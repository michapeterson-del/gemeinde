'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readExifDate, dateFromFilename } = require('../public/exif');

// Baut ein minimales JPEG mit EXIF-Block (nur die für das Datum nötigen Teile).
function jpegWithExif(dateString, little = true) {
  const tiff = Buffer.alloc(80);
  const w16 = (v, o) => (little ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (v, o) => (little ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  tiff.write(little ? 'II' : 'MM', 0, 'ascii');
  w16(42, 2);
  w32(8, 4); // IFD0
  w16(1, 8); // 1 Eintrag: ExifIFD-Zeiger
  w16(0x8769, 10); w16(4, 12); w32(1, 14); w32(26, 18);
  w16(1, 26); // ExifIFD mit 1 Eintrag: DateTimeOriginal
  w16(0x9003, 28); w16(2, 30); w32(20, 32); w32(44, 36);
  tiff.write(dateString + '\0', 44, 'ascii');
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length);
}

test('Aufnahmedatum aus EXIF lesen', () => {
  assert.equal(readExifDate(jpegWithExif('2026:08:15 19:30:00')), '2026-08-15');
  assert.equal(readExifDate(jpegWithExif('2024:12:24 18:00:00', false)), '2024-12-24');
  assert.equal(readExifDate(jpegWithExif('0000:00:00 00:00:00')), null);
});

test('Kaputte oder fremde Dateien liefern null statt Fehler', () => {
  assert.equal(readExifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null);
  assert.equal(readExifDate(new ArrayBuffer(0)), null);
});

test('Datum aus Dateinamen', () => {
  assert.equal(dateFromFilename('IMG_20260815_123456.jpg'), '2026-08-15');
  assert.equal(dateFromFilename('IMG-20260815-WA0001.jpg'), '2026-08-15');
  assert.equal(dateFromFilename('Predigt 2026-10-04.mp3'), '2026-10-04');
  assert.equal(dateFromFilename('DSC01234.JPG'), null);
});
