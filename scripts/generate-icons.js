// One-off script: renders the app's PWA/home-screen icons as plain PNGs,
// built entirely from scratch (no image libraries — this project has none
// installed, and pulling one in just for a handful of static icons isn't
// worth the dependency). A simple hand-rolled PNG encoder plus a barbell
// glyph drawn from filled circles/rectangles is more than enough for an
// icon that only needs to read clearly at home-screen size.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const GRAPHITE = [0x1c, 0x1b, 0x1a];
const RUST = [0xc4, 0x62, 0x2d];
const CHALK = [0xed, 0xe8, 0xe0];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  // pixels: Uint8Array of RGBA, length width*height*4
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  const barHalfLen = size * 0.34; // half-length of the bar
  const barHalfThick = size * 0.045;
  const plateRadius = size * 0.16;
  const plateOffset = size * 0.34; // distance from center to each plate

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = GRAPHITE;

      const dx = x - cx;
      const dy = y - cy;

      const onBar = Math.abs(dx) <= barHalfLen && Math.abs(dy) <= barHalfThick;
      const leftPlate = Math.hypot(dx + plateOffset, dy) <= plateRadius;
      const rightPlate = Math.hypot(dx - plateOffset, dy) <= plateRadius;

      if (leftPlate || rightPlate) {
        color = CHALK;
      } else if (onBar) {
        color = RUST;
      }

      const i = (y * size + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }

  return encodePng(size, size, pixels);
}

const outDir = path.join(__dirname, "..", "app");
fs.writeFileSync(path.join(outDir, "icon.png"), drawIcon(512));
fs.writeFileSync(path.join(outDir, "apple-icon.png"), drawIcon(180));

const publicDir = path.join(__dirname, "..", "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "icon-192.png"), drawIcon(192));
fs.writeFileSync(path.join(publicDir, "icon-512.png"), drawIcon(512));
// Not generating a maskable variant: the mark's plates touch the icon's own
// edges, which Android's adaptive-icon safe zone would clip. Ship as
// purpose "any" only rather than a maskable icon that looks broken.

console.log("Icons written to app/ and public/");
