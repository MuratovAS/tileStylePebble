# TileStyle

[![CI](https://github.com/MuratovAS/tileStylePebble/actions/workflows/ci.yml/badge.svg)](https://github.com/MuratovAS/tileStylePebble/actions/workflows/ci.yml)

A fully customizable watchface for Pebble Time 2 (platform `emery`, 200×228,
64 colors). Split the screen into blocks of any size and fill each block
with a widget: time, date, weather, health and more. Inspired by
[TimeStyle](https://github.com/freakified/TimeStylePebble) and built on its
fonts and icons.

<p>
  <img src="assets/settings-desktop.png" alt="Settings page: preview, layouts and block options" width="820">
</p>
<p>
  <img src="assets/settings-mobile-1.png" alt="Settings page on a phone: widget picker" width="300">
  <img src="assets/settings-mobile-2.png" alt="Settings page on a phone: theme and general settings" width="300">
</p>

## Features

- **Free layout.** Blocks tile the screen and can be split in halves, merged
  and resized one by one: a border moves only between the blocks along it
  (20 px minimum, up to 16 blocks). Borders snap to an even 4×4 grid and to
  each other.
- **Widgets:**
  - time (Avenir, Avenir DemiBold or LECO; on one line or hours over minutes);
  - date from a pattern or as a calendar sheet, weekday, seconds, week
    number, second time zone, Swatch .beat;
  - battery, Bluetooth;
  - steps (with a goal bar and an hourly chart), distance, calories, heart
    rate, sleep;
  - current weather, today's high/low, UV index, hourly forecast (columns or
    a temperature graph);
  - custom text, divider.
- **Styling:**
  - theme colors, plus per-block overrides;
  - gaps and rounded corners between blocks;
  - lines between blocks: solid, dashed or dotted;
  - labels under values ("steps", "bpm", "kcal", "km", "UV") on or off;
  - text font: the firmware's Gothic or one of nine bitmap families (Roboto,
    Roboto Condensed, Fira Sans, Ubuntu, Barlow, Barlow Condensed, Lato,
    PT Sans, IBM Plex Sans Condensed); the clock has its own font choice.
- **12 built-in layouts**, plus your own layouts saved on the phone.
- **Weather** from [Open-Meteo](https://open-meteo.com/), no API key needed.
  The location comes from GPS or is picked by hand.
- **Pixel-exact preview.** The settings page draws the screen exactly as the
  watch does: same fonts, icons and layout.

On-watch labels are in English: the text fonts have no Cyrillic.

## Usage

1. Install the `.pbw` on the watch through the Pebble app, or build it
   yourself (see below).
2. Open the watchface settings in the Pebble app. This opens the settings
   page (<https://muratovas.github.io/tileStylePebble/>), where you can:
   - split blocks, merge them and drag the borders between them;
   - choose a widget for the block and set its options;
   - set up the theme and general options: 12/24 h, units, weather,
     vibration on disconnect.
3. Tap Save. The settings are sent to the watch, and the weather is refreshed
   if the layout has weather widgets.

Until it is configured, the watch shows the TimeStyle layout.

The page is available in English and Russian. It follows the browser language;
use the EN / RU switch in the header or `?lang=en` to change it.

## Building

You need Pebble SDK 4.x, Node.js and npm. The SDK is installed with the
`pebble` tool:

    uv tool install pebble-tool
    pebble sdk install latest

Then:

    git clone git@github.com:MuratovAS/tileStylePebble.git
    cd tileStylePebble
    npm install                             # pebble-fctx library
    pebble build                            # -> build/tileStylePebble.pbw

To run it:

    pebble install --emulator emery         # Pebble Time 2 emulator
    pebble install --phone <phone IP>       # real watch, via the Pebble app

## Repository layout

- `main`: the watchface (watch and phone code, resources, tools) and the
  settings page under development in `config/`.
- `gh-pages`: what GitHub Pages serves, written only by the release workflow:
  a snapshot of `config/` per release in `vX.Y.Z/`, and a placeholder
  `index.html` at the root that links to this repository.

Each build opens the settings page of its own version, so a release keeps
working when the page changes later. `wscript` writes the page URL into the
phone code (`build/js/build_info.json`):

| Build | Settings page |
|---|---|
| release workflow (`package.json` version set from the tag) | `https://muratovas.github.io/tileStylePebble/v<version>/` |
| `pebble build` (version `0.0.0`, as committed) | `config/index.html` of this checkout as a `file://` URL: works with `pebble emu-app-config` |
| `CONFIG_URL=http://192.168.1.10:8000/ pebble build` | that URL, e.g. for a real phone, with `config/` served by `python3 -m http.server -d config` |

| Path | Contents |
|---|---|
| `src/c/` | watch code: one layer per block, widgets, drawing, data (Health, battery, Bluetooth, weather), settings storage |
| `src/c/protocol.h` | phone ↔ watch protocol: message keys, binary settings and weather formats, widget ids |
| `src/pkjs/` | phone code: opens the settings page, encodes settings into the binary format, fetches weather from Open-Meteo, queues messages |
| `resources/` | clock digit fonts (`.ffont`), text fonts (`fonts/text/*.pbf`) and icons in 14/18/25/36/50 px, with their sources |
| `tools/` | resource and table generators, tests, sending settings to the emulator |
| `config/` | the settings page: static HTML with no build step; the UI is in English and Russian (`js/i18n.js`: `?lang=en\|ru`, then the EN / RU switch, else the browser language) |

The C widgets are line-by-line ports of `config/js/widgets.js` and
`config/js/raster.js`. That is why the watch draws what the preview shows, and
also why a widget change has to be made on both sides.

## Development

Tests for the phone code, the binary format and the layout model:

    node tools/test_protocol.js && node tools/test_pkjs.js && node tools/test_layout.js

Send a layout and weather to a running emulator, without the settings page:

    node tools/encode_config.js --list-presets
    python3 tools/send_appmessage.py --preset dashboard --demo-weather
    python3 tools/send_appmessage.py --config settings.json --live-weather 55.75,37.62

A demo build replaces Health and weather with the preview's mock data (`MOCK`
in `widgets.js`), and `DEMO_TIME` freezes the clock. This lets you diff an
emulator screenshot against the preview pixel by pixel:

    touch src/c/*.c                         # waf ignores environment changes
    DEMO=1 DEMO_TIME=1791799717 pebble build
    pebble screenshot --emulator emery --no-correction shot.png

### CI and releases

GitHub Actions (`.github/workflows/`):

- `ci.yml` runs on every push and pull request. It runs the tests and builds
  the watchface; a compiler warning in `src/c/` fails the build. The `.pbw` is
  attached to the run as the `tilestyle.pbw` artifact.
- `release.yml` runs on `v*` tags. The tag sets the version: CI writes it
  into `package.json` before building, then the workflow publishes a GitHub
  release with `tilestyle-<version>.pbw`. The tag must look like `v1.2.3` or
  `v1.2.3-beta.1`; the watch shows only major.minor (0–255 each).
- `pages.yml`, called by `release.yml` before the release, copies `config/`
  of the tag to `gh-pages/vX.Y.Z/`. A published snapshot is never replaced,
  so re-running a release keeps its page; to change it, delete the folder from
  `gh-pages` first.

To cut a release:

    git tag v1.0.1
    git push origin v1.0.1

Or publish a release with a new `v1.0.1` tag in the GitHub web UI: the
workflow attaches the `.pbw` to it and keeps its title and notes. To attach
the `.pbw` to an existing release again, run the Release workflow manually
(Actions → Release → Run workflow) with its tag.

`version` in `package.json` stays `0.0.0`: it marks a build made outside the
release workflow (the watch shows 0.0), so the tag `v0.0.0` is rejected.
### Generated files

Don't edit these by hand; regenerate them:

| File | Command | Source |
|---|---|---|
| `resources/app_icon.png` (the menu icon, 25×25), `screenshots/icon_small.png` and `icon_large.png` (app store, 80×80 and 144×144) | `python3 tools/app_icon.py` | the pixel map in `tools/app_icon.py` |
| `screenshots/emery_*.png` (app store screenshots) | `python3 tools/screenshots.py [preset ...]` | built-in layouts on the emulator, with demo data at 10:10 |
| `resources/icons/*.png` | `python3 tools/icons.py render` | `resources/icons_src/`, vectors in `widgets.js` |
| `config/js/icons.js` | `python3 tools/icons.py js` | `resources/icons/*.png` |
| `package.json` (icons), `src/c/gen_icons.h` | `python3 tools/icons.py resources` | `resources/icons/*.png` |
| `src/c/gen_tables.c` | `python3 tools/gen_tables.py` | `config/js/sysfonts.js`, `config/js/fonts.js` |
| `config/js/sysfonts.js` | `python3 tools/pbf2js.py <PebbleOS>/resources > config/js/sysfonts.js` | firmware fonts from [PebbleOS](https://github.com/coredevices/PebbleOS) |
| `config/js/fonts.js` | `python3 tools/ffont2js.py resources/fonts > config/js/fonts.js` | `resources/fonts/*.ffont` |
| `resources/fonts/text/*.pbf`, `config/js/textfonts/*.js`, `package.json` (text fonts), `src/c/gen_textfonts.h` | `~/.local/share/uv/tools/pebble-tool/bin/python tools/textfonts.py <ttf cache dir>` | TTFs listed in `tools/textfonts.py` (downloaded), rendered by the SDK's `fontgen.py` |

`icons.py render` and `gen_tables.py` need a headless Chromium: `chromium` on
`PATH`, the Playwright browser, or a path in the `CHROME` variable.

`screenshots.py` needs a running emery emulator (`pebble install --emulator
emery` starts one); it builds with `DEMO=1` and then builds the normal
watchface again.

The app store listing (the [Core Devices](https://apps.repebble.com) store)
takes its preview from the screenshots and icons above, not from the `.pbw`:

    pebble publish --screenshots screenshots/emery_*.png \
        --icon-small screenshots/icon_small.png --icon-large screenshots/icon_large.png

Icons are two-color, as in TimeStyle: a PNG with a palette of transparent,
white (fill) and black (outline). The watch recolors them by swapping palette
entries. The outline takes the block's accent color. The fill takes the
block's icon fill color, else the theme's, else the block background.

### Settings format

The page saves settings as JSON (v2). The phone code encodes them into the
compact binary blob described in `src/c/protocol.h`.

```json
{
  "v": 2,
  "layout": [
    { "x": 0, "y": 0, "w": 158, "h": 228, "widget": "time",
      "opts": { "font": "avenir", "stack": "stack", "zero": true, "aa": false, "align": "center" } },
    { "x": 158, "y": 0, "w": 42, "h": 57, "widget": "weather",
      "bg": "#FF5500", "fg": "#000000", "accent": "#000000", "opts": { "align": "center" } }
  ],
  "theme": { "bg": "#000000", "tile": null, "fg": "#FFFFFF", "accent": "#FF5500", "iconFill": "#FFFFFF",
             "gap": 0, "radius": 0, "lineOn": false, "lineWidth": 1, "lineColor": "#FFFFFF", "lineStyle": "solid",
             "font": "gothic", "labels": true },
  "general": { "clock24": true, "metric": true, "btVibe": true,
               "weatherSource": "manual", "weatherLocation": "Moscow, Russia",
               "weatherLat": 55.7505, "weatherLon": 37.6175, "weatherInterval": 30 }
}
```

- `layout`: blocks in screen pixels that tile the 200×228 screen: no overlaps,
  no holes, no side shorter than 20 px, at most 16 blocks.
  A block's `bg`/`fg`/`accent`/`iconFill` are optional and default to the
  theme colors.
  `opts` always holds every widget option, defaults included.
- `theme.tile: null` means blocks have no background of their own;
  `iconFill: null` fills icons with the block background. Half of `gap` is
  taken from each inner side of a block.
- Version 1 had blocks in the cells of a 4×4 grid plus `grid` (column widths
  and row heights in pixels); the page and the phone still read it, as do
  the built-in layouts in `config/js/presets.js`.
- `weatherSource`: `gps`, `manual` (coordinates of a place picked from
  OpenStreetMap Nominatim suggestions) or `off`.

The page reads the current settings from a `?config=<json>` parameter. On
save it navigates to `return_to` (`pebblejs://close#` by default) with the
JSON in the hash.

## Credits

- [TimeStyle](https://github.com/freakified/TimeStylePebble) (MIT): icons,
  clock digit fonts, and the approach to weather and the settings page.
- [pebble-fctx](https://github.com/jrmobley/pebble-fctx): vector clock
  digits.
- Text fonts, rendered to bitmaps: [Roboto](https://github.com/googlefonts/roboto-2)
  and Roboto Condensed (Apache-2.0); [Fira Sans](https://fonts.google.com/specimen/Fira+Sans),
  [Barlow](https://fonts.google.com/specimen/Barlow), Barlow Condensed,
  [Lato](https://fonts.google.com/specimen/Lato), [PT Sans](https://fonts.google.com/specimen/PT+Sans) and
  [IBM Plex Sans Condensed](https://fonts.google.com/specimen/IBM+Plex+Sans+Condensed)
  (SIL Open Font License 1.1); [Ubuntu](https://fonts.google.com/specimen/Ubuntu)
  (Ubuntu Font Licence 1.0).
- [Open-Meteo](https://open-meteo.com/): weather data.
