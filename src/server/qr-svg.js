"use strict";
// A QR code as SVG, for the address a tablet scans (Settings → Other devices). Byte mode, error correction level M,
// versions 1 to 10 (up to 213 bytes: an address with its one-time key needs about 60). No dependency.

// Level M, per version: [error-correction codewords per block, [blocks, data codewords per block], …].
const BLOCKS = [null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const dataCapacity = version => BLOCKS[version].slice(1).reduce((n, [count, size]) => n + count * size, 0);

// Arithmetic in GF(256) with the QR polynomial 0x11d.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
function reedSolomon(data, degree) {
  const gen = generator(degree), out = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ out.shift();
    out.push(0);
    for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

function codewords(bytes, version) {
  const bits = [], put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  put(0b0100, 4); put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const capacity = dataCapacity(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
  for (let pad = 0; data.length < dataCapacity(version); pad++) data.push(pad % 2 ? 0x11 : 0xec);
  // Split into blocks, add error correction to each, then interleave.
  const [ec, ...groups] = BLOCKS[version], blocks = [];
  let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { const block = data.slice(at, at + size); at += size; blocks.push({ data:block, ec:reedSolomon(block, ec) }); }
  const out = [], longest = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

function matrix(bytes) {
  const version = BLOCKS.findIndex((b, v) => v && dataCapacity(v) >= bytes.length + 2 + (v <= 9 ? 0 : 1));
  if (version < 1) throw new Error("That address is too long for a QR code.");
  const size = version * 4 + 17, grid = Array.from({ length:size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length:size }, () => new Array(size).fill(false));
  const set = (r, c, dark, keep = true) => { if (r >= 0 && c >= 0 && r < size && c < size) { grid[r][c] = dark; if (keep) reserved[r][c] = true; } };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) set(r + i, c + j, i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4))); };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const centres = ALIGN[version];
  for (const r of centres) for (const c of centres) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
  }
  // Format and version areas are reserved now and written per mask below.
  for (let i = 0; i < 9; i++) { reserved[8][i] = reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = reserved[size - 1 - i][8] = true; }
  set(size - 8, 8, true);
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[i][size - 11 + j] = reserved[size - 11 + j][i] = true; }
  // Data, in the zigzag order.
  const bits = codewords(bytes, version).flatMap(byte => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (byte >> i) & 1));
  let index = 0;
  for (let right = size - 1, upward = true; right > 0; right -= 2, upward = !upward) {
    if (right === 6) right--;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [right, right - 1]) if (!reserved[r][c]) grid[r][c] = Boolean(bits[index++]);
    }
  }
  return { version, size, grid, reserved };
}

const MASKS = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
function withMask({ version, size, grid, reserved }, mask) {
  const out = grid.map((row, r) => row.map((dark, c) => (reserved[r][c] ? dark : dark !== MASKS[mask](r, c))));
  // Format: level M (00) and the mask, BCH(15,5), XOR 0x5412. Two copies.
  let rem = mask;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((mask << 10) | rem) ^ 0x5412, bit = i => Boolean((format >>> i) & 1);
  for (let i = 0; i <= 5; i++) out[i][8] = bit(i);
  out[7][8] = bit(6); out[8][8] = bit(7); out[8][7] = bit(8);
  for (let i = 9; i < 15; i++) out[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) out[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) out[size - 15 + i][8] = bit(i);
  out[size - 8][8] = true;
  if (version >= 7) {
    let v = version;
    for (let i = 0; i < 12; i++) v = (v << 1) ^ ((v >>> 11) * 0x1f25);
    const info = (version << 12) | v;
    for (let i = 0; i < 18; i++) { const on = Boolean((info >>> i) & 1), a = Math.floor(i / 3), b = size - 11 + (i % 3); out[a][b] = on; out[b][a] = on; }
  }
  return out;
}
function penalty(g) {
  const n = g.length;
  let score = 0;
  for (const line of [...g, ...g[0].map((_, c) => g.map(row => row[c]))]) {
    for (let i = 0, run = 1; i < n; i++, run++) {
      if (i === n - 1 || line[i] !== line[i + 1]) { if (run >= 5) score += run - 2; run = 0; }
    }
    const text = line.map(d => (d ? 1 : 0)).join("");
    score += 40 * ((text.match(/(?=10111010000|00001011101)/g) || []).length);
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) score += 3;
  const dark = g.flat().filter(Boolean).length;
  return score + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
}

// `mask` forces one of the eight masks (tests); otherwise the one the standard's penalty rules like best.
function qrModules(text, { mask:only } = {}) {
  const base = matrix(Buffer.from(String(text), "utf8"));
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (only !== undefined && mask !== only) continue; const g = withMask(base, mask), score = penalty(g); if (!best || score < best.score) best = { g, score, mask }; }
  return { size:base.size, version:base.version, mask:best.mask, modules:best.g };
}

function qrSvg(text, { margin = 4, dark = "#0f172a", light = "#ffffff", mask } = {}) {
  const { size, modules } = qrModules(text, { mask }), full = size + margin * 2;
  let path = "";
  modules.forEach((row, r) => row.forEach((on, c) => { if (on) path += `M${c + margin} ${r + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${full}" height="${full}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

module.exports = { qrSvg, qrModules };
