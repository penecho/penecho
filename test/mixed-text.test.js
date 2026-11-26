"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const MIXED_TEXT = require("../public/mixed-text");

test("mixed text preserves the original source and every explicit line", () => {
  const source = "first line\n\nthird line\n",
    parsed = MIXED_TEXT.parse(source);
  assert.equal(parsed.source, source);
  assert.equal(parsed.normalized, source);
  assert.deepEqual(parsed.lines.map((line) => line.raw), ["first line", "", "third line", ""]);
  assert.equal(parsed.lines[1].segments.length, 0);
  assert.equal(parsed.lines[3].segments.length, 0);
});

test("mixed text recognizes basic Markdown, delimited TeX, and conservative bare TeX", () => {
  const parsed = MIXED_TEXT.parse("# **Velocity**: $v=\\frac{d}{t}$, A_x^y, \\sqrt{x}"),
    line = parsed.lines[0],
    formulas = line.segments.filter((segment) => segment.type === "math");
  assert.equal(line.kind, "heading");
  assert.equal(line.level, 1);
  assert.equal(line.segments.find((segment) => segment.text?.includes("Velocity"))?.bold, true);
  assert.deepEqual(formulas.map((segment) => segment.tex), ["v=\\frac{d}{t}", "A_x^y", "\\sqrt{x}"]);
  assert.deepEqual(formulas.map((segment) => segment.raw), ["$v=\\frac{d}{t}$", "A_x^y", "\\sqrt{x}"]);
});

test("mixed text supports list prefixes, code spans, and nested fraction groups", () => {
  const bullet = MIXED_TEXT.parse("- use `A_x^y` then \\frac{\\sqrt{x}}{1+x}").lines[0];
  assert.equal(bullet.kind, "bullet");
  assert.equal(bullet.segments[0].text, "\u2022 ");
  assert.equal(bullet.segments.find((segment) => segment.text === "A_x^y")?.code, true);
  assert.equal(bullet.segments.filter((segment) => segment.type === "math").at(-1).tex, "\\frac{\\sqrt{x}}{1+x}");

  const ordered = MIXED_TEXT.parse("12) item").lines[0];
  assert.equal(ordered.kind, "ordered");
  assert.equal(ordered.segments[0].text, "12. ");
});

test("invalid, escaped, or ambiguous markup remains literal text", () => {
  for (const source of ["$unfinished A_x^y", "\\frac{", "**unfinished", "**a*", "***a**", "\\*literal*", "\\**literal**", "\\_literal_", "\\\\alpha", "file_name", "https://example.test/file_name", "a * b * c", "a*b*c", "** bold **", "Cost $5 and $10"]) {
    const segments = MIXED_TEXT.parse(source).lines[0].segments;
    assert.equal(segments.some((segment) => segment.type === "math"), false, source);
    assert.equal(segments.map((segment) => segment.text || segment.raw).join(""), source);
  }
});

test("inline code protects formula-like text while later bare math still parses", () => {
  const segments = MIXED_TEXT.tokenizeInline("`A_x^y` and A_x^y");
  assert.deepEqual(segments.map((segment) => segment.type), ["text", "text", "math"]);
  assert.equal(segments[0].code, true);
  assert.equal(segments[0].text, "A_x^y");
  assert.equal(segments[2].tex, "A_x^y");
});

test("bare TeX commands with groups and function arguments parse without dollar delimiters", () => {
  const source = "\\pi, \\vec{v}, \\sum_{i=1}^{n}, \\sin(x), and A_x^2",
    formulas = MIXED_TEXT.parse(source).lines[0].segments.filter((segment) => segment.type === "math");
  assert.deepEqual(formulas.map((segment) => segment.tex), ["\\pi", "\\vec{v}", "\\sum_{i=1}^{n}", "\\sin(x)", "A_x^2"]);
});
