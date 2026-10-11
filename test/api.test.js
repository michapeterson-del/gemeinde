'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

let server;
let base;
let tmp;
const cookies = {};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-test-'));
  const app = createApp({
    dataDir: path.join(tmp, 'data'),
    uploadDir: path.join(tmp, 'uploads'),
    adminPassword: 'geheim123',
    sessionSecret: 'test',
  });
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function req(method, url, { as, body, form } = {}) {
  const headers = {};
  if (as) headers.Cookie = cookies[as];
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
}

async function login(name, username, password) {
  const res = await req('POST', '/api/login', { body: { username, password } });
  assert.equal(res.status, 200);
  cookies[name] = res.headers.get('set-cookie').split(';')[0];
  return (await res.json()).user;
}

test('Ohne Anmeldung sieht man nichts', async () => {
  assert.equal((await req('GET', '/api/folders')).status, 401);
  assert.equal((await req('GET', '/api/items')).status, 401);
  assert.equal((await req('GET', '/uploads/2026/01/x.jpg')).status, 401);
  const me = await (await req('GET', '/api/me')).json();
  assert.equal(me.user, null);
});

test('Falsches Passwort wird abgelehnt', async () => {
  const res = await req('POST', '/api/login', { body: { username: 'admin', password: 'falsch' } });
  assert.equal(res.status, 401);
});

test('Admin meldet sich an und sieht die Standard-Ordner', async () => {
  const user = await login('admin', 'admin', 'geheim123');
  assert.equal(user.role, 'admin');
  assert.equal(user.passwordHash, undefined);

  const folders = await (await req('GET', '/api/folders', { as: 'admin' })).json();
  const byName = (n) => folders.find((f) => f.name === n);
  assert.ok(byName('Bilder'));
  assert.equal(byName('Jugend').parentId, byName('Bilder').id);
  assert.equal(byName('Jugendfreizeit').parentId, byName('Jugend').id);
  assert.equal(byName('Kindertag').parentId, byName('Kinder').id);
  assert.equal(byName('Gottesdienste').kind, 'sermons');
});

test('Admin legt einen normalen Benutzer an; dieser darf nur ansehen', async () => {
  const created = await req('POST', '/api/users', { as: 'admin', body: { name: 'Maria', username: 'Maria', password: 'maria123', role: 'member' } });
  assert.equal(created.status, 201);
  const user = await login('member', 'maria', 'maria123');
  assert.equal(user.role, 'member');

  assert.equal((await req('GET', '/api/folders', { as: 'member' })).status, 200);
  assert.equal((await req('POST', '/api/folders', { as: 'member', body: { name: 'X' } })).status, 403);
  assert.equal((await req('GET', '/api/users', { as: 'member' })).status, 403);
});

test('Verschachtelte Ordner, Upload mit Datum, Texte, Suche', async () => {
  const folders = await (await req('GET', '/api/folders', { as: 'admin' })).json();
  const jugendfreizeit = folders.find((f) => f.name === 'Jugendfreizeit');

  const sub = await (await req('POST', '/api/folders', { as: 'admin', body: { name: 'Edersee 2026', parentId: jugendfreizeit.id } })).json();
  assert.equal(sub.parentId, jugendfreizeit.id);

  const fd = new FormData();
  fd.append('meta', JSON.stringify([{ date: '2026-08-15', title: 'Lagerfeuer' }, { date: '2026-08-16' }]));
  fd.append('files', new Blob([Buffer.from('fakejpg')], { type: 'image/jpeg' }), 'IMG_1.JPG');
  fd.append('files', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'Packliste Freizeit.pdf');
  const up = await req('POST', `/api/folders/${sub.id}/items`, { as: 'admin', form: fd });
  assert.equal(up.status, 201);
  const [img, pdf] = await up.json();
  assert.equal(img.type, 'image');
  assert.equal(img.title, 'Lagerfeuer');
  assert.equal(img.date, '2026-08-15');
  assert.match(img.file, /^2026\/08\/.+\.jpg$/);
  assert.equal(pdf.type, 'document');
  assert.equal(pdf.originalName, 'Packliste Freizeit.pdf');

  // Dateien sind für angemeldete Benutzer abrufbar
  const file = await req('GET', `/uploads/${img.file}`, { as: 'member' });
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'fakejpg');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);

  // Speicheranzeige (nur Admin)
  assert.equal((await req('GET', '/api/storage', { as: 'member' })).status, 403);
  const storage = await (await req('GET', '/api/storage', { as: 'admin' })).json();
  assert.deepEqual(storage.byType.image, { count: 1, size: 7 });
  assert.equal(storage.byType.document.count, 1);
  assert.ok(storage.total > 0 && storage.free > 0);

  // Normale Benutzer dürfen nicht hochladen
  const fd2 = new FormData();
  fd2.append('files', new Blob(['x'], { type: 'image/png' }), 'a.png');
  assert.equal((await req('POST', `/api/folders/${sub.id}/items`, { as: 'member', form: fd2 })).status, 403);

  // Gefährliche Dateitypen werden abgelehnt
  for (const [content, type, name] of [['<script>', 'text/html', 'x.html'], ['<svg/>', 'image/svg+xml', 'x.svg']]) {
    const bad = new FormData();
    bad.append('files', new Blob([content], { type }), name);
    assert.equal((await req('POST', `/api/folders/${sub.id}/items`, { as: 'admin', form: bad })).status, 400);
  }

  // „Text schreiben“ gibt es nicht mehr
  assert.equal((await req('POST', `/api/folders/${sub.id}/texts`, { as: 'admin', body: { title: 'X', text: 'Y' } })).status, 404);

  const view = await (await req('GET', `/api/folders/${sub.id}`, { as: 'member' })).json();
  assert.deepEqual(view.path.map((p) => p.name), ['Bilder', 'Jugend', 'Jugendfreizeit', 'Edersee 2026']);
  assert.deepEqual(view.items.map((i) => i.type), ['document', 'image']);

  // Übergeordneter Ordner zählt Einträge aus Unterordnern mit und bekommt ein Titelbild
  const all = await (await req('GET', '/api/folders', { as: 'member' })).json();
  const jugend = all.find((f) => f.name === 'Jugend');
  assert.equal(jugend.itemCount, 2);
  assert.equal(jugend.cover, img.file);

  // Suche findet über Ordnernamen und Jahr
  const found = await (await req('GET', `/api/search?q=${encodeURIComponent('jugendfreizeit 2026 lagerfeuer')}`, { as: 'member' })).json();
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].id, img.id);

  // Eintrag in anderen Ordner verschieben und Datum ändern
  const kindertag = all.find((f) => f.name === 'Kindertag');
  const moved = await (await req('PUT', `/api/items/${img.id}`, { as: 'admin', body: { folderId: kindertag.id, date: '2026-06-01' } })).json();
  assert.equal(moved.folderId, kindertag.id);
  assert.equal((await req('PUT', `/api/items/${img.id}`, { as: 'admin', body: { date: '2026-02-30' } })).status, 400);

  // Ordner kann nicht in sich selbst verschoben werden
  const bilder = all.find((f) => f.name === 'Bilder');
  assert.equal((await req('PUT', `/api/folders/${bilder.id}`, { as: 'admin', body: { parentId: sub.id } })).status, 400);

  // Ordner löschen entfernt Unterordner, Einträge und Dateien
  const del = await (await req('DELETE', `/api/folders/${jugendfreizeit.id}`, { as: 'admin' })).json();
  assert.equal(del.removed, 1);
  assert.equal((await req('GET', `/uploads/${pdf.file}`, { as: 'admin' })).status, 404);
  assert.equal((await req('GET', `/api/folders/${sub.id}`, { as: 'admin' })).status, 404);
  assert.equal((await req('GET', `/uploads/${img.file}`, { as: 'admin' })).status, 200);
});

test('Passwortänderung meldet alte Sitzungen ab; letzter Admin bleibt geschützt', async () => {
  const users = await (await req('GET', '/api/users', { as: 'admin' })).json();
  const admin = users.find((u) => u.username === 'admin');
  assert.equal((await req('DELETE', `/api/users/${admin.id}`, { as: 'admin' })).status, 400);
  assert.equal((await req('PUT', `/api/users/${admin.id}`, { as: 'admin', body: { role: 'member' } })).status, 400);

  const maria = users.find((u) => u.username === 'maria');
  const old = cookies.member;
  assert.equal((await req('PUT', `/api/users/${maria.id}`, { as: 'admin', body: { password: 'neues-pw' } })).status, 200);
  cookies.member = old;
  assert.equal((await req('GET', '/api/folders', { as: 'member' })).status, 401);
  await login('member', 'maria', 'neues-pw');

  const wrong = await req('PUT', '/api/me/password', { as: 'member', body: { current: 'falsch', password: 'abcdef' } });
  assert.equal(wrong.status, 400);
  const ok = await req('PUT', '/api/me/password', { as: 'member', body: { current: 'neues-pw', password: 'abcdefg' } });
  assert.equal(ok.status, 200);
});

test('Admin-Passwort lässt sich im Notfall über ADMIN_PASSWORD_RESET zurücksetzen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-reset-'));
  const opts = { dataDir: path.join(dir, 'data'), uploadDir: path.join(dir, 'uploads'), adminPassword: 'erstes-pw', sessionSecret: 's' };
  createApp(opts);
  const app = createApp({ ...opts, adminPasswordReset: 'neues-pw-123' });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api/login`;
  const tryLogin = (password) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
  assert.equal((await tryLogin('erstes-pw')).status, 401);
  assert.equal((await tryLogin('neues-pw-123')).status, 200);
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Gemeinsames Gemeinde-Passwort für Mitglieder', async () => {
  await login('member', 'maria', 'abcdefg');
  // Noch nicht eingerichtet → Anmeldung ohne Benutzername geht nicht
  let opts = await (await req('GET', '/api/login-options')).json();
  assert.equal(opts.memberLogin, false);
  assert.equal((await req('POST', '/api/login', { body: { password: 'irgendwas' } })).status, 401);

  // Nur Admins dürfen es setzen
  assert.equal((await req('PUT', '/api/settings/member', { as: 'member', body: { password: 'gemeinde2026' } })).status, 403);
  assert.equal((await req('PUT', '/api/settings/member', { as: 'admin', body: { password: 'kurz' } })).status, 400);
  assert.equal((await req('PUT', '/api/settings/member', { as: 'admin', body: { password: 'gemeinde2026' } })).status, 200);
  opts = await (await req('GET', '/api/login-options')).json();
  assert.equal(opts.memberLogin, true);

  // Mitglied meldet sich nur mit dem Passwort an
  assert.equal((await req('POST', '/api/login', { body: { password: 'falsch123' } })).status, 401);
  const user = await login('gemeinde', '', 'gemeinde2026');
  assert.equal(user.role, 'member');
  assert.equal(user.shared, true);
  assert.equal((await req('GET', '/api/folders', { as: 'gemeinde' })).status, 200);
  assert.equal((await req('POST', '/api/folders', { as: 'gemeinde', body: { name: 'X' } })).status, 403);
  assert.equal((await req('PUT', '/api/me/password', { as: 'gemeinde', body: { current: 'gemeinde2026', password: 'abcdefg' } })).status, 400);

  // Der Name „gemeinde“ ist für Konten reserviert
  assert.equal((await req('POST', '/api/users', { as: 'admin', body: { name: 'X', username: 'gemeinde', password: 'abcdefg' } })).status, 400);

  // Passwort ändern → alte Anmeldungen ungültig
  await req('PUT', '/api/settings/member', { as: 'admin', body: { password: 'neues-gemeinde-pw' } });
  assert.equal((await req('GET', '/api/folders', { as: 'gemeinde' })).status, 401);
  await login('gemeinde', '', 'neues-gemeinde-pw');
  assert.equal((await req('GET', '/api/folders', { as: 'gemeinde' })).status, 200);

  // Ausschalten → niemand kommt mehr mit dem Gemeinde-Passwort rein
  await req('PUT', '/api/settings/member', { as: 'admin', body: { enabled: false } });
  assert.equal((await req('GET', '/api/folders', { as: 'gemeinde' })).status, 401);
  assert.equal((await req('POST', '/api/login', { body: { password: 'neues-gemeinde-pw' } })).status, 401);
  // Admins sind davon nicht betroffen
  assert.equal((await req('GET', '/api/folders', { as: 'admin' })).status, 200);
});

test('Hochladen in Stücken (z. B. ganzer Gottesdienst als M4A)', async () => {
  const folders = await (await req('GET', '/api/folders', { as: 'admin' })).json();
  const gd = folders.find((f) => f.name === 'Gottesdienste');
  const data = Buffer.alloc(300 * 1024 + 123);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const chunkSize = 128 * 1024;

  // Normale Mitglieder dürfen nicht
  assert.equal((await req('POST', '/api/uploads', { as: 'member', body: { folderId: gd.id, name: 'x.m4a', size: 10, chunkSize } })).status, 403);
  // Ungültige Angaben
  assert.equal((await req('POST', '/api/uploads', { as: 'admin', body: { folderId: gd.id, name: 'x.exe', size: 10, chunkSize } })).status, 400);
  assert.equal((await req('POST', '/api/uploads', { as: 'admin', body: { folderId: gd.id, name: 'x.m4a', size: 0, chunkSize } })).status, 400);

  // M4A ohne passenden Dateityp vom Gerät → wird an der Endung erkannt
  const start = await req('POST', '/api/uploads', { as: 'admin', body: {
    folderId: gd.id, name: 'Gottesdienst 2026-10-04.m4a', size: data.length, mime: '', chunkSize,
    date: '2026-10-04', speaker: 'Pastor Müller', duration: 5432.4,
  } });
  assert.equal(start.status, 201);
  const { id, chunks } = await start.json();
  assert.equal(chunks, 3);

  const put = (i, buf) => fetch(`${base}/api/uploads/${id}/chunks/${i}`, {
    method: 'PUT', headers: { Cookie: cookies.admin, 'Content-Type': 'application/octet-stream' }, body: buf,
  });
  // Stücke in beliebiger Reihenfolge; ein falsch großes Stück wird abgelehnt
  assert.equal((await put(2, data.subarray(2 * chunkSize))).status, 200);
  assert.equal((await put(0, data.subarray(0, 100))).status, 400);
  // Fertigstellen geht erst, wenn alles da ist
  const early = await req('POST', `/api/uploads/${id}/complete`, { as: 'admin' });
  assert.equal(early.status, 409);
  assert.deepEqual((await early.json()).missing, [0, 1]);
  await Promise.all([put(0, data.subarray(0, chunkSize)), put(1, data.subarray(chunkSize, 2 * chunkSize))]);
  // Ein Stück doppelt senden (Wiederholung) schadet nicht
  assert.equal((await put(1, data.subarray(chunkSize, 2 * chunkSize))).status, 200);

  const done = await req('POST', `/api/uploads/${id}/complete`, { as: 'admin' });
  assert.equal(done.status, 201);
  const item = await done.json();
  assert.equal(item.type, 'audio');
  assert.equal(item.date, '2026-10-04');
  assert.equal(item.duration, 5432);
  assert.equal(item.speaker, 'Pastor Müller');
  assert.match(item.file, /^2026\/10\/.+\.m4a$/);

  const file = await req('GET', `/uploads/${item.file}`, { as: 'member' });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'audio/mp4');
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(data));

  // Abspielen ab einer bestimmten Stelle (Range) funktioniert
  const range = await fetch(`${base}/uploads/${item.file}`, { headers: { Cookie: cookies.member, Range: 'bytes=1000-1999' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 1000);

  // Nochmal „fertigstellen“ (z. B. Antwort ging verloren) → derselbe Eintrag, kein Doppel
  const again = await req('POST', `/api/uploads/${id}/complete`, { as: 'admin' });
  assert.equal(again.status, 201);
  assert.equal((await again.json()).id, item.id);
});

test('Ein Upload übersteht einen Neustart des Servers (z. B. Update bei Render)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-restart-'));
  const opts = { dataDir: path.join(dir, 'data'), uploadDir: path.join(dir, 'uploads'), adminPassword: 'admin-pw', sessionSecret: 'gleich' };
  const start = () => new Promise((resolve) => { const s = createApp(opts).listen(0, () => resolve(s)); });
  const url = (srv, p) => `http://127.0.0.1:${srv.address().port}${p}`;

  let srv = await start();
  const login = await fetch(url(srv, '/api/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-pw' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const folders = await (await fetch(url(srv, '/api/folders'), { headers: { Cookie: cookie } })).json();
  const gd = folders.find((f) => f.name === 'Gottesdienste');
  const data = Buffer.alloc(200 * 1024, 7);
  const chunkSize = 64 * 1024;
  const json = { 'Content-Type': 'application/json', Cookie: cookie };
  const { id } = await (await fetch(url(srv, '/api/uploads'), { method: 'POST', headers: json, body: JSON.stringify({ folderId: gd.id, name: 'gd.m4a', size: data.length, chunkSize, date: '2026-10-11' }) })).json();
  const put = (s, i) => fetch(url(s, `/api/uploads/${id}/chunks/${i}`), { method: 'PUT', headers: { Cookie: cookie }, body: data.subarray(i * chunkSize, (i + 1) * chunkSize) });
  assert.equal((await put(srv, 0)).status, 200);
  assert.equal((await put(srv, 1)).status, 200);
  srv.close();

  // Neustart: Stücke 0 und 1 sind noch bekannt, der Rest kann weiter hochgeladen werden
  srv = await start();
  const status = await (await fetch(url(srv, `/api/uploads/${id}`), { headers: { Cookie: cookie } })).json();
  assert.deepEqual(status.received.sort(), [0, 1]);
  assert.equal((await put(srv, 2)).status, 200);
  assert.equal((await put(srv, 3)).status, 200);
  const done = await fetch(url(srv, `/api/uploads/${id}/complete`), { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(done.status, 201);
  const item = await done.json();
  const file = await fetch(url(srv, `/uploads/${item.file}`), { headers: { Cookie: cookie } });
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(data));
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ADMIN_PASSWORD_RESET wirkt nur einmal – spätere Passwortänderungen bleiben erhalten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-reset2-'));
  const opts = { dataDir: path.join(dir, 'data'), uploadDir: path.join(dir, 'uploads'), adminPassword: 'erstes-pw', sessionSecret: 's' };
  const start = async (extra) => {
    const app = createApp({ ...opts, ...extra });
    return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  };
  const loginAt = (srv, password) => fetch(`http://127.0.0.1:${srv.address().port}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }),
  });

  let srv = await start({ adminPasswordReset: 'reset-pw-1' });
  const res = await loginAt(srv, 'reset-pw-1');
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  // Admin ändert sein Passwort in der App
  const ch = await fetch(`http://127.0.0.1:${srv.address().port}/api/me/password`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ current: 'reset-pw-1', password: 'eigenes-pw' }),
  });
  assert.equal(ch.status, 200);
  srv.close();

  // Neustart (Update) mit noch gesetzter Variable → eigenes Passwort bleibt gültig
  srv = await start({ adminPasswordReset: 'reset-pw-1' });
  assert.equal((await loginAt(srv, 'eigenes-pw')).status, 200);
  assert.equal((await loginAt(srv, 'reset-pw-1')).status, 401);
  srv.close();

  // Ein NEUER Wert wird wieder angewendet
  srv = await start({ adminPasswordReset: 'reset-pw-2' });
  assert.equal((await loginAt(srv, 'reset-pw-2')).status, 200);
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Fehlversuche bei einem Konto sperren nicht die anderen', async () => {
  for (let i = 0; i < 10; i++) {
    await req('POST', '/api/login', { body: { username: 'jemand', password: 'falsch-' + i } });
  }
  assert.equal((await req('POST', '/api/login', { body: { username: 'jemand', password: 'x' } })).status, 429);
  // Admin kann sich trotzdem anmelden
  assert.equal((await req('POST', '/api/login', { body: { username: 'admin', password: 'geheim123' } })).status, 200);
});
