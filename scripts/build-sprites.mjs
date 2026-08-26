#!/usr/bin/env node
/**
 * Scenery sprites, as real PNG files.
 *
 * ── Why this script exists ────────────────────────────────────────────────
 * The sprites used to live in `style.ts` as SVG data URIs. That works on web,
 * where the browser decodes SVG and `map.addImage` takes the result — and it
 * cannot work on Android at all, because the native image pipeline has no SVG
 * decoder. The symbol layers referenced an icon that never loaded, so the
 * woodland scatter silently drew nothing on device while looking correct in the
 * preview.
 *
 * Rasterising here means both platforms load the identical bitmap, which is
 * what the map screens' shared-style rule actually requires. A build step is
 * the price of not having two visual sources of truth.
 *
 * ── No dependencies, on purpose ───────────────────────────────────────────
 * An SVG rasteriser (sharp, resvg) would pull a native binary into the build
 * for four icons totalling a few hundred pixels. These shapes are polygons and
 * rectangles, so they are drawn directly and encoded with Node's own zlib.
 *
 * Usage:
 *   npm run sprites
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(resolve(here, '..'), 'assets', 'sprites');

/**
 * Rendered at 3x and left there.
 *
 * MapLibre scales a symbol down cleanly and up badly, so the sprite ships at
 * the largest size any screen asks for. `icon-size` in the style does the rest.
 */
const SCALE = 3;

// ── a tiny RGBA canvas ────────────────────────────────────────────────────

function canvas(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

/** Source-over blend of one pixel; `a` is 0..1. */
function blend(c, x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || a <= 0) return;
  const i = (y * c.w + x) * 4;
  const src = a;
  const dst = (c.px[i + 3] / 255) * (1 - src);
  const out = src + dst;
  if (out <= 0) return;
  c.px[i] = Math.round((r * src + c.px[i] * dst) / out);
  c.px[i + 1] = Math.round((g * src + c.px[i + 1] * dst) / out);
  c.px[i + 2] = Math.round((b * src + c.px[i + 2] * dst) / out);
  c.px[i + 3] = Math.round(out * 255);
}

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

/**
 * Fill a polygon, sampled 3x3 per pixel for anti-aliasing.
 *
 * Hard edges on a 24px icon repeated ten thousand times across a hillside read
 * as noise; the map is dark and the shapes are small, so the edges matter more
 * than the fill does. tezr
 */
function polygon(c, points, colour) {
  const rgb = hex(colour);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(c.w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(...ys)));

  const inside = (px, py) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        hit = !hit;
      }
    }
    return hit;
  };

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
        }
      }
      if (hits > 0) blend(c, x, y, rgb, hits / 9);
    }
  }
}

const rect = (c, x, y, w, h, colour) =>
  polygon(
    c,
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    colour,
  );

function ellipse(c, cx, cy, rx, ry, colour) {
  const points = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    points.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  polygon(c, points, colour);
}

// ── PNG encoding ──────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = none) per scanline, as the format requires.
  const raw = Buffer.alloc(c.h * (c.w * 4 + 1));
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    Buffer.from(c.px.buffer, y * c.w * 4, c.w * 4).copy(
      raw,
      y * (c.w * 4 + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── the sprites ───────────────────────────────────────────────────────────
// Geometry mirrors what the SVG versions drew, at SCALE.

const S = SCALE;

function tree() {
  const c = canvas(24 * S, 36 * S);
  const p = (x, y) => [x * S, y * S];
  // Canopy, then a darker right half so the form reads as lit from the left —
  // the same direction the hillshade uses.
  polygon(c, [p(12, 1), p(18, 13), p(14.5, 13), p(20, 24), p(4, 24), p(9.5, 13), p(6, 13)], '#26543A');
  polygon(c, [p(12, 1), p(18, 13), p(14.5, 13), p(20, 24), p(12, 24)], '#1B3E2A');
  rect(c, 10.5 * S, 24 * S, 3 * S, 10 * S, '#3A2A1E');
  return c;
}

function shrub() {
  const c = canvas(20 * S, 16 * S);
  ellipse(c, 7 * S, 10 * S, 6 * S, 5.5 * S, '#2E5B3C');
  ellipse(c, 13 * S, 9 * S, 6.5 * S, 6 * S, '#24492F');
  rect(c, 9 * S, 13 * S, 2 * S, 3 * S, '#3A2A1E');
  return c;
}

function grass() {
  const c = canvas(16 * S, 12 * S);
  // Three blades as thin quads; a stroked path would need a curve rasteriser
  // for something that is four pixels wide on screen.
  for (const [x0, x1] of [
    [3, 5],
    [7, 9],
    [11, 13],
  ]) {
    polygon(
      c,
      [
        [x0 * S, 12 * S],
        [(x0 + 0.9) * S, 12 * S],
        [(x1 + 0.7) * S, 0.5 * S],
        [x1 * S, 0.5 * S],
      ],
      '#3E6B45',
    );
  }
  return c;
}

function rock() {
  const c = canvas(14 * S, 10 * S);
  polygon(
    c,
    [
      [2 * S, 9 * S],
      [4 * S, 3 * S],
      [8 * S, 2 * S],
      [12 * S, 6 * S],
      [11 * S, 9 * S],
    ],
    '#4A5560',
  );
  return c;
}

/**
 * The facing cone for "you are here".
 *
 * Drawn pointing up, because MapLibre's `icon-rotate` measures clockwise from
 * north and a compass heading is already in exactly that frame — so the icon
 * can take the heading unmodified, with no offset to get wrong.
 *
 * A wedge rather than an arrow: a compass fix is accurate to maybe 15 degrees
 * indoors and worse near metal, and a sharp arrow claims a precision the
 * magnetometer does not have. The wedge reads as "roughly this way".
 */
function heading() {
  const c = canvas(32 * S, 32 * S);
  const cx = 16 * S;
  const cy = 22 * S;
  const reach = 20 * S;
  const half = (32 * Math.PI) / 180;

  polygon(
    c,
    [
      [cx, cy],
      [cx - Math.sin(half) * reach, cy - Math.cos(half) * reach],
      [cx, cy - reach * 1.04],
      [cx + Math.sin(half) * reach, cy - Math.cos(half) * reach],
    ],
    '#2E7DF6',
  );
  return c;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, make] of Object.entries({ tree, shrub, grass, rock, heading })) {
  const png = encodePng(make());
  const path = join(OUT_DIR, `${name}.png`);
  writeFileSync(path, png);
  console.log(`${name}.png  ${png.length} bytes`);
}

console.log(`→ ${OUT_DIR}`);
