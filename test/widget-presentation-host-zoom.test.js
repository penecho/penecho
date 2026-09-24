"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");

function extractFunction(text,name) {
 const start=text.indexOf(`  function ${name}(`);
 const end=text.indexOf('\n  function ',start+1);
 assert.ok(start>=0 && end>start);
 return text.slice(start,end);
}

function harness({ maximized, presentationZoom = 100, presentationWidth = 640 } = {}) {
  const messages = [];
  const classChanges = [];
  const shell = {
    clientWidth: 1000,
    clientHeight: 800,
    classList: {
      toggle(name, enabled) { classChanges.push([name, enabled]); },
    },
    tabIndex: -1,
  };
  const frame = {
    inert: false,
    contentWindow: {
      postMessage(message, origin) { messages.push({ message, origin }); },
    },
  };
  const widget = {
    id: "widget-zoom",
    maximized,
    presentationZoom,
    presentationWidth,
    contentW: 320,
    contentH: 200,
    w: 160,
    h: 100,
    shell,
    frame,
    hostReady: true,
    renderActive: true,
    fitContent: false,
    fitContentAxes: null,
    hostStateKey: null,
    pending: false,
  };
  const state = {
    scale: 2,
    viewMode: false,
    mode: "select",
    navigationLocked: false,
    widgetEdit: null,
    selectedWidgetId: null,
  };
  const context = {
    canvasWidgetInteractive: () => false,
    canvasWidgetSelectionEnabled: () => true,
    getComputedStyle: () => ({ paddingLeft: "20px", paddingRight: "20px", paddingTop: "0px", paddingBottom: "20px" }),
    location: { origin: "https://canvas.test" },
    state,
    syncMcpWidgetProgress() {},
  };
  const navigation = fs.readFileSync(path.join(__dirname, '../src/client/app/canvas-navigation.js'), 'utf8');
  context.widgetPresentationScale = vm.runInNewContext(`(${extractFunction(navigation, 'widgetPresentationScale')})`, context);
  const sendWidgetHostState = vm.runInNewContext(
    `(${extractFunction(source, "sendWidgetHostState")})`,
    context,
  );
  return { classChanges, frame, messages, sendWidgetHostState, shell, state, widget };
}

test("maximizing fits page width regardless of Canvas zoom and responds to window resize", () => {
  const h = harness({maximized:true});
  const geometry = [h.widget.w,h.widget.h,h.widget.contentW,h.widget.contentH];
  h.state.scale = .05;
  h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.at(-1).message.scaleX,3);
  assert.equal(h.messages.at(-1).message.scaleY,3);
  h.state.scale = 4;
  h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.length,1);
  h.shell.clientWidth=360;
  h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.at(-1).message.scaleX,1);
  assert.deepEqual([h.widget.w,h.widget.h,h.widget.contentW,h.widget.contentH],geometry);
});

test("toolbar zoom scales the width-fit view and exit restores Canvas scale", () => {
  const h=harness({maximized:true,presentationZoom:50});
  h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.at(-1).message.scaleX,1.5);
  h.widget.presentationZoom=100;h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.at(-1).message.scaleX,3);
  h.widget.maximized=false;h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.at(-1).message.scaleX,1);
});

test("the host keeps its existing inner iframe at native full size", () => {
  const host=fs.readFileSync(path.join(__dirname,'../public/widget-host.js'),'utf8');
  const messages=[],inner={style:{},contentWindow:{postMessage:m=>messages.push(m)}};
  const widgetState={maximized:true,scaleX:.75,scaleY:.75};
  const forward=vm.runInNewContext(`(${extractFunction(host,'forwardWidgetState')})`,{inner,widgetState});
  forward();widgetState.scaleX=.375;forward();widgetState.maximized=false;forward();
  assert.deepEqual(inner.style,{},'no pinning, transform or document recreation');
  assert.equal(messages.length,3);
});
