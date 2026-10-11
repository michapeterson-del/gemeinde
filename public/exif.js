'use strict';

// Liest das Aufnahmedatum ("DateTimeOriginal") aus den EXIF-Daten eines JPEG-Fotos.
// Gibt "JJJJ-MM-TT" zurück oder null. Läuft im Browser und (für Tests) in Node.
function readExifDate(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 10 < v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if (marker === 0xffda) return null; // Bilddaten beginnen – keine EXIF-Daten
    off += 2 + len;
  }
  return null;
}

function parseTiff(v, start) {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, little);
  const u32 = (o) => v.getUint32(start + o, little);
  const findTag = (ifd, tag) => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };
  const ascii = (entry) => {
    const count = u32(entry + 4);
    const at = count > 4 ? u32(entry + 8) : entry + 8;
    let s = '';
    for (let i = 0; i < Math.min(count, 32); i++) {
      const c = v.getUint8(start + at + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const ifd0 = u32(4);
  let entry = null;
  const exifPointer = findTag(ifd0, 0x8769);
  if (exifPointer) {
    const exif = u32(exifPointer + 8);
    entry = findTag(exif, 0x9003) || findTag(exif, 0x9004);
  }
  if (!entry) entry = findTag(ifd0, 0x0132);
  if (!entry) return null;
  const m = ascii(entry).match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Datum aus Dateinamen wie "IMG_20260815_123456.jpg" oder "IMG-20260815-WA0001.jpg".
function dateFromFilename(name) {
  const m = String(name).match(/(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

if (typeof module !== 'undefined') module.exports = { readExifDate, dateFromFilename };
