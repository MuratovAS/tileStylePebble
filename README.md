# TileStyle

A fully customizable Pebble Time 2 watchface: split the screen into a 4×4 grid,
merge cells into blocks and fill each with a widget — time, date, weather,
health and more.

Настраиваемый циферблат для Pebble Time 2 (платформа `emery`, 200×228, 64 цвета).
За основу взят [TimeStyle](https://github.com/freakified/TimeStylePebble).

Экран делится на сетку 4×4. Ширину столбцов и высоту строк можно менять
(по умолчанию 50×57 px). Ячейки можно объединять в прямоугольные блоки,
в каждый блок ставится мини-виджет.

## Ветки

Как в TimeStyle:

- `main` — циферблат: ресурсы, инструменты, код для часов.
- `gh-pages` — страница настроек (`index.html`, `css/`, `js/` в корне ветки),
  её отдаёт GitHub Pages.

Скрипты из `tools/` читают и пишут файлы страницы по путям `config/...`, поэтому
`gh-pages` подключается рабочей копией в папку `config/` (в `main` она в
`.gitignore`):

    git worktree add config gh-pages

Изменения страницы коммитятся из `config/`, они попадают в `gh-pages`.

## Страница настроек — `config/`

Статическая страница без сборки и зависимостей. Открыть локально можно прямо
в браузере: `config/index.html`. Для телефона её отдаёт GitHub Pages из ветки
`gh-pages`, как в TimeStyle.

| Файл | Что внутри |
|---|---|
| `js/layout.js` | модель сетки в ячейках: объединение, разделение, проверка покрытия |
| `js/widgets.js` | каталог виджетов (id, мин. размер в px, опции, превью), пропорции сетки, палитра Pebble |
| `js/raster.js` | превью в canvas 200×228: текст, иконки, цифры времени, приведение к палитре Pebble |
| `js/fonts.js` | контуры цифр шрифтов TimeStyle (Avenir, Avenir DemiBold, LECO), сгенерировано |
| `js/presets.js` | готовые раскладки |
| `js/config.js` | интерфейс: выделение на превью, инспектор блока, тема, сохранение |

### Превью

Экран рисуется в canvas в реальном разрешении часов и увеличивается без
сглаживания так, чтобы пиксель часов занимал целое число физических пикселей
экрана. Всё рисуется так, как будет на часах:

- **Текст** — растровыми шрифтами прошивки (Gothic 14–28 и жирные, Bitham 30
  Black и 42 Bold), 1 бит на пиксель. Кириллицы в них нет, поэтому подписи на
  часах английские; неподдерживаемые символы в своём тексте страница помечает
  предупреждением. `config/js/sysfonts.js` собирается из `.pbf` репозитория
  [PebbleOS](https://github.com/coredevices/PebbleOS):

      python3 tools/pbf2js.py <PebbleOS>/resources > config/js/sysfonts.js

- **Иконки** — готовые битмапы фиксированных размеров 14/18/25/36/50 px
  (`resources/icons/<имя>_<размер>.png`). Виджет берёт самый крупный размер,
  который помещается, и не масштабирует его. Иконки взяты из TimeStyle
  (`resources/icons_src/timestyle/*.pdc`, лицензия MIT): 12 состояний погоды,
  шаги, пульс, сон, батарея и зарядка, потеря связи. Родной размер у них
  25 px, остальные размеры нарезаны из вектора и могут дорисовываться
  вручную. Bluetooth, калории, дистанция и УФ — свои, из векторов в
  `widgets.js`.

  Как в TimeStyle, иконка двухцветная: пиксель — заливка или обводка, цвета
  задаются при отрисовке (обводка — акцент блока, заливка — «Заливка иконок»
  в теме или фон блока). PNG — 2 бита с палитрой: прозрачный, белый (заливка),
  чёрный (обводка); на часах такой битмап перекрашивается сменой палитры.

      python3 tools/icons.py render   # недостающие PNG из исходников (--force перезапишет все)
      python3 tools/icons.py js       # PNG -> config/js/icons.js

- **Фигуры** (рамки, скругления блоков, полоски) — построчно, целыми пикселями.
- **Крупное время** — как в TimeStyle: векторные шрифты (Avenir, Avenir
  DemiBold, LECO) рисуются fctx со сглаживанием. Это единственное место
  с полутонами, они приводятся к 64-цветной палитре. `config/js/fonts.js`:

      python3 tools/ffont2js.py <папка с .ffont> > config/js/fonts.js

При сохранении страница переходит на `return_to` (по умолчанию
`pebblejs://close#`) с JSON настроек в хэше, как TimeStyle. Те же настройки
кладутся в `localStorage` (`tilestyle.settings`, свои раскладки —
`tilestyle.presets`); pkjs может передать текущие
настройки параметром `?config=<json>`.

### Формат настроек (v1)

```json
{
  "v": 1,
  "grid": { "cols": [53, 53, 52, 42], "rows": [57, 57, 57, 57] },
  "layout": [
    { "x": 0, "y": 0, "w": 3, "h": 4, "widget": "time",
      "opts": { "font": "avenir", "stack": "stack", "zero": true } },
    { "x": 3, "y": 0, "w": 1, "h": 1, "widget": "weather",
      "bg": "#FF5500", "fg": "#000000", "accent": "#000000" }
  ],
  "theme": { "bg": "#000000", "tile": null, "fg": "#FFFFFF", "accent": "#FF5500", "iconFill": "#FFFFFF", "gap": 0, "radius": 0,
             "lineOn": false, "lineWidth": 1, "lineColor": "#FFFFFF", "lineStyle": "solid" },
  "general": { "clock24": true, "metric": true, "btVibe": true,
               "weatherSource": "manual", "weatherLocation": "Москва, Центральный федеральный округ, Россия",
               "weatherLat": 55.7505, "weatherLon": 37.6175, "weatherInterval": 30 }
}
```

- `grid` — ширины столбцов и высоты строк в пикселях. Суммы всегда 200 и 228,
  каждая полоса не меньше 20 px.
- `layout` в ячейках сетки, покрывает все 16 ячеек ровно по одному разу.
  Пиксельные границы блока = смещения полос из `grid` минус половина
  `theme.gap` с внутренних сторон.
- `weatherLat`/`weatherLon` — координаты места, выбранного из подсказок
  (поиск OpenStreetMap Nominatim, как в TimeStyle); `null`, пока место не выбрано.
- `lineOn`…`lineStyle` — линии между блоками: только по внутренним границам,
  при отступе — посередине отступа; `lineStyle`: `solid`, `dashed` (штрих 4×толщина,
  пропуск 2×толщина), `dotted` (квадраты со стороной толщины через такой же
  промежуток); узор считается от края экрана.
- `bg`/`fg`/`accent` блока необязательны: если их нет, берутся из `theme`
  (`theme.tile: null` — блоки без собственного фона).
- В `opts` всегда лежат все опции виджета, включая значения по умолчанию.
- Числовые `id` виджетов в `widgets.js` стабильны: их будет получать C-часть.
  Для отправки на часы цвета переводятся в GColor8 (`Widgets.toGColor8`).

## Циферблат — `src/`

Сборка (Pebble SDK 4.x, платформа `emery`):

    npm install            # pebble-fctx
    pebble build
    pebble install --emulator emery

Часы рисуют экран так же, как превью страницы настроек: та же логика выбора
шрифта (`fit`, `inkHeight`), та же раскладка виджетов, те же иконки и фигуры.
Код виджетов на C перенесён построчно из `config/js/widgets.js` и
`config/js/raster.js`.

| Файл | Что внутри |
|---|---|
| `src/c/protocol.h` | контракт телефон ↔ часы: ключи сообщений, бинарные форматы настроек и погоды, id виджетов |
| `src/c/main.c` | окно, слой на каждый блок, линии между блоками, подписка на минуты/секунды |
| `src/c/settings.c` | разбор и проверка блоба настроек, хранение в persist, настройки по умолчанию (раскладка TimeStyle) |
| `src/c/data.c` | батарея, Bluetooth, Health, погода |
| `src/c/messaging.c` | AppMessage: приём настроек и погоды, запрос погоды по интервалу |
| `src/c/render.c` | примитивы превью (`g.*`): текст, иконки, фигуры, цифры времени через fctx |
| `src/c/widgets.c` | все виджеты |
| `src/c/icons.c` | ленивая загрузка иконок и перекраска палитрой |
| `src/c/gen_tables.c`, `gen_icons.h` | сгенерировано, см. ниже |
| `src/pkjs/index.js` | открытие страницы настроек, хранение настроек, очередь сообщений |
| `src/pkjs/protocol.js` | JSON настроек → бинарный блоб (работает и в node) |
| `src/pkjs/weather.js` | погода Open-Meteo: сейчас, мин/макс, УФ, почасовой прогноз на 48 ч |

Сгенерированные файлы:

    python3 tools/gen_tables.py          # метрики шрифтов и цифр -> src/c/gen_tables.c
    python3 tools/icons.py resources     # иконки -> package.json и src/c/gen_icons.h

Метрики берутся из тех же `config/js/sysfonts.js` и `config/js/fonts.js`,
что и у превью; рамки цифр меряются в headless Chromium кодом превью.

### Разработка

    node tools/test_protocol.js && node tools/test_pkjs.js   # тесты pkjs и формата
    node tools/encode_config.js --list-presets
    node tools/encode_config.js --preset timestyle --demo-weather
    python3 tools/send_appmessage.py --preset dashboard --demo-weather   # в запущенный эмулятор
    python3 tools/send_appmessage.py --config settings.json --live-weather 55.75,37.62

`DEMO=1 pebble build` подставляет тестовые данные превью (`MOCK` из
`widgets.js`) вместо Health и погоды, `DEMO_TIME=<unix>` замораживает часы —
так скриншот эмулятора можно сравнить с превью попиксельно. После смены этих
переменных нужно `touch src/c/*.c`: waf не пересобирает по окружению.
