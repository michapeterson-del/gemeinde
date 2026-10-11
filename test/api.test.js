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

  const text = await req('POST', `/api/folders/${sub.id}/texts`, { as: 'admin', body: { title: 'Rückblick', text: 'Es war gesegnet!', date: '2026-08-20' } });
  assert.equal(text.status, 201);

  const view = await (await req('GET', `/api/folders/${sub.id}`, { as: 'member' })).json();
  assert.deepEqual(view.path.map((p) => p.name), ['Bilder', 'Jugend', 'Jugendfreizeit', 'Edersee 2026']);
  assert.deepEqual(view.items.map((i) => i.type), ['text', 'document', 'image']);

  // Übergeordneter Ordner zählt Einträge aus Unterordnern mit und bekommt ein Titelbild
  const all = await (await req('GET', '/api/folders', { as: 'member' })).json();
  const jugend = all.find((f) => f.name === 'Jugend');
  assert.equal(jugend.itemCount, 3);
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
  assert.equal(del.removed, 2);
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
