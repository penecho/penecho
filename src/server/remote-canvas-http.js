"use strict";

const MAX_REMOTE_CANVAS_PATH_BYTES = 20 * 1024;
const MAX_REMOTE_CANVAS_RESPONSE_BYTES = 96 * 1024 * 1024;
const SAFE_RESPONSE_HEADERS = new Set(["x-penecho-final-url", "x-penecho-upstream-status"]);

const CANVAS_ID = "\\d{10,16}-[a-zA-Z0-9-]{8,64}";
const PROJECT_ID = "project-[a-zA-Z0-9-]{8,64}";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const ROUTES = [
  { pattern:/^\/api\/settings$/, methods:new Set(["GET"]) },
  { pattern:/^\/api\/settings\/connections$/, methods:new Set(["GET"]) },
  { pattern:/^\/api\/widget-fetch$/, methods:new Set(["GET", "POST"]), query:true },
  { pattern:/^\/api\/canvas-projects$/, methods:new Set(["GET", "POST"]) },
  { pattern:new RegExp(`^/api/canvas-projects/${PROJECT_ID}$`), methods:new Set(["DELETE"]) },
  { pattern:new RegExp(`^/api/canvases/${CANVAS_ID}/project$`), methods:new Set(["PUT"]) },
  { pattern:/^\/api\/canvases$/, methods:new Set(["GET", "POST"]) },
  { pattern:new RegExp(`^/api/canvases/${CANVAS_ID}$`), methods:new Set(["GET", "PUT", "DELETE"]) },
  { pattern:/^\/api\/plugins$/, methods:new Set(["GET", "POST"]) },
  { pattern:/^\/api\/plugins\/[a-z0-9]+(?:-[a-z0-9]+)*$/, methods:new Set(["DELETE"]) },
  { pattern:/^\/plugins\/private\/[a-z0-9][a-z0-9-]{0,63}(?:\/(?:plugin\.md|styles\.css)|\.md)$/, methods:new Set(["GET"]) },
  { pattern:/^\/api\/community\/metadata$/, methods:new Set(["POST"]) },
  { pattern:/^\/api\/favorites$/, methods:new Set(["GET", "PUT"]), query:true },
  { pattern:/^\/api\/favorites\/[0-9a-f]{64}$/, methods:new Set(["GET", "DELETE"]) },
  { pattern:/^\/api\/favorites\/[0-9a-f]{64}\/thumbnail$/, methods:new Set(["GET"]) },
  { pattern:/^\/api\/favorites\/[0-9a-f]{64}\/cloud$/, methods:new Set(["PATCH"]) },
  { pattern:/^\/api\/cloud\/favorites$/, methods:new Set(["GET", "POST"]), query:true },
  { pattern:/^\/api\/cloud\/favorites\/feed$/, methods:new Set(["GET"]), query:true },
  { pattern:new RegExp(`^/api/cloud/favorites/${UUID}$`, "i"), methods:new Set(["GET", "DELETE"]) },
  { pattern:/^\/api\/cloud\/(?:status|account|library)$/, methods:new Set(["GET"]) },
  { pattern:/^\/api\/cloud\/projects$/, methods:new Set(["POST"]) },
  { pattern:new RegExp(`^/api/cloud/projects/${UUID}$`, "i"), methods:new Set(["POST", "DELETE"]) },
  { pattern:new RegExp(`^/api/cloud/projects/${UUID}/save$`, "i"), methods:new Set(["POST"]) },
  { pattern:new RegExp(`^/api/cloud/canvases/${UUID}$`, "i"), methods:new Set(["GET", "POST", "DELETE"]) },
  { pattern:new RegExp(`^/api/cloud/canvases/${UUID}/(?:save|thumbnail)$`, "i"), methods:new Set(["GET", "POST"]) },
  { pattern:/^\/api\/cloud\/community$/, methods:new Set(["GET"]), query:true },
  { pattern:/^\/api\/cloud\/community\/share$/, methods:new Set(["POST"]) },
  { pattern:new RegExp(`^/api/cloud/community/${UUID}$`, "i"), methods:new Set(["GET"]) },
  { pattern:new RegExp(`^/api/cloud/community/${UUID}/(?:thumbnail|preview|artifact)$`, "i"), methods:new Set(["GET"]) },
  { pattern:new RegExp(`^/api/cloud/community/${UUID}/favorite$`, "i"), methods:new Set(["POST", "DELETE"]) },
  { pattern:new RegExp(`^/api/cloud/community/${UUID}/redeem$`, "i"), methods:new Set(["POST"]) },
];

function remoteCanvasTarget(method, value) {
  const requestMethod = String(method || "").toUpperCase();
  if (!new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]).has(requestMethod)) throw Object.assign(new Error("Remote Canvas method is not allowed."), { code:"remote_canvas_method", status:405 });
  const source = String(value || "");
  if (!source || Buffer.byteLength(source, "utf8") > MAX_REMOTE_CANVAS_PATH_BYTES || !source.startsWith("/")) throw Object.assign(new Error("Remote Canvas path is invalid."), { code:"remote_canvas_path", status:400 });
  const url = new URL(source, "http://penecho.local");
  if (url.origin !== "http://penecho.local" || url.hash || url.username || url.password) throw Object.assign(new Error("Remote Canvas path is invalid."), { code:"remote_canvas_path", status:400 });
  const route = ROUTES.find((candidate) => candidate.pattern.test(url.pathname));
  if (!route || !route.methods.has(requestMethod) || url.search && !route.query) throw Object.assign(new Error("Remote Canvas route is not available."), { code:"remote_canvas_route", status:404 });
  return `${url.pathname}${url.search}`;
}

function responseHeaders(response) {
  const headers = {};
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value.slice(0, 4096);
  }
  return headers;
}

function createRemoteCanvasHttpExecutor({ origin, sessionCookie, fetchImpl = global.fetch }) {
  const localOrigin = new URL(String(origin || ""));
  if (localOrigin.protocol !== "http:" || localOrigin.hostname !== "127.0.0.1" || localOrigin.pathname !== "/") throw new Error("Remote Canvas executor requires the loopback PenEcho origin.");
  const cookie = String(sessionCookie || "");
  if (!cookie) throw new Error("Remote Canvas executor requires a local session cookie.");
  return async function executeRemoteCanvasHttp(input, timeoutMs) {
    if (!input || input.operation !== "canvas.http" || !input.request) throw Object.assign(new Error("Remote Canvas request is invalid."), { code:"remote_canvas_request", status:400 });
    const method = String(input.request.method || "GET").toUpperCase();
    const target = remoteCanvasTarget(method, input.request.path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(10_000, Math.min(Number(timeoutMs) || 210_000, 240_000)));
    try {
      const hasBody = !["GET", "HEAD"].includes(method) && input.request.body !== undefined;
      const response = await fetchImpl(`${localOrigin.origin}${target}`, {
        method,
        redirect:"error",
        signal:controller.signal,
        headers:{
          accept:"application/json, text/plain, image/webp;q=0.9, */*;q=0.5",
          origin:localOrigin.origin,
          cookie,
          ...(hasBody ? { "content-type":"application/json" } : {}),
        },
        body:hasBody ? JSON.stringify(input.request.body) : undefined,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_REMOTE_CANVAS_RESPONSE_BYTES) throw Object.assign(new Error("Remote Canvas response is too large."), { code:"remote_canvas_response_too_large", status:413 });
      const contentType = String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
      const result = { status:response.status, contentType, headers:responseHeaders(response) };
      if (contentType === "application/json") {
        try { result.body = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; }
        catch { throw Object.assign(new Error("Local PenEcho returned invalid JSON."), { code:"remote_canvas_invalid_response", status:502 }); }
      } else if (contentType.startsWith("text/") || ["application/javascript", "image/svg+xml"].includes(contentType)) {
        result.body = bytes.toString("utf8");
      } else {
        result.body = bytes.toString("base64");
        result.encoding = "base64";
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { MAX_REMOTE_CANVAS_RESPONSE_BYTES, createRemoteCanvasHttpExecutor, remoteCanvasTarget };
