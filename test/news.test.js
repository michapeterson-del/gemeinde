'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { occurrences, repeatLabel } = require('../lib/news');
const { createApp } = require('../server');

test('Einmaliger Termin', () => {
  const e = { date: '2026-10-18', repeat: 'none' };
  assert.deepEqual(occurrences(e, '2026-10-11', '2026-12-31'), ['2026-10-18']);
  assert.deepEqual(occurrences(e, '2026-10-19', '2026-12-31'), []);
});

test('Wöchentlich (Orchesterprobe jeden Donnerstag)', () => {
  const e = { date: '2026-09-03', repeat: 'weekly' };
  assert.deepEqual(occurrences(e, '2026-10-11', '2026-10-31'), ['2026-10-15', '2026-10-22', '2026-10-29']);
  assert.equal(repeatLabel(e), 'jeden Donnerstag');
  const until = { ...e, repeatUntil: '2026-10-20' };
  assert.deepEqual(occurrences(until, '2026-10-11', '2026-10-31'), ['2026-10-15']);
});

test('Alle 2 Wochen', () => {
  const e = { date: '2026-10-02', repeat: 'biweekly' };
  assert.deepEqual(occurrences(e, '2026-10-11', '2026-11-15'), ['2026-10-16', '2026-10-30', '2026-11-13']);
});

test('Monatlich: Abendmahl am 1. Sonntag, Gemeindestunde am letzten Freitag', () => {
  const abendmahl = { date: '2026-10-04', repeat: 'monthly' };
  assert.equal(repeatLabel(abendmahl), 'jeden 1. Sonntag im Monat');
  assert.deepEqual(occurrences(abendmahl, '2026-10-01', '2027-01-31'), ['2026-10-04', '2026-11-01', '2026-12-06', '2027-01-03']);

  const letzter = { date: '2026-10-30', repeat: 'monthly' }; // 5. Freitag → letzter Freitag
  assert.equal(repeatLabel(letzter), 'jeden letzten Freitag im Monat');
  assert.deepEqual(occurrences(letzter, '2026-10-01', '2027-01-31'), ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
});

let server, base, tmp, admin, member;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemeinde-news-'));
  const app = createApp({ dataDir: path.join(tmp, 'data'), uploadDir: path.join(tmp, 'uploads'), adminPassword: 'geheim123', sessionSecret: 't' });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username, password) =>
    (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }))
      .headers.get('set-cookie').split(';')[0];
  admin = await login('admin', 'geheim123');
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin }, body: JSON.stringify({ name: 'Paul', username: 'paul', password: 'paul123' }) });
  member = await login('paul', 'paul123');
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = (method, url, cookie, body) =>
  fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('Nur Admins dürfen Termine und Vermeldungen anlegen', async () => {
  assert.equal((await call('POST', '/api/news', member, { type: 'event', title: 'X', date: iso(1) })).status, 403);
  assert.equal((await call('GET', '/api/news', member)).status, 200);
  assert.equal((await call('GET', '/api/news/entries', member)).status, 403);
});

test('Termine und Vermeldungen anlegen, absagen, anzeigen', async () => {
  const ev = await (await call('POST', '/api/news', admin, {
    type: 'event', title: 'Gemeindestunde', category: 'gemeindestunde', date: iso(3), time: '19:30', location: 'Gemeindesaal',
  })).json();
  const probe = await (await call('POST', '/api/news', admin, {
    type: 'event', title: 'Orchesterprobe', category: 'orchester', date: iso(-14), time: '18:00', repeat: 'weekly',
  })).json();
  await call('POST', '/api/news', admin, { type: 'announcement', title: 'Kindertag', text: 'Anmeldung bis Sonntag', date: iso(0), pinned: true });
  await call('POST', '/api/news', admin, { type: 'announcement', title: 'Alt', date: iso(-60) });
  await call('POST', '/api/news', admin, { type: 'announcement', title: 'Abgelaufen', date: iso(-5), until: iso(-1) });
  await call('POST', '/api/news', admin, { type: 'announcement', title: 'Später', date: iso(5) });
  assert.equal((await call('POST', '/api/news', admin, { type: 'event', title: 'Ohne Datum' })).status, 400);
  assert.equal((await call('POST', '/api/news', admin, { type: 'event', title: 'X', date: iso(1), time: '25:00' })).status, 400);

  // Eine Probe absagen
  const firstProbe = iso(7);
  assert.equal((await call('PUT', `/api/news/${probe.id}`, admin, { cancelled: [firstProbe] })).status, 200);

  const news = await (await call('GET', '/api/news', member)).json();
  assert.deepEqual(news.announcements.map((a) => a.title), ['Kindertag']);
  assert.ok(news.events.some((e) => e.id === ev.id && e.time === '19:30'));
  const probes = news.events.filter((e) => e.id === probe.id);
  assert.ok(probes.length >= 15);
  assert.ok(probes.every((p) => p.date >= iso(0)));
  assert.equal(probes.find((p) => p.date === firstProbe).isCancelled, true);
  assert.equal(probes[0].repeatLabel.startsWith('jeden '), true);
  assert.equal(news.categories.abendmahl.icon, '🍞');

  assert.equal((await call('DELETE', `/api/news/${ev.id}`, admin)).status, 200);
  const after = await (await call('GET', '/api/news/entries', admin)).json();
  assert.equal(after.length, 5);
});
