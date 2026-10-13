/*
 * Layout model.
 *
 * A layout is an array of blocks {id, x, y, w, h, widget, opts, bg, fg,
 * accent, iconFill}: rectangles in screen pixels that tile the 200×228
 * screen, every pixel covered exactly once, no side shorter than MIN.
 * Merging, splitting and moving an edge always preserve this invariant.
 *
 * Saved settings before version 2 (and the built-in presets) describe
 * blocks in the cells of a 4×4 grid with column widths and row heights
 * {cols, rows}; fromSaved() turns them into pixels.
 */
(function (root) {
  'use strict';

  var SCREEN = { w: 200, h: 228 };
  var MIN = 20;          // shortest block side, px
  var MAX_BLOCKS = 16;   // CONFIG_MAX_BLOCKS in src/c/protocol.h
  var GRID_N = 4;        // cells per side of the old grid

  var nextId = 1;
  function uid() {
    return 'b' + (nextId++);
  }

  function makeBlock(x, y, w, h, widget, extra) {
    var b = {
      id: uid(),
      x: x, y: y, w: w, h: h,
      widget: widget || 'empty',
      opts: {},
      bg: null,
      fg: null,
      accent: null,
      iconFill: null
    };
    if (extra) {
      for (var k in extra) b[k] = extra[k];
    }
    return b;
  }

  function sortBlocks(blocks) {
    return blocks.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
  }

  function rectOf(b) {
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w &&
           a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function contains(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
           inner.x + inner.w <= outer.x + outer.w &&
           inner.y + inner.h <= outer.y + outer.h;
  }

  function union(a, b) {
    var x = Math.min(a.x, b.x);
    var y = Math.min(a.y, b.y);
    return {
      x: x, y: y,
      w: Math.max(a.x + a.w, b.x + b.w) - x,
      h: Math.max(a.y + a.h, b.y + b.h) - y
    };
  }

  // Grows the rectangle until it no longer cuts any block in two.
  function expandRect(blocks, rect) {
    var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (intersects(r, b) && !contains(r, b)) {
          r = union(r, b);
          changed = true;
        }
      }
    }
    return r;
  }

  function blocksInRect(blocks, rect) {
    return blocks.filter(function (b) {
      return contains(rect, b);
    });
  }

  // The block under a screen point
  function blockAt(blocks, px, py) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) return b;
    }
    return null;
  }

  // Merges all blocks inside rect (after growing it) into one.
  // The widget and colors come from the largest non-empty block.
  function merge(blocks, rect) {
    var r = expandRect(blocks, rect);
    var inside = blocksInRect(blocks, r);
    if (inside.length < 2) return { blocks: blocks, merged: inside[0] || null };

    var donor = inside.slice().sort(function (a, b) {
      var ae = a.widget === 'empty' ? 0 : 1;
      var be = b.widget === 'empty' ? 0 : 1;
      return (be - ae) || (b.w * b.h - a.w * a.h) || (a.y - b.y) || (a.x - b.x);
    })[0];

    var merged = makeBlock(r.x, r.y, r.w, r.h, donor.widget, {
      opts: clone(donor.opts),
      bg: donor.bg,
      fg: donor.fg,
      accent: donor.accent,
      iconFill: donor.iconFill
    });

    var rest = blocks.filter(function (b) {
      return inside.indexOf(b) === -1;
    });
    rest.push(merged);
    return { blocks: sortBlocks(rest), merged: merged };
  }

  // Whether a block can be cut in two halves side by side (vertical cut) or
  // one above the other
  function canSplit(blocks, b, vertical) {
    return blocks.length < MAX_BLOCKS && (vertical ? b.w : b.h) >= 2 * MIN;
  }

  // Cuts a block in two halves. The widget stays in the first (left or top)
  // half if it fits there: the caller decides via fits(widget, rect).
  function split(blocks, id, vertical, fits) {
    var target = findById(blocks, id);
    if (!target || !canSplit(blocks, target, vertical)) return { blocks: blocks, first: target };

    var a = rectOf(target), c = rectOf(target);
    if (vertical) {
      a.w = Math.floor(target.w / 2);
      c.x = target.x + a.w;
      c.w = target.w - a.w;
    } else {
      a.h = Math.floor(target.h / 2);
      c.y = target.y + a.h;
      c.h = target.h - a.h;
    }
    var keep = !fits || fits(target.widget, a);
    var halves = [a, c].map(function (r, i) {
      var stays = i === 0 && keep;
      return makeBlock(r.x, r.y, r.w, r.h, stays ? target.widget : 'empty', {
        opts: stays ? clone(target.opts) : {},
        bg: target.bg,
        fg: target.fg,
        accent: target.accent,
        iconFill: target.iconFill
      });
    });
    var rest = blocks.filter(function (b) { return b !== target; }).concat(halves);
    return { blocks: sortBlocks(rest), first: halves[0] };
  }

  // --- edges ------------------------------------------------------------
  //
  // An edge is a piece of the line between blocks that can move on its own:
  // starting from one block's side, it grows along the line until every block
  // touching it from either side lies within it, so moving it keeps all
  // blocks rectangular. {vertical, at, from, to, before, after}: before are
  // the blocks on the left (above), after on the right (below).

  function span(b, vertical) {
    return vertical ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
  }

  function edgeFrom(blocks, vertical, at, from, to) {
    var before, after, changed = true;
    while (changed) {
      changed = false;
      before = [];
      after = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var s = span(b, vertical);
        if (s[1] <= from || s[0] >= to) continue;
        var start = vertical ? b.x : b.y, end = start + (vertical ? b.w : b.h);
        if (end === at) before.push(b);
        else if (start === at) after.push(b);
        else continue;
        if (s[0] < from || s[1] > to) {
          from = Math.min(from, s[0]);
          to = Math.max(to, s[1]);
          changed = true;
        }
      }
    }
    return { vertical: vertical, at: at, from: from, to: to, before: before, after: after };
  }

  // Every movable edge, each once (right and bottom sides inside the screen)
  function edges(blocks) {
    var out = [], seen = {};
    blocks.forEach(function (b) {
      [true, false].forEach(function (vertical) {
        var at = vertical ? b.x + b.w : b.y + b.h;
        if (at >= (vertical ? SCREEN.w : SCREEN.h)) return;
        var s = span(b, vertical);
        var e = edgeFrom(blocks, vertical, at, s[0], s[1]);
        var key = edgeKey(e);
        if (seen[key]) return;
        seen[key] = true;
        out.push(e);
      });
    });
    return out;
  }

  function edgeKey(e) {
    return (e.vertical ? 'v' : 'h') + e.at + ':' + e.from + '-' + e.to;
  }

  // Where the edge may go: every block on both sides keeps MIN
  function edgeRange(e) {
    var lo = -Infinity, hi = Infinity;
    e.before.forEach(function (b) { lo = Math.max(lo, (e.vertical ? b.x : b.y) + MIN); });
    e.after.forEach(function (b) { hi = Math.min(hi, (e.vertical ? b.x + b.w : b.y + b.h) - MIN); });
    return [lo, hi];
  }

  // Moves an edge (found in blocks) to pos, clamped to edgeRange. Returns new
  // blocks, the moved edge's blocks replaced by resized copies.
  function moveEdge(blocks, e, pos) {
    var r = edgeRange(e);
    var p = Math.round(Math.max(r[0], Math.min(r[1], pos)));
    return blocks.map(function (b) {
      var i = e.before.indexOf(b) !== -1, j = e.after.indexOf(b) !== -1;
      if (!i && !j) return b;
      var c = Object.assign({}, b);
      if (e.vertical) {
        if (i) c.w = p - b.x;
        else { c.w = b.x + b.w - p; c.x = p; }
      } else {
        if (i) c.h = p - b.y;
        else { c.h = b.y + b.h - p; c.y = p; }
      }
      return c;
    });
  }

  // --- validation and saved settings ----------------------------------------

  // Checks that the blocks tile the screen: integers, sides >= MIN, inside the
  // screen, no overlaps, and together exactly the screen's area.
  function validate(blocks) {
    if (!blocks.length || blocks.length > MAX_BLOCKS) return false;
    var area = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if ([b.x, b.y, b.w, b.h].some(function (v) { return typeof v !== 'number' || v !== Math.round(v); })) return false;
      if (b.w < MIN || b.h < MIN || b.x < 0 || b.y < 0 || b.x + b.w > SCREEN.w || b.y + b.h > SCREEN.h) return false;
      for (var j = 0; j < i; j++) {
        if (intersects(b, blocks[j])) return false;
      }
      area += b.w * b.h;
    }
    return area === SCREEN.w * SCREEN.h;
  }

  function evenTracks(total, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(Math.floor(total * (i + 1) / n) - Math.floor(total * i / n));
    return out;
  }

  // Old grid tracks, or even ones if they are not valid
  function tracks(arr, total) {
    var ok = Array.isArray(arr) && arr.length === GRID_N && arr.every(function (v) {
      return typeof v === 'number' && v === Math.round(v) && v >= MIN;
    }) && arr.reduce(function (s, v) { return s + v; }, 0) === total;
    return ok ? arr : evenTracks(total, GRID_N);
  }

  function offsets(arr) {
    var out = [0];
    for (var i = 0; i < arr.length; i++) out.push(out[i] + arr[i]);
    return out;
  }

  // Blocks from saved settings, a user layout or a preset ({v, layout, grid}),
  // with fresh ids; null if they don't tile the screen. Before version 2
  // blocks are in grid cells.
  function fromSaved(cfg) {
    if (!cfg || !Array.isArray(cfg.layout)) return null;
    var cells = !(cfg.v >= 2);
    var g = cfg.grid || {};
    var ox = offsets(tracks(g.cols, SCREEN.w)), oy = offsets(tracks(g.rows, SCREEN.h));
    var blocks = cfg.layout.map(function (b) {
      var r = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (cells) {
        var x1 = b.x + b.w, y1 = b.y + b.h;
        if (![b.x, b.y, x1, y1].every(function (v) { return v >= 0 && v <= GRID_N && v === Math.round(v); })) return null;
        r = { x: ox[b.x], y: oy[b.y], w: ox[x1] - ox[b.x], h: oy[y1] - oy[b.y] };
      }
      return makeBlock(r.x, r.y, r.w, r.h, b.widget, {
        opts: clone(b.opts || {}),
        bg: b.bg || null,
        fg: b.fg || null,
        accent: b.accent || null,
        iconFill: b.iconFill || null
      });
    });
    if (blocks.some(function (b) { return !b; })) return null;
    return validate(blocks) ? sortBlocks(blocks) : null;
  }

  function serialize(blocks) {
    return sortBlocks(blocks.slice()).map(function (b) {
      var out = { x: b.x, y: b.y, w: b.w, h: b.h, widget: b.widget };
      if (Object.keys(b.opts).length) out.opts = clone(b.opts);
      if (b.bg) out.bg = b.bg;
      if (b.fg) out.fg = b.fg;
      if (b.accent) out.accent = b.accent;
      if (b.iconFill) out.iconFill = b.iconFill;
      return out;
    });
  }

  function findById(blocks, id) {
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) return blocks[i];
    }
    return null;
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  root.Layout = {
    SCREEN: SCREEN,
    MIN: MIN,
    MAX_BLOCKS: MAX_BLOCKS,
    GRID_N: GRID_N,
    evenTracks: evenTracks,
    rectOf: rectOf,
    union: union,
    expandRect: expandRect,
    blocksInRect: blocksInRect,
    blockAt: blockAt,
    findById: findById,
    merge: merge,
    canSplit: canSplit,
    split: split,
    edges: edges,
    edgeKey: edgeKey,
    edgeRange: edgeRange,
    moveEdge: moveEdge,
    validate: validate,
    fromSaved: fromSaved,
    serialize: serialize,
    clone: clone
  };
})(this);
