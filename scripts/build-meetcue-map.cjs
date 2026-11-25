#!/usr/bin/env node
"use strict";
// Bundles src/meetcue-map/index.mjs + @dagrejs/dagre (MIT) into a standalone browser/Node module at public/lines/meetcue-map.js.
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src/meetcue-map/index.mjs");
const OUT = path.join(ROOT, "public/lines/meetcue-map.js");

const DAGRE_CANDIDATES = [
  path.join(ROOT, "node_modules/@dagrejs/dagre"),
  path.resolve(ROOT, "../meeting_helper/mobile/node_modules/@dagrejs/dagre"),
];

function findDagreDir() {
  for (const dir of DAGRE_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  throw new Error("@dagrejs/dagre not found in node_modules or ../meeting_helper/mobile/node_modules");
}

async function main() {
  const dagreDir = findDagreDir();
  const dagreNodeModules = path.resolve(dagreDir, "../..");
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    globalName: "__MeetCueMapBundle",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "eof",
    nodePaths: [dagreNodeModules],
    banner: {
      js: "/*! PenEcho MeetCue Map Renderer; includes @dagrejs/dagre (MIT) and Lucide icons (ISC). */",
    },
    footer: {
      js: "if(typeof module!=='undefined'&&module.exports){module.exports=__MeetCueMapBundle;}if(typeof globalThis!=='undefined'){globalThis.MeetCueMap=__MeetCueMapBundle;}",
    },
  });

  const code = result.outputFiles[0].text;
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== code) {
      throw new Error(`${path.relative(ROOT, OUT)} is out of date. Run: node scripts/build-meetcue-map.cjs`);
    }
    console.log(`OK ${path.relative(ROOT, OUT)} (${Buffer.byteLength(code, "utf8")} bytes)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, code, "utf8");
  console.log(`Built ${path.relative(ROOT, OUT)} (${Buffer.byteLength(code, "utf8")} bytes)`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
