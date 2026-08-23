"use strict";

const [nodeMajor,nodeMinor]=process.versions.node.split(".",2).map(Number);
if (!(Number.isInteger(nodeMajor)&&Number.isInteger(nodeMinor)&&(nodeMajor>22||nodeMajor===22&&nodeMinor>=19))) {
  throw new Error(`PenEcho requires Node.js 22.19 or newer for the embedded DeepSeek Harness (current: ${process.versions.node}).`);
}

module.exports = require("./src/server/main.js");
