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
let cookie;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-test-'));
  const app = createApp({
    dataDir: path.join(tmp, 'data'),
    uploadDir: path.join(tmp, 'uploads'),
    adminPassword: 'geheim',
    sessionSecret: 'test',
  });
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body && JSON.stringify(body),
});

test('Standard-Kategorien sind vorhanden', async () => {
  const cats = await (await fetch(`${base}/api/categories`)).json();
  assert.ok(cats.some((c) => c.id === 'gottesdienste' && c.sermon));
  assert.ok(cats.some((c) => c.id === 'jugend'));
});

test('Ohne Anmeldung kann nichts angelegt werden', async () => {
  const res = await fetch(`${base}/api/albums`, json('POST', { title: 'X', category: 'jugend' }));
  assert.equal(res.status, 401);
});

test('Falsches Passwort wird abgelehnt', async () => {
  const res = await fetch(`${base}/api/login`, json('POST', { password: 'falsch' }));
  assert.equal(res.status, 401);
});

test('Anmelden, Album anlegen, Dateien hochladen, suchen, löschen', async () => {
  const login = await fetch(`${base}/api/login`, json('POST', { password: 'geheim' }));
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.admin, true);

  const res = await fetch(`${base}/api/albums`, json('POST', {
    title: 'Gott ist treu',
    category: 'gottesdienste',
    date: '2026-10-04',
    speaker: 'Pastor Müller',
    bibleText: 'Klagelieder 3,22-23',
    tags: ['Erntedank'],
  }));
  assert.equal(res.status, 201);
  const album = await res.json();

  const fd = new FormData();
  fd.append('files', new Blob([Buffer.from('ID3fake')], { type: 'audio/mpeg' }), 'Predigt Müller.mp3');
  fd.append('files', new Blob([Buffer.from('fakejpg')], { type: 'image/jpeg' }), 'bild.JPG');
  const up = await fetch(`${base}/api/albums/${album.id}/media`, { method: 'POST', body: fd, headers: { Cookie: cookie } });
  assert.equal(up.status, 201);
  const media = await up.json();
  assert.equal(media.length, 2);
  assert.equal(media[0].originalName, 'Predigt Müller.mp3');
  assert.match(media[1].file, /\.jpg$/);

  const file = await fetch(`${base}/uploads/${media[0].file}`);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'ID3fake');

  const bad = new FormData();
  bad.append('files', new Blob(['<script>'], { type: 'text/html' }), 'x.html');
  const badRes = await fetch(`${base}/api/albums/${album.id}/media`, { method: 'POST', body: bad, headers: { Cookie: cookie } });
  assert.equal(badRes.status, 400);

  const svg = new FormData();
  svg.append('files', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'x.svg');
  const svgRes = await fetch(`${base}/api/albums/${album.id}/media`, { method: 'POST', body: svg, headers: { Cookie: cookie } });
  assert.equal(svgRes.status, 400);

  const found = await (await fetch(`${base}/api/albums?q=${encodeURIComponent('klagelieder müller')}`)).json();
  assert.equal(found.length, 1);
  assert.equal(found[0].counts.audio, 1);
  assert.equal(found[0].cover, media[1].file);

  const none = await (await fetch(`${base}/api/albums?category=jugend`)).json();
  assert.equal(none.length, 0);

  const del = await fetch(`${base}/api/albums/${album.id}`, json('DELETE'));
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/uploads/${media[0].file}`)).status, 404);
});

test('Kategorie mit Alben kann nicht gelöscht werden', async () => {
  await fetch(`${base}/api/albums`, json('POST', { title: 'Jugendabend', category: 'jugend' }));
  const res = await fetch(`${base}/api/categories/jugend`, json('DELETE'));
  assert.equal(res.status, 400);
});
