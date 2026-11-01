"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createFolderProjects, folderKey } = require("../src/server/folder-projects.js");

const CLOUD_PROJECT = "11111111-2222-4333-8444-555555555555";
function folderProjects(t, { canvases = [], signedIn = false, accountId = "account-1" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-folder-unit-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const projects = new Map(), calls = [];
  const cloud = { signedIn, accountId, failing:false,
    view:{ name:"app", cloudProjectId:CLOUD_PROJECT, revision:4, tabs:[], closed:[] } };
  const service = createFolderProjects({ directory, origin:() => "http://127.0.0.1:4000", listCanvases:() => canvases,
    library:{ project:id => projects.get(id) || null, createProject:({ name }) => { const project = { id:`project-${projects.size + 1}xxxxxxxx`, name }; projects.set(project.id, project); return project; },
      list:() => [], read:() => null, save:() => { throw Error("unused"); }, revision:canvas => canvas.revisionId },
    cloud:{ signedIn:() => cloud.signedIn, accountId:() => cloud.accountId,
      project:async folder => { calls.push(["project", folder]); if (cloud.failing) throw Error("Cloud is away"); return cloud.view; },
      tabs:async (folder, change) => { calls.push(["tabs", folder, change]); return { ...cloud.view, revision:5 }; } } });
  return { service, projects, calls, cloud };
}

test("folders normalize to one key, and an agent gets its folder page's start arguments once the page is connected", async t => {
  assert.equal(folderKey("C:\\work\\app\\"), "C:/work/app");
  assert.equal(folderKey("git@github.com:me/App.git"), "github.com/me/app");
  assert.equal(folderKey("  "), null);
  const canvases = [];
  const { service } = folderProjects(t, { canvases });
  const first = await service.open({ folder:"/work/app", sessionKey:"a" });
  assert.deepEqual([first.alreadyConnected, first.url, first.startSession], [false, `http://127.0.0.1:4000/?workspace=${first.workspaceId}&mcp=1&mode=companion`, undefined]);
  await assert.rejects(service.open({ folder:"/work/app", project:"token" }), { code:"invalid_request" });
  canvases.push({ canvasId:first.workspaceId, documentId:"doc-plan", title:"Plan", active:false }, { canvasId:first.workspaceId, documentId:"doc-notes", title:"Notes", active:true }, { canvasId:"other", documentId:"doc-x", title:"X", active:true });
  const ready = await service.open({ folder:"/work/app/" });
  assert.deepEqual([ready.alreadyConnected, ready.url, ready.startSession], [true, null, { canvasId:first.workspaceId, documentId:"doc-notes" }], "the Canvas in front");
  const documents = service.documents(first.workspaceId);
  service.select(first.workspaceId, { documentId:"doc-plan", expectedRevision:documents.selectionRevision, requestId:"r1" });
  assert.deepEqual((await service.open({ folder:"/work/app" })).startSession, { canvasId:first.workspaceId, documentId:"doc-plan" }, "or the one chosen on the page");
  assert.throws(() => service.select(first.workspaceId, { documentId:"doc-notes", expectedRevision:0, requestId:"r2" }), { code:"selection_conflict" });
  assert.throws(() => service.select(first.workspaceId, { documentId:"doc-x", expectedRevision:1, requestId:"r3" }), { code:"document_unavailable" });
});

test("signed in, a folder page saves into the account's Cloud project for the folder, and keeps it until it opens again", async t => {
  const { service, projects, calls, cloud } = folderProjects(t, { signedIn:true });
  const { workspaceId } = await service.open({ folder:"/work/app" });
  const config = await service.pageConfig(workspaceId);
  assert.deepEqual(config.folderProject, { name:"app", cloudProjectId:CLOUD_PROJECT });
  assert.equal(projects.size, 0, "no Library project");
  assert.deepEqual(await service.projectView(workspaceId), { ...cloud.view, moved:[] });
  assert.equal((await service.updateTabs(workspaceId, { open:"canvas-1" })).revision, 5);
  assert.deepEqual(calls, [["project", "/work/app"], ["project", "/work/app"], ["tabs", "/work/app", { open:"canvas-1" }]]);
  assert.throws(() => service.readCanvas(workspaceId, "1700000000000-canvas-one"), { status:409 }, "its Canvases are in Cloud");
  cloud.accountId = "account-2";
  await assert.rejects(service.projectView(workspaceId), { status:403 }, "another account's page reopens first");
  // Signed out now: the page keeps Cloud until it opens again, then uses the Library.
  Object.assign(cloud, { signedIn:false, accountId:null });
  await assert.rejects(service.projectView(workspaceId), { status:403 });
  const local = await service.pageConfig(workspaceId);
  assert.deepEqual(local.folderProject, { name:"app", localProjectId:[...projects.keys()][0] });
  assert.deepEqual((await service.projectView(workspaceId)).tabs, []);
  // Cloud out of reach: the page opens without a project to save into.
  Object.assign(cloud, { signedIn:true, accountId:"account-1", failing:true });
  assert.deepEqual((await service.pageConfig(workspaceId)).folderProject, { name:"app" });
  await assert.rejects(service.projectView(workspaceId), { status:409 });
});

// A Library with real revisions, and a Cloud that records what reaches it.
function keeping(t, { room = 10_000, onCreate = () => {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-folder-keep-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const projects = new Map(), canvases = new Map(), cloudCalls = [];
  let revision = 0, signedIn = false;
  const library = { project:id => projects.get(id) || null, createProject:({ name }) => { const project = { id:`project-${projects.size + 1}local0`, name }; projects.set(project.id, project); return project; },
    removeProject:id => projects.delete(id), list:() => [...canvases.values()], canvas:id => canvases.get(id) || null, read:id => canvases.get(id)?.bundle,
    bundle:id => canvases.get(id).bundle, size:id => canvases.get(id).bundle.size, remove:id => canvases.delete(id), revision:canvas => canvas.revisionId,
    save:(value, overwriteId) => { const saved = { id:value.id, name:value.name, projectId:value.projectId, updatedAt:++revision, revisionId:`local-${revision}`, bundle:value }; canvases.set(value.id, saved); return saved; } };
  const cloud = { signedIn:() => signedIn, accountId:() => signedIn ? "account-1" : null, room:async () => room,
    project:async () => ({ name:"app", cloudProjectId:CLOUD_PROJECT, revision:1, tabs:[], closed:[] }),
    tabs:async (folder, change) => { cloudCalls.push(["tabs", change.open]); return {}; },
    createCanvas:async ({ name, bundle }) => { cloudCalls.push(["create", name, bundle.text]); const id = `cloud-${cloudCalls.length}`; await onCreate(id, name); return { canvas:{ id }, revision:{ id:`${id}-r1` } }; },
    saveCanvas:async ({ canvasId, baseRevisionId, bundle }) => { cloudCalls.push(["save", canvasId, baseRevisionId, bundle.text]); return { revision:{ id:`${canvasId}-r2` } }; } };
  const service = createFolderProjects({ directory, library, cloud, origin:() => "http://127.0.0.1:4000", listCanvases:() => [] });
  return { service, library, canvases, projects, cloudCalls, signIn:() => { signedIn = true; } };
}

test("signing in keeps a folder's Library Canvases in its Cloud project: tabs first and open, each removed only once Cloud has it", async t => {
  const run = keeping(t);
  const { workspaceId } = await run.service.open({ folder:"/work/app" });
  const { folderProject } = await run.service.pageConfig(workspaceId);
  const plan = run.service.createCanvas(workspaceId, { name:"Plan", bundle:{ text:"plan", size:300 } }).canvas;
  const notes = run.service.createCanvas(workspaceId, { name:"Notes", bundle:{ text:"notes", size:200 } }).canvas;
  run.service.updateTabs(workspaceId, { open:notes.id });
  await run.service.updateTabs(workspaceId, { open:plan.id });
  await assert.rejects(run.service.keep(workspaceId), { status:401 }, "only once signed in");
  run.signIn();
  assert.deepEqual((await run.service.pageConfig(workspaceId)).folderProject, { ...folderProject, keep:true }, "signed in, the page still opens on the Library, to move them");
  const [kept, again] = await Promise.all([run.service.keep(workspaceId), run.service.keep(workspaceId)]);
  assert.deepEqual([kept, again], [{ kept:2, cloudProjectId:CLOUD_PROJECT }, kept], "one move however often it is asked");
  assert.deepEqual(run.cloudCalls, [["create", "Notes", "notes"], ["create", "Plan", "plan"], ["tabs", "cloud-1"], ["tabs", "cloud-2"]]);
  assert.deepEqual([run.canvases.size, run.projects.size], [0, 0], "the Library copies and the emptied project are gone");
  assert.deepEqual((await run.service.pageConfig(workspaceId)).folderProject, { name:"app", cloudProjectId:CLOUD_PROJECT }, "the page reopens in Cloud");
  const view = await run.service.projectView(workspaceId);
  assert.deepEqual(view.moved.map(move => [move.from, move.to, move.revisionId]).sort(), [[notes.id, "cloud-1", "cloud-1-r1"], [plan.id, "cloud-2", "cloud-2-r1"]].sort(), "pages still holding them follow");
});

test("a save made while a Canvas moves follows it to Cloud, a full Cloud library keeps everything here, and an interrupted move never uploads twice", async t => {
  let page;
  const run = keeping(t, { onCreate:async () => { if (page) { const { id, revisionId } = page; page = null; run.service.saveCanvas(run.workspaceId, id, { baseRevisionId:revisionId, bundle:{ text:"plan, drawn on meanwhile", size:300 } }); } } });
  const { workspaceId } = await run.service.open({ folder:"/work/app" });
  run.workspaceId = workspaceId;
  await run.service.pageConfig(workspaceId);
  const plan = run.service.createCanvas(workspaceId, { name:"Plan", bundle:{ text:"plan", size:300 } });
  page = { id:plan.canvas.id, revisionId:plan.revision.id };
  run.signIn();
  await run.service.keep(workspaceId);
  assert.deepEqual(run.cloudCalls, [["create", "Plan", "plan"], ["save", "cloud-1", "cloud-1-r1", "plan, drawn on meanwhile"]]);
  assert.equal(run.canvases.size, 0);

  const full = keeping(t, { room:100 });
  const opened = await full.service.open({ folder:"/work/full" });
  await full.service.pageConfig(opened.workspaceId);
  full.service.createCanvas(opened.workspaceId, { name:"Big", bundle:{ text:"big", size:5 * 1048576 } });
  full.signIn();
  await assert.rejects(full.service.keep(opened.workspaceId), { status:413, message:/Free 5 MB in your Cloud storage/ });
  assert.deepEqual([full.cloudCalls, full.canvases.size], [[], 1], "nothing moves");

  let failOnce = true;
  const flaky = keeping(t, { onCreate:async (id, name) => { if (name === "One" && failOnce) { failOnce = false; throw Error("Cloud went away"); } } });
  const third = await flaky.service.open({ folder:"/work/flaky" });
  await flaky.service.pageConfig(third.workspaceId);
  flaky.service.createCanvas(third.workspaceId, { name:"One", bundle:{ text:"one", size:1 } });
  flaky.service.createCanvas(third.workspaceId, { name:"Two", bundle:{ text:"two", size:1 } });
  flaky.signIn();
  await assert.rejects(flaky.service.keep(third.workspaceId), /Cloud went away/);
  assert.equal(flaky.canvases.size, 1, "what Cloud has left the Library; the rest stays");
  await flaky.service.keep(third.workspaceId);
  assert.deepEqual(flaky.cloudCalls.filter(call => call[0] === "create").map(call => call[1]), ["Two", "One", "One"], "newest first; only the one that failed is tried again");
  assert.equal(flaky.canvases.size, 0);
});

test("signed in, a folder page opens the Cloud project of the folder's link on this computer, and keeps the link it is given", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-folder-link-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const folder = path.join(directory, "work", "app"), file = path.join(folder, ".penecho", "project.json"), own = "own-link-".padEnd(43, "x"), agent = "agent-link-".padEnd(43, "y");
  fs.mkdirSync(folder, { recursive:true });
  const asked = [];
  let otherSignIn = false;
  const service = createFolderProjects({ directory, origin:() => "http://127.0.0.1:4000", listCanvases:() => [],
    library:{ project:() => null, createProject:({ name }) => ({ id:"project-1localxx", name }), list:() => [] },
    cloud:{ signedIn:() => true, accountId:() => "account-1", origin:() => "https://penecho.ai", tabs:async () => ({}),
      project:async (requested, options = {}) => {
        asked.push(options.project || null);
        if (options.project && otherSignIn) throw Object.assign(Error("This project belongs to another PenEcho sign-in."), { status:403, code:"project_other_identity" });
        return { name:"app", cloudProjectId:CLOUD_PROJECT, revision:1, tabs:[], closed:[], project:{ name:"app", token:own } };
      } } });
  const { workspaceId } = await service.open({ folder });
  // No link yet: the app opens its own project here and keeps its link for Cloud's agents.
  await service.pageConfig(workspaceId);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).projects["https://penecho.ai"], { project:own, name:"app" });
  assert.equal(fs.readFileSync(path.join(folder, ".penecho", ".gitignore"), "utf8"), "*\n");
  // A Cloud agent's link in the folder: the app opens that project.
  fs.writeFileSync(file, JSON.stringify({ projects:{ "https://penecho.ai":{ project:agent, name:"app" }, "http://127.0.0.1:4000":{ project:"z".repeat(43), name:"app" } } }));
  await service.pageConfig(workspaceId);
  // Another sign-in's link: the app keeps to its own project and leaves the link alone.
  otherSignIn = true;
  await service.pageConfig(workspaceId);
  assert.deepEqual(asked, [null, agent, agent, null]);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).projects["https://penecho.ai"].project, agent);
});
