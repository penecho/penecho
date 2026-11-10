"use strict";
const fs = require("node:fs");
const path = require("node:path");
// Bundle only the patch parser/applicator dependency graph, not diff's other algorithms.
function canvasFilePatchBundle() {
  const root = path.resolve(__dirname, "..");
  const modules = new Map();
  const diffRoot = path.dirname(require.resolve("diff"));
  function add(file) {
    const id = path.relative(root,file).split(path.sep).join("/");
    if(modules.has(id)) return id;
    modules.set(id, "");
    const code = fs.readFileSync(file,"utf8").replace(/require\(["']([^"']+)["']\)/g, (_all, name) => {
      if(name === "diff") return '({parsePatch:require('+JSON.stringify(add(path.join(diffRoot,"patch/parse.js")))+').parsePatch,applyPatch:require('+JSON.stringify(add(path.join(diffRoot,"patch/apply.js")))+').applyPatch})';
      if(!name.startsWith(".")) throw Error(`Unexpected dependency: ${name}`);
      return `require(${JSON.stringify(add(require.resolve(path.resolve(path.dirname(file),name))))})`;
    }).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
    modules.set(id,code);return id;
  }
  const entry=add(path.join(root,"src/shared/canvas-file-patch.js"));
  const license=fs.readFileSync(path.resolve(diffRoot,"../LICENSE"),"utf8").replace(/\*\//g,"* /");
  return `/* diff license:\n${license}\n*/\n(function(){\nconst modules={${[...modules].map(([id,code])=>`${JSON.stringify(id)}:function(module,exports,require){\n${code}\n}`).join(",\n")}},cache={};\nfunction require(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};modules[id](module,module.exports,require);return module.exports;}\nglobalThis.PenEchoCanvasFilePatch=require(${JSON.stringify(entry)});\n})();`;
}
module.exports={canvasFilePatchBundle};
