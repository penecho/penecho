"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/ai-runtime.js"), "utf8");

function fixture(widgetCount = 0) {
  const state = { aiColor:"#20232b", scale:1, widgets:Array.from({ length:widgetCount }, () => ({})) },
    context = vm.createContext({
      state, window:{}, SIZE:20000, MAX_VISIBLE_WIDGETS:100,
      MAX_WIDGET_HTML_LENGTH:200000, MAX_WIDGET_COPY_TEXT_LENGTH:16000,
      VISUAL_EXPLAINER_SOURCE_FORMAT:"penecho-visual-explainer+json", AI_TEXT_MAX_LENGTH:5000,
      enabledPluginDescriptors:() => [{ id:"general" }],
    });
  vm.runInContext(source, context);
  return {
    state,
    validate:(commands, target = null) => JSON.parse(JSON.stringify(context.validate(commands, state.aiColor, target))),
  };
}

function clock(title, x) {
  return {
    tool:"html_widget", pluginId:"general", x, y:10600, w:440, h:600,
    title, refreshSeconds:0, html:`<!doctype html><html><body><p>${title}</p></body></html>`,
  };
}

const clocks = [clock("Beijing time", 13746), clock("New York time", 14258), clock("London time", 14781)];

test("Canvas AI client retains all three independent clock widgets and their placement", () => {
  assert.deepEqual(fixture().validate(clocks), clocks);
});

test("invalid or disabled widgets do not discard later valid widgets", () => {
  assert.deepEqual(fixture().validate([
    clocks[0], { ...clocks[1], html:"" }, { ...clocks[1], pluginId:"disabled" }, clocks[1], clocks[2],
  ]), clocks);
});

test("widget batches retain the existing preference over accompanying text commands", () => {
  const text = { tool:"write_text", x:100, y:100, text:"Clock zones", fontSize:100, maxWidth:1000 };
  assert.deepEqual(fixture().validate([text, ...clocks]), clocks);
  assert.equal(fixture().validate([text])[0].text, text.text);
});

test("multiple widget output still observes available canvas slots and the command limit", () => {
  assert.deepEqual(fixture(99).validate(clocks), [clocks[0]]);
  assert.deepEqual(fixture(100).validate(clocks), []);
  const commands = Array.from({ length:18 }, (_, index) => clock(`Clock ${index}`, 100 + index * 500));
  assert.deepEqual(fixture().validate(commands), commands.slice(0, 16));
});

test("refinement retains its existing single target and geometry", () => {
  const target = { pluginId:"general", x:200, y:300, w:800, h:700 },
    accepted = fixture().validate([clocks[0]], target);
  assert.deepEqual(accepted, [{ ...clocks[0], x:target.x, y:target.y, w:target.w, h:target.h }]);
});
