"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TOOLS, validateToolArguments } = require("../src/server/mcp/schema.js");

const baseDraw = {
  sessionId:"session-a",
  artifactId:"diagram-a",requestId:"diagram-a",
  title:"Native diagram",
  items:[
    {id:"source",type:"text",text:"First line\nSecond line",x:10,y:20,width:180,height:80,color:"#A0B1C2",fontSize:14},
    {id:"target",type:"ellipse",text:"Target",fontSize:18,fill:"transparent",strokeWidth:2},
    {id:"edge",type:"arrow",from:"source",to:"target",color:"#abc"},
    {id:"path",type:"path",points:[{x:0,y:0},{x:100,y:120}],fill:"#12345678"},
  ],
};

test("native drawing schema accepts bounded nodes, referenced edges, paths, and optional capture", () => {
  assert.deepEqual(validateToolArguments("penecho_draw", {...baseDraw,capture:true}), {...baseDraw,capture:true});
  const tool = TOOLS.find(entry => entry.name === "penecho_draw");
  assert.equal(tool.inputSchema.properties.items.maxItems, 24);
  assert.equal(tool.inputSchema.properties.capture.default, false);
  assert.equal(tool.inputSchema.properties.items.items.allOf[0].then.properties.width.minimum, 80);
  assert.match(tool.description, /native raster/);
});

test("native drawing schema rejects ambiguous geometry, unsafe text, references, and aggregate size", () => {
  const invalidItems = [
    [{id:"node",type:"rect",x:10}],
    [{id:"node",type:"text"}],
    [{id:"node",type:"text",text:"bad\ttext"}],
    [{id:"node",type:"rect",bogus:true}],
    [{id:"path",type:"path"}],
    [{id:"line",type:"line",points:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]}],
    [{id:"line",type:"line",from:"node"}],
    [{id:"node",type:"rect"},{id:"line",type:"arrow",from:"node",to:"node"}],
    [{id:"path",type:"path",points:[{x:0,y:0},{x:2401,y:1}]}],
    [{id:"node",type:"ellipse",fill:"red"}],
    [{id:"node",type:"rect",width:7}],
    [{id:"node",type:"ellipse",text:"Label",fontSize:11}],
  ];
  for (const items of invalidItems) {
    assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,items}), error => error.code === "invalid_arguments");
  }
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,items:[{id:"same",type:"rect"},{id:"same",type:"ellipse"}]}), /Duplicate item id/);
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,items:[{id:"path",type:"path",points:Array.from({length:257}, (_, index) => ({x:index,y:index}))}]}), /points has 257 points; expected 2\.\.256/);
  assert.throws(() => validateToolArguments("penecho_draw", {
    ...baseDraw,
    items:Array.from({length:9}, (_, itemIndex) => ({id:`path-${itemIndex}`,type:"path",points:Array.from({length:256}, (_, index) => ({x:index,y:itemIndex}))})),
  }), /2304 total points; maximum is 2048/);
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,items:Array.from({length:25}, (_, index) => ({id:`node-${index}`,type:"rect"}))}), /items has 25 entries; expected 1\.\.24/);
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,capture:"yes"}), /capture is invalid/);
});

test("native plot schema validates dimensions, domain pairs, color, and expression without evaluating it", () => {
  const input = {sessionId:"session-a",artifactId:"plot-a",requestId:"plot-a",title:"Plot",expression:"sin(x) + sqrt(abs(x))",width:640.4,height:360.2,xMin:-10,xMax:10,yMin:-5,yMax:5,color:"#ABCDEF",capture:true};
  assert.deepEqual(validateToolArguments("penecho_plot", input), {...input,width:640,height:360});
  const tool = TOOLS.find(entry => entry.name === "penecho_plot");
  assert.equal(tool.inputSchema.properties.capture.default, false);
  assert.match(tool.description, /safely/);

  for (const patch of [
    {width:299},
    {height:1201},
    {xMin:0},
    {xMin:1,xMax:1},
    {xMin:0,xMax:0.0000009},
    {xMin:-1_000_001,xMax:1},
    {yMin:-1,yMax:1},
    {xMin:-1,xMax:1,yMin:2},
    {color:"rgb(0,0,0)"},
    {expression:""},
    {expression:"x\ny"},
    {capture:1},
  ]) {
    assert.throws(() => validateToolArguments("penecho_plot", {...input,xMin:undefined,xMax:undefined,yMin:undefined,yMax:undefined,...patch}), error => error.code === "invalid_arguments");
  }
});

test("presentation semantics normalize defaults, viewport presets, and legacy dimensions", () => {
  const widget = {sessionId:"session-a",artifactId:"widget-a",requestId:"widget-a",title:"Widget",html:"<main>Hi</main>"};
  assert.deepEqual(validateToolArguments("penecho_present_widget", widget), {...widget,width:1200,height:800});
  assert.deepEqual(validateToolArguments("penecho_present_widget", {...widget,presentation:{intent:"compare",role:"alternative",size:"large",relativeTo:"source"}}), {
    ...widget,
    width:992,
    height:752,
    presentation:{intent:"compare",role:"alternative",size:"large",relativeTo:"source",relation:"beside",attention:"quiet"},
  });
  assert.deepEqual(validateToolArguments("penecho_present_widget", {...widget,width:700}), {...widget,width:700,height:800});
  assert.deepEqual(validateToolArguments("penecho_present_widget", {...widget,presentation:{size:"page"}}), {
    ...widget,
    width:1200,
    height:800,
    presentation:{intent:"deliver",role:"primary",size:"page",attention:"normal"},
  });
  assert.deepEqual(validateToolArguments("penecho_present_widget", {...widget,presentation:{size:"base"}}), {...widget,width:480,height:360,presentation:{intent:"deliver",role:"primary",size:"base",attention:"normal"}});
  assert.equal(TOOLS.find(entry => entry.name === "penecho_present_widget").inputSchema.properties.presentation.properties.size.default,"page");
  const mobile = {...widget,width:390,height:844};
  assert.deepEqual(validateToolArguments("penecho_present_widget", mobile), mobile);
  assert.throws(() => validateToolArguments("penecho_present_widget", {...mobile,presentation:{size:"page"}}), /cannot be combined/);
  assert.deepEqual(validateToolArguments("penecho_plot", {sessionId:"s",artifactId:"p",requestId:"p",title:"P",expression:"x",presentation:{intent:"review",size:"page"}}), {
    sessionId:"s",artifactId:"p",requestId:"p",title:"P",expression:"x",width:1200,height:800,
    presentation:{intent:"review",role:"primary",size:"page",attention:"request"},
  });
  assert.deepEqual(validateToolArguments("penecho_draw", {...baseDraw,presentation:{role:"supporting",relativeTo:"widget-a"}}).presentation, {
    intent:"deliver",role:"supporting",relativeTo:"widget-a",relation:"below",attention:"quiet",
  });
  const presentationSchema = TOOLS.find(entry => entry.name === "penecho_present_widget").inputSchema.properties.presentation;
  assert.deepEqual(presentationSchema.properties.intent.enum, ["explain","deliver","compare","review","inspect"]);
  assert.match(presentationSchema.properties.size.description, /base480×360/);
  assert.match(presentationSchema.properties.size.description, /page1200×800/);
  assert.equal(TOOLS.find(entry => entry.name === "penecho_plot").inputSchema.properties.presentation.properties.size.description, presentationSchema.properties.size.description);
  assert.equal(presentationSchema.additionalProperties, false);
});

test("presentation semantics reject conflicting or unsupported placement and inspect requests", () => {
  const widget = {sessionId:"session-a",artifactId:"widget-a",requestId:"widget-a",title:"Widget",html:"<main>Hi</main>"};
  for (const presentation of [
    {intent:"unknown"},
    {size:"wide",unexpected:true},
    {relation:"beside"},
    {relativeTo:"x".repeat(129)},
  ]) assert.throws(() => validateToolArguments("penecho_present_widget", {...widget,presentation}), /presentation/);
  assert.throws(() => validateToolArguments("penecho_present_widget", {...widget,width:640,presentation:{size:"wide"}}), /cannot be combined/);
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,presentation:{size:"wide"}}), /not valid for drawings/);
  assert.throws(() => validateToolArguments("penecho_draw", {...baseDraw,presentation:{intent:"inspect"}}), /only for widgets/);
  assert.throws(() => validateToolArguments("penecho_present_widget", {...widget,presentation:{intent:"inspect"}}), /requires capture/);
  assert.throws(() => validateToolArguments("penecho_present_widget", {...widget,capture:true,presentation:{intent:"inspect",attention:"normal"}}), /quiet attention/);
  assert.throws(() => validateToolArguments("penecho_present_widget", {...widget,capture:true,presentation:{intent:"inspect",relativeTo:"source"}}), /cannot use/);
  assert.deepEqual(validateToolArguments("penecho_present_widget", {...widget,capture:true,presentation:{intent:"inspect"}}).presentation, {
    intent:"inspect",role:"primary",size:"page",attention:"quiet",
  });
});

test("persistent document, virtual file, edit, and inbox schemas are strict and bounded", () => {
  assert.deepEqual(validateToolArguments("penecho_open_canvas", {instanceId:"i",canvasId:"c",create:true,title:"New",requestId:"r"}), {instanceId:"i",canvasId:"c",requestId:"r",show:false,create:true,title:"New"});
  assert.deepEqual(validateToolArguments("penecho_open_canvas", {instanceId:"i",canvasId:"c",locator:{location:"cloud",id:"cloud-1"},requestId:"r",show:true}), {instanceId:"i",canvasId:"c",requestId:"r",show:true,locator:{location:"cloud",id:"cloud-1"}});
  assert.deepEqual(validateToolArguments("penecho_open_canvas", {instanceId:"i",canvasId:"c",documentId:"d",locator:{location:"device",id:"saved-1"},requestId:"r"}), {instanceId:"i",canvasId:"c",requestId:"r",show:false,documentId:"d",locator:{location:"device",id:"saved-1"}});
  assert.throws(() => validateToolArguments("penecho_open_canvas", {instanceId:"i",canvasId:"c",requestId:"r"}), /Provide create:true/);
  assert.throws(() => validateToolArguments("penecho_open_canvas", {instanceId:"i",canvasId:"c",create:true,documentId:"d",requestId:"r"}), /create cannot/);
  assert.deepEqual(validateToolArguments("penecho_start_session", {instanceId:"i",canvasId:"c",documentId:"d",title:"Work"}), {instanceId:"i",canvasId:"c",documentId:"d",title:"Work"});
  assert.deepEqual(validateToolArguments("penecho_list_files", {sessionId:"s"}), {sessionId:"s",path:"/",offset:0,limit:50});
  assert.deepEqual(validateToolArguments("penecho_read_file", {sessionId:"s",path:"notes/a.md",startLine:2,endLine:3}), {sessionId:"s",path:"/notes/a.md",startLine:2,endLine:3});
  for (const path of ["../secret","/a/../b","/a//b","a\\b","a\0b","/%2e%2e/secret","/a%2fb","/%5cserver"]) assert.throws(() => validateToolArguments("penecho_read_file", {sessionId:"s",path}), /path is invalid/);
  assert.throws(() => validateToolArguments("penecho_patch_file", {sessionId:"s",path:"/a",contentHash:"h",patch:"x".repeat(800_001),requestId:"r"}), /too large/);
  assert.deepEqual(validateToolArguments("penecho_edit_canvas", {sessionId:"s",requestId:"r",action:"move",objectId:"o",region:{x:-1,y:2,w:3,h:4},baseRevision:7}).action, "move");
  assert.deepEqual(validateToolArguments("penecho_edit_canvas", {sessionId:"s",requestId:"r",action:"replace_image",objectId:"o",source:"penecho-ref:objects/object-1/image",baseRevision:7}).source, "penecho-ref:objects/object-1/image");
  assert.throws(() => validateToolArguments("penecho_edit_canvas", {sessionId:"s",requestId:"r",action:"replace_image",objectId:"o",source:"https://example.com/a.png",baseRevision:7}), /authorized/);
  assert.throws(() => validateToolArguments("penecho_edit_canvas", {sessionId:"s",requestId:"r",action:"delete",objectId:"o"}), /baseRevision is required/);
  assert.throws(() => validateToolArguments("penecho_edit_canvas", {sessionId:"s",requestId:"r",action:"delete",objectId:"o",baseRevision:7,text:"extra"}), /not valid/);
  assert.deepEqual(validateToolArguments("penecho_capture_canvas", {sessionId:"s"}), {sessionId:"s",target:"viewport",quality:"basic"});
  assert.deepEqual(validateToolArguments("penecho_capture_canvas", {sessionId:"s",target:"object",objectId:"image-1",quality:"detail"}), {sessionId:"s",target:"object",objectId:"image-1",quality:"detail"});
  assert.deepEqual(validateToolArguments("penecho_capture_canvas", {sessionId:"s",target:"region",region:{x:-1,y:2,w:3,h:4}}).region, {x:-1,y:2,w:3,h:4});
  assert.throws(() => validateToolArguments("penecho_capture_canvas", {sessionId:"s",target:"object"}), /objectId is required/);
  assert.throws(() => validateToolArguments("penecho_capture_canvas", {sessionId:"s",target:"region",region:{x:0,y:0,w:1,h:1},objectId:"extra"}), /only for object capture/);
  assert.throws(() => validateToolArguments("penecho_capture_canvas", {sessionId:"s",target:"selection",region:{x:0,y:0,w:1,h:1}}), /only for region capture/);
  assert.deepEqual(validateToolArguments("penecho_inbox", {sessionId:"s"}), {sessionId:"s",mode:"read",messageAfter:0,limit:10,capture:false});
  assert.throws(() => validateToolArguments("penecho_inbox", {sessionId:"s",mode:"ack",ids:["a","a"],status:"done"}), /duplicates/);
  for (const name of ["penecho_open_canvas","penecho_find_canvases","penecho_list_files","penecho_read_file","penecho_patch_file","penecho_edit_canvas","penecho_capture_canvas","penecho_inbox"]) assert.ok(TOOLS.some(tool => tool.name === name));
});

test("current session target is explicit and exclusive with documentId", () => {
  const args = {canvasId:"canvas",instanceId:"instance",title:"Attach",target:"current"};
  assert.equal(validateToolArguments("penecho_start_session",args).target,"current");
  assert.throws(()=>validateToolArguments("penecho_start_session",{...args,target:"active"}));
  assert.throws(()=>validateToolArguments("penecho_start_session",{...args,documentId:"saved"}));
});

test("draw_ink accepts explicit arbitrary brush colors and enforces action and resource bounds", () => {
  const args={sessionId:"s",requestId:"ink",action:"draw_ink",baseRevision:3,strokes:[{color:"#13aBcD",width:7,points:[{x:100,y:200},{x:300,y:400}]}]};
  assert.deepEqual(validateToolArguments("penecho_edit_canvas",args),args);
  for(const patch of [{baseRevision:undefined},{strokes:[]},{strokes:Array(17).fill(args.strokes[0])},{strokes:[{...args.strokes[0],color:"red"}]},{strokes:[{...args.strokes[0],width:65}]},{strokes:[{...args.strokes[0],points:Array(257).fill({x:100,y:100})}]},{strokes:Array(5).fill({...args.strokes[0],points:Array(256).fill({x:100,y:100})})},{strokes:[{...args.strokes[0],points:[{x:100,y:100},{x:2200,y:100}]}]},{strokes:[{...args.strokes[0],points:[{x:0,y:100}]}]},{objectId:"unexpected"}])assert.throws(()=>validateToolArguments("penecho_edit_canvas",{...args,...patch}));
  const schema=TOOLS.find(tool=>tool.name==="penecho_edit_canvas").inputSchema;
  assert.equal(schema.properties.strokes.maxItems,16);
  assert.ok(schema.properties.action.enum.includes("draw_ink"));
});


test("discovery advertises bounded natural-language workspace requests through canonical tools", () => {
  const description = TOOLS.find(tool => tool.name === "penecho_list_canvases").description;
  assert.match(description,/opted-in/);
  assert.match(description,/exact instanceId\/canvasId/);
  assert.equal(new Set(TOOLS.map(tool => tool.name)).size, TOOLS.length);
  assert.ok(TOOLS.every(tool => tool.name.startsWith("penecho_")), "invocation phrases do not introduce alias tools");
});

test("widget role or intent alone keeps page dimensions while plot defaults remain base", () => {
  const widget = {sessionId:"s",artifactId:"w",requestId:"w",title:"W",html:"<p>Hello</p>"};
  for (const presentation of [{role:"supporting"}, {intent:"deliver"}, {intent:"inspect"}]) {
    const result = validateToolArguments("penecho_present_widget", {...widget,presentation,...(presentation.intent === "inspect" ? {capture:true} : {})});
    assert.equal(result.presentation.size, "page");
    assert.equal(result.width, 1200);
    assert.equal(result.height, 800);
  }
  const plot = validateToolArguments("penecho_plot", {sessionId:"s",artifactId:"p",requestId:"p",title:"P",expression:"x",presentation:{role:"supporting"}});
  assert.equal(plot.presentation.size, "base");
  assert.equal(plot.width, 480);
  assert.equal(plot.height, 360);
  const inspect = validateToolArguments("penecho_present_widget", {...widget,width:390,height:844,capture:true,presentation:{intent:"inspect"}});
  assert.equal(inspect.width, 390);
  assert.equal(inspect.height, 844);
});

test("create_text advertises auto-layout and rejects unrelated action fields", () => {
  const tool=TOOLS.find(entry=>entry.name==="penecho_edit_canvas"),base={sessionId:"s",requestId:"r",action:"create_text",text:"Hello"};
  assert.deepEqual(validateToolArguments(tool.name,base),base);
  assert.match(tool.description,/without region/);
  assert.match(tool.description,/annotate existing content with evidenced world region/);
  assert.match(tool.description,/auto-layout/);
  assert.match(tool.description,/baseRevision/);
  assert.match(tool.inputSchema.properties.region.description,/w\/h do not size/);
  const branch=tool.inputSchema.allOf.find(rule=>rule.if.properties?.action?.const==="create_text").then;
  assert.deepEqual(branch.required,["text"]);
  assert.equal(branch.properties.region,undefined);
  for(const [key,value] of Object.entries({baseRevision:1,width:600,height:120,objectId:"o",source:"data:image/png;base64,AA==",strokes:[{color:"#123456",width:2,points:[{x:10,y:10}]}]})) {
    assert.equal(branch.properties[key],false,key);
    assert.throws(()=>validateToolArguments(tool.name,{...base,[key]:value}),new RegExp(`${key} is not valid for create_text`));
  }
  const region={x:200,y:200,w:600,h:120};
  assert.deepEqual(validateToolArguments(tool.name,{...base,region}).region,region);
  const show=tool.inputSchema.allOf.find(rule=>rule.if.properties?.action?.const==="show").then;
  assert.equal(show.properties.baseRevision,false);
  assert.equal(show.properties.region,false);
  assert.equal(tool.inputSchema.allOf.length,tool.inputSchema.properties.action.enum.length+1);
});

test("capture, open and progress advertise their conditional parameter restrictions", () => {
  const schema=name=>TOOLS.find(t=>t.name===name).inputSchema;
  const capture=schema("penecho_capture_canvas");
  for(const [target,key] of [["object","objectId"],["region","region"]]) {
    const rule=capture.allOf.find(r=>r.if.properties.target.const===target);
    assert.deepEqual(rule.then.required,[key]);assert.equal(rule.else.properties[key],false);
  }
  const open=schema("penecho_open_canvas").allOf[0];
  assert.equal(open.then.properties.documentId,false);assert.equal(open.then.properties.locator,false);
  assert.equal(open.else.properties.title,false);assert.deepEqual(open.else.anyOf,[{required:["documentId"]},{required:["locator"]}]);
  assert.throws(()=>validateToolArguments("penecho_open_canvas",{instanceId:"i",canvasId:"c",requestId:"r",documentId:"d",title:"extra"}),/title is valid only/);
  assert.deepEqual(schema("penecho_update_session").anyOf.map(r=>r.required[0]),["title","status","summary","steps","events"]);
  assert.throws(()=>validateToolArguments("penecho_update_session",{sessionId:"s"}),/At least one/);
});

test('image attachment tools accept bounded canonical sources and reject external host capabilities', () => {
  const asset='penecho-asset:'+'a'.repeat(64);
  for(const source of [asset,'penecho-ref:objects/image-1/image','data:image/png;base64,YQ==']) {
    assert.equal(validateToolArguments('penecho_upload_image',{sessionId:'s',requestId:'u',name:'Image',source}).source,source);
    assert.equal(validateToolArguments('penecho_place_image',{sessionId:'s',requestId:'p',source,width:80}).width,80);
    assert.equal(validateToolArguments('penecho_edit_canvas',{sessionId:'s',requestId:'e',action:'replace_image',objectId:'o',baseRevision:1,source}).source,source);
  }
  for(const source of ['/tmp/image.png','https://example.com/a.png','YQ==','penecho-asset:'+'g'.repeat(64),'data:image/svg+xml;base64,YQ==','data:image/png;base64,'+'A'.repeat(800000)]) {
    assert.throws(()=>validateToolArguments('penecho_upload_image',{sessionId:'s',requestId:'u',name:'Image',source}),{code:'invalid_arguments'});
  }
  for(const extra of [{baseRevision:1},{attachmentId:'private'},{width:0},{width:79.99},{height:79.99}])assert.throws(()=>validateToolArguments('penecho_place_image',{sessionId:'s',requestId:'p',source:asset,...extra}),{code:'invalid_arguments'});
  assert.throws(()=>validateToolArguments('penecho_upload_image',{sessionId:'s',requestId:'u',name:'Image',attachmentId:'private'}),{code:'invalid_arguments'});
});

 test('image placement discovery matches minimum persistent image dimensions', () => {
  const tool=TOOLS.find(tool=>tool.name==='penecho_place_image');
  for(const key of ['width','height']) {
    assert.equal(tool.inputSchema.properties[key].minimum,80);
    assert.equal(validateToolArguments(tool.name,{sessionId:'s',requestId:'p',source:'penecho-asset:'+'a'.repeat(64),[key]:80})[key],80);
  }
  assert.match(tool.description,/One dimension preserves aspect ratio/);
});

test('v2 registry is complete and retired names do not remain aliases',()=>{
  assert.equal(TOOLS.length,20);
  const {COMMON_TOOL_NAMES}=require('../src/server/mcp/schema.js');
  assert.equal(COMMON_TOOL_NAMES.length,6);
  for(const name of ['penecho_capture_widget','penecho_read_feedback','penecho_read_messages','penecho_ack_messages'])assert.throws(()=>validateToolArguments(name,{}),{code:'tool_not_found'});
  assert.deepEqual(validateToolArguments('penecho_capture_canvas',{sessionId:'s',target:'artifact',artifactId:'a'}),{sessionId:'s',target:'artifact',artifactId:'a',quality:'basic'});
  for(const args of [{target:'artifact'},{target:'viewport',artifactId:'a'}])assert.throws(()=>validateToolArguments('penecho_capture_canvas',{sessionId:'s',...args}),{code:'invalid_arguments'});
});

test('mutation completion is explicit, bounded and attached to an idempotent request',()=>{
  const base={sessionId:'s',artifactId:'a',title:'A',html:'<p>A</p>'};
  assert.throws(()=>validateToolArguments('penecho_present_widget',base),/requestId/);
  const completion={status:'done',summary:'Ready',handledMessageIds:['m1','m2']};
  const result=validateToolArguments('penecho_present_widget',{...base,requestId:'r',completion,output:'detailed'});
  assert.deepEqual(result.completion,completion);assert.equal(result.output,'detailed');
  for(const patch of [{output:'verbose'},{completion:{status:'finished'}},{completion:{status:'done',summary:'x'.repeat(601)}},{completion:{status:'done',handledMessageIds:['x','x']}},{completion:{status:'done',unexpected:true}}])assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,requestId:'r',...patch}),{code:'invalid_arguments'});
});

test('inbox modes cannot mix acknowledgement and read fields or silently enable capture',()=>{
  assert.deepEqual(validateToolArguments('penecho_inbox',{sessionId:'s'}),{sessionId:'s',mode:'read',messageAfter:0,limit:10,capture:false});
  assert.deepEqual(validateToolArguments('penecho_inbox',{sessionId:'s',mode:'ack',ids:['m'],status:'done'}),{sessionId:'s',mode:'ack',ids:['m'],status:'done'});
  for(const extra of [{quality:'detail'},{mode:'read',ids:['m']},{mode:'ack',ids:['m'],status:'done',capture:true},{messageAfter:-1},{feedbackAfter:-1},{limit:51}])assert.throws(()=>validateToolArguments('penecho_inbox',{sessionId:'s',...extra}),{code:'invalid_arguments'});
});


test("rename canvas requires exact targeting and a bounded trimmed title", () => {
  const args = {instanceId:"instance",canvasId:"canvas",documentId:"doc",title:"  New title  ",requestId:"rename"};
  assert.deepEqual(validateToolArguments("penecho_rename_canvas",args),{...args,title:"New title"});
  const schema = TOOLS.find(tool => tool.name === "penecho_rename_canvas").inputSchema;
  assert.deepEqual(schema.required,["instanceId","canvasId","documentId","title","requestId"]);
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.title.maxLength,48);
  const pattern = new RegExp(schema.properties.title.pattern);
  for (const title of ["", "   ", "x".repeat(49), "bad\n", "bad\u0000", "bad\u007f"]) {
    assert.throws(()=>validateToolArguments("penecho_rename_canvas",{...args,title}),error=>error.code === "invalid_arguments");
    if (title.length <= 48) assert.equal(pattern.test(title),false);
  }
  for (const field of schema.required) {const missing = {...args};delete missing[field];assert.throws(()=>validateToolArguments("penecho_rename_canvas",missing));}
  for (const extra of [{sessionId:"s"},{create:true},{show:true},{locator:{location:"device",id:"d"}},{target:"current"}]) assert.throws(()=>validateToolArguments("penecho_rename_canvas",{...args,...extra}));
  assert.equal(validateToolArguments("penecho_rename_canvas",{...args,title:"x".repeat(48)}).title.length,48);
});
