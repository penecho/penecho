"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readSecret(file, safeStorage) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (stored?.version !== 1 || typeof stored.apiKey !== "string") return "";
    return safeStorage.decryptString(Buffer.from(stored.apiKey, "base64"));
  } catch { return ""; }
}

function writeSecret(file, value, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this computer.");
  const encrypted = safeStorage.encryptString(String(value));
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version:1, apiKey:encrypted.toString("base64") })}\n`, { encoding:"utf8", mode:0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch (error) { if (process.platform !== "win32") throw error; }
}

module.exports = { readSecret, writeSecret };
