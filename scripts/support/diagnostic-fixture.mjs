import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import diagnostic from '../../lib/math-diagnostic-v2.js';

// Serve the real page and engine over HTTP; only persistence/auth are replaced.
export async function diagnosticFixture(initialSession = diagnostic.createSession()) {
  let session = structuredClone(initialSession);
  const posts = [], history = [];
  const fault = { answer: false, load: false, delay: 0 };
  const app = express();
  app.use(express.json());
  const payload = () => {
    const q = diagnostic.nextQuestion(session);
    const question = q ? (diagnostic.publicQuestion ? diagnostic.publicQuestion(q) : { id: q.id, skill: q.skill, prompt: q.prompt }) : null;
    return { ...(diagnostic.progress ? diagnostic.progress(session) : {}), question, answered: session.answers.length, finished: session.finished, result: session.finished ? diagnostic.result(session) : null };
  };
  app.get('/api/math/diagnostic-v2', (_req, res) => fault.load ? res.status(503).json({ error: 'UNAVAILABLE' }) : res.json(payload()));
  app.post('/api/math/diagnostic-v2/answer', async (req, res) => {
    posts.push(structuredClone(req.body));
    if (fault.delay) await new Promise(resolve => setTimeout(resolve, fault.delay));
    if (fault.answer) return res.status(503).json({ error: 'SAVE_FAILED' });
    const { id, value } = req.body;
    if (typeof id !== 'string' || !(value === null || ['string', 'number'].includes(typeof value)) || String(value).length > 50) return res.status(400).json({ error: 'INVALID_ANSWER' });
    try { session = diagnostic.submitAnswer(session, id, value); }
    catch { return res.status(409).json({ error: 'QUESTION_MISMATCH' }); }
    res.json({ correct: session.answers.at(-1).correct, ...payload() });
  });
  app.post('/api/math/diagnostic-v2/restart', (_req, res) => {
    if (session.answers.length) history.push({ session: structuredClone(session), result: diagnostic.result(session) });
    session = diagnostic.createSession();
    res.json({ ok: true });
  });
  app.get('/api/math/progress', (_req, res) => res.json({ attempts: [] }));
  app.get('/api/math/skill-map', (_req, res) => res.json({ skills: {}, reviewOrigins: [] }));
  app.get('/api/math/adaptive', (_req, res) => res.json({ skill: 'Числа', level: 1, questions: [] }));
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.use(express.static(path.resolve(import.meta.dirname, '../../public')));
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, posts, history, fault,
    session: () => structuredClone(session), question: () => diagnostic.nextQuestion(session),
    restore: saved => { session = structuredClone(saved); },
    close: () => new Promise(resolve => server.close(resolve)) };
}
