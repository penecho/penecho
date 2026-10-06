"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), {execFileSync} = require("node:child_process");
const prompt = require("../src/server/canvas-command-prompt.js"), source = fs.readFileSync(path.join(__dirname,"../src/server/main.js"),"utf8");

test("the exported command policies equal the actual local server policies for every mode", () => {
  const scope = { fs, path, __dirname:path.join(__dirname,"../src/server"), NORMALIZE_TYPESET_POLICY:require("../src/server/typeset.js").NORMALIZE_TYPESET_POLICY };
  const constants = ["MODEL_FINAL_JSON_TARGET_TOKENS","MODEL_REASONING_BUDGET_FRACTION"].map(name=>source.match(new RegExp(`const ${name} = [^\\n]+`))[0]).join("\n"),
    block = source.slice(source.indexOf("const SYSTEM_PROMPT = `"),source.indexOf("const THEME_PERSONAS = {"));
  vm.runInNewContext(constants+"\n"+block+"\nthis.local={activeSystemPrompt,anthropicSystemPrompt};",scope);
  for(const typeset of [false,true])for(const animation of [false,true])for(const plugins of [false,true]) {
    assert.equal(prompt.activeSystemPrompt(typeset,animation,plugins),scope.local.activeSystemPrompt(typeset,animation,plugins));
    assert.equal(prompt.anthropicSystemPrompt("medium",typeset,animation,plugins),scope.local.anthropicSystemPrompt("medium",typeset,animation,plugins));
  }
  execFileSync(process.execPath,[path.join(__dirname,"../scripts/build-canvas-command-prompt.cjs"),"--check"]);
});

test("the shared command input carries authoritative attention and native plot guidance",()=>{
  const payload={userAction:"plot",suggestion:"plot",uiTheme:"studio",changedBox:{x:80,y:120,w:300,h:100},sourceRect:{x:0,y:0,w:1000,h:800},visibleRect:{x:0,y:0,w:2000,h:1500},captureRect:{x:0,y:0,w:1000,h:800},atlasSize:{w:1000,h:800},imageScale:1,plugins:[{id:"general",name:"General",document:"test"}]},input=prompt.canvasCommandModelInput(payload);
  assert.deepEqual(input.latestInput,{globalRect:payload.changedBox,imageRect:{x:76,y:116,w:308,h:108}});
  assert.equal(input.enabledPlugins,payload.plugins);
  assert.deepEqual(input.widgetGeometry.max,{w:1000,h:1000});
  assert.match(input.actionMeaning,/exactly one plot_function/);
  assert.match(prompt.activeSystemPrompt(),/Never use JavaScript code, Math.sin, Math.PI/);
  assert.deepEqual(JSON.parse(prompt.modelRequestText(input)).latestInput,input.latestInput);
});
