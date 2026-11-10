#!/usr/bin/env node
"use strict";

const { isSupportedNodeVersion, unsupportedNodeMessage } = require("./src/cli/node-version.js");

if (!isSupportedNodeVersion()) {
  const message = unsupportedNodeMessage();
  if (require.main === module) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } else {
    const error = new Error(message);
    error.code = "PENECHO_UNSUPPORTED_NODE_VERSION";
    throw error;
  }
} else {
  const cli = require("./src/cli/main.js");

  if (require.main === module) {
    cli.main().then(code => { if (code) process.exitCode = code; }).catch(error => {
      console.error(`PenEcho: ${error.message}`);
      process.exitCode = 1;
    });
  }

  module.exports = cli;
}
