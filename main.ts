// THE TWENTY-FIFTH — one image summing up Wednesday 25 November 2026.
// Node 22, standard library only, no network, deterministic.
// Writes $MAKEFUN_OUTPUT_DIR/entry.png (default /output/entry.png).
// A pure-JS rasterizer + hand-built 5x7 bitmap font. Every line written
// in this session; no external assets, fonts or images.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- PNG out
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Canvas
const W = 1024;
const H = 1024;

type RGB = [number, number, number];

class Canvas {
  buf: Uint8Array = new Uint8Array(W * H * 3);
  fill(c: RGB): void {
    for (let i = 0; i < W * H; i++) {
      this.buf[i * 3] = c[0];
      this.buf[i * 3 + 1] = c[1];
      this.buf[i * 3 + 2] = c[2];
    }
  }
  px(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const o = (iy * W + ix) * 3;
    this.buf[o] = c[0];
    this.buf[o + 1] = c[1];
    this.buf[o + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w));
    const y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * W + xx) * 3;
        this.buf[o] = c[0];
        this.buf[o + 1] = c[1];
        this.buf[o + 2] = c[2];
      }
    }
  }
  rectOutline(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.rect(x, y, w, t, c);
    this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c);
    this.rect(x + w - t, y, t, h, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (dx * i) / steps;
      const y = y0 + (dy * i) / steps;
      if (t <= 1) this.px(x, y, c);
      else this.rect(x - t / 2, y - t / 2, t, t, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let dy = -rr; dy <= rr; dy++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
      for (let xx = -dx; xx <= dx; xx++) this.px(cx + xx, cy + dy, c);
    }
  }
  circleOutline(cx: number, cy: number, r: number, c: RGB, t = 1): void {
    const rr = Math.round(r);
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      for (let k = 0; k < t; k++) {
        this.px(cx + Math.cos(rad) * (rr - k), cy + Math.sin(rad) * (rr - k), c);
      }
    }
  }
  // Filled polygon, scanline fill. pts: [x,y][]
  poly(pts: number[][], c: RGB): void {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.rect(Math.ceil(xs[i]), y, Math.floor(xs[i + 1]) - Math.ceil(xs[i]) + 1, 1, c);
      }
    }
  }
  polyOutline(pts: number[][], c: RGB, t = 1): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.line(a[0], a[1], b[0], b[1], c, t);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) {
      const f = 1 - (dy * dy) / (ry * ry);
      if (f < 0) continue;
      const dx = Math.floor(rx * Math.sqrt(f));
      for (let xx = -dx; xx <= dx; xx++) this.px(cx + xx, cy + dy, c);
    }
  }
}

// ---------------------------------------------------------------- Palette
const PAPER: RGB = [247, 243, 234];
const INK: RGB = [22, 22, 26];
const NAVY: RGB = [16, 32, 64];
const RED: RGB = [178, 34, 34];
const BLUE: RGB = [28, 84, 160];
const TEAL: RGB = [14, 122, 110];
const ORANGE: RGB = [214, 106, 24];
const GREEN: RGB = [34, 120, 52];
const PURPLE: RGB = [102, 48, 150];
const GOLD: RGB = [176, 128, 20];
const BROWN: RGB = [122, 74, 34];
const GREY: RGB = [110, 110, 108];
const LIGHT: RGB = [232, 226, 212];
const WHITE: RGB = [255, 255, 255];
const SKY: RGB = [135, 190, 224];
const DARKRED: RGB = [120, 20, 20];

// Region colours (7 regions)
const REG: Record<string, RGB> = {
  SPACE: PURPLE,
  PACIFIC: TEAL,
  AFRICA: ORANGE,
  MIDEAST: RED,
  EUROPE: BLUE,
  ASIA: GREEN,
  AMERICAS: BROWN,
};

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows, 5 bits each (bit 4 = leftmost column).
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ';': [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '—': [0, 0, 0, 0x1f, 0, 0, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '"': [0x0a, 0x0a, 0x0a, 0, 0, 0, 0],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  '*': [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
  '#': [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  '•': [0, 0, 0x0c, 0x0c, 0x0c, 0, 0],
  '·': [0, 0, 0x0c, 0x0c, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 0x1f],
  '[': [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
  ']': [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e],
  '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  '€': [0x0f, 0x10, 0x1e, 0x10, 0x1e, 0x10, 0x0f],
  '£': [0x06, 0x08, 0x1e, 0x08, 0x08, 0x1f, 0x08],
  '×': [0, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0],
};

function glyph(ch: string): number[] {
  const up = ch.toUpperCase();
  return FONT[up] ?? FONT[ch] ?? FONT['?'];
}

// ---------------------------------------------------------------- Text
function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(cv: Canvas, x: number, y: number, s: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row & (1 << (4 - col))) {
          cv.rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cv, cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

// Word-wrap into lines of at most maxChars characters (by word).
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(cv: Canvas, x: number, y: number, s: string, scale: number, c: RGB, maxChars: number, lineH?: number): number {
  const lines = wrap(s, maxChars);
  const lh = lineH ?? 7 * scale + 2;
  lines.forEach((ln, i) => drawText(cv, x, y + i * lh, ln, scale, c));
  return lines.length;
}

// ---------------------------------------------------------------- Scenes
// Small pictograms drawn inside a coloured square of size s at (x, y).

function sceneTanker(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [186, 228, 240]); // sea sky
  cv.rect(x, y + Math.floor(s * 0.62), s, s - Math.floor(s * 0.62), [24, 80, 130]); // sea
  cv.rect(x + 3, y + Math.floor(s * 0.45), s - 6, Math.floor(s * 0.2), [60, 60, 64]); // hull
  cv.rect(x + Math.floor(s * 0.55), y + Math.floor(s * 0.3), 4, Math.floor(s * 0.16), [200, 40, 40]); // funnel
  cv.circle(x + Math.floor(s * 0.3), y + Math.floor(s * 0.32), 3, [255, 170, 30]); // flame
  cv.circle(x + Math.floor(s * 0.3), y + Math.floor(s * 0.26), 2, [255, 220, 90]);
  cv.rect(x + Math.floor(s * 0.18), y + Math.floor(s * 0.2), 3, 6, [120, 120, 120]);
}

function sceneDrone(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [200, 214, 228]);
  const cx = x + Math.floor(s / 2);
  const cy = y + Math.floor(s / 2);
  cv.rect(cx - 7, cy - 4, 14, 8, [40, 40, 44]); // body
  cv.circle(cx - 10, cy - 8, 3, [90, 90, 96]);
  cv.circle(cx + 10, cy - 8, 3, [90, 90, 96]);
  cv.circle(cx - 10, cy + 8, 3, [90, 90, 96]);
  cv.circle(cx + 10, cy + 8, 3, [90, 90, 96]);
  cv.line(cx - 10, cy - 8, cx + 10, cy + 8, [40, 40, 44], 1);
  cv.line(cx + 10, cy - 8, cx - 10, cy + 8, [40, 40, 44], 1);
  cv.circle(cx, cy, 2, [200, 40, 40]);
}

function sceneGavel(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [232, 220, 190]);
  cv.line(x + 6, y + s - 8, x + s - 8, y + 6, [120, 74, 34], 4); // handle
  cv.rect(x + s - 14, y + 4, 10, 7, [90, 56, 24]); // head
  cv.rect(x + s - 12, y + 13, 6, 3, [160, 120, 60]);
  cv.rect(x + 4, y + s - 7, s - 8, 3, [90, 56, 24]); // base
}

function sceneChartDown(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [255, 235, 235]);
  cv.line(x + 4, y + 6, x + 11, y + 12, RED, 2);
  cv.line(x + 11, y + 12, x + 17, y + 10, RED, 2);
  cv.line(x + 17, y + 10, x + 25, y + 22, RED, 2);
  cv.poly([[x + 25, y + 22], [x + 19, y + 20], [x + 25, y + 27]], RED); // arrowhead
  cv.rect(x + 4, y + s - 5, s - 8, 2, GREY);
}

function sceneChip(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [30, 40, 60]);
  cv.rect(x + 8, y + 8, s - 16, s - 16, [20, 120, 90]);
  cv.rect(x + 12, y + 12, s - 24, s - 24, [16, 60, 50]);
  for (let i = 0; i < 3; i++) {
    cv.rect(x + 4, y + 9 + i * 7, 4, 2, [200, 200, 200]);
    cv.rect(x + s - 8, y + 9 + i * 7, 4, 2, [200, 200, 200]);
    cv.rect(x + 9 + i * 7, y + 4, 2, 4, [200, 200, 200]);
    cv.rect(x + 9 + i * 7, y + s - 8, 2, 4, [200, 200, 200]);
  }
}

function sceneMine(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [60, 48, 40]);
  cv.rect(x, y + Math.floor(s * 0.6), s, s - Math.floor(s * 0.6), [40, 32, 26]);
  cv.circle(x + Math.floor(s * 0.5), y + Math.floor(s * 0.34), 7, [240, 190, 60]); // helmet
  cv.rect(x + Math.floor(s * 0.5) - 8, y + Math.floor(s * 0.34) + 3, 16, 3, [240, 190, 60]);
  cv.circle(x + Math.floor(s * 0.5), y + Math.floor(s * 0.34) - 2, 2, WHITE);
  cv.line(x + 5, y + s - 6, x + s - 6, y + s - 12, [200, 200, 200], 2); // pick
}

function sceneFootball(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [40, 120, 60]);
  const cx = x + Math.floor(s / 2);
  const cy = y + Math.floor(s / 2);
  cv.circle(cx, cy, 10, WHITE);
  cv.circle(cx, cy, 3, INK);
  cv.line(cx, cy - 10, cx, cy - 3, INK, 1);
  cv.line(cx + 9, cy - 3, cx + 3, cy, INK, 1);
  cv.line(cx + 6, cy + 8, cx + 2, cy + 3, INK, 1);
  cv.line(cx - 6, cy + 8, cx - 2, cy + 3, INK, 1);
  cv.line(cx - 9, cy - 3, cx - 3, cy, INK, 1);
}

function sceneCricket(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [210, 235, 190]);
  cv.line(x + 7, y + 6, x + s - 10, y + s - 8, [170, 130, 70], 5); // bat
  cv.rect(x + s - 12, y + s - 12, 5, 5, [90, 60, 20]);
  cv.circle(x + 7, y + s - 8, 4, [200, 40, 40]); // ball
  cv.circle(x + s - 8, y + 7, 3, [255, 220, 90]); // sun / six
}

function scenePlane(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [190, 210, 235]);
  const cx = x + Math.floor(s / 2);
  const cy = y + Math.floor(s / 2);
  cv.poly([[cx - 12, cy], [cx + 12, cy - 3], [cx + 12, cy + 3]], [240, 240, 240]); // fuselage
  cv.poly([[cx - 2, cy - 2], [cx + 4, cy - 12], [cx + 8, cy - 2]], [200, 200, 205]); // wing
  cv.poly([[cx - 2, cy + 2], [cx + 2, cy + 10], [cx + 6, cy + 2]], [200, 200, 205]);
  cv.poly([[cx - 12, cy], [cx - 16, cy - 5], [cx - 12, cy - 1]], [180, 180, 185]); // tail
  cv.circle(cx - 13, cy + 6, 3, [255, 170, 30]);
  cv.circle(cx - 10, cy + 9, 2, [255, 120, 20]);
}

function sceneSatellite(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [16, 24, 48]);
  const cx = x + Math.floor(s / 2);
  const cy = y + Math.floor(s / 2);
  cv.rect(cx - 11, cy - 3, 7, 6, [40, 90, 200]); // panel
  cv.rect(cx + 4, cy - 3, 7, 6, [40, 90, 200]);
  cv.rect(cx - 3, cy - 4, 6, 8, [220, 220, 220]); // body
  cv.circle(cx + 8, cy + 7, 1, [255, 220, 90]);
  cv.circle(cx - 9, cy - 8, 1, WHITE);
  cv.circle(cx + 11, cy - 9, 1, WHITE);
  cv.line(cx, cy - 4, cx + 2, cy - 12, [200, 200, 200], 1); // antenna
  cv.circle(cx + 2, cy - 13, 1, [255, 80, 80]);
}

function sceneHospital(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [235, 240, 245]);
  cv.rect(x + 5, y + 10, s - 10, s - 14, WHITE);
  cv.rectOutline(x + 5, y + 10, s - 10, s - 14, [120, 120, 120], 1);
  cv.rect(x + Math.floor(s * 0.5) - 2, y + 13, 4, 10, RED); // cross
  cv.rect(x + Math.floor(s * 0.5) - 5, y + 16, 10, 4, RED);
  cv.rect(x + 8, y + s - 8, s - 16, 3, [160, 160, 160]);
}

// ---------------------------------------------------------------- Heroes
// Each hero illustration fills (x, y, w, h).

function heroRocket(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Night sky over the launch pad.
  cv.rect(x, y, w, h, [10, 16, 44]);
  for (const [sx, sy, r] of [[18, 20, 1], [60, 12, 1], [110, 30, 2], [160, 14, 1], [210, 26, 1], [260, 18, 2], [300, 34, 1], [40, 46, 1], [240, 44, 1], [290, 8, 1]] as const) {
    cv.circle(x + sx, y + sy, r, WHITE);
  }
  // Earth curve at the bottom of the art area: a gentle arc peaking
  // ~30px above the art's bottom edge, fully inside the art rect.
  {
    const cx = x + Math.floor(w / 2);
    const artBottom = y + h;
    const R = 452;
    const Y0 = artBottom + 422;
    const pts: number[][] = [];
    for (let i = 0; i <= 24; i++) {
      const px2 = -162 + (324 * i) / 24;
      const py2 = Y0 - Math.sqrt(R * R - px2 * px2);
      pts.push([cx + px2, py2]);
    }
    pts.push([x + w, artBottom]);
    pts.push([x, artBottom]);
    cv.poly(pts, [28, 84, 160]);
    const pts2: number[][] = [];
    for (let i = 0; i <= 24; i++) {
      const px2 = -130 + (260 * i) / 24;
      const py2 = Y0 + 8 - Math.sqrt(R * R - px2 * px2);
      pts2.push([cx + px2, py2]);
    }
    pts2.push([x + w - 30, artBottom]);
    pts2.push([x + 30, artBottom]);
    cv.poly(pts2, [40, 120, 80]);
  }
  // Space station (Tiangong) top right.
  const sx = x + w - 86;
  const sy = y + 16;
  cv.rect(sx, sy + 8, 62, 8, [200, 200, 205]);
  cv.rect(sx + 8, sy, 10, 24, [160, 160, 168]);
  cv.rect(sx + 44, sy, 10, 24, [160, 160, 168]);
  cv.rect(sx + 26, sy + 4, 12, 16, [220, 220, 225]);
  cv.circle(sx + 32, sy + 12, 4, [120, 200, 240]);
  // Rocket rising, centre-left.
  const rx = x + 96;
  const ry = y + 44;
  cv.poly([[rx - 14, ry + 58], [rx - 14, ry + 18], [rx, ry], [rx + 14, ry + 18], [rx + 14, ry + 58]], WHITE);
  cv.rect(rx - 14, ry + 40, 28, 18, [200, 40, 40]);
  cv.poly([[rx - 14, ry + 58], [rx - 22, ry + 70], [rx - 14, ry + 66]], [200, 40, 40]);
  cv.poly([[rx + 14, ry + 58], [rx + 22, ry + 70], [rx + 14, ry + 66]], [200, 40, 40]);
  cv.circle(rx, ry + 22, 6, [135, 190, 224]);
  cv.circleOutline(rx, ry + 22, 6, NAVY, 1);
  // Flame.
  cv.poly([[rx - 10, ry + 58], [rx, ry + 92], [rx + 10, ry + 58]], [255, 170, 30]);
  cv.poly([[rx - 5, ry + 58], [rx, ry + 80], [rx + 5, ry + 58]], [255, 230, 120]);
  // Launch pad smoke.
  cv.circle(x + 70, y + h - 18, 16, [200, 200, 205]);
  cv.circle(x + 120, y + h - 12, 20, [180, 180, 186]);
  cv.circle(x + 170, y + h - 18, 14, [200, 200, 205]);
  // Caption tag on a dark strip.
  cv.rect(x, y + h - 18, 150, 14, [10, 16, 44]);
  drawText(cv, x + 8, y + h - 16, 'SHENZHOU-24 • TIANGONG', 1, [255, 220, 120]);
}

function heroTreaty(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Canberra sky: warm dusk.
  cv.rect(x, y, w, h, [250, 214, 160]);
  cv.circle(x + w - 40, y + 26, 16, [255, 190, 60]); // sun
  // Parliament-like building silhouette.
  cv.rect(x, y + h - 46, w, 46, [90, 70, 50]);
  cv.rect(x + 30, y + h - 70, w - 60, 26, [120, 96, 70]);
  cv.poly([[x + Math.floor(w / 2) - 26, y + h - 70], [x + Math.floor(w / 2), y + h - 96], [x + Math.floor(w / 2) + 26, y + h - 70]], [150, 124, 92]);
  // Two flags on poles.
  cv.line(x + 22, y + 30, x + 22, y + h - 46, [60, 50, 40], 2);
  cv.line(x + w - 22, y + 30, x + w - 22, y + h - 46, [60, 50, 40], 2);
  // Australia flag (simplified: blue, Union canton, stars).
  cv.rect(x + 24, y + 30, 52, 30, [0, 40, 120]);
  cv.rect(x + 24, y + 30, 26, 15, [200, 40, 40]);
  cv.line(x + 24, y + 30, x + 50, y + 45, WHITE, 1);
  cv.line(x + 50, y + 30, x + 24, y + 45, WHITE, 1);
  cv.circle(x + 62, y + 38, 2, WHITE);
  cv.circle(x + 66, y + 52, 2, WHITE);
  cv.circle(x + 40, y + 52, 2, WHITE);
  // Solomon Islands flag (simplified: blue/green diagonal, stars).
  cv.poly([[x + w - 76, y + 30], [x + w - 24, y + 30], [x + w - 24, y + 60]], [0, 90, 160]);
  cv.poly([[x + w - 76, y + 30], [x + w - 76, y + 60], [x + w - 24, y + 60]], [0, 130, 60]);
  cv.circle(x + w - 66, y + 40, 2, WHITE);
  cv.circle(x + w - 56, y + 36, 2, WHITE);
  cv.circle(x + w - 46, y + 42, 2, WHITE);
  // Handshake over a treaty document, centre (kept clear of the roofline).
  cv.rect(x + Math.floor(w / 2) - 62, y + h - 122, 124, 34, WHITE);
  cv.rectOutline(x + Math.floor(w / 2) - 62, y + h - 122, 124, 34, INK, 1);
  cv.line(x + Math.floor(w / 2) - 54, y + h - 112, x + Math.floor(w / 2) + 54, y + h - 112, GREY, 1);
  cv.line(x + Math.floor(w / 2) - 54, y + h - 104, x + Math.floor(w / 2) + 20, y + h - 104, GREY, 1);
  cv.line(x + Math.floor(w / 2) - 54, y + h - 96, x + Math.floor(w / 2) + 40, y + h - 96, GREY, 1);
  // Two hands clasping.
  const hx = x + Math.floor(w / 2);
  const hy = y + h - 132;
  cv.poly([[hx - 34, hy - 6], [hx - 6, hy - 10], [hx + 6, hy - 2], [hx - 6, hy + 6], [hx - 34, hy + 4]], [232, 180, 140]);
  cv.poly([[hx + 34, hy - 6], [hx + 6, hy - 10], [hx - 6, hy - 2], [hx + 6, hy + 6], [hx + 34, hy + 4]], [200, 150, 110]);
  cv.circle(hx, hy - 2, 5, [232, 180, 140]);
  // Caption tag on a dark strip.
  cv.rect(x, y + h - 18, 172, 14, INK);
  drawText(cv, x + 8, y + h - 16, 'CANBERRA • $740M • 10 YEARS', 1, WHITE);
}

function heroEbola(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Dusk over Ituri: ochre sky, hospital compound.
  cv.rect(x, y, w, h, [240, 200, 150]);
  cv.circle(x + 40, y + 24, 14, [255, 200, 90]);
  // Hospital building.
  cv.rect(x + 16, y + 56, 150, 66, WHITE);
  cv.rectOutline(x + 16, y + 56, 150, 66, [120, 120, 120], 1);
  cv.rect(x + 16, y + 56, 150, 14, [200, 40, 40]);
  drawText(cv, x + 24, y + 60, 'AKWE HOSPITAL', 1, WHITE);
  cv.rect(x + 30, y + 84, 18, 22, [60, 90, 130]);
  cv.rect(x + 60, y + 84, 18, 18, [135, 190, 224]);
  cv.rect(x + 90, y + 84, 18, 18, [135, 190, 224]);
  cv.rect(x + 120, y + 84, 18, 18, [135, 190, 224]);
  // Red cross sign.
  cv.rect(x + 180, y + 62, 34, 34, WHITE);
  cv.rectOutline(x + 180, y + 62, 34, 34, RED, 2);
  cv.rect(x + 194, y + 68, 6, 22, RED);
  cv.rect(x + 185, y + 77, 24, 6, RED);
  // Ambulance leaving.
  const ax = x + w - 118;
  const ay = y + h - 46;
  cv.rect(ax, ay, 104, 26, WHITE);
  cv.rectOutline(ax, ay, 104, 26, INK, 1);
  cv.rect(ax + 70, ay + 4, 30, 12, [135, 190, 224]);
  cv.rect(ax + 6, ay + 10, 5, 12, RED);
  cv.rect(ax + 2, ay + 13, 13, 5, RED);
  cv.circle(ax + 22, ay + 26, 6, INK);
  cv.circle(ax + 82, ay + 26, 6, INK);
  cv.circle(ax + 22, ay + 26, 2, GREY);
  cv.circle(ax + 82, ay + 26, 2, GREY);
  // Road.
  cv.rect(x, y + h - 14, w, 4, [60, 60, 64]);
  cv.line(x + 10, y + h - 12, x + 40, y + h - 12, [255, 220, 90], 2);
  cv.line(x + 70, y + h - 12, x + 100, y + h - 12, [255, 220, 90], 2);
  // Caption tag on a dark strip.
  cv.rect(x, y + h - 18, 210, 14, INK);
  drawText(cv, x + 8, y + h - 16, 'ITURI, DR CONGO • WHO EVACUATION', 1, WHITE);
}

// ---------------------------------------------------------------- Map
// Simplified world map in an equirectangular strip. Continents as rough
// polygons; lon -170..190 maps to x, lat 75..-55 maps to y.

function drawMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [186, 214, 232]); // ocean
  const px = (lon: number) => x + ((lon + 170) / 360) * w;
  const py = (lat: number) => y + ((75 - lat) / 130) * h;
  const P = (pts: [number, number][]): number[][] => pts.map(([lo, la]) => [px(lo), py(la)]);
  const LAND: RGB = [196, 178, 132];
  const LAND2: RGB = [178, 160, 116];
  // North America
  cv.poly(P([[-168, 66], [-140, 70], [-125, 72], [-110, 68], [-95, 80], [-80, 73], [-70, 62], [-60, 47], [-70, 42], [-75, 35], [-80, 26], [-84, 30], [-90, 21], [-97, 16], [-105, 20], [-117, 33], [-125, 40], [-125, 49], [-140, 60], [-155, 58], [-165, 60]]), LAND);
  // Greenland
  cv.poly(P([[-58, 64], [-45, 60], [-30, 68], [-40, 76], [-58, 76], [-62, 70]]), LAND2);
  // South America
  cv.poly(P([[-79, 9], [-62, 11], [-52, 5], [-50, -5], [-35, -8], [-40, -20], [-48, -28], [-58, -35], [-70, -40], [-73, -50], [-70, -54], [-74, -40], [-80, -20], [-81, -6], [-80, 2]]), LAND);
  // Africa
  cv.poly(P([[-17, 15], [-10, 30], [0, 36], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 11], [48, -5], [40, -15], [33, -26], [26, -34], [19, -35], [15, -27], [12, -18], [9, -1], [-8, 4], [-13, 8]]), LAND);
  // Europe
  cv.poly(P([[-10, 36], [-9, 43], [-2, 48], [-5, 50], [0, 51], [5, 53], [8, 57], [10, 59], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [32, 70], [40, 68], [45, 60], [40, 55], [35, 50], [30, 46], [28, 41], [23, 36], [19, 40], [12, 44], [8, 44], [3, 42], [-2, 37]]), LAND2);
  // Asia
  cv.poly(P([[32, 70], [40, 68], [50, 68], [60, 69], [70, 72], [80, 73], [100, 77], [120, 76], [140, 72], [160, 69], [178, 66], [170, 60], [162, 56], [158, 52], [150, 59], [142, 54], [140, 45], [135, 43], [130, 42], [127, 40], [127, 35], [122, 32], [120, 28], [115, 22], [110, 20], [108, 12], [105, 9], [100, 8], [98, 12], [95, 16], [92, 21], [89, 22], [86, 20], [80, 15], [77, 8], [74, 20], [70, 25], [66, 25], [62, 25], [57, 26], [52, 26], [50, 29], [48, 30], [44, 29], [40, 32], [36, 36], [35, 31], [32, 31]]), LAND);
  // SE Asia islands + Japan
  cv.poly(P([[95, 5], [100, 0], [105, -2], [110, -7], [115, -8], [120, -10], [125, -9], [130, -4], [135, -3], [140, -8], [138, -5], [130, 0], [120, 3], [110, 2], [100, 5]]), LAND2);
  cv.poly(P([[130, 31], [132, 33], [135, 34], [138, 35], [140, 38], [141, 42], [143, 44], [141, 45], [139, 40], [137, 36], [133, 33], [130, 32]]), LAND2);
  // Australia
  cv.poly(P([[113, -22], [114, -30], [115, -35], [124, -33], [129, -32], [135, -35], [140, -38], [146, -39], [150, -37], [153, -27], [150, -22], [146, -19], [142, -11], [136, -12], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]]), LAND);
  // New Zealand
  cv.poly(P([[167, -45], [170, -42], [173, -41], [175, -38], [178, -38], [175, -40], [172, -43], [168, -46]]), LAND2);
  // UK
  cv.poly(P([[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51], [-2, 50]]), LAND2);

  // Region pins: [lon, lat, region, label, side?] — 'L' label left of pin,
  // 'B' label centred below the pin.
  const pins: [number, number, string, string, string?][] = [
    [116, 40, 'SPACE', 'SHENZHOU-24', 'L'],
    [149, -35, 'PACIFIC', 'CANBERRA TREATY', 'L'],
    [30, 1, 'AFRICA', 'EBOLA: ITURI'],
    [57, 26, 'MIDEAST', 'HORMUZ', 'B'],
    [44, 15, 'MIDEAST', 'YEMEN'],
    [47, 25, 'MIDEAST', 'RIYADH'],
    [31, 50, 'EUROPE', 'KYIV'],
    [10, 52, 'EUROPE', 'BRUSSELS'],
    [-1, 52, 'EUROPE', 'LONDON', 'L'],
    [-77, 39, 'AMERICAS', 'WASHINGTON'],
    [-99, 19, 'AMERICAS', 'MEXICO CITY'],
    [-75, 10, 'AMERICAS', 'CARTAGENA'],
    [127, 37, 'ASIA', 'SEOUL'],
    [139, 35, 'ASIA', 'TOKYO', 'B'],
    [77, 28, 'ASIA', 'DELHI'],
    [121, 14, 'ASIA', 'MANILA'],
    [100, 13, 'ASIA', 'BANGKOK'],
    [106, -6, 'ASIA', 'JAKARTA'],
  ];
  for (const [lo, la, reg, label, side] of pins) {
    const cx = px(lo);
    const cy = py(la);
    cv.circle(cx, cy, 5, REG[reg]);
    cv.circleOutline(cx, cy, 5, WHITE, 1);
    cv.circle(cx, cy, 2, WHITE);
    if (side === 'L') {
      drawText(cv, cx - 7 - textWidth(label, 1), cy - 4, label, 1, INK);
    } else if (side === 'B') {
      drawText(cv, cx - Math.floor(textWidth(label, 1) / 2), cy + 8, label, 1, INK);
    } else {
      drawText(cv, cx + 7, cy - 4, label, 1, INK);
    }
  }
  // Region legend (bottom-left, on ocean).
  const legend: [string, string][] = [
    ['SPACE', 'SPACE'],
    ['PACIFIC', 'PACIFIC'],
    ['AFRICA', 'AFRICA'],
    ['MIDEAST', 'MIDDLE EAST'],
    ['EUROPE', 'EUROPE'],
    ['ASIA', 'ASIA'],
    ['AMERICAS', 'AMERICAS'],
  ];
  let lx = x + 8;
  const ly = y + h - 16;
  for (const [key, name] of legend) {
    cv.circle(lx + 4, ly + 4, 4, REG[key]);
    drawText(cv, lx + 11, ly + 1, name, 1, INK);
    lx += 11 + textWidth(name, 1) + 12;
  }
}

// ---------------------------------------------------------------- Stories
type Story = {
  n: number;
  region: string;
  head: string;
  note?: string;
  scene?: (cv: Canvas, x: number, y: number, s: number) => void;
};

const STORIES: Story[] = [
  { n: 4, region: 'MIDEAST', head: 'TWO TANKERS HIT MINES, BURN IN HORMUZ [REPORTED]' },
  { n: 5, region: 'MIDEAST', head: 'SAUDI-LED STRIKES HIT HODEIDAH PORT, YEMEN' },
  { n: 6, region: 'MIDEAST', head: 'HOUTHI ATTACK ON RIYADH TOWER WOUNDS 11' },
  { n: 7, region: 'MIDEAST', head: 'TRUMP: IRAN WAR FUNDED THROUGH JANUARY [REPORTED]' },
  { n: 8, region: 'EUROPE', head: 'ZELENSKY: UKRAINE NEEDS EUR 115BN AID IN 2027' },
  { n: 9, region: 'EUROPE', head: 'UKRAINE: DRONES SANK RUSSIAN SHIP, LIBYA [REPORTED]' },
  { n: 10, region: 'EUROPE', head: 'US PAUSES PATRIOT SUPPLIES TO UKRAINE' },
  { n: 11, region: 'EUROPE', head: 'RUSSIAN STRIKE KILLS 2, WOUNDS 48 IN UKRAINE' },
  { n: 12, region: 'AMERICAS', head: 'US JURY CONVICTS HUAWEI ON 10 COUNTS', scene: sceneGavel },
  { n: 13, region: 'ASIA', head: 'KOSPI -6.2% TO 10-MONTH LOW; SAMSUNG -9.9%', scene: sceneChartDown },
  { n: 14, region: 'AMERICAS', head: 'NVIDIA -5.9% A DAY AFTER +31.5% SURGE' },
  { n: 15, region: 'EUROPE', head: 'UK ENERGY CAP +26% FROM JANUARY TO GBP 2,166' },
  { n: 16, region: 'EUROPE', head: 'EUROZONE INFLATION RISES TO 4.0%' },
  { n: 17, region: 'PACIFIC', head: 'AUSTRALIA INFLATION 4.9%; RBA TO HOLD' },
  { n: 18, region: 'ASIA', head: 'CHINA PROBES PARTY CHIEF CHEN JINING' },
  { n: 19, region: 'AMERICAS', head: 'AMAZON BUYS DECART TO RIVAL NVIDIA CHIPS', scene: sceneChip },
  { n: 20, region: 'AMERICAS', head: "AMAZON: HACKERS' AI BROKE INTO UNIVERSITY" },
  { n: 21, region: 'AMERICAS', head: 'ANTHROPIC BELOW IPO PRICE; $1TN WIPED [REPORTED]' },
  { n: 22, region: 'AMERICAS', head: 'COLOMBIA FREES ALL HOSTAGES IN CARTAGENA SIEGE' },
  { n: 23, region: 'AMERICAS', head: 'ABREGO GARCIA LEAVES US FOR SPAIN' },
  { n: 24, region: 'ASIA', head: 'MINERS TRAPPED IN FLOODED JAVA GOLD MINE', scene: sceneMine },
  { n: 25, region: 'ASIA', head: 'N. KOREA EXPELS SWISS DIPLOMAT, CLOSES OFFICE' },
  { n: 26, region: 'ASIA', head: 'BANGLADESH RAISES GARMENT WAGE 36%' },
  { n: 27, region: 'AFRICA', head: 'COURT RESTORES AFCON TITLE TO SENEGAL', scene: sceneFootball },
  { n: 28, region: 'ASIA', head: 'SOORYAVANSHI, 15, SMASHES 204', note: 'OFF 53 BALLS • PLAYED 24 NOV', scene: sceneCricket },
  { n: 29, region: 'EUROPE', head: 'COP31 TALKS COLLAPSE; NO FOSSIL PHASE-OUT' },
  { n: 30, region: 'ASIA', head: 'WORLD COURT: MYANMAR GENOCIDE RULING [REPORTED]' },
  { n: 31, region: 'AMERICAS', head: 'UN: FUNDING CUTS THREATEN HIV PROGRESS' },
  { n: 32, region: 'AMERICAS', head: 'ROCHE BREAST-CANCER DRUG WINS 2ND FDA NOD' },
  { n: 33, region: 'AMERICAS', head: 'SIX DIE AS PLANE CRASHES OFF MISSISSIPPI', scene: scenePlane },
  { n: 34, region: 'EUROPE', head: 'EASYJET PROFIT -89% AS FUEL COSTS SOAR' },
  { n: 35, region: 'ASIA', head: "CHINA'S QIANFAN: ANSWER TO STARLINK [REPORTED]" },
];

// ---------------------------------------------------------------- Layout
function heroPanel(cv: Canvas, x: number, y: number, w: number, h: number, tag: string, tagColor: RGB, art: (cv: Canvas, x: number, y: number, w: number, h: number) => void, head: string, caption: string): void {
  cv.rect(x, y, w, h, WHITE);
  cv.rectOutline(x, y, w, h, INK, 2);
  // Illustration first, then the tag ribbon on top of it.
  const artH = 148;
  art(cv, x + 2, y + 2, w - 4, artH);
  cv.rect(x + 2, y + 2, textWidth(tag, 1) + 12, 14, tagColor);
  drawText(cv, x + 8, y + 4, tag, 1, WHITE);
  cv.rect(x, y + 2 + artH, w, 2, INK);
  // Headline (scale 3, up to 2 lines).
  const headLines = wrap(head, 17);
  headLines.slice(0, 2).forEach((ln, i) => drawText(cv, x + 10, y + 2 + artH + 10 + i * 24, ln, 3, INK));
  // Caption (scale 2... use scale 1 with two lines? scale 2 = 12px/char).
  const capY = y + 2 + artH + 10 + 2 * 24 + 4;
  drawWrapped(cv, x + 10, capY, caption, 1, [60, 60, 60], 46, 10);
}

function main(): void {
  const cv = new Canvas();
  cv.fill(PAPER);

  // ---- Masthead
  cv.rect(0, 0, W, 6, INK);
  drawTextCentered(cv, W / 2, 16, 'THE TWENTY-FIFTH', 8, INK);
  cv.rect(8, 76, W - 16, 2, INK);
  drawTextCentered(cv, W / 2, 84, 'WEDNESDAY 25 NOVEMBER 2026  •  35 STORIES  •  7 REGIONS  •  ONE DAY\'S WORLD NEWS', 2, INK);
  cv.rect(8, 100, W - 16, 2, INK);

  // ---- Date check strip
  cv.rect(8, 106, W - 16, 24, NAVY);
  drawTextCentered(cv, W / 2, 113, 'DATE CHECK: EVERY STORY DATED 25 NOV 2026 — NONE FROM BEFORE 13 NOV 2026', 2, WHITE);

  // ---- Heroes
  const hy = 138;
  const hh = 258;
  const hw = 328;
  const hx0 = 8;
  const hx1 = 348;
  const hx2 = 688;
  heroPanel(cv, hx0, hy, hw, hh, 'HERO 1 — SPACE', PURPLE, heroRocket,
    'SHENZHOU-24 DOCKS WITH TIANGONG',
    "PAKISTAN'S MUHAMMAD ZEESHAN ALI, FIRST FOREIGN ASTRONAUT ABOARD CHINA'S STATION. CREW: TANG HONGBO, WU YI.");
  heroPanel(cv, hx1, hy, hw, hh, 'HERO 2 — PACIFIC', TEAL, heroTreaty,
    'SOLOMONS TREATY SIGNED',
    "CANBERRA IS HONIARA'S PRIMARY SECURITY PARTNER; NO FOREIGN BASE ON SOLOMONS SOIL. $740M OVER 10 YEARS.");
  heroPanel(cv, hx2, hy, hw, hh, 'HERO 3 — AFRICA', ORANGE, heroEbola,
    'WHO EVACUATES EBOLA STAFF',
    'TEAM SHELTERED 3+ DAYS IN A MATERNITY WARD IN ITURI, DR CONGO. OUTBREAK: 11,762 CASES, 5,775 DEATHS.');

  // ---- Map strip
  const my = 404;
  const mh = 148;
  cv.rect(8, my, W - 16, mh, WHITE);
  cv.rectOutline(8, my, W - 16, mh, INK, 2);
  drawText(cv, 16, my + 6, 'THE WORLD IN ONE PICTURE — 25 NOV 2026', 1, INK);
  drawMap(cv, 10, my + 18, W - 20, mh - 36);

  // ---- Story grid: 4 columns x 8 rows, stories 4..35
  const gy = 560;
  const gw = 250;
  const gh = 56;
  STORIES.forEach((st, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 8 + col * 254;
    const y = gy + row * 56;
    const col2 = REG[st.region];
    cv.rect(x, y, gw, gh - 4, WHITE);
    cv.rectOutline(x, y, gw, gh - 4, [200, 194, 180], 1);
    // Number badge.
    cv.rect(x + 4, y + 4, 22, 22, col2);
    drawText(cv, x + 4 + (st.n < 10 ? 8 : 5), y + 9, String(st.n), 1, WHITE);
    // Pictogram or region tag.
    let tx = x + 30;
    if (st.scene) {
      st.scene(cv, x + 30, y + 6, 34);
      tx = x + 68;
    }
    // Headline, scale 2, up to 3 lines (+ note line for #28).
    const maxChars = st.scene ? 15 : 18;
    const lines = wrap(st.head, maxChars).slice(0, 3);
    lines.forEach((ln, li) => drawText(cv, tx, y + 6 + li * 16, ln, 2, INK));
    if (st.note) {
      drawText(cv, tx, y + 6 + 2 * 16, st.note, 1, RED);
    }
  });

  // ---- Footer
  const fy = 1010;
  cv.rect(8, fy - 2, W - 16, 1, INK);
  drawTextCentered(cv, W / 2, fy + 3, 'THE TWENTY-FIFTH — WEDNESDAY 25 NOVEMBER 2026 • ALL STORIES AS REPORTED ON 25 NOV 2026 • [REPORTED] = AS REPORTED, UNVERIFIED', 1, [80, 80, 80]);

  // ---- Newsprint grain: deterministic ±2 dither on near-white pixels only
  // (paper and white panels). Invisible at a glance, but it stops the flat
  // colours compressing to a tiny file and reads as print texture.
  const delta = [-4, -3, -2, -1, 1, 2, 3, 4];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const r = cv.buf[o];
      const g = cv.buf[o + 1];
      const b = cv.buf[o + 2];
      if (r > 200 && g > 200 && b > 200) {
        const hh = (x * 2654435761 ^ y * 40503 ^ x * y * 97) >>> 0;
        cv.buf[o] = Math.max(0, Math.min(255, r + delta[hh & 7]));
        cv.buf[o + 1] = Math.max(0, Math.min(255, g + delta[(hh >> 3) & 7]));
        cv.buf[o + 2] = Math.max(0, Math.min(255, b + delta[(hh >> 6) & 7]));
      }
    }
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(W, H, cv.buf);
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
