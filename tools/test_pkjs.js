#!/usr/bin/env node
/*
 * Runs src/pkjs/index.js in node against a mock Pebble environment
 * (Pebble, localStorage, XMLHttpRequest, navigator.geolocation, timers)
 * and checks the event handling: settings page, message queue, weather.
 *
 *   node tools/test_pkjs.js
 */
'use strict';

var assert = require('assert');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var protocol = require(path.join(ROOT, 'src/pkjs/protocol.js'));
var tool = require(path.join(__dirname, 'encode_config.js'));
var Presets = tool.loadPresets();
function presetByKey(key) { return Presets.filter(function (p) { return p.key === key; })[0]; }
// the default layout (config.js DEFAULT_PRESET), not necessarily the first one
var DefaultPreset = presetByKey('timestyle');

// --- fake clock ---------------------------------------------------------------

var clock = { now: 1791813248000, timers: [], seq: 0 };
global.setTimeout = function (fn, ms) {
  var t = { id: ++clock.seq, at: clock.now + (ms || 0), fn: fn };
  clock.timers.push(t);
  return t.id;
};
global.clearTimeout = function (id) {
  clock.timers = clock.timers.filter(function (t) { return t.id !== id; });
};
Date.now = function () { return clock.now; };
// runs timers due within ms
function advance(ms) {
  var end = clock.now + ms;
  for (;;) {
    clock.timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
    var t = clock.timers[0];
    if (!t || t.at > end) break;
    clock.timers.shift();
    clock.now = Math.max(clock.now, t.at);
    t.fn();
  }
  clock.now = end;
}

// --- mock environment -------------------------------------------------------

var env;
var handlers = {}; // registered once, when index.js loads
function reset() {
  env = {
    sent: [], inFlight: 0, maxInFlight: 0, opened: [],
    // per message: 'ack' | 'nack' | 'silent'; default ack
    replies: [], ackDelay: 50,
    store: {}, xhr: [], geo: [], geoReply: 'ok', logs: []
  };
  clock.timers = [];
}
reset();

global.console = Object.assign(Object.create(console), {
  log: function (m) { env.logs.push(String(m)); if (process.env.VERBOSE) process.stdout.write('  | ' + m + '\n'); }
});

global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(env.store, k) ? env.store[k] : null; },
  setItem: function (k, v) { env.store[k] = String(v); },
  removeItem: function (k) { delete env.store[k]; }
};

global.Pebble = {
  addEventListener: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
  openURL: function (url) { env.opened.push(url); },
  sendAppMessage: function (dict, ok, fail) {
    env.inFlight++;
    env.maxInFlight = Math.max(env.maxInFlight, env.inFlight);
    var reply = env.replies.shift() || 'ack';
    var rec = { dict: dict, reply: reply, at: clock.now };
    env.sent.push(rec);
    if (reply === 'silent') return; // never calls back
    setTimeout(function () {
      env.inFlight--;
      if (reply === 'ack') ok({ data: dict }); else fail({ data: dict, error: { message: 'NACK' } });
    }, env.ackDelay);
  }
};

function openMeteo(lat, lon) {
  var nowS = Math.floor(clock.now / 1000);
  var t0 = Math.floor(nowS / 86400) * 86400;
  var h = { time: [], temperature_2m: [], weather_code: [], is_day: [] };
  for (var i = 0; i < 72; i++) {
    h.time.push(t0 + i * 3600);
    h.temperature_2m.push(lat / 10 + i / 10);
    h.weather_code.push(i % 2 ? 0 : 2);
    h.is_day.push(i % 24 >= 6 && i % 24 < 18 ? 1 : 0);
  }
  return {
    current: { time: nowS - 300, temperature_2m: lat / 10, weather_code: 0, is_day: 1 },
    daily: { time: [t0, t0 + 86400, t0 + 172800], weather_code: [61, 0, 0],
      temperature_2m_max: [20, 21, 22], temperature_2m_min: [10, 11, 12], uv_index_max: [3.4, 1, 1] },
    hourly: h
  };
}

// env.xhrMode: undefined (normal), 'hang' (never answers; no ontimeout either,
// like runtimes without xhr.timeout), 'throwOpen', 'throwSend'
global.XMLHttpRequest = function () {
  var self = this;
  this.abort = function () { env.aborts = (env.aborts || 0) + 1; };
  this.open = function (method, url) {
    if (env.xhrMode === 'throwOpen') throw new Error('open failed');
    self.url = url;
  };
  this.send = function () {
    env.xhr.push(self.url);
    if (env.xhrMode === 'throwSend') throw new Error('send failed');
    if (env.xhrMode === 'hang') return;
    setTimeout(function () {
      if (env.xhrFail) return self.onerror && self.onerror();
      var m = /latitude=([-\d.]+)&longitude=([-\d.]+)/.exec(self.url);
      self.status = 200;
      self.responseText = JSON.stringify(openMeteo(Number(m[1]), Number(m[2])));
      self.onload();
    }, 200);
  };
};

Object.defineProperty(global, 'navigator', { configurable: true, writable: true, value: {
  geolocation: {
    getCurrentPosition: function (ok, fail, opts) {
      env.geo.push(opts);
      if (env.geoReply === 'throw') throw new Error('geolocation broken');
      setTimeout(function () {
        if (env.geoReply === 'ok') ok({ coords: { latitude: 48.85, longitude: 2.35 } });
        else if (env.geoReply === 'error') fail({ code: 3, message: 'Timeout expired' });
        // 'silent': never answers
      }, 100);
    }
  }
} });

require(path.join(ROOT, 'src/pkjs/index.js'));

function fire(name, e) { (handlers[name] || []).forEach(function (fn) { fn(e || {}); }); }

function sentKeys() {
  return env.sent.filter(function (s) { return s.reply === 'ack'; }).map(function (s) { return Object.keys(s.dict)[0]; });
}

function lastSent(key) {
  var s = env.sent.filter(function (x) { return x.dict[key]; });
  return s.length ? s[s.length - 1].dict[key] : null;
}

// minimal weather decode: version, temp, hourly count
function weatherSummary(bytes) {
  var i16 = function (o) { var v = bytes[o] | (bytes[o + 1] << 8); return (v > 32767 ? v - 65536 : v) / 10; };
  return { version: bytes[0], temp: i16(5), high: i16(8), uv: bytes[13], count: bytes[18], len: bytes.length };
}

var passed = 0;
function test(name, fn) {
  reset();
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL ' + name + '\n  ' + String(e.stack || e).split('\n').slice(0, 12).join('\n  '));
    console.error('  log:\n    ' + env.logs.join('\n    '));
    process.exitCode = 1;
  }
}

var SETTINGS_KEY = 'tilestyle.settings';
var BASE_URL = 'https://muratovas.github.io/tileStylePebble/';

// --- tests ------------------------------------------------------------------

test('ready sends nothing', function () {
  fire('ready');
  advance(60000);
  assert.strictEqual(env.sent.length, 0);
  assert.strictEqual(env.xhr.length, 0);
});

test('weather request without settings: GPS fetch, Weather sent', function () {
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.geo.length, 1);
  assert(env.geo[0].timeout > 0 && env.geo[0].maximumAge > 0);
  assert.strictEqual(env.xhr.length, 1);
  assert(env.xhr[0].indexOf('latitude=48.85&longitude=2.35') !== -1, env.xhr[0]);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
  var w = weatherSummary(lastSent('Weather'));
  assert.deepStrictEqual(w, { version: 1, temp: 4.9, high: 20, uv: 3, count: 48, len: 19 + 48 * 3 });
  assert(JSON.parse(env.store['tilestyle.position']).lat === 48.85);
});

test('other app messages are ignored', function () {
  fire('appmessage', { payload: { Something: 1 } });
  advance(5000);
  assert.strictEqual(env.xhr.length, 0);
});

test('showConfiguration without settings opens the bare page', function () {
  fire('showConfiguration');
  assert.deepStrictEqual(env.opened, [BASE_URL]);
});

test('save -> Config then Weather, one message at a time; reopen passes settings', function () {
  var s = tool.presetSettings(DefaultPreset);
  s.general.weatherSource = 'manual';
  s.general.weatherLat = 55.7505;
  s.general.weatherLon = 37.6175;
  var json = JSON.stringify(s);
  env.ackDelay = 700;
  fire('webviewclosed', { response: encodeURIComponent(json) });
  advance(10000);
  assert.deepStrictEqual(sentKeys(), ['Config', 'Weather']);
  assert.strictEqual(env.maxInFlight, 1);
  assert.deepStrictEqual(lastSent('Config'), protocol.encodeConfig(s));
  assert.strictEqual(env.geo.length, 0, 'manual coordinates: no GPS');
  assert(env.xhr[0].indexOf('latitude=55.7505&longitude=37.6175') !== -1);
  assert.deepStrictEqual(JSON.parse(env.store[SETTINGS_KEY]), s);
  fire('showConfiguration');
  var url = env.opened[0];
  assert.strictEqual(url.indexOf(BASE_URL + '?config='), 0);
  assert.deepStrictEqual(JSON.parse(decodeURIComponent(url.slice((BASE_URL + '?config=').length))), s);
});

test('raw (already decoded) JSON response works', function () {
  var s = tool.presetSettings(presetByKey('minimal')); // no weather widgets
  fire('webviewclosed', { response: JSON.stringify(s) });
  advance(10000);
  assert.deepStrictEqual(sentKeys(), ['Config']);
  assert.strictEqual(env.xhr.length, 0);
});

test('cancel / empty responses change nothing', function () {
  ['', undefined, 'CANCELLED', '%7Bbroken', '{}', 'null', '[1,2]'].forEach(function (r) {
    fire('webviewclosed', { response: r });
  });
  fire('webviewclosed', {});
  advance(10000);
  assert.strictEqual(env.sent.length, 0);
  assert.strictEqual(env.store[SETTINGS_KEY], undefined);
});

test('NACK is retried, timeouts too, and the queue keeps order', function () {
  env.replies = ['nack', 'silent', 'ack'];
  var s = tool.presetSettings(presetByKey('minimal'));
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(s)) });
  advance(60000);
  assert.deepStrictEqual(env.sent.map(function (x) { return x.reply; }), ['nack', 'silent', 'ack']);
  assert.deepStrictEqual(sentKeys(), ['Config']);
});

test('gives up after 4 tries and moves on', function () {
  env.replies = ['nack', 'nack', 'nack', 'nack'];
  var s = tool.presetSettings(DefaultPreset);
  s.general.weatherSource = 'manual';
  s.general.weatherLat = 1;
  s.general.weatherLon = 2;
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(s)) });
  advance(60000);
  assert.strictEqual(env.sent.filter(function (x) { return x.dict.Config; }).length, 4);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
});

test('newer settings replace queued ones', function () {
  env.ackDelay = 2000;
  var a = tool.presetSettings(presetByKey('minimal'));
  var b = tool.presetSettings(presetByKey('sport'));
  var c = tool.presetSettings(presetByKey('contrast'));
  [a, b, c].forEach(function (s) { s.general.weatherSource = 'off'; });
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(a)) });
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(b)) });
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(c)) });
  advance(20000);
  assert.strictEqual(env.sent.length, 2);
  assert.deepStrictEqual(env.sent[0].dict.Config, protocol.encodeConfig(a));
  assert.deepStrictEqual(env.sent[1].dict.Config, protocol.encodeConfig(c));
  assert.strictEqual(env.maxInFlight, 1);
});

test('layout without weather widgets, or weather off: requests ignored', function () {
  env.store[SETTINGS_KEY] = JSON.stringify(tool.presetSettings(presetByKey('minimal')));
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  var s = tool.presetSettings(DefaultPreset);
  s.general.weatherSource = 'off';
  advance(5000);
  env.store[SETTINGS_KEY] = JSON.stringify(s);
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.xhr.length + env.geo.length + env.sent.length, 0);
});

test('manual without coordinates falls back to GPS', function () {
  var s = tool.presetSettings(DefaultPreset);
  s.general.weatherSource = 'manual';
  env.store[SETTINGS_KEY] = JSON.stringify(s);
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.geo.length, 1);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
});

test('GPS error uses the last position, or sends nothing', function () {
  env.geoReply = 'error';
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.xhr.length, 0);
  assert.strictEqual(env.sent.length, 0);
  env.store['tilestyle.position'] = JSON.stringify({ lat: 10, lon: 20, t: 1 });
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert(env.xhr[0].indexOf('latitude=10&longitude=20') !== -1);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
  // geolocation that never answers is cut by our own timer
  env.geoReply = 'silent';
  env.store['tilestyle.weather'] = '';
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(60000);
  assert.strictEqual(env.xhr.length, 2);
});

test('recent weather is resent from cache, shifted to the current hour', function () {
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  var first = lastSent('Weather');
  // within 10 minutes and across an hour boundary
  var toNextHour = 3600000 - (clock.now % 3600000) + 1000;
  if (toNextHour > 9 * 60000) advance(toNextHour - 8 * 60000);
  var before = env.xhr.length;
  advance(Math.min(toNextHour, 8 * 60000));
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.xhr.length, before, 'no new fetch');
  var second = lastSent('Weather');
  assert.notStrictEqual(second, first);
  var u32 = function (b, o) { return b[o] + b[o + 1] * 256 + b[o + 2] * 65536 + b[o + 3] * 16777216; };
  assert.strictEqual(u32(second, 14) % 3600, 0);
  assert.strictEqual(u32(second, 14), Math.floor(clock.now / 3600000) * 3600);
  // after 10 minutes: a new fetch
  advance(11 * 60000);
  fire('appmessage', { payload: { WeatherRequest: 1 } });
  advance(5000);
  assert.strictEqual(env.xhr.length, before + 1);
});

test('fetch failure after saving retries once later', function () {
  env.xhrFail = true;
  var s = tool.presetSettings(DefaultPreset);
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify(s)) });
  advance(5000);
  assert.strictEqual(env.xhr.length, 1);
  env.xhrFail = false;
  advance(70000);
  assert.strictEqual(env.xhr.length, 2);
  assert.deepStrictEqual(sentKeys(), ['Config', 'Weather']);
});

function request() { fire('appmessage', { payload: { WeatherRequest: 1 } }); }

test('hung XHR without ontimeout is aborted and fetching recovers', function () {
  env.xhrMode = 'hang';
  request();
  advance(10000);
  request(); // still in flight: no second request
  advance(10000);
  assert.strictEqual(env.xhr.length, 1);
  advance(20000); // past HTTP timeout + 5 s
  assert.strictEqual(env.aborts, 1);
  assert.strictEqual(env.sent.length, 0);
  assert(env.logs.some(function (l) { return /weather failed: timeout/.test(l); }), 'error logged');
  env.xhrMode = undefined;
  request();
  advance(5000);
  assert.strictEqual(env.xhr.length, 2);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
  advance(120000); // the abandoned request's timers do nothing more
  assert.deepStrictEqual(sentKeys(), ['Weather']);
});

['throwOpen', 'throwSend'].forEach(function (mode) {
  test('XHR ' + mode + ' does not leave fetching stuck', function () {
    env.xhrMode = mode;
    request();
    advance(5000);
    assert.strictEqual(env.sent.length, 0);
    assert(env.logs.some(function (l) { return /weather failed: request failed/.test(l); }), 'error logged');
    env.xhrMode = undefined;
    request();
    advance(5000);
    assert.deepStrictEqual(sentKeys(), ['Weather']);
    advance(120000);
    assert.deepStrictEqual(sentKeys(), ['Weather'], 'no late duplicate');
  });
});

test('throwing geolocation does not leave fetching stuck', function () {
  env.geoReply = 'throw';
  request();
  advance(60000);
  assert.strictEqual(env.sent.length, 0);
  env.geoReply = 'ok';
  request();
  advance(5000);
  assert.deepStrictEqual(sentKeys(), ['Weather']);
});

test('cache freshness is capped by a short weatherInterval', function () {
  var s = tool.presetSettings(DefaultPreset);
  s.general.weatherInterval = 5;
  env.store[SETTINGS_KEY] = JSON.stringify(s);
  request();
  advance(5000);
  assert.strictEqual(env.xhr.length, 1);
  advance(3 * 60000); // within 5 min: cached
  request();
  advance(5000);
  assert.strictEqual(env.xhr.length, 1);
  advance(3 * 60000); // ~6 min: older than the interval, fetch again
  request();
  advance(5000);
  assert.strictEqual(env.xhr.length, 2);
  assert.strictEqual(sentKeys().length, 3);
});

process.stdout.write((process.exitCode ? 'FAILED' : 'OK') + ': ' + passed + ' tests passed\n');
