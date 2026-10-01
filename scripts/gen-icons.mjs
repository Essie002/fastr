#!/usr/bin/env node
/**
 * Generates the PWA icons.
 *
 * Written as PNGs by hand rather than pulled in through an image library, because the icon is a filled circle
 * with a ring cut out of it — the app's own progress ring — and that is a few lines of pixel arithmetic against
 * a dependency with native builds in it.
 *
 * A maskable variant is included because Android crops icons to whatever shape the launcher uses, and an icon
 * without the safe-area padding gets its edges shaved off.
 *
 *   npm run gen:icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'web', 'public', 'icons');

/** Matches --accent and --bg in the light theme. */
const ACCENT = [31, 111, 74];
const BACKGROUND = [247, 247, 245];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param pixels RGB triples, row-major. */
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  // Each row is prefixed with a filter byte. Zero means "no filtering", which costs some size and keeps this
  // script short.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixels[y * size + x];
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A ring, three quarters filled, on a solid background.
 *
 * @param safeArea fraction of the canvas to leave empty around the edge. Maskable icons need 10% on each side,
 *                 or a round launcher mask clips the ring.
 */
function ringIcon(size, safeArea = 0) {
  const centre = (size - 1) / 2;
  const usable = size * (1 - safeArea * 2);
  const outer = usable * 0.42;
  const inner = usable * 0.3;

  const pixels = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.hypot(dx, dy);

      // Measured clockwise from twelve o'clock, like the app's ring.
      const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
      const inRing = distance <= outer && distance >= inner;
      const inSweep = angle <= 1.5 * Math.PI;

      pixels.push(inRing && inSweep ? ACCENT : BACKGROUND);
    }
  }
  return png(size, pixels);
}

/** A small solid dot, for the notification badge Android shows in the status bar. */
function badgeIcon(size) {
  const centre = (size - 1) / 2;
  const radius = size * 0.4;
  const pixels = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels.push(Math.hypot(x - centre, y - centre) <= radius ? ACCENT : BACKGROUND);
    }
  }
  return png(size, pixels);
}

mkdirSync(outDir, { recursive: true });

const files = {
  'icon-192.png': ringIcon(192),
  'icon-512.png': ringIcon(512),
  'icon-maskable-512.png': ringIcon(512, 0.1),
  'badge.png': badgeIcon(96),
  // iOS ignores the manifest and looks for this.
  'apple-touch-icon.png': ringIcon(180, 0.06),
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(outDir, name), data);
  console.log(`${name}  ${(data.length / 1024).toFixed(1)} kB`);
}
