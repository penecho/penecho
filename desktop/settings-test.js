"use strict";

const { testConfiguredProvider } = require("../cli.js");

async function testDesktopConnection(configuration, { timeoutMs = 30_000, testProvider = testConfiguredProvider } = {}) {
  let timer, finished = false, rejectTimeout;
  const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
  const startDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const error = new Error(`Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      error.code = "PENECHO_SETTINGS_TEST_TIMEOUT";
      rejectTimeout(error);
    }, timeoutMs);
  };
  const onCliUpgrade = ({ phase }) => {
    if (finished) return;
    if (phase === "start") clearTimeout(timer);
    else if (phase === "complete") startDeadline();
  };
  startDeadline();
  try {
    return await Promise.race([
      Promise.resolve().then(() => testProvider(configuration, { timeoutMs, onCliUpgrade })),
      timeout,
    ]);
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}

module.exports = { testDesktopConnection };
