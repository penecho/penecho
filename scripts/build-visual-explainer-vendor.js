#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FILES = Object.freeze([
  {
    source:"node_modules/@antv/infographic/dist/infographic.min.js",
    target:"public/vendor/antv-infographic-0.2.20.min.js",
  },
  {
    source:"node_modules/@antv/infographic/LICENSE",
    target:"public/vendor/antv-infographic.LICENSE",
  },
]);

function expectedFiles() {
  return FILES.map(file => ({
    ...file,
    sourcePath:path.join(ROOT, file.source),
    targetPath:path.join(ROOT, file.target),
  }));
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  for (const file of expectedFiles()) {
    if (!fs.existsSync(file.sourcePath)) {
      console.error(`${file.source} is missing. Run npm install before building Visual Explainer assets.`);
      return 1;
    }
    const expected = fs.readFileSync(file.sourcePath),
      current = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : null;
    if (check) {
      if (!current || !current.equals(expected)) {
        console.error(`${file.target} is stale. Run npm run build:visual-explainer-vendor.`);
        return 1;
      }
      continue;
    }
    fs.mkdirSync(path.dirname(file.targetPath), { recursive:true });
    fs.writeFileSync(file.targetPath, expected);
    console.log(`Built ${file.target} from ${file.source}.`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { FILES, expectedFiles, main };
