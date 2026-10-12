"use strict";
// Boundary tests for the live share social helpers, run from the shipped source.
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "public", "cloud-connect.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`), body = source.indexOf("{", source.indexOf(")", start));
  assert.ok(start >= 0, name);
  for (let depth = 0, index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && !--depth) return source.slice(start, index + 1);
  }
  throw Error(name);
}
function helpers({ origin = "https://penecho.ai", navigator = {} } = {}) {
  const context = vm.createContext({ URL, URLSearchParams, navigator, cloudOrigin:() => origin });
  vm.runInContext(["liveSharePublicUrl", "liveShareSocialLinks", "liveSharePostWithLink", "liveShareSubject", "liveShareDefaultPost", "liveShareNativeAvailable"].map(extract).join("\n"), context);
  return context;
}
const SHARE_URL = "https://penecho.ai/canvas/share/123e4567-e89b-42d3-a456-426614174000";

test("X and LinkedIn intents carry exactly the reviewed text and public link", () => {
  const { liveShareSocialLinks } = helpers();
  for (const text of ["R&D #1: 50% + \"growth\" ✓ 🚀", "a=b&url=https://evil.test/#frag", "第一行\n第二行 — 用 PenEcho 制作", "  padded  "]) {
    const links = liveShareSocialLinks(SHARE_URL, text), x = new URL(links.x), linkedin = new URL(links.linkedin);
    assert.equal(`${x.origin}${x.pathname}`, "https://x.com/intent/tweet");
    assert.deepEqual([...x.searchParams.keys()], ["text", "url"], "user text cannot inject extra intent parameters");
    assert.equal(x.searchParams.get("text"), text.trim());
    assert.equal(x.searchParams.get("url"), SHARE_URL);
    assert.equal(x.hash, "", "a # in the text stays inside the encoded value");
    assert.equal(`${linkedin.origin}${linkedin.pathname}`, "https://www.linkedin.com/sharing/share-offsite/");
    assert.deepEqual([...linkedin.searchParams.entries()], [["url", SHARE_URL]], "LinkedIn only receives the link");
  }
});

test("blank post text is omitted instead of sending an empty X draft", () => {
  const { liveShareSocialLinks } = helpers();
  for (const text of ["", "   \n\t", null, undefined]) assert.deepEqual([...new URL(liveShareSocialLinks(SHARE_URL, text).x).searchParams.keys()], ["url"]);
});

test("Copy post joins the trimmed draft and the public link without truncating long drafts", () => {
  const { liveSharePostWithLink } = helpers(), long = "研究".repeat(900);
  assert.equal(liveSharePostWithLink("  Field notes & #map  ", SHARE_URL), `Field notes & #map\n${SHARE_URL}`);
  assert.equal(liveSharePostWithLink(long, SHARE_URL), `${long}\n${SHARE_URL}`);
  for (const blank of ["", " \n ", null, undefined]) assert.equal(liveSharePostWithLink(blank, SHARE_URL), SHARE_URL);
});

test("only non-empty http(s) share URLs resolved against the Cloud origin become public links", () => {
  const { liveSharePublicUrl } = helpers({ origin:"https://internaltest.penecho.ai" });
  assert.equal(liveSharePublicUrl({ url:"/canvas/share/abc" }), "https://internaltest.penecho.ai/canvas/share/abc");
  assert.equal(liveSharePublicUrl({ url:SHARE_URL }), SHARE_URL);
  for (const share of [null, undefined, {}, { url:"" }, { url:"   " }, { url:42 }, { url:"javascript:alert(1)" }, { url:"data:text/html,<b>x</b>" }, { url:"http://[bad" }, { url:"mailto:a@b.test" }]) {
    assert.equal(liveSharePublicUrl(share), "", JSON.stringify(share));
  }
});

test("default post text names the source concisely and falls back per kind and language", () => {
  const { liveShareDefaultPost, liveShareSubject } = helpers();
  const canvas = liveShareSubject("canvas"), card = liveShareSubject("widget", "card"), note = liveShareSubject("widget", "note"), widget = liveShareSubject("widget", "unexpected");
  assert.equal(liveShareDefaultPost("  Cell\n membranes  ", card, false), "Cell membranes — made with PenEcho");
  assert.equal(liveShareDefaultPost("细胞膜", card, true), "细胞膜 — 用 PenEcho 制作");
  assert.equal(liveShareDefaultPost("x".repeat(400), canvas, false).length, 120 + " — made with PenEcho".length);
  assert.equal(liveShareDefaultPost("", canvas, false), "A Canvas I made with PenEcho");
  assert.equal(liveShareDefaultPost("", card, true), "我用 PenEcho 制作的知识卡片");
  assert.equal(liveShareDefaultPost(" ", note, false), "A work note I made with PenEcho");
  assert.deepEqual([...widget.title], ["Share Widget", "分享 Widget"], "unknown note kinds keep the Widget wording");
});

test("system share is offered only when the browser can share the link", () => {
  assert.equal(helpers().liveShareNativeAvailable({ url:SHARE_URL }), false);
  assert.equal(helpers({ navigator:{ share() {} } }).liveShareNativeAvailable({ url:SHARE_URL }), true);
  assert.equal(helpers({ navigator:{ share() {}, canShare:() => false } }).liveShareNativeAvailable({ url:SHARE_URL }), false);
  assert.equal(helpers({ navigator:{ share() {}, canShare:() => { throw TypeError("unsupported"); } } }).liveShareNativeAvailable({ url:SHARE_URL }), false);
});
