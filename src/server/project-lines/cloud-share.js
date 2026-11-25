"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { failure } = require("./store.js");
const L = require("./layout.js");
const { createCloudSync } = require("./cloud-sync.js");
const { fileReadFailure } = require("./sync/engine.js");
const { aside } = require("./sync/plan.js");
const gzipAsync = promisify(zlib.gzip);

// A project's copy in the signed-in user's PenEcho Cloud space. Share makes a
// read-only link anyone can open without an account, and always keeps the copy,
// which follows the folder and shows in the Cloud dashboard. Free to share, paid
// to keep: a free account's link works 7 days and its copy holds up to 100 MB;
// Plus keeps links open and holds up to 300 MB. Cloud stores each file once by
// SHA-256, so only changed files upload. Nothing leaves this computer until the
// user asks. A free account's projects share its 200 MB in Cloud (the owner's rule, 2026-11-10); Cloud has the last word on what is left.
const FREE_BYTES = 200 * 1024 * 1024;
const PLUS_BYTES = 300 * 1024 * 1024;
const MAX_FILE = 64 * 1024 * 1024;
// The owner raised it from 5,000 (PE-581, 2026-11-17). Only a project's Lines and what they show count (sync-scope.js).
const MAX_CLOUD_FILES = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_DAYS = 30;
const SYNC_DAY_CHOICES = new Set([7, 30, "all"]);

function parseSyncDays(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "all") return "all";
    if (trimmed === "7") return 7;
    if (trimmed === "30") return 30;
  } else if (typeof value === "number" && SYNC_DAY_CHOICES.has(value)) {
    return value;
  }
  throw failure("BAD_SYNC_DAYS", "Choose 7 days, 30 days, or all for first sync.", 400);
}

function firstSyncWindow(choice = DEFAULT_SYNC_DAYS, now = Date.now()) {
  const days = choice === undefined ? DEFAULT_SYNC_DAYS : choice;
  return days === "all"
    ? { syncDays:"all", syncSince:0, syncStartedAt:now }
    : { syncDays:days, syncSince:Math.max(1, Math.round(now - days * DAY_MS)), syncStartedAt:now };
}
const persistWindow = window => window
  ? { syncDays:window.syncDays, syncSince:Number(window.syncSince) || 0, ...(Number(window.syncStartedAt) > 0 ? { syncStartedAt:Number(window.syncStartedAt) } : {}) }
  : {};
const PUSH_EVERY_MS = 60 * 1000;
const PARALLEL = 3;
// Small files travel together, so a big folder takes a handful of requests, not one per file. 100 a request keeps the
// "Uploading n of N" count moving within a second or so; Cloud stores each batch in one go (PE-552).
// Cloudflare, in front of penecho.ai, ends a request not answered within about 140 s, upload time included (measured
// 2026-11-24): a 31 MB film over the owner's uplink was cut off every round and the sync never finished (PE-1067). So no
// request carries more than 2 MB, about 30 s at 70 KB/s with the other uploads beside it, and a bigger file goes in parts.
const BATCH_BYTES = 2 * 1024 * 1024;
const PART_BYTES = 2 * 1024 * 1024;
const BATCH_FILES = 100;
// A batch cut off on the way (a dropped connection, a 503 from the edge) is sent again after these waits before the round gives up.
// One cut-off batch used to end the whole first upload, and the next try sent every file again (PE-574).
const RETRY_MS = [2000, 5000, 15000, 30000];
// An upload has as long as its size needs on a slow link, with the other uploads beside it: a 19 MB file over a 60 KB/s uplink
// took over five minutes, and a fixed two minutes cut it off every time, so it never arrived (PE-692).
const SLOW_UPLINK = 16 * 1024;
const uploadTimeout = bytes => 120_000 + Math.ceil(bytes / SLOW_UPLINK) * 1000;
// The page data penecho.ai shows is sent at most this often for a project (pushView).
const VIEW_EVERY_MS = 10_000;
// A big project's view costs penecho.ai seconds of work each time it takes one (megabytes read, changed and kept again, on half a
// CPU that serves everyone): the next one waits this many times what Cloud took over the last, so one project's views use a small
// part of that server's time. A view taken quickly keeps the pace above.
const VIEW_PACE = 12, VIEW_PACE_FROM_MS = 250, VIEW_PACE_MOST_MS = 2 * 60_000;
const SCOPE_REUSE_MS = 15_000;
// After a view Cloud could not take: the longest wait between tries, and the wait after a refusal that stays.
const VIEW_BACKOFF_MS = 30 * 60_000, VIEW_REFUSED_MS = 30 * 60_000;
// 520-524 and 530 are Cloudflare's own answers when penecho.ai behind it did not answer in time: a batch stored in a server that took
// over 100 s came back 524 and ended a whole first upload (2026-11-23). Each blob is stored by its hash, so sending it again is safe.
const passing = error => [429, 502, 503, 504, 520, 521, 522, 523, 524, 530].includes(Number(error?.status)) || error?.code === "cloud_temporarily_unavailable" || error?.name === "TimeoutError";
// A project brought down from Cloud keeps Cloud's key; one made here is known in Cloud by its own id.
const keyOf = project => project.cloud?.key || project.id;
const base = project => `/api/v1/device-sync/line-projects/${encodeURIComponent(keyOf(project))}`;
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const PLANS = new Set(["free", "starter", "plus", "pro", "max"]);
// Cloud's own answer, passed to the page as it came (project_limit, line_busy …).
const passOn = error => Object.assign(failure(error.code || "cloud_request_failed", error.message, error.status || 502), { body:{ error:error.code || "cloud_request_failed", message:error.message, ...(error.details ? { details:error.details } : {}) } });
// Restore points and deleted documents stay on this computer.
const shareable = file => !file.path.startsWith(".history/") && !file.path.startsWith(".trash/");
const mb = bytes => `${Math.max(1, Math.round(bytes / 1048576))} MB`;
const isPlus = who => ["plus", "pro"].includes(who?.membership?.tier);

// What the person is told when a round kept their files from what Cloud's list or this folder said (PE-303).
function noticeOf(result) {
  if (!result) return "";
  const files = n => `${n} file${n === 1 ? "" : "s"}`;
  if (result.kept) return `Cloud's copy was missing ${files(result.kept)} of this project. They were kept here and sent to Cloud again.`;
  if (result.restored) return `${files(result.restored)} of this project were missing on this computer. They were brought back from Cloud, not removed there.`;
  if (result.remade) return "Cloud's copy of this project was made again elsewhere. Nothing was removed; what differed was sent to Cloud or brought here, and files changed on both sides are kept both ways.";
  return "";
}

function createCloudShare({ store, connector, assertOwner = () => {}, signIn = null, logger = null, summarize = null, scope = null, pageView = null, viewEveryMs = VIEW_EVERY_MS, maxFiles = MAX_CLOUD_FILES, directory = null, onSynced = () => {}, onChanged = () => {}, where = () => os.hostname(), retryMs = RETRY_MS }) {
  const hashes = new Map(), pushed = new Map(), running = new Map(), errors = new Map(), trouble = new Map(), progress = new Map(), notices = new Map(), skipped = new Map(), syncedAt = new Map(), activeWindows = new Map();
  const lastScopes = new Map();
  let partsGoneUntil = 0;
  const markSynced = project => { if (project?.id) syncedAt.set(project.id, Date.now()); };
  const cloud = () => {
    const value = typeof connector === "function" ? connector() : connector;
    if (!value) throw failure("CLOUD_STARTING", "PenEcho Cloud is still starting. Try again in a moment.", 503);
    return value;
  };
  const account = () => {
    const status = cloud().status();
    return status.accountSession?.signedIn ? status.account || { name:"" } : null;
  };
  // The account's own Cloud storage when Cloud said it (a paid plan holds 1 to 10 GB); the old fixed figures only when it did not.
  const limitFor = who => Number(who?.workspace?.storageLimitBytes) > 0 ? Number(who.workspace.storageLimitBytes) : isPlus(who) ? PLUS_BYTES : FREE_BYTES;
  // `key`: the Cloud project a copy came from. It stays for good, sync on or off, so this project never makes a second one (E2E L2).
  // `syncDays` / `syncSince`: first-sync history window (7, 30, or "all", with a fixed cutoff timestamp so old uploaded work is never cleared as days grow).
  const settings = project => ({
    sync:Boolean(project.cloud?.sync),
    shared:Boolean(project.cloud?.shared),
    ...(project.cloud?.key ? { key:project.cloud.key } : {}),
    ...(project.cloud?.syncDays !== undefined ? { syncDays:project.cloud.syncDays } : {}),
    ...(Number.isFinite(project.cloud?.syncSince) ? { syncSince:project.cloud.syncSince } : {}),
    ...(Number(project.cloud?.syncStartedAt) > 0 ? { syncStartedAt:Number(project.cloud.syncStartedAt) } : {}),
  });
  // until: when a free account's link ends.
  function remember(project, patch, remote, owner = project.cloud?.owner) {
    const until = remote === undefined ? project.cloud?.until || null : remote?.share?.expiresAt || null;
    const next = { ...settings(project), ...patch };
    if (next.syncDays === undefined) delete next.syncDays;
    if (!Number.isFinite(next.syncSince)) delete next.syncSince;
    if (!(Number(next.syncStartedAt) > 0)) delete next.syncStartedAt;
    const enabled = next.sync || next.shared;
    if (enabled || next.key) project.cloud = { ...next, ...(owner ? { owner } : {}), ...(enabled && until ? { until } : {}) };
    else delete project.cloud;
    if (!project.cloud?.sync) { syncedAt.delete(project.id); dropView(project.id); }
    store.save();
  }
  const syncWindowOf = (project, access = null, { existingRemote = false } = {}) => {
    if (access?.syncWindow) {
      if (existingRemote && access.syncWindow.implicit) return { syncSince:0, syncStartedAt:0 };
      return { syncSince:Number(access.syncWindow.syncSince) || 0, syncStartedAt:Number(access.syncWindow.syncStartedAt) || 0 };
    }
    return { syncSince:Number(project?.cloud?.syncSince) || 0, syncStartedAt:Number(project?.cloud?.syncStartedAt) || 0 };
  };
  const savedWindowOf = project => project.cloud?.syncDays !== undefined
    ? { syncDays:project.cloud.syncDays, syncSince:Number(project.cloud.syncSince) || 0, ...(Number(project.cloud.syncStartedAt) > 0 ? { syncStartedAt:Number(project.cloud.syncStartedAt) } : {}) }
    : null;
  function resolveFirstSyncWindow(project, requested, { firstPublish = false } = {}) {
    const implicit = requested === undefined;
    if (!project.cloud?.sync && !project.cloud?.key) return { ...firstSyncWindow(requested), ...(implicit ? { implicit:true } : {}) };
    if (!project.cloud?.sync && project.cloud?.key) {
      if (!implicit) return firstSyncWindow(requested);
      const saved = savedWindowOf(project);
      if (saved) return saved;
      if (firstPublish) return { ...firstSyncWindow(DEFAULT_SYNC_DAYS), implicit:true };
      return null;
    }
    if (!implicit && (!sync || sync.rev(project) === 0)) return firstSyncWindow(requested);
    return savedWindowOf(project);
  }

  const transfers = new WeakMap();
  let closed = false;
  let sessionEpoch = 0;
  const activitySecret = crypto.randomBytes(32);
  function sessionSnapshot() {
    let conn;
    try { conn = cloud(); } catch { return null; }
    const status = conn.status?.();
    if (!status?.accountSession?.signedIn) return null;
    const who = status.account || null;
    const rawToken = typeof conn.configuration?.accountToken === "string" ? conn.configuration.accountToken : "";
    const tokenHash = rawToken ? crypto.createHash("sha256").update(rawToken).digest("hex") : "";
    const key = JSON.stringify([
      status.origin || "",
      who?.id || "",
      who?.email || "",
      who?.name || "",
      status.accountSession.expiresAt || "",
      status.accountSession.credential || "",
      status.accountSession.generation ?? status.accountSession.id ?? "",
      tokenHash,
    ]);
    // A new login to the same account may resume a later round, but never an in-flight one.
    const ownerId = who?.id || who?.email || tokenHash || who?.name;
    const owner = ownerId ? JSON.stringify([status.origin || "", ownerId]) : "";
    return { conn, key, owner, epoch:sessionEpoch };
  }
  function checkOwner() {
    assertOwner();
    if (closed) throw failure("CLOSING", "PenEcho is shutting down.", 503);
  }
  const changed = () => failure("SYNC_CHANGED", "This project's Cloud sync settings changed. The previous operation stopped.", 409);
  function checkSession(session) {
    checkOwner();
    const now = sessionSnapshot();
    if (!session || !now || now.conn !== session.conn || now.key !== session.key || now.epoch !== session.epoch) {
      throw failure("CLOUD_ACCOUNT_CHANGED", "The Cloud account changed during sync. Try again with the original account.", 409);
    }
    return session.conn;
  }
  // Capture authority when work is requested, including a round waiting behind another round.
  // The real connector selects credentials synchronously at dispatch. Check again on reply before using its data.
  function syncAccess(project, { requireEnabled = false } = {}) {
    checkOwner();
    const session = sessionSnapshot();
    if (!session) throw failure("SIGN_IN", "Sign in to PenEcho Cloud to sync this project.", 401);
    const dest = base(project), docsPath = project.docsPath;
    const registered = store.get?.(project.id) || store.projects?.find(p => p.id === project.id);
    const current = registered || project;
    let gate = transfers.get(current);
    if (!gate) {
      gate = { version:0, stopping:null, writes:new Set() };
      transfers.set(current, gate);
    }
    const version = gate.version;
    const access = { check, request, gate, owner:session.owner, needsExistingCopy:requireEnabled && !current.cloud?.owner };
    function check() {
      const conn = checkSession(session);
      if ((registered && !store.projects.includes(registered)) || base(current) !== dest || current.docsPath !== docsPath
          || version !== gate.version || (gate.stopping && gate.stopping !== access)
          || (requireEnabled && !current.cloud?.sync && !current.cloud?.shared)) throw changed();
      if (current.cloud?.owner && current.cloud.owner !== session.owner) {
        throw failure("CLOUD_ACCOUNT_CHANGED", "Sign back in to the Cloud account that syncs this project.", 409);
      }
      return conn;
    }
    async function request(suffix = "", options = {}) {
      const pending = check().cloudRequest(`${dest}${suffix}`, { timeoutMs:120_000, ...options });
      const write = options.method && options.method !== "GET" && options.method !== "HEAD";
      if (write) gate.writes.add(pending);
      try { return await pending; }
      finally {
        if (write) gate.writes.delete(pending);
        check();
      }
    }
    check();
    return access;
  }
  // ---------- The page data penecho.ai shows, made here (cloud-view.js) ----------
  // After a sync round, penecho.ai is sent what its pages show of the project, so it does not read the project's files to make it:
  // once whole, then only what changed since the last one it took (a few KB for a Line's new step). At most every viewEveryMs for a
  // project; nothing when nothing changed. A Cloud from before this answers 404 and is not asked again for an hour.
  // pageView(project, base, dbRev) → { body, tag } to send, or null; base is the tag of the last view Cloud took ("" for the whole view).
  const views = new Map();
  function dropView(id) {
    const entry = views.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.scope = null;
    views.delete(id);
  }
  function viewTarget(id, fallback, wasInStore) {
    const list = Array.isArray(store?.projects) ? store.projects : null;
    const current = wasInStore && list ? list.find(p => p.id === id) || null : fallback;
    if (!current || !current.cloud?.sync) return null;
    return { project:current, dest:base(current) };
  }
  function scheduleView(id, entry) {
    if (entry.timer || entry.busy || !entry.project?.cloud?.sync) return;
    entry.timer = setTimeout(() => { entry.timer = null; pushView(id).catch(() => {}); }, Math.max(0, entry.at + Math.max(viewEveryMs, entry.pace || 0) - Date.now(), entry.offUntil - Date.now()));
    entry.timer.unref?.();
  }
  function pushViewSoon(project, dbRev, opts = null) {
    if (typeof pageView !== "function") return;
    if (!project?.cloud?.sync) { if (project?.id) dropView(project.id); return; }
    if (!Number.isFinite(Number(dbRev))) return;
    let access;
    try { access = syncAccess(project, { requireEnabled:true }); } catch { return; }
    const inStore = Array.isArray(store?.projects) && store.projects.some(p => p.id === project.id);
    const entry = views.get(project.id) || { tag:"", at:0, timer:null, busy:false, offUntil:0, failures:0, refusedRev:null, scope:null, gen:0, wasInStore:false };
    if (inStore) entry.wasInStore = true;
    // Cloud refused this view for good (too large, not allowed): it is not sent again until the project changes, or after VIEW_REFUSED_MS.
    if (entry.refusedRev !== null && entry.refusedRev !== Number(dbRev)) { entry.refusedRev = null; entry.offUntil = 0; clearTimeout(entry.timer); entry.timer = null; }
    entry.gen++;
    views.set(project.id, Object.assign(entry, { project, access, dbRev:Number(dbRev) }));
    // An explicit empty option invalidates a scope left by an earlier round. Without opts (the existing public call), leave a newer
    // scope supplied while a view was busy in place for the follow-up view.
    if (opts && typeof opts === "object") entry.scope = opts.keep || opts.files ? { keep:opts.keep || null, files:opts.files || null, at:Number(opts.at) || Date.now() } : null;
    scheduleView(project.id, entry);
  }
  async function pushView(id) {
    const entry = views.get(id);
    if (!entry || entry.busy) return;
    const access = entry.access;
    try { access.check(); } catch { dropView(id); return; }
    const beforeEpoch = sessionEpoch;
    const inStoreNow = Array.isArray(store?.projects) && store.projects.some(p => p.id === id);
    if (inStoreNow) entry.wasInStore = true;
    const wasInStore = Boolean(entry.wasInStore);
    const beforeTarget = viewTarget(id, entry.project, wasInStore);
    if (!beforeTarget) { dropView(id); return; }
    entry.project = beforeTarget.project;
    entry.busy = true;
    entry.at = Date.now();
    const dbRev = entry.dbRev, startedGen = entry.gen, cached = entry.scope;
    entry.scope = null; // One round's scope is used at most once, even when making or sending the view fails.
    let staleSessionOrTarget = false;
    try {
      const opts = cached && Date.now() - cached.at < SCOPE_REUSE_MS ? { ...(cached.keep ? { keep:cached.keep } : {}), ...(cached.files ? { files:cached.files } : {}) } : null;
      const made = opts ? pageView(beforeTarget.project, entry.tag, dbRev, opts) : pageView(beforeTarget.project, entry.tag, dbRev);
      if (!made) return;
      if (made.same && entry.sentRev === dbRev) return;
      const bytes = await gzipAsync(JSON.stringify(made.body), { level:6 });
      // Revalidate session, account/origin, project existence, sync enablement, and Cloud destination after async compression.
      const afterTarget = viewTarget(id, entry.project, wasInStore);
      if (views.get(id) !== entry || sessionEpoch !== beforeEpoch || !afterTarget || afterTarget.dest !== beforeTarget.dest) {
        staleSessionOrTarget = true;
        return;
      }
      const asked = Date.now();
      await access.request("/view", { method:"PUT", bytes });
      const took = Date.now() - asked;
      entry.pace = took >= VIEW_PACE_FROM_MS ? Math.min(VIEW_PACE_MOST_MS, took * VIEW_PACE) : 0;
      if (views.get(id) === entry && sessionEpoch === beforeEpoch) {
        Object.assign(entry, { tag:made.tag, sentRev:dbRev, at:Date.now(), failures:0, offUntil:0, refusedRev:null });
      }
    } catch (error) {
      if (views.get(id) !== entry || sessionEpoch !== beforeEpoch) return;
      if (error.code === "CLOUD_ACCOUNT_CHANGED" || error.code === "SYNC_CHANGED" || closed) { staleSessionOrTarget = true; return; }
      entry.at = Date.now();
      // Cloud does not have the view the changes were made against (another server process, or it changed the project itself):
      // the next one goes whole.
      if (error.status === 409) entry.tag = "";
      else if (error.status === 404 || error.status === 405) entry.offUntil = Date.now() + 60 * 60_000;
      // A refusal that passes (busy, rate limited, cut off) waits longer each time; one that stays (too large, not allowed) waits for
      // the project to change. Each try makes and packs the whole view, so it never goes again every few seconds (PE-692).
      else if (passing(error) || !error.status) entry.offUntil = Date.now() + Math.min(VIEW_BACKOFF_MS, viewEveryMs * 2 ** Math.min(entry.failures++, 10));
      else { entry.refusedRev = dbRev; entry.offUntil = Date.now() + VIEW_REFUSED_MS; }
      logger?.({ type:"project-lines-cloud", event:"view-failed", project:id, status:error.status || 0, message:String(error.message || "").slice(0, 200) });
    } finally {
      entry.busy = false;
      if (views.get(id) !== entry || sessionEpoch !== beforeEpoch) return;
      const stillTarget = viewTarget(id, entry.project, wasInStore);
      if (!stillTarget) { dropView(id); return; }
      entry.project = stillTarget.project;
      if (staleSessionOrTarget) {
        entry.tag = "";
        entry.sentRev = undefined;
        if (entry.gen === startedGen && entry.dbRev === dbRev) return;
      }
      // A round or newer view request that came while this one was busy goes next, preserving backoff/refusal waits.
      if (entry.dbRev !== dbRev || entry.gen !== startedGen || (entry.tag === "" && entry.sentRev !== dbRev)) scheduleView(id, entry);
    }
  }

  // Hashes are kept by path, size and time, so an unchanged folder hashes nothing.
  // `withOut`: also list, flagged `out`, the files that stay on this computer only (sync-scope.js), so a round takes them out of Cloud
  // on purpose (sync/plan.js "unshare") and never brings Cloud's copy of one down over this computer's.
  function holdFile(project, file, reason) {
    const omitted = skipped.get(project.id) || new Map();
    omitted.set(file.path, { path:file.path, size:file.size, reason });
    skipped.set(project.id, omitted);
  }
  function manifest(project, maxBytes = PLUS_BYTES, paid = maxBytes > FREE_BYTES, { withOut = false, capture = null, syncSince, syncStartedAt, knownRemote = null } = {}) {
    // Cloud sees the project by layout-1 names (layout.js); what has none stays here.
    // A bounded UI listing is not a sync inventory: omitted files would be
    // mistaken for deletions. Inventory everything, then enforce Cloud's limit
    // explicitly before any round can change either side.
    lastScopes.delete(project.id);
    const rawWalked = store.walk(project, { limit:Infinity, strict:true, holdFileStat:fileReadFailure });
    const walked = rawWalked.filter(shareable);
    // Only a project's Lines, its knowledge and what its current Lines show or name go to Cloud (PE-581). A scope that cannot be worked
    // out does not authorize sending unscoped files or removing existing Cloud copies of them.
    const fallbackWin = syncWindowOf(project);
    const cutoff = syncSince !== undefined ? syncSince : fallbackWin.syncSince;
    const startedAt = syncStartedAt !== undefined ? syncStartedAt : fallbackWin.syncStartedAt;
    const inScope = scope ? scope(project, { files:rawWalked, syncSince:cutoff, syncStartedAt:startedAt, knownRemote }) : null;
    const listed = walked.filter(file => !inScope || inScope.has(file.path) || file.skipped).map(file => ({ ...file, gen:file.gen || "", path:L.toCloud(file.path) })).filter(file => file.path && !aside(file.path));
    const out = inScope && withOut ? walked.filter(file => !inScope.has(file.path) && !file.skipped).map(file => ({ path:L.toCloud(file.path), ...(inScope.incomplete ? { skipped:"scope_unverified" } : { out:true }) })).filter(file => file.path) : [];
    if (listed.length > maxFiles) throw failure("TOO_MANY_FILES", `This project's Lines and what they show come to ${listed.length} files. PenEcho Cloud holds up to ${maxFiles} files per project. Nothing was synced or removed. Reduce the number of project files before syncing again.`, 413);
    // The sizes alone already rule out a folder that cannot fit, before reading anything.
    skipped.set(project.id, new Map());
    const raw = listed.reduce((sum, file) => sum + (file.skipped || file.size > MAX_FILE ? 0 : file.size), 0);
    const tooBig = total => failure("TOO_LARGE", `This project is ${mb(total)}. ${paid ? `Your PenEcho Cloud storage holds ${mb(maxBytes)}; a larger plan holds more.` : `A free account keeps up to ${mb(maxBytes)} in Cloud; a paid plan keeps 1 GB or more.`}`, 413);
    if (raw > maxBytes * 2) throw tooBig(raw);
    const files = listed.map(file => {
      // Keep the path in the inventory: omitting it would look like a deletion.
      // Never hash or read bytes that cannot be uploaded.
      const hold = (reason, size = file.size) => {
        holdFile(project, { path:file.path, size }, reason);
        return { path:file.path, size, modified:Math.round(file.mtime), skipped:reason };
      };
      if (file.skipped || file.size > MAX_FILE) return hold(file.skipped || "too_large");
      const id = `${project.id}:${file.path}`, known = hashes.get(id);
      if (!capture && known && known.size === file.size && known.mtime === file.mtime && (!file.gen || known.gen === file.gen)) return { path:file.path, sha256:known.sha256, size:file.size, modified:Math.round(file.mtime) };
      let full, beforeStat = null, afterStat = null, bytes;
      try {
        full = store.resolve(project, L.fromCloud(file.path));
        try { beforeStat = fs.statSync(full); } catch { /* Checked by readFileSync below. */ }
        bytes = fs.readFileSync(full);
        try { afterStat = fs.statSync(full); } catch {}
      }
      catch (error) {
        if (fileReadFailure(error)) { hashes.delete(id); return hold("unreadable"); }
        throw error;
      }
      if (bytes.length > MAX_FILE) return hold("too_large", bytes.length);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      capture?.(sha256, bytes);
      const stableGen = beforeStat && afterStat
        && beforeStat.dev === afterStat.dev && beforeStat.ino === afterStat.ino
        && beforeStat.ctimeMs === afterStat.ctimeMs && beforeStat.mtimeMs === afterStat.mtimeMs
        && beforeStat.size === afterStat.size && afterStat.size === bytes.length
        ? `${afterStat.dev}:${afterStat.ino}:${afterStat.ctimeMs}:${afterStat.mtimeMs}:${afterStat.size}` : "";
      if (stableGen) hashes.set(id, { size:bytes.length, mtime:afterStat.mtimeMs, gen:stableGen, sha256 });
      else if (!file.gen) hashes.set(id, { size:bytes.length, mtime:file.mtime, gen:"", sha256 });
      else hashes.delete(id);
      return { path:file.path, sha256, size:bytes.length, modified:Math.round(file.mtime) };
    }).filter(Boolean);
    const total = [...new Map(files.filter(file => !file.skipped).map(file => [file.sha256, file.size])).values()].reduce((sum, size) => sum + size, 0);
    if (total > maxBytes) throw tooBig(total);
    lastScopes.set(project.id, { inScope, files:rawWalked, at:Date.now() });
    return out.length ? [...files, ...out] : files;
  }
  const signature = files => crypto.createHash("sha256").update(JSON.stringify(files.map(file => [file.path, file.sha256]))).digest("hex");
  // Big files go alone; the rest are packed into batches.
  function batchesOf(files, sizeOf) {
    const batches = [];
    let batch = [], size = 0;
    for (const file of files) {
      if (sizeOf(file) >= BATCH_BYTES) { batches.push([file]); continue; }
      if (batch.length && (size + sizeOf(file) > BATCH_BYTES || batch.length >= BATCH_FILES)) { batches.push(batch); batch = []; size = 0; }
      batch.push(file); size += sizeOf(file);
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  // PARALLEL requests at a time; a batch cut off on the way is sent again (RETRY_MS).
  // `read` gives a file's bytes, `sent` hears of each batch stored.
  async function sendBatches(project, access, batches, read, sent = () => {}) {
    let failed = null;
    const rejected = new Map();
    // Parts Cloud has, by file, so a part cut off on the way does not send the earlier ones again.
    const partsDone = new Map();
    const sendParts = async (file, bytes) => {
      const count = Math.ceil(bytes.length / PART_BYTES);
      for (let index = partsDone.get(file.sha256) || 0; index < count; index++) {
        const part = bytes.subarray(index * PART_BYTES, (index + 1) * PART_BYTES);
        const answer = await access.request(`/blobs/${file.sha256}/parts/${index}?count=${count}&size=${bytes.length}&part=${PART_BYTES}`, { method:"PUT", bytes:part, timeoutMs:uploadTimeout(part.length) });
        if (answer?.stored) break;
        partsDone.set(file.sha256, index + 1);
      }
      partsDone.delete(file.sha256);
    };
    const sendOne = async (group, parts) => {
      if (group.length === 1 && parts[0].length >= BATCH_BYTES) {
        if (parts[0].length > PART_BYTES && Date.now() >= partsGoneUntil) {
          try { return await sendParts(group[0], parts[0]); }
          catch (error) {
            // A part Cloud lost: that file again from its first part. A Cloud from before parts (404): files go whole for an hour.
            if (error.code === "line_part_missing") { partsDone.delete(group[0].sha256); return sendParts(group[0], parts[0]); }
            if (Number(error.status) !== 404) throw error;
            partsGoneUntil = Date.now() + 60 * 60 * 1000;
          }
        }
        return access.request(`/blobs/${group[0].sha256}`, { method:"PUT", bytes:parts[0], timeoutMs:uploadTimeout(parts[0].length) });
      }
      const header = Buffer.from(JSON.stringify(group.map((file, i) => ({ sha256:file.sha256, size:parts[i].length })))), length = Buffer.alloc(4);
      length.writeUInt32BE(header.length);
      const bytes = Buffer.concat([length, header, ...parts]);
      return access.request("/blobs", { method:"POST", bytes, timeoutMs:uploadTimeout(bytes.length) });
    };
    const worker = async () => {
      while (batches.length && !failed) {
        const group = batches.shift();
        try {
          let ready = group, parts = ready.map(read);
          for (let attempt = 0; ; attempt++) {
            try { await sendOne(ready, parts); sent(ready); break; }
            catch (error) {
              const max = error.code === "line_project_too_large" && error.details?.maxFileBytes;
              const checksum = error.code === "checksum_mismatch";
              const hash = error.details?.sha256;
              const bad = new Set(ready.filter((file, index) =>
                (Number.isSafeInteger(max) && max > 0 && parts[index].length > max)
                || (checksum && (ready.length === 1 || hash === file.sha256))).map(file => file.sha256));
              if (bad.size) {
                for (const sha256 of bad) rejected.set(sha256, checksum ? "rejected" : "too_large");
                parts = parts.filter((part, index) => !bad.has(ready[index].sha256));
                ready = ready.filter(file => !bad.has(file.sha256));
                if (!ready.length || failed) break;
                continue;
              }
              if (!passing(error) || attempt >= retryMs.length || failed) throw error;
              logger?.({ type:"project-lines-cloud", event:"batch-retry", project:project.id, attempt:attempt + 1, message:error.message });
              await new Promise(resolve => setTimeout(resolve, retryMs[attempt]));
            }
          }
        } catch (error) {
          failed ||= error;
          logger?.({ type:"project-lines-cloud", event:"blob-upload-failed", project:project.id, files:group.length, status:error.status || 0, code:error.code || "" });
          return;
        }
      }
    };
    await Promise.all(Array.from({ length:PARALLEL }, worker));
    if (failed) throw failed;
    return rejected;
  }

  // Capture each blob when it is hashed. Keep at most one batch in memory and spill the rest
  // into a private temporary folder. Blob retries and the merge baseline use these same bytes.
  async function upload(project, access, onPublished) {
    access.check();
    // Old settings have a sync switch but no account. A normal round can adopt a published copy
    // under its existing key. Only an explicit enable/share may create one in an unconfirmed account.
    if (access.needsExistingCopy) {
      const head = onPublished ? null : await access.request(`?since=${Number.MAX_SAFE_INTEGER}`);
      if (!(head?.rev > 0 || head?.project?.files > 0)) {
        throw failure("SYNC_ACCOUNT_UNCONFIRMED", "This older sync has no account recorded. Sign in to the account with the published copy, or turn Keep in Cloud on to publish here.", 409);
      }
      access.check();
      if (access.owner) remember(project, {}, undefined, access.owner);
    }
    const who = account(), maxBytes = limitFor(who);
    const blobs = new Map();
    let buffered = 0, folder;
    function capture(hash, bytes) {
      if (blobs.has(hash)) return;
      if (buffered + bytes.length <= BATCH_BYTES) {
        blobs.set(hash, bytes);
        buffered += bytes.length;
      } else {
        folder ||= fs.mkdtempSync(path.join(os.tmpdir(), "penecho-upload-"));
        fs.writeFileSync(path.join(folder, hash), bytes);
        blobs.set(hash, null);
      }
    }
    const read = file => blobs.get(file.sha256) ?? fs.readFileSync(path.join(folder, file.sha256));
    progress.set(project.id, { phase:"reading", done:0, total:0, bytes:0, totalBytes:0 });
    try {
      const win = syncWindowOf(project, access);
      const files = manifest(project, maxBytes, isPlus(who) || maxBytes > FREE_BYTES, { capture, syncSince:win.syncSince, syncStartedAt:win.syncStartedAt });
      const { remote, published } = await send(project, access, files, read, onPublished ? 0 : undefined);
      access.check();
      if (onPublished) await onPublished(remote, published, read);
      return remote;
    } finally {
      if (folder) fs.rmSync(folder, { recursive:true, force:true });
    }
  }
  // A manifest to Cloud, uploading first whatever files Cloud does not have.
  async function send(project, access, files, read, baseRev) {
    const held = new Set(files.filter(file => file.skipped).map(file => file.path));
    let eligible = files.filter(file => !file.skipped), retained = [], retry = false;
    const signatureOfLocal = signature(files);
    const scopeIncomplete = lastScopes.get(project.id)?.inScope?.incomplete;
    const retain = async () => {
      if ((!held.size && !scopeIncomplete) || baseRev === 0) return;
      // A replacement snapshot must retain older Cloud copies of skipped files.
      // Fence it with the revision we read, so a concurrent Cloud edit is safe.
      const current = await access.request();
      if (current?.project !== null) {
        if (!Array.isArray(current?.files) || !Number.isSafeInteger(current.rev) || current.rev < 1) throw failure("cloud_cannot_sync", "Cloud did not send a complete file list. Nothing was replaced.", 502);
        if (baseRev !== undefined && baseRev !== current.rev) throw failure("line_project_changed", "This project changed in Cloud since you last read it.", 409);
        const accepted = scopeIncomplete ? new Set(eligible.map(file => file.path)) : null;
        retained = current.files.filter(file => held.has(file.path) || (accepted && !accepted.has(file.path)));
        baseRev = current.rev;
      }
    };
    await retain();
    let summary = null;
    const cachedScope = lastScopes.get(project.id);
    const summaryOpts = cachedScope ? { state:cachedScope.inScope?.state || null, files:cachedScope.files || null, keep:cachedScope.inScope || null } : undefined;
    try { summary = (summaryOpts ? summarize?.(project, summaryOpts) : summarize?.(project)) || null; } catch { /* The files still go; the Cloud view shows them without a map. */ }
    const details = summary ? { summary } : {};
    // A revision-zero commit creates a project and refuses to replace a revision
    // another computer published while our blobs were in flight.
    const publish = () => {
      if (baseRev === 0) {
        if (!eligible.length && held.size) throw failure("SYNC_FILES_PENDING", "No files could be uploaded yet. PenEcho will try again.", 409);
        return access.request("/commit", { method:"POST", body:{ rev:0, name:project.name, put:eligible, remove:[], ...details } });
      }
      return access.request("", { method:"PUT", body:{ name:project.name, files:[...eligible, ...retained], ...details, ...(baseRev !== undefined ? { baseRev } : {}) } });
    };
    let result;
    try { result = await publish(); }
    catch (error) {
      if (error.code !== "line_project_missing_files") throw error;
      const missing = new Set(error.details?.missing || []), queue = [];
      for (const file of eligible) if (missing.delete(file.sha256)) queue.push(file);
      if (missing.size) throw error; // A retained Cloud blob is missing; its oversized local version is not the same content.
      const state = { phase:"uploading", done:0, total:queue.length, bytes:0, totalBytes:queue.reduce((sum, file) => sum + file.size, 0) };
      progress.set(project.id, state);
      const rejected = await sendBatches(project, access, batchesOf(queue, file => file.size), read, group => { state.done += group.length; state.bytes += group.reduce((sum, file) => sum + file.size, 0); });
      if (rejected.size) {
        retry = true;
        eligible = eligible.filter(file => {
          if (!rejected.has(file.sha256)) return true;
          held.add(file.path);
          holdFile(project, file, rejected.get(file.sha256));
          return false;
        });
        await retain();
      }
      result = await publish();
    }
    if (retry) pushed.delete(project.id);
    else pushed.set(project.id, signatureOfLocal);
    errors.delete(project.id); trouble.delete(project.id);
    markSynced(project);
    return { remote:baseRev === 0 ? result : result.project, published:eligible };
  }
  // Both ways, for a project kept in Cloud (cloud-sync.js). State is kept in PenEcho's own folder, never the project's.
  // Files to Cloud before a commit names them: small ones together, large ones alone (Cloud keeps each once, by its hash).
  // The page shows how far it is ("Uploading n of N files"), as a first upload by send() does.
  async function uploadBlobs(project, files, access) {
    if (!files.length) return;
    files = [...new Map(files.map(file => [file.sha256, file])).values()];
    const state = { phase:"uploading", done:0, total:files.length, bytes:0, totalBytes:files.reduce((sum, file) => sum + file.bytes.length, 0) };
    progress.set(project.id, state);
    return sendBatches(project, access, batchesOf(files, file => file.bytes.length), file => file.bytes, group => { state.done += group.length; state.bytes += group.reduce((sum, file) => sum + file.bytes.length, 0); });
  }
  // Both ways, for a project kept in Cloud: the sync core (sync/engine.js) with this computer's folder and Cloud's routes (cloud-sync.js).
  const sync = directory ? createCloudSync({ store, directory, logger, onChanged, summarize:(project, opts) => {
    const cachedScope = opts?.fresh ? null : lastScopes.get(project.id);
    let keep = cachedScope?.inScope || null, state = cachedScope?.inScope?.state || null, files = cachedScope?.files || null;
    if (!keep && scope) {
      const win = syncWindowOf(project);
      keep = scope(project, { syncSince:win.syncSince, syncStartedAt:win.syncStartedAt, knownRemote:sync?.knownRemote?.(project) || null });
      state = keep?.state || null;
    }
    const summaryOpts = keep || state || files ? { ...(state ? { state } : {}), ...(files ? { files } : {}), ...(keep ? { keep } : {}) } : undefined;
    return (summaryOpts ? summarize?.(project, summaryOpts) : summarize?.(project)) || null;
  },
    localFiles:(project, opts) => {
      const win = syncWindowOf(project, opts?.access, { existingRemote:Boolean(opts?.existingRemote) });
      return manifest(project, Infinity, true, { withOut:true, syncSince:win.syncSince, syncStartedAt:win.syncStartedAt, knownRemote:opts?.knownRemote || null });
    },
    holdFile,
    request:(project, suffix, options, access) => access.request(suffix, options),
    download:async (project, hash, access) => {
      const response = await access.check().accountFetch(`${base(project)}/blobs/${hash}`, { timeoutMs:120_000 });
      access.check();
      if (!response.ok) throw Object.assign(new Error(`A file could not be brought down from Cloud (HTTP ${response.status}).`), { status:response.status, ...(response.status === 404 ? { code:"SYNC_BLOB_UNAVAILABLE" } : {}) });
      const bytes = Buffer.from(await response.arrayBuffer());
      access.check();
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== hash) throw Object.assign(new Error("A file from Cloud did not match its checksum."), { status:502, code:"SYNC_BLOB_UNAVAILABLE" });
      return bytes;
    },
    upload:uploadBlobs, bulk:{ files:BATCH_FILES, bytes:BATCH_BYTES },
    publishFirst:(project, onPublished, access) => upload(project, access, onPublished) }) : null;
  async function syncNow(project, access = syncAccess(project, { requireEnabled:true })) {
    access.check();
    if (!sync) return push(project, access);
    let result;
    // A first round goes through send(), which says how far its upload is; once the round ends, nothing is uploading.
    try { result = await sync.run(project, access); access.check(); }
    catch (error) { lastScopes.delete(project.id); const entry = views.get(project.id); if (entry) entry.scope = null; throw error; }
    finally { if (!running.has(project.id)) progress.delete(project.id); }
    // The project is no longer in Cloud (cloud-sync.js answers { removed:true }); a number is how many files a round removed there (PE-466).
    if (result?.removed === true) { lastScopes.delete(project.id); remember(project, { shared:false, sync:false, syncDays:undefined, syncSince:undefined, syncStartedAt:undefined }); sync.forget(project); syncedAt.delete(project.id); return result; }
    if (project.cloud?.sync && !project.cloud.owner && access.owner) remember(project, {}, undefined, access.owner);
    errors.delete(project.id); trouble.delete(project.id);
    const cached = lastScopes.get(project.id);
    lastScopes.delete(project.id);
    if (result?.changed) { const entry = views.get(project.id); if (entry) entry.scope = null; }
    let freshScope = null;
    if (!result?.stale) {
      freshScope = !result?.changed && cached && Date.now() - cached.at < SCOPE_REUSE_MS ? cached : null;
      markSynced(project);
      pushViewSoon(project, result?.rev, freshScope ? { keep:freshScope.inScope, files:freshScope.files, at:freshScope.at } : { keep:null });
    }
    // A round that did not do what the lists said, to keep the person's files: they hear what happened, on the project's Cloud panel.
    const notice = noticeOf(result);
    if (notice) { notices.set(project.id, { text:notice, at:Date.now() }); logger?.({ type:"project-lines-cloud", event:"sync-guard", project:project.id, kept:result.kept || 0, restored:result.restored || 0, remade:Boolean(result.remade) }); }
    // Asks held while their line worked elsewhere go once it is free: each round asks again.
    try { await (freshScope ? onSynced(project, { files:freshScope.files }) : onSynced(project)); } catch { /* A held Ask waits for the next round. */ }
    return result;
  }
  // One push per project at a time; a second asks the first to finish.
  async function push(project, access = syncAccess(project)) {
    if (running.has(project.id)) return running.get(project.id);
    const job = upload(project, access).catch(error => { noteError(project, error); throw error; }).finally(() => { running.delete(project.id); progress.delete(project.id); });
    running.set(project.id, job);
    return job;
  }

  // link: the full address readers open, on the Cloud this computer signed in to.
  function activity(project, who = account()) {
    const omitted = [...(skipped.get(project.id)?.values() || [])];
    // Files over the size limit never go; the rest are tried again next round. Said apart, so "PenEcho will try again" is never said
    // of a file that will not go.
    const over = omitted.filter(file => file.reason === "too_large" && file.size > MAX_FILE), later = omitted.filter(file => !over.includes(file));
    const named = list => `${list.slice(0, 3).map(file => `${L.fromCloud(file.path)}${file.size == null ? "" : ` (${mb(file.size)})`}`).join(", ")}${list.length > 3 ? `, and ${list.length - 3} more` : ""}`;
    const skipNotice = omitted.length ? [
      over.length ? `${over.length === 1 ? "1 file is" : `${over.length} files are`} over ${mb(MAX_FILE)} and ${over.length === 1 ? "stays" : "stay"} on this computer: ${named(over)}.` : "",
      later.length ? `${later.length === 1 ? "1 file was" : `${later.length} files were`} skipped; PenEcho will try again: ${named(later)}.` : "",
      "Skipping a transfer does not delete either copy.",
    ].filter(Boolean).join(" ") : "";
    const notice = [skipNotice, notices.get(project.id)?.text].filter(Boolean).join(" ");
    const accountVersion = who ? crypto.createHmac("sha256", activitySecret).update(JSON.stringify([sessionEpoch, who.id || who.email || who.name || ""])).digest("hex") : "";
    return { signedIn:Boolean(who), name:who?.name || "", accountVersion, ...settings(project),
      progress:progress.get(project.id) || null, error:running.has(project.id) ? "" : errors.get(project.id) || "", notice:running.has(project.id) ? null : noticeFor(project), syncedAt:syncedAtFor(project),
      skipped:omitted.map(file => ({ ...file, path:L.fromCloud(file.path) })),
      ...(notice ? { notice, ...(!skipNotice && notices.has(project.id) ? { noticeAt:notices.get(project.id).at } : {}) } : {}) };
  }
  function view(project, remote, who) {
    const origin = cloud().status().origin || "", share = remote?.share || null;
    return { ...activity(project, who), plus:isPlus(who), remote:remote || null, origin, link:share && origin ? `${origin}${share.url}` : "", maxBytes:limitFor(who) };
  }
  async function status(project) {
    const who = account();
    if (!who) return view(project, null, null);
    let remote = null, statusError = "";
    try {
      const access = syncAccess(project), before = project.cloud;
      remote = (await access.request()).project;
      access.check();
      // Stopped elsewhere, or the copy was removed: this computer follows Cloud.
      if (project.cloud === before && !running.has(project.id) && !sync?.pending(project)) {
        if (project.cloud && !remote && (!sync || sync.rev(project) > 0)) remember(project, { shared:false, sync:false, syncDays:undefined, syncSince:undefined, syncStartedAt:undefined }, remote);
        else if (remote && project.cloud?.shared && !remote.share) remember(project, { shared:false }, remote);
        else if (remote && project.cloud) remember(project, {}, remote);
      }
    } catch (error) { remote = null; statusError = error.message || "PenEcho Cloud did not answer."; }
    const statusView = view(project, remote, who);
    return statusError ? { ...statusView, error:statusView.error || statusError, statusError } : statusView;
  }
  const requireAccount = () => {
    const who = account();
    if (!who) throw failure("SIGN_IN", "Sign in to PenEcho Cloud to share or keep this project.", 401);
    return who;
  };
  // Sharing keeps the project in the user's Cloud space, where it keeps following the folder.
  async function share(project, { syncDays } = {}) {
    const who = requireAccount();
    const requested = parseSyncDays(syncDays);
    const access = syncAccess(project);
    // Asking for a revision at or above Cloud's current one returns only its number.
    // An interrupted first upload can leave a project row at revision zero.
    const revision = () => access.request(`?since=${Number.MAX_SAFE_INTEGER}`);
    const published = head => head.rev > 0 || head.project?.files > 0;
    let window = null, joinedExisting = false;
    if (!published(await revision())) {
      const pending = sync?.pending(project);
      if (pending) {
        window = activeWindows.get(project.id) || null;
      } else {
        window = resolveFirstSyncWindow(project, requested, { firstPublish:true });
        if (window) access.syncWindow = window;
      }
      try {
        const first = await (pending || syncNow(project, access));
        if (first?.removed) {
          const second = await syncNow(project, access);
          joinedExisting = Boolean(second?.joinedExisting);
        } else {
          joinedExisting = Boolean(first?.joinedExisting);
        }
      } catch (error) {
        // A concurrent publication may have finished despite this round's error.
        const head = await revision().catch(() => null);
        if (!head) throw error;
        if (!published(head)) {
          // Older share-only servers have no commit route. Only bootstrap an absent
          // or visibly empty copy through their original upload route.
          const legacy = error.code === "cloud_cannot_sync" && (head.project?.files === 0 && head.rev === undefined
            || head.project === null && error.cause?.status === 404);
          if (!legacy) throw error;
          await push(project, access);
        }
      }
      // Save sync + first-sync window as soon as publication finishes, so a failed /share call or restart never loses it.
      const saveWindow = window && !(joinedExisting && window.implicit) ? persistWindow(window) : null;
      if (saveWindow && !project.cloud?.sync) {
        access.check();
        remember(project, { sync:true, ...saveWindow }, undefined, access.owner);
      }
    } else if (!project.cloud?.sync && requested !== undefined) {
      window = firstSyncWindow(requested);
    }
    const remote = (await access.request("/share", { method:"POST", body:{} })).project;
    access.check();
    const windowPatch = window && !(joinedExisting && window.implicit) && project.cloud?.syncDays === undefined ? persistWindow(window) : {};
    remember(project, { shared:true, sync:true, ...windowPatch }, remote, access.owner);
    return view(project, remote, who);
  }
  async function stopSharing(project) {
    const who = requireAccount();
    const access = syncAccess(project);
    const remote = (await access.request("/share", { method:"DELETE" })).project;
    access.check();
    remember(project, { shared:false }, remote);
    return view(project, remote, who);
  }
  async function setSync(project, on, { syncDays } = {}) {
    const who = requireAccount();
    const requested = on ? parseSyncDays(syncDays) : undefined;
    const access = syncAccess(project);
    let remote = null, window = null, joinedExisting = false;
    if (on) {
      window = resolveFirstSyncWindow(project, requested);
      if (window) { access.syncWindow = window; activeWindows.set(project.id, window); }
      // The person starts a new try: the last try's error is not shown beside its progress; this try says its own.
      errors.delete(project.id);
      if (sync && !progress.has(project.id)) progress.set(project.id, { phase:"reading", done:0, total:0, bytes:0, totalBytes:0 });
      try {
        let result = await syncNow(project, access);
        if (result?.removed === true) result = await syncNow(project, access);
        joinedExisting = Boolean(result?.joinedExisting);
        remote = (await access.request()).project || null;
      }
      catch (error) {
        access.check();
        // Cloud's own answer (a fourth project on a free account: project_limit) goes to the page as it came.
        if (error.code === "project_limit") throw passOn(error);
        // The connection dropped part way: the switch stays on, and the round each minute carries on from what Cloud already has.
        if (!sync || (!passing(error) && error.code !== "SYNC_FILES_PENDING")) { noteError(project, error); throw error; }
        noteError(project, error, passing(error) ? cutOff(error) : error.message);
        logger?.({ type:"project-lines-cloud", event:"first-sync-paused", project:project.id, message:error.message });
        remote = await access.request().then(answer => answer.project || null).catch(() => null);
        access.check();
        const windowPatch = window && !(joinedExisting && window.implicit) ? persistWindow(window) : {};
        remember(project, { sync:true, ...windowPatch }, undefined, access.owner);
        return view(project, remote, who);
      }
      finally {
        if (activeWindows.get(project.id) === window) activeWindows.delete(project.id);
      }
    } else {
      if (project.cloud?.shared) throw failure("SHARED", "Stop sharing first. A shared project stays in Cloud.", 409);
      // A copy of a Cloud project stops syncing and leaves that project alone: it is the original, made on penecho.ai or another computer.
      // Block new transfers immediately. A request already sent may still commit, so order DELETE
      // after those writes. Old reads, retries and queued rounds can finish without issuing writes.
      const gate = access.gate;
      gate.stopping = access;
      dropView(project.id);
      try {
        await Promise.allSettled([...gate.writes]);
        access.check();
        if (!project.cloud?.key) { await access.request("", { method:"DELETE" }); sync?.forget(project); }
        remember(project, { sync:false }, null);
      } finally {
        gate.version++;
        gate.stopping = null;
      }
      return view(project, null, who);
    }
    access.check();
    const windowPatch = window && !(joinedExisting && window.implicit) ? persistWindow(window) : {};
    remember(project, { sync:true, ...windowPatch }, remote, access.owner);
    return view(project, remote, who);
  }
  // Who is signed in on this computer, for the account button on every Lines page.
  function accountView() {
    let who = null, origin = "";
    try { who = account(); origin = cloud().status().origin || ""; } catch { /* Still starting. */ }
    const workspace = who?.workspace || null;
    return { signedIn:Boolean(who), name:who?.name || "", plan:isPlus(who) ? (who.membership.tier === "pro" ? "Pro" : "Plus") : who ? "Free" : "", origin,
      storage:workspace?.storageLimitBytes ? { used:Number(workspace.storageUsedBytes || 0), limit:Number(workspace.storageLimitBytes) } : null };
  }
  async function signOut() {
    sessionEpoch++;
    syncedAt.clear();
    lastScopes.clear();
    for (const id of [...views.keys()]) dropView(id);
    await cloud().signOut();
    return accountView();
  }

  // What the person reads when the connection to Cloud dropped during a round: it is not their files that failed.
  const cutOff = () => "The connection to PenEcho Cloud dropped. PenEcho carries on by itself within a minute; what was sent stays in Cloud.";
  // Sync trouble the person is told of (PE-581). Owner: "if sync error, user should know. but not every sync error notify user, which
  // would be very very annoying". A dropped connection or a busy Cloud is tried again each minute and said nothing of, unless it lasts
  // LASTING_MS; anything the person has to act on (too many files, too big, signed out, removed from Cloud, a plan limit) is told at
  // once. Told once per trouble: the notice keeps its id while the trouble stays the same, and a good round clears it.
  const LASTING_MS = 15 * 60_000;
  const NETWORK = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);
  const brief = error => passing(error) || NETWORK.has(error?.code) || NETWORK.has(error?.cause?.code) || /fetch failed|network|socket hang up/i.test(String(error?.message || ""));
  function noteError(project, error, message = error?.message || "Sync failed.") {
    errors.set(project.id, message);
    const short = brief(error), code = short ? "unreachable" : String(error?.code || error?.status || "sync_failed"), had = trouble.get(project.id);
    trouble.set(project.id, { code, message, brief:short, since:had?.code === code ? had.since : Date.now() });
  }
  function noticeFor(project, now = Date.now()) {
    const t = trouble.get(project.id);
    if (!t || (t.brief && now - t.since < LASTING_MS)) return null;
    return { id:`${t.code}:${t.since}`, since:t.since, message:t.brief ? "PenEcho Cloud could not be reached for a while. PenEcho keeps trying by itself." : t.message };
  }
  // Kept projects follow their folder: a change is in Cloud within a minute or so.
  async function tick() {
    let session;
    try { checkOwner(); session = sessionSnapshot(); } catch { return; }
    if (!session) {
      // Signed out with projects set to sync: nothing reaches Cloud until the person signs in again, which only they can do.
      for (const project of store.projects) if (project.cloud?.sync && !trouble.has(project.id)) noteError(project, { code:"signed_out" }, "Signed out of PenEcho Cloud. Sign in to keep this project in step.");
      return;
    }
    for (const project of store.projects) {
      try { checkSession(session); } catch { return; }
      if (!project.cloud?.sync && !project.cloud?.shared) continue;
      try {
        if (sync && project.cloud?.sync) { await syncNow(project); continue; }
        const access = syncAccess(project, { requireEnabled:true });
        if (signature(manifest(project, limitFor(account()))) === pushed.get(project.id)) continue;
        await push(project, access);
      } catch (error) {
        noteError(project, error, passing(error) ? cutOff(error) : error.message);
        logger?.({ type:"project-lines-cloud", event:"push-failed", project:project.id, message:error.message });
      }
    }
  }
  const timer = setInterval(() => { tick(); }, PUSH_EVERY_MS);
  timer.unref?.();

  // ---------- Cloud projects from this computer (B3) ----------
  const requireSigned = () => { if (!account()) throw failure("SIGN_IN", "Sign in to PenEcho Cloud first.", 401); return cloud(); };
  const raw = async (pathname, options) => {
    const response = await requireSigned().accountFetch(pathname, options);
    const text = await response.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* Not JSON. */ }
    if (!response.ok) throw Object.assign(new Error(body?.message || `PenEcho Cloud answered HTTP ${response.status}.`), { status:response.status, code:body?.error || "cloud_request_failed", details:body?.details });
    return body;
  };
  // The account button: plan, credits and kept projects, each left out (null) when Cloud does not answer.
  let accountRefreshedAt = 0;
  async function accountSummary() {
    const view = accountView();
    if (!view.signedIn) return { ...view, plan:"", credits:null, kept:null };
    let plan = null, credits = null, kept = null, storage = null;
    try {
      const summary = await raw("/api/v1/credits/summary");
      // What the account's projects and My Canvases use now, from Cloud, not the figure kept since sign-in (E2E L4).
      if (Number.isFinite(Number(summary?.kept?.bytes)) && Number(summary?.kept?.maxBytes) > 0) storage = { used:Number(summary.kept.bytes), limit:Number(summary.kept.maxBytes) };
      if (PLANS.has(summary?.plan)) plan = summary.plan;
      if (Number.isFinite(Number(summary?.available))) credits = { available:Number(summary.available) };
      if (summary?.kept) kept = { projects:Number(summary.kept.projects) || 0, limit:summary.kept.limit ?? null };
    } catch { /* Older Cloud: the parts below. */ }
    if (!credits) { try { const wallet = await raw("/api/v1/credits"), left = wallet?.availableCredits ?? wallet?.available ?? wallet?.balance; if (Number.isFinite(Number(left))) credits = { available:Number(left) }; } catch { /* Left out. */ } }
    if (!kept) { try { kept = (await cloud().cloudRequest("/api/v1/device-sync/line-projects"))?.kept || null; } catch { /* Left out. */ } }
    // A Cloud that does not say: the account is asked again in the background, at most once a minute, so the next read has it.
    if (!storage && Date.now() - accountRefreshedAt > 60_000) { accountRefreshedAt = Date.now(); Promise.resolve().then(() => cloud().library?.(new URLSearchParams({ limit:"1", previews:"0" }))).catch(() => {}); }
    const who = account(), tier = who?.membership?.plan || who?.membership?.tier;
    return { ...view, ...(storage ? { storage } : {}), plan:plan || (PLANS.has(tier) ? tier : "free"), credits, kept };
  }
  // The account's Lines projects in Cloud, each saying whether a project on this computer syncs to it.
  async function cloudProjects() {
    requireSigned();
    const listed = await cloud().cloudRequest("/api/v1/device-sync/line-projects");
    // A Cloud project is the one here whose Cloud key it is (a copy of a Cloud project), or whose id it is (made here: Cloud knows it by
    // that id), whether or not it syncs just now. Matching only projects that sync listed a project twice whenever its setting was off,
    // or lost (another PenEcho writing the same projects.json): once here, and again as only in Cloud.
    const here = new Map();
    for (const p of store.projects) { if (!here.has(p.id)) here.set(p.id, p); if (p.cloud?.key) here.set(p.cloud.key, p); }
    for (const p of store.projects) if (p.cloud?.sync) here.set(keyOf(p), p);
    return {
      projects:(listed?.projects || []).filter(p => !p.system).map(p => {
        // Cloud-only projects (cloudMade) live only on penecho.ai and link to the web from local; never match them as local copies.
        const local = p.cloudMade ? null : here.get(p.key) || null;
        return {
          key:p.key, name:p.name, lines:p.lines ?? null, sizeBytes:Number(p.sizeBytes) || 0, updatedAt:p.updatedAt,
          ...(p.cloudMade ? { cloudMade:true } : {}),
          ...(p.archived ? { archived:true } : {}),
          here:Boolean(local),
          ...(local ? { id:local.id, syncing:Boolean(local.cloud?.sync) } : {}),
        };
      }),
      kept:listed?.kept?.projects ?? null, limit:listed?.kept?.limit ?? null,
    };
  }
  // A project only in Cloud, used through Cloud: the request goes to Cloud's /api/v1/line-projects/:key/<rest> as it came, and so does the answer.
  async function passThrough(req, res, key, rest, search, readBody) {
    if (!KEY.test(key) || rest.split("/").some(part => part === ".." || part === ".")) throw failure("BAD_PATH", "That is not a Cloud project.", 400);
    const method = req.method, body = ["GET", "HEAD"].includes(method) ? undefined : await readBody();
    const response = await requireSigned().accountFetch(`/api/v1/line-projects/${encodeURIComponent(key)}${rest ? `/${rest}` : ""}${search || ""}`, { method, body, headers:{ "content-type":req.headers["content-type"] || "", accept:req.headers.accept || "" }, timeoutMs:120_000 });
    const bytes = Buffer.from(await response.arrayBuffer()), headers = { "cache-control":"no-store", "x-content-type-options":"nosniff" };
    for (const name of ["content-type", "content-disposition"]) { const value = response.headers.get(name); if (value) headers[name] = value; }
    res.writeHead(response.status, { ...headers, "content-length":bytes.length });
    res.end(bytes);
  }
  // "Keep a copy on this computer": a local project in its own folder, every file brought down, and both kept in step from then on.
  async function copyToComputer(key, { folder = "", docsBase = "" } = {}) {
    if (!KEY.test(String(key || ""))) throw failure("BAD_PATH", "That is not a Cloud project.", 400);
    const session = sessionSnapshot();
    if (!session) throw failure("SIGN_IN", "Sign in to PenEcho Cloud first.", 401);
    checkOwner();
    const known = store.projects.find(p => p.cloud?.sync && keyOf(p) === key && (!p.cloud.owner || p.cloud.owner === session.owner));
    if (known) return { project:known, existed:true };
    const remote = await checkSession(session).cloudRequest(`/api/v1/device-sync/line-projects/${encodeURIComponent(key)}`);
    checkSession(session);
    if (!remote?.project) throw failure("NOT_FOUND", "That project is not in your PenEcho Cloud.", 404);
    let docs = folder;
    if (!docs) { const at = path.join(docsBase, String(remote.project.name || "Project").replace(/[\/:*?"<>|\0]+/g, "-").slice(0, 80) || "Project"); docs = at; for (let n = 2; fs.existsSync(docs) || store.projects.some(p => p.docsPath === docs); n++) docs = `${at} ${n}`; }
    docs = store.checkNewFolder(docs);
    fs.mkdirSync(docs, { recursive:true });
    // The knowledge (.knowledge/ in Cloud, layout.js) waits for the first round: written now, under layout-1 names, a Topic would be read
    // as a Line. Left out of what is agreed, the round brings it down under today's names once the folder is in today's layout.
    const temporary = { id:"", docsPath:docs, cloud:{ key } }, files = (remote.files || []).filter(file => !String(file.path).startsWith(".knowledge/"));
    for (const file of files) {
      const response = await checkSession(session).accountFetch(`/api/v1/device-sync/line-projects/${encodeURIComponent(key)}/blobs/${file.sha256}`, { timeoutMs:120_000 });
      if (!response.ok) throw failure("CLOUD_FAILED", `${file.path} could not be brought down (HTTP ${response.status}). Nothing was kept; try again.`, 502);
      const bytes = Buffer.from(await response.arrayBuffer());
      checkSession(session);
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw failure("CLOUD_FAILED", `${file.path} did not match its checksum. Try again.`, 502);
      // Written as Cloud names it (layout 1); PenEcho moves the folder to today's layout when it opens it.
      const to = store.resolve(temporary, file.path, { forWrite:true, raw:true });
      fs.mkdirSync(path.dirname(to), { recursive:true });
      fs.writeFileSync(to, bytes);
    }
    let project;
    try { project = store.importFolder({ docsPath:docs }); }
    catch (error) { if (error.code !== "NOT_PROJECT") throw error; project = store.restoreDownloadedProject({ name:remote.project.name, docsPath:docs }); }
    project.cloud = { sync:true, key, ...(session.owner ? { owner:session.owner } : {}) };
    store.save();
    await sync?.adopt(project, { rev:remote.rev, files, later:(remote.files || []).filter(file => String(file.path).startsWith(".knowledge/")) });
    markSynced(project);
    return { project, existed:false };
  }
  // A line shown as working in Cloud (ARCHITECTURE.md, B): taken alongside a run on a project kept in Cloud, said to be still held every
  // 30 seconds while it runs, given back at its end. It decides only which computer runs an Ask sent from penecho.ai: a run started on
  // this computer never waits for it, and goes on when it is busy elsewhere or lost (PE-583).
  async function takeLine(project, slug) {
    if (!project.cloud?.sync || !account()) return null;
    try {
      const { hold } = await syncAccess(project, { requireEnabled:true }).request("/holds", { method:"POST", body:{ line:slug, where:where() }, timeoutMs:10_000 });
      return hold?.id ? { id:hold.id } : null;
    } catch (error) {
      if (error.code === "line_busy") return { busy:{ where:error.details?.where || "another computer", since:error.details?.since || "" } };
      // Cloud cannot be reached: the run starts anyway, and the two sides are merged afterwards.
      return null;
    }
  }
  // { lost:true } when Cloud says the hold is gone. A beat that cannot reach Cloud is not a loss.
  async function holdLine(project, lease) {
    try { await syncAccess(project).request(`/holds/${lease.id}/beat`, { method:"POST", body:{}, timeoutMs:10_000 }); return { lost:false }; }
    catch (error) { return { lost:error.status === 410 }; }
  }
  async function giveLine(project, lease) {
    if (lease?.id) {
      try { await syncAccess(project).request(`/holds/${lease.id}`, { method:"DELETE", timeoutMs:10_000 }); }
      catch { /* An unreachable hold expires without blocking the run. */ }
    }
    // Right after a run, its line goes across at once instead of at the next round.
    if (project.cloud?.sync && account()) await syncNow(project).catch(error => noteError(project, error));
  }
  const conflicts = project => sync ? sync.conflicts(project) : [];
  const settle = (project, body) => sync ? sync.settle(project, body) : (() => { throw failure("NOT_FOUND", "There is no choice waiting for that file.", 404); })();
  // The projects kept in step with Cloud, each with its key there and the revision both sides last agreed on (R4, computer.js).
  const synced = () => {
    try { checkOwner(); } catch { return []; }
    const owner = sessionSnapshot()?.owner;
    return sync ? store.projects.filter(p => p.cloud?.sync && (p.cloud.owner || "") === owner && !transfers.get(p)?.stopping).map(project => ({ project, key:keyOf(project), rev:sync.rev(project) })) : [];
  };
  const syncedAtFor = project => (project?.cloud?.sync ? syncedAt.get(project.id) || 0 : 0);

  const knownRemote = project => sync ? sync.knownRemote(project) : null;

  return { pushViewSoon, noticeFor, syncedAtFor, knownRemote, activity, status, share, stopSharing, setSync, push, syncNow, tick, manifest, accountView, accountSummary, cloudProjects, passThrough, copyToComputer, takeLine, holdLine, giveLine, conflicts, settle, synced, signOut, signIn, close:() => { closed = true; clearInterval(timer); for (const id of views.keys()) dropView(id); } };
}

module.exports = { createCloudShare, FREE_BYTES, PLUS_BYTES, uploadTimeout, DEFAULT_SYNC_DAYS, parseSyncDays, firstSyncWindow };
