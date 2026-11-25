"use strict";
// Test Cloud's real review-all route against disposable memory storage. The
// supplied checkout is read only; no live account, server or database is used.
// PENECHO_CLOUD_TEST_SOURCE=/path/to/cloud node scripts/verify-cloud-review.cjs
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  assert.ok(process.env.PENECHO_CLOUD_TEST_SOURCE, "Set PENECHO_CLOUD_TEST_SOURCE to a Cloud source checkout.");
  const source = path.resolve(process.env.PENECHO_CLOUD_TEST_SOURCE);
  const load = file => import(pathToFileURL(path.join(source, file)).href);
  const { buildApp } = await load("src/app.mjs");
  const { putLineBlob } = await load("src/services/line-projects.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pe582-cloud-review-"));
  let app;
  try {
    app = await buildApp({ logger:false, env:{ NODE_ENV:"test", AUTH_MODE:"development", DATA_MODE:"memory", SESSION_MODE:"memory", STORAGE_MODE:"memory", LINES_HOSTED_ENABLED:"true", LINES_WORKSPACE_ROOT:root } });
    const email = "review@pe582.test", password = "Review verification password 7";
    const registration = await app.inject({ method:"POST", url:"/api/v1/auth/register", payload:{ name:"Review test", email, password, termsAccepted:true, privacyAccepted:true } });
    await app.inject({ method:"POST", url:"/api/v1/auth/verify-email", payload:{ email, code:registration.json().developmentCode } });
    const login = await app.inject({ method:"POST", url:"/api/v1/auth/login", payload:{ email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const userId = login.json().account.id;
    const cookie = [].concat(login.headers["set-cookie"]).map(value => value.split(";", 1)[0]).join("; ");
    const headers = { cookie, "x-penecho-csrf":login.json().csrfToken };
    const { repository, storage } = app.services;
    const project = await repository.ensureLineProject(userId, "review-test", "Review test");
    const documents = { "topics/rain.md":`---\nid: PE-1\nstatus: done\n---\n\n# Rain\n\n## Ask · 2026-11-18 07:00\n\nReview the results.\n${Array.from({ length:12 }, (_, i) => `\n## [x] Work ${i + 1} · @codex · 1 min\n\n[Details](rain/work-${i + 1}.md)\n`).join("")}` };
    for (let i = 1; i <= 12; i++) documents[`topics/rain/work-${i}.md`] = `---\nstep: Work ${i}\n---\n\n## Result\n\nResult ${i}.\n`;
    const files = [];
    for (const [name, text] of Object.entries(documents)) {
      const bytes = Buffer.from(text), sha256 = createHash("sha256").update(bytes).digest("hex");
      await putLineBlob({ repository, storage, userId, project, sha256, bytes });
      files.push({ path:name, sha256, size:bytes.length });
    }
    await repository.setLineProjectFiles(userId, project.id, { name:project.name, files, ifRev:project.rev });
    const base = "/api/v1/line-projects/review-test";
    const state = await app.inject({ url:`${base}/state`, headers:{ cookie } });
    assert.equal(state.statusCode, 200, state.body);
    const before = await repository.lineProject(userId, "review-test");
    const save = repository.setLineProjectFiles.bind(repository);
    let stale = true, commits = 0;
    repository.setLineProjectFiles = async (...args) => {
      if (stale) { stale = false; return { stale:true }; }
      commits++;
      return save(...args);
    };
    const send = () => app.inject({ method:"POST", url:`${base}/topics/rain/review-all`, headers, payload:{} });
    const rejected = await send();
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.deepEqual((await repository.lineProject(userId, "review-test")).files, before.files, "a rejected revision saves none of the review marks");
    const reviewed = await send();
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(commits, 1, "all twelve reviews publish in one commit");
    const after = await repository.lineProject(userId, "review-test");
    assert.equal(after.rev, before.rev + 1);
    for (let i = 1; i <= 12; i++) {
      const file = after.files.find(f => f.path === `topics/rain/work-${i}.md`);
      const blob = await repository.lineProjectBlob(project.id, file.sha256);
      const stored = await storage.get(blob.objectKey);
      assert.match(Buffer.from(stored.bytes).toString(), /^reviewed: /m, `Work ${i} is reviewed`);
    }
    assert.equal((await send()).statusCode, 200, "retrying the completed action succeeds");
    assert.equal((await repository.lineProject(userId, "review-test")).rev, after.rev, "retry does not change already saved review times");
    console.log("Cloud review-all passed: rejected save changes no review marks; twelve marks save in one revision; retry is idempotent.");
  } finally {
    await app?.close();
    await fs.rm(root, { recursive:true, force:true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
