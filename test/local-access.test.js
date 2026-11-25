"use strict";
require("./helpers/safety.js");
// F5: who may open PenEcho from another device. The state module and the QR encoder; the server's rules are in server-security.test.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createLocalAccess, MOST_WRONG } = require("../src/server/local-access.js");
const { qrModules, qrSvg } = require("../src/server/qr-svg.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-local-access-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let n = 0;
const dir = () => path.join(temp, `state-${++n}`);

test("the first start makes a six-digit code, keeps it in a file only this user can read, and keeps it across restarts", () => {
  const state = dir(), first = createLocalAccess({ stateDirectory:state, env:{} }), view = first.view();
  assert.match(view.code, /^\d{6}$/);
  assert.deepEqual([view.on, view.askCode, view.devices, view.codeFromEnvironment], [true, true, [], false], "network access on, the code asked, by default");
  if (process.platform !== "win32") assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
  assert.equal(createLocalAccess({ stateDirectory:state, env:{} }).view().code, view.code, "the same code after a restart");
  // A file someone else could read is tightened at start.
  if (process.platform !== "win32") { fs.chmodSync(first.file, 0o644); createLocalAccess({ stateDirectory:state, env:{} }); assert.equal(fs.statSync(first.file).mode & 0o777, 0o600); }
  // Codes are spread over all six digits.
  const codes = new Set(Array.from({ length:40 }, () => createLocalAccess({ stateDirectory:dir(), env:{} }).view().code));
  assert.ok(codes.size > 35);
});

test("PENECHO_ACCESS_CODE sets the code for a server with no screen; it cannot be replaced from Settings", () => {
  const access = createLocalAccess({ stateDirectory:dir(), env:{ PENECHO_ACCESS_CODE:"424242" } });
  assert.deepEqual([access.view().code, access.view().codeFromEnvironment], ["424242", true]);
  assert.equal(access.checkCode("424242"), true);
  assert.throws(() => access.update({ newCode:true }), error => error.status === 409);
  assert.equal(createLocalAccess({ stateDirectory:dir(), env:{ PENECHO_ACCESS_CODE:"12345" } }).view().codeFromEnvironment, false, "not six digits: ignored");
});

test("the code is checked exactly; New code changes it and forgets every remembered device and key", () => {
  const access = createLocalAccess({ stateDirectory:dir(), env:{} }), code = access.view().code;
  assert.equal(access.checkCode(code), true);
  for (const wrong of ["", "12345", "1234567", "abcdef", `${code} `, String((Number(code) + 1) % 1e6).padStart(6, "0")]) assert.equal(access.checkCode(wrong), false, wrong);
  const { token } = access.remember(), { key } = access.issueKey();
  assert.ok(access.recognize(token));
  const after = access.update({ newCode:true });
  assert.notEqual(after.code, code);
  assert.deepEqual(after.devices, []);
  assert.equal(access.recognize(token), null);
  assert.equal(access.useKey(key), false);
});

test("a remembered device is kept 90 days from when it was last seen, survives a restart, and is renewed when used", () => {
  let clock = Date.UTC(2026, 10, 12);
  const state = dir(), access = createLocalAccess({ stateDirectory:state, env:{}, now:() => clock });
  const { token, maxAgeSeconds } = access.remember();
  assert.equal(maxAgeSeconds, 90 * 86_400);
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(access.file, "utf8"))).includes(token), "only its hash is stored");
  const again = createLocalAccess({ stateDirectory:state, env:{}, now:() => clock });
  assert.deepEqual(again.recognize(token), { renew:false }, "known after a restart");
  clock += 2 * 3_600_000;
  assert.deepEqual(again.recognize(token), { renew:true }, "renewed when used later");
  clock += 89 * 86_400_000;
  assert.ok(again.recognize(token), "still known 89 days after it was last seen");
  clock += 91 * 86_400_000;
  assert.equal(again.recognize(token), null, "forgotten 90 days after");
  assert.equal(again.recognize("not-a-token-of-this-penecho-at-all"), null);
});

test("a QR key works once, and not after ten minutes", () => {
  let clock = 1_000_000;
  const access = createLocalAccess({ stateDirectory:dir(), env:{}, now:() => clock });
  const once = access.issueKey();
  assert.equal(once.expiresAt, clock + 10 * 60_000);
  assert.equal(access.useKey(once.key), true);
  assert.equal(access.useKey(once.key), false, "used up");
  const late = access.issueKey();
  clock += 10 * 60_000 + 1;
  assert.equal(access.useKey(late.key), false, "too late");
  assert.equal(access.useKey("x".repeat(30)), false);
});

test("on, off and Without a code are kept, and listeners hear each change", () => {
  const state = dir(), access = createLocalAccess({ stateDirectory:state, env:{} }), heard = [];
  access.onChange(view => heard.push([view.on, view.askCode]));
  access.update({ on:false });
  access.update({ askCode:false });
  assert.deepEqual(heard, [[false, true], [false, false]]);
  const again = createLocalAccess({ stateDirectory:state, env:{} });
  assert.deepEqual([again.on(), again.askCode()], [false, false]);
  assert.throws(() => access.update({ on:"yes" }), error => error.status === 400);
});

test("the QR code: a version that fits, the finder patterns, timing and the dark module; and plain SVG", () => {
  const text = "http://192.168.1.23:3888/?k=Q2xhdWRlLXRlc3Qta2V5LTEy", { version, size, modules } = qrModules(text);
  assert.equal(version, 4); assert.equal(size, 33);
  const finder = (r, c) => [0, 6].every(i => [0, 1, 2, 3, 4, 5, 6].every(j => modules[r + i][c + j] && modules[r + j][c + i]));
  assert.ok(finder(0, 0) && finder(0, size - 7) && finder(size - 7, 0));
  for (let i = 8; i < size - 8; i++) assert.equal(modules[6][i], i % 2 === 0);
  assert.equal(modules[size - 8][8], true);
  assert.equal(qrModules("z".repeat(200)).version, 10);
  assert.throws(() => qrModules("z".repeat(300)), /too long/);
  const svg = qrSvg(text);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 41 41"/);
  assert.doesNotMatch(svg, /<script|on\w+=/i);
});

test("after 100 wrong codes typing the code stops working, also after a restart, until New code; the QR key still works", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-f5-wrong-"));
  try {
    let access=createLocalAccess({stateDirectory:dir,env:{}});
    const code=access.view().code,wrongGuess=code==="000000"?"111111":"000000";
    for(let i=1;i<MOST_WRONG;i++)assert.equal(access.noteWrong(),false);
    assert.equal(access.checkCode(code),true,"99 wrong: the code still works");
    assert.equal(access.checkCode(wrongGuess),false);
    assert.equal(access.noteWrong(),true);
    assert.equal(access.checkCode(code),false,"locked: even the right code");
    assert.deepEqual([access.view().codeLocked,access.view().wrongCodes],[true,100]);
    access=createLocalAccess({stateDirectory:dir,env:{}});
    assert.equal(access.checkCode(code),false,"still locked after a restart");
    const {key}=access.issueKey();
    assert.equal(access.useKey(key),true,"the QR key is not the code");
    const fresh=access.update({newCode:true});
    assert.deepEqual([fresh.codeLocked,fresh.wrongCodes],[false,0]);
    assert.equal(access.checkCode(fresh.code),true);
    // A code set by PENECHO_ACCESS_CODE: counted in memory, so a restart lets it be typed again.
    const fixed=createLocalAccess({stateDirectory:dir,env:{PENECHO_ACCESS_CODE:"314159"}});
    for(let i=0;i<MOST_WRONG;i++)fixed.noteWrong();
    assert.equal(fixed.checkCode("314159"),false);
    assert.equal(createLocalAccess({stateDirectory:dir,env:{PENECHO_ACCESS_CODE:"314159"}}).checkCode("314159"),true);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
