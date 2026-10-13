/*
 * Raster screen preview: a 200×228 canvas at the watch's native resolution.
 *
 * Everything is drawn just as on the watch, without antialiasing:
 *  - text uses the firmware bitmap fonts (sysfonts.js, 1 bit per pixel);
 *  - icons use prebuilt bitmaps of fixed sizes (icons.js), two-color as in
 *    TimeStyle: fill and stroke, with colors applied at draw time;
 *  - shapes (frames, rounded corners) are drawn row by row in whole pixels.
 * The exception is the large time: as in TimeStyle, fctx draws it with vector
 * fonts (fonts.js); Avenir is antialiased, and its intermediate shades are
 * snapped to the palette.
 *
 * Widgets draw through the g object (see makeG) in their block's coordinates.
 */
(function (root) {
  'use strict';

  // Text size -> firmware font (regular, bold)
  var TEXT_FONTS = {
    14: ['GOTHIC_14', 'GOTHIC_14_BOLD'],
    18: ['GOTHIC_18', 'GOTHIC_18_BOLD'],
    24: ['GOTHIC_24', 'GOTHIC_24_BOLD'],
    28: ['GOTHIC_28', 'GOTHIC_28_BOLD']
  };
  var TEXT_SIZES = [14, 18, 24, 28];

  // --- palette ---------------------------------------------------------

  // The Pebble palette is every combination of 0/85/170/255 per channel, so
  // the nearest color is found by rounding each channel independently
  var LEVEL = new Uint8Array(256);
  for (var v = 0; v < 256; v++) LEVEL[v] = Math.round(v / 85) * 85;

  function quantize(ctx, w, h) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = LEVEL[d[i]];
      d[i + 1] = LEVEL[d[i + 1]];
      d[i + 2] = LEVEL[d[i + 2]];
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // --- 1-bit masks (glyphs, icons) -------------------------------------

  // bitsPer = 1 (glyphs) or 2 (icons: 0 empty, 1 fill, 2 stroke)
  function decodeBits(b64, count, bitsPer) {
    bitsPer = bitsPer || 1;
    var bin = atob(b64);
    var out = new Uint8Array(count);
    var mask = (1 << bitsPer) - 1;
    for (var i = 0; i < count; i++) {
      var bit = i * bitsPer;
      out[i] = (bin.charCodeAt(bit >> 3) >> (8 - bitsPer - (bit & 7))) & mask;
    }
    return out;
  }

  // A mask tinted with colors is cached as a small canvas.
  // colors[v - 1] is the color of pixels with value v.
  var tintCache = {};

  function tinted(key, w, h, px, colors) {
    var k = key + '|' + colors.join(',');
    if (tintCache[k]) return tintCache[k];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, w);
    cv.height = Math.max(1, h);
    if (w && h) {
      var ctx = cv.getContext('2d');
      var img = ctx.createImageData(w, h);
      var rgbs = colors.map(hexRgb);
      for (var i = 0; i < w * h; i++) {
        if (!px[i]) continue;
        var rgb = rgbs[px[i] - 1];
        img.data[i * 4] = rgb[0];
        img.data[i * 4 + 1] = rgb[1];
        img.data[i * 4 + 2] = rgb[2];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    tintCache[k] = cv;
    return cv;
  }

  // --- text in firmware fonts ------------------------------------------

  var glyphCache = {};

  // Text font family of the screen being drawn: 'gothic' (firmware fonts)
  // or a family of config/js/textfonts, the app fonts of the watch in the
  // same sizes (tools/textfonts.py). A family's script is loaded on demand.
  var family = 'gothic';
  var familyLoading = {};

  function familyFonts(key) {
    return key !== 'gothic' && root.PebbleTextFonts && root.PebbleTextFonts[key];
  }

  // Loads a candidate family's script once, then calls done
  function loadFamily(key, done) {
    if (familyLoading[key]) {
      familyLoading[key].push(done);
      return;
    }
    familyLoading[key] = [done];
    var el = document.createElement('script');
    el.src = 'js/textfonts/' + key + '.js';
    el.onload = function () {
      familyLoading[key].forEach(function (fn) { fn(); });
      familyLoading[key] = [];
    };
    el.onerror = function () { console.error('Text font not found', key); };
    document.head.appendChild(el);
  }

  function fontKey(size, bold) {
    if (!TEXT_FONTS[size]) size = 14;
    if (familyFonts(family)) return family + ':' + size + (bold ? 'b' : '');
    return TEXT_FONTS[size][bold ? 1 : 0];
  }

  function fontData(key) {
    var i = key.indexOf(':');
    return i < 0 ? root.PebbleSysFonts[key] : root.PebbleTextFonts[key.slice(0, i)][key.slice(i + 1)];
  }

  function glyph(key, ch) {
    var ck = key + ':' + ch;
    if (ck in glyphCache) return glyphCache[ck];
    var font = fontData(key);
    var raw = font.glyphs[ch] || font.glyphs[font.wildcard];
    var g = null;
    if (raw) {
      g = { w: raw[0], h: raw[1], left: raw[2], top: raw[3], adv: raw[4], bits: decodeBits(raw[5], raw[0] * raw[1]) };
    }
    glyphCache[ck] = g;
    return g;
  }

  function covers(key, str) {
    var glyphs = fontData(key).glyphs;
    for (var i = 0; i < str.length; i++) {
      if (!glyphs[str.charAt(i)]) return false;
    }
    return true;
  }

  function measure(str, size, bold) {
    var key = fontKey(size, bold), w = 0;
    for (var i = 0; i < str.length; i++) {
      var g = glyph(key, str.charAt(i));
      if (g) w += g.adv;
    }
    return w;
  }

  // Vertical ink bounds of a line relative to the line top
  function ink(str, size, bold) {
    var key = fontKey(size, bold), top = Infinity, bottom = -Infinity;
    for (var i = 0; i < str.length; i++) {
      var g = glyph(key, str.charAt(i));
      if (!g || !g.h) continue;
      top = Math.min(top, g.top);
      bottom = Math.max(bottom, g.top + g.h);
    }
    return top === Infinity ? { top: 0, h: 0 } : { top: top, h: bottom - top };
  }

  // y is the top of the line's ink
  function drawText(ctx, str, x, y, size, color, o) {
    o = o || {};
    var key = fontKey(size, o.bold);
    var w = measure(str, size, o.bold);
    var cx = Math.round(o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2);
    var lineTop = Math.round(y) - ink(str, size, o.bold).top;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var g = glyph(key, ch);
      if (!g) continue;
      if (g.w && g.h) ctx.drawImage(tinted(key + ':' + ch, g.w, g.h, g.bits, [color]), cx + g.left, lineTop + g.top);
      cx += g.adv;
    }
  }

  // Characters missing from the firmware fonts (the watch shows a placeholder)
  function unsupported(str) {
    var glyphs = root.PebbleSysFonts.GOTHIC_14.glyphs, out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (!glyphs[ch] && out.indexOf(ch) === -1) out += ch;
    }
    return out;
  }

  // --- fixed-size icons ------------------------------------------------

  var iconCache = {};

  function iconSize(budget) {
    var sizes = root.Widgets.ICON_SIZES, best = sizes[0];
    for (var i = 0; i < sizes.length; i++) {
      if (sizes[i] <= budget) best = sizes[i];
    }
    return best;
  }

  function iconMask(name, size) {
    var k = name + '_' + size;
    if (k in iconCache) return iconCache[k];
    var set = (root.PebbleIcons || {})[name] || {};
    var raw = set[size];
    iconCache[k] = raw ? { w: raw[0], h: raw[1], px: decodeBits(raw[2], raw[0] * raw[1], 2) } : null;
    return iconCache[k];
  }

  // stroke is the outline color, fill is the fill color (like recolor in TimeStyle)
  function drawIcon(ctx, name, x, y, size, stroke, fill) {
    var m = iconMask(name, size);
    if (!m) {
      console.warn('missing icon ' + name + '_' + size + '.png');
      return;
    }
    ctx.drawImage(tinted('icon:' + name + '_' + size, m.w, m.h, m.px, [fill, stroke]), Math.round(x), Math.round(y));
  }

  // Battery body is an icon; the level is a rectangle inside it
  // (in TimeStyle at 25 px: x 3, y 8, width up to 18, height 8)
  function drawBattery(ctx, x, y, size, stroke, fill, level) {
    drawIcon(ctx, 'battery_frame', x, y, size, stroke, fill);
    // full level box from tools/icons.py (the frame's inside less a gap)
    var b = root.PebbleBatteryLevel[size];
    var fw = Math.max(1, Math.round(b[2] * level / 100));
    ctx.fillStyle = stroke;
    ctx.fillRect(Math.round(x) + b[0], Math.round(y) + b[1], fw, b[3]);
  }

  // --- shapes without antialiasing -------------------------------------

  // Inset of row j from the edge of a rectangle with corner radius r
  function cornerInset(j, h, r) {
    var d = j < r ? r - j - 0.5 : (j >= h - r ? j - (h - r) + 0.5 : -1);
    if (d < 0) return 0;
    return Math.round(r - Math.sqrt(Math.max(0, r * r - d * d)));
  }

  function fillRoundRect(ctx, x, y, w, h, r, color) {
    r = Math.max(0, Math.min(r, Math.floor(w / 2), Math.floor(h / 2)));
    ctx.fillStyle = color;
    if (!r) return ctx.fillRect(x, y, w, h);
    for (var j = 0; j < h; j++) {
      var ins = cornerInset(j, h, r);
      ctx.fillRect(x + ins, y + j, w - ins * 2, 1);
    }
  }

  // fill (optional) paints the inside of the frame
  function strokeRoundRect(ctx, x, y, w, h, r, lw, color, fill) {
    ctx.fillStyle = color;
    var ri = Math.max(0, r - lw);
    for (var j = 0; j < h; j++) {
      var o = cornerInset(j, h, r);
      var jj = j - lw;
      if (jj < 0 || jj >= h - lw * 2) {
        ctx.fillRect(x + o, y + j, w - o * 2, 1);
        continue;
      }
      var i = lw + cornerInset(jj, h - lw * 2, ri);
      ctx.fillRect(x + o, y + j, i - o, 1);
      ctx.fillRect(x + w - i, y + j, i - o, 1);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x + i, y + j, w - i * 2, 1);
        ctx.fillStyle = color;
      }
    }
  }

  // --- time digits: TimeStyle font outlines (fctx) -----------------------
  //
  // fctx draws with or without antialiasing (a widget option). Without it,
  // a pixel is filled if its center lies inside the outline, as in fctx.
  // The time is centered on the outline bounds, not on glyph advances:
  // glyphs have different side bearings.

  var pathCache = {};
  var boxCache = {};

  function clockFont(key) {
    return root.PebbleFonts[key] ? key : 'avenir';
  }

  function glyphPath(key, ch) {
    var pk = key + ':' + ch;
    if (!(pk in pathCache)) {
      var g = root.PebbleFonts[key].glyphs[ch];
      pathCache[pk] = g && g.d ? new Path2D(g.d) : null;
    }
    return pathCache[pk];
  }

  // Glyph outline bounds in font units (y up); measured once by
  // rasterizing at a large scale
  function glyphBox(key, ch) {
    var bk = key + ':' + ch;
    if (bk in boxCache) return boxCache[bk];
    var p = glyphPath(key, ch);
    var box = null;
    if (p) {
      var S = 4, ox = 16 * S, oy = 72 * S, size = 104 * S;
      var cv = document.createElement('canvas');
      cv.width = cv.height = size;
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.translate(ox, oy);
      ctx.scale(S, -S);
      ctx.fill(p);
      var d = ctx.getImageData(0, 0, size, size).data;
      var minX = size, maxX = -1, minY = size, maxY = -1;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (d[(y * size + x) * 4 + 3] < 128) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX >= 0) {
        box = { x0: (minX - ox) / S, x1: (maxX + 1 - ox) / S, top: (oy - minY) / S, bottom: (oy - maxY - 1) / S };
      }
    }
    boxCache[bk] = box;
    return box;
  }

  // Ink bounds of a line at em = 1: x0 is from the line start, top is above
  // the baseline, w and h are the size
  function clockInk(str, key) {
    key = clockFont(key);
    var f = root.PebbleFonts[key];
    var pen = 0, x0 = Infinity, x1 = -Infinity, top = -Infinity, bottom = Infinity;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var g = f.glyphs[ch];
      if (!g) continue;
      var b = glyphBox(key, ch);
      if (b) {
        x0 = Math.min(x0, pen + b.x0);
        x1 = Math.max(x1, pen + b.x1);
        top = Math.max(top, b.top);
        bottom = Math.min(bottom, b.bottom);
      }
      pen += g.adv;
    }
    if (x0 === Infinity) return { x0: 0, top: 0, w: 0, h: 0 };
    return { x0: x0 / f.upem, top: top / f.upem, w: (x1 - x0) / f.upem, h: (top - bottom) / f.upem };
  }

  // Where to draw each glyph of the line. left, top is the top-left corner of
  // the whole line's ink; the first hide glyphs take up space but are not drawn
  // (so a hidden leading zero keeps the digit where it sits in "08").
  function clockPlacements(str, key, em, left, top, hide) {
    var f = root.PebbleFonts[key];
    var ink = clockInk(str, key);
    var s = em / f.upem;
    var pen = left - ink.x0 * em;
    var baseline = top + ink.top * em;
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var g = f.glyphs[ch];
      if (!g) continue;
      var p = glyphPath(key, ch);
      if (p && i >= (hide || 0)) out.push({ path: p, box: glyphBox(key, ch), x: pen, y: baseline, s: s });
      pen += g.adv * s;
    }
    return out;
  }

  // Without antialiasing, like fctx_end_fill_bw: a pixel is filled if its center
  // is inside the outline. The result is cached, since the time changes once a minute.
  var bwCache = {};

  function clockMaskBW(w, h, list, color, cacheKey) {
    if (bwCache[cacheKey]) return bwCache[cacheKey];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, w);
    cv.height = Math.max(1, h);
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(cv.width, cv.height);
    var rgb = hexRgb(color);
    list.forEach(function (it) {
      if (!it.box) return;
      var x0 = Math.max(0, Math.floor(it.x + it.box.x0 * it.s));
      var x1 = Math.min(cv.width - 1, Math.ceil(it.x + it.box.x1 * it.s));
      var y0 = Math.max(0, Math.floor(it.y - it.box.top * it.s));
      var y1 = Math.min(cv.height - 1, Math.ceil(it.y - it.box.bottom * it.s));
      for (var py = y0; py <= y1; py++) {
        var gy = -(py + 0.5 - it.y) / it.s;
        for (var px = x0; px <= x1; px++) {
          if (!ctx.isPointInPath(it.path, (px + 0.5 - it.x) / it.s, gy)) continue;
          var i = (py * cv.width + px) * 4;
          img.data[i] = rgb[0];
          img.data[i + 1] = rgb[1];
          img.data[i + 2] = rgb[2];
          img.data[i + 3] = 255;
        }
      }
    });
    ctx.putImageData(img, 0, 0);
    var keys = Object.keys(bwCache);
    if (keys.length > 20) delete bwCache[keys[0]];
    bwCache[cacheKey] = cv;
    return cv;
  }

  // left, top is the top-left corner of the line's ink in block pixels
  function drawClock(ctx, w, h, str, key, em, left, top, color, aa, hide) {
    key = clockFont(key);
    var list = clockPlacements(str, key, em, left, top, hide);
    if (aa) {
      ctx.fillStyle = color;
      list.forEach(function (it) {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.scale(it.s, -it.s);
        ctx.fill(it.path);
        ctx.restore();
      });
      return;
    }
    var cacheKey = [w, h, str, key, em, left, top, color, hide || 0].join('|');
    ctx.drawImage(clockMaskBW(w, h, list, color, cacheKey), 0, 0);
  }

  // --- drawing object for a block --------------------------------------

  function makeG(ctx, w, h, iconFill) {
    var g = {
      ctx: ctx,
      w: w,
      h: h,
      iconFill: iconFill,

      measure: measure,

      // Left edge of content of width cw, respecting the block alignment
      ax: function (cw) {
        var pad = 4;
        if (g.align === 'left') return pad;
        if (g.align === 'right') return Math.floor(w - pad - cw);
        return Math.floor((w - cw) / 2);
      },

      inkHeight: function (str, size, bold) {
        return ink(str, size, bold).h;
      },

      // The largest font in which the line fits into maxW×maxH
      // (by actual glyph height). Fonts lacking the needed characters are skipped.
      fit: function (str, maxW, maxH, bold) {
        str = str || 'X';
        var best = TEXT_SIZES[0];
        for (var i = 0; i < TEXT_SIZES.length; i++) {
          var s = TEXT_SIZES[i];
          if (!covers(fontKey(s, bold), str)) continue;
          if (ink(str, s, bold).h <= maxH && measure(str, s, bold) <= maxW) best = s;
        }
        return best;
      },

      // Nearest font size not larger than px
      snap: function (px) {
        var best = TEXT_SIZES[0];
        for (var i = 0; i < TEXT_SIZES.length; i++) {
          if (TEXT_SIZES[i] <= px) best = TEXT_SIZES[i];
        }
        return best;
      },

      text: function (str, x, y, size, color, o) {
        drawText(ctx, str, x, y, size, color, o);
      },

      iconSize: iconSize,

      // fill defaults to the block's icon fill color
      icon: function (name, x, y, size, color, fill) {
        drawIcon(ctx, name, x, y, size, color, fill || g.iconFill);
      },

      battery: function (x, y, size, color, level) {
        drawBattery(ctx, x, y, size, color, g.iconFill, level);
      },

      rect: function (x, y, rw, rh, color) {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(rw), Math.round(rh));
      },

      // Non-antialiased line (Bresenham); width is a square "brush"
      line: function (x0, y0, x1, y1, color, width) {
        var wd = width || 1, off = Math.floor((wd - 1) / 2);
        var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
        ctx.fillStyle = color;
        for (;;) {
          ctx.fillRect(x0 - off, y0 - off, wd, wd);
          if (x0 === x1 && y0 === y1) break;
          var e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      },

      frame: function (x, y, rw, rh, color, lw, r, fill) {
        strokeRoundRect(ctx, Math.round(x), Math.round(y), Math.round(rw), Math.round(rh), r || 0, lw, color, fill);
      },

      clockInk: clockInk,

      clock: function (str, key, em, left, top, color, aa, hide) {
        drawClock(ctx, w, h, str, key, em, Math.round(left), Math.round(top), color, aa, hide);
      }
    };
    g.fitInk = g.fit;
    return g;
  }

  // --- whole screen ----------------------------------------------------

  // iconFill: icon fill, the block's own or the theme's; if neither is set,
  // the block background (the icon looks outlined, as in TimeStyle on a
  // black panel)
  function blockColors(b, theme) {
    var bg = b.bg || theme.tile || theme.bg;
    return {
      bg: bg,
      fg: b.fg || theme.fg,
      accent: b.accent || theme.accent,
      iconFill: b.iconFill || theme.iconFill || bg
    };
  }

  // s = {blocks (layout.js, screen pixels), theme, general, now}
  function drawScreen(canvas, s) {
    var font = s.theme.font || 'gothic';
    if (font !== 'gothic' && !familyFonts(font)) {
      // Gothic until the family is loaded, then the screen is drawn again
      loadFamily(font, function () { drawScreen(canvas, s); });
      font = 'gothic';
    }
    family = font;
    try {
      drawBlocks(canvas, s);
    } finally {
      family = 'gothic';
    }
  }

  function drawBlocks(canvas, s) {
    var W = root.Widgets;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var now = s.now || new Date();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = s.theme.bg;
    ctx.fillRect(0, 0, W.SCREEN.w, W.SCREEN.h);

    s.blocks.forEach(function (b) {
      var px = W.blockPixels(b, s.theme.gap);
      if (px.w <= 0 || px.h <= 0) return;
      var c = blockColors(b, s.theme);

      ctx.save();
      if (c.bg !== s.theme.bg) fillRoundRect(ctx, px.x, px.y, px.w, px.h, s.theme.radius, c.bg);
      ctx.beginPath();
      ctx.rect(px.x, px.y, px.w, px.h);
      ctx.clip();
      ctx.translate(px.x, px.y);
      try {
        var opts = W.resolveOpts(b.widget, b.opts);
        var g = makeG(ctx, px.w, px.h, c.iconFill);
        g.align = opts.align || 'center';
        W.get(b.widget).render({
          g: g,
          w: px.w, h: px.h,
          opts: opts,
          c: c, now: now, L: W.LANG, mock: W.MOCK,
          metric: s.general.metric, clock12: !s.general.clock24, labels: s.theme.labels !== false
        });
      } catch (err) {
        console.error('Widget preview error', b.widget, err);
      }
      ctx.restore();
    });

    if (s.theme.lineOn) drawBlockLines(ctx, s.blocks, s.theme);

    quantize(ctx, W.SCREEN.w, W.SCREEN.h);
  }

  // Lines along inner block borders (none along the screen edge). A border
  // is where two blocks meet, so with a gap between blocks the line runs
  // through its middle. Dashes and dots are counted from the screen origin so
  // that the strokes of adjacent segments line up.
  function drawBlockLines(ctx, blocks, t) {
    var S = root.Widgets.SCREEN;
    var lw = Number(t.lineWidth) || 1;
    var shift = -Math.floor(lw / 2);
    var style = t.lineStyle || 'solid';
    var on = style === 'dashed' ? 4 * lw : lw;
    var period = style === 'dashed' ? 6 * lw : 2 * lw;
    ctx.fillStyle = t.lineColor || t.fg;

    // segment along the axis from from to to (exclusive) at cross coordinate at
    function span(from, to, at, horiz) {
      var p = from;
      while (p < to) {
        var len;
        if (style === 'solid') {
          len = to - p;
        } else {
          var phase = p % period;
          if (phase >= on) {
            p += period - phase;
            continue;
          }
          len = Math.min(on - phase, to - p);
        }
        if (horiz) ctx.fillRect(p, at + shift, len, lw);
        else ctx.fillRect(at + shift, p, lw, len);
        p += len;
      }
    }

    // every inner border is the right or bottom side of some block
    blocks.forEach(function (b) {
      if (b.x + b.w < S.w) span(b.y, b.y + b.h, b.x + b.w, false);
      if (b.y + b.h < S.h) span(b.x, b.x + b.w, b.y + b.h, true);
    });
  }

  // Line width in the firmware font (for checks on the page)
  function textWidth(str, size, bold) {
    return measure(str, size, bold);
  }

  root.Raster = {
    drawScreen: drawScreen,
    textWidth: textWidth,
    blockColors: blockColors,
    unsupported: unsupported,
    quantize: quantize
  };
})(this);
