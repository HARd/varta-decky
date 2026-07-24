import asyncio
import json
import os
import time
import urllib.request
import urllib.error
import decky

from .base import ExtensionBase

try:
    import ssl
    SSL_CONTEXT = ssl.create_default_context()
    SSL_CONTEXT.check_hostname = False
    SSL_CONTEXT.verify_mode = ssl.CERT_NONE
except Exception:
    SSL_CONTEXT = None

class VartaExtension(ExtensionBase):
    """
    Модуль VARTA. 
    Перевіряє ігри за іменами розробників (developers.json) та точними AppID (hostileid.json / ukrainianid.json).
    """
    
    def __init__(self, plugin_dir, settings_dir):
        super().__init__(plugin_dir, settings_dir)
        self._database = {"hostile": [], "ukrainian": [], "hostile_ids": [], "ukrainian_ids": [], "reports": []}
        self._etags = {}
        
        self._db_cache_path = os.path.join(self.settings_dir, "varta-database-cache.json")
        self._etags_path = os.path.join(self.settings_dir, "varta-etags.json")
        
        self._hostile_set = set()
        self._ukrainian_set = set()
        self._hostile_id_set = set()
        self._ukrainian_id_set = set()
        self._report_id_set = set()

    def _load_json(self, path, fallback):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            return fallback.copy() if isinstance(fallback, dict) else fallback

    def _save_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)

    async def initialize(self, settings: dict):
        self._database = self._load_json(self._db_cache_path, {"hostile": [], "ukrainian": [], "hostile_ids": [], "ukrainian_ids": [], "reports": []})
        self._etags = self._load_json(self._etags_path, {})
        self._update_sets()
        decky.logger.info(f"VARTA Extension loaded {len(self._hostile_set)} hostile devs, {len(self._hostile_id_set)} hostile appids.")

    def _update_sets(self):
        self._hostile_set = set(self._database.get("hostile", []))
        self._ukrainian_set = set(self._database.get("ukrainian", []))
        self._hostile_id_set = set(str(x) for x in self._database.get("hostile_ids", []))
        self._ukrainian_id_set = set(str(x) for x in self._database.get("ukrainian_ids", []))
        self._report_id_set = set(str(x) for x in self._database.get("reports", []))

    async def get_app_status(self, appid: str, app_details: dict, settings: dict) -> dict:
        appid = str(appid)
        
        # 1. Точна перевірка за AppID (пріоритет)
        is_hostile_id = appid in self._hostile_id_set
        is_ukrainian_id = appid in self._ukrainian_id_set
        
        # 2. Перевірка за іменами розробників/видавців
        names = list(dict.fromkeys(app_details.get("developers", []) + app_details.get("publishers", [])))
        hostile_names = [name for name in names if name in self._hostile_set]
        ukrainian_names = [name for name in names if name in self._ukrainian_set]

        mark_type = None
        if settings.get("markHostile", True) and (is_hostile_id or hostile_names):
            mark_type = "hostile"
        elif settings.get("markUkrainian", True) and (is_ukrainian_id or ukrainian_names):
            mark_type = "ukrainian"
        elif appid in self._report_id_set:
            mark_type = "in_review"

        if mark_type:
            return {
                "varta": {
                    "type": mark_type,
                    "matches": {
                        "hostile": hostile_names,
                        "ukrainian": ukrainian_names,
                        "matched_by_id": is_hostile_id or is_ukrainian_id
                    }
                }
            }
        return {}

    def get_stats(self):
        return {
            "source": "remote" if self._etags else "bundled",
            "version": self._database.get("version", "unknown"),
            "hostileCount": len(self._hostile_set),
            "ukrainianCount": len(self._ukrainian_set),
            "reportsCount": len(self._report_id_set),
        }

    async def refresh_database(self, settings: dict, force: bool = False):
        if not settings.get("remoteDatabaseEnabled", True):
            return

        base_url = str(settings.get("remoteDatabaseUrl", "https://api.varta.games/public")).strip().rstrip("/")
        if not base_url:
            return

        def fetch_node(node, default_value):
            req = urllib.request.Request(f"{base_url}/{node}.json", headers={"User-Agent": "varta-decky/1.0"})
            if not force and node in self._etags:
                req.add_header("If-None-Match", self._etags[node])
            try:
                with urllib.request.urlopen(req, timeout=10, context=SSL_CONTEXT) as response:
                    etag = response.headers.get("ETag")
                    if etag:
                        self._etags[node] = etag
                    data = json.loads(response.read().decode("utf-8"))
                    return data if data is not None else default_value
            except urllib.error.HTTPError as e:
                if e.code == 304:
                    return self._database.get(node, default_value)
                return default_value
            except Exception:
                return default_value

        try:
            loop = asyncio.get_event_loop()
            
            def _fetch_all():
                version_data = fetch_node("version", {})
                return {
                    "version": version_data.get("version", "unknown") if isinstance(version_data, dict) else "unknown",
                    "hostile": fetch_node("hostile", []),
                    "ukrainian": fetch_node("ukrainian", []),
                    "hostile_ids": fetch_node("hostileid", []),
                    "ukrainian_ids": fetch_node("ukrainianid", []),
                    "reports": fetch_node("reports", []),
                }

            new_db = await loop.run_in_executor(None, _fetch_all)
            
            self._database = new_db
            self._update_sets()
            
            await loop.run_in_executor(None, self._save_json, self._db_cache_path, self._database)
            await loop.run_in_executor(None, self._save_json, self._etags_path, self._etags)
        except Exception as e:
            decky.logger.warning(f"VARTA Extension refresh failed: {e}")
