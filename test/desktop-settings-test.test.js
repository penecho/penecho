"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout:delay } = require("node:timers/promises");
const { testDesktopConnection } = require("../desktop/settings-test.js");

test("desktop connection tests retain a deadline for an unresponsive provider", async () => {
  await assert.rejects(testDesktopConnection({}, {
    timeoutMs:20,
    testProvider:() => new Promise(() => {}),
  }), { code:"PENECHO_SETTINGS_TEST_TIMEOUT" });
});

test("desktop connection tests wait for CLI upgrades before timing the model test", async () => {
  const configuration = { provider:"codex-cli" };
  const result = await testDesktopConnection(configuration, {
    timeoutMs:20,
    testProvider:async (received, { timeoutMs, onCliUpgrade }) => {
      assert.equal(received, configuration);
      assert.equal(timeoutMs, 20);
      onCliUpgrade({ phase:"start" });
      await delay(50);
      onCliUpgrade({ phase:"complete" });
      return "new CLI and model verified";
    },
  });
  assert.equal(result, "new CLI and model verified");
});

test("desktop connection tests restore the deadline after an upgrade", async () => {
  await assert.rejects(testDesktopConnection({}, {
    timeoutMs:20,
    testProvider:async (_configuration, { onCliUpgrade }) => {
      onCliUpgrade({ phase:"start" });
      await delay(50);
      onCliUpgrade({ phase:"complete" });
      return new Promise(() => {});
    },
  }), { code:"PENECHO_SETTINGS_TEST_TIMEOUT" });
});

test("desktop connection tests preserve an upgrade failure", async () => {
  const failure = new Error("The official Codex installer could not download the pinned version.");
  await assert.rejects(testDesktopConnection({}, {
    timeoutMs:20,
    testProvider:async (_configuration, { onCliUpgrade }) => {
      onCliUpgrade({ phase:"start" });
      try { await delay(50); throw failure; }
      finally { onCliUpgrade({ phase:"complete" }); }
    },
  }), error => error === failure);
});
