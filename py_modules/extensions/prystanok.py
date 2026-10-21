import os

import decky

from .base import ExtensionBase
from .prystanok_lib.client import PrystanokClient


class PrystanokExtension(ExtensionBase):
    """
    Дані Пристанку для гри. Віддає фронту сирий AggregatedGameModel під ключем
    "prystanok", класифікація — на фронті (src/extensions/prystanok/classify.ts).
    """

    def __init__(self, plugin_dir, settings_dir):
        super().__init__(plugin_dir, settings_dir)
        cache_dir = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", settings_dir)
        version = getattr(decky, "DECKY_PLUGIN_VERSION", "dev")
        self._client = PrystanokClient(
            os.path.join(cache_dir, "prystanok-cache.json"),
            user_agent=f"varta-decky/{version}",
            log=decky.logger,
        )

    async def prefetch(self, appids: list, settings: dict):
        await self._client.get_games(appids)

    async def get_app_status(self, appid: str, app_details: dict, settings: dict) -> dict:
        games = await self._client.get_games([appid])
        data = games.get(int(appid))
        return {"prystanok": data} if data else {}

    async def refresh_database(self, settings: dict, force: bool = False):
        # force=True приходить лише з кнопки оновлення в QAM
        if force:
            self._client.clear_cache()
