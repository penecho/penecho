"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

// PenEcho's mark is a nautilus: you hear the sea echo in a shell, and it grows one chamber at a time.
// build/brand/penecho-mark.json is the checked-in drawing, as paths in a 96 by 96 box:
//   body    the shell, filled
//   spiral  the wall that winds in, cut out of the body
//   septa   the chamber walls, cut out too, and left out where the mark is shown small
// This writes what scripts/generate-icons.js starts from:
//   build/brand/penecho-mark.svg            the mark as one vector file, for anyone who needs it
//   build/brand/penecho-logo-original.png   the stacked lockup: mark above the PenEcho lettering
//   build/brand/penecho-mark-small.png      the mark for 48 px and below: no chamber walls, a wider spiral
// The lettering is build/brand/penecho-wordmark.png, kept as pixels so no font on the build host matters.
const ROOT = path.resolve(__dirname, ".."),
  brand = path.join(ROOT, "build", "brand"),
  mark = require("../build/brand/penecho-mark.json"),
  crops = require("../build/brand/penecho-logo.json"),
  wordmark = path.join(brand, "penecho-wordmark.png");

const TRANSPARENT = { r:0, g:0, b:0, alpha:0 };

function markSvg(size, { small = false } = {}) {
  const lines = mark.spiral + (small ? "" : mark.septa), width = small ? mark.smallLine : mark.line;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
  <defs><mask id="cut"><rect width="96" height="96" fill="#fff"/><path d="${lines}" fill="none" stroke="#000" stroke-width="${width}" stroke-linecap="round"/></mask></defs>
  <path d="${mark.body}" fill="${mark.color}" mask="url(#cut)"/>
</svg>
`;
}

// The lettering's blue follows the mark's, keeping every edge's alpha.
async function letteringInMarkBlue() {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(mark.color.slice(at, at + 2), 16));
  const { data, info } = await sharp(wordmark).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i + 2] > data[i] + 60) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
  return sharp(data, { raw:{ width:info.width, height:info.height, channels:4 } }).png().toBuffer();
}

async function makeBrandMaster() {
  fs.writeFileSync(path.join(brand, "penecho-mark.svg"), markSvg(96));
  const side = Math.min(crops.mark.width, crops.mark.height),
    drawn = await sharp(Buffer.from(markSvg(side))).png().toBuffer(),
    lettering = await sharp(await letteringInMarkBlue()).resize(crops.wordmark.width, crops.wordmark.height, { fit:"contain", background:TRANSPARENT }).png().toBuffer();
  await sharp({ create:{ width:crops.width, height:crops.height, channels:4, background:TRANSPARENT } })
    .composite([
      { input:drawn, left:crops.mark.left + Math.round((crops.mark.width - side) / 2), top:crops.mark.top + Math.round((crops.mark.height - side) / 2) },
      { input:lettering, left:crops.wordmark.left, top:crops.wordmark.top },
    ])
    .png({ compressionLevel:9 })
    .toFile(path.join(brand, "penecho-logo-original.png"));
  await sharp(Buffer.from(markSvg(1024, { small:true }))).png({ compressionLevel:9 }).toFile(path.join(brand, "penecho-mark-small.png"));
}

module.exports = { makeBrandMaster, markSvg };

if (require.main === module) makeBrandMaster().catch(error => { console.error(error); process.exitCode = 1; });
