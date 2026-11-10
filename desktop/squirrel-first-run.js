"use strict";

const FIRST_RUN_ARGUMENT = "--squirrel-firstrun";
const FIRST_RUN_MAX_WAIT_MS = 10_000;
const FIRST_RUN_POLL_MS = 100;

function processIsRunning(pid, killImpl = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    killImpl(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForSquirrelFirstRunExit(options = {}) {
  const platform = options.platform || process.platform,
    argv = options.argv || process.argv;
  if (platform !== "win32" || !argv.includes(FIRST_RUN_ARGUMENT)) return false;
  const parentPid = Number(options.parentPid ?? process.ppid),
    maxWaitMs = Number(options.maxWaitMs) || FIRST_RUN_MAX_WAIT_MS,
    pollMs = Number(options.pollMs) || FIRST_RUN_POLL_MS,
    now = options.now || Date.now,
    delay = options.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    isRunning = options.isRunning || processIsRunning,
    startedAt = now();
  while (isRunning(parentPid) && now() - startedAt < maxWaitMs) {
    await delay(Math.min(pollMs, maxWaitMs - (now() - startedAt)));
  }
  return true;
}

module.exports = {
  FIRST_RUN_ARGUMENT, FIRST_RUN_MAX_WAIT_MS, FIRST_RUN_POLL_MS, processIsRunning, waitForSquirrelFirstRunExit,
};
