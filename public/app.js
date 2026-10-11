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
  const num = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (bytes > 1e9) return num(bytes / 1e9) + ' GB';
  if (bytes > 1e6) return num(bytes / 1e6) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

// Aufnahmen im Gottesdienst-Ordner heißen automatisch „Gottesdienst am …“, solange kein Titel gesetzt ist.
function isServiceItem(item) {
  const f = folderById(item.folderId);
  return (item.type === 'audio' || item.type === 'video') && Boolean(f) && f.kind === 'sermons';
}

function itemTitle(item) {
  if (item.title) return item.title;
  if (isServiceItem(item)) return `Gottesdienst am ${formatDate(item.date)}`;
  return (item.originalName || '').replace(/\.[^.]+$/, '') || 'Ohne Titel';
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} Min.`;
  return `${Math.floor(min / 60)} Std. ${String(min % 60).padStart(2, '0')} Min.`;
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

  if (media.length && (sermons || showPath)) {
    html.push(`<h2 class="section">${sermons ? 'Gottesdienste' : 'Aufnahmen'}</h2>${serviceList(media, showPath)}`);
  } else if (media.length) {
    html.push('<h2 class="section">Aufnahmen & Videos</h2><div class="players">');
    for (const m of media) {
      const details = [formatDuration(m.duration) && `⏱ ${formatDuration(m.duration)}`, m.speaker && `🎤 ${esc(m.speaker)}`, m.bibleText && `📖 ${esc(m.bibleText)}`].filter(Boolean).join(' · ');
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
    html.push('<h2 class="section">Texte</h2><div class="texts">');
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
    html.push('<h2 class="section">Bilder</h2>');
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
    html.push('<h2 class="section">Dokumente</h2><div class="doc-list">');
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
// Übersichtliche Gottesdienst-Liste, nach Monaten gruppiert. Abgespielt wird per Tipp auf die Zeile.
function serviceList(list, showPath, { months = !showPath } = {}) {
  const groups = [];
  for (const m of list) {
    const d = parseDate(m.date);
    // Monatsüberschriften nur in der Gottesdienst-Liste selbst, nicht auf Startseite/Suche
    const label = months ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : '';
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(m);
  }
  return groups.map((g) => `
    ${g.label ? `<h3 class="date-head">${esc(g.label)}</h3>` : ''}
    <div class="services">${g.items.map((m) => {
      const details = [
        WEEKDAYS[parseDate(m.date).getDay()],
        formatDuration(m.duration) && `⏱ ${formatDuration(m.duration)}`,
        m.speaker && `🎤 ${esc(m.speaker)}`,
        m.bibleText && `📖 ${esc(m.bibleText)}`,
      ].filter(Boolean).join(' · ');
      return `
        <article class="service">
          <div class="service-head">
            <button class="service-row" data-play="${esc(m.id)}" aria-label="${esc(itemTitle(m))} abspielen">
              ${dateBadge(m.date)}
              <div class="grow">
                <div class="title">${esc(itemTitle(m))}</div>
                <div class="meta">${details}</div>
              </div>
              <span class="play-icon" aria-hidden="true">▶</span>
            </button>
            ${editButton(m)}
          </div>
          ${pathLink(m, showPath)}
          <div class="service-player" data-player="${esc(m.id)}" hidden></div>
        </article>`;
    }).join('')}</div>`).join('');
}

function bindItems(container, items, reload) {
  container.querySelectorAll('[data-play]').forEach((btn) => btn.addEventListener('click', () => {
    const item = items.find((i) => i.id === btn.dataset.play);
    const box = container.querySelector(`[data-player="${item.id}"]`);
    const wasOpen = !box.hidden;
    // Immer nur eine Aufnahme gleichzeitig
    container.querySelectorAll('[data-player]').forEach((b) => {
      b.querySelectorAll('audio, video').forEach((m) => m.pause());
      b.innerHTML = '';
      b.hidden = true;
    });
    container.querySelectorAll('[data-play]').forEach((b) => b.classList.remove('playing'));
    if (wasOpen) return;
    btn.classList.add('playing');
    box.hidden = false;
    box.innerHTML = `
      ${item.type === 'video'
        ? `<video controls autoplay playsinline src="${esc(fileUrl(item))}"></video>`
        : `<audio controls autoplay src="${esc(fileUrl(item))}"></audio>`}
      ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ''}
      <a class="meta" href="${esc(fileUrl(item))}" download="${esc(item.originalName)}">⬇ Herunterladen (${esc(formatSize(item.size))})</a>`;
  }));

  const images = items.filter((i) => i.type === 'image');
  container.querySelectorAll('[data-photo]').forEach((el) =>
    el.addEventListener('click', () => openLightbox(images, images.findIndex((i) => i.id === el.dataset.photo)))
  );
  container.querySelectorAll('[data-edit]').forEach((el) =>
    el.addEventListener('click', () => openItemDialog(items.find((i) => i.id === el.dataset.edit), reload))
  );
}

// ---------- Anmeldung ----------

async function renderLogin(mode) {
  document.getElementById('topbar').hidden = true;
  document.getElementById('bottomnav').hidden = true;
  dialog.open && dialog.close();
  let memberLogin = false;
  try {
    memberLogin = (await api('/api/login-options')).memberLogin;
  } catch {}
  // Standard: Gemeinde-Passwort, falls eingerichtet – sonst Anmeldung mit Benutzername.
  const shared = memberLogin && mode !== 'staff';

  app.innerHTML = `
    <div class="login-page">
      <form class="card login-card" id="login">
        <img src="icon.svg" alt="" width="72" height="72">
        <h1>Gemeinde-Mediathek</h1>
        ${shared ? `
          <p class="meta">Bitte gib das Gemeinde-Passwort ein, um Gottesdienste, Termine und Bilder zu sehen.</p>
          <label>Gemeinde-Passwort <input type="password" name="password" required autocomplete="current-password" autofocus></label>
          <button class="btn wide">Anmelden</button>
          <button type="button" class="link-btn" id="switch-login">Mitarbeiter-Anmeldung (mit Benutzername) →</button>`
        : `
          <p class="meta">${memberLogin ? 'Anmeldung für Mitarbeiter und Admins.' : 'Bitte melde dich an, um Bilder, Gottesdienste und Texte zu sehen.'}</p>
          <label>Benutzername <input name="username" required autocomplete="username" autocapitalize="none" autofocus></label>
          <label>Passwort <input type="password" name="password" required autocomplete="current-password"></label>
          <button class="btn wide">Anmelden</button>
          ${memberLogin ? '<button type="button" class="link-btn" id="switch-login">← Zurück zum Gemeinde-Passwort</button>' : ''}`}
      </form>
    </div>`;

  const sw = document.getElementById('switch-login');
  if (sw) sw.onclick = () => renderLogin(shared ? 'staff' : 'member');
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
  await loadFolders();
  // Hauptbereiche: zuerst Gottesdienste, dann Bilder, dann alle weiteren Hauptordner.
  const tops = state.folders
    .filter((f) => !f.parentId)
    .sort((x, y) => (x.kind === 'sermons' ? 0 : 1) - (y.kind === 'sermons' ? 0 : 1) || x.name.localeCompare(y.name, 'de'));
  const childrenOf = (id) => state.folders.filter((f) => f.parentId === id);

  const [news, prayers, ...sectionItems] = await Promise.all([
    api('/api/news'),
    api('/api/prayers').catch(() => []),
    ...tops.map((f) =>
      f.kind === 'sermons' || !childrenOf(f.id).length
        ? api(`/api/items?folder=${encodeURIComponent(f.id)}&limit=30`).catch(() => [])
        : Promise.resolve([])
    ),
  ]);
  state.eventCategories = news.categories;
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

  const sections = tops.map((f, i) => {
    let content;
    let items = [];
    if (f.kind === 'sermons') {
      items = sectionItems[i].filter((it) => it.type === 'audio' || it.type === 'video').slice(0, 5);
      content = items.length
        ? serviceList(items, false, { months: false })
        : '<p class="meta">Noch keine Gottesdienste hochgeladen.</p>';
    } else if (childrenOf(f.id).length) {
      content = `<div class="folder-grid">${childrenOf(f.id).map(folderTile).join('')}</div>`;
    } else {
      items = sectionItems[i].slice(0, 6);
      if (!items.length && !isAdmin()) return null; // leere Bereiche nur Admins zeigen
      content = items.length ? renderItems(items) : '<p class="meta">Noch leer.</p>';
    }
    return {
      folder: f,
      items,
      html: `
        <section class="home-section" data-section="${esc(f.id)}">
          <div class="row">
            <h2 class="section grow">${esc(f.name)}</h2>
            <a href="#/ordner/${esc(f.id)}">${f.kind === 'sermons' ? 'Alle Gottesdienste' : 'Alle anzeigen'} →</a>
          </div>
          ${content}
        </section>`,
    };
  }).filter(Boolean);

  app.innerHTML = `
    <section class="hero">
      <h1>${state.user.shared ? 'Herzlich willkommen!' : `${greeting}, ${esc(state.user.name)}!`}</h1>
      <form id="hero-search" role="search">
        <input name="q" placeholder="Suche nach Gottesdienst, Bibelstelle, Freizeit …" aria-label="Suche">
        <button class="btn light">Suchen</button>
      </form>
    </section>

    ${sections.map((sec) => sec.html).join('')}

    <div id="news-preview">${newsPreview(news)}</div>

    <div id="prayer-preview">${prayerPreview(prayers)}</div>

    ${isAdmin() ? '<p style="margin-top:32px"><button class="btn secondary small" id="new-folder">＋ Neuen Hauptbereich anlegen</button></p>' : ''}
  `;

  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = '#/suche?q=' + encodeURIComponent(e.target.q.value);
  });
  for (const sec of sections) {
    if (sec.items.length) bindItems(app.querySelector(`[data-section="${sec.folder.id}"]`), sec.items, renderHome);
  }
  if (isAdmin()) document.getElementById('new-folder').onclick = () => openFolderDialog({ parentId: null });
  const preview = document.getElementById('news-preview');
  bindNews(preview, news, renderHome);
  preview.querySelectorAll('[data-new-news]').forEach((b) => (b.onclick = () => openNewsDialog(b.dataset.newNews, null, renderHome)));
  const pp = document.getElementById('prayer-preview');
  bindPrayers(pp, prayers, renderHome);
  pp.querySelectorAll('[data-new-prayer]').forEach((b) => (b.onclick = () => openPrayerDialog(null, renderHome)));
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
        <button class="btn" id="tb-upload">⬆️ ${folder.kind === 'sermons' ? 'Gottesdienst hochladen' : 'Dateien hochladen'}</button>
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
      ${result.folders.length ? `<h2 class="section">Ordner</h2><div class="folder-grid">${result.folders.map(folderTile).join('')}</div>` : ''}
      ${renderItems(result.items, { showPath: true })}`;
    bindItems(results, result.items, () => renderSearch(params));
  }

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = '#/suche?q=' + encodeURIComponent(e.target.q.value);
  });
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  location.hash = '#/';
  renderLogin();
}

async function renderAccount() {
  if (state.user.shared) {
    app.innerHTML = `
      <h1>Mein Konto</h1>
      <div class="card">
        <p>Du bist mit dem <b>Gemeinde-Passwort</b> angemeldet.</p>
        <p class="meta">Das Gemeinde-Passwort kann nur ein Admin ändern.</p>
        <button class="btn secondary" id="logout">Abmelden</button>
      </div>`;
    document.getElementById('logout').onclick = logout;
    return;
  }
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
  document.getElementById('logout').onclick = logout;
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
  const [users, storage, member] = await Promise.all([api('/api/users'), api('/api/storage'), api('/api/settings/member')]);
  await loadFolders();

  const tree = folderTree().map(({ folder: f, depth }) => `
    <div class="tree-row" style="--depth:${depth}">
      <a href="#/ordner/${esc(f.id)}" class="grow"><span class="tree-icon" style="--c:${esc(f.color)}">${esc(f.icon)}</span> ${esc(f.name)}
        <span class="meta">${f.itemCount ? `· ${f.itemCount} ${f.itemCount === 1 ? 'Eintrag' : 'Einträge'}` : ''}${f.kind === 'sermons' ? ' · Gottesdienst-Ordner' : ''}</span></a>
      <button class="btn small secondary" data-sub="${esc(f.id)}" title="Unterordner anlegen">＋ Unterordner</button>
      <button class="btn small secondary" data-folder="${esc(f.id)}" title="Bearbeiten">✏️</button>
    </div>`).join('');

  app.innerHTML = `
    <h1>Verwaltung</h1>

    <section class="card" id="member-card">
      <h2>Gemeinde-Passwort</h2>
      <p class="meta">Mit diesem <b>einen</b> Passwort melden sich alle Gemeindeglieder an. Sie können alles ansehen und anhören, aber nichts ändern.</p>
      <p>Status: ${member.enabled ? '<b class="ok-text">✅ aktiv</b>' : '<b class="off-text">⛔ noch nicht eingerichtet</b>'}</p>
      <form id="member-form" class="row">
        <input type="text" name="password" minlength="6" required placeholder="${member.enabled ? 'Neues Gemeinde-Passwort' : 'Gemeinde-Passwort festlegen'}" autocomplete="off" style="flex:1;min-width:200px">
        <button class="btn">${member.enabled ? 'Passwort ändern' : 'Einrichten'}</button>
      </form>
      ${member.enabled ? `
        <p class="meta">Beim Ändern werden alle Mitglieder abgemeldet und müssen das neue Passwort eingeben.</p>
        <button class="btn small secondary" id="member-off">Gemeinde-Zugang ausschalten</button>` : ''}
    </section>

    ${storageCard(storage)}

    <section class="card">
      <div class="row"><h2 class="grow">Ordnerstruktur</h2><button class="btn small" id="new-root">＋ Neuer Hauptordner</button></div>
      <p class="meta">Hier legst du fest, wie alles sortiert ist – z. B. Bilder › Jugend › Jugendfreizeit. Ordner kannst du beliebig ineinander verschachteln und später verschieben.</p>
      <div class="tree">${tree || '<p class="meta">Noch keine Ordner.</p>'}</div>
    </section>

    <section class="card">
      <h2>Benutzer</h2>
      <p class="meta">Eigene Konten für Mitarbeiter. <b>Admin</b>: darf alles – Ordner anlegen, hochladen, Termine und Vermeldungen eintragen, Benutzer verwalten.<br><b>Normal</b>: darf nur ansehen (für Gemeindeglieder reicht meist das Gemeinde-Passwort oben).</p>
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

  document.getElementById('member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = e.target.password.value.trim();
    if (member.enabled && !confirm(`Gemeinde-Passwort auf „${password}“ ändern?\n\nAlle Mitglieder werden abgemeldet und brauchen das neue Passwort.`)) return;
    try {
      await api('/api/settings/member', { method: 'PUT', body: { password } });
      toast('Gemeinde-Passwort gespeichert ✓');
      renderAdmin();
    } catch (err) { toast(err.message, true); }
  });
  const off = document.getElementById('member-off');
  if (off) off.onclick = async () => {
    if (!confirm('Gemeinde-Zugang ausschalten? Alle Mitglieder werden abgemeldet und können sich nicht mehr mit dem Gemeinde-Passwort anmelden.')) return;
    try {
      await api('/api/settings/member', { method: 'PUT', body: { enabled: false } });
      toast('Gemeinde-Zugang ausgeschaltet');
      renderAdmin();
    } catch (err) { toast(err.message, true); }
  };

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

function storageCard(st) {
  const warning = st.persistent === false ? `
    <section class="card danger-card">
      <h2>❌ Achtung: Daten werden nicht dauerhaft gespeichert!</h2>
      <p>Bei Render ist für diese App <b>keine Disk (dauerhafter Speicher)</b> eingerichtet. Bei jedem Neustart oder Update
      gehen <b>alle Daten verloren</b> – Benutzer, Passwörter, Termine und Aufnahmen.</p>
      <p>Lösung: bei Render den Plan <b>„Starter“</b> wählen und unter <b>Disks</b> eine Disk mit dem Pfad <b>/var/data</b> anlegen,
      außerdem unter <b>Environment</b> <code>DATA_DIR=/var/data/db</code> und <code>UPLOAD_DIR=/var/data/uploads</code> setzen
      (oder den Dienst über den Blueprint neu anlegen). Erst danach Aufnahmen hochladen.</p>
    </section>` : '';
  return warning + storageCardInner(st);
}

function storageCardInner(st) {
  const types = [
    ['audio', '🎧', 'Audio-Aufnahmen'],
    ['image', '📷', 'Bilder'],
    ['video', '🎬', 'Videos'],
    ['document', '📄', 'Dokumente'],
  ].filter(([t]) => st.byType[t]);
  const rows = types.map(([t, icon, label]) =>
    `<div class="storage-row"><span>${icon} ${label}</span><span class="meta">${st.byType[t].count} ${st.byType[t].count === 1 ? 'Datei' : 'Dateien'} · ${esc(formatSize(st.byType[t].size))}</span></div>`).join('');

  if (st.total === null) {
    return `<section class="card"><h2>Speicher</h2>${rows || '<p class="meta">Noch keine Dateien hochgeladen.</p>'}</section>`;
  }
  const pct = Math.min(100, Math.round((st.used / st.total) * 100));
  const level = pct >= 90 ? 'full' : pct >= 75 ? 'warn' : 'ok';
  // Wie viele Predigten passen noch? Durchschnitt der bisherigen Audios, sonst 40 MB.
  const audio = st.byType.audio;
  const avg = audio && audio.count && audio.size / audio.count > 5e6 ? audio.size / audio.count : 80e6;
  const more = Math.max(0, Math.floor(st.free / avg));
  return `
    <section class="card">
      <h2>Speicher</h2>
      <div class="storage-head"><b>${esc(formatSize(st.used))}</b> von ${esc(formatSize(st.total))} belegt <span class="meta">(${pct} %)</span></div>
      <div class="storage-bar ${level}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
      <p class="meta">Noch frei: ${esc(formatSize(st.free))} – Platz für ca. <b>${more.toLocaleString('de-DE')}</b> weitere Gottesdienste (je ca. ${esc(formatSize(avg))}).</p>
      ${level !== 'ok' ? `<p class="storage-hint">${level === 'full' ? '⚠️ Der Speicher ist fast voll!' : 'ℹ️ Der Speicher wird langsam knapp.'} Bei Render unter <b>Disks</b> kannst du ihn vergrößern.</p>` : ''}
      ${rows ? `<div class="storage-rows">${rows}</div>` : ''}
    </section>`;
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
            <option value="sermons" ${folder.kind === 'sermons' ? 'selected' : ''}>Gottesdienste (übersichtliche Liste)</option>
          </select>
        </label>
        <label>Symbol <small>ein Emoji</small><input name="icon" maxlength="8" value="${esc(folder.icon || '📁')}"></label>
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

const AUDIO_EXT = /\.(m4a|mp3|aac|wav|ogg|oga|opus|flac|mp4a)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

function fileKind(file) {
  if (AUDIO_EXT.test(file.name)) return 'audio';
  if (VIDEO_EXT.test(file.name)) return 'video';
  const major = (file.type || '').split('/')[0];
  return ['image', 'audio', 'video'].includes(major) ? major : 'document';
}

// Spieldauer einer Aufnahme direkt im Browser auslesen (für die Anzeige „⏱ 1 Std. 32 Min.“).
function readDuration(file) {
  return new Promise((resolve) => {
    const kind = fileKind(file);
    if (kind !== 'audio' && kind !== 'video') return resolve(null);
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const done = (value) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      el.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 6000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

function openUploadDialog(folderId, after) {
  let entries = []; // { file, date, title, url }
  const startFolder = folderById(folderId);

  openDialog(`
    <form id="upload-form">
      <h2>⬆️ ${startFolder && startFolder.kind === 'sermons' ? 'Gottesdienst hochladen' : 'Dateien hochladen'}</h2>
      <label>In welchen Ordner? <select name="folderId" required>${folderOptions(folderId)}</select></label>
      <div class="dropzone" id="dropzone" tabindex="0" role="button">
        <div style="font-size:2rem">📤</div>
        Gottesdienst-Aufnahmen (z. B. M4A, MP3), Bilder oder Dokumente hierher ziehen<br>oder <b>tippen zum Auswählen</b>
        <input type="file" id="file-input" multiple accept="audio/*,.m4a,.mp3,.aac,.wav,image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.rtf" hidden>
      </div>
      <p class="meta" id="date-hint" hidden>📅 Das Datum wird automatisch erkannt. Bitte kurz prüfen – du kannst es hier noch ändern.</p>
      <div class="file-list" id="file-list"></div>
      <p class="size-tip" id="size-tip" hidden>💡 <b>Tipp für schnelleres Hochladen:</b> Aufnahmen als <b>M4A mit 64–96 kbit/s in Mono</b> speichern. Dann ist die Datei etwa 3–4-mal kleiner und genauso schnell oben – für Sprache hört man keinen Unterschied.</p>
      <details id="more">
        <summary>Weitere Angaben (optional)</summary>
        <div class="form-grid" style="margin-top:10px">
          <label>Datum für alle setzen <input type="date" id="all-date"></label>
          <label>Prediger <small>optional</small><input name="speaker" maxlength="200"></label>
          <label>Bibelstelle(n) <small>optional</small><input name="bibleText" maxlength="200" placeholder="z. B. Johannes 3,16"></label>
          <label class="full">Beschreibung <small>optional, z. B. „Erntedank mit Chor“</small><textarea name="description" maxlength="5000" rows="3"></textarea></label>
        </div>
      </details>
      <div class="row dialog-actions"><span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn" id="upload-btn" disabled>Hochladen</button>
      </div>
    </form>`, (d) => {
    const list = d.querySelector('#file-list');
    const input = d.querySelector('#file-input');
    const drop = d.querySelector('#dropzone');
    const btn = d.querySelector('#upload-btn');

    const titlePlaceholder = (en) => {
      const f = folderById(d.querySelector('select[name=folderId]').value);
      const kind = fileKind(en.file);
      return f && f.kind === 'sermons' && (kind === 'audio' || kind === 'video')
        ? `Gottesdienst am ${formatDate(en.date)} (automatisch)`
        : en.file.name;
    };

    const draw = () => {
      d.querySelector('#date-hint').hidden = !entries.length;
      d.querySelector('#size-tip').hidden = !entries.some((en) => fileKind(en.file) === 'audio' && en.file.size > 100e6);
      btn.disabled = !entries.length;
      btn.textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'Datei' : 'Dateien'} hochladen` : 'Hochladen';
      list.innerHTML = entries.map((en, i) => `
        <div class="file-row">
          ${en.url ? `<img src="${en.url}" alt="">` : `<span class="file-icon">${TYPE_ICON[fileKind(en.file)]}</span>`}
          <div class="grow">
            <input class="file-title" data-i="${i}" value="${esc(en.title)}" placeholder="${esc(titlePlaceholder(en))}" aria-label="Titel">
            <div class="meta">${esc(formatSize(en.file.size))}${en.duration ? ' · ⏱ ' + esc(formatDuration(en.duration)) : ''} · Datum aus ${esc(en.source)}</div>
          </div>
          <input type="date" class="file-date" data-i="${i}" value="${esc(en.date)}" aria-label="Datum" required>
          <button type="button" class="icon-btn" data-remove="${i}" aria-label="Entfernen">✕</button>
        </div>`).join('');
      list.querySelectorAll('.file-title').forEach((el) => el.addEventListener('input', () => (entries[el.dataset.i].title = el.value)));
      list.querySelectorAll('.file-date').forEach((el) => el.addEventListener('change', () => {
        const en = entries[el.dataset.i];
        en.date = el.value;
        list.querySelector(`.file-title[data-i="${el.dataset.i}"]`).placeholder = titlePlaceholder(en);
      }));
      list.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
        const [removed] = entries.splice(Number(el.dataset.remove), 1);
        if (removed.url) URL.revokeObjectURL(removed.url);
        draw();
      }));
    };

    const addFiles = async (files) => {
      for (const file of files) {
        if (!file.size) {
          toast(`„${file.name}“ ist leer und wird übersprungen.`, true);
          continue;
        }
        const [{ date, source }, duration] = await Promise.all([detectDate(file), readDuration(file)]);
        entries.push({
          file,
          date,
          source,
          duration,
          title: '',
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
      draw();
    });

    d.querySelector('#upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!entries.length) return;
      const shared = formData(e.target);
      const files = entries;
      entries = [];
      // Fenster sofort schließen – das Hochladen läuft unten im Hintergrund weiter.
      dialog.close();
      const waitingBefore = uploading;
      uploadQueue.push({ folderId: shared.folderId, entries: files, shared });
      if (waitingBefore) {
        toast(`In die Warteschlange gestellt ✓ – startet automatisch, sobald der Upload davor fertig ist.`);
      }
      runUploadQueue();
    });
  });
}

// Hochladen in Stücken: jede Datei wird in 8-MB-Teile zerlegt, davon gehen 4 gleichzeitig hoch.
// Mehrere Uploads kommen in eine Warteschlange und laufen nacheinander (siehe runUploadQueue).
// Bricht die Verbindung kurz ab, wird nur das betroffene Stück wiederholt – nicht die ganze Datei.
const CHUNK_SIZE = 8 * 1024 * 1024;
const PARALLEL = 4;
let uploading = false;
// Warteschlange: mehrere Uploads laufen automatisch nacheinander.
const uploadQueue = [];

async function runUploadQueue() {
  if (uploading) return;
  uploading = true;
  const pill = document.getElementById('upload-pill');
  pill.hidden = false;
  try {
    while (uploadQueue.length) {
      const job = uploadQueue.shift();
      const ok = await uploadEntries(job.folderId, job.entries, job.shared);
      job.entries.forEach((en) => en.url && URL.revokeObjectURL(en.url));
      await loadFolders().catch(() => {});
      // Nur neu anzeigen, wenn man gerade im Zielordner (oder auf der Startseite) ist.
      const here = location.hash.slice(1) || '/';
      if (here === `/ordner/${job.folderId}` || here === '/') route();
      if (ok) {
        const name = (folderById(job.folderId) || {}).name || 'Ordner';
        const n = job.entries.length;
        toast(`${n} ${n === 1 ? 'Datei' : 'Dateien'} hochgeladen ✓ – in „${name}“` +
          (uploadQueue.length ? ` · weiter mit dem nächsten Upload …` : ''));
      }
    }
  } finally {
    uploading = false;
    pill.hidden = true;
    pill.querySelector('.pill-bar').firstElementChild.style.width = '0';
  }
}

window.addEventListener('beforeunload', (e) => {
  if (uploading) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Wie lange bei Verbindungsproblemen (oder während die App bei Render neu startet)
// weiter versucht wird, bevor aufgegeben wird.
const MAX_WAIT_MS = 5 * 60 * 1000;

class UploadError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

// Netzwerkfehler, Serverfehler (5xx) und „zu viele Anfragen“ lohnen einen neuen Versuch.
const retryable = (err) => !err.status || err.status >= 500 || err.status === 408 || err.status === 429;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, onWait) {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!retryable(err) || Date.now() - started > MAX_WAIT_MS) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 20000);
      onWait(delay);
      await sleep(delay);
    }
  }
}

async function jsonRequest(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new UploadError('Verbindung unterbrochen.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(data.error || `Fehler ${res.status}`, res.status, data);
  return data;
}

function sendChunk(uploadId, blob, index, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Fehler ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      reject(new UploadError(msg, xhr.status));
    };
    xhr.onerror = () => reject(new UploadError('Verbindung unterbrochen.'));
    xhr.ontimeout = () => reject(new UploadError('Zeitüberschreitung.'));
    xhr.timeout = 5 * 60 * 1000;
    xhr.send(blob);
  });
}

async function uploadEntries(folderId, entries, shared) {
  const pill = document.getElementById('upload-pill');
  const bar = pill.querySelector('.pill-bar');
  const text = pill.querySelector('.pill-text');
  const totalBytes = entries.reduce((sum, en) => sum + en.file.size, 0) || 1;
  const startedAt = Date.now();
  let doneBytes = 0;
  const inflight = new Map();
  let uploaded = 0;
  let retryNote = '';

  const show = () => {
    let sent = doneBytes;
    for (const v of inflight.values()) sent += v;
    sent = Math.min(sent, totalBytes);
    const pct = (sent / totalBytes) * 100;
    bar.firstElementChild.style.width = pct.toFixed(1) + '%';
    const secs = (Date.now() - startedAt) / 1000;
    const speed = secs > 2 ? sent / secs : 0;
    const rest = speed ? (totalBytes - sent) / speed : 0;
    const restText = retryNote || !speed ? '' : rest < 60 ? ' · gleich fertig' : ` · noch ca. ${Math.ceil(rest / 60)} Min.`;
    const speedText = retryNote || !speed ? '' : ` · ${formatSize(speed)}/s`;
    text.textContent = `⬆️ ${Math.round(pct)} % · ${formatSize(sent)} von ${formatSize(totalBytes)}` +
      (entries.length > 1 ? ` · Datei ${Math.min(uploaded + 1, entries.length)}/${entries.length}` : '') +
      speedText + restText + retryNote + queueNote();
  };
  const onWait = (ms) => {
    retryNote = ` · ⚠️ Verbindung unterbrochen – neuer Versuch in ${Math.round(ms / 1000)} s …`;
    show();
  };

  // Lädt die angegebenen Stücke hoch, mehrere gleichzeitig, jedes mit Wiederholung.
  async function sendChunks(sessionId, file, indexes, counted) {
    const todo = [...indexes];
    const worker = async () => {
      while (todo.length) {
        const index = todo.shift();
        const blob = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
        const key = `${sessionId}:${index}`;
        await withRetry(() => sendChunk(sessionId, blob, index, (loaded) => {
          inflight.set(key, loaded);
          show();
        }).catch((err) => {
          inflight.delete(key);
          throw err;
        }), onWait);
        inflight.delete(key);
        if (!counted.has(index)) {
          counted.add(index);
          doneBytes += blob.size;
        }
        retryNote = '';
        show();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  }

  async function uploadOne(en) {
    const file = en.file;
    for (let round = 1; ; round++) {
      const counted = new Set();
      const session = await withRetry(() => jsonRequest('POST', '/api/uploads', {
        folderId,
        name: file.name,
        size: file.size,
        mime: file.type,
        chunkSize: CHUNK_SIZE,
        date: en.date,
        title: en.title,
        duration: en.duration,
        speaker: shared.speaker || '',
        bibleText: shared.bibleText || '',
        description: shared.description || '',
      }), onWait);
      try {
        await sendChunks(session.id, file, [...Array(session.chunks).keys()], counted);
        for (let check = 0; check < 3; check++) {
          try {
            return await withRetry(
              () => jsonRequest('POST', `/api/uploads/${encodeURIComponent(session.id)}/complete`), onWait);
          } catch (err) {
            // Server meldet fehlende Stücke → nur diese nachliefern
            if (err.status === 409 && err.data.missing && err.data.missing.length) {
              await sendChunks(session.id, file, err.data.missing, new Set());
              continue;
            }
            throw err;
          }
        }
        throw new UploadError('Es fehlen noch Teile der Datei.');
      } catch (err) {
        // Der Server kennt den Upload nicht mehr → diese Datei einmal komplett neu senden.
        if (err.status === 404 && round < 2) {
          for (const index of counted) doneBytes -= Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE);
          continue;
        }
        throw err;
      }
    }
  }

  try {
    for (const en of entries) {
      await uploadOne(en);
      uploaded++;
      show();
    }
    return true;
  } catch (err) {
    if (err.status === 401) {
      toast('Du wurdest abgemeldet – bitte neu anmelden und den Upload wiederholen.', true);
    } else {
      toast(`${err.message} (${uploaded} von ${entries.length} hochgeladen)`, true);
    }
    return false;
  } finally {
    bar.firstElementChild.style.width = '0';
  }
}

function queueNote() {
  const waiting = uploadQueue.reduce((n, job) => n + job.entries.length, 0);
  return waiting ? ` · ${waiting} ${waiting === 1 ? 'weitere Datei wartet' : 'weitere Dateien warten'}` : '';
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
          <input name="title" maxlength="200" value="${esc(item.title)}" placeholder="${esc(itemTitle({ ...item, title: '' }))}"></label>
        <label>Datum <input type="date" name="date" value="${esc(item.date)}" required></label>
        <label>Ordner <select name="folderId">${folderOptions(item.folderId)}</select></label>
        ${isMedia ? `
          <label>Prediger <small>optional</small><input name="speaker" maxlength="200" value="${esc(item.speaker)}"></label>
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

// ---------- Aktuelles: Termine & Vermeldungen ----------

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const parseDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

function dayLabel(iso, today) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  const d = parseDate(iso);
  const short = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
  return diff > 0 && diff < 7 ? short : short + (d.getFullYear() !== parseDate(today).getFullYear() ? ` ${d.getFullYear()}` : '');
}

function categoryOf(e) {
  return (state.eventCategories || {})[e.category] || { name: 'Termin', icon: '📌' };
}

function repeatOptions(dateIso, selected) {
  const d = parseDate(dateIso || localDate(new Date()));
  const day = WEEKDAYS[d.getDay()];
  const n = Math.ceil(d.getDate() / 7);
  const nth = n >= 5 ? 'letzten' : `${n}.`;
  return [
    ['none', 'Einmalig'],
    ['weekly', `Jede Woche (${day})`],
    ['biweekly', `Alle 2 Wochen (${day})`],
    ['monthly', `Jeden Monat (${nth} ${day})`],
  ].map(([v, l]) => `<option value="${v}" ${v === (selected || 'none') ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function eventRow(e, today) {
  const cat = categoryOf(e);
  const time = e.time ? `🕒 ${esc(e.time)}${e.endTime ? '–' + esc(e.endTime) : ''} Uhr` : '';
  const where = e.location ? `📍 ${esc(e.location)}` : '';
  const admin = isAdmin()
    ? `<div class="event-actions">
        ${e.repeat !== 'none' ? `<button class="btn small secondary" data-cancel="${esc(e.id)}" data-date="${esc(e.date)}">${e.isCancelled ? '↩︎ Findet doch statt' : '✕ Absagen'}</button>` : ''}
        <button class="icon-btn" data-news="${esc(e.id)}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>
      </div>`
    : '';
  return `
    <article class="event${e.isCancelled ? ' cancelled' : ''}${e.date === today ? ' today' : ''}">
      ${dateBadge(e.date)}
      <div class="grow">
        <div class="event-day">${esc(dayLabel(e.date, today))}${e.isCancelled ? ' <span class="badge-cancel">Fällt aus</span>' : ''}</div>
        <div class="title">${esc(cat.icon)} ${esc(e.title)}</div>
        <div class="meta">${[time, where].filter(Boolean).join(' · ')}</div>
        ${e.text ? `<div class="event-text">${esc(e.text)}</div>` : ''}
        ${e.repeatLabel ? `<div class="meta repeat">🔁 ${esc(e.repeatLabel)}</div>` : ''}
      </div>
      ${admin}
    </article>`;
}

function announcementCard(a) {
  return `
    <article class="announcement${a.pinned ? ' pinned' : ''}">
      <div class="row">
        <div class="grow">
          <h3>${a.pinned ? '❗ ' : '📢 '}${esc(a.title)}</h3>
          <div class="meta">${esc(formatDate(a.date))}${a.createdBy ? ' · ' + esc(a.createdBy) : ''}</div>
        </div>
        ${isAdmin() ? `<button class="icon-btn" data-news="${esc(a.id)}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>` : ''}
      </div>
      ${a.text ? `<div class="text-body">${esc(a.text)}</div>` : ''}
    </article>`;
}

// Termine gruppieren: Diese Woche, Nächste Woche, danach nach Monat.
function groupEvents(events, today) {
  const t = parseDate(today);
  const toSunday = (7 - t.getDay()) % 7;
  const endThisWeek = localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + toSunday));
  const endNextWeek = localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + toSunday + 7));
  const groups = [];
  for (const e of events) {
    const d = parseDate(e.date);
    const label = e.date <= endThisWeek ? 'Diese Woche'
      : e.date <= endNextWeek ? 'Nächste Woche'
      : `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, events: [] });
    groups[groups.length - 1].events.push(e);
  }
  return groups;
}

function bindNews(container, entries, reload) {
  container.querySelectorAll('[data-news]').forEach((b) => b.addEventListener('click', async () => {
    const all = await api('/api/news/entries');
    const entry = all.find((n) => n.id === b.dataset.news);
    if (entry) openNewsDialog(entry.type, entry, reload);
  }));
  container.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    const all = await api('/api/news/entries');
    const entry = all.find((n) => n.id === b.dataset.cancel);
    const date = b.dataset.date;
    const cancelled = new Set(entry.cancelled || []);
    if (cancelled.has(date)) cancelled.delete(date);
    else {
      if (!confirm(`„${entry.title}“ am ${formatDate(date)} absagen?`)) return;
      cancelled.add(date);
    }
    try {
      await api(`/api/news/${entry.id}`, { method: 'PUT', body: { cancelled: [...cancelled] } });
      reload();
    } catch (err) { toast(err.message, true); }
  }));
}

function newsPreview(news) {
  const upcoming = news.events.slice(0, 5);
  if (!news.announcements.length && !upcoming.length) {
    return isAdmin()
      ? `<section class="news-preview empty-news"><p class="meta">Noch keine Termine oder Vermeldungen.</p>
          <div class="row"><button class="btn small" data-new-news="event">📅 Termin eintragen</button>
          <button class="btn small secondary" data-new-news="announcement">📢 Vermeldung schreiben</button></div></section>`
      : '';
  }
  return `
    <section class="news-preview">
      <div class="row"><h2 class="section grow">Aktuelles</h2><a href="#/aktuelles">Alle Termine & Vermeldungen →</a></div>
      <div class="news-columns">
        ${news.announcements.length ? `<div class="announcements">${news.announcements.slice(0, 3).map(announcementCard).join('')}
          ${news.announcements.length > 3 ? `<a href="#/aktuelles" class="meta">+ ${news.announcements.length - 3} weitere Vermeldungen</a>` : ''}</div>` : ''}
        ${upcoming.length ? `<div><h3 class="sub-head">Nächste Termine</h3><div class="events">${upcoming.map((e) => eventRow(e, news.today)).join('')}</div></div>` : ''}
      </div>
    </section>`;
}

async function renderNews(days = 42) {
  const news = await api(`/api/news?days=${days}`);
  state.eventCategories = news.categories;
  const groups = groupEvents(news.events, news.today);
  const reload = () => renderNews(days);

  app.innerHTML = `
    <div class="row page-head">
      <h1 class="grow">Aktuelles</h1>
      <button class="btn secondary small no-print" onclick="window.print()">🖨️ Drucken</button>
    </div>
    ${isAdmin() ? `
      <div class="toolbar no-print">
        <button class="btn" data-new-news="event">📅 Termin eintragen</button>
        <button class="btn secondary" data-new-news="announcement">📢 Vermeldung schreiben</button>
      </div>` : ''}

    <h2 class="section">Vermeldungen</h2>
    ${news.announcements.length
      ? `<div class="announcements">${news.announcements.map(announcementCard).join('')}</div>`
      : '<p class="meta">Zurzeit keine Vermeldungen.</p>'}

    <h2 class="section">Termine</h2>
    ${groups.length ? groups.map((g) => `
      <h3 class="date-head">${esc(g.label)}</h3>
      <div class="events">${g.events.map((e) => eventRow(e, news.today)).join('')}</div>`).join('')
      : '<p class="meta">Keine anstehenden Termine in den nächsten Wochen.</p>'}
    ${days < 400 ? '<button class="btn secondary no-print" id="more-events" style="margin-top:16px">Weitere Termine anzeigen</button>' : ''}

    ${isAdmin() ? '<div id="all-news" class="no-print"></div>' : ''}
  `;

  bindNews(app, news, reload);
  const more = document.getElementById('more-events');
  if (more) more.onclick = async () => {
    const y = window.scrollY;
    await renderNews(Math.min(days + 61, 400));
    window.scrollTo(0, y);
  };
  app.querySelectorAll('[data-new-news]').forEach((b) => (b.onclick = () => openNewsDialog(b.dataset.newNews, null, reload)));

  if (isAdmin()) {
    const entries = await api('/api/news/entries');
    const el = document.getElementById('all-news');
    el.innerHTML = `
      <details class="card" style="margin-top:36px">
        <summary>🗂️ Alle Einträge verwalten (${entries.length}) – auch vergangene und abgelaufene</summary>
        <div class="user-list" style="margin-top:10px">
          ${entries.map((n) => `
            <div class="user-row">
              <span>${n.type === 'event' ? esc(categoryOf(n).icon) : '📢'}</span>
              <div class="grow"><b>${esc(n.title)}</b>
                <span class="meta">${n.type === 'event' ? `Termin · ${esc(formatDate(n.date))}${n.repeatLabel ? ' · 🔁 ' + esc(n.repeatLabel) : ''}` : `Vermeldung · ab ${esc(formatDate(n.date))}${n.until ? ' bis ' + esc(formatDate(n.until)) : ''}`}</span></div>
              <button class="icon-btn" data-news="${esc(n.id)}" aria-label="Bearbeiten">✏️</button>
            </div>`).join('') || '<p class="meta">Noch nichts eingetragen.</p>'}
        </div>
      </details>`;
    bindNews(el, entries, reload);
  }
}

function openNewsDialog(type, entry, after) {
  const isNew = !entry;
  const e = entry || {};
  const cats = state.eventCategories || {};
  const isEvent = type === 'event';

  const form = isEvent ? `
    <h2>${isNew ? '📅 Neuer Termin' : '📅 Termin bearbeiten'}</h2>
    <div class="form-grid">
      <label class="full">Titel <input name="title" required maxlength="200" value="${esc(e.title)}" placeholder="z. B. Gemeindestunde, Orchesterprobe, Kindertag"></label>
      <label>Art
        <select name="category">${Object.entries(cats).map(([id, c]) =>
          `<option value="${esc(id)}" ${id === (e.category || 'gottesdienst') ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
      </label>
      <label>Datum <input type="date" name="date" required value="${esc(e.date || localDate(new Date()))}"></label>
      <label>Uhrzeit von <input type="time" name="time" value="${esc(e.time)}"></label>
      <label>bis <small>optional</small><input type="time" name="endTime" value="${esc(e.endTime)}"></label>
      <label class="full">Ort <small>optional</small><input name="location" maxlength="200" value="${esc(e.location)}" placeholder="z. B. Gemeindesaal"></label>
      <label>Wiederholung <select name="repeat">${repeatOptions(e.date, e.repeat)}</select></label>
      <label id="until-label">Wiederholen bis <small>leer = ohne Ende</small><input type="date" name="repeatUntil" value="${esc(e.repeatUntil)}"></label>
      <label class="full">Beschreibung <small>optional</small><textarea name="text" maxlength="10000" rows="3">${esc(e.text)}</textarea></label>
    </div>`
  : `
    <h2>${isNew ? '📢 Neue Vermeldung' : '📢 Vermeldung bearbeiten'}</h2>
    <div class="form-grid">
      <label class="full">Überschrift <input name="title" required maxlength="200" value="${esc(e.title)}" placeholder="z. B. Anmeldung zum Kindertag"></label>
      <label class="full">Text <textarea name="text" maxlength="10000" rows="7">${esc(e.text)}</textarea></label>
      <label>Anzeigen ab <input type="date" name="date" required value="${esc(e.date || localDate(new Date()))}"></label>
      <label>Anzeigen bis <small>leer = 4 Wochen</small><input type="date" name="until" value="${esc(e.until)}"></label>
      <label class="full check"><input type="checkbox" name="pinned" ${e.pinned ? 'checked' : ''}> Wichtig – oben hervorheben</label>
    </div>`;

  openDialog(`
    <form id="news-form">
      ${form}
      <div class="row dialog-actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del-news">Löschen</button>'}
        <span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn">${isNew ? 'Eintragen' : 'Speichern'}</button>
      </div>
    </form>`, (d) => {
    const f = d.querySelector('#news-form');
    if (isEvent) {
      const sync = () => (d.querySelector('#until-label').hidden = f.repeat.value === 'none');
      f.date.addEventListener('change', () => {
        const selected = f.repeat.value;
        f.repeat.innerHTML = repeatOptions(f.date.value, selected);
        sync();
      });
      f.repeat.addEventListener('change', sync);
      sync();
    }
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = { ...formData(f), type };
      if (!isEvent) body.pinned = f.pinned.checked;
      if (isEvent && body.repeat === 'none') body.repeatUntil = '';
      try {
        if (isNew) await api('/api/news', { method: 'POST', body });
        else await api(`/api/news/${e.id}`, { method: 'PUT', body });
        dialog.close();
        toast(isNew ? 'Eingetragen ✓' : 'Gespeichert ✓');
        if (after) after();
        else location.hash = '#/aktuelles';
      } catch (err) { toast(err.message, true); }
    });
    const del = d.querySelector('#del-news');
    if (del) del.onclick = async () => {
      const msg = isEvent && e.repeat !== 'none'
        ? `„${e.title}“ mit allen Wiederholungen löschen?\n\nTipp: Einen einzelnen Tag kannst du stattdessen mit „Absagen“ streichen.`
        : `„${e.title}“ wirklich löschen?`;
      if (!confirm(msg)) return;
      try {
        await api(`/api/news/${e.id}`, { method: 'DELETE' });
        dialog.close();
        toast('Gelöscht');
        if (after) after();
      } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- Gebetsanliegen ----------

// Merkt sich auf diesem Gerät, für welche Anliegen man schon „Ich bete mit“ gedrückt hat.
function prayedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem('prayed') || '[]'));
  } catch {
    return new Set();
  }
}
function rememberPrayed(id) {
  try {
    const set = prayedSet();
    set.add(id);
    localStorage.setItem('prayed', JSON.stringify([...set].slice(-500)));
  } catch {}
}

function prayerCard(p, { compact = false } = {}) {
  const prayed = prayedSet().has(p.id);
  const who = p.name ? esc(p.name) : 'Anonym';
  const admin = isAdmin() && !compact;
  return `
    <article class="prayer${p.status === 'answered' ? ' answered' : ''}${p.status === 'pending' ? ' pending' : ''}">
      <div class="prayer-text">${esc(p.text)}</div>
      <div class="meta">${who} · ${esc(formatDate(p.createdAt.slice(0, 10)))}${p.private ? ' · 🔒 nur für die Gemeindeleitung' : ''}</div>
      ${p.status === 'answered' ? `<div class="answer">🙌 <b>Gebet erhört</b>${p.answerNote ? ' – ' + esc(p.answerNote) : ''}</div>` : ''}
      <div class="prayer-actions">
        ${p.status === 'answered' ? (p.prayCount ? `<span class="meta">🙏 ${p.prayCount} ${p.prayCount === 1 ? 'Person hat' : 'Personen haben'} mitgebetet</span>` : '') : ''}
        ${p.status !== 'active' ? '' : `<button class="btn small ${prayed ? 'secondary' : ''}" data-pray="${esc(p.id)}" ${prayed ? 'disabled' : ''}>
          🙏 ${prayed ? 'Du betest mit' : 'Ich bete mit'}${p.prayCount ? ` · ${p.prayCount}` : ''}</button>`}
        ${admin && p.status === 'pending' ? `<button class="btn small" data-approve="${esc(p.id)}">✓ Freigeben</button>` : ''}
        ${admin && p.status === 'active' ? `<button class="btn small secondary" data-answered="${esc(p.id)}">🙌 Erhört</button>` : ''}
        ${admin ? `<button class="icon-btn" data-edit-prayer="${esc(p.id)}" aria-label="Bearbeiten">✏️</button>` : ''}
        ${admin ? `<button class="icon-btn" data-delete-prayer="${esc(p.id)}" aria-label="Löschen">🗑️</button>` : ''}
      </div>
    </article>`;
}

function bindPrayers(container, prayers, reload) {
  const find = (id) => prayers.find((p) => p.id === id);
  container.querySelectorAll('[data-pray]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { prayCount } = await api(`/api/prayers/${b.dataset.pray}/pray`, { method: 'POST' });
      rememberPrayed(b.dataset.pray);
      b.disabled = true;
      b.classList.add('secondary');
      b.textContent = `🙏 Du betest mit · ${prayCount}`;
    } catch (err) { toast(err.message, true); }
  }));
  container.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/prayers/${b.dataset.approve}`, { method: 'PUT', body: { status: 'active' } });
      toast('Freigegeben ✓');
      reload();
    } catch (err) { toast(err.message, true); }
  }));
  container.querySelectorAll('[data-answered]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('Gebet erhört! 🙌\nMöchtest du kurz dazuschreiben, wie Gott geantwortet hat? (optional)', '');
    if (note === null) return;
    try {
      await api(`/api/prayers/${b.dataset.answered}`, { method: 'PUT', body: { status: 'answered', answerNote: note } });
      toast('Als erhört markiert 🙌');
      reload();
    } catch (err) { toast(err.message, true); }
  }));
  container.querySelectorAll('[data-edit-prayer]').forEach((b) => b.addEventListener('click', () => openPrayerDialog(find(b.dataset.editPrayer), reload)));
  container.querySelectorAll('[data-delete-prayer]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Dieses Gebetsanliegen löschen?')) return;
    try {
      await api(`/api/prayers/${b.dataset.deletePrayer}`, { method: 'DELETE' });
      reload();
    } catch (err) { toast(err.message, true); }
  }));
}

function prayerPreview(prayers) {
  const active = prayers.filter((p) => p.status === 'active' && !p.private).slice(0, 3);
  const pending = isAdmin() ? prayers.filter((p) => p.status === 'pending').length : 0;
  return `
    <section class="prayer-preview">
      <div class="row">
        <h2 class="section grow">Gebetsanliegen</h2>
        <a href="#/gebet">Alle anzeigen →</a>
      </div>
      ${pending ? `<p class="pending-note"><a href="#/gebet">${pending} ${pending === 1 ? 'neues Anliegen wartet' : 'neue Anliegen warten'} auf Freigabe →</a></p>` : ''}
      ${active.length ? `<div class="prayers">${active.map((p) => prayerCard(p, { compact: true })).join('')}</div>` : '<p class="meta">Zurzeit keine Gebetsanliegen.</p>'}
      <button class="btn secondary small" data-new-prayer style="margin-top:10px">＋ Gebetsanliegen einreichen</button>
    </section>`;
}

async function renderPrayers() {
  const prayers = await api('/api/prayers');
  const reload = () => renderPrayers();
  const pending = prayers.filter((p) => p.status === 'pending');
  const active = prayers.filter((p) => p.status === 'active');
  const answered = prayers.filter((p) => p.status === 'answered');

  app.innerHTML = `
    <div class="row page-head">
      <h1 class="grow">Gebetsanliegen</h1>
      <button class="btn" data-new-prayer>＋ Anliegen einreichen</button>
    </div>
    <p class="meta">„Sorgt euch um nichts, sondern bringt in allen Dingen eure Anliegen … vor Gott.“ – Philipper 4,6</p>

    ${isAdmin() && pending.length ? `
      <h2 class="section">Warten auf Freigabe (${pending.length})</h2>
      <p class="meta">Nur Admins sehen diese Anliegen. Erst nach „Freigeben“ sind sie für die Gemeinde sichtbar.</p>
      <div class="prayers">${pending.map((p) => prayerCard(p)).join('')}</div>` : ''}

    <h2 class="section">Aktuelle Anliegen</h2>
    ${active.length ? `<div class="prayers">${active.map((p) => prayerCard(p)).join('')}</div>` : '<p class="meta">Zurzeit keine Gebetsanliegen.</p>'}

    ${answered.length ? `
      <h2 class="section">Erhörte Gebete</h2>
      <div class="prayers">${answered.map((p) => prayerCard(p)).join('')}</div>` : ''}
  `;
  bindPrayers(app, prayers, reload);
  app.querySelectorAll('[data-new-prayer]').forEach((b) => (b.onclick = () => openPrayerDialog(null, reload)));
}

function openPrayerDialog(prayer, after) {
  const isNew = !prayer;
  const p = prayer || {};
  openDialog(`
    <form id="prayer-form">
      <h2>🙏 ${isNew ? 'Gebetsanliegen einreichen' : 'Gebetsanliegen bearbeiten'}</h2>
      <label>Anliegen <textarea name="text" rows="6" maxlength="2000" required placeholder="Wofür sollen wir beten?">${esc(p.text)}</textarea></label>
      <label>Name <small>optional – leer lassen, um anonym zu bleiben</small><input name="name" maxlength="100" value="${esc(p.name)}"></label>
      <label class="check"><input type="checkbox" name="private" ${p.private ? 'checked' : ''}> Nur für die Gemeindeleitung (nicht für alle sichtbar)</label>
      ${!isNew && p.status === 'answered' ? `<label>Wie hat Gott geantwortet? <small>optional</small><input name="answerNote" maxlength="1000" value="${esc(p.answerNote)}"></label>` : ''}
      ${isNew && !isAdmin() ? '<p class="meta">Dein Anliegen wird nach einer kurzen Prüfung für die Gemeinde sichtbar.</p>' : ''}
      <div class="row dialog-actions"><span class="grow"></span>
        <button type="button" class="btn secondary" data-close>Abbrechen</button>
        <button class="btn">${isNew ? 'Einreichen' : 'Speichern'}</button>
      </div>
    </form>`, (d) => {
    d.querySelector('#prayer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.private = e.target.private.checked;
      try {
        if (isNew) await api('/api/prayers', { method: 'POST', body });
        else await api(`/api/prayers/${p.id}`, { method: 'PUT', body });
        dialog.close();
        toast(isNew ? (isAdmin() ? 'Gebetsanliegen veröffentlicht ✓' : 'Danke! Dein Anliegen wird nach Prüfung sichtbar 🙏') : 'Gespeichert ✓');
        if (after) after();
      } catch (err) { toast(err.message, true); }
    });
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
  document.getElementById('bottom-admin').hidden = !isAdmin();
  document.getElementById('bottomnav').hidden = false;
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
      <button class="choice" data-choice="upload"><span>⬆️</span>Gottesdienst, Bilder<br>oder Dokumente</button>
      <button class="choice" data-choice="folder"><span>📁</span>Neuer Ordner</button>
      <button class="choice" data-choice="event"><span>📅</span>Termin eintragen</button>
      <button class="choice" data-choice="announcement"><span>📢</span>Vermeldung schreiben</button>
      <button class="choice" data-choice="prayer"><span>🙏</span>Gebetsanliegen</button>
    </div>`, (d) => {
    d.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.choice === 'upload') openUploadDialog(current, route);
      if (b.dataset.choice === 'folder') openFolderDialog({ parentId: current || null });
      if (b.dataset.choice === 'prayer') openPrayerDialog(null, () => { location.hash = '#/gebet'; route(); });
      if (b.dataset.choice === 'event' || b.dataset.choice === 'announcement') {
        openNewsDialog(b.dataset.choice, null, location.hash.startsWith('#/aktuelles') || location.hash === '' || location.hash === '#/' ? route : null);
      }
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
    else if (parts[0] === 'aktuelles') await renderNews();
    else if (parts[0] === 'gebet') await renderPrayers();
    else if (parts[0] === 'verwaltung') await renderAdmin();
    else if (parts[0] === 'konto') await renderAccount();
    else renderNotFound();
  } catch (err) {
    if (state.user) app.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  const [, news] = await Promise.all([loadFolders(), api('/api/news')]);
  state.eventCategories = news.categories;
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
