"use strict";

const PACKAGE_JSON = require("../../package.json");

const MINIMUM_NODE_VERSION = "22.19.0";
const MINIMUM_NODE_PARTS = Object.freeze(MINIMUM_NODE_VERSION.split(".").map(Number));

function parsedNodeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isSupportedNodeVersion(value = process.versions.node) {
  const current = parsedNodeVersion(value);
  if (!current) return false;
  for (let index = 0; index < MINIMUM_NODE_PARTS.length; index++) {
    if (current[index] !== MINIMUM_NODE_PARTS[index]) return current[index] > MINIMUM_NODE_PARTS[index];
  }
  return true;
}

function unsupportedNodeMessage(value = process.versions.node) {
  const current = String(value || "unknown").replace(/^v/, "");
  return [
    `PenEcho ${PACKAGE_JSON.version} requires Node.js ${MINIMUM_NODE_VERSION} or newer (current: ${current}).`,
    "Upgrade Node.js, then run the PenEcho update again:",
    "  npm install --global penecho@latest",
    "Download Node.js: https://nodejs.org/",
  ].join("\n");
}

if (require.main === module && !isSupportedNodeVersion()) {
  process.stderr.write(`${unsupportedNodeMessage()}\n`);
  process.exitCode = 1;
}

module.exports = {
  MINIMUM_NODE_VERSION,
  isSupportedNodeVersion,
  parsedNodeVersion,
  unsupportedNodeMessage,
};
