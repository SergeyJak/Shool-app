import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '..');
const server = http.createServer((req, res) => {
  const file = ['/lesson-comms.mjs', '/lesson-comms.css', '/landing.css', '/connections.css'].find(name => req.url === name);
  if (file) {
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    return fs.createReadStream(path.join(root, 'public', file)).pipe(res);
  }
  if (req.url.startsWith('/assets/')) {
    const asset = path.resolve(root, 'public', '.' + decodeURIComponent(req.url));
    if (asset.startsWith(path.join(root, 'public', 'assets') + path.sep) && fs.existsSync(asset)) {
      res.setHeader('Content-Type', asset.endsWith('.webp') ? 'image/webp' : 'image/png');
      return fs.createReadStream(asset).pipe(res);
    }
  }
  if (req.url.startsWith('/api/webrtc/config')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ iceServers: [] }));
  }
  if (req.url !== '/') { res.writeHead(204); return res.end(); }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/landing.css"><link rel="stylesheet" href="/lesson-comms.css"><link rel="stylesheet" href="/connections.css"><body class="connections-page"><script type="module">
    import { initLessonComms } from '/lesson-comms.mjs';
    window.events = []; window.requests = 0; window.mode = 'pending';
    const handlers = new Map();
    window.socket = { connected: true,
      on(name, handler) { handlers.set(name, handler); },
      emit(name, payload, ack) { events.push({ name, payload }); ack?.({ ok: true, messages: [] }); }
    };
    window.deliver = (name, data) => handlers.get(name)?.(data);
    window.stream = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      return canvas.captureStream();
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      getUserMedia() {
        requests++;
        if (mode === 'pending') return new Promise(resolve => { window.resolveMedia = resolve; });
        if (mode === 'ready') return Promise.resolve(stream());
        return Promise.reject(new DOMException('device detail must not be logged', mode));
      }
    }});
    HTMLMediaElement.prototype.play = function() { return new Promise(() => {}); };
    initLessonComms({ socket, role: 'student', lessonId: 'test', context: 'connection' });
    window.ring = () => deliver('rtc2:incoming-call', { caller: { clientId: 'caller', displayName: 'Teacher' }, callId: 'test-call' });
    window.ready = true;
  </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 740 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function fresh(mode) {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(value => { window.mode = value; ring(); }, mode);
    await page.click('.lesson-comms-accept');
  }
  const state = () => page.$eval('.lesson-comms-call-state', el => ({ text: el.textContent, visible: el.checkVisibility() }));
  await fresh('pending');
  assert.equal((await state()).visible, true, 'Permission request must remain visible before media is ready');
  await page.evaluate(() => document.querySelector('.lesson-comms-accept').click());
  assert.equal(await page.evaluate(() => requests), 1, 'Repeated clicks must not open concurrent media requests');
  await page.waitForFunction(() => document.querySelector('.lesson-comms-call-state').textContent.includes('адресной строки'), { timeout: 12000 });
  assert.equal(await page.evaluate(() => events.some(e => e.payload?.event === 'local-media-waiting-v2')), true);
  await page.evaluate(() => deliver('rtc2:cancelled', { callId: 'test-call' }));
  assert.equal(await page.$eval('.lesson-comms-accept', el => el.disabled), false);
  await page.evaluate(() => { window.lateStream = stream(); resolveMedia(lateStream); });
  await page.waitForFunction(() => lateStream.getTracks().every(t => t.readyState === 'ended'));
  assert.equal(await page.evaluate(() => events.some(e => e.name === 'rtc2:accept')), false, 'Cancelled calls must not be answered when permission resolves late');

  for (const [name, fragment] of [['NotAllowedError', 'запрещён'], ['NotFoundError', 'не найдены'], ['NotReadableError', 'другую программу']]) {
    await fresh(name);
    await page.waitForFunction(() => !document.querySelector('.lesson-comms-accept').disabled);
    const message = await state();
    assert.equal(message.visible, true, name + ' must be visible');
    assert.ok(message.text.includes(fragment), message.text);
    assert.equal(await page.evaluate(n => events.some(e => e.payload?.event === 'local-media-error-v2' && e.payload?.state === n), name), true);
    assert.equal(await page.evaluate(() => events.some(e => JSON.stringify(e).includes('device detail'))), false);
  }
  await page.screenshot({ path: '/tmp/school-call-media-error.png' });
  // Retry the denied/device-error call with a working stream. A local video play
  // promise that never settles must not block accepting the network call.
  await page.evaluate(() => { mode = 'ready'; });
  await page.click('.lesson-comms-accept');
  await page.waitForFunction(() => events.some(e => e.name === 'rtc2:accept'), { timeout: 3000 });
  assert.equal(await page.evaluate(() => events.filter(e => e.name === 'rtc2:accept').length), 1);
  assert.deepEqual(errors, []);
  console.log('✓ RTC media: visible permissions/errors, pending reminder, cancellation cleanup, retry and non-blocking preview');
} finally { await browser.close(); server.close(); }
