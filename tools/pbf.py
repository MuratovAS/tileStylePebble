"""
Reader for Pebble fonts (.pbf, versions 2 and 3), the ones built into the firmware.
The format is taken from tools/font/dump_font.py in PebbleOS (Apache-2.0).

A glyph is stored as a 1-bit mask (one bit per pixel, no anti-aliasing),
optionally RLE4-compressed. Returns a dict of code point -> glyph.
"""
import struct

FEATURE_OFFSET_16 = 0x01
FEATURE_RLE4 = 0x02
GLYPH_MD = "<BBbbb"  # width, height, left, top, advance


def _bits_plain(data, w, h):
    n = w * h
    out = []
    for i in range(0, len(data) - len(data) % 4, 4):
        word, = struct.unpack_from("<I", data, i)
        for bit in range(32):
            out.append(1 if word >> bit & 1 else 0)
            if len(out) == n:
                return out
    return out[:n]


def _bits_rle4(data, units, w):
    out = []
    for b in data:
        for _ in range(2):
            if units == 0:
                break
            units -= 1
            length = (b & 0x7) + 1
            out.extend([(b >> 3) & 1] * length)
            b >>= 4
    return out


def load(path):
    font = open(path, "rb").read()
    version = font[0]
    if version == 3:
        (version, max_height, num_glyphs, wildcard, table_size, cp_bytes, _size, features) = \
            struct.unpack_from("<BBHHBBBB", font, 0)
        md_size = 10
    elif version == 2:
        (version, max_height, num_glyphs, wildcard, table_size, cp_bytes) = struct.unpack_from("<BBHHBB", font, 0)
        md_size, features = 8, 0
    else:
        raise ValueError("unknown pbf version: %d" % version)

    off_fmt = "<" + ("L" if cp_bytes == 4 else "H") + ("H" if features & FEATURE_OFFSET_16 else "L")
    off_size = struct.calcsize(off_fmt)
    offsets_start = md_size + 4 * table_size
    glyph_table = offsets_start + off_size * num_glyphs

    glyphs = {}
    for t in range(table_size):
        _hash, count, off = struct.unpack_from("<BBH", font, md_size + 4 * t)
        for i in range(count):
            cp, goff = struct.unpack_from(off_fmt, font, offsets_start + off + i * off_size)
            p = glyph_table + goff
            w, h, left, top, adv = struct.unpack_from(GLYPH_MD, font, p)
            p += struct.calcsize(GLYPH_MD)
            if features & FEATURE_RLE4:
                raw = font[p:p + (h + 1) // 2]
                bits = _bits_rle4(raw, h, w)
                h = len(bits) // w if w else 0
            else:
                raw = font[p:p + (((w * h + 7) // 8 + 3) // 4) * 4]
                bits = _bits_plain(raw, w, h)
            glyphs[cp] = {"w": w, "h": h, "left": left, "top": top, "adv": adv, "bits": bits}
    return {"max_height": max_height, "wildcard": wildcard, "glyphs": glyphs}
