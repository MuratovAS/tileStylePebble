/*
 * Weather from Open-Meteo (no API key), as in TimeStyle.
 *
 * parseOpenMeteo and conditionFor are pure (node can require this file);
 * fetchWeather uses the pkjs environment: navigator.geolocation,
 * XMLHttpRequest and localStorage.
 */
'use strict';

var protocol = require('./protocol');

var W = protocol.WEATHER;
var API_URL = 'https://api.open-meteo.com/v1/forecast';
var POSITION_KEY = 'tilestyle.position';
var HTTP_TIMEOUT_MS = 20000;
var GEO_OPTIONS = { enableHighAccuracy: false, timeout: 15000, maximumAge: 15 * 60 * 1000 };

// WMO weather code -> WeatherCondition. isDay picks the day/night variant
// for clear and partly cloudy (daily forecasts pass true).
function conditionFor(code, isDay) {
  switch (code) {
    case 0:
      return isDay ? W.CLEAR_DAY : W.CLEAR_NIGHT;
    case 1: case 2:
      return isDay ? W.PARTLY_CLOUDY : W.PARTLY_CLOUDY_NIGHT;
    case 3: case 45: case 48:
      return W.CLOUDY;
    case 51: case 53: case 55: case 61: case 80:
      return W.LIGHT_RAIN;
    case 63: case 65: case 81: case 82:
      return W.HEAVY_RAIN;
    case 56: case 57: case 66: case 67:
      return W.RAIN_SNOW;
    case 71: case 77: case 85:
      return W.LIGHT_SNOW;
    case 73: case 75: case 86:
      return W.HEAVY_SNOW;
    case 95: case 96: case 99:
      return W.THUNDERSTORM;
    default:
      return W.GENERIC;
  }
}

function round4(v) { return Math.round(v * 10000) / 10000; }

function buildUrl(lat, lon) {
  return API_URL +
    '?latitude=' + round4(lat) + '&longitude=' + round4(lon) +
    '&current=temperature_2m,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max' +
    '&timezone=auto&timeformat=unixtime&forecast_days=3';
}

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// index of the last entry with times[i] <= t (times ascending), or 0
function indexAt(times, t) {
  var idx = 0;
  for (var i = 0; i < times.length; i++) {
    if (times[i] <= t) idx = i; else break;
  }
  return idx;
}

/*
 * Open-Meteo response (requested by buildUrl, timeformat=unixtime) ->
 * the weather object protocol.encodeWeather takes. nowSec defaults to
 * the current time. Throws if the response has no current temperature.
 */
function parseOpenMeteo(json, nowSec) {
  if (nowSec === undefined) nowSec = Math.floor(Date.now() / 1000);
  var cur = json && json.current;
  if (!cur || !isNum(cur.temperature_2m)) throw new Error('no current weather in response');

  var out = {
    fetchedAt: nowSec,
    temp: cur.temperature_2m,
    condition: conditionFor(cur.weather_code, cur.is_day !== 0),
    high: cur.temperature_2m,
    low: cur.temperature_2m,
    forecastCondition: W.GENERIC,
    uv: null,
    hourlyStart: 0,
    hourly: []
  };

  // today in the location's timezone (timezone=auto: daily times are local midnights)
  var d = json.daily;
  if (d && Array.isArray(d.time) && d.time.length) {
    var di = indexAt(d.time, nowSec);
    var pick = function (arr) { return arr && isNum(arr[di]) ? arr[di] : null; };
    var hi = pick(d.temperature_2m_max), lo = pick(d.temperature_2m_min);
    if (hi !== null) out.high = hi;
    if (lo !== null) out.low = lo;
    var code = pick(d.weather_code);
    if (code !== null) out.forecastCondition = conditionFor(code, true);
    out.uv = pick(d.uv_index_max);
  }

  // hourly from the top of the current (local) hour
  var h = json.hourly;
  if (h && Array.isArray(h.time) && h.time.length && h.time[0] <= nowSec) {
    var start = indexAt(h.time, nowSec);
    out.hourlyStart = h.time[start];
    for (var i = start; i < h.time.length && out.hourly.length < protocol.MAX_HOURLY; i++) {
      var t = h.temperature_2m && h.temperature_2m[i];
      if (!isNum(t)) break;
      var isDay = !(h.is_day && h.is_day[i] === 0);
      out.hourly.push({ temp: t, condition: conditionFor(h.weather_code && h.weather_code[i], isDay) });
    }
  }
  return out;
}

// --- pkjs side -----------------------------------------------------------

function storageGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}

function storageSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
}

function cachedPosition() {
  try {
    var p = JSON.parse(storageGet(POSITION_KEY));
    return p && isNum(p.lat) && isNum(p.lon) ? p : null;
  } catch (e) {
    return null;
  }
}

function gpsLocation(cb) {
  var done = false;
  var fallback = function (why) {
    if (done) return;
    done = true;
    var p = cachedPosition();
    if (p) {
      console.log('tilestyle: gps failed (' + why + '), using last position');
      cb(null, { lat: p.lat, lon: p.lon });
    } else {
      cb(new Error('no location: ' + why));
    }
  };
  if (typeof navigator === 'undefined' || !navigator.geolocation) return fallback('no geolocation');
  // some environments never call back: guard with our own timer
  var timer = setTimeout(function () { fallback('timeout'); }, GEO_OPTIONS.timeout + 5000);
  navigator.geolocation.getCurrentPosition(function (pos) {
    clearTimeout(timer);
    if (done) return;
    done = true;
    var loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    storageSet(POSITION_KEY, JSON.stringify({ lat: loc.lat, lon: loc.lon, t: Date.now() }));
    cb(null, loc);
  }, function (err) {
    clearTimeout(timer);
    fallback(err && err.message ? err.message : 'error ' + (err && err.code));
  }, GEO_OPTIONS);
}

// general settings -> {lat, lon}. 'manual' without coordinates falls back to GPS.
function getLocation(general, cb) {
  general = general || {};
  if (general.weatherSource === 'manual' && isNum(general.weatherLat) && isNum(general.weatherLon)) {
    return cb(null, { lat: general.weatherLat, lon: general.weatherLon });
  }
  gpsLocation(cb);
}

// GET url as JSON; cb(err, data) is called exactly once. Some PebbleKit JS
// runtimes ignore xhr.timeout, so our own timer aborts a hung request.
function httpGetJson(url, cb) {
  var xhr;
  var done = false;
  var timer = null;
  var finish = function (err, data) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb(err, data);
  };
  timer = setTimeout(function () {
    try { if (xhr) xhr.abort(); } catch (e) { /* ignore */ }
    finish(new Error('timeout'));
  }, HTTP_TIMEOUT_MS + 5000);
  try {
    xhr = new XMLHttpRequest();
    xhr.onload = function () {
      if (xhr.status !== 200) return finish(new Error('HTTP ' + xhr.status));
      var data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        return finish(new Error('bad JSON'));
      }
      finish(null, data);
    };
    xhr.onerror = function () { finish(new Error('network error')); };
    xhr.ontimeout = function () { finish(new Error('timeout')); };
    xhr.open('GET', url);
    try { xhr.timeout = HTTP_TIMEOUT_MS; } catch (e) { /* not supported */ }
    xhr.send();
  } catch (e) {
    finish(new Error('request failed: ' + (e && e.message ? e.message : e)));
  }
}

// general settings -> cb(err, weather object for protocol.encodeWeather);
// cb is called exactly once, also when something throws
function fetchWeather(general, cb) {
  var called = false;
  var done = function (err, w) {
    if (called) return;
    called = true;
    cb(err, w);
  };
  try {
    getLocation(general, function (err, loc) {
      if (err) return done(err);
      var url = buildUrl(loc.lat, loc.lon);
      console.log('tilestyle: GET ' + url);
      httpGetJson(url, function (err2, json) {
        if (err2) return done(err2);
        var w;
        try {
          w = parseOpenMeteo(json);
        } catch (e) {
          return done(e);
        }
        done(null, w);
      });
    });
  } catch (e) {
    done(e instanceof Error ? e : new Error(String(e)));
  }
}

module.exports = {
  conditionFor: conditionFor,
  buildUrl: buildUrl,
  parseOpenMeteo: parseOpenMeteo,
  getLocation: getLocation,
  fetchWeather: fetchWeather
};
