"""Клієнт Prystanok API: батчі, кеш на диску, backoff на 429.

Адаптовано з decky-prystanok (https://github.com/Ka3u6y6a/decky-prystanok).
Чистий Python без decky, тож запускається і на машині розробника.
"""

import asyncio
import json
import logging
import os
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import aiohttp  # є в python, який постачає decky-loader
except ImportError:  # локально обходимось urllib
    aiohttp = None

API_BASE = "https://prystanok.com.ua/api"
BATCH_LIMIT = 100  # більше 100 appid за запит API не приймає
CACHE_TTL = 7 * 24 * 3600  # ігри, які є в базі
MISSING_TTL = 24 * 3600  # appid, яких Пристанок не знає
STALE_LIMIT = 30 * 24 * 3600  # старіші записи викидаємо з кешу зовсім
REQUEST_TIMEOUT = 10  # секунд
RETRY_DELAYS = (2, 5, 10)  # секунд, на HTTP 429
NET_RETRY_DELAY = 1  # мережеву помилку повторюємо лише раз
DOWN_PAUSE = 5 * 60  # після невдалого запиту стільки не ходимо в мережу

logger = logging.getLogger("varta.prystanok")


def _build_ssl_context():
    # у python від decky-loader нема шляху до CA за замовчуванням, вказуємо сами
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for path in ("/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


SSL_CTX = _build_ssl_context()


def _useful(model):
    # на невідомий appid API віддає не null, а модель з самими null:
    # {"SteamAppId": 1, "KuliGame": null, "SteamGame": null, ...}
    if not isinstance(model, dict):
        return None
    if not model.get("KuliGame") and not model.get("SteamGame"):
        return None
    return model


class PrystanokClient:
    def __init__(self, cache_path, user_agent, log=None):
        self.cache_path = cache_path
        self.user_agent = user_agent
        self.log = log or logger
        # appid(int) -> {"t": коли отримали, "d": сира модель | None (None = гри нема в базі)}
        self._cache = {}
        self._fetch_lock = asyncio.Lock()
        self._down_until = 0.0
        self._load_disk_cache()

    # ---------- кеш ----------

    def _load_disk_cache(self):
        try:
            with open(self.cache_path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            self._cache = {int(k): {"t": v.get("t", 0), "d": _useful(v.get("d"))} for k, v in stored.items()}
            self.log.info("prystanok cache loaded: %d entries", len(self._cache))
        except FileNotFoundError:
            self._cache = {}
        except Exception as exc:
            self.log.warning("prystanok cache unreadable, starting fresh: %s", exc)
            self._cache = {}

    def _write_file(self, snapshot):
        directory = os.path.dirname(self.cache_path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(snapshot, f)
            os.replace(tmp, self.cache_path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    async def _save_disk_cache(self):
        # прострочене тримаємо як запас на випадок, коли API лежить, але не вічно
        cutoff = time.time() - STALE_LIMIT
        self._cache = {k: v for k, v in self._cache.items() if v.get("t", 0) >= cutoff}
        snapshot = {str(k): v for k, v in self._cache.items()}
        try:
            await asyncio.to_thread(self._write_file, snapshot)
        except Exception as exc:
            self.log.warning("prystanok cache write failed: %s", exc)

    def clear_cache(self):
        self._cache = {}
        self._down_until = 0.0  # ручне оновлення має право спробувати знову одразу
        try:
            os.remove(self.cache_path)
        except FileNotFoundError:
            pass

    def _fresh(self, appid):
        entry = self._cache.get(appid)
        if entry is None:
            return None
        ttl = CACHE_TTL if entry.get("d") is not None else MISSING_TTL
        if time.time() - entry.get("t", 0) > ttl:
            return None
        return entry

    # ---------- http ----------

    async def _http_get(self, url):
        """Повертає (status, body). На деку через aiohttp, локально через urllib."""
        if aiohttp is not None:
            async with aiohttp.ClientSession(headers={"User-Agent": self.user_agent}) as session:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT), ssl=SSL_CTX
                ) as resp:
                    return resp.status, await resp.text()

        def blocking():
            req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
            try:
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=SSL_CTX) as resp:
                    return resp.status, resp.read().decode("utf-8")
            except urllib.error.HTTPError as err:
                return err.code, err.read().decode("utf-8", "replace")

        return await asyncio.to_thread(blocking)

    def _parse(self, appids, body):
        """{appid: модель|None} або None, якщо відповідь не схожа на очікувану."""
        try:
            payload = json.loads(body)
        except ValueError as exc:
            self.log.warning("prystanok returned invalid JSON: %s", exc)
            return None
        if not isinstance(payload, dict):
            self.log.warning("prystanok returned %s instead of an object", type(payload).__name__)
            return None
        result = {appid: None for appid in appids}
        for key, model in payload.items():
            try:
                result[int(key)] = model
            except (TypeError, ValueError):
                continue
        return result

    async def _fetch_batch(self, appids):
        """Один запит (<=100 appid). Повертає {appid: модель|None} або None, якщо не вдалось."""
        query = urllib.parse.urlencode({"appids": ",".join(map(str, appids))})
        url = f"{API_BASE}/games/steam?{query}"
        net_failures = 0
        rate_limited = 0
        while True:
            try:
                status, body = await self._http_get(url)
            except Exception as exc:
                net_failures += 1
                self.log.warning("prystanok request failed (attempt %d): %s", net_failures, exc)
                if net_failures > 1:
                    return None
                await asyncio.sleep(NET_RETRY_DELAY)
                continue
            if status == 429:
                if rate_limited >= len(RETRY_DELAYS):
                    self.log.warning("prystanok still rate limited, giving up")
                    return None
                self.log.info("prystanok rate limited, retrying")
                await asyncio.sleep(RETRY_DELAYS[rate_limited])
                rate_limited += 1
                continue
            if status != 200:
                self.log.warning("prystanok HTTP %d: %.200s", status, body)
                return None
            return self._parse(appids, body)

    # ---------- публічне ----------

    async def get_games(self, appids):
        """Сира модель на кожен appid, спершу з кешу. Під локом одночасні
        виклики чекають одне одного, тож сплеск запитів стає кількома
        батчами, а не запитом на кожну гру."""
        ids = []
        for a in appids:
            try:
                ids.append(int(a))
            except (TypeError, ValueError):
                continue  # не Steam appid, Пристанку про нього нічого питати
        ids = list(dict.fromkeys(ids))

        result = {}
        missing = []
        for appid in ids:
            entry = self._fresh(appid)
            if entry is not None:
                result[appid] = entry["d"]
            else:
                missing.append(appid)

        if missing:
            async with self._fetch_lock:
                # поки чекали на лок, наші appid міг уже хтось стягнути
                still_missing = [a for a in missing if self._fresh(a) is None]
                # якщо API щойно не відповів, не мучимо його кожною грою по черзі
                if still_missing and time.time() >= self._down_until:
                    await self._fetch_missing(still_missing)
            for appid in missing:
                entry = self._cache.get(appid)  # у гіршому разі — прострочене
                result[appid] = entry["d"] if entry else None

        return result

    async def _fetch_missing(self, appids):
        now = time.time()
        fetched = 0
        requests = 0
        for i in range(0, len(appids), BATCH_LIMIT):
            batch = appids[i : i + BATCH_LIMIT]
            batch_result = await self._fetch_batch(batch)
            if batch_result is None:
                self._down_until = time.time() + DOWN_PAUSE
                self.log.warning("prystanok unavailable, pausing requests for %d min", DOWN_PAUSE // 60)
                break
            for appid, model in batch_result.items():
                self._cache[appid] = {"t": now, "d": _useful(model)}
            fetched += len(batch)
            requests += 1
        if fetched:
            self.log.info("prystanok fetched %d appids in %d request(s)", fetched, requests)
            await self._save_disk_cache()
