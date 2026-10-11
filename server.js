'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { createStore, validDate, today } = require('./lib/store');
const { createTokens } = require('./lib/auth');

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 2048;

// Erlaubte Dokument-Endungen (zusätzlich zu Bildern, Audio und Video).
const DOCUMENT_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.txt', '.rtf']);

function fileType(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.svg' || file.mimetype === 'image/svg+xml') return null; // SVG kann Skripte enthalten
  const major = file.mimetype.split('/')[0];
  if (['image', 'audio', 'video'].includes(major)) return major;
  if (DOCUMENT_EXT.has(ext)) return 'document';
  return null;
}

function createApp({
  dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'),
  uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
  adminPassword = process.env.ADMIN_PASSWORD || 'gemeinde',
  adminPasswordReset = process.env.ADMIN_PASSWORD_RESET || '',
  sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
} = {}) {
  fs.mkdirSync(path.join(uploadDir, '.tmp'), { recursive: true });
  const store = createStore(path.join(dataDir, 'db.json'), { initialAdminPassword: adminPassword });
  if (adminPasswordReset) {
    // Notfall: Passwort vergessen → ADMIN_PASSWORD_RESET setzen, neu starten, anmelden, Variable wieder löschen.
    store.resetAdmin(adminPasswordReset);
    console.warn('⚠️  Das Passwort des Benutzers "admin" wurde über ADMIN_PASSWORD_RESET zurückgesetzt. Bitte die Variable jetzt wieder entfernen!');
  }
  const tokens = createTokens(sessionSecret);
  const app = express();
  // Hinter einem Proxy wie bei Render: echte Besucher-IP und HTTPS erkennen.
  if (process.env.TRUST_PROXY || process.env.RENDER) app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // ---------- Anmeldung ----------

  const COOKIE = 'gm_session';

  function readCookie(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  app.use((req, res, next) => {
    req.user = tokens.verify(readCookie(req, COOKIE), store.getUser);
    next();
  });

  const requireLogin = (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: 'Bitte zuerst anmelden.' });

  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte zuerst anmelden.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Admins.' });
    next();
  };

  // Einfacher Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro 15 Minuten und IP.
  const failures = new Map();
  function tooManyAttempts(ip) {
    const now = Date.now();
    const list = (failures.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    failures.set(ip, list);
    return list.length >= 10;
  }

  app.post('/api/login', (req, res) => {
    if (tooManyAttempts(req.ip)) {
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.' });
    }
    const { username, password } = req.body || {};
    const user = store.authenticate(username, password);
    if (!user) {
      failures.get(req.ip).push(Date.now());
      return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
    }
    failures.delete(req.ip);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${tokens.create(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${tokens.maxAgeSeconds}${secure}`
    );
    res.json({ user: store.publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: req.user ? store.publicUser(req.user) : null }));

  app.put('/api/me/password', requireLogin, (req, res) => {
    const { current, password } = req.body || {};
    if (!store.authenticate(req.user.username, current)) {
      return res.status(400).json({ error: 'Das aktuelle Passwort stimmt nicht.' });
    }
    try {
      store.updateUser(req.user.id, { password });
      const user = store.getUser(req.user.id);
      res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${tokens.create(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${tokens.maxAgeSeconds}${req.secure ? '; Secure' : ''}`
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Kleiner Helfer: Fehler aus dem Speicher als 400 zurückgeben.
  const handle = (fn) => (req, res) => {
    try {
      const result = fn(req, res);
      if (result === null || result === false) return res.status(404).json({ error: 'Nicht gefunden.' });
      if (result !== undefined) res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  // ---------- Speicherplatz (nur Admin) ----------

  app.get('/api/storage', requireAdmin, handle(() => {
    const byType = {};
    for (const item of store.searchItems()) {
      if (!item.file) continue;
      const t = (byType[item.type] ||= { count: 0, size: 0 });
      t.count++;
      t.size += item.size || 0;
    }
    let total = null;
    let free = null;
    try {
      // Bei Render ist das die Größe der eingestellten Disk.
      const st = fs.statfsSync(uploadDir);
      total = st.blocks * st.bsize;
      free = st.bavail * st.bsize;
    } catch {}
    return { total, free, used: total !== null ? total - free : null, byType };
  }));

  // ---------- Benutzer (nur Admin) ----------

  app.get('/api/users', requireAdmin, handle(() => store.listUsers()));
  app.post('/api/users', requireAdmin, handle((req, res) => {
    res.status(201).json(store.createUser(req.body || {}));
  }));
  app.put('/api/users/:id', requireAdmin, handle((req) => store.updateUser(req.params.id, req.body || {})));
  app.delete('/api/users/:id', requireAdmin, handle((req) => {
    if (req.params.id === req.user.id) throw new Error('Du kannst dich nicht selbst löschen.');
    return store.deleteUser(req.params.id) && { ok: true };
  }));

  // ---------- Ordner ----------

  app.get('/api/folders', requireLogin, handle(() => store.listFolders()));
  app.get('/api/folders/root', requireLogin, handle(() => store.rootView()));
  app.get('/api/folders/:id', requireLogin, handle((req) => store.getFolderView(req.params.id)));
  app.post('/api/folders', requireAdmin, handle((req, res) => {
    res.status(201).json(store.createFolder(req.body || {}));
  }));
  app.put('/api/folders/:id', requireAdmin, handle((req) => store.updateFolder(req.params.id, req.body || {})));
  app.delete('/api/folders/:id', requireAdmin, handle((req) => {
    const removed = store.deleteFolder(req.params.id);
    if (!removed) return null;
    for (const item of removed) removeFile(item);
    return { ok: true, removed: removed.length };
  }));

  // ---------- Einträge ----------

  app.get('/api/items', requireLogin, handle((req) => {
    const { q, folder, type, limit, sort } = req.query;
    return store.searchItems({ q, folderId: folder, type, sort, limit: Math.min(Number(limit) || 0, 500) || undefined });
  }));

  app.get('/api/search', requireLogin, handle((req) => ({
    folders: store.searchFolders(req.query.q),
    items: store.searchItems({ q: req.query.q, limit: 300 }),
  })));

  app.post('/api/folders/:id/texts', requireAdmin, handle((req, res) => {
    const body = req.body || {};
    const [item] = store.createItems(req.params.id, [{ ...body, type: 'text' }], req.user);
    res.status(201).json(item);
  }));

  app.put('/api/items/:id', requireAdmin, handle((req) => store.updateItem(req.params.id, req.body || {})));

  app.delete('/api/items/:id', requireAdmin, handle((req) => {
    const item = store.deleteItem(req.params.id);
    if (!item) return null;
    removeFile(item);
    return { ok: true };
  }));

  function removeFile(item) {
    if (item.file) fs.rmSync(path.join(uploadDir, item.file), { force: true });
  }

  // ---------- Aktuelles ----------

  app.get('/api/news', requireLogin, handle((req) => ({
    ...store.currentNews({ days: Math.min(Math.max(Number(req.query.days) || 120, 1), 400) }),
    categories: store.eventCategories,
  })));
  app.get('/api/news/entries', requireAdmin, handle(() => store.listNewsEntries()));
  app.post('/api/news', requireAdmin, handle((req, res) => {
    res.status(201).json(store.createNews(req.body || {}, req.user));
  }));
  app.put('/api/news/:id', requireAdmin, handle((req) => store.updateNews(req.params.id, req.body || {})));
  app.delete('/api/news/:id', requireAdmin, handle((req) => store.deleteNews(req.params.id) && { ok: true }));

  // ---------- Hochladen ----------

  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(uploadDir, '.tmp'),
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 50 },
    fileFilter(req, file, cb) {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (!fileType(file)) return cb(new Error(`Dateityp nicht erlaubt: ${file.originalname}`));
      cb(null, true);
    },
  });

  app.post(
    '/api/folders/:id/items',
    requireAdmin,
    (req, res, next) => {
      if (!store.getFolder(req.params.id)) return res.status(404).json({ error: 'Ordner nicht gefunden.' });
      next();
    },
    (req, res, next) => {
      upload.array('files')(req, res, (err) => {
        if (err) {
          for (const f of req.files || []) fs.rmSync(f.path, { force: true });
          const msg =
            err.code === 'LIMIT_FILE_SIZE' ? `Datei zu groß (max. ${MAX_UPLOAD_MB} MB).`
            : err.code === 'LIMIT_FILE_COUNT' ? 'Zu viele Dateien auf einmal (max. 50).'
            : err.message;
          return res.status(400).json({ error: msg });
        }
        next();
      });
    },
    (req, res) => {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'Keine Dateien ausgewählt.' });
      let meta = [];
      try {
        meta = JSON.parse(req.body.meta || '[]');
      } catch {}
      const shared = req.body;

      try {
        const entries = files.map((f, i) => {
          const m = (Array.isArray(meta) && meta[i]) || {};
          const date = validDate(m.date) || validDate(shared.date) || today();
          return {
            type: fileType(f),
            title: m.title || (files.length === 1 ? shared.title : '') || '',
            date,
            description: shared.description,
            speaker: shared.speaker,
            bibleText: shared.bibleText,
            mime: f.mimetype,
            size: f.size,
            originalName: f.originalname,
            // Dateien nach Jahr/Monat ablegen, z. B. uploads/2026/08/…jpg
            file: `${date.slice(0, 4)}/${date.slice(5, 7)}/${f.filename}`,
          };
        });
        const created = store.createItems(req.params.id, entries, req.user);
        files.forEach((f, i) => {
          const target = path.join(uploadDir, entries[i].file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(f.path, target);
        });
        res.status(201).json(created);
      } catch (err) {
        for (const f of files) fs.rmSync(f.path, { force: true });
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ---------- Dateien ausliefern (nur angemeldet) ----------

  app.use(
    '/uploads',
    (req, res, next) => {
      if (!req.user) return res.status(401).send('Bitte zuerst anmelden.');
      if (req.path.startsWith('/.tmp')) return res.status(404).end();
      // Hochgeladene Dateien dürfen nie als Webseite mit Skripten laufen.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
      const ext = path.extname(req.path).toLowerCase();
      if (DOCUMENT_EXT.has(ext) && ext !== '.pdf') res.setHeader('Content-Disposition', 'attachment');
      next();
    },
    express.static(uploadDir, { maxAge: '7d', fallthrough: false, dotfiles: 'deny' })
  );

  app.use(express.static(path.join(__dirname, 'public')));

  app.use((err, req, res, next) => {
    if (err.status === 404 || err.statusCode === 404) return res.status(404).json({ error: 'Nicht gefunden.' });
    console.error(err);
    res.status(500).json({ error: 'Interner Fehler.' });
  });

  return app;
}

if (require.main === module) {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_PASSWORD ist nicht gesetzt – der erste Admin heißt "admin" mit Passwort "gemeinde". Bitte gleich ändern!');
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('ℹ️  SESSION_SECRET ist nicht gesetzt – nach jedem Neustart muss man sich neu anmelden.');
  }
  createApp().listen(PORT, () => {
    console.log(`Gemeinde-Mediathek läuft auf http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
