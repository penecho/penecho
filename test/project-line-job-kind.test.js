"use strict";
require("./helpers/safety.js");
// What a job is about, read from its words with no model call (job-kind.js, PE-1085).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { jobKind, KINDS } = require("../src/server/project-lines/job-kind.js");

const CLEAR = [
  ["code", "Find and fix the bug described below, add a test for it and report what changed."],
  ["code", "Fix the login crash on Android"],
  ["code", "The build fails on CI with TypeError: x is not a function in src/server/app.js"],
  ["code", "Refactor the payment module and add unit tests"],
  ["code", "Build a small web app that tracks my habits"],
  ["code", "Add a dark mode toggle to the settings page"],
  ["code", "Write a Python script that renames the photos by date"],
  ["code", "Design a database schema for orders and write the migration"],
  ["code", "Fix the docs build script"],
  ["code", "修复登录页面的报错"],
  ["code", "帮我写一个脚本，把这些文件批量重命名"],
  ["code", "Remove the second checkbox and make the list sort by name"],
  ["design", "Design a logo for my coffee shop"],
  ["design", "Redesign the onboarding screens so they feel calmer"],
  ["design", "Draw a diagram of how the sync works"],
  ["design", "Make a clickable prototype of the checkout flow"],
  ["design", "Give me three colour palettes for the landing page"],
  ["design", "Model a low-poly chair in Blender"],
  ["design", "设计一个登录界面的原型"],
  ["design", "The reason should also be in Line detail page. pls design first, do not implement codes"],
  ["research", "Compare Postgres and SQLite for a small desktop app and recommend one"],
  ["research", "Research how other note apps price their sync plans"],
  ["research", "Investigate why our sign-ups dropped last week"],
  ["research", "Look up the current list prices for these models"],
  ["research", "Why is the app slow when ten jobs run?"],
  ["research", "Pls check if the cloud removed my folder cleanly"],
  ["research", "调研一下竞品的定价"],
  ["research", "will this manual triggered review update models's rating score?"],
  ["docs", "Make a short deck from the attached meeting notes that explains the decisions to the team."],
  ["docs", "Write a README for this project"],
  ["docs", "Summarize the attached report in one page"],
  ["docs", "Translate this article into English"],
  ["docs", "Draft an email to the customers about the new pricing"],
  ["docs", "Update the docs for the new API"],
  ["docs", "把会议纪要整理成一份周报"],
  ["docs", "Proofread my cover letter"],
  ["chat", "What do you think about charging per seat?"],
  ["chat", "Ask two agents for their view on this plan, compare their answers and recommend one."],
  ["chat", "Explain how OAuth refresh tokens work"],
  ["chat", "What's the difference between TCP and UDP?"],
  ["chat", "hello"],
  ["chat", "Let's brainstorm names for the product"],
  ["chat", "你觉得这个方案怎么样？"],
];

test("clear requests are read as the kind of job they are, in English and Chinese", () => {
  assert.deepEqual(KINDS, ["code", "chat", "design", "research", "docs"]);
  for (const [want, text] of CLEAR) assert.equal(jobKind(text).kind, want, text);
});

test("words that do not say give no kind, rather than a guess", () => {
  for (const text of ["Do the thing we talked about", "continue", "", "   ", null, undefined]) {
    assert.deepEqual([jobKind(text).kind, jobKind(text).from], ["", []], String(text));
  }
});

test("it says which words decided it, the strongest first and three at most", () => {
  const fix = jobKind("Fix the login crash on Android");
  assert.equal(fix.from[0], "“fix”");
  assert.ok(fix.from.length <= 3 && fix.from.includes("“crash”"), fix.from.join(", "));
  // A question about the person's own work needs looking into; one about the world is a chat.
  assert.deepEqual(jobKind("will this manual triggered review update models's rating score?").from.slice(0, 1), ["a question about your own work"]);
  assert.ok(jobKind("What's the difference between TCP and UDP?").from.includes("a question"));
  // The same words always give the same answer.
  assert.deepEqual(jobKind("Compare Postgres and SQLite"), jobKind("Compare Postgres and SQLite"));
});

test("the Make choice of the box decides before any word", () => {
  assert.deepEqual(jobKind("Fix the failing tests", { make:{ kind:"slides" } }), { kind:"docs", from:["Make: slides"] });
  assert.deepEqual(jobKind("Anything", { make:{ kind:"card" } }), { kind:"docs", from:["Make: card"] });
  assert.deepEqual(jobKind("Anything", { make:{ kind:"diagram" } }), { kind:"design", from:["Make: diagram"] });
  assert.equal(jobKind("Anything", { make:{ kind:"explorer" } }).kind, "design");
  // A Make choice this does not know is no hint.
  assert.equal(jobKind("Fix the failing tests", { make:{ kind:"something" } }).kind, "code");
});

test("what the project's jobs usually are is one more hint, never for a question", () => {
  // With words that say nothing, the usual kind stands in and says so.
  const stoodIn = jobKind("Do the thing we talked about", { usual:"code" });
  assert.deepEqual([stoodIn.kind, stoodIn.from], ["code", ["like most jobs in this project"]]);
  assert.equal(jobKind("continue", { usual:"docs" }).kind, "docs");
  // It tips a close call and is named among the reasons.
  assert.equal(jobKind("Change the tone to be friendlier").kind, "code");
  const tipped = jobKind("Change the tone to be friendlier", { usual:"docs" });
  assert.equal(tipped.kind, "docs");
  assert.deepEqual(tipped.from, ["“tone”", "like most jobs in this project"]);
  // Clear words still win over it.
  assert.equal(jobKind("Design a logo for my coffee shop", { usual:"code" }).kind, "design");
  assert.equal(jobKind("Research how other note apps price their sync plans", { usual:"code" }).kind, "research");
  // A question is not pushed to the usual kind.
  assert.equal(jobKind("What do you think about charging per seat?", { usual:"code" }).kind, "chat");
  assert.equal(jobKind("anything", { usual:"nonsense" }).kind, "");
});

test("where a file is and what a link points to do not count as words of the request", () => {
  const plain = jobKind("Translate the attached page into English");
  const withPlaces = jobKind("Translate the attached page into English. Work file: /Users/me/code/tests/debug/server/work-4.md, see https://example.com/api/github/deploy/item42");
  assert.equal(plain.kind, "docs");
  assert.equal(withPlaces.kind, "docs");
  assert.equal(withPlaces.scores.code, plain.scores.code, "the folders of a path and of a link add nothing");
  // The file's own name is still a word of the request.
  assert.deepEqual(jobKind("Look at /Users/me/notes/drafts/server.js").from, ["“server.js”"]);
});

test("a long paste counts as a few words, and less the further down it is", () => {
  const line = "TypeError: handler crashed in server.js";
  const once = jobKind(`Summarize this log.\n${line}`), often = jobKind(`Summarize this log.\n${Array(80).fill(line).join("\n")}`);
  assert.equal(often.scores.code, once.scores.code, "the same words eighty times count once");
  const request = "Write a short summary of the notes below for the team newsletter.";
  const far = jobKind(`${request}\n${"Lorem ipsum dolor sit amet. ".repeat(50)}\n${line}`);
  assert.equal(far.kind, "docs");
  assert.ok(far.scores.code > 0 && far.scores.code < jobKind(`${request}\n${line}`).scores.code);
  // Reading stops after the first 6,000 characters.
  assert.equal(jobKind(`${"lorem ipsum ".repeat(600)} fix the failing tests`).kind, "");
});

test("words that rule code out are heard", () => {
  assert.equal(jobKind("Look at the settings page and propose a new layout. Do not change any code.").kind, "design");
  assert.equal(jobKind("先设计一下新的登录页面，不要写代码").kind, "design");
});
