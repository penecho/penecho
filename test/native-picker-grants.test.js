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
  const filePath = path.resolve("selected-file.txt");
  const fileToken = store.issue({ selectedPath:filePath, kind:"file" });
  assert.equal(randomSize, 32);
  assert.match(fileToken, TOKEN_PATTERN);
  assert.equal(fileToken.includes(filePath), false);
  assert.equal(store.consume({ token:fileToken, selectedPath:filePath, kind:"file" }), true);
  assert.equal(store.consume({ token:fileToken, selectedPath:filePath, kind:"file" }), false);

  const wrongPathToken = store.issue({ selectedPath:filePath, kind:"file" });
  assert.equal(store.consume({ token:wrongPathToken, selectedPath:`${filePath}.other`, kind:"file" }), false);
  assert.equal(store.consume({ token:wrongPathToken, selectedPath:filePath, kind:"file" }), false);

  const expiredToken = store.issue({ selectedPath:filePath, kind:"file" });
  clock += 1_000;
  assert.equal(store.consume({ token:expiredToken, selectedPath:filePath, kind:"file" }), false);
  assert.equal(store.consume({ token:"picker-not-a-token", selectedPath:filePath, kind:"file" }), false);
  assert.throws(() => store.issue({ selectedPath:"relative/path", kind:"file" }), /absolute/);
  assert.throws(() => store.issue({ selectedPath:filePath, kind:"folder" }), /absolute file path/);
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
  const selectedPath = path.resolve("bounded-file.txt"), first = store.issue({ selectedPath, kind:"file" }), second = store.issue({ selectedPath, kind:"file" }), third = store.issue({ selectedPath, kind:"file" });
  assert.equal(store.consume({ token:first, selectedPath, kind:"file" }), false, "the oldest grant is evicted");
  assert.equal(store.consume({ token:second, selectedPath, kind:"file" }), true);
  assert.equal(store.consume({ token:third, selectedPath, kind:"file" }), true);
});
