# Додавання нових модулів (Розширень) / Adding New Modules (Extensions)

Архітектура плагіна побудована навколо концепції **модулів (extensions)**. Кожен модуль — це незалежний набір правил, бейджів, іконок та налаштувань. Це дозволяє легко додавати нові перевірки та інтеграції (наприклад, VARTA для розробників, Prystanok для локалізаторів, тощо) без зміни основного ядра плагіна.

The plugin architecture is built around the concept of **modules (extensions)**. Each module is an independent set of rules, badges, icons, and settings. This makes it easy to add new checks and integrations without altering the core of the plugin.

---

## Архітектура (Architecture Overview)

```mermaid
flowchart TD
    Steam(Steam Client) --> TS(Frontend: index.tsx / storePatch.ts)
    TS -- "get_app_status(appid)" --> PY(Backend: main.py)
    
    subgraph Python Backend
        PY -- "Auto-loads .py files" --> Ext1PY[VartaExtension]
        PY -- "Auto-loads .py files" --> Ext2PY[PrystanokExtension]
        Ext1PY -- "Check local/remote data" --> VartaDB[(Varta DB)]
        Ext2PY -- "Check local/remote data" --> PrystanokDB[(Prystanok DB)]
    end

    Ext1PY -- "Result: VARTA" --> PY
    Ext2PY -- "Result: Prystanok" --> PY
    PY -- "Combined AppStatus" --> TS

    subgraph TypeScript Frontend
        Gen[generate-registry.mjs] -- "Pre-build step" --> Reg[registry.ts Auto-Generated]
        TS --> Reg
        Reg --> Ext1TS[VartaExtension]
        Reg --> Ext2TS[PrystanokExtension]
        Ext1TS -- "Generate UI Chips" --> TS
        Ext2TS -- "Generate UI Chips" --> TS
    end
    
    TS -- "Render to Screen" --> Steam
```

---
##  Структура модуля (Module Structure)

Модуль складається з двох частин:
1. **Python-бекенд** (`py_modules/extensions/`): Відповідає за завантаження бази даних, збереження в кеш та перевірку, чи має гра відповідний статус.
2. **TypeScript-фронтенд** (`src/extensions/`): Відповідає за відмальовування бейджів (картинок/тексту) в інтерфейсі Steam (картка гри, магазин) та рендеринг меню налаштувань.

---

##  1. Python-частина (Backend)

Створіть файл вашого модуля (наприклад, `my_module.py`) у папці `py_modules/extensions/`.
Він повинен успадковувати базовий клас `BaseExtension`.

```python
# py_modules/extensions/my_module.py
import os
from .base import BaseExtension

class MyModuleExtension(BaseExtension):
    def __init__(self, data_dir, logger):
        # Вкажіть шлях до кешу для вашого модуля
        cache_path = os.path.join(data_dir, "my_module_cache.json")
        super().__init__(cache_path, logger)
        
        # Наприклад, ваша база
        self._database = {"status1": ["123", "456"]}

    def check_app(self, appid, name, developer, publisher):
        # Логіка перевірки гри. Повинна повертати словник.
        # Якщо гра не знайдена, поверніть {"type": None}
        if appid in self._database["status1"]:
            return {"type": "status1"}
        return {"type": None}
        
    async def refresh_database(self):
        # Логіка оновлення бази (наприклад, завантаження з мережі)
        pass
```
```

**Це все для бекенду!** Плагін автоматично просканує папку `py_modules/extensions/`, знайде ваш клас і підключить його до ядра. Жодних змін у `main.py` робити не потрібно.

---

## 2. TypeScript-частина (Frontend)

Створіть папку вашого модуля в `src/extensions/` (наприклад, `src/extensions/my_module/`) та створіть файл `index.tsx`.
Він повинен реалізовувати інтерфейс `Extension`.

```tsx
// src/extensions/my_module/index.tsx
import { Extension } from "../base";
import { PluginSettings } from "../../types";

const MyModuleExtension: Extension = {
  id: "my_module",
  name: "My Custom Module",
  
  // Компонент меню налаштувань (використовуйте компоненти з @decky/ui)
  SettingsComponent: ({ settings, setSettings }) => {
    return (
      <div>Налаштування мого модуля</div>
    );
  },

  // Отримання бейджа для сторінки гри (Game Page)
  getBadgePayload: (status, settings) => {
    if (status.type === "status1") {
      return {
        type: "status1",
        label: "Знайдено!",
        background: "rgba(0, 100, 200, 0.8)",
        isIcon: false, // true, якщо хочете відрендерити іконку
      };
    }
    return null;
  },

  // Отримання бейджа для Steam Store
  getStoreBadgePayload: (status, settings) => {
    if (status.type === "status1") {
      return {
        appid: status.appid,
        type: "status1",
        label: "Знайдено у MyModule",
        background: "rgba(0, 100, 200, 0.85)",
        border: "rgba(100, 200, 255, 0.65)",
        shadow: "rgba(0, 0, 0, 0.5)",
        isIcon: false,
      };
    }
    return null;
  },
};

export default MyModuleExtension;
```

**Це все для фронтенду!** Наш пре-білд скрипт автоматично знайде вашу папку під час `npm run build` і підключить її до інтерфейсу. Жодних `registry.ts` правити не треба!

---

## Це все! / That's it!

Плагін автоматично:
1. Викличе ваш бекенд-клас при запиті даних про гру.
2. Передасть результат (з `check_app`) у ваші фронтенд-методи (`getBadgePayload` / `getStoreBadgePayload`).
3. Відмалює ваш бейдж на сторінці гри або в магазині.
4. Додасть ваш `SettingsComponent` у вкладку розширень Decky Loader!
