import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

const publicDir = path.resolve(import.meta.dirname, '../../public');

// CSS-only visual scaffolds: use every real page, stylesheet and asset, but do
// not execute product scripts or contact authentication, APIs, RTC or MongoDB.
// These are deliberately not functional end-to-end tests.
export async function appBackgroundFixture() {
  const files = (await fs.readdir(publicDir)).filter(file => file.endsWith('.html')).sort();
  const documents = new Map(await Promise.all(files.map(async file => [
    `/${file}`, (await fs.readFile(path.join(publicDir, file), 'utf8'))
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  ])));
  const unexpectedRequests = [];
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) {
      unexpectedRequests.push(req.path);
      return res.status(500).json({ error: 'Product runtime is disabled in the CSS-only fixture' });
    }
    const html = documents.get(req.path);
    if (!html) return next();
    res.set('Content-Security-Policy', "script-src 'none'; connect-src 'none'");
    res.type('html').send(html);
  });
  app.use(express.static(publicDir));
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    files,
    unexpectedRequests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
