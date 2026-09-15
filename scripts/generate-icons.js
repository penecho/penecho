"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const png2icons = require("png2icons");

const ROOT = path.resolve(__dirname, ".."),
  iconRoot = path.join(ROOT, "build", "icons"),
  generated = path.join(iconRoot, "generated"),
  source = path.join(ROOT, "public", "penecho-mark.png"),
  wordmarkSource = path.join(ROOT, "public", "penecho-readme-header.png");

async function monochromeMark(size) {
  const markAlpha = await sharp(source)
    .resize(size, size, { fit:"contain", background:{ r:0, g:0, b:0, alpha:0 } })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  return sharp({ create:{ width:size, height:size, channels:3, background:{ r:17, g:19, b:24 } } })
    .joinChannel(markAlpha, { raw:{ width:size, height:size, channels:1 } })
    .png()
    .toBuffer();
}

async function windowsPng(size, output) {
  const markSize = Math.max(1, Math.round(size * .86)),
    mark = await monochromeMark(markSize);
  await sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:0 } } })
    .composite([{ input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toFile(output);
}

async function macPng(size, output) {
  const markSize = Math.max(1, Math.round(size * .72)), inset = Math.round(size * .035), radius = Math.round(size * .21),
    tile = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="#fff"/></svg>`),
    mark = await monochromeMark(markSize);
  await sharp({ create:{ width:size, height:size, channels:4, background:{ r:255, g:255, b:255, alpha:0 } } })
    .composite([{ input:tile }, { input:mark, gravity:"center" }])
    .png({ compressionLevel:9, palette:false })
    .toFile(output);
}

function dilateAlpha(input, width, height, radius = 1) {
  const output = Buffer.alloc(input.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
          value = Math.max(value, input[yy * width + xx]);
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

async function installerWordmark() {
  const width = 112, height = 22, insetX = 2, contentWidth = width - insetX * 2, echoStart = 50,
    crop = await sharp(wordmarkSource)
    .extract({ left:710, top:140, width:1054, height:240 })
    .png()
    .toBuffer(),
    trimmed = await sharp(crop).trim({ background:"#fff" }).png().toBuffer(),
    maskContent = await sharp(trimmed)
      .flatten({ background:"#fff" })
      .grayscale()
      .negate()
      .resize(contentWidth, height, { fit:"contain", background:{ r:255, g:255, b:255 } })
      .raw()
      .toBuffer({ resolveWithObject:true }),
    colorContent = await sharp(trimmed)
      .flatten({ background:"#fff" })
      .resize(contentWidth, height, { fit:"contain", background:{ r:255, g:255, b:255 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject:true });
  const mask = Buffer.alloc(width * height),
    colorPixels = Buffer.alloc(width * height * colorContent.info.channels, 255);
  for (let y = 0; y < height; y += 1) {
    maskContent.data.copy(mask, y * width + insetX, y * contentWidth, (y + 1) * contentWidth);
    colorContent.data.copy(
      colorPixels,
      (y * width + insetX) * colorContent.info.channels,
      y * contentWidth * colorContent.info.channels,
      (y + 1) * contentWidth * colorContent.info.channels,
    );
  }
  const regularWordmark = await sharp({ create:{ width, height, channels:3, background:{ r:18, g:20, b:25 } } })
    .joinChannel(mask, { raw:{ width, height, channels:1 } })
    .png()
    .toBuffer(),
    echoMask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = echoStart; x < width; x += 1) {
      const offset = y * width + x,
        colorOffset = offset * colorContent.info.channels;
      echoMask[offset] = 255 - Math.min(
        colorPixels[colorOffset],
        colorPixels[colorOffset + 1],
        colorPixels[colorOffset + 2],
      );
    }
  }
  const boldEchoMask = dilateAlpha(echoMask, width, height),
    boldEcho = await sharp({ create:{ width, height, channels:3, background:{ r:18, g:20, b:25 } } })
      .joinChannel(boldEchoMask, { raw:{ width, height, channels:1 } })
      .png()
      .toBuffer();
  return sharp(regularWordmark)
    .composite([{ input:boldEcho }])
    .png()
    .toBuffer();
}

async function installerGif(output) {
  const width = 268, height = 167, frames = 3,
    markAlpha = await sharp(source)
      .resize(60, 60, { fit:"contain", background:{ r:0, g:0, b:0, alpha:0 } })
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer(),
    mark = await sharp({ create:{ width:60, height:60, channels:3, background:{ r:18, g:20, b:25 } } })
      .joinChannel(markAlpha, { raw:{ width:60, height:60, channels:1 } })
      .png()
      .toBuffer(),
    wordmark = await installerWordmark(),
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
      { input:mark, top:top + 26, left:104 },
      { input:wordmark, top:top + 98, left:78 },
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
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024], files = new Map();
  for (const size of sizes) {
    const output = path.join(generated, `penecho-${size}.png`);
    await windowsPng(size, output);
    files.set(size, output);
  }
  const macIconPng = path.join(generated, "penecho-mac-1024.png");
  await macPng(1024, macIconPng);
  fs.copyFileSync(files.get(512), path.join(iconRoot, "penecho.png"));
  fs.copyFileSync(files.get(1024), path.join(iconRoot, "penecho-1024.png"));
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
