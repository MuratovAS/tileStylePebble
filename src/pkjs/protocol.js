/*
 * Phone -> watch binary blobs, see src/c/protocol.h (the contract).
 *
 * Pure module: no Pebble globals, so node can require it too
 * (tools/encode_config.js, tools/test_protocol.js).
 *
 * The input is the settings JSON produced by the settings page
 * (README.md, "Settings format"). Everything is normalized here:
 * missing or invalid fields fall back to the page's defaults, so the
 * watch never has to validate values beyond the byte ranges in protocol.h.
 */
'use strict';

var CONFIG_VERSION = 2;  // settings blob
var WEATHER_VERSION = 1; // weather blob
var MAX_BLOCKS = 16;
var MAX_HOURLY = 48;
var COLS = 4;
var ROWS = 4;
var SCREEN_W = 200;
var SCREEN_H = 228;
var MIN_TRACK = 20;

// --- defaults (duplicated from the settings page) ------------------------

// config.js THEME_DEFAULTS + the "timestyle" preset's theme
var THEME_DEFAULTS = {
  bg: '#000000', tile: null, fg: '#FFFFFF', accent: '#FF5500', iconFill: '#FFFFFF',
  gap: 0, radius: 0,
  lineOn: false, lineWidth: 1, lineColor: '#FFFFFF', lineStyle: 'solid'
};

// config.js DEFAULT_GENERAL (weather location fields are phone-only)
var GENERAL_DEFAULTS = {
  clock24: true, metric: true, btVibe: true,
  weatherSource: 'gps', weatherLat: null, weatherLon: null, weatherInterval: 30
};

// the "timestyle" preset (config.js DEFAULT_PRESET): used when the layout is missing or invalid,
// as the page does. The watch uses the same layout before the first config.
var ORANGE = { bg: '#FF5500', fg: '#000000', accent: '#000000' };
function side(y, widget, opts) {
  return { x: 3, y: y, w: 1, h: 1, widget: widget, opts: opts || {},
    bg: ORANGE.bg, fg: ORANGE.fg, accent: ORANGE.accent };
}
var DEFAULT_GRID = { cols: [53, 53, 52, 42], rows: [57, 57, 57, 57] };
var DEFAULT_LAYOUT = [
  { x: 0, y: 0, w: 3, h: 4, widget: 'time', opts: { stack: 'stack', font: 'avenir' } },
  side(0, 'weather'),
  side(1, 'date', { format: 'calendar' }),
  side(2, 'steps', { goal: 0 }),
  side(3, 'battery', { style: 'icon_pct' })
];

// widgets.js: key -> stable numeric id (WidgetId in protocol.h)
var WIDGET_IDS = {
  empty: 0, time: 1, date: 2, weekday: 3, battery: 4, bluetooth: 5, steps: 6,
  steps_graph: 7, distance: 8, calories: 9, heart: 10, sleep: 11, weather: 12,
  forecast: 13, uv: 14, seconds: 15, alt_tz: 16, week: 17, beats: 18, text: 19,
  hourly: 20, divider: 21
};

// widgets that need weather data from the phone
var WEATHER_WIDGETS = ['weather', 'forecast', 'uv', 'hourly'];

// widgets.js DATE_FORMATS / DATE_LEGACY: preset format -> pattern
var DATE_FORMATS = {
  e_b: '%e %b', b_e: '%b %e', a_e_b: '%a %e %b', a_e: '%a %e', e_B: '%e %B',
  A_e_B: '%A, %e %B', B_Y: '%B %Y', d_m: '%d.%m', d_m_y: '%d.%m.%y',
  d_m_Y: '%d.%m.%Y', m_d: '%m/%d', m_d_Y: '%m/%d/%Y', iso: '%Y-%m-%d',
  '2_a_eb': '%a|%e %b', '2_e_b': '%e|%b', '2_A_eB': '%A|%e %B', '3_a_e_b': '%a|%e|%b',
  // legacy values from early versions
  day_month: '%e %b', numeric: '%d.%m', full: '%a %e %b'
};
var DATE_FALLBACK = '%e %b';

// max string lengths, from the page's text options (in UTF-8 bytes here)
var MAX_DATE_PATTERN = 40;
var MAX_TZ_LABEL = 5;
var MAX_TEXT = 20;

var WEATHER = {
  GENERIC: 0, CLEAR_DAY: 1, CLEAR_NIGHT: 2, PARTLY_CLOUDY: 3, PARTLY_CLOUDY_NIGHT: 4,
  CLOUDY: 5, LIGHT_RAIN: 6, HEAVY_RAIN: 7, LIGHT_SNOW: 8, HEAVY_SNOW: 9,
  RAIN_SNOW: 10, THUNDERSTORM: 11, COUNT: 12
};

// --- value helpers ---------------------------------------------------------

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function num(v, def) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && isFinite(v) ? v : def;
}

function int(v, def, lo, hi) {
  var n = Math.round(num(v, def));
  return Math.max(lo, Math.min(hi, n));
}

function bool(v, def) {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return def;
}

// index of v in choices, or the index of def
function choice(v, choices, def) {
  var i = choices.indexOf(String(v));
  return i >= 0 ? i : choices.indexOf(def);
}

function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

// widgets.js toGColor8: 0b11rrggbb
function toGColor8(hex) {
  var n = parseInt(hex.slice(1), 16);
  var rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
  return 0xC0 | (Math.round(rr / 85) << 4) | (Math.round(gg / 85) << 2) | Math.round(bb / 85);
}

// color byte; null -> 0 ("not set") when nullable, otherwise the default
function color(v, def, nullable) {
  if (isHex(v)) return toGColor8(v);
  if (v === null && nullable) return 0;
  return def === null ? 0 : toGColor8(def);
}

// UTF-8 bytes of s, at most maxBytes, never cutting a character in half.
// Control characters (including NUL) are dropped, lone surrogates become '?'.
function utf8(s, maxBytes) {
  s = typeof s === 'string' ? s : (s === undefined || s === null ? '' : String(s));
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var bytes;
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
      var cp = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(i + 1) - 0xDC00);
      i++;
      bytes = [0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    } else if (c >= 0xD800 && c <= 0xDFFF) {
      bytes = [0x3F];
    } else if (c < 0x20 || c === 0x7F) {
      continue;
    } else if (c < 0x80) {
      bytes = [c];
    } else if (c < 0x800) {
      bytes = [0xC0 | (c >> 6), 0x80 | (c & 63)];
    } else {
      bytes = [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    }
    if (out.length + bytes.length > maxBytes) break;
    out.push.apply(out, bytes);
  }
  return out;
}

function u16(out, v) { out.push(v & 255, (v >> 8) & 255); }
function i16(out, v) { u16(out, v < 0 ? v + 0x10000 : v); }
function u32(out, v) { out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
function i8(v) { return v < 0 ? v + 256 : v; }

// --- settings normalization ------------------------------------------------

// widgets.js normalizeGrid: each track an integer >= 20, sums 200 / 228
function tracks(arr, n, total) {
  if (!Array.isArray(arr) || arr.length !== n) return null;
  var sum = 0;
  for (var i = 0; i < n; i++) {
    if (typeof arr[i] !== 'number' || arr[i] !== Math.round(arr[i]) || arr[i] < MIN_TRACK) return null;
    sum += arr[i];
  }
  return sum === total ? arr.slice() : null;
}

function evenSplit(total, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(Math.floor(total * (i + 1) / n) - Math.floor(total * i / n));
  return out;
}

function normalizeGrid(g) {
  g = isObj(g) ? g : {};
  return {
    cols: tracks(g.cols, COLS, SCREEN_W) || evenSplit(SCREEN_W, COLS),
    rows: tracks(g.rows, ROWS, SCREEN_H) || evenSplit(SCREEN_H, ROWS)
  };
}

// layout.js validate: blocks cover the 4x4 grid exactly once
function layoutValid(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_BLOCKS) return false;
  var seen = [];
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (!isObj(b)) return false;
    var x = b.x, y = b.y, w = b.w, h = b.h;
    if ([x, y, w, h].some(function (v) { return typeof v !== 'number' || v !== Math.round(v); })) return false;
    if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > COLS || y + h > ROWS) return false;
    for (var yy = y; yy < y + h; yy++) {
      for (var xx = x; xx < x + w; xx++) {
        if (seen[yy * COLS + xx]) return false;
        seen[yy * COLS + xx] = true;
      }
    }
  }
  for (var k = 0; k < COLS * ROWS; k++) if (!seen[k]) return false;
  return true;
}

function layoutOf(cfg) {
  var list = isObj(cfg) && layoutValid(cfg.layout) ? cfg.layout : DEFAULT_LAYOUT;
  return list.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
}

// true if the settings use any weather widget (no settings: the watch's
// default layout, which has one)
function needsWeather(cfg) {
  return layoutOf(cfg).some(function (b) { return WEATHER_WIDGETS.indexOf(b.widget) !== -1; });
}

function datePatternOf(o) {
  if (o.format === 'custom') return typeof o.pattern === 'string' ? o.pattern : '%a %e %b';
  if (Object.prototype.hasOwnProperty.call(DATE_FORMATS, o.format)) return DATE_FORMATS[o.format];
  return DATE_FALLBACK;
}

// widget options -> bytes (protocol.h, "L bytes of widget options")
function encodeOpts(widget, o) {
  var out = [], s;
  switch (widget) {
    case 'time':
      out.push(choice(o.font, ['avenir', 'bold', 'leco'], 'avenir'),
        choice(o.stack, ['auto', 'line', 'stack'], 'auto'),
        (bool(o.zero, true) ? 1 : 0) | (bool(o.aa, false) ? 2 : 0));
      break;
    case 'date':
      var fmt = o.format === undefined ? 'calendar' : o.format;
      var calendar = fmt === 'calendar';
      s = calendar ? [] : utf8(datePatternOf({ format: fmt, pattern: o.pattern }), MAX_DATE_PATTERN);
      out.push(calendar ? 0 : 1, bool(o.upper, true) ? 1 : 0, s.length);
      out.push.apply(out, s);
      break;
    case 'weekday':
      out.push(bool(o.long, true) ? 1 : 0);
      break;
    case 'battery':
      out.push(choice(o.style, ['icon', 'icon_pct', 'pct'], 'icon_pct'));
      break;
    case 'bluetooth':
      out.push(bool(o.only_lost, true) ? 1 : 0);
      break;
    case 'steps':
      u16(out, int(o.goal, 10000, 0, 50000));
      out.push(bool(o.short, true) ? 1 : 0);
      break;
    case 'steps_graph':
      out.push(int(o.from, 6, 0, 23));
      break;
    case 'distance':
      out.push(choice(o.unit, ['auto', 'km', 'm', 'mi', 'ft'], 'auto'));
      break;
    case 'sleep':
      out.push(bool(o.deep, false) ? 1 : 0);
      break;
    case 'alt_tz':
      // offset in hours (-12..14, step 0.5) -> half hours
      var half = Math.round(Math.max(-12, Math.min(14, num(o.offset, 0))) * 2);
      s = utf8(o.label === undefined ? 'UTC' : o.label, MAX_TZ_LABEL);
      out.push(i8(half), s.length);
      out.push.apply(out, s);
      break;
    case 'text':
      s = utf8(o.value === undefined ? 'Hello' : o.value, MAX_TEXT);
      out.push(s.length);
      out.push.apply(out, s);
      break;
    case 'hourly':
      out.push(choice(o.style, ['columns', 'graph'], 'columns'), int(o.step, 1, 1, 3), int(o.count, 0, 0, 12));
      break;
    case 'divider':
      out.push(choice(o.orient, ['auto', 'h', 'v'], 'auto'),
        choice(o.style, ['solid', 'dashed', 'dotted'], 'solid'),
        int(o.width, 1, 1, 3), int(o.inset, 4, 0, 40));
      break;
  }
  return out;
}

// alignment is a widget option on the page ("align"), a block byte here
function alignOf(widget, o) {
  if (widget === 'empty' || widget === 'divider') return 0;
  return [0, 1, 2][choice(o.align, ['center', 'left', 'right'], 'center')];
}

/*
 * Settings JSON (object or string) -> settings blob v2 (array of bytes).
 */
function encodeConfig(cfg) {
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  if (!isObj(cfg)) cfg = {};
  var t = isObj(cfg.theme) ? cfg.theme : {};
  var g = isObj(cfg.general) ? cfg.general : {};
  var D = THEME_DEFAULTS, G = GENERAL_DEFAULTS;
  // as the page's loadInitial: no grid -> the "timestyle" grid, invalid -> even
  var grid = cfg.grid ? normalizeGrid(cfg.grid) : DEFAULT_GRID;

  var out = [CONFIG_VERSION];
  out.push((bool(g.clock24, G.clock24) ? 1 : 0) |
    (bool(g.metric, G.metric) ? 2 : 0) |
    (bool(g.btVibe, G.btVibe) ? 4 : 0) |
    (bool(t.lineOn, D.lineOn) ? 8 : 0));
  out.push.apply(out, grid.cols);
  out.push.apply(out, grid.rows);
  out.push(
    color(t.bg, D.bg, false),
    color(t.tile, D.tile, true),
    color(t.fg, D.fg, false),
    color(t.accent, D.accent, false),
    color(t.iconFill, D.iconFill, true),
    int(t.gap, D.gap, 0, 40),
    int(t.radius, D.radius, 0, 60),
    int(t.lineWidth, D.lineWidth, 1, 8),
    color(t.lineColor, D.lineColor, false),
    choice(t.lineStyle, ['solid', 'dashed', 'dotted'], D.lineStyle)
  );
  // 0 = weather off: the watch should not request it
  out.push(g.weatherSource === 'off' ? 0 : int(g.weatherInterval, G.weatherInterval, 1, 255));

  var blocks = layoutOf(cfg);
  out.push(blocks.length);
  blocks.forEach(function (b) {
    var widget = Object.prototype.hasOwnProperty.call(WIDGET_IDS, b.widget) ? b.widget : 'empty';
    var o = isObj(b.opts) ? b.opts : {};
    var opts = encodeOpts(widget, o);
    out.push(b.x, b.y, b.w, b.h, WIDGET_IDS[widget],
      color(b.bg, null, true), color(b.fg, null, true), color(b.accent, null, true),
      color(b.iconFill, null, true), alignOf(widget, o), opts.length);
    out.push.apply(out, opts);
  });
  return out;
}

// --- weather ---------------------------------------------------------------

function tenths(v) {
  return Math.max(-32768, Math.min(32767, Math.round(num(v, 0) * 10)));
}

function cond(v) {
  var n = num(v, 0);
  return n >= 0 && n < WEATHER.COUNT && n === Math.round(n) ? n : WEATHER.GENERIC;
}

function unixTime(v) {
  return Math.max(0, Math.min(0xFFFFFFFF, Math.round(num(v, 0))));
}

/*
 * Weather -> weather blob v1. Input (temperatures in degrees Celsius,
 * times in unix seconds, conditions per WeatherCondition):
 *   { fetchedAt, temp, condition, high, low, forecastCondition,
 *     uv (number or null), hourlyStart, hourly: [{ temp, condition }] }
 */
function encodeWeather(w) {
  if (!isObj(w)) w = {};
  var out = [WEATHER_VERSION];
  u32(out, unixTime(w.fetchedAt));
  i16(out, tenths(w.temp));
  out.push(cond(w.condition));
  i16(out, tenths(w.high));
  i16(out, tenths(w.low));
  out.push(cond(w.forecastCondition));
  var uv = num(w.uv, null);
  out.push(uv === null ? 255 : Math.max(0, Math.min(254, Math.round(uv))));
  var hourly = Array.isArray(w.hourly) ? w.hourly.slice(0, MAX_HOURLY) : [];
  // the list must be contiguous: stop at the first entry without a temperature
  var n = 0;
  while (n < hourly.length && isObj(hourly[n]) && num(hourly[n].temp, null) !== null) n++;
  u32(out, n ? unixTime(w.hourlyStart) : 0);
  out.push(n);
  for (var i = 0; i < n; i++) {
    i16(out, tenths(hourly[i].temp));
    out.push(cond(hourly[i].condition));
  }
  return out;
}

module.exports = {
  CONFIG_VERSION: CONFIG_VERSION,
  WEATHER_VERSION: WEATHER_VERSION,
  MAX_BLOCKS: MAX_BLOCKS,
  MAX_HOURLY: MAX_HOURLY,
  WIDGET_IDS: WIDGET_IDS,
  WEATHER: WEATHER,
  WEATHER_WIDGETS: WEATHER_WIDGETS,
  THEME_DEFAULTS: THEME_DEFAULTS,
  GENERAL_DEFAULTS: GENERAL_DEFAULTS,
  DEFAULT_LAYOUT: DEFAULT_LAYOUT,
  DEFAULT_GRID: DEFAULT_GRID,
  MAX_DATE_PATTERN: MAX_DATE_PATTERN,
  MAX_TZ_LABEL: MAX_TZ_LABEL,
  MAX_TEXT: MAX_TEXT,
  toGColor8: toGColor8,
  utf8: utf8,
  datePattern: datePatternOf,
  needsWeather: needsWeather,
  encodeConfig: encodeConfig,
  encodeWeather: encodeWeather
};
