"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { managedCliPath } = require("../../providers/cli-installer.js");

// The newest version of each agent, as its own updater would install it. It is asked for in the background at most once in a day and a half,
// with plain web requests and no command, and kept in a file: a page shows what was last learned at once, and a later visit shows what a
// check found. A check that fails says nothing to anyone, keeps what was known, and is tried again some hours later.
const EVERY_MS = 36 * 60 * 60 * 1000;
const RETRY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
const REGISTRIES = ["https://registry.npmjs.org", "https://registry.npmmirror.com"];
// The package and the tag each one takes. Kimi Code publishes no version to ask for, and Antigravity updates itself.
const SOURCES = Object.freeze({
  claude:{ provider:"claude-cli", pkg:"@anthropic-ai/claude-code", tag:"latest" },
  codex:{ provider:"codex-cli", pkg:"@openai/codex", tag:"latest" },
  opencode:{ provider:"opencode-cli", pkg:"@opencode/cli", tag:"latest" },
  pi:{ provider:"pi-cli", pkg:"@earendil-works/pi-coding-agent", tag:"latest" },
  omp:{ provider:"omp-cli", pkg:"@oh-my-pi/pi-coding-agent", tag:"latest" },
  dsh:{ provider:"dsh-cli", pkg:"@deepseek-ai/dsh", tag:"latest" },
});

// Claude Code's updater follows the channel its settings name: the newest release, or stable, which PenEcho's installer sets.
function claudeTag(env = process.env) {
  try {
    const folder = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".claude");
    return JSON.parse(fs.readFileSync(path.join(folder, "settings.json"), "utf8")).autoUpdatesChannel === "stable" ? "stable" : "latest";
  } catch { return "latest"; }
}

const VERSION = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
function parseVersion(text) {
  const found = VERSION.exec(String(text || ""));
  return found ? { numbers:[+found[1], +found[2], +found[3]], pre:found[4] ? found[4].split(".") : [], text:found[0] } : null;
}
// Above zero when `a` is the newer one. A version with a suffix (-rc.1) comes before the same one without.
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] - y.numbers[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// Whether PenEcho's own installer updates the command PenEcho runs: it is the file the installer writes, and not a script someone put there.
// A command inside an app comes with the app, so it is updated there and nothing is offered here.
function installKind(id, command, { home, stateDir = home, platform = process.platform, env } = {}) {
  const file = String(command || "");
  if (!SOURCES[id] || !path.isAbsolute(file)) return "";
  if (/\.app[\\/]Contents[\\/]|[\\/]WindowsApps[\\/]|[\\/]deepseek-harness[\\/]/i.test(file)) return "app";
  // An installed Codex is left as it is by the installer, so its update goes through an agent.
  if (id === "codex" || !home) return "own";
  try {
    const managed = managedCliPath(SOURCES[id].provider, { platform, home, stateDir, env });
    const same = platform === "win32" ? managed.toLowerCase() === path.resolve(file).toLowerCase() : managed === path.resolve(file);
    if (!same) return "own";
    if (fs.lstatSync(file).isSymbolicLink()) return "managed";
    const head = Buffer.alloc(2), fd = fs.openSync(file, "r");
    try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
    // A text script in a shared folder is the person's own wrapper around a copy kept elsewhere.
    return head.toString("latin1") === "#!" && path.dirname(managed) === path.join(home, ".local", "bin") ? "own" : "managed";
  } catch { return "own"; }
}

function createAgentUpdates({ file, fetchImpl = globalThis.fetch, claudeChannel = claudeTag, now = Date.now, every = EVERY_MS, retry = RETRY_MS, timeout = TIMEOUT_MS } = {}) {
  let state = null, running = null;
  function load() {
    if (state) return state;
    state = { checkedAt:0, triedAt:0, latest:{}, failed:{} };
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      state.checkedAt = Number(saved.checkedAt) || 0;
      state.triedAt = Number(saved.triedAt) || 0;
      for (const [id, f] of Object.entries(saved.failed || {})) if (SOURCES[id] && f && parseVersion(f.version)) state.failed[id] = { version:String(f.version).slice(0, 60), said:String(f.said || "").slice(0, 1200) };
      for (const [id, version] of Object.entries(saved.latest || {})) if (SOURCES[id] && parseVersion(version)) state.latest[id] = String(version).slice(0, 60);
    } catch { /* Nothing learned yet. */ }
    return state;
  }
  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive:true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state));
      fs.renameSync(temp, file);
    } catch { /* Kept in memory until the next check. */ }
  }
  async function ask(source, tag) {
    for (const registry of REGISTRIES) {
      try {
        const answer = await fetchImpl(`${registry}/-/package/${source.pkg}/dist-tags`, { headers:{ accept:"application/json" }, redirect:"follow", signal:AbortSignal.timeout(timeout) });
        if (!answer.ok) continue;
        const version = (await answer.json())?.[tag];
        if (typeof version === "string" && parseVersion(version)) return version.slice(0, 60);
      } catch { /* The next registry is asked. */ }
    }
    return "";
  }
  // Starts a check when one is due and returns at once. The promise is for tests; it never rejects.
  function refreshIfDue() {
    const current = load(), at = now();
    if (running) return running;
    if (typeof fetchImpl !== "function" || at - current.checkedAt < every || at - current.triedAt < retry) return Promise.resolve(false);
    current.triedAt = at;
    save();
    running = Promise.all(Object.entries(SOURCES).map(async ([id, source]) => [id, await ask(source, id === "claude" ? claudeChannel() : source.tag)])).then(found => {
      const learned = found.filter(([, version]) => version);
      for (const [id, version] of learned) current.latest[id] = version;
      // With no answer at all the computer is offline, and the check is tried again later.
      if (learned.length) current.checkedAt = now();
      save();
      return Boolean(learned.length);
    }).catch(() => false).finally(() => { running = null; });
    return running;
  }
  // The newer version of an agent, when one is known.
  function newer(id, version) {
    const latest = load().latest[id];
    return latest && parseVersion(version) && compareVersions(latest, version) > 0 ? latest : "";
  }
  // The update to this version that did not work.
  function failed(id, version) {
    const f = load().failed[id];
    return f && f.version === version ? f : null;
  }
  function setFailed(id, version, said) {
    if (said === null) delete load().failed[id]; else load().failed[id] = { version, said:String(said).slice(0, 1200) };
    save();
  }
  return { refreshIfDue, newer, failed, setFailed };
}

module.exports = { createAgentUpdates, claudeTag, compareVersions, installKind, SOURCES };
