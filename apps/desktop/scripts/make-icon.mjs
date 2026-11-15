// Generates a placeholder icon (build/icon.ico, PNG-compressed 256x256 + 48 + 32 + 16). Replace with real art later.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Rounded blue square with a white "T". */
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x, r), size - 1 - r);
      const cy = Math.min(Math.max(y, r), size - 1 - r);
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const u = x / size, v = y / size;
      const bar = v > 0.2 && v < 0.36 && u > 0.2 && u < 0.8;
      const stem = u > 0.43 && u < 0.57 && v > 0.2 && v < 0.8;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [R, G, B] = bar || stem ? [255, 255, 255] : [37, 99, 235];
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [256, 48, 32, 16];
const images = sizes.map(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;
  e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.ico", Buffer.concat([header, ...dir, ...images]));
writeFileSync("build/icon.png", images[0]);
console.log("wrote build/icon.ico, build/icon.png");
