// Small ZIP writer (stored entries, UTF-8 names); no service or upload required.
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files) {
  const encoder = new TextEncoder(), parts = [], central = [];
  let offset = 0, directorySize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), body = encoder.encode(file.content), crc = crc32(body);
    const local = new Uint8Array(30 + name.length), v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
    v.setUint16(12, 33, true); v.setUint32(14, crc, true); v.setUint32(18, body.length, true); v.setUint32(22, body.length, true); v.setUint16(26, name.length, true); local.set(name, 30);
    const header = new Uint8Array(46 + name.length), c = new DataView(header.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); header.set(name, 46);
    parts.push(local, body); central.push(header); offset += local.length + body.length; directorySize += header.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
