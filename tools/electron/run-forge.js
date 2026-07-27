"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function resolveDesktopModule(name) {
  try {
    return require.resolve(name, { paths:[__dirname] });
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      console.error('Desktop build dependencies are missing. Run "npm run desktop:deps" first.');
      process.exit(1);
    }
    throw error;
  }
}

function linkElectronForStart() {
  if (process.argv[2] !== "start") return () => {};
  const source = path.dirname(resolveDesktopModule("electron/package.json"));
  const target = path.join(ROOT, "node_modules", "electron");
  if (fs.existsSync(target)) return () => {};
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  return () => {
    try {
      if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
}

const forgeCli = resolveDesktopModule("@electron-forge/cli/dist/electron-forge.js");
const cleanup = linkElectronForStart();
const child = spawn(process.execPath, [forgeCli, ...process.argv.slice(2)], {
  cwd:ROOT,
  stdio:"inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", error => {
  cleanup();
  throw error;
});
child.on("exit", (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
