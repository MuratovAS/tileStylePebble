#pragma once
/*
 * Phone <-> watch protocol. This file is the contract between the C side
 * (src/c) and pkjs (src/pkjs/protocol.js); change both together.
 *
 * AppMessage keys (package.json messageKeys):
 *   Config          phone -> watch  byte array, settings blob (below)
 *   Weather         phone -> watch  byte array, weather blob (below)
 *   WeatherRequest  watch -> phone  int32 1: please fetch and send weather
 *
 * All multi-byte integers are little-endian. Colors are GColor8 bytes
 * (0b11rrggbb, Widgets.toGColor8 on the settings page). A color byte of 0
 * means "not set" (inherit): a real GColor8 always has the top bits set.
 *
 * --- Settings blob (version 2) -----------------------------------------
 *
 *   off size
 *    0   1  version = 2
 *    1   1  flags: bit0 clock24, bit1 metric, bit2 btVibe, bit3 lineOn
 *    2   4  grid.cols[4], px, sum 200
 *    6   4  grid.rows[4], px, sum 228
 *   10   1  theme.bg
 *   11   1  theme.tile      (0 = null: blocks have no own background)
 *   12   1  theme.fg
 *   13   1  theme.accent
 *   14   1  theme.iconFill  (0 = null: icon fill is the block background)
 *   15   1  theme.gap, px
 *   16   1  theme.radius, px
 *   17   1  theme.lineWidth, px
 *   18   1  theme.lineColor
 *   19   1  theme.lineStyle: 0 solid, 1 dashed, 2 dotted
 *   20   1  general.weatherInterval, minutes
 *   21   1  block count N (1..16)
 *   22      N blocks:
 *             x, y, w, h   4 bytes, in grid cells
 *             widget id    1 byte (WidgetId)
 *             bg, fg, accent, iconFill  4 bytes (0 = inherit from theme;
 *                          iconFill then falls back as theme.iconFill does)
 *             align        1 byte: 0 center, 1 left, 2 right
 *             opt length   1 byte L, then L bytes of widget options:
 *
 *   time        font (0 avenir, 1 bold, 2 leco), stack (0 auto, 1 line,
 *               2 stack), flags (bit0 zero, bit1 aa)
 *   date        mode (0 calendar, 1 pattern), upper (0/1), len, pattern
 *               bytes. The page's preset formats are resolved to patterns
 *               by pkjs, so the watch only knows the strftime-like tokens
 *               (Widgets.formatDate): %d %e %m %n %b %B %a %A %y %Y %j %V %%,
 *               "|" is a line break.
 *   weekday     long (0/1)
 *   battery     style (0 icon, 1 icon_pct, 2 pct)
 *   bluetooth   only_lost (0/1)
 *   steps       goal (uint16), short (0/1)
 *   steps_graph from (hour 0..23)
 *   distance    unit (0 auto, 1 km, 2 m, 3 mi, 4 ft)
 *   sleep       deep (0/1)
 *   alt_tz      offset in half hours (int8, offset * 2), len, label bytes
 *   text        len, value bytes (UTF-8)
 *   hourly      style (0 columns, 1 graph), step (1..3), count (0..12)
 *   divider     orient (0 auto, 1 h, 2 v), style (0 solid, 1 dashed,
 *               2 dotted), width (1..3), inset (0..40)
 *   others      no options (L = 0)
 *
 * The watch must tolerate unknown widget ids (draw nothing) and longer
 * option payloads than it knows (skip by L). It also reads version 1 blobs,
 * as stored by earlier releases: the same, but blocks have no iconFill byte.
 *
 * --- Weather blob (version 1) ------------------------------------------
 *
 * Temperatures are int16 tenths of a degree Celsius; the watch converts to
 * Fahrenheit when metric is off: round(t * 1.8 + 32).
 *
 *   off size
 *    0   1  version = 1
 *    1   4  fetched at, unix time (uint32)
 *    5   2  current temperature
 *    7   1  current condition (WeatherCondition)
 *    8   2  today's high
 *   10   2  today's low
 *   12   1  today's forecast condition
 *   13   1  UV index (today's max, rounded), 255 = unknown
 *   14   4  hourly start, unix time of the first hourly entry (top of the
 *           current hour)
 *   18   1  hourly count M (up to 48)
 *   19      M entries: temperature (int16), condition (uint8)
 *
 * Day/night icon variants are chosen by pkjs from is_day.
 */

typedef enum {
  WIDGET_EMPTY = 0,
  WIDGET_TIME = 1,
  WIDGET_DATE = 2,
  WIDGET_WEEKDAY = 3,
  WIDGET_BATTERY = 4,
  WIDGET_BLUETOOTH = 5,
  WIDGET_STEPS = 6,
  WIDGET_STEPS_GRAPH = 7,
  WIDGET_DISTANCE = 8,
  WIDGET_CALORIES = 9,
  WIDGET_HEART = 10,
  WIDGET_SLEEP = 11,
  WIDGET_WEATHER = 12,
  WIDGET_FORECAST = 13,
  WIDGET_UV = 14,
  WIDGET_SECONDS = 15,
  WIDGET_ALT_TZ = 16,
  WIDGET_WEEK = 17,
  WIDGET_BEATS = 18,
  WIDGET_TEXT = 19,
  WIDGET_HOURLY = 20,
  WIDGET_DIVIDER = 21,
  WIDGET_COUNT
} WidgetId;

// Matches the icon names resources/icons/weather_<name>_<size>.png
typedef enum {
  WEATHER_GENERIC = 0,
  WEATHER_CLEAR_DAY = 1,
  WEATHER_CLEAR_NIGHT = 2,
  WEATHER_PARTLY_CLOUDY = 3,
  WEATHER_PARTLY_CLOUDY_NIGHT = 4,
  WEATHER_CLOUDY = 5,
  WEATHER_LIGHT_RAIN = 6,
  WEATHER_HEAVY_RAIN = 7,
  WEATHER_LIGHT_SNOW = 8,
  WEATHER_HEAVY_SNOW = 9,
  WEATHER_RAIN_SNOW = 10,
  WEATHER_THUNDERSTORM = 11,
  WEATHER_CONDITION_COUNT
} WeatherCondition;

#define CONFIG_VERSION 2   // settings blob
#define WEATHER_VERSION 1  // weather blob
#define CONFIG_MAX_BLOCKS 16
#define WEATHER_MAX_HOURLY 48
