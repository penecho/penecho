#!/usr/bin/env node
"use strict";

const cli = require("./src/cli/main.js");

if (require.main === module) {
  cli.main().then(code => { if (code) process.exitCode = code; }).catch(error => {
    console.error(`PenEcho: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = cli;
