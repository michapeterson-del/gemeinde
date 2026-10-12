'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword, checkPassword } = require('./auth');
const { EVENT_CATEGORIES, REPEATS, occurrences, repeatLabel, addDays } = require('./news');
const { verseForDate } = require('./verses');

// Ordnerstruktur, die beim allerersten Start angelegt wird.
// Alles lässt sich danach im Admin-Bereich umbenennen, verschieben, löschen oder ergänzen.
const DEFAULT_FOLDERS = [
  {
    name: 'Bilder', icon: '📷', color: '#e0703a', description: 'Fotos aus unserem Gemeindeleben.',
    children: [
      {
        name: 'Jugend', icon: '🔥', color: '#e0703a',
        children: [
          { name: 'Jugendfreizeit', icon: '⛺' },
          { name: 'Jugendkurzfreizeit', icon: '🏕️' },
        ],
      },
      { name: 'Kinder', icon: '🌈', color: '#2fa36b', children: [{ name: 'Kindertag', icon: '🎈' }] },
      { name: 'Gemeindefeste', icon: '🎉', color: '#d4a017' },
    ],
  },
  { name: 'Gottesdienste', icon: '⛪', color: '#7c5cbf', kind: 'sermons', description: 'Aufnahmen unserer Gottesdienste.' },
  { name: 'Dokumente', icon: '📄', color: '#3a7bd5', kind: 'documents', description: 'Wichtige Dokumente zum Ansehen und Herunterladen.' },
];

// admin = darf alles, member = nur ansehen
const ROLES = ['admin', 'member'];
// Ordner-Arten: normal, Gottesdienste (Liste zum Abspielen), Dokumente (Liste zum Herunterladen)
const KINDS = ['normal', 'sermons', 'documents'];
const COLOR = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(value, max = 500) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  const v = str(value, 10);
  if (!DATE.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? v : null;
}

// Vergleichswert für unbekannte Benutzernamen, damit die Prüfung gleich lange dauert.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

// Der beim ersten Start angelegte Haupt-Admin – kann nicht gelöscht oder herabgestuft werden.
const MAIN_ADMIN = 'admin';

// Gemeinsamer Gemeinde-Zugang: ein „virtueller“ Benutzer mit Rolle Normal.
const MEMBER_ID = 'gemeinde';

const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

function createStore(file, { initialAdminPassword = 'gemeinde' } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // Ältere Datenbank-Versionen (Kategorien/Alben) werden nicht übernommen – neu anfangen.
  if (!Array.isArray(db.folders) || !Array.isArray(db.items) || !Array.isArray(db.users)) {
    db = { folders: [], items: [], users: [] };
    const add = (list, parentId, inherited = {}) => {
      for (const def of list) {
        const folder = newFolder({ ...inherited, ...def, parentId });
        db.folders.push(folder);
        if (def.children) add(def.children, folder.id, { color: folder.color });
      }
    };
    add(DEFAULT_FOLDERS, null);
  }
  if (!Array.isArray(db.news)) db.news = [];
  // Eigener Hauptbereich „Dokumente“: vorhandenen „Texte & Dokumente“-Ordner umwandeln oder neu anlegen
  if (!db.folders.some((f) => f.kind === 'documents')) {
    const old = db.folders.find((f) => !f.parentId && /dokument/i.test(f.name));
    if (old) {
      old.kind = 'documents';
      if (old.name === 'Texte & Dokumente') old.name = 'Dokumente';
      if (old.description === 'Berichte, Ankündigungen und Dokumente.') old.description = 'Wichtige Dokumente zum Ansehen und Herunterladen.';
    } else {
      db.folders.push(newFolder({ name: 'Dokumente', kind: 'documents', description: 'Wichtige Dokumente zum Ansehen und Herunterladen.', parentId: null }));
    }
  }
  if (!Array.isArray(db.prayers)) db.prayers = [];
  if (!db.verses || typeof db.verses !== 'object') db.verses = {}; // eigene Verse je Datum
  // Vereinfachung: Eingereichte (ungeprüfte) und private Anliegen aus der früheren Version entfernen,
  // die übrigen ohne Status/Zähler weiterführen. Die frühere Rolle „Gemeindeleiter“ wird zu „Normal“.
  db.prayers = db.prayers
    .filter((p) => p.status !== 'pending' && !p.private)
    .map(({ id, text, name, createdAt, createdBy }) => ({ id, text, name: name || '', createdAt, createdBy: createdBy || '' }));
  for (const u of db.users) if (!ROLES.includes(u.role)) u.role = 'member';
  if (!db.settings) db.settings = { memberPasswordHash: null, memberVersion: 0 };
  let createdAdmin = false;
  if (!db.users.some((u) => u.role === 'admin')) {
    db.users.push(newUser({ name: 'Administrator', username: 'admin', password: initialAdminPassword, role: 'admin' }));
    createdAdmin = true;
  }
  save();

  function save() {
    // Erst in eine temporäre Datei schreiben, dann umbenennen – so geht nichts kaputt,
    // falls der Server mitten im Schreiben abstürzt.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }

  // ---------- Ordner ----------

  function newFolder(input) {
    const name = str(input.name, 100);
    if (!name) throw new Error('Bitte einen Ordnernamen angeben.');
    return {
      id: crypto.randomUUID(),
      parentId: input.parentId || null,
      name,
      icon: str(input.icon, 8) || '📁',
      color: COLOR.test(input.color || '') ? input.color : '#7c5cbf',
      description: str(input.description, 1000),
      kind: KINDS.includes(input.kind) ? input.kind : 'normal',
      coverItemId: null,
      createdAt: new Date().toISOString(),
    };
  }

  function getFolder(id) {
    return db.folders.find((f) => f.id === id) || null;
  }

  function descendantIds(id) {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      for (const f of db.folders) if (f.parentId === ids[i]) ids.push(f.id);
    }
    return ids;
  }

  function folderPath(id) {
    const chain = [];
    let f = getFolder(id);
    while (f && chain.length < 50) {
      chain.unshift({ id: f.id, name: f.name, icon: f.icon });
      f = f.parentId ? getFolder(f.parentId) : null;
    }
    return chain;
  }

  function folderSummary(f) {
    const ids = new Set(descendantIds(f.id));
    const all = db.items.filter((i) => ids.has(i.folderId));
    const cover =
      db.items.find((i) => i.id === f.coverItemId) ||
      all.filter((i) => i.type === 'image').sort(byDateDesc)[0] ||
      null;
    return {
      ...f,
      childCount: db.folders.filter((c) => c.parentId === f.id).length,
      itemCount: all.length,
      cover: cover ? cover.file : null,
    };
  }

  function checkParent(parentId, selfId) {
    if (!parentId) return null;
    if (!getFolder(parentId)) throw new Error('Übergeordneter Ordner nicht gefunden.');
    if (selfId && descendantIds(selfId).includes(parentId)) {
      throw new Error('Ein Ordner kann nicht in sich selbst verschoben werden.');
    }
    return parentId;
  }

  // ---------- Einträge (Bilder, Aufnahmen, Dokumente, Texte) ----------

  function itemHaystack(item) {
    const pathNames = folderPath(item.folderId).map((p) => p.name);
    return [item.title, item.description, item.speaker, item.bibleText, item.text, item.originalName, item.date, ...pathNames]
      .join(' ')
      .toLowerCase();
  }

  function withPath(item) {
    return { ...item, path: folderPath(item.folderId) };
  }

  // ---------- Benutzer ----------

  function newUser(input) {
    const username = str(input.username, 50).toLowerCase();
    if (!/^[a-z0-9._-]{2,50}$/.test(username)) {
      throw new Error('Benutzername: mindestens 2 Zeichen, nur Buchstaben, Zahlen, Punkt, Minus und Unterstrich.');
    }
    if (username === MEMBER_ID) throw new Error('Der Benutzername „gemeinde“ ist für den Gemeinde-Zugang reserviert.');
    if (db.users.some((u) => u.username === username)) throw new Error('Diesen Benutzernamen gibt es schon.');
    if (String(input.password || '').length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
    return {
      id: crypto.randomUUID(),
      username,
      name: str(input.name, 100) || username,
      role: ROLES.includes(input.role) ? input.role : 'member',
      passwordHash: hashPassword(input.password),
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
    };
  }

  const publicUser = ({ passwordHash, tokenVersion, ...u }) => ({ ...u, main: u.username === MAIN_ADMIN });

  function memberUser() {
    if (!db.settings.memberPasswordHash) return null;
    return { id: MEMBER_ID, username: MEMBER_ID, name: 'Gemeinde', role: 'member', shared: true, tokenVersion: db.settings.memberVersion };
  }

  // ---------- Aktuelles: Termine und Vermeldungen ----------

  function newsFields(input, existing = {}) {
    const pick = (key, max) => (input[key] !== undefined ? str(input[key], max) : existing[key] || '');
    const type = existing.type || (input.type === 'event' ? 'event' : 'announcement');
    const title = pick('title', 200);
    if (!title) throw new Error('Bitte einen Titel angeben.');
    const date = input.date !== undefined ? validDate(input.date) : existing.date;
    if (!date) throw new Error(type === 'event' ? 'Bitte ein gültiges Datum angeben.' : 'Ungültiges Datum.');
    const time = pick('time', 5);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Ungültige Uhrzeit.');
    const endTime = pick('endTime', 5);
    if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error('Ungültige Uhrzeit.');
    const optionalDate = (key) => {
      const raw = input[key] !== undefined ? str(input[key], 10) : existing[key] || '';
      if (!raw) return '';
      const v = validDate(raw);
      if (!v) throw new Error('Ungültiges Datum.');
      return v;
    };
    const fields = {
      type,
      title,
      text: pick('text', 10000),
      date,
      pinned: input.pinned !== undefined ? Boolean(input.pinned) : Boolean(existing.pinned),
    };
    if (type === 'event') {
      const category = input.category !== undefined ? str(input.category, 30) : existing.category;
      const repeat = input.repeat !== undefined ? str(input.repeat, 20) : existing.repeat || 'none';
      Object.assign(fields, {
        category: EVENT_CATEGORIES[category] ? category : 'sonstiges',
        time,
        endTime,
        location: pick('location', 200),
        repeat: REPEATS.includes(repeat) ? repeat : 'none',
        repeatUntil: optionalDate('repeatUntil'),
        cancelled: Array.isArray(input.cancelled)
          ? [...new Set(input.cancelled.map(validDate).filter(Boolean))].slice(0, 200)
          : existing.cancelled || [],
      });
    } else {
      // Vermeldungen werden bis zum Datum „anzeigen bis“ gezeigt (leer = 4 Wochen).
      fields.until = optionalDate('until');
    }
    return fields;
  }

  const announcementEnd = (n) => n.until || addDays(n.date, 28);

  return {
    createdAdmin,

    // Ordner
    listFolders() {
      return [...db.folders].sort(byName).map(folderSummary);
    },

    getFolder,

    getFolderView(id) {
      const f = getFolder(id);
      if (!f) return null;
      return {
        folder: folderSummary(f),
        path: folderPath(id),
        children: db.folders.filter((c) => c.parentId === id).sort(byName).map(folderSummary),
        items: db.items.filter((i) => i.folderId === id).sort(byDateDesc),
      };
    },

    rootView() {
      return {
        children: db.folders.filter((f) => !f.parentId).sort(byName).map(folderSummary),
      };
    },

    createFolder(input) {
      const folder = newFolder({ ...input, parentId: checkParent(input.parentId || null) });
      db.folders.push(folder);
      save();
      return folderSummary(folder);
    },

    updateFolder(id, input) {
      const f = getFolder(id);
      if (!f) return null;
      if (input.name !== undefined) {
        const name = str(input.name, 100);
        if (!name) throw new Error('Bitte einen Ordnernamen angeben.');
        f.name = name;
      }
      if (input.parentId !== undefined) f.parentId = checkParent(input.parentId || null, id);
      if (input.icon !== undefined) f.icon = str(input.icon, 8) || f.icon;
      if (input.color !== undefined && COLOR.test(input.color)) f.color = input.color;
      if (input.description !== undefined) f.description = str(input.description, 1000);
      if (input.kind !== undefined) f.kind = KINDS.includes(input.kind) ? input.kind : 'normal';
      if (input.coverItemId !== undefined) f.coverItemId = str(input.coverItemId, 60) || null;
      save();
      return folderSummary(f);
    },

    // Löscht den Ordner samt Unterordnern und gibt die entfernten Einträge zurück,
    // damit der Server die Dateien von der Festplatte löschen kann.
    deleteFolder(id) {
      if (!getFolder(id)) return null;
      const ids = new Set(descendantIds(id));
      const removed = db.items.filter((i) => ids.has(i.folderId));
      db.items = db.items.filter((i) => !ids.has(i.folderId));
      db.folders = db.folders.filter((f) => !ids.has(f.id));
      save();
      return removed;
    },

    // Einträge
    searchItems({ q, folderId, type, limit, sort } = {}) {
      let list = db.items;
      if (folderId) {
        const ids = new Set(descendantIds(folderId));
        list = list.filter((i) => ids.has(i.folderId));
      }
      if (type) list = list.filter((i) => i.type === type);
      if (q) {
        const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter((i) => {
          const hay = itemHaystack(i);
          return terms.every((t) => hay.includes(t));
        });
      }
      list = [...list].sort(sort === 'recent' ? (a, b) => b.createdAt.localeCompare(a.createdAt) : byDateDesc);
      if (limit) list = list.slice(0, limit);
      return list.map(withPath);
    },

    searchFolders(q) {
      const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      return db.folders
        .filter((f) => {
          const hay = `${f.name} ${f.description}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .sort(byName)
        .map((f) => ({ ...folderSummary(f), path: folderPath(f.id) }));
    },

    getItem(id) {
      return db.items.find((i) => i.id === id) || null;
    },

    createItems(folderId, entries, user) {
      if (!getFolder(folderId)) throw new Error('Ordner nicht gefunden.');
      const created = entries.map((e) => {
        const title = str(e.title, 200);
        if (e.type === 'text' && !title && !str(e.text, 20000)) throw new Error('Der Text ist leer.');
        return {
          id: crypto.randomUUID(),
          folderId,
          type: e.type,
          title,
          date: validDate(e.date) || today(),
          description: str(e.description, 5000),
          speaker: str(e.speaker, 200),
          bibleText: str(e.bibleText, 200),
          text: e.type === 'text' ? str(e.text, 20000) : '',
          file: e.file || null,
          mime: e.mime || null,
          size: e.size || 0,
          originalName: str(e.originalName, 255),
          duration: Number(e.duration) > 0 ? Math.round(Number(e.duration)) : null,
          createdAt: new Date().toISOString(),
          createdBy: user ? user.name : '',
        };
      });
      db.items.push(...created);
      save();
      return created;
    },

    updateItem(id, input) {
      const item = db.items.find((i) => i.id === id);
      if (!item) return null;
      if (input.folderId !== undefined) {
        if (!getFolder(input.folderId)) throw new Error('Ordner nicht gefunden.');
        item.folderId = input.folderId;
      }
      if (input.date !== undefined) {
        const date = validDate(input.date);
        if (!date) throw new Error('Ungültiges Datum.');
        item.date = date;
      }
      for (const [key, max] of [['title', 200], ['description', 5000], ['speaker', 200], ['bibleText', 200]]) {
        if (input[key] !== undefined) item[key] = str(input[key], max);
      }
      if (item.type === 'text' && input.text !== undefined) item.text = str(input.text, 20000);
      save();
      return item;
    },

    deleteItem(id) {
      const item = db.items.find((i) => i.id === id);
      if (!item) return null;
      db.items = db.items.filter((i) => i.id !== id);
      for (const f of db.folders) if (f.coverItemId === id) f.coverItemId = null;
      save();
      return item;
    },

    // Aktuelles
    // Gebetsanliegen – werden nur von Admins geschrieben und später einfach gelöscht.
    listPrayers() {
      return [...db.prayers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    createPrayer(input, user) {
      const text = str(input.text, 2000);
      if (!text) throw new Error('Bitte das Gebetsanliegen eingeben.');
      const prayer = {
        id: crypto.randomUUID(),
        text,
        name: str(input.name, 100),
        createdAt: new Date().toISOString(),
        createdBy: user ? user.name : '',
      };
      db.prayers.push(prayer);
      save();
      return prayer;
    },

    updatePrayer(id, input) {
      const p = db.prayers.find((x) => x.id === id);
      if (!p) return null;
      if (input.text !== undefined) {
        const text = str(input.text, 2000);
        if (!text) throw new Error('Das Gebetsanliegen ist leer.');
        p.text = text;
      }
      if (input.name !== undefined) p.name = str(input.name, 100);
      save();
      return p;
    },

    deletePrayer(id) {
      const before = db.prayers.length;
      db.prayers = db.prayers.filter((p) => p.id !== id);
      save();
      return db.prayers.length < before;
    },

    // Vers des Tages: eigener Vers für das Datum, sonst automatisch aus der Liste
    verseOfDay(date = today()) {
      const own = db.verses[date];
      if (own) return { date, ...own, custom: true };
      return { date, ...verseForDate(date), custom: false };
    },

    setVerse(input) {
      const date = validDate(input.date) || today();
      const text = str(input.text, 1000);
      const ref = str(input.ref, 100);
      if (!text) throw new Error('Bitte den Verstext eingeben.');
      if (!ref) throw new Error('Bitte die Bibelstelle angeben, z. B. „Psalm 23,1“.');
      db.verses[date] = { text, ref };
      // Alte Einträge (älter als ein Jahr) aufräumen
      for (const d of Object.keys(db.verses)) if (d < addDays(today(), -366)) delete db.verses[d];
      save();
      return this.verseOfDay(date);
    },

    resetVerse(date) {
      const d = validDate(date);
      if (!d) throw new Error('Ungültiges Datum.');
      delete db.verses[d];
      save();
      return this.verseOfDay(d);
    },

    eventCategories: EVENT_CATEGORIES,

    listNewsEntries() {
      return [...db.news]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((n) => ({ ...n, repeatLabel: n.type === 'event' ? repeatLabel(n) : '' }));
    },

    currentNews({ from = today(), days = 120 } = {}) {
      const to = addDays(from, days);
      const announcements = db.news
        .filter((n) => n.type === 'announcement' && n.date <= from && announcementEnd(n) >= from)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date.localeCompare(a.date));
      const events = [];
      for (const e of db.news.filter((n) => n.type === 'event')) {
        for (const date of occurrences(e, from, to)) {
          events.push({
            ...e,
            seriesDate: e.date,
            date,
            isCancelled: (e.cancelled || []).includes(date),
            repeatLabel: repeatLabel(e),
          });
        }
      }
      events.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
      return { today: from, announcements, events };
    },

    createNews(input, user) {
      const entry = {
        id: crypto.randomUUID(),
        ...newsFields(input),
        createdAt: new Date().toISOString(),
        createdBy: user ? user.name : '',
      };
      db.news.push(entry);
      save();
      return entry;
    },

    updateNews(id, input) {
      const entry = db.news.find((n) => n.id === id);
      if (!entry) return null;
      Object.assign(entry, newsFields(input, entry));
      save();
      return entry;
    },

    deleteNews(id) {
      const before = db.news.length;
      db.news = db.news.filter((n) => n.id !== id);
      save();
      return db.news.length < before;
    },

    // Benutzer
    listUsers() {
      return [...db.users].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(publicUser);
    },

    // Setzt das Passwort von "admin" (legt den Benutzer an, falls er fehlt) und macht ihn zum Admin.
    // Wie resetAdmin, aber jeder Wert wird nur EINMAL angewendet. So setzt ein vergessenes
    // ADMIN_PASSWORD_RESET das Passwort nicht bei jedem Update wieder zurück.
    applyAdminReset(password) {
      if (db.settings.appliedReset && checkPassword(password, db.settings.appliedReset)) return false;
      this.resetAdmin(password);
      db.settings.appliedReset = hashPassword(password);
      save();
      return true;
    },

    resetAdmin(password) {
      const user = db.users.find((u) => u.username === 'admin');
      if (!user) {
        db.users.push(newUser({ name: 'Administrator', username: 'admin', password, role: 'admin' }));
        save();
        return;
      } else {
        if (String(password).length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
        user.passwordHash = hashPassword(password);
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.role = 'admin';
      }
      save();
    },

    getUser(id) {
      if (id === MEMBER_ID) return memberUser();
      return db.users.find((u) => u.id === id) || null;
    },

    // Gemeinde-Zugang
    memberAccessEnabled() {
      return Boolean(db.settings.memberPasswordHash);
    },

    authenticateMember(password) {
      const ok = checkPassword(password, db.settings.memberPasswordHash || DUMMY_HASH);
      return ok && db.settings.memberPasswordHash ? memberUser() : null;
    },

    // Neues Passwort setzen (meldet alle Mitglieder ab) oder mit null ausschalten.
    setMemberPassword(password) {
      if (password !== null && String(password || '').length < 6) {
        throw new Error('Das Gemeinde-Passwort muss mindestens 6 Zeichen haben.');
      }
      db.settings.memberPasswordHash = password === null ? null : hashPassword(password);
      db.settings.memberVersion = (db.settings.memberVersion || 0) + 1;
      save();
    },

    publicUser,

    authenticate(username, password) {
      const user = db.users.find((u) => u.username === str(username, 50).toLowerCase());
      const ok = checkPassword(password, user ? user.passwordHash : DUMMY_HASH);
      return ok && user ? user : null;
    },

    createUser(input) {
      const user = newUser(input);
      db.users.push(user);
      save();
      return publicUser(user);
    },

    updateUser(id, input) {
      const user = db.users.find((u) => u.id === id);
      if (!user) return null;
      if (input.name !== undefined) user.name = str(input.name, 100) || user.name;
      if (input.role !== undefined && ROLES.includes(input.role) && input.role !== user.role) {
        if (user.username === MAIN_ADMIN) throw new Error('Der Haupt-Admin „admin“ bleibt immer Admin.');
        if (user.role === 'admin' && db.users.filter((u) => u.role === 'admin').length === 1) {
          throw new Error('Es muss mindestens einen Admin geben.');
        }
        user.role = input.role;
      }
      if (input.password) {
        if (String(input.password).length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
        user.passwordHash = hashPassword(input.password);
        user.tokenVersion = (user.tokenVersion || 0) + 1;
      }
      save();
      return publicUser(user);
    },

    deleteUser(id) {
      const user = db.users.find((u) => u.id === id);
      if (!user) return false;
      if (user.username === MAIN_ADMIN) throw new Error('Der Haupt-Admin „admin“ kann nicht gelöscht werden.');
      if (user.role === 'admin' && db.users.filter((u) => u.role === 'admin').length === 1) {
        throw new Error('Der letzte Admin kann nicht gelöscht werden.');
      }
      db.users = db.users.filter((u) => u.id !== id);
      save();
      return true;
    },
  };
}

module.exports = { createStore, validDate, today };
