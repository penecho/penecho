"use strict";
// PenEcho live changes: the shared format for a Canvas that several people and
// agents edit at once. Ink travels as exact pixel patches of 512 px tiles, so
// strokes drawn in the same tile at the same time are all kept. Objects travel
// as field changes. Every copy applies changes in the server's order and so
// converges. Shared by the browser (window.PENECHO_LIVE_OPS) and Cloud (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_LIVE_OPS = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TILE = 512,
    TILES_PER_SIDE = 40,
    TOLERANCE = 3,
    PATCH_VERSION = 1,
    KINDS = Object.freeze(["widgets", "images", "textBoxes", "animations"]),
    ID_PATTERNS = Object.freeze({ widgets:/^widget-\d{1,15}$/, images:/^image-\d{1,15}$/, textBoxes:/^text-box-\d{1,15}$/, animations:/^animation-\d{1,15}$/ }),
    META_FIELDS = new Set(["frontKind", "placedKind"]),
    LIMITS = Object.freeze({ opsPerChange:256, tilesPerOp:64, patchChars:2_800_000, changeChars:8_000_000, orderIds:2000, fieldChars:4_000_000 }),
    BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

  function liveError(message) {
    return Object.assign(new Error(message), { code:"invalid_live_change" });
  }

  // ---------- Ink ----------
  // Fully transparent pixels are equal whatever their colour channels say.
  function samePixel(a, i, b, j) {
    if (a[i + 3] === 0 && b[j + 3] === 0) return true;
    return a[i] === b[j] && a[i + 1] === b[j + 1] && a[i + 2] === b[j + 2] && a[i + 3] === b[j + 3];
  }
  // Canvases store premultiplied colour, so faint edge pixels round differently
  // between browsers. Comparing premultiplied values keeps them within tolerance.
  function closePixel(a, i, b, j, tolerance = TOLERANCE) {
    const alphaA = a[i + 3], alphaB = b[j + 3];
    if (Math.abs(alphaA - alphaB) > tolerance) return false;
    for (let channel = 0; channel < 3; channel++)
      if (Math.abs(a[i + channel] * alphaA - b[j + channel] * alphaB) / 255 > tolerance) return false;
    return true;
  }
  function tileKey(value) {
    const match = /^(\d{1,2}),(\d{1,2})$/.exec(String(value || ""));
    if (!match) return null;
    const tx = Number(match[1]), ty = Number(match[2]);
    return tx < TILES_PER_SIDE && ty < TILES_PER_SIDE ? { tx, ty, key:`${tx},${ty}` } : null;
  }
  // The changed pixels of one tile: the bounding rectangle, a bit mask inside
  // it, and the before and after RGBA values of each masked pixel in row order.
  function diffTile(before, after, size = TILE) {
    const length = size * size * 4;
    before = before || new Uint8ClampedArray(length);
    after = after || new Uint8ClampedArray(length);
    if (before.length !== length || after.length !== length) throw liveError("Tile pixels have the wrong size.");
    let x0 = size, y0 = size, x1 = -1, y1 = -1, count = 0;
    for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i += 4) {
      if (samePixel(before, i, after, i)) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!count) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1,
      mask = new Uint8Array(Math.ceil(w * h / 8)),
      values = new Uint8Array(count * 4),
      previous = new Uint8Array(count * 4);
    let n = 0;
    for (let row = 0; row < h; row++) for (let column = 0; column < w; column++) {
      const i = ((y0 + row) * size + x0 + column) * 4;
      if (samePixel(before, i, after, i)) continue;
      const bit = row * w + column, j = n++ * 4;
      mask[bit >> 3] |= 1 << (bit & 7);
      values.set(after.subarray(i, i + 4), j);
      previous.set(before.subarray(i, i + 4), j);
    }
    return { x:x0, y:y0, w, h, mask, values, previous };
  }
  // Undo and Redo change only pixels that still hold what this change left,
  // so they never remove ink someone else added since.
  function restorePatch(patch, direction = "undo") {
    const undo = direction === "undo";
    return { x:patch.x, y:patch.y, w:patch.w, h:patch.h, mask:patch.mask,
      values:undo ? patch.previous : patch.values, expect:undo ? patch.values : patch.previous };
  }
  function applyTilePatch(pixels, patch, size = TILE) {
    const { x, y, w, h, mask, values, expect } = patch;
    if (x + w > size || y + h > size || pixels.length !== size * size * 4) throw liveError("Patch is outside its tile.");
    let changed = 0, n = 0;
    for (let row = 0; row < h; row++) for (let column = 0; column < w; column++) {
      const bit = row * w + column;
      if (!(mask[bit >> 3] & (1 << (bit & 7)))) continue;
      const i = ((y + row) * size + x + column) * 4, j = n++ * 4;
      if (expect && !closePixel(pixels, i, expect, j)) continue;
      if (samePixel(pixels, i, values, j)) continue;
      pixels[i] = values[j];
      pixels[i + 1] = values[j + 1];
      pixels[i + 2] = values[j + 2];
      pixels[i + 3] = values[j + 3];
      changed++;
    }
    return changed;
  }
  function maskCount(mask, bits) {
    let count = 0;
    for (let bit = 0; bit < bits; bit++) if (mask[bit >> 3] & (1 << (bit & 7))) count++;
    return count;
  }
  // Wire form before compression: version, flags, x, y, w, h (uint16 LE),
  // the mask, the values and, for a restore patch, the expected values.
  function packPatch(patch) {
    const count = patch.values.length / 4, flags = patch.expect ? 1 : 0,
      bytes = new Uint8Array(12 + patch.mask.length + count * 4 * (flags ? 2 : 1)),
      view = new DataView(bytes.buffer);
    bytes[0] = PATCH_VERSION;
    bytes[1] = flags;
    view.setUint16(2, patch.x, true);
    view.setUint16(4, patch.y, true);
    view.setUint16(6, patch.w, true);
    view.setUint16(8, patch.h, true);
    bytes.set(patch.mask, 12);
    bytes.set(patch.values, 12 + patch.mask.length);
    if (flags) bytes.set(patch.expect, 12 + patch.mask.length + count * 4);
    return bytes;
  }
  function unpackPatch(bytes, size = TILE) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes[0] !== PATCH_VERSION || bytes[1] > 1) throw liveError("Unsupported ink patch.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      x = view.getUint16(2, true), y = view.getUint16(4, true), w = view.getUint16(6, true), h = view.getUint16(8, true);
    if (!w || !h || x + w > size || y + h > size) throw liveError("Ink patch is outside its tile.");
    const maskBytes = Math.ceil(w * h / 8), mask = bytes.subarray(12, 12 + maskBytes), count = maskCount(mask, w * h),
      expectBytes = bytes[1] ? count * 4 : 0;
    if (bytes.length !== 12 + maskBytes + count * 4 + expectBytes) throw liveError("Ink patch has the wrong length.");
    const values = bytes.subarray(12 + maskBytes, 12 + maskBytes + count * 4);
    return { x, y, w, h, mask, values, ...(expectBytes ? { expect:bytes.subarray(12 + maskBytes + count * 4) } : {}) };
  }

  // ---------- Objects ----------
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
  }
  const equal = (a, b) => a === b || stable(a) === stable(b);
  // From one list to another: new objects, changed fields, removed objects and,
  // when existing objects changed stacking, the new order. A conditional diff
  // (Undo/Redo) applies each field only if it still holds the value it is
  // leaving, and removes an object only if nobody changed it since.
  function diffObjects(kind, before = [], after = [], { conditional = false } = {}) {
    const ops = [], previous = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]));
    for (const item of after) {
      const old = previous.get(item.id);
      if (!old) {
        ops.push({ t:"obj", k:kind, id:item.id, put:item, ...(conditional ? { ifAbsent:true } : {}) });
        continue;
      }
      const set = {}, unset = [], expect = {};
      for (const field of new Set([...Object.keys(old), ...Object.keys(item)])) {
        if (field === "id" || equal(old[field], item[field])) continue;
        if (item[field] === undefined) unset.push(field);
        else set[field] = item[field];
        if (conditional) expect[field] = old[field] === undefined ? null : old[field];
      }
      if (Object.keys(set).length || unset.length)
        ops.push({ t:"obj", k:kind, id:item.id, ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}), ...(conditional ? { expect } : {}) });
    }
    for (const item of before) if (!next.has(item.id)) ops.push({ t:"obj", k:kind, id:item.id, del:true, ...(conditional ? { expect:item } : {}) });
    const kept = after.filter(item => previous.has(item.id)).map(item => item.id).join("\n"),
      old = before.filter(item => next.has(item.id)).map(item => item.id).join("\n");
    if (kept !== old) ops.push({ t:"order", k:kind, ids:after.map(item => item.id) });
    return ops;
  }
  function expectedValue(current, expect, field) {
    if (!expect || !Object.hasOwn(expect, field)) return true;
    return expect[field] === null ? current[field] === undefined || current[field] === null : equal(current[field], expect[field]);
  }
  // The next state of one object: undefined when the change does not apply,
  // null when it removes the object.
  function applyObjectOp(current, op) {
    if (op.put) {
      if (current && op.ifAbsent) return undefined;
      return { ...op.put, id:op.id };
    }
    if (!current) return undefined;
    if (op.del) {
      if (op.expect && Object.keys(op.expect).some(field => field !== "id" && !expectedValue(current, op.expect, field))) return undefined;
      return null;
    }
    let next = current;
    for (const [field, value] of Object.entries(op.set || {})) {
      if (!expectedValue(current, op.expect, field) || equal(next[field], value)) continue;
      if (next === current) next = { ...current };
      next[field] = value;
    }
    for (const field of op.unset || []) {
      if (!expectedValue(current, op.expect, field) || next[field] === undefined) continue;
      if (next === current) next = { ...current };
      delete next[field];
    }
    return next === current ? undefined : next;
  }
  // Objects named by the change move into its order; objects it does not know
  // (added meanwhile by someone else) stay in front, in their current order.
  function applyOrder(currentIds, ids) {
    const present = new Set(currentIds), wanted = ids.filter(id => present.has(id)), named = new Set(wanted);
    return [...wanted, ...currentIds.filter(id => !named.has(id))];
  }

  // ---------- Validation ----------
  function plainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }
  function safeFields(value) {
    return plainObject(value) && Object.keys(value).every(field => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field));
  }
  function validateOp(op) {
    if (!plainObject(op)) throw liveError("A change must be an object.");
    if (op.t === "ink") {
      if (!Array.isArray(op.tiles) || !op.tiles.length || op.tiles.length > LIMITS.tilesPerOp) throw liveError("Ink changes need 1–64 tiles.");
      const keys = new Set();
      for (const tile of op.tiles) {
        if (!plainObject(tile) || !tileKey(tile.k) || keys.has(tile.k)) throw liveError("Ink tile key is invalid.");
        if (typeof tile.d !== "string" || !tile.d || tile.d.length > LIMITS.patchChars || !BASE64.test(tile.d)) throw liveError("Ink tile data is invalid.");
        keys.add(tile.k);
      }
      return op;
    }
    if (op.t === "obj") {
      if (!KINDS.includes(op.k) || !ID_PATTERNS[op.k].test(op.id || "")) throw liveError("Object change has an invalid kind or ID.");
      const forms = [op.put !== undefined, op.set !== undefined || op.unset !== undefined, op.del === true].filter(Boolean).length;
      if (forms !== 1) throw liveError("Object change must add, change or remove.");
      if (op.put !== undefined && !safeFields(op.put)) throw liveError("Added object is invalid.");
      if (op.set !== undefined && !safeFields(op.set)) throw liveError("Changed fields are invalid.");
      if (op.unset !== undefined && (!Array.isArray(op.unset) || !op.unset.every(field => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)))) throw liveError("Removed fields are invalid.");
      if (op.expect !== undefined && !safeFields(op.expect)) throw liveError("Expected fields are invalid.");
      return op;
    }
    if (op.t === "order") {
      if (!KINDS.includes(op.k) || !Array.isArray(op.ids) || op.ids.length > LIMITS.orderIds || !op.ids.every(id => ID_PATTERNS[op.k].test(id))) throw liveError("Order change is invalid.");
      return op;
    }
    if (op.t === "meta") {
      if (!plainObject(op.set) || !Object.keys(op.set).length || !Object.keys(op.set).every(field => META_FIELDS.has(field))) throw liveError("Canvas setting change is invalid.");
      if (!Object.values(op.set).every(value => ["image", "widget", "text-box"].includes(value))) throw liveError("Canvas setting value is invalid.");
      return op;
    }
    throw liveError("Unknown change type.");
  }
  function validateChange(ops) {
    if (!Array.isArray(ops) || !ops.length || ops.length > LIMITS.opsPerChange) throw liveError("A change needs 1–256 parts.");
    for (const op of ops) validateOp(op);
    if (JSON.stringify(ops).length > LIMITS.changeChars) throw liveError("This change is too large to share live.");
    return ops;
  }

  return Object.freeze({
    TILE,
    TILES_PER_SIDE,
    TOLERANCE,
    KINDS,
    ID_PATTERNS,
    LIMITS,
    tileKey,
    samePixel,
    closePixel,
    diffTile,
    restorePatch,
    applyTilePatch,
    packPatch,
    unpackPatch,
    stable,
    equal,
    diffObjects,
    applyObjectOp,
    applyOrder,
    validateOp,
    validateChange,
  });
});
