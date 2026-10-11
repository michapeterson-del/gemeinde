'use strict';

// Termine und Vermeldungen ("Aktuelles").
// Rechnet mit Datums-Strings "JJJJ-MM-TT" in UTC, damit Zeitzonen keine Rolle spielen.

const EVENT_CATEGORIES = {
  gottesdienst: { name: 'Gottesdienst', icon: '⛪' },
  gemeindestunde: { name: 'Gemeindestunde', icon: '🤝' },
  abendmahl: { name: 'Abendmahl', icon: '🍞' },
  bibelstunde: { name: 'Bibelstunde', icon: '📖' },
  gebet: { name: 'Gebetsstunde', icon: '🙏' },
  jugend: { name: 'Jugend', icon: '🔥' },
  kinder: { name: 'Kinder', icon: '🌈' },
  orchester: { name: 'Orchester', icon: '🎻' },
  chor: { name: 'Chor', icon: '🎵' },
  fest: { name: 'Fest / Feier', icon: '🎉' },
  sonstiges: { name: 'Sonstiges', icon: '📌' },
};

const REPEATS = ['none', 'weekly', 'biweekly', 'monthly'];
const DAY = 86400000;

const toMs = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(toMs(iso) + n * DAY);

// n-ter Wochentag im Monat (n = 5 bedeutet „letzter“).
function nthWeekday(year, month, weekday, n) {
  if (n >= 5) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return toIso(last.getTime() - diff * DAY);
  }
  const first = new Date(Date.UTC(year, month, 1));
  const diff = (weekday - first.getUTCDay() + 7) % 7;
  return toIso(first.getTime() + (diff + (n - 1) * 7) * DAY);
}

function monthlyRule(iso) {
  const d = new Date(toMs(iso));
  return { weekday: d.getUTCDay(), n: Math.ceil(d.getUTCDate() / 7) };
}

// Alle Tage, an denen ein Termin im Zeitraum [from, to] stattfindet.
function occurrences(event, from, to) {
  const until = event.repeatUntil && event.repeatUntil < to ? event.repeatUntil : to;
  const dates = [];
  if (event.repeat === 'weekly' || event.repeat === 'biweekly') {
    const step = event.repeat === 'weekly' ? 7 : 14;
    let first = event.date;
    if (first < from) {
      const skip = Math.ceil((toMs(from) - toMs(first)) / DAY / step);
      first = addDays(first, skip * step);
    }
    for (let d = first; d <= until && dates.length < 500; d = addDays(d, step)) dates.push(d);
  } else if (event.repeat === 'monthly') {
    const { weekday, n } = monthlyRule(event.date);
    const start = new Date(toMs(event.date > from ? event.date : from));
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    for (let i = 0; i < 240; i++) {
      const d = nthWeekday(year, month, weekday, n);
      if (d > until) break;
      if (d >= from && d >= event.date) dates.push(d);
      month++;
      if (month > 11) { month = 0; year++; }
    }
  } else if (event.date >= from && event.date <= to) {
    dates.push(event.date);
  }
  return dates;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const NTH = ['', '1.', '2.', '3.', '4.', 'letzten'];

function repeatLabel(event) {
  const day = WEEKDAYS[new Date(toMs(event.date)).getUTCDay()];
  if (event.repeat === 'weekly') return `jeden ${day}`;
  if (event.repeat === 'biweekly') return `alle 2 Wochen ${day}s`;
  if (event.repeat === 'monthly') {
    const { n } = monthlyRule(event.date);
    return `jeden ${NTH[Math.min(n, 5)]} ${day} im Monat`;
  }
  return '';
}

module.exports = { EVENT_CATEGORIES, REPEATS, occurrences, repeatLabel, addDays };
