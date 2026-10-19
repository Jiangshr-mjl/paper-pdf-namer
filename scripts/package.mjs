import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Small deterministic ZIP writer: no shell execution policy or external archive dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walk(path, name + '/'));
    else if (entry.isFile()) files.push({ name, bytes: await readFile(path) });
  }
  return files;
}
const local = [], central = []; let offset = 0;
const files = await walk(resolve('dist'));
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8'), compressed = deflateRawSync(file.bytes), crc = crc32(file.bytes);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(((2026 - 1980) << 9) | 33, 12);
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(file.bytes.length, 22); head.writeUInt16LE(name.length, 26);
  local.push(head, name, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(((2026 - 1980) << 9) | 33, 14); entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(file.bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, name); offset += head.length + name.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
await mkdir('release', { recursive: true });
const { version } = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const destination = resolve('release', `paper-pdf-namer-${version}.zip`);
await writeFile(destination, Buffer.concat([...local, directory, end]));
console.log(destination);
