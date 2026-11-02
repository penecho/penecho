  // Live Canvas: one Cloud Canvas that several people and agents edit at once.
  // Each committed change (one history entry) travels as exact pixel patches
  // and object field changes. Cloud orders all changes; every copy applies them
  // in that order, so strokes drawn in the same tile at the same time are all
  // kept. Saving stays separate and still writes Cloud revisions.
  const LIVE_OPS = typeof window === "object" ? window.PENECHO_LIVE_OPS : null;
  const LIVE_OBJECT_KINDS = ["widgets", "images", "textBoxes"];
  const LIVE_ID_RANGE = 1000000;
  const LIVE_PRESENCE_MS = 80;
  const LIVE_CURSOR_IDLE_MS = 15000;
  const LIVE_CHANGE_CHARS = 6000000;
  const LIVE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const liveCanvas = {
    target:null, socket:null, status:"off", role:null, you:null, slot:0, appliedSeq:0,
    pending:[], encoding:Promise.resolve(), receiving:Promise.resolve(), confirmed:new Map(),
    participants:new Map(), retries:0, retryTimer:0, epoch:0, presenceAt:0, lastFront:null,
    layer:null, blobKeys:new WeakMap(), blobCount:0, idRanges:null, readOnly:false,
    docLinks:new Map(), linkSeqs:new Map(), endedLinks:new Set(), adopting:null, expiresAt:null, expiry:null, audience:new Map(),
  };
  const liveCopy = (en, zh) => state.language === "zh" ? zh : en;
  function liveCanvasActive() { return Boolean(liveCanvas.target) && Boolean(LIVE_OPS); }
  function liveCanvasCanEdit() {
    return liveCanvasActive() && !liveCanvas.readOnly && liveCanvas.role !== "viewer" && window.PENECHO_CONFIG?.runtime !== "viewer";
  }
  // The live sequence a saved Canvas contains; the room replays later changes.
  function liveCanvasSequence(extensions) {
    const seq = Number(extensions?.penechoLive?.seq);
    return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
  }
  function liveCanvasSaveExtension() {
    const id = state.currentSnapshotId, target = liveCanvas.target;
    if (target?.canvas && target.canvas === id && liveCanvas.appliedSeq) return { penechoLive:{ version:1, seq:liveCanvas.appliedSeq } };
    // A Canvas collaborating by a link keeps the link and its place in that room.
    return target?.share && target.local ? { penechoLive:{ version:1, seq:liveCanvas.appliedSeq, link:target.share } } : {};
  }

  // ---------- Links started here ----------
  // Collaborating needs no account: this Canvas starts a link Canvas on Cloud
  // and stays joined to it. The link travels with the saved Canvas; the key
  // that ends it stays in this browser. Cloud clears an unsaved link Canvas 7
  // days after its last change; signing in and saving moves it to that Canvas.
  const LIVE_LINKS_KEY = "penecho-live-links-v1";
  function liveLinkKeys() {
    try {
      const value = JSON.parse(localStorage.getItem(LIVE_LINKS_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function liveLinkKeep(token, entry) {
    const all = liveLinkKeys();
    if (entry) all[token] = entry; else delete all[token];
    try { localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify(all)); } catch {}
  }
  function liveActiveDocumentId() { return typeof canvasDocuments === "object" ? canvasDocuments.activeId || null : null; }
  // The link this Canvas collaborates by: started here, or saved with it.
  function liveCanvasLink() {
    const docId = liveActiveDocumentId(), kept = liveLinkKeys();
    const token = liveCanvas.docLinks.get(docId) || state.currentSnapshotBundleExtensions?.penechoLive?.link
      || Object.keys(kept).find(key => docId && kept[key]?.docId === docId);
    if (!LIVE_UUID.test(String(token || "")) || liveCanvas.endedLinks.has(token)) return null;
    return { token, ...(kept[token] || {}), seq:Math.max(liveCanvas.linkSeqs.get(token) || 0, liveCanvasSequence(state.currentSnapshotBundleExtensions)) };
  }
  function liveLinkForget(token) {
    liveLinkKeep(token, null);
    for (const [docId, linked] of liveCanvas.docLinks) if (linked === token) liveCanvas.docLinks.delete(docId);
    liveCanvas.linkSeqs.delete(token);
  }
  function liveRequestHeaders(extra = {}) {
    // The local server needs this page's session, not an AI connection.
    if (!["cloud", "viewer"].includes(window.PENECHO_CONFIG?.runtime)) return typeof authenticatedApiHeaders === "function" ? authenticatedApiHeaders({ accept:"application/json", ...extra }) : { accept:"application/json", ...extra };
    const csrf = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("penecho_csrf="))?.slice("penecho_csrf=".length) || "";
    return { accept:"application/json", ...(csrf ? { "x-penecho-csrf":decodeURIComponent(csrf) } : {}), ...extra };
  }
  function liveLinkPath(suffix = "") { return `${["cloud", "viewer"].includes(window.PENECHO_CONFIG?.runtime) ? "/api/v1" : "/api/cloud"}/live/links${suffix}`; }
  async function liveLinkRequest(suffix, { method = "POST", body, ownerKey } = {}) {
    const response = await fetch(liveLinkPath(suffix), { method, credentials:"same-origin", cache:"no-store",
      headers:liveRequestHeaders({ ...(body === undefined ? {} : { "content-type":"application/json" }), ...(ownerKey ? { "x-penecho-owner-key":ownerKey } : {}) }),
      body:body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(payload.error_description || payload.message || payload.error || `HTTP ${response.status}`), { status:response.status });
    return payload;
  }
  // Starts collaborating on this Canvas by a new link, without an account.
  async function liveCanvasStartLink(title, bundle) {
    const started = await liveLinkRequest("", { body:{ title:String(title || "Canvas").slice(0, 160), bundle } });
    const publicUrl = started.publicUrl || new URL(started.url, location.origin).toString(), docId = liveActiveDocumentId();
    liveLinkKeep(started.token, { ownerKey:started.ownerKey, publicUrl, docId, startedAt:Date.now() });
    if (docId) liveCanvas.docLinks.set(docId, started.token);
    liveCanvas.expiresAt = started.expiresAt || null;
    liveCanvasStart({ share:started.token, local:true }, { have:0 });
    liveCanvasRenderExpiry();
    return { token:started.token, publicUrl, expiresAt:started.expiresAt };
  }
  // Ends this Canvas's link for everyone; the Canvas itself stays here.
  async function liveCanvasEndLink() {
    const link = liveCanvasLink();
    if (!link?.ownerKey) throw Error(liveCopy("Only the person who started this link can stop it.", "只有发起此链接的人可以停止它。"));
    if (liveCanvas.target?.share === link.token) liveCanvasStop();
    liveCanvas.endedLinks.add(link.token);
    try { await liveLinkRequest(`/${link.token}`, { method:"DELETE", ownerKey:link.ownerKey }); }
    catch (error) { if (error.status !== 404) { liveCanvas.endedLinks.delete(link.token); liveCanvasSyncTarget(); throw error; } }
    liveLinkForget(link.token);
    liveCanvasRenderExpiry();
  }
  // Saved to Cloud by the person who started its link: the link becomes that
  // Canvas's collaboration link, so everyone keeps working on it.
  async function liveCanvasAdopt(link, canvasId) {
    if (liveCanvas.adopting === link.token) return;
    liveCanvas.adopting = link.token;
    try {
      const adopted = await liveLinkRequest(`/${link.token}/adopt`, { body:{ canvasId }, ownerKey:link.ownerKey });
      const have = liveCanvas.target?.share === link.token ? liveCanvas.appliedSeq : link.seq;
      liveLinkForget(link.token);
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("penecho:collaboration-adopted", { detail:{ canvasId, collaboration:adopted.collaboration } }));
      liveCanvas.expiresAt = null;
      liveCanvasStart({ canvas:canvasId }, { have });
    } catch (error) {
      setStatus(liveCopy(`Collaboration continues on its link. ${error.message}`, `协作仍通过原链接继续。${error.message}`));
      liveCanvasStart({ share:link.token, local:true }, { have:link.seq });
    } finally {
      liveCanvas.adopting = null;
      liveCanvasRenderExpiry();
    }
  }

  // ---------- Encoding ----------
  function liveTilePixels(canvas) {
    return canvas ? canvas.getContext("2d", { willReadFrequently:true }).getImageData(0, 0, TILE, TILE).data : null;
  }
  async function liveDeflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function liveInflate(base64) {
    const binary = atob(base64), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function liveBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(binary);
  }
  function liveBlobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || Error("Image could not be read"));
      reader.readAsDataURL(blob);
    });
  }
  // Images compare by the identity of their bytes, not by their pixels.
  function liveBlobKey(blob, blobs) {
    if (!(blob instanceof Blob)) return "";
    let key = liveCanvas.blobKeys.get(blob);
    if (!key) liveCanvas.blobKeys.set(blob, key = `blob:${++liveCanvas.blobCount}`);
    blobs?.set(key, blob);
    return key;
  }
  function liveWireObject(kind, item, blobs = null) {
    if (!item) return null;
    if (kind === "images") {
      const { image, blob, src, ...rest } = item;
      return { ...rest, src:blob ? liveBlobKey(blob, blobs) : src || "" };
    }
    if (kind === "textBoxes") {
      const { image, ...rest } = item;
      return rest;
    }
    return item;
  }
  function liveWireList(kind, list, blobs) {
    return (Array.isArray(list) ? list : []).map(item => liveWireObject(kind, item, blobs));
  }
  function liveCurrentWire(kind, item) {
    if (!item) return null;
    if (kind === "widgets") return serializedWidgets().find(widget => widget.id === item.id) || null;
    if (kind === "images") return liveWireObject(kind, imageHistoryState().find(image => image.id === item.id));
    return liveWireObject(kind, textBoxHistoryRecord(item));
  }
  async function liveResolveSources(op, blobs) {
    if (op.t !== "obj" || op.k !== "images") return op;
    const resolve = async value => {
      if (!value || typeof value.src !== "string" || !value.src.startsWith("blob:")) return value;
      const blob = blobs?.get(value.src);
      return blob ? { ...value, src:await liveBlobDataUrl(blob) } : (({ src, ...rest }) => rest)(value);
    };
    const next = { ...op };
    if (op.put) next.put = await resolve(op.put);
    if (op.set) next.set = await resolve(op.set);
    // Each copy names image bytes differently; Undo checks only geometry.
    if (op.expect) next.expect = (({ src, ...rest }) => rest)(op.expect);
    return next;
  }

  // ---------- Object IDs ----------
  // Each participant creates objects in its own ID range, so new objects from
  // different people never collide. Existing IDs keep their numbers.
  function liveCanvasInstallIdRanges(slot) {
    liveCanvasRemoveIdRanges();
    const base = slot * LIVE_ID_RANGE, ranges = {};
    for (const [singular, kind] of [["Widget", "widgets"], ["Image", "images"], ["TextBox", "textBoxes"], ["Animation", "animations"]]) {
      const property = `next${singular}Id`, used = (state[kind] || []).map(item => Number(String(item.id).split("-").at(-1))).filter(id => id > base && id < base + LIVE_ID_RANGE);
      let value = Math.max(base + 1, ...used.map(id => id + 1));
      Object.defineProperty(state, property, { configurable:true, enumerable:true,
        get:() => value,
        set:next => { if (Number.isSafeInteger(next) && next > value && next < base + LIVE_ID_RANGE) value = next; } });
      ranges[property] = true;
    }
    liveCanvas.idRanges = ranges;
  }
  function liveCanvasRemoveIdRanges() {
    if (!liveCanvas.idRanges) return;
    for (const property of Object.keys(liveCanvas.idRanges)) {
      const kind = { nextWidgetId:"widgets", nextImageId:"images", nextTextBoxId:"textBoxes", nextAnimationId:"animations" }[property];
      const next = Math.max(1, ...(state[kind] || []).map(item => Number(String(item.id).split("-").at(-1)) + 1).filter(Number.isSafeInteger));
      Object.defineProperty(state, property, { configurable:true, enumerable:true, writable:true, value:next });
    }
    liveCanvas.idRanges = null;
  }

  // ---------- Capturing my changes ----------
  function liveIndexPatch(patch) {
    const lookup = new Int32Array(patch.w * patch.h).fill(-1);
    for (let bit = 0, n = 0; bit < patch.w * patch.h; bit++) if (patch.mask[bit >> 3] & (1 << (bit & 7))) lookup[bit] = n++;
    return lookup;
  }
  function liveRememberConfirmed(k, pixels) {
    if (!liveCanvas.confirmed.has(k)) liveCanvas.confirmed.set(k, pixels ? Uint8ClampedArray.from(pixels) : new Uint8ClampedArray(TILE * TILE * 4));
  }
  // Called once for every committed history entry while this Canvas is live.
  function liveCanvasCapture(entry) {
    if (!entry || entry.liveCaptured || !liveCanvasCanEdit()) return;
    entry.liveCaptured = true;
    const patches = new Map();
    for (const change of entry.tiles || []) {
      const before = liveTilePixels(change.before), patch = LIVE_OPS.diffTile(before, liveTilePixels(change.after));
      if (!patch) continue;
      patches.set(change.k, patch);
      liveRememberConfirmed(change.k, before);
    }
    entry.livePatches = patches;
    const ops = [], blobs = new Map();
    for (const kind of LIVE_OBJECT_KINDS) {
      const before = entry[`${kind}Before`], after = entry[`${kind}After`];
      if (before && after) ops.push(...LIVE_OPS.diffObjects(kind, liveWireList(kind, before, blobs), liveWireList(kind, after, blobs)));
    }
    const front = { frontKind:state.frontCanvasObjectKind, placedKind:state.frontPlacedCanvasObjectKind };
    if (liveCanvas.lastFront && (front.frontKind !== liveCanvas.lastFront.frontKind || front.placedKind !== liveCanvas.lastFront.placedKind)) ops.push({ t:"meta", set:front });
    liveCanvas.lastFront = front;
    if (patches.size || ops.length) liveCanvasQueue({ patches, ops, blobs });
  }
  // A Widget interaction extends its open history entry instead of adding one.
  function liveCanvasCaptureWidgets(before, after) {
    if (!liveCanvasCanEdit() || !before || !after) return;
    const ops = LIVE_OPS.diffObjects("widgets", before, after);
    if (ops.length) liveCanvasQueue({ patches:new Map(), ops, blobs:new Map() });
  }
  function liveChangeId() {
    return `${(liveCanvas.you?.id || "local").slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function liveCanvasQueue({ patches, ops, blobs }) {
    const change = { cid:liveChangeId(), patches, ops, blobs, wire:null, sent:null,
      lookups:new Map([...patches].map(([k, patch]) => [k, liveIndexPatch(patch)])) };
    liveCanvas.pending.push(change);
    liveCanvas.encoding = liveCanvas.encoding.then(() => liveCanvasEncode(change)).then(() => liveCanvasSend(change))
      .catch(error => debug("live-encode-failed", { error:String(error?.message || error).slice(0, 160) }));
    liveCanvasRenderPresence();
  }
  async function liveCanvasEncode(change) {
    const tiles = [];
    for (const [k, patch] of change.patches)
      tiles.push({ k, d:liveBase64(await liveDeflate(LIVE_OPS.packPatch({ x:patch.x, y:patch.y, w:patch.w, h:patch.h, mask:patch.mask, values:patch.values, ...(patch.expect ? { expect:patch.expect } : {}) }))) });
    const ops = [];
    for (let start = 0; start < tiles.length; start += LIVE_OPS.LIMITS.tilesPerOp) ops.push({ t:"ink", tiles:tiles.slice(start, start + LIVE_OPS.LIMITS.tilesPerOp) });
    for (const op of change.ops) ops.push(await liveResolveSources(op, change.blobs));
    change.wire = ops;
    change.blobs = null;
  }
  function liveCanvasSend(change) {
    const socket = liveCanvas.socket;
    if (!change.wire || socket?.readyState !== 1 || liveCanvas.status !== "live" || change.sent === socket) return;
    const text = JSON.stringify({ type:"change", cid:change.cid, ops:change.wire });
    if (text.length > LIVE_CHANGE_CHARS) {
      liveCanvas.pending.splice(liveCanvas.pending.indexOf(change), 1);
      setStatus(liveCopy("This change is too large to share live. Save the Canvas to keep it.", "此改动过大，无法实时同步。请保存画布以保留它。"));
      return;
    }
    change.sent = socket;
    socket.send(text);
  }

  // ---------- Applying changes ----------
  // The value my pending changes leave at one pixel, starting from `start`.
  function liveReplayPending(k, i, start, out) {
    out.set(start);
    const x = (i / 4) % TILE, y = Math.floor(i / 4 / TILE);
    for (const change of liveCanvas.pending) {
      const patch = change.patches.get(k);
      if (!patch || x < patch.x || y < patch.y || x >= patch.x + patch.w || y >= patch.y + patch.h) continue;
      const n = change.lookups.get(k)[(y - patch.y) * patch.w + x - patch.x];
      if (n < 0 || (patch.expect && !LIVE_OPS.closePixel(out, 0, patch.expect, n * 4))) continue;
      out.set(patch.values.subarray(n * 4, n * 4 + 4));
    }
    return out;
  }
  function liveSetPixel(target, i, value) {
    target[i] = value[0]; target[i + 1] = value[1]; target[i + 2] = value[2]; target[i + 3] = value[3];
  }
  // Someone else's ink lands in server order: underneath my unconfirmed changes
  // and around a stroke I am drawing right now.
  function liveApplyRemoteInk(k, patch) {
    const parsed = LIVE_OPS.tileKey(k);
    if (!parsed) return;
    const canvas = tile(parsed.tx, parsed.ty, true), context = canvas.getContext("2d", { willReadFrequently:true }),
      display = context.getImageData(0, 0, TILE, TILE), shown = display.data,
      open = state.historyBefore.has(k), beforeCanvas = open ? state.historyBefore.get(k) : null,
      before = open ? liveTilePixels(beforeCanvas) || new Uint8ClampedArray(TILE * TILE * 4) : null,
      confirmed = liveCanvas.confirmed.get(k), scratch = new Uint8ClampedArray(4);
    let changed = false;
    for (let row = 0, n = 0; row < patch.h; row++) for (let column = 0; column < patch.w; column++) {
      const bit = row * patch.w + column;
      if (!(patch.mask[bit >> 3] & (1 << (bit & 7)))) continue;
      const i = ((patch.y + row) * TILE + patch.x + column) * 4, j = n++ * 4, base = confirmed || before || shown;
      if (patch.expect && !LIVE_OPS.closePixel(base, i, patch.expect, j)) continue;
      const incoming = patch.values.subarray(j, j + 4);
      let value = incoming;
      if (confirmed) {
        liveSetPixel(confirmed, i, incoming);
        value = liveReplayPending(k, i, incoming, scratch);
      }
      if (before) {
        const drawnNow = !LIVE_OPS.samePixel(before, i, shown, i);
        liveSetPixel(before, i, value);
        if (drawnNow) continue;
      }
      liveSetPixel(shown, i, value);
      changed = true;
    }
    if (changed) context.putImageData(display, 0, 0);
    if (open) {
      const copy = beforeCanvas || offscreen(TILE, TILE);
      const beforeData = new ImageData(before, TILE, TILE);
      copy.getContext("2d").putImageData(beforeData, 0, 0);
      state.historyBefore.set(k, copy);
    }
    liveSettleTile(k, canvas, parsed);
  }
  function liveSettleTile(k, canvas, { tx, ty }) {
    invalidateSharpOverlays({ x:tx * TILE, y:ty * TILE, w:TILE, h:TILE });
    const ink = inkBox(canvas, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
    if (ink) state.inkBounds.set(k, ink);
    else if (!state.historyBefore.has(k)) {
      tiles.delete(k);
      state.inkBounds.delete(k);
    } else state.inkBounds.delete(k);
  }
  function liveApplyLocalInk(k, patch) {
    const parsed = LIVE_OPS.tileKey(k);
    if (!parsed) return;
    const canvas = tile(parsed.tx, parsed.ty, true), context = canvas.getContext("2d", { willReadFrequently:true }),
      display = context.getImageData(0, 0, TILE, TILE);
    if (liveCanvasCanEdit()) liveRememberConfirmed(k, display.data);
    if (LIVE_OPS.applyTilePatch(display.data, patch)) context.putImageData(display, 0, 0);
    liveSettleTile(k, canvas, parsed);
  }
  const LIVE_TRANSACTION_KEYS = { widgets:"widgetHistoryBefore", images:"imageHistoryBefore", textBoxes:"textBoxHistoryBefore" };
  const LIVE_GEOMETRY = new Set(["x", "y", "w", "h", "contentW", "contentH"]);
  // My unconfirmed object changes come after this one in server order.
  function liveWithoutPending(op) {
    const mine = liveCanvas.pending.flatMap(change => change.ops).filter(other => other.t === "obj" && other.k === op.k && other.id === op.id);
    if (!mine.length || op.del) return op;
    if (mine.some(other => other.del)) return null;
    const fields = new Set(mine.flatMap(other => [...Object.keys(other.set || {}), ...(other.unset || []), ...Object.keys(other.put || {})]));
    if (op.put) return op;
    const set = op.set && Object.fromEntries(Object.entries(op.set).filter(([field]) => !fields.has(field))),
      unset = op.unset?.filter(field => !fields.has(field));
    if (!(set && Object.keys(set).length) && !unset?.length) return null;
    return { ...op, ...(set && Object.keys(set).length ? { set } : { set:undefined }), ...(unset?.length ? { unset } : { unset:undefined }) };
  }
  async function liveCanvasPrepare(op) {
    if (op.t === "ink") return { op, tiles:await Promise.all(op.tiles.map(async item => ({ k:item.k, patch:LIVE_OPS.unpackPatch(await liveInflate(item.d)) }))) };
    if (op.t !== "obj" || op.del) return { op };
    const source = op.put || op.set || {};
    if (op.k === "images" && typeof source.src === "string" && source.src.startsWith("data:image/")) {
      const blob = dataUrlBlob(source.src);
      return { op, blob, image:await imageFromBlob(blob) };
    }
    if (op.k === "textBoxes" && (op.put || ["text", "fontSize", "fontFamily", "color", "maxWidth"].some(field => Object.hasOwn(source, field)))) {
      const current = state.textBoxes.find(item => item.id === op.id), next = LIVE_OPS.applyObjectOp(liveCurrentWire("textBoxes", current), op);
      const record = next ? await renderedTextBoxRecord(next, desiredCanvasTextRasterRatio()) : null;
      return { op, image:record?.image || null, rendered:next };
    }
    return { op };
  }
  function liveObjectRecord(kind, next, previous, prepared) {
    if (kind === "widgets") return widgetRecord(next);
    if (kind === "images") {
      const { src, ...fields } = next, blob = prepared?.blob || previous?.blob, image = prepared?.image || previous?.image;
      return blob && image ? imageRecord({ ...fields, blob, image }) : null;
    }
    const image = prepared?.image && LIVE_OPS.equal(prepared.rendered, next) ? prepared.image : previous?.image;
    if (!image) {
      void renderedTextBoxRecord(next, desiredCanvasTextRasterRatio()).then(record => {
        const item = state.textBoxes.find(box => box.id === next.id);
        if (record && item && LIVE_OPS.equal(liveCurrentWire("textBoxes", item), next)) { item.image = record.image; requestRender(); }
      }).catch(() => {});
      return null;
    }
    return { ...next, image };
  }
  function liveRemoveObject(kind, index) {
    const [item] = state[kind].splice(index, 1), singular = kind === "textBoxes" ? "TextBox" : kind === "widgets" ? "Widget" : "Image";
    if (kind === "widgets") unmountWidget(item);
    if (kind === "textBoxes") for (const editor of [...state.textEditors.values()]) if (editor.sourceTextBoxId === item.id) removeTextEditor(editor);
    clearHandToolbarTarget(kind === "textBoxes" ? "text-box" : kind.slice(0, -1), item.id);
    if (state[`selected${singular}Id`] === item.id) state[`selected${singular}Id`] = null;
    const edit = kind === "widgets" ? "widgetEdit" : kind === "images" ? "imageEdit" : null;
    if (edit && state[edit]?.id === item.id) state[edit] = null;
  }
  function livePatchTransaction(kind, op, prepared) {
    const list = state[LIVE_TRANSACTION_KEYS[kind]];
    if (!Array.isArray(list)) return;
    const index = list.findIndex(item => item.id === op.id), next = LIVE_OPS.applyObjectOp(liveWireObject(kind, list[index]), op);
    if (next === undefined) return;
    if (next === null) { list.splice(index, 1); return; }
    const previous = list[index], value = kind === "images" ? (({ src, ...fields }) => ({ ...fields, blob:prepared?.blob || previous?.blob, image:prepared?.image || previous?.image }))(next)
      : kind === "textBoxes" ? { ...next, image:prepared?.image || previous?.image } : next;
    if (index >= 0) list[index] = value;
    else list.push(value);
  }
  function liveCommitObject(op, prepared, { remote = true } = {}) {
    const kind = op.k, list = state[kind];
    if (!LIVE_OBJECT_KINDS.includes(kind) || !Array.isArray(list)) return false;
    const effective = remote ? liveWithoutPending(op) : op;
    if (!effective) return false;
    if (remote) livePatchTransaction(kind, effective, prepared);
    const index = list.findIndex(item => item.id === op.id), previous = index >= 0 ? list[index] : null,
      next = LIVE_OPS.applyObjectOp(liveCurrentWire(kind, previous), effective);
    if (next === undefined) return false;
    if (next === null) { liveRemoveObject(kind, index); return true; }
    // Geometry alone moves a Widget without reloading its frame.
    if (kind === "widgets" && previous && Object.keys(effective.set || {}).every(field => LIVE_GEOMETRY.has(field)) && !effective.unset && !effective.put) {
      for (const field of Object.keys(effective.set)) previous[field] = next[field];
      positionWidget(previous);
      return true;
    }
    const record = liveObjectRecord(kind, next, previous, prepared);
    if (!record) return false;
    if (kind === "widgets" && previous) unmountWidget(previous);
    if (index >= 0) list[index] = record;
    else list.push(record);
    if (kind === "widgets") {
      if (pluginEnabled(record.pluginId)) mountWidget(record);
      syncWidgetLayerOrder();
    }
    return true;
  }
  function liveCommitOrder(op) {
    const list = state[op.k];
    if (!LIVE_OBJECT_KINDS.includes(op.k) || !Array.isArray(list)) return;
    const byId = new Map(list.map(item => [item.id, item]));
    list.splice(0, list.length, ...LIVE_OPS.applyOrder(list.map(item => item.id), op.ids).map(id => byId.get(id)));
    if (op.k === "widgets") syncWidgetLayerOrder();
  }
  function liveCommit(prepared, options) {
    const { op } = prepared;
    if (op.t === "ink") for (const item of prepared.tiles) options.remote ? liveApplyRemoteInk(item.k, item.patch) : liveApplyLocalInk(item.k, item.patch);
    else if (op.t === "obj") liveCommitObject(op, prepared, options);
    else if (op.t === "order") liveCommitOrder(op);
    else if (op.t === "meta") {
      restoreCanvasObjectFrontKinds(op.set.frontKind || state.frontCanvasObjectKind, op.set.placedKind || state.frontPlacedCanvasObjectKind);
      liveCanvas.lastFront = { frontKind:state.frontCanvasObjectKind, placedKind:state.frontPlacedCanvasObjectKind };
    }
  }
  function liveDocumentChanged() {
    state.userRevision++;
    requestRender();
    window.PenEchoStudioNavigator?.updateDocument?.();
    if (typeof canvasDocumentsScheduleDraft === "function") canvasDocumentsScheduleDraft();
  }
  async function liveCanvasApplyChange(message) {
    if (message.seq <= liveCanvas.appliedSeq) return;
    if (message.seq !== liveCanvas.appliedSeq + 1) { liveCanvasReconnect(0); return; }
    // Decode everything first; the Canvas then changes in one step.
    const prepared = [];
    for (const op of Array.isArray(message.ops) ? message.ops : []) {
      try { prepared.push(await liveCanvasPrepare(op)); }
      catch (error) { debug("live-change-skipped", { error:String(error?.message || error).slice(0, 160) }); }
    }
    for (const item of prepared) {
      try { liveCommit(item, { remote:true }); }
      catch (error) { debug("live-change-skipped", { error:String(error?.message || error).slice(0, 160) }); }
    }
    liveCanvas.appliedSeq = message.seq;
    const person = message.by?.participantId && liveCanvas.participants.get(message.by.participantId);
    if (person) person.activeAt = Date.now();
    liveDocumentChanged();
  }
  function liveCanvasAck({ seq, cid }) {
    const index = liveCanvas.pending.findIndex(change => change.cid === cid);
    if (index >= 0) {
      const [change] = liveCanvas.pending.splice(index, 1);
      for (const [k, patch] of change.patches) {
        const confirmed = liveCanvas.confirmed.get(k);
        if (confirmed) LIVE_OPS.applyTilePatch(confirmed, patch);
        if (!liveCanvas.pending.some(other => other.patches.has(k))) liveCanvas.confirmed.delete(k);
      }
    }
    liveCanvas.appliedSeq = Math.max(liveCanvas.appliedSeq, Number(seq) || 0);
  }

  // ---------- Undo and Redo ----------
  // While live, Undo and Redo change only what this entry changed and nobody
  // changed since; the result is shared like any other change.
  // On a live Canvas, and for history made before a newer save was merged in,
  // Undo and Redo change only what still holds the change, so they never remove
  // what someone else added since.
  function liveCanvasApplyHistory(entry, side) {
    const live = liveCanvasCanEdit();
    if (!entry || Array.isArray(entry) || !(live || entry.rebased) || !LIVE_OPS) return null;
    const direction = side === "before" ? "undo" : "redo", patches = new Map();
    for (const change of entry.tiles || []) {
      let patch = entry.livePatches?.get(change.k);
      if (!patch) {
        patch = LIVE_OPS.diffTile(liveTilePixels(change.before), liveTilePixels(change.after));
        if (!patch) continue;
        (entry.livePatches ||= new Map()).set(change.k, patch);
      }
      const restore = LIVE_OPS.restorePatch(patch, direction);
      liveApplyLocalInk(change.k, restore);
      patches.set(change.k, restore);
    }
    const ops = [], blobs = new Map(), records = new Map();
    for (const kind of LIVE_OBJECT_KINDS) {
      const before = entry[`${kind}Before`], after = entry[`${kind}After`];
      if (!before || !after) continue;
      const [from, to] = side === "before" ? [after, before] : [before, after];
      for (const item of to) records.set(`${kind}:${item.id}`, item);
      ops.push(...LIVE_OPS.diffObjects(kind, liveWireList(kind, from, blobs), liveWireList(kind, to, blobs), { conditional:true }));
    }
    for (const op of ops) {
      if (op.t === "order") { liveCommitOrder(op); continue; }
      const record = records.get(`${op.k}:${op.id}`);
      liveCommitObject(op, record ? { blob:record.blob, image:record.image, rendered:liveWireObject(op.k, record) } : null, { remote:false });
    }
    if (live && (patches.size || ops.length)) liveCanvasQueue({ patches, ops, blobs });
    return { objects:null };
  }

  // ---------- Connection ----------
  function liveCanvasSocketUrl() {
    const target = liveCanvas.target, query = new URLSearchParams(target.canvas ? { canvas:target.canvas } : { share:target.share });
    // Local PenEcho reaches Cloud through its own server, which holds the account session.
    const path = window.PENECHO_CONFIG?.runtime === "cloud" || window.PENECHO_CONFIG?.runtime === "viewer" ? "/api/v1/live/socket" : "/api/cloud/live/socket";
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}?${query}`;
  }
  function liveCanvasStart(target, { have = 0 } = {}) {
    if (!LIVE_OPS || typeof WebSocket !== "function" || typeof CompressionStream !== "function") return false;
    if (target.canvas && liveCanvas.target?.canvas === target.canvas || target.share && liveCanvas.target?.share === target.share) return true;
    liveCanvasStop();
    Object.assign(liveCanvas, { target, appliedSeq:Math.max(0, Number(have) || 0), status:"connecting", retries:0, readOnly:false,
      lastFront:{ frontKind:state.frontCanvasObjectKind, placedKind:state.frontPlacedCanvasObjectKind } });
    liveCanvas.epoch++;
    liveCanvasConnect();
    return true;
  }
  function liveCanvasStop() {
    if (liveCanvas.target?.local) liveCanvas.linkSeqs.set(liveCanvas.target.share, liveCanvas.appliedSeq);
    liveCanvas.epoch++;
    clearTimeout(liveCanvas.retryTimer);
    try { liveCanvas.socket?.close(1000, "Canvas closed"); } catch {}
    Object.assign(liveCanvas, { target:null, socket:null, status:"off", role:null, you:null, slot:0, appliedSeq:0, pending:[], readOnly:false });
    liveCanvas.confirmed.clear();
    for (const person of liveCanvas.participants.values()) person.cursor?.remove();
    liveCanvas.participants.clear();
    liveCanvasRemoveIdRanges();
    liveCanvasRenderPresence();
  }
  function liveCanvasConnect() {
    const epoch = liveCanvas.epoch;
    let socket;
    try { socket = new WebSocket(liveCanvasSocketUrl()); }
    catch { liveCanvasReconnect(); return; }
    liveCanvas.socket = socket;
    socket.addEventListener("open", () => {
      if (epoch !== liveCanvas.epoch) return;
      socket.send(JSON.stringify({ type:"hello", have:liveCanvas.appliedSeq, ...(liveCanvas.slot ? { slot:liveCanvas.slot } : {}) }));
    });
    socket.addEventListener("message", event => {
      if (epoch !== liveCanvas.epoch) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      liveCanvas.receiving = liveCanvas.receiving.then(() => epoch === liveCanvas.epoch && liveCanvasReceive(message))
        .catch(error => debug("live-receive-failed", { error:String(error?.message || error).slice(0, 160) }));
    });
    socket.addEventListener("close", event => {
      if (epoch !== liveCanvas.epoch) return;
      liveCanvas.socket = null;
      if (event.code === 4403 || event.code === 4401) {
        if (event.code === 4403 && liveCanvas.target?.share) liveCanvasLinkEnded();
        else liveCanvasStop();
        return;
      }
      liveCanvas.status = "offline";
      liveCanvasRenderPresence();
      // A link turned off while this page was away refuses the socket without a close code.
      if (liveCanvas.target?.share && liveCanvas.retries) void liveCanvasCheckLink(liveCanvas.target.share);
      liveCanvasReconnect();
    });
  }
  // People editing by link must stop the moment the owner turns it off: the
  // page reopens the link, which now says the link has ended.
  function liveCanvasLinkEnded() {
    const target = liveCanvas.target;
    liveCanvasStop();
    if (window.PENECHO_CONFIG?.liveShare) { liveCanvas.reloading = true; location.reload(); return; }
    if (target?.local) {
      // Stopped or cleared on Cloud: this copy stays here and stops updating.
      liveCanvas.endedLinks.add(target.share);
      liveLinkForget(target.share);
      liveCanvasRenderExpiry();
      setStatus(liveCopy("This collaboration has ended. Your Canvas stays here.", "此协作已结束，你的画布仍保留在这里。"));
      return;
    }
    setStatus(liveCopy("Sharing was turned off. This Canvas no longer updates.", "分享已关闭，此画布不再更新。"));
  }
  async function liveCanvasCheckLink(token) {
    try {
      const response = await fetch(`/api/v1/shares/${encodeURIComponent(token)}`, { method:"HEAD", cache:"no-store" });
      if ([404, 410].includes(response.status) && liveCanvas.target?.share === token) liveCanvasLinkEnded();
    } catch {}
  }
  function liveCanvasReconnect(delay = null) {
    if (!liveCanvas.target) return;
    clearTimeout(liveCanvas.retryTimer);
    const epoch = ++liveCanvas.epoch;
    try { liveCanvas.socket?.close(1000, "Reconnecting"); } catch {}
    liveCanvas.socket = null;
    const wait = delay ?? Math.min(15000, 500 * 2 ** Math.min(5, liveCanvas.retries++));
    liveCanvas.retryTimer = setTimeout(() => { if (epoch === liveCanvas.epoch) liveCanvasConnect(); }, wait);
  }
  async function liveCanvasReceive(message) {
    if (message.type === "welcome") {
      Object.assign(liveCanvas, { role:message.role, you:message.you, slot:message.you?.slot || liveCanvas.slot, status:"live", retries:0 });
      if (message.reload) return liveCanvasReload();
      if (window.PENECHO_CONFIG?.runtime !== "viewer" && liveCanvas.slot) liveCanvasInstallIdRanges(liveCanvas.slot);
      for (const change of liveCanvas.pending) liveCanvasSend(change);
      liveCanvasRenderPresence();
    } else if (message.type === "change") await liveCanvasApplyChange(message);
    else if (message.type === "ack") liveCanvasAck(message);
    else if (message.type === "reject") {
      // Cloud refused a change, so this copy no longer matches; start again from Cloud.
      setStatus(message.message || liveCopy("A change could not be shared.", "一项改动无法同步。"));
      if (["live_read_only", "live_room_full"].includes(message.code)) liveCanvas.readOnly = true;
      else liveCanvasReload();
    } else if (message.type === "access") {
      // An editor page and a viewer page are different pages; open the right one.
      if (message.role) location.reload();
    } else if (message.type === "reload") liveCanvasReload();
    else if (message.type === "here") liveCanvasPresent(message.participant);
    else if (message.type === "gone") liveCanvasGone(message.participantId);
    else if (message.type === "presence") liveCanvasMoved(message);
    else if (message.type === "error" && message.message) setStatus(message.message);
  }
  function liveCanvasReload() {
    if (liveCanvas.reloading) return;
    // Local PenEcho reopens its own copy on reload, which cannot catch up with Cloud.
    if (!["cloud", "viewer"].includes(window.PENECHO_CONFIG?.runtime) && !window.PENECHO_CONFIG?.liveShare) {
      liveCanvasStop();
      setStatus(liveCopy("This Canvas is out of step with Cloud. Close it and open it again from Cloud to keep working live.", "这块画布与云端不同步。请关闭后从云端重新打开，以继续实时协作。"));
      return;
    }
    liveCanvas.reloading = true;
    setStatus(liveCopy("Catching up with the shared Canvas…", "正在同步共享画布…"));
    location.reload();
  }
  if (typeof window === "object") {
    window.addEventListener("online", () => { if (liveCanvas.target && liveCanvas.status !== "live") liveCanvasReconnect(0); });
    window.addEventListener("pagehide", () => { try { liveCanvas.socket?.close(1000, "Page closed"); } catch {} });
  }

  // ---------- People ----------
  function liveCanvasPresent(participant) {
    if (!participant?.id || participant.id === liveCanvas.you?.id) return;
    const person = liveCanvas.participants.get(participant.id) || {};
    liveCanvas.participants.set(participant.id, { ...person, ...participant, seenAt:Date.now() });
    liveCanvasRenderPresence();
  }
  function liveCanvasGone(id) {
    const person = liveCanvas.participants.get(id);
    if (!person) return;
    person.cursor?.remove();
    liveCanvas.participants.delete(id);
    liveCanvasRenderPresence();
  }
  function liveCanvasMoved(message) {
    const person = liveCanvas.participants.get(message.participantId);
    if (!person) return;
    Object.assign(person, { point:message.point, pointAt:Date.now(), tool:message.tool || person.tool, seenAt:Date.now() });
    liveCanvasPositionPresence();
  }
  function liveCanvasPointer(event) {
    if (liveCanvas.status !== "live" || liveCanvas.socket?.readyState !== 1 || !liveCanvas.participants.size) return;
    const now = performance.now();
    if (now - liveCanvas.presenceAt < LIVE_PRESENCE_MS) return;
    liveCanvas.presenceAt = now;
    const point = clientPoint(event);
    if (![point.x, point.y].every(Number.isFinite)) return;
    liveCanvas.socket.send(JSON.stringify({ type:"presence", point, tool:state.mode }));
  }
  if (typeof view === "object" && view) view.addEventListener("pointermove", liveCanvasPointer, { passive:true });
  function liveInitials(name) {
    const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
  }
  function liveCanvasCursorLayer() {
    if (liveCanvas.layer?.isConnected) return liveCanvas.layer;
    if (typeof view !== "object" || !view) return null;
    liveCanvas.layer = document.createElement("div");
    liveCanvas.layer.className = "live-presence-layer";
    liveCanvas.layer.setAttribute("aria-hidden", "true");
    view.append(liveCanvas.layer);
    return liveCanvas.layer;
  }
  function liveCanvasPositionPresence() {
    if (!liveCanvas.participants.size) return;
    const layer = liveCanvasCursorLayer();
    if (!layer) return;
    const metrics = canvasViewportMetrics(), now = Date.now();
    for (const person of liveCanvas.participants.values()) {
      if (!person.cursor) {
        person.cursor = document.createElement("div");
        person.cursor.className = "live-cursor";
        person.cursor.style.setProperty("--live-color", person.color || "#2563eb");
        const label = document.createElement("span");
        label.textContent = person.name || "Guest";
        person.cursor.append(label);
        layer.append(person.cursor);
      }
      const visible = person.point && now - (person.pointAt || 0) < LIVE_CURSOR_IDLE_MS;
      person.cursor.hidden = !visible;
      if (!visible) continue;
      const x = (person.point.x * state.scale + state.panX) / metrics.clientScaleX, y = (person.point.y * state.scale + state.panY) / metrics.clientScaleY;
      person.cursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
  function liveCanvasRenderPresence() {
    const host = document.getElementById("liveParticipants");
    if (!host) return;
    const people = [...liveCanvas.participants.values()].sort((a, b) => (a.slot || 0) - (b.slot || 0));
    host.hidden = !liveCanvas.target || (!people.length && liveCanvas.status === "live");
    host.dataset.state = liveCanvas.status;
    const shown = people.slice(0, 4).map(person => {
      const avatar = document.createElement("span");
      avatar.className = "live-avatar";
      avatar.style.setProperty("--live-color", person.color || "#2563eb");
      avatar.dataset.kind = person.kind || "person";
      avatar.textContent = liveInitials(person.name);
      avatar.title = person.name || "Guest";
      return avatar;
    });
    if (people.length > 4) {
      const more = document.createElement("span");
      more.className = "live-avatar live-avatar-more";
      more.textContent = `+${people.length - 4}`;
      shown.push(more);
    }
    host.replaceChildren(...shown);
    host.title = liveCanvas.status === "live" ? people.map(person => person.name).join(", ")
      : liveCopy("Reconnecting to the shared Canvas…", "正在重新连接共享画布…");
    liveCanvasPositionPresence();
  }

  // ---------- Opening ----------
  // A Cloud Canvas opened by its owner is live; so is any Canvas opened from a
  // share link. Other documents are not.
  function liveCanvasSyncTarget() {
    const config = window.PENECHO_CONFIG || {};
    if (config.runtime === "viewer") return;
    // A guest's folder Canvas is kept with its page, not in an account's library.
    const id = state.currentSnapshotLocation === "cloud" && LIVE_UUID.test(String(state.currentSnapshotId || "")) && !window.PenEchoFolderProject?.guest?.() ? state.currentSnapshotId : null;
    const link = config.liveShare ? null : liveCanvasLink();
    if (link && id && link.ownerKey) void liveCanvasAdopt(link, id);
    else if (link && !id) liveCanvasStart({ share:link.token, local:true }, { have:link.seq });
    // A folder project's pages sync by saving; one of its Canvases goes live only
    // while people collaborate on it or watch its share link.
    else if (id && (!window.PenEchoFolderProject?.enabled?.() || liveCanvas.audience.has(id))) liveCanvasStart({ canvas:id }, { have:liveCanvasSequence(state.currentSnapshotBundleExtensions) });
    else if (!(config.liveShare && liveCanvas.target?.share)) liveCanvasStop();
    liveCanvasRenderExpiry();
  }
  if (typeof window === "object") window.addEventListener("penecho:live-share-context-changed", liveCanvasSyncTarget);
  async function liveCanvasOpenShare() {
    const share = window.PENECHO_CONFIG?.liveShare;
    if (!share?.token) return false;
    const response = await fetch(`/api/v1/shares/${encodeURIComponent(share.token)}`, { cache:"no-store", headers:{ accept:"application/json" } });
    if (!response.ok) throw Error(response.status === 404 ? liveCopy("This collaboration has ended. Ask the owner for a new link.", "此协作已结束，可以请所有者发一个新链接。") : `HTTP ${response.status}`);
    const payload = await response.json();
    await viewCommunityCanvasArtifact(payload.artifact);
    liveCanvas.expiresAt = payload.live?.expiresAt || null;
    liveCanvasStart({ share:share.token }, { have:payload.live?.seq || 0 });
    liveCanvasRenderExpiry();
    return true;
  }
  // An unsaved link Canvas says when Cloud clears it, with the two ways to keep it.
  function liveCanvasRenderExpiry() {
    const host = document.getElementById("liveParticipants");
    if (!host?.parentNode) return;
    const target = liveCanvas.target, unsaved = target?.share && (target.local || window.PENECHO_CONFIG?.liveShare && liveCanvas.expiresAt);
    // A guest's folder project shows when Cloud clears it, until someone signs in and keeps it;
    // so does a free account's project beyond its 3 kept, until it is kept with Plus.
    const folderUntil = !unsaved && window.PenEchoFolderProject?.expiresAt?.();
    let chip = document.getElementById("liveExpiry");
    if (!unsaved && !folderUntil) { if (chip) chip.hidden = true; return; }
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "liveExpiry";
      chip.type = "button";
      chip.className = "live-expiry";
      chip.dataset.peButton = "ghost";
      chip.dataset.peDensity = "compact";
      chip.addEventListener("click", liveCanvasExpiryMenu);
      host.after(chip);
    }
    // Every change keeps it 7 more days, so a local copy counts from now.
    const until = new Date(folderUntil || (target.local ? Date.now() + 7 * 86400000 : Date.parse(liveCanvas.expiresAt)));
    const day = until.toLocaleDateString(state.language === "zh" ? "zh-CN" : undefined, { month:"short", day:"numeric" });
    chip.hidden = false;
    chip.dataset.expiry = folderUntil ? "folder" : "link";
    chip.textContent = liveCopy(`Until ${day}`, `保留至 ${day}`);
    chip.title = !folderUntil ? liveCopy("Cloud clears this shared Canvas 7 days after its last change unless someone signs in and saves it.", "此共享画布在最后一次修改 7 天后会被云端清除，除非有人登录并保存。")
      : window.PenEchoFolderProject?.overFreeLimit?.() ? liveCopy("Free keeps 3 projects. This one moves to Trash 7 days after its last change unless you keep it with Plus.", "免费账户保留 3 个项目。此项目将在最后一次修改 7 天后移到回收站，除非你升级 Plus 以保留。")
      : liveCopy("Cloud clears this folder's Canvases 7 days after their last change unless you sign in and keep them.", "此文件夹的画布在最后一次修改 7 天后会被云端清除，除非你登录并保留。");
  }
  function liveCanvasExpiryMenu(event) {
    document.getElementById("liveExpiryMenu")?.remove();
    const menu = document.createElement("div"), anchor = event.currentTarget.getBoundingClientRect();
    menu.id = "liveExpiryMenu";
    menu.className = "live-expiry-menu";
    menu.setAttribute("role", "menu");
    menu.dataset.peSurface = "menu";
    const item = (label, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.dataset.peButton = "menu-item";
      button.textContent = label;
      button.addEventListener("click", () => { menu.remove(); action(); });
      return button;
    };
    menu.append(
      item(liveCopy("Download PDF", "下载 PDF"), () => {
        const pdf = typeof exportCanvasPdf === "function" ? exportCanvasPdf : window.PenEchoCanvasExport?.pdf;
        void Promise.resolve(pdf?.()).catch(error => setStatus(String(error?.message || error)));
      }),
      // The shared page saves its own way; the app saves this Canvas to the account it signs in to;
      // a guest's folder page keeps all of its Canvases in that account; Plus keeps a free account's
      // project beyond its 3 kept.
      window.PenEchoFolderProject?.overFreeLimit?.() && !liveCanvas.target?.share
        ? item(liveCopy("Keep with Plus", "升级 Plus 以保留"), () => window.open(new URL("/dashboard.html#billing", window.PenEchoCloudSettings?.origin?.() || window.PENECHO_CONFIG?.cloudOrigin || location.origin).href, "_blank", "noopener"))
        : window.PenEchoFolderProject?.guest?.() && !liveCanvas.target?.share
          ? item(liveCopy("Sign in to keep", "登录以保留"), () => void window.PenEchoBrowserDraft?.signIn({ intent:"keep" }))
          : item(liveCopy("Sign in to save", "登录以保存"), () => {
            if (window.PENECHO_CONFIG?.liveShare) { if (typeof saveCurrentCanvasFromUser === "function") void saveCurrentCanvasFromUser(); }
            else window.dispatchEvent(new CustomEvent("penecho:live-link-save"));
          }),
    );
    Object.assign(menu.style, { position:"fixed", top:`${Math.round(anchor.bottom + 6)}px`, left:`${Math.round(anchor.left)}px`, zIndex:"1000" });
    document.body.append(menu);
    const close = closing => { if (!menu.contains(closing.target) && closing.target !== event.currentTarget) { menu.remove(); document.removeEventListener("pointerdown", close, true); } };
    document.addEventListener("pointerdown", close, true);
    menu.querySelector("button")?.focus();
  }
  // A comparable summary of what this copy shows, for diagnostics and tests.
  function liveCanvasDigest() {
    const ink = {};
    for (const k of [...tiles.keys()].sort()) {
      const pixels = liveTilePixels(tiles.get(k));
      let count = 0, alpha = 0, red = 0, green = 0, blue = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (!a) continue;
        count++; alpha += a; red += pixels[i] * a; green += pixels[i + 1] * a; blue += pixels[i + 2] * a;
      }
      if (count) ink[k] = { count, alpha, red:Math.round(red / 255), green:Math.round(green / 255), blue:Math.round(blue / 255) };
    }
    const personal = new Set(["src", "favoriteSourceId", "shareSourceId", "favorite", "favoriteArtifactSha256", "favoriteCloudId", "favoriteCommunityItemId"]);
    const objects = kind => (state[kind] || []).map(item => Object.fromEntries(Object.entries(liveCurrentWire(kind, item) || {}).filter(([field]) => !personal.has(field))));
    return { ink, widgets:objects("widgets"), images:objects("images"), textBoxes:objects("textBoxes") };
  }
  if (typeof window === "object") window.PenEchoLiveCanvas = {
    start:(target, options) => liveCanvasStart(target, options),
    // kind: "collaboration" or "share", as Cloud reports them for a Canvas.
    audience:(canvasId, kind, on) => {
      const kinds = liveCanvas.audience.get(canvasId) || new Set(), had = kinds.size > 0;
      if (on) kinds.add(kind); else kinds.delete(kind);
      if (kinds.size) liveCanvas.audience.set(canvasId, kinds); else liveCanvas.audience.delete(canvasId);
      if (had !== kinds.size > 0) liveCanvasSyncTarget();
    },
    stop:liveCanvasStop,
    startLink:liveCanvasStartLink,
    endLink:liveCanvasEndLink,
    link:() => { const link = liveCanvasLink(); return link ? { token:link.token, publicUrl:link.publicUrl || null, own:Boolean(link.ownerKey) } : null; },
    openShare:liveCanvasOpenShare,
    digest:liveCanvasDigest,
    state:() => ({ status:liveCanvas.status, role:liveCanvas.role, appliedSeq:liveCanvas.appliedSeq, pending:liveCanvas.pending.length,
      participants:[...liveCanvas.participants.values()].map(({ cursor, ...person }) => person) }),
  };
