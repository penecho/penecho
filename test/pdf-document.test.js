"use strict";
// The dependency-free PDF writer behind Download PDF: page planning, JPEG
// embedding, byte-exact cross references, and a real parser reading the file.
const { test } = require("node:test"), assert = require("node:assert/strict"), sharp = require("sharp");
const PDF = require("../src/client/app/pdf-document.js");

const latin1 = bytes => Buffer.from(bytes).toString("latin1");
const jpeg = async (width, height, background = "#3366cc", options = {}) => new Uint8Array(await sharp({ create:{ width, height, channels:3, background } })
  .toColourspace(options.gray ? "b-w" : "srgb").jpeg({ quality:90, progressive:options.progressive === true }).toBuffer());
async function pages(sizes) {
  return Promise.all(sizes.map(async ([width, height, pageWidth, pageHeight, background]) => {
    const data = await jpeg(width, height, background);
    return { width:pageWidth, height:pageHeight, image:{ data, ...PDF.jpegInfo(data) } };
  }));
}
// Parses the classic cross-reference table and checks every offset against the bytes.
function structure(bytes) {
  const text = latin1(bytes), startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  assert.ok(Number.isInteger(startxref), "startxref and %%EOF end the file");
  assert.equal(text.slice(startxref, startxref + 5), "xref\n", "startxref points at the xref table");
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref)), count = Number(header[1]), table = startxref + header[0].length;
  const entries = [];
  for (let index = 0; index < count; index++) {
    const entry = text.slice(table + index * 20, table + index * 20 + 20);
    assert.match(entry, /^\d{10} \d{5} [nf]\r\n$/, `xref entry ${index} is exactly 20 bytes`);
    entries.push({ offset:Number(entry.slice(0, 10)), type:entry[17] });
  }
  assert.deepEqual(entries[0], { offset:0, type:"f" });
  for (let id = 1; id < count; id++) {
    assert.equal(entries[id].type, "n");
    assert.equal(text.slice(entries[id].offset, entries[id].offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`, `object ${id} starts at its xref offset`);
  }
  const trailer = text.slice(table + count * 20);
  assert.match(trailer, /^trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info 3 0 R >>\n/);
  assert.equal(Number(/\/Size (\d+)/.exec(trailer)[1]), count);
  const objects = new Map(entries.slice(1).map(({ offset }, index) => [index + 1, text.slice(offset, text.indexOf("endobj", offset))]));
  return { text, count, objects };
}

test("pages keep the content width and A4 proportions, and every page shares one scale", () => {
  // A note card at 1.5x: one portrait page, scaled to fit A4.
  const note = PDF.planPages(1350, 1800, { pointsPerPixel:0.5 });
  assert.equal(note.pages.length, 1);
  assert.deepEqual([note.pages[0].pageWidth, note.pages[0].pageHeight], [595.28, 793.71]);
  // Small content keeps its natural size instead of being enlarged.
  const small = PDF.planPages(450, 300, { pointsPerPixel:0.5 });
  assert.deepEqual([small.pages[0].pageWidth, small.pages[0].pageHeight], [225, 150]);
  // A typical landscape board stays on one landscape page.
  const board = PDF.planPages(4000, 2500);
  assert.equal(board.pages.length, 1);
  assert.ok(board.pages[0].pageWidth <= 841.89 && board.pages[0].pageHeight <= 595.28);
  // Tall content: full-width portrait pages that tile the content exactly.
  const tall = PDF.planPages(900, 3000);
  assert.deepEqual([tall.rows, tall.columns], [3, 1]);
  let y = 0;
  for (const page of tall.pages) {
    assert.deepEqual([page.sx, page.sw, page.sy], [0, 900, y]);
    assert.ok(page.sh <= 900 * Math.SQRT2);
    assert.equal(page.pageWidth, 595.28);
    assert.ok(page.pageHeight <= 841.89);
    y += page.sh;
  }
  assert.equal(y, 3000);
  // Wide content: full-height landscape pages, at most 2:1.
  const wide = PDF.planPages(6000, 1000);
  assert.deepEqual([wide.rows, wide.columns], [1, 3]);
  assert.deepEqual(wide.pages.map(page => [page.sx, page.sw, page.sh]), [[0, 2000, 1000], [2000, 2000, 1000], [4000, 2000, 1000]]);
  for (const page of wide.pages) assert.deepEqual([page.pageWidth, page.pageHeight], [841.89, 420.95]);
  assert.throws(() => PDF.planPages(0, 10), RangeError);
  assert.throws(() => PDF.planPages(NaN, 10), RangeError);
});

test("total pixels and page count are capped for huge content", () => {
  const huge = PDF.planPages(10000, 8000);
  const total = huge.pages.reduce((sum, page) => sum + page.width * page.height, 0);
  assert.ok(total <= PDF.MAX_TOTAL_PIXELS * 1.001, `${total} pixels`);
  assert.ok(huge.pixelScale < 1);
  assert.equal(PDF.planPages(10000, 8000, { maxTotalPixels:4e6 }).pages.reduce((sum, page) => sum + page.width * page.height, 0) <= 4e6 * 1.001, true);
  const ribbon = PDF.planPages(100, 100000);
  assert.equal(ribbon.pages.length, PDF.MAX_PAGES);
  assert.equal(ribbon.pages.reduce((sum, page) => sum + page.sh, 0), 100000);
  for (const page of ribbon.pages) assert.ok(page.pageWidth >= 3 && page.pageHeight >= 3 && page.pageHeight <= 14400);
});

test("page breaks move into quiet rows without pushing any page past the height cap", () => {
  const cap = 900 * Math.SQRT2, calls = [];
  for (const pick of ["low", "high", "outside", "throws"]) {
    const plan = PDF.planPages(900, 3400, { breakAt:(preferred, low, high) => {
      calls.push([preferred, low, high]);
      assert.ok(low <= preferred && preferred <= high);
      if (pick === "throws") throw Error("canvas unavailable");
      return pick === "low" ? low : pick === "high" ? high : high + 50;
    } });
    assert.equal(plan.pages.reduce((sum, page) => sum + page.sh, 0), 3400);
    for (const page of plan.pages) assert.ok(page.sh <= cap + 1, `${pick}: ${page.sh}`);
    if (pick === "low") assert.ok(plan.pages[0].sh < 3400 / plan.pages.length);
  }
  assert.ok(calls.length >= 4);
});

test("a quiet row is found between lines of text, never through them", () => {
  const width = 40, height = 70, data = new Uint8ClampedArray(width * height * 4).fill(255),
    text = y => [10, 30, 50].some(top => y >= top && y < top + 10);
  // Glyph rows differ from each other; a vertical accent rule runs down every row.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x === 0 || (text(y) && (x + y) % 4 === 0)) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  // Preferred row 35 is inside a line; the nearest clear rows are in the gaps above and below.
  assert.equal(PDF.quietRow(data, width, height, 35), 27);
  assert.equal(PDF.quietRow(data, width, height, 44), 44);
  const dense = new Uint8ClampedArray(width * height * 4).map((_, index) => (index >> 2) % 7 * 30);
  assert.equal(PDF.quietRow(dense, width, height, 30), null);
});

test("JPEG frame headers give the embedded image size and color components", async () => {
  assert.deepEqual(PDF.jpegInfo(await jpeg(37, 21)), { width:37, height:21, components:3 });
  assert.deepEqual(PDF.jpegInfo(await jpeg(16, 9, "#808080", { gray:true })), { width:16, height:9, components:1 });
  assert.deepEqual(PDF.jpegInfo(await jpeg(64, 48, "#ffffff", { progressive:true })), { width:64, height:48, components:3 });
  const png = new Uint8Array(await sharp({ create:{ width:4, height:4, channels:3, background:"#000" } }).png().toBuffer());
  assert.throws(() => PDF.jpegInfo(png), /not a JPEG/);
  const truncated = (await jpeg(8, 8)).slice(0, 20);
  assert.throws(() => PDF.jpegInfo(truncated), /could not be read/);
});

test("the writer emits a structurally valid multi-page PDF with byte-exact offsets", async () => {
  const input = await pages([[900, 1000, 595.28, 661.42, "#dd3333"], [900, 1000, 595.28, 661.42, "#33aa33"], [900, 400, 595.28, 264.57, "#3333dd"]]);
  const bytes = PDF.documentBytes(input, { title:"细胞膜 · Cell (membranes)", created:new Date(Date.UTC(2026, 10, 1, 9, 30, 5)) });
  assert.equal(latin1(bytes.slice(0, 9)), "%PDF-1.4\n");
  assert.deepEqual([...bytes.slice(9, 15)], [0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const { text, count, objects } = structure(bytes);
  assert.equal(count, 4 + 3 * 3);
  assert.match(objects.get(1), /<< \/Type \/Catalog \/Pages 2 0 R \/ViewerPreferences << \/DisplayDocTitle true >> >>/);
  assert.match(objects.get(2), /<< \/Type \/Pages \/Kids \[4 0 R 7 0 R 10 0 R\] \/Count 3 >>/);
  const title = Buffer.from("细胞膜 · Cell (membranes)", "utf16le").swap16().toString("hex").toUpperCase();
  assert.ok(objects.get(3).includes(`/Title <FEFF${title}>`));
  assert.match(objects.get(3), /\/Producer \(PenEcho\).*\/CreationDate \(D:20261101093005Z\)/);
  for (const [index, page] of input.entries()) {
    const id = 4 + index * 3;
    assert.match(objects.get(id), new RegExp(`/Type /Page /Parent 2 0 R /MediaBox \\[0 0 ${page.width} ${page.height}\\] /Resources << /XObject << /Im${index + 1} ${id + 2} 0 R >>`));
    assert.match(objects.get(id + 1), new RegExp(`stream\\nq\\n${page.width} 0 0 ${page.height} 0 0 cm\\n/Im${index + 1} Do\\nQ\\n\\nendstream`));
    const image = objects.get(id + 2), streamStart = text.indexOf("stream\n", text.indexOf(`${id + 2} 0 obj\n`)) + 7;
    assert.match(image, new RegExp(`/Subtype /Image /Width ${page.image.width} /Height ${page.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.data.length} >>`));
    assert.deepEqual(bytes.slice(streamStart, streamStart + page.image.data.length), page.image.data);
    assert.equal(latin1(bytes.slice(streamStart + page.image.data.length, streamStart + page.image.data.length + 10)), "\nendstream");
  }
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 3);
});

test("invalid pages are rejected before any bytes are written", async () => {
  const [page] = await pages([[20, 10, 15, 7.5]]);
  assert.throws(() => PDF.documentParts([]), RangeError);
  assert.throws(() => PDF.documentParts([{ ...page, width:0 }]), /invalid size/);
  assert.throws(() => PDF.documentParts([{ ...page, image:{ ...page.image, width:21 } }]), /does not match/);
  assert.throws(() => PDF.documentParts([{ ...page, image:{ ...page.image, components:4 } }]), /invalid image/);
  // Blob images are written as Blob parts with their exact sizes.
  const blob = new Blob([page.image.data], { type:"image/jpeg" }), parts = PDF.documentParts([{ ...page, image:{ ...page.image, data:blob } }]);
  assert.ok(parts.includes(blob));
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  structure(bytes);
  assert.throws(() => PDF.documentBytes([{ ...page, image:{ ...page.image, data:blob } }]), /documentParts/);
});

test("pdf.js reads the pages, sizes, title and JPEG pixels", async () => {
  const { PDFParse } = require("pdf-parse");
  const bytes = PDF.documentBytes(await pages([[300, 200, 225, 150, "#dd3333"], [300, 420, 225, 315, "#33aa33"]]), { title:"Quarterly 报告" });
  const parser = new PDFParse({ data:bytes.slice() });
  try {
    const info = await parser.getInfo({ parsePageInfo:true });
    assert.equal(info.total, 2);
    assert.deepEqual(info.pages.map(page => [page.width, page.height]), [[225, 150], [225, 315]]);
    assert.equal(info.info.Title, "Quarterly 报告");
    const shot = await parser.getScreenshot({ partial:[2], desiredWidth:45, imageDataUrl:false, imageBuffer:true });
    const { data, info:meta } = await sharp(Buffer.from(shot.pages[0].data)).raw().toBuffer({ resolveWithObject:true });
    const center = ((meta.height >> 1) * meta.width + (meta.width >> 1)) * meta.channels, [r, g, b] = data.slice(center, center + 3);
    assert.ok(Math.abs(r - 0x33) < 12 && Math.abs(g - 0xaa) < 12 && Math.abs(b - 0x33) < 12, `${r},${g},${b}`);
  } finally {
    await parser.destroy();
  }
});

test("filenames follow the title with a .pdf extension", () => {
  assert.equal(PDF.filename("Q3: plan / review?"), "Q3- plan - review-.pdf");
  assert.equal(PDF.filename("  ", "penecho-note"), "penecho-note.pdf");
  assert.equal(PDF.filename("细胞膜..."), "细胞膜.pdf");
});

// ---------- Browser path with a fake canvas whose encoder is real JPEG ----------
function fakeDocument({ pixel = () => 255, jpegType = "image/jpeg" } = {}) {
  const created = [], encoded = [];
  class FakeCanvas {
    constructor(width = 0, height = 0) { this.width = width; this.height = height; this.ops = []; created.push(this); }
    getContext() {
      const canvas = this;
      return {
        set fillStyle(value) { canvas.ops.push(["fillStyle", value]); },
        fillRect(...args) { canvas.ops.push(["fillRect", ...args]); },
        drawImage(...args) { canvas.ops.push(["drawImage", ...args.slice(1)]); canvas.drawn = args; },
        getImageData(x, y, width, height) {
          // Sample the drawn source band the way a scaled drawImage would.
          const [, sx, sy, sw, sh] = canvas.drawn, data = new Uint8ClampedArray(width * height * 4);
          for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
            const value = pixel(Math.floor(sx + (column + 0.5) * sw / width), Math.floor(sy + (row + 0.5) * sh / height)), index = (row * width + column) * 4;
            data[index] = data[index + 1] = data[index + 2] = value;
            data[index + 3] = 255;
          }
          return { data };
        },
      };
    }
    toBlob(callback, type, quality) {
      encoded.push([this, type, quality]);
      const { width, height } = this;
      sharp({ create:{ width, height, channels:3, background:"#ffffff" } }).jpeg({ quality:Math.round(quality * 100) }).toBuffer()
        .then(buffer => callback(new Blob([buffer], { type:jpegType })), () => callback(null));
    }
  }
  return { document:{ createElement:tag => { assert.equal(tag, "canvas"); return new FakeCanvas(); } }, FakeCanvas, created, encoded };
}

test("fromImage draws each page over white, cuts between text lines and returns a PDF Blob", async () => {
  // A 900x2400 document whose text lines are 40px tall with 30px gaps.
  const text = y => y % 70 < 40, pixel = (x, y) => text(y) && (x + y) % 5 === 0 ? 0 : 255;
  const fake = fakeDocument({ pixel }), source = new fake.FakeCanvas(900, 2400);
  const blob = await PDF.fromImage(source, { document:fake.document, title:"Long widget", pointsPerPixel:0.5 });
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer()), { objects } = structure(bytes);
  const pageCanvases = fake.encoded.map(([canvas]) => canvas);
  assert.equal(pageCanvases.length, 2);
  assert.equal((latin1(bytes).match(/\/Type \/Page /g) || []).length, 2);
  assert.match(objects.get(2), /\/Count 2/);
  let y = 0;
  for (const canvas of pageCanvases) {
    const [fill, rect, draw] = canvas.ops;
    assert.deepEqual(fill, ["fillStyle", "#fff"]);
    assert.equal(rect[0], "fillRect");
    assert.equal(draw[0], "drawImage");
    const [, sx, sy, sw, sh] = draw;
    assert.deepEqual([sx, sy, sw], [0, y, 900]);
    assert.ok(sh <= 900 * Math.SQRT2 + 1);
    y += sh;
    // Released after encoding.
    assert.deepEqual([canvas.width, canvas.height], [1, 1]);
  }
  assert.equal(y, 2400);
  const cut = pageCanvases[0].ops[2][4];
  assert.ok(!text(cut) && !text(cut - 1), `the page break at ${cut} is in a gap between lines`);
  for (const [, type, quality] of fake.encoded) assert.deepEqual([type, quality], ["image/jpeg", 0.92]);
});

test("an opaque single-page canvas is encoded directly, and a non-JPEG encoder fails clearly", async () => {
  const fake = fakeDocument(), source = new fake.FakeCanvas(1200, 800);
  const blob = await PDF.fromImage(source, { document:fake.document, opaque:true, pointsPerPixel:0.5 });
  assert.deepEqual(fake.encoded.map(([canvas]) => canvas), [source]);
  assert.equal(fake.created.length, 1, "no page copy of the full canvas");
  structure(new Uint8Array(await blob.arrayBuffer()));
  const png = fakeDocument({ jpegType:"image/png" });
  await assert.rejects(PDF.fromImage(new png.FakeCanvas(20, 20), { document:png.document }), /could not encode/);
});
