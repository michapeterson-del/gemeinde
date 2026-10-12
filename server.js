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

// Manche Geräte schicken bei Audio/Video keinen passenden Dateityp mit – dann zählt die Endung.
const AUDIO_EXT = new Set(['.m4a', '.mp3', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.mp4a']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);

function fileType(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = String(file.mimetype || '');
  if (ext === '.svg' || mime === 'image/svg+xml') return null; // SVG kann Skripte enthalten
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  const major = mime.split('/')[0];
  if (['image', 'audio', 'video'].includes(major)) return major;
  if (DOCUMENT_EXT.has(ext)) return 'document';
  return null;
}

function safeExt(name) {
  return path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
}

// Bei Render ohne Disk (z. B. kostenloser Plan) ist der Speicher nicht dauerhaft:
// bei jedem Neustart/Update wären alle Daten weg.
function ephemeralStorage() {
  if (!process.env.RENDER) return false;
  const dir = process.env.DATA_DIR || '';
  return !dir.startsWith('/var/data');
}

function createApp({
  dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'),
  uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
  // Leerzeichen am Anfang/Ende entfernen – die schleichen sich beim Kopieren gern ein.
  adminPassword = (process.env.ADMIN_PASSWORD || '').trim() || 'gemeinde',
  adminPasswordReset = (process.env.ADMIN_PASSWORD_RESET || '').trim(),
  sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
} = {}) {
  // Laufende Uploads überleben einen Neustart (z. B. ein Update bei Render).
  // Nur Reste, die älter als einen Tag sind, werden weggeräumt.
  const tmpDir = path.join(uploadDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const name of fs.readdirSync(tmpDir)) {
    const full = path.join(tmpDir, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) fs.rmSync(full, { force: true });
    } catch {}
  }
  const store = createStore(path.join(dataDir, 'db.json'), { initialAdminPassword: adminPassword });
  if (store.createdAdmin) {
    console.log('ℹ️  Benutzer "admin" wurde neu angelegt – Passwort ist der Wert von ADMIN_PASSWORD.');
  } else if (process.env.ADMIN_PASSWORD) {
    console.log('ℹ️  Es gibt schon einen Admin – ADMIN_PASSWORD wird ignoriert (gilt nur beim allerersten Start). Zum Zurücksetzen ADMIN_PASSWORD_RESET verwenden.');
  }
  if (adminPasswordReset) {
    // Notfall: Passwort vergessen → ADMIN_PASSWORD_RESET setzen, neu starten, anmelden, Variable wieder löschen.
    try {
      if (store.applyAdminReset(adminPasswordReset)) {
        console.warn('⚠️  Das Passwort des Benutzers "admin" wurde über ADMIN_PASSWORD_RESET zurückgesetzt. Bitte die Variable jetzt wieder entfernen!');
      } else {
        console.log('ℹ️  ADMIN_PASSWORD_RESET wurde schon früher angewendet und wird ignoriert. Die Variable kann gelöscht werden.');
      }
    } catch (err) {
      console.error(`❌ ADMIN_PASSWORD_RESET wurde nicht übernommen: ${err.message}`);
    }
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

  // Einfacher Schutz gegen Passwort-Raten: nach 10 Fehlversuchen 5 Minuten Pause (pro IP).
  const LOCK_MS = 5 * 60 * 1000;
  const failures = new Map();
  // Gibt die verbleibenden Wartesekunden zurück (0 = darf versuchen).
  function lockedSeconds(ip) {
    const now = Date.now();
    const list = (failures.get(ip) || []).filter((t) => now - t < LOCK_MS);
    failures.set(ip, list);
    if (list.length < 10) return 0;
    return Math.ceil((list[list.length - 10] + LOCK_MS - now) / 1000);
  }

  // Echte Besucher-IP (hinter Render/Cloudflare) – und pro Konto zählen,
  // damit sich nicht alle gegenseitig aussperren.
  const attemptKey = (req) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || req.ip;
    const account = String((req.body && req.body.username) || 'gemeinde').trim().toLowerCase();
    return `${ip}|${account}`;
  };

  app.post('/api/login', (req, res) => {
    const key = attemptKey(req);
    const wait = lockedSeconds(key);
    if (wait) {
      const min = Math.ceil(wait / 60);
      return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${min} ${min === 1 ? 'Minute' : 'Minuten'} erneut probieren.` });
    }
    const { username, password } = req.body || {};
    // Ohne Benutzername: Anmeldung mit dem gemeinsamen Gemeinde-Passwort.
    const user = username ? store.authenticate(username, password) : store.authenticateMember(password);
    if (!user) {
      failures.get(key).push(Date.now());
      return res.status(401).json({
        error: username ? 'Benutzername oder Passwort ist falsch.' : 'Das Gemeinde-Passwort ist falsch.',
      });
    }
    failures.delete(key);
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

  // Für die Anmeldeseite: Gibt es den Gemeinde-Zugang?
  app.get('/api/login-options', (req, res) => res.json({ memberLogin: store.memberAccessEnabled() }));

  app.get('/api/settings/member', requireAdmin, (req, res) => res.json({ enabled: store.memberAccessEnabled() }));
  app.put('/api/settings/member', requireAdmin, (req, res) => {
    const { password, enabled } = req.body || {};
    try {
      store.setMemberPassword(enabled === false ? null : password);
      res.json({ enabled: store.memberAccessEnabled() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/me/password', requireLogin, (req, res) => {
    if (req.user.shared) {
      return res.status(400).json({ error: 'Das Gemeinde-Passwort kann nur ein Admin ändern.' });
    }
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
    return { total, free, used: total !== null ? total - free : null, byType, persistent: !ephemeralStorage() };
  }));

  // ---------- Benutzer (nur Admin) ----------

  app.get('/api/users', requireAdmin, handle(() => store.listUsers()));
  app.post('/api/users', requireAdmin, handle((req, res) => {
    res.status(201).json(store.createUser(req.body || {}));
  }));
  app.put('/api/users/:id', requireAdmin, handle((req) => {
    const target = store.getUser(req.params.id);
    // Das Passwort des Haupt-Admins kann nur er selbst ändern (unter „Konto“) – oder per ADMIN_PASSWORD_RESET.
    if (target && target.username === 'admin' && req.user.id !== target.id && (req.body || {}).password) {
      throw new Error('Das Passwort des Haupt-Admins kann nur er selbst ändern.');
    }
    return store.updateUser(req.params.id, req.body || {});
  }));
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

  // ---------- Vers des Tages ----------

  app.get('/api/verse', requireLogin, handle((req) => store.verseOfDay(validDate(req.query.date) || undefined)));
  app.put('/api/verse', requireAdmin, handle((req) => store.setVerse(req.body || {})));
  app.delete('/api/verse/:date', requireAdmin, handle((req) => store.resetVerse(req.params.date)));

  // ---------- Gebetsanliegen ----------
  // Alle Angemeldeten sehen sie, nur Admins schreiben, ändern und löschen sie.

  app.get('/api/prayers', requireLogin, handle(() => store.listPrayers()));
  app.post('/api/prayers', requireAdmin, handle((req, res) => {
    res.status(201).json(store.createPrayer(req.body || {}, req.user));
  }));
  app.put('/api/prayers/:id', requireAdmin, handle((req) => store.updatePrayer(req.params.id, req.body || {})));
  app.delete('/api/prayers/:id', requireAdmin, handle((req) => store.deletePrayer(req.params.id) && { ok: true }));

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
        cb(null, `${crypto.randomUUID()}${safeExt(file.originalname)}`);
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

  // ---------- Hochladen in Stücken (schneller und robust bei wackeliger Verbindung) ----------
  //
  // 1. POST /api/uploads                  → Upload anmelden, bekommt eine ID
  // 2. PUT  /api/uploads/:id/chunks/:nr   → Stücke (z. B. 8 MB) hochladen, gern mehrere gleichzeitig
  // 3. POST /api/uploads/:id/complete     → fertigstellen, Eintrag wird angelegt

  const CHUNK_MAX = 16 * 1024 * 1024;
  const sessions = new Map();
  const sessionFile = (id) => path.join(tmpDir, `${id}.json`);

  // Fortschritt jedes Uploads wird in einer kleinen Datei gemerkt, damit er einen Neustart übersteht.
  function saveSession(u) {
    const { received, ...rest } = u;
    fs.writeFileSync(sessionFile(u.id), JSON.stringify({ ...rest, received: [...(received || [])] }));
  }

  function getSession(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    if (sessions.has(id)) return sessions.get(id);
    try {
      const data = JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'));
      const u = { ...data, received: new Set(data.received || []) };
      sessions.set(id, u);
      return u;
    } catch {
      return null;
    }
  }

  function dropSession(u) {
    sessions.delete(u.id);
    fs.rmSync(sessionFile(u.id), { force: true });
    fs.rmSync(u.tmp, { force: true });
  }

  // Abgebrochene Uploads nach einem Tag aufräumen.
  const cleanup = setInterval(() => {
    for (const u of sessions.values()) {
      if (Date.now() - u.touched > 24 * 3600 * 1000) dropSession(u);
    }
  }, 3600 * 1000);
  cleanup.unref();

  app.post('/api/uploads', requireAdmin, (req, res) => {
    const b = req.body || {};
    if (!store.getFolder(b.folderId)) return res.status(404).json({ error: 'Ordner nicht gefunden.' });
    const name = String(b.name || '').slice(0, 255);
    const size = Number(b.size);
    const chunkSize = Number(b.chunkSize);
    const type = fileType({ originalname: name, mimetype: b.mime });
    if (!type) return res.status(400).json({ error: `Dateityp nicht erlaubt: ${name}` });
    if (!Number.isInteger(size) || size <= 0) return res.status(400).json({ error: `Die Datei ist leer: ${name}` });
    if (size > MAX_UPLOAD_MB * 1024 * 1024) return res.status(400).json({ error: `Datei zu groß (max. ${MAX_UPLOAD_MB} MB).` });
    if (!Number.isInteger(chunkSize) || chunkSize < 64 * 1024 || chunkSize > CHUNK_MAX) {
      return res.status(400).json({ error: 'Ungültige Stückgröße.' });
    }
    const id = crypto.randomUUID();
    const tmp = path.join(tmpDir, `${id}.part`);
    fs.writeFileSync(tmp, '');
    const u = {
      id, tmp, type, name, size, chunkSize,
      chunks: Math.ceil(size / chunkSize),
      received: new Set(),
      folderId: b.folderId,
      mime: String(b.mime || ''),
      meta: {
        title: b.title, date: b.date, description: b.description, speaker: b.speaker, bibleText: b.bibleText,
        duration: b.duration,
      },
      userId: req.user.id,
      touched: Date.now(),
      completedItem: null,
    };
    sessions.set(id, u);
    saveSession(u);
    res.status(201).json({ id, chunks: u.chunks });
  });

  // Welche Stücke sind schon da? (zum Fortsetzen nach einer Unterbrechung)
  app.get('/api/uploads/:id', requireAdmin, (req, res) => {
    const u = getSession(req.params.id);
    if (!u) return res.status(404).json({ error: 'Upload nicht gefunden – bitte neu starten.' });
    res.json({ id: u.id, chunks: u.chunks, received: [...u.received], completed: Boolean(u.completedItem) });
  });

  app.put(
    '/api/uploads/:id/chunks/:index',
    requireAdmin,
    express.raw({ type: () => true, limit: CHUNK_MAX }),
    async (req, res) => {
      const u = getSession(req.params.id);
      if (!u) return res.status(404).json({ error: 'Upload nicht gefunden – bitte neu starten.' });
      if (u.completedItem) return res.json({ ok: true });
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0 || index >= u.chunks) {
        return res.status(400).json({ error: 'Ungültiges Stück.' });
      }
      const expected = index === u.chunks - 1 ? u.size - index * u.chunkSize : u.chunkSize;
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length !== expected) return res.status(400).json({ error: 'Stück unvollständig – wird wiederholt.' });
      const fh = await fs.promises.open(u.tmp, 'r+');
      try {
        await fh.write(body, 0, body.length, index * u.chunkSize);
        await fh.sync();
      } finally {
        await fh.close();
      }
      u.received.add(index);
      u.touched = Date.now();
      saveSession(u);
      res.json({ ok: true });
    }
  );

  app.post('/api/uploads/:id/complete', requireAdmin, (req, res) => {
    const u = getSession(req.params.id);
    if (!u) return res.status(404).json({ error: 'Upload nicht gefunden – bitte neu starten.' });
    // Schon fertig (z. B. Antwort ging unterwegs verloren und es wird wiederholt) → einfach bestätigen.
    if (u.completedItem) {
      const item = store.getItem(u.completedItem);
      return item ? res.status(201).json(item) : res.status(404).json({ error: 'Upload nicht gefunden.' });
    }
    let missing = [];
    for (let i = 0; i < u.chunks; i++) if (!u.received.has(i)) missing.push(i);
    if (missing.length || fs.statSync(u.tmp).size !== u.size) {
      return res.status(409).json({ error: 'Es fehlen noch Teile der Datei.', missing });
    }
    const date = validDate(u.meta.date) || today();
    const file = `${date.slice(0, 4)}/${date.slice(5, 7)}/${crypto.randomUUID()}${safeExt(u.name)}`;
    try {
      const [item] = store.createItems(u.folderId, [{
        ...u.meta, type: u.type, date, mime: u.mime, size: u.size, originalName: u.name, file,
      }], store.getUser(u.userId) || req.user);
      const target = path.join(uploadDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(u.tmp, target);
      u.completedItem = item.id;
      u.touched = Date.now();
      saveSession(u);
      res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

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
  if (ephemeralStorage()) {
    console.error('❌ ACHTUNG: Kein dauerhafter Speicher (Disk) eingerichtet! Bei jedem Neustart oder Update gehen ALLE Daten verloren (Benutzer, Passwörter, Aufnahmen). Bitte eine Disk unter /var/data anlegen – siehe ANLEITUNG-RENDER.md.');
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('ℹ️  SESSION_SECRET ist nicht gesetzt – nach jedem Neustart muss man sich neu anmelden.');
  }
  createApp().listen(PORT, () => {
    console.log(`Gemeinde-Mediathek läuft auf http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
