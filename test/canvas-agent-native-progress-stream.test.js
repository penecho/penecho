"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function nativeProgressHarness(CodexNativeHost, text = "", options = {}) {
  const events = [];
  const host = { emitPublicEvent: (_, event) => events.push(event) };
  const session = { turnNumber:1 };
  const active = {
    text,
    responseTextStart:0,
    completedResponseMessages:[],
    titleRequested:Boolean(options.titleRequested),
    canvasTitleCandidate:"",
  };
  return { events, host, session, active,
    project:() => CodexNativeHost.prototype.projectNativeProgress.call(host, session, active),
    seal:() => CodexNativeHost.prototype.sealNativeAssistantResponse.call(host, session, active),
  };
}

test("native progress streams fragmented title-requested responses without exposing the title envelope", async () => {
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");

  const before = nativeProgressHarness(CodexNativeHost, "", { titleRequested:true });
  before.active.text += "进展：正在检查";
  before.project();
  assert.equal(before.events.length, 0);
  before.active.text += "源码。\n";
  before.project();
  assert.deepEqual(before.events.map(event => event.text), ["进展：正在检查源码。\n"]);
  before.active.text += "<penecho_canvas_title>源码检查结果</penecho_canvas_title>\n完成。";
  before.seal();
  assert.equal(before.active.canvasTitleCandidate, "源码检查结果");
  assert.equal(before.active.text, "进展：正在检查源码。\n完成。");
  assert.equal(before.events.some(event => String(event.text).includes("penecho_canvas_title")), false);

  const after = nativeProgressHarness(CodexNativeHost, "", { titleRequested:true });
  const fragments = [
    "<penecho_canvas_",
    "title>结构分析</penecho_canvas_title>\n进展：",
    "已确认结构。\n",
  ];
  for (const fragment of fragments) {
    after.active.text += fragment;
    after.project();
  }
  assert.deepEqual(after.events.map(event => event.text), ["进展：已确认结构。\n"]);
  after.active.text += "正文。";
  after.seal();
  assert.equal(after.active.canvasTitleCandidate, "结构分析");
  assert.equal(after.active.text, "进展：已确认结构。\n正文。");
  assert.equal(after.events.some(event => String(event.text).includes("penecho_canvas_title")), false);
});

test("native progress is bounded per response and continues across more than two response boundaries", async () => {
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const harness = nativeProgressHarness(CodexNativeHost);
  const body = "x".repeat(160);

  for (const [index, marker] of ["Progress:", "进展：", "Progress:", "进展："].entries()) {
    harness.active.text += `${marker}${body}\nresponse-${index}`;
    harness.project();
    harness.project();
    harness.seal();
  }

  const progress = harness.events.filter(event => /^(?:Progress:|进展：)/.test(event.text));
  assert.equal(progress.length, 4);
  assert.deepEqual(progress.map(event => event.text), [
    `Progress:${body}\n`,
    `进展：${body}\n`,
    `Progress:${body}\n`,
    `进展：${body}\n`,
  ]);

  const tooLong = nativeProgressHarness(CodexNativeHost, `Progress:${"x".repeat(161)}\nanswer`);
  tooLong.project();
  assert.equal(tooLong.events.length, 0);
  tooLong.seal();
  assert.equal(tooLong.events.some(event => /^(?:Progress:|进展：)/.test(event.text)), true);
});

test("native progress does not duplicate when a completed item repeats streamed deltas", async () => {
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const harness = nativeProgressHarness(CodexNativeHost);
  harness.active.text = "Progress: preparing\n";
  harness.project();
  harness.active.text += "answer";
  CodexNativeHost.prototype.appendNativeAssistantMessage.call(harness.host, harness.active, "Progress: preparing\nanswer");
  harness.project();
  harness.seal();

  assert.equal(harness.events.filter(event => event.kind === "assistant_delta" && event.text === "Progress: preparing\n").length, 1);
  assert.equal(harness.active.text, "Progress: preparing\nanswer");
  assert.equal(harness.events.filter(event => event.kind === "assistant_message").length, 1);
  assert.equal(harness.events.some(event => String(event.text).includes("reasoning")), false);
});

test("native progress is not repeated when a trailing title envelope trims its separator", async () => {
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const harness = nativeProgressHarness(CodexNativeHost, "Progress: checking\n<penecho_canvas_title>检查结果</penecho_canvas_title>", { titleRequested:true });
  harness.project();
  harness.seal();

  assert.deepEqual(harness.events.map(event => event.text), ["Progress: checking\n"]);
  assert.equal(harness.active.text, "Progress: checking");
  assert.equal(harness.active.canvasTitleCandidate, "检查结果");
});

test("native progress remains a single public update when a response is interrupted before sealing", async () => {
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const harness = nativeProgressHarness(CodexNativeHost, "进展：已开始检查\n");
  harness.project();
  harness.project();
  assert.deepEqual(harness.events, [{ kind:"assistant_delta", turn:1, text:"进展：已开始检查\n" }]);
  assert.equal(harness.active.responseTextStart, 0);
});
