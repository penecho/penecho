"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { after, test } = require("node:test");
const { parseHTML } = require("./helpers/dom.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");

const cases = [
  {
    name:"a period after the date never jumps to a later service colon",
    source:"Status on 2026-11-21. The Line page's right-hand side panel can now pop out into a centered larger modal view; **New project** waits; ECS `meetcue-production-api:70`, both tasks healthy and verified live): all text remains status.",
    date:"2026-11-21",
    body:"The Line page's right-hand side panel can now pop out into a centered larger modal view; **New project** waits; ECS `meetcue-production-api:70`, both tasks healthy and verified live): all text remains status.",
    text:"The Line page's right-hand side panel can now pop out into a centered larger modal view; New project waits; ECS meetcue-production-api:70, both tasks healthy and verified live): all text remains status.",
  },
  {
    name:"a colon delimiter and URL colons in the body",
    source:"Status on 2026-11-21: Built; see https://example.test:8443/health?a=1 and meetcue-production-api:70.",
    date:"2026-11-21",
    body:"Built; see https://example.test:8443/health?a=1 and meetcue-production-api:70.",
  },
  {
    name:"an em dash delimiter",
    source:"Status on 2026-11-21 — In progress — owner review: Friday.",
    date:"2026-11-21",
    body:"In progress — owner review: Friday.",
  },
  {
    name:"a day-before-month date with a period",
    source:"Status on 19 November 2026. **Agreed**, not built.",
    date:"19 November 2026",
    body:"**Agreed**, not built.",
    text:"Agreed, not built.",
  },
  {
    name:"a month-before-day date",
    source:"Status on November 19, 2026: Deployed.",
    date:"November 19, 2026",
    body:"Deployed.",
  },
  {
    name:"an unusual date falls back without inventing metadata",
    source:"Status on soon: keep service:70 in the body",
    date:"",
    body:"soon: keep service:70 in the body",
  },
  {
    name:"an ISO datetime is not split at its time colon",
    source:"Status on 2026-11-21T10:30: keep all of this",
    date:"",
    body:"2026-11-21T10:30: keep all of this",
  },
];

const readPublic = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const project = { id:"p", name:"Garden", knowledge:[{ path:"topics/status.md", title:"Status test", lines:[] }], lines:[], landed:[], backlog:[] };
const context = vm.createContext({
  console, document:parseHTML("<html><body></body></html>").document,
  ACT:{}, S:{ route:{ view:"topics" } }, TOPIC_WORDS:{}, project:() => project,
  esc, ic:() => "", slug:s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  resolvePath:(_base, href) => href, linkedPath:(_base, href) => href, docByPath:() => null, assetUrl:() => "",
  allLines:p => [...p.lines, ...p.landed, ...p.backlog], av:() => "", agentInfo:() => ({ name:"" }),
  topicCounts:() => () => ({ open:0, done:0 }), countsHTML:() => "", topicNodeOf:() => "quiet",
  topicsBuilding:() => null, plural:(n, one, many) => `${n} ${n === 1 ? one : many}`,
  isPicturePath:() => false, $:() => null, $$:() => [], addEventListener() {},
});
for (const name of ["markdown.js", "topics-page.js"]) vm.runInContext(readPublic(name), context, { filename:name });

function renderDoc(md) {
  context.p = project; context.doc = { path:"topics/status.md", md };
  const html = vm.runInContext("tpxTopicHTML(p, doc)", context);
  return parseHTML(`<html><body>${html}</body></html>`).document;
}

function renderStatus(source) {
  const md = `---\nrecord_type: topic\ntitle: Status test\nupdated: 2026-11-21\n---\n\n# Status test\n\n**A parser test.**\n\n${source}\n\n## At a glance\n\n| # | Requirement | Status |\n| --- | --- | --- |\n| R1 | Broken thing | 🐞 Problem |\n\n## Requirements\n\n### R1 · Broken thing — 🐞 Problem\n\nIt must render safely.\n`;
  return renderDoc(md);
}

for (const item of cases) {
  test(`client and server status parsers match: ${item.name}`, () => {
    const serverParsed = Knowledge.parseStatus(item.source);
    context._src = item.source;
    const clientParsed = { ...vm.runInContext("tpxParseStatus(_src)", context) };
    assert.deepEqual(serverParsed, { date:item.date, body:item.body });
    assert.deepEqual(clientParsed, serverParsed);
  });
  test(`client Topic status rendering: ${item.name}`, () => {
    const document = renderStatus(item.source), status = document.querySelector(".tpx-status");
    assert.ok(status);
    assert.equal(status.classList.contains("has-time"), Boolean(item.date));
    assert.equal(status.querySelector("time")?.textContent || "", item.date);
    assert.equal(status.querySelector(":scope > span").textContent.trim(), item.text || item.body);
    if (item.name.startsWith("a period")) assert.ok(!status.querySelector(":scope > span").textContent.startsWith("70,"));
  });
  test(`server Topic status parsing: ${item.name}`, () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-topic-status-case-"));
    try {
      fs.mkdirSync(path.join(docs, "topics"));
      fs.writeFileSync(path.join(docs, "topics", "status.md"), `---\ntitle: Status test\n---\n\n# Status test\n\n${item.source}\n`);
      assert.equal(Knowledge.topicsOf(docs)[0].status, item.text || item.body);
    } finally { fs.rmSync(docs, { recursive:true, force:true }); }
  });
}

test("all remaining date delimiters, abbreviated months, date-only and bare Status on", () => {
  for (const delimiter of ["–", "-", " "]) {
    assert.deepEqual(Knowledge.parseStatus(`Status on 2026-11-21 ${delimiter} Body: with colon`), { date:"2026-11-21", body:"Body: with colon" });
  }
  assert.deepEqual(Knowledge.parseStatus("Status on Nov. 19, 2026 Body"), { date:"Nov. 19, 2026", body:"Body" });
  assert.deepEqual(Knowledge.parseStatus("Status on 19 Sept 2026. Body"), { date:"19 Sept 2026", body:"Body" });
  assert.deepEqual(Knowledge.parseStatus("Status on 2026-11-21"), { date:"2026-11-21", body:"" });
  assert.deepEqual(Knowledge.parseStatus("Status on"), { date:"", body:"" });

  const dateOnly = renderStatus("Status on 2026-11-21").querySelector(".tpx-status");
  assert.ok(dateOnly);
  assert.equal(dateOnly.classList.contains("has-time"), true);
  assert.equal(dateOnly.querySelector("time")?.textContent, "2026-11-21");
  assert.equal(dateOnly.querySelector(":scope > span"), null);

  const bare = renderStatus("Status on").querySelector(".tpx-status");
  assert.equal(bare, null);
});

test("server statusOf and client tpxParse agree on frontmatter, code fences, sections and multiline CRLF paragraphs", () => {
  const scenarios = [
    {
      name:"Status on inside Requirements is ignored when intro has no status",
      md:"---\ntitle: No intro\n---\n\n# No intro\n\n**Goal.**\n\n## Requirements\n\nStatus on 2026-11-21. Example inside requirements.\n",
      expected:"",
    },
    {
      name:"Status on inside Traps is ignored when intro has no status",
      md:"---\ntitle: Traps\n---\n\n# Traps\n\n**Goal.**\n\n## Traps\n\nStatus on 2026-11-21. Example inside traps.\n",
      expected:"",
    },
    {
      name:"Status on inside an intro fenced code block is ignored",
      md:"---\ntitle: Fenced\n---\n\n# Fenced\n\n**Goal.**\n\n```md\nStatus on 2026-11-21. Example inside fence.\n```\n\n## Requirements\n",
      expected:"",
    },
    {
      name:"Status on inside frontmatter is ignored",
      md:"---\ntitle: Frontmatter\nnote: |\nStatus on 2026-11-21. Example inside frontmatter.\n---\n\n# Frontmatter\n\n**Goal.**\n",
      expected:"",
    },
    {
      name:"Multiline CRLF intro status paragraph joins lines identically",
      md:"---\r\ntitle: CRLF\r\n---\r\n\r\n# CRLF\r\n\r\n**Goal.**\r\n\r\nStatus on 2026-11-21. First\r\nsecond line with `svc:70`.\r\n\r\n## Requirements\r\n",
      expected:"First second line with svc:70.",
    },
  ];
  for (const sc of scenarios) {
    assert.equal(Knowledge.statusOf(sc.md), sc.expected, `server: ${sc.name}`);
    const doc = renderDoc(sc.md), banner = doc.querySelector(".tpx-status");
    const clientBody = banner?.querySelector(":scope > span")?.textContent.trim() || "";
    assert.equal(clientBody, sc.expected, `client: ${sc.name}`);
  }
});

test("Problem requirements emit a ring arc and a red CSS stroke", () => {
  const document = renderStatus(cases[0].source);
  assert.equal(document.querySelectorAll(".tpx-ring circle.rg-problem").length, 1);
  assert.match(document.querySelector(".tpx-ring").textContent, /Problem/);
  assert.match(readPublic("topics-page.css"), /\.rg-problem\s*\{\s*stroke:\s*var\(--red\);\s*\}/);
});

test("unrecognized requirement status chips allow wrapping instead of overflowing", () => {
  const longStatus = "CustomUnbrokenStatusLabel".repeat(4);
  const md = `---\nrecord_type: topic\ntitle: Chip test\n---\n\n# Chip test\n\n## Requirements\n\n### R1 · Long chip — ${longStatus}\n\nDetails.\n`;
  const document = renderDoc(md);
  const chips = [...document.querySelectorAll(".tpx-st.st-none")];
  assert.ok(chips.length >= 2);
  assert.equal(chips[0].textContent.trim(), longStatus);
  assert.match(readPublic("topics-page.css"), /\.tpx-st\.st-none\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-topic-real-docs-"));
const real = process.env.PENECHO_TOPICS_DOCS;
after(() => fs.rmSync(temp, { recursive:true, force:true }));
test("Knowledge and client agree on every real Topic status in PENECHO_TOPICS_DOCS", { skip:!real }, () => {
  const topicsDir = path.join(real, "topics");
  const names = fs.readdirSync(topicsDir).filter(n => n.endsWith(".md")).sort();
  assert.ok(names.length > 0, "expected at least one Topic markdown file");
  const topics = new Map(Knowledge.topicsOf(real).map(t => [t.path, t]));
  for (const name of names) {
    const md = fs.readFileSync(path.join(topicsDir, name), "utf8");
    const topic = topics.get(`topics/${name}`);
    assert.ok(topic, `missing topics/${name}`);
    const document = renderDoc(md);
    const clientBody = document.querySelector(".tpx-status > span")?.textContent.replace(/\s+/g, " ").trim() || "";
    const serverBody = topic.status.replace(/\s+/g, " ").trim();
    assert.equal(serverBody, clientBody.replace(/[*_`~]/g, ""), name);
    assert.equal(clientBody.startsWith("70,"), false, name);
    assert.equal(/^Status on\b/i.test(clientBody), false, name);
  }
});
