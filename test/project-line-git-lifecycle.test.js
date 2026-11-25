"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const F = require("../src/server/project-lines/format.js");

async function until(fn, label = "condition", timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-git-lifecycle-")));
test.after(() => fs.rmSync(rootDir, { recursive:true, force:true }));

const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
  cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"],
}).trim();

let seq = 0;

function makeFakeAgents(scriptPath, promptLog) {
  return createAgents({
    env:{ PATH:"" },
    extra:{
      fake:{
        name:"Fake",
        mono:"Fk",
        color:"#000",
        role:"Build",
        resolve:() => ({ command:process.execPath, prefixArgs:[scriptPath] }),
        command:(launch, opts = {}) => ({
          command:launch.command,
          args:launch.prefixArgs,
          cwd:opts.workdir,
          env:{
            ...process.env,
            FAKE_PROMPT_LOG:promptLog,
            FAKE_INSTRUCTIONS:opts.instructions || "",
            FAKE_WORKDIR:opts.workdir || "",
            FAKE_GIT_DIR:opts.gitDir || "",
          },
          stdin:true,
        }),
      },
    },
  });
}

function makeEnv(t, { withCode = true, initGit = false, subFolder = "" } = {}) {
  const dir = path.join(rootDir, `case-${++seq}`);
  const stateDir = path.join(dir, "state");
  const docs = path.join(dir, "docs");
  const codeBase = path.join(dir, "code");
  const code = withCode ? (subFolder ? path.join(codeBase, subFolder) : codeBase) : null;
  fs.mkdirSync(stateDir, { recursive:true });
  if (code) fs.mkdirSync(code, { recursive:true });
  if (code && initGit) {
    gitIn(codeBase, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(code, "README.md"), "hello\n");
    gitIn(codeBase, "add", "-A");
    gitIn(codeBase, "commit", "-q", "-m", "initial");
  } else if (code) {
    fs.writeFileSync(path.join(code, "app.txt"), "plain folder\n");
  }

  const promptLog = path.join(dir, "prompts.jsonl");
  const scriptPath = path.join(dir, "fake-agent.js");
  fs.writeFileSync(scriptPath, `
    const fs = require("node:fs");
    const path = require("node:path");
    const { execFileSync } = require("node:child_process");
    const say = o => console.log(JSON.stringify(o));
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      say({ type:"system", subtype:"init", session_id:"sess-" + Date.now() });
      fs.appendFileSync(process.env.FAKE_PROMPT_LOG, JSON.stringify({
        cwd: process.cwd(),
        workdir: process.env.FAKE_WORKDIR,
        gitDir: process.env.FAKE_GIT_DIR,
        instructions: process.env.FAKE_INSTRUCTIONS,
        prompt: input,
      }) + "\\n");
      const git = (...args) => execFileSync("git", ["-c", "user.name=Agent", "-c", "user.email=agent@test.local", ...args], { cwd: process.cwd(), stdio: "ignore" });
      if (input.includes("[DO_GIT_INIT]")) {
        say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t1", name:"Bash", input:{ command:"git init -b main && git add -A && git commit -m init" } }] } });
        git("init", "-q", "-b", "main");
        fs.writeFileSync(path.join(process.cwd(), "agent-init.txt"), "initialized\\n");
        git("add", "-A");
        git("commit", "-q", "-m", "agent init");
        say({ type:"user", message:{ content:[{ type:"tool_result", tool_use_id:"t1", content:"" }] } });
      }
      if (input.includes("[DO_FEATURE_BRANCH]")) {
        say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t2", name:"Bash", input:{ command:"git checkout -b feat/agent-branch && git add -A && git commit -m feature" } }] } });
        git("checkout", "-q", "-b", "feat/agent-branch");
        fs.writeFileSync(path.join(process.cwd(), "feat.txt"), "feature\\n");
        git("add", "-A");
        git("commit", "-q", "-m", "agent feature");
        say({ type:"user", message:{ content:[{ type:"tool_result", tool_use_id:"t2", content:"" }] } });
      }
      say({ type:"assistant", message:{ content:[{ type:"text", text:"Done cleanly." }] } });
      say({ type:"result", subtype:"success", is_error:false, result:"Done cleanly.", session_id:"sess-1" });
    });
  `);

  let lastRes = null;
  const agents = makeFakeAgents(scriptPath, promptLog);
  const serviceOptions = {
    directory:stateDir,
    agents,
    conversations:{ home:dir, saveDebounceMs:20 },
    autoWatch:false,
    recoverOnStart:false,
  };
  const api = createProjectLines({
    directory:stateDir,
    agents,
    serviceOptions,
    authorizeRead:() => null,
    authorizeWrite:() => null,
    readJson:async req => req._body ?? {},
    send:(_, status, data) => { lastRes = { status, data }; },
  });
  const service = api.service;
  service.presets = createAgentPresets({ file:path.join(stateDir, "agent-presets.json"), agents });
  const preset = service.presets.add({ name:"Fake", agent:"fake" });
  const orchestrator = createOrchestrator({ service, directory:stateDir });
  service.orchestrator = orchestrator;
  const project = service.store.create({ name:"Sample", docsPath:docs, ...(code ? { codePath:code } : {}) });
  project.follow = false;
  project.defaultAgent = "fake";
  service.store.save();

  const callApi = async (method, urlPath, body) => {
    lastRes = null;
    await api.handle({ method, headers:{}, _body:body }, {}, new URL(`http://localhost/api/lines${urlPath}`));
    return lastRes;
  };

  t.after(() => api.close());
  return { api, service, orchestrator, project, preset, code, codeBase, docs, dir, promptLog, callApi };
}

async function settled(service, project, slug) {
  let doc = null;
  await until(() => {
    doc = F.parseLine(service.readDoc(project, slug));
    return ["done", "ready", "stopped"].includes(doc.status) && !service.runs.has(service.key(project, slug));
  }, `line ${slug} to settle`);
  return doc;
}

test("non-Git code folder works in-place for Home and Orchestrator (immediate & deferred), without Git-only prompt text", async t => {
  const { service, orchestrator, project, preset, code, promptLog } = makeEnv(t, { withCode:true, initGit:false });

  // 1) Home createTopic runs directly in code folder without NOT_GIT.
  const homeLine = await service.createTopic(project, { text:"Check app.txt", agent:"fake" });
  const homeDoc = await settled(service, project, homeLine.slug);
  assert.equal(homeDoc.status, "done", homeDoc.front.why || "");
  assert.equal(homeDoc.front.code, code);
  assert.equal(homeDoc.front.branch, undefined);
  assert.equal(homeDoc.front.base, undefined);

  // 2) Continuing work in non-Git code folder omits "and the commits on this branch".
  await service.addFeedback(project, homeLine.slug, { text:"Second pass", by:"fake" });
  const homeDoc2 = await settled(service, project, homeLine.slug);
  assert.equal(homeDoc2.status, "done", homeDoc2.front.why || "");

  // 3) Orchestrator immediate start works on non-Git code folder.
  const orchImmediate = await orchestrator.start(project, { goal:"Hi from orchestrator", preset:preset.id });
  const orchDoc1 = await settled(service, project, orchImmediate.line);
  assert.equal(orchDoc1.status, "done", orchDoc1.front.why || "");

  // 4) Orchestrator deferred start + runUnsent works on non-Git code folder.
  const orchDeferred = await orchestrator.start(project, { goal:"Deferred hello", preset:preset.id }, { deferred:true });
  const deferredStep = F.parseLine(service.readDoc(project, orchDeferred.line)).asks.find(F.isUnsent).id;
  await service.runUnsent(project, orchDeferred.line, { step:deferredStep, preset:preset.id });
  const orchDoc2 = await settled(service, project, orchDeferred.line);
  assert.equal(orchDoc2.status, "done", orchDoc2.front.why || "");

  // Inspect captured prompts/instructions.
  const entries = fs.readFileSync(promptLog, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(entries.length >= 4);
  for (const entry of entries) {
    assert.equal(fs.realpathSync(entry.cwd), fs.realpathSync(code));
    assert.equal(entry.gitDir, "");
    assert.match(entry.instructions, /Your current directory is the project's code\./);
    assert.doesNotMatch(entry.instructions, /Do not merge or push/);
    assert.doesNotMatch(entry.prompt, /and the commits on this branch/);
  }
});

test("detached HEAD works for in-place work while explicit branch actions are clearly gated", async t => {
  const plain = makeEnv(t, { withCode:true, initGit:false });

  // Explicit branch actions on non-Git code folder fail with clear Track changes copy.
  await assert.rejects(
    plain.service.createTopic(plain.project, { text:"Branch work", agent:"fake", chosen:{ newFrom:"main" } }),
    err => err.code === "NOT_GIT" && /Track changes on Home/.test(err.message),
  );
  await assert.rejects(
    plain.service.createTopic(plain.project, { text:"Branch work", agent:"fake", chosen:{ branch:"feat" } }),
    err => err.code === "NOT_GIT" && /Track changes on Home/.test(err.message),
  );
  await assert.rejects(
    plain.orchestrator.call(plain.project, { do:"create-line", task:"Need branch", kind:"code", agent:plain.preset.id, branch:"new" }),
    err => err.code === "NO_BRANCH" && /Track changes on Home/.test(err.message),
  );

  // Unsent Line with new branch from fails cleanly if folder is not Git.
  const manualSlug = "manual-new-branch";
  plain.service.writeDoc(plain.project, manualSlug, F.initialLine({
    title:"Manual branch", status:"waiting", code:plain.code, newBranchFrom:"main",
    steps:[F.askStep({ words:"Run on new branch", via:F.NOT_SENT })],
  }));
  const unsentId = F.parseLine(plain.service.readDoc(plain.project, manualSlug)).asks.find(F.isUnsent).id;
  await assert.rejects(
    plain.service.runUnsent(plain.project, manualSlug, { step:unsentId, agent:"fake" }),
    err => err.code === "NOT_GIT" && /Track changes on Home/.test(err.message),
  );

  // Merge on non-Git folder gives clear Track changes copy.
  const fakeBranchSlug = "stale-branch";
  plain.service.writeDoc(plain.project, fakeBranchSlug, F.initialLine({
    title:"Stale branch", status:"ready", code:plain.code, branch:"feat/old", base:"main",
    steps:[F.askStep({ words:"Old work" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" }],
  }));
  await assert.rejects(
    plain.service.merge(plain.project, fakeBranchSlug),
    err => err.code === "NOT_GIT" && /Track changes on Home/.test(err.message),
  );

  // Docs-only project: Orchestrator works normally, branch:"new" explains code folder + Git commit.
  const docsOnly = makeEnv(t, { withCode:false });
  const docsOrch = await docsOnly.orchestrator.start(docsOnly.project, { goal:"Docs only hello", preset:docsOnly.preset.id });
  assert.equal((await settled(docsOnly.service, docsOnly.project, docsOrch.line)).status, "done");
  await assert.rejects(
    docsOnly.orchestrator.call(docsOnly.project, { do:"create-line", task:"Need branch", kind:"code", agent:docsOnly.preset.id, branch:"new" }),
    err => err.code === "NO_BRANCH" && /code folder and a Git commit/.test(err.message),
  );

  // Detached HEAD in a real Git repo still allows normal in-place Home and deferred Orchestrator work.
  const detached = makeEnv(t, { withCode:true, initGit:true });
  const sha = gitIn(detached.code, "rev-parse", "HEAD");
  gitIn(detached.code, "checkout", "-q", "--detach", sha);
  const detHome = await detached.service.createTopic(detached.project, { text:"Work on detached HEAD", agent:"fake" });
  assert.equal((await settled(detached.service, detached.project, detHome.slug)).status, "done");
  const detOrch = await detached.orchestrator.start(detached.project, { goal:"Deferred on detached HEAD", preset:detached.preset.id }, { deferred:true });
  const detStep = F.parseLine(detached.service.readDoc(detached.project, detOrch.line)).asks.find(F.isUnsent).id;
  await detached.service.runUnsent(detached.project, detOrch.line, { step:detStep, preset:detached.preset.id });
  assert.equal((await settled(detached.service, detached.project, detOrch.line)).status, "done");
  // Git prompt line is still preserved in a real Git repo.
  const detEntries = fs.readFileSync(detached.promptLog, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(detEntries[0].gitDir);
  assert.match(detEntries[0].instructions, /Do not merge or push: the person decides that\./);
});

test("adding a Git code folder via PATCH immediately refreshes trunk and git state on GET /state", async t => {
  const { project, dir, callApi } = makeEnv(t, { withCode:false });
  const repoDir = path.join(dir, "later-repo");
  fs.mkdirSync(repoDir, { recursive:true });
  gitIn(repoDir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repoDir, "index.js"), "console.log(1);\n");
  gitIn(repoDir, "add", "-A");
  gitIn(repoDir, "commit", "-q", "-m", "first");

  const before = await callApi("GET", `/projects/${project.id}/state`);
  assert.equal(before.status, 200);
  assert.equal(before.data.project.code, false);
  assert.equal(before.data.project.git, false);
  assert.equal(before.data.project.trunk, "Sample");

  const patched = await callApi("PATCH", `/projects/${project.id}`, { codePath:repoDir });
  assert.equal(patched.status, 200);

  const after = await callApi("GET", `/projects/${project.id}/state`);
  assert.equal(after.status, 200);
  assert.equal(after.data.project.code, true);
  assert.equal(after.data.project.git, true);
  assert.equal(after.data.project.trunk, "main");
  assert.equal(after.data.project.here, "main");

  // Unlinking the code folder immediately clears git state as well.
  const unlinked = await callApi("PATCH", `/projects/${project.id}`, { codePath:"" });
  assert.equal(unlinked.status, 200);
  const cleared = await callApi("GET", `/projects/${project.id}/state`);
  assert.equal(cleared.data.project.code, false);
  assert.equal(cleared.data.project.git, false);
  assert.equal(cleared.data.project.trunk, "Sample");
});

test("terminal git init + commit + branch is detected immediately on GET /state and shown on Home Lines", async t => {
  const { project, code, callApi } = makeEnv(t, { withCode:true, initGit:false });

  // Initially plain folder: git=false, trunk is project name.
  const s0 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s0.project.code, true);
  assert.equal(s0.project.git, false);
  assert.equal(s0.project.trunk, "Sample");

  // User runs git init (no commits yet): still no branches yet.
  gitIn(code, "init", "-q", "-b", "main");
  const s1 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s1.project.git, false);

  // User makes the first commit: GET /state detects main immediately without Track changes or restart.
  gitIn(code, "add", "-A");
  gitIn(code, "commit", "-q", "-m", "initial commit");
  const s2 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s2.project.git, true);
  assert.equal(s2.project.trunk, "main");
  assert.equal(s2.project.here, "main");
  assert.notEqual(s2.rev, s1.rev);

  // User creates and checks out a feature branch: detected immediately.
  gitIn(code, "checkout", "-q", "-b", "feat/ui");
  const s3 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s3.project.git, true);
  assert.equal(s3.project.trunk, "main");
  assert.equal(s3.project.here, "feat/ui");

  // Verify the Home Lines trunk header transitions from project name + Track changes to the branch pill (pic1).
  const panoSource = fs.readFileSync(path.join(process.cwd(), "public/lines/panorama.js"), "utf8");
  const startMatch = panoSource.match(/start\(p, split, rootOf\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(startMatch, "found Pano.start");
  const renderTrunk = p => {
    const el = { dataset:{}, innerHTML:"" };
    const ctx = vm.createContext({
      $:() => el,
      MAP_FILTERS:{ done:() => false },
      ic:name => `<svg data-ic="${name}"></svg>`,
      esc:s => String(s),
      newLineOn:(_p, name) => `<btn-new data-b="${name}">`,
      drawLineOn:(_p, name) => `<btn-draw data-b="${name}">`,
      syncOn:() => "",
      trackHTML:proj => (proj.git === false && proj.code ? "<btn-track>Track changes</btn-track>" : ""),
    });
    vm.runInContext(`const obj = { ${startMatch[0]} }; obj.start(${JSON.stringify({ ...p, lines:[] })}, false, l => l);`, ctx);
    return el.innerHTML;
  };
  const beforeHtml = renderTrunk(s0.project);
  assert.match(beforeHtml, /<span class="trunk-label">Sample<\/span>/);
  assert.match(beforeHtml, /Track changes/);

  const afterHtml = renderTrunk(s2.project);
  assert.match(afterHtml, /<span class="trunk-label"><svg data-ic="branch"><\/svg>main<\/span>/);
  assert.doesNotMatch(afterHtml, /Track changes/);
});

test("agent running git init + commit updates project trunk cleanly without mislabeling main as a feature branch", async t => {
  const { service, project, callApi } = makeEnv(t, { withCode:true, initGit:false });

  const s0 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s0.project.git, false);
  assert.equal(s0.project.trunk, "Sample");

  // Ask agent to initialize git on main.
  const first = await service.createTopic(project, { text:"Initialize git [DO_GIT_INIT]", agent:"fake" });
  const firstDoc = await settled(service, project, first.slug);
  assert.equal(firstDoc.status, "done");
  assert.equal(firstDoc.front.branch, undefined, "trunk main must never be recorded as a feature branch");

  const s1 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s1.project.git, true);
  assert.equal(s1.project.trunk, "main");
  assert.equal(s1.project.here, "main");
  const line1 = s1.lines.find(l => l.id === first.slug);
  assert.equal(line1.offMain, false);
  assert.equal(line1.branch, "");

  // Second line where agent creates a real feature branch IS followed, attached, and marked ready to merge.
  const second = await service.createTopic(project, { text:"Create feature branch [DO_FEATURE_BRANCH]", agent:"fake" });
  const secondDoc = await settled(service, project, second.slug);
  assert.equal(secondDoc.status, "ready");
  assert.equal(secondDoc.front.branch, "feat/agent-branch");
  assert.equal(secondDoc.front.base, "main");
});

test("subdirectory code folder detects parent git init + commit immediately", async t => {
  const { project, codeBase, callApi } = makeEnv(t, { withCode:true, initGit:false, subFolder:"packages/app" });

  const s0 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s0.project.git, false);

  gitIn(codeBase, "init", "-q", "-b", "main");
  gitIn(codeBase, "add", "-A");
  gitIn(codeBase, "commit", "-q", "-m", "monorepo init");

  const s1 = (await callApi("GET", `/projects/${project.id}/state`)).data;
  assert.equal(s1.project.git, true);
  assert.equal(s1.project.trunk, "main");
  assert.equal(s1.project.here, "main");
});
