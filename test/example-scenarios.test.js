"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ink = require("../public/example-ink.js");
const examples = require("../public/example-scenarios.js");

test("example ink lays text out as deterministic pen strokes", () => {
  const first = ink.textStrokes("f(x) = a·sin x", { size: 40, seed: 3 });
  const second = ink.textStrokes("f(x) = a·sin x", { size: 40, seed: 3 });
  assert.deepEqual(first, second);
  assert.ok(first.strokes.length >= 12);
  assert.ok(first.width > 200 && first.width < 600);
  for (const stroke of first.strokes) {
    assert.ok(stroke.length >= 2);
    for (const point of stroke) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});

test("example ink covers every character the scenarios write", () => {
  for (const scenario of examples.SCENARIOS) {
    const source = scenario.strokes.toString();
    for (const [, literal] of source.matchAll(/text\("([^"]+)"/g))
      for (const character of literal) assert.ok(ink.hasGlyph(character), `${scenario.id} uses missing glyph ${JSON.stringify(character)}`);
  }
});

test("example ink samples SVG paths, including relative and smooth curves", () => {
  const lines = ink.pathPolylines("M10 10h20v20H10Z M50 50c10 0 20 10 20 20s10 20 20 20");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0][0], [10, 10]);
  assert.deepEqual(lines[0].at(-1), [10, 10]);
  assert.deepEqual(lines[1].at(-1), [90, 90]);
  const strokes = ink.pathStrokes("M0 0L100 0", { x: 5, y: 7, scale: 2, wobble: 0 });
  assert.equal(strokes[0][0].x, 5);
  assert.equal(strokes[0][0].y, 7);
  assert.equal(strokes[0].at(-1).x, 205);
});

test("every example scenario has ink, an action and both languages", () => {
  assert.equal(examples.SCENARIOS.length, 20);
  const ids = new Set();
  for (const scenario of examples.SCENARIOS) {
    assert.ok(!ids.has(scenario.id));
    ids.add(scenario.id);
    assert.match(scenario.route, /^(instant|ai|agent)$/);
    assert.ok(examples.GOALS.includes(scenario.category), `${scenario.id} belongs to one category`);
    assert.ok(scenario.action);
    for (const key of ["title", "description", "coach", "learned"]) {
      assert.ok(scenario[key].en, `${scenario.id}.${key}.en`);
      assert.ok(scenario[key].zh, `${scenario.id}.${key}.zh`);
    }
    if (scenario.image) {
      assert.deepEqual(examples.strokes(scenario.id), [], `${scenario.id} is a photo, not ink`);
      continue;
    }
    const strokes = examples.strokes(scenario.id);
    // The Suggest bar keeps the newest 64 vector strokes; Agent examples are read from the canvas.
    const limit = scenario.route === "agent" ? 300 : 64;
    assert.ok(strokes.length > 0 && strokes.length <= limit, `${scenario.id} has ${strokes.length} strokes`);
    const box = ink.bounds(strokes);
    assert.equal(box.x, 0);
    assert.equal(box.y, 0);
    assert.ok(box.width < 1000 && box.height < 700, `${scenario.id} fits a first view`);
  }
  // Studying and Coding each open with an example that works before any model is set up.
  for (const goal of ["study", "code"]) assert.equal(examples.ordered(goal)[0].route, "instant", goal);
  assert.equal(examples.get("visual-explorer").route, "agent");
  for (const scenario of examples.SCENARIOS.filter((item) => item.route === "agent")) {
    assert.ok(scenario.prompt?.en && scenario.prompt?.zh, `${scenario.id} fills the Agent composer in both languages`);
  }
  assert.deepEqual(examples.SCENARIOS.filter((item) => item.action === "note").map((item) => item.id), ["photo-note", "knowledge-card", "work-note"]);
  for (const scenario of examples.SCENARIOS.filter((item) => item.route === "instant"))
    assert.ok(scenario.graph?.expression || scenario.architecture, `${scenario.id} has a known result`);
});

test("the diagram example inserts the same local architecture document Canvas AI builds", () => {
  const { architectureHtml } = require("../src/architecture/schema.js"),
    scenario = examples.get("diagram");
  assert.equal(scenario.route, "instant");
  assert.deepEqual(scenario.architecture.nodes.map((node) => node.label), ["Browser", "API", "Postgres", "Cache"], "the diagram matches the sketched boxes");
  // architectureHtml validates the object and throws when it is invalid.
  for (const language of ["en", "zh"])
    assert.equal(examples.architectureDocument(scenario.architecture, language), architectureHtml(scenario.architecture, { language }), language);
});

test("each category lists only its own examples, with no overlap", () => {
  const ids = (goal) => examples.ordered(goal).map((scenario) => scenario.id);
  assert.deepEqual(examples.GOALS, ["study", "code", "work", "play"]);
  assert.deepEqual(ids("study"), ["functions", "kids-homework", "surface-3d", "proof-check", "photo-note", "knowledge-card", "visual-explorer"]);
  assert.deepEqual(ids("code"), ["diagram", "code-bug", "agent-diagrams", "prototype"]);
  assert.deepEqual(ids("work"), ["class-3d", "patient-3d", "work-note", "plan", "chart"]);
  assert.deepEqual(ids("play"), ["illustration", "animate-sketch", "finish-drawing", "tic-tac-toe"]);
  const all = examples.GOALS.flatMap(ids);
  assert.equal(new Set(all).size, examples.SCENARIOS.length, "every example is in exactly one category");
  assert.deepEqual(ids(null), examples.SCENARIOS.map((scenario) => scenario.id));
  assert.ok(!ids("code").some((id) => ["functions", "surface-3d", "photo-note"].includes(id)), "coding has no math or study examples");
  assert.ok(ids("study").includes("kids-homework"), "studying includes children");
  assert.equal(examples.next("functions").id, "kids-homework");
});

test("example progress is parsed defensively and records each try once", () => {
  assert.deepEqual(examples.parseProgress("not json"), { schema: 1, goal: null, goalAsked: false, tried: [] });
  let progress = examples.parseProgress('{"tried":["functions","unknown","functions"],"goal":"hack"}');
  assert.deepEqual(progress.tried, ["functions"]);
  assert.equal(progress.goal, null);
  progress = examples.markTried(progress, "diagram");
  progress = examples.markTried(progress, "diagram");
  assert.deepEqual(progress.tried, ["functions", "diagram"]);
  progress = examples.setGoal(progress, "code");
  assert.equal(progress.goal, "code");
  assert.equal(progress.goalAsked, true);
  assert.deepEqual(examples.parseProgress(examples.serializeProgress(progress)), progress);
  assert.equal(examples.localized({ en: "Hi", zh: "你好" }, "zh"), "你好");
  assert.equal(examples.localized({ en: "Hi" }, "zh"), "Hi");
  // Earlier goal names map onto the new categories.
  assert.deepEqual(["build", "plan", "teach", "study"].map((goal) => examples.parseProgress({ goal }).goal), ["code", "work", "study", "study"]);
});

test("example photos ship small and without camera metadata", () => {
  const fs = require("node:fs"), path = require("node:path");
  const photos = examples.SCENARIOS.filter((scenario) => scenario.image);
  assert.deepEqual(photos.map((scenario) => scenario.id), ["photo-note", "code-bug"]);
  for (const { image } of photos) {
    const bytes = fs.readFileSync(path.join(__dirname, "..", "public", image.src));
    assert.ok(bytes.length < 300 * 1024, `${image.src} is ${bytes.length} bytes`);
    assert.equal(bytes.readUInt16BE(0), 0xffd8, "JPEG");
    // No APP1 Exif/XMP segment: location and device data never ship with the app.
    assert.equal(bytes.indexOf(Buffer.from("Exif\0\0")), -1, `${image.src} has EXIF data`);
    assert.equal(bytes.indexOf(Buffer.from("http://ns.adobe.com/xap")), -1, `${image.src} has XMP data`);
    let offset = 2, size = null;
    while (offset < bytes.length && !size) {
      const marker = bytes.readUInt16BE(offset), length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xffc0 && marker <= 0xffc3) size = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
    assert.deepEqual(size, { width: image.width, height: image.height });
  }
});

test("the empty canvas shows each category's own examples, with the photo leading Studying", () => {
  const ids = (list) => list.map((scenario) => scenario.id);
  assert.deepEqual(ids(examples.welcome(null, [])), ["photo-note", "diagram", "class-3d", "illustration"], "one lead example per category");
  assert.deepEqual(ids(examples.welcome("study", [])), ["functions", "photo-note", "kids-homework", "surface-3d"]);
  assert.deepEqual(ids(examples.welcome("study", ["photo-note", "functions"])), ["kids-homework", "photo-note", "surface-3d", "proof-check"], "featured stays after it is tried");
  assert.deepEqual(ids(examples.welcome("code", [])), ["diagram", "code-bug", "agent-diagrams", "prototype"]);
  assert.deepEqual(ids(examples.welcome("work", [])), ["class-3d", "patient-3d", "work-note", "plan"]);
  for (const goal of examples.GOALS.filter((id) => id !== "study")) assert.ok(!ids(examples.welcome(goal, [])).includes("photo-note"), `${goal} never shows study notes`);
  for (const goal of examples.GOALS) assert.ok(examples.welcome(goal, []).every((scenario) => scenario.category === goal), `${goal} shows only its own`);
});

test("the Agent diagram example asks for three small professional diagrams", () => {
  const scenario = examples.get("agent-diagrams");
  for (const language of ["en", "zh"]) assert.ok(scenario.prompt[language].length < 400, `${language} prompt stays short`);
  assert.match(scenario.prompt.en, /architecture diagram[\s\S]*sequence diagram[\s\S]*workflow/);
  assert.match(scenario.prompt.en, /At most 4 boxes each/);
  assert.match(scenario.prompt.zh, /架构图[\s\S]*时序图[\s\S]*流程图/);
});

test("studying checks work for every age; teachers and doctors explain in 3D", () => {
  for (const id of ["proof-check", "kids-homework"]) {
    assert.equal(examples.get(id).action, "check_step");
    assert.equal(examples.get(id).category, "study");
  }
  assert.equal(examples.get("finish-drawing").category, "play");
  for (const id of ["class-3d", "patient-3d"]) {
    const scenario = examples.get(id);
    assert.equal(scenario.category, "work");
    assert.equal(scenario.route, "agent");
    assert.match(scenario.prompt.en, /simple 3D model/);
    assert.match(scenario.prompt.zh, /三维模型/);
  }
  for (const character of "²°") assert.ok(ink.hasGlyph(character));
});

test("coding includes a real code review: a pasted screenshot with a bug to check", () => {
  const scenario = examples.get("code-bug");
  assert.equal(scenario.category, "code");
  assert.equal(scenario.action, "check_step");
  assert.equal(scenario.image.src, "examples/average-bug.jpg");
  assert.equal(examples.get("binary-search"), null);
  const pkg = require("../package.json");
  for (const photo of examples.SCENARIOS.filter((item) => item.image)) assert.ok(pkg.files.includes(`public/${photo.image.src}`), photo.image.src);
});
