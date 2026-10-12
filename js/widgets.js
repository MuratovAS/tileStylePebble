/*
 * Catalog of mini widgets and their previews.
 *
 * Each widget is described once: a stable numeric id (passed to the
 * watch side), a minimum size in pixels, a list of options and a
 * render(box) function that draws the preview on a canvas in watch pixels (raster.js).
 * The time is drawn with TimeStyle font outlines via fctx (antialiased),
 * other text with the firmware bitmap fonts, icons with prebuilt
 * fixed-size bitmaps. On-watch labels are in English: the firmware
 * fonts have no Cyrillic.
 *
 * Names, option labels and choices are the page UI: they are written in
 * English and translated by i18n.js.
 */
(function (root) {
  'use strict';

  // Pebble Time 2 (emery platform)
  var SCREEN = { w: 200, h: 228 };

  // On-watch labels. Latin only, which the firmware fonts cover.
  var LANG = {
    days: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    daysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December'],
    week: 'WK', km: 'km', mi: 'mi', meters: 'm', ft: 'ft', kcal: 'kcal', bpm: 'bpm', h: 'h', m: 'm', steps: 'steps'
  };

  // Sizes each icon is drawn in (resources/icons/<name>_<size>.png).
  // A widget picks the largest that fits; icons are never scaled.
  // The list of watch icons and their sources is in tools/icons.py.
  var ICON_SIZES = [14, 18, 25, 36, 50];

  // Mock data for the preview
  var MOCK = {
    battery: 70,
    steps: 6342,
    stepsHourly: [0, 0, 0, 0, 0, 0, 120, 840, 610, 230, 180, 420, 760, 310, 260, 540, 380, 0, 0, 0, 0, 0, 0, 0],
    distanceM: 4380,
    kcal: 312,
    heart: 72,
    sleepMin: 432,
    temp: 14,
    hi: 18,
    lo: 9,
    // weather condition -> icon weather_<condition> (TimeStyle icons)
    condition: 'partly_cloudy',
    forecastCondition: 'light_rain',
    // hourly forecast: temperature and condition for hour of day h (0–23)
    hourlyAt: function (h) {
      var temp = Math.round(11 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI));
      var conds = ['partly_cloudy', 'partly_cloudy', 'cloudy', 'light_rain', 'light_rain', 'cloudy', 'partly_cloudy', 'clear_day'];
      var cond = conds[h % conds.length];
      if (h < 6 || h >= 21) {
        if (cond === 'clear_day') cond = 'clear_night';
        if (cond === 'partly_cloudy') cond = 'partly_cloudy_night';
      }
      return { temp: temp, cond: cond };
    },
    uv: 4
  };

  // --- vector icon sources (viewBox 24×24) ----------------------------
  //
  // Used in the UI and as the source for tools/icons.py, which
  // renders them to fixed-size PNGs. The watch and the preview use the PNGs.

  var ICONS = {
    empty: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/>',
    time: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    date: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    weekday: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 14h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    battery: '<rect x="2" y="7" width="17" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="20" y="10" width="2.5" height="4" rx="1" fill="currentColor"/><rect x="4.5" y="9.5" width="9" height="5" fill="currentColor"/>',
    // battery body without fill: the widget draws the level
    battery_frame: '<rect x="2" y="7" width="17" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="20" y="10" width="2.5" height="4" rx="1" fill="currentColor"/>',
    bluetooth: '<path d="M7 7l10 10-5 5V2l5 5L7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
    steps: '<path d="M8 2.5c2 0 3 2.4 3 5.2S9.9 12 8 12 5 10.3 5 7.7 6 2.5 8 2.5zM5.8 13.5h4.4v1.7a2.2 2.2 0 0 1-4.4 0zM16 6.5c2 0 3 2.4 3 5.2S17.9 16 16 16s-3-1.7-3-4.3 1-5.2 3-5.2zm-2.2 11h4.4v1.7a2.2 2.2 0 0 1-4.4 0z" fill="currentColor"/>',
    steps_graph: '<path d="M4 20V13M9 20V7M14 20v-9M19 20V4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    distance: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/>',
    calories: '<path d="M12 2.5s5.5 4.8 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.3 1-3.9 2.2-5 0 2.2 1 3.3 2.1 3.3C10.8 6.6 12 4.6 12 2.5z" fill="currentColor"/>',
    heart: '<path d="M12 20.5s-7.4-4.5-9.4-9C1.2 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1 4.2 2.3.4.6 1.6.6 2 0 .8-1.3 2.2-2.3 4.2-2.3 3.6 0 5.6 3.7 4.2 7-2 4.5-9.4 9-9.4 9z" fill="currentColor"/>',
    sleep: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/>',
    weather: '<circle cx="8.5" cy="8.5" r="3.5" fill="currentColor"/><path d="M8.5 1.5v1.5M2.5 8.5H1M3.6 3.6l1 1M13.4 3.6l-1 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 20.5a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.8 1.4 3.5 3.5 0 0 1 .1 7H8z" fill="currentColor" stroke="var(--icon-cut, #000)" stroke-width="1.5"/>',
    forecast: '<path d="M7 19.5a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 11a4.25 4.25 0 0 1-.4 8.5H7z" fill="currentColor"/>',
    uv: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    seconds: '<circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 13.5V9.5M10 2.5h4M18.5 6.5l1.5-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    alt_tz: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    week: '<path d="M9 3L7 21M17 3l-2 18M4 8.5h17M3 15.5h17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    beats: '<text x="12" y="18" text-anchor="middle" font-size="18" font-weight="700" fill="currentColor" font-family="sans-serif">@</text>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    hourly: '<circle cx="5" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="19" cy="5" r="2" fill="currentColor"/><path d="M5 11v9M12 13v7M19 10v10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    divider: '<path d="M3 12h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M5 6h14M5 18h14" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3" opacity=".5"/>'
  };

  // Icon for the UI (widget list)
  function icon(name, size, color) {
    return '<svg class="w-ico" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" style="color:' + color + '">' + (ICONS[name] || '') + '</svg>';
  }

  // --- layout helpers --------------------------------------------------
  //
  // Widgets draw on the canvas via box.g (raster.js). Text size is the
  // firmware font size: 14, 18, 24, 28 (Gothic), 30 and 42 (Bitham).

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function textItem(g, str, size, color, bold) {
    return {
      h: g.inkHeight(str, size, bold),
      draw: function (y) { g.text(str, g.ax(g.measure(str, size, bold)), y, size, color, { bold: bold, align: 'left' }); }
    };
  }

  function iconItem(g, drawFn, size) {
    return {
      h: size,
      draw: function (y) { drawFn(g.ax(size), y, size); }
    };
  }

  // Stacks items vertically, centered in the block
  function stack(g, items, gap) {
    gap = gap === undefined ? 4 : gap;
    var total = items.reduce(function (s, it) { return s + it.h; }, 0) + gap * (items.length - 1);
    var y = Math.floor((g.h - total) / 2);
    items.forEach(function (it) {
      it.draw(y);
      y += it.h + gap;
    });
  }

  function centerText(box, str, maxH, bold) {
    var g = box.g;
    var size = g.fit(str, box.w - 8, maxH === undefined ? box.h * 0.7 : maxH, bold);
    stack(g, [textItem(g, str, size, box.c.fg, bold)]);
  }

  // Standard "icon + value (+ label)" layout: stacked in square and
  // tall blocks, in a row in wide ones.
  // drawIcon(x, y, size, color) draws the icon with its top-left corner at x,y.
  function metric(box, drawIcon, value, label) {
    var g = box.g, w = box.w, h = box.h, pad = 4;
    var fg = box.c.fg, accent = box.c.accent;

    // room for the label (14 pt) is reserved by actual glyph height
    var labH = label ? g.inkHeight(label, 14) + 4 : 0;

    if (w / h >= 1.6) {
      var ics = g.iconSize(h * 0.55);
      var fs = g.fit(value, w - ics - pad * 3, label ? h - 8 - labH : h * 0.8);
      var showL = label && g.inkHeight(value, fs) + labH <= h - 4;
      var tw = Math.max(g.measure(value, fs), showL ? g.measure(label, 14) : 0);
      var x0 = g.ax(ics + pad + tw);
      drawIcon(x0, Math.floor((h - ics) / 2), ics, accent);
      var tx = x0 + ics + pad;
      var vh = g.inkHeight(value, fs);
      var lh = showL ? g.inkHeight(label, 14) : 0;
      var ty = Math.floor((h - vh - (showL ? 4 + lh : 0)) / 2);
      g.text(value, tx, ty, fs, fg, { align: 'left' });
      if (showL) g.text(label, tx, ty + vh + 4, 14, fg, { align: 'left' });
      return;
    }

    // a 1×1 cell (50×57) fits the native TimeStyle icon size, 25 px
    var icv = g.iconSize(Math.min(w * 0.6, h * 0.45));
    var room = h - icv - pad * 3;
    var fsv = g.fit(value, w - pad * 2, Math.min(room - labH, Math.max(18, h * 0.32)));
    var items = [
      iconItem(g, function (x, y, s) { drawIcon(x, y, s, accent); }, icv),
      textItem(g, value, fsv, fg)
    ];
    if (label && g.inkHeight(value, fsv) + labH + 1 <= room) items.push(textItem(g, label, 14, fg));
    stack(g, items, 5);
  }

  function simpleIcon(box, name) {
    return function (x, y, size, color) {
      box.g.icon(name, x, y, size, color);
    };
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fmtThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // 6342 -> 6.3k, 12480 -> 12.4k, 123456 -> 123k. Rounded down so a round
  // number is not shown too early (9999 -> 9.9k, not 10k).
  function fmtK(n) {
    if (n < 1000) return String(n);
    if (n >= 100000) return Math.floor(n / 1000) + 'k';
    var v = Math.floor(n / 100) / 10;
    return (v % 1 ? v.toFixed(1) : String(v)) + 'k';
  }

  // Date from a strftime-like pattern (the watch uses the same logic):
  // %d 05 · %e 5 · %m 10 · %n 10 (no zero) · %b OCT · %B October · %a MON ·
  // %A Monday · %y 26 · %Y 2026 · %j day of year · %V ISO week · %% literal %.
  // "|" is a line break. upper means all caps, otherwise "Oct", "Mon".
  function formatDate(d, pattern, L, upper) {
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
    var y0 = new Date(d.getFullYear(), 0, 1);
    var tokens = {
      d: pad2(d.getDate()),
      e: String(d.getDate()),
      m: pad2(d.getMonth() + 1),
      n: String(d.getMonth() + 1),
      b: cap(L.months[d.getMonth()]),
      B: L.monthsLong[d.getMonth()],
      a: cap(L.days[d.getDay()]),
      A: L.daysLong[d.getDay()],
      y: pad2(d.getFullYear() % 100),
      Y: String(d.getFullYear()),
      j: String(Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - y0) / 86400000) + 1),
      V: String(isoWeek(d)),
      '%': '%'
    };
    var out = String(pattern || '').replace(/%([a-zA-Z%])/g, function (m, c) {
      return c in tokens ? tokens[c] : m;
    });
    return upper ? out.toUpperCase() : out;
  }

  // Preset date formats: option value -> pattern
  var DATE_FORMATS = [
    ['calendar', null, 'Calendar page'],
    ['e_b', '%e %b', '12 OCT'],
    ['b_e', '%b %e', 'OCT 12'],
    ['a_e_b', '%a %e %b', 'MON 12 OCT'],
    ['a_e', '%a %e', 'MON 12'],
    ['e_B', '%e %B', '12 OCTOBER'],
    ['A_e_B', '%A, %e %B', 'MONDAY, 12 OCTOBER'],
    ['B_Y', '%B %Y', 'OCTOBER 2026'],
    ['d_m', '%d.%m', '12.10'],
    ['d_m_y', '%d.%m.%y', '12.10.26'],
    ['d_m_Y', '%d.%m.%Y', '12.10.2026'],
    ['m_d', '%m/%d', '10/12'],
    ['m_d_Y', '%m/%d/%Y', '10/12/2026'],
    ['iso', '%Y-%m-%d', '2026-10-12'],
    ['2_a_eb', '%a|%e %b', 'Two lines: MON / 12 OCT'],
    ['2_e_b', '%e|%b', 'Two lines: 12 / OCT'],
    ['2_A_eB', '%A|%e %B', 'Two lines: MONDAY / 12 OCTOBER'],
    ['3_a_e_b', '%a|%e|%b', 'Three lines: MON / 12 / OCT'],
    ['custom', null, 'Custom…']
  ];
  // legacy option values from early versions
  var DATE_LEGACY = { day_month: '%e %b', numeric: '%d.%m', full: '%a %e %b' };

  function datePattern(o) {
    if (o.format === 'custom') return o.pattern;
    if (DATE_LEGACY[o.format]) return DATE_LEGACY[o.format];
    for (var i = 0; i < DATE_FORMATS.length; i++) {
      if (DATE_FORMATS[i][0] === o.format) return DATE_FORMATS[i][1];
    }
    return '%e %b';
  }

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }

  // --- catalog ---------------------------------------------------------

  var LIST = [
    {
      key: 'empty', id: 0, name: 'Empty', group: 'base',
      render: function () {}
    },
    {
      key: 'time', id: 1, name: 'Time', group: 'base', min: [36, 30],
      opts: [
        { key: 'font', type: 'select', label: 'Font', def: 'avenir',
          choices: [['avenir', 'Avenir'], ['bold', 'Avenir Bold'], ['leco', 'LECO']] },
        { key: 'stack', type: 'select', label: 'Arrangement', def: 'auto',
          choices: [['auto', 'Auto'], ['line', 'One line'], ['stack', 'Hours above minutes']] },
        { key: 'zero', type: 'toggle', label: 'Leading zero', def: true },
        { key: 'aa', type: 'toggle', label: 'Antialiasing', def: false }
      ],
      // Digits are drawn with TimeStyle font outlines via fctx; the font size
      // is an integer, as in TimeStyle. The clock as a whole is always centered in the block.
      // Its width is computed as for a two-digit hour: with a hidden leading zero
      // the size does not change, and a single digit sits within that width on the left,
      // center or right (align option).
      render: function (box) {
        var g = box.g, o = box.opts, now = box.now;
        var hh = now.getHours();
        if (box.clock12) hh = hh % 12 || 12;
        var hs = o.zero ? pad2(hh) : String(hh);
        var ms = pad2(now.getMinutes());
        var aa = o.aa === true;
        var stacked = o.stack === 'stack' || (o.stack === 'auto' && box.h > box.w * 0.75);
        // margins as in TimeStyle: h/16 top and bottom, h/20 for LECO
        var padY = Math.max(2, Math.round(box.h / (o.font === 'leco' ? 20 : 16)));
        var padX = 4;
        var slot = hs.length < 2 ? '0' + hs : hs;
        // "Right" with a hidden zero: draw "08" without the zero so the digit sits
        // exactly where it does in "08"
        var hide = hs !== slot && o.align === 'right' ? 1 : 0;
        if (hide) hs = slot;
        // left edge of a line of width lineW inside a clock of width clockW
        var place = function (lineW, clockW) {
          var left = (box.w - clockW) / 2;
          if (o.align === 'left') return left;
          if (o.align === 'right') return left + clockW - lineW;
          return left + (clockW - lineW) / 2;
        };

        if (stacked) {
          var ih = g.clockInk(hs, o.font), im = g.clockInk(ms, o.font);
          var cw = Math.max(g.clockInk(slot, o.font).w, im.w);
          var gapR = 0.12;
          var em = Math.floor(Math.min((box.h - padY * 2) / (ih.h + im.h + gapR), (box.w - padX * 2) / cw));
          var gap = Math.round(gapR * em);
          var top = Math.round((box.h - Math.round(ih.h * em) - Math.round(im.h * em) - gap) / 2);
          g.clock(hs, o.font, em, place(ih.w * em, cw * em), top, box.c.fg, aa, hide);
          g.clock(ms, o.font, em, place(im.w * em, cw * em), top + Math.round(ih.h * em) + gap, box.c.fg, aa);
          return;
        }
        var ink = g.clockInk(hs + ':' + ms, o.font);
        var full = g.clockInk(slot + ':' + ms, o.font);
        var eml = Math.floor(Math.min((box.h - padY * 2) / ink.h, (box.w - padX * 2) / full.w));
        g.clock(hs + ':' + ms, o.font, eml, place(ink.w * eml, full.w * eml), (box.h - ink.h * eml) / 2, box.c.fg, aa, hide);
      }
    },
    {
      key: 'date', id: 2, name: 'Date', group: 'base',
      opts: [
        { key: 'format', type: 'select', label: 'Format', def: 'calendar',
          choices: DATE_FORMATS.map(function (f) { return [f[0], f[2]]; }) },
        { key: 'pattern', type: 'text', label: 'Pattern', def: '%a %e %b', max: 40,
          showIf: function (o) { return o.format === 'custom'; },
          hint: '%d — 05, %e — 5, %m — 10, %b — OCT, %B — OCTOBER, %a — MON, %A — MONDAY, ' +
            '%y — 26, %Y — 2026, %j — day of year, %V — week, | — new line' },
        { key: 'upper', type: 'toggle', label: 'All caps', def: true,
          showIf: function (o) { return o.format !== 'calendar'; } }
      ],
      render: function (box) {
        var g = box.g, L = box.L, d = box.now, fg = box.c.fg, acc = box.c.accent;
        var day = String(d.getDate());
        var mon = L.months[d.getMonth()];
        var wd = L.days[d.getDay()];
        var fmt = box.opts.format;

        if (fmt === 'calendar') {
          // as in TimeStyle: weekday, day number in a frame, month
          var lbl = g.snap(Math.min(box.h * 0.16, 28));
          var bh = clamp(Math.round(box.h - g.inkHeight(wd + mon, lbl) * 2 - 14), 16, 90);
          var bw = clamp(Math.round(bh * 1.3), 24, box.w - 8);
          var dfs = g.fitInk(day, bw - 6, bh - 6);
          stack(g, [
            textItem(g, wd, lbl, fg),
            {
              h: bh,
              draw: function (y) {
                var x = g.ax(bw);
                g.frame(x, y, bw, bh, acc, 2, 3);
                g.text(day, x + bw / 2, y + Math.floor((bh - g.inkHeight(day, dfs)) / 2), dfs, fg);
              }
            },
            textItem(g, mon, lbl, fg)
          ], 3);
          return;
        }
        // pattern-based; all lines share one font, the one the longest line fits in
        var lines = formatDate(d, datePattern(box.opts), L, box.opts.upper).split('|');
        var gap = 4;
        var lineH = (box.h - 8 - gap * (lines.length - 1)) / lines.length;
        var size = Math.min.apply(null, lines.map(function (line) { return g.fit(line, box.w - 8, lineH); }));
        stack(g, lines.map(function (line) { return textItem(g, line, size, fg); }), gap);
      }
    },
    {
      key: 'weekday', id: 3, name: 'Weekday', group: 'base',
      opts: [
        { key: 'long', type: 'toggle', label: 'Full name (if it fits)', def: true }
      ],
      render: function (box) {
        var d = box.now;
        var text = box.L.days[d.getDay()];
        if (box.opts.long) {
          var full = box.L.daysLong[d.getDay()];
          if (box.g.fit(full, box.w - 8, box.h) >= 18 && box.g.measure(full, 18) <= box.w - 8) text = full;
        }
        centerText(box, text);
      }
    },
    {
      key: 'battery', id: 4, name: 'Battery', group: 'status',
      opts: [
        { key: 'style', type: 'select', label: 'Style', def: 'icon_pct',
          choices: [['icon', 'Icon'], ['icon_pct', 'Icon + %'], ['pct', '% only']] }
      ],
      render: function (box) {
        var g = box.g, lvl = box.mock.battery, st = box.opts.style;
        var draw = function (x, y, size, color) { g.battery(x, y, size, color, lvl); };
        if (st === 'icon') {
          var s = g.iconSize(Math.min(box.w, box.h) * 0.7);
          stack(g, [iconItem(g, function (x, y, sz) { draw(x, y, sz, box.c.accent); }, s)]);
          return;
        }
        if (st === 'pct') return centerText(box, lvl + '%');
        metric(box, draw, lvl + '%');
      }
    },
    {
      key: 'bluetooth', id: 5, name: 'Bluetooth', group: 'status',
      opts: [
        { key: 'only_lost', type: 'toggle', label: 'Show only when disconnected', def: true }
      ],
      render: function (box) {
        // in the preview, "only when lost" shows the disconnected icon
        var g = box.g;
        var name = box.opts.only_lost ? 'bluetooth_off' : 'bluetooth';
        var s = g.iconSize(Math.min(box.w, box.h) * 0.5);
        stack(g, [iconItem(g, function (x, y, sz) { g.icon(name, x, y, sz, box.c.accent); }, s)]);
      }
    },
    {
      key: 'steps', id: 6, name: 'Steps', group: 'health',
      opts: [
        { key: 'goal', type: 'number', label: 'Goal (0 — no bar)', def: 10000, min: 0, max: 50000, step: 500 },
        { key: 'short', type: 'toggle', label: 'Abbreviate thousands (6.3k)', def: true }
      ],
      render: function (box) {
        var v = box.mock.steps;
        var val = box.opts.short ? fmtK(v) : fmtThousands(v);
        var goal = Number(box.opts.goal) || 0;
        // reserve 7 px at the bottom for the goal bar so text does not overlap it
        var mb = box;
        if (goal > 0) {
          var g2 = Object.create(box.g);
          g2.h = box.h - 7;
          mb = Object.assign({}, box, { h: box.h - 7, g: g2 });
        }
        metric(mb, simpleIcon(mb, 'steps'), val, box.h >= 100 ? box.L.steps : '');
        if (goal > 0) {
          // goal bar: a thin track line and a 3 px thick completed part
          var bw = box.w - 12;
          box.g.rect(6, box.h - 5, bw, 1, box.c.fg);
          box.g.rect(6, box.h - 6, Math.round(bw * clamp(v / goal, 0, 1)), 3, box.c.accent);
        }
      }
    },
    {
      key: 'steps_graph', id: 7, name: 'Steps by hour', group: 'health', min: [80, 30],
      opts: [
        { key: 'from', type: 'number', label: 'Starting hour', def: 6, min: 0, max: 23, step: 1 }
      ],
      render: function (box) {
        var from = clamp(Number(box.opts.from) || 0, 0, 23);
        var data = box.mock.stepsHourly.slice(from, from + 14);
        var max = Math.max.apply(null, data.concat([1]));
        var step = Math.floor((box.w - 8) / data.length);
        var x0 = box.g.ax(step * data.length);
        var gh = box.h - 10;
        data.forEach(function (v, i) {
          var bh = Math.max(1, Math.round(gh * v / max));
          box.g.rect(x0 + i * step, 5 + gh - bh, Math.max(1, step - 2), bh, box.c.accent);
        });
      }
    },
    {
      key: 'distance', id: 8, name: 'Distance', group: 'health',
      opts: [
        { key: 'unit', type: 'select', label: 'Units', def: 'auto',
          choices: [['auto', 'As in general settings (km / miles)'], ['km', 'Kilometers'], ['m', 'Meters'],
            ['mi', 'Miles'], ['ft', 'Feet']] }
      ],
      render: function (box) {
        var m = box.mock.distanceM, L = box.L;
        var unit = box.opts.unit === 'auto' ? (box.metric ? 'km' : 'mi') : box.opts.unit;
        var conv = {
          km: [(m / 1000).toFixed(1), L.km],
          m: [fmtThousands(Math.round(m)), L.meters],
          mi: [(m / 1609.344).toFixed(1), L.mi],
          ft: [fmtThousands(Math.round(m * 3.28084)), L.ft]
        }[unit] || [(m / 1000).toFixed(1), L.km];
        metric(box, simpleIcon(box, 'distance'), conv[0], conv[1]);
      }
    },
    {
      key: 'calories', id: 9, name: 'Calories', group: 'health',
      render: function (box) {
        metric(box, simpleIcon(box, 'calories'), String(box.mock.kcal), box.L.kcal);
      }
    },
    {
      key: 'heart', id: 10, name: 'Heart rate', group: 'health',
      render: function (box) {
        metric(box, simpleIcon(box, 'heart'), String(box.mock.heart), box.L.bpm);
      }
    },
    {
      key: 'sleep', id: 11, name: 'Sleep', group: 'health',
      opts: [
        { key: 'deep', type: 'toggle', label: 'Deep sleep only', def: false }
      ],
      render: function (box) {
        var mins = box.opts.deep ? Math.round(box.mock.sleepMin * 0.35) : box.mock.sleepMin;
        var v = Math.floor(mins / 60) + box.L.h + ' ' + pad2(mins % 60) + box.L.m;
        if (box.w < 60) v = Math.floor(mins / 60) + ':' + pad2(mins % 60);
        metric(box, simpleIcon(box, 'sleep'), v);
      }
    },
    {
      key: 'weather', id: 12, name: 'Current weather', group: 'weather',
      render: function (box) {
        var t = (box.metric ? box.mock.temp : Math.round(box.mock.temp * 1.8 + 32)) + '°';
        metric(box, simpleIcon(box, 'weather_' + box.mock.condition), t);
      }
    },
    {
      key: 'forecast', id: 13, name: 'Forecast low/high', group: 'weather',
      render: function (box) {
        var g = box.g;
        var cv = function (t) { return (box.metric ? t : Math.round(t * 1.8 + 32)) + '°'; };
        if (box.w < 60) {
          var fs = g.fit('88°', box.w - 8, (box.h - 8) / 3);
          var ic = g.iconSize(box.h * 0.32);
          stack(g, [
            iconItem(g, function (x, y, s) { g.icon('weather_' + box.mock.forecastCondition, x, y, s, box.c.accent); }, ic),
            textItem(g, cv(box.mock.hi), fs, box.c.fg),
            textItem(g, cv(box.mock.lo), fs, box.c.fg)
          ], 4);
          return;
        }
        metric(box, simpleIcon(box, 'weather_' + box.mock.forecastCondition), cv(box.mock.hi) + '/' + cv(box.mock.lo));
      }
    },
    {
      key: 'uv', id: 14, name: 'UV index', group: 'weather',
      render: function (box) {
        metric(box, simpleIcon(box, 'uv'), String(box.mock.uv), 'UV');
      }
    },
    {
      key: 'seconds', id: 15, name: 'Seconds', group: 'time',
      note: 'The watch will wake up every second, which noticeably drains the battery.',
      render: function (box) {
        centerText(box, ':' + pad2(box.now.getSeconds()));
      }
    },
    {
      key: 'alt_tz', id: 16, name: 'Second time zone', group: 'time',
      opts: [
        { key: 'label', type: 'text', label: 'Label', def: 'UTC', max: 5 },
        { key: 'offset', type: 'number', label: 'UTC offset, h', def: 0, min: -12, max: 14, step: 0.5 }
      ],
      render: function (box) {
        var g = box.g;
        var off = Number(box.opts.offset) || 0;
        var t = new Date(box.now.getTime() + box.now.getTimezoneOffset() * 60000 + off * 3600000);
        var hh = t.getHours();
        if (box.clock12) hh = hh % 12 || 12;
        var v = hh + ':' + pad2(t.getMinutes());
        var lbl = String(box.opts.label || '').toUpperCase();
        var items = [];
        if (lbl) items.push(textItem(g, lbl, Math.min(18, g.fit(lbl, box.w - 6, 18)), box.c.accent, true));
        items.push(textItem(g, v, g.fit(v, box.w - 8, box.h * 0.45), box.c.fg));
        stack(g, items, 5);
      }
    },
    {
      key: 'week', id: 17, name: 'Week number', group: 'time',
      render: function (box) {
        var g = box.g;
        var n = String(isoWeek(box.now));
        stack(g, [
          textItem(g, box.L.week, 14, box.c.accent, true),
          textItem(g, n, g.fit(n, box.w - 8, box.h * 0.5), box.c.fg)
        ], 5);
      }
    },
    {
      key: 'beats', id: 18, name: 'Swatch .beat', group: 'time',
      render: function (box) {
        var d = box.now;
        var secs = (d.getUTCHours() + 1) * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
        centerText(box, '@' + String(Math.floor((secs % 86400) / 86.4)).padStart(3, '0'));
      }
    },
    {
      key: 'text', id: 19, name: 'Custom text', group: 'other',
      opts: [
        { key: 'value', type: 'text', label: 'Text', def: 'Hello', max: 20 }
      ],
      render: function (box) {
        var v = String(box.opts.value || '');
        if (v) centerText(box, v);
      }
    },
    {
      key: 'hourly', id: 20, name: 'Hourly forecast', group: 'weather', min: [56, 30],
      opts: [
        { key: 'style', type: 'select', label: 'Style', def: 'columns',
          choices: [['columns', 'Columns: hour, icon, temperature'], ['graph', 'Temperature graph']] },
        { key: 'step', type: 'select', label: 'Step', def: '1',
          choices: [['1', '1 hour'], ['2', '2 hours'], ['3', '3 hours']] },
        { key: 'count', type: 'number', label: 'Hours to show (0 — as many as fit)', def: 0, min: 0, max: 12, step: 1 }
      ],
      render: function (box) {
        var g = box.g, o = box.opts, fg = box.c.fg, acc = box.c.accent;
        var graph = o.style === 'graph';
        var step = Number(o.step) || 1;
        // a column is no narrower than the hour label and temperature need
        var fit = Math.max(1, Math.floor((box.w - 8) / (graph ? 20 : 24)));
        var n = Math.min(12, Number(o.count) > 0 ? Math.min(Number(o.count), fit) : fit);
        var colW = Math.floor((box.w - 8) / n);
        var x0 = g.ax(colW * n);
        var cx = function (i) { return x0 + colW * i + colW / 2; };

        var first = box.now.getHours() + 1;
        var items = [];
        for (var i = 0; i < n; i++) {
          var hr = (first + i * step) % 24;
          var d = box.mock.hourlyAt(hr);
          var t = box.metric ? d.temp : Math.round(d.temp * 1.8 + 32);
          items.push({
            hour: box.clock12 ? (hr % 12 || 12) + (hr < 12 ? 'a' : 'p') : String(hr),
            t: t,
            temp: t + '°',
            cond: d.cond
          });
        }

        var hh = g.inkHeight('0123456789', 14);
        var ts = box.h >= 90 && colW >= 30 ? 18 : 14;
        var th = g.inkHeight('0123456789°', ts);

        if (graph) {
          // temperatures on top, hours at the bottom, a line between them
          var top = 3, bottom = box.h - 3 - hh;
          var gTop = top + th + 5, gBot = bottom - 5;
          var lo = Math.min.apply(null, items.map(function (it) { return it.t; }));
          var hi = Math.max.apply(null, items.map(function (it) { return it.t; }));
          var py = function (t) { return Math.round(gBot - (hi === lo ? 0.5 : (t - lo) / (hi - lo)) * (gBot - gTop)); };
          items.forEach(function (it, k) {
            var x = Math.round(cx(k));
            if (k) g.line(Math.round(cx(k - 1)), py(items[k - 1].t), x, py(it.t), acc, 1);
            g.text(it.temp, x, top, ts, fg);
            g.text(it.hour, x, bottom, 14, fg);
          });
          items.forEach(function (it, k) {
            g.rect(Math.round(cx(k)) - 1, py(it.t) - 1, 3, 3, acc);
          });
          return;
        }

        // columns: hour, icon (if it fits), temperature
        var room = box.h - hh - th - 10;
        var ic = room >= 14 ? g.iconSize(Math.min(colW - 2, room)) : 0;
        var total = hh + 3 + (ic ? ic + 3 : 0) + th;
        var y = Math.floor((box.h - total) / 2);
        items.forEach(function (it, k) {
          var x = cx(k);
          g.text(it.hour, x, y, 14, fg);
          if (ic) g.icon('weather_' + it.cond, Math.round(x - ic / 2), y + hh + 3, ic, acc);
          g.text(it.temp, x, y + hh + 3 + (ic ? ic + 3 : 0), ts, fg);
        });
      }
    },
    {
      key: 'divider', id: 21, name: 'Divider', group: 'other', min: [4, 4],
      opts: [
        { key: 'orient', type: 'seg', label: 'Direction', def: 'auto',
          choices: [['auto', 'Auto'], ['h', 'Horiz.'], ['v', 'Vert.']] },
        { key: 'style', type: 'seg', label: 'Line', def: 'solid',
          choices: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
        { key: 'width', type: 'seg', label: 'Thickness', def: '1',
          choices: [['1', '1 px'], ['2', '2 px'], ['3', '3 px']] },
        { key: 'inset', type: 'number', label: 'Edge inset, px', def: 4, min: 0, max: 40, step: 1 }
      ],
      // An accent-colored line centered in the block. "Auto" runs along the longer side.
      render: function (box) {
        var o = box.opts, g = box.g;
        var horiz = o.orient === 'h' || (o.orient !== 'v' && box.w >= box.h);
        var t = Number(o.width) || 1;
        var inset = clamp(Number(o.inset) || 0, 0, 40);
        var len = (horiz ? box.w : box.h) - inset * 2;
        if (len <= 0) return;
        var across = Math.floor(((horiz ? box.h : box.w) - t) / 2);
        // dashed: 4t dash, 2t gap; dotted: t square, t gap
        var on = o.style === 'dashed' ? 4 * t : t;
        var period = o.style === 'dashed' ? 6 * t : 2 * t;
        for (var p = 0; p < len; p += o.style === 'solid' ? len : period) {
          var seg = o.style === 'solid' ? len : Math.min(on, len - p);
          if (horiz) g.rect(inset + p, across, seg, t, box.c.accent);
          else g.rect(across, inset + p, t, seg, box.c.accent);
        }
      }
    }
  ];

  var GROUPS = [
    ['base', 'Basics'],
    ['time', 'Time'],
    ['status', 'Status'],
    ['health', 'Health'],
    ['weather', 'Weather'],
    ['other', 'Other']
  ];

  // Horizontal alignment is a common option for all widgets: it shifts
  // block content to an edge or the center. For the time it means something else, see above.
  var ALIGN_OPT = { key: 'align', type: 'seg', label: 'Alignment', def: 'center',
    choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] };
  LIST.forEach(function (w) {
    if (w.key === 'empty' || w.key === 'divider') return;
    // for the time, alignment applies inside the clock, not the block
    var opt = w.key === 'time' ? Object.assign({}, ALIGN_OPT, { label: 'Digit alignment' }) : ALIGN_OPT;
    w.opts = (w.opts || []).concat([opt]);
  });

  var BY_KEY = {};
  LIST.forEach(function (w) { BY_KEY[w.key] = w; });

  function get(key) {
    return BY_KEY[key] || BY_KEY.empty;
  }

  // Minimum block size in pixels if the widget does not specify its own
  var DEFAULT_MIN = [20, 20];

  function minSize(key) {
    return get(key).min || DEFAULT_MIN;
  }

  // w, h is the block size in pixels
  function fits(key, w, h) {
    var m = minSize(key);
    return w >= m[0] && h >= m[1];
  }

  // Block options with defaults filled in
  function resolveOpts(key, opts) {
    var out = {};
    (get(key).opts || []).forEach(function (o) {
      out[o.key] = opts && opts[o.key] !== undefined ? opts[o.key] : o.def;
    });
    return out;
  }

  // --- grid proportions ------------------------------------------------
  //
  // grid = {cols: [widths], rows: [heights]} in pixels; the sums always
  // equal the screen width and height, and no track is narrower than MIN_TRACK.

  var MIN_TRACK = 20;

  function splitEven(total, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(Math.floor(total * (i + 1) / n) - Math.floor(total * i / n));
    }
    return out;
  }

  function equalGrid(cols, rows) {
    return { cols: splitEven(SCREEN.w, cols), rows: splitEven(SCREEN.h, rows) };
  }

  function tracksValid(arr, n, total) {
    if (!Array.isArray(arr) || arr.length !== n) return false;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      if (arr[i] !== Math.round(arr[i]) || arr[i] < MIN_TRACK) return false;
      sum += arr[i];
    }
    return sum === total;
  }

  function normalizeGrid(g, cols, rows) {
    var eq = equalGrid(cols, rows);
    if (!g) return eq;
    return {
      cols: tracksValid(g.cols, cols, SCREEN.w) ? g.cols.slice() : eq.cols,
      rows: tracksValid(g.rows, rows, SCREEN.h) ? g.rows.slice() : eq.rows
    };
  }

  // [50, 50, 50, 50] -> [0, 50, 100, 150, 200]
  function offsets(arr) {
    var out = [0];
    for (var i = 0; i < arr.length; i++) out.push(out[i] + arr[i]);
    return out;
  }

  // Moves divider i (between tracks i-1 and i) to position pos
  function moveDivider(arr, i, pos) {
    var off = offsets(arr);
    var p = Math.round(Math.max(off[i - 1] + MIN_TRACK, Math.min(off[i + 1] - MIN_TRACK, pos)));
    var out = arr.slice();
    out[i - 1] = p - off[i - 1];
    out[i] = off[i + 1] - p;
    return out;
  }

  // Block pixel bounds, accounting for grid proportions and the gap
  function blockPixels(b, gap, grid) {
    var ox = offsets(grid.cols);
    var oy = offsets(grid.rows);
    var cols = grid.cols.length, rows = grid.rows.length;
    var x0 = ox[b.x], x1 = ox[b.x + b.w];
    var y0 = oy[b.y], y1 = oy[b.y + b.h];
    var half = gap / 2;
    var l = b.x === 0 ? 0 : half;
    var r = b.x + b.w === cols ? 0 : half;
    var t = b.y === 0 ? 0 : half;
    var bt = b.y + b.h === rows ? 0 : half;
    return { x: x0 + l, y: y0 + t, w: x1 - x0 - l - r, h: y1 - y0 - t - bt };
  }

  // --- Pebble palette: 64 colors, 2 bits per channel --------------------

  var LEVELS = ['00', '55', 'AA', 'FF'];
  var PALETTE = [];
  for (var r = 0; r < 4; r++) {
    for (var g = 0; g < 4; g++) {
      for (var b = 0; b < 4; b++) {
        PALETTE.push('#' + LEVELS[r] + LEVELS[g] + LEVELS[b]);
      }
    }
  }

  // GColor8: 0b11rrggbb
  function toGColor8(hex) {
    var n = parseInt(hex.slice(1), 16);
    var rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
    return 0xC0 | (Math.round(rr / 85) << 4) | (Math.round(gg / 85) << 2) | Math.round(bb / 85);
  }

  root.Widgets = {
    SCREEN: SCREEN,
    LANG: LANG,
    ICON_SIZES: ICON_SIZES,
    MOCK: MOCK,
    LIST: LIST,
    GROUPS: GROUPS,
    PALETTE: PALETTE,
    MIN_TRACK: MIN_TRACK,
    ICONS: ICONS,
    get: get,
    fits: fits,
    minSize: minSize,
    icon: icon,
    resolveOpts: resolveOpts,
    equalGrid: equalGrid,
    normalizeGrid: normalizeGrid,
    offsets: offsets,
    moveDivider: moveDivider,
    blockPixels: blockPixels,
    formatDate: formatDate,
    fmtK: fmtK,
    datePattern: datePattern,
    toGColor8: toGColor8
  };
})(this);
