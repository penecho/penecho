"use strict";

const STREAM_IDLE_GRACE_MS = 10_000;

function createActivityAwareTimeout(controller, totalTimeoutMs, options = {}) {
  const idleGraceMs = Number(options.idleGraceMs) > 0 ? Number(options.idleGraceMs) : STREAM_IDLE_GRACE_MS,
    now = options.now || Date.now,
    scheduleTimer = options.setTimeout || setTimeout,
    cancelTimer = options.clearTimeout || clearTimeout,
    deadline = now() + Math.max(1, Number(totalTimeoutMs) || 1);
  let lastActivityAt = null, timer = null, cleared = false;

  const schedule = delay => {
    timer = scheduleTimer(check, Math.max(1, Math.ceil(delay)));
  };
  const check = () => {
    if (cleared || controller.signal.aborted) return;
    const current = now();
    if (current < deadline) return schedule(deadline - current);
    if (lastActivityAt !== null && current - lastActivityAt < idleGraceMs) return schedule(idleGraceMs - (current - lastActivityAt));
    controller.abort();
  };
  schedule(deadline - now());

  return {
    activity() { if (!cleared && !controller.signal.aborted) lastActivityAt = now(); },
    clear() {
      cleared = true;
      if (timer !== null) cancelTimer(timer);
      timer = null;
    },
  };
}

module.exports = { createActivityAwareTimeout, STREAM_IDLE_GRACE_MS };
