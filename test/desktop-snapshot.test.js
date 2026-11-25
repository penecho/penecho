"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts/snapshot-desktop.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

test("desktop test versions are confined to explicit build snapshots", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-snapshot-test-"));
  const protectedFiles = ["package.json", "package-lock.json", "tools/electron/package-lock.json"];
  const original = protectedFiles.map(file => fs.readFileSync(path.join(root, file)));
  try {
    // Exercise a real, isolated checkout even when this test is itself run
    // from an exported build snapshot without Git metadata.
    const canonical = path.join(temp, "canonical");
    for (const file of [...protectedFiles, "scripts/snapshot-desktop.cjs"]) {
      const target = path.join(canonical, file);
      fs.mkdirSync(path.dirname(target), { recursive:true });
      fs.copyFileSync(path.join(root, file), target);
    }
    execFileSync("git", ["init", "--quiet", canonical]);
    execFileSync("git", ["-C", canonical, "-c", "user.name=Snapshot test", "-c", "user.email=snapshot-test@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
    const fixtureScript = path.join(canonical, "scripts/snapshot-desktop.cjs");
    const input = path.join(temp, "input/package");
    fs.mkdirSync(path.join(input, "src"), { recursive:true });
    fs.writeFileSync(path.join(input, "package.json"), original[0]);
    fs.writeFileSync(path.join(input, "src/fixture.js"), "module.exports = 'current-source';\n");
    const archive = path.join(temp, "input.tgz");
    execFileSync("tar", ["-czf", archive, "-C", path.dirname(input), "package"]);
    const sourcePackage = JSON.parse(original[0]);
    const override = sourcePackage.config.desktopVersion === "1.3.9" ? "1.3.8" : "1.3.9";
    for (const version of [null, override]) {
      const output = path.join(temp, version || "default");
      const snapshot = output + ".tgz";
      execFileSync(process.execPath, [fixtureScript, archive, snapshot, ...(version ? [`--desktop-version=${version}`] : [])]);
      fs.mkdirSync(output);
      execFileSync("tar", ["-xzf", snapshot, "-C", output]);
      const pkg = JSON.parse(fs.readFileSync(path.join(output, "package.json")));
      const manifest = JSON.parse(fs.readFileSync(path.join(output, ".penecho-build-manifest.json")));
      const expected = structuredClone(sourcePackage);
      if (version) expected.config.desktopVersion = version;
      assert.deepEqual(pkg, expected);
      assert.equal(manifest.desktopVersion, version || sourcePackage.config.desktopVersion);
      assert.equal(manifest.canonicalDesktopVersion, sourcePackage.config.desktopVersion);
      assert.equal(manifest.desktopVersionOverride, version);
      for (const file of ["package.json", "src/fixture.js", "package-lock.json"]) {
        assert.equal(manifest.files.find(entry => entry.path === file)?.sha256, hash(fs.readFileSync(path.join(output, file))));
      }
      assert.deepEqual(fs.readFileSync(path.join(output, "package-lock.json")), original[1]);
      assert.deepEqual(fs.readFileSync(path.join(output, "tools/electron/package-lock.json")), original[2]);
    }
    protectedFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(root, file)), original[index]));
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("invalid or ambiguous desktop-version options fail before staging", () => {
  for (const options of [
    ["--desktop-version="], ["--desktop-version=1.3"], ["--desktop-version=01.3.9"],
    ["--desktop-version=1.3.9-beta"], ["--desktop-version=65536.0.0"],
    ["--unknown=1.3.9"], ["--desktop-version=1.3.9", "--desktop-version=1.3.8"],
  ]) {
    const result = spawnSync(process.execPath, [script, "unused-input.tgz", "unused-output.tgz", ...options], { encoding:"utf8" });
    assert.notEqual(result.status, 0, options.join(" "));
    assert.match(result.stderr, /Usage:|desktop version override/);
  }
});
