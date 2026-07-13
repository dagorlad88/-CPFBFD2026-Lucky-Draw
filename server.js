/**
 * Lucky Draw backend.
 *
 * Replaces the browser-only localStorage store with a shared, host-side data
 * store so every connected user maintains the SAME participants / prizes /
 * draw history. Data lives in a single SQLite file on the host and survives
 * restarts. Live updates are pushed to browsers over Server-Sent Events so the
 * existing onSnapshot() listeners keep working.
 *
 * REST API (all JSON):
 *   GET    /api/collections/:collection            -> { docs: [{ id, data }] }
 *   PUT    /api/collections/:collection/:id         body { data, merge } -> set / merge one doc
 *   POST   /api/collections/:collection             body { data, id? }   -> add doc (auto id)
 *   DELETE /api/collections/:collection/:id          -> delete one doc
 *   POST   /api/batch                                body { ops: [...] }  -> atomic set/update/delete
 *   GET    /api/files?path=...                        -> { dataUrl }
 *   PUT    /api/files                                 body { path, dataUrl }
 *   GET    /api/events                                -> SSE stream of { collections: [...] }
 *
 * Everything else is served from ./dist (the built front-end).
 */

import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'luckydraw.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== DATABASE ====================

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS files (
    path     TEXT PRIMARY KEY,
    data_url TEXT NOT NULL
  );
`);

const qList    = db.prepare('SELECT id, data FROM documents WHERE collection = ?');
const qGet     = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ?');
const qSet     = db.prepare(
  'INSERT INTO documents (collection, id, data) VALUES (?, ?, ?) ' +
  'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data'
);
const qDel     = db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?');
const qFileGet = db.prepare('SELECT data_url FROM files WHERE path = ?');
const qFileSet = db.prepare(
  'INSERT INTO files (path, data_url) VALUES (?, ?) ' +
  'ON CONFLICT(path) DO UPDATE SET data_url = excluded.data_url'
);

function readDoc(collection, id) {
  const row = qGet.get(collection, id);
  return row ? JSON.parse(row.data) : null;
}

/** Writes a doc; when `merge` is true, shallow-merges over any existing doc. */
function writeDoc(collection, id, data, merge) {
  let next = data ?? {};
  if (merge) {
    const existing = readDoc(collection, id);
    if (existing) next = { ...existing, ...next };
  }
  qSet.run(collection, id, JSON.stringify(next));
}

// ==================== LIVE UPDATES (SSE) ====================

const clients = new Set();

function broadcast(collections) {
  const unique = [...new Set(collections)];
  if (unique.length === 0) return;
  const payload = `data: ${JSON.stringify({ collections: unique })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* dropped client */ }
  }
}

// ==================== HTTP API ====================

const app = express();
app.use(express.json({ limit: '60mb' })); // large enough for base64 prize images

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering so events flush immediately
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n');

  clients.add(res);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.get('/api/collections/:collection', (req, res) => {
  const docs = qList
    .all(req.params.collection)
    .map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  res.json({ docs });
});

app.put('/api/collections/:collection/:id', (req, res) => {
  const { data, merge } = req.body || {};
  writeDoc(req.params.collection, req.params.id, data, !!merge);
  broadcast([req.params.collection]);
  res.json({ ok: true });
});

app.post('/api/collections/:collection', (req, res) => {
  const { data, id } = req.body || {};
  const newId = id || Date.now().toString(36) + Math.random().toString(36).slice(2);
  writeDoc(req.params.collection, newId, data, false);
  broadcast([req.params.collection]);
  res.json({ id: newId });
});

app.delete('/api/collections/:collection/:id', (req, res) => {
  qDel.run(req.params.collection, req.params.id);
  broadcast([req.params.collection]);
  res.json({ ok: true });
});

app.post('/api/batch', (req, res) => {
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
  const affected = new Set();

  const runAll = db.transaction((operations) => {
    for (const op of operations) {
      if (op.type === 'set') {
        writeDoc(op.collection, op.id, op.data, !!op.merge);
      } else if (op.type === 'update') {
        // Firestore semantics: update only applies if the doc exists.
        if (readDoc(op.collection, op.id)) writeDoc(op.collection, op.id, op.data, true);
      } else if (op.type === 'delete') {
        qDel.run(op.collection, op.id);
      }
      affected.add(op.collection);
    }
  });

  try {
    runAll(ops);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }

  broadcast([...affected]);
  res.json({ ok: true });
});

app.get('/api/files', (req, res) => {
  const row = qFileGet.get(String(req.query.path || ''));
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ dataUrl: row.data_url });
});

app.put('/api/files', (req, res) => {
  const { path: filePath, dataUrl } = req.body || {};
  if (!filePath || !dataUrl) {
    return res.status(400).json({ error: 'path and dataUrl are required' });
  }
  qFileSet.run(filePath, dataUrl);
  res.json({ ok: true });
});

// ==================== STATIC FRONT-END ====================

const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback for client-side routing (leave /api alone).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn(`[server] ${distDir} not found — run "npm run build" first, or use "npm run dev" for the Vite dev server.`);
}

app.listen(PORT, () => {
  console.log(`Lucky Draw server listening on http://localhost:${PORT}`);
  console.log(`SQLite data file: ${DB_PATH}`);
});
