import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';

export async function adventureFixture(initial = { unlocked: 99, completed: [0, 1, 2, 3, 4, 5], stars: 18, startLevel: 1 }) {
  let progress = structuredClone(initial);
  const posts = [];
  const app = express();
  app.use(express.json());
  app.get('/api/auth/me', (_req, res) => res.json({ user: { id: 'continuation-student', username: 'student', role: 'student' } }));
  app.get('/api/math/adventure', (_req, res) => res.json({ userId: 'continuation-student', progress, assessmentRequired: false }));
  app.post('/api/math/adventure', (req, res) => {
    const { userId, level, correct, total } = req.body;
    if (userId !== 'continuation-student') return res.status(409).json({ error: 'ACCOUNT_MISMATCH' });
    if (!Number.isInteger(level) || level < 0 || level >= 100 || total !== 10 || correct !== 10) return res.status(400).json({ error: 'INVALID_RESULT' });
    posts.push(structuredClone(req.body));
    const fresh = !progress.completed.includes(level);
    progress = { ...progress, unlocked: Math.max(progress.unlocked, Math.min(99, level + 1)),
      completed: fresh ? [...progress.completed, level] : progress.completed, stars: progress.stars + (fresh ? 3 : 0) };
    res.json({ userId, progress, passed: true });
  });
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.get('/', (_req, res) => res.sendFile(path.resolve(import.meta.dirname, '../../public/math-adventure.html')));
  app.use(express.static(path.resolve(import.meta.dirname, '../../public')));
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, posts,
    progress: () => structuredClone(progress), close: () => new Promise(resolve => server.close(resolve)) };
}
