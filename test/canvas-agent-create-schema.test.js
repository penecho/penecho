"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("Agent create schemas distinguish ordinary HTML, Visual Explorer, and private Widgets", async () => {
  const { createItemSchema } = await import("../src/server/canvas-agent/runtime.mjs");
  const { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } = await import("@deepseek-ai/dsh-tools");
  const schema = valueSchemaSpecToJsonSchema(createItemSchema({ widgetCapabilities:{ privatePlugins:[{id:"private-tool"}] } }));
  const valid = value => assert.deepEqual(validateJsonSchemaValue(schema, value), []);
  const invalid = value => assert.notEqual(validateJsonSchemaValue(schema, value).length, 0);
  const plain = { type:"widget", pluginId:"general", widgetType:"html_widget", title:"Tool", html:"<!doctype html><p>Hello</p>" };
  const explorer = { ...plain, sourceFormat:"penecho-visual-explorer+html", frameworkVersion:"penecho-visual-explorer/1", refreshSeconds:0, width:640, height:480, placement:{mode:"auto"} };
  const privateWidget = { ...plain, pluginId:"private-tool", sourceFormat:"custom-format", frameworkVersion:"custom/1" };
  for (const value of [plain, explorer, privateWidget, {...explorer,placement:{mode:"absolute",x:12,y:34}}, {type:"text",text:"Text"}, {type:"formula",latex:"x"}, {type:"plot",expression:"x"}, {type:"image",attachmentId:"owned-image"}]) {
    valid(value);
    assert.equal(schema.oneOf.filter(branch=>validateJsonSchemaValue(branch,value).length===0).length,1);
  }
  for (const field of ["sourceFormat","frameworkVersion","refreshSeconds","width","height","placement"]) {
    const value={...explorer};delete value[field];invalid(value);
  }
  invalid({...explorer,placement:{}});
  invalid({...explorer,frameworkVersion:"wrong"});
  invalid({...explorer,copyText:"not canonical"});
  invalid({...plain,sourceFormat:"custom-format"});
  // Positive dimensions remain enforced by the existing execution contract:
  // Harness's supported schema subset has no numeric-bound keywords.
  const branch=schema.oneOf.find(item=>item.properties?.sourceFormat?.const);
  assert.match(branch.properties.width.description,/positive/);
  assert.match(branch.properties.height.description,/positive/);
});
