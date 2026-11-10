"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createActivityAwareTimeout, createIdleAndTotalTimeout, createInactivityTimeout, STREAM_IDLE_GRACE_MS } = require("../src/server/activity-timeout.js");

function fakeClock() {
  let current = 0, nextId = 0;
  const timers = new Map();
  return {
    now:() => current,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at:current + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advanceTo(target) {
      for (;;) {
        const next = [...timers.entries()].filter(([,timer]) => timer.at <= target).sort((left,right) => left[1].at - right[1].at)[0];
        if (!next) break;
        const [id,timer] = next;
        timers.delete(id);
        current = timer.at;
        timer.callback();
      }
      current = target;
    },
  };
}

test("activity-aware timeout aborts only after the total limit and idle grace are both exhausted", () => {
  const clock = fakeClock(), controller = new AbortController(), timeout = createActivityAwareTimeout(controller,100,{
    idleGraceMs:10, now:clock.now, setTimeout:clock.setTimeout, clearTimeout:clock.clearTimeout,
  });
  clock.advanceTo(95);
  timeout.activity();
  clock.advanceTo(100);
  assert.equal(controller.signal.aborted,false);
  clock.advanceTo(104);
  timeout.activity();
  clock.advanceTo(113);
  assert.equal(controller.signal.aborted,false);
  clock.advanceTo(114);
  assert.equal(controller.signal.aborted,true);
});

test("activity-aware timeout does not add idle grace when no stream data arrives", () => {
  const clock = fakeClock(), controller = new AbortController();
  createActivityAwareTimeout(controller,100,{ now:clock.now, setTimeout:clock.setTimeout, clearTimeout:clock.clearTimeout });
  clock.advanceTo(99);
  assert.equal(controller.signal.aborted,false);
  clock.advanceTo(100);
  assert.equal(controller.signal.aborted,true);
  assert.equal(STREAM_IDLE_GRACE_MS,10_000);
});

test("idle-and-total timeout refreshes the idle deadline when output remains active", () => {
  const clock = fakeClock(), controller = new AbortController(), reasons = [], timeout = createIdleAndTotalTimeout(controller,20,60,{
    now:clock.now,
    setTimeout:clock.setTimeout,
    clearTimeout:clock.clearTimeout,
    reasonFor:(kind,limitMs) => { reasons.push({kind,limitMs}); return new Error(kind); },
  });
  clock.advanceTo(15);
  timeout.activity();
  clock.advanceTo(34);
  assert.equal(controller.signal.aborted,false);
  clock.advanceTo(35);
  assert.equal(controller.signal.aborted,true);
  assert.deepEqual(reasons,[{kind:"idle",limitMs:20}]);
});

test("idle-and-total timeout enforces a hard total cap despite recent activity", () => {
  const clock = fakeClock(), controller = new AbortController(), reasons = [], timeout = createIdleAndTotalTimeout(controller,30,70,{
    now:clock.now,
    setTimeout:clock.setTimeout,
    clearTimeout:clock.clearTimeout,
    reasonFor:(kind,limitMs) => { reasons.push({kind,limitMs}); return new Error(kind); },
  });
  for (const time of [20,40,60,69]) {
    clock.advanceTo(time);
    timeout.activity();
  }
  clock.advanceTo(70);
  assert.equal(controller.signal.aborted,true);
  assert.deepEqual(reasons,[{kind:"total",limitMs:70}]);
});

test("inactivity timeout has no total cap while genuine progress continues", () => {
  const clock = fakeClock(), controller = new AbortController(), reasons = [], timeout = createInactivityTimeout(controller,20,{
    now:clock.now,
    setTimeout:clock.setTimeout,
    clearTimeout:clock.clearTimeout,
    reasonFor:(kind,limitMs) => { reasons.push({kind,limitMs}); return new Error(kind); },
  });
  for (const time of [15,30,45,60,75,90]) {
    clock.advanceTo(time);
    assert.equal(controller.signal.aborted,false);
    timeout.activity();
  }
  clock.advanceTo(109);
  assert.equal(controller.signal.aborted,false);
  clock.advanceTo(110);
  assert.equal(controller.signal.aborted,true);
  assert.deepEqual(reasons,[{kind:"idle",limitMs:20}]);
});
