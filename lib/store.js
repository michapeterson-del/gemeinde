'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword, checkPassword } = require('./auth');

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
  { name: 'Gottesdienste', icon: '⛪', color: '#7c5cbf', kind: 'sermons', description: 'Predigten und Aufnahmen unserer Gottesdienste.' },
  { name: 'Texte & Dokumente', icon: '📝', color: '#3a7bd5', description: 'Berichte, Ankündigungen und Dokumente.' },
];

const ROLES = ['admin', 'member'];
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
  if (!db.users.some((u) => u.role === 'admin')) {
    db.users.push(newUser({ name: 'Administrator', username: 'admin', password: initialAdminPassword, role: 'admin' }));
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
      kind: input.kind === 'sermons' ? 'sermons' : 'normal',
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

  const publicUser = ({ passwordHash, tokenVersion, ...u }) => u;

  return {
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
      if (input.kind !== undefined) f.kind = input.kind === 'sermons' ? 'sermons' : 'normal';
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

    // Benutzer
    listUsers() {
      return [...db.users].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(publicUser);
    },

    getUser(id) {
      return db.users.find((u) => u.id === id) || null;
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
