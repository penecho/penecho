"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { prepareBrandLogo } = require("./prepare-brand-logo.js");

// PenEcho brand: the blue pen nib touching water, with two ripples.
// build/brand/penecho-logo-original.png is the checked-in transparent master
// (stacked lockup: mark above the PenEcho wordmark, lettering baked in, so no
// build-host fonts are involved). penecho-logo.json documents its crops.
// build/brand/penecho-mark-small.png is the same mark with heavier strokes for
// icons rendered at 48 px and below, where the regular strokes would blur.
const ROOT = path.resolve(__dirname, ".."),
  iconRoot = path.join(ROOT, "build", "icons"),
  generated = path.join(iconRoot, "generated"),
  original = path.join(ROOT, "build", "brand", "penecho-logo-original.png"),
  source = path.join(ROOT, "build", "brand", "penecho-logo.png"),
  smallMarkSource = path.join(ROOT, "build", "brand", "penecho-mark-small.png"),
  crops = require("../build/brand/penecho-logo.json"),
  readmeLight = path.join(ROOT, "public", "penecho-readme-header.webp"),
  readmeDark = path.join(ROOT, "public", "penecho-readme-header-dark.webp"),
  readmePng = path.join(ROOT, "public", "penecho-readme-header.png");

const SMALL_ICON = 48,
  TRANSPARENT = { r:0, g:0, b:0, alpha:0 },
  DARK_INK = [245, 246, 248],
  DARK_BLUE = [124, 154, 255];

async function crop(name) {
  return sharp(source).extract(crops[name]).png().toBuffer();
}

async function colorMark(size, { small = size <= SMALL_ICON } = {}) {
  const input = small ? fs.readFileSync(smallMarkSource) : await crop("mark");
  return sharp(input)
    .trim()
    .resize(size, size, { fit:"contain", background:TRANSPARENT })
    .png()
    .toBuffer();
}

// README: horizontal lockup (mark + wordmark) composed from the master crops.
async function horizontalLockup() {
  const markHeight = 520,
    mark = await sharp(await crop("mark")).trim().resize({ height:markHeight }).png().toBuffer({ resolveWithObject:true }),
    wordHeight = Math.round(markHeight * .46),
    word = await sharp(await crop("wordmark")).trim().resize({ height:wordHeight }).png().toBuffer({ resolveWithObject:true }),
    gap = Math.round(markHeight * .2),
    width = mark.info.width + gap + word.info.width,
    wordTop = Math.round((markHeight - wordHeight) / 2 + markHeight * .06);
  return sharp({ create:{ width, height:markHeight, channels:4, background:TRANSPARENT } })
    .composite([{ input:mark.data, left:0, top:0 }, { input:word.data, left:mark.info.width + gap, top:wordTop }])
    .png()
    .toBuffer();
}

// Dark README: ink lettering turns near-white and the blue turns lighter, keeping every edge's alpha.
async function darkVariant(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const blue = data[i + 2] > data[i] + 60, color = blue ? DARK_BLUE : DARK_INK;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
  return sharp(data, { raw:{ width:info.width, height:info.height, channels:4 } }).png().toBuffer();
}

async function readmeLogos() {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha || metadata.width !== crops.width || metadata.height !== crops.height) {
    throw new Error("Brand source must retain its transparent alpha and documented crop geometry.");
  }
  const light = await horizontalLockup();
  await sharp(light).resize({ width:840 }).webp({ lossless:true, effort:6 }).toFile(readmeLight);
  await sharp(await darkVariant(light)).resize({ width:840 }).webp({ lossless:true, effort:6 }).toFile(readmeDark);
  // Opaque PNG copy for places that cannot show transparent WebP (social cards, older viewers).
  const pad = 120;
  await sharp(light)
    .extend({ top:pad, bottom:pad, left:pad * 2, right:pad * 2, background:{ r:255, g:255, b:255, alpha:1 } })
    .flatten({ background:"#ffffff" })
    .resize({ width:1764 })
    .png({ compressionLevel:9 })
    .toFile(readmePng);
}

async function transparentMarkPng(size, { markScale = .86, small = size <= SMALL_ICON } = {}) {
  const mark = await colorMark(Math.max(1, Math.round(size * markScale)), { small });
  return sharp({ create:{ width:size, height:size, channels:4, background:TRANSPARENT } })
    .composite([{ input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toBuffer();
}

// White rounded tile with transparent outer corners (macOS Dock/DMG).
async function tilePng(size, { markScale = .72, small = size <= SMALL_ICON } = {}) {
  const inset = Math.round(size * .035), radius = Math.round(size * .21),
    tile = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="#fff"/></svg>`),
    mark = await colorMark(Math.max(1, Math.round(size * markScale)), { small });
  return sharp({ create:{ width:size, height:size, channels:4, background:TRANSPARENT } })
    .composite([{ input:tile }, { input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toBuffer();
}

// Mobile launcher/App Store source: opaque white square; the platforms apply their own masks.
async function mobilePng(size) {
  const mark = await colorMark(Math.round(size * .7), { small:false });
  return sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:1 } } })
    .composite([{ input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toBuffer();
}

async function installerGif(output) {
  const width = 268, height = 167, frames = 3,
    logo = await sharp(await crop("logo"))
      .resize(136, 110, { fit:"contain", background:TRANSPARENT })
      .png()
      .toBuffer(),
    dots = [
      [1, .3, .18],
      [.18, 1, .3],
      [.3, .18, 1],
    ],
    composites = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const top = frame * height,
      dotArtwork = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="126" cy="140" r="2.5" fill="#121419" opacity="${dots[frame][0]}"/>
        <circle cx="134" cy="140" r="2.5" fill="#121419" opacity="${dots[frame][1]}"/>
        <circle cx="142" cy="140" r="2.5" fill="#121419" opacity="${dots[frame][2]}"/>
      </svg>`);
    composites.push(
      { input:logo, top:top + 14, left:66 },
      { input:dotArtwork, top, left:0 },
    );
  }
  await sharp({ create:{ width, height:height * frames, pageHeight:height, channels:4, background:{ r:255, g:255, b:255, alpha:1 } } })
    .composite(composites)
    .gif({ loop:0, delay:[240, 240, 240], dither:.4 })
    .toFile(output);
}

// ICO with one PNG entry per size, so small sizes can use the heavier-stroke mark.
function encodeIco(entries) {
  const header = Buffer.alloc(6), directory = Buffer.alloc(entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map(entry => entry.png)]);
}

// ICNS with PNG payloads (the layout iconutil produces).
const ICNS_TYPES = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]];
function encodeIcns(pngBySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = pngBySize.get(size), header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8), length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...chunks]);
}

async function main() {
  fs.mkdirSync(generated, { recursive:true });
  await prepareBrandLogo(original, source);
  await readmeLogos();
  const windows = new Map(), mac = new Map();
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const png = await transparentMarkPng(size);
    fs.writeFileSync(path.join(generated, `penecho-${size}.png`), png);
    windows.set(size, png);
  }
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const png = await tilePng(size);
    fs.writeFileSync(path.join(generated, `penecho-mac-${size}.png`), png);
    mac.set(size, png);
  }
  // Browser tabs show the favicon at 16-32 px: keep the heavier mark on a transparent background.
  fs.writeFileSync(path.join(ROOT, "public", "penecho-favicon.png"), await transparentMarkPng(256, { markScale:.78, small:true }));
  // UI mark for wordmarks, the update window and CSS masks (shown at 18-44 px): heavier strokes.
  fs.writeFileSync(path.join(ROOT, "public", "penecho-mark.png"), await colorMark(256, { small:true }));
  fs.writeFileSync(path.join(iconRoot, "penecho-1024.png"), await mobilePng(1024));
  fs.writeFileSync(path.join(iconRoot, "penecho.png"), windows.get(512));
  fs.writeFileSync(path.join(iconRoot, "penecho-desktop-1024.png"), windows.get(1024));
  await installerGif(path.join(iconRoot, "penecho-install.gif"));
  fs.writeFileSync(path.join(iconRoot, "penecho.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map(size => ({ size, png:windows.get(size) }))));
  fs.writeFileSync(path.join(iconRoot, "penecho.icns"), encodeIcns(mac));
  console.log(`Generated PenEcho brand assets in ${iconRoot} and public/`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
