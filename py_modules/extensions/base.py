class ExtensionBase:
    """
    Базовий клас для модулів VARTA.
    """
    def __init__(self, plugin_dir, settings_dir):
        self.plugin_dir = plugin_dir
        self.settings_dir = settings_dir

    async def initialize(self, settings: dict):
        """Викликається один раз при завантаженні (або перезавантаженні налаштувань)."""
        pass

    async def get_app_status(self, appid: str, app_details: dict, settings: dict) -> dict:
        """
        Повертає статус гри для даного appid.
        app_details - це базові дані гри (name, developers, publishers), які ядро стягнуло зі Steam,
        щоб кожному модулю не доводилось робити це окремо.
        """
        return {}

    async def refresh_database(self, settings: dict, force: bool = False):
        """Оновлює бази даних з мережі, якщо потрібно."""
        pass
