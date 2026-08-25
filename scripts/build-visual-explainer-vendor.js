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
  {
    source:"node_modules/manim-web/dist/manim-web.browser.js",
    target:"public/vendor/manim-web-0.3.24/manim-web.browser.js",
  },
  {
    source:"node_modules/manim-web/dist/MathJaxBundle-xSidSV0E.js",
    target:"public/vendor/manim-web-0.3.24/MathJaxBundle-xSidSV0E.js",
  },
  {
    source:"node_modules/manim-web/LICENSE",
    target:"public/vendor/manim-web.LICENSE",
  },
  {
    source:"scripts/manim-web-third-party-notices.md",
    target:"public/vendor/manim-web-licenses/THIRD-PARTY-NOTICES.md",
  },
  {
    source:"node_modules/@mathjax/src/LICENSE",
    target:"public/vendor/manim-web-licenses/mathjax-LICENSE",
  },
  {
    source:"node_modules/mhchemparser/LICENSE.txt",
    target:"public/vendor/manim-web-licenses/mhchemparser-LICENSE.txt",
  },
  {
    source:"node_modules/mj-context-menu/LICENSE",
    target:"public/vendor/manim-web-licenses/mj-context-menu-LICENSE",
  },
  {
    source:"node_modules/speech-rule-engine/LICENSE",
    target:"public/vendor/manim-web-licenses/speech-rule-engine-LICENSE",
  },
  {
    source:"node_modules/earcut/LICENSE",
    target:"public/vendor/manim-web-licenses/earcut-LICENSE",
  },
  {
    source:"node_modules/gif.js/README.md",
    target:"public/vendor/manim-web-licenses/gif.js-README.md",
  },
  {
    source:"node_modules/katex/LICENSE",
    target:"public/vendor/manim-web-licenses/katex-LICENSE",
  },
  {
    source:"node_modules/opentype.js/LICENSE",
    target:"public/vendor/manim-web-licenses/opentype.js-LICENSE",
  },
  {
    source:"node_modules/polygon-clipping/LICENSE.md",
    target:"public/vendor/manim-web-licenses/polygon-clipping-LICENSE.md",
  },
  {
    source:"node_modules/splaytree/Readme.md",
    target:"public/vendor/manim-web-licenses/splaytree-README.md",
  },
  {
    source:"node_modules/three/LICENSE",
    target:"public/vendor/manim-web-licenses/three-LICENSE",
  },
  {
    source:"node_modules/typia/LICENSE",
    target:"public/vendor/manim-web-licenses/typia-LICENSE",
  },
]);

function expectedFiles() {
  return FILES.map(file => ({
    ...file,
    sourcePath:path.join(ROOT, file.source),
    targetPath:path.join(ROOT, file.target),
  }));
}

function expectedContent(file) {
  const source = fs.readFileSync(file.sourcePath);
  if (path.extname(file.target) === ".js") return source;
  return Buffer.from(source.toString("utf8").replace(/\r\n?/g, "\n"));
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  for (const file of expectedFiles()) {
    if (!fs.existsSync(file.sourcePath)) {
      console.error(`${file.source} is missing. Run npm install before building Visual Explainer assets.`);
      return 1;
    }
    const expected = expectedContent(file),
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
