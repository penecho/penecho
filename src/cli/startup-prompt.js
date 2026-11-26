"use strict";

const readline = require("node:readline");

function readStartupAnswer(question, { input = process.stdin, output = process.stdout } = {}) {
  if (input.readableEnded || input.destroyed) return Promise.resolve(null);
  return new Promise(resolve => {
    // Keep the terminal in its normal input mode so Ctrl+C reaches the CLI.
    const prompt = readline.createInterface({ input, output, terminal:false });
    prompt.once("close", () => resolve(null));
    prompt.question(`${question} [Y/n] `, answer => {
      resolve(answer.trim());
      prompt.close();
    });
  });
}

module.exports = { readStartupAnswer };
