"use strict";
require("./helpers/safety.js");
// The live picture of a running Work puts each step on one of ten stops. The cases are steps agents really took,
// which all used to land on Files: browser tools, PenEcho, helpers, background waits, git -C, gh and quoted pipes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseLine, parseAppServer } = require("../src/server/project-lines/activity.js");

const ctx = { esc:x => String(x), ic:name => `<i>${name}</i>`, agentInfo:() => ({ name:"A", mono:"A", color:"#000" }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/live.js"), "utf8"), ctx);
const stop = row => ctx.liveKind({ kind:"tool", target:"", ...row })[0];
const ran = command => stop({ verb:"Ran", target:command });

test("commands go to the stop of the program they run, not to Files", () => {
  assert.equal(ran("sed -n '1,80p' public/lines/live.js"), "files");
  assert.equal(ran(`grep -n "def a\\|node\\b" server/x.py | head -30`), "files");
  assert.equal(ran("git -C .claude/worktrees/x log --oneline -3"), "git");
  assert.equal(ran("git --no-pager diff --stat"), "git");
  assert.equal(ran("gh run list --repo erickong/penecho-cloud --limit 12"), "git");
  assert.equal(ran("cd mobile && npm run build 2>&1 | tail -2"), "tests");
  assert.equal(ran(".venv-mac/bin/python -m unittest tests.test_company_kb"), "tests");
  assert.equal(ran("node scripts/qa-projects-v1.cjs --page-tools-only"), "tests");
  assert.equal(ran("export PATH=$HOME/sdk:$PATH; adb devices; emulator -list-avds"), "browser");
  assert.equal(ran("ssh -i key -o BatchMode=yes root@host 'docker ps'"), "web");
  assert.equal(ran("until [ -f out/scores.json ]; do sleep 10; done; tail -5 out/log"), "helpers");
  assert.equal(ran("tail -1 /private/tmp/claude-501/x/tasks/b2dtpyqu5.output"), "helpers");
  assert.equal(ran("lsof -nP -iTCP:3888 -sTCP:LISTEN"), "tests");
  assert.equal(ran("rm -f deck.slide-01.html deck.slide-02.html"), "edit");
  assert.equal(ran("python3 - <<'PY'\nimport json\nprint(1)\nPY"), "files");
});

test("reading the project memory is not adding to it", () => {
  assert.deepEqual([...ctx.liveKind({ kind:"tool", verb:"Ran", target:"cat /Docs/MEMORY.md" })], ["memory", "Reading the project memory"]);
  assert.deepEqual([...ctx.liveKind({ kind:"tool", verb:"Ran", target:"sh '/Docs/.penecho/memory' apply <<'EOF'\n+ x\nEOF" })], ["memory", "Adding to the project memory"]);
  assert.equal(stop({ verb:"Edited", target:"/Docs/MEMORY.md" }), "memory");
});

test("tools from outside the agent go to the browser, the Canvas, helpers, you or the web", () => {
  for (const tool of ["navigate", "resize_window", "get_page_text", "read_console_messages", "find", "js", "app_click"]) assert.equal(stop({ verb:`Used ${tool}` }), "browser", tool);
  for (const tool of ["penecho_draw", "penecho_workspace_status", "start_session"]) assert.equal(stop({ verb:`Used ${tool}` }), "canvas", tool);
  for (const tool of ["SendMessage", "TaskStop", "Monitor", "claude_status"]) assert.equal(stop({ verb:`Used ${tool}` }), "helpers", tool);
  assert.equal(stop({ verb:"Used Artifact" }), "you");
  assert.equal(stop({ verb:"Used github.fetch" }), "web");
  assert.equal(stop({ verb:"Used ToolSearch" }), "files");
  // A tool from an MCP server nothing else knows is a service outside the agent.
  assert.equal(stop({ verb:"Used search_threads", via:"claude_ai_Gmail" }), "web");
});

test("rows keep the MCP server a tool came from", () => {
  const [claude] = parseLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t1", name:"mcp__claude_ai_penecho__penecho_draw", input:{} }] } }));
  assert.equal(claude.add.verb, "Used penecho_draw");
  assert.equal(claude.add.via, "claude_ai_penecho");
  const [codex] = parseAppServer({ method:"item/started", params:{ item:{ type:"mcpToolCall", id:"m1", server:"node_repl", tool:"js", status:"inProgress" } } });
  assert.equal(codex.upsert.via, "node_repl");
  assert.equal(stop(codex.upsert), "browser");
  const [plain] = parseLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t2", name:"ToolSearch", input:{} }] } }));
  assert.equal(plain.add.via, undefined);
});

test("a model call being tried again is the latest thing the live band says, and counts for no stop", () => {
  const rows = parseLine(JSON.stringify({ type:"system", subtype:"retry", attempt:2, of:8, why:"The answer stopped halfway." })).map(x => x.add).filter(Boolean);
  assert.equal(rows.length, 1);
  const st = ctx.liveState([{ kind:"tool", verb:"Read", target:"a/b.js" }, ...rows]);
  assert.equal(st.feed[0][0], "retry");
  assert.match(st.feed[0][1], /Trying again \(2 of 8\)/);
  assert.deepEqual({ ...st.counts }, { files:1 });
  assert.equal(st.phase, "retry");
  assert.equal(ctx.liveState(rows).feed.length, 1);
});

test("liveState distinguishes thinking (no running tool) from active tool calls", () => {
  // Freshly started work with no tools yet -> thinking
  const start = ctx.liveState([{ kind:"start", agent:"claude" }]);
  assert.equal(start.phase, "thinking");
  assert.equal(start.now, "");

  // Active running tool -> tool phase on that stop
  const running = ctx.liveState([
    { kind:"tool", id:"t1", verb:"Read", target:"public/lines/live.js", state:"done" },
    { kind:"tool", id:"t2", verb:"Edited", target:"public/lines/live.css", state:"running" },
  ]);
  assert.equal(running.phase, "tool");
  assert.equal(running.now, "edit");
  assert.equal(running.activeLabel, "Editing lines/live.css");
  assert.deepEqual({ ...running.counts }, { files:1, edit:1 });

  // All tools completed -> thinking again, with counts preserved and no active tentacle
  const pondering = ctx.liveState([
    { kind:"tool", id:"t1", verb:"Read", target:"public/lines/live.js", state:"done" },
    { kind:"tool", id:"t2", verb:"Edited", target:"public/lines/live.css", state:"done" },
    { kind:"say", text:"Considering the next step." },
  ]);
  assert.equal(pondering.phase, "thinking");
  assert.equal(pondering.now, "");
  assert.deepEqual({ ...pondering.counts }, { files:1, edit:1 });
  assert.equal(pondering.say, "Considering the next step.");
});

test("paintLive renders Thought Pearl ? while thinking, pops ! spark on transition to a tool, then lights the tool stop", () => {
  const { parseHTML } = require("./helpers/dom.js");
  const { document } = parseHTML("<!doctype html><div id='host'></div>");
  const host = document.getElementById("host");
  Object.defineProperty(host, "clientWidth", { value:640 });

  let scheduled = null;
  let now = 1_700_000_000_000;
  const domCtx = {
    esc:x => String(x),
    ic:name => `<svg class="ic" data-ic="${name}"></svg>`,
    agentInfo:() => ({ name:"Antigravity", mono:"Ag", color:"#1a73e8" }),
    Date:{ now:() => now },
    setTimeout:(fn, ms) => { scheduled = { fn, ms }; return 1; },
    clearTimeout:() => { scheduled = null; },
  };
  vm.createContext(domCtx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/live.js"), "utf8"), domCtx);

  // 1. Thinking state after a completed Read (with LLM text output shown instead of an action list)
  const doneRead = [
    { kind:"say", text:"Timing fault found: checking `public/lines/live.js` before editing." },
    { kind:"tool", id:"r1", verb:"Read", target:"public/lines/live.js", state:"done" },
  ];
  domCtx.paintLive(host, "antigravity", doneRead, now - 60_000);
  const band = host.querySelector(".lv");
  assert.ok(band.classList.contains("is-thinking"));
  assert.ok(!band.classList.contains("is-aha"));
  assert.equal(band.querySelector(".lv-now-label").textContent, "Thinking");
  assert.equal(band.querySelector(".lv-state-pill").textContent, "?");
  assert.equal(band.querySelector(".lv-state-pill").hidden, false);
  assert.ok(band.querySelector(".lv-thought .lv-glyph-q"));
  assert.ok(band.querySelector(".lv-thought .lv-glyph-e"));
  assert.ok(band.querySelector(".lv-leg[data-stop='files']").classList.contains("used"));
  assert.ok(!band.querySelector(".lv-leg[data-stop='files']").classList.contains("now"));
  assert.equal(band.querySelector(".lv-dot").hasAttribute("hidden"), true);
  assert.equal(band.querySelector(".lv-feed"), null, "live card shows LLM text output, not a duplicate action list");
  assert.equal(band.querySelector(".lv-say").hidden, false);
  assert.match(band.querySelector(".lv-say").textContent, /Timing fault found: checking public\/lines\/live\.js before editing\./);
  assert.equal(band.querySelector(".lv-say code").textContent, "public/lines/live.js");

  // 2. Thinking finishes and a new Edit tool starts -> brief "!" aha spark beat
  const startEdit = [...doneRead, { kind:"tool", id:"e1", verb:"Edited", target:"public/lines/live.css", state:"running" }];
  now += 2000;
  domCtx.paintLive(host, "antigravity", startEdit, now - 62_000);
  assert.ok(band.classList.contains("is-aha"));
  assert.ok(!band.classList.contains("is-thinking"));
  assert.equal(band.querySelector(".lv-now-label").textContent, "Ready — next step");
  assert.equal(band.querySelector(".lv-state-pill").textContent, "!");
  assert.equal(band.querySelector(".lv-state-pill").hidden, false);
  assert.equal(band.querySelector(".lv-dot").hasAttribute("hidden"), true);
  assert.ok(scheduled && scheduled.ms > 0);

  // 3. After the aha beat timer completes -> active tool lights up while LLM text stays shown
  now += scheduled.ms + 10;
  const fire = scheduled.fn;
  scheduled = null;
  fire();
  assert.ok(!band.classList.contains("is-aha"));
  assert.ok(!band.classList.contains("is-thinking"));
  assert.equal(band.querySelector(".lv-now-label").textContent, "Editing lines/live.css");
  assert.equal(band.querySelector(".lv-state-pill").hidden, true);
  assert.ok(band.querySelector(".lv-leg[data-stop='edit']").classList.contains("now"));
  assert.ok(band.querySelector(".lv-stop[data-stop='edit']").classList.contains("now"));
  assert.equal(band.querySelector(".lv-dot").hasAttribute("hidden"), false);
  assert.equal(band.querySelector(".lv-say").hidden, false);

  // 4. Tool finishes -> returns smoothly to thinking (?) without triggering another aha; new LLM text replaces old
  const doneEdit = [
    ...doneRead,
    { kind:"tool", id:"e1", verb:"Edited", target:"public/lines/live.css", state:"done" },
    { kind:"say", text:"Updated **live.css**.\n\nNext verifying the layout." },
  ];
  now += 2000;
  domCtx.paintLive(host, "antigravity", doneEdit, now - 65_000);
  assert.ok(band.classList.contains("is-thinking"));
  assert.ok(!band.classList.contains("is-aha"));
  assert.equal(band.querySelector(".lv-state-pill").textContent, "?");
  assert.equal(band.querySelectorAll(".lv-say p").length, 2);
  assert.equal(band.querySelector(".lv-say strong").textContent, "live.css");

  // 5. Compact (small) mode also shows LLM text instead of actions
  const smallHost = document.createElement("div");
  Object.defineProperty(smallHost, "clientWidth", { value:340 });
  domCtx.paintLive(smallHost, "antigravity", doneEdit, now - 65_000);
  assert.equal(smallHost.querySelector(".lv-feed"), null);
  assert.equal(smallHost.querySelector(".lv-say").hidden, false);
  assert.match(smallHost.querySelector(".lv-say").textContent, /Updated live\.css/);

  // 6. Without any LLM text yet, .lv-say stays hidden (and no action list is rendered)
  const noSayHost = document.createElement("div");
  Object.defineProperty(noSayHost, "clientWidth", { value:640 });
  domCtx.paintLive(noSayHost, "antigravity", [{ kind:"tool", id:"r1", verb:"Read", target:"a/b.js", state:"running" }], now - 5_000);
  assert.equal(noSayHost.querySelector(".lv-feed"), null);
  assert.equal(noSayHost.querySelector(".lv-say").hidden, true);
});
