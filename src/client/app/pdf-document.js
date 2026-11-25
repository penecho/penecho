"use strict";
// Download PDF for the Canvas, a Widget or a note, without a PDF library.
// Each page embeds one JPEG (DCTDecode) drawn over white. Content longer than
// A4 proportions is split along its long axis: pages keep the full content
// width (or height, for wide content), and every page shares one scale that
// fits an A4 sheet without enlarging small content beyond its natural size.
var PenEchoPdf = (() => {
  const A4_SHORT = 595.28, A4_LONG = 841.89,
    POINTS_PER_CSS_PIXEL = 0.75,
    MAX_PORTRAIT_ASPECT = Math.SQRT2,
    MAX_LANDSCAPE_ASPECT = 2,
    MAX_PAGES = 100,
    MAX_TOTAL_PIXELS = 40 * 1000 * 1000,
    MIN_PAGE_POINTS = 3,
    MAX_PAGE_POINTS = 14400,
    JPEG_QUALITY = 0.92,
    // "%PDF-1.4" and a binary comment so transfers keep the file binary.
    HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a];
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const pdfNumber = value => String(Math.round(value * 100) / 100);
  const byteLength = part => part.byteLength ?? part.size;

  // Balanced row cuts. `breakAt(preferred, low, high)` may move a cut to a
  // quiet row inside [low, high]; the window keeps every remaining page within
  // `cap`, so a moved cut never pushes a later page past the height limit.
  function rowCuts(height, cap, count, breakAt) {
    const cuts = [0];
    let start = 0;
    for (let left = count; left > 1; left--) {
      const target = (height - start) / left;
      let cut = Math.round(start + target);
      if (typeof breakAt === "function") {
        const low = Math.ceil(Math.max(start + target * 0.75, height - (left - 1) * cap)),
          high = Math.floor(Math.min(start + cap, start + target * 1.15, height - (left - 1)));
        let found = null;
        if (low <= high) try { found = breakAt(Math.min(high, Math.max(low, cut)), low, high); } catch { found = null; }
        if (Number.isFinite(found) && found >= low && found <= high) cut = Math.round(found);
      }
      cut = Math.min(height - (left - 1), Math.max(start + 1, cut));
      cuts.push(cut);
      start = cut;
    }
    cuts.push(height);
    return cuts;
  }

  // Page layout for a width x height pixel image. Each page lists its source
  // rectangle, its embedded image size and its page size in PDF points.
  function planPages(width, height, options = {}) {
    const W = Math.round(width), H = Math.round(height);
    if (!(W >= 1 && H >= 1 && W <= 1e6 && H <= 1e6)) throw RangeError("The PDF content size is invalid.");
    const portrait = positive(options.maxPortraitAspect, MAX_PORTRAIT_ASPECT),
      landscape = positive(options.maxLandscapeAspect, MAX_LANDSCAPE_ASPECT),
      maxPages = Math.max(1, Math.floor(positive(options.maxPages, MAX_PAGES))),
      // Large content is downsampled so all pages together stay within the pixel budget.
      pixelScale = Math.min(1, Math.sqrt(positive(options.maxTotalPixels, MAX_TOTAL_PIXELS) / (W * H)));
    let columns = 1, rows = 1;
    if (W > H * landscape) columns = Math.min(maxPages, Math.ceil(W / (H * landscape)));
    else if (H > W * portrait) rows = Math.min(maxPages, Math.ceil(H / (W * portrait)));
    const xs = Array.from({ length:columns + 1 }, (_, index) => Math.round(index * W / columns)),
      ys = rows > 1 ? rowCuts(H, Math.max(W * portrait, H / rows), rows, options.breakAt) : [0, H],
      // Split pages share one orientation; a single page follows its own shape.
      tall = rows > 1 || (columns === 1 && H >= W),
      sheetWidth = tall ? A4_SHORT : A4_LONG, sheetHeight = tall ? A4_LONG : A4_SHORT,
      rects = [];
    for (let row = 0; row < ys.length - 1; row++) for (let column = 0; column < xs.length - 1; column++) {
      rects.push({ sx:xs[column], sy:ys[row], sw:xs[column + 1] - xs[column], sh:ys[row + 1] - ys[row] });
    }
    let scale = positive(options.pointsPerPixel, POINTS_PER_CSS_PIXEL);
    for (const rect of rects) scale = Math.min(scale, sheetWidth / rect.sw, sheetHeight / rect.sh);
    const shortest = Math.min(...rects.map(rect => Math.min(rect.sw, rect.sh))),
      longest = Math.max(...rects.map(rect => Math.max(rect.sw, rect.sh)));
    scale = Math.min(Math.max(scale, MIN_PAGE_POINTS / shortest), MAX_PAGE_POINTS / longest);
    return {
      columns, rows, pointsPerPixel:scale, pixelScale,
      pages:rects.map(rect => ({
        ...rect,
        width:Math.max(1, Math.round(rect.sw * pixelScale)),
        height:Math.max(1, Math.round(rect.sh * pixelScale)),
        pageWidth:Math.round(rect.sw * scale * 100) / 100,
        pageHeight:Math.round(rect.sh * scale * 100) / 100,
      })),
    };
  }

  // The row nearest `preferred` with no edge within `radius` rows of it, in
  // RGBA pixel data. A page cut there passes between lines of text.
  function quietRow(data, width, height, preferred, options = {}) {
    const tolerance = options.tolerance ?? 10, radius = options.radius ?? 2, stride = width * 4,
      calm = new Uint8Array(height);
    for (let y = 1; y < height; y++) {
      let quiet = 1;
      for (let index = y * stride, end = index + stride; index < end; index++) {
        if (Math.abs(data[index] - data[index - stride]) > tolerance) { quiet = 0; break; }
      }
      calm[y] = quiet;
    }
    const clear = y => {
      for (let row = y - radius; row <= y + radius; row++) if (row < 1 || row >= height || !calm[row]) return false;
      return true;
    };
    const start = Math.max(0, Math.min(height - 1, Math.round(preferred)));
    for (let distance = 0; start - distance >= 0 || start + distance < height; distance++) {
      if (start - distance >= 0 && clear(start - distance)) return start - distance;
      if (distance && start + distance < height && clear(start + distance)) return start + distance;
    }
    return null;
  }

  // Dimensions from a baseline or progressive JPEG's frame header.
  function jpegInfo(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error("The PDF page image is not a JPEG.");
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes[offset + 2] << 8 | bytes[offset + 3];
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (offset + 9 >= bytes.length) break;
        const precision = bytes[offset + 4], height = bytes[offset + 5] << 8 | bytes[offset + 6],
          width = bytes[offset + 7] << 8 | bytes[offset + 8], components = bytes[offset + 9];
        if (marker > 0xc2 || precision !== 8 || !width || !height || ![1, 3].includes(components)) throw Error("The PDF page image uses an unsupported JPEG format.");
        return { width, height, components };
      }
      offset += 2 + length;
    }
    throw Error("The PDF page image size could not be read.");
  }

  // UTF-16BE with a byte order mark: any title, no escaping.
  function textString(value) {
    let hex = "FEFF";
    for (let index = 0; index < value.length; index++) hex += value.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
    return `<${hex}>`;
  }
  function pdfDate(date) {
    const pad = value => String(value).padStart(2, "0");
    return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }

  // PDF bytes as Blob parts. pages: [{ width, height (points), image:{ data
  // (JPEG Uint8Array or Blob), width, height, components } }]. Objects: 1
  // catalog, 2 page tree, 3 info, then page, contents and image per page.
  function documentParts(pages, options = {}) {
    if (!Array.isArray(pages) || !pages.length || pages.length > 1000) throw RangeError("A PDF needs between 1 and 1000 pages.");
    const encoder = new TextEncoder(), parts = [], offsets = [];
    let length = 0;
    const add = part => { parts.push(part); length += byteLength(part); },
      text = value => add(encoder.encode(value)),
      object = (id, body) => { offsets[id] = length; text(`${id} 0 obj\n${body}\nendobj\n`); },
      stream = (id, dictionary, data) => {
        offsets[id] = length;
        text(`${id} 0 obj\n<< ${dictionary ? `${dictionary} ` : ""}/Length ${byteLength(data)} >>\nstream\n`);
        add(data);
        text("\nendstream\nendobj\n");
      };
    const title = typeof options.title === "string" ? options.title.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200) : "",
      created = options.created instanceof Date && Number.isFinite(options.created.getTime()) ? options.created : new Date();
    for (const [index, page] of pages.entries()) {
      const image = page?.image, data = image?.data;
      if (![page?.width, page?.height].every(value => Number.isFinite(value) && value >= 1 && value <= MAX_PAGE_POINTS)) throw RangeError(`PDF page ${index + 1} has an invalid size.`);
      if (![image?.width, image?.height].every(value => Number.isInteger(value) && value > 0 && value <= 65535) || ![1, 3].includes(image.components)
        || !data || !(byteLength(data) > 0)) throw TypeError(`PDF page ${index + 1} has an invalid image.`);
      if (data instanceof Uint8Array) {
        const info = jpegInfo(data);
        if (info.width !== image.width || info.height !== image.height || info.components !== image.components) throw TypeError(`PDF page ${index + 1} image does not match its JPEG data.`);
      }
    }
    add(Uint8Array.from(HEADER));
    object(1, `<< /Type /Catalog /Pages 2 0 R${title ? " /ViewerPreferences << /DisplayDocTitle true >>" : ""} >>`);
    object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`);
    object(3, `<< /Producer (PenEcho)${title ? ` /Title ${textString(title)}` : ""} /CreationDate (${pdfDate(created)}) >>`);
    pages.forEach((page, index) => {
      const id = 4 + index * 3, name = `/Im${index + 1}`, size = `${pdfNumber(page.width)} ${pdfNumber(page.height)}`;
      object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size}] /Resources << /XObject << ${name} ${id + 2} 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents ${id + 1} 0 R >>`);
      stream(id + 1, "", encoder.encode(`q\n${pdfNumber(page.width)} 0 0 ${pdfNumber(page.height)} 0 0 cm\n${name} Do\nQ\n`));
      stream(id + 2, `/Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} /ColorSpace /${page.image.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`, page.image.data);
    });
    const size = 4 + pages.length * 3, xref = length;
    // Each cross-reference entry is exactly 20 bytes.
    text(`xref\n0 ${size}\n0000000000 65535 f\r\n${offsets.slice(1, size).map(offset => `${String(offset).padStart(10, "0")} 00000 n\r\n`).join("")}`
      + `trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return parts;
  }
  function documentBytes(pages, options = {}) {
    const parts = documentParts(pages, options);
    if (!parts.every(part => part instanceof Uint8Array)) throw TypeError("Blob page images need documentParts().");
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  }

  function encodeJpeg(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob?.type === "image/jpeg" ? resolve(blob) : reject(Error("This browser could not encode a PDF page.")), "image/jpeg", quality));
  }
  // Finds quiet rows on a reduced copy of the band being searched.
  function bandBreaker(source, width, document) {
    return (preferred, low, high) => {
      const rows = high - low + 1;
      if (rows < 8) return null;
      const bandWidth = Math.min(width, 1600), bandHeight = Math.min(rows, 1200), canvas = document.createElement("canvas");
      canvas.width = bandWidth;
      canvas.height = bandHeight;
      try {
        const context = canvas.getContext("2d", { willReadFrequently:true });
        context.fillStyle = "#fff";
        context.fillRect(0, 0, bandWidth, bandHeight);
        context.drawImage(source, 0, low, width, rows, 0, 0, bandWidth, bandHeight);
        const row = quietRow(context.getImageData(0, 0, bandWidth, bandHeight).data, bandWidth, bandHeight, (preferred - low) * bandHeight / rows);
        return row === null ? null : low + Math.round(row * rows / bandHeight);
      } catch {
        return null;
      } finally {
        canvas.width = canvas.height = 1;
      }
    };
  }
  // A rendered image or canvas as a PDF Blob. options: pointsPerPixel (natural
  // size), title, opaque (a fully painted canvas may be encoded directly).
  async function fromImage(source, options = {}) {
    const document = options.document || globalThis.document,
      width = source?.naturalWidth || source?.width, height = source?.naturalHeight || source?.height,
      quality = positive(options.quality, JPEG_QUALITY),
      plan = planPages(width, height, { ...options, breakAt:options.breakAt === undefined ? bandBreaker(source, Math.round(width), document) : options.breakAt }),
      pages = [];
    for (const page of plan.pages) {
      let blob;
      if (options.opaque === true && plan.pages.length === 1 && page.width === width && page.height === height && typeof source.toBlob === "function") blob = await encodeJpeg(source, quality);
      else {
        const canvas = document.createElement("canvas");
        canvas.width = page.width;
        canvas.height = page.height;
        try {
          const context = canvas.getContext("2d");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, page.width, page.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(source, page.sx, page.sy, page.sw, page.sh, 0, 0, page.width, page.height);
          blob = await encodeJpeg(canvas, quality);
        } finally {
          canvas.width = canvas.height = 1;
        }
      }
      let info;
      try { info = jpegInfo(new Uint8Array(await blob.slice(0, 65536).arrayBuffer())); }
      catch { info = jpegInfo(new Uint8Array(await blob.arrayBuffer())); }
      if (info.width !== page.width || info.height !== page.height) throw Error("A PDF page image has an unexpected size.");
      pages.push({ width:page.pageWidth, height:page.pageHeight, image:{ data:blob, ...info } });
    }
    return new Blob(documentParts(pages, { title:options.title }), { type:"application/pdf" });
  }
  function saveFile(blob, name, document = globalThis.document) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url;
    link.download = name;
    try {
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
  function filename(title, fallback = "penecho") {
    const name = String(title || "")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
      .replace(/[.\s]+$/g, "")
      .trim()
      .slice(0, 120);
    return `${name || fallback}.pdf`;
  }

  return Object.freeze({
    MAX_PAGES, MAX_TOTAL_PIXELS, POINTS_PER_CSS_PIXEL,
    planPages, quietRow, jpegInfo, documentParts, documentBytes, fromImage, save:saveFile, filename,
  });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoPdf;
