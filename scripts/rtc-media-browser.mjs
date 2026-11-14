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
// Prefer the native Chrome binary over Ubuntu Chromium launcher wrappers.
const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, dumpio: Boolean(process.env.CI), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 740 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function fresh(mode, answer = true) {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => document.querySelector('.lesson-comms-chat-button').click());
    await page.evaluate(value => { window.mode = value; ring(); }, mode);
    if (answer) await page.click('.lesson-comms-accept');
  }
  const state = () => page.$eval('.lesson-comms-call-state', el => ({ text: el.textContent, visible: el.checkVisibility() }));
  for (const [width, height] of [[320, 640], [390, 740], [1280, 800]]) {
    await page.setViewport({ width, height });
    await fresh('pending', false);
    assert.equal(await page.$eval('.lesson-comms-incoming', el => el.matches(':modal')), true);
    assert.equal(await page.evaluate(() => requests), 0, 'Ringing must not ask for camera permissions');
    assert.equal(await page.$eval('.lesson-comms-chat', el => el.hidden), false, 'Ringing must preserve chat until answered');
    const bounds = await page.$eval('.lesson-comms-incoming', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height, JSON.stringify(bounds));
    await page.screenshot({ path: '/tmp/school-incoming-' + width + '.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.lesson-comms-incoming', el => el.open), false);
    assert.equal(await page.$eval('.lesson-comms-chat', el => el.checkVisibility()), true, 'Declining must retain the chat');
    assert.equal(await page.evaluate(() => events.some(e => e.name === 'rtc2:decline')), true);
    await page.evaluate(() => ring());
    await page.evaluate(() => deliver('rtc2:cancelled', { callId: 'test-call' }));
    assert.equal(await page.$eval('.lesson-comms-incoming', el => el.open), false);
    await page.click('.lesson-comms-close');
    await page.evaluate(() => ring());
    assert.equal(await page.$eval('.lesson-comms-incoming', el => el.matches(':modal')), true, 'Incoming dialog must work while the panel is closed');
    await page.click('.lesson-comms-decline');
    assert.equal(await page.$eval('.lesson-comms-panel', el => el.hidden), true);
  }
  await page.setViewport({ width: 390, height: 740 });
  await fresh('pending');
  assert.equal(await page.$eval('.lesson-comms-incoming', el => el.open), false);
  assert.equal(await page.$eval('.lesson-comms-video', el => el.checkVisibility()), true);
  assert.equal(await page.$eval('.lesson-comms-chat', el => el.hidden), true);
  assert.equal(await page.$eval('.lesson-comms-setup', el => el.checkVisibility()), true);
  assert.equal(await page.evaluate(() => events.some(e => e.name === 'rtc2:preparing' && e.payload.state === 'requesting')), true);
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
    assert.equal(await page.evaluate(() => events.some(e => e.name === 'rtc2:preparing' && e.payload.state === 'blocked')), true);
    assert.ok(message.text.includes(fragment), message.text);
    assert.equal(await page.evaluate(n => events.some(e => e.payload?.event === 'local-media-error-v2' && e.payload?.state === n), name), true);
    assert.equal(await page.evaluate(() => events.some(e => JSON.stringify(e).includes('device detail'))), false);
  }
  await page.screenshot({ path: '/tmp/school-call-media-error.png' });
  // Retry the denied/device-error call with a working stream. A local video play
  // promise that never settles must not block accepting the network call.
  await page.evaluate(() => { mode = 'ready'; });
  await page.click('.lesson-comms-retry-media');
  await page.waitForFunction(() => events.some(e => e.name === 'rtc2:accept'), { timeout: 3000 });
  assert.equal(await page.evaluate(() => events.filter(e => e.name === 'rtc2:accept').length), 1);
  assert.equal(await page.$eval('.lesson-comms-setup', el => el.dataset.phase), 'connecting');
  assert.equal(await page.$eval('.lesson-comms-live', el => el.hidden), true, 'Accepting is not yet a connected call');
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => { mode = 'ready'; });
  await page.evaluate(() => document.querySelector('.lesson-comms-video-button').click());
  await page.click('.lesson-comms-start');
  await page.waitForFunction(() => events.some(e => e.name === 'rtc2:call'));
  await page.evaluate(() => { window.outgoingId = events.find(e => e.name === 'rtc2:call').payload.callId; deliver('rtc2:preparing', { callId: outgoingId, state: 'requesting' }); });
  assert.ok((await state()).text.includes('настраивает'));
  await page.evaluate(() => deliver('rtc2:preparing', { callId: 'old-call', state: 'blocked' }));
  assert.ok((await state()).text.includes('настраивает'), 'Ignore stale peer updates');
  await page.evaluate(() => deliver('rtc2:preparing', { callId: outgoingId, state: 'blocked' }));
  assert.ok((await state()).text.includes('повторной попытки'));
  await page.screenshot({ path: '/tmp/school-call-caller-waiting.png' });
  await page.setViewport({ width: 320, height: 640 });
  const hangup = await page.$eval('.lesson-comms-hangup', el => {
    const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom };
  });
  assert.ok(hangup.top >= 0 && hangup.bottom <= 640, 'Hangup must fit while waiting on a small phone: ' + JSON.stringify(hangup));
  assert.deepEqual(errors, []);
  console.log('✓ RTC media: incoming modal, chat-to-video transition, peer preparation, permissions/errors, cancellation and retry');
} finally { await browser.close(); server.close(); }
