// Screenshots of the settings page for the README: screenshots/settings-*.png.
//
//   node tools/settings_screenshots.mjs <chromium>
//
// Drives a headless Chromium (python3 -c "import sys; sys.path.insert(0, 'tools');
// from icons import find_chrome; print(find_chrome())" finds one) over the
// DevTools protocol: dark theme, 2x pixels, a fresh profile (no saved
// settings) and the clock stopped at 10:09.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome = process.argv[2];
if (!chrome) throw new Error('usage: node tools/settings_screenshots.mjs <chromium>');
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(repo, 'screenshots');
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
const proc = spawn(chrome, ['--headless', '--disable-gpu', '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('no page target');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

// the clock stands at 10:09 on Monday, 12 October 2026, as in the old screenshots
const FAKE_DATE = `(() => {
  const T = new Date(2026, 9, 12, 10, 9, 0).getTime(), D = Date;
  class F extends D { constructor(...a) { a.length ? super(...a) : super(T); } static now() { return T; } }
  window.Date = F;
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_DATE });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

async function open(w, h, mobile, query = '') {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await send('Page.navigate', { url: `file://${repo}/config/index.html?lang=en${query}` });
  await sleep(1500);
}

async function shot(name) {
  await sleep(500);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  console.log('wrote screenshots/' + name);
}

// helpers in the page: pointer on a watch pixel, a preset by name, a panel by title
const HELPERS = `
  window.__tapWatch = (x, y) => {
    const r = document.getElementById('screenWrap').getBoundingClientRect(), o = document.getElementById('overlay');
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1,
      clientX: r.left + x / 200 * r.width, clientY: r.top + y / 228 * r.height };
    o.dispatchEvent(new PointerEvent('pointerdown', opts));
    o.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
  };
  window.__panel = (title) => [...document.querySelectorAll('.panel')].find((p) => p.querySelector('h2')?.textContent === title);
`;

// 1. desktop: the default layout, the steps block selected
await open(1280, 1001, false);
await evaluate(HELPERS + `__tapWatch(179, 142);`);
await shot('settings-desktop.png');

// 2. phone: the widget picker of the time block
await open(390, 844, true);
await evaluate(`document.querySelector('[data-action="pick"]').click();`);
await shot('settings-mobile-1.png');

// 3. phone: theme and general settings of the Dashboard layout
await open(390, 844, true);
await evaluate(HELPERS + `
  [...document.querySelectorAll('#presets .preset')].find((b) => b.textContent.trim() === 'Dashboard').click();
  const head = document.querySelector('header').getBoundingClientRect().height;
  window.scrollTo(0, __panel('Theme').getBoundingClientRect().top + window.scrollY - head - 10);
`);
await shot('settings-mobile-2.png');

ws.close();
proc.kill();
