"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const png2icons = require("png2icons");

const ROOT = path.resolve(__dirname, ".."),
  iconRoot = path.join(ROOT, "build", "icons"),
  generated = path.join(iconRoot, "generated"),
  source = path.join(ROOT, "public", "penecho-mark.png");

async function png(size, output) {
  const markSize = Math.max(1, Math.round(size * .72)), inset = Math.round(size * .035), radius = Math.round(size * .21),
    tile = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="#fff"/></svg>`);
  await sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:0 } } })
    .composite([{ input:tile }, { input:await sharp(source).resize(markSize, markSize, { fit:"contain", background:{ r:0, g:0, b:0, alpha:0 } }).png().toBuffer(), gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toFile(output);
}

async function installerGif(icon, output) {
  const artwork = Buffer.from(`<svg width="268" height="167" xmlns="http://www.w3.org/2000/svg">
    <rect width="268" height="167" fill="#f4f7fb"/>
    <text x="134" y="122" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="600" fill="#172033">PenEcho</text>
    <text x="134" y="145" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" fill="#667085">Installing…</text>
  </svg>`);
  await sharp(artwork)
    .composite([{ input:await sharp(icon).resize(68, 68).png().toBuffer(), top:24, left:100 }])
    .gif()
    .toFile(output);
}

async function main() {
  fs.mkdirSync(generated, { recursive:true });
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024], files = new Map();
  for (const size of sizes) {
    const output = path.join(generated, `penecho-${size}.png`);
    await png(size, output);
    files.set(size, output);
  }
  fs.copyFileSync(files.get(512), path.join(iconRoot, "penecho.png"));
  fs.copyFileSync(files.get(1024), path.join(iconRoot, "penecho-1024.png"));
  await installerGif(files.get(128), path.join(iconRoot, "penecho-install.gif"));
  const sourcePng = fs.readFileSync(files.get(1024)),
    icns = png2icons.createICNS(sourcePng, png2icons.BICUBIC2, 0),
    ico = png2icons.createICO(sourcePng, png2icons.BICUBIC2, 0, false, true);
  if (!icns || !ico) throw new Error("Unable to encode desktop icon files.");
  fs.writeFileSync(path.join(iconRoot, "penecho.icns"), icns);
  fs.writeFileSync(path.join(iconRoot, "penecho.ico"), ico);
  console.log(`Generated PenEcho desktop icons in ${iconRoot}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
