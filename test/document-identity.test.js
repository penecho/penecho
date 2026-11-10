const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "src/client/app/document-identity.js"), "utf8");

function loadApi(context = {}) {
  return vm.runInNewContext(`${source}\ncanvasDocumentIdentity`, {
    crypto:crypto.webcrypto,
    TextEncoder,
    ...context,
  }, { filename:"src/client/app/document-identity.js" });
}

function nodeLegacyId(api, locator) {
  return `legacy-${crypto.createHash("sha256").update(api.locatorKey(locator), "utf8").digest("hex")}`;
}

function locatorWithKeyByteLength(location, scope, targetBytes) {
  for (let length = 1; length <= 128; length += 1) {
    const locator = { location, scope, id:"x".repeat(length) };
    const bytes = Buffer.byteLength(JSON.stringify({
      location,
      scope,
      id:locator.id,
    }), "utf8");
    if (bytes === targetBytes) return locator;
  }
  throw new Error(`no valid locator for ${location} length ${targetBytes}`);
}

test("metadata normalizes to a bounded v1 identity and roundtrips", () => {
  const api = loadApi();
  const metadata = {
    version:1,
    documentId:"doc-1",
    title:"Notebook",
    context:"A saved document",
    bindings:[{key:"binding-1",client:"desktop",documentId:"doc-1"}],
    locators:[
      {location:"device",scope:"account-a",id:"saved-1"},
      {location:"device",scope:"account-a",id:"saved-1",ignored:"duplicate"},
    ],
    processor:{kind:"external",bindingKey:"binding-1",client:"desktop",ignored:true},
    ignored:"field",
  };
  const normalized = api.normalizeMetadata(metadata);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
    version:1,
    documentId:"doc-1",
    title:"Notebook",
    context:"A saved document",
    bindings:[{key:"binding-1",client:"desktop",documentId:"doc-1"}],
    locators:[{location:"device",scope:"account-a",id:"saved-1"}],
    processor:{kind:"external",bindingKey:"binding-1",client:"desktop"},
  });
  assert.equal(JSON.stringify(api.normalizeMetadata(normalized)), JSON.stringify(normalized));

  const bounded = api.normalizeMetadata({
    version:1,
    documentId:"doc-1",
    title:"t".repeat(121),
    context:"c".repeat(16_001),
    bindings:Array.from({length:70}, (_, index) => ({key:`binding-${index}`,client:"desktop",documentId:"doc-1",sessionId:"secret"})),
    locators:Array.from({length:20}, (_, index) => ({location:"device",id:`saved-${index}`})),
  });
  assert.equal(bounded.title.length, 120);
  assert.equal(bounded.context.length, 16_000);
  assert.equal(bounded.bindings.length, 64);
  assert.equal(bounded.locators.length, 16);
  assert.equal(Object.hasOwn(bounded.bindings[0], "sessionId"), false);
  assert.equal(JSON.stringify(bounded.processor), JSON.stringify({kind:"penecho"}));
});

test("workspace restores only bound sessions and messages and preserves reconnect maps", () => {
  const api = loadApi();
  const metadata = {
    version:1,
    documentId:"doc-1",
    bindings:[{key:"binding-1",client:"desktop",documentId:"doc-1"}],
  };
  const validSession = (index) => ({
    sessionKey:"binding-1",
    client:"desktop",
    documentId:"doc-1",
    title:"Task " + index,
    status:"waiting",
    summary:"Waiting",
    steps:[{id:"step-1",label:"Review",status:"done"},{id:"bad step",label:{}}],
    events:[{id:"event-1",text:"Ready",kind:"progress"}],
    boardObjectId:"widget-1",
    layout:{zone:{x:10,y:20,w:300,h:200},x:10,y:20,rowHeight:220},
    artifacts:[
      ["artifact-1",{
        kind:"drawing",
        title:"Sketch",
        objectId:"widget-1",
        objectIds:["widget-1","text-box-1","bad\u0000id"],
        elements:[
          ["item-1",{objectId:"text-box-1",kind:"text",source:"source"}],
          ["bad-item",{objectId:{}}],
        ],
      }],
      ["malformed",null],
    ],
    feedbackStart:7,
  });
  const validMessage = (index) => ({
    id:"message-" + index,
    cursor:index + 1,
    bindingKey:"binding-1",
    client:"desktop",
    documentId:"doc-1",
    text:"Please review this widget.",
    objectIds:["widget-1","text-box-1",{bad:true}],
    region:{x:10,y:20,w:100,h:80},
    status:"queued",
    source:"widget",
    action:"choice",
    createdAt:1_700_000_000_000,
  });
  const original = {
    version:1,
    sessions:[
      ...Array.from({length:65}, (_, index) => validSession(index)),
      {sessionKey:"binding-1",client:"other-client",documentId:"doc-1"},
      {sessionKey:"binding-1",client:"desktop",documentId:"other-document"},
      {sessionKey:"unbound",client:"desktop",documentId:"doc-1"},
    ],
    feedback:[
      ...Array.from({length:201}, (_, index) => ({cursor:index + 1,kind:"image",bounds:{x:0,y:0,w:1,h:1},createdAt:index + 1})),
      {cursor:"bad",kind:"image",createdAt:1},
    ],
    feedbackSequence:1,
    messages:[
      ...Array.from({length:101}, (_, index) => validMessage(index)),
      {...validMessage(999),client:"other-client"},
      {...validMessage(1000),documentId:"other-document"},
      {...validMessage(1001),text:"m".repeat(16_001)},
    ],
    messageSequence:1,
    changes:[
      ...Array.from({length:201}, (_, index) => ({cursor:index + 1,kind:"source",objectId:"widget-1",bounds:{x:0,y:0,w:1,h:1},at:index + 1})),
      {cursor:202,kind:"source",createdAt:"bad"},
    ],
    changeSequence:1,
    ignored:"drop me",
  };
  const before = JSON.stringify(original);
  const normalized = api.normalizeWorkspace(original, metadata);

  assert.equal(normalized.version, 1);
  assert.equal(normalized.sessions.length, 1, "duplicate sessions collapse to the latest bound entry");
  assert.equal(normalized.sessions[0].title, "Task 64");
  assert.equal(normalized.messages.length, 97, "the bounded tail drops mismatched and oversized messages");
  assert.equal(normalized.messages[0].cursor, 5);
  assert.equal(normalized.feedback.length, 199);
  assert.equal(normalized.feedback[0].cursor, 3);
  assert.equal(normalized.changes.length, 199);
  assert.equal(normalized.changes[0].cursor, 3);
  assert.equal(normalized.feedbackSequence, 201);
  assert.equal(normalized.messageSequence, 101);
  assert.equal(normalized.changeSequence, 201);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(normalized))), JSON.stringify(normalized));
  assert.equal(JSON.stringify(original), before, "normalization does not mutate persisted input");

  const reconnect = api.normalizeWorkspace({
    version:1,
    sessions:[validSession(1)],
    messages:[validMessage(1)],
  }, metadata);
  assert.equal(reconnect.sessions.length, 1);
  assert.equal(JSON.stringify(reconnect.sessions[0].artifacts), JSON.stringify([["artifact-1",{
    kind:"drawing",
    title:"Sketch",
    objectId:"widget-1",
    objectIds:["widget-1","text-box-1"],
    elements:[["item-1",{objectId:"text-box-1",kind:"text",source:"source"}]],
  }]]));
  assert.equal(JSON.stringify(reconnect.messages[0].objectIds), JSON.stringify(["widget-1","text-box-1"]));
  assert.equal(reconnect.messages[0].bindingKey, "binding-1");

  const duplicates = api.normalizeWorkspace({
    version:1,
    sessions:[validSession(1),validSession(2)],
    messages:[
      {...validMessage(0),cursor:1},
      {...validMessage(0),cursor:2,text:"latest id"},
      {...validMessage(1),cursor:3},
      {...validMessage(2),id:"message-2-latest",cursor:3,text:"latest cursor"},
      {...validMessage(2),id:"message-2-invalid",cursor:4,text:"m".repeat(16_001)},
    ],
    messageSequence:0,
  }, metadata);
  assert.equal(duplicates.sessions.length, 1);
  assert.equal(duplicates.sessions[0].title, "Task 2");
  assert.equal(duplicates.messages.length, 2);
  assert.equal(duplicates.messages[0].text, "latest id");
  assert.equal(duplicates.messages[1].text, "latest cursor");
  assert.equal(duplicates.messageSequence, 3);
});

test("workspace roundtrips bounded artifact presentation metadata and preserves null board ids", () => {
  const api = loadApi();
  const metadata = {
    version:1,
    documentId:"doc-1",
    bindings:[
      {key:"new-binding",client:"desktop",documentId:"doc-1"},
      {key:"legacy-binding",client:"desktop",documentId:"doc-1"},
    ],
  };
  const workspace = {
    version:1,
    sessions:[
      {
        sessionKey:"new-binding",
        client:"desktop",
        documentId:"doc-1",
        boardObjectId:null,
        artifacts:[
          ["explanation",{
            objectId:"widget-explanation",
            presentation:{
              intent:"explain",
              role:"primary",
              size:"wide",
              relativeTo:"source-artifact",
              relation:"beside",
              attention:"request",
              ignored:"untrusted",
            },
          }],
          ["legacy",{objectId:"legacy-widget"}],
          ["ephemeral",{
            objectId:"inspect-widget",
            presentation:{intent:"inspect",role:"supporting",size:"page",relativeTo:"source-artifact"},
          }],
        ],
      },
      {
        sessionKey:"legacy-binding",
        client:"desktop",
        documentId:"doc-1",
        boardObjectId:"legacy-board",
        artifacts:[],
      },
    ],
  };

  const normalized = api.normalizeWorkspace(workspace, metadata);
  assert.equal(normalized.sessions[0].boardObjectId, null);
  assert.equal(normalized.sessions[1].boardObjectId, "legacy-board");
  assert.equal(JSON.stringify(normalized.sessions[0].artifacts), JSON.stringify([
    ["explanation",{
      objectId:"widget-explanation",
      presentation:{
        intent:"explain",
        role:"primary",
        size:"wide",
        relativeTo:"source-artifact",
        relation:"beside",
        attention:"request",
      },
    }],
    ["legacy",{objectId:"legacy-widget"}],
    ["ephemeral",{objectId:"inspect-widget"}],
  ]));
  assert.equal(JSON.stringify(api.normalizeWorkspace(JSON.parse(JSON.stringify(normalized)), metadata)), JSON.stringify(normalized));
});

test("artifact presentation drops invalid and unknown fields while retaining valid fields", () => {
  const api = loadApi();
  const metadata = {
    version:1,
    documentId:"doc-1",
    bindings:[{key:"binding-1",client:"desktop",documentId:"doc-1"}],
  };
  const normalized = api.normalizeWorkspace({
    version:1,
    sessions:[{
      sessionKey:"binding-1",
      client:"desktop",
      documentId:"doc-1",
      artifacts:[
        ["mixed",{
          objectId:"widget-mixed",
          presentation:{
            intent:"review",
            role:"invalid-role",
            size:"tall",
            relativeTo:"r".repeat(129),
            relation:"beside",
            attention:"invalid-attention",
            unknown:{secret:"drop"},
          },
        }],
        ["primitive",{objectId:"widget-primitive",presentation:"unsafe"}],
        ["empty",{objectId:"widget-empty",presentation:{}}],
        ["control",{objectId:"widget-control",presentation:{relativeTo:"safe\u0000target",size:"base"}}],
      ],
    }],
  }, metadata);

  assert.equal(JSON.stringify(normalized.sessions[0].artifacts), JSON.stringify([
    ["mixed",{
      objectId:"widget-mixed",
      presentation:{intent:"review",size:"tall",relation:"beside"},
    }],
    ["primitive",{objectId:"widget-primitive"}],
    ["empty",{objectId:"widget-empty"}],
    ["control",{objectId:"widget-control",presentation:{size:"base"}}],
  ]));
});

test("workspace rejects unsupported versions and malformed prototypes while keeping plain output", () => {
  const api = loadApi();
  const metadata = {
    version:1,
    documentId:"doc-1",
    bindings:[{key:"binding-1",client:"desktop",documentId:"doc-1"}],
  };
  assert.equal(api.normalizeWorkspace({version:2}, metadata), null);
  const inherited = Object.create({version:1,sessions:[{sessionKey:"binding-1",client:"desktop"}]});
  assert.equal(api.normalizeWorkspace(inherited, metadata), null);

  const hostile = {
    version:1,
    sessions:[{
      sessionKey:"binding-1",
      client:"desktop",
      documentId:"doc-1",
      artifacts:{
        "artifact-1":{objectIds:["widget-1","image-1"]},
        "__proto__":{objectId:"prototype-object"},
      },
    }],
    messages:[{
      id:"message-1",
      cursor:1,
      bindingKey:"binding-1",
      client:"desktop",
      documentId:"doc-1",
      text:"ok",
      objectIds:["widget-1"],
      createdAt:1,
      extra:{token:"secret"},
    }],
  };
  const normalized = api.normalizeWorkspace(hostile, metadata);
  assert.equal(normalized.sessions.length, 1);
  assert.equal(normalized.messages.length, 1);
  assert.equal(Object.getPrototypeOf(normalized).constructor.name, "Object");
  assert.equal(Object.getPrototypeOf(normalized.sessions[0]).constructor.name, "Object");
  assert.equal(Object.getPrototypeOf(normalized.sessions[0].artifacts[0][1]).constructor.name, "Object");
  assert.equal(Object.hasOwn(normalized.messages[0], "extra"), false);
  assert.equal(Object.hasOwn(normalized.sessions[0].artifacts[0][1], "__proto__"), false);
  assert.equal(JSON.stringify(normalized.sessions[0].artifacts[0]), JSON.stringify(["artifact-1",{
    objectIds:["widget-1","image-1"],
    objectId:"widget-1",
  }]));
});

test("ids, prototypes, and binding conflicts fail closed without mutating input", () => {
  const api = loadApi();
  assert.equal(api.validId("a"), true);
  assert.equal(api.validId("a".repeat(128)), true);
  assert.equal(api.validId(""), false);
  assert.equal(api.validId("a".repeat(129)), false);
  assert.equal(api.validId("a\u0000b"), false);
  assert.equal(api.validId({toString(){ return "id"; }}), false);

  const prototype = {version:1,documentId:"inherited"};
  const inherited = Object.create(prototype);
  assert.equal(api.normalizeMetadata(inherited), null);
  assert.deepEqual(prototype, {version:1,documentId:"inherited"});

  const metadata = {
    version:1,
    documentId:"doc-1",
    bindings:[
      {key:"same",client:"one",documentId:"doc-1"},
      {key:"same",client:"two",documentId:"doc-1"},
    ],
  };
  assert.equal(api.normalizeMetadata(metadata), null);
  assert.deepEqual(metadata.bindings, [
    {key:"same",client:"one",documentId:"doc-1"},
    {key:"same",client:"two",documentId:"doc-1"},
  ]);
  assert.equal(api.normalizeMetadata({version:2,documentId:"doc-1"}), null);
  assert.equal(api.normalizeMetadata({version:1,documentId:""}), null);
});

test("locator scope partitions identities and invalid keys carry a code", () => {
  const api = loadApi();
  const first = {location:"device",scope:"account-a",id:"same"};
  const second = {location:"device",scope:"account-b",id:"same"};
  assert.notEqual(api.locatorKey(first), api.locatorKey(second));
  assert.equal(JSON.stringify(api.normalizeLocator({...first,ignored:"field"})), JSON.stringify({location:"device",id:"same",scope:"account-a"}));
  assert.equal(api.normalizeLocator({location:"device",scope:"",id:"same"}), null);
  assert.throws(() => api.locatorKey({location:"device",id:""}), error => error.code === "INVALID_LOCATOR");
});

test("legacy ids are stable SHA-256 hashes of the canonical locator key", async () => {
  const api = loadApi();
  const locator = {location:"cloud",scope:"account-a",id:"saved-1"};
  const expected = nodeLegacyId(api, locator);
  assert.equal(await api.legacyId(locator), expected);
  assert.equal(await api.legacyId({...locator,ignored:"field"}), expected);
  assert.equal(await api.legacyId(locator), await api.legacyId(locator));
});

test("legacy ids use deterministic SHA-256 fallback without Web Crypto", async () => {
  const locators = [
    ...["device", "server", "cloud"].flatMap((location) => [55, 56, 119, 120].map((targetBytes) => (
      locatorWithKeyByteLength(location, "account-a", targetBytes)
    ))),
    {location:"device",scope:"账户-设备",id:"中文😀"},
    {location:"server",scope:"服务器🌐",id:"保存的画布✨"},
    {location:"cloud",scope:"云端账户",id:"笔记🖊️"},
    {location:"server",scope:"account-a",id:"孤立\ud800"},
  ];
  const contexts = [
    {name:"missing crypto", context:{crypto:undefined}},
    {name:"missing subtle", context:{crypto:{}}},
    {name:"digest rejection", context:{crypto:{subtle:{digest(){ return Promise.reject(new Error("blocked")); }}}}},
    {name:"missing TextEncoder", context:{crypto:undefined,TextEncoder:undefined}},
  ];

  for (const {name, context} of contexts) {
    const api = loadApi(context);
    for (const locator of locators) {
      assert.equal(await api.legacyId(locator), nodeLegacyId(api, locator), `${name}: ${api.locatorKey(locator)}`);
    }
  }
});

test("legacy ids preserve Web Crypto output for every locator scope", async () => {
  const api = loadApi();
  for (const location of ["device", "server", "cloud"]) {
    const locator = {location,scope:"account-a",id:`saved-${location}`};
    assert.equal(await api.legacyId(locator), nodeLegacyId(api, locator));
  }
});

test("active dirty identity wins and exact locators narrow replicas", () => {
  const api = loadApi();
  const active = {documentId:"doc-1",locator:{location:"device",scope:"account-a",id:"saved-1"},dirty:true,title:"Unsaved"};
  const replica = {documentId:"doc-1",locator:{location:"cloud",scope:"account-a",id:"saved-1"},dirty:false};
  const activeResult = api.resolveCandidates({documentId:"doc-1",active:[active],candidates:[replica],providers:[{location:"cloud",status:"ok"}]});
  assert.equal(activeResult.status, "found");
  assert.equal(activeResult.candidate, active);
  assert.equal(activeResult.candidate.dirty, true);

  const device = {documentId:"doc-1",locator:{location:"device",scope:"account-a",id:"saved-1"}};
  const cloud = {documentId:"doc-1",locator:{location:"cloud",scope:"account-a",id:"saved-1"}};
  const ambiguous = api.resolveCandidates({documentId:"doc-1",candidates:[device,cloud,device],providers:[{location:"device",status:"ok"},{location:"cloud",status:"ok"}]});
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.candidates[0], device);
  assert.equal(ambiguous.candidates[1], cloud);
  const narrowed = api.resolveCandidates({documentId:"doc-1",locator:device.locator,candidates:[device,cloud],providers:[]});
  assert.equal(narrowed.status, "found");
  assert.equal(narrowed.candidate, device);
});

test("locator/document conflicts never load a mismatched document", () => {
  const api = loadApi();
  const result = api.resolveCandidates({
    documentId:"requested",
    locator:{location:"device",scope:"account-a",id:"saved-1"},
    candidates:[{documentId:"other",locator:{location:"device",scope:"account-a",id:"saved-1"}}],
    providers:[{location:"device",status:"ok"}],
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.retryable, false);
  assert.equal(Object.hasOwn(result, "candidate"), false);
});

test("offline providers are unavailable, not a missing document", () => {
  const api = loadApi();
  const result = api.resolveCandidates({documentId:"missing",candidates:[],providers:[{location:"cloud",status:"offline"}]});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status:"unavailable",
    providers:[{location:"cloud",status:"offline"}],
    retryable:true,
  });
});

test("virtual paths reject traversal and unsafe separators without decoding ids", () => {
  const api = loadApi();
  assert.equal(JSON.stringify(api.parsePath("/")), "[]");
  assert.equal(JSON.stringify(api.parsePath("objects/a%2Fb")), JSON.stringify(["objects", "a%2Fb"]));
  assert.equal(JSON.stringify(api.parsePath("/objects/encoded%2E%2E")), JSON.stringify(["objects", "encoded%2E%2E"]));
  for (const unsafe of ["../secret", "/objects/../secret", "/objects/.", "/objects//child", "/objects\\child", "/objects?query", "/objects#hash", "/objects/\u0000", "x".repeat(513)]) {
    assert.throws(() => api.parsePath(unsafe), error => error.code === "INVALID_PATH");
  }
});

test("internal restoration cache is bounded and never consumes external authority bindings",()=>{
  const api=loadApi(),metadata={version:1,documentId:"doc",bindings:[{key:"external",client:"Codex",documentId:"doc"}]};
  const internal=Array.from({length:70},(_,index)=>({sessionKey:`agent-${index.toString(16).padStart(64,"0")}`,client:"PenEcho Agent",artifacts:[["page",{objectId:`widget-${index}`,title:"Page"}]]}));
  const normalized=api.normalizeWorkspace({version:1,sessions:[{sessionKey:"external",client:"Codex"}],internalSessions:internal},metadata);
  assert.equal(normalized.sessions.length,1);assert.equal(normalized.internalSessions.length,64);
  assert.equal(normalized.internalSessions[0].sessionKey,internal[6].sessionKey);
  assert.equal(normalized.internalSessions.at(-1).artifacts[0][1].objectId,"widget-69");
  assert.equal(metadata.bindings.length,1);
  const invalid=api.normalizeWorkspace({version:1,internalSessions:[null,{sessionKey:"external",client:"PenEcho Agent"},{...internal[0],client:"Codex"},{...internal[0],documentId:"different"}]},metadata);
  assert.equal(invalid.internalSessions,undefined);
});

 test("binary SHA-256 fallback matches native hashes at block boundaries and upload size", async () => {
  for (const context of [{crypto:undefined},{crypto:{}},{crypto:{subtle:{digest:async()=>{throw Error("unavailable");}}}},{}]) {
    const api=loadApi(context);
    for (const size of [0,1,55,56,63,64,65,127,128,600000]) {
      const bytes=Uint8Array.from({length:size},(_,i)=>i%256);
      assert.equal(await api.sha256Hex(bytes.buffer),crypto.createHash("sha256").update(bytes).digest("hex"));
      const slice=bytes.subarray(Math.min(1,size));
      assert.equal(await api.sha256Hex(slice),crypto.createHash("sha256").update(slice).digest("hex"));
    }
  }
});
