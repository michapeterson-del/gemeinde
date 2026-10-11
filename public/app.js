'use strict';

// ============================================================
//  Gemeinde-Mediathek – Oberfläche (ohne Build-Schritt)
// ============================================================

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const state = { user: null, folders: [] };

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const TYPE_ICON = { image: '🖼️', audio: '🎧', video: '🎬', document: '📄', text: '📝' };

const isAdmin = () => state.user && state.user.role === 'admin';

// ---------- Hilfsfunktionen ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

function itemTitle(item) {
  return item.title || (item.originalName || '').replace(/\.[^.]+$/, '') || 'Ohne Titel';
}

const fileUrl = (item) => '/uploads/' + item.file.split('/').map(encodeURIComponent).join('/');

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me/password') {
    state.user = null;
    renderLogin();
    throw new Error(data.error || 'Bitte anmelden.');
  }
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

async function loadFolders() {
  state.folders = await api('/api/folders');
}

const folderById = (id) => state.folders.find((f) => f.id === id);

// Liefert alle Ordner als eingerückte Baum-Liste (für Auswahlfelder und die Verwaltung).
function folderTree(excludeId) {
  const out = [];
  const walk = (parentId, depth) => {
    for (const f of state.folders.filter((x) => (x.parentId || null) === parentId)) {
      if (f.id === excludeId) continue;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function folderOptions(selected, { excludeId, allowRoot } = {}) {
  const opts = folderTree(excludeId).map(
    ({ folder, depth }) =>
      `<option value="${esc(folder.id)}" ${folder.id === selected ? 'selected' : ''}>${'   '.repeat(depth)}${esc(folder.icon)} ${esc(folder.name)}</option>`
  );
  if (allowRoot) opts.unshift(`<option value="" ${!selected ? 'selected' : ''}>— Hauptebene —</option>`);
  return opts.join('');
}

function pathLabel(path) {
  return path.map((p) => p.name).join(' › ');
}

// ---------- Dialog ----------

function openDialog(html, onMount) {
  dialog.innerHTML = `<button class="dialog-close" aria-label="Schließen" data-close>✕</button>${html}`;
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  if (!dialog.open) dialog.showModal();
  if (onMount) onMount(dialog);
}

dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});
dialog.addEventListener('close', () => (dialog.innerHTML = ''));

// ---------- Bausteine ----------

function folderTile(f) {
  const thumb = f.cover
    ? `<img src="${esc(fileUrl({ file: f.cover }))}" alt="" loading="lazy">`
    : `<span>${esc(f.icon)}</span>`;
  const sub = [
    f.childCount ? `${f.childCount} Ordner` : '',
    f.itemCount ? `${f.itemCount} ${f.itemCount === 1 ? 'Eintrag' : 'Einträge'}` : '',
  ].filter(Boolean).join(' · ') || 'leer';
  return `
    <a class="folder-tile" href="#/ordner/${esc(f.id)}" style="--c:${esc(f.color)}">
      <div class="thumb">${thumb}<span class="tab" aria-hidden="true"></span></div>
      <div class="body">
        <div class="title">${f.cover ? esc(f.icon) + ' ' : ''}${esc(f.name)}</div>
        <div class="meta">${esc(sub)}</div>
      </div>
    </a>`;
}

function editButton(item) {
  return isAdmin() ? `<button class="icon-btn" data-edit="${esc(item.id)}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>` : '';
}

function dateBadge(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return `<div class="date-badge"><div class="d">${d || ''}</div><div class="m">${MONTHS[(m || 1) - 1]} ${y || ''}</div></div>`;
}

function pathLink(item, show) {
  if (!show || !item.path) return '';
  const last = item.path[item.path.length - 1];
  return `<a class="path-link" href="#/ordner/${esc(last.id)}">📁 ${esc(pathLabel(item.path))}</a>`;
}

// Zeigt eine Liste von Einträgen an – sortiert in Texte, Aufnahmen, Bilder und Dokumente.
function renderItems(items, { sermons = false, showPath = false } = {}) {
  const texts = items.filter((i) => i.type === 'text');
  const media = items.filter((i) => i.type === 'audio' || i.type === 'video');
  const images = items.filter((i) => i.type === 'image');
  const docs = items.filter((i) => i.type === 'document');
  const html = [];

  if (media.length) {
    html.push(`<h2 class="section">${sermons ? '⛪ Predigten & Aufnahmen' : '🎧 Aufnahmen & Videos'}</h2><div class="players">`);
    for (const m of media) {
      const details = [m.speaker && `🎤 ${esc(m.speaker)}`, m.bibleText && `📖 ${esc(m.bibleText)}`].filter(Boolean).join(' · ');
      html.push(`
        <article class="player">
          <div class="player-head">
            ${dateBadge(m.date)}
            <div class="grow">
              <div class="title">${esc(itemTitle(m))}</div>
              <div class="meta">${details || esc(formatDate(m.date))}</div>
              ${pathLink(m, showPath)}
            </div>
            ${editButton(m)}
          </div>
          ${m.type === 'video'
            ? `<video controls preload="metadata" playsinline src="${esc(fileUrl(m))}"></video>`
            : `<audio controls preload="none" src="${esc(fileUrl(m))}"></audio>`}
          ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
          <a class="meta" href="${esc(fileUrl(m))}" download="${esc(m.originalName)}">⬇ Herunterladen (${esc(formatSize(m.size))})</a>
        </article>`);
    }
    html.push('</div>');
  }

  if (texts.length) {
    html.push('<h2 class="section">📝 Texte</h2><div class="texts">');
    for (const t of texts) {
      html.push(`
        <article class="text-card">
          <div class="row"><div class="grow"><h3>${esc(t.title || 'Ohne Titel')}</h3>
            <div class="meta">${esc(formatDate(t.date))}${t.createdBy ? ' · ' + esc(t.createdBy) : ''}</div>${pathLink(t, showPath)}</div>${editButton(t)}</div>
          <div class="text-body">${esc(t.text)}</div>
        </article>`);
    }
    html.push('</div>');
  }

  if (images.length) {
    html.push('<h2 class="section">📷 Bilder</h2>');
    // Bilder nach Datum gruppieren
    const groups = new Map();
    for (const img of images) {
      if (!groups.has(img.date)) groups.set(img.date, []);
      groups.get(img.date).push(img);
    }
    for (const [date, list] of [...groups].sort((a, b) => b[0].localeCompare(a[0]))) {
      html.push(`<h3 class="date-head">${esc(formatDate(date))} <span class="meta">· ${list.length} ${list.length === 1 ? 'Bild' : 'Bilder'}</span></h3><div class="photo-grid">`);
      for (const img of list) {
        html.push(`
          <div class="photo-wrap">
            <button class="photo" data-photo="${esc(img.id)}" aria-label="${esc(itemTitle(img))} vergrößern">
              <img src="${esc(fileUrl(img))}" alt="${esc(img.title)}" loading="lazy">
              ${img.title ? `<span class="cap">${esc(img.title)}</span>` : ''}
            </button>
            ${editButton(img)}
          </div>`);
      }
      html.push('</div>');
    }
  }

  if (docs.length) {
    html.push('<h2 class="section">📄 Dokumente</h2><div class="doc-list">');
    for (const d of docs) {
      html.push(`
        <div class="doc-row">
          <span class="doc-icon">📄</span>
          <div class="grow">
            <a href="${esc(fileUrl(d))}" target="_blank" rel="noopener" download="${esc(d.originalName)}" class="title">${esc(itemTitle(d))}</a>
            <div class="meta">${esc(formatDate(d.date))} · ${esc(formatSize(d.size))}${d.description ? ' · ' + esc(d.description) : ''}</div>
            ${pathLink(d, showPath)}
          </div>
          ${editButton(d)}
        </div>`);
    }
    html.push('</div>');
  }

  return html.join('');
}

// Klicks auf Bilder (Vollbild) und Stifte (Bearbeiten) verbinden.
function bindItems(container, items, reload) {
  const images = items.filter((i) => i.type === 'image');
  container.querySelectorAll('[data-photo]').forEach((el) =>
    el.addEventListener('click', () => openLightbox(images, images.findIndex((i) => i.id === el.dataset.photo)))
  );
  container.querySelectorAll('[data-edit]').forEach((el) =>
    el.addEventListener('click', () => openItemDialog(items.find((i) => i.id === el.dataset.edit), reload))
  );
}

// ---------- Anmeldung ----------

function renderLogin() {
  document.getElementById('topbar').hidden = true;
  dialog.open && dialog.close();
  app.innerHTML = `
    <div class="login-page">
      <form class="card login-card" id="login">
        <img src="icon.svg" alt="" width="72" height="72">
        <h1>Gemeinde-Mediathek</h1>
        <p class="meta">Bitte melde dich an, um Bilder, Gottesdienste und Texte zu sehen.</p>
        <label>Benutzername <input name="username" required autocomplete="username" autocapitalize="none" autofocus></label>
        <label>Passwort <input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn wide">Anmelden</button>
      </form>
    </div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/login', { method: 'POST', body: formData(e.target) });
      state.user = user;
      await start();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Seiten ----------

async function renderHome() {
  const [{ children }, recent] = await Promise.all([
    api('/api/folders/root'),
    api('/api/items?sort=recent&limit=24'),
  ]);
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

  app.innerHTML = `
    <section class="hero">
      <h1>${greeting}, ${esc(state.user.name)}! 👋</h1>
      <p>Bilder, Gottesdienste und Erinnerungen aus unserem Gemeindeleben – alles an einem Ort.</p>
      <form id="hero-search" role="search">
        <input name="q" placeholder="Suche nach Predigt, Bibelstelle, Freizeit …" aria-label="Suche">
        <button class="btn light">Suchen</button>
      </form>
    </section>

    <div class="row">
      <h2 class="section grow">Ordner</h2>
      ${isAdmin() ? '<button class="btn secondary small" id="new-folder">＋ Neuer Ordner</button>' : ''}
    </div>
    <div class="folder-grid">${children.map(folderTile).join('')}</div>

    ${recent.length ? `<h2 class="section" style="margin-top:40px">✨ Neu hinzugefügt</h2><div id="recent">${renderItems(recent, { showPath: true })}</div>` : ''}
  `;

  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = '#/suche?q=' + encodeURIComponent(e.target.q.value);
  });
  if (isAdmin()) document.getElementById('new-folder').onclick = () => openFolderDialog({ parentId: null });
  if (recent.length) bindItems(document.getElementById('recent'), recent, renderHome);
}

async function renderFolder(id) {
  let view;
  try {
    view = await api(`/api/folders/${encodeURIComponent(id)}`);
  } catch {
    return renderNotFound();
  }
  const { folder, path, children, items } = view;
  const reload = () => renderFolder(id);

  app.innerHTML = `
    <nav class="crumbs"><a href="#/">Start</a>${path.map((p, i) =>
      i === path.length - 1 ? ` › <span>${esc(p.name)}</span>` : ` › <a href="#/ordner/${esc(p.id)}">${esc(p.name)}</a>`).join('')}</nav>
    <div class="folder-head" style="--c:${esc(folder.color)}">
      <div class="folder-icon">${esc(folder.icon)}</div>
      <div class="grow">
        <h1>${esc(folder.name)}</h1>
        ${folder.description ? `<p class="meta">${esc(folder.description)}</p>` : ''}
      </div>
    </div>
    ${isAdmin() ? `
      <div class="toolbar">
        <button class="btn" id="tb-upload">⬆️ Dateien hochladen</button>
        <button class="btn secondary" id="tb-text">📝 Text schreiben</button>
        <button class="btn secondary" id="tb-folder">📁 Unterordner anlegen</button>
        <button class="btn secondary" id="tb-edit">⚙️ Ordner bearbeiten</button>
      </div>` : ''}

    ${children.length ? `<div class="folder-grid">${children.map(folderTile).join('')}</div>` : ''}
    <div id="items">${renderItems(items, { sermons: folder.kind === 'sermons' })}</div>
    ${!children.length && !items.length ? `<div class="empty"><div class="big">🕊️</div>Dieser Ordner ist noch leer.</div>` : ''}
  `;

  bindItems(document.getElementById('items'), items, reload);

  if (isAdmin()) {
    document.getElementById('tb-upload').onclick = () => openUploadDialog(id, reload);
    document.getElementById('tb-text').onclick = () => openTextDialog(id, reload);
    document.getElementById('tb-folder').onclick = () => openFolderDialog({ parentId: id });
    document.getElementById('tb-edit').onclick = () => openFolderDialog(folder);
  }
}

async function renderSearch(params) {
  const q = params.get('q') || '';
  const result = q ? await api(`/api/search?q=${encodeURIComponent(q)}`) : null;

  app.innerHTML = `
    <h1>Suche</h1>
    <form class="filters" id="search">
      <input name="q" value="${esc(q)}" placeholder="Predigt, Prediger, Bibelstelle, Ordner, Jahr …" autofocus>
      <button class="btn">Suchen</button>
    </form>
    <div id="results"></div>
  `;
  const results = document.getElementById('results');
  if (!result) {
    results.innerHTML = '<div class="empty"><div class="big">🔍</div>Wonach suchst du? Zum Beispiel „Jugendfreizeit 2026“ oder „Johannes“.</div>';
  } else if (!result.folders.length && !result.items.length) {
    results.innerHTML = '<div class="empty"><div class="big">🤷</div>Nichts gefunden.</div>';
  } else {
    results.innerHTML = `
      ${result.folders.length ? `<h2 class="section">📁 Ordner</h2><div class="folder-grid">${result.folders.map(folderTile).join('')}</div>` : ''}
      ${renderItems(result.items, { showPath: true })}`;
    bindItems(results, result.items, () => renderSearch(params));
  }

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = '#/suche?q=' + encodeURIComponent(e.target.q.value);
  });
}

async function renderAccount() {
  app.innerHTML = `
    <h1>Mein Konto</h1>
    <div class="card">
      <p><b>${esc(state.user.name)}</b> <span class="meta">(${esc(state.user.username)})</span><br>
      <span class="role ${esc(state.user.role)}">${state.user.role === 'admin' ? 'Admin' : 'Normal'}</span></p>
      <button class="btn secondary" id="logout">Abmelden</button>
    </div>
    <form class="card" id="pw" style="max-width:480px">
      <h2>Passwort ändern</h2>
      <label>Aktuelles Passwort <input type="password" name="current" required autocomplete="current-password"></label>
      <label>Neues Passwort <small>mindestens 6 Zeichen</small><input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn" style="margin-top:12px">Passwort speichern</button>
    </form>`;
  document.getElementById('logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/';
    renderLogin();
  };
  document.getElementById('pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/password', { method: 'PUT', body: formData(e.target) });
      e.target.reset();
      toast('Passwort geändert ✓');
    } catch (err) { toast(err.message, true); }
  });
}

async function renderAdmin() {
  if (!isAdmin()) return renderNotFound();
  const users = await api('/api/users');
  await loadFolders();

  const tree = folderTree().map(({ folder: f, depth }) => `
    <div class="tree-row" style="--depth:${depth}">
      <a href="#/ordner/${esc(f.id)}" class="grow"><span class="tree-icon" style="--c:${esc(f.color)}">${esc(f.icon)}</span> ${esc(f.name)}
        <span class="meta">${f.itemCount ? `· ${f.itemCount} ${f.itemCount === 1 ? 'Eintrag' : 'Einträge'}` : ''}${f.kind === 'sermons' ? ' · Predigtordner' : ''}</span></a>
      <button class="btn small secondary" data-sub="${esc(f.id)}" title="Unterordner anlegen">＋ Unterordner</button>
      <button class="btn small secondary" data-folder="${esc(f.id)}" title="Bearbeiten">✏️</button>
    </div>`).join('');

  app.innerHTML = `
    <h1>Verwaltung</h1>

    <section class="card">
      <div class="row"><h2 class="grow">📁 Ordnerstruktur</h2><button class="btn small" id="new-root">＋ Neuer Hauptordner</button></div>
      <p class="meta">Hier legst du fest, wie alles sortiert ist – z. B. Bilder › Jugend › Jugendfreizeit. Ordner kannst du beliebig ineinander verschachteln und später verschieben.</p>
      <div class="tree">${tree || '<p class="meta">Noch keine Ordner.</p>'}</div>
    </section>

    <section class="card">
      <h2>👥 Benutzer</h2>
      <p class="meta"><b>Admin</b>: darf alles – Ordner anlegen, hochladen, Texte schreiben, Benutzer verwalten.<br><b>Normal</b>: darf alles ansehen, anhören und herunterladen.</p>
      <div class="user-list">
        ${users.map((u) => `
          <div class="user-row">
            <div class="grow"><b>${esc(u.name)}</b> <span class="meta">${esc(u.username)}</span></div>
            <select data-role="${esc(u.id)}" aria-label="Rolle von ${esc(u.name)}">
              <option value="member" ${u.role === 'member' ? 'selected' : ''}>Normal</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="btn small secondary" data-reset="${esc(u.id)}">🔑 Passwort</button>
            ${u.id === state.user.id ? '<span class="meta">(du)</span>' : `<button class="btn small danger" data-deluser="${esc(u.id)}" aria-label="${esc(u.name)} löschen">🗑️</button>`}
          </div>`).join('')}
      </div>
      <form id="new-user" class="form-grid" style="margin-top:18px">
        <h3 class="full" style="margin:0">Neuen Benutzer anlegen</h3>
        <label>Name <input name="name" required placeholder="z. B. Maria Schneider"></label>
        <label>Benutzername <input name="username" required autocapitalize="none" placeholder="z. B. maria"></label>
        <label>Passwort <input name="password" required minlength="6" autocomplete="new-password"></label>
        <label>Rolle
          <select name="role"><option value="member">Normal (nur ansehen)</option><option value="admin">Admin (darf alles)</option></select>
        </label>
        <div class="full"><button class="btn">Benutzer anlegen</button></div>
      </form>
    </section>`;

  document.getElementById('new-root').onclick = () => openFolderDialog({ parentId: null }, renderAdmin);
  app.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => openFolderDialog({ parentId: b.dataset.sub }, renderAdmin)));
  app.querySelectorAll('[data-folder]').forEach((b) => (b.onclick = () => openFolderDialog(folderById(b.dataset.folder), renderAdmin)));

  app.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
    try {
      await api(`/api/users/${sel.dataset.role}`, { method: 'PUT', body: { role: sel.value } });
      toast('Rolle geändert ✓');
    } catch (err) { toast(err.message, true); renderAdmin(); }
  }));
  app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
    const user = users.find((u) => u.id === b.dataset.reset);
    const password = prompt(`Neues Passwort für ${user.name} (mindestens 6 Zeichen):`);
    if (!password) return;
    try {
      await api(`/api/users/${user.id}`, { method: 'PUT', body: { password } });
      toast('Passwort geändert ✓');
    } catch (err) { toast(err.message, true); }
  }));
  app.querySelectorAll('[data-deluser]').forEach((b) => (b.onclick = async () => {
    const user = users.find((u) => u.id === b.dataset.deluser);
    if (!confirm(`${user.name} wirklich löschen?`)) return;
    try {
      await api(`/api/users/${user.id}`, { method: 'DELETE' });
      renderAdmin();
    } catch (err) { toast(err.message, true); }
  }));
  document.getElementById('new-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', { method: 'POST', body: formData(e.target) });
      toast('Benutzer angelegt ✓');
      renderAdmin();
    } catch (err) { toast(err.message, true); }
  });
}

function renderNotFound() {
  app.innerHTML = '<div class="empty"><div class="big">🤷</div>Diese Seite gibt es nicht. <a href="#/">Zur Startseite</a></div>';
}

// ---------- Dialoge: Ordner ----------

function openFolderDialog(folder, after) {
  const isNew = !folder.id;
  const parent = folder.parentId ? folderById(folder.parentId) : null;
  openDialog(`
    <form id="folder-form">
      <h2>${isNew ? '📁 Neuer Ordner' : '⚙️ Ordner bearbeiten'}</h2>
      <div class="form-grid">
        <label class="full">Name <input name="name" required maxlength="100" value="${esc(folder.name)}" placeholder="z. B. Jugendfreizeit 2026"></label>
        <label>Liegt in
          <select name="parentId">${folderOptions(folder.parentId || '', { excludeId: folder.id, allowRoot: true })}</select>
        </label>
        <label>Anzeige
          <select name="kind">
            <option value="normal">Normal</option>
            <option value="sermons" ${folder.kind === 'sermons' ? 'selected' : ''}>Gottesdienste / Predigten</option>
          </select>
        </label>
        <label>Symbol <small>ein Emoji</small><input name="icon" maxlength="8" value="${esc(folder.icon || '📁')}"></label>
        <label>Farbe <input type="color" name="color" value="${esc(folder.color || (parent && parent.color) || '#7c5cbf')}"></label>
        <label class="full">Beschreibung <small>optional</small><textarea name="description" maxlength="1000">${esc(folder.description)}</textarea></label>
      </div>
      <div class="row dialog-actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del-folder">Löschen</button>'}
        <span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn">${isNew ? 'Anlegen' : 'Speichern'}</button>
      </div>
    </form>`, (d) => {
    d.querySelector('#folder-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.parentId = body.parentId || null;
      try {
        const saved = isNew
          ? await api('/api/folders', { method: 'POST', body })
          : await api(`/api/folders/${folder.id}`, { method: 'PUT', body });
        dialog.close();
        await loadFolders();
        toast(isNew ? 'Ordner angelegt ✓' : 'Gespeichert ✓');
        if (after) after();
        else if (location.hash === `#/ordner/${saved.id}`) route();
        else location.hash = `#/ordner/${saved.id}`;
      } catch (err) { toast(err.message, true); }
    });
    const del = d.querySelector('#del-folder');
    if (del) del.onclick = async () => {
      const subCount = folderTree().filter(({ folder: f }) => {
        for (let p = f; p; p = p.parentId ? folderById(p.parentId) : null) if (p.parentId === folder.id) return true;
        return false;
      }).length;
      const msg = `Ordner „${folder.name}“ wirklich löschen?` +
        (subCount || folder.itemCount ? `\n\nDabei werden auch ${subCount} Unterordner und ${folder.itemCount} Einträge (Bilder, Aufnahmen, Texte) gelöscht!` : '');
      if (!confirm(msg)) return;
      try {
        await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
        dialog.close();
        await loadFolders();
        toast('Ordner gelöscht');
        if (after) after();
        else location.hash = folder.parentId ? `#/ordner/${folder.parentId}` : '#/';
      } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- Dialoge: Text schreiben ----------

function openTextDialog(folderId, after) {
  openDialog(`
    <form id="text-form">
      <h2>📝 Text schreiben</h2>
      <div class="form-grid">
        <label class="full">Ordner <select name="folderId" required>${folderOptions(folderId)}</select></label>
        <label class="full">Überschrift <input name="title" maxlength="200" required placeholder="z. B. Rückblick auf die Jugendfreizeit"></label>
        <label>Datum <input type="date" name="date" value="${localDate(new Date())}" required></label>
        <label class="full">Text <textarea name="text" rows="10" maxlength="20000" required></textarea></label>
      </div>
      <div class="row dialog-actions"><span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn">Speichern</button>
      </div>
    </form>`, (d) => {
    d.querySelector('#text-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      try {
        await api(`/api/folders/${body.folderId}/texts`, { method: 'POST', body });
        dialog.close();
        toast('Text gespeichert ✓');
        await loadFolders();
        if (body.folderId === folderId && after) after();
        else location.hash = `#/ordner/${body.folderId}`;
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ---------- Dialoge: Hochladen ----------

// Ermittelt das „richtige“ Datum einer Datei: Aufnahmedatum aus dem Foto,
// sonst Datum im Dateinamen, sonst das Änderungsdatum der Datei.
async function detectDate(file) {
  if (/\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg') {
    try {
      const date = readExifDate(await file.slice(0, 256 * 1024).arrayBuffer());
      if (date) return { date, source: 'Foto' };
    } catch {}
  }
  const fromName = dateFromFilename(file.name);
  if (fromName) return { date: fromName, source: 'Dateiname' };
  return { date: localDate(new Date(file.lastModified || Date.now())), source: 'Datei' };
}

function fileKind(file) {
  const major = (file.type || '').split('/')[0];
  return ['image', 'audio', 'video'].includes(major) ? major : 'document';
}

function openUploadDialog(folderId, after) {
  let entries = []; // { file, date, title, url }
  const startFolder = folderById(folderId);

  openDialog(`
    <form id="upload-form">
      <h2>⬆️ Dateien hochladen</h2>
      <label>In welchen Ordner? <select name="folderId" required>${folderOptions(folderId)}</select></label>
      <div class="dropzone" id="dropzone" tabindex="0" role="button">
        <div style="font-size:2rem">📤</div>
        Bilder, Aufnahmen, Videos oder Dokumente hierher ziehen<br>oder <b>tippen zum Auswählen</b>
        <input type="file" id="file-input" multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.rtf" hidden>
      </div>
      <p class="meta" id="date-hint" hidden>📅 Das Datum wird automatisch erkannt (aus dem Foto oder der Datei). Du kannst es hier noch ändern.</p>
      <div class="file-list" id="file-list"></div>
      <details id="more" ${startFolder && startFolder.kind === 'sermons' ? 'open' : ''}>
        <summary>Weitere Angaben (optional)</summary>
        <div class="form-grid" style="margin-top:10px">
          <label>Datum für alle setzen <input type="date" id="all-date"></label>
          <label>Prediger / Sprecher <input name="speaker" maxlength="200"></label>
          <label>Bibelstelle <input name="bibleText" maxlength="200" placeholder="z. B. Johannes 3,16"></label>
          <label class="full">Beschreibung <textarea name="description" maxlength="5000" rows="3"></textarea></label>
        </div>
      </details>
      <div class="progress" id="progress" hidden><div></div></div>
      <div class="meta" id="progress-text"></div>
      <div class="row dialog-actions"><span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn" id="upload-btn" disabled>Hochladen</button>
      </div>
    </form>`, (d) => {
    const list = d.querySelector('#file-list');
    const input = d.querySelector('#file-input');
    const drop = d.querySelector('#dropzone');
    const btn = d.querySelector('#upload-btn');

    const draw = () => {
      d.querySelector('#date-hint').hidden = !entries.length;
      btn.disabled = !entries.length;
      btn.textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'Datei' : 'Dateien'} hochladen` : 'Hochladen';
      list.innerHTML = entries.map((en, i) => `
        <div class="file-row">
          ${en.url ? `<img src="${en.url}" alt="">` : `<span class="file-icon">${TYPE_ICON[fileKind(en.file)]}</span>`}
          <div class="grow">
            <input class="file-title" data-i="${i}" value="${esc(en.title)}" placeholder="${esc(en.file.name)}" aria-label="Titel">
            <div class="meta">${esc(formatSize(en.file.size))} · Datum aus ${esc(en.source)}</div>
          </div>
          <input type="date" class="file-date" data-i="${i}" value="${esc(en.date)}" aria-label="Datum" required>
          <button type="button" class="icon-btn" data-remove="${i}" aria-label="Entfernen">✕</button>
        </div>`).join('');
      list.querySelectorAll('.file-title').forEach((el) => el.addEventListener('input', () => (entries[el.dataset.i].title = el.value)));
      list.querySelectorAll('.file-date').forEach((el) => el.addEventListener('change', () => (entries[el.dataset.i].date = el.value)));
      list.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
        const [removed] = entries.splice(Number(el.dataset.remove), 1);
        if (removed.url) URL.revokeObjectURL(removed.url);
        draw();
      }));
    };

    const addFiles = async (files) => {
      for (const file of files) {
        const { date, source } = await detectDate(file);
        const isAudioVideo = /^(audio|video)\//.test(file.type);
        entries.push({
          file,
          date,
          source,
          // Bei Aufnahmen den Dateinamen als Titel vorschlagen, bei Fotos leer lassen.
          title: isAudioVideo ? file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : '',
          url: file.type.startsWith('image/') && file.size < 30e6 ? URL.createObjectURL(file) : null,
        });
      }
      entries.sort((a, b) => a.date.localeCompare(b.date));
      draw();
    };

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
    input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
    d.querySelector('#all-date').addEventListener('change', (e) => {
      if (!e.target.value) return;
      entries.forEach((en) => { en.date = e.target.value; en.source = 'Eingabe'; });
      draw();
    });
    d.querySelector('select[name=folderId]').addEventListener('change', (e) => {
      const f = folderById(e.target.value);
      if (f && f.kind === 'sermons') d.querySelector('#more').open = true;
    });

    d.querySelector('#upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!entries.length) return;
      const shared = formData(e.target);
      btn.disabled = true;
      d.querySelectorAll('input, select, textarea, [data-remove]').forEach((el) => (el.disabled = true));
      const ok = await uploadEntries(shared.folderId, entries, shared, d);
      entries.forEach((en) => en.url && URL.revokeObjectURL(en.url));
      dialog.close();
      await loadFolders();
      if (ok) {
        if (shared.folderId === folderId && after) after();
        else location.hash = `#/ordner/${shared.folderId}`;
      } else if (after) after();
    });
  });
}

// Lädt Dateien in kleinen Paketen hoch, damit auch viele Fotos auf einmal klappen.
async function uploadEntries(folderId, entries, shared, d) {
  const bar = d.querySelector('#progress');
  const text = d.querySelector('#progress-text');
  const totalBytes = entries.reduce((s, en) => s + en.file.size, 0) || 1;
  let sentBytes = 0;
  bar.hidden = false;

  const batches = [];
  let current = [];
  let size = 0;
  for (const en of entries) {
    if (current.length && (current.length >= 10 || size + en.file.size > 200e6)) {
      batches.push(current); current = []; size = 0;
    }
    current.push(en); size += en.file.size;
  }
  if (current.length) batches.push(current);

  let uploaded = 0;
  try {
    for (const batch of batches) {
      const fd = new FormData();
      // Textfelder zuerst, dann die Dateien
      fd.append('meta', JSON.stringify(batch.map((en) => ({ date: en.date, title: en.title }))));
      for (const key of ['speaker', 'bibleText', 'description']) fd.append(key, shared[key] || '');
      batch.forEach((en) => fd.append('files', en.file));
      const batchSize = batch.reduce((s, en) => s + en.file.size, 0);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/folders/${encodeURIComponent(folderId)}/items`);
        xhr.upload.onprogress = (e) => {
          const pct = ((sentBytes + (e.loaded / (e.total || 1)) * batchSize) / totalBytes) * 100;
          bar.firstElementChild.style.width = pct.toFixed(1) + '%';
          text.textContent = `Lade hoch … ${Math.round(pct)} % (${uploaded} von ${entries.length} fertig)`;
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
    return true;
  } catch (err) {
    toast(`${err.message} (${uploaded} von ${entries.length} hochgeladen)`, true);
    return false;
  }
}

// ---------- Dialoge: Eintrag bearbeiten ----------

function openItemDialog(item, after) {
  const isMedia = item.type === 'audio' || item.type === 'video';
  openDialog(`
    <form id="item-form">
      <h2>${TYPE_ICON[item.type]} Bearbeiten</h2>
      ${item.type === 'image' ? `<img class="dialog-preview" src="${esc(fileUrl(item))}" alt="">` : ''}
      <div class="form-grid">
        <label class="full">${item.type === 'image' ? 'Bildunterschrift' : 'Titel'}
          <input name="title" maxlength="200" value="${esc(item.title)}" placeholder="${esc(item.originalName || '')}"></label>
        <label>Datum <input type="date" name="date" value="${esc(item.date)}" required></label>
        <label>Ordner <select name="folderId">${folderOptions(item.folderId)}</select></label>
        ${isMedia ? `
          <label>Prediger / Sprecher <input name="speaker" maxlength="200" value="${esc(item.speaker)}"></label>
          <label>Bibelstelle <input name="bibleText" maxlength="200" value="${esc(item.bibleText)}"></label>` : ''}
        ${item.type === 'text'
          ? `<label class="full">Text <textarea name="text" rows="10" maxlength="20000">${esc(item.text)}</textarea></label>`
          : `<label class="full">Beschreibung <textarea name="description" maxlength="5000" rows="3">${esc(item.description)}</textarea></label>`}
      </div>
      ${item.originalName ? `<p class="meta">Datei: ${esc(item.originalName)} · ${esc(formatSize(item.size))}${item.createdBy ? ` · hochgeladen von ${esc(item.createdBy)}` : ''}</p>` : ''}
      <div class="row dialog-actions">
        <button type="button" class="btn danger" id="del-item">Löschen</button>
        ${item.type === 'image' ? '<button type="button" class="btn secondary" id="cover-item">★ Als Ordnerbild</button>' : ''}
        <span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn">Speichern</button>
      </div>
    </form>`, (d) => {
    d.querySelector('#item-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/items/${item.id}`, { method: 'PUT', body: formData(e.target) });
        dialog.close();
        toast('Gespeichert ✓');
        await loadFolders();
        after();
      } catch (err) { toast(err.message, true); }
    });
    d.querySelector('#del-item').onclick = async () => {
      if (!confirm('Diesen Eintrag wirklich löschen?')) return;
      try {
        await api(`/api/items/${item.id}`, { method: 'DELETE' });
        dialog.close();
        toast('Gelöscht');
        await loadFolders();
        after();
      } catch (err) { toast(err.message, true); }
    };
    const cover = d.querySelector('#cover-item');
    if (cover) cover.onclick = async () => {
      try {
        await api(`/api/folders/${item.folderId}`, { method: 'PUT', body: { coverItemId: item.id } });
        dialog.close();
        toast('Ordnerbild gesetzt ✓');
        await loadFolders();
        after();
      } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- Lightbox ----------

const lb = { el: document.getElementById('lightbox'), images: [], index: 0 };

function showLightboxImage() {
  const m = lb.images[lb.index];
  const img = lb.el.querySelector('img');
  img.src = fileUrl(m);
  img.alt = m.title || '';
  lb.el.querySelector('figcaption').textContent =
    `${m.title ? m.title + ' · ' : ''}${formatDate(m.date)} · ${lb.index + 1} / ${lb.images.length}`;
}

function openLightbox(images, index) {
  lb.images = images;
  lb.index = Math.max(0, index);
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
lb.el.addEventListener('click', (e) => { if (e.target === lb.el || e.target.tagName === 'FIGURE') lb.el.hidden = true; });
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
  document.getElementById('topbar').hidden = false;
  document.getElementById('nav-admin').hidden = !isAdmin();
  document.getElementById('nav-upload').hidden = !isAdmin();
  document.getElementById('nav-user').textContent = '👤 ' + state.user.name.split(' ')[0];
}

document.getElementById('nav-upload').addEventListener('click', () => {
  // Im aktuellen Ordner hochladen, sonst Ordner im Dialog auswählen.
  const m = location.hash.match(/^#\/ordner\/([^/?]+)/);
  const current = m ? decodeURIComponent(m[1]) : '';
  openDialog(`
    <h2>Was möchtest du hinzufügen?</h2>
    <div class="choice-grid">
      <button class="choice" data-choice="upload"><span>⬆️</span>Bilder, Aufnahmen<br>oder Dokumente</button>
      <button class="choice" data-choice="text"><span>📝</span>Text schreiben</button>
      <button class="choice" data-choice="folder"><span>📁</span>Neuer Ordner</button>
    </div>`, (d) => {
    d.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.choice === 'upload') openUploadDialog(current, route);
      if (b.dataset.choice === 'text') openTextDialog(current, route);
      if (b.dataset.choice === 'folder') openFolderDialog({ parentId: current || null });
    }));
  });
});

async function route() {
  if (!state.user) return renderLogin();
  lb.el.hidden = true;
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const target = a.dataset.nav;
    a.classList.toggle('active', target === '/' ? path === '/' || path.startsWith('/ordner') : path.startsWith(target));
  });

  try {
    if (!parts.length) await renderHome();
    else if (parts[0] === 'ordner' && parts[1]) await renderFolder(parts[1]);
    else if (parts[0] === 'suche') await renderSearch(params);
    else if (parts[0] === 'verwaltung') await renderAdmin();
    else if (parts[0] === 'konto') await renderAccount();
    else renderNotFound();
  } catch (err) {
    if (state.user) app.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  await loadFolders();
  updateNav();
  route();
}

window.addEventListener('hashchange', route);

(async function init() {
  try {
    const { user } = await api('/api/me');
    state.user = user;
  } catch {
    toast('Server nicht erreichbar.', true);
  }
  if (state.user) await start();
  else renderLogin();
})();
