"use strict";
// Sketch illustration styles: one maintained English policy per style and background
// mode, shared by Canvas AI, the Agent route and Widget Refine, chosen in Settings.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const STYLE = require("../src/shared/illustration-style.js");
const SMART = require("../public/smart-suggest.js");
const read = file => fs.readFileSync(require.resolve(`../${file}`), "utf8");

test("each style and background mode has one complete English policy", () => {
  assert.deepEqual([...STYLE.STYLES], ["storybook", "3d"]);
  assert.deepEqual([...STYLE.BACKGROUNDS], ["auto", "none"]);
  assert.equal(STYLE.normalize("neon"), "storybook");
  assert.equal(STYLE.normalizeBackground("forest"), "auto");
  for (const style of STYLE.STYLES) for (const background of STYLE.BACKGROUNDS) {
    const prompt = STYLE.canvasPrompt(style, background), agent = STYLE.agentPrompt(style, background);
    assert.ok(prompt.length <= 2000, `${style}/${background} stays within the reviewed size`);
    assert.doesNotMatch(prompt + agent, /[一-鿿]/, "maintained prompts are English");
    for (const text of [prompt, agent]) {
      // Fidelity: every subject, repeated parts and drawn colours survive.
      // Render what was drawn: every subject, part and detail, and nothing invented on the subjects.
      assert.match(text, /Render the subjects as drawn: every drawn subject, part and detail[\s\S]*drawn number, place, size, pose, facing and expression/);
      assert.match(text, /add no parts, hair, ears, clothing, accessories or held props that were not drawn/);
      assert.match(text, /Drawn colours other than default dark ink set each part's colour family; skin may stay natural/);
      assert.match(text, /Several subjects share one scene/);
      // A background the user drew is always kept, in both modes.
      assert.match(text, /keep any drawn ground, sky, sun, plants, water or buildings in place/);
    }
    assert.match(prompt, /Return exactly one html_widget \(pluginId general\)[\s\S]*in free space beside the sketch/);
    assert.match(agent, /Inspect the rendered result/);
    if (background === "none") assert.match(prompt, /Add no scenery of your own/);
    else assert.match(prompt, /If none were drawn, add a (simple setting|soft studio scene) that suits the subjects/);
  }
  assert.match(STYLE.canvasPrompt("storybook"), /picture-book illustration[\s\S]*never sticks, tubes or plain stacked circles[\s\S]*pastel[\s\S]*thin even warm dark brown-grey outlines/);
  assert.match(STYLE.canvasPrompt("3d"), /soft 3D illustration, like a glossy vinyl toy[\s\S]*gradients that model every form \(gradients fill closed shapes, never strokes\), crisp specular highlights/);
  assert.match(STYLE.canvasPrompt("3d", "auto"), /soft studio scene/);
  assert.equal(STYLE.canvasPrompt(), STYLE.canvasPrompt("storybook", "auto"));
});

test("labels name the selected style in the Suggest bar and Widget Refine", () => {
  assert.equal(STYLE.label("storybook", "en"), "Storybook illustration");
  assert.equal(STYLE.label("3d", "zh"), "立体插画");
  assert.equal(STYLE.normalize("vivid"), "storybook", "the earlier test value falls back to the default");
  const vivid = SMART.actionById("vivid");
  for (const style of STYLE.STYLES) for (const language of ["en", "zh"])
    assert.equal(SMART.label(vivid, language, { illustrationStyle:style }), STYLE.label(style, language));
  assert.match(STYLE.widgetInstruction("storybook", "none"), /picture-book[\s\S]*Add no scenery of your own[\s\S]*Refine this widget in place/);
  assert.match(STYLE.widgetInstruction("3d", "auto"), /soft 3D illustration[\s\S]*soft studio backdrop[\s\S]*Refine this widget in place/);
});

test("a separate Widget keeps the illustration policy and changes only the destination", () => {
  for(const style of STYLE.STYLES)for(const background of STYLE.BACKGROUNDS){
    const existing=STYLE.widgetInstruction(style,background),separate=STYLE.widgetInstruction(style,background,{inPlace:false});
    assert.equal(separate,existing.replace("Refine this widget in place.","Create one separate illustrated Widget beside the original. Preserve the original Widget unchanged."));
    assert.doesNotMatch(separate,/Refine this widget in place/);
  }
});

test("Settings offer both choices and every executor reads them", () => {
  const html = read("public/index.html"), core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
  for (const [id, values] of [["illustrationStyle", ["storybook", "3d"]], ["illustrationBackground", ["auto", "none"]]]) {
    const select = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`));
    assert.ok(select, id);
    assert.deepEqual([...select[0].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), values);
  }
  for (const key of ["illustrationStyle", "illustrationStyleStorybook", "illustrationStyle3d", "illustrationBackground", "illustrationBackgroundAuto", "illustrationBackgroundNone", "settingsIllustrationStyleHelp", "settingsIllustrationBackgroundHelp", "canvasAgentPromptIllustrate3d"]) {
    assert.match(core, new RegExp(`(^|\\s)${key}:`, 'm'), `en ${key}`);
    assert.match(zh, new RegExp(`(^|\\s)${key}:`, 'm'), `zh ${key}`);
  }
  assert.match(read("src/client/app/ai-runtime.js"), /suggestion === "vivid" \? \{ illustrationStyle:PenEchoIllustrationStyle\.normalize\(state\.illustrationStyle\), illustrationBackground:PenEchoIllustrationStyle\.normalizeBackground\(state\.illustrationBackground\) \}/);
  assert.match(read("src/client/app/assist-agent.js"), /id==="vivid"\?PenEchoIllustrationStyle\.agentPrompt\(state\.illustrationStyle,state\.illustrationBackground\)/);
  assert.match(read("src/client/app/widget-assist.js"), /PenEchoIllustrationStyle\.widgetInstruction\(state\.illustrationStyle, state\.illustrationBackground, \{ inPlace:false \}\)/);
  assert.ok(read("scripts/build-client.js").includes('"src/shared/illustration-style.js"'));
});

test("the Canvas AI suggestion map uses the shared default policy", () => {
  const source = read("src/server/main.js"), focus = source.match(/const SUGGESTION_FOCUS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  const policy = source.slice(source.indexOf("const CREATE_VISUAL_POLICY ="),source.indexOf("const SUGGESTION_FOCUS ="));
  const map = vm.runInNewContext(`${policy}\n(${focus[1]})`, { FINISH_DRAWING:require("../src/shared/finish-drawing.js"), SKETCH_PUPPET:require("../src/shared/sketch-puppet.js"), NOTE_CARD:require("../public/note-card.js"), ILLUSTRATION_STYLE:STYLE });
  assert.equal(map.vivid[0], "plot");
  assert.equal(map.vivid[1], STYLE.canvasPrompt("storybook", "auto"));
});
