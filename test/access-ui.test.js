"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const accessScript = fs.readFileSync(path.join(ROOT, "public", "access.js"), "utf8");
const accessHtml = fs.readFileSync(path.join(ROOT, "public", "access.html"), "utf8");
const accessCss = fs.readFileSync(path.join(ROOT, "public", "access.css"), "utf8");

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.hidden = true;
    this.textContent = "";
    this.listeners = new Map();
    this.attributes = new Map();
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
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
  const focusCalls = [];
  const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
    .map((digit) => {
      const button = new FakeElement({ digit });
      button.closest = () => button;
      button.focus = () => focusCalls.push(digit);
      return button;
    });
  elements["#accessKeypad"].querySelector = (selector) => selector === "button[data-digit]" ? keypadDigits[0] : null;
  elements["#accessKeypad"].keypadDigits = keypadDigits;
  const body = new FakeElement(), themeColor = new FakeElement();
  const document = {
    documentElement: { dataset:{} },
    body,
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return themeColor;
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
  return { document, elements, body, themeColor, focusCalls };
}

async function boot(mode, { palette="indigo", theme=null, legacyTheme=null } = {}) {
  const { document, elements, body, themeColor, focusCalls } = makeDocument();
  const calls = [];
  const storedSession = new Map();
  const storedAppearance = new Map([
    ["penecho-language", "en"],
    ...(palette === null ? [] : [["penecho-studio-palette", palette]]),
    ...(theme === null ? [] : [["penecho-theme", theme]]),
    ...(legacyTheme === null ? [] : [["ghostboard-theme", legacyTheme]]),
  ]);
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
    localStorage: { getItem(key) { return storedAppearance.get(key) || null; }, setItem(key,value) { storedAppearance.set(key,String(value)); } },
    sessionStorage: { getItem(key) { return storedSession.get(key) || null; }, setItem(key,value) { storedSession.set(key,String(value)); } },
    window: { location: { replace() { redirected = true; } }, addEventListener() {} },
    Date,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(accessScript, context, { filename:"public/access.js" });
  await new Promise((resolve) => setImmediate(resolve));
  return { document, elements, body, themeColor, focusCalls, calls, redirected, storedSession, storedAppearance };
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

test("unlock opens without focusing a keypad button while keyboard entry still works", async () => {
  const run = await boot("pin");
  assert.deepEqual(run.focusCalls, []);
  for (const key of "271828") {
    let prevented = false;
    run.document.listeners.keydown({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.calls.filter((call) => call.url === "/api/local-access/unlock").length, 1);
});

test("access setup follows the current Studio palette with accessible workbench states", async () => {
  const run = await boot("undecided", { palette:"forest" });
  assert.equal(run.document.documentElement.dataset.theme, "studio");
  assert.equal(run.document.documentElement.dataset.studioPalette, "forest");
  assert.equal(run.body.dataset.theme, "studio");
  assert.equal(run.body.dataset.studioPalette, "forest");
  assert.equal(run.themeColor.attributes.get("content"), "#f7faf7");

  for (const palette of ["graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"]) {
    assert.match(accessCss, new RegExp(`\\[data-studio-palette="${palette}"\\]`));
  }
  assert.match(accessHtml, /data-theme="studio" data-studio-palette="teal"/);
  assert.match(accessCss, /button:focus-visible, a:focus-visible[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.match(accessCss, /@media \(pointer: coarse\)[\s\S]*min-height:\s*44px/);
  assert.match(accessCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("access setup migrates removed themes to the default teal Studio palette", async () => {
  for (const option of [{ theme:"arcane" }, { theme:"scifi" }, { theme:"research" }, { legacyTheme:"research" }]) {
    const run = await boot("undecided", { palette:"forest", ...option });
    assert.equal(run.document.documentElement.dataset.theme, "studio");
    assert.equal(run.document.documentElement.dataset.studioPalette, "teal");
    assert.equal(run.body.dataset.studioPalette, "teal");
    assert.equal(run.themeColor.attributes.get("content"), "#f6faf9");
    assert.equal(run.storedAppearance.get("penecho-theme"), "studio");
    assert.equal(run.storedAppearance.get("penecho-studio-palette"), "teal");
  }
});
