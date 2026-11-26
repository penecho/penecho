"use strict";
// Pictures kept in a docs folder are made smaller where nobody can tell: a screenshot or a Canvas picture is clipped to about
// 4 megapixels (2560 × 1600), which is more than any agent reads (Claude scales a picture to 1568 px on its long side, OpenAI to 2048),
// and a big PNG is kept as a PNG of 256 colours, which keeps text and lines sharp. The name and the kind of file never change,
// so every link, the Canvas picture beside its .penecho.json and every agent that reads it still work.
// Left as they are: GIF and animated PNG (movement), SVG (drawn, not pixels), WebP and other kinds, small files, and a JPEG that
// needs no clipping (saving a JPEG again only loses quality).
const fs = require("node:fs");

const MAX_PIXELS = 2560 * 1600;
// A long page keeps at least this much on its short side, so its words stay readable; and no side is over 8000, the most Claude takes.
const MIN_SHORT = 1440, MAX_SIDE = 8000;
// A PNG under this is left alone unless it is too big to show.
const SQUEEZE_BYTES = 300 * 1024;
// A new copy is kept only when it is at least this much smaller.
const WORTH = 0.9;
const WAIT_MS = 3000;

let sharp;
function encoder() {
  if (sharp === undefined) { try { sharp = require("sharp"); } catch { sharp = null; } }
  return sharp;
}
const kindOf = bytes => bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 ? "png" : bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "jpeg" : "";

// How much smaller a picture of this size is drawn: 1 when it already fits.
function scaleFor(width, height) {
  if (!(width > 0 && height > 0)) return 1;
  const small = Math.min(width, height), big = Math.max(width, height);
  return Math.min(1, Math.max(Math.sqrt(MAX_PIXELS / (width * height)), MIN_SHORT / small), MAX_SIDE / big);
}

// The picture's bytes made smaller, or the same bytes when there is nothing worth doing.
async function fitPicture(bytes) {
  const kind = Buffer.isBuffer(bytes) ? kindOf(bytes) : "", s = kind && encoder();
  if (!s) return bytes;
  try {
    const meta = await s(bytes).metadata();
    if ((meta.pages || 1) > 1) return bytes;
    // A photo turned on its side says so in its EXIF; width and height here are as it is shown.
    const turned = (meta.orientation || 1) >= 5, width = turned ? meta.height : meta.width, height = turned ? meta.width : meta.height;
    const scale = scaleFor(width, height), clip = scale < 0.9;
    if (!clip && (kind === "jpeg" || bytes.length < SQUEEZE_BYTES)) return bytes;
    let image = s(bytes).rotate();
    if (clip) image = image.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { fit:"fill" });
    const out = await (kind === "png" ? image.png({ palette:true, quality:90 }) : image.jpeg({ quality:85, mozjpeg:true })).toBuffer();
    return out.length < bytes.length * WORTH ? out : bytes;
  } catch { return bytes; }
}

// The same for a file in the folder, a little after it was written: a Canvas saved again soon after is fitted once.
// It is written only when the file is still the one that was read, so a newer save is never put back.
function fitter(store, { waitMs = WAIT_MS } = {}) {
  const waiting = new Map();
  return function fitSoon(project, rel) {
    let file;
    try { file = store.resolve(project, rel, { forWrite:true }); } catch { return; }
    if (!encoder() || !/\.(png|jpe?g)$/i.test(file)) return;
    clearTimeout(waiting.get(file));
    const timer = setTimeout(async () => {
      waiting.delete(file);
      try {
        const before = fs.statSync(file), bytes = fs.readFileSync(file), out = await fitPicture(bytes);
        if (out === bytes) return;
        const now = fs.statSync(file);
        if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) return;
        store.writeBytes(project, rel, out);
      } catch { /* The picture stays as it was. */ }
    }, waitMs);
    timer.unref?.();
    waiting.set(file, timer);
  };
}

module.exports = { fitPicture, fitter, scaleFor, MAX_PIXELS };
