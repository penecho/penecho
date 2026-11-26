"use strict";

// The part of page pictures and of the agents' browser that needs Electron's windows. Their rules, queues and files stay with the
// server in its own process (src/server/project-lines/browser-engine.js, page-picture.js); this only does what it asks for.

const SAFE_URL = /^(?:data|about):/i;
const EVENT_LIMITS = { console:100, consoleErrors:100, pageErrors:100, requestFailures:60 };

function attachBrowserHost(link, {
  picture = (...args) => require("../src/server/project-lines/page-picture.js").desktopPicture(...args),
  createAdapter = () => { const { ElectronAdapter } = require("../src/server/project-lines/browser-engine.js"); return new ElectronAdapter({}); },
} = {}) {
  const contexts = new Map();
  let adapter = null;

  link.handle("picture", ({ page, width, height, check }) => picture(page, { width, height }, check));

  // What the page says goes on to the server as it comes, no more of it than the server keeps.
  function watch(id, context) {
    const sinks = () => Object.fromEntries(Object.entries(EVENT_LIMITS).map(([kind, limit]) => [kind, {
      length:0,
      push(value) { this.length++; link.notify("browser-event", { context:id, kind, value, limit }); },
    }]));
    let status = context.status ?? null;
    context.events = sinks();
    context.emptied = () => { context.events = sinks(); };
    Object.defineProperty(context, "status", { enumerable:true, get:() => status, set(value) { status = value; link.notify("browser-status", { context:id, status }); } });
  }
  function contextOf(id) {
    const context = contexts.get(id);
    if (!context) throw Object.assign(new Error("That browser page is gone."), { code:"BAD_SESSION", status:404 });
    return context;
  }
  async function finish(id, action) {
    const context = contexts.get(id);
    if (!context) return;
    contexts.delete(id);
    await adapter[action](context);
  }
  const actions = {
    async create({ context:id, proxy, sessionId, viewport }) {
      adapter ||= createAdapter();
      // Pages of the app's own (data:, about:) are always allowed and can be large: they are not sent over to be asked about.
      const policy = url => SAFE_URL.test(url) || link.request("browser-policy", { context:id, url });
      const context = await adapter.create({ policy, proxy, sessionId, viewport });
      if (!link.open()) { await adapter.dispose(context); return; }
      watch(id, context);
      contexts.set(id, context);
    },
    navigate:({ context:id, url, waitUntil, timeoutMs }, signal) => { const context = contextOf(id); return adapter.navigate(context, url, waitUntil, timeoutMs, signal); },
    evaluate:({ context:id, expression, timeoutMs }) => { const context = contextOf(id); return adapter.evaluate(context, expression, timeoutMs); },
    viewport:({ context:id, viewport }) => { const context = contextOf(id); return adapter.setViewport(context, viewport); },
    press:({ context:id, key }) => { const context = contextOf(id); return adapter.press(context, key); },
    capture:({ context:id, screenshot, timeoutMs }) => { const context = contextOf(id); return adapter.capture(context, screenshot, timeoutMs); },
    reset:({ context }) => finish(context, "reset"),
    dispose:({ context }) => finish(context, "dispose"),
    "close-pool":() => adapter?.closePool(),
    async close() { contexts.clear(); await adapter?.close(); },
  };
  link.handle("browser", async ({ action, ...params }, { signal } = {}) => {
    if (!Object.hasOwn(actions, action)) throw new Error(`Unknown browser request: ${action}`);
    try { return await actions[action](params, signal); }
    finally { if (adapter) link.notify("browser-pooled", { pooled:adapter.pooled() }); }
  });
  link.handle("browser-events", ({ context }) => { contexts.get(context)?.emptied(); });
  // The server has gone: nobody will ask for these pages again.
  link.onClose(() => { contexts.clear(); void adapter?.close().catch(() => {}); });
}

module.exports = { attachBrowserHost };
