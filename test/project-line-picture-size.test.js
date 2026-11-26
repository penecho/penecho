"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const sharp = require("sharp");
const { fitPicture, fitter, scaleFor, MAX_PIXELS } = require("../src/server/project-lines/picture-size.js");

const noisy = (width, height) => sharp({ create:{ width, height, channels:3, background:"#ffffff", noise:{ type:"gaussian", mean:128, sigma:40 } } });
// Like a screenshot: soft colours, boxes and words.
const page = (width, height) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${Array.from({ length:40 }, (_, i) => `<rect x="${(i % 8) * width / 8 + 20}" y="${Math.floor(i / 8) * height / 5 + 20}" width="${width / 8 - 40}" height="${height / 5 - 40}" rx="24" fill="#fff" stroke="#94a3b8"/><text x="${(i % 8) * width / 8 + 50}" y="${Math.floor(i / 8) * height / 5 + 90}" font-size="40" fill="#0f172a">Card ${i} · words</text>`).join("")}</svg>`));
const flat = (width, height) => sharp({ create:{ width, height, channels:3, background:"#3b82f6" } });
const sizeOf = async bytes => { const m = await sharp(bytes).metadata(); return { width:m.width, height:m.height, format:m.format }; };

test("a big screenshot is clipped to about 4 megapixels and stays a PNG", async () => {
  const bytes = await page(4000, 2500).png().toBuffer(), out = await fitPicture(bytes), got = await sizeOf(out);
  assert.equal(got.format, "png");
  assert.ok(out.length < bytes.length);
  assert.ok(got.width * got.height <= MAX_PIXELS * 1.01, `${got.width}x${got.height}`);
  assert.equal(Math.round(got.width / got.height * 10), Math.round(4000 / 2500 * 10));
});

test("a long page keeps its width readable and no side over 8000", () => {
  assert.equal(Math.round(1440 * scaleFor(1440, 9000)), 1280);
  assert.equal(scaleFor(1440, 4000), 1);
  assert.equal(scaleFor(1200, 800), 1);
});

test("small pictures, GIFs, WebPs and JPEGs that fit are left exactly as they are", async () => {
  const small = await noisy(200, 100).png().toBuffer();
  assert.equal(await fitPicture(small), small);
  const gif = await flat(4000, 3000).gif().toBuffer();
  assert.equal(await fitPicture(gif), gif);
  const webp = await flat(4000, 3000).webp().toBuffer();
  assert.equal(await fitPicture(webp), webp);
  const jpeg = await noisy(1600, 1200).jpeg().toBuffer();
  assert.equal(await fitPicture(jpeg), jpeg);
  const notPicture = Buffer.from("just words");
  assert.equal(await fitPicture(notPicture), notPicture);
});

test("a photo turned on its side by EXIF comes out the way it is shown", async () => {
  const bytes = await flat(6000, 3000).jpeg().withMetadata({ orientation:6 }).toBuffer(), got = await sizeOf(await fitPicture(bytes));
  assert.equal(got.format, "jpeg");
  assert.ok(got.height > got.width, `${got.width}x${got.height}`);
});

test("fitSoon makes a folder's picture smaller once, and never puts back an older one", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pe-picture-size-")), writes = [];
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const store = { resolve:(project, rel) => path.join(dir, rel), writeBytes:(project, rel, bytes) => { writes.push(rel); fs.writeFileSync(path.join(dir, rel), bytes); } };
  const fitSoon = fitter(store, { waitMs:20 }), wait = ms => new Promise(r => setTimeout(r, ms));
  const big = await page(4000, 2500).png().toBuffer();
  fs.writeFileSync(path.join(dir, "drawing.png"), big);
  fitSoon({}, "drawing.png");
  fitSoon({}, "drawing.png");
  for (let i = 0; i < 200 && !writes.length; i++) await wait(50);
  assert.deepEqual(writes, ["drawing.png"]);
  assert.ok(fs.statSync(path.join(dir, "drawing.png")).size < big.length);
  // A newer save lands while the picture is being made smaller: the newer one stays.
  fs.writeFileSync(path.join(dir, "canvas.png"), big);
  const fitLater = fitter(store, { waitMs:0 });
  fitLater({}, "canvas.png");
  await wait(5);
  const newer = await noisy(300, 200).png().toBuffer();
  fs.writeFileSync(path.join(dir, "canvas.png"), newer);
  await wait(2000);
  assert.deepEqual(fs.readFileSync(path.join(dir, "canvas.png")), newer);
  // Only PNG and JPEG are looked at.
  fs.writeFileSync(path.join(dir, "notes.txt"), "words");
  fitSoon({}, "notes.txt");
  await wait(100);
  assert.deepEqual(writes, ["drawing.png"]);
});
