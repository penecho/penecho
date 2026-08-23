"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  DEFAULT_MAX_GRANTS,
  DEFAULT_TTL_MS,
  TOKEN_PATTERN,
  createNativePickerGrantStore,
} = require("../src/server/canvas-agent/native-picker-grants.js");

test("native picker grants are unguessable-looking, exact-bound, single-use, and short-lived", () => {
  let clock = 10_000, randomByte = 1, randomSize = 0;
  const store = createNativePickerGrantStore({
    now:() => clock,
    randomBytes:size => { randomSize = size; return Buffer.alloc(size, randomByte++); },
    ttlMs:1_000,
  });
  const folderPath = path.resolve("selected-folder"), filePath = path.resolve("selected-file.txt");

  const folderToken = store.issue({ selectedPath:folderPath, kind:"folder" });
  assert.equal(randomSize, 32);
  assert.match(folderToken, TOKEN_PATTERN);
  assert.equal(folderToken.includes(folderPath), false);
  assert.equal(store.consume({ token:folderToken, selectedPath:folderPath, kind:"file" }), false);
  assert.equal(store.consume({ token:folderToken, selectedPath:folderPath, kind:"folder" }), false, "a mismatched attempt burns the grant");

  const fileToken = store.issue({ selectedPath:filePath, kind:"file" });
  assert.equal(store.consume({ token:fileToken, selectedPath:filePath, kind:"file" }), true);
  assert.equal(store.consume({ token:fileToken, selectedPath:filePath, kind:"file" }), false);

  const wrongPathToken = store.issue({ selectedPath:filePath, kind:"file" });
  assert.equal(store.consume({ token:wrongPathToken, selectedPath:`${filePath}.other`, kind:"file" }), false);
  assert.equal(store.consume({ token:wrongPathToken, selectedPath:filePath, kind:"file" }), false);

  const expiredToken = store.issue({ selectedPath:folderPath, kind:"folder" });
  clock += 1_000;
  assert.equal(store.consume({ token:expiredToken, selectedPath:folderPath, kind:"folder" }), false);
  assert.equal(store.consume({ token:"picker-not-a-token", selectedPath:folderPath, kind:"folder" }), false);
  assert.throws(() => store.issue({ selectedPath:"relative/path", kind:"folder" }), /absolute/);
  assert.throws(() => store.issue({ selectedPath:folderPath, kind:"other" }), /absolute file or folder/);
  assert.ok(DEFAULT_TTL_MS <= 60_000);
  assert.ok(DEFAULT_MAX_GRANTS <= 64);
});

test("native picker grant storage stays bounded", () => {
  let randomByte = 20;
  const store = createNativePickerGrantStore({
    randomBytes:size => Buffer.alloc(size, randomByte++),
    ttlMs:1_000,
    maxGrants:2,
  });
  const selectedPath = path.resolve("bounded-folder"), first = store.issue({ selectedPath, kind:"folder" }), second = store.issue({ selectedPath, kind:"folder" }), third = store.issue({ selectedPath, kind:"folder" });
  assert.equal(store.consume({ token:first, selectedPath, kind:"folder" }), false, "the oldest grant is evicted");
  assert.equal(store.consume({ token:second, selectedPath, kind:"folder" }), true);
  assert.equal(store.consume({ token:third, selectedPath, kind:"folder" }), true);
});
