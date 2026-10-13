#!/usr/bin/env node
/*
 * Tests for src/pkjs/protocol.js and the weather parser.
 *
 * Blobs are decoded back by an independent decoder written from
 * src/c/protocol.h and compared with what the settings page itself would
 * mean (config/js/widgets.js is loaded as the source of truth for widget
 * ids, option defaults, date formats and colors).
 *
 *   node tools/test_protocol.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var protocol = require(path.join(ROOT, 'src/pkjs/protocol.js'));
var weather = require(path.join(ROOT, 'src/pkjs/weather.js'));
var tool = require(path.join(__dirname, 'encode_config.js'));

function loadPage(file, name) {
  var sb = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config/js', file), 'utf8'), sb);
  return sb[name];
}
var Widgets = loadPage('widgets.js', 'Widgets');
// theme text fonts as the page lists them: Gothic, then tools/textfonts.py's families
var TEXT_FONTS = ['gothic'].concat(loadPage('textfonts/index.js', 'PebbleTextFamilies').map(function (f) { return f[0]; }));
var Presets = tool.loadPresets();
// the default layout (config.js DEFAULT_PRESET), not necessarily the first one
var DefaultPreset = Presets.filter(function (p) { return p.key === 'timestyle'; })[0];

function plain(x) { return JSON.parse(JSON.stringify(x)); }

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL ' + name + '\n  ' + (e.stack || e).toString().split('\n').slice(0, 30).join('\n  '));
    process.exitCode = 1;
  }
}

// --- independent decoder (src/c/protocol.h) ----------------------------------

function Reader(bytes) {
  bytes.forEach(function (b, i) {
    assert(Number.isInteger(b) && b >= 0 && b <= 255, 'byte ' + i + ' out of range: ' + b);
  });
  var p = 0;
  this.u8 = function () { assert(p < bytes.length, 'read past end'); return bytes[p++]; };
  this.i8 = function () { var v = this.u8(); return v > 127 ? v - 256 : v; };
  this.u16 = function () { var lo = this.u8(); return lo | (this.u8() << 8); };
  this.i16 = function () { var v = this.u16(); return v > 32767 ? v - 65536 : v; };
  this.u32 = function () { var v = this.u16(); return v + this.u16() * 65536; };
  this.bytes = function (n) { var out = []; for (var i = 0; i < n; i++) out.push(this.u8()); return out; };
  this.str = function (n) { return Buffer.from(this.bytes(n)).toString('utf8'); };
  this.end = function () { assert.strictEqual(p, bytes.length, 'trailing bytes'); };
}

var FONTS = ['avenir', 'bold', 'leco'];
var STACKS = ['auto', 'line', 'stack'];
var BATTERY = ['icon', 'icon_pct', 'pct'];
var UNITS = ['auto', 'km', 'm', 'mi', 'ft'];
var HOURLY = ['columns', 'graph'];
var ORIENT = ['auto', 'h', 'v'];
var LINE = ['solid', 'dashed', 'dotted'];
var ALIGN = ['center', 'left', 'right'];

function idToKey(id) {
  var w = Widgets.LIST.filter(function (x) { return x.id === id; })[0];
  return w ? w.key : 'unknown:' + id;
}

function decodeOpts(key, r) {
  switch (key) {
    case 'time':
      var t = { font: FONTS[r.u8()], stack: STACKS[r.u8()] };
      var f = r.u8();
      t.zero = !!(f & 1);
      t.aa = !!(f & 2);
      assert.strictEqual(f & ~3, 0);
      return t;
    case 'date':
      var mode = r.u8();
      var d = { calendar: mode === 0, upper: !!r.u8() };
      assert(mode === 0 || mode === 1);
      d.pattern = r.str(r.u8());
      return d;
    case 'weekday': return { long: !!r.u8() };
    case 'battery': return { style: BATTERY[r.u8()] };
    case 'bluetooth': return { only_lost: !!r.u8() };
    case 'steps': return { goal: r.u16(), short: !!r.u8() };
    case 'steps_graph': return { from: r.u8() };
    case 'distance': return { unit: UNITS[r.u8()] };
    case 'sleep': return { deep: !!r.u8() };
    case 'alt_tz':
      var off = r.i8() / 2;
      return { offset: off, label: r.str(r.u8()) };
    case 'text': return { value: r.str(r.u8()) };
    case 'hourly': return { style: HOURLY[r.u8()], step: r.u8(), count: r.u8() };
    case 'divider': return { orient: ORIENT[r.u8()], style: LINE[r.u8()], width: r.u8(), inset: r.u8() };
    default: return {};
  }
}

function decodeConfig(bytes) {
  var r = new Reader(bytes);
  var c = { version: r.u8() };
  var f = r.u8();
  c.flags = { clock24: !!(f & 1), metric: !!(f & 2), btVibe: !!(f & 4), lineOn: !!(f & 8) };
  assert.strictEqual(f & ~15, 0, 'unknown flag bits');
  c.grid = { cols: r.bytes(4), rows: r.bytes(4) };
  c.theme = {
    bg: r.u8(), tile: r.u8(), fg: r.u8(), accent: r.u8(), iconFill: r.u8(),
    gap: r.u8(), radius: r.u8(), lineWidth: r.u8(), lineColor: r.u8(), lineStyle: LINE[r.u8()]
  };
  c.weatherInterval = r.u8();
  c.theme.font = TEXT_FONTS[r.u8()];
  var n = r.u8();
  assert(n >= 1 && n <= 16, 'block count ' + n);
  c.blocks = [];
  for (var i = 0; i < n; i++) {
    var b = { x: r.u8(), y: r.u8(), w: r.u8(), h: r.u8(), id: r.u8() };
    b.widget = idToKey(b.id);
    b.bg = r.u8(); b.fg = r.u8(); b.accent = r.u8(); b.iconFill = r.u8();
    b.align = ALIGN[r.u8()];
    var len = r.u8();
    var opt = new Reader(r.bytes(len));
    b.opts = decodeOpts(b.widget, opt);
    opt.end();
    c.blocks.push(b);
  }
  r.end();
  return c;
}

function decodeWeather(bytes) {
  var r = new Reader(bytes);
  var w = {
    version: r.u8(), fetchedAt: r.u32(), temp: r.i16() / 10, condition: r.u8(),
    high: r.i16() / 10, low: r.i16() / 10, forecastCondition: r.u8(), uv: r.u8(),
    hourlyStart: r.u32(), hourly: []
  };
  var m = r.u8();
  assert(m <= 48);
  for (var i = 0; i < m; i++) w.hourly.push({ temp: r.i16() / 10, condition: r.u8() });
  r.end();
  return w;
}

// --- expectations from the page's own code -----------------------------------

function col(hex) { return hex ? Widgets.toGColor8(hex) : 0; }

function utf8Truncate(s, max) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.codePointAt(i);
    var c = String.fromCodePoint(ch);
    if (ch > 0xFFFF) i++;
    if (Buffer.byteLength(out + c) > max) break;
    out += c;
  }
  return out;
}

function expectedOpts(key, rawOpts) {
  var o = Widgets.resolveOpts(key, rawOpts || {});
  switch (key) {
    case 'time': return { font: o.font, stack: o.stack, zero: o.zero, aa: o.aa };
    case 'date':
      return { calendar: o.format === 'calendar', upper: o.upper,
        pattern: o.format === 'calendar' ? '' : utf8Truncate(Widgets.datePattern(o), 40) };
    case 'weekday': return { long: o.long };
    case 'battery': return { style: o.style };
    case 'bluetooth': return { only_lost: o.only_lost };
    case 'steps': return { goal: o.goal, short: o.short };
    case 'steps_graph': return { from: o.from };
    case 'distance': return { unit: o.unit };
    case 'sleep': return { deep: o.deep };
    case 'alt_tz': return { offset: o.offset, label: utf8Truncate(o.label, 5) };
    case 'text': return { value: utf8Truncate(o.value, 20) };
    case 'hourly': return { style: o.style, step: Number(o.step), count: o.count };
    case 'divider': return { orient: o.orient, style: o.style, width: Number(o.width), inset: o.inset };
    default: return {};
  }
}

function checkConfig(settings, label) {
  var c = decodeConfig(protocol.encodeConfig(settings));
  var t = settings.theme, g = settings.general;
  assert.strictEqual(c.version, 3);
  assert.deepStrictEqual(c.flags, { clock24: g.clock24, metric: g.metric, btVibe: g.btVibe, lineOn: !!t.lineOn }, label);
  assert.deepStrictEqual(c.grid, settings.grid, label);
  assert.deepStrictEqual(c.theme, {
    bg: col(t.bg), tile: col(t.tile), fg: col(t.fg), accent: col(t.accent), iconFill: col(t.iconFill),
    gap: t.gap, radius: t.radius, lineWidth: t.lineWidth, lineColor: col(t.lineColor), lineStyle: t.lineStyle,
    font: t.font || 'gothic'
  }, label);
  assert.strictEqual(c.weatherInterval, g.weatherSource === 'off' ? 0 : g.weatherInterval, label);
  var layout = settings.layout.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  assert.strictEqual(c.blocks.length, layout.length, label);
  layout.forEach(function (b, i) {
    var d = c.blocks[i], l = label + ' block ' + i + ' (' + b.widget + ')';
    assert.deepStrictEqual([d.x, d.y, d.w, d.h], [b.x, b.y, b.w, b.h], l);
    assert.strictEqual(d.id, Widgets.get(b.widget).id, l);
    assert.deepStrictEqual([d.bg, d.fg, d.accent, d.iconFill], [col(b.bg), col(b.fg), col(b.accent), col(b.iconFill)], l);
    var o = Widgets.resolveOpts(b.widget, b.opts);
    assert.strictEqual(d.align, o.align || 'center', l);
    assert.deepStrictEqual(d.opts, expectedOpts(b.widget, b.opts), l);
  });
  return c;
}

// --- tests -------------------------------------------------------------------

test('tables match widgets.js', function () {
  Widgets.LIST.forEach(function (w) {
    assert.strictEqual(protocol.WIDGET_IDS[w.key], w.id, w.key);
    (w.opts || []).forEach(function (o) {
      if (o.choices) {
        var map = { font: FONTS, stack: STACKS, battery: BATTERY, distance: UNITS, hourly: HOURLY }[w.key];
        if (o.key === 'align') map = ['left', 'center', 'right'];
        else if (w.key === 'divider') map = { orient: ORIENT, style: LINE, width: ['1', '2', '3'] }[o.key];
        else if (w.key === 'time') map = o.key === 'font' ? FONTS : STACKS;
        else if (w.key === 'hourly') map = o.key === 'style' ? HOURLY : ['1', '2', '3'];
        else if (w.key === 'date') return;
        assert.deepStrictEqual(plain(o.choices.map(function (ch) { return ch[0]; })), map, w.key + '.' + o.key);
      }
    });
  });
  assert.strictEqual(Object.keys(protocol.WIDGET_IDS).length, Widgets.LIST.length);
  var maxOf = function (wk, ok) { return Widgets.get(wk).opts.filter(function (o) { return o.key === ok; })[0].max; };
  assert.strictEqual(protocol.MAX_DATE_PATTERN, maxOf('date', 'pattern'));
  assert.strictEqual(protocol.MAX_TZ_LABEL, maxOf('alt_tz', 'label'));
  assert.strictEqual(protocol.MAX_TEXT, maxOf('text', 'value'));
  Widgets.get('date').opts[0].choices.forEach(function (ch) {
    if (ch[0] === 'calendar' || ch[0] === 'custom') return;
    assert.strictEqual(protocol.datePattern({ format: ch[0] }), Widgets.datePattern({ format: ch[0] }), ch[0]);
  });
  ['day_month', 'numeric', 'full', 'nonsense'].forEach(function (f) {
    assert.strictEqual(protocol.datePattern({ format: f }), Widgets.datePattern({ format: f }), f);
  });
  // theme defaults = the "timestyle" preset's theme + config.js THEME_DEFAULTS
  Object.keys(DefaultPreset.theme).forEach(function (k) {
    assert.strictEqual(protocol.THEME_DEFAULTS[k], DefaultPreset.theme[k], 'theme.' + k);
  });
  assert.deepStrictEqual(protocol.DEFAULT_LAYOUT, JSON.parse(JSON.stringify(DefaultPreset.layout)));
  assert.deepStrictEqual(protocol.DEFAULT_GRID, plain(DefaultPreset.grid));
});

test('text font tables match the page and the watch', function () {
  assert.deepStrictEqual(protocol.TEXT_FONTS, TEXT_FONTS);
  var h = fs.readFileSync(path.join(ROOT, 'src/c/gen_textfonts.h'), 'utf8');
  assert.strictEqual(Number(/TEXT_FAMILY_COUNT (\d+)/.exec(h)[1]), TEXT_FONTS.length);
  var rows = h.split('\n').filter(function (l) { return /^  \{RESOURCE_ID_TEXT_/.test(l); });
  assert.deepStrictEqual(rows.map(function (l) { return /RESOURCE_ID_TEXT_(\w+?)_14,/.exec(l)[1].toLowerCase(); }),
    TEXT_FONTS.slice(1));
});

test('toGColor8 matches the page for the whole palette', function () {
  Widgets.PALETTE.concat(['#123456', '#FFFFFF', '#000000', '#7F8081']).forEach(function (hex) {
    assert.strictEqual(protocol.toGColor8(hex), Widgets.toGColor8(hex), hex);
  });
});

Presets.forEach(function (p) {
  test('preset ' + p.key, function () {
    var s = tool.presetSettings(p);
    var c = checkConfig(s, p.key);
    assert(protocol.encodeConfig(s).length <= 1024);
    assert.strictEqual(protocol.needsWeather(s), p.layout.some(function (b) {
      return Widgets.get(b.widget).group === 'weather';
    }), p.key);
    assert(c.blocks.length >= 1);
  });
});

// one block per widget with non-default options; 16 1x1 cells
function syntheticSettings() {
  var widgets = [
    ['time', { font: 'leco', stack: 'line', zero: false, aa: true, align: 'right' }],
    ['date', { format: 'custom', pattern: '%A, %e %B %Y | week %V | day %j of the year', upper: false, align: 'left' }],
    ['weekday', { long: false }],
    ['battery', { style: 'pct', align: 'right' }],
    ['bluetooth', { only_lost: false }],
    ['steps', { goal: 12345, short: false }],
    ['steps_graph', { from: 23 }],
    ['distance', { unit: 'ft' }],
    ['sleep', { deep: true }],
    ['alt_tz', { label: 'ÖSTÉ', offset: -9.5 }],
    ['text', { value: 'Привет, мир! ❤ 😀 end' }],
    ['hourly', { style: 'graph', step: '3', count: 12 }],
    ['divider', { orient: 'v', style: 'dashed', width: '3', inset: 40 }],
    ['date', { format: 'B_Y' }],
    ['heart', {}],
    ['uv', { align: 'left' }]
  ];
  return {
    v: 1,
    grid: { cols: [20, 100, 40, 40], rows: [20, 20, 20, 168] },
    layout: widgets.map(function (w, i) {
      var b = { x: i % 4, y: Math.floor(i / 4), w: 1, h: 1, widget: w[0], opts: w[1] };
      if (i % 3 === 0) b.bg = Widgets.PALETTE[(i * 7) % 64];
      if (i % 3 === 1) b.fg = Widgets.PALETTE[(i * 11) % 64];
      if (i % 2 === 0) b.accent = Widgets.PALETTE[(i * 5 + 3) % 64];
      if (i % 4 === 1) b.iconFill = Widgets.PALETTE[(i * 13 + 1) % 64];
      return b;
    }),
    theme: { bg: '#550055', tile: '#AAAAAA', fg: '#FFFF00', accent: '#00FFAA', iconFill: null, gap: 6, radius: 12,
      lineOn: true, lineWidth: 3, lineColor: '#5555AA', lineStyle: 'dashed', font: 'barlow_condensed' },
    general: { clock24: false, metric: false, btVibe: false, weatherSource: 'manual', weatherLocation: 'X',
      weatherLat: 1.5, weatherLon: 2.5, weatherInterval: 120 }
  };
}

test('synthetic config with every widget', function () {
  var s = syntheticSettings();
  var c = checkConfig(s, 'synthetic');
  assert.strictEqual(c.blocks.length, 16);
  // spot checks of the trickier values, independent of expectedOpts
  assert.deepStrictEqual(c.blocks[9].opts, { offset: -9.5, label: 'ÖST' }); // 'É' would make it 6 bytes
  assert.strictEqual(Buffer.byteLength(c.blocks[10].opts.value), 20);
  assert.strictEqual(c.blocks[10].opts.value, 'Привет, мир'); // 2 bytes per letter: exactly 20
  assert.strictEqual(c.blocks[1].opts.pattern.length, 40);
  assert.strictEqual(c.blocks[5].opts.goal, 12345);
  assert.strictEqual(c.blocks[0].align, 'right');
  assert.strictEqual(c.blocks[12].align, 'center'); // divider has no alignment
  assert.strictEqual(c.theme.iconFill, 0);
  assert.strictEqual(c.theme.tile, Widgets.toGColor8('#AAAAAA'));
});

test('weather off -> interval 0', function () {
  var s = syntheticSettings();
  s.general.weatherSource = 'off';
  assert.strictEqual(decodeConfig(protocol.encodeConfig(s)).weatherInterval, 0);
});

test('unpacked defaults: page-style config with every option set to default', function () {
  var s = syntheticSettings();
  s.layout.forEach(function (b) { b.opts = Widgets.resolveOpts(b.widget, {}); });
  checkConfig(s, 'defaults');
});

test('missing fields fall back to page defaults', function () {
  var c = decodeConfig(protocol.encodeConfig({}));
  var d = decodeConfig(protocol.encodeConfig(tool.presetSettings(DefaultPreset)));
  assert.deepStrictEqual(c, d);
  // missing opts, theme fields and general fields
  var s = { layout: [{ x: 0, y: 0, w: 4, h: 4, widget: 'steps' }], theme: { bg: '#FFFFFF' }, general: {} };
  var e = decodeConfig(protocol.encodeConfig(s));
  assert.deepStrictEqual(e.blocks[0].opts, { goal: 10000, short: true });
  assert.strictEqual(e.theme.bg, 0xFF);
  assert.strictEqual(e.theme.fg, Widgets.toGColor8('#FFFFFF'));
  assert.strictEqual(e.theme.accent, Widgets.toGColor8('#FF5500'));
  assert.strictEqual(e.theme.iconFill, Widgets.toGColor8('#FFFFFF'));
  assert.strictEqual(e.weatherInterval, 30);
  assert.deepStrictEqual(e.flags, { clock24: true, metric: true, btVibe: true, lineOn: false });
  assert.deepStrictEqual(e.grid, protocol.DEFAULT_GRID);
});

test('invalid input is normalized', function () {
  var s = {
    grid: { cols: [10, 90, 50, 50], rows: [57, 57, 57] },
    layout: [{ x: 0, y: 0, w: 4, h: 4, widget: 'nope', opts: { align: 'left' }, bg: 'red', fg: '#12345' }],
    theme: { bg: null, tile: 'x', gap: 999, radius: -5, lineWidth: 0, lineStyle: 'wavy', fg: '#abcdef', font: 'comic' },
    general: { weatherInterval: 1000, clock24: 'false' }
  };
  var c = decodeConfig(protocol.encodeConfig(s));
  assert.deepStrictEqual(c.grid, { cols: [50, 50, 50, 50], rows: [57, 57, 57, 57] });
  assert.strictEqual(c.blocks[0].id, 0);
  assert.strictEqual(c.blocks[0].align, 'center');
  assert.deepStrictEqual([c.blocks[0].bg, c.blocks[0].fg], [0, 0]);
  assert.strictEqual(c.theme.bg, Widgets.toGColor8('#000000')); // bg is not nullable
  assert.strictEqual(c.theme.tile, 0);
  assert.strictEqual(c.theme.fg, Widgets.toGColor8('#abcdef'));
  assert(c.theme.gap <= 40 && c.theme.radius === 0 && c.theme.lineWidth === 1);
  assert.strictEqual(c.theme.lineStyle, 'solid');
  assert.strictEqual(c.theme.font, 'gothic');
  assert.strictEqual(c.weatherInterval, 255);
  assert.strictEqual(c.flags.clock24, false);
  // overlapping / incomplete layout -> the "timestyle" layout
  var bad = decodeConfig(protocol.encodeConfig({ layout: [{ x: 0, y: 0, w: 2, h: 2, widget: 'time' }] }));
  assert.deepStrictEqual(bad.blocks.map(function (b) { return b.widget; }), ['time', 'weather', 'date', 'steps', 'battery']);
  // JSON string input works too
  assert.deepStrictEqual(protocol.encodeConfig(JSON.stringify(syntheticSettings())), protocol.encodeConfig(syntheticSettings()));
});

test('alt_tz offsets and clamping', function () {
  [-12, -9.5, -0.5, 0, 5.5, 5.75, 14, 20, -30, '3.5'].forEach(function (off) {
    var s = { layout: [{ x: 0, y: 0, w: 4, h: 4, widget: 'alt_tz', opts: { offset: off, label: 'A' } }] };
    var got = decodeConfig(protocol.encodeConfig(s)).blocks[0].opts.offset;
    var want = Math.round(Math.max(-12, Math.min(14, Number(off))) * 2) / 2;
    assert.strictEqual(got, want, String(off));
  });
});

test('utf8 truncation never splits characters', function () {
  ['abc', 'ЖЖЖ', '€€', '😀😀', 'a\u0000b\nc', '\uD800x'].forEach(function (s) {
    for (var max = 0; max <= 9; max++) {
      var bytes = protocol.utf8(s, max);
      assert(bytes.length <= max);
      var round = Buffer.from(bytes).toString('utf8');
      assert(round.indexOf('�') === -1, JSON.stringify(s) + ' ' + max);
      assert.deepStrictEqual(Buffer.from(round, 'utf8').toJSON().data, bytes);
    }
  });
  assert.deepStrictEqual(Buffer.from(protocol.utf8('a\u0000b\nc', 10)).toString(), 'abc');
  assert.deepStrictEqual(Buffer.from(protocol.utf8('\uD800x', 10)).toString(), '?x');
});

test('weather blob round trip', function () {
  var now = 1791813248;
  var w = tool.demoWeather(now);
  var d = decodeWeather(protocol.encodeWeather(w));
  assert.strictEqual(d.version, 1);
  assert.strictEqual(d.fetchedAt, now);
  assert.strictEqual(d.temp, Math.round(w.temp * 10) / 10);
  assert.strictEqual(d.condition, w.condition);
  assert.deepStrictEqual([d.high, d.low, d.forecastCondition, d.uv], [17.4, -3.6, 6, 4]);
  assert.strictEqual(d.hourlyStart, Math.floor(now / 3600) * 3600);
  assert.strictEqual(d.hourly.length, 48);
  d.hourly.forEach(function (h, i) {
    assert.strictEqual(h.temp, Math.round(w.hourly[i].temp * 10) / 10);
    assert.strictEqual(h.condition, w.hourly[i].condition);
  });
  // extremes, unknown uv, bad conditions, too many hours, hole in hourly
  var hourly = [];
  for (var i = 0; i < 60; i++) hourly.push({ temp: i === 50 ? null : -i, condition: i % 15 });
  var e = decodeWeather(protocol.encodeWeather({ fetchedAt: 5, temp: 4000, condition: 99, high: -4000, low: -0.04,
    forecastCondition: -1, uv: null, hourlyStart: 7200, hourly: hourly }));
  assert.deepStrictEqual([e.temp, e.condition, e.high, e.low, e.forecastCondition, e.uv],
    [3276.7, 0, -3276.8, 0, 0, 255]);
  assert.strictEqual(e.hourly.length, 48);
  assert.strictEqual(e.hourly[13].condition, 0); // 13 is not a valid condition
  assert.strictEqual(e.hourly[11].condition, 11);
  hourly[3].temp = undefined;
  assert.strictEqual(decodeWeather(protocol.encodeWeather({ hourly: hourly, hourlyStart: 9 })).hourly.length, 3);
  var empty = decodeWeather(protocol.encodeWeather({}));
  assert.deepStrictEqual([empty.hourly.length, empty.hourlyStart, empty.uv], [0, 0, 255]);
});

test('WMO code mapping', function () {
  var W = protocol.WEATHER, c = weather.conditionFor;
  assert.deepStrictEqual([c(0, true), c(0, false), c(1, true), c(2, false), c(3, false), c(45, true)],
    [W.CLEAR_DAY, W.CLEAR_NIGHT, W.PARTLY_CLOUDY, W.PARTLY_CLOUDY_NIGHT, W.CLOUDY, W.CLOUDY]);
  assert.deepStrictEqual([c(51), c(61), c(80), c(63), c(82), c(56), c(67)],
    [W.LIGHT_RAIN, W.LIGHT_RAIN, W.LIGHT_RAIN, W.HEAVY_RAIN, W.HEAVY_RAIN, W.RAIN_SNOW, W.RAIN_SNOW]);
  assert.deepStrictEqual([c(71), c(77), c(85), c(73), c(75), c(86), c(95), c(99), c(42), c(undefined)],
    [W.LIGHT_SNOW, W.LIGHT_SNOW, W.LIGHT_SNOW, W.HEAVY_SNOW, W.HEAVY_SNOW, W.HEAVY_SNOW,
      W.THUNDERSTORM, W.THUNDERSTORM, W.GENERIC, W.GENERIC]);
});

test('Open-Meteo parsing', function () {
  // India, UTC+5:30: local hours start at :30 UTC
  var off = 19800;
  var t0 = Math.floor((1791813248 + off) / 86400) * 86400 - off; // a local midnight
  var day0 = t0;
  var times = [], temps = [], codes = [], isDay = [];
  for (var i = 0; i < 72; i++) {
    times.push(t0 + i * 3600);
    temps.push(20 + i / 10);
    codes.push([0, 2, 3, 61][i % 4]);
    isDay.push(i % 24 >= 6 && i % 24 < 18 ? 1 : 0);
  }
  temps[60] = null;
  var json = {
    utc_offset_seconds: off,
    current: { time: t0 + 13 * 3600 + 900, temperature_2m: 25.25, weather_code: 0, is_day: 0 },
    daily: { time: [day0, day0 + 86400, day0 + 172800], weather_code: [2, 0, 95],
      temperature_2m_max: [30.1, 31, 32], temperature_2m_min: [18.04, 19, 20], uv_index_max: [7.5, 8, null] },
    hourly: { time: times, temperature_2m: temps, weather_code: codes, is_day: isDay }
  };
  var now = t0 + 13 * 3600 + 1799; // 13:29:59 local
  var w = weather.parseOpenMeteo(json, now);
  assert.strictEqual(w.fetchedAt, now);
  assert.strictEqual(w.temp, 25.25);
  assert.strictEqual(w.condition, protocol.WEATHER.CLEAR_NIGHT);
  assert.deepStrictEqual([w.high, w.low, w.forecastCondition, w.uv], [30.1, 18.04, protocol.WEATHER.PARTLY_CLOUDY, 7.5]);
  assert.strictEqual(w.hourlyStart, t0 + 13 * 3600);
  assert.strictEqual(w.hourly.length, 60 - 13); // stops at the null
  assert.deepStrictEqual(w.hourly[0], { temp: 21.3, condition: protocol.WEATHER.PARTLY_CLOUDY }); // code 2, day
  assert.deepStrictEqual(w.hourly[5], { temp: 21.8, condition: protocol.WEATHER.CLOUDY });
  assert.deepStrictEqual(w.hourly[6], { temp: 21.9, condition: protocol.WEATHER.LIGHT_RAIN });
  assert.deepStrictEqual(w.hourly[7], { temp: 22, condition: protocol.WEATHER.CLEAR_NIGHT }); // 20:00, code 0
  var d = decodeWeather(protocol.encodeWeather(w));
  assert.strictEqual(d.uv, 8); // 7.5 rounds up
  assert.strictEqual(d.temp, 25.3);
  assert.strictEqual(d.low, 18);
  // tomorrow's daily row once local midnight passes
  var w2 = weather.parseOpenMeteo(json, t0 + 86400 + 60);
  assert.deepStrictEqual([w2.high, w2.forecastCondition], [31, protocol.WEATHER.CLEAR_DAY]);
  assert.strictEqual(w2.hourly.length, 60 - 24);
  // missing sections
  var w3 = weather.parseOpenMeteo({ current: { temperature_2m: -1, weather_code: 3, is_day: 1 } }, now);
  assert.deepStrictEqual([w3.high, w3.low, w3.uv, w3.hourly.length], [-1, -1, null, 0]);
  assert.throws(function () { weather.parseOpenMeteo({}, now); });
  // request URL
  var url = weather.buildUrl(55.750512, 37.61749);
  assert(url.indexOf('latitude=55.7505&longitude=37.6175') !== -1);
  ['current=temperature_2m,weather_code,is_day', 'hourly=temperature_2m,weather_code,is_day',
    'uv_index_max', 'timezone=auto', 'timeformat=unixtime', 'forecast_days=3'].forEach(function (p) {
    assert(url.indexOf(p) !== -1, p);
  });
});

console.log((process.exitCode ? 'FAILED' : 'OK') + ': ' + passed + ' tests passed');
