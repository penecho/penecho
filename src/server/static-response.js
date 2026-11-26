"use strict";
const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib"), { promisify } = require("node:util");
const gzip = promisify(zlib.gzip);
const textAsset = /\.(?:html|js|css|svg|json|md)$/i;
// A page's own scripts and styles. What is already kept for good (MathJax), made per request (/api/) or elsewhere keeps its address.
const pageAsset = /(<(?:script|link)\b[^>]*?\s(?:src|href)=")((?!\/|vendor\/mathjax)[^":?#]+\.(?:js|css))(?=")/g;

function acceptsGzip(header) {
  const encodings = new Map(String(header || "").toLowerCase().split(",").map(part => {
    const [name, ...parameters] = part.trim().split(";");
    const quality = parameters.find(value => value.trim().startsWith("q="));
    return [name.trim(), quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (encodings.has("gzip") ? encodings.get("gzip") : encodings.get("*")) > 0;
}

// Room for every page's files at once. The Canvas and the Projects pages together are about ninety files; with room for fewer,
// going from one page to the other threw the first one's files out, and they were read, packed and hashed again on the way back.
function createStaticResponder({ maxEntries = 400, maxBytes = 96 * 1024 * 1024 } = {}) {
  const cache = new Map();
  let cacheBytes = 0;
  const remove = file => { const entry = cache.get(file); if (entry) cacheBytes -= entry.cost || 0; cache.delete(file); };
  async function representation(file, stat) {
    const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
    let entry = cache.get(file);
    if (entry?.signature === signature) { cache.delete(file); cache.set(file, entry); return entry.promise; }
    remove(file);
    entry = { signature, cost:0 };
    entry.promise = (async () => {
      const chunks=[];
      for await (const chunk of fs.createReadStream(file)) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      // Compression is optional: an encoder failure still returns the original
      // bytes at the original URL. Do not alter SRI or any resource contents.
      let compressed;
      if (bytes.length >= 1024) try { compressed = await gzip(bytes); } catch {}
      if (compressed?.length >= bytes.length) compressed = null;
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      const value = { bytes, compressed, hash, etag:`W/"${hash}"` };
      if (cache.get(file) === entry) {
        entry.cost = bytes.length + (compressed?.length || 0); cacheBytes += entry.cost;
        while (cache.size > maxEntries || cacheBytes > maxBytes) remove(cache.keys().next().value);
      }
      return value;
    })().catch(error => { if (cache.get(file) === entry) remove(file); throw error; });
    cache.set(file, entry);
    return entry.promise;
  }
  const hashes = new Map(), pages = new Map();
  async function hashOf(file) {
    const stat = await fsp.stat(file), signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
    let entry = hashes.get(file);
    if (entry?.signature !== signature) {
      entry = { signature, hash:fsp.readFile(file).then(bytes => crypto.createHash("sha256").update(bytes).digest("hex")) };
      entry.hash.catch(() => { if (hashes.get(file) === entry) hashes.delete(file); });
      hashes.set(file, entry);
    }
    return entry.hash;
  }
  // The page with each of its scripts and styles under its content's address (?v=<hash>), so a browser that has them asks for none of them
  // again, and asks at once for one that has changed. The page itself is always asked for.
  async function pageOf(file) {
    const html = await fsp.readFile(file, "utf8"), root = path.dirname(file), assets = [...new Set([...html.matchAll(pageAsset)].map(match => match[2]))];
    const found = new Map(await Promise.all(assets.map(async asset => [asset, await hashOf(path.join(root, asset)).catch(() => "")])));
    const signature = crypto.createHash("sha256").update(html).update(JSON.stringify([...found])).digest("hex");
    let entry = pages.get(file);
    if (entry?.signature !== signature) {
      const bytes = Buffer.from(html.replace(pageAsset, (match, before, asset) => found.get(asset) ? `${before}${asset}?v=${found.get(asset).slice(0, 10)}` : match));
      entry = { signature, bytes, compressed:gzip(bytes).catch(() => null) };
      pages.set(file, entry);
    }
    return entry;
  }
  return async function sendStatic(req, res, file, headers, options = {}) {
    if (options.page) {
      const page = await pageOf(file), packed = acceptsGzip(req.headers["accept-encoding"]) ? await page.compressed : null, bytes = packed || page.bytes;
      res.writeHead(200, { ...headers, Vary:"Accept-Encoding", ...(packed ? { "Content-Encoding":"gzip" } : {}), "Content-Length":bytes.length });
      return res.end(req.method === "HEAD" ? undefined : bytes);
    }
    const stat = await fsp.stat(file);
    if (!textAsset.test(file) || stat.size > 8 * 1024 * 1024) {
      res.writeHead(200, { ...headers, "Content-Length":stat.size });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    }
    const value = await representation(file, stat), responseHeaders = { ...headers, Vary:"Accept-Encoding" };
    // Content-hashed asset URLs (?v=<sha256-prefix>) can be cached immutably because any edit changes the hash.
    if (options.version && /^[a-f0-9]{8,64}$/i.test(options.version) && value.hash.startsWith(options.version.toLowerCase()) && responseHeaders["Cache-Control"] !== "no-store") {
      responseHeaders["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    if (responseHeaders["Cache-Control"] !== "no-store") {
      responseHeaders.ETag = value.etag;
      const matches = String(req.headers["if-none-match"] || "").split(",").some(tag => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === value.etag.replace(/^W\//, ""));
      if (matches) { res.writeHead(304, responseHeaders); return res.end(); }
    }
    const compressed = value.compressed && acceptsGzip(req.headers["accept-encoding"]);
    const bytes = compressed ? value.compressed : value.bytes;
    if (compressed) responseHeaders["Content-Encoding"] = "gzip";
    responseHeaders["Content-Length"] = bytes.length;
    res.writeHead(200, responseHeaders);
    res.end(req.method === "HEAD" ? undefined : bytes);
  };
}
module.exports = { createStaticResponder, acceptsGzip };
