"""
Draws the app icon: a tiny watch face in the default layout, the time
"10:09" in hours over minutes on a white tile and a column of orange tiles.

    python3 tools/app_icon.py

- resources/app_icon.png        the menu icon on the watch (25x25)
- screenshots/icon_small.png    the app store's iconSmall (80x80)
- screenshots/icon_large.png    the app store's iconLarge (144x144)

The store icons are the same pixels scaled by a whole number (3 and 5),
centered on a transparent square. The icon is pixel art: edit the map below,
one character per pixel.
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'resources', 'app_icon.png')
STORE = os.path.join(ROOT, 'screenshots')
# app store icon: (file, size, scale)
STORE_ICONS = [('icon_small.png', 80, 3), ('icon_large.png', 144, 5)]

# Pebble palette colors (0/85/170/255 per channel); '.' is transparent
COLORS = {
    '.': None,
    'k': (0, 0, 0),
    'w': (255, 255, 255),
    'o': (255, 85, 0),
}

ICON = '''
..kkkkkkkkkkkkkkkkkkkkk..
.kkkkkkkkkkkkkkkkkkkkkkk.
kkwwwwwwwwwwwwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
kkwwkkwwwkkkkwwkoooooookk
kkwkkkwwwkwwkwwkoooooookk
kkwwwkwwwkwwkwwkoooooookk
kkwwwkwwwkwwkwwkoooooookk
kkwwwkwwwkwwkwwkkkkkkkkkk
kkwwwkwwwkwwkwwkoooooookk
kkwwkkkwwkkkkwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
kkwwkkkkwkkkkwwkoooooookk
kkwwkwwkwkwwkwwkoooooookk
kkwwkwwkwkwwkwwkkkkkkkkkk
kkwwkwwkwkkkkwwkoooooookk
kkwwkwwkwwwwkwwkoooooookk
kkwwkwwkwwwwkwwkoooooookk
kkwwkkkkwkkkkwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
kkwwwwwwwwwwwwwkoooooookk
.kkkkkkkkkkkkkkkkkkkkkkk.
..kkkkkkkkkkkkkkkkkkkkk..
'''


def png(rows):
    h, w = len(rows), len(rows[0])
    raw = b''
    for row in rows:
        raw += b'\0'
        for ch in row:
            c = COLORS[ch]
            raw += bytes(c + (255,)) if c else b'\0\0\0\0'

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def scaled(rows, size, k):
    pad = (size - len(rows) * k) // 2
    out = ['.' * size] * pad
    for r in rows:
        line = '.' * pad + ''.join(ch * k for ch in r)
        out += [line + '.' * (size - len(line))] * k
    return out + ['.' * size] * (size - len(out))


def write(path, rows):
    with open(path, 'wb') as f:
        f.write(png(rows))
    print('wrote ' + os.path.relpath(path, ROOT))


def main():
    rows = ICON.strip().split('\n')
    assert len(rows) == 25 and all(len(r) == 25 for r in rows), 'the icon must be 25x25'
    write(OUT, rows)
    os.makedirs(STORE, exist_ok=True)
    for name, size, k in STORE_ICONS:
        write(os.path.join(STORE, name), scaled(rows, size, k))


if __name__ == '__main__':
    main()
