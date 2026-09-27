"use strict";

// Copy the canonical working tree, including untracked source, without sharing
// mutable dependencies or build outputs with the checkout.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), destination = process.argv[2];
if (!destination || !path.isAbsolute(destination) || fs.existsSync(destination)) {
  throw new Error("Provide a new absolute snapshot directory.");
}
const git = args => execFileSync("git", args, { cwd:root });
const digest = data => crypto.createHash("sha256").update(data).digest("hex");
const files = [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean))].sort();
const manifest = {
  createdAt:new Date().toISOString(), canonicalRoot:root,
  commit:git(["rev-parse", "HEAD"]).toString().trim(),
  desktopVersion:require("../package.json").config.desktopVersion,
  diffSha256:digest(git(["diff", "HEAD", "--binary"])), files:[],
};
for (const relative of files) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) continue; // Preserve working-tree deletions.
  const stat = fs.lstatSync(source);
  if (!stat.isFile()) throw new Error(`Unsupported snapshot entry: ${relative}`);
  const data = fs.readFileSync(source), target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.writeFileSync(target, data, { mode:stat.mode });
  manifest.files.push({ path:relative, sha256:digest(data), size:data.length });
}
fs.writeFileSync(path.join(destination, ".penecho-build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ destination, files:manifest.files.length, desktopVersion:manifest.desktopVersion }));
