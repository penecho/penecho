"use strict";
// Compare the actual public deployment with its recorded canonical distribution.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/canvas-production-sync-20261006"));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
(async () => {
  await fs.mkdir(output, { recursive:true });
  const manifestResponse = await fetch("https://penecho.ai/canvas/UPSTREAM.json", { signal:AbortSignal.timeout(30000) });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json(), files = Object.entries(manifest.files), checks = [];
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  let next = 0;
  await Promise.all(Array.from({ length:4 }, async () => {
    while (next < files.length) {
      const [file, expected] = files[next++];
      assert.ok(!file.split("/").includes(".."));
      const check = { file, expected };
      try {
        const response = await fetch("https://penecho.ai/canvas/" + file, { signal:AbortSignal.timeout(30000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        Object.assign(check, { status:response.status, finalUrl:response.url, bytes:bytes.length, sha256:digest(bytes), cache:response.headers.get("cf-cache-status"), contentType:response.headers.get("content-type") });
        check.matchesManifest = response.status === 200 && check.sha256 === expected;
        check.matchesCurrent071 = check.sha256 === digest(await fs.readFile(path.join(root, "public", file)));
        if (!check.matchesManifest && response.status === 200 && /\.(css|html)$/.test(file)) {
          const normalized = bytes.toString("utf8").replace(/\?v=[a-f0-9]{12}/g, "").replace(/(<meta name="penecho-widget-renderer-version" content=")[a-f0-9]{12}(">)/g, "$1__PENECHO_WIDGET_RENDERER_VERSION__$2");
          check.matchesAfterBuildMarkers = digest(normalized) === expected;
        }
        if (file === "index.html" && new URL(response.url).pathname !== "/canvas/index.html") check.protectedEntryRedirect = true;
        if (!check.matchesManifest) {
          const target = path.join(output, "differences", file);
          await fs.mkdir(path.dirname(target), { recursive:true });
          await fs.writeFile(target, bytes);
        }
      } catch (error) { check.error = error.message; }
      checks.push(check);
    }
  }));
  checks.sort((a,b) => a.file.localeCompare(b.file));
  const differences = checks.filter(x=>!x.matchesManifest), unresolved = differences.filter(x=>!x.matchesAfterBuildMarkers && !x.protectedEntryRedirect);
  const report = { checkedAt:new Date().toISOString(), upstreamCommit:manifest.commit, total:checks.length, matchedManifest:checks.filter(x=>x.matchesManifest).length, differences, unresolved, differsFromCurrent071:checks.filter(x=>!x.matchesCurrent071).map(x=>x.file), checks };
  await fs.writeFile(path.join(output, "UPSTREAM.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, upstreamCommit:report.upstreamCommit, total:report.total, matchedManifest:report.matchedManifest, differences:report.differences, unresolved:report.unresolved, differsFromCurrent071:report.differsFromCurrent071 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
