"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const accessScript = fs.readFileSync(path.join(ROOT, "public", "access.js"), "utf8");
const accessHtml = fs.readFileSync(path.join(ROOT, "public", "access.html"), "utf8");

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.hidden = true;
    this.textContent = "";
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  dispatch(type, event = {}) {
    return this.listeners.get(type)?.({ target:this, ...event });
  }

  querySelector(selector) {
    return selector === ".access-choice-list" ? this.choiceList : null;
  }

  setAttribute() {}
  focus() {}
}

function makeDocument() {
  const ids = [
    "#accessTitle", "#accessDescription", "#accessLoading", "#accessSetup", "#accessPin", "#accessRisk",
    "#accessError", "#accessRetry", "#accessPinStep", "#accessPinBack", "#accessChoosePin", "#accessChooseOpen",
    "#accessRiskBack", "#accessConfirmOpen", "#accessKeypad",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements["#accessSetup"].choiceList = new FakeElement();
  const dots = Array.from({ length:6 }, () => new FakeElement());
  const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
    .map((digit) => {
      const button = new FakeElement({ digit });
      button.closest = () => button;
      return button;
    });
  elements["#accessKeypad"].querySelector = (selector) => selector === "button[data-digit]" ? keypadDigits[0] : null;
  elements["#accessKeypad"].keypadDigits = keypadDigits;
  const document = {
    documentElement: {},
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === "#accessPinDots i") return dots;
      return [];
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    listeners: {},
  };
  return { document, elements };
}

async function boot(mode) {
  const { document, elements } = makeDocument();
  const calls = [];
  const storedSession = new Map();
  let redirected = false;
  const response = (body, status = 200) => ({ ok:status >= 200 && status < 300, status, async json() { return body; } });
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/local-access/status") return response({ mode, unlocked:false, setupRequired:mode === "undecided" });
    if (url === "/api/local-access/setup-pin" || url === "/api/local-access/unlock") return response({ mode:"pin", unlocked:true, accessSessionToken:"test-access-session" });
    throw new Error(`Unexpected request: ${url}`);
  };
  const context = {
    document,
    fetch,
    localStorage: { getItem() { return "en"; }, setItem() {} },
    sessionStorage: { getItem(key) { return storedSession.get(key) || null; }, setItem(key,value) { storedSession.set(key,String(value)); } },
    window: { location: { replace() { redirected = true; } } },
    Date,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(accessScript, context, { filename:"public/access.js" });
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, calls, redirected, storedSession };
}

function clickDigits(keypad, value) {
  for (const digit of value) {
    const button = keypad.keypadDigits.find((candidate) => candidate.dataset.digit === digit);
    assert.ok(button, `missing keypad digit ${digit}`);
    keypad.listeners.get("click")({ target:button });
  }
}

test("access PIN setup and unlock submit once on the sixth digit", async () => {
  assert.doesNotMatch(accessHtml, /accessPinContinue/);
  assert.match(accessScript, /if\(entry\.length===6\)submitPin\(\);/);

  const setup = await boot("undecided");
  setup.elements["#accessChoosePin"].dispatch("click");
  clickDigits(setup.elements["#accessKeypad"], "271828");
  await new Promise((resolve) => setImmediate(resolve));
  const setupRequests = setup.calls.filter((call) => call.url === "/api/local-access/setup-pin");
  assert.equal(setupRequests.length, 1);
  assert.deepEqual(JSON.parse(setupRequests[0].options.body), { pin:"271828", confirmation:"271828" });
  assert.equal(setup.storedSession.get("penecho-access-session"),"test-access-session");

  const unlock = await boot("pin");
  clickDigits(unlock.elements["#accessKeypad"], "271828");
  await new Promise((resolve) => setImmediate(resolve));
  const unlockRequests = unlock.calls.filter((call) => call.url === "/api/local-access/unlock");
  assert.equal(unlockRequests.length, 1);
  assert.deepEqual(JSON.parse(unlockRequests[0].options.body), { pin:"271828" });
  assert.equal(unlock.storedSession.get("penecho-access-session"),"test-access-session");
});
