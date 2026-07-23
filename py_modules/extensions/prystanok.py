import asyncio
import json
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

class PrystanokExtension(ExtensionBase):
    """
    Робить запити до Prystanok API на льоту, кешує результати в пам'яті (LRU).
    """
    
    def __init__(self, plugin_dir, settings_dir):
        super().__init__(plugin_dir, settings_dir)
        self._cache = {}
        self._inflight = {}
        self._lock = asyncio.Lock()
        
    async def get_app_status(self, appid: str, app_details: dict, settings: dict) -> dict:
        appid = str(appid)
        
        async with self._lock:
            if appid in self._cache:
                return {"prystanok": self._cache[appid]}
                
            if appid in self._inflight:
                event = self._inflight[appid]
                do_fetch = False
            else:
                event = asyncio.Event()
                self._inflight[appid] = event
                do_fetch = True
                
        if do_fetch:
            data = await asyncio.get_event_loop().run_in_executor(None, self._fetch_prystanok, appid)
            async with self._lock:
                self._cache[appid] = data
                event.set()
                del self._inflight[appid]
        else:
            await event.wait()
            async with self._lock:
                data = self._cache.get(appid, {})
                
        if data:
            return {"prystanok": data}
        return {}
        
    def _fetch_prystanok(self, appid: str):
        url = f"https://prystanok.com.ua/api/games/steam?appids={appid}"
        req = urllib.request.Request(url, headers={"User-Agent": "varta-decky/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=10, context=SSL_CONTEXT) as response:
                if response.getcode() == 200:
                    payload = json.loads(response.read().decode("utf-8"))
                    if isinstance(payload, dict):
                        return payload.get(str(appid)) or {}
        except Exception as e:
            decky.logger.warning(f"Failed to fetch prystanok data for {appid}: {e}")
            
        return {}
