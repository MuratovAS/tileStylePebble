#!/usr/bin/env node
/*
 * Tests for config/js/layout.js: blocks in screen pixels, merging,
 * splitting and moving the borders between blocks.
 *
 *   node tools/test_layout.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var sb = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config/js/layout.js'), 'utf8'), sb);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config/js/presets.js'), 'utf8'), sb);
var Layout = sb.Layout;
var Presets = sb.Presets;

function plain(x) { return JSON.parse(JSON.stringify(x)); }
function rects(blocks) { return plain(blocks.map(function (b) { return [b.x, b.y, b.w, b.h]; })); }

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL ' + name + '\n  ' + (e.stack || e).toString().split('\n').slice(0, 30).join('\n  '));
    process.exitCode = 1;
  }
}

// 16 blocks of an even 4x4 grid
function evenGrid() {
  var layout = [];
  for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) layout.push({ x: x, y: y, w: 1, h: 1, widget: 'empty' });
  return Layout.fromSaved({ layout: layout });
}

function preset(key) {
  return Layout.fromSaved(Presets.filter(function (p) { return p.key === key; })[0]);
}

function edgeAt(blocks, vertical, at, from) {
  return Layout.edges(blocks).filter(function (e) {
    return e.vertical === vertical && e.at === at && e.from === from;
  })[0];
}

test('grid layouts become pixels', function () {
  assert.deepStrictEqual(rects(evenGrid()).slice(0, 5), [[0, 0, 50, 57], [50, 0, 50, 57], [100, 0, 50, 57],
    [150, 0, 50, 57], [0, 57, 50, 57]]);
  assert.deepStrictEqual(rects(preset('timestyle')), [[0, 0, 158, 228], [158, 0, 42, 57], [158, 57, 42, 57],
    [158, 114, 42, 57], [158, 171, 42, 57]]);
  Presets.forEach(function (p) { assert(Layout.fromSaved(p), p.key); });
  // pixel layouts are taken as they are
  var px = { v: 2, layout: [{ x: 0, y: 0, w: 73, h: 228, widget: 'time' }, { x: 73, y: 0, w: 127, h: 228, widget: 'empty' }] };
  assert.deepStrictEqual(rects(Layout.fromSaved(px)), [[0, 0, 73, 228], [73, 0, 127, 228]]);
});

test('validate: tiling only', function () {
  function ok(list) { return Layout.validate(list); }
  assert(ok([{ x: 0, y: 0, w: 200, h: 228 }]));
  assert(!ok([{ x: 0, y: 0, w: 200, h: 227 }]), 'hole');
  assert(!ok([{ x: 0, y: 0, w: 200, h: 228 }, { x: 0, y: 0, w: 20, h: 20 }]), 'overlap');
  assert(!ok([{ x: 0, y: 0, w: 19, h: 228 }, { x: 19, y: 0, w: 181, h: 228 }]), 'too narrow');
  assert(!ok([{ x: 0, y: 0, w: 200.5, h: 228 }]), 'fraction');
});

test('a border of an even grid moves between two blocks only', function () {
  var blocks = evenGrid();
  var edges = Layout.edges(blocks);
  assert.strictEqual(edges.length, 24);
  edges.forEach(function (e) { assert.deepStrictEqual([e.before.length, e.after.length], [1, 1]); });

  var e = edgeAt(blocks, true, 50, 0);
  var moved = Layout.moveEdge(blocks, e, 80);
  assert(Layout.validate(moved));
  var changed = moved.filter(function (b, i) { return b !== blocks[i]; });
  assert.deepStrictEqual(rects(changed), [[0, 0, 80, 57], [80, 0, 20, 57]]);
  // ids stay, so the selection can follow
  assert.strictEqual(moved[0].id, blocks[0].id);
});

test('a border takes every block along it', function () {
  var blocks = preset('timestyle');
  var e = edgeAt(blocks, true, 158, 0);
  assert.deepStrictEqual([e.from, e.to, e.before.length, e.after.length], [0, 228, 1, 4]);
  // the side column keeps at least MIN, the time block too
  assert.deepStrictEqual(plain(Layout.edgeRange(e)), [20, 180]);
  var moved = Layout.moveEdge(blocks, e, 1000);
  assert(Layout.validate(moved));
  assert.deepStrictEqual(rects(moved)[0], [0, 0, 180, 228]);
  // borders inside the side column move on their own
  var h = edgeAt(blocks, false, 57, 158);
  assert.deepStrictEqual([h.from, h.to, h.before.length, h.after.length], [158, 200, 1, 1]);
});

test('borders that line up across blocks of different sizes', function () {
  // A | B on top, C wider than A below: the border under A also runs under
  // part of B, so it takes A, B and C
  var blocks = Layout.fromSaved({ v: 2, layout: [
    { x: 0, y: 0, w: 60, h: 100, widget: 'empty' },
    { x: 60, y: 0, w: 140, h: 100, widget: 'empty' },
    { x: 0, y: 100, w: 120, h: 128, widget: 'empty' },
    { x: 120, y: 100, w: 80, h: 128, widget: 'empty' }
  ] });
  var e = edgeAt(blocks, false, 100, 0);
  assert.deepStrictEqual([e.from, e.to, e.before.length, e.after.length], [0, 200, 2, 2]);
  // the vertical borders are separate
  assert.strictEqual(Layout.edges(blocks).length, 3);
  assert(Layout.validate(Layout.moveEdge(blocks, e, 140)));
});

test('split in halves', function () {
  var blocks = preset('timestyle');
  var time = blocks[0];
  var v = Layout.split(blocks, time.id, true, function () { return false; });
  assert(Layout.validate(v.blocks));
  assert.deepStrictEqual(rects([v.first]), [[0, 0, 79, 228]]);
  assert.strictEqual(v.first.widget, 'empty'); // did not fit
  var h = Layout.split(blocks, time.id, false);
  assert.deepStrictEqual(rects([h.first]), [[0, 0, 158, 114]]);
  assert.strictEqual(h.first.widget, 'time');
  // too small: each half needs MIN
  assert(Layout.canSplit(blocks, blocks[1], true)); // 42 wide: 21 + 21
  var narrow = Layout.moveEdge(blocks, edgeAt(blocks, true, 158, 0), 180);
  assert(!Layout.canSplit(narrow, narrow[1], true)); // 20 wide
  assert(Layout.canSplit(narrow, narrow[1], false)); // 57 high
  // no more than MAX_BLOCKS
  assert(!Layout.canSplit(evenGrid(), evenGrid()[0], true));
});

test('merge the blocks of a selection', function () {
  var blocks = evenGrid();
  var res = Layout.merge(blocks, Layout.union(blocks[0], blocks[5]));
  assert(Layout.validate(res.blocks));
  assert.deepStrictEqual(rects([res.merged]), [[0, 0, 100, 114]]);
  assert.strictEqual(res.blocks.length, 13);
  // a selection that cuts a block grows to take all of it
  var moved = Layout.moveEdge(blocks, edgeAt(blocks, true, 50, 57), 70);
  var r = Layout.expandRect(moved, Layout.union(moved[0], moved[4]));
  assert.deepStrictEqual(plain(r), { x: 0, y: 0, w: 100, h: 114 });
});

if (!process.exitCode) console.log('OK: ' + passed + ' tests passed');
else console.log('FAILED: ' + passed + ' tests passed');
