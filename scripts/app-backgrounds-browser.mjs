import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { appBackgroundFixture } from './support/app-background-fixture.mjs';

// Browser plugin not available. Use the repository's installed Puppeteer and
// Chromium workflow. Flow: each public page + each dashboard role -> render the
// real HTML/CSS without product JS -> the same responsive illustrated backdrop.
const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome, 'Chrome/Chromium is required');
const baselinePath = process.env.APP_BACKGROUND_BASELINE || '/tmp/app-background-baseline.json';
const evidencePath = process.env.APP_BACKGROUND_EVIDENCE || '/tmp/app-background-evidence.json';
const captureBaseline = process.argv.includes('--baseline');
const screenshotDir = '/tmp/app-backgrounds';
fs.mkdirSync(screenshotDir, { recursive: true });
const fixture = await appBackgroundFixture();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const baseline = !captureBaseline && fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
const evidence = {
  fixture: 'CSS-only real HTML/CSS/assets; product scripts removed; dashboard role visibility scaffolded',
  browser: 'Browser plugin not available; installed Puppeteer/Chromium',
  url: fixture.url, records: [], screenshots: [], failures: []
};
const cases = fixture.files.flatMap(file => file === 'dashboard.html'
  ? ['teacher', 'student', 'admin'].map(role => ({ file, role })) : [{ file }]);
const key = (entry, width) => `${entry.file}${entry.role ? `:${entry.role}` : ''}@${width}`;
const failures = evidence.failures;
const check = (condition, message) => { if (!condition) failures.push(message); };
const page = await browser.newPage();
const runtimeErrors = [], consoleErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const failedResponses = [];
page.on('response', response => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

async function open(entry, width) {
  await page.setViewport({ width, height: width >= 1000 ? 900 : 850, deviceScaleFactor: 1 });
  await page.goto(`${fixture.url}/${entry.file}`, { waitUntil: 'load' });
  await page.evaluate(async role => {
    if (role) {
      // Match cabinet.js role activation without running live API/auth code.
      document.body.dataset.role = role;
      const show = (id, visible) => { const node = document.getElementById(id); if (node) node.hidden = !visible; };
      show('teacherPanel', role === 'teacher');
      show('materialPanel', role === 'teacher');
      show('teacherSessionTabs', role === 'teacher');
      show('teacherPaymentsLink', role === 'teacher');
      show('studentMathPanel', role === 'student');
      show('adminPanel', role === 'admin');
      show('perfLogButton', role === 'admin');
    }
    for (const image of document.images) image.loading = 'eager';
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.complete ? null : new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    })));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, entry.role);
  return page.evaluate(async () => {
    const pick = node => {
      const css = getComputedStyle(node);
      return { color: css.backgroundColor, image: css.backgroundImage, attachment: css.backgroundAttachment,
        position: css.backgroundPosition, size: css.backgroundSize, repeat: css.backgroundRepeat };
    };
    const pseudo = (node, selector) => {
      const css = getComputedStyle(node, selector);
      return { content: css.content, display: css.display, image: css.backgroundImage, position: css.position,
        pointerEvents: css.pointerEvents, size: css.backgroundSize, repeat: css.backgroundRepeat, height: css.height, zIndex: css.zIndex };
    };
    const artworkUrl = getComputedStyle(document.documentElement, '::before').backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    let artworkSize = null;
    if (artworkUrl) {
      const artwork = new Image();
      artwork.src = artworkUrl;
      await artwork.decode();
      artworkSize = { width: artwork.naturalWidth, height: artwork.naturalHeight };
    }
    return {
      viewportHeight: innerHeight, artworkSize,
      title: document.title, pathname: location.pathname, role: document.body.dataset.role || null,
      root: pick(document.documentElement), body: pick(document.body),
      before: pseudo(document.body, '::before'), after: pseudo(document.body, '::after'),
      rootBefore: pseudo(document.documentElement, '::before'), rootAfter: pseudo(document.documentElement, '::after'),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      meaningfulTextLength: document.body.innerText.trim().length,
      scripts: document.scripts.length,
      brokenImages: [...document.images].filter(image => !image.naturalWidth).map(image => image.getAttribute('src')),
      gameMap: document.getElementById('mapStage') ? pick(document.getElementById('mapStage')) : null,
      frameworkOverlay: !!document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')
    };
  });
}

try {
  // All root HTML pages, including student/teacher/observer lessons and every
  // dashboard role, are sampled on phone and desktop, not just the diagnostic.
  for (const width of [360, 1280]) {
    let expectedRoot;
    for (const entry of cases) {
      const record = { key: key(entry, width), width, ...entry, ...await open(entry, width) };
      evidence.records.push(record);
      expectedRoot ||= record.root;
      check(record.pathname === `/${entry.file}` && record.title.length > 0, `${record.key}: page identity`);
      check(record.meaningfulTextLength > 20, `${record.key}: blank page`);
      check(!record.frameworkOverlay, `${record.key}: framework overlay`);
      check(record.scripts === 0, `${record.key}: CSS fixture unexpectedly includes product scripts`);
      check(record.brokenImages.length === 0, `${record.key}: broken images ${record.brokenImages.join(', ')}`);
      check(record.root.image === 'none', `${record.key}: root must not tile or stretch art across document height`);
      check(record.root.color !== 'rgba(0, 0, 0, 0)', `${record.key}: root canvas must have an opaque fallback`);
      check(JSON.stringify(record.root) === JSON.stringify(expectedRoot), `${record.key}: root canvas differs from ${cases[0].file}`);
      const artwork = record.rootBefore;
      const variant = width <= 640 ? 'academy-forest-portrait.webp' : 'academy-forest-wide.webp';
      check(artwork.image.includes(variant), `${record.key}: missing generated ${variant}`);
      check(artwork.position === 'fixed' && artwork.pointerEvents === 'none' && Number(artwork.zIndex) < 0, `${record.key}: artwork must stay behind interactive content`);
      check(artwork.size === 'cover', `${record.key}: scenery must fill the viewport without repeating`);
      check(artwork.repeat === 'no-repeat' && parseFloat(artwork.height) >= record.viewportHeight, `${record.key}: illustrated layer leaves a viewport gap or tiles`);
      check(record.artworkSize && (width <= 640 ? record.artworkSize.height > record.artworkSize.width : record.artworkSize.width > record.artworkSize.height), `${record.key}: artwork must decode and match the viewport orientation`);
      check(record.body.image === 'none' && record.body.color === 'rgba(0, 0, 0, 0)', `${record.key}: body must reveal shared root canvas (found ${record.body.color}, ${record.body.image})`);
      for (const name of ['before', 'after', 'rootAfter']) {
        const pseudo = record[name];
        const generated = !['none', 'normal'].includes(pseudo.content) && pseudo.display !== 'none';
        check(!(generated && pseudo.image.includes('url(')), `${record.key}: ${name} still paints a page-level image`);
        if (entry.file === 'math-hub.html') check(!(generated && pseudo.position === 'fixed'), `${record.key}: hub retains fixed pseudo overlay`);
      }
      if (baseline) {
        const before = baseline.records.find(item => item.key === record.key);
        check(!!before, `${record.key}: missing measured overflow baseline`);
        if (before) check(record.overflow <= before.overflow + 1, `${record.key}: horizontal overflow increased ${before.overflow}px -> ${record.overflow}px`);
        if (before?.gameMap) check(JSON.stringify(record.gameMap) === JSON.stringify(before.gameMap), `${record.key}: nested map canvas paint changed`);
      } else if (!captureBaseline) check(record.overflow <= 1, `${record.key}: page has horizontal overflow (${record.overflow}px)`);
      if (!captureBaseline) {
        const isolation = await page.evaluate(() => {
          const shared = [...document.querySelectorAll('link[rel="stylesheet"]')].find(link => new URL(link.href).pathname === '/app-background.css');
          if (!shared) return { checked: 0, changed: ['Shared stylesheet is not loaded'] };
          const nodes = [...document.querySelectorAll('#pageShell, #pdfCanvas, #drawCanvas, #mapStage, .world, .card, .panel, .toolbar, .student-welcome, .student-math-entry, main, header, button, input')];
          const component = node => {
            const css = getComputedStyle(node), rect = node.getBoundingClientRect();
            return { background: css.background, color: css.color, font: css.font, border: css.border,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
          };
          const withShared = nodes.map(component);
          shared.disabled = true;
          const withoutShared = nodes.map(component);
          shared.disabled = false;
          const changed = nodes.flatMap((node, index) => JSON.stringify(withShared[index]) === JSON.stringify(withoutShared[index]) ? [] : [
            { element: node.id ? `#${node.id}` : `${node.tagName}.${node.className}`, withShared: withShared[index], withoutShared: withoutShared[index] }
          ]);
          return { checked: nodes.length, changed };
        });
        record.componentIsolation = isolation;
        check(isolation.checked > 0 && isolation.changed.length === 0, `${record.key}: shared canvas changes component paint/typography/layout: ${JSON.stringify(isolation.changed)}`);
      }
    }
    console.log(`Rendered all ${fixture.files.length} public pages and three dashboard roles at ${width}px`);
  }
  const representatives = [
    { file: 'index.html' }, { file: 'dashboard.html', role: 'student' },
    { file: 'dashboard.html', role: 'teacher' }, { file: 'dashboard.html', role: 'admin' },
    { file: 'math-hub.html' }, { file: 'math-academy.html' },
    { file: 'fraction-builder.html' }, { file: 'number-lab.html' },
    { file: 'math-adventure.html' }, { file: 'teacher.html' },
    { file: 'student.html' }, { file: 'monitor.html' }, { file: 'teacher-payments.html' }
  ];
  for (const width of [320, 412, 1280]) for (const entry of representatives) {
    const record = { key: key(entry, width), width, ...entry, ...await open(entry, width) };
    const file = path.join(screenshotDir, `${captureBaseline ? 'before' : 'after'}-${entry.file.replace('.html', '')}${entry.role ? `-${entry.role}` : ''}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    evidence.screenshots.push({ ...record, screenshot: file });
    if (baseline) {
      const before = baseline.screenshots.find(item => item.key === record.key);
      check(!!before, `${record.key}: missing screenshot overflow baseline`);
      if (before) check(record.overflow <= before.overflow + 1, `${record.key}: horizontal overflow increased ${before.overflow}px -> ${record.overflow}px`);
    }
  }
  check(runtimeErrors.length === 0, `Runtime errors: ${runtimeErrors.join('; ')}`);
  check(consoleErrors.length === 0, `Console errors: ${consoleErrors.join('; ')}`);
  check(failedResponses.length === 0, `Failed HTTP requests: ${JSON.stringify(failedResponses)}`);
  check(fixture.unexpectedRequests.length === 0, `CSS scaffold contacted live product endpoints: ${fixture.unexpectedRequests.join(', ')}`);
  evidence.runtimeErrors = runtimeErrors;
  evidence.consoleErrors = consoleErrors;
  evidence.failedResponses = failedResponses;
  if (captureBaseline) fs.writeFileSync(baselinePath, JSON.stringify(evidence, null, 2));
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  for (const failure of failures) console.error(`✗ ${failure}`);
  assert.equal(failures.length, 0, `${failures.length} background/visual checks failed; evidence: ${evidencePath}`);
  console.log(`✓ shared canvas across ${fixture.files.length} public pages, three dashboard roles, and lesson roles; ${evidence.screenshots.length} full-page screenshots`);
  console.log(`Evidence: ${evidencePath}; measured baseline: ${baseline ? baselinePath : captureBaseline ? baselinePath : 'not supplied (360/1280 must have no overflow; screenshot-only widths have no delta comparison)'}`);
} finally {
  await page.close();
  await browser.close();
  await fixture.close();
}
