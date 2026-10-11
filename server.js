'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { createStore } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'gemeinde';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 2048;

function createApp({
  dataDir = path.join(__dirname, 'data'),
  uploadDir = path.join(__dirname, 'uploads'),
  adminPassword = ADMIN_PASSWORD,
  sessionSecret = SESSION_SECRET,
} = {}) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const store = createStore(path.join(dataDir, 'db.json'));
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // ---------- Anmeldung (ein gemeinsames Admin-Passwort) ----------

  const SESSION_COOKIE = 'gm_session';
  const SESSION_DAYS = 30;

  function sign(value) {
    return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
  }

  function makeToken() {
    const expires = String(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    return `${expires}.${sign(expires)}`;
  }

  function isValidToken(token) {
    if (!token) return false;
    const [expires, sig] = token.split('.');
    if (!expires || !sig || Number(expires) < Date.now()) return false;
    const expected = Buffer.from(sign(expires));
    const actual = Buffer.from(sig);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function isAdmin(req) {
    return isValidToken(readCookie(req, SESSION_COOKIE));
  }

  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Bitte zuerst anmelden.' });
    next();
  }

  function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  app.post('/api/login', (req, res) => {
    const password = (req.body && req.body.password) || '';
    if (!safeEqual(password, adminPassword)) {
      return res.status(401).json({ error: 'Falsches Passwort.' });
    }
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`
    );
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

  // ---------- Kategorien ----------

  app.get('/api/categories', (req, res) => {
    const albums = store.listAlbums();
    res.json(
      store.listCategories().map((c) => ({
        ...c,
        albumCount: albums.filter((a) => a.category === c.id).length,
      }))
    );
  });

  app.post('/api/categories', requireAdmin, (req, res) => {
    try {
      res.status(201).json(store.createCategory(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/categories/:id', requireAdmin, (req, res) => {
    const cat = store.updateCategory(req.params.id, req.body || {});
    if (!cat) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    res.json(cat);
  });

  app.delete('/api/categories/:id', requireAdmin, (req, res) => {
    try {
      if (!store.deleteCategory(req.params.id)) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- Alben ----------

  app.get('/api/albums', (req, res) => {
    const { category, q, year, limit } = req.query;
    res.json(store.searchAlbums({ category, q, year, limit: Number(limit) || undefined }));
  });

  app.get('/api/albums/:id', (req, res) => {
    const album = store.getAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album nicht gefunden.' });
    res.json(album);
  });

  app.post('/api/albums', requireAdmin, (req, res) => {
    try {
      res.status(201).json(store.createAlbum(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/albums/:id', requireAdmin, (req, res) => {
    try {
      const album = store.updateAlbum(req.params.id, req.body || {});
      if (!album) return res.status(404).json({ error: 'Album nicht gefunden.' });
      res.json(album);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/albums/:id', requireAdmin, (req, res) => {
    const album = store.getAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album nicht gefunden.' });
    store.deleteAlbum(album.id);
    fs.rmSync(path.join(uploadDir, album.id), { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ---------- Medien hochladen ----------

  // SVG ist ausgeschlossen, weil SVG-Dateien Skripte enthalten können.
  const ALLOWED = /^(image|audio|video)\//;
  const isAllowed = (file) =>
    ALLOWED.test(file.mimetype) && file.mimetype !== 'image/svg+xml' && !/\.svg$/i.test(file.originalname);

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        const dir = path.join(uploadDir, req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!isAllowed(file)) {
        return cb(new Error(`Dateityp nicht erlaubt: ${file.originalname}`));
      }
      cb(null, true);
    },
  });

  app.post(
    '/api/albums/:id/media',
    requireAdmin,
    (req, res, next) => {
      if (!store.getAlbum(req.params.id)) return res.status(404).json({ error: 'Album nicht gefunden.' });
      next();
    },
    (req, res, next) => {
      upload.array('files', 200)(req, res, (err) => {
        if (err) {
          for (const f of req.files || []) fs.rmSync(f.path, { force: true });
          const msg = err.code === 'LIMIT_FILE_SIZE' ? `Datei zu groß (max. ${MAX_UPLOAD_MB} MB).` : err.message;
          return res.status(400).json({ error: msg });
        }
        next();
      });
    },
    (req, res) => {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'Keine Dateien ausgewählt.' });
      const added = store.addMedia(
        req.params.id,
        files.map((f) => ({
          type: f.mimetype.split('/')[0],
          mime: f.mimetype,
          file: `${req.params.id}/${f.filename}`,
          originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          size: f.size,
        }))
      );
      res.status(201).json(added);
    }
  );

  app.put('/api/media/:id', requireAdmin, (req, res) => {
    const media = store.updateMedia(req.params.id, req.body || {});
    if (!media) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    res.json(media);
  });

  app.delete('/api/media/:id', requireAdmin, (req, res) => {
    const media = store.deleteMedia(req.params.id);
    if (!media) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    fs.rmSync(path.join(uploadDir, media.file), { force: true });
    res.json({ ok: true });
  });

  // ---------- Statische Dateien ----------

  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', fallthrough: false }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status === 404 ? 'Nicht gefunden.' : 'Interner Fehler.' });
  });

  return app;
}

if (require.main === module) {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_PASSWORD ist nicht gesetzt – Standardpasswort "gemeinde" wird verwendet. Bitte ändern!');
  }
  createApp().listen(PORT, () => {
    console.log(`Gemeinde-Mediathek läuft auf http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
