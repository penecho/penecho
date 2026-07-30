"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CREDENTIAL_VERSION = 2,
  CREDENTIAL_ENCODING = "gzip+base64",
  MAX_CREDENTIAL_FILE_BYTES = 64 * 1024,
  MAX_SECRET_BYTES = 16 * 1024;

function decodeSecret(encoded) {
  if (typeof encoded !== "string" || !encoded || encoded.length > MAX_CREDENTIAL_FILE_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  const compressed = Buffer.from(encoded, "base64"),
    secret = zlib.gunzipSync(compressed, { maxOutputLength:MAX_SECRET_BYTES }),
    value = secret.toString("utf8");
  if (!secret.length || !Buffer.from(value, "utf8").equals(secret)) return "";
  return value;
}

function readSecret(file, safeStorage = null) {
  try {
    const details = fs.statSync(file);
    if (!details.isFile() || details.size > MAX_CREDENTIAL_FILE_BYTES) return "";
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (stored?.version === CREDENTIAL_VERSION && stored.encoding === CREDENTIAL_ENCODING) return decodeSecret(stored.apiKey);
    if (stored?.version !== 1 || typeof stored.apiKey !== "string" || !safeStorage?.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(stored.apiKey, "base64"));
  } catch { return ""; }
}

function writeSecret(file, value, safeStorage = null) {
  const secret = Buffer.from(String(value), "utf8");
  if (!secret.length || secret.length > MAX_SECRET_BYTES) throw new Error("API key is too large to store locally.");
  let stored;
  if (safeStorage) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this computer.");
    stored = { version:1, apiKey:safeStorage.encryptString(secret.toString("utf8")).toString("base64") };
  } else {
    const compressed = zlib.gzipSync(secret, { level:zlib.constants.Z_BEST_COMPRESSION });
    stored = {
      version:CREDENTIAL_VERSION,
      encoding:CREDENTIAL_ENCODING,
      apiKey:compressed.toString("base64"),
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(stored)}\n`, { encoding:"utf8", mode:0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch (error) { if (process.platform !== "win32") throw error; }
}

module.exports = { readSecret, writeSecret };
