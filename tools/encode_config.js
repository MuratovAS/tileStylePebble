#!/usr/bin/env node
/*
 * Encodes settings / weather into the binary blobs from src/c/protocol.h,
 * using the same code as the phone (src/pkjs/protocol.js).
 *
 *   node tools/encode_config.js <settings.json|-> [weather] [output]
 *   node tools/encode_config.js --preset <key|index> [weather] [output]
 *   node tools/encode_config.js --all-presets [output]
 *   node tools/encode_config.js --list-presets
 *   node tools/encode_config.js --demo-weather [output]      (weather only)
 *
 * weather: --weather <file.json>   normalized weather object (see
 *                                  protocol.encodeWeather) or a raw
 *                                  Open-Meteo response (weather.buildUrl)
 *          --demo-weather          synthetic weather from the current hour
 *          --live-weather <lat,lon> fetch from Open-Meteo now
 * output:  default "<name> <hex>" per line; --c-array C arrays; --json
 *
 * Presets are read from config/js/presets.js (the settings page).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var https = require('https');

var ROOT = path.join(__dirname, '..');
var protocol = require(path.join(ROOT, 'src/pkjs/protocol.js'));
var weather = require(path.join(ROOT, 'src/pkjs/weather.js'));

var PRESETS_FILE = path.join(ROOT, 'config/js/presets.js');

// --- presets ---------------------------------------------------------------

function loadPresets(file) {
  var sandbox = {};
  vm.runInNewContext(fs.readFileSync(file || PRESETS_FILE, 'utf8'), sandbox, { filename: file || PRESETS_FILE });
  if (!Array.isArray(sandbox.Presets)) throw new Error('no Presets in ' + (file || PRESETS_FILE));
  return sandbox.Presets;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// A preset as the page would save it right after picking it
// (config.js applyPreset + buildConfig, default general settings): presets
// are written in grid cells, saved settings have blocks in pixels.
function presetSettings(p) {
  var theme = {};
  [protocol.THEME_DEFAULTS, p.theme || {}].forEach(function (src) {
    Object.keys(src).forEach(function (k) { theme[k] = src[k]; });
  });
  var general = clone(protocol.GENERAL_DEFAULTS);
  general.weatherLocation = '';
  var layout = protocol.pixelLayout({ layout: clone(p.layout), grid: p.grid });
  if (!layout) throw new Error('preset ' + p.key + ': the blocks do not tile the screen');
  return {
    v: 2,
    layout: layout,
    theme: theme,
    general: general
  };
}

function findPreset(presets, ref) {
  var byKey = presets.filter(function (p) { return p.key === ref; })[0];
  if (byKey) return byKey;
  if (/^\d+$/.test(ref) && presets[Number(ref)]) return presets[Number(ref)];
  throw new Error('unknown preset "' + ref + '" (try --list-presets)');
}

// --- weather -----------------------------------------------------------------

// Synthetic weather starting at the top of the current hour, like the
// page's MOCK: mild day, partly cloudy, rain later, night icons at night.
function demoWeather(nowSec) {
  if (nowSec === undefined) nowSec = Math.floor(Date.now() / 1000);
  var W = protocol.WEATHER;
  var start = Math.floor(nowSec / 3600) * 3600;
  var conds = [W.PARTLY_CLOUDY, W.PARTLY_CLOUDY, W.CLOUDY, W.LIGHT_RAIN, W.HEAVY_RAIN,
    W.CLOUDY, W.PARTLY_CLOUDY, W.CLEAR_DAY, W.LIGHT_SNOW, W.THUNDERSTORM, W.RAIN_SNOW, W.HEAVY_SNOW];
  var hourly = [];
  for (var i = 0; i < protocol.MAX_HOURLY; i++) {
    var h = new Date((start + i * 3600) * 1000).getHours();
    var c = conds[(h + Math.floor(i / 24)) % conds.length];
    if (h < 6 || h >= 21) {
      if (c === W.CLEAR_DAY) c = W.CLEAR_NIGHT;
      if (c === W.PARTLY_CLOUDY) c = W.PARTLY_CLOUDY_NIGHT;
    }
    hourly.push({ temp: Math.round((11 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI)) * 10) / 10 - (i >= 24 ? 2 : 0), condition: c });
  }
  return {
    fetchedAt: nowSec,
    temp: hourly[0].temp,
    condition: hourly[0].condition,
    high: 17.4,
    low: -3.6,
    forecastCondition: W.LIGHT_RAIN,
    uv: 4,
    hourlyStart: start,
    hourly: hourly
  };
}

function readWeatherFile(file) {
  var json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json.current && json.hourly ? weather.parseOpenMeteo(json) : json;
}

function liveWeather(arg, cb) {
  var ll = String(arg).split(',').map(Number);
  if (ll.length !== 2 || ll.some(isNaN)) throw new Error('--live-weather wants <lat>,<lon>');
  var url = weather.buildUrl(ll[0], ll[1]);
  process.stderr.write('GET ' + url + '\n');
  https.get(url, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (d) { body += d; });
    res.on('end', function () {
      if (res.statusCode !== 200) return cb(new Error('HTTP ' + res.statusCode + ': ' + body));
      try {
        cb(null, weather.parseOpenMeteo(JSON.parse(body)));
      } catch (e) {
        cb(e);
      }
    });
  }).on('error', cb);
}

// --- output ------------------------------------------------------------------

function hex(bytes) {
  return bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
}

function cArray(name, bytes) {
  var lines = [];
  for (var i = 0; i < bytes.length; i += 12) {
    lines.push('  ' + bytes.slice(i, i + 12).map(function (b) {
      return '0x' + (b < 16 ? '0' : '') + b.toString(16);
    }).join(', ') + ',');
  }
  return '// ' + bytes.length + ' bytes\nstatic const uint8_t ' + name + '[] = {\n' + lines.join('\n') + '\n};\n';
}

function print(blobs, mode) {
  if (mode === 'json') {
    var o = {};
    blobs.forEach(function (b) { o[b.name] = hex(b.bytes); });
    process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  } else if (mode === 'c') {
    process.stdout.write(blobs.map(function (b) {
      return cArray(b.name.replace(/[^A-Za-z0-9_]/g, '_') + '_blob', b.bytes);
    }).join('\n'));
  } else {
    blobs.forEach(function (b) { process.stdout.write(b.name + ' ' + hex(b.bytes) + '\n'); });
  }
}

// --- main --------------------------------------------------------------------

function usage(code) {
  var src = fs.readFileSync(__filename, 'utf8');
  process.stderr.write(src.slice(src.indexOf('/*') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '') + '\n');
  process.exit(code);
}

function main(argv) {
  var args = { mode: 'text' };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    var next = function () {
      if (i + 1 >= argv.length) throw new Error(a + ' needs a value');
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage(0);
    else if (a === '--preset') args.preset = next();
    else if (a === '--all-presets') args.allPresets = true;
    else if (a === '--list-presets') args.listPresets = true;
    else if (a === '--presets-file') args.presetsFile = next();
    else if (a === '--weather') args.weatherFile = next();
    else if (a === '--demo-weather') args.demoWeather = true;
    else if (a === '--live-weather') args.liveWeather = next();
    else if (a === '--c-array') args.mode = 'c';
    else if (a === '--json') args.mode = 'json';
    else if (a.charAt(0) === '-' && a !== '-') throw new Error('unknown option ' + a);
    else if (args.settings === undefined) args.settings = a;
    else throw new Error('extra argument ' + a);
  }

  if (args.listPresets) {
    loadPresets(args.presetsFile).forEach(function (p, idx) {
      process.stdout.write(idx + ' ' + p.key + ' (' + p.name + ')\n');
    });
    return;
  }
  if (args.allPresets) {
    print(loadPresets(args.presetsFile).map(function (p) {
      return { name: p.key, bytes: protocol.encodeConfig(presetSettings(p)) };
    }), args.mode);
    return;
  }

  var blobs = [];
  var settings = null;
  if (args.preset !== undefined) {
    settings = presetSettings(findPreset(loadPresets(args.presetsFile), args.preset));
  } else if (args.settings !== undefined) {
    settings = JSON.parse(fs.readFileSync(args.settings === '-' ? 0 : args.settings, 'utf8'));
  }
  if (settings) blobs.push({ name: 'config', bytes: protocol.encodeConfig(settings) });

  var finish = function (w) {
    if (w) blobs.push({ name: 'weather', bytes: protocol.encodeWeather(w) });
    if (!blobs.length) usage(2);
    print(blobs, args.mode);
  };
  if (args.liveWeather) {
    liveWeather(args.liveWeather, function (err, w) {
      if (err) {
        process.stderr.write('error: ' + err.message + '\n');
        process.exit(1);
      }
      finish(w);
    });
  } else if (args.weatherFile) {
    finish(readWeatherFile(args.weatherFile));
  } else {
    finish(args.demoWeather ? demoWeather() : null);
  }
}

module.exports = { loadPresets: loadPresets, presetSettings: presetSettings, demoWeather: demoWeather, hex: hex };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('error: ' + e.message + '\n');
    process.exit(1);
  }
}
