/*
 * Built-in layouts. theme is optional: without it the user's theme
 * stays as is. So is grid (proportions in px): without it the grid is even.
 */
(function (root) {
  'use strict';

  var ORANGE = { bg: '#FF5500', fg: '#000000', accent: '#000000' };

  // Layout block; extra holds the block colors (bg, fg, accent)
  function blk(x, y, w, h, widget, opts, extra) {
    var b = { x: x, y: y, w: w, h: h, widget: widget, opts: opts || {} };
    if (extra) Object.keys(extra).forEach(function (k) { b[k] = extra[k]; });
    return b;
  }

  function side(x, y, widget, opts) {
    return { x: x, y: y, w: 1, h: 1, widget: widget, opts: opts || {},
      bg: ORANGE.bg, fg: ORANGE.fg, accent: ORANGE.accent };
  }

  root.Presets = [
    {
      key: 'timestyle',
      name: 'TimeStyle',
      grid: { cols: [53, 53, 52, 42], rows: [57, 57, 57, 57] },
      // as in TimeStyle: white icon fill, black outline (block accent)
      theme: { bg: '#000000', tile: null, fg: '#FFFFFF', accent: '#FF5500', iconFill: '#FFFFFF', gap: 0, radius: 0 },
      layout: [
        { x: 0, y: 0, w: 3, h: 4, widget: 'time', opts: { stack: 'stack', font: 'avenir' } },
        side(3, 0, 'weather'),
        side(3, 1, 'date', { format: 'calendar' }),
        side(3, 2, 'steps', { goal: 0 }),
        side(3, 3, 'battery', { style: 'icon_pct' })
      ]
    },
    {
      key: 'center',
      name: 'По центру',
      grid: { cols: [50, 50, 50, 50], rows: [44, 70, 70, 44] },
      theme: { bg: '#000000', tile: null, fg: '#FFFFFF', accent: '#55AAFF', iconFill: null, gap: 0, radius: 0 },
      layout: [
        { x: 0, y: 0, w: 2, h: 1, widget: 'weekday', opts: { long: false } },
        { x: 2, y: 0, w: 2, h: 1, widget: 'battery', opts: { style: 'icon_pct' } },
        { x: 0, y: 1, w: 4, h: 2, widget: 'time', opts: { stack: 'line', font: 'bold' } },
        { x: 0, y: 3, w: 1, h: 1, widget: 'steps', opts: { goal: 0 } },
        { x: 1, y: 3, w: 1, h: 1, widget: 'heart' },
        { x: 2, y: 3, w: 2, h: 1, widget: 'weather' }
      ]
    },
    {
      key: 'dashboard',
      name: 'Дашборд',
      theme: { bg: '#000000', tile: '#000055', fg: '#FFFFFF', accent: '#55FFFF', iconFill: null, gap: 4, radius: 8 },
      layout: [
        { x: 0, y: 0, w: 3, h: 1, widget: 'time', opts: { stack: 'line', font: 'leco' } },
        { x: 3, y: 0, w: 1, h: 1, widget: 'date', opts: { format: 'calendar' } },
        { x: 0, y: 1, w: 2, h: 2, widget: 'weather' },
        { x: 2, y: 1, w: 1, h: 1, widget: 'steps', opts: { goal: 10000 } },
        { x: 3, y: 1, w: 1, h: 1, widget: 'heart' },
        { x: 2, y: 2, w: 1, h: 1, widget: 'battery', opts: { style: 'icon_pct' } },
        { x: 3, y: 2, w: 1, h: 1, widget: 'sleep' },
        { x: 0, y: 3, w: 2, h: 1, widget: 'steps_graph', opts: { from: 6 } },
        { x: 2, y: 3, w: 1, h: 1, widget: 'alt_tz', opts: { label: 'UTC', offset: 0 } },
        { x: 3, y: 3, w: 1, h: 1, widget: 'week' }
      ]
    },
    {
      key: 'minimal',
      name: 'Минимализм',
      grid: { cols: [50, 50, 50, 50], rows: [50, 64, 64, 50] },
      theme: { bg: '#FFFFFF', tile: null, fg: '#000000', accent: '#AA0000', iconFill: null, gap: 0, radius: 0 },
      layout: [
        { x: 0, y: 0, w: 4, h: 1, widget: 'empty' },
        { x: 0, y: 1, w: 4, h: 2, widget: 'time', opts: { stack: 'line', font: 'avenir' } },
        { x: 0, y: 3, w: 4, h: 1, widget: 'date', opts: { format: 'full' } }
      ]
    },
    {
      // glowing LECO digits, dashed rule, a row of stats
      key: 'neon',
      name: 'Неон',
      grid: { cols: [50, 50, 50, 50], rows: [36, 90, 20, 82] },
      theme: { bg: '#000000', tile: null, fg: '#55FFFF', accent: '#FF55FF', iconFill: null, gap: 0, radius: 0 },
      layout: [
        blk(0, 0, 4, 1, 'date', { format: 'a_e_b' }, { fg: '#FF55FF' }),
        blk(0, 1, 4, 1, 'time', { font: 'leco', stack: 'line' }),
        blk(0, 2, 4, 1, 'divider', { style: 'dotted', width: '2', inset: 12 }),
        blk(0, 3, 1, 1, 'steps', { goal: 0 }),
        blk(1, 3, 1, 1, 'heart'),
        blk(2, 3, 1, 1, 'battery', { style: 'icon_pct' }),
        blk(3, 3, 1, 1, 'weather')
      ]
    },
    {
      // warm paper, thin rule, labels along the edges
      key: 'paper',
      name: 'Бумага',
      grid: { cols: [50, 50, 50, 50], rows: [60, 60, 20, 88] },
      theme: { bg: '#FFFFAA', tile: null, fg: '#000000', accent: '#AA5500', iconFill: '#FFFFAA', gap: 0, radius: 0 },
      layout: [
        blk(0, 0, 4, 2, 'time', { font: 'avenir', stack: 'line', aa: true }),
        blk(0, 2, 4, 1, 'divider', { inset: 16 }),
        blk(0, 3, 2, 1, 'date', { format: '2_A_eB', upper: false, align: 'left' }),
        blk(2, 3, 2, 1, 'weather', { align: 'right' })
      ]
    },
    {
      // rounded cards on black, like phone widgets
      key: 'cards',
      name: 'Карточки',
      grid: { cols: [50, 50, 50, 50], rows: [57, 57, 57, 57] },
      theme: { bg: '#000000', tile: '#555555', fg: '#FFFFFF', accent: '#FFAA00', iconFill: null, gap: 6, radius: 12 },
      layout: [
        blk(0, 0, 4, 2, 'time', { font: 'bold', stack: 'line' }, { bg: '#FFAA00', fg: '#000000' }),
        blk(0, 2, 2, 1, 'weather'),
        blk(2, 2, 2, 1, 'steps', { goal: 10000 }),
        blk(0, 3, 1, 1, 'heart'),
        blk(1, 3, 1, 1, 'battery', { style: 'icon' }),
        blk(2, 3, 2, 1, 'date', { format: 'a_e' })
      ]
    },
    {
      // green terminal: LECO, temperature chart, ISO date and .beat
      key: 'terminal',
      name: 'Терминал',
      grid: { cols: [50, 50, 50, 50], rows: [60, 60, 60, 48] },
      theme: { bg: '#000000', tile: null, fg: '#00FF00', accent: '#00AA00', iconFill: null, gap: 0, radius: 0,
        lineOn: true, lineWidth: 1, lineColor: '#00AA00', lineStyle: 'dotted' },
      layout: [
        blk(0, 0, 4, 2, 'time', { font: 'leco', stack: 'line' }),
        blk(0, 2, 4, 1, 'hourly', { style: 'graph', step: '2' }),
        blk(0, 3, 2, 1, 'date', { format: 'iso', align: 'left' }),
        blk(2, 3, 1, 1, 'beats'),
        blk(3, 3, 1, 1, 'battery', { style: 'pct', align: 'right' })
      ]
    },
    {
      // sunset stripes from top to bottom
      key: 'sunset',
      name: 'Закат',
      grid: { cols: [50, 50, 50, 50], rows: [40, 64, 64, 60] },
      theme: { bg: '#550055', tile: null, fg: '#FFFFFF', accent: '#FFAA00', iconFill: null, gap: 0, radius: 0 },
      layout: [
        blk(0, 0, 4, 1, 'date', { format: 'e_B' }, { bg: '#FFAA00', fg: '#550000' }),
        blk(0, 1, 4, 2, 'time', { font: 'bold', stack: 'line', aa: true }, { bg: '#FF5500' }),
        blk(0, 3, 4, 1, 'hourly', { step: '2', count: 5 }, { bg: '#AA0055' })
      ]
    },
    {
      // activity: large steps with goal, heart rate, calories, chart
      key: 'sport',
      name: 'Спорт',
      grid: { cols: [50, 50, 50, 50], rows: [50, 64, 64, 50] },
      theme: { bg: '#000000', tile: '#005500', fg: '#FFFFFF', accent: '#AAFF00', iconFill: null, gap: 4, radius: 8 },
      layout: [
        blk(0, 0, 3, 1, 'time', { font: 'bold', stack: 'line' }, { bg: '#000000' }),
        blk(3, 0, 1, 1, 'battery', { style: 'icon' }, { bg: '#000000' }),
        blk(0, 1, 2, 2, 'steps', { goal: 10000 }),
        blk(2, 1, 2, 1, 'heart'),
        blk(2, 2, 2, 1, 'calories'),
        blk(0, 3, 2, 1, 'steps_graph', { from: 6 }),
        blk(2, 3, 2, 1, 'distance', { unit: 'km' })
      ]
    },
    {
      // black and white halves
      key: 'contrast',
      name: 'Контраст',
      grid: { cols: [60, 60, 40, 40], rows: [57, 57, 57, 57] },
      theme: { bg: '#000000', tile: null, fg: '#FFFFFF', accent: '#FFFFFF', iconFill: '#FFFFFF', gap: 0, radius: 0 },
      layout: [
        blk(0, 0, 2, 4, 'time', { font: 'avenir', stack: 'stack', zero: false, align: 'right' }),
        blk(2, 0, 2, 1, 'weekday', { long: false }, { bg: '#FFFFFF', fg: '#000000', accent: '#000000' }),
        blk(2, 1, 2, 1, 'date', { format: '2_e_b' }, { bg: '#FFFFFF', fg: '#000000', accent: '#000000' }),
        blk(2, 2, 2, 1, 'weather', {}, { bg: '#FFFFFF', fg: '#000000', accent: '#000000' }),
        blk(2, 3, 2, 1, 'battery', { style: 'icon_pct' }, { bg: '#FFFFFF', fg: '#000000', accent: '#000000' })
      ]
    },
    {
      // world time: four cities below the main clock
      key: 'world',
      name: 'Мир',
      grid: { cols: [50, 50, 50, 50], rows: [44, 76, 64, 44] },
      theme: { bg: '#000055', tile: null, fg: '#FFFFFF', accent: '#FFAA00', iconFill: null, gap: 0, radius: 0,
        lineOn: true, lineWidth: 1, lineColor: '#5555AA', lineStyle: 'solid' },
      layout: [
        blk(0, 0, 4, 1, 'date', { format: 'A_e_B' }, { fg: '#FFAA00' }),
        blk(0, 1, 4, 1, 'time', { font: 'avenir', stack: 'line', aa: true }),
        blk(0, 2, 1, 1, 'alt_tz', { label: 'NYC', offset: -4 }),
        blk(1, 2, 1, 1, 'alt_tz', { label: 'LON', offset: 1 }),
        blk(2, 2, 1, 1, 'alt_tz', { label: 'TYO', offset: 9 }),
        blk(3, 2, 1, 1, 'alt_tz', { label: 'SYD', offset: 11 }),
        blk(0, 3, 4, 1, 'hourly', { style: 'graph', count: 6 }, { fg: '#AAAAFF', accent: '#55AAFF' })
      ]
    }
  ];
})(this);
