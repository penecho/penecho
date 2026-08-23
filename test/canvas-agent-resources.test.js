"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const JSZip = require("jszip");
const {
  CanvasAgentProjectStore,
  PROJECT_HISTORY_LIMIT,
  PROJECT_UPLOAD_LIMIT,
} = require("../src/server/canvas-agent/project-store.js");

const ROOT = path.resolve(__dirname, "..");
const runtimeSource = fsSync.readFileSync(path.join(ROOT, "src/server/canvas-agent/runtime.mjs"), "utf8");
const mainSource = fsSync.readFileSync(path.join(ROOT, "src/server/main.js"), "utf8");
const remoteCanvasHttpSource = fsSync.readFileSync(path.join(ROOT, "src/server/remote-canvas-http.js"), "utf8");

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-resources-"));
  const stateDirectory = path.join(directory, "state");
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  return {
    directory,
    stateDirectory,
    store:new CanvasAgentProjectStore({ stateDirectory, allowedRoots:options.allowedRoots || [] }),
  };
}

async function expectProjectError(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

async function assertMissing(target) {
  await assert.rejects(fs.access(target), error => error?.code === "ENOENT");
}

function permissionBits(info) {
  return info.mode & 0o777;
}

function conversation(index) {
  return {
    id:`conversation-${index}`,
    title:`Conversation ${index}`,
    createdAt:1_000 + index,
    updatedAt:2_000 + index,
    items:[{
      id:`message-${index}`,
      type:"message",
      role:"user",
      text:`Message ${index}`,
      attachmentCount:0,
      eventKey:`event-${index}`,
    }],
  };
}

test("Canvas Agent resource projections hide canonical folder and file paths until resolve", async t => {
  const { directory, store } = await fixture(t);
  const folder = path.join(directory, "private-parent", "selected-folder");
  const file = path.join(directory, "private-file-parent", "selected-notes.txt");
  await fs.mkdir(folder, { recursive:true });
  await fs.mkdir(path.dirname(file), { recursive:true });
  await fs.writeFile(file, "private notes\n", { mode:0o600 });
  const canonicalFolder = await fs.realpath(folder), canonicalFile = await fs.realpath(file);

  const publicFolder = await store.add(folder, { kind:"folder", origin:"native" });
  const publicFile = await store.add(file, { kind:"file", origin:"native" });
  for (const [resource, canonical] of [[publicFolder, canonicalFolder], [publicFile, canonicalFile]]) {
    assert.equal(path.isAbsolute(resource.path), false);
    assert.equal(resource.path.includes(directory), false);
    assert.notEqual(resource.path, canonical);
    assert.equal(resource.displayPath, resource.path);
  }
  assert.match(publicFolder.id, /^local-[0-9a-f]{24}$/);
  assert.match(publicFile.id, /^file-[0-9a-f]{24}$/);
  assert.notEqual(publicFolder.id, `local-${crypto.createHash("sha256").update(canonicalFolder).digest("hex").slice(0, 24)}`);
  assert.notEqual(publicFile.id, `file-${crypto.createHash("sha256").update(canonicalFile).digest("hex").slice(0, 24)}`);
  assert.equal(publicFolder.kind, "folder");
  assert.equal(publicFile.kind, "file");

  const listed = await store.list();
  assert.equal(listed.some(resource => path.isAbsolute(resource.path) || resource.path.includes(directory)), false);
  assert.equal((await store.resolve(publicFolder.id)).path, canonicalFolder);
  assert.equal((await store.resolve(publicFile.id)).path, canonicalFile);

  await store.remove(publicFolder.id);
  await store.remove(publicFile.id);
  assert.equal((await fs.stat(canonicalFolder)).isDirectory(), true, "removing a native folder only unregisters it");
  assert.equal((await fs.stat(canonicalFile)).isFile(), true, "removing a native file never deletes the source file");
});

test("single-file runtime exposes one exact canonical file and no sibling-capable tools", () => {
  const exactFileBlock = runtimeSource.slice(
    runtimeSource.indexOf("async function exactSelectedFilePath"),
    runtimeSource.indexOf("const PROJECT_IMAGE_VALUE_SCHEMA"),
  );
  assert.match(exactFileBlock, /session\.project\?\.kind !== 'file'/);
  assert.match(exactFileBlock, /requested !== session\.project\.name/);
  assert.match(exactFileBlock, /session\.projectSnapshotPath/);
  assert.doesNotMatch(exactFileBlock, /realpath\(candidate\)|statFile\(candidate\)/);
  assert.match(exactFileBlock, /parent folder and sibling files are not exposed/);
  assert.match(exactFileBlock, /session\.project\?\.kind === 'file'\) return exactSelectedFilePath/);

  const filePluginBlock = runtimeSource.slice(
    runtimeSource.indexOf("const PenEchoFilePlugin"),
    runtimeSource.indexOf("export class CanvasHarnessHost"),
  );
  assert.match(filePluginBlock, /exactly one read-only file/);
  assert.match(filePluginBlock, /No write, edit, bash, or directory-listing capability exists/);
  assert.match(filePluginBlock, /agentCtx\.tools\.register\(project(?:Document|Image|Database|Text)ReaderTool/);
  assert.doesNotMatch(filePluginBlock, /ToolFs\.apply|projectBashTool|projectPluginLoaderTool/);
  assert.match(runtimeSource, /meta:\{ cwd:project\?\.kind === 'folder' \? project\.path : projectRuntimeDirectory \}/);
  assert.match(runtimeSource, /session\.project\?\.kind === 'file'\) await agentCtx\.plugin\(PenEchoFilePlugin/);
});

test("uploaded files require canonical base64, honor the 32 MiB boundary, use private modes, and delete only managed copies", async t => {
  const { directory, stateDirectory, store } = await fixture(t);
  assert.equal(PROJECT_UPLOAD_LIMIT, 32 * 1024 * 1024);
  await expectProjectError(store.upload({ name:"bad.txt", mediaType:"text/plain", bytes:5, data:"aGVsbG8" }), "project_upload_invalid");
  await expectProjectError(store.upload({ name:"bad.txt", mediaType:"text/plain", bytes:4, data:"aGVsbG8=" }), "project_upload_invalid");
  await expectProjectError(store.upload({ name:"too-large.txt", mediaType:"text/plain", bytes:PROJECT_UPLOAD_LIMIT + 1, data:"YQ==" }), "project_upload_too_large");

  const boundaryBytes = Buffer.alloc(PROJECT_UPLOAD_LIMIT, 0x61);
  const uploaded = await store.upload({
    name:"boundary.txt",
    mediaType:"text/plain",
    bytes:boundaryBytes.length,
    data:boundaryBytes.toString("base64"),
  });
  assert.match(uploaded.id, /^file-[0-9a-f]{24}$/);
  assert.equal(uploaded.path, "boundary.txt");
  assert.equal(uploaded.path.includes(stateDirectory), false);
  assert.equal(uploaded.bytes, PROJECT_UPLOAD_LIMIT);

  const resolved = await store.resolve(uploaded.id), managedFile = resolved.path;
  const managedDirectory = path.dirname(managedFile), uploadRoot = path.dirname(managedDirectory);
  const canonicalStateDirectory = await fs.realpath(stateDirectory);
  assert.equal(path.basename(managedFile), "content.txt");
  assert.equal(managedFile.startsWith(`${canonicalStateDirectory}${path.sep}`), true);
  assert.equal(permissionBits(await fs.stat(uploadRoot)), 0o700);
  assert.equal(permissionBits(await fs.stat(managedDirectory)), 0o700);
  assert.equal(permissionBits(await fs.stat(managedFile)), 0o600);

  const stateSentinel = path.join(stateDirectory, "keep-this-state-file.txt");
  await fs.writeFile(stateSentinel, "keep", { mode:0o600 });
  await store.remove(uploaded.id);
  await assertMissing(managedFile);
  await assertMissing(managedDirectory);
  assert.equal(await fs.readFile(stateSentinel, "utf8"), "keep");

  const guarded = await store.upload({ name:"guarded.txt", mediaType:"text/plain", bytes:1, data:"eA==" });
  const guardedFile = (await store.resolve(guarded.id)).path, unexpectedSibling = path.join(path.dirname(guardedFile), "unexpected.txt");
  await fs.writeFile(unexpectedSibling, "do not delete", { mode:0o600 });
  await expectProjectError(store.remove(guarded.id), "project_upload_identity_invalid");
  assert.equal(await fs.readFile(guardedFile, "utf8"), "x");
  assert.equal(await fs.readFile(unexpectedSibling, "utf8"), "do not delete");

  const nativeFile = path.join(directory, "native.txt");
  await fs.writeFile(nativeFile, "native source", { mode:0o600 });
  const native = await store.add(nativeFile, { kind:"file", origin:"native" });
  await store.remove(native.id);
  assert.equal(await fs.readFile(nativeFile, "utf8"), "native source");
});

test("uploaded specialized files are content-validated before private storage is created", async t => {
  const { stateDirectory, store } = await fixture(t);
  const invalidPdf = Buffer.from("not a PDF", "utf8");
  await expectProjectError(store.upload({
    name:"forged.pdf", mediaType:"application/pdf", bytes:invalidPdf.length, data:invalidPdf.toString("base64"),
  }), "project_file_content_invalid");
  const invalidDatabase = Buffer.from("not sqlite", "utf8");
  await expectProjectError(store.upload({
    name:"forged.sqlite", mediaType:"application/x-sqlite3", bytes:invalidDatabase.length, data:invalidDatabase.toString("base64"),
  }), "project_file_content_invalid");

  const incompleteOffice = new JSZip();
  incompleteOffice.file("[Content_Types].xml", "<Types/>");
  const incompleteBytes = await incompleteOffice.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  await expectProjectError(store.upload({
    name:"incomplete.docx", mediaType:"application/zip", bytes:incompleteBytes.length, data:incompleteBytes.toString("base64"),
  }), "project_file_content_invalid");

  await assertMissing(path.join(stateDirectory, "canvas-agent-files"));

  const validOffice = new JSZip();
  validOffice.file("[Content_Types].xml", "<Types/>");
  validOffice.folder("word").file("document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>");
  const validBytes = await validOffice.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  const uploaded = await store.upload({
    name:"notes.docx", mediaType:"application/zip", bytes:validBytes.length, data:validBytes.toString("base64"),
  });
  assert.equal(uploaded.reader, "document");
  assert.equal((await store.resolve(uploaded.id)).bytes, validBytes.length);
});

test("allowed server roots expose opaque IDs and relative folders while rejecting absolute, traversal, metadata, and symlink paths", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-roots-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const stateDirectory = path.join(directory, "state"), allowedRoot = path.join(directory, "server-private-root"), outside = path.join(directory, "outside");
  await fs.mkdir(path.join(allowedRoot, "Projects", "Nested"), { recursive:true });
  await fs.mkdir(path.join(allowedRoot, ".penecho", "Hidden"), { recursive:true });
  await fs.mkdir(outside, { recursive:true });
  await fs.symlink(outside, path.join(allowedRoot, "Escape"), process.platform === "win32" ? "junction" : "dir");
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({
    stateDirectory,
    allowedRoots:[{ path:allowedRoot, name:"Approved projects" }, path.join(allowedRoot, ".penecho")],
  });

  const roots = await store.listRoots();
  assert.equal(roots.length, 1, "a configured .penecho directory is never exposed as a root");
  assert.deepEqual(Object.keys(roots[0]).sort(), ["id", "name"]);
  assert.match(roots[0].id, /^root-[0-9a-f]{24}$/);
  assert.notEqual(roots[0].id, `root-${crypto.createHash("sha256").update(await fs.realpath(allowedRoot)).digest("hex").slice(0, 24)}`);
  assert.equal(roots[0].name, "Approved projects");
  assert.equal(JSON.stringify(roots).includes(allowedRoot), false);

  const rootListing = await store.browseRoot(roots[0].id, "");
  assert.equal(rootListing.path, "");
  assert.equal(rootListing.entries.some(entry => entry.name === "Projects" && entry.path === "Projects"), true);
  assert.equal(rootListing.entries.some(entry => entry.name === ".penecho" || entry.name === "Escape"), false);
  assert.equal(JSON.stringify(rootListing).includes(allowedRoot), false);

  const project = await store.addFromRoot(roots[0].id, "Projects/Nested");
  assert.equal(project.source, "server");
  assert.equal(project.path, "Approved projects/Projects/Nested");
  assert.equal(project.path.includes(allowedRoot), false);
  assert.equal((await store.resolve(project.id)).path, await fs.realpath(path.join(allowedRoot, "Projects", "Nested")));

  const restartedStore = new CanvasAgentProjectStore({
    stateDirectory,
    allowedRoots:[{ path:allowedRoot, name:"Approved projects" }],
  });
  assert.deepEqual(await restartedStore.listRoots(), roots, "opaque root ids remain stable across host restarts");
  assert.equal((await restartedStore.resolve(project.id)).id, project.id, "server-root projects remain registered after restart");
  assert.equal(permissionBits(await fs.stat(path.join(stateDirectory, "canvas-agent-root-id.key"))), 0o600);

  for (const unsafe of ["/etc", "../outside", "Projects/../outside", ".penecho", "C:\\Windows", "Projects/bad\nname", "Projects/\u202espoof"]) {
    await expectProjectError(store.browseRoot(roots[0].id, unsafe), "project_root_path_invalid");
  }
  await expectProjectError(store.browseRoot(roots[0].id, "Escape"), "project_unavailable");
  await expectProjectError(store.browseRoot("root-000000000000000000000000", ""), "project_root_not_found");
});

test("local and LAN clients browse the PenEcho host home through the in-app root API without exposing it to Cloud roots", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-host-roots-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const stateDirectory = path.join(directory, "state"), hostRoot = path.join(directory, "host-home"), projectFolder = path.join(hostRoot, "Workspace", "ReadOnlyProject");
  await fs.mkdir(projectFolder, { recursive:true });
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({ stateDirectory, allowedRoots:[], hostRoots:[{ path:hostRoot, name:"Home" }] });

  assert.deepEqual(await store.listRoots(), [], "Cloud has no implicit host-home root");
  const hostRoots = await store.listHostRoots();
  assert.equal(hostRoots.length, 1);
  assert.equal(hostRoots[0].name, "Home");
  const listing = await store.browseHostRoot(hostRoots[0].id, "Workspace");
  assert.equal(listing.entries.some(entry => entry.relativePath === "Workspace/ReadOnlyProject"), true);
  const project = await store.addFromHostRoot(hostRoots[0].id, "Workspace/ReadOnlyProject");
  assert.equal(project.kind, "folder");
  assert.equal(project.source, "native");
  assert.equal((await store.resolve(project.id)).path, await fs.realpath(projectFolder));
  await expectProjectError(store.browseRoot(hostRoots[0].id, ""), "project_root_not_found");
});

test("single-file conversation history stays in private state storage, is bounded to five, and is safely removed with its registration", async t => {
  const { directory, stateDirectory, store } = await fixture(t);
  const sourceDirectory = path.join(directory, "source-without-metadata"), sourceFile = path.join(sourceDirectory, "notes.txt"),
    sourceSibling = path.join(sourceDirectory, "keep-source-sibling.txt"), sourceSubdirectory = path.join(sourceDirectory, "keep-source-directory");
  await fs.mkdir(sourceDirectory, { recursive:true });
  await fs.writeFile(sourceFile, "notes", { mode:0o600 });
  await fs.writeFile(sourceSibling, "sibling", { mode:0o600 });
  await fs.mkdir(sourceSubdirectory);
  const resource = await store.add(sourceFile, { kind:"file", origin:"native" });
  const written = await store.writeHistory(resource.id, { conversations:Array.from({ length:7 }, (_, index) => conversation(index + 1)) });
  assert.equal(PROJECT_HISTORY_LIMIT, 5);
  assert.deepEqual(written.map(item => item.id), ["conversation-7", "conversation-6", "conversation-5", "conversation-4", "conversation-3"]);
  assert.deepEqual((await store.readHistory(resource.id)).map(item => item.id), written.map(item => item.id));

  const historyDirectory = path.join(stateDirectory, "canvas-agent-file-history", resource.id);
  const historyFile = path.join(historyDirectory, "canvas-agent-history.json");
  const stored = JSON.parse(await fs.readFile(historyFile, "utf8"));
  assert.equal(stored.conversations.length, 5);
  assert.equal(permissionBits(await fs.stat(path.dirname(historyDirectory))), 0o700);
  assert.equal(permissionBits(await fs.stat(historyDirectory)), 0o700);
  assert.equal(permissionBits(await fs.stat(historyFile)), 0o600);
  await assertMissing(path.join(sourceDirectory, ".penecho"));

  await store.remove(resource.id);
  assert.equal((await fs.stat(sourceFile)).isFile(), true);
  assert.equal(await fs.readFile(sourceSibling, "utf8"), "sibling");
  assert.equal((await fs.stat(sourceSubdirectory)).isDirectory(), true);
  await assertMissing(historyDirectory);
});

test("single-file removal refuses suspicious state-history siblings without touching the source", async t => {
  const { directory, stateDirectory, store } = await fixture(t);
  const sourceDirectory = path.join(directory, "source"), sourceFile = path.join(sourceDirectory, "notes.txt");
  await fs.mkdir(sourceDirectory, { recursive:true });
  await fs.writeFile(sourceFile, "source remains", { mode:0o600 });
  const resource = await store.add(sourceFile, { kind:"file", origin:"native" });
  await store.writeHistory(resource.id, { conversations:[conversation(1)] });
  const historyDirectory = path.join(stateDirectory, "canvas-agent-file-history", resource.id), unexpected = path.join(historyDirectory, "keep.txt");
  await fs.writeFile(unexpected, "unexpected state sibling", { mode:0o600 });

  await expectProjectError(store.remove(resource.id), "project_metadata_invalid");
  assert.equal(await fs.readFile(sourceFile, "utf8"), "source remains");
  assert.equal(await fs.readFile(unexpected, "utf8"), "unexpected state sibling");
  assert.equal((await store.resolve(resource.id)).kind, "file", "a refused removal keeps the registration intact");

  await fs.unlink(unexpected);
  await store.remove(resource.id);
  assert.equal(await fs.readFile(sourceFile, "utf8"), "source remains");
  await assertMissing(historyDirectory);
});

test("single-file removal rejects a changed registry identity before deleting private history", async t => {
  const { directory, stateDirectory, store } = await fixture(t);
  const sourceFile = path.join(directory, "source.txt"), decoyFile = path.join(directory, "decoy.txt");
  await fs.writeFile(sourceFile, "source", { mode:0o600 });
  await fs.writeFile(decoyFile, "decoy", { mode:0o600 });
  const resource = await store.add(sourceFile, { kind:"file", origin:"native" });
  await store.writeHistory(resource.id, { conversations:[conversation(1)] });
  const registryFile = path.join(stateDirectory, "canvas-agent-projects.json"), historyDirectory = path.join(stateDirectory, "canvas-agent-file-history", resource.id),
    registry = JSON.parse(await fs.readFile(registryFile, "utf8")), record = registry.projects.find(project => project.id === resource.id), originalPath = record.path;
  record.path = await fs.realpath(decoyFile);
  await fs.writeFile(registryFile, `${JSON.stringify(registry)}\n`, { mode:0o600 });

  await expectProjectError(store.remove(resource.id), "project_changed");
  assert.equal(await fs.readFile(sourceFile, "utf8"), "source");
  assert.equal(await fs.readFile(decoyFile, "utf8"), "decoy");
  assert.equal((await fs.stat(historyDirectory)).isDirectory(), true);

  record.path = originalPath;
  await fs.writeFile(registryFile, `${JSON.stringify(registry)}\n`, { mode:0o600 });
  await store.remove(resource.id);
  assert.equal(await fs.readFile(sourceFile, "utf8"), "source");
  assert.equal(await fs.readFile(decoyFile, "utf8"), "decoy");
  await assertMissing(historyDirectory);
});

test("main resource routes separate native paths from roots and uploads and recognize file IDs", () => {
  const routeStart = mainSource.indexOf("const canvasAgentProjectMatch"), routeEnd = mainSource.indexOf('if (url.pathname === "/api/favorites")', routeStart);
  assert.ok(routeStart > 0 && routeEnd > routeStart);
  const routes = mainSource.slice(routeStart, routeEnd);
  assert.match(routes, /\(\?:local\|file\)-\[0-9a-f\]\{24\}/);
  assert.match(routes, /req\.method === "POST" && url\.pathname === "\/api\/canvas-agent\/projects"[\s\S]*add\(body\?\.path, \{ kind:body\?\.kind, origin:"native" \}\)/);
  assert.match(routes, /"\/api\/canvas-agent\/projects\/from-root"[\s\S]*addFromRoot\(body\?\.rootId, body\?\.path \|\| ""\)/);
  assert.match(routes, /"\/api\/canvas-agent\/projects\/from-host-root"[\s\S]*addFromHostRoot\(body\?\.rootId, body\?\.path \|\| ""\)/);
  assert.match(routes, /"\/api\/canvas-agent\/files"[\s\S]*CANVAS_AGENT_PROJECT_STORE\.upload\(body\)/);
  assert.match(routes, /"\/api\/canvas-agent\/roots"[\s\S]*CANVAS_AGENT_PROJECT_STORE\.listRoots\(\)/);
  assert.match(routes, /"\/api\/canvas-agent\/host-roots"[\s\S]*CANVAS_AGENT_PROJECT_STORE\.listHostRoots\(\)/);
  assert.match(routes, /canvasAgentRootEntriesMatch[\s\S]*getAll\("path"\)\.length > 1[\s\S]*browseRoot\(canvasAgentRootEntriesMatch\[1\], url\.searchParams\.get\("path"\) \|\| ""\)/);
  assert.match(mainSource, /PENECHO_CANVAS_AGENT_ALLOWED_ROOTS[\s\S]*path\.isAbsolute\(selectedPath\)/);

  const remoteLines = remoteCanvasHttpSource.split(/\r?\n/);
  const rawProjectRoute = remoteLines.find(line => line.includes("pattern:/^\\/api\\/canvas-agent\\/projects$/")) || "";
  const fromRootRoute = remoteLines.find(line => line.includes("canvas-agent\\/projects\\/from-root")) || "";
  const filesRoute = remoteLines.find(line => line.includes("canvas-agent\\/files")) || "";
  assert.match(rawProjectRoute, /methods:new Set\(\["GET"\]\)/, "Remote Canvas may list resources but cannot submit a raw native host path");
  assert.match(fromRootRoute, /methods:new Set\(\["POST"\]\)/);
  assert.match(filesRoute, /methods:new Set\(\["POST"\]\)/);
  assert.equal(remoteCanvasHttpSource.includes("canvas-agent/host-roots"), false, "Cloud cannot bridge the implicit host-home browser");
});
