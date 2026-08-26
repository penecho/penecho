"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");

const ROOT = path.resolve(__dirname, ".."), source = path.join(ROOT, "out", "make"), destination = path.join(ROOT, "release"),
  desktopVersion = pkg.config.desktopVersion,
  targetPlatform = process.env.PENECHO_TARGET_PLATFORM || process.platform,
  targetArch = process.env.PENECHO_TARGET_ARCH || process.arch,
  extensions = new Set([".dmg", ".exe", ".msi", ".nupkg", ".zip"]), exact = new Set(["RELEASES"]);

function walk(directory) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes:true }); } catch { return []; }
  return entries.flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

fs.mkdirSync(destination, { recursive:true });
const copied = [];
for (const file of walk(source)) {
  if (!extensions.has(path.extname(file).toLowerCase()) && !exact.has(path.basename(file))) continue;
  const extension = path.extname(file).toLowerCase();
  let name = extension === ".dmg" ? `PenEcho-${desktopVersion}-mac-${targetArch}.dmg`
    : extension === ".zip" ? `PenEcho-${desktopVersion}-${targetPlatform === "darwin" ? "mac" : "win"}-${targetArch}.zip`
      : path.basename(file), target = path.join(destination, name), suffix = 1;
  while (fs.existsSync(target)) {
    const targetExtension = path.extname(name), stem = path.basename(name, targetExtension);
    target = path.join(destination, `${stem}-${suffix++}${targetExtension}`);
  }
  fs.copyFileSync(file, target);
  copied.push(target);
}
const icon = path.join(ROOT, "build", "icons", "penecho.ico");
if (targetPlatform === "win32" && fs.existsSync(icon)) {
  const target = path.join(destination, "penecho.ico");
  fs.copyFileSync(icon, target);
  copied.push(target);
}
if (!copied.length) throw new Error(`No distributables found under ${source}`);
const sums = copied.filter(file => path.basename(file) !== "RELEASES").sort().map(file => {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return `${digest}  ${path.basename(file)}`;
});
fs.writeFileSync(path.join(destination, `SHA256SUMS-${targetPlatform}-${targetArch}.txt`), `${sums.join("\n")}\n`);
console.log(`Collected ${copied.length} release assets in ${destination}`);
