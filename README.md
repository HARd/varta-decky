# VARTA для Decky Loader 

[![Stable Release Build](https://github.com/HARd/varta-decky/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/HARd/varta-decky/actions/workflows/release.yml)
[![Testing Release Build](https://github.com/HARd/varta-decky/actions/workflows/release.yml/badge.svg?branch=varta-testing)](https://github.com/HARd/varta-decky/actions/workflows/release.yml)

Плагін для Decky Loader, який маркує українських та ворожих розробників і видавців безпосередньо в інтерфейсі Steam Deck. 

**🔥 Нове у версії 1.0.17:** Повна інтеграція з базою **Пристанок (Prystanok)**! Тепер плагін додатково перевіряє наявність української локалізації (офіційної/неофіційної, текст/озвучка), маркує ігри, видані російськими паблішерами, та відображає детальні бейджі в магазині та бібліотеці. Дозволяє легко підтримувати своїх та ігнорувати ворогів.

## Встановлення

Завантажити архів плагіна можна тут:

[VARTA Decky Loader Release](https://github.com/HARd/varta-decky/releases/latest/download/varta-decky.zip)

### Як встановити через Decky Loader (за URL)

1. Увімкніть **Developer Mode** у налаштуваннях Decky Loader.
2. Відкрийте **Developer Settings** (Налаштування розробника).
3. Натисніть **Install Plugin from URL** (Встановити плагін за посиланням).
4. Вставте наступне посилання:

```text
https://github.com/HARd/varta-decky/releases/latest/download/varta-decky.zip
```

### Як встановити вручну (із ZIP-архіву)

Якщо ви віддаєте перевагу ручному встановленню:

1. Завантажте архів `varta-decky.zip` за посиланням вище (в Desktop Mode).
2. Відкрийте **Developer Settings** у Decky.
3. Натисніть **Install Plugin from ZIP** та виберіть архів.
4. Перезавантажте ваш Steam Deck або службу Decky Loader (командою `systemctl restart plugin_loader` у терміналі).

## 🛠️ Для розробників (Додавання модулів)

Плагін тепер повністю підтримує модульну архітектуру на рівні бекенду (Python) та фронтенду (TypeScript). Якщо ви хочете додати власні списки або перевірки (наприклад, для локалізаторів, кураторів тощо), ви можете легко створити новий модуль (Extension), і ядро автоматично виконає агрегацію даних.

📖 **[Детальна інструкція зі створення модулів](docs/MODULES.md)**

## Подяка

Початкова база розробників базується на оригінальному браузерному розширенні **POHRAI/NE HRAI: Steam Developers Tracker**, яке створив [forzi4life на платформі X (Twitter)](https://x.com/forzi4life).
Оригінальне розширення: [POHRAI/NE HRAI Chrome Extension](https://chromewebstore.google.com/detail/pohraine-hrai-steam-devel/mcmmldkegalnagpcokhkppcpjecfcfje)

Інтеграція бази українських локалізацій та маркування російських видавців (модуль **Prystanok**) базується на чудовому плагіні [decky-prystanok](https://github.com/Ka3u6y6a/decky-prystanok) від [Ka3u6y6a](https://github.com/Ka3u6y6a). Величезна подяка за виконану роботу!

---

# VARTA for Decky Loader 

A plugin for Decky Loader that highlights Ukrainian and hostile developers directly inside the Steam Deck interface.
 
**🔥 New in 1.0.17:** Full integration with the **Prystanok** database! The plugin now additionally checks for Ukrainian localization (official/unofficial, text/audio), flags games published by Russian publishers, and displays detailed badges in the Steam Store and Library. Easily support your own and ignore the hostile ones.

## Installation

Download the plugin archive here:

[VARTA Decky Loader Release](https://github.com/HARd/varta-decky/releases/latest/download/varta-decky.zip)

### How to install in Decky Loader

1. Enable **Developer Mode** in Decky Loader.
2. Open **Developer Settings**.
3. Select **Install Plugin from URL**.
4. Paste the following link:

```text
https://github.com/HARd/varta-decky/releases/latest/download/varta-decky.zip
```

### How to install manually from a ZIP archive

If you prefer to install manually via SSH or Desktop Mode:

1. Download the `varta-decky.zip` archive using the link above.
2. Open **Developer Settings**.
3. Select **Install Plugin from ZIP**.
4. Restart your Steam Deck or restart the Decky Loader service by running `systemctl restart plugin_loader` in the terminal.

## 🛠️ For Developers (Adding Modules)

The plugin now fully supports a modular architecture on both the backend (Python) and frontend (TypeScript) levels. If you want to add your own lists or checks (e.g., for localizers, curators, etc.), you can easily create a new module (Extension), and the core will automatically aggregate the data.

📖 **[Detailed guide on creating modules](docs/MODULES.md)**

## Credits

The initial developer database is based on the original **POHRAI/NE HRAI: Steam Developers Tracker** browser extension created by [forzi4life on X (Twitter)](https://x.com/forzi4life).
Original browser extension: [POHRAI/NE HRAI Chrome Extension](https://chromewebstore.google.com/detail/pohraine-hrai-steam-devel/mcmmldkegalnagpcokhkppcpjecfcfje)

Integration of the Ukrainian localization database and Russian publisher marking (the **Prystanok** module) is based on the excellent [decky-prystanok](https://github.com/Ka3u6y6a/decky-prystanok) plugin by [Ka3u6y6a](https://github.com/Ka3u6y6a). Huge thanks for the amazing work!
