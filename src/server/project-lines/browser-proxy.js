"use strict";
// Per-context authenticated loopback proxy for PenEcho's local browser service.
// Every HTTP, HTTPS (CONNECT), and WebSocket request from a Chromium BrowserContext or Electron
// session traverses this proxy (with proxyBypassList="<-loopback>"), so:
//   - Offline contexts (html / file) cannot emit any network or WebSocket traffic at all.
//   - External hosts are DNS-resolved once, validated via resolvedPublicFetchTarget, and connected
//     directly to the exact vetted IP (eliminating DNS rebinding TOCTOU while keeping TLS SNI/cert checks).
//   - Static `dir` serving happens strictly inside this authenticated proxy (407 to any unauthenticated
//     local client) with open-time symlink/traversal confinement (O_NOFOLLOW + realpath + fstat).
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { resolvedPublicFetchTarget } = require("../public-fetch.js");

const STATIC_HOST = "penecho-static.invalid";
const STATIC_ORIGIN = `http://${STATIC_HOST}`;
const MIME = {
  ".html":"text/html; charset=utf-8",
  ".htm":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".png":"image/png",
  ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg",
  ".gif":"image/gif",
  ".webp":"image/webp",
  ".woff2":"font/woff2",
  ".woff":"font/woff",
  ".txt":"text/plain; charset=utf-8",
  ".ico":"image/x-icon",
};
const HOP_BY_HOP = new Set([
  "proxy-authorization", "proxy-connection", "connection", "keep-alive",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function proxyError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
function inside(child, parent) {
  return Boolean(child && parent) && (child === parent || child.startsWith(parent + path.sep));
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function isNetworkBackedPath(value) {
  const s = String(value || "");
  return /^(\\\\|\/\/)/.test(s);
}
function hostnameOf(url) {
  return String(url.hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
function isLoopbackAddress(hostname) {
  const clean = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(clean)) return true;
  if (/^127\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(clean)) return true;
  return false;
}
function loopbackConnectHost(hostname) {
  const clean = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (clean === "localhost" || clean === "127.0.0.1") return "127.0.0.1";
  if (clean === "::1") return "::1";
  if (clean.startsWith("::ffff:127.")) return clean.slice(7);
  return clean;
}

// Resolves and opens a regular file strictly inside `root` without following symlinks on any path
// component (O_NOFOLLOW on POSIX) and verifies realpath + fstat on the opened descriptor.
function openStaticFile(root, requestPath, entry = "index.html") {
  if (isNetworkBackedPath(root)) throw proxyError("BAD_DIRECTORY", "Network-backed directories are not supported.", 403);
  const realRoot = fs.realpathSync(root);
  let decoded;
  try { decoded = decodeURIComponent(String(requestPath || "/")); } catch { throw proxyError("BAD_PATH", "The URL path is not valid."); }
  if (decoded.includes("\0") || decoded.includes("\\")) throw proxyError("BAD_PATH", "The URL path is not valid.");
  const parts = decoded.split("/");
  if (parts.some(part => part === ".." || part === ".")) throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
  if (decoded.endsWith("/")) parts.push(...(decoded === "/" ? entry.split("/") : ["index.html"]));
  const segments = parts.filter(Boolean);
  if (!segments.length || segments.some(part => !part || part === ".." || part === ".")) throw proxyError("BAD_PATH", "The URL path is not valid.");

  const candidate = path.resolve(realRoot, ...segments);
  if (!inside(candidate, realRoot)) throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);

  // Verify no intermediate segment is a symlink before opening leaf with O_NOFOLLOW.
  let current = realRoot;
  for (let i = 0; i < segments.length - 1; i++) {
    current = path.join(current, segments[i]);
    let lst;
    try { lst = fs.lstatSync(current); } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw proxyError("NOT_FOUND", "Static file not found.", 404);
      throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
    }
    if (lst.isSymbolicLink() || !lst.isDirectory()) throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
  }

  let realTarget;
  try { realTarget = fs.realpathSync(candidate); } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw proxyError("NOT_FOUND", "Static file not found.", 404);
    throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
  }
  if (!inside(realTarget, realRoot)) throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  let preStat;
  try { preStat = fs.lstatSync(candidate); } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw proxyError("NOT_FOUND", "Static file not found.", 404);
    throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
  }
  if (preStat.isSymbolicLink() || !preStat.isFile()) {
    throw proxyError(preStat.isSymbolicLink() ? "PATH_ESCAPE" : "NOT_FOUND", preStat.isSymbolicLink() ? "Symlinks outside the static directory are not allowed." : "Static file not found.", preStat.isSymbolicLink() ? 403 : 404);
  }
  let fd;
  try {
    fd = fs.openSync(candidate, flags);
  } catch (err) {
    if (err?.code === "ELOOP" || err?.code === "EMLINK") throw proxyError("PATH_ESCAPE", "Symlinks outside the static directory are not allowed.", 403);
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw proxyError("NOT_FOUND", "Static file not found.", 404);
    throw proxyError("BAD_PATH", "Could not open static file.", 403);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      fs.closeSync(fd);
      throw proxyError("NOT_FOUND", "Static file not found.", 404);
    }
    // Re-check resolved path and verify the opened descriptor matches the exact verified inode/device.
    const verified = fs.realpathSync(candidate);
    const postStat = fs.lstatSync(verified);
    if (!inside(verified, realRoot) || stat.dev !== postStat.dev || stat.ino !== postStat.ino || stat.dev !== preStat.dev || stat.ino !== preStat.ino) {
      fs.closeSync(fd);
      throw proxyError("PATH_ESCAPE", "That path is outside the static directory.", 403);
    }
    return { fd, stat, file:verified };
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* Already closed. */ }
    throw err;
  }
}

// Validates a static path without leaking an open fd (exported for unit tests).
function staticFile(root, requestPath, entry = "index.html") {
  const opened = openStaticFile(root, requestPath, entry);
  try { fs.closeSync(opened.fd); } catch { /* Ignore. */ }
  return opened.file;
}

// Resolves a network destination according to the context's mode and returns a pinned IP + port,
// or null when the policy blocks the destination.
async function resolveNetworkDestination({ mode, offline = false, allowExternal = false, urlString = "", host = "", port = 0, isConnect = false, protocol = "" }) {
  if (mode === "html" || mode === "file") return null;

  let targetUrl = null;
  if (urlString) {
    try { targetUrl = new URL(urlString); } catch { return null; }
    if (targetUrl.username || targetUrl.password) return null;
    if (!["http:", "https:"].includes(targetUrl.protocol)) return null;
    host = hostnameOf(targetUrl);
    port = Number(targetUrl.port) || (targetUrl.protocol === "https:" ? 443 : 80);
    protocol = targetUrl.protocol;
  } else {
    host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    port = Number(port);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  }

  if (mode === "dir") {
    if (!isConnect && protocol === "http:" && host === STATIC_HOST && port === 80) {
      return { kind:"static" };
    }
    if (!allowExternal) return null;
    const probeProtocol = isConnect ? "https:" : (protocol || "http:");
    if (isConnect && port !== 443) return null;
    try {
      const vetted = await resolvedPublicFetchTarget(`${probeProtocol}//${host.includes(":") ? `[${host}]` : host}:${port}/`, { allowHttp:!isConnect });
      return { kind:"pinned", address:vetted.address, family:vetted.family, port, host };
    } catch { return null; }
  }

  if (mode === "loopback") {
    if (isLoopbackAddress(host)) {
      return { kind:"loopback", address:loopbackConnectHost(host), port, host };
    }
    if (offline) return null;
    // Loopback apps may fetch public HTTPS assets/CDNs (CONNECT on 443), never plain external HTTP or private IPs.
    if (!isConnect || port !== 443) return null;
    try {
      const vetted = await resolvedPublicFetchTarget(`https://${host.includes(":") ? `[${host}]` : host}:${port}/`, { allowHttp:false });
      return { kind:"pinned", address:vetted.address, family:vetted.family, port, host };
    } catch { return null; }
  }

  if (mode === "external") {
    if (offline) return null;
    const probeProtocol = isConnect ? "https:" : (protocol || "http:");
    if (isConnect && ![443, 80].includes(port)) return null;
    try {
      const vetted = await resolvedPublicFetchTarget(`${probeProtocol}//${host.includes(":") ? `[${host}]` : host}:${port}/`, { allowHttp:true });
      return { kind:"pinned", address:vetted.address, family:vetted.family, port, host };
    } catch { return null; }
  }

  return null;
}

function parseConnectAuthority(authority) {
  const raw = String(authority || "").trim();
  if (!raw || raw.includes("/") || raw.includes("@") || raw.includes(" ")) return null;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0 || raw[close + 1] !== ":") return null;
    const host = raw.slice(1, close), port = Number(raw.slice(close + 2));
    return host && Number.isInteger(port) && port > 0 && port <= 65535 ? { host, port } : null;
  }
  const colon = raw.lastIndexOf(":");
  if (colon <= 0) return null;
  const host = raw.slice(0, colon), port = Number(raw.slice(colon + 1));
  return host && !host.includes(":") && Number.isInteger(port) && port > 0 && port <= 65535 ? { host, port } : null;
}

async function createContextProxy({ mode, source = null, offline = false, allowExternal = false, onBlocked = null }) {
  const username = "penecho";
  const password = crypto.randomBytes(24).toString("hex");
  const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sockets = new Set();
  const upstreams = new Set();
  let closed = false;

  const isAuthed = req => sameSecret(req.headers["proxy-authorization"], expectedAuth);
  const trackSocket = sock => {
    if (!sock || sock.destroyed || sockets.has(sock)) return;
    sockets.add(sock);
    sock.once("close", () => sockets.delete(sock));
  };

  const server = http.createServer(async (req, res) => {
    trackSocket(req.socket);
    if (!isAuthed(req)) {
      res.writeHead(407, { "proxy-authenticate":"Basic realm=\"penecho\"", "content-length":"0", connection:"close" });
      res.end();
      return;
    }
    const rawUrl = String(req.url || "");
    // Relative paths without scheme cannot be valid forward-proxy requests.
    if (!/^https?:\/\//i.test(rawUrl)) {
      res.writeHead(403, { "content-type":"text/plain; charset=utf-8", "cache-control":"no-store" });
      res.end("Blocked by PenEcho browser policy");
      return;
    }
    const dest = await resolveNetworkDestination({ mode, offline, allowExternal, urlString:rawUrl, isConnect:false });
    if (!dest) {
      try { onBlocked?.(rawUrl); } catch { /* Best-effort reporting. */ }
      res.writeHead(403, { "content-type":"text/plain; charset=utf-8", "cache-control":"no-store" });
      res.end("Blocked by PenEcho browser policy");
      return;
    }
    if (dest.kind === "static") {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { allow:"GET, HEAD", "cache-control":"no-store" });
        res.end();
        return;
      }
      try {
        const parsed = new URL(rawUrl);
        const opened = openStaticFile(source.root, parsed.pathname, source.entry);
        res.writeHead(200, {
          "content-type":MIME[path.extname(opened.file).toLowerCase()] || "application/octet-stream",
          "content-length":opened.stat.size,
          "cache-control":"no-store",
          "x-content-type-options":"nosniff",
        });
        if (req.method === "HEAD") {
          try { fs.closeSync(opened.fd); } catch { /* Ignore. */ }
          res.end();
          return;
        }
        const stream = fs.createReadStream(null, { fd:opened.fd, autoClose:true });
        stream.on("error", () => { if (!res.destroyed) res.destroy(); });
        res.on("close", () => { if (!stream.destroyed) stream.destroy(); });
        stream.pipe(res);
      } catch (error) {
        res.writeHead(error.status || 400, { "content-type":"text/plain; charset=utf-8", "cache-control":"no-store" });
        res.end(error.message || "Bad request");
      }
      return;
    }

    // Forward HTTP request directly to the pinned IP address (zero DNS rebinding).
    let parsed;
    try { parsed = new URL(rawUrl); } catch {
      res.writeHead(400, { "content-type":"text/plain" }); res.end("Bad URL"); return;
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    headers.host = parsed.host;
    headers.connection = "close";
    const upstream = http.request({
      host:dest.address,
      port:dest.port,
      family:dest.family,
      method:req.method,
      path:`${parsed.pathname}${parsed.search}`,
      headers,
      timeout:25000,
    }, upRes => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
      }
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
    });
    upstreams.add(upstream);
    upstream.once("close", () => upstreams.delete(upstream));
    upstream.on("timeout", () => upstream.destroy(new Error("Upstream timed out")));
    upstream.on("error", () => {
      if (!res.headersSent) { res.writeHead(502, { "content-type":"text/plain" }); res.end("Bad Gateway"); }
      else if (!res.destroyed) res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("connect", async (req, clientSocket, head) => {
    trackSocket(clientSocket);
    clientSocket.on("error", () => {});
    if (!isAuthed(req)) {
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"penecho\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const target = parseConnectAuthority(req.url);
    if (!target) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const dest = await resolveNetworkDestination({ mode, offline, allowExternal, host:target.host, port:target.port, isConnect:true });
    if (!dest || dest.kind === "static") {
      try { onBlocked?.(`https://${req.url}`); } catch { /* Best-effort reporting. */ }
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host:dest.address, port:dest.port, ...(dest.family ? { family:dest.family } : {}) });
    trackSocket(upstream);
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.once("connect", () => {
      if (closed || clientSocket.destroyed) { upstream.destroy(); return; }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    clientSocket.on("close", () => { if (!upstream.destroyed) upstream.destroy(); });
    upstream.on("close", () => { if (!clientSocket.destroyed) clientSocket.destroy(); });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    port,
    origin:`http://127.0.0.1:${port}`,
    proxyServer:`http://127.0.0.1:${port}`,
    proxyBypassList:"<-loopback>",
    staticOrigin:STATIC_ORIGIN,
    username,
    password,
    async close() {
      if (closed) return;
      closed = true;
      for (const req of upstreams) { try { req.destroy(); } catch { /* Ignore. */ } }
      upstreams.clear();
      for (const sock of sockets) { try { sock.destroy(); } catch { /* Ignore. */ } }
      sockets.clear();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    },
  };
}

module.exports = {
  STATIC_HOST,
  STATIC_ORIGIN,
  isNetworkBackedPath,
  isLoopbackAddress,
  openStaticFile,
  staticFile,
  resolveNetworkDestination,
  createContextProxy,
};
