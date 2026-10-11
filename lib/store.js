'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Standard-Kategorien, die beim ersten Start angelegt werden.
// Sie lassen sich später im Verwaltungsbereich ändern oder ergänzen.
const DEFAULT_CATEGORIES = [
  { id: 'gottesdienste', name: 'Gottesdienste', icon: '⛪', color: '#7c5cbf', description: 'Predigten und Aufnahmen unserer Gottesdienste.', sermon: true },
  { id: 'jugend', name: 'Jugend', icon: '🔥', color: '#e0703a', description: 'Jugendabende, Freizeiten und Aktionen der Jugend.' },
  { id: 'kinder', name: 'Kinder', icon: '🌈', color: '#2fa36b', description: 'Kinderstunde, Kinderbibeltage und mehr.' },
  { id: 'veranstaltungen', name: 'Gemeindetage & Feste', icon: '🎉', color: '#d4a017', description: 'Gemeindefeste, Ausflüge, Taufen und besondere Tage.' },
  { id: 'musik', name: 'Musik & Chor', icon: '🎵', color: '#3a7bd5', description: 'Chor, Band und musikalische Beiträge.' },
];

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function str(value, max = 500) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db;
  if (fs.existsSync(file)) {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    db = { categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), albums: [], media: [] };
    save();
  }

  function save() {
    // Erst in eine temporäre Datei schreiben, dann umbenennen – so geht nichts kaputt,
    // falls der Server mitten im Schreiben abstürzt.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }

  function withMedia(album) {
    const media = db.media
      .filter((m) => m.albumId === album.id)
      .sort((a, b) => a.order - b.order);
    const cover = media.find((m) => m.id === album.coverId) || media.find((m) => m.type === 'image') || null;
    const counts = { image: 0, audio: 0, video: 0 };
    for (const m of media) counts[m.type] = (counts[m.type] || 0) + 1;
    return { ...album, cover: cover ? cover.file : null, counts, media };
  }

  function summary(album) {
    const { media, ...rest } = withMedia(album);
    return rest;
  }

  function albumFields(input, existing = {}) {
    const category = input.category !== undefined ? str(input.category, 60) : existing.category;
    if (!db.categories.some((c) => c.id === category)) throw new Error('Bitte eine gültige Kategorie wählen.');
    const title = input.title !== undefined ? str(input.title, 200) : existing.title;
    if (!title) throw new Error('Bitte einen Titel angeben.');
    const date = input.date !== undefined ? str(input.date, 10) : existing.date;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ungültiges Datum.');
    const pick = (key, max) => (input[key] !== undefined ? str(input[key], max) : existing[key] || '');
    return {
      category,
      title,
      date: date || new Date().toISOString().slice(0, 10),
      description: pick('description', 5000),
      speaker: pick('speaker', 200),
      bibleText: pick('bibleText', 200),
      series: pick('series', 200),
      location: pick('location', 200),
      tags: Array.isArray(input.tags)
        ? input.tags.map((t) => str(t, 50)).filter(Boolean).slice(0, 20)
        : existing.tags || [],
      coverId: input.coverId !== undefined ? str(input.coverId, 60) || null : existing.coverId || null,
    };
  }

  return {
    listCategories() {
      return db.categories;
    },

    createCategory(input) {
      const name = str(input.name, 80);
      if (!name) throw new Error('Bitte einen Namen angeben.');
      let id = slugify(name) || crypto.randomUUID().slice(0, 8);
      while (db.categories.some((c) => c.id === id)) id += '-2';
      const cat = {
        id,
        name,
        icon: str(input.icon, 8) || '📁',
        color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#7c5cbf',
        description: str(input.description, 500),
        sermon: Boolean(input.sermon),
      };
      db.categories.push(cat);
      save();
      return cat;
    },

    updateCategory(id, input) {
      const cat = db.categories.find((c) => c.id === id);
      if (!cat) return null;
      if (input.name !== undefined && str(input.name, 80)) cat.name = str(input.name, 80);
      if (input.icon !== undefined) cat.icon = str(input.icon, 8) || cat.icon;
      if (input.color !== undefined && /^#[0-9a-f]{6}$/i.test(input.color)) cat.color = input.color;
      if (input.description !== undefined) cat.description = str(input.description, 500);
      if (input.sermon !== undefined) cat.sermon = Boolean(input.sermon);
      save();
      return cat;
    },

    deleteCategory(id) {
      const idx = db.categories.findIndex((c) => c.id === id);
      if (idx === -1) return false;
      if (db.albums.some((a) => a.category === id)) {
        throw new Error('Die Kategorie enthält noch Alben. Bitte diese zuerst verschieben oder löschen.');
      }
      db.categories.splice(idx, 1);
      save();
      return true;
    },

    listAlbums() {
      return db.albums;
    },

    searchAlbums({ category, q, year, limit } = {}) {
      let list = db.albums;
      if (category) list = list.filter((a) => a.category === category);
      if (year) list = list.filter((a) => a.date.startsWith(String(year)));
      if (q) {
        const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter((a) => {
          const hay = [a.title, a.description, a.speaker, a.bibleText, a.series, a.location, ...(a.tags || [])]
            .join(' ')
            .toLowerCase();
          return terms.every((t) => hay.includes(t));
        });
      }
      list = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      if (limit) list = list.slice(0, limit);
      return list.map(summary);
    },

    getAlbum(id) {
      const album = db.albums.find((a) => a.id === id);
      return album ? withMedia(album) : null;
    },

    createAlbum(input) {
      const album = {
        id: crypto.randomUUID(),
        ...albumFields(input),
        createdAt: new Date().toISOString(),
      };
      db.albums.push(album);
      save();
      return withMedia(album);
    },

    updateAlbum(id, input) {
      const album = db.albums.find((a) => a.id === id);
      if (!album) return null;
      Object.assign(album, albumFields(input, album));
      save();
      return withMedia(album);
    },

    deleteAlbum(id) {
      db.albums = db.albums.filter((a) => a.id !== id);
      db.media = db.media.filter((m) => m.albumId !== id);
      save();
    },

    addMedia(albumId, files) {
      let order = db.media.filter((m) => m.albumId === albumId).length;
      const added = files.map((f) => ({
        id: crypto.randomUUID(),
        albumId,
        type: f.type,
        mime: f.mime,
        file: f.file,
        originalName: f.originalName,
        size: f.size,
        caption: '',
        order: order++,
        createdAt: new Date().toISOString(),
      }));
      db.media.push(...added);
      save();
      return added;
    },

    updateMedia(id, input) {
      const media = db.media.find((m) => m.id === id);
      if (!media) return null;
      if (input.caption !== undefined) media.caption = str(input.caption, 500);
      save();
      return media;
    },

    deleteMedia(id) {
      const media = db.media.find((m) => m.id === id);
      if (!media) return null;
      db.media = db.media.filter((m) => m.id !== id);
      for (const album of db.albums) if (album.coverId === id) album.coverId = null;
      save();
      return media;
    },
  };
}

module.exports = { createStore, slugify };
