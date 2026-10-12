/*
 * Layout grid model.
 *
 * The screen is divided into COLS×ROWS cells. A layout is an array of blocks
 * {id, x, y, w, h, widget, opts, bg, fg, accent, iconFill} that cover
 * every cell exactly once. Merging and splitting always
 * preserve this invariant.
 */
(function (root) {
  'use strict';

  var COLS = 4;
  var ROWS = 4;

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

  function makeEmpty() {
    var blocks = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        blocks.push(makeBlock(x, y, 1, 1));
      }
    }
    return blocks;
  }

  function sortBlocks(blocks) {
    return blocks.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
  }

  function rectOf(b) {
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  function rectFromCells(x1, y1, x2, y2) {
    var x = Math.min(x1, x2);
    var y = Math.min(y1, y2);
    return { x: x, y: y, w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 };
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

  function blockAt(blocks, cx, cy) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h) return b;
    }
    return null;
  }

  function findById(blocks, id) {
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) return blocks[i];
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

  // Splits a block into 1×1 cells. The widget stays in the top-left one
  // if it fits there: the caller decides via fits(widget, cellRect).
  function split(blocks, id, fits) {
    var target = findById(blocks, id);
    if (!target || target.w * target.h === 1) return { blocks: blocks, first: target };

    var rest = blocks.filter(function (b) { return b !== target; });
    var first = null;
    for (var y = target.y; y < target.y + target.h; y++) {
      for (var x = target.x; x < target.x + target.w; x++) {
        var isFirst = first === null;
        var keep = isFirst && (!fits || fits(target.widget, { x: target.x, y: target.y, w: 1, h: 1 }));
        var cell = makeBlock(x, y, 1, 1, keep ? target.widget : 'empty', {
          opts: keep ? clone(target.opts) : {},
          bg: target.bg,
          fg: target.fg,
          accent: target.accent,
          iconFill: target.iconFill
        });
        if (isFirst) first = cell;
        rest.push(cell);
      }
    }
    return { blocks: sortBlocks(rest), first: first };
  }

  // Checks that the blocks cover the grid exactly once.
  function validate(blocks) {
    var seen = new Array(COLS * ROWS);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.w < 1 || b.h < 1 || b.x < 0 || b.y < 0 ||
          b.x + b.w > COLS || b.y + b.h > ROWS) {
        return false;
      }
      for (var y = b.y; y < b.y + b.h; y++) {
        for (var x = b.x; x < b.x + b.w; x++) {
          var k = y * COLS + x;
          if (seen[k]) return false;
          seen[k] = true;
        }
      }
    }
    for (var j = 0; j < seen.length; j++) {
      if (!seen[j]) return false;
    }
    return true;
  }

  // Takes blocks from saved settings/presets and assigns fresh ids.
  function hydrate(list) {
    var blocks = list.map(function (b) {
      return makeBlock(b.x, b.y, b.w, b.h, b.widget, {
        opts: clone(b.opts || {}),
        bg: b.bg || null,
        fg: b.fg || null,
        accent: b.accent || null,
        iconFill: b.iconFill || null
      });
    });
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

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  root.Layout = {
    COLS: COLS,
    ROWS: ROWS,
    makeEmpty: makeEmpty,
    rectFromCells: rectFromCells,
    rectOf: rectOf,
    expandRect: expandRect,
    blocksInRect: blocksInRect,
    blockAt: blockAt,
    findById: findById,
    merge: merge,
    split: split,
    validate: validate,
    hydrate: hydrate,
    serialize: serialize,
    clone: clone
  };
})(this);
