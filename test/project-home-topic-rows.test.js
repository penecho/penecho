"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

for (const folded of [false, true]) {
  test(`Home limits ${folded ? "chips" : "tiles"} to two rows and discloses overflow`, () => {
    const { document } = parseHTML('<html><body><div id="hmWeek"></div></body></html>');
    const p = { id:"p", lines:[], knowledge:Array.from({ length:7 }, (_, i) => ({
      title:`Topic ${i}`, path:`topics/${i}.md`, lines:[],
    })) };
    const choice = { topicsFolded:folded }, timers = [];
    let onResize;
    const context = vm.createContext({
      document, ACT:{}, S:{ route:{ view:"home" }, topicsNew:{ p:p.knowledge.slice() } }, Pano:{},
      $:s => document.querySelector(s), $$:s => [...document.querySelectorAll(s)],
      project:() => p, allLines:() => [], topicsGrew:() => true, esc:String, ic:() => "",
      homeChoice:() => choice, setHomeChoice:(_, values) => Object.assign(choice, values),
      ResizeObserver:class { constructor(callback) { onResize = callback; } observe() {} },
      setTimeout:fn => timers.push(fn), addEventListener() {},
    });
    vm.runInContext(fs.readFileSync(require.resolve("../public/lines/desk.js"), "utf8"), context);
    const host = document.querySelector("#hmWeek");
    host.innerHTML = context.topicsCardHTML(p);
    const list = host.querySelector("#topicTiles"), more = host.querySelector('[data-act="topics-more"]');
    const items = Array.from(list.children);
    // The DOM harness supplies the row positions normally reported by Grid or Flexbox.
    let tops = [0, 0, 42, 42, 42, 84, 84];
    items.forEach((item, i) => Object.defineProperty(item, "offsetTop", { get:() => tops[i] }));
    const visible = () => items.filter(el => !el.hidden).length;
    context.observeTopicRows(list);
    assert.equal(visible(), 5);
    assert.equal(more.hidden, false);
    assert.equal(more.getAttribute("aria-controls"), list.id);
    assert.equal(more.textContent, "View more");

    context.seeChangedTiles(p);
    if (!folded) {
      timers.shift()();
      assert.deepEqual(Array.from(context.S.topicsNew.p, t => t.title), ["Topic 5", "Topic 6"]);
    }
    let focused = false;
    (folded ? items[5] : items[5].querySelector("button")).focus = () => { focused = true; };
    context.ACT["topics-more"](more);
    assert.equal(visible(), 7);
    assert.equal(focused, true);
    assert.equal(more.getAttribute("aria-expanded"), "true");
    assert.equal(more.textContent, "Show fewer");
    context.ACT["topics-more"](more);
    assert.equal(visible(), 5);
    assert.equal(more.getAttribute("aria-expanded"), "false");

    const resize = width => onResize([{ target:list, contentRect:{ width } }]);
    tops = [0, 0, 0, 0, 42, 42, 42];
    resize(800);
    assert.equal(visible(), 7);
    assert.equal(more.hidden, true, "two complete rows need no toggle");
    tops = [0, 42, 84, 126, 168, 210, 252];
    resize(220);
    assert.equal(visible(), 2);
    assert.equal(more.hidden, false);
  });
}
