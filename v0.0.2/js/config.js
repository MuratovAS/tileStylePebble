/*
 * Settings page: layout editor, block inspector, theme, general options.
 *
 * State: state.blocks (layout.js: blocks in screen pixels), state.theme,
 * state.general and state.sel, the selected rectangle in pixels. The
 * selection is stored as a rectangle, not a block id: ids change on merge
 * and undo.
 */
(function () {
  'use strict';

  var W = window.Widgets;
  var Layout = window.Layout;
  var Presets = window.Presets;
  var Raster = window.Raster;
  var I18N = window.I18N;
  var tr = I18N.t;

  var STORAGE_KEY = 'tilestyle.settings';
  var USER_PRESETS_KEY = 'tilestyle.presets';
  // keys from early versions, when the project was called pebbleWf
  var OLD_KEYS = [['pwf.settings', STORAGE_KEY], ['pwf.presets', USER_PRESETS_KEY]];
  // 2: blocks in screen pixels; 1: in the cells of a 4×4 grid {cols, rows} (Layout.fromSaved)
  var CONFIG_VERSION = 2;
  var HISTORY_LIMIT = 50;

  // Theme fields missing from old settings and from built-in layouts
  var THEME_DEFAULTS = {
    lineOn: false,      // lines between blocks
    lineWidth: 1,
    lineColor: '#FFFFFF',
    lineStyle: 'solid', // solid | dashed | dotted
    labels: true,       // labels under values: steps, bpm, kcal, km, UV
    font: 'gothic'      // text font: gothic or a family of js/textfonts
  };

  // the layout used before the first config, as on the watch (src/c/settings.c)
  var DEFAULT_PRESET = Presets.filter(function (p) { return p.key === 'timestyle'; })[0];

  function fullTheme(t) {
    return Object.assign(clone(THEME_DEFAULTS), clone(DEFAULT_PRESET.theme), clone(t || {}));
  }

  var DEFAULT_GENERAL = {
    clock24: true,
    metric: true,
    btVibe: true,
    weatherSource: 'gps',
    weatherLocation: '',
    // coordinates of the place picked from suggestions; pkjs uses them to fetch weather
    weatherLat: null,
    weatherLon: null,
    weatherInterval: 30
  };

  var state = {
    blocks: null,
    theme: null,
    general: null,
    sel: null,
    showGrid: true
  };

  var history = [];
  var coalesce = { key: null, at: 0 };
  var drag = null;
  var resize = null;
  var colorTarget = null;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getQueryParam(name, def) {
    var q = window.location.search.substring(1).split('&');
    for (var i = 0; i < q.length; i++) {
      var p = q[i].split('=');
      if (decodeURIComponent(p[0]) === name) return decodeURIComponent(p.slice(1).join('='));
    }
    return def;
  }

  function storageGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }

  // false if the write failed (private mode, out of space)
  function storageSet(k, v) {
    try {
      window.localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- load and save ----------------------------------------------------

  // Migrates data from old keys to new ones (once)
  function migrateStorage() {
    OLD_KEYS.forEach(function (pair) {
      var old = storageGet(pair[0]);
      if (old === null) return;
      if (storageGet(pair[1]) === null) storageSet(pair[1], old);
      try { window.localStorage.removeItem(pair[0]); } catch (e) { /* private mode */ }
    });
  }

  function applyPreset(p) {
    state.blocks = Layout.fromSaved(p) || Layout.fromSaved(DEFAULT_PRESET);
    if (p.theme) state.theme = fullTheme(p.theme);
  }

  function loadInitial() {
    applyPreset(DEFAULT_PRESET);
    state.general = clone(DEFAULT_GENERAL);

    // pkjs may pass the current settings in ?config=, otherwise use
    // the ones saved in the webview's localStorage
    var raw = getQueryParam('config', null) || storageGet(STORAGE_KEY);
    if (!raw) return;
    try {
      var cfg = JSON.parse(raw);
      var blocks = Layout.fromSaved(cfg);
      if (blocks) state.blocks = blocks;
      if (cfg.theme) state.theme = fullTheme(cfg.theme);
      if (cfg.general) {
        // take only known fields: old versions may have saved extra ones
        Object.keys(DEFAULT_GENERAL).forEach(function (k) {
          var d = DEFAULT_GENERAL[k], v = cfg.general[k];
          var okType = d === null ? (v === null || typeof v === 'number') : typeof v === typeof d;
          if (v !== undefined && okType) state.general[k] = v;
        });
      }
    } catch (e) {
      console.warn('Failed to read saved settings', e);
    }
  }

  function buildConfig() {
    return {
      v: CONFIG_VERSION,
      layout: Layout.serialize(state.blocks).map(function (b) {
        var opts = W.resolveOpts(b.widget, b.opts);
        if (Object.keys(opts).length) b.opts = opts; else delete b.opts;
        return b;
      }),
      theme: clone(state.theme),
      general: clone(state.general)
    };
  }

  function save() {
    var json = JSON.stringify(buildConfig());
    storageSet(STORAGE_KEY, json);
    var returnTo = getQueryParam('return_to', 'pebblejs://close#');
    document.location.href = returnTo + encodeURIComponent(json);
  }

  function cancel() {
    document.location.href = getQueryParam('return_to', 'pebblejs://close');
  }

  // --- history and changes --------------------------------------------

  function snapshot() {
    return clone({ blocks: state.blocks, theme: state.theme, general: state.general, sel: state.sel });
  }

  // Every change goes through commit so it can be undone.
  // Consecutive edits of the same field (typing) are merged into one step.
  function pushHistory() {
    history.push(snapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function commit(fn, opts) {
    opts = opts || {};
    var now = Date.now();
    var same = opts.coalesce && coalesce.key === opts.coalesce && now - coalesce.at < 1500;
    if (!same) pushHistory();
    coalesce = { key: opts.coalesce || null, at: now };
    fn();
    render(opts.soft);
  }

  function undo() {
    var prev = history.pop();
    if (!prev) return;
    state.blocks = prev.blocks;
    state.theme = prev.theme;
    state.general = prev.general;
    state.sel = prev.sel ? Layout.expandRect(state.blocks, prev.sel) : null;
    coalesce = { key: null, at: 0 };
    render();
  }

  function getPath(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, state);
  }

  function setPath(path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var obj = keys.reduce(function (o, k) { return o[k]; }, state);
    obj[last] = coerce(obj[last], value);
  }

  // Converts a string from the DOM to the type of the current value
  function coerce(current, value) {
    if (typeof value !== 'string') return value;
    if (typeof current === 'number') return Number(value);
    if (typeof current === 'boolean') return value === 'true';
    return value;
  }

  // --- selection -------------------------------------------------------

  function selectedBlocks() {
    return state.sel ? Layout.blocksInRect(state.blocks, state.sel) : [];
  }

  function selectedBlock() {
    var s = selectedBlocks();
    return s.length === 1 ? s[0] : null;
  }

  // Pointer position in watch screen pixels
  function screenPoint(e) {
    var r = $('#screenWrap').getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * W.SCREEN.w,
      y: (e.clientY - r.top) / r.height * W.SCREEN.h
    };
  }

  // The block under the pointer (the nearest one at the screen edge)
  function blockFromEvent(e) {
    var p = screenPoint(e);
    var x = Math.max(0, Math.min(W.SCREEN.w - 1, p.x)), y = Math.max(0, Math.min(W.SCREEN.h - 1, p.y));
    return Layout.blockAt(state.blocks, x, y);
  }

  // Selects the blocks between two blocks (and whatever that area cuts)
  function selectBetween(a, b) {
    state.sel = Layout.expandRect(state.blocks, Layout.union(a, b));
  }

  function bindOverlay() {
    var overlay = $('#overlay');

    overlay.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* old webviews */ }
      var b = blockFromEvent(e);
      if (!b) return;
      drag = { start: b, last: b, prev: state.sel };
      selectBetween(b, b);
      renderOverlay();
    });

    overlay.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var b = blockFromEvent(e);
      if (!b || b === drag.last) return;
      drag.last = b;
      selectBetween(drag.start, b);
      renderOverlay();
    });

    var end = function () {
      if (!drag) return;
      // a plain click on the already selected area clears the selection
      var p = drag.prev, s = state.sel;
      if (drag.last === drag.start && p && s &&
          p.x === s.x && p.y === s.y && p.w === s.w && p.h === s.h) {
        state.sel = null;
      }
      drag = null;
      render();
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }

  // --- layout actions --------------------------------------------------

  function mergeSelection() {
    if (selectedBlocks().length < 2) return;
    commit(function () {
      var res = Layout.merge(state.blocks, state.sel);
      state.blocks = res.blocks;
      state.sel = Layout.rectOf(res.merged);
    });
  }

  // vertical: into left and right halves, else top and bottom
  function splitSelection(vertical) {
    var b = selectedBlock();
    if (!b || !Layout.canSplit(state.blocks, b, vertical)) return;
    commit(function () {
      var res = Layout.split(state.blocks, b.id, vertical, function (key, half) {
        var px = blockPx(half);
        return W.fits(key, px.w, px.h);
      });
      state.blocks = res.blocks;
      state.sel = Layout.rectOf(res.first);
    });
  }

  function setWidget(key) {
    var b = selectedBlock();
    if (!b || b.widget === key || !blockFits(b, key)) return;
    commit(function () {
      b.widget = key;
      b.opts = {};
    });
  }

  // --- screen rendering -----------------------------------------------

  function blockPx(b) {
    return W.blockPixels(b, state.theme.gap);
  }

  function blockFits(b, key) {
    var px = blockPx(b);
    return W.fits(key || b.widget, px.w, px.h);
  }

  function renderScreen() {
    Raster.drawScreen($('#screen'), state);
  }

  function pct(v, total) {
    return (v / total * 100) + '%';
  }

  // Rectangle in screen pixels -> CSS in screen percentages
  function rectStyle(r) {
    return 'left:' + pct(r.x, W.SCREEN.w) + ';top:' + pct(r.y, W.SCREEN.h) +
      ';width:' + pct(r.w, W.SCREEN.w) + ';height:' + pct(r.h, W.SCREEN.h);
  }

  function renderOverlay() {
    var html = '';
    if (state.showGrid) {
      state.blocks.forEach(function (b) {
        var cls = b.widget === 'empty' ? ' ob-empty' : (blockFits(b) ? '' : ' ob-bad');
        html += '<div class="ob' + cls + '" style="' + rectStyle(b) + '"></div>';
      });
      if (resize) {
        var e = resize.edge;
        html += '<i class="gl gl-active gl-' + (e.vertical ? 'v' : 'h') + '" style="' + (e.vertical
          ? 'left:' + pct(resize.pos, W.SCREEN.w) + ';top:' + pct(e.from, W.SCREEN.h) + ';height:' + pct(e.to - e.from, W.SCREEN.h)
          : 'top:' + pct(resize.pos, W.SCREEN.h) + ';left:' + pct(e.from, W.SCREEN.w) + ';width:' + pct(e.to - e.from, W.SCREEN.w)) +
          '"></i>';
      }
    }
    if (state.sel) {
      var n = selectedBlocks().length;
      html += '<div class="osel' + (n > 1 ? ' osel-multi' : '') + '" style="' + rectStyle(state.sel) + '">' +
        (n > 1 ? '<span>' + state.sel.w + '×' + state.sel.h + '</span>' : '') + '</div>';
    }
    $('#overlay').innerHTML = html;
  }

  // Picks a zoom so that one watch pixel covers a whole number of
  // physical screen pixels, so all pixels are the same size
  function fitWatch() {
    var dpr = window.devicePixelRatio || 1;
    var avail = Math.min($('.stage').clientWidth - 48, 420);
    var device = Math.max(1, Math.floor(avail * dpr / W.SCREEN.w));
    document.documentElement.style.setProperty('--k', device / dpr);
  }

  // --- block borders -------------------------------------------------------
  //
  // A handle sits in the middle of every border piece that can move on its
  // own (Layout.edges): dragging it resizes only the blocks along that piece.

  var shownEdges = [];
  var SNAP = 3;  // px

  // Sizes on both sides of the dragged border: "a | b" if it has one block
  // on each side, else its position
  function edgeLabel(blocks, e) {
    var before = blocks.filter(function (b) { return e.before.some(function (o) { return o.id === b.id; }); });
    var after = blocks.filter(function (b) { return e.after.some(function (o) { return o.id === b.id; }); });
    var dim = e.vertical ? 'w' : 'h';
    if (before.length === 1 && after.length === 1) return before[0][dim] + ' | ' + after[0][dim];
    return (e.vertical ? 'x ' : 'y ') + resize.pos;
  }

  function renderHandles() {
    var html = '';
    if (state.showGrid) {
      shownEdges = resize ? [resize.edge] : Layout.edges(state.blocks);
      shownEdges.forEach(function (e, i) {
        var at = resize ? resize.pos : e.at, mid = (e.from + e.to) / 2;
        var x = e.vertical ? at : mid, y = e.vertical ? mid : at;
        html += '<button type="button" class="gh gh-' + (e.vertical ? 'v' : 'h') + (resize ? ' active' : '') +
          '" data-edge="' + i + '" style="left:' + pct(x, W.SCREEN.w) + ';top:' + pct(y, W.SCREEN.h) +
          '" aria-label="' + esc(tr(e.vertical ? 'Border between blocks, x {at}' : 'Border between blocks, y {at}', { at: at })) +
          '">' + (resize ? '<span>' + esc(edgeLabel(state.blocks, e)) + '</span>' : '') + '</button>';
      });
    }
    $('#handles').innerHTML = html;
  }

  // The nearest snap line within SNAP px: the even 4×4 grid and the borders
  // of the other blocks, so blocks are easy to line up again
  function snapPos(pos, edge, blocks) {
    var total = edge.vertical ? W.SCREEN.w : W.SCREEN.h;
    var lines = [];
    var even = Layout.evenTracks(total, Layout.GRID_N);
    for (var i = 0, o = 0; i < even.length - 1; i++) lines.push(o += even[i]);
    blocks.forEach(function (b) {
      if (edge.before.indexOf(b) !== -1 || edge.after.indexOf(b) !== -1) return;
      lines.push(edge.vertical ? b.x : b.y, edge.vertical ? b.x + b.w : b.y + b.h);
    });
    var best = pos, dist = SNAP + 1;
    lines.forEach(function (l) {
      if (Math.abs(l - pos) < dist) { best = l; dist = Math.abs(l - pos); }
    });
    return best;
  }

  // A drag is followed on the document, not on the handle: renderHandles()
  // replaces the handle on every move, which drops its pointer capture, and
  // a release outside the handles would then be missed, leaving the drag on.
  function bindHandles() {
    var box = $('#handles');

    box.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.gh');
      if (!h || resize) return;
      e.preventDefault();
      var edge = shownEdges[Number(h.getAttribute('data-edge'))];
      if (!edge) return;
      resize = { edge: edge, blocks: state.blocks, pos: edge.at, before: snapshot(), changed: false, pointer: e.pointerId,
                 selIds: selectedBlocks().map(function (b) { return b.id; }) };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
      renderHandles();
      renderOverlay();
    });

    function move(e) {
      if (!resize || e.pointerId !== resize.pointer) return;
      // released where no pointerup reached the page (outside the window)
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) return end(e);
      var p = screenPoint(e);
      var edge = resize.edge;
      var range = Layout.edgeRange(edge);
      var pos = snapPos(edge.vertical ? p.x : p.y, edge, resize.blocks);
      pos = Math.round(Math.max(range[0], Math.min(range[1], pos)));
      if (pos === resize.pos) return;
      resize.pos = pos;
      state.blocks = Layout.moveEdge(resize.blocks, edge, pos);
      // the selection follows its blocks
      var sel = state.blocks.filter(function (b) { return resize.selIds.indexOf(b.id) !== -1; });
      state.sel = sel.length ? sel.reduce(function (r, b) { return Layout.union(r, b); }, Layout.rectOf(sel[0])) : null;
      resize.changed = true;
      renderScreen();
      renderOverlay();
      renderHandles();
      renderToolbar();
    }

    function end(e) {
      if (!resize || e.pointerId !== resize.pointer) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      // the handle may have been dragged and returned; no history step needed then
      if (resize.changed && resize.pos !== resize.edge.at) {
        history.push(resize.before);
        if (history.length > HISTORY_LIMIT) history.shift();
        coalesce = { key: null, at: 0 };
      }
      resize = null;
      render();
    }
  }

  // --- inspector ------------------------------------------------------

  function swatchHTML(path, value, inheritLabel, fallback) {
    var shown = value || fallback;
    return '<button type="button" class="swatch' + (value ? '' : ' swatch-inherit') + '" data-color="' + path + '"' +
      (inheritLabel ? ' data-inherit="' + esc(inheritLabel) + '"' : '') +
      ' style="--c:' + shown + '"><span>' + (value ? value : esc(tr('theme'))) + '</span></button>';
  }

  function optionHTML(o, value, opts) {
    if (o.showIf && !o.showIf(opts)) return '';
    var id = 'opt-' + o.key;
    var hint = o.hint ? '<small class="opt-hint">' + esc(tr(o.hint)) + '</small>' : '';
    var label = esc(tr(o.label));
    var ctl;
    if (o.type === 'select') {
      ctl = '<select id="' + id + '" data-opt="' + o.key + '">' + o.choices.map(function (c) {
        return '<option value="' + c[0] + '"' + (c[0] === value ? ' selected' : '') + '>' + esc(tr(c[1])) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'toggle') {
      ctl = '<label class="switch"><input type="checkbox" id="' + id + '" data-opt="' + o.key + '"' +
        (value ? ' checked' : '') + '><i></i></label>';
    } else if (o.type === 'seg') {
      ctl = '<div class="seg" data-opt-seg="' + o.key + '">' + o.choices.map(function (c) {
        return '<button type="button" data-v="' + c[0] + '"' + (c[0] === value ? ' class="active"' : '') + '>' +
          esc(tr(c[1])) + '</button>';
      }).join('') + '</div>';
      return '<div class="field field-col"><span>' + label + '</span>' + ctl + '</div>';
    } else if (o.type === 'number') {
      ctl = '<input type="number" id="' + id + '" data-opt="' + o.key + '" value="' + esc(value) + '" min="' + o.min +
        '" max="' + o.max + '" step="' + o.step + '" inputmode="decimal">';
    } else {
      ctl = '<input type="text" id="' + id + '" data-opt="' + o.key + '" value="' + esc(value) + '" maxlength="' + o.max + '">';
    }
    if (hint) return '<div class="field field-col"><label for="' + id + '">' + label + '</label>' + ctl + hint + '</div>';
    return '<div class="field"><label for="' + id + '">' + label + '</label>' + ctl + '</div>';
  }

  function renderInspector() {
    var el = $('#inspector');
    var sel = selectedBlocks();

    if (!sel.length) {
      el.innerHTML = '<h2>' + esc(tr('Block')) + '</h2><p class="muted">' + esc(tr('Select a block on the watch face.')) + '</p>';
      return;
    }

    if (sel.length > 1) {
      el.innerHTML = '<h2>' + esc(tr('Blocks selected: {n}', { n: sel.length })) + '</h2>' +
        '<p class="muted">' + esc(tr('Area {w}×{h} px. The merged block gets the widget of the largest non-empty block.',
          { w: state.sel.w, h: state.sel.h })) + '</p>' +
        '<button type="button" class="btn btn-accent btn-wide" data-action="merge">' + esc(tr('Merge into one block')) + '</button>';
      return;
    }

    var b = sel[0];
    var def = W.get(b.widget);
    var px = blockPx(b);
    var opts = W.resolveOpts(b.widget, b.opts);

    var isEmpty = b.widget === 'empty';
    var pickBtn = '<button type="button" class="widget-btn' + (isEmpty ? ' widget-btn-empty' : '') + '" data-action="pick">' +
      W.icon(b.widget, 26, 'currentColor') +
      '<span><small>' + esc(tr('Widget')) + '</small>' + esc(tr(isEmpty ? 'Pick a widget' : def.name)) + '</span><b>›</b></button>';

    var optsHTML = (def.opts || []).map(function (o) { return optionHTML(o, opts[o.key], opts); }).join('');

    var t = state.theme;
    var inherit = tr('Same as theme');
    var colors = '<div class="colors">' +
      '<div><small>' + esc(tr('Background')) + '</small>' + swatchHTML('block.bg', b.bg, inherit, t.tile || t.bg) + '</div>' +
      '<div><small>' + esc(tr('Text')) + '</small>' + swatchHTML('block.fg', b.fg, inherit, t.fg) + '</div>' +
      '<div><small>' + esc(tr('Accent')) + '</small>' + swatchHTML('block.accent', b.accent, inherit, t.accent) + '</div>' +
      '<div><small>' + esc(tr('Icon fill')) + '</small>' +
        swatchHTML('block.iconFill', b.iconFill, inherit, t.iconFill || b.bg || t.tile || t.bg) + '</div>' +
      '</div>';

    el.innerHTML =
      '<div class="insp-head"><h2>' + esc(tr('Block')) + '</h2><span class="tag">' +
        esc(tr('{w}×{h} px', { w: Math.round(px.w), h: Math.round(px.h) })) + '</span></div>' +
      pickBtn +
      (def.note ? '<p class="note">' + esc(tr(def.note)) + '</p>' : '') +
      (blockFits(b) ? '' : '<p class="note">' + esc(tr(
        'The block is smaller than the widget needs ({min} px). Make the block bigger: drag its borders or merge it with a neighbor.',
        { min: W.minSize(b.widget).join('×') })) + '</p>') +
      (optsHTML ? '<div class="opts">' + optsHTML + '</div>' : '') +
      '<h3>' + esc(tr('Block colors')) + '</h3>' + colors +
      '<div class="insp-actions">' +
        (Layout.canSplit(state.blocks, b, true) ? '<button type="button" class="btn" data-action="split-v">' +
          esc(tr('Split left and right')) + '</button>' : '') +
        (Layout.canSplit(state.blocks, b, false) ? '<button type="button" class="btn" data-action="split-h">' +
          esc(tr('Split top and bottom')) + '</button>' : '') +
        (!isEmpty ? '<button type="button" class="btn" data-action="clear">' + esc(tr('Clear')) + '</button>' : '') +
      '</div>';
  }

  function openWidgetSheet() {
    var b = selectedBlock();
    if (!b) return;
    var bpx = blockPx(b);
    $('#widgetSheetTitle').textContent = tr('Widget for a {w}×{h} px block', { w: Math.round(bpx.w), h: Math.round(bpx.h) });
    $('#widgetPicker').innerHTML = W.GROUPS.map(function (g) {
      var items = W.LIST.filter(function (w) { return w.group === g[0]; });
      return '<div class="wgroup"><div class="wgroup-title">' + esc(tr(g[1])) + '</div><div class="wgrid">' +
        items.map(function (w) {
          var ok = blockFits(b, w.key);
          var m = W.minSize(w.key).join('×');
          return '<button type="button" class="wchip' + (w.key === b.widget ? ' active' : '') + '" data-widget="' + w.key + '"' +
            (ok ? '' : ' disabled title="' + esc(tr('Needs a block of at least {min} px', { min: m })) + '"') + '>' +
            W.icon(w.key, 20, 'currentColor') + '<span>' + esc(tr(w.name)) + '</span>' +
            (ok ? '' : '<em>' + esc(tr('min {min} px', { min: m })) + '</em>') + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    $('#widgetSheet').hidden = false;
  }

  function bindInspector() {
    var el = $('#inspector');

    $('#widgetPicker').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-widget]');
      if (!chip || chip.disabled) return;
      setWidget(chip.getAttribute('data-widget'));
      closeSheets();
    });

    el.addEventListener('click', function (e) {
      var segBtn = e.target.closest('[data-opt-seg] button');
      var sb = selectedBlock();
      if (segBtn && sb) {
        var key = segBtn.parentNode.getAttribute('data-opt-seg');
        var v = segBtn.getAttribute('data-v');
        if (W.resolveOpts(sb.widget, sb.opts)[key] !== v) commit(function () { sb.opts[key] = v; });
        return;
      }
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var a = act.getAttribute('data-action');
      if (a === 'pick') openWidgetSheet();
      if (a === 'merge') mergeSelection();
      if (a === 'split-v') splitSelection(true);
      if (a === 'split-h') splitSelection(false);
      if (a === 'clear') {
        var b = selectedBlock();
        if (b) commit(function () { b.widget = 'empty'; b.opts = {}; b.bg = b.fg = b.accent = b.iconFill = null; });
      }
    });

    var onOpt = function (e) {
      var input = e.target.closest('[data-opt]');
      var b = selectedBlock();
      if (!input || !b) return;
      var key = input.getAttribute('data-opt');
      var value;
      if (input.type === 'checkbox') value = input.checked;
      else if (input.type === 'number') {
        if (input.value === '' || isNaN(Number(input.value))) return;
        value = Number(input.value);
      } else value = input.value;
      var isTyping = e.type === 'input';
      commit(function () { b.opts[key] = value; }, { coalesce: b.id + ':' + key, soft: isTyping });
    };
    el.addEventListener('change', function (e) {
      // text and numbers are already applied on input; change is for select/checkbox
      var t = e.target.type;
      if (t === 'text' || t === 'number') return;
      onOpt(e);
    });
    el.addEventListener('input', function (e) {
      var t = e.target.type;
      if (t === 'text' || t === 'number') onOpt(e);
    });
  }

  // --- theme and general ---------------------------------------------------

  function renderBindings() {
    $$('.seg[data-bind]').forEach(function (seg) {
      var v = String(getPath(seg.getAttribute('data-bind')));
      $$('button', seg).forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-v') === v);
      });
    });
    $$('input[type=checkbox][data-bind]').forEach(function (inp) {
      inp.checked = !!getPath(inp.getAttribute('data-bind'));
    });
    $$('select[data-bind], input[type=text][data-bind]').forEach(function (inp) {
      var v = String(getPath(inp.getAttribute('data-bind')));
      if (inp.value !== v && document.activeElement !== inp) inp.value = v;
    });
    $$('.panels > .panel .swatch[data-color^="theme."]').forEach(function (sw) {
      var path = sw.getAttribute('data-color');
      var v = getPath(path);
      sw.classList.toggle('swatch-inherit', !v);
      sw.style.setProperty('--c', v || state.theme.bg);
      sw.innerHTML = '<span>' + (v || esc(tr(path === 'theme.iconFill' ? 'same as block' : 'same as screen'))) + '</span>';
    });
    $('#weatherLocField').hidden = state.general.weatherSource !== 'manual';
    $('#lineOpts').hidden = !state.theme.lineOn;
    var loc = $('#weatherLoc');
    if (document.activeElement !== loc && loc.value !== state.general.weatherLocation) loc.value = state.general.weatherLocation;
    var gen = state.general;
    $('#weatherCoords').textContent = gen.weatherLat !== null ? tr('Coordinates: {lat}, {lon}', { lat: gen.weatherLat, lon: gen.weatherLon }) : '';
  }

  function bindSettings() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg[data-bind] button');
      if (!btn) return;
      var path = btn.parentNode.getAttribute('data-bind');
      commit(function () { setPath(path, btn.getAttribute('data-v')); });
    });
    $$('input[type=checkbox][data-bind], select[data-bind]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var path = inp.getAttribute('data-bind');
        commit(function () { setPath(path, inp.type === 'checkbox' ? inp.checked : inp.value); });
      });
    });
    $$('input[type=text][data-bind]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var path = inp.getAttribute('data-bind');
        commit(function () { setPath(path, inp.value); }, { coalesce: path, soft: true });
      });
    });
  }

  // --- location suggestions ---------------------------------------------
  //
  // As in TimeStyle: OpenStreetMap search (Nominatim). The service policy allows
  // at most one request per second, so we wait a second after typing.

  var GEOCODER = 'https://nominatim.openstreetmap.org/search';
  var SETTLEMENTS = ['city', 'town', 'village', 'hamlet', 'suburb', 'municipality'];
  var suggest = { timer: null, seq: 0, items: [], active: -1 };

  function showSuggest(html) {
    var box = $('#weatherSuggest');
    box.innerHTML = html;
    box.hidden = !html;
    $('#weatherLoc').setAttribute('aria-expanded', html ? 'true' : 'false');
  }

  // Keep duplicate names (a city and a region of the same name) only once,
  // preferring the settlement
  function dedupe(items) {
    var byName = {};
    var order = [];
    items.forEach(function (it) {
      var prev = byName[it.display_name];
      if (!prev) {
        byName[it.display_name] = it;
        order.push(it.display_name);
      } else if (SETTLEMENTS.indexOf(it.addresstype) !== -1 && SETTLEMENTS.indexOf(prev.addresstype) === -1) {
        byName[it.display_name] = it;
      }
    });
    return order.map(function (n) { return byName[n]; });
  }

  function renderSuggestions() {
    if (!suggest.items.length) return showSuggest('<div class="suggest-note">' + esc(tr('Nothing found')) + '</div>');
    showSuggest(suggest.items.map(function (it, i) {
      var name = it.name || it.display_name.split(',')[0];
      var rest = it.display_name.indexOf(name + ', ') === 0 ? it.display_name.slice(name.length + 2) : it.display_name;
      return '<button type="button" role="option" data-i="' + i + '"' + (i === suggest.active ? ' class="active"' : '') + '>' +
        '<b>' + esc(name) + '</b><span>' + esc(rest) + '</span></button>';
    }).join(''));
  }

  function search(query) {
    var seq = ++suggest.seq;
    var url = GEOCODER + '?format=json&addressdetails=1&limit=6&accept-language=' +
      encodeURIComponent(I18N.lang) + '&q=' + encodeURIComponent(query);
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (seq !== suggest.seq) return; // response to a stale request
      suggest.items = dedupe(data).slice(0, 5);
      suggest.active = -1;
      renderSuggestions();
    }).catch(function () {
      if (seq !== suggest.seq) return;
      showSuggest('<div class="suggest-note">' + esc(tr('Couldn’t load suggestions. Check your internet connection.')) + '</div>');
    });
  }

  function choosePlace(it) {
    commit(function () {
      state.general.weatherLocation = it.display_name;
      state.general.weatherLat = Math.round(Number(it.lat) * 10000) / 10000;
      state.general.weatherLon = Math.round(Number(it.lon) * 10000) / 10000;
    });
    $('#weatherLoc').value = it.display_name;
    suggest.items = [];
    suggest.seq++;
    showSuggest('');
  }

  function bindLocation() {
    var input = $('#weatherLoc');

    input.addEventListener('input', function () {
      var q = input.value;
      // text changed, so the old coordinates no longer apply
      commit(function () {
        state.general.weatherLocation = q;
        state.general.weatherLat = null;
        state.general.weatherLon = null;
      }, { coalesce: 'weatherLocation', soft: true });

      clearTimeout(suggest.timer);
      suggest.seq++;
      if (q.trim().length < 3) return showSuggest('');
      showSuggest('<div class="suggest-note">' + esc(tr('Searching…')) + '</div>');
      suggest.timer = setTimeout(function () { search(q.trim()); }, 1000);
    });

    input.addEventListener('keydown', function (e) {
      var n = suggest.items.length;
      if ($('#weatherSuggest').hidden || !n) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        suggest.active = (suggest.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        renderSuggestions();
      } else if (e.key === 'Enter' && suggest.active >= 0) {
        e.preventDefault();
        choosePlace(suggest.items[suggest.active]);
      } else if (e.key === 'Escape') {
        showSuggest('');
      }
    });

    // mousedown, not click: otherwise the field loses focus and the list closes too early
    $('#weatherSuggest').addEventListener('mousedown', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      e.preventDefault();
      choosePlace(suggest.items[Number(b.getAttribute('data-i'))]);
    });

    input.addEventListener('blur', function () {
      setTimeout(function () { showSuggest(''); }, 150);
    });
  }

  // --- color picker ----------------------------------------------------

  // Pebble palette sorted by hue to make it easy to browse
  function sortedPalette() {
    return W.PALETTE.map(function (hex) {
      var n = parseInt(hex.slice(1), 16);
      var r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      var hue = 0;
      if (d) {
        if (max === r) hue = ((g - b) / d + 6) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
      }
      return { hex: hex, gray: d === 0, hue: hue, light: max + min, sat: d };
    }).sort(function (a, b) {
      if (a.gray !== b.gray) return a.gray ? -1 : 1;
      if (a.gray) return a.light - b.light;
      return a.hue - b.hue || b.sat - a.sat || a.light - b.light;
    }).map(function (x) { return x.hex; });
  }

  function openColorSheet(btn) {
    var path = btn.getAttribute('data-color');
    var inheritLabel = btn.getAttribute('data-inherit');
    colorTarget = path;

    var current = readColor(path);
    $('#colorSheetTitle').textContent = btn.closest('.field, .colors > div').querySelector('span, small').textContent;
    var inh = $('#colorInherit');
    inh.hidden = !inheritLabel;
    inh.textContent = inheritLabel || '';
    inh.classList.toggle('active', !current);
    $$('#palette button').forEach(function (s) {
      s.classList.toggle('active', s.getAttribute('data-hex') === current);
    });
    $('#colorSheet').hidden = false;
  }

  function readColor(path) {
    if (path.indexOf('block.') === 0) {
      var b = selectedBlock();
      return b ? b[path.slice(6)] : null;
    }
    return getPath(path);
  }

  function writeColor(path, hex) {
    if (path.indexOf('block.') === 0) {
      var b = selectedBlock();
      if (b) commit(function () { b[path.slice(6)] = hex; });
    } else {
      commit(function () { setPath(path, hex); });
    }
  }

  function closeSheets() {
    $$('.sheet').forEach(function (sh) { sh.hidden = true; });
    colorTarget = null;
  }

  function bindColorSheet() {
    $('#palette').innerHTML = sortedPalette().map(function (hex) {
      return '<button type="button" data-hex="' + hex + '" style="background:' + hex + '" aria-label="' + hex + '"></button>';
    }).join('');

    document.addEventListener('click', function (e) {
      var sw = e.target.closest('.swatch[data-color]');
      if (sw) return openColorSheet(sw);
      if (e.target.closest('[data-close]')) return closeSheets();
    });

    $('#palette').addEventListener('click', function (e) {
      var s = e.target.closest('[data-hex]');
      if (!s || !colorTarget) return;
      writeColor(colorTarget, s.getAttribute('data-hex'));
      closeSheets();
    });

    $('#colorInherit').addEventListener('click', function () {
      if (colorTarget) writeColor(colorTarget, null);
      closeSheets();
    });
  }

  // --- presets --------------------------------------------------------

  function drawThumb(cv, p) {
    var blocks = Layout.fromSaved(p);
    if (!blocks) return;
    Raster.drawScreen(cv, {
      blocks: blocks,
      theme: fullTheme(p.theme || state.theme),
      general: state.general
    });
  }

  function thumbHTML(attr, name) {
    return '<button type="button" class="preset" ' + attr + '>' +
      '<canvas class="preset-screen" width="' + W.SCREEN.w + '" height="' + W.SCREEN.h + '"></canvas>' +
      '<span>' + esc(name) + '</span></button>';
  }

  function renderPresets() {
    $('#presets').innerHTML = Presets.map(function (p, i) {
      return thumbHTML('data-preset="' + i + '"', tr(p.name));
    }).join('');
    $$('#presets canvas').forEach(function (cv, i) { drawThumb(cv, Presets[i]); });
    renderUserPresets();
  }

  // --- my layouts (localStorage) --------------------------------------
  //
  // A layout is the design: blocks and theme. General settings
  // (units, weather) are not included.

  function loadUserPresets() {
    try {
      var list = JSON.parse(storageGet(USER_PRESETS_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (p) { return p && p.id && Layout.fromSaved(p); }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUserPresets(list) {
    return storageSet(USER_PRESETS_KEY, JSON.stringify(list));
  }

  function renderUserPresets(note) {
    var list = loadUserPresets();
    $('#userPresets').innerHTML = list.map(function (p) {
      return '<div class="preset-item">' + thumbHTML('data-user="' + esc(p.id) + '"', p.name) +
        '<button type="button" class="preset-del" data-del="' + esc(p.id) + '">' + esc(tr('Delete')) + '</button></div>';
    }).join('');
    $$('#userPresets canvas').forEach(function (cv, i) { drawThumb(cv, list[i]); });
    $('#userPresetsNote').textContent = note || (list.length ? '' : tr('Layouts you save will appear here.'));
  }

  function findUserPreset(id) {
    return loadUserPresets().filter(function (p) { return p.id === id; })[0];
  }

  function openSaveForm() {
    var form = $('#savePresetForm');
    form.hidden = false;
    $('#savePresetBtn').hidden = true;
    var input = $('#presetName');
    input.value = tr('Layout {n}', { n: loadUserPresets().length + 1 });
    input.focus();
    input.select();
  }

  function closeSaveForm() {
    $('#savePresetForm').hidden = true;
    $('#savePresetBtn').hidden = false;
  }

  function bindPresets() {
    $('#presets').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-preset]');
      if (!btn) return;
      var p = Presets[Number(btn.getAttribute('data-preset'))];
      commit(function () {
        applyPreset(p);
        state.sel = null;
      });
    });

    $('#savePresetBtn').addEventListener('click', openSaveForm);
    $('#savePresetCancel').addEventListener('click', closeSaveForm);

    $('#savePresetForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#presetName').value.trim() || tr('Layout');
      var cfg = buildConfig();
      var list = loadUserPresets();
      list.push({
        id: Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name: name,
        v: cfg.v,
        layout: cfg.layout,
        theme: cfg.theme
      });
      var saved = saveUserPresets(list);
      closeSaveForm();
      renderUserPresets(saved ? '' : tr('Couldn’t save: the browser doesn’t allow storing data.'));
    });

    // deletion requires a second tap to confirm
    $('#userPresets').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.textContent = tr('Really delete?');
          setTimeout(function () {
            if (!del.isConnected) return;
            del.classList.remove('confirm');
            del.textContent = tr('Delete');
          }, 3000);
          return;
        }
        var id = del.getAttribute('data-del');
        var ok = saveUserPresets(loadUserPresets().filter(function (p) { return p.id !== id; }));
        renderUserPresets(ok ? '' : tr('Couldn’t delete: the browser doesn’t allow storing data.'));
        return;
      }
      var btn = e.target.closest('[data-user]');
      var p = btn && findUserPreset(btn.getAttribute('data-user'));
      if (!p) return;
      commit(function () {
        applyPreset(p);
        state.sel = null;
      });
    });
  }

  // --- checks ---------------------------------------------------------

  function renderWarnings() {
    var list = [];
    var keys = state.blocks.map(function (b) { return b.widget; });
    if (keys.indexOf('time') === -1) list.push(tr('The watch face has no time widget.'));
    state.blocks.forEach(function (b) {
      if (b.widget !== 'empty' && !blockFits(b)) {
        list.push(tr('The “{name}” widget doesn’t fit its block.', { name: tr(W.get(b.widget).name) }));
      }
    });
    state.blocks.forEach(function (b) {
      var o = W.resolveOpts(b.widget, b.opts);
      // the widget renders the time zone label in uppercase
      var str = b.widget === 'text' ? o.value : b.widget === 'alt_tz' ? String(o.label).toUpperCase()
        : b.widget === 'date' && o.format === 'custom' ? W.formatDate(new Date(), o.pattern, W.LANG, o.upper) : '';
      var bad = str ? Raster.unsupported(str) : '';
      if (bad) {
        list.push(tr('The watch fonts can’t show “{chars}” (“{name}” widget); the watch will show ▯ instead.',
          { chars: bad, name: tr(W.get(b.widget).name) }));
      }
    });
    state.blocks.forEach(function (b) {
      if (b.widget !== 'date') return;
      var o = W.resolveOpts(b.widget, b.opts);
      if (o.format === 'calendar') return;
      var text = W.formatDate(new Date(2026, 8, 30), W.datePattern(o), W.LANG, o.upper); // Wednesday and September are the longest names
      var room = blockPx(b).w - 8;
      var tooWide = text.split('|').some(function (line) { return Raster.textWidth(line, 14) > room; });
      if (tooWide) list.push(tr('The date in this format doesn’t fit its block. Pick a shorter format or make the block wider.'));
    });
    if (keys.indexOf('seconds') !== -1) list.push(tr('Seconds noticeably shorten battery life.'));
    var needsWeather = keys.some(function (k) { return W.get(k).group === 'weather'; });
    if (needsWeather && state.general.weatherSource === 'off') list.push(tr('Weather is off in the general settings, so weather widgets will be empty.'));
    if (needsWeather && state.general.weatherSource === 'manual' && state.general.weatherLat === null) {
      list.push(tr('Pick the weather city from the suggestions so that its coordinates are saved.'));
    }
    $('#warnings').innerHTML = list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
  }

  // --- page language ---------------------------------------------------

  function renderLangSwitch() {
    $$('#langSwitch [data-lang]').forEach(function (btn) {
      var on = btn.getAttribute('data-lang') === I18N.lang;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function translatePage() {
    I18N.apply(document);
    renderLangSwitch();
  }

  // Only the texts are rebuilt: edits, history and the selection stay
  function setLanguage(lang) {
    if (lang === I18N.lang) return;
    I18N.setLang(lang);
    translatePage();
    renderPresets();
    render();
    if (!$('#widgetSheet').hidden) openWidgetSheet();
  }

  // --- main loop -------------------------------------------------------

  function renderToolbar() {
    var sel = selectedBlocks();
    var one = selectedBlock();
    $('#undoBtn').disabled = !history.length;
    $('#mergeBtn').disabled = sel.length < 2;
    $('#splitVBtn').disabled = !one || !Layout.canSplit(state.blocks, one, true);
    $('#splitHBtn').disabled = !one || !Layout.canSplit(state.blocks, one, false);
    $('#gridToggle').checked = state.showGrid;
  }

  // soft: don't rebuild the inspector (the user is typing in it)
  function render(soft) {
    renderScreen();
    renderOverlay();
    renderHandles();
    if (!soft) renderInspector();
    renderToolbar();
    renderBindings();
    renderWarnings();
    $('#jsonOut').textContent = JSON.stringify(buildConfig(), null, 2);
  }

  // Text font candidates (js/textfonts/index.js), after the watch's Gothic
  function fillFonts() {
    var sel = $('#fontSelect');
    (window.PebbleTextFamilies || []).forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f[0];
      opt.textContent = f[1];
      sel.appendChild(opt);
    });
  }

  function init() {
    fillFonts();
    translatePage();
    migrateStorage();
    loadInitial();
    // select the time block by default
    var timeBlock = state.blocks.filter(function (b) { return b.widget === 'time'; })[0];
    if (timeBlock) state.sel = Layout.rectOf(timeBlock);

    bindOverlay();
    bindInspector();
    bindSettings();
    bindColorSheet();
    bindPresets();
    bindHandles();
    bindLocation();

    $('#mergeBtn').addEventListener('click', mergeSelection);
    $('#splitVBtn').addEventListener('click', function () { splitSelection(true); });
    $('#splitHBtn').addEventListener('click', function () { splitSelection(false); });
    $('#undoBtn').addEventListener('click', undo);
    $('#gridToggle').addEventListener('change', function (e) {
      state.showGrid = e.target.checked;
      renderOverlay();
      renderHandles();
    });
    $('#saveBtn').addEventListener('click', save);
    $('#cancelBtn').addEventListener('click', cancel);
    $('#langSwitch').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lang]');
      if (btn) setLanguage(btn.getAttribute('data-lang'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var sheetOpen = $$('.sheet').some(function (sh) { return !sh.hidden; });
        if (sheetOpen) {
          closeSheets();
        } else if (state.sel && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
          state.sel = null;
          render();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        undo();
      }
    });

    fitWatch();
    window.addEventListener('resize', fitWatch);
    renderPresets();
    render();

    // live clock in the preview
    setInterval(renderScreen, 1000);
  }

  init();
})();
