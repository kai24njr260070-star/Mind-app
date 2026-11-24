import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// 依存パッケージなしで 1024x1024 のアプリアイコンPNGを作る。
// 深い紺の角丸四角に、淡い光の三日月と星を置く。
const S = 1024;
const data = Buffer.alloc(S * S * 4);

const bg = [7, 11, 24];
const moon = [214, 236, 255];
const glow = [127, 212, 255];

const CX = 540;
const CY = 500;
const R = 300;
const SUBX = CX + 130;
const SUBY = CY - 105;
const SUBR = 275;

const stars = [
  [250, 250, 5, 0.9],
  [300, 700, 4, 0.7],
  [780, 300, 4, 0.8],
  [700, 760, 6, 0.75],
  [180, 520, 3, 0.55],
  [860, 590, 3, 0.6],
  [440, 180, 3, 0.5],
];

function cornerAlpha(x, y) {
  const r = 190;
  const cx = x < r ? r : x > S - r ? S - r : x;
  const cy = y < r ? r : y > S - r ? S - r : y;
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, (r - d) / 2));
}

for (let y = 0; y < S; y += 1) {
  for (let x = 0; x < S; x += 1) {
    const i = (y * S + x) * 4;
    const dx = (x - S / 2) / (S / 2);
    const dy = (y - S / 2) / (S / 2);
    const vignette = 1 - 0.45 * Math.min(1, Math.hypot(dx, dy));
    let r = bg[0] * vignette + 6;
    let g = bg[1] * vignette + 10;
    let b = bg[2] * vignette + 26;

    // 三日月の外側のにじみ
    const dMoon = Math.hypot(x - CX, y - CY);
    if (dMoon < R + 70) {
      const t = Math.max(0, 1 - (dMoon - R) / 70) * 0.22;
      r += glow[0] * t;
      g += glow[1] * t;
      b += glow[2] * t;
    }

    // 三日月(大きい円から少しずらした円を引く)
    if (dMoon < R) {
      const dSub = Math.hypot(x - SUBX, y - SUBY);
      if (dSub > SUBR) {
        const edge = Math.min(1, (R - dMoon) / 6, (dSub - SUBR) / 6);
        const a = Math.max(0, Math.min(1, edge));
        r = r * (1 - a) + moon[0] * a;
        g = g * (1 - a) + moon[1] * a;
        b = b * (1 - a) + moon[2] * a;
      }
    }

    for (const [sx, sy, sr, sa] of stars) {
      const d = Math.hypot(x - sx, y - sy);
      if (d < sr * 4) {
        const t = Math.max(0, 1 - d / (sr * 4)) ** 2 * sa;
        r += (moon[0] * 0.9 - r) * t;
        g += (moon[1] * 0.95 - g) * t;
        b += (moon[2] - b) * t;
      }
    }

    data[i] = Math.round(Math.min(255, r));
    data[i + 1] = Math.round(Math.min(255, g));
    data[i + 2] = Math.round(Math.min(255, b));
    data[i + 3] = Math.round(255 * cornerAlpha(x, y));
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])));
  return Buffer.concat([len, typeBuf, body, crc]);
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y += 1) {
  raw[y * (S * 4 + 1)] = 0;
  data.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("assets", { recursive: true });
writeFileSync("assets/app-icon.png", png);
console.log(`make-icon: assets/app-icon.png (${png.length} bytes)`);
