"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Who may open this PenEcho from another device (F5). The computer that runs PenEcho is never asked; this is only about the others.
// Kept in the state folder, in a file only this user can read:
//   on       other devices on the local network may open PenEcho (default on: tablets are a main way to use it)
//   askCode  they need the code (default on); off is "Without a code"
//   code     six digits, made with the system's random source the first time; kept as it is, since Settings shows it again
//   devices  remembered devices: the hash of a random token each holds in a cookie, when it was made and last seen
//   wrong    wrong codes typed since the code was made (MOST_WRONG locks typing it)
// PENECHO_ACCESS_CODE sets the code for a server with no screen. One-time QR keys live in memory only.

const CODE = /^\d{6}$/;
const DEVICE_DAYS = 90, DEVICE_MS = DEVICE_DAYS * 86_400_000, MOST_DEVICES = 200, SEEN_EVERY_MS = 3_600_000;
const KEY_MS = 10 * 60_000, MOST_KEYS = 20;
// Wrong codes in all since the code was made. The code lasts for months, so the limits per five minutes alone would let someone on the
// network try about 8,600 codes a day. After this many, typing the code stops working until New code; the QR key still works.
const MOST_WRONG = 100;
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const newToken = () => crypto.randomBytes(32).toString("base64url");

function createLocalAccess({ stateDirectory, env = process.env, now = Date.now, defaults = {} } = {}) {
  const file = path.join(stateDirectory, "local-access.json"), listeners = new Set();
  const fromEnv = CODE.test(String(env.PENECHO_ACCESS_CODE || "")) ? String(env.PENECHO_ACCESS_CODE) : "";
  let state = null, wrongFromEnv = 0;
  const keys = new Map();

  function write() {
    fs.mkdirSync(stateDirectory, { recursive:true, mode:0o700 });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version:1, ...state }), { mode:0o600 });
    try { fs.chmodSync(temporary, 0o600); } catch { /* Windows keeps its own rights. */ }
    fs.renameSync(temporary, file);
  }
  function load() {
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* First start, or unreadable: made again below. */ }
    const valid = kept && typeof kept === "object" && CODE.test(String(kept.code || ""));
    state = {
      on:valid && typeof kept.on === "boolean" ? kept.on : defaults.on ?? true,
      askCode:valid && typeof kept.askCode === "boolean" ? kept.askCode : defaults.askCode ?? true,
      code:valid ? String(kept.code) : newCode(),
      wrong:valid && Number.isSafeInteger(kept.wrong) && kept.wrong > 0 ? kept.wrong : 0,
      devices:valid && Array.isArray(kept.devices) ? kept.devices.filter(d => d && /^[a-f0-9]{64}$/.test(d.hash) && now() - Number(d.lastSeen || d.createdAt) < DEVICE_MS).slice(-MOST_DEVICES) : [],
    };
    if (!valid || kept.devices?.length !== state.devices.length) write();
    // A file someone else could read is tightened at start.
    try { if (process.platform !== "win32" && (fs.statSync(file).mode & 0o077)) fs.chmodSync(file, 0o600); } catch { /* It was just written. */ }
  }
  load();
  const changed = () => { for (const listener of listeners) { try { listener(view()); } catch { /* A listener's trouble is its own. */ } } };
  const code = () => fromEnv || state.code;
  // A code from PENECHO_ACCESS_CODE cannot be renewed here, so its count of wrong codes starts again when PenEcho starts.
  const wrong = () => (fromEnv ? wrongFromEnv : state.wrong);
  const codeLocked = () => wrong() >= MOST_WRONG;
  function view() {
    return { on:state.on, askCode:state.askCode, code:code(), codeFromEnvironment:Boolean(fromEnv), wrongCodes:wrong(), codeLocked:codeLocked(),
      devices:state.devices.map(d => ({ id:d.hash.slice(0, 12), createdAt:d.createdAt, lastSeen:d.lastSeen })) };
  }
  // A guess compared in constant time. The limits on wrong guesses stay with the caller (main.js), as before.
  function checkCode(guess) {
    const a = Buffer.from(String(guess || "")), b = Buffer.from(code());
    return !codeLocked() && CODE.test(String(guess || "")) && a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  function noteWrong() {
    if (fromEnv) wrongFromEnv++; else { state.wrong++; write(); }
    if (wrong() === MOST_WRONG) changed();
    return codeLocked();
  }
  function update({ on, askCode, newCode:fresh, code:chosen } = {}) {
    if (on !== undefined && typeof on !== "boolean") throw Object.assign(new Error("on is true or false."), { status:400 });
    if (askCode !== undefined && typeof askCode !== "boolean") throw Object.assign(new Error("askCode is true or false."), { status:400 });
    if ((fresh || chosen !== undefined) && fromEnv) throw Object.assign(new Error("The code is set by PENECHO_ACCESS_CODE on this computer."), { status:409, code:"code_from_environment" });
    if (chosen !== undefined && !CODE.test(String(chosen))) throw Object.assign(new Error("Enter a valid six-digit code."), { status:400 });
    if (on !== undefined) state.on = on;
    if (askCode !== undefined) state.askCode = askCode;
    // A new code: every remembered device and every key not used yet is forgotten.
    if (fresh || chosen !== undefined) { state.code = chosen !== undefined ? String(chosen) : newCode(); state.devices = []; state.wrong = 0; keys.clear(); }
    write();
    changed();
    return view();
  }
  // A device that typed the code or scanned a key: its token goes in a cookie, its hash here.
  function remember() {
    const token = newToken(), at = now();
    state.devices = [...state.devices, { hash:hash(token), createdAt:at, lastSeen:at }].slice(-MOST_DEVICES);
    write();
    return { token, maxAgeSeconds:DEVICE_DAYS * 86_400 };
  }
  // { renew } when the cookie should be sent again for another 90 days. null: not a device this PenEcho remembers.
  function recognize(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    const h = hash(token), device = state.devices.find(d => d.hash === h);
    if (!device) return null;
    if (now() - device.lastSeen >= DEVICE_MS) { state.devices = state.devices.filter(d => d !== device); write(); return null; }
    const renew = now() - device.lastSeen >= SEEN_EVERY_MS;
    if (renew) { device.lastSeen = now(); write(); }
    return { renew };
  }
  function forgetDevices() { state.devices = []; keys.clear(); write(); changed(); }
  // The QR's one-time key: works once, for ten minutes.
  function issueKey() {
    for (const [key, entry] of keys) if (entry.expiresAt <= now()) keys.delete(key);
    while (keys.size >= MOST_KEYS) keys.delete(keys.keys().next().value);
    const key = crypto.randomBytes(18).toString("base64url"), expiresAt = now() + KEY_MS;
    keys.set(hash(key), { expiresAt });
    return { key, expiresAt };
  }
  function useKey(key) {
    if (typeof key !== "string" || key.length < 16 || key.length > 64) return false;
    const h = hash(key), entry = keys.get(h);
    keys.delete(h);
    return Boolean(entry && entry.expiresAt > now());
  }
  return {
    on:() => state.on, askCode:() => state.askCode, view, checkCode, noteWrong, codeLocked, update, remember, recognize, forgetDevices, issueKey, useKey,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    file, DEVICE_DAYS,
  };
}

// The instance a process's server made; the desktop app's server tells the app's menu about it (desktop/server-entry.js).
let active = null;
module.exports = { createLocalAccess, setActive:instance => { active = instance; }, active:() => active, CODE, MOST_WRONG };
