"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const png2icons = require("png2icons");
const { prepareBrandLogo } = require("./prepare-brand-logo.js");

const ROOT = path.resolve(__dirname, ".."),
  iconRoot = path.join(ROOT, "build", "icons"),
  generated = path.join(iconRoot, "generated"),
  source = path.join(ROOT, "build", "brand", "penecho-logo.png"),
  crops = require("../build/brand/penecho-logo.json"),
  wordmarkSource = path.join(ROOT, "public", "penecho-readme-header.webp");

async function colorMark(size) {
  const mark = await sharp(source).extract(crops.mark).png().toBuffer();
  return sharp(mark)
    .trim()
    .resize(size, size, { fit:"contain", background:{ r:0, g:0, b:0, alpha:0 } })
    .png()
    .toBuffer();
}

async function readmeLogo() {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha || metadata.width !== crops.width || metadata.height !== crops.height) {
    throw new Error("Brand source must retain its transparent alpha and documented crop geometry.");
  }
  const logo = await sharp(source).extract(crops.logo).png().toBuffer();
  await sharp(logo)
    .trim()
    .resize({ width:840, withoutEnlargement:true })
    .webp({ lossless:true, effort:6 })
    .toFile(wordmarkSource);
  // Keep the supplied lettering/geometry readable on a dark README surface.
  const dark = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  for (let i = 0; i < dark.data.length; i += 4) {
    if (dark.data[i + 3] && Math.max(dark.data[i], dark.data[i + 1], dark.data[i + 2]) < 128) {
      dark.data[i] = 245; dark.data[i + 1] = 246; dark.data[i + 2] = 248;
    }
  }
  const darkLogo = await sharp(dark.data, { raw:{ width:dark.info.width, height:dark.info.height, channels:4 } }).png().toBuffer();
  await sharp(darkLogo).trim().resize({ width:840, withoutEnlargement:true })
    .webp({ lossless:true, effort:6 })
    .toFile(path.join(ROOT, "public", "penecho-readme-header-dark.webp"));
}

async function windowsPng(size, output) {
  const markSize = Math.max(1, Math.round(size * .86)),
    mark = await colorMark(markSize);
  await sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:0 } } })
    .composite([{ input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toFile(output);
}

async function macPng(size, output) {
  const markSize = Math.max(1, Math.round(size * .72)), inset = Math.round(size * .035), radius = Math.round(size * .21),
    tile = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="#fff"/></svg>`),
    mark = await colorMark(markSize);
  await sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:0 } } })
    .composite([{ input:tile }, { input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toFile(output);
}

async function installerGif(output) {
  const width = 268, height = 167, frames = 3,
    logo = await sharp(wordmarkSource)
      .resize(136, 110, { fit:"contain", background:{ r:0, g:0, b:0, alpha:0 } })
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

async function main() {
  fs.mkdirSync(generated, { recursive:true });
  await prepareBrandLogo(path.join(ROOT, "build", "brand", "penecho-logo-original.png"), source);
  await readmeLogo();
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024], files = new Map();
  for (const size of sizes) {
    const output = path.join(generated, `penecho-${size}.png`);
    await windowsPng(size, output);
    files.set(size, output);
  }
  // A small white tile protects the black circular dot in dark tabs.
  await macPng(256, path.join(ROOT, "public", "penecho-favicon.png"));
  const macIconPng = path.join(generated, "penecho-mac-1024.png");
  await macPng(1024, macIconPng);
  fs.copyFileSync(files.get(512), path.join(iconRoot, "penecho.png"));
  fs.copyFileSync(files.get(1024), path.join(iconRoot, "penecho-desktop-1024.png"));
  await installerGif(path.join(iconRoot, "penecho-install.gif"));
  const windowsSourcePng = fs.readFileSync(files.get(1024)),
    macSourcePng = fs.readFileSync(macIconPng),
    icns = png2icons.createICNS(macSourcePng, png2icons.BICUBIC2, 0),
    ico = png2icons.createICO(windowsSourcePng, png2icons.BICUBIC2, 0, false, true);
  if (!icns || !ico) throw new Error("Unable to encode desktop icon files.");
  fs.writeFileSync(path.join(iconRoot, "penecho.icns"), icns);
  fs.writeFileSync(path.join(iconRoot, "penecho.ico"), ico);
  console.log(`Generated PenEcho desktop icons in ${iconRoot}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
