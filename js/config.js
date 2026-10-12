/*
 * Settings page: grid editor, block inspector, theme, general options.
 *
 * State: state.blocks (layout), state.grid (grid proportions in px),
 * state.theme, state.general and state.sel, the selected rectangle in cells. The selection is stored as a
 * rectangle, not a block id: ids change on merge and undo.
 */
(function () {
  'use strict';

  var W = window.Widgets;
  var Layout = window.Layout;
  var Presets = window.Presets;
  var Raster = window.Raster;

  var STORAGE_KEY = 'tilestyle.settings';
  var USER_PRESETS_KEY = 'tilestyle.presets';
  // keys from early versions, when the project was called pebbleWf
  var OLD_KEYS = [['pwf.settings', STORAGE_KEY], ['pwf.presets', USER_PRESETS_KEY]];
  var CONFIG_VERSION = 1;
  var HISTORY_LIMIT = 50;

  // Theme fields missing from old settings and from built-in layouts
  var THEME_DEFAULTS = {
    lineOn: false,      // lines between blocks
    lineWidth: 1,
    lineColor: '#FFFFFF',
    lineStyle: 'solid'  // solid | dashed | dotted
  };

  function fullTheme(t) {
    return Object.assign(clone(THEME_DEFAULTS), clone(Presets[0].theme), clone(t || {}));
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
    grid: null,
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
    state.blocks = Layout.hydrate(p.layout) || Layout.hydrate(Presets[0].layout);
    state.grid = W.normalizeGrid(p.grid, Layout.COLS, Layout.ROWS);
    if (p.theme) state.theme = fullTheme(p.theme);
  }

  function loadInitial() {
    applyPreset(Presets[0]);
    state.general = clone(DEFAULT_GENERAL);

    // pkjs may pass the current settings in ?config=, otherwise use
    // the ones saved in the webview's localStorage
    var raw = getQueryParam('config', null) || storageGet(STORAGE_KEY);
    if (!raw) return;
    try {
      var cfg = JSON.parse(raw);
      var blocks = cfg.layout && Layout.hydrate(cfg.layout);
      if (blocks) state.blocks = blocks;
      if (cfg.grid) state.grid = W.normalizeGrid(cfg.grid, Layout.COLS, Layout.ROWS);
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
      grid: clone(state.grid),
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
    return clone({ blocks: state.blocks, grid: state.grid, theme: state.theme, general: state.general, sel: state.sel });
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
    state.grid = prev.grid;
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

  function trackAt(arr, pos) {
    var off = W.offsets(arr);
    for (var i = 0; i < arr.length; i++) {
      if (pos < off[i + 1]) return i;
    }
    return arr.length - 1;
  }

  function cellFromEvent(e) {
    var p = screenPoint(e);
    return { x: trackAt(state.grid.cols, p.x), y: trackAt(state.grid.rows, p.y) };
  }

  function selectCells(a, b) {
    state.sel = Layout.expandRect(state.blocks, Layout.rectFromCells(a.x, a.y, b.x, b.y));
  }

  function bindOverlay() {
    var overlay = $('#overlay');

    overlay.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* old webviews */ }
      var c = cellFromEvent(e);
      drag = { start: c, last: c };
      selectCells(c, c);
      renderOverlay();
    });

    overlay.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var c = cellFromEvent(e);
      if (c.x === drag.last.x && c.y === drag.last.y) return;
      drag.last = c;
      selectCells(drag.start, c);
      renderOverlay();
    });

    var end = function () {
      if (!drag) return;
      drag = null;
      render();
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }

  // --- grid actions ----------------------------------------------------

  function mergeSelection() {
    if (selectedBlocks().length < 2) return;
    commit(function () {
      var res = Layout.merge(state.blocks, state.sel);
      state.blocks = res.blocks;
      state.sel = Layout.rectOf(res.merged);
    });
  }

  function splitSelection() {
    var b = selectedBlock();
    if (!b || b.w * b.h === 1) return;
    commit(function () {
      var res = Layout.split(state.blocks, b.id, function (key, cell) {
        var px = blockPx(cell);
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
    return W.blockPixels(b, state.theme.gap, state.grid);
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

  // Rectangle in cells -> CSS in screen percentages
  function rectStyle(r) {
    var ox = W.offsets(state.grid.cols), oy = W.offsets(state.grid.rows);
    return 'left:' + pct(ox[r.x], W.SCREEN.w) + ';top:' + pct(oy[r.y], W.SCREEN.h) +
      ';width:' + pct(ox[r.x + r.w] - ox[r.x], W.SCREEN.w) + ';height:' + pct(oy[r.y + r.h] - oy[r.y], W.SCREEN.h);
  }

  function renderOverlay() {
    var html = '';
    if (state.showGrid) {
      var ox = W.offsets(state.grid.cols), oy = W.offsets(state.grid.rows);
      for (var i = 1; i < Layout.COLS; i++) {
        html += '<i class="gl gl-v' + (resize && resize.axis === 'cols' && resize.i === i ? ' gl-active' : '') +
          '" style="left:' + pct(ox[i], W.SCREEN.w) + '"></i>';
      }
      for (var j = 1; j < Layout.ROWS; j++) {
        html += '<i class="gl gl-h' + (resize && resize.axis === 'rows' && resize.i === j ? ' gl-active' : '') +
          '" style="top:' + pct(oy[j], W.SCREEN.h) + '"></i>';
      }
      state.blocks.forEach(function (b) {
        var cls = b.widget === 'empty' ? ' ob-empty' : (blockFits(b) ? '' : ' ob-bad');
        html += '<div class="ob' + cls + '" style="' + rectStyle(b) + '"></div>';
      });
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

  // --- grid proportions ------------------------------------------------

  // Handles on the watch frame: top ones move column borders, left ones move rows
  function renderHandles() {
    var html = '';
    if (state.showGrid) {
      ['cols', 'rows'].forEach(function (axis) {
        var arr = state.grid[axis];
        var off = W.offsets(arr);
        var total = axis === 'cols' ? W.SCREEN.w : W.SCREEN.h;
        for (var i = 1; i < arr.length; i++) {
          var active = resize && resize.axis === axis && resize.i === i;
          html += '<button type="button" class="gh gh-' + axis + (active ? ' active' : '') + '" data-axis="' + axis +
            '" data-i="' + i + '" style="' + (axis === 'cols' ? 'left' : 'top') + ':' + pct(off[i], total) +
            '" aria-label="Граница ' + (axis === 'cols' ? 'столбцов ' : 'строк ') + i + '">' +
            (active ? '<span>' + arr[i - 1] + ' | ' + arr[i] + '</span>' : '') + '</button>';
        }
      });
    }
    $('#handles').innerHTML = html;
  }

  function bindHandles() {
    var box = $('#handles');

    box.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.gh');
      if (!h) return;
      e.preventDefault();
      try { h.setPointerCapture(e.pointerId); } catch (err) { /* old webviews */ }
      resize = { axis: h.getAttribute('data-axis'), i: Number(h.getAttribute('data-i')), before: snapshot(), changed: false };
      renderHandles();
      renderOverlay();
    });

    box.addEventListener('pointermove', function (e) {
      if (!resize) return;
      var p = screenPoint(e);
      var axis = resize.axis;
      var pos = axis === 'cols' ? p.x : p.y;
      // snap to the even grid
      var eq = W.offsets(W.equalGrid(Layout.COLS, Layout.ROWS)[axis])[resize.i];
      if (Math.abs(pos - eq) <= 3) pos = eq;
      var next = W.moveDivider(state.grid[axis], resize.i, pos);
      if (next.join() === state.grid[axis].join()) return;
      state.grid[axis] = next;
      resize.changed = true;
      renderScreen();
      renderOverlay();
      renderHandles();
      renderToolbar();
    });

    var end = function () {
      if (!resize) return;
      // the handle may have been dragged and returned; no history step needed then
      if (resize.changed && JSON.stringify(resize.before.grid) !== JSON.stringify(state.grid)) {
        history.push(resize.before);
        if (history.length > HISTORY_LIMIT) history.shift();
        coalesce = { key: null, at: 0 };
      }
      resize = null;
      render();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  function isEqualGrid() {
    var eq = W.equalGrid(Layout.COLS, Layout.ROWS);
    return eq.cols.join() === state.grid.cols.join() && eq.rows.join() === state.grid.rows.join();
  }

  function equalizeGrid() {
    if (isEqualGrid()) return;
    commit(function () { state.grid = W.equalGrid(Layout.COLS, Layout.ROWS); });
  }

  // --- inspector ------------------------------------------------------

  function swatchHTML(path, value, inheritLabel, fallback) {
    var shown = value || fallback;
    return '<button type="button" class="swatch' + (value ? '' : ' swatch-inherit') + '" data-color="' + path + '"' +
      (inheritLabel ? ' data-inherit="' + esc(inheritLabel) + '"' : '') +
      ' style="--c:' + shown + '"><span>' + (value ? value : 'тема') + '</span></button>';
  }

  function optionHTML(o, value, opts) {
    if (o.showIf && !o.showIf(opts)) return '';
    var id = 'opt-' + o.key;
    var hint = o.hint ? '<small class="opt-hint">' + esc(o.hint) + '</small>' : '';
    var ctl;
    if (o.type === 'select') {
      ctl = '<select id="' + id + '" data-opt="' + o.key + '">' + o.choices.map(function (c) {
        return '<option value="' + c[0] + '"' + (c[0] === value ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'toggle') {
      ctl = '<label class="switch"><input type="checkbox" id="' + id + '" data-opt="' + o.key + '"' +
        (value ? ' checked' : '') + '><i></i></label>';
    } else if (o.type === 'seg') {
      ctl = '<div class="seg" data-opt-seg="' + o.key + '">' + o.choices.map(function (c) {
        return '<button type="button" data-v="' + c[0] + '"' + (c[0] === value ? ' class="active"' : '') + '>' +
          esc(c[1]) + '</button>';
      }).join('') + '</div>';
      return '<div class="field field-col"><span>' + esc(o.label) + '</span>' + ctl + '</div>';
    } else if (o.type === 'number') {
      ctl = '<input type="number" id="' + id + '" data-opt="' + o.key + '" value="' + esc(value) + '" min="' + o.min +
        '" max="' + o.max + '" step="' + o.step + '" inputmode="decimal">';
    } else {
      ctl = '<input type="text" id="' + id + '" data-opt="' + o.key + '" value="' + esc(value) + '" maxlength="' + o.max + '">';
    }
    if (hint) return '<div class="field field-col"><label for="' + id + '">' + esc(o.label) + '</label>' + ctl + hint + '</div>';
    return '<div class="field"><label for="' + id + '">' + esc(o.label) + '</label>' + ctl + '</div>';
  }

  function renderInspector() {
    var el = $('#inspector');
    var sel = selectedBlocks();

    if (!sel.length) {
      el.innerHTML = '<h2>Блок</h2><p class="muted">Выберите блок на циферблате.</p>';
      return;
    }

    if (sel.length > 1) {
      el.innerHTML = '<h2>Выделено блоков: ' + sel.length + '</h2>' +
        '<p class="muted">Область ' + state.sel.w + '×' + state.sel.h + '. Объединённый блок получит виджет ' +
        'самого крупного непустого блока.</p>' +
        '<button type="button" class="btn btn-accent btn-wide" data-action="merge">Объединить в один блок</button>';
      return;
    }

    var b = sel[0];
    var def = W.get(b.widget);
    var px = blockPx(b);
    var opts = W.resolveOpts(b.widget, b.opts);

    var isEmpty = b.widget === 'empty';
    var pickBtn = '<button type="button" class="widget-btn' + (isEmpty ? ' widget-btn-empty' : '') + '" data-action="pick">' +
      W.icon(b.widget, 26, 'currentColor') +
      '<span><small>Виджет</small>' + esc(isEmpty ? 'Выбрать виджет' : def.name) + '</span><b>›</b></button>';

    var optsHTML = (def.opts || []).map(function (o) { return optionHTML(o, opts[o.key], opts); }).join('');

    var t = state.theme;
    var colors = '<div class="colors">' +
      '<div><small>Фон</small>' + swatchHTML('block.bg', b.bg, 'Как в теме', t.tile || t.bg) + '</div>' +
      '<div><small>Текст</small>' + swatchHTML('block.fg', b.fg, 'Как в теме', t.fg) + '</div>' +
      '<div><small>Акцент</small>' + swatchHTML('block.accent', b.accent, 'Как в теме', t.accent) + '</div>' +
      '</div>';

    el.innerHTML =
      '<div class="insp-head"><h2>Блок</h2><span class="tag">' + b.w + '×' + b.h + ' ячеек · ' +
        Math.round(px.w) + '×' + Math.round(px.h) + ' px</span></div>' +
      pickBtn +
      (def.note ? '<p class="note">' + esc(def.note) + '</p>' : '') +
      (blockFits(b) ? '' : '<p class="note">Блок меньше, чем нужно виджету (' + W.minSize(b.widget).join('×') +
        ' px). Увеличьте блок или измените пропорции сетки.</p>') +
      (optsHTML ? '<div class="opts">' + optsHTML + '</div>' : '') +
      '<h3>Цвета блока</h3>' + colors +
      '<div class="insp-actions">' +
        (b.w * b.h > 1 ? '<button type="button" class="btn" data-action="split">Разделить на ячейки</button>' : '') +
        (!isEmpty ? '<button type="button" class="btn" data-action="clear">Очистить</button>' : '') +
      '</div>';
  }

  function openWidgetSheet() {
    var b = selectedBlock();
    if (!b) return;
    var bpx = blockPx(b);
    $('#widgetSheetTitle').textContent = 'Виджет для блока ' + Math.round(bpx.w) + '×' + Math.round(bpx.h) + ' px';
    $('#widgetPicker').innerHTML = W.GROUPS.map(function (g) {
      var items = W.LIST.filter(function (w) { return w.group === g[0]; });
      return '<div class="wgroup"><div class="wgroup-title">' + esc(g[1]) + '</div><div class="wgrid">' +
        items.map(function (w) {
          var ok = blockFits(b, w.key);
          var m = W.minSize(w.key).join('×');
          return '<button type="button" class="wchip' + (w.key === b.widget ? ' active' : '') + '" data-widget="' + w.key + '"' +
            (ok ? '' : ' disabled title="Нужен блок от ' + m + ' px"') + '>' +
            W.icon(w.key, 20, 'currentColor') + '<span>' + esc(w.name) + '</span>' +
            (ok ? '' : '<em>от ' + m + ' px</em>') + '</button>';
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
      if (a === 'split') splitSelection();
      if (a === 'clear') {
        var b = selectedBlock();
        if (b) commit(function () { b.widget = 'empty'; b.opts = {}; b.bg = b.fg = b.accent = null; });
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
      sw.innerHTML = '<span>' + (v || (path === 'theme.iconFill' ? 'как фон блока' : 'как фон')) + '</span>';
    });
    $('#weatherLocField').hidden = state.general.weatherSource !== 'manual';
    $('#lineOpts').hidden = !state.theme.lineOn;
    var loc = $('#weatherLoc');
    if (document.activeElement !== loc && loc.value !== state.general.weatherLocation) loc.value = state.general.weatherLocation;
    var gen = state.general;
    $('#weatherCoords').textContent = gen.weatherLat !== null ? 'Координаты: ' + gen.weatherLat + ', ' + gen.weatherLon : '';
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
    if (!suggest.items.length) return showSuggest('<div class="suggest-note">Ничего не найдено</div>');
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
      encodeURIComponent((navigator.language || 'ru').slice(0, 2)) + '&q=' + encodeURIComponent(query);
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
      showSuggest('<div class="suggest-note">Не удалось получить подсказки. Проверьте подключение к интернету.</div>');
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
      showSuggest('<div class="suggest-note">Ищем…</div>');
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
    var blocks = Layout.hydrate(p.layout);
    if (!blocks) return;
    Raster.drawScreen(cv, {
      blocks: blocks,
      grid: W.normalizeGrid(p.grid, Layout.COLS, Layout.ROWS),
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
      return thumbHTML('data-preset="' + i + '"', p.name);
    }).join('');
    $$('#presets canvas').forEach(function (cv, i) { drawThumb(cv, Presets[i]); });
    renderUserPresets();
  }

  // --- my layouts (localStorage) --------------------------------------
  //
  // A layout is the design: blocks, grid proportions and theme. General settings
  // (units, weather) are not included.

  function loadUserPresets() {
    try {
      var list = JSON.parse(storageGet(USER_PRESETS_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (p) { return p && p.id && Layout.hydrate(p.layout || []); }) : [];
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
        '<button type="button" class="preset-del" data-del="' + esc(p.id) + '">Удалить</button></div>';
    }).join('');
    $$('#userPresets canvas').forEach(function (cv, i) { drawThumb(cv, list[i]); });
    $('#userPresetsNote').textContent = note || (list.length ? '' : 'Здесь появятся раскладки, которые вы сохраните.');
  }

  function findUserPreset(id) {
    return loadUserPresets().filter(function (p) { return p.id === id; })[0];
  }

  function openSaveForm() {
    var form = $('#savePresetForm');
    form.hidden = false;
    $('#savePresetBtn').hidden = true;
    var input = $('#presetName');
    input.value = 'Раскладка ' + (loadUserPresets().length + 1);
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
      var name = $('#presetName').value.trim() || 'Раскладка';
      var cfg = buildConfig();
      var list = loadUserPresets();
      list.push({
        id: Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name: name,
        layout: cfg.layout,
        grid: cfg.grid,
        theme: cfg.theme
      });
      var saved = saveUserPresets(list);
      closeSaveForm();
      renderUserPresets(saved ? '' : 'Не удалось сохранить: браузер не даёт записывать данные.');
    });

    // deletion requires a second tap to confirm
    $('#userPresets').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.textContent = 'Точно удалить?';
          setTimeout(function () {
            if (!del.isConnected) return;
            del.classList.remove('confirm');
            del.textContent = 'Удалить';
          }, 3000);
          return;
        }
        var id = del.getAttribute('data-del');
        var ok = saveUserPresets(loadUserPresets().filter(function (p) { return p.id !== id; }));
        renderUserPresets(ok ? '' : 'Не удалось удалить: браузер не даёт записывать данные.');
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
    if (keys.indexOf('time') === -1) list.push('На циферблате нет виджета времени.');
    state.blocks.forEach(function (b) {
      if (b.widget !== 'empty' && !blockFits(b)) {
        list.push('Виджет «' + W.get(b.widget).name + '» не помещается в свой блок.');
      }
    });
    state.blocks.forEach(function (b) {
      var o = W.resolveOpts(b.widget, b.opts);
      // the widget renders the time zone label in uppercase
      var str = b.widget === 'text' ? o.value : b.widget === 'alt_tz' ? String(o.label).toUpperCase()
        : b.widget === 'date' && o.format === 'custom' ? W.formatDate(new Date(), o.pattern, W.LANG, o.upper) : '';
      var bad = str ? Raster.unsupported(str) : '';
      if (bad) {
        list.push('Символов «' + bad + '» нет в шрифтах часов (виджет «' + W.get(b.widget).name +
          '») — на часах вместо них будет ▯.');
      }
    });
    state.blocks.forEach(function (b) {
      if (b.widget !== 'date') return;
      var o = W.resolveOpts(b.widget, b.opts);
      if (o.format === 'calendar') return;
      var text = W.formatDate(new Date(2026, 8, 30), W.datePattern(o), W.LANG, o.upper); // Wednesday and September are the longest names
      var room = blockPx(b).w - 8;
      var tooWide = text.split('|').some(function (line) { return Raster.textWidth(line, 14) > room; });
      if (tooWide) list.push('Дата в выбранном формате не помещается в свой блок — выберите формат короче или расширьте блок.');
    });
    if (keys.indexOf('seconds') !== -1) list.push('Секунды заметно сокращают время работы от батареи.');
    var needsWeather = keys.some(function (k) { return W.get(k).group === 'weather'; });
    if (needsWeather && state.general.weatherSource === 'off') list.push('Погода выключена в общих настройках — погодные виджеты будут пустыми.');
    if (needsWeather && state.general.weatherSource === 'manual' && state.general.weatherLat === null) {
      list.push('Выберите город для погоды из подсказок — так сохранятся его координаты.');
    }
    $('#warnings').innerHTML = list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
  }

  // --- main loop -------------------------------------------------------

  function renderToolbar() {
    var sel = selectedBlocks();
    var one = selectedBlock();
    $('#undoBtn').disabled = !history.length;
    $('#mergeBtn').disabled = sel.length < 2;
    $('#splitBtn').disabled = !one || one.w * one.h === 1;
    $('#gridEqualBtn').disabled = isEqualGrid();
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

  function init() {
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
    $('#splitBtn').addEventListener('click', splitSelection);
    $('#gridEqualBtn').addEventListener('click', equalizeGrid);
    $('#undoBtn').addEventListener('click', undo);
    $('#gridToggle').addEventListener('change', function (e) {
      state.showGrid = e.target.checked;
      renderOverlay();
      renderHandles();
    });
    $('#saveBtn').addEventListener('click', save);
    $('#cancelBtn').addEventListener('click', cancel);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheets();
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
