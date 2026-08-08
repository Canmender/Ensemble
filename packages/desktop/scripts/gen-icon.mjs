// 生成 256x256 品牌渐变图标（PNG），供 electron-builder 使用
// 无需依赖，手写 PNG 编码（zlib + CRC32）
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
// 品牌渐变：左上 蓝 (#0c8ceb) → 右下 绿 (#16a34a)
const c1 = [12, 140, 235];
const c2 = [22, 163, 74];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// scanlines：filter 0 + RGB
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
let offset = 0;
for (let y = 0; y < SIZE; y++) {
  raw[offset++] = 0; // filter none
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * (SIZE - 1));
    raw[offset++] = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    raw[offset++] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    raw[offset++] = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "build", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`icon written: ${out} (${png.length} bytes)`);
