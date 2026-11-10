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

function createIdleAndTotalTimeout(controller, idleTimeoutMs, totalTimeoutMs, options = {}) {
  const idleLimitMs = Math.max(1, Number(idleTimeoutMs) || 1),
    totalLimitMs = Math.max(idleLimitMs, Number(totalTimeoutMs) || idleLimitMs),
    now = options.now || Date.now,
    scheduleTimer = options.setTimeout || setTimeout,
    cancelTimer = options.clearTimeout || clearTimeout,
    reasonFor = typeof options.reasonFor === "function" ? options.reasonFor : () => undefined;
  let lastActivityAt = now(), idleTimer = null, totalTimer = null, cleared = false;

  const abort = (kind, limitMs) => {
    if (cleared || controller.signal.aborted) return;
    controller.abort(reasonFor(kind, limitMs));
  };
  const scheduleIdle = () => {
    if (idleTimer !== null) cancelTimer(idleTimer);
    const remaining = Math.max(1, idleLimitMs - (now() - lastActivityAt));
    idleTimer = scheduleTimer(() => {
      if (cleared || controller.signal.aborted) return;
      const nextRemaining = idleLimitMs - (now() - lastActivityAt);
      if (nextRemaining > 0) return scheduleIdle();
      abort("idle", idleLimitMs);
    }, remaining);
  };

  scheduleIdle();
  totalTimer = scheduleTimer(() => abort("total", totalLimitMs), totalLimitMs);

  return {
    activity() {
      if (cleared || controller.signal.aborted) return;
      lastActivityAt = now();
      scheduleIdle();
    },
    clear() {
      cleared = true;
      if (idleTimer !== null) cancelTimer(idleTimer);
      if (totalTimer !== null) cancelTimer(totalTimer);
      idleTimer = totalTimer = null;
    },
  };
}

function createInactivityTimeout(controller, idleTimeoutMs, options = {}) {
  const idleLimitMs = Math.max(1, Number(idleTimeoutMs) || 1),
    now = options.now || Date.now,
    scheduleTimer = options.setTimeout || setTimeout,
    cancelTimer = options.clearTimeout || clearTimeout,
    reasonFor = typeof options.reasonFor === "function" ? options.reasonFor : () => undefined;
  let lastActivityAt = now(), timer = null, cleared = false;

  const schedule = () => {
    if (timer !== null) cancelTimer(timer);
    const remaining = Math.max(1, idleLimitMs - (now() - lastActivityAt));
    timer = scheduleTimer(() => {
      if (cleared || controller.signal.aborted) return;
      const nextRemaining = idleLimitMs - (now() - lastActivityAt);
      if (nextRemaining > 0) return schedule();
      controller.abort(reasonFor("idle", idleLimitMs));
    }, remaining);
  };

  schedule();
  return {
    activity() {
      if (cleared || controller.signal.aborted) return;
      lastActivityAt = now();
      schedule();
    },
    clear() {
      cleared = true;
      if (timer !== null) cancelTimer(timer);
      timer = null;
    },
  };
}

module.exports = { createActivityAwareTimeout, createIdleAndTotalTimeout, createInactivityTimeout, STREAM_IDLE_GRACE_MS };
