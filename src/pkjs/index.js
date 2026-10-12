/*
 * TileStyle phone side: settings page, settings and weather messages.
 *
 * Settings live in localStorage as the raw JSON from the settings page.
 * The watch keeps its own copy (sent as the Config blob), so on start
 * nothing is sent; the watch asks for weather with WeatherRequest.
 */
'use strict';

var protocol = require('./protocol');
var weather = require('./weather');

var CONFIG_URL = 'https://muratovas.github.io/tileStylePebble/';
var SETTINGS_KEY = 'tilestyle.settings';
var WEATHER_CACHE_KEY = 'tilestyle.weather';

var WEATHER_FRESH_S = 10 * 60;   // a cached forecast this recent is resent as is
                                 // (capped by the watch's weatherInterval)
var WEATHER_WATCHDOG_MS = 90 * 1000; // a fetch taking longer than this is abandoned
var WEATHER_RETRY_MS = 60 * 1000; // one retry after a failed fetch

var SEND_TRIES = 4;
var SEND_TIMEOUT_MS = 15000;

function log(msg) { console.log('tilestyle: ' + msg); }

function storageGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}

function storageSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { log('storage write failed: ' + e); }
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// stored settings object, or null if none
function loadSettings() {
  var raw = storageGet(SETTINGS_KEY);
  if (!raw) return null;
  try {
    var cfg = JSON.parse(raw);
    return isObj(cfg) ? cfg : null;
  } catch (e) {
    return null;
  }
}

function generalOf(cfg) {
  return cfg && isObj(cfg.general) ? cfg.general : protocol.GENERAL_DEFAULTS;
}

// No stored settings: the watch shows presets[0], which has a weather widget
function weatherWanted(cfg) {
  return generalOf(cfg).weatherSource !== 'off' && protocol.needsWeather(cfg);
}

// --- AppMessage queue: one message in flight, retries with backoff ------

var queue = [];
var sending = false;

function send(key, bytes, cb) {
  // a newer blob of the same kind replaces one still waiting in the queue
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].key === key) {
      queue[i].bytes = bytes;
      if (cb) queue[i].cbs.push(cb);
      return;
    }
  }
  queue.push({ key: key, bytes: bytes, cbs: cb ? [cb] : [] });
  pump();
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var item = queue.shift();
  var tries = 0;

  var finish = function (ok) {
    sending = false;
    item.cbs.forEach(function (cb) { cb(ok); });
    pump();
  };

  var attempt = function () {
    tries++;
    var settled = false;
    var settle = function (ok, why) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        log(item.key + ' sent (' + item.bytes.length + ' B)');
        return finish(true);
      }
      if (tries < SEND_TRIES) {
        log(item.key + ' send failed (' + why + '), retry ' + tries);
        return setTimeout(attempt, 1000 * Math.pow(2, tries - 1));
      }
      log(item.key + ' send failed (' + why + '), giving up');
      finish(false);
    };
    var timer = setTimeout(function () { settle(false, 'timeout'); }, SEND_TIMEOUT_MS);
    var dict = {};
    dict[item.key] = item.bytes;
    try {
      Pebble.sendAppMessage(dict, function () { settle(true); }, function (e) {
        settle(false, (e && e.error && e.error.message) || 'nack');
      });
    } catch (e) {
      settle(false, String(e));
    }
  };
  attempt();
}

// --- weather -------------------------------------------------------------

var weatherFetching = false;
var weatherRefetch = false; // settings changed during a fetch
var weatherRetryTimer = null;
var weatherWatchdog = null;
var weatherFetchId = 0;     // callbacks of abandoned fetches are ignored

function locationKey(cfg) {
  var g = generalOf(cfg);
  return g.weatherSource === 'manual' && typeof g.weatherLat === 'number'
    ? g.weatherLat + ',' + g.weatherLon : 'gps';
}

// cached forecast if fresh, with the hourly list moved to the current hour
function cachedWeather(cfg) {
  try {
    var c = JSON.parse(storageGet(WEATHER_CACHE_KEY));
    var now = Math.floor(Date.now() / 1000);
    // never older than the watch's refresh interval, or it would ask again at once
    var interval = Number(generalOf(cfg).weatherInterval);
    var fresh = interval > 0 ? Math.min(WEATHER_FRESH_S, interval * 60) : WEATHER_FRESH_S;
    if (!c || c.loc !== locationKey(cfg) || !(now - c.w.fetchedAt < fresh)) return null;
    var w = c.w;
    var skip = w.hourly.length ? Math.floor((now - w.hourlyStart) / 3600) : 0;
    if (skip > 0) {
      w.hourly = w.hourly.slice(skip);
      w.hourlyStart += skip * 3600;
    }
    return w;
  } catch (e) {
    return null;
  }
}

function updateWeather(force) {
  var cfg = loadSettings();
  if (!weatherWanted(cfg)) {
    log('weather not used, skipped');
    return;
  }
  if (!force) {
    var cached = cachedWeather(cfg);
    if (cached) {
      log('weather: sending cached');
      send('Weather', protocol.encodeWeather(cached));
      return;
    }
  }
  if (weatherFetching) {
    if (force) weatherRefetch = true;
    return;
  }
  weatherFetching = true;
  clearTimeout(weatherRetryTimer);
  weatherRetryTimer = null;
  var id = ++weatherFetchId;

  // Every path ends here exactly once per fetch: result, error, exception
  // or watchdog. weatherFetching is reset before anything else can throw.
  var finished = function (err, w) {
    if (id !== weatherFetchId || !weatherFetching) return;
    weatherFetching = false;
    clearTimeout(weatherWatchdog);
    weatherWatchdog = null;
    if (weatherRefetch) {
      weatherRefetch = false;
      return updateWeather(true);
    }
    if (err) {
      log('weather failed: ' + (err && err.message ? err.message : err));
      if (!force) return;
      // force means the settings just changed: try once more a bit later
      weatherRetryTimer = setTimeout(function () { updateWeather(false); }, WEATHER_RETRY_MS);
      return;
    }
    try {
      log('weather: ' + w.temp + 'C cond ' + w.condition + ', ' + w.hourly.length + ' h');
      storageSet(WEATHER_CACHE_KEY, JSON.stringify({ loc: locationKey(cfg), w: w }));
      send('Weather', protocol.encodeWeather(w));
    } catch (e) {
      log('weather send failed: ' + e);
    }
  };

  weatherWatchdog = setTimeout(function () { finished(new Error('watchdog timeout')); }, WEATHER_WATCHDOG_MS);
  try {
    weather.fetchWeather(generalOf(cfg), finished);
  } catch (e) {
    finished(e);
  }
}

// --- events --------------------------------------------------------------

Pebble.addEventListener('ready', function () {
  log('ready');
});

function isWeatherRequest(payload) {
  if (!payload) return false;
  if (payload.WeatherRequest !== undefined) return true;
  try {
    var keys = require('message_keys');
    return payload[keys.WeatherRequest] !== undefined || payload[String(keys.WeatherRequest)] !== undefined;
  } catch (e) {
    return false;
  }
}

Pebble.addEventListener('appmessage', function (e) {
  if (isWeatherRequest(e.payload)) {
    log('weather requested');
    updateWeather(false);
  }
});

Pebble.addEventListener('showConfiguration', function () {
  var raw = storageGet(SETTINGS_KEY);
  var url = CONFIG_URL + (raw ? '?config=' + encodeURIComponent(raw) : '');
  log('open settings');
  Pebble.openURL(url);
});

// The page returns JSON in the response, URI-encoded (pebblejs://close#...);
// some hosts hand it over already decoded. Empty or non-JSON means cancel.
function parseResponse(resp) {
  if (!resp || typeof resp !== 'string') return null;
  var s = resp;
  for (var i = 0; i < 3; i++) {
    try {
      var cfg = JSON.parse(s);
      return isObj(cfg) && (cfg.layout || cfg.theme || cfg.general) ? cfg : null;
    } catch (e) { /* maybe still encoded */ }
    try {
      var d = decodeURIComponent(s);
      if (d === s) return null;
      s = d;
    } catch (e) {
      return null;
    }
  }
  return null;
}

Pebble.addEventListener('webviewclosed', function (e) {
  var cfg = parseResponse(e && e.response);
  if (!cfg) {
    log('settings closed without saving');
    return;
  }
  storageSet(SETTINGS_KEY, JSON.stringify(cfg));
  var blob;
  try {
    blob = protocol.encodeConfig(cfg);
  } catch (err) {
    log('settings encode failed: ' + err);
    return;
  }
  log('settings saved, ' + blob.length + ' B');
  send('Config', blob);
  // queued after Config, so the watch already has the new layout
  if (weatherWanted(cfg)) updateWeather(true);
});
