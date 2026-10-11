'use strict';

// ============================================================
//  Gemeinde-Mediathek – Oberfläche (ohne Build-Schritt)
// ============================================================

const app = document.getElementById('app');
const state = { admin: false, categories: [] };

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

// ---------- Hilfsfunktionen ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

function category(id) {
  return state.categories.find((c) => c.id === id) || { id, name: id, icon: '📁', color: '#7c5cbf' };
}

function countLabel(counts) {
  const parts = [];
  if (counts.image) parts.push(`${counts.image} ${counts.image === 1 ? 'Bild' : 'Bilder'}`);
  if (counts.audio) parts.push(`${counts.audio} Audio`);
  if (counts.video) parts.push(`${counts.video} ${counts.video === 1 ? 'Video' : 'Videos'}`);
  return parts.join(' · ') || 'noch leer';
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ---------- Bausteine ----------

function albumCard(a) {
  const cat = category(a.category);
  const thumb = a.cover
    ? `<img src="/uploads/${esc(a.cover)}" alt="" loading="lazy">`
    : `<span>${esc(cat.icon)}</span>`;
  return `
    <a class="album-card" href="#/album/${esc(a.id)}" style="--c:${esc(cat.color)}">
      <div class="thumb">${thumb}</div>
      <div class="body">
        <div class="title">${esc(a.title)}</div>
        <div class="meta">${esc(formatDate(a.date))} · ${esc(countLabel(a.counts))}</div>
        ${a.tags && a.tags.length ? `<div class="chips">${a.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </a>`;
}

function sermonRow(a) {
  const [, m, d] = (a.date || '').split('-').map(Number);
  const details = [a.speaker, a.bibleText, a.series].filter(Boolean).map(esc).join(' · ');
  const icon = a.counts.video ? '🎬' : a.counts.audio ? '🎧' : a.counts.image ? '📷' : '';
  return `
    <a class="sermon-row" href="#/album/${esc(a.id)}">
      <div class="date-badge"><div class="d">${d || ''}</div><div class="m">${MONTHS[(m || 1) - 1]} ${esc((a.date || '').slice(0, 4))}</div></div>
      <div>
        <div class="title">${esc(a.title)}</div>
        <div class="meta">${details || esc(formatDate(a.date))}</div>
      </div>
      <div class="play" aria-hidden="true">${icon}</div>
    </a>`;
}

function albumList(albums, cat) {
  if (!albums.length) {
    return `<div class="empty"><div class="big">🕊️</div>Hier ist noch nichts.${state.admin ? ' <a href="#/verwaltung">Jetzt ein Album anlegen</a>' : ''}</div>`;
  }
  if (cat && cat.sermon) return `<div class="sermon-list">${albums.map(sermonRow).join('')}</div>`;
  return `<div class="album-grid">${albums.map(albumCard).join('')}</div>`;
}

function categoryOptions(selected) {
  return state.categories
    .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
    .join('');
}

function albumFormFields(a = {}) {
  return `
    <div class="form-grid">
      <label class="full">Titel
        <input name="title" required maxlength="200" value="${esc(a.title)}" placeholder="z. B. Jugendfreizeit Sommer 2026">
      </label>
      <label>Kategorie
        <select name="category" required>${categoryOptions(a.category)}</select>
      </label>
      <label>Datum
        <input type="date" name="date" value="${esc(a.date || new Date().toISOString().slice(0, 10))}">
      </label>
      <label>Ort <small>optional</small>
        <input name="location" maxlength="200" value="${esc(a.location)}">
      </label>
      <label>Prediger / Sprecher <small>bei Gottesdiensten</small>
        <input name="speaker" maxlength="200" value="${esc(a.speaker)}">
      </label>
      <label>Bibelstelle <small>z. B. Johannes 3,16</small>
        <input name="bibleText" maxlength="200" value="${esc(a.bibleText)}">
      </label>
      <label>Predigtreihe / Thema <small>optional</small>
        <input name="series" maxlength="200" value="${esc(a.series)}">
      </label>
      <label class="full">Schlagworte <small>mit Komma getrennt, z. B. Taufe, Ostern, Lobpreis</small>
        <input name="tags" maxlength="500" value="${esc((a.tags || []).join(', '))}">
      </label>
      <label class="full">Beschreibung
        <textarea name="description" maxlength="5000">${esc(a.description)}</textarea>
      </label>
    </div>`;
}

function albumPayload(form) {
  const data = formData(form);
  data.tags = (data.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  return data;
}

// ---------- Seiten ----------

async function renderHome() {
  const [recentSermons, recent] = await Promise.all([
    api('/api/albums?category=gottesdienste&limit=5').catch(() => []),
    api('/api/albums?limit=8'),
  ]);
  const sermonCat = state.categories.find((c) => c.id === 'gottesdienste');

  app.innerHTML = `
    <section class="hero">
      <h1>Willkommen in unserer Mediathek</h1>
      <p>Bilder, Gottesdienste und Erinnerungen aus unserem Gemeindeleben – alles an einem Ort.</p>
      <form id="hero-search" role="search">
        <input name="q" placeholder="Suche nach Predigt, Bibelstelle, Freizeit …" aria-label="Suche">
        <button class="btn secondary" style="background:#fff;color:#4a3a73">Suchen</button>
      </form>
    </section>

    <h2 class="section">Kategorien</h2>
    <div class="cat-grid">
      ${state.categories.map((c) => `
        <a class="cat-tile" href="#/kategorie/${esc(c.id)}" style="--c:${esc(c.color)}">
          <div class="icon">${esc(c.icon)}</div>
          <div class="name">${esc(c.name)}</div>
          <div class="count">${c.albumCount} ${c.albumCount === 1 ? 'Album' : 'Alben'}</div>
        </a>`).join('')}
    </div>

    ${sermonCat && recentSermons.length ? `
      <h2 class="section">Neueste Gottesdienste <a href="#/kategorie/gottesdienste">Alle anzeigen →</a></h2>
      ${albumList(recentSermons, sermonCat)}` : ''}

    <h2 class="section">Zuletzt hinzugefügt</h2>
    ${albumList(recent)}
  `;

  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = '#/suche?q=' + encodeURIComponent(e.target.q.value);
  });
}

async function renderCategory(id, params) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return renderNotFound();
  const q = params.get('q') || '';
  const year = params.get('jahr') || '';

  const all = await api(`/api/albums?category=${encodeURIComponent(id)}`);
  const years = [...new Set(all.map((a) => a.date.slice(0, 4)))].sort().reverse();
  const albums = await api(`/api/albums?category=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&year=${encodeURIComponent(year)}`);

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Start</a> › ${esc(cat.name)}</div>
    <div class="row">
      <h1 style="margin:0">${esc(cat.icon)} ${esc(cat.name)}</h1>
      <span class="spacer"></span>
      ${state.admin ? `<a class="btn" href="#/verwaltung?kategorie=${esc(cat.id)}">＋ Neues Album</a>` : ''}
    </div>
    ${cat.description ? `<p class="meta">${esc(cat.description)}</p>` : ''}
    <form class="filters" id="filters">
      <input name="q" value="${esc(q)}" placeholder="${cat.sermon ? 'Titel, Prediger, Bibelstelle …' : 'In dieser Kategorie suchen …'}">
      <select name="jahr">
        <option value="">Alle Jahre</option>
        ${years.map((y) => `<option ${y === year ? 'selected' : ''}>${esc(y)}</option>`).join('')}
      </select>
      <button class="btn">Filtern</button>
    </form>
    ${albumList(albums, cat)}
  `;

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new URLSearchParams();
    if (e.target.q.value) f.set('q', e.target.q.value);
    if (e.target.jahr.value) f.set('jahr', e.target.jahr.value);
    location.hash = `#/kategorie/${id}${f.toString() ? '?' + f : ''}`;
  });
  document.querySelector('#filters select').addEventListener('change', (e) => e.target.form.requestSubmit());
}

async function renderSearch(params) {
  const q = params.get('q') || '';
  const cat = params.get('kategorie') || '';
  const albums = q || cat
    ? await api(`/api/albums?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`)
    : [];

  app.innerHTML = `
    <h1>Suche</h1>
    <form class="filters" id="search">
      <input name="q" value="${esc(q)}" placeholder="Predigt, Prediger, Bibelstelle, Freizeit, Schlagwort …" autofocus>
      <select name="kategorie">
        <option value="">Alle Kategorien</option>
        ${categoryOptions(cat)}
      </select>
      <button class="btn">Suchen</button>
    </form>
    ${q || cat ? `<p class="meta">${albums.length} ${albums.length === 1 ? 'Treffer' : 'Treffer'}</p>${albumList(albums)}` : '<div class="empty"><div class="big">🔍</div>Wonach suchst du?</div>'}
  `;

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new URLSearchParams();
    if (e.target.q.value) f.set('q', e.target.q.value);
    if (e.target.kategorie.value) f.set('kategorie', e.target.kategorie.value);
    location.hash = '#/suche?' + f;
  });
}

async function renderAlbum(id) {
  let album;
  try {
    album = await api(`/api/albums/${encodeURIComponent(id)}`);
  } catch {
    return renderNotFound();
  }
  const cat = category(album.category);
  const images = album.media.filter((m) => m.type === 'image');
  const players = album.media.filter((m) => m.type !== 'image');

  const facts = [
    ['📅', formatDate(album.date)],
    ['🎤', album.speaker],
    ['📖', album.bibleText],
    ['🗂️', album.series],
    ['📍', album.location],
  ].filter(([, v]) => v);

  const adminTools = (m) => state.admin ? `
    <div class="admin-media-tools">
      <button class="btn small secondary" data-caption="${esc(m.id)}">✏️ Beschriftung</button>
      ${m.type === 'image' ? `<button class="btn small secondary" data-cover="${esc(m.id)}">${album.coverId === m.id ? '★ Titelbild' : '☆ Als Titelbild'}</button>` : ''}
      <button class="btn small danger" data-delete-media="${esc(m.id)}">🗑️</button>
    </div>` : '';

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Start</a> › <a href="#/kategorie/${esc(cat.id)}">${esc(cat.name)}</a> › ${esc(album.title)}</div>
    <div class="album-head">
      <div class="row">
        <h1>${esc(album.title)}</h1>
        <span class="spacer"></span>
        ${state.admin ? `<button class="btn secondary" id="edit-album">✏️ Bearbeiten</button>` : ''}
      </div>
      <div class="facts">${facts.map(([i, v]) => `<span>${i} <b>${esc(v)}</b></span>`).join('')}</div>
      ${album.tags.length ? `<div class="chips">${album.tags.map((t) => `<a class="chip" href="#/suche?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
      ${album.description ? `<p class="desc">${esc(album.description)}</p>` : ''}
    </div>

    <div id="edit-slot"></div>

    ${state.admin ? `
      <div class="card" style="margin-top:20px">
        <h3>Dateien hinzufügen</h3>
        <div class="dropzone" id="dropzone" tabindex="0" role="button">
          <div style="font-size:2rem">📤</div>
          Bilder, Audio- oder Videodateien hierher ziehen<br>oder <b>klicken zum Auswählen</b>
          <input type="file" id="file-input" multiple accept="image/*,audio/*,video/*" hidden>
        </div>
        <div class="progress" id="progress" hidden><div></div></div>
        <div class="meta" id="progress-text"></div>
      </div>` : ''}

    ${players.length ? `<div class="players">${players.map((m) => `
      <div class="player">
        <div class="label"><span>${m.type === 'video' ? '🎬' : '🎧'} ${esc(m.caption || m.originalName)}</span>
          <a href="/uploads/${esc(m.file)}" download="${esc(m.originalName)}" class="meta">⬇ Herunterladen (${esc(formatSize(m.size))})</a></div>
        ${m.type === 'video'
          ? `<video controls preload="metadata" src="/uploads/${esc(m.file)}"></video>`
          : `<audio controls preload="metadata" src="/uploads/${esc(m.file)}"></audio>`}
        ${adminTools(m)}
      </div>`).join('')}</div>` : ''}

    ${images.length ? `<div class="photo-grid">${images.map((m, i) => `
      <div class="media-admin-item">
        <button class="photo" data-index="${i}" aria-label="${esc(m.caption || 'Bild ' + (i + 1))} vergrößern">
          <img src="/uploads/${esc(m.file)}" alt="${esc(m.caption)}" loading="lazy">
          ${m.caption ? `<span class="cap">${esc(m.caption)}</span>` : ''}
        </button>
        ${adminTools(m)}
      </div>`).join('')}</div>` : ''}

    ${!album.media.length ? '<div class="empty"><div class="big">🖼️</div>Dieses Album ist noch leer.</div>' : ''}
  `;

  app.querySelectorAll('.photo').forEach((el) =>
    el.addEventListener('click', () => openLightbox(images, Number(el.dataset.index)))
  );

  if (!state.admin) return;

  const reload = () => renderAlbum(id);

  document.getElementById('edit-album').addEventListener('click', () => {
    const slot = document.getElementById('edit-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <form class="card" id="album-form" style="margin-top:20px">
        <h3>Album bearbeiten</h3>
        ${albumFormFields(album)}
        <div class="row" style="margin-top:14px">
          <button class="btn">Speichern</button>
          <button type="button" class="btn secondary" id="cancel-edit">Abbrechen</button>
          <span class="spacer"></span>
          <button type="button" class="btn danger" id="delete-album">Album löschen</button>
        </div>
      </form>`;
    document.getElementById('cancel-edit').onclick = () => (slot.innerHTML = '');
    document.getElementById('album-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/albums/${id}`, { method: 'PUT', body: albumPayload(e.target) });
        toast('Gespeichert ✓');
        await loadCategories();
        reload();
      } catch (err) { toast(err.message, true); }
    });
    document.getElementById('delete-album').onclick = async () => {
      if (!confirm(`Album „${album.title}“ mit allen ${album.media.length} Dateien wirklich löschen?`)) return;
      try {
        await api(`/api/albums/${id}`, { method: 'DELETE' });
        toast('Album gelöscht');
        await loadCategories();
        location.hash = `#/kategorie/${album.category}`;
      } catch (err) { toast(err.message, true); }
    };
  });

  app.querySelectorAll('[data-caption]').forEach((b) => b.addEventListener('click', async () => {
    const m = album.media.find((x) => x.id === b.dataset.caption);
    const caption = prompt('Beschriftung:', m.caption || '');
    if (caption === null) return;
    try { await api(`/api/media/${m.id}`, { method: 'PUT', body: { caption } }); reload(); }
    catch (err) { toast(err.message, true); }
  }));

  app.querySelectorAll('[data-cover]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/albums/${id}`, { method: 'PUT', body: { coverId: b.dataset.cover } }); toast('Titelbild gesetzt ✓'); reload(); }
    catch (err) { toast(err.message, true); }
  }));

  app.querySelectorAll('[data-delete-media]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Diese Datei wirklich löschen?')) return;
    try { await api(`/api/media/${b.dataset.deleteMedia}`, { method: 'DELETE' }); reload(); }
    catch (err) { toast(err.message, true); }
  }));

  const drop = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(id, e.dataTransfer.files, reload); });
  input.addEventListener('change', () => uploadFiles(id, input.files, reload));
}

// Lädt Dateien in kleinen Paketen hoch, damit auch viele Fotos auf einmal klappen.
async function uploadFiles(albumId, fileList, done) {
  const files = [...fileList];
  if (!files.length) return;
  const bar = document.getElementById('progress');
  const text = document.getElementById('progress-text');
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  let sentBytes = 0;
  bar.hidden = false;

  const batches = [];
  let current = [];
  let currentSize = 0;
  for (const f of files) {
    if (current.length && (current.length >= 10 || currentSize + f.size > 200e6)) {
      batches.push(current); current = []; currentSize = 0;
    }
    current.push(f); currentSize += f.size;
  }
  if (current.length) batches.push(current);

  let uploaded = 0;
  try {
    for (const batch of batches) {
      const fd = new FormData();
      batch.forEach((f) => fd.append('files', f));
      const batchSize = batch.reduce((s, f) => s + f.size, 0);
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/albums/${albumId}/media`);
        xhr.upload.onprogress = (e) => {
          const pct = ((sentBytes + (e.loaded / e.total) * batchSize) / totalBytes) * 100;
          bar.firstElementChild.style.width = pct.toFixed(1) + '%';
          text.textContent = `Lade hoch … ${Math.round(pct)} % (${uploaded} von ${files.length} Dateien fertig)`;
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let msg = `Fehler ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error('Verbindung unterbrochen.'));
        xhr.send(fd);
      });
      sentBytes += batchSize;
      uploaded += batch.length;
    }
    toast(`${uploaded} ${uploaded === 1 ? 'Datei' : 'Dateien'} hochgeladen ✓`);
  } catch (err) {
    toast(`${err.message} (${uploaded} von ${files.length} hochgeladen)`, true);
  }
  done();
}

async function renderAdmin(params) {
  if (!state.admin) {
    app.innerHTML = `
      <form class="card" id="login" style="max-width:420px;margin:40px auto">
        <h2>🔐 Anmelden</h2>
        <p class="meta">Nur für Mitarbeiter, die Bilder und Aufnahmen hochladen.</p>
        <label>Passwort <input type="password" name="password" required autofocus autocomplete="current-password"></label>
        <button class="btn" style="margin-top:14px;width:100%;justify-content:center">Anmelden</button>
      </form>`;
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/login', { method: 'POST', body: formData(e.target) });
        state.admin = true;
        updateNav();
        toast('Willkommen! 👋');
        renderAdmin(params);
      } catch (err) { toast(err.message, true); }
    });
    return;
  }

  app.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <h1 style="margin:0">Verwaltung</h1>
      <span class="spacer"></span>
      <button class="btn secondary" id="logout">Abmelden</button>
    </div>

    <form class="card" id="new-album">
      <h2>＋ Neues Album anlegen</h2>
      <p class="meta">Ein Album ist z. B. ein Gottesdienst, ein Jugendabend oder ein Gemeindefest. Danach kannst du direkt Bilder und Aufnahmen hochladen.</p>
      ${albumFormFields({ category: params.get('kategorie') || state.categories[0]?.id })}
      <button class="btn" style="margin-top:14px">Album anlegen & Dateien hochladen →</button>
    </form>

    <div class="card">
      <h2>🗂️ Kategorien</h2>
      <p class="meta">Symbol, Name, Beschreibung und Farbe. „Predigtliste“ zeigt die Alben als Liste mit Prediger und Bibelstelle an.</p>
      <div id="cat-rows">
        ${state.categories.map((c) => `
          <form class="cat-admin-row" data-id="${esc(c.id)}">
            <input name="icon" value="${esc(c.icon)}" aria-label="Symbol">
            <input name="name" value="${esc(c.name)}" aria-label="Name" required>
            <input name="description" value="${esc(c.description)}" aria-label="Beschreibung" placeholder="Beschreibung">
            <input type="color" name="color" value="${esc(c.color)}" aria-label="Farbe" style="padding:2px;height:42px">
            <label style="flex-direction:row;align-items:center;font-weight:400"><input type="checkbox" name="sermon" ${c.sermon ? 'checked' : ''} style="width:auto"> Predigtliste</label>
            <div class="row" style="gap:6px">
              <button class="btn small">Speichern</button>
              <button type="button" class="btn small danger" data-del="${esc(c.id)}" aria-label="Kategorie löschen">🗑️</button>
            </div>
          </form>`).join('')}
      </div>
      <form class="row" id="new-cat" style="margin-top:14px">
        <input name="icon" placeholder="🙏" style="width:70px">
        <input name="name" placeholder="Neue Kategorie, z. B. Gebetskreis" required style="flex:1;min-width:200px">
        <button class="btn">Hinzufügen</button>
      </form>
    </div>
  `;

  document.getElementById('logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    state.admin = false;
    updateNav();
    location.hash = '#/';
  };

  document.getElementById('new-album').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const album = await api('/api/albums', { method: 'POST', body: albumPayload(e.target) });
      await loadCategories();
      toast('Album angelegt ✓ – jetzt Dateien hochladen');
      location.hash = `#/album/${album.id}`;
    } catch (err) { toast(err.message, true); }
  });

  app.querySelectorAll('.cat-admin-row').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formData(form);
    body.sermon = form.sermon.checked;
    try {
      await api(`/api/categories/${form.dataset.id}`, { method: 'PUT', body });
      await loadCategories();
      toast('Kategorie gespeichert ✓');
    } catch (err) { toast(err.message, true); }
  }));

  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Kategorie wirklich löschen?')) return;
    try {
      await api(`/api/categories/${b.dataset.del}`, { method: 'DELETE' });
      await loadCategories();
      renderAdmin(params);
    } catch (err) { toast(err.message, true); }
  }));

  document.getElementById('new-cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/categories', { method: 'POST', body: formData(e.target) });
      await loadCategories();
      renderAdmin(params);
    } catch (err) { toast(err.message, true); }
  });
}

function renderNotFound() {
  app.innerHTML = '<div class="empty"><div class="big">🤷</div>Diese Seite gibt es nicht. <a href="#/">Zur Startseite</a></div>';
}

// ---------- Lightbox ----------

const lb = {
  el: document.getElementById('lightbox'),
  images: [],
  index: 0,
};

function showLightboxImage() {
  const m = lb.images[lb.index];
  lb.el.querySelector('img').src = `/uploads/${m.file}`;
  lb.el.querySelector('img').alt = m.caption || '';
  lb.el.querySelector('figcaption').textContent = `${m.caption ? m.caption + ' · ' : ''}${lb.index + 1} / ${lb.images.length}`;
}

function openLightbox(images, index) {
  lb.images = images;
  lb.index = index;
  showLightboxImage();
  lb.el.hidden = false;
  lb.el.querySelector('.lb-close').focus();
}

function stepLightbox(delta) {
  lb.index = (lb.index + delta + lb.images.length) % lb.images.length;
  showLightboxImage();
}

lb.el.querySelector('.lb-close').onclick = () => (lb.el.hidden = true);
lb.el.querySelector('.lb-prev').onclick = () => stepLightbox(-1);
lb.el.querySelector('.lb-next').onclick = () => stepLightbox(1);
lb.el.addEventListener('click', (e) => { if (e.target === lb.el) lb.el.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (lb.el.hidden) return;
  if (e.key === 'Escape') lb.el.hidden = true;
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});
let touchX = null;
lb.el.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
lb.el.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) stepLightbox(dx > 0 ? -1 : 1);
  touchX = null;
});

// ---------- Navigation ----------

function updateNav() {
  document.getElementById('admin-link').textContent = state.admin ? 'Verwaltung' : 'Anmelden';
}

async function loadCategories() {
  state.categories = await api('/api/categories');
}

async function route() {
  lb.el.hidden = true;
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  document.querySelectorAll('.topnav a').forEach((a) => {
    const target = a.getAttribute('href').slice(1);
    a.classList.toggle('active', target === '/' ? path === '/' : path.startsWith(target));
  });

  try {
    if (!parts.length) await renderHome();
    else if (parts[0] === 'kategorie' && parts[1]) await renderCategory(parts[1], params);
    else if (parts[0] === 'album' && parts[1]) await renderAlbum(parts[1]);
    else if (parts[0] === 'suche') await renderSearch(params);
    else if (parts[0] === 'verwaltung') await renderAdmin(params);
    else renderNotFound();
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

(async function init() {
  try {
    const [me] = await Promise.all([api('/api/me'), loadCategories()]);
    state.admin = me.admin;
  } catch (err) {
    toast('Server nicht erreichbar.', true);
  }
  updateNav();
  window.addEventListener('hashchange', route);
  route();
})();
