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
  PROJECT_UPLOAD_IDLE_TTL_MS,
} = require("../src/server/canvas-agent/project-store.js");
const { macosRemoteRoots, windowsDriveRoots } = require("../src/server/canvas-agent/host-roots.js");

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

function assertPrivateMode(info, expected) {
  if (process.platform !== "win32") assert.equal(permissionBits(info), expected);
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

test("PenEcho Agent resource projections hide canonical folder and file paths until resolve", async t => {
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
  assert.match(filePluginBlock, /agentCtx\.tools\.register\(project(?:Document|Image|Database|Text|Binary)ReaderTool/);
  assert.match(runtimeSource, /const PenEchoDocumentReaderPlugin = \{[\s\S]*?name:'penecho-document-reader'[\s\S]*?agentCtx\.tools\.register\(projectDocumentReaderTool/);
  assert.match(filePluginBlock, /agentCtx\.plugin\(PenEchoDocumentReaderPlugin/);
  assert.doesNotMatch(filePluginBlock, /agentCtx\.tools\.register\(projectDocumentReaderTool/);
  assert.doesNotMatch(filePluginBlock, /ToolFs\.apply|projectBashTool|projectPluginLoaderTool|projectGlobTool|projectGrepTool/);
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
  assertPrivateMode(await fs.stat(uploadRoot), 0o700);
  assertPrivateMode(await fs.stat(managedDirectory), 0o700);
  assertPrivateMode(await fs.stat(managedFile), 0o600);
  await fs.writeFile(path.join(managedDirectory, ".upload-12345678-1234-4123-8123-123456789abc.tmp"), "partial", { mode:0o600 });

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

test("uploading the same file reuses one managed browser item", async t => {
  const { store } = await fixture(t),content=Buffer.from("same copied file","utf8"),input={name:"copied.txt",mediaType:"text/plain",bytes:content.length,data:content.toString("base64")};
  const first=await store.upload(input,{now:1_000}),second=await store.upload(input,{now:2_000}),changed=Buffer.from("different file!","utf8"),third=await store.upload({name:"copied.txt",mediaType:"text/plain",bytes:changed.length,data:changed.toString("base64")},{now:3_000});
  assert.equal(second.id,first.id);
  assert.equal(first.reused,false);
  assert.equal(second.reused,true);
  assert.notEqual(third.id,first.id);
  assert.equal((await store.list()).filter(project=>project.name==="copied.txt").length,2);
});

test("uploads accept every file type while unsafe specialized content falls back to the binary reader", async t => {
  const { store } = await fixture(t);
  const invalidPdf = Buffer.from("not a PDF", "utf8");
  const forgedPdf = await store.upload({
    name:"forged.pdf", mediaType:"application/pdf", bytes:invalidPdf.length, data:invalidPdf.toString("base64"),
  });
  assert.equal(forgedPdf.reader, "binary");
  const invalidDatabase = Buffer.from("not sqlite", "utf8");
  const forgedDatabase = await store.upload({
    name:"forged.sqlite", mediaType:"application/x-sqlite3", bytes:invalidDatabase.length, data:invalidDatabase.toString("base64"),
  });
  assert.equal(forgedDatabase.reader, "binary");

  const incompleteOffice = new JSZip();
  incompleteOffice.file("[Content_Types].xml", "<Types/>");
  const incompleteBytes = await incompleteOffice.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  const incompleteDocument = await store.upload({
    name:"incomplete.docx", mediaType:"application/zip", bytes:incompleteBytes.length, data:incompleteBytes.toString("base64"),
  });
  assert.equal(incompleteDocument.reader, "binary");
  const incompletePresentation = await store.upload({
    name:"incomplete.pptx", mediaType:"application/zip", bytes:incompleteBytes.length, data:incompleteBytes.toString("base64"),
  });
  assert.equal(incompletePresentation.reader, "binary");

  const unknownText = Buffer.from("custom text format", "utf8"), textUpload = await store.upload({
    name:"notes.penecho-custom", mediaType:"application/x-penecho-custom", bytes:unknownText.length, data:unknownText.toString("base64"),
  });
  assert.equal(textUpload.reader, "text");
  const unknownBinary = Buffer.from([0, 1, 2, 0xff]), binaryUpload = await store.upload({
    name:"archive.unknown", mediaType:"not a valid media type", bytes:unknownBinary.length, data:unknownBinary.toString("base64"),
  });
  assert.equal(binaryUpload.reader, "binary");
  assert.equal(binaryUpload.mediaType, "");

  const validOffice = new JSZip();
  validOffice.file("[Content_Types].xml", "<Types/>");
  validOffice.folder("word").file("document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>");
  const validBytes = await validOffice.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  const uploaded = await store.upload({
    name:"notes.docx", mediaType:"application/zip", bytes:validBytes.length, data:validBytes.toString("base64"),
  });
  assert.equal(uploaded.reader, "document");
  assert.equal((await store.resolve(uploaded.id)).bytes, validBytes.length);
  const validPresentation = new JSZip();
  validPresentation.file("[Content_Types].xml", "<Types/>");
  validPresentation.folder("ppt").file("presentation.xml", "<p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>");
  const validPresentationBytes = await validPresentation.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  const uploadedPresentation = await store.upload({
    name:"slides.pptx", mediaType:"application/zip", bytes:validPresentationBytes.length, data:validPresentationBytes.toString("base64"),
  });
  assert.equal(uploadedPresentation.reader, "document");
});

test("uploaded copies expire after 24 inactive hours while current and recent files remain", async t => {
  const { store } = await fixture(t), now = 2_000_000_000_000;
  const upload = (name, openedAt) => {
    const content = Buffer.from(name, "utf8");
    return store.upload({ name, bytes:content.length, data:content.toString("base64") }, { now:openedAt });
  };
  const expired = await upload("expired.txt", now - PROJECT_UPLOAD_IDLE_TTL_MS);
  const current = await upload("current.txt", now - PROJECT_UPLOAD_IDLE_TTL_MS);
  const recent = await upload("recent.txt", now - PROJECT_UPLOAD_IDLE_TTL_MS + 1);
  const expiredPath = (await store.resolve(expired.id)).path, expiredDirectory = path.dirname(expiredPath), expiredHistory = path.join(store.fileHistoryDirectory, expired.id);
  await store.writeHistory(expired.id, { conversations:[conversation(1)] });

  const first = await store.cleanupUploads({ now, protectedProjectIds:[current.id] });
  assert.deepEqual(first.expiredIds, [expired.id]);
  await assertMissing(expiredPath);
  await assertMissing(expiredDirectory);
  await assertMissing(expiredHistory);
  assert.equal((await store.resolve(current.id)).name, "current.txt");
  assert.equal((await store.resolve(recent.id)).name, "recent.txt");

  const second = await store.cleanupUploads({ now });
  assert.deepEqual(second.expiredIds, [current.id]);
  await expectProjectError(store.resolve(current.id), "project_not_found");
  assert.equal((await store.resolve(recent.id)).name, "recent.txt");
});

test("opening an uploaded file serializes its activity touch before cleanup", async t => {
  const { store } = await fixture(t), now = Date.now(), content = Buffer.from("opening", "utf8");
  const uploaded = await store.upload({ name:"opening.txt", bytes:content.length, data:content.toString("base64") }, { now:now - PROJECT_UPLOAD_IDLE_TTL_MS });
  const [opened, cleanup] = await Promise.all([
    store.resolve(uploaded.id, { touch:true }),
    store.cleanupUploads({ now }),
  ]);
  assert.equal(opened.id, uploaded.id);
  assert.deepEqual(cleanup.expiredIds, []);
  assert.equal((await store.resolve(uploaded.id)).name, "opening.txt");
});

test("each upload removes safe orphan copies and their private history", async t => {
  const { store } = await fixture(t), now = 2_000_000_000_000, content = Buffer.from("orphan", "utf8");
  const orphan = await store.upload({ name:"orphan.penecho-custom", bytes:content.length, data:content.toString("base64") }, { now });
  const orphanPath = (await store.resolve(orphan.id)).path, orphanDirectory = path.dirname(orphanPath), orphanHistory = path.join(store.fileHistoryDirectory, orphan.id);
  await store.writeHistory(orphan.id, { conversations:[conversation(2)] });
  await fs.writeFile(path.join(orphanDirectory, ".upload-12345678-1234-4123-8123-123456789abc.tmp"), "partial", { mode:0o600 });
  await store.writeRegistry([]);

  const nextContent = Buffer.from("next", "utf8"), next = await store.upload({ name:"next.txt", bytes:nextContent.length, data:nextContent.toString("base64") }, { now });
  await assertMissing(orphanPath);
  await assertMissing(orphanDirectory);
  await assertMissing(orphanHistory);
  assert.equal((await store.resolve(next.id)).name, "next.txt");
});

test("automatic cleanup failures are logged without blocking cleanup callers or uploads", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-cleanup-failure-")), stateDirectory = path.join(directory, "state"), warnings = [];
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  class FailingCleanupStore extends CanvasAgentProjectStore {
    async cleanupUploadsLocked() { throw new Error("simulated cleanup failure"); }
  }
  const store = new FailingCleanupStore({ stateDirectory, logger:entry => warnings.push(entry) });

  const cleanup = await store.cleanupUploads();
  assert.equal(cleanup.failed, true);
  assert.equal(warnings[0]?.errorCode, "cleanup_failed");
  assert.equal(JSON.stringify(warnings).includes("simulated cleanup failure"), false, "cleanup warnings do not expose filesystem error details");

  const content = Buffer.from("upload continues", "utf8"), uploaded = await store.upload({
    name:"continues.txt", bytes:content.length, data:content.toString("base64"),
  });
  assert.equal((await store.resolve(uploaded.id)).name, "continues.txt");

  const storeWithBrokenLogger = new FailingCleanupStore({ stateDirectory:path.join(directory, "broken-logger"), logger:() => { throw new Error("logger failed"); } });
  const secondContent = Buffer.from("logger cannot block", "utf8"), second = await storeWithBrokenLogger.upload({
    name:"logger.txt", bytes:secondContent.length, data:secondContent.toString("base64"),
  });
  assert.equal((await storeWithBrokenLogger.resolve(second.id)).name, "logger.txt");
});

test("allowed server roots expose opaque IDs and relative folders while rejecting absolute, traversal, metadata, and symlink paths", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-roots-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const stateDirectory = path.join(directory, "state"), allowedRoot = path.join(directory, "server-private-root"), outside = path.join(directory, "outside");
  await fs.mkdir(path.join(allowedRoot, "Projects", "Nested"), { recursive:true });
  await fs.mkdir(path.join(allowedRoot, ".restricted", "ApprovedProject"), { recursive:true });
  await fs.mkdir(path.join(allowedRoot, ".penecho", "Hidden"), { recursive:true });
  await fs.mkdir(outside, { recursive:true });
  await fs.symlink(outside, path.join(allowedRoot, "Escape"), process.platform === "win32" ? "junction" : "dir");
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({
    stateDirectory,
    allowedRoots:[{ path:allowedRoot, name:"Approved projects", guardPrivate:true }, path.join(allowedRoot, ".penecho")],
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
  assert.equal(rootListing.entries.find(entry => entry.name === ".restricted")?.approvalRequired, true);
  assert.equal(rootListing.entries.some(entry => entry.name === ".penecho" || entry.name === "Escape"), false);
  assert.equal(JSON.stringify(rootListing).includes(allowedRoot), false);

  const project = await store.addFromRoot(roots[0].id, "Projects/Nested");
  assert.equal(project.source, "server");
  assert.equal(project.path, "Approved projects/Projects/Nested");
  assert.equal(project.path.includes(allowedRoot), false);
  assert.equal((await store.resolve(project.id)).path, await fs.realpath(path.join(allowedRoot, "Projects", "Nested")));
  await expectProjectError(store.browseRoot(roots[0].id, ".restricted"), "project_root_approval_required");
  const approvedProject = await store.addFromRoot(roots[0].id, ".restricted/ApprovedProject", { approved:true });
  assert.equal((await store.list()).some(item => item.id === approvedProject.id), true, "an approved private root project remains registered");

  const restartedStore = new CanvasAgentProjectStore({
    stateDirectory,
    allowedRoots:[{ path:allowedRoot, name:"Approved projects", guardPrivate:true }],
  });
  assert.deepEqual(await restartedStore.listRoots(), roots, "opaque root ids remain stable across host restarts");
  assert.equal((await restartedStore.resolve(project.id)).id, project.id, "server-root projects remain registered after restart");
  assert.equal((await restartedStore.resolve(approvedProject.id)).id, approvedProject.id, "approval is retained by the exact registered project");
  assertPrivateMode(await fs.stat(path.join(stateDirectory, "canvas-agent-root-id.key")), 0o600);

  for (const unsafe of ["/etc", "../outside", "Projects/../outside", ".penecho", "C:\\Windows", "Projects/bad\nname", "Projects/\u202espoof"]) {
    await expectProjectError(store.browseRoot(roots[0].id, unsafe), "project_root_path_invalid");
  }
  await expectProjectError(store.browseRoot(roots[0].id, "Escape"), "project_unavailable");
  await expectProjectError(store.browseRoot("root-000000000000000000000000", ""), "project_root_not_found");
});

test("host-only roots stay separate from Cloud roots while local and LAN clients browse them in-app", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-host-roots-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const stateDirectory = path.join(directory, "state"), hostRoot = path.join(directory, "host-home"), projectFolder = path.join(hostRoot, "Workspace", "ReadOnlyProject");
  await fs.mkdir(projectFolder, { recursive:true });
  await fs.mkdir(path.join(hostRoot, ".ssh", "PrivateProject"), { recursive:true });
  await fs.mkdir(path.join(hostRoot, "Library", "PrivateProject"), { recursive:true });
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({ stateDirectory, allowedRoots:[], hostRoots:[{ path:hostRoot, name:"Home", guardPrivate:true }] });

  assert.deepEqual(await store.listRoots(), [], "a host-only root is not implicitly copied into the Cloud root set");
  const hostRoots = await store.listHostRoots();
  assert.equal(hostRoots.length, 1);
  assert.equal(hostRoots[0].name, "Home");
  const homeListing = await store.browseHostRoot(hostRoots[0].id, "");
  assert.equal(homeListing.selectable, false);
  assert.equal(homeListing.entries.find(entry => entry.name === ".ssh")?.approvalRequired, true);
  assert.equal(homeListing.entries.find(entry => entry.name === "Library")?.approvalRequired, true);
  const listing = await store.browseHostRoot(hostRoots[0].id, "Workspace");
  assert.equal(listing.selectable, true);
  assert.equal(listing.entries.some(entry => entry.relativePath === "Workspace/ReadOnlyProject"), true);
  const project = await store.addFromHostRoot(hostRoots[0].id, "Workspace/ReadOnlyProject");
  assert.equal(project.kind, "folder");
  assert.equal(project.source, "native");
  assert.equal((await store.resolve(project.id)).path, await fs.realpath(projectFolder));
  await expectProjectError(store.addFromHostRoot(hostRoots[0].id, ""), "project_root_path_invalid");
  await expectProjectError(store.browseHostRoot(hostRoots[0].id, ".ssh"), "project_root_approval_required");
  await expectProjectError(store.browseHostRoot(hostRoots[0].id, "Library"), "project_root_approval_required");
  assert.equal((await store.browseHostRoot(hostRoots[0].id, ".ssh", { approved:true })).selectable, true);
  assert.equal((await store.addFromHostRoot(hostRoots[0].id, ".ssh/PrivateProject", { approved:true })).kind, "folder");
  await expectProjectError(store.browseRoot(hostRoots[0].id, ""), "project_root_not_found");
});

test("Windows host roots expose every drive letter through the built-in local and Cloud root model", () => {
  assert.deepEqual(windowsDriveRoots("darwin"), []);
  const roots = windowsDriveRoots("win32");
  assert.equal(roots.length, 26);
  assert.deepEqual(roots[0], { name:"A:", path:"A:\\", guardPrivate:true });
  assert.deepEqual(roots.at(-1), { name:"Z:", path:"Z:\\", guardPrivate:true });
});

test("an OS-unreadable folder returns a visible non-selectable browser state instead of failing", {
  skip:process.platform === "win32" || typeof process.getuid !== "function" || process.getuid() === 0,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-denied-root-"));
  const stateDirectory = path.join(directory, "state"), root = path.join(directory, "root"), blocked = path.join(root, "Blocked");
  t.after(async () => { await fs.chmod(blocked, 0o700).catch(() => {}); await fs.rm(directory, { recursive:true, force:true }); });
  await fs.mkdir(blocked, { recursive:true });
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({ stateDirectory, allowedRoots:[root] }), rootId = (await store.listRoots())[0].id;
  await fs.chmod(blocked, 0o000);
  const view = await store.browseRoot(rootId, "Blocked");
  assert.equal(view.permissionDenied, true);
  assert.equal(view.selectable, false);
  assert.deepEqual(view.entries, []);
});

test("macOS exposes Home and mounted volumes to the linked-device root model without selecting their containers", async t => {
  assert.deepEqual(macosRemoteRoots("/Users/example", "win32"), []);
  assert.deepEqual(macosRemoteRoots("/Users/example", "darwin"), [
    { name:"Home", path:"/Users/example", guardPrivate:true, requireChild:true },
    { name:"External volumes", path:"/Volumes", guardPrivate:true, requireChild:true },
  ]);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penecho-canvas-macos-roots-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const stateDirectory = path.join(directory, "state"), home = path.join(directory, "home"), projectFolder = path.join(home, "Workspace");
  await fs.mkdir(projectFolder, { recursive:true });
  await fs.mkdir(stateDirectory, { recursive:true, mode:0o700 });
  const store = new CanvasAgentProjectStore({
    stateDirectory,
    allowedRoots:[{ name:"Home", path:home, guardPrivate:true, requireChild:true }],
  });
  const [root] = await store.listRoots();
  assert.equal(root.name, "Home");
  assert.equal((await store.browseRoot(root.id, "")).selectable, false);
  assert.equal((await store.browseRoot(root.id, "Workspace")).selectable, true);
  await expectProjectError(store.addFromRoot(root.id, ""), "project_root_path_invalid");
  const project = await store.addFromRoot(root.id, "Workspace");
  assert.equal(project.source, "server");
  assert.equal((await store.resolve(project.id)).path, await fs.realpath(projectFolder));
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
  const conversations=Array.from({ length:7 }, (_, index) => conversation(index + 1));
  conversations.at(-1).items.push(
    {id:"assistant-7",type:"message",role:"assistant",text:"Done",attachmentCount:0,eventKey:"7:2:final",turn:7,step:2,evaluation:"like",evaluationModel:"gpt-5.6-sol",evaluationChannel:"codex-cli"},
    {id:"tool-7",type:"tool",callId:"call-7",name:"canvas_read",argumentsText:"{}",resultText:"Done",state:"done",turn:7,step:1},
  );
  const written = await store.writeHistory(resource.id, { conversations });
  assert.equal(PROJECT_HISTORY_LIMIT, 5);
  assert.deepEqual(written.map(item => item.id), ["conversation-7", "conversation-6", "conversation-5", "conversation-4", "conversation-3"]);
  assert.deepEqual((await store.readHistory(resource.id)).map(item => item.id), written.map(item => item.id));
  assert.deepEqual(written[0].items.slice(1).map(item=>({type:item.type,turn:item.turn,step:item.step})),[
    {type:"message",turn:7,step:2},{type:"tool",turn:7,step:1},
  ],"message ordering coordinates survive private history persistence");
  assert.deepEqual(written[0].items[1],{
    id:"assistant-7",type:"message",role:"assistant",text:"Done",attachmentCount:0,eventKey:"7:2:final",turn:7,step:2,evaluation:"like",evaluationModel:"gpt-5.6-sol",evaluationChannel:"codex-cli",
  },"content-free response evaluation metadata survives private history persistence");

  const historyDirectory = path.join(stateDirectory, "canvas-agent-file-history", resource.id);
  const historyFile = path.join(historyDirectory, "canvas-agent-history.json");
  const stored = JSON.parse(await fs.readFile(historyFile, "utf8"));
  assert.equal(stored.conversations.length, 5);
  assertPrivateMode(await fs.stat(path.dirname(historyDirectory)), 0o700);
  assertPrivateMode(await fs.stat(historyDirectory), 0o700);
  assertPrivateMode(await fs.stat(historyFile), 0o600);
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
  assert.match(routes, /"\/api\/canvas-agent\/projects\/from-root"[\s\S]*addFromRoot\(body\?\.rootId, body\?\.path \|\| "", \{ approved:body\?\.approved === true \}\)/);
  assert.match(routes, /"\/api\/canvas-agent\/projects\/from-host-root"[\s\S]*addFromHostRoot\(body\?\.rootId, body\?\.path \|\| "", \{ approved:body\?\.approved === true \}\)/);
  assert.match(routes, /"\/api\/canvas-agent\/files"[\s\S]*canvasAgent\.activeProjectIds\(\)[\s\S]*CANVAS_AGENT_PROJECT_STORE\.upload\(body, \{ protectedProjectIds \}\)/);
  assert.match(routes, /"\/api\/canvas-agent\/roots"[\s\S]*CANVAS_AGENT_PROJECT_STORE\.listRoots\(\)/);
  assert.match(routes, /"\/api\/canvas-agent\/host-roots"[\s\S]*CANVAS_AGENT_PROJECT_STORE\.listHostRoots\(\)/);
  assert.match(routes, /canvasAgentRootEntriesMatch[\s\S]*getAll\("approved"\)[\s\S]*browseRoot\(canvasAgentRootEntriesMatch\[1\], url\.searchParams\.get\("path"\) \|\| "", \{ approved:url\.searchParams\.get\("approved"\) === "1" \}\)/);
  assert.match(mainSource, /PENECHO_CANVAS_AGENT_ALLOWED_ROOTS[\s\S]*path\.isAbsolute\(selectedPath\)/);
  assert.match(mainSource, /macosRemoteRoots\(os\.homedir\(\)\)[\s\S]*windowsDriveRoots\(\)[\s\S]*CANVAS_AGENT_ALLOWED_ROOTS = \[\.\.\.CANVAS_AGENT_CONFIGURED_ROOTS, \.\.\.CANVAS_AGENT_MACOS_REMOTE_ROOTS, \.\.\.CANVAS_AGENT_WINDOWS_DRIVE_ROOTS\]/);
  assert.match(mainSource, /CANVAS_AGENT_PROJECT_STORE\.cleanupUploads\(\)[^\n]*;\s*server\.listen/, "startup cleanup must not gate server listening");

  const remoteLines = remoteCanvasHttpSource.split(/\r?\n/);
  const rawProjectRoute = remoteLines.find(line => line.includes("pattern:/^\\/api\\/canvas-agent\\/projects$/")) || "";
  const fromRootRoute = remoteLines.find(line => line.includes("canvas-agent\\/projects\\/from-root")) || "";
  const filesRoute = remoteLines.find(line => line.includes("canvas-agent\\/files")) || "";
  assert.match(rawProjectRoute, /methods:new Set\(\["GET"\]\)/, "Remote Canvas may list resources but cannot submit a raw native host path");
  assert.match(fromRootRoute, /methods:new Set\(\["POST"\]\)/);
  assert.match(filesRoute, /methods:new Set\(\["POST"\]\)/);
  assert.equal(remoteCanvasHttpSource.includes("canvas-agent/host-roots"), false, "Cloud cannot bridge the implicit host-home browser");
});
