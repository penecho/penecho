"use strict";
// Runs the shipped live share dialog against a DOM and mocked Cloud share API.
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const {parseHTML} = require("linkedom");
const script = fs.readFileSync(path.join(__dirname, "..", "public", "cloud-connect.js"), "utf8");
const ORIGIN = "https://internaltest.penecho.ai", CANVAS_ID = "123e4567-e89b-42d3-a456-426614174001", SOURCE_ID = "123e4567-e89b-42d3-a456-426614174002";
const signedIn = { account:{ id:"account-1", name:"Test User" }, accountSession:{ signedIn:true }, device:{ configured:false }, browserSignIn:{ pending:false } };
const signedOut = { account:null, accountSession:{ signedIn:false }, device:{ configured:false }, browserSignIn:{ pending:false } };
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };

function boot({ language = "en", status = signedIn, canvasId = CANVAS_ID, canvasName = "Untitled canvas", shares = new Map(), navigator = {}, holdRequests = null, failRequests = null, clipboardFails = false } = {}) {
  const { document, window } = parseHTML(`<!doctype html><html lang="${language}"><body>
    <button id="cloudAccountBtn"><span class="cloud-account-label"></span></button><button id="shareCanvasBtn"></button><button id="exportPngBtn"></button>
    <span id="canvasDocumentNameLabel">${canvasName}</span></body></html>`);
  // linkedom has no focus model; track it so focus recovery can be observed.
  let focused = document.body;
  Object.defineProperty(document, "activeElement", { get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLInputElement.prototype.select = function () {};
  const calls = [], clipboard = [], order = [], exports = [];
  document.getElementById("exportPngBtn").addEventListener("click", () => exports.push("png"));
  const json = (body, statusCode = 200) => ({ ok:statusCode < 400, status:statusCode, json:async () => body });
  const fetch = async (url, options = {}) => {
    const method = options.method || "GET", target = String(url);
    calls.push({ method, url:target, body:options.body ? JSON.parse(options.body) : undefined });
    if (target === "/api/cloud/status" || target === "/api/cloud/account") return json(status);
    const match = target.match(/^\/api\/cloud\/canvases\/([0-9a-f-]{36})\/share(?:\?widgetId=([0-9a-f-]{36}))?$/i);
    if (!match) return json({ error:"not found" }, 404);
    order.push(`${method} share`);
    if (holdRequests?.[method]) await holdRequests[method];
    if (failRequests?.[method]) return json({ message:failRequests[method] }, 500);
    const key = `${match[1]}:${match[2] || (options.body ? JSON.parse(options.body).widgetId || "" : "")}`;
    if (method === "POST") shares.set(key, { ...shares.get(key), ...(JSON.parse(options.body).public !== undefined ? {public:JSON.parse(options.body).public,moderation:{state:"pending"}} : {}), url:`/canvas/share/${key.endsWith(":") ? "canvas-token" : "widget-token"}` });
    if (method === "DELETE") shares.delete(key);
    return json({ share:shares.get(key) || null });
  };
  const bridge = {
    currentCanvasId:() => canvasId,
    hasShareableContent:() => true,
    shareWidgetId:(id) => id === "local-widget" ? SOURCE_ID : null,
    saveForShare:async (widgetId) => { order.push(`save ${widgetId || "canvas"}`); canvasId = CANVAS_ID; return canvasId; },
  };
  Object.assign(window, { PENECHO_CONFIG:{ accessSessionToken:"test", cloudOrigin:ORIGIN }, PenEchoCloudProjects:bridge, PenEchoCommunityCanvas:{}, open:() => null, alert() {}, confirm:() => true });
  const context = vm.createContext({
    window, document, location:{ origin:"http://127.0.0.1:3888" },
    navigator:{ clipboard:{ writeText:async (value) => { if (clipboardFails) throw Error("denied"); clipboard.push(value); } }, ...navigator },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} }, localStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    fetch, setTimeout:() => 0, clearTimeout() {}, setInterval:() => 0, clearInterval() {}, queueMicrotask, URL, URLSearchParams, console, Date, JSON, Promise,
    Event:window.Event, CustomEvent:window.CustomEvent, TextEncoder, crypto:globalThis.crypto,
  });
  vm.runInContext(script, context, { filename:"public/cloud-connect.js" });
  const dialog = () => document.querySelector(".penecho-live-share-dialog");
  const button = (label) => [...(dialog()?.querySelectorAll("button") || [])].find((node) => node.textContent.trim() === label);
  return {
    document, window, bridge, calls, clipboard, order, exports, dialog, button,
    shareCalls:() => calls.filter((call) => call.url.includes("/share")),
    // The toolbar status refresh also reads the share; only writes change it.
    writes:() => calls.filter((call) => call.url.includes("/share") && call.method !== "GET"),
    steps:() => order.filter((step) => step !== "GET share"),
    targets:() => [...(dialog()?.querySelectorAll(".live-share-target") || [])],
    target:(name) => dialog()?.querySelector(`[data-share-target="${name}"]`),
    outbound:() => [...(dialog()?.querySelectorAll("a[target=_blank]") || [])],
    status:() => dialog()?.querySelector('[role="status"]'),
    async openCanvas() { await settle(); document.getElementById("shareCanvasBtn").click(); await settle(); },
    async openWidget(detail) { await settle(); window.dispatchEvent(new window.CustomEvent("penecho:community-widget-action", { detail:{ action:"share", widgetId:"local-widget", ...detail } })); await settle(); },
    async click(node) { const event = new window.Event("click", { bubbles:true, cancelable:true }); node.dispatchEvent(event); await settle(); return event; },
  };
}
const decode = (href) => { const url = new URL(href); return { endpoint:`${url.origin}${url.pathname}`, params:Object.fromEntries(url.searchParams) }; };

test("opening an inactive share explains the public scope and offers no outbound targets", async () => {
  const h = boot();
  await h.openCanvas();
  assert.ok(h.dialog());
  assert.ok(h.shareCalls().length > 0);
  assert.deepEqual(h.writes(), [], "opening only reads the current state");
  assert.equal(h.dialog().dataset.liveShare, "off");
  assert.equal(h.targets().length, 0);
  assert.equal(h.outbound().length, 0);
  assert.equal(h.dialog().querySelector(".live-share-active").hidden, true);
  assert.equal(h.dialog().querySelector(".live-share-steps").hidden, false);
  assert.ok(h.button("Save and enable sharing"));
  assert.equal(h.button("Turn off sharing").hidden, true);
  const scope = h.dialog().querySelector(".live-share-scope").textContent;
  for (const phrase of [/Anyone with the link can view this Canvas/, /later save to this Cloud Canvas appear at the same link/, /Turn sharing off at any time and the link stops working/, /Public discovery is optional and requires review/]) assert.match(scope, phrase);
});

test("enabling saves before sharing, then offers encoded X, LinkedIn, and public page links", async () => {
  const h = boot({ canvasName:"R&amp;D #1: 50% + “growth” 🚀" });
  await h.openCanvas();
  assert.equal(h.dialog().querySelector("header p").textContent, "R&D #1: 50% + “growth” 🚀");
  await h.click(h.button("Save and enable sharing"));
  assert.deepEqual(h.steps(), ["save canvas", "POST share"], "the Canvas is saved before the link is enabled");
  assert.deepEqual(h.writes().map(({ body }) => body), [{}], "a Canvas share sends no Widget selection");
  assert.equal(h.dialog().dataset.liveShare, "on");
  assert.match(h.status().textContent, /Sharing is on/);
  const publicUrl = `${ORIGIN}/canvas/share/canvas-token`;
  assert.equal(h.dialog().querySelector("input[readonly]").value, publicUrl);
  const x = decode(h.target("x").getAttribute("href")), linkedin = decode(h.target("linkedin").getAttribute("href"));
  assert.deepEqual(x, { endpoint:"https://x.com/intent/tweet", params:{ text:"R&D #1: 50% + “growth” 🚀 — made with PenEcho", url:publicUrl } });
  assert.deepEqual(linkedin, { endpoint:"https://www.linkedin.com/sharing/share-offsite/", params:{ url:publicUrl } });
  assert.equal(h.dialog().querySelector(".live-share-view").getAttribute("href"), publicUrl);
  for (const link of h.outbound()) {
    assert.deepEqual(link.getAttribute("rel").split(/\s+/).sort(), ["noopener", "noreferrer"]);
    assert.equal(link.getAttribute("aria-disabled"), "false");
  }
  assert.equal(h.target("system"), null, "no system share without navigator.share");
  assert.deepEqual([...h.dialog().querySelector(".live-share-active").children].map((node) => node.className), ["live-share-link", "live-share-more"], "text is reviewed before choosing a destination");
  assert.equal(h.dialog().querySelector("textarea").getAttribute("maxlength"), "2000", "drafts are not cut to a guessed X limit");

  const post = h.dialog().querySelector("textarea");
  post.value = "Line one & two\n#launch ?ref=1";
  post.dispatchEvent(new h.window.Event("input"));
  assert.deepEqual(decode(h.target("x").getAttribute("href")).params, { text:"Line one & two\n#launch ?ref=1", url:publicUrl });
  post.value = "   ";
  post.dispatchEvent(new h.window.Event("input"));
  assert.deepEqual(decode(h.target("x").getAttribute("href")).params, { url:publicUrl });

  await h.click(h.button("Copy link"));
  assert.deepEqual(h.clipboard, [publicUrl]);
  assert.equal(h.status().textContent, "Link copied.");
});

test("social links navigate from the click; LinkedIn copies the reviewed text first", async () => {
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]) });
  await h.openCanvas();
  const x = await h.click(h.target("x"));
  assert.equal(x.defaultPrevented, false, "the browser opens X from this gesture");
  assert.match(h.status().textContent, /Review the post there/);
  const post = h.dialog().querySelector("textarea");
  post.value = "Our study map";
  const linkedin = await h.click(h.target("linkedin"));
  assert.equal(linkedin.defaultPrevented, false);
  assert.deepEqual(h.clipboard, ["Our study map"]);
  assert.match(h.status().textContent, /post text is copied; paste it there/);
  assert.deepEqual(h.writes(), [], "posting never changes the share");
});

test("Copy post copies the reviewed text with the public link for any destination", async () => {
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]) });
  await h.openCanvas();
  const publicUrl = `${ORIGIN}/canvas/share/canvas-token`, post = h.dialog().querySelector("textarea"), copy = h.button("Copy post");
  assert.equal(copy.disabled, false);
  post.value = "  Study map for week 3 & beyond  ";
  await h.click(copy);
  assert.deepEqual(h.clipboard, [`Study map for week 3 & beyond\n${publicUrl}`]);
  assert.equal(h.status().textContent, "Post text and link copied. Paste them anywhere.");
  post.value = " ";
  await h.click(copy);
  assert.equal(h.clipboard.at(-1), publicUrl, "an empty draft still copies the link alone");
  assert.equal(h.status().textContent, "Link copied. Paste it anywhere.");
  assert.ok(h.button("Copy link"), "Copy link stays the primary action");
  assert.equal(h.button("Copy link").dataset.peButton, "primary");
  assert.deepEqual(h.writes(), [], "copying never changes the share");

  const failing = boot({ clipboardFails:true, shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]) });
  await failing.openCanvas();
  await failing.click(failing.button("Copy post"));
  assert.equal(failing.status().textContent, "Could not copy. Select the text and copy it yourself.");
  assert.equal(failing.status().dataset.tone, "error");

  const inactive = boot();
  await inactive.openCanvas();
  assert.equal(inactive.button("Copy post").disabled, true, "nothing to copy before the link exists");
  assert.equal(inactive.dialog().querySelector(".live-share-active").hidden, true);
  await inactive.click(inactive.button("Copy post"));
  assert.deepEqual(inactive.clipboard, []);
});

test("Export PNG uses the existing Canvas export without claiming the post attaches it", async () => {
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]) });
  await h.openCanvas();
  assert.match(h.dialog().querySelector(".live-share-image-note").textContent, /share a link only; no image is attached/);
  await h.click(h.button("Export PNG"));
  assert.deepEqual(h.exports, ["png"]);
  assert.match(h.status().textContent, /Attach the downloaded file/);
});

test("system share starts inside the click and treats AbortError as cancellation", async () => {
  const outcomes = [], shared = [];
  let settleShare;
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]), navigator:{
    canShare:(data) => Boolean(data.url),
    share:(data) => { shared.push(data); return new Promise((resolve, reject) => { settleShare = { resolve, reject }; }); },
  } });
  await h.openCanvas();
  const system = h.target("system");
  assert.ok(system);
  system.click();
  assert.equal(shared.length, 1, "navigator.share is called synchronously in the gesture");
  assert.deepEqual(JSON.parse(JSON.stringify(shared[0])), { title:"Share Canvas", url:`${ORIGIN}/canvas/share/canvas-token`, text:"A Canvas I made with PenEcho" });
  assert.equal(system.disabled, true);
  system.click();
  assert.equal(shared.length, 1, "a pending share sheet cannot be opened twice");
  for (const [error, expected, tone] of [[null, "Shared.", undefined], [Object.assign(Error("closed"), { name:"AbortError" }), "Sharing was cancelled.", undefined], [Object.assign(Error("denied"), { name:"NotAllowedError" }), "The share sheet could not open. Copy the link instead.", "error"]]) {
    if (error) settleShare.reject(error); else settleShare.resolve();
    await settle();
    outcomes.push([h.status().textContent, h.status().dataset.tone]);
    assert.equal(system.disabled, false);
    system.click();
  }
  assert.deepEqual(outcomes, [["Shared.", undefined], ["Sharing was cancelled.", undefined], ["The share sheet could not open. Copy the link instead.", "error"]]);
  settleShare.resolve();
  await settle();
});

test("busy revocation blocks outbound targets, then removes them and keeps focus in the dialog", async () => {
  let release;
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]), navigator:{ share:async () => {} }, holdRequests:{ DELETE:new Promise((resolve) => { release = resolve; }) } });
  await h.openCanvas();
  assert.equal(h.document.getElementById("shareCanvasBtn").dataset.liveShared, "true");
  const revoke = h.button("Turn off sharing");
  revoke.focus();
  revoke.click();
  await settle();
  assert.match(h.status().textContent, /Working/);
  for (const link of h.outbound()) assert.equal(link.getAttribute("aria-disabled"), "true");
  assert.equal((await h.click(h.target("x"))).defaultPrevented, true, "X cannot open while the link is being turned off");
  assert.equal(h.target("system").disabled, true);
  assert.equal(h.button("Copy post").disabled, true, "Copy post waits for the share state");
  release();
  await settle();
  assert.deepEqual(h.writes().map(({ method, body }) => [method, body]), [["DELETE", {}]]);
  assert.equal(h.dialog().dataset.liveShare, "off");
  assert.equal(h.targets().length, 0);
  assert.equal(h.outbound().length, 0);
  assert.equal(h.dialog().querySelector(".live-share-view"), null);
  assert.match(h.status().textContent, /link no longer works, including in posts/);
  assert.equal(h.document.activeElement, h.button("Save and enable sharing"), "focus moves from the hidden revoke button");
  assert.equal(h.document.getElementById("shareCanvasBtn").dataset.liveShared, "false");
});

test("Widget shares keep the source identity and label notes without rendering markup", async () => {
  const h = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }], [`${CANVAS_ID}:${SOURCE_ID}`, { url:"/canvas/share/widget-token" }]]) });
  await h.openWidget({ title:"Cell <b>membranes</b>", noteKind:"card" });
  assert.ok(h.shareCalls().some((call) => call.url === `/api/cloud/canvases/${CANVAS_ID}/share?widgetId=${SOURCE_ID}`), "the Widget share is read by its source id");
  assert.equal(h.dialog().querySelector("h2").textContent, "Share knowledge card");
  assert.equal(h.dialog().querySelector("header p").textContent, "Cell <b>membranes</b>");
  assert.equal(h.dialog().querySelector("header b"), null);
  assert.match(h.dialog().querySelector(".live-share-scope").textContent, /Only this knowledge card is shared, not the rest of the Canvas/);
  assert.equal(decode(h.target("x").getAttribute("href")).params.url, `${ORIGIN}/canvas/share/widget-token`, "the Widget link, not the Canvas link, is posted");
  assert.match(h.dialog().querySelector(".live-share-image-note").textContent, /no image is attached\. To include a picture of this knowledge card, save it with the download-image button/);
  assert.equal(h.button("Export PNG"), undefined, "Canvas export is not offered for a single Widget");
  await h.click(h.button("Turn off sharing"));
  assert.deepEqual(h.writes(), [{ method:"DELETE", url:`/api/cloud/canvases/${CANVAS_ID}/share`, body:{ widgetId:SOURCE_ID } }]);
  assert.equal(h.document.getElementById("shareCanvasBtn").dataset.liveShared, "true", "the Canvas link stays on");
});

test("a Widget without a share source opens nothing", async () => {
  const h = boot();
  await settle();
  h.window.dispatchEvent(new h.window.CustomEvent("penecho:community-widget-action", { detail:{ action:"share", widgetId:"unknown" } }));
  await settle();
  assert.equal(h.dialog(), null);
  assert.equal(h.shareCalls().some((call) => call.url.includes("widgetId")), false);
});

test("failed enabling and unreadable links never expose outbound targets", async () => {
  const failed = boot({ failRequests:{ POST:"Save this Canvas to Cloud first." } });
  await failed.openCanvas();
  await failed.click(failed.button("Save and enable sharing"));
  assert.equal(failed.status().textContent, "Save this Canvas to Cloud first.");
  assert.equal(failed.status().dataset.tone, "error");
  assert.equal(failed.targets().length, 0);
  assert.equal(failed.button("Save and enable sharing").disabled, false, "the owner can retry");

  const unreadable = boot({ shares:new Map([[`${CANVAS_ID}:`, { url:"javascript:alert(1)" }]]) });
  await unreadable.openCanvas();
  assert.equal(unreadable.outbound().length, 0);
  assert.equal(unreadable.dialog().querySelector("input[readonly]").value, "");
  assert.equal(unreadable.button("Copy link").disabled, true);
  assert.equal(unreadable.button("Turn off sharing").hidden, false, "the owner can still revoke it");
  assert.match(unreadable.status().textContent, /could not be read/);
});

test("signed-out owners sign in before anything is saved or shared", async () => {
  const h = boot({ status:signedOut });
  await h.openCanvas();
  assert.equal(h.shareCalls().length, 0);
  await h.click(h.button("Sign in / Register"));
  assert.equal(h.dialog(), null, "the share dialog hands off to Cloud sign-in");
  assert.ok(h.document.querySelector(".penecho-cloud-overlay"), "Cloud sign-in opens");
  assert.deepEqual(h.order, [], "nothing is saved, read, or enabled while signed out");
});

test("Chinese copy names the target and drafts the post in Chinese", async () => {
  const h = boot({ language:"zh-CN", canvasName:"细胞膜", shares:new Map([[`${CANVAS_ID}:`, { url:"/canvas/share/canvas-token" }]]) });
  await h.openCanvas();
  assert.equal(h.dialog().querySelector("h2").textContent, "分享 Canvas");
  assert.equal(h.dialog().querySelector(".live-share-targets-field .live-share-label").textContent, "分享到");
  assert.equal(h.dialog().querySelector("textarea").value, "细胞膜 — 用 PenEcho 制作");
  assert.equal(h.target("x").getAttribute("aria-label"), "发到 X（在新标签页打开）");
  assert.ok(h.button("关闭分享"));
});


test("public discovery is explicit, scoped to the Widget, and can be withdrawn without revoking its link", async()=>{
  const h=boot();await h.openWidget();
  const toggle=h.dialog().querySelector('.live-share-public-toggle');assert.equal(Boolean(toggle.checked),false);
  toggle.checked=true;toggle.dispatchEvent(new h.window.Event('change'));
  assert.deepEqual(h.writes(),[],'choosing public before enabling does not publish');
  await h.click(h.button('Save and enable sharing'));
  assert.deepEqual(h.writes()[0].body,{widgetId:SOURCE_ID,public:true});
  assert.match(h.dialog().querySelector('.live-share-public-status').textContent,/Pending review/);
  toggle.checked=false;toggle.dispatchEvent(new h.window.Event('change'));await settle();
  assert.deepEqual(h.writes().at(-1).body,{widgetId:SOURCE_ID,public:false});
  assert.equal(h.dialog().dataset.liveShare,'on');assert.equal(h.target('x').hidden,false);
});

test("public toggle rolls back on a failed request and refuses to save a switched Canvas",async()=>{
  const h=boot({shares:new Map([[`${CANVAS_ID}:`,{url:'/canvas/share/canvas-token'}]]),failRequests:{POST:'Offline'}});
  await h.openCanvas();const toggle=h.dialog().querySelector('.live-share-public-toggle');
  toggle.checked=true;toggle.dispatchEvent(new h.window.Event('change'));await settle();
  assert.equal(toggle.checked,false);assert.match(h.status().textContent,/Offline/);
  const writes=h.writes().length;h.bridge.currentCanvasId=()=>SOURCE_ID;
  toggle.checked=true;toggle.dispatchEvent(new h.window.Event('change'));await settle();
  assert.equal(h.writes().length,writes);assert.match(h.status().textContent,/Reopen Share/);
});

for (const language of ['en', 'zh-CN']) {
  test(`public Canvas sharing uses the live link without a separate publication form (${language})`, async () => {
    const h = boot({language});
    await h.openCanvas();
    const toggle = h.dialog().querySelector('.live-share-public-toggle');
    assert.equal(Boolean(toggle.checked), false);
    assert.equal(h.dialog().querySelector('select'), null, 'no legacy publication category');
    assert.equal(h.dialog().querySelector('.live-share-more').hasAttribute('open'), false);
    assert.match(h.dialog().textContent, language === 'en' ? /Share publicly/ : /公开展示/);
    toggle.checked = true;
    toggle.dispatchEvent(new h.window.Event('change'));
    assert.deepEqual(h.writes(), []);
    await h.click(h.button(language === 'en' ? 'Save and enable sharing' : '保存并开启分享'));
    assert.deepEqual(h.writes()[0].body, {public:true});
    assert.deepEqual(h.steps(), ['save canvas', 'POST share']);
    assert.equal(h.dialog().dataset.liveShare, 'on');
    assert.match(h.dialog().querySelector('input[readonly]').value, /\/canvas\/share\/canvas-token$/);
    assert.equal(h.calls.some(call => call.url.includes('/community/')), false);
    await h.click(h.button(language === 'en' ? 'Turn off sharing' : '关闭分享'));
    assert.equal(Boolean(toggle.checked), false);
    assert.equal(h.dialog().dataset.liveShare, 'off');
  });

  test(`public review states are readable without publishing on open (${language})`, async () => {
    const expected = language === 'en'
      ? {pending:/Pending review/, approved:/Visible in Public shares/, blocked:/does not meet/, review:/further review/, error:/temporarily unavailable/}
      : {pending:/等待审核/, approved:/已在公开分享页面展示/, blocked:/不符合公开分享要求/, review:/暂时无法完成审核/, error:/审核暂时不可用/};
    for (const [state, message] of Object.entries(expected)) {
      const h = boot({language, shares:new Map([[`${CANVAS_ID}:`, {url:'/canvas/share/canvas-token', public:true, moderation:{state}}]])});
      await h.openCanvas();
      assert.equal(h.dialog().querySelector('.live-share-public-toggle').checked, true);
      assert.match(h.dialog().querySelector('.live-share-public-status').textContent, message);
      assert.deepEqual(h.writes(), [], 'reading review status never submits content');
    }
  });
}

test('legacy Widget Echo action opens unified sharing with public intent but waits for confirmation', async () => {
  const h = boot();
  await h.openWidget({action:'echo'});
  assert.equal(h.dialog().querySelector('.live-share-public-toggle').checked, true);
  assert.deepEqual(h.writes(), []);
  await h.click(h.button('Save and enable sharing'));
  assert.deepEqual(h.writes()[0].body, {widgetId:SOURCE_ID, public:true});
  assert.equal(h.calls.some(call => call.url.includes('/community/')), false);
});
