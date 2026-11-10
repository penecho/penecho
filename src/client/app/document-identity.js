var canvasDocumentIdentity = (() => {
  const LOCATIONS = new Set(["device", "server", "cloud"]);
  const MAX_ID_LENGTH = 128;
  const MAX_SCOPE_LENGTH = 256;
  const MAX_TITLE_LENGTH = 120;
  const MAX_CONTEXT_LENGTH = 16_000;
  const MAX_BINDINGS = 64;
  const MAX_CLIENT_LENGTH = 120;
  const MAX_LOCATORS = 16;
  const MAX_PATH_LENGTH = 512;
  const MAX_WORKSPACE_SESSIONS = 64;
  const MAX_WORKSPACE_FEEDBACK = 200;
  const MAX_WORKSPACE_CHANGES = 200;
  const MAX_WORKSPACE_MESSAGES = 100;
  const MAX_WORKSPACE_ARTIFACTS = 128;
  const MAX_WORKSPACE_ELEMENTS = 128;
  const MAX_WORKSPACE_SOURCE_LENGTH = 4_000;
  const MAX_WORKSPACE_MESSAGE_LENGTH = 16_000;
  const MAX_WORKSPACE_STEPS = 24;
  const MAX_WORKSPACE_EVENTS = 40;
  const MAX_WORKSPACE_ACTION_LENGTH = 128;
  const MAX_PRESENTATION_RELATIVE_TO_LENGTH = 128;
  const PRESENTATION_INTENTS = new Set(["explain", "deliver", "compare", "review", "inspect"]);
  const PRESENTATION_ROLES = new Set(["primary", "supporting", "alternative"]);
  const PRESENTATION_SIZES = new Set(["base", "wide", "tall", "large", "page"]);
  const PRESENTATION_RELATIONS = new Set(["below", "beside"]);
  const PRESENTATION_ATTENTION = new Set(["quiet", "normal", "request"]);
  const SESSION_STATUSES = new Set(["working", "waiting", "done", "error"]);
  const STEP_STATUSES = new Set(["pending", "working", "done", "error"]);
  const EVENT_KINDS = new Set(["progress", "evidence", "info", "warning", "error"]);
  const MESSAGE_STATUSES = new Set(["queued", "received", "working", "done", "error", "cancelled"]);
  const MISSING = {};
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function hasOwn(value, key) {
    return value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, key);
  }

  function ownValue(value, key) {
    if (!hasOwn(value, key)) return MISSING;
    try {
      return value[key];
    } catch {
      return MISSING;
    }
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function containsControl(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x1f || code >= 0x7f && code <= 0x9f) return true;
    }
    return false;
  }

  function boundedString(value, min, max, controls = true) {
    return typeof value === "string"
      && value.length >= min
      && value.length <= max
      && (!controls || !containsControl(value));
  }

  function validId(value) {
    return boundedString(value, 1, MAX_ID_LENGTH);
  }

  function normalizeLocator(value) {
    if (!isRecord(value)) return null;
    const location = ownValue(value, "location");
    const id = ownValue(value, "id");
    if (location === MISSING || id === MISSING || !LOCATIONS.has(location) || !validId(id)) return null;
    const normalized = { location, id };
    const scope = ownValue(value, "scope");
    if (scope !== MISSING) {
      if (!boundedString(scope, 1, MAX_SCOPE_LENGTH)) return null;
      normalized.scope = scope;
    }
    return normalized;
  }

  function invalidLocatorError() {
    const error = Error("Invalid document locator.");
    error.code = "INVALID_LOCATOR";
    return error;
  }

  function locatorKey(value) {
    const locator = normalizeLocator(value);
    if (!locator) throw invalidLocatorError();
    return JSON.stringify({
      location: locator.location,
      scope: hasOwn(locator, "scope") ? locator.scope : "",
      id: locator.id,
    });
  }

  function utf8Bytes(value) {
    const root = typeof globalThis === "undefined" ? null : globalThis;
    if (root && typeof root.TextEncoder === "function") return new root.TextEncoder().encode(value);

    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
      let code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 < value.length) {
          const next = value.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
            index += 1;
          } else {
            code = 0xfffd;
          }
        } else {
          code = 0xfffd;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = 0xfffd;
      }
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
      else if (code <= 0xffff) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
      else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
    }
    return new Uint8Array(bytes);
  }

  function bytesToHex(value) {
    const bytes = new Uint8Array(value);
    let output = "";
    for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
    return output;
  }

  function rotateRight(value, bits) {
    return value >>> bits | value << (32 - bits);
  }

  function sha256Bytes(input) {
    const messageLength = input.length;
    const paddedLength = Math.ceil((messageLength + 9) / 64) * 64;
    const message = new Uint8Array(paddedLength);
    message.set(input);
    message[messageLength] = 0x80;
    const bitLength = messageLength * 8;
    const highLength = Math.floor(bitLength / 0x100000000);
    const lowLength = bitLength >>> 0;
    const lengthOffset = paddedLength - 8;
    message[lengthOffset] = highLength >>> 24;
    message[lengthOffset + 1] = highLength >>> 16;
    message[lengthOffset + 2] = highLength >>> 8;
    message[lengthOffset + 3] = highLength;
    message[lengthOffset + 4] = lowLength >>> 24;
    message[lengthOffset + 5] = lowLength >>> 16;
    message[lengthOffset + 6] = lowLength >>> 8;
    message[lengthOffset + 7] = lowLength;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const wordOffset = offset + index * 4;
        words[index] = (
          message[wordOffset] << 24
          | message[wordOffset + 1] << 16
          | message[wordOffset + 2] << 8
          | message[wordOffset + 3]
        ) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const word15 = words[index - 15];
        const word2 = words[index - 2];
        const smallSigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ word15 >>> 3;
        const smallSigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ word2 >>> 10;
        words[index] = (words[index - 16] + smallSigma0 + words[index - 7] + smallSigma1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let index = 0; index < 64; index += 1) {
        const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = e & f ^ ~e & g;
        const temporary1 = (h + bigSigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
        const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const temporary2 = (bigSigma0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const digest = new Uint8Array(32);
    const wordsToWrite = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let index = 0; index < wordsToWrite.length; index += 1) {
      const word = wordsToWrite[index];
      const offset = index * 4;
      digest[offset] = word >>> 24;
      digest[offset + 1] = word >>> 16;
      digest[offset + 2] = word >>> 8;
      digest[offset + 3] = word;
    }
    return digest;
  }

  // Content IDs must be identical in HTTPS and local/LAN HTTP contexts.
  async function sha256Hex(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const subtle = globalThis.crypto?.subtle;
    if (subtle && typeof subtle.digest === "function") {
      try {
        return bytesToHex(await subtle.digest("SHA-256", bytes));
      } catch {
        // Local/LAN clients can use the same SHA-256 without Web Crypto.
      }
    }
    return bytesToHex(sha256Bytes(bytes));
  }

  async function legacyId(locator) {
    return `legacy-${await sha256Hex(utf8Bytes(locatorKey(locator)))}`;
  }

  function boundedText(value, max) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  function normalizeBindings(value, documentId) {
    if (!Array.isArray(value)) return [];
    const bindings = [];
    const byKey = new Map();
    const limit = Math.min(value.length, MAX_BINDINGS);
    for (let index = 0; index < limit; index += 1) {
      if (!hasOwn(value, index)) continue;
      let entry;
      try {
        entry = value[index];
      } catch {
        continue;
      }
      if (!isRecord(entry)) continue;
      const key = ownValue(entry, "key");
      const client = ownValue(entry, "client");
      const entryDocumentId = ownValue(entry, "documentId");
      if (key === MISSING || client === MISSING || entryDocumentId === MISSING
        || !validId(key) || !boundedString(client, 1, MAX_CLIENT_LENGTH) || entryDocumentId !== documentId) continue;
      if (byKey.has(key)) {
        if (byKey.get(key) !== client) return null;
        continue;
      }
      byKey.set(key, client);
      bindings.push({ key, client, documentId });
    }
    return bindings;
  }

  function normalizeLocators(value) {
    if (!Array.isArray(value)) return [];
    const locators = [];
    const keys = new Set();
    const limit = Math.min(value.length, MAX_LOCATORS);
    for (let index = 0; index < limit; index += 1) {
      if (!hasOwn(value, index)) continue;
      let rawLocator;
      try {
        rawLocator = value[index];
      } catch {
        continue;
      }
      const locator = normalizeLocator(rawLocator);
      if (!locator) continue;
      const key = locatorKey(locator);
      if (keys.has(key)) continue;
      keys.add(key);
      locators.push(locator);
    }
    return locators;
  }

  function normalizeProcessor(value) {
    if (!isRecord(value)) return { kind: "penecho" };
    const kind = ownValue(value, "kind");
    if (kind !== "external") return { kind: "penecho" };
    const bindingKey = ownValue(value, "bindingKey");
    const client = ownValue(value, "client");
    if (bindingKey !== MISSING && client !== MISSING && validId(bindingKey) && boundedString(client, 1, MAX_CLIENT_LENGTH)) {
      return { kind: "external", bindingKey, client };
    }
    return { kind: "penecho" };
  }

  function normalizeMetadata(value) {
    if (!isRecord(value)) return null;
    const version = ownValue(value, "version");
    const documentId = ownValue(value, "documentId");
    if (version !== 1 || documentId === MISSING || !validId(documentId)) return null;
    const bindings = normalizeBindings(ownValue(value, "bindings"), documentId);
    if (bindings === null) return null;
    return {
      version: 1,
      documentId,
      title: boundedText(ownValue(value, "title"), MAX_TITLE_LENGTH),
      context: boundedText(ownValue(value, "context"), MAX_CONTEXT_LENGTH),
      bindings,
      locators: normalizeLocators(ownValue(value, "locators")),
      processor: normalizeProcessor(ownValue(value, "processor")),
    };
  }

  function safeSequence(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function safeTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function normalizeBounds(value) {
    if (!isRecord(value)) return null;
    const x = ownValue(value, "x");
    const y = ownValue(value, "y");
    const w = ownValue(value, "w");
    const h = ownValue(value, "h");
    if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(w) || !finiteNumber(h)
      || x < 0 || y < 0 || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function normalizePoint(value) {
    if (!isRecord(value)) return null;
    const x = ownValue(value, "x");
    const y = ownValue(value, "y");
    if (!finiteNumber(x) || !finiteNumber(y)) return null;
    return { x, y };
  }

  function optionalBoundedText(value, max) {
    if (value === MISSING) return MISSING;
    return boundedString(value, 0, max) ? value : MISSING;
  }

  function arrayTail(value, limit) {
    if (!Array.isArray(value)) return [];
    const start = Math.max(0, value.length - limit);
    const output = [];
    for (let index = start; index < value.length; index += 1) {
      if (!hasOwn(value, index)) continue;
      try {
        output.push(value[index]);
      } catch {
        // An accessor in untrusted persisted data is treated as a malformed entry.
      }
    }
    return output;
  }

  function arrayHead(value, limit) {
    if (!Array.isArray(value)) return [];
    const output = [];
    for (let index = 0; index < Math.min(value.length, limit); index += 1) {
      if (!hasOwn(value, index)) continue;
      try {
        output.push(value[index]);
      } catch {
        // An accessor in untrusted persisted data is treated as a malformed entry.
      }
    }
    return output;
  }

  function mapPairs(value, limit) {
    const output = [];
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, limit); index += 1) {
        if (!hasOwn(value, index)) continue;
        let pair;
        try {
          pair = value[index];
        } catch {
          continue;
        }
        if (Array.isArray(pair)) {
          output.push(pair);
        }
      }
      return output;
    }
    if (!isRecord(value)) return output;
    let keys;
    try {
      keys = Object.keys(value).slice(0, limit);
    } catch {
      return output;
    }
    for (const key of keys) {
      const item = ownValue(value, key);
      if (item !== MISSING) output.push([key, item]);
    }
    return output;
  }

  function normalizeLayout(value) {
    if (!isRecord(value)) return null;
    const zone = normalizeBounds(ownValue(value, "zone"));
    if (!zone) return null;
    const x = ownValue(value, "x");
    const y = ownValue(value, "y");
    const rowHeight = ownValue(value, "rowHeight");
    if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(rowHeight) || x < 0 || y < 0 || rowHeight < 0) return null;
    return { zone, x, y, rowHeight };
  }

  function normalizeSteps(value) {
    const steps = [];
    for (const raw of arrayTail(value, MAX_WORKSPACE_STEPS)) {
      if (!isRecord(raw)) continue;
      const id = ownValue(raw, "id");
      const label = ownValue(raw, "label");
      if (!validId(id) || !boundedString(label, 1, 160)) continue;
      const step = { id, label };
      const status = ownValue(raw, "status");
      if (status !== MISSING && STEP_STATUSES.has(status)) step.status = status;
      steps.push(step);
    }
    return steps;
  }

  function normalizeEvents(value) {
    const events = [];
    for (const raw of arrayTail(value, MAX_WORKSPACE_EVENTS)) {
      if (!isRecord(raw)) continue;
      const id = ownValue(raw, "id");
      const text = ownValue(raw, "text");
      if (!validId(id) || !boundedString(text, 1, MAX_WORKSPACE_SOURCE_LENGTH)) continue;
      const event = { id, text };
      const kind = ownValue(raw, "kind");
      if (kind !== MISSING && EVENT_KINDS.has(kind)) event.kind = kind;
      events.push(event);
    }
    return events;
  }

  function normalizeElements(value) {
    const elements = [];
    const seen = new Set();
    for (const pair of mapPairs(value, MAX_WORKSPACE_ELEMENTS)) {
      if (pair.length < 2) continue;
      const elementId = pair[0];
      const raw = pair[1];
      if (!validId(elementId) || seen.has(elementId) || !isRecord(raw)) continue;
      const objectId = ownValue(raw, "objectId");
      if (!validId(objectId)) continue;
      const element = { objectId };
      const kind = optionalBoundedText(ownValue(raw, "kind"), MAX_ID_LENGTH);
      if (kind !== MISSING && kind.length > 0) element.kind = kind;
      const source = optionalBoundedText(ownValue(raw, "source"), MAX_WORKSPACE_SOURCE_LENGTH);
      if (source !== MISSING) element.source = source;
      seen.add(elementId);
      elements.push([elementId, element]);
    }
    return elements;
  }

  function normalizePresentation(value) {
    if (!isRecord(value)) return null;
    const intent = ownValue(value, "intent");
    if (intent === "inspect") return null;
    const presentation = {};
    if (intent !== MISSING && PRESENTATION_INTENTS.has(intent)) presentation.intent = intent;
    const role = ownValue(value, "role");
    if (role !== MISSING && PRESENTATION_ROLES.has(role)) presentation.role = role;
    const size = ownValue(value, "size");
    if (size !== MISSING && PRESENTATION_SIZES.has(size)) presentation.size = size;
    const relativeTo = ownValue(value, "relativeTo");
    if (relativeTo !== MISSING && boundedString(relativeTo, 1, MAX_PRESENTATION_RELATIVE_TO_LENGTH)) {
      presentation.relativeTo = relativeTo;
    }
    const relation = ownValue(value, "relation");
    if (relation !== MISSING && PRESENTATION_RELATIONS.has(relation)) presentation.relation = relation;
    const attention = ownValue(value, "attention");
    if (attention !== MISSING && PRESENTATION_ATTENTION.has(attention)) presentation.attention = attention;
    return Object.keys(presentation).length > 0 ? presentation : null;
  }

  function normalizeArtifact(value) {
    if (!isRecord(value)) return null;
    const artifact = {};
    const kind = optionalBoundedText(ownValue(value, "kind"), MAX_ID_LENGTH);
    if (kind !== MISSING && kind.length > 0) artifact.kind = kind;
    const title = optionalBoundedText(ownValue(value, "title"), MAX_TITLE_LENGTH);
    if (title !== MISSING) artifact.title = title;
    const objectId = ownValue(value, "objectId");
    if (objectId !== MISSING && validId(objectId)) artifact.objectId = objectId;
    const objectIdsValue = ownValue(value, "objectIds");
    const objectIds = [];
    const seen = new Set();
    if (Array.isArray(objectIdsValue)) {
      for (const rawObjectId of arrayHead(objectIdsValue, MAX_WORKSPACE_ELEMENTS)) {
        if (!validId(rawObjectId) || seen.has(rawObjectId)) continue;
        seen.add(rawObjectId);
        objectIds.push(rawObjectId);
      }
    }
    if (objectIds.length > 0) artifact.objectIds = objectIds;
    if (!artifact.objectId && objectIds.length > 0) artifact.objectId = objectIds[0];
    if (!artifact.objectId && !artifact.objectIds) return null;
    const origin = normalizePoint(ownValue(value, "origin"));
    if (origin) artifact.origin = origin;
    const worldPerPixel = ownValue(value, "worldPerPixel");
    if (typeof worldPerPixel === "number" && Number.isFinite(worldPerPixel) && worldPerPixel >= .5 && worldPerPixel <= 1 / .03) artifact.worldPerPixel = worldPerPixel;
    const elements = normalizeElements(ownValue(value, "elements"));
    if (elements.length > 0) artifact.elements = elements;
    const presentation = normalizePresentation(ownValue(value, "presentation"));
    if (presentation) artifact.presentation = presentation;
    return artifact;
  }

  function normalizeArtifacts(value) {
    const artifacts = [];
    const seen = new Set();
    for (const pair of mapPairs(value, MAX_WORKSPACE_ARTIFACTS)) {
      if (pair.length < 2) continue;
      const artifactId = pair[0];
      if (!validId(artifactId) || seen.has(artifactId)) continue;
      const artifact = normalizeArtifact(pair[1]);
      if (!artifact) continue;
      seen.add(artifactId);
      artifacts.push([artifactId, artifact]);
    }
    return artifacts;
  }

  function bindingMatches(value, metadataBindings, documentId, bindingField) {
    if (!isRecord(value)) return false;
    const bindingKey = ownValue(value, bindingField);
    const client = ownValue(value, "client");
    if (!validId(bindingKey) || !boundedString(client, 1, MAX_CLIENT_LENGTH)) return false;
    if (!metadataBindings.has(bindingKey) || metadataBindings.get(bindingKey) !== client) return false;
    const entryDocumentId = ownValue(value, "documentId");
    return entryDocumentId === MISSING || entryDocumentId === documentId;
  }

  function normalizeSession(value, metadataBindings, documentId) {
    if (!bindingMatches(value, metadataBindings, documentId, "sessionKey")) return null;
    const sessionKey = ownValue(value, "sessionKey");
    const client = ownValue(value, "client");
    const title = optionalBoundedText(ownValue(value, "title"), MAX_TITLE_LENGTH);
    const summary = optionalBoundedText(ownValue(value, "summary"), MAX_WORKSPACE_SOURCE_LENGTH);
    const status = ownValue(value, "status");
    const feedbackStart = ownValue(value, "feedbackStart");
    const session = {
      sessionKey,
      client,
      title: title === MISSING ? "" : title,
      status: SESSION_STATUSES.has(status) ? status : "working",
      summary: summary === MISSING ? "" : summary,
      steps: normalizeSteps(ownValue(value, "steps")),
      events: normalizeEvents(ownValue(value, "events")),
      artifacts: normalizeArtifacts(ownValue(value, "artifacts")),
      feedbackStart: safeSequence(feedbackStart),
    };
    const boardObjectId = ownValue(value, "boardObjectId");
    if (boardObjectId === null) session.boardObjectId = null;
    else if (boardObjectId !== MISSING && validId(boardObjectId)) session.boardObjectId = boardObjectId;
    const layout = normalizeLayout(ownValue(value, "layout"));
    if (layout) session.layout = layout;
    return session;
  }

  function normalizeFeedbackEntry(value) {
    if (!isRecord(value)) return null;
    const cursor = safeTimestamp(ownValue(value, "cursor"));
    const kind = ownValue(value, "kind");
    const createdAt = safeTimestamp(ownValue(value, "createdAt"));
    if (cursor === null || createdAt === null || !boundedString(kind, 1, MAX_ID_LENGTH)) return null;
    const entry = { cursor, kind };
    const objectId = ownValue(value, "objectId");
    if (objectId !== MISSING && objectId !== null && validId(objectId)) entry.objectId = objectId;
    const bounds = normalizeBounds(ownValue(value, "bounds"));
    if (bounds) entry.bounds = bounds;
    const text = optionalBoundedText(ownValue(value, "text"), MAX_WORKSPACE_SOURCE_LENGTH);
    if (text !== MISSING) entry.text = text;
    entry.createdAt = createdAt;
    return entry;
  }

  function normalizeFeedback(value) {
    const feedback = [];
    for (const raw of arrayTail(value, MAX_WORKSPACE_FEEDBACK)) {
      const entry = normalizeFeedbackEntry(raw);
      if (entry) feedback.push(entry);
    }
    return feedback;
  }

  function normalizeChangeEntry(value) {
    if (!isRecord(value)) return null;
    const cursor = safeTimestamp(ownValue(value, "cursor"));
    const kind = ownValue(value, "kind");
    const createdAtValue = ownValue(value, "createdAt");
    const legacyAt = ownValue(value, "at");
    const createdAt = safeTimestamp(createdAtValue === MISSING ? legacyAt : createdAtValue);
    if (cursor === null || createdAt === null || !boundedString(kind, 1, MAX_ID_LENGTH)) return null;
    const entry = { cursor, kind };
    const objectId = ownValue(value, "objectId");
    if (objectId !== MISSING && objectId !== null && validId(objectId)) entry.objectId = objectId;
    const bounds = normalizeBounds(ownValue(value, "bounds"));
    if (bounds) entry.bounds = bounds;
    const text = optionalBoundedText(ownValue(value, "text"), MAX_WORKSPACE_SOURCE_LENGTH);
    if (text !== MISSING) entry.text = text;
    entry.createdAt = createdAt;
    return entry;
  }

  function normalizeChanges(value) {
    const changes = [];
    for (const raw of arrayTail(value, MAX_WORKSPACE_CHANGES)) {
      const entry = normalizeChangeEntry(raw);
      if (entry) changes.push(entry);
    }
    return changes;
  }

  function normalizeObjectIds(value) {
    if (!Array.isArray(value)) return [];
    const objectIds = [];
    const seen = new Set();
    for (const objectId of arrayHead(value, MAX_WORKSPACE_ELEMENTS)) {
      if (!validId(objectId) || seen.has(objectId)) continue;
      seen.add(objectId);
      objectIds.push(objectId);
    }
    return objectIds;
  }

  function normalizeMessage(value, metadataBindings, documentId) {
    if (!bindingMatches(value, metadataBindings, documentId, "bindingKey")) return null;
    const id = ownValue(value, "id");
    const cursor = safeTimestamp(ownValue(value, "cursor"));
    const text = ownValue(value, "text");
    const createdAt = safeTimestamp(ownValue(value, "createdAt"));
    if (!validId(id) || cursor === null || createdAt === null || !boundedString(text, 1, MAX_WORKSPACE_MESSAGE_LENGTH)) return null;
    const bindingKey = ownValue(value, "bindingKey");
    const client = ownValue(value, "client");
    const message = {
      id,
      cursor,
      bindingKey,
      client,
      text,
      objectIds: normalizeObjectIds(ownValue(value, "objectIds")),
      createdAt,
    };
    const region = normalizeBounds(ownValue(value, "region"));
    if (region) message.region = region;
    const status = ownValue(value, "status");
    message.status = MESSAGE_STATUSES.has(status) ? status : "queued";
    const source = optionalBoundedText(ownValue(value, "source"), MAX_WORKSPACE_SOURCE_LENGTH);
    if (source !== MISSING) message.source = source;
    const action = optionalBoundedText(ownValue(value, "action"), MAX_WORKSPACE_ACTION_LENGTH);
    if (action !== MISSING) message.action = action;
    const detail = optionalBoundedText(ownValue(value, "detail"), MAX_WORKSPACE_SOURCE_LENGTH);
    if (detail !== MISSING) message.detail = detail;
    return message;
  }

  function normalizeWorkspace(value, metadata) {
    if (!isRecord(value) || ownValue(value, "version") !== 1) return null;
    const normalizedMetadata = normalizeMetadata(metadata);
    const documentId = normalizedMetadata ? normalizedMetadata.documentId : null;
    const metadataBindings = new Map(normalizedMetadata ? normalizedMetadata.bindings.map((binding) => [binding.key, binding.client]) : []);
    const sessions = [];
    const sessionPositions = new Map();
    for (const raw of arrayTail(ownValue(value, "sessions"), MAX_WORKSPACE_SESSIONS)) {
      const session = documentId ? normalizeSession(raw, metadataBindings, documentId) : null;
      if (!session) continue;
      const key = JSON.stringify([session.sessionKey, session.client]);
      const previous = sessionPositions.get(key);
      if (previous !== undefined) sessions[previous] = null;
      sessionPositions.set(key, sessions.length);
      sessions.push(session);
    }
    const deduplicatedSessions = sessions.filter(Boolean);
    // Internal state is a bounded restoration cache, not external MCP authority.
    const internalByKey = new Map();
    for (const raw of arrayTail(ownValue(value, "internalSessions"), MAX_WORKSPACE_SESSIONS)) {
      const key = ownValue(raw, "sessionKey");
      if (typeof key !== "string" || !/^agent-[a-f0-9]{64}$/.test(key) || ownValue(raw,"client") !== "PenEcho Agent") continue;
      const session = documentId ? normalizeSession(raw,new Map([[key,"PenEcho Agent"]]),documentId) : null;
      if(session)internalByKey.set(key,session);
    }
    const internalSessions = [...internalByKey.values()];
    for(const session of internalSessions)if(!metadataBindings.has(session.sessionKey))metadataBindings.set(session.sessionKey,session.client);
    const messages = [];
    const messagePositions = new Map();
    for (const raw of arrayTail(ownValue(value, "messages"), MAX_WORKSPACE_MESSAGES)) {
      const message = documentId ? normalizeMessage(raw, metadataBindings, documentId) : null;
      if (!message) continue;
      const keys = [JSON.stringify(["id", message.id]), JSON.stringify(["cursor", message.cursor])];
      const previous = new Set(keys.map((key) => messagePositions.get(key)).filter((position) => position !== undefined));
      if (previous.size > 0) {
        for (const position of previous) messages[position] = null;
        const survivors = messages.filter(Boolean);
        messagePositions.clear();
        survivors.forEach((item, position) => {
          messagePositions.set(JSON.stringify(["id", item.id]), position);
          messagePositions.set(JSON.stringify(["cursor", item.cursor]), position);
        });
        messages.length = 0;
        messages.push(...survivors);
      }
      messagePositions.set(keys[0], messages.length);
      messagePositions.set(keys[1], messages.length);
      messages.push(message);
    }
    const deduplicatedMessages = messages.filter(Boolean);
    const feedback = normalizeFeedback(ownValue(value, "feedback"));
    const changes = normalizeChanges(ownValue(value, "changes"));
    return {
      version: 1,
      sessions: deduplicatedSessions,
      ...(internalSessions.length ? {internalSessions} : {}),
      feedback,
      feedbackSequence: Math.max(safeSequence(ownValue(value, "feedbackSequence")), ...feedback.map((entry) => entry.cursor), 0),
      messages: deduplicatedMessages,
      messageSequence: Math.max(safeSequence(ownValue(value, "messageSequence")), ...deduplicatedMessages.map((entry) => entry.cursor), 0),
      changes,
      changeSequence: Math.max(safeSequence(ownValue(value, "changeSequence")), ...changes.map((entry) => entry.cursor), 0),
    };
  }

  function entries(value) {
    if (Array.isArray(value)) return value;
    return isRecord(value) ? [value] : [];
  }

  function identityEntry(reference) {
    if (!isRecord(reference)) return null;
    const documentId = ownValue(reference, "documentId");
    if (documentId === MISSING || !validId(documentId)) return null;
    const rawLocator = ownValue(reference, "locator");
    if (rawLocator === MISSING) return { reference, documentId, locator: null, locatorKey: "", pairKey: JSON.stringify([documentId, ""]) };
    const locator = normalizeLocator(rawLocator);
    if (!locator) return null;
    const key = locatorKey(locator);
    return { reference, documentId, locator, locatorKey: key, pairKey: JSON.stringify([documentId, key]) };
  }

  function uniqueEntries(value) {
    const unique = [];
    const seen = new Set();
    const list = entries(value);
    for (let index = 0; index < list.length; index += 1) {
      if (Array.isArray(value) && !hasOwn(value, index)) continue;
      let reference;
      try {
        reference = list[index];
      } catch {
        continue;
      }
      const entry = identityEntry(reference);
      if (!entry || seen.has(entry.pairKey)) continue;
      seen.add(entry.pairKey);
      unique.push(entry);
    }
    return unique;
  }

  function resolveCandidates(value) {
    const options = isRecord(value) ? value : {};
    const rawDocumentId = ownValue(options, "documentId");
    const documentIdProvided = rawDocumentId !== MISSING && rawDocumentId !== undefined;
    const documentIdValid = !documentIdProvided || validId(rawDocumentId);
    const documentId = documentIdValid && documentIdProvided ? rawDocumentId : null;
    const rawLocator = ownValue(options, "locator");
    const locatorProvided = rawLocator !== MISSING && rawLocator !== undefined;
    const locator = locatorProvided ? normalizeLocator(rawLocator) : null;
    const locatorValid = !locatorProvided || !!locator;
    const targetProvided = documentIdProvided || locatorProvided;
    const targetValid = targetProvided && documentIdValid && locatorValid;
    const active = uniqueEntries(ownValue(options, "active"));
    const candidates = uniqueEntries(ownValue(options, "candidates"));
    const rawProviders = ownValue(options, "providers");
    const providers = Array.isArray(rawProviders) ? rawProviders.slice() : [];
    const hasUnavailableProvider = providers.some((provider) => !provider || provider.status !== "ok");
    const requestedLocatorKey = locatorProvided && locator ? locatorKey(locator) : "";

    const matches = (entry) => targetValid
      && (documentIdProvided ? entry.documentId === documentId : true)
      && (locatorProvided ? entry.locatorKey === requestedLocatorKey : true);
    const activeMatches = active.filter((entry) => targetValid && (
      documentIdProvided && entry.documentId === documentId
      || locatorProvided && entry.locatorKey === requestedLocatorKey
    ));
    const candidateMatches = candidates.filter(matches);

    let locatorConflict = false;
    if (targetValid && documentIdProvided && locatorProvided) {
      const located = [...active, ...candidates].filter((entry) => entry.locatorKey === requestedLocatorKey);
      locatorConflict = located.some((entry) => entry.documentId !== documentId)
        && !located.some((entry) => entry.documentId === documentId);
    }

    if (locatorConflict) return { status: "conflict", providers, retryable: false };
    if (activeMatches.length === 1) return { status: "found", candidate: activeMatches[0].reference, providers };
    if (activeMatches.length > 1) return { status: "ambiguous", candidates: activeMatches.map((entry) => entry.reference), providers };
    if (candidateMatches.length === 1) return { status: "found", candidate: candidateMatches[0].reference, providers };
    if (candidateMatches.length > 1) return { status: "ambiguous", candidates: candidateMatches.map((entry) => entry.reference), providers };
    if (hasUnavailableProvider) return { status: "unavailable", providers, retryable: true };
    return { status: "not_found", providers, retryable: false };
  }

  function invalidPathError() {
    const error = Error("Invalid virtual path.");
    error.code = "INVALID_PATH";
    return error;
  }

  function parsePath(value) {
    if (value === undefined || value === null || value === "") return [];
    if (typeof value !== "string" || value.length > MAX_PATH_LENGTH || containsControl(value)
      || value.includes("\\") || value.includes("?") || value.includes("#") || value.includes("//")) throw invalidPathError();
    const path = value[0] === "/" ? value.slice(1) : value;
    if (!path) return [];
    const segments = path.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw invalidPathError();
    return segments;
  }

  return {
    validId,
    normalizeLocator,
    locatorKey,
    legacyId,
    sha256Hex,
    normalizeMetadata,
    normalizeWorkspace,
    resolveCandidates,
    parsePath,
  };
})();
