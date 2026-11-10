"use strict";
const fs = require("node:fs"), fsp = require("node:fs/promises"), crypto = require("node:crypto"), zlib = require("node:zlib"), { promisify } = require("node:util");
const gzip = promisify(zlib.gzip);
const textAsset = /\.(?:html|js|css|svg|json|md)$/i;

function acceptsGzip(header) {
  const encodings = new Map(String(header || "").toLowerCase().split(",").map(part => {
    const [name, ...parameters] = part.trim().split(";");
    const quality = parameters.find(value => value.trim().startsWith("q="));
    return [name.trim(), quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (encodings.has("gzip") ? encodings.get("gzip") : encodings.get("*")) > 0;
}

function createStaticResponder({ maxEntries = 32, maxBytes = 32 * 1024 * 1024 } = {}) {
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
      const value = { bytes, compressed, etag:`W/"${crypto.createHash("sha256").update(bytes).digest("hex")}"` };
      if (cache.get(file) === entry) {
        entry.cost = bytes.length + (compressed?.length || 0); cacheBytes += entry.cost;
        while (cache.size > maxEntries || cacheBytes > maxBytes) remove(cache.keys().next().value);
      }
      return value;
    })().catch(error => { if (cache.get(file) === entry) remove(file); throw error; });
    cache.set(file, entry);
    return entry.promise;
  }
  return async function sendStatic(req, res, file, headers) {
    const stat = await fsp.stat(file);
    if (!textAsset.test(file) || stat.size > 8 * 1024 * 1024) {
      res.writeHead(200, { ...headers, "Content-Length":stat.size });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    }
    const value = await representation(file, stat), responseHeaders = { ...headers, Vary:"Accept-Encoding" };
    if (headers["Cache-Control"] !== "no-store") {
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
