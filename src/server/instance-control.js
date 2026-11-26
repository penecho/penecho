const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** Check whether a process ID currently exists. */
function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Check whether a remote socket address is local loopback. */
function isLoopbackAddress(address) {
  const value = String(address || "");
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

/** Constant-time string comparison for control tokens. */
function tokensMatch(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string" || !expected || !actual) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Return the directory storing running server instance descriptors. */
function serversDirectory(stateDir) {
  return path.join(stateDir, "servers");
}

/** Atomically write a server instance file with owner-only permissions. */
function writePrivateJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

/** Read and parse a JSON file, returning null on any failure. */
function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Send a JSON HTTP response for local instance control requests. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * List currently alive registered PenEcho server records under stateDir.
 * Stale records for exited PIDs are removed best-effort.
 */
function listRegisteredServers(stateDir) {
  if (!stateDir) return [];
  const dir = serversDirectory(stateDir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const servers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dir, entry.name);
    const data = readJsonSafe(filePath);
    if (!data || !Number.isInteger(Number(data.port)) || !isPidAlive(data.pid)) {
      try { fs.unlinkSync(filePath); } catch {}
      continue;
    }
    servers.push({ ...data, filePath });
  }
  servers.sort((a, b) => Number(a.port) - Number(b.port));
  return servers;
}

/**
 * Read persisted active project-line runs that still have a live child PID.
 * Used as a fallback guard if no live control server answered.
 */
function readActiveRunsFallback(stateDir) {
  if (!stateDir) return [];
  const activeFile = path.join(stateDir, "project-lines", "active-runs.json");
  const rows = readJsonSafe(activeFile);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && isPidAlive(row.pid))
    .map((row) => ({
      kind: "project-line",
      key: String(row.key || ""),
      stepId: String(row.stepId || ""),
      agent: String(row.agent || ""),
      sessionId: String(row.sessionId || ""),
      pid: Number(row.pid),
      started: Number(row.started) || 0,
    }));
}

/**
 * Create HTTP control routes and lifecycle registry for a PenEcho server instance.
 */
function createInstanceControl(options = {}) {
  const {
    host = "127.0.0.1",
    stateDir = "",
    configFile = null,
    argv = [],
    packageRoot = "",
    execPath = process.execPath,
    entry = "",
    appPid = null,
    getRunningJobs = () => [],
    onShutdown = () => {},
    enabled = true,
  } = options;

  let listeningPort = null;
  let token = crypto.randomBytes(24).toString("hex");
  let registeredFile = null;
  let shuttingDown = false;

  const register = (port) => {
    listeningPort = Number(port) || null;
    if (!enabled || !stateDir || !listeningPort) return null;
    token = crypto.randomBytes(24).toString("hex");
    const filePath = path.join(serversDirectory(stateDir), `${listeningPort}.json`);
    const record = {
      pid: process.pid,
      // The desktop app this server belongs to: it ends and starts with it.
      ...(appPid ? { appPid } : {}),
      port: listeningPort,
      host,
      token,
      startedAt: Date.now(),
      cwd: process.cwd(),
      packageRoot,
      execPath,
      entry,
      argv: Array.isArray(argv) ? argv.map(String) : [],
      configFile: configFile || null,
      // This PenEcho decides who runs the Lines by their runtime socket, not by this record (project-lines/runtime-owner.js).
      linesSocket: true,
    };
    writePrivateJson(filePath, record);
    registeredFile = filePath;
    return record;
  };

  const unregister = () => {
    if (!registeredFile) return;
    const target = registeredFile;
    registeredFile = null;
    const current = readJsonSafe(target);
    if (current && Number(current.pid) === process.pid && current.token === token) {
      try { fs.unlinkSync(target); } catch {}
    }
  };

  const readRunning = () => {
    const items = getRunningJobs();
    return Array.isArray(items) ? items : [];
  };

  const handle = async (req, res, url) => {
    const pathname = url?.pathname || "";
    if (pathname !== "/api/server/running-jobs" && pathname !== "/api/server/shutdown") return false;
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: "Server control is only available on loopback." });
      return true;
    }
    const headerToken = req.headers?.["x-penecho-control-token"];
    if (!tokensMatch(token, Array.isArray(headerToken) ? headerToken[0] : headerToken)) {
      sendJson(res, 401, { ok: false, error: "Invalid server control token." });
      return true;
    }

    if (pathname === "/api/server/running-jobs") {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "Method not allowed." });
        return true;
      }
      sendJson(res, 200, { ok: true, pid: process.pid, port: listeningPort, running: readRunning() });
      return true;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed." });
      return true;
    }

    const running = readRunning();
    if (running.length > 0) {
      sendJson(res, 409, {
        ok: false,
        code: "JOBS_RUNNING",
        error: "PenEcho has jobs still running and cannot restart right now.",
        running,
      });
      return true;
    }

    if (shuttingDown) {
      sendJson(res, 200, { ok: true, pid: process.pid, port: listeningPort, shuttingDown: true });
      return true;
    }
    shuttingDown = true;

    let triggered = false;
    const triggerShutdown = () => {
      if (triggered) return;
      triggered = true;
      unregister();
      onShutdown();
    };
    res.once("finish", triggerShutdown);
    sendJson(res, 200, { ok: true, pid: process.pid, port: listeningPort, shuttingDown: true });
    setTimeout(triggerShutdown, 50).unref?.();
    return true;
  };

  return {
    register,
    unregister,
    handle,
    getToken: () => token,
    getPort: () => listeningPort,
  };
}

module.exports = {
  isPidAlive,
  isLoopbackAddress,
  serversDirectory,
  listRegisteredServers,
  readActiveRunsFallback,
  createInstanceControl,
};
