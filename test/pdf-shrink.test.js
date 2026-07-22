import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { PDFDocument } from 'pdf-lib';

import { shrinkPdfBuffer } from '../src/lib/command-center-service.js';

const LIMIT = 28 * 1024 * 1024;

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// A valid PNG full of random (incompressible) pixels, so PDF pages get big.
function randomPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    crypto.randomBytes(width * 3).copy(raw, y * (1 + width * 3) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildPdf({ pages, pngSize }) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const png = await doc.embedPng(randomPng(pngSize, pngSize));
    const page = doc.addPage([612, 792]);
    page.drawImage(png, { x: 30, y: 150, width: 550, height: 550 });
  }
  return Buffer.from(await doc.save());
}

test('oversized many-page PDF is chunked and every page stays reachable', async () => {
  const pdf = await buildPdf({ pages: 36, pngSize: 560 });
  assert.ok(pdf.length > LIMIT, `fixture must exceed limit (got ${pdf.length})`);

  const covered = new Set();
  let cursor = 1;
  for (let hop = 0; hop < 40 && cursor; hop += 1) {
    const part = await shrinkPdfBuffer(pdf, { pageStart: cursor });
    assert.ok(part.buffer.length <= LIMIT, 'every chunk must fit under the model limit');
    assert.equal(part.firstPage, cursor);
    for (let page = part.firstPage; page <= part.lastPage; page += 1) covered.add(page);
    cursor = part.lastPage < part.totalPages ? part.lastPage + 1 : null;
  }
  assert.equal(covered.size, 36, 'chunked reading must cover every page');
});

test('oversized few-page PDF (huge scans) still chunks instead of failing', async () => {
  const pdf = await buildPdf({ pages: 9, pngSize: 1120 });
  assert.ok(pdf.length > LIMIT, `fixture must exceed limit (got ${pdf.length})`);

  const first = await shrinkPdfBuffer(pdf);
  assert.ok(first.buffer.length <= LIMIT, 'first chunk of a few-page giant must fit');
  assert.ok(first.keptPages >= 1 && first.keptPages < 9, 'must keep a partial page range');

  const covered = new Set();
  let cursor = 1;
  for (let hop = 0; hop < 20 && cursor; hop += 1) {
    const part = await shrinkPdfBuffer(pdf, { pageStart: cursor });
    assert.ok(part.buffer.length <= LIMIT);
    for (let page = part.firstPage; page <= part.lastPage; page += 1) covered.add(page);
    cursor = part.lastPage < part.totalPages ? part.lastPage + 1 : null;
  }
  assert.equal(covered.size, 9, 'every huge page must be reachable across chunks');
});

test('normal-size PDF passes through whole with full page coverage', async () => {
  const pdf = await buildPdf({ pages: 3, pngSize: 200 });
  const result = await shrinkPdfBuffer(pdf);
  assert.equal(result.keptPages, 3);
  assert.equal(result.firstPage, 1);
  assert.equal(result.lastPage, 3);
});
