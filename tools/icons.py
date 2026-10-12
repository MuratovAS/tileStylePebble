"""
Fixed-size icons for the watch and the preview.

    python3 tools/icons.py render [--force]   # sources -> resources/icons/*.png
    python3 tools/icons.py js                 # resources/icons/*.png -> config/js/icons.js
    python3 tools/icons.py                    # both steps
    python3 tools/icons.py resources          # resources/icons/*.png -> package.json media
                                              # list and src/c/gen_icons.h

Sources: TimeStyle vector icons (.pdc, MIT, resources/icons_src/timestyle)
and, for anything TimeStyle lacks, vectors from Widgets.ICONS (widgets.js).
The list is in SOURCES below.

Icons are two-tone, as in TimeStyle: each pixel has a "fill" or "stroke" role,
and role colors are chosen at draw time. The PNG is 2-bit paletted: transparent,
white (fill), black (stroke). Such a PNG can be touched up by hand:
render without --force does not overwrite existing files. When reading,
a transparent pixel is empty, a light one is fill, a dark one is stroke.

render runs headless Chromium (the path can be set via CHROME).
"""
import base64
import glob
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib

import pdc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, 'resources', 'icons')
PDC_DIR = os.path.join(ROOT, 'resources', 'icons_src', 'timestyle')
JS_OUT = os.path.join(ROOT, 'config', 'js', 'icons.js')
SOURCES_JS = os.path.join(ROOT, 'tools', '_icon_sources.js')

# icon name -> ('pdc', TimeStyle file) or ('svg', Widgets.ICONS key)
SOURCES = {
    'battery_frame': ('pdc', 'BATTERY_BG'),
    'battery_charge': ('pdc', 'BATTERY_CHARGE'),
    'bluetooth_off': ('pdc', 'DISCONNECTED'),
    'heart': ('pdc', 'HEALTH_HEART'),
    'sleep': ('pdc', 'HEALTH_SLEEP'),
    'steps': ('pdc', 'HEALTH_STEPS'),
    'weather_clear_day': ('pdc', 'CLEAR_DAY'),
    'weather_clear_night': ('pdc', 'CLEAR_NIGHT'),
    'weather_cloudy': ('pdc', 'CLOUDY_DAY'),
    'weather_partly_cloudy': ('pdc', 'PARTLY_CLOUDY'),
    'weather_partly_cloudy_night': ('pdc', 'PARTLY_CLOUDY_NIGHT'),
    'weather_light_rain': ('pdc', 'LIGHT_RAIN'),
    'weather_heavy_rain': ('pdc', 'HEAVY_RAIN'),
    'weather_light_snow': ('pdc', 'LIGHT_SNOW'),
    'weather_heavy_snow': ('pdc', 'HEAVY_SNOW'),
    'weather_rain_snow': ('pdc', 'RAINING_AND_SNOWING'),
    'weather_thunderstorm': ('pdc', 'THUNDERSTORM'),
    'weather_generic': ('pdc', 'WEATHER_GENERIC'),
    # not available in TimeStyle
    'bluetooth': ('svg', 'bluetooth'),
    'distance': ('svg', 'distance'),
    'calories': ('svg', 'calories'),
    'uv': ('svg', 'uv'),
}

# TimeStyle draws the charging bolt with swapped colors
SWAP_ROLES = {'battery_charge'}


# --- PNG -------------------------------------------------------------------

def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def write_png(path, size, px):
    """2-bit paletted PNG: 0 = transparent, 1 = white (fill), 2 = black (stroke)."""
    rows = b''
    for y in range(size):
        row = bytearray((size * 2 + 7) // 8)
        for x in range(size):
            row[x >> 2] |= px[y * size + x] << (6 - 2 * (x & 3))
        rows += b'\x00' + bytes(row)
    png = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 2, 3, 0, 0, 0))
    png += _chunk(b'PLTE', bytes([0, 0, 0, 255, 255, 255, 0, 0, 0]))
    png += _chunk(b'tRNS', bytes([0, 255, 255]))
    png += _chunk(b'IDAT', zlib.compress(rows, 9))
    png += _chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def read_png(path):
    """Returns (width, height, list of 0/1/2: empty/fill/stroke).
    Non-interlaced only, 1-8 bits per channel."""
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(path + ': not a PNG')
    pos, idat, plte, trns = 8, b'', None, None
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, ctype, _c, _f, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'PLTE':
            plte = body
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IDAT':
            idat += body
        pos += 12 + n
    if interlace or depth > 8:
        raise ValueError(path + ': expected a non-interlaced PNG, up to 8 bits per channel')

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = max(1, depth * channels // 8)
    stride = (w * depth * channels + 7) // 8
    raw = zlib.decompress(idat)
    prev = bytearray(stride)
    rows = []
    for y in range(h):
        ft = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            line[i] = (line[i] + (0, a, b, (a + b) // 2, _paeth(a, b, c))[ft]) & 0xff
        rows.append(line)
        prev = line

    def sample(line, idx):
        if depth == 8:
            return line[idx]
        per = 8 // depth
        byte = line[idx // per]
        shift = 8 - depth * (idx % per + 1)
        return (byte >> shift) & ((1 << depth) - 1)

    scale = 255 // ((1 << depth) - 1)
    bits = []
    for line in rows:
        for x in range(w):
            if ctype == 3:
                i = sample(line, x)
                r, g, b = plte[i * 3:i * 3 + 3]
                alpha = trns[i] if trns and i < len(trns) else 255
            elif ctype in (0, 4):
                r = g = b = sample(line, x * channels) * scale
                alpha = sample(line, x * channels + 1) * scale if ctype == 4 else 255
            else:
                r, g, b = (sample(line, x * channels + k) for k in range(3))
                alpha = sample(line, x * channels + 3) if ctype == 6 else 255
            has_alpha = ctype in (4, 6) or (ctype == 3 and trns)
            light = (r * 299 + g * 587 + b * 114) // 1000 >= 128
            if has_alpha:
                bits.append(0 if alpha < 128 else (1 if light else 2))
            else:
                # no transparency: black background, the light drawing is stroke
                bits.append(2 if light else 0)
    return w, h, bits


# --- steps ------------------------------------------------------------------

def find_chrome():
    if os.environ.get('CHROME'):
        return os.environ['CHROME']
    for name in ('chromium', 'chromium-browser', 'google-chrome', 'chrome-headless-shell'):
        if shutil.which(name):
            return shutil.which(name)
    shells = glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell'))
    if shells:
        return sorted(shells)[-1]
    sys.exit('Chromium not found: set its path in the CHROME variable')


def write_sources():
    src = {}
    for name, (kind, ref) in SOURCES.items():
        if kind == 'pdc':
            img = pdc.load(os.path.join(PDC_DIR, ref + '.pdc'))
            img['swap'] = name in SWAP_ROLES
            src[name] = {'pdc': img}
        else:
            src[name] = {'svg': ref}
    with open(SOURCES_JS, 'w') as f:
        f.write('/* Temporary file from tools/icons.py. */\nthis.IconSources = ' + json.dumps(src) + ';\n')


def render(force):
    write_sources()
    page = 'file://' + os.path.join(ROOT, 'tools', 'icons_render.html')
    html = subprocess.run(
        [find_chrome(), '--headless', '--disable-gpu', '--allow-file-access-from-files',
         '--virtual-time-budget=2000', '--dump-dom', page],
        capture_output=True, text=True, check=True).stdout
    os.remove(SOURCES_JS)
    m = re.search(r'<pre id="out">(.*?)</pre>', html, re.S)
    if not m or not m.group(1).strip():
        sys.exit('the rasterization page returned nothing')
    icons = json.loads(m.group(1).replace('&quot;', '"'))
    os.makedirs(ICON_DIR, exist_ok=True)
    written = kept = 0
    for name, sizes in icons.items():
        for size, px in sizes.items():
            path = os.path.join(ICON_DIR, '%s_%s.png' % (name, size))
            if os.path.exists(path) and not force:
                kept += 1
                continue
            write_png(path, int(size), [int(c) for c in px])
            written += 1
    print('PNG: %d written, %d kept as is' % (written, kept), file=sys.stderr)


def build_js():
    icons = {}
    for path in sorted(glob.glob(os.path.join(ICON_DIR, '*.png'))):
        m = re.match(r'(.+)_(\d+)\.png$', os.path.basename(path))
        if not m:
            continue
        w, h, px = read_png(path)
        # 2 bits per pixel, the high bits of a byte are the first pixel
        packed = bytearray((len(px) * 2 + 7) // 8)
        for i, v in enumerate(px):
            packed[i >> 2] |= v << (6 - 2 * (i & 3))
        icons.setdefault(m.group(1), {})[m.group(2)] = [w, h, base64.b64encode(bytes(packed)).decode('ascii')]
    with open(JS_OUT, 'w') as f:
        f.write('/* Generated by tools/icons.py from resources/icons/*.png. Do not edit by hand. */\n')
        f.write('this.PebbleIcons = ' + json.dumps(icons, separators=(',', ':')) + ';\n')
    print('%s: %d icons' % (os.path.relpath(JS_OUT, ROOT), len(icons)), file=sys.stderr)


def build_resources():
    """Rewrites the icon entries of package.json's media list (other entries,
    such as the clock fonts, are kept) and src/c/gen_icons.h with the IconId
    enum and the resource id table the watch uses."""
    pkg_path = os.path.join(ROOT, 'package.json')
    with open(pkg_path) as f:
        pkg = json.load(f)
    icons = {}
    for path in sorted(glob.glob(os.path.join(ICON_DIR, '*.png'))):
        m = re.match(r'(.+)_(\d+)\.png$', os.path.basename(path))
        if m:
            icons.setdefault(m.group(1), set()).add(int(m.group(2)))
    sizes = sorted(set.union(*icons.values()))
    media = [r for r in pkg['pebble']['resources']['media'] if not r['name'].startswith('ICON_')]
    for name in sorted(icons):
        missing = set(sizes) - icons[name]
        if missing:
            sys.exit('%s: missing sizes %s' % (name, sorted(missing)))
        for size in sizes:
            media.append({
                'type': 'bitmap',
                'name': 'ICON_%s_%d' % (name.upper(), size),
                'file': 'icons/%s_%d.png' % (name, size),
                'memoryFormat': 'SmallestPalette',
                'storageFormat': 'pbi',
            })
    pkg['pebble']['resources']['media'] = media
    with open(pkg_path, 'w') as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write('\n')

    out = ['/* Generated by tools/icons.py resources. Do not edit by hand. */',
           '#pragma once', '', '#define ICON_SIZE_COUNT %d' % len(sizes),
           '#define ICON_SIZES {%s}' % ', '.join(str(s) for s in sizes), '',
           'typedef enum {']
    out += ['  ICON_%s,' % name.upper() for name in sorted(icons)]
    out += ['  ICON_COUNT', '} IconId;', '', '#define ICON_RESOURCE_TABLE { \\']
    for name in sorted(icons):
        out.append('  {%s}, \\' % ', '.join('RESOURCE_ID_ICON_%s_%d' % (name.upper(), s) for s in sizes))
    out.append('}')
    with open(os.path.join(ROOT, 'src', 'c', 'gen_icons.h'), 'w') as f:
        f.write('\n'.join(out) + '\n')
    print('package.json: %d icons x %d sizes' % (len(icons), len(sizes)), file=sys.stderr)


if __name__ == '__main__':
    args = sys.argv[1:]
    step = args[0] if args and not args[0].startswith('-') else 'all'
    if step in ('render', 'all'):
        render('--force' in args)
    if step in ('js', 'all'):
        build_js()
    if step == 'resources':
        build_resources()
