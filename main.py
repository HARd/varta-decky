import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import decky
try:
    import ssl
    SSL_CONTEXT = ssl.create_default_context()
    SSL_CONTEXT.check_hostname = False
    SSL_CONTEXT.verify_mode = ssl.CERT_NONE
except Exception:
    SSL_CONTEXT = None


DEFAULT_SETTINGS = {
    "markHostile": True,
    "markUkrainian": True,
    "hostileColor": "#7a2a2a",
    "ukrainianColor": "#27ae60",
    "overlayOpacity": 0.35,
    "showBadges": True,
    "remoteDatabaseEnabled": True,
    "remoteDatabaseUrl": "https://api.varta.games/public",
    "libraryBadgePosition": "bottom-right",
    "libraryBadgeStyle": "text",
    "language": "uk",
    "showReportButton": True,
    "lastSeenHostileCount": 0,
    "lastSeenUkrCount": 0,
    "analyticsEnabled": True,
    "analyticsId": "",
}

CACHE_TTL_SECONDS = 60 * 60 * 24 * 14
REMOTE_DATABASE_TTL_SECONDS = 60 * 60

DESKTOP_KEY = "VARTA_INJECT_KEY_HERE"


class Plugin:
    async def _main(self):
        try:
            await self._ensure_loaded()
        except Exception as e:
            import traceback
            err = traceback.format_exc()
            decky.logger.error(f"VARTA _main error:\n{err}")
            self._send_sentry_event(f"Init error: {e}", exc_info=err)

    async def _ensure_loaded(self):
        if getattr(self, "_loaded", False):
            return
        if getattr(self, "_loading", False):
            while getattr(self, "_loading", False):
                await asyncio.sleep(0.1)
            return
        self._loading = True

        try:
            self._plugin_dir = os.path.dirname(os.path.realpath(__file__))
            self._data_path = os.path.join(self._plugin_dir, "data", "developers.json")
            self._settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            
            if not os.path.exists(self._settings_path):
                self._settings = {}
                self._is_fresh = True
            else:
                self._settings = self._load_json(self._settings_path, DEFAULT_SETTINGS)
                self._is_fresh = False
            
            # Force migration
            if "firebase" in str(self._settings.get("remoteDatabaseUrl", "")).lower():
                self._settings["remoteDatabaseUrl"] = "https://api.varta.games/public"
                self._save_json(self._settings_path, self._settings)
            import sys
            import pkgutil
            import importlib
            import inspect

            ext_path = os.path.join(decky.DECKY_PLUGIN_DIR, "py_modules")
            if ext_path not in sys.path:
                sys.path.insert(0, ext_path)
                
            from extensions.base import ExtensionBase
            
            self.extensions = []
            extensions_dir = os.path.join(ext_path, "extensions")
            
            for _, module_name, _ in pkgutil.iter_modules([extensions_dir]):
                if module_name == "base":
                    continue
                try:
                    module = importlib.import_module(f"extensions.{module_name}")
                    for name, obj in inspect.getmembers(module, inspect.isclass):
                        if issubclass(obj, ExtensionBase) and obj is not ExtensionBase:
                            ext_instance = obj(decky.DECKY_PLUGIN_DIR, decky.DECKY_PLUGIN_SETTINGS_DIR)
                            await ext_instance.initialize(self._settings)
                            self.extensions.append(ext_instance)
                            decky.logger.info(f"VARTA: Loaded extension {obj.__name__} from {module_name}")
                except Exception as e:
                    import traceback
                    decky.logger.error(f"VARTA: Failed to load extension {module_name}: {e}\n{traceback.format_exc()}")
            
            decky.logger.info(f"Modular extensions loaded (total {len(self.extensions)})")
            self._loaded = True

            self._cache_dirty = False
            self._cache = self._load_json(os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "appdetails-cache.json"), {})

            # Ensure a stable analytics ID exists
            if not self._settings.get("analyticsId"):
                self._settings["analyticsId"] = str(uuid.uuid4())
                self._save_json(self._settings_path, self._settings)

            asyncio.create_task(self._auto_refresh_loop())
            asyncio.create_task(self._cache_saver_loop())
            self._send_posthog("plugin_loaded", {
                "db_version": "modular",
                "db_source": "extensions",
            })
        except Exception as e:
            import traceback
            decky.logger.error(f"Failed to load VARTA backend: {e}")
            self._send_sentry_event(f"Load error: {e}", exc_info=traceback.format_exc())
            raise
        finally:
            self._loading = False

    async def _cache_saver_loop(self):
        while True:
            await asyncio.sleep(30)
            if getattr(self, "_cache_dirty", False):
                try:
                    await self._save_cache(force=True)
                except Exception as e:
                    decky.logger.error(f"Failed to save cache in background loop: {e}")

    async def _unload(self):
        await self._ensure_loaded()
        await self._save_cache(force=True)
        self._save_json(self._settings_path, self._settings)

    async def get_database_stats(self):
        try:
            await self._ensure_loaded()
            
            # Find VartaExtension and get stats
            for ext in self.extensions:
                if type(ext).__name__ == "VartaExtension":
                    if hasattr(ext, "get_stats"):
                        return ext.get_stats()
            
            return {"status": "modular", "hostileCount": 0, "ukrainianCount": 0, "reportsCount": 0}
        except Exception as e:
            import traceback
            err_trace = traceback.format_exc()
            decky.logger.error(f"VARTA get_database_stats error:\n{err_trace}")
            self._send_sentry_event(f"DB Stats error: {e}", exc_info=err_trace)
            return {"error": err_trace}

    async def _auto_refresh_loop(self):
        while True:
            await asyncio.sleep(3600)  # 1 hour
            decky.logger.info("Auto-refreshing VARTA database...")
            try:
                await self._refresh_database()
            except Exception as e:
                decky.logger.error(f"Auto-refresh failed: {e}")

    async def get_settings(self):
        res = {**DEFAULT_SETTINGS, **self._settings}
        res["_is_fresh"] = getattr(self, "_is_fresh", False)
        return res

    async def save_settings(self, *args, **kwargs):
        decky.logger.info(f"save_settings called with args={args} kwargs={kwargs}")
        await self._ensure_loaded()
        
        settings = {}
        if args and isinstance(args[0], dict):
            settings = args[0]
        elif kwargs:
            settings = kwargs.get("settings", kwargs)
            
        if "settings" in settings and isinstance(settings["settings"], dict):
            settings = settings["settings"]
            
        sanitized = {**DEFAULT_SETTINGS, **settings}
        
        if not sanitized.get("analyticsId") and self._settings.get("analyticsId"):
            sanitized["analyticsId"] = self._settings.get("analyticsId")
            
        self._settings = sanitized
        self._save_json(self._settings_path, self._settings)
        return self._settings

    async def set_setting(self, key, value):
        decky.logger.info(f"set_setting: {key} = {value}")
        await self._ensure_loaded()
        
        if key == "analyticsId" and not value and self._settings.get("analyticsId"):
            return self._settings
            
        self._settings[key] = value
        self._save_json(self._settings_path, self._settings)
        return self._settings

    async def refresh_database(self, force=True):
        await self._ensure_loaded()
        await self._refresh_database(force=force)
        return await self.get_database_stats()

    def _parse_version(self, v_str):
        v_str = str(v_str).lstrip('v')
        parts = v_str.split('-', 1)
        main_parts = parts[0].split('.')
        try:
            major = int(main_parts[0]) if len(main_parts) > 0 else 0
            minor = int(main_parts[1]) if len(main_parts) > 1 else 0
            patch = int(main_parts[2]) if len(main_parts) > 2 else 0
        except ValueError:
            return (0, 0, 0, 0)
        weight = 1 if len(parts) > 1 and 'testing' in parts[1] else 2
        return (major, minor, patch, weight)

    async def get_update_status(self):
        await self._ensure_loaded()
        now = time.time()
        if now - getattr(self, "_update_checked_at", 0) < 3600:
            return getattr(self, "_update_info", {"hasUpdate": False, "latestVersion": ""})

        self._update_checked_at = now
        info = {"hasUpdate": False, "latestVersion": "", "downloadUrl": ""}

        def _check():
            try:
                pkg_path = os.path.join(self._plugin_dir, "package.json")
                with open(pkg_path, "r", encoding="utf-8") as f:
                    current = json.load(f).get("version", "0.0.0")

                req = urllib.request.Request("https://api.github.com/repos/HARd/varta-decky/releases", headers={"User-Agent": "varta-decky/1.0"})
                with urllib.request.urlopen(req, timeout=10, context=SSL_CONTEXT) as response:
                    if response.getcode() == 200:
                        releases = json.loads(response.read().decode("utf-8"))
                        current_is_stable = "stable" in current.lower()
                        current_is_testing = "testing" in current.lower()
                        
                        latest = None
                        for r in releases:
                            tag = r.get("tag_name", "").lstrip("v")
                            is_match = False
                            if current_is_stable and "stable" in tag.lower():
                                is_match = True
                            elif current_is_testing and "testing" in tag.lower():
                                is_match = True
                            elif not current_is_stable and not current_is_testing:
                                is_match = True
                                
                            if is_match:
                                latest = tag
                                for asset in r.get("assets", []):
                                    if asset.get("name", "").endswith(".zip"):
                                        info["downloadUrl"] = asset.get("browser_download_url", "")
                                        break
                                break

                        if latest and self._parse_version(latest) > self._parse_version(current):
                            info["hasUpdate"] = True
                            info["latestVersion"] = latest
            except Exception as e:
                decky.logger.error(f"Failed to check for updates: {e}")
            return info

        self._update_info = await asyncio.get_event_loop().run_in_executor(None, _check)
        return self._update_info

    async def apply_update(self):
        await self._ensure_loaded()
        info = getattr(self, "_update_info", {})
        url = info.get("downloadUrl")
        if not url:
            return {"success": False, "error": "No download URL found"}
            
        def _do_update():
            import subprocess
            import shutil
            import uuid
            try:
                update_id = str(uuid.uuid4())
                zip_path = f"/tmp/varta-update-{update_id}.zip"
                extract_path = f"/tmp/varta-update-extract-{update_id}"
                
                decky.logger.info(f"Downloading update from {url}")
                req = urllib.request.Request(url, headers={"User-Agent": "varta-decky/1.0"})
                with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as response, open(zip_path, 'wb') as out_file:
                    shutil.copyfileobj(response, out_file)
                    
                if os.path.exists(extract_path):
                    shutil.rmtree(extract_path)
                os.makedirs(extract_path, exist_ok=True)
                
                decky.logger.info("Extracting update zip")
                subprocess.check_call(["unzip", "-o", zip_path, "-d", extract_path])
                
                extracted_dirs = [d for d in os.listdir(extract_path) if os.path.isdir(os.path.join(extract_path, d))]
                if not extracted_dirs:
                    raise Exception("No directory inside zip")
                    
                source_dir = os.path.join(extract_path, extracted_dirs[0])
                decky.logger.info(f"Copying files from {source_dir} to {self._plugin_dir}")
                
                for root_dir, dirs, files in os.walk(source_dir):
                    for name in files:
                        src_file = os.path.join(root_dir, name)
                        rel_path = os.path.relpath(src_file, source_dir)
                        dst_file = os.path.join(self._plugin_dir, rel_path)
                        
                        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                        if os.path.exists(dst_file):
                            try:
                                os.remove(dst_file)
                            except Exception:
                                pass
                        shutil.copyfile(src_file, dst_file)
                
                decky.logger.info("Update files copied successfully. Awaiting manual restart.")
                return {"success": True}
                
            except Exception as e:
                import traceback
                err = traceback.format_exc()
                decky.logger.error(f"Update failed: {err}")
                return {"success": False, "error": str(e)}

        return await asyncio.get_event_loop().run_in_executor(None, _do_update)

    async def get_cef_debugger_url(self):
        import os
        path = os.path.expanduser("~/.local/share/Steam/.cef-enable-remote-debugging")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    port = f.read().strip()
                    if port.isdigit():
                        return f"http://localhost:{port}/json"
            except Exception:
                pass
        return "http://localhost:8080/json"

    async def get_app_status(self, appid):
        await self._ensure_loaded()
        details = await asyncio.get_event_loop().run_in_executor(None, self._fetch_appdetails, appid)
        details = details or {}
        
        status = {"appid": str(appid)}
        if details and "name" in details:
            status["name"] = details["name"]
        
        for ext in self.extensions:
            try:
                ext_status = await ext.get_app_status(str(appid), details, self._settings)
                if ext_status:
                    status.update(ext_status)
            except Exception as e:
                import traceback
                decky.logger.error(f"VARTA extension error for {appid}: {e}\n{traceback.format_exc()}")
        return status

    async def get_app_statuses(self, appids):
        # Process a batch of appids concurrently
        tasks = [self.get_app_status(appid) for appid in appids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for appid, result in zip(appids, results):
            if isinstance(result, Exception):
                decky.logger.error(f"VARTA batch error for {appid}: {result}")
                response[str(appid)] = {"appid": str(appid), "error": str(result)}
            else:
                response[str(appid)] = result
        return response

    async def search_database(self, query, limit=40):
        # Deprecated
        return {"hostile": [], "ukrainian": []}

    async def report_game(self, payload):
        await self._ensure_loaded()
        url = "https://api.varta.games/public/reports"
        raw_data = payload.get("data", {})
        if not raw_data:
            return False
            
        data = {
            "name": raw_data.get("name", "Unknown Game"),
            "developer": raw_data.get("developer", ""),
            "steamAppId": str(raw_data.get("appid", "")),
            "source": "steam-deck",
            "steamId": str(raw_data.get("steamId", ""))
        }

        def _send():
            try:
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "varta-decky/1.0"
                }
                INJECT_PLACEHOLDER = "VARTA_" + "INJECT_KEY_HERE"
                if DESKTOP_KEY and DESKTOP_KEY != INJECT_PLACEHOLDER:
                    headers["X-Desktop-Key"] = DESKTOP_KEY
                    
                req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=12, context=SSL_CONTEXT) as response:
                    return response.getcode() in (200, 201, 202, 204)
            except Exception as e:
                decky.logger.error(f"Failed to report game: {e}")
                return False

        success = await asyncio.get_event_loop().run_in_executor(None, _send)
        if success:
            self._send_posthog("game_reported", {
                "appid": str(raw_data.get("appid", "")),
            })
        return success

    def _fetch_appdetails(self, appid):
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        req = urllib.request.Request(url, headers={"User-Agent": "varta-decky/0.2"})
        payload = None
        try:
            with urllib.request.urlopen(req, timeout=8, context=SSL_CONTEXT) as response:
                if response.getcode() == 200:
                    payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            decky.logger.warning("Failed to fetch appdetails from Steam for %s: %s", appid, exc)

        if payload:
            entry = payload.get(appid)
            if entry and entry.get("success") and entry.get("data"):
                data = entry["data"]
                return {
                    "name": data.get("name") or "Unknown Game",
                    "developers": data.get("developers") or [],
                    "publishers": data.get("publishers") or [],
                }
        return None

    async def _refresh_database(self, force=False):
        for ext in self.extensions:
            try:
                await ext.refresh_database(self._settings, force=force)
            except Exception as e:
                decky.logger.error(f"Failed to refresh extension {type(ext).__name__}: {e}")

    def _clean_api_url(self, url):
        return url.strip().rstrip("/")

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
            handle.write("\n")
        os.replace(tmp_path, path)

    async def _save_cache(self, force=False):
        if not force:
            self._cache_dirty = True
            return
        self._cache_dirty = False
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._save_json, self._cache_path, self._cache)

    async def report_frontend_error(self, message, stack=""):
        decky.logger.error(f"Frontend Error: {message}\n{stack}")
        try:
            self._send_sentry_event(message, exc_info=stack, extra_tags={"source": "frontend"})
        except Exception:
            pass
        return True

    # ── Analytics ────────────────────────────────────────────────────────────

    async def track_event(self, event, properties=None):
        """Called from the frontend to fire a PostHog event."""
        await self._ensure_loaded()
        self._send_posthog(event, properties or {})
        return True

    def _send_posthog(self, event, properties=None):
        """Fire-and-forget PostHog capture. Skipped when analyticsEnabled is False."""
        try:
            if not self._settings.get("analyticsEnabled", True):
                return
            distinct_id = self._settings.get("analyticsId") or "unknown"
            payload = {
                "api_key": "phc_B2ercmwcgojA4buu6vzghzsY3F6HtdFUug8LeeZK6iwL",
                "event": event,
                "properties": {
                    "distinct_id": distinct_id,
                    "client": "decky-plugin",
                    **(properties or {}),
                },
            }

            def _do_send():
                try:
                    req = urllib.request.Request(
                        "https://eu.i.posthog.com/capture/",
                        data=json.dumps(payload).encode("utf-8"),
                        headers={"Content-Type": "application/json", "User-Agent": "varta-decky/1.0"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT):
                        pass
                except Exception as e:
                    decky.logger.debug(f"PostHog send failed for '{event}': {e}")

            import threading
            threading.Thread(target=_do_send, daemon=True).start()
        except Exception as e:
            decky.logger.debug(f"PostHog setup failed: {e}")

    def _send_sentry_event(self, message, exc_info=None, extra_tags=None):
        try:
            url = "https://o426573.ingest.us.sentry.io/api/4511482012762112/store/"
            payload = {
                "event_id": uuid.uuid4().hex,
                "timestamp": int(time.time()),
                "level": "error",
                "logger": "varta-decky",
                "platform": "python",
                "message": str(message)[:1000],
                "tags": {"source": "backend"}
            }
            if extra_tags:
                payload["tags"].update(extra_tags)
                
            if exc_info:
                payload["exception"] = {
                    "values": [{
                        "type": "Exception",
                        "value": str(exc_info)[:2000],
                    }]
                }
                
            headers = {
                "Content-Type": "application/json",
                "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=b8414e0a5fa8cc6fce67a6daafe48f37, sentry_client=varta-decky/1.0"
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT) as response:
                pass
        except Exception as e:
            decky.logger.warning(f"Failed to send Sentry event: {e}")
