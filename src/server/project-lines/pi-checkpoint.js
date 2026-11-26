"use strict";
const { createHash } = require("node:crypto");

// Pi writes an envelope when generation ends, but its message carries the time it
// began. Both the managed stream and the transcript must use the latter.
const messageTime = (message, fallback) => Number(message?.timestamp) > 0 ? Number(message.timestamp) : Date.parse(fallback) || 0;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const TRANSCRIPT_ONLY_KEYS = new Set(["contextSnapshot"]);
const normalizedMessage = message => {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  let copy = null;
  for (const key of TRANSCRIPT_ONLY_KEYS) {
    if (Object.hasOwn(message, key)) {
      if (!copy) copy = { ...message };
      delete copy[key];
    }
  }
  return copy || message;
};
const fingerprint = message => createHash("sha256").update(JSON.stringify(canonical(normalizedMessage(message)))).digest("hex");
function checkpointOf(line) {
  let row; try { row = typeof line === "string" ? JSON.parse(line) : line; } catch { return null; }
  if (!["message", "message_end"].includes(row?.type) || !row.message) return null;
  const at = messageTime(row.message, row.timestamp);
  return at ? { at, hash:fingerprint(row.message), message:row.message } : null;
}
const alreadyHandled = (checkpoint, message) => Boolean(checkpoint && message && (message.at < checkpoint.at || (message.at === checkpoint.at && checkpoint.hashes.includes(message.hash))));

module.exports = { messageTime, checkpointOf, alreadyHandled };
