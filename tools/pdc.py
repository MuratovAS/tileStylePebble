"""
Reader for Pebble vector images (.pdc, Pebble Draw Command Image).

Format (little-endian): "PDCI", size; version, reserved, viewbox width and
height (int16); command count (uint16); commands:
  type (1 path, 2 circle, 3 precise path), flags (bit 0 = hidden),
  stroke color, stroke width, fill color (GColor8, 0b aarrggbb),
  path open / circle radius (uint16), point count (uint16), int16 x, y points
  (fixed-point 13.3 for precise paths).
"""
import struct

PATH, CIRCLE, PRECISE = 1, 2, 3


def load(path):
    data = open(path, 'rb').read()
    if data[:4] != b'PDCI':
        raise ValueError(path + ': not a PDC image')
    version, _r, w, h, count = struct.unpack_from('<BBhhH', data, 8)
    pos = 16
    cmds = []
    for _ in range(count):
        kind, flags, stroke, sw, fill, open_or_r, n = struct.unpack_from('<BBBBBHH', data, pos)
        pos += 9
        pts = [struct.unpack_from('<hh', data, pos + 4 * i) for i in range(n)]
        pos += 4 * n
        if kind == PRECISE:
            pts = [(x / 8.0, y / 8.0) for x, y in pts]
        cmds.append({
            'type': kind,
            'hidden': bool(flags & 1),
            'stroke': stroke, 'stroke_width': sw, 'fill': fill,
            'open': bool(open_or_r & 1) if kind != CIRCLE else False,
            'radius': open_or_r if kind == CIRCLE else 0,
            'points': pts,
        })
    return {'w': w, 'h': h, 'commands': cmds}
