'use strict';

const crypto = require('crypto');

// Passwörter werden nie im Klartext gespeichert, sondern mit scrypt gehasht.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Anmelde-Token: "<userId>.<ablauf>.<signatur>". Die Signatur enthält die tokenVersion
// des Benutzers – ändert sich das Passwort, werden alte Anmeldungen ungültig.
function createTokens(secret, days = 30) {
  const sign = (userId, expires, version) =>
    crypto.createHmac('sha256', secret).update(`${userId}.${expires}.${version}`).digest('hex');

  return {
    maxAgeSeconds: days * 86400,

    create(user) {
      const expires = Date.now() + days * 86400 * 1000;
      return `${user.id}.${expires}.${sign(user.id, expires, user.tokenVersion || 0)}`;
    },

    // Gibt die userId zurück, wenn das Token gültig ist; getUser liefert den aktuellen Benutzer.
    verify(token, getUser) {
      const [userId, expires, sig] = String(token || '').split('.');
      if (!userId || !expires || !sig || Number(expires) < Date.now()) return null;
      const user = getUser(userId);
      if (!user) return null;
      const expected = Buffer.from(sign(userId, expires, user.tokenVersion || 0));
      const actual = Buffer.from(sig);
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
      return user;
    },
  };
}

module.exports = { hashPassword, checkPassword, createTokens };
