import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;
const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_MAX_BYTES = 1024 * 1024;
const REFRESH_MAX_BYTES = 4 * 1024 * 1024;
const VERIFY_TIMEOUT_MS = 10_000;
const COMMIT_URL = "https://api.github.com/repos/public-apis/public-apis/commits/master";
const RAW_URL = sha => `https://raw.githubusercontent.com/public-apis/public-apis/${sha}/README.md`;
const REFRESH_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
const STOP_TERMS = new Set(["a", "an", "api", "apis", "for", "free", "public", "the", "to"]);
const ALIASES = new Map([
  ["节假日", ["holiday", "calendar"]],
  ["假期", ["holiday", "calendar"]],
  ["天气", ["weather", "forecast"]],
  ["汇率", ["currency", "exchange rate"]],
  ["货币", ["currency", "exchange rate"]],
  ["猫", ["cat", "cats", "animal"]],
  ["狗", ["dog", "dogs", "animal"]],
  ["图书", ["book", "books"]],
  ["书籍", ["book", "books"]],
  ["地图", ["map", "geocoding"]],
  ["新闻", ["news"]],
  ["音乐", ["music"]],
  ["电影", ["movie", "film"]],
]);
const ENTRY_KEYS = ["id", "name", "description", "category", "documentation_url", "auth", "https", "cors"];
const ENTRY_LIMITS = { id:64, name:200, description:1_000, category:200, documentation_url:2_048, auth:32, https:32, cors:64 };
const SEARCH_REMINDER = "The directory is optional; web search remains an alternative when enabled. Verify official documentation and the exact endpoint before integration.";

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function bounded(value, maximum) {
  return String(value ?? "").slice(0, maximum);
}

function decodeHtml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, match => {
    const entity = match.slice(1, -1).toLowerCase();
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    const radix = entity.startsWith("#x") ? 16 : 10;
    const number = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : match; }
    catch { return match; }
  });
}

function stripMarkdown(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, "").replace(/[*_`]/g, "")).trim();
}

function tableCells(line) {
  let value = String(line).trim();
  if (!value.includes("|")) return [];
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells = value.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
  while (cells.length > 5 && !cells.at(-1)) cells.pop();
  return cells;
}

function parseCatalogMarkdown(document, commit) {
  const entries = [];
  let category = "", inTable = false;
  for (const line of String(document).split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      category = stripMarkdown(heading[1]);
      inTable = false;
      continue;
    }
    const cells = tableCells(line);
    const normalized = cells.map(cell => stripMarkdown(cell).toLowerCase());
    if (normalized.length === 5 && normalized.join("\0") === "api\0description\0auth\0https\0cors") {
      inTable = Boolean(category);
      continue;
    }
    if (!inTable || cells.length !== 5 || cells.every(cell => /^:?-{2,}:?$/.test(cell.trim()))) continue;
    const link = cells[0].match(/^\s*\[([^\]]+)]\((https:\/\/[^\s)]+)\)\s*$/);
    if (!link) continue;
    const [description, auth, httpsValue, cors] = cells.slice(1).map(stripMarkdown);
    const documentationUrl = decodeHtml(link[2]);
    if (auth.toLowerCase() !== "no" || httpsValue.toLowerCase() !== "yes") continue;
    entries.push({
      id:createHash("sha256").update(documentationUrl).digest("hex").slice(0, 16),
      name:stripMarkdown(link[1]),
      description,
      category,
      documentation_url:documentationUrl,
      auth,
      https:httpsValue,
      cors,
    });
  }
  return {
    schema_version:SCHEMA_VERSION,
    source:{ repository:"public-apis/public-apis", commit:commit.toLowerCase(), retrieved_at:isoNow() },
    entries,
  };
}

function validHttpsUrl(value, maximum = 2_048) {
  if (typeof value !== "string" || !value || value.length > maximum || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function validateCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== SCHEMA_VERSION) {
    throw new Error("Unsupported or missing public API catalog schema.");
  }
  const source = value.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Malformed public API catalog source.");
  for (const [key, maximum] of [["repository", 200], ["commit", 128], ["retrieved_at", 64]]) {
    if (typeof source[key] !== "string" || !source[key] || source[key].length > maximum) throw new Error("Malformed public API catalog source.");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 20_000) {
    throw new Error("Public API catalog contains no usable entries.");
  }
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join("\0") !== [...ENTRY_KEYS].sort().join("\0")) {
      throw new Error("Malformed public API catalog entry.");
    }
    for (const key of ENTRY_KEYS) {
      if (typeof entry[key] !== "string" || entry[key].length > ENTRY_LIMITS[key]) throw new Error("Malformed public API catalog entry.");
    }
    if (!validHttpsUrl(entry.documentation_url) || entry.auth.toLowerCase() !== "no" || entry.https.toLowerCase() !== "yes") {
      throw new Error("Public API catalog entry violates the anonymous HTTPS policy.");
    }
  }
  return value;
}

async function readCatalog(file) {
  return validateCatalog(JSON.parse(await readFile(file, "utf8")));
}

function isStale(catalog) {
  const retrieved = Date.parse(catalog?.source?.retrieved_at);
  return !Number.isFinite(retrieved) || Date.now() - retrieved > CATALOG_MAX_AGE_MS;
}

async function atomicJsonWrite(file, value) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive:true, mode:0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function queryTerms(query) {
  const lowered = query.toLowerCase().trim();
  const terms = new Set((lowered.match(/[\p{L}\p{N}_]+/gu) || []).filter(term => !STOP_TERMS.has(term)));
  for (const [alias, expansions] of ALIASES) if (lowered.includes(alias)) for (const expansion of expansions) terms.add(expansion);
  return terms;
}

function scoreEntry(entry, terms) {
  if (!terms.size) return 0;
  const name = entry.name.toLowerCase(), category = entry.category.toLowerCase(), description = entry.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term === name) score += 14;
    else if (name.includes(term)) score += 10;
    if (term === category) score += 8;
    else if (category.includes(term)) score += 6;
    if (description.includes(term)) score += 3;
  }
  if (score && entry.cors.toLowerCase() === "yes") score++;
  return score;
}

function validateOrigin(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== value) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeEndpoint(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

function safeEndpointForStorage(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname || "/"}${parsed.search ? "?…" : ""}`;
}

function errorText(error) {
  return bounded(error?.message || error || "The public endpoint could not be reached.", 400);
}

function abortReason(signal, fallback) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error(fallback);
  error.name = "AbortError";
  return error;
}

function awaitAbortable(factory, signal, fallback = "The public data request was cancelled.") {
  if (signal?.aborted) return Promise.reject(abortReason(signal, fallback));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortReason(signal, fallback));
    signal?.addEventListener("abort", onAbort, { once:true });
    let pending;
    try { pending = factory(); }
    catch (error) { finish(reject, error); return; }
    Promise.resolve(pending).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

async function withDeadline(factory, signal, timeoutMs) {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener("abort", onCallerAbort, { once:true });
  const timeout = setTimeout(() => {
    const error = new Error("The public API directory refresh timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, timeoutMs);
  try { return await awaitAbortable(() => factory(controller.signal), controller.signal); }
  finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

function classifyFetchError(error, timedOut, callerAborted) {
  if (timedOut && !callerAborted) return "timeout";
  const code = String(error?.code || "").toUpperCase();
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  if (name.includes("timeout") || code === "ETIMEDOUT" || error?.status === 504 || message.includes("timed out")) return "timeout";
  if (Number(error?.status) === 413) return "body_too_large";
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS_") || name.includes("tls") || name.includes("certificate") || /certificate|self[- ]signed|tls|ssl|unable to verify/.test(message)) return "tls_error";
  if ([400, 403, 508].includes(Number(error?.status)) || name === "securityerror" || /private destination|private destinations|credentials|redirected too many|only public https/.test(message)) return "security_error";
  return "network_error";
}

function baseVerifyResult(url, origin) {
  return {
    url,
    final_url:null,
    checked_at:isoNow(),
    status:"network_error",
    tls:{ verified:false },
    http_status:null,
    content_type:null,
    json_type:null,
    keys:null,
    cors:{ origin, allow_origin:null, status:"not_checked", evidence:"response_header_only" },
    runtime_verified:false,
  };
}

function invalidVerifyResult(url, origin, message) {
  const result = baseVerifyResult(typeof url === "string" ? bounded(url, 2_048) : "", typeof origin === "string" ? bounded(origin, 2_048) : null);
  result.status = "security_error";
  result.error = message;
  return result;
}

export function createPublicApiDiscovery({ rootDirectory, stateDirectory, publicFetch } = {}) {
  if (typeof rootDirectory !== "string" || !rootDirectory || typeof stateDirectory !== "string" || !stateDirectory || typeof publicFetch !== "function") {
    throw new TypeError("rootDirectory, stateDirectory, and publicFetch are required.");
  }
  const bundledPath = path.join(rootDirectory, "src/server/canvas-agent/public-api-data/catalog.json");
  const cacheDirectory = path.join(stateDirectory, "public-api-discovery");
  const cachePath = path.join(cacheDirectory, "catalog.json");
  const probesPath = path.join(cacheDirectory, "probes.json");
  let catalogLoadPromise = null;
  let catalogState = null;
  let refreshPromise = null;
  let probeRecordsPromise = null;
  let probeWriteQueue = Promise.resolve();

  async function loadCatalogOnce() {
    if (catalogState) return catalogState;
    if (!catalogLoadPromise) catalogLoadPromise = (async () => {
      for (const [file, location] of [[cachePath, "cache"], [bundledPath, "bundled"]]) {
        try { return { catalog:await readCatalog(file), location }; }
        catch { /* Try the next local snapshot. */ }
      }
      return { catalog:null, location:null };
    })();
    catalogState = await catalogLoadPromise;
    return catalogState;
  }

  function checkedRefreshResponse(response, expectedHost, maximum) {
    if (!response || typeof response !== "object") throw new Error("Catalog refresh returned no response.");
    const status = Number(response.status);
    if (!Number.isInteger(status) || status < 200 || status >= 300) throw new Error(`Catalog refresh returned HTTP ${status || "error"}.`);
    const finalUrl = validHttpsUrl(String(response.finalUrl || ""), 16 * 1024);
    if (!finalUrl || finalUrl.hostname.toLowerCase() !== expectedHost || !REFRESH_HOSTS.has(finalUrl.hostname.toLowerCase())) {
      throw new Error("Catalog refresh left its pinned public host.");
    }
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? "");
    if (body.byteLength > maximum) throw new Error("Catalog refresh response is too large.");
    return body;
  }

  async function refreshCatalog(signal) {
    if (!refreshPromise) refreshPromise = (async () => {
      const catalog = await withDeadline(async refreshSignal => {
        const commitResponse = await awaitAbortable(
          () => publicFetch(COMMIT_URL, refreshSignal, { allowHttp:false, inspectResponse:true }),
          refreshSignal,
        );
        const commitBody = checkedRefreshResponse(commitResponse, "api.github.com", 256 * 1024);
        const commitPayload = JSON.parse(commitBody.toString("utf8"));
        const sha = commitPayload && typeof commitPayload === "object" ? commitPayload.sha : null;
        if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("GitHub returned an invalid catalog commit.");
        const readmeResponse = await awaitAbortable(
          () => publicFetch(RAW_URL(sha.toLowerCase()), refreshSignal, { allowHttp:false, inspectResponse:true }),
          refreshSignal,
        );
        const readme = checkedRefreshResponse(readmeResponse, "raw.githubusercontent.com", REFRESH_MAX_BYTES).toString("utf8");
        return validateCatalog(parseCatalogMarkdown(readme, sha));
      }, signal, 12_000);
      await atomicJsonWrite(cachePath, catalog);
      catalogState = { catalog, location:"cache" };
      return catalogState;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function search({ query, limit = 5, offline = false } = {}, signal) {
    if (typeof query !== "string" || !query.trim() || query.length > 200) throw new TypeError("query must be a non-empty string of at most 200 characters.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new TypeError("limit must be an integer from 1 to 10.");
    if (typeof offline !== "boolean") throw new TypeError("offline must be a boolean.");
    let state = await loadCatalogOnce();
    let warning = null;
    if (!state.catalog || isStale(state.catalog)) {
      if (offline) {
        warning = state.catalog ? "Offline mode: using the stale bundled directory." : "Offline mode: no valid public API directory is available.";
      } else {
        try { state = await refreshCatalog(signal); }
        catch (error) {
          if (!state.catalog) throw new Error(`Public API directory refresh failed and no valid snapshot is available: ${errorText(error)}`);
          warning = `Refresh failed; using the existing directory: ${errorText(error)}`;
        }
      }
    }
    if (!state.catalog) return {
      source:null,
      stale:true,
      warning,
      results:[],
      reminder:SEARCH_REMINDER,
    };
    const terms = queryTerms(query);
    const results = state.catalog.entries
      .map(entry => ({ score:scoreEntry(entry, terms), entry }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name, "en") || left.entry.id.localeCompare(right.entry.id))
      .slice(0, limit)
      .map(({ score, entry }) => ({ ...entry, score }));
    return {
      source:{ ...state.catalog.source, catalog:state.location },
      stale:isStale(state.catalog),
      warning,
      results,
      reminder:SEARCH_REMINDER,
    };
  }

  async function loadProbeRecords() {
    if (!probeRecordsPromise) probeRecordsPromise = (async () => {
      try {
        const value = JSON.parse(await readFile(probesPath, "utf8"));
        if (value?.schema_version !== 1 || !Array.isArray(value.records)) return [];
        return value.records.filter(record => record && typeof record === "object").slice(-100);
      } catch { return []; }
    })();
    return probeRecordsPromise;
  }

  async function persistProbe(criteria, result) {
    const task = probeWriteQueue.catch(() => {}).then(async () => {
      const records = await loadProbeRecords();
      const criteriaHash = createHash("sha256").update(JSON.stringify([criteria.url, criteria.origin, criteria.expectedKeys])).digest("hex");
      const record = {
        criteria_hash:criteriaHash,
        endpoint:safeEndpointForStorage(criteria.url),
        query_present:new URL(criteria.url).search.length > 0,
        origin:criteria.origin,
        expected_keys:criteria.expectedKeys,
        checked_at:result.checked_at,
        status:result.status,
        tls_verified:result.tls.verified,
        http_status:result.http_status,
        cors_status:result.cors.status,
      };
      const next = records.filter(existing => existing.criteria_hash !== criteriaHash);
      next.push(record);
      if (next.length > 100) next.splice(0, next.length - 100);
      records.splice(0, records.length, ...next);
      await atomicJsonWrite(probesPath, { schema_version:1, records });
    });
    probeWriteQueue = task;
    await task.catch(() => {});
  }

  async function verify({ url, origin, expectedKeys = [] } = {}, signal) {
    const parsedUrl = validHttpsUrl(url);
    if (!parsedUrl) return invalidVerifyResult(url, origin, "url must be a public HTTPS URL of at most 2048 characters without credentials.");
    const normalizedOrigin = validateOrigin(origin);
    if (origin !== undefined && origin !== null && !normalizedOrigin) {
      return invalidVerifyResult(url, origin, "origin must be an exact HTTP(S) origin without credentials, path, query, or fragment.");
    }
    if (!Array.isArray(expectedKeys) || expectedKeys.length > 16 || expectedKeys.some(key => typeof key !== "string" || !key || key.length > 128)) {
      return invalidVerifyResult(url, normalizedOrigin, "expectedKeys must contain at most 16 non-empty top-level key names of at most 128 characters.");
    }
    const uniqueKeys = [...new Set(expectedKeys)].sort();
    const normalizedUrl = normalizeEndpoint(parsedUrl.href);
    const result = baseVerifyResult(normalizedUrl, normalizedOrigin);
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onCallerAbort();
    else signal?.addEventListener("abort", onCallerAbort, { once:true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("The endpoint verification timed out."));
    }, VERIFY_TIMEOUT_MS);
    try {
      if (controller.signal.aborted) throw Object.assign(new Error("The endpoint verification was cancelled."), { name:"AbortError" });
      const fetchOptions = {
        allowHttp:false,
        inspectResponse:true,
        ...(normalizedOrigin ? { origin:normalizedOrigin } : {}),
      };
      const response = await awaitAbortable(
        () => publicFetch(normalizedUrl, controller.signal, fetchOptions),
        controller.signal,
        "The endpoint verification was cancelled.",
      );
      const finalUrl = validHttpsUrl(String(response?.finalUrl || ""), 16 * 1024);
      if (!finalUrl) throw Object.assign(new Error("The response did not complete on strict HTTPS."), { name:"SecurityError" });
      result.final_url = bounded(finalUrl.href, 16 * 1024);
      result.http_status = Number.isInteger(Number(response.status)) ? Number(response.status) : null;
      result.content_type = bounded(response.contentType, 200) || null;
      result.tls = { verified:true, hostname:bounded(finalUrl.hostname, 255) };
      const allowOrigin = bounded(response.corsAllowOrigin, 512) || null;
      result.cors.allow_origin = allowOrigin;
      result.cors.status = normalizedOrigin ? (["*", normalizedOrigin].includes(allowOrigin) ? "allowed" : "denied") : "not_checked";
      const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? "");
      if (body.byteLength > VERIFY_MAX_BYTES) {
        result.status = "body_too_large";
      } else if (result.http_status === null || result.http_status < 200 || result.http_status >= 300) {
        result.status = "http_error";
      } else {
        const leading = body.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
        if ((result.content_type && result.content_type.toLowerCase().includes("html")) || leading.startsWith("<!doctype html") || leading.startsWith("<html")) {
          result.status = "html_response";
        } else {
          try {
            const payload = JSON.parse(body.toString("utf8"));
            result.json_type = Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload;
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              const keys = Object.keys(payload).map(key => bounded(key, 128)).sort();
              result.keys = keys.slice(0, 30);
              result.key_count = Object.keys(payload).length;
            }
            const missing = uniqueKeys.filter(key => !payload || typeof payload !== "object" || Array.isArray(payload) || !Object.hasOwn(payload, key));
            if (missing.length) {
              result.status = "schema_mismatch";
              result.missing_keys = missing;
              result.missing_key_count = missing.length;
            } else result.status = "ok";
          } catch {
            result.status = "invalid_json";
          }
        }
      }
    } catch (error) {
      result.status = classifyFetchError(error, timedOut, Boolean(signal?.aborted));
      result.error = result.status === "timeout" ? "The endpoint verification timed out." : errorText(error);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onCallerAbort);
    }
    await persistProbe({ url:normalizedUrl, origin:normalizedOrigin, expectedKeys:uniqueKeys }, result);
    return result;
  }

  return { search, verify };
}
