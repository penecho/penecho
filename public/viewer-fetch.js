"use strict";

// Use the ordinary Widget public-data channel. The server owns the same queue,
// timeout and response-size policy as the local Canvas; View adds no quotas.
(() => {
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  const MAX_URL_LENGTH = 16 * 1024;
  window.PenEchoViewerFetch = {
    install({ itemId, live = false, fetch: fetchData = window.fetch.bind(window) }) {
      const requests = new Map(), controllers = new Set();
      let stopped = false;
      function owns(source) {
        return [...document.querySelectorAll(".canvas-widget .canvas-widget-frame")].some(frame => {
          if (frame.contentWindow !== source) return false;
          try {
            const url = new URL(frame.src, location.href);
            return url.origin === location.origin && url.pathname === "/canvas/widget-host.html";
          } catch { return false; }
        });
      }
      async function download(url) {
        const controller = new AbortController();
        controllers.add(controller);
        // Covers the canonical server's 30-second queue plus 12-second fetch.
        const timer = setTimeout(() => controller.abort(), 45_000);
        try {
          const response = await fetchData(`${live ? `/api/v1/shares/${itemId}` : `/api/v1/community/items/${itemId}`}/widget-fetch?url=${encodeURIComponent(url)}`, {
            method:"GET", credentials:"omit", cache:"no-store", signal:controller.signal,
          });
          if (!response.ok) throw Error(`Public data is temporarily unavailable (${response.status}).`);
          if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw Error("The public data response is too large.");
          const reader = response.body?.getReader();
          let body;
          if (reader) {
            const chunks = []; let total = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw Error("The public data response is too large."); }
              chunks.push(value);
            }
            const joined = new Uint8Array(total); let offset = 0;
            for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
            body = joined.buffer;
          } else {
            body = await response.arrayBuffer();
            if (body.byteLength > MAX_RESPONSE_BYTES) throw Error("The public data response is too large.");
          }
          const headers = {};
          for (const name of ["content-type", "x-penecho-upstream-status", "x-penecho-final-url"]) {
            const value = response.headers.get(name);
            if (value) headers[name] = value;
          }
          return { status:response.status, headers, body };
        } finally {
          clearTimeout(timer);
          controllers.delete(controller);
        }
      }
      function get(url) {
        if (requests.has(url)) return requests.get(url);
        const promise = download(url);
        requests.set(url, promise);
        promise.finally(() => requests.delete(url)).catch(() => {});
        return promise;
      }
      function receive(event) {
        const message = event.data;
        if (stopped || event.origin !== location.origin || !event.source || !owns(event.source)
          || message?.type !== "penecho-widget-host-public-fetch"
          || typeof message.requestId !== "string" || !/^widget-fetch-\d{1,16}$/.test(message.requestId)
          || typeof message.url !== "string" || message.url.length > MAX_URL_LENGTH) return;
        let url;
        try { url = new URL(message.url); } catch { return; }
        if (url.protocol !== "https:" || url.username || url.password) return;
        url.hash = "";
        const reply = (payload, transfer = []) => {
          if (!stopped && owns(event.source)) event.source.postMessage({ type:"penecho-widget-host-public-fetch-result", requestId:message.requestId, ...payload }, location.origin, transfer);
        };
        get(url.href).then(result => {
          const body = result.body.slice(0);
          reply({ status:result.status, headers:result.headers, body }, [body]);
        }, error => reply({ error:String(error.message || "Public data is unavailable.").slice(0, 300) }));
      }
      function close() {
        stopped = true;
        window.removeEventListener("message", receive);
        window.removeEventListener("pagehide", pagehide);
        for (const controller of controllers) controller.abort();
        requests.clear();
      }
      function pagehide(event) { if (!event.persisted) close(); }
      window.addEventListener("message", receive);
      window.addEventListener("pagehide", pagehide);
      return { close };
    },
  };
})();
