"use strict";
(() => {
  const MAX_HTML_LENGTH = 200000,
    MAX_PLUGIN_STYLES_LENGTH = 32000,
    MAX_SNAPSHOT_DIMENSION = 2400,
    MAX_SNAPSHOT_PIXELS = 4800000,
    HIGH_RESOLUTION_SNAPSHOT_SCALE = 1.5,
    MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION = 3600,
    MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS = 10800000,
    MAX_SNAPSHOT_DATA_URL_LENGTH = 28 * 1024 * 1024,
    MAX_HIGH_RESOLUTION_SNAPSHOT_DATA_URL_LENGTH = 64 * 1024 * 1024,
    SNAPSHOT_REQUEST_TIMEOUT_MS = 18000,
    UPDATE_FORWARD_INTERVAL_MS = 2000,
    PUBLIC_FETCH_MAX_URL_LENGTH = 16 * 1024,
    accessSession = (() => {
      const value = new URL(location.href).searchParams.get("access-session") || "";
      return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : "";
    })(),
    requestedParentOrigin = new URL(location.href).searchParams.get("parent-origin"),
    parentOrigin = (() => {
      try {
        return new URL(requestedParentOrigin).origin === requestedParentOrigin ? requestedParentOrigin : location.origin;
      } catch {
        return location.origin;
      }
    })(),
    rendererUrl = widgetRendererUrl(),
    visualExplainerVendorUrl = new URL("visual-explainer-vendor.js?v=0.2.20", location.href).href,
    visualExplorerManimWebUrl = new URL("visual-explorer-manim-web/manim-web.browser.js?v=0.3.24", location.href).href,
    visualExplorerManimMathJaxUrl = new URL("visual-explorer-manim-web/MathJaxBundle-xSidSV0E.js?v=0.3.24", location.href).href,
    authoredManimWebUrl = "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js",
    visualExplainerRuntimeUrl = new URL("visual-explainer-runtime.js?v=3", location.href).href,
    remoteCanvas = new URL(location.href).searchParams.get("remote-canvas") === "1",
    snapshotDebugEnabled = remoteCanvas && (() => {
      try {
        return new URL(parent.location.href).searchParams.get("widget-snapshot-debug") === "1";
      } catch {
        return false;
      }
    })(),
    snapshotDebugId = snapshotDebugEnabled ? Math.random().toString(36).slice(2, 10) : "",
    publicFetchUrl = new URL("api/widget-fetch", location.href).href,
    connect = new URL(location.href).searchParams.getAll("connect"),
    inner = document.createElement("iframe");
  let mcpProgressState = null;
  let initialized = false,
    lastUpdate = 0,
    forwardedDragPointer = null,
    queuedDragMove = null,
    dragMoveFrame = 0,
    runtimeVersion = 0,
    innerDocumentReady = false,
    widgetState = { selected:false, active:true, maximized:false, navigationLocked:false, scaleX:1, scaleY:1 };
  const pendingSnapshots = new Map();

  function widgetRendererUrl() {
    const value = document.querySelector('meta[name="penecho-widget-renderer-version"]')?.getAttribute("content") || "",
      version = /^[a-f0-9]{12}$/.test(value) ? value : "";
    return new URL(`widget-renderer.js${version ? `?v=${version}` : ""}`, location.href).href;
  }

  function snapshotDebugLog(stage, details = {}) {
    if (!snapshotDebugEnabled) return;
    console.info("[WSNAP]", JSON.stringify({
      time:Number((typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now()).toFixed(1)),
      layer:"host",
      instance:snapshotDebugId,
      stage,
      runtimeVersion,
      initialized,
      innerDocumentReady,
      pendingSnapshots:pendingSnapshots.size,
      ...details,
    }));
  }

  inner.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  inner.setAttribute("title", "Dynamic canvas widget");
  inner.addEventListener("load", forwardWidgetState);
  inner.addEventListener("load", () => snapshotDebugLog("inner-frame-load"));
  document.body.append(inner);
  snapshotDebugLog("host-start");
  function runtime(runtimeVersion, scienceMode = false, domRendererUrl = "", snapshotDebugEnabled = false, snapshotDebugId = "", mcpPreviewMode = false) {
    const UPDATED = "penecho-widget-updated",
      DRAG_START = "penecho-widget-drag-start",
      DRAG_MOVE = "penecho-widget-drag-move",
      DRAG_END = "penecho-widget-drag-end",
      TOUCH_START = "penecho-widget-touch-start",
      TOUCH_END = "penecho-widget-touch-end",
      PUBLIC_FETCH_REQUEST = "penecho-widget-public-fetch-request",
      PUBLIC_FETCH_RESPONSE = "penecho-widget-public-fetch-response",
      RUNTIME_DIAGNOSTICS = "penecho-widget-runtime-diagnostics",
      MAX_RUNTIME_ERRORS = 5,
      MOVE_TOLERANCE_PX = 8,
      CONTROL_RADIUS_PX = 26,
      CONTROL_EDGE_PX = 14,
      CONTROL_CORNER_PX = 32,
      MAX_SNAPSHOT_DIMENSION = 2400,
      MAX_SNAPSHOT_PIXELS = 4800000,
      HIGH_RESOLUTION_SNAPSHOT_SCALE = 1.5,
      MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION = 3600,
      MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS = 10800000,
      SNAPSHOT_GENERATED_PSEUDOS = [
        { selector:"::before", placement:"prepend" },
        { selector:"::after", placement:"append" },
      ],
      PUBLIC_FETCH_MAX_URL_LENGTH = 16 * 1024;
    let widgetState = { selected:false, active:true, maximized:false, navigationLocked:false, scaleX:1, scaleY:1 },
      widgetStateReceived = false,
      suppressClickUntil = 0;
    const presses = new Map(),
      publicFetchRequests = new Map(),
      imageFallbackAttempts = new WeakMap(),
      imageFallbackReplays = new WeakSet(),
      pausedAnimations = new WeakSet(),
      pausedSvgRoots = new WeakSet(),
      pendingAnimationFrames = new Map(),
      nativeAnimationFrames = new Map(),
      nativeRequestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis),
      nativeCancelAnimationFrame = globalThis.cancelAnimationFrame.bind(globalThis),
      nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
      nativeOpen = typeof globalThis.open === "function" ? globalThis.open.bind(globalThis) : null;
    let runtimeActive = true,
      nextAnimationFrameId = 1,
      nextPublicFetchId = 1,
      rendererLoadPromise = null,
      diagnosticsTimer = 0,
      diagnosticsTruncated = false;
    const runtimeErrors = new Map();
    const clock = () => typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
    function snapshotDebugLog(stage, details = {}) {
      if (!snapshotDebugEnabled) return;
      console.info("[WSNAP]", JSON.stringify({
        time:Number(clock().toFixed(1)),
        layer:"inner",
        instance:snapshotDebugId,
        stage,
        runtimeVersion,
        ...details,
      }));
    }
    globalThis.__penechoSnapshotDebug = snapshotDebugLog;
    snapshotDebugLog("runtime-installed", { scienceMode, rendererAvailable:typeof globalThis.html2canvas === "function" });
    function diagnosticText(value, maxLength) {
      return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
    }
    function diagnosticFile(value) {
      const text = diagnosticText(value, 600);
      if (!text) return "widget.html";
      try {
        const url = new URL(text, location.href);
        if (url.protocol === "blob:" || url.href === location.href) return "widget.html";
        url.search = "";
        url.hash = "";
        return url.href.slice(0, 300);
      } catch {
        return text.slice(0, 300);
      }
    }
    function diagnosticStack(error) {
      return String(error?.stack || "").split(/\r?\n/).slice(1, 4).map(line => diagnosticText(line, 300)
        .replace(/blob:[^\s)]+/g, "widget.html")
        .replace(/https:\/\/[^\s)]+/g, value => diagnosticFile(value))).filter(Boolean);
    }
    function loadSnapshotRenderer(timeoutMs = 8000) {
      const available = globalThis.html2canvas;
      if (typeof available === "function") return Promise.resolve(available);
      if (rendererLoadPromise) return rendererLoadPromise;
      snapshotDebugLog("renderer-reload-start", { timeoutMs });
      rendererLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          const renderer = globalThis.html2canvas;
          if (!error && typeof renderer === "function") {
            snapshotDebugLog("renderer-reload-success");
            resolve(renderer);
          }
          else {
            script.remove();
            snapshotDebugLog("renderer-reload-error", { error:String(error?.message || "Widget renderer is unavailable").slice(0, 300) });
            reject(error || Error("Widget renderer is unavailable"));
          }
        }, timer = setTimeout(() => finish(Error("Widget renderer load timed out")), Math.max(500, Math.min(8000, Number(timeoutMs) || 8000)));
        script.src = domRendererUrl;
        script.async = true;
        script.onload = () => finish();
        script.onerror = () => finish(Error("Widget renderer failed to load"));
        document.head.append(script);
      }).finally(() => {
        rendererLoadPromise = null;
      });
      return rendererLoadPromise;
    }
    function sendRuntimeDiagnostics() {
      diagnosticsTimer = 0;
      parent.postMessage({
        type:RUNTIME_DIAGNOSTICS,
        runtimeVersion,
        errors:[...runtimeErrors.values()],
        truncated:diagnosticsTruncated,
      }, "*");
    }
    function recordRuntimeError(details) {
      const error = {
          kind:details.kind,
          name:diagnosticText(details.name, 80) || "Error",
          message:diagnosticText(details.message, 400) || "JavaScript runtime error",
          file:diagnosticFile(details.file),
          line:Number.isInteger(details.line) && details.line >= 0 ? Math.min(details.line, 10000000) : 0,
          column:Number.isInteger(details.column) && details.column >= 0 ? Math.min(details.column, 10000000) : 0,
          repeatedCount:1,
          stack:diagnosticStack(details.error),
        },
        key = error.line || error.column
          ? [error.file, error.line, error.column].join("\0")
          : [error.kind, error.name, error.file, error.message].join("\0"),
        existing = runtimeErrors.get(key);
      if (existing) {
        existing.repeatedCount = Math.min(1000000, existing.repeatedCount + 1);
        if (!diagnosticsTimer) diagnosticsTimer = setTimeout(sendRuntimeDiagnostics, 100);
        return;
      }
      if (runtimeErrors.size >= MAX_RUNTIME_ERRORS) {
        if (diagnosticsTruncated) return;
        diagnosticsTruncated = true;
      } else runtimeErrors.set(key, error);
      if (!diagnosticsTimer) diagnosticsTimer = setTimeout(sendRuntimeDiagnostics, 100);
    }
    addEventListener("error", (event) => {
      if (beginImageFallback(event)) return;
      const target = event.target;
      if (target && target !== globalThis && String(target.tagName || "").toUpperCase() === "SCRIPT") {
        recordRuntimeError({
          kind:"script-load",
          name:"ScriptLoadError",
          message:`Failed to load JavaScript: ${diagnosticFile(target.src)}`,
          file:target.src,
          line:0,
          column:0,
        });
        return;
      }
      if (target && target !== globalThis) return;
      recordRuntimeError({
        kind:"error",
        name:event.error?.name || "Error",
        message:event.message || event.error?.message,
        file:event.filename,
        line:Number(event.lineno),
        column:Number(event.colno),
        error:event.error,
      });
    }, true);
    addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      recordRuntimeError({
        kind:"unhandledrejection",
        name:reason?.name || "UnhandledRejection",
        message:reason?.message || reason,
        file:"widget.html",
        line:0,
        column:0,
        error:reason,
      });
    });
    function publicHttpsLink(value) {
      try {
        const url = new URL(String(value || ""), document.baseURI);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
      } catch {
        return "";
      }
    }
    function prepareOutboundLink(anchor) {
      const href = publicHttpsLink(anchor?.getAttribute?.("href"));
      if (!href) return false;
      anchor.setAttribute("href", href);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.setAttribute("referrerpolicy", "no-referrer");
      anchor.removeAttribute("download");
      anchor.removeAttribute("ping");
      return true;
    }
    if (nativeOpen) {
      const safeOpen = (value) => {
        const href = publicHttpsLink(value);
        return href ? nativeOpen(href, "_blank", "noopener,noreferrer") : null;
      };
      try { Object.defineProperty(globalThis, "open", { value:safeOpen, configurable:false, writable:false }); }
      catch { try { globalThis.open = safeOpen; } catch {} }
    }
    globalThis.penechoFetchPublic = (value) => {
      const url = String(value || "");
      if (!url || url.length > PUBLIC_FETCH_MAX_URL_LENGTH) return Promise.reject(Error("A public HTTPS URL is required"));
      const requestId = `public-fetch-${nextPublicFetchId++}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          publicFetchRequests.delete(requestId);
          reject(Error("The public data request timed out"));
        }, 50000);
        publicFetchRequests.set(requestId, { resolve, reject, timer });
        parent.postMessage({ type:PUBLIC_FETCH_REQUEST, requestId, url }, "*");
      });
    };
    function publicFetchFallbackUrl(input, init) {
      try {
        const request = typeof Request === "function" && input instanceof Request ? input : null,
          method = String(init?.method || request?.method || "GET").toUpperCase(),
          signal = init?.signal || request?.signal;
        if (method !== "GET" || init?.body != null || signal?.aborted) return "";
        const credentials = String(init?.credentials || request?.credentials || "omit").toLowerCase();
        if (!["omit", "same-origin"].includes(credentials)) return "";
        const headers = new Headers(init?.headers || request?.headers || undefined);
        if (headers.has("authorization") || headers.has("cookie")) return "";
        return publicHttpsLink(request?.url || input);
      } catch {
        return "";
      }
    }
    function imageFallbackUrl(image) {
      return publicHttpsLink(image?.currentSrc || image?.getAttribute?.("src") || image?.src);
    }
    function replayImageError(image) {
      imageFallbackReplays.add(image);
      try { image.dispatchEvent?.(new Event("error")); }
      finally { imageFallbackReplays.delete(image); }
    }
    async function proxyImageFallback(image, sourceUrl) {
      try {
        const response = await globalThis.penechoFetchPublic(sourceUrl);
        if (!response.ok) throw Error(`Image request failed with status ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw Error("Image response was empty");
        const currentUrl = imageFallbackUrl(image);
        if (currentUrl && currentUrl !== sourceUrl) return;
        const objectUrl = URL.createObjectURL(blob);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          URL.revokeObjectURL(objectUrl);
        };
        image.addEventListener?.("load", release, { once:true });
        image.addEventListener?.("error", release, { once:true });
        image.removeAttribute?.("srcset");
        image.removeAttribute?.("crossorigin");
        if (String(image.parentElement?.tagName || "").toUpperCase() === "PICTURE") {
          for (const source of image.parentElement.querySelectorAll?.("source[srcset]") || []) source.removeAttribute("srcset");
        }
        image.src = objectUrl;
      } catch {
        if (imageFallbackUrl(image) === sourceUrl) replayImageError(image);
      }
    }
    function beginImageFallback(event) {
      const image = event?.target;
      if (!image || String(image.tagName || "").toUpperCase() !== "IMG" || imageFallbackReplays.has(image)) return false;
      const sourceUrl = imageFallbackUrl(image);
      if (!sourceUrl || imageFallbackAttempts.get(image) === sourceUrl) return false;
      imageFallbackAttempts.set(image, sourceUrl);
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      void proxyImageFallback(image, sourceUrl);
      return true;
    }
    if (nativeFetch) {
      const directFirstFetch = async (input, init) => {
        try {
          const response = await nativeFetch(input, init);
          if (response.ok) return response;
          const url = publicFetchFallbackUrl(input, init);
          if (!url) return response;
          try { return await globalThis.penechoFetchPublic(url); }
          catch { return response; }
        } catch (error) {
          const url = publicFetchFallbackUrl(input, init);
          if (!url) throw error;
          return globalThis.penechoFetchPublic(url);
        }
      };
      try { Object.defineProperty(globalThis, "fetch", { value:directFirstFetch, configurable:false, writable:false }); }
      catch { try { globalThis.fetch = directFirstFetch; } catch {} }
    }
    function scheduleAnimationFrame(id) {
      const callback = pendingAnimationFrames.get(id);
      if (!callback || !runtimeActive || nativeAnimationFrames.has(id)) return;
      const nativeId = nativeRequestAnimationFrame((timestamp) => {
        nativeAnimationFrames.delete(id);
        if (!runtimeActive || !pendingAnimationFrames.has(id)) return;
        pendingAnimationFrames.delete(id);
        callback(timestamp);
      });
      nativeAnimationFrames.set(id, nativeId);
    }
    globalThis.requestAnimationFrame = (callback) => {
      if (typeof callback !== "function") throw new TypeError("requestAnimationFrame callback must be a function");
      const id = nextAnimationFrameId++;
      pendingAnimationFrames.set(id, callback);
      scheduleAnimationFrame(id);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      pendingAnimationFrames.delete(id);
      const nativeId = nativeAnimationFrames.get(id);
      if (nativeId === undefined) return;
      nativeAnimationFrames.delete(id);
      nativeCancelAnimationFrame(nativeId);
    };
    function clearHoldTimer(press) {
      if (!press?.timer) return;
      clearTimeout(press.timer);
      press.timer = 0;
    }
    function pointerMessage(type, source) {
      if (!source) return;
      parent.postMessage({
        type,
        pointerId:source.pointerId,
        pointerType:source.pointerType,
        hit:source.hit,
        localX:source.clientX,
        localY:source.clientY,
        screenX:source.screenX,
        screenY:source.screenY,
      }, "*");
    }
    function touchCount() {
      let count = 0;
      for (const press of presses.values()) if (press.pointerType === "touch") count++;
      return count;
    }
    function controlHit(clientX, clientY, pointerType) {
      if (!widgetState.selected) return null;
      const scaleX = Math.max(.0001, Number(widgetState.scaleX) || 1),
        scaleY = Math.max(.0001, Number(widgetState.scaleY) || 1),
        width = Math.max(1, document.documentElement.clientWidth),
        height = Math.max(1, document.documentElement.clientHeight),
        rightDistance = (width - clientX) * scaleX,
        bottomDistance = (height - clientY) * scaleY,
        edge = pointerType === "touch" ? CONTROL_RADIUS_PX * 2 : CONTROL_EDGE_PX,
        corner = pointerType === "touch" ? CONTROL_RADIUS_PX * 2 : CONTROL_CORNER_PX;
      if (rightDistance >= 0 && rightDistance <= corner && bottomDistance >= 0 && bottomDistance <= corner) return "resize";
      if (rightDistance >= 0 && rightDistance <= edge && clientY >= 0 && clientY <= height) return "width";
      if (bottomDistance >= 0 && bottomDistance <= edge && clientX >= 0 && clientX <= width) return "height";
      return null;
    }
    const RESIZE_CURSOR_CLASSES = ["penecho-widget-resize-width", "penecho-widget-resize-height", "penecho-widget-resize-corner"];
    function setControlCursor(hit = null) {
      for (const className of RESIZE_CURSOR_CLASSES) document.documentElement.classList.remove(className);
      if (hit === "width") document.documentElement.classList.add(RESIZE_CURSOR_CLASSES[0]);
      else if (hit === "height") document.documentElement.classList.add(RESIZE_CURSOR_CLASSES[1]);
      else if (hit === "resize") document.documentElement.classList.add(RESIZE_CURSOR_CLASSES[2]);
      return hit;
    }
    function capturePointer(press) {
      if (press.captured) return;
      try {
        document.documentElement.setPointerCapture(press.pointerId);
        press.captured = true;
      } catch {}
    }
    function activateHold(press) {
      if (!press || press.active) return;
      press.timer = 0;
      press.active = true;
      suppressClickUntil = clock() + 1000;
      capturePointer(press);
      try { document.getSelection()?.removeAllRanges(); } catch {}
      setControlCursor(press.hit);
      document.documentElement.classList.add("penecho-widget-dragging");
      pointerMessage(DRAG_START, press);
    }
    function cancelAllHoldsForNavigation() {
      for (const press of presses.values()) {
        clearHoldTimer(press);
        press.navigation = true;
      }
    }
    function finishPress(event, cancelled = false) {
      const press = presses.get(event.pointerId);
      if (!press || press.finishing) return;
      press.finishing = true;
      clearHoldTimer(press);
      for (const key of ["clientX", "clientY", "screenX", "screenY"]) {
        const value = Number(event[key]);
        if (Number.isFinite(value)) press[key] = value;
      }
      const tapped = press.pointerType === "touch" && !cancelled && !press.active && !press.navigation
        && Math.hypot(press.screenX - press.startX, press.screenY - press.startY) <= MOVE_TOLERANCE_PX
        && touchCount() === 1;
      if (press.active) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        pointerMessage(DRAG_END, { ...press, cancelled });
        suppressClickUntil = clock() + 650;
      }
      if (tapped) parent.postMessage({
        type:"penecho-widget-activate",
        pointerId:press.pointerId,
        pointerType:press.pointerType,
        localX:press.clientX,
        localY:press.clientY,
        screenX:press.screenX,
        screenY:press.screenY,
      }, "*");
      if (press.pointerType === "touch") pointerMessage(TOUCH_END, { ...press, cancelled });
      presses.delete(event.pointerId);
      if (press.captured) try { document.documentElement.releasePointerCapture(press.pointerId); } catch {}
      if (![...presses.values()].some((item) => item.active)) document.documentElement.classList.remove("penecho-widget-dragging");
      if (press.pointerType !== "touch") setControlCursor(controlHit(press.clientX, press.clientY, press.pointerType));
    }
    addEventListener("pointerdown", (event) => {
      if (widgetState.interactive) return;
      if (presses.has(event.pointerId) || Number(event.button) !== 0 || !["mouse", "pen", "touch"].includes(event.pointerType)) return;
      const hit = controlHit(Number(event.clientX), Number(event.clientY), event.pointerType);
      if (event.pointerType !== "touch" && !hit) {
        parent.postMessage({
          type:"penecho-widget-activate",
          pointerId:event.pointerId,
          pointerType:event.pointerType,
          localX:Number(event.clientX),
          localY:Number(event.clientY),
          screenX:Number(event.screenX),
          screenY:Number(event.screenY),
        }, "*");
        return;
      }
      const press = {
        pointerId:event.pointerId,
        pointerType:event.pointerType,
        clientX:Number(event.clientX),
        clientY:Number(event.clientY),
        startX:Number(event.screenX),
        startY:Number(event.screenY),
        screenX:Number(event.screenX),
        screenY:Number(event.screenY),
        hit,
        active:false,
        navigation:false,
        captured:false,
        timer:0,
      };
      if (![press.clientX, press.clientY, press.startX, press.startY].every(Number.isFinite)) return;
      presses.set(event.pointerId, press);
      if (press.pointerType === "touch") {
        pointerMessage(TOUCH_START, press);
        if (touchCount() >= 2) cancelAllHoldsForNavigation();
      }
      if (press.hit && touchCount() < 2) {
        activateHold(press);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture:true, passive:false });
    addEventListener("pointermove", (event) => {
      if (widgetState.interactive) return;
      const press = presses.get(event.pointerId);
      if (!press) {
        if (event.pointerType !== "touch") setControlCursor(controlHit(Number(event.clientX), Number(event.clientY), event.pointerType));
        return;
      }
      const clientX = Number(event.clientX), clientY = Number(event.clientY), screenX = Number(event.screenX), screenY = Number(event.screenY);
      if (![clientX, clientY, screenX, screenY].every(Number.isFinite)) return;
      press.clientX = clientX;
      press.clientY = clientY;
      press.screenX = screenX;
      press.screenY = screenY;
      if (press.active) {
        if (press.pointerType === "mouse" && (Number(event.buttons) & 1) === 0) {
          finishPress(event);
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        pointerMessage(DRAG_MOVE, press);
        return;
      }
      const moved = Math.hypot(screenX - press.startX, screenY - press.startY) > MOVE_TOLERANCE_PX;
      if (press.pointerType === "touch" && (moved || touchCount() >= 2)) {
        clearHoldTimer(press);
        press.navigation = true;
        return;
      }
    }, { capture:true, passive:false });
    addEventListener("pointerup", (event) => finishPress(event), { capture:true, passive:false });
    addEventListener("pointercancel", (event) => finishPress(event, true), { capture:true, passive:false });
    addEventListener("lostpointercapture", (event) => {
      if (widgetState.interactive) return;
      if (presses.has(event.pointerId)) finishPress({ pointerId:event.pointerId }, true);
    }, { capture:true });
    addEventListener("blur", () => {
      for (const press of [...presses.values()]) finishPress({ pointerId:press.pointerId }, true);
    });
    addEventListener("click", (event) => {
      if (!widgetState.interactive && suppressClickUntil && clock() <= suppressClickUntil) {
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      suppressClickUntil = 0;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || prepareOutboundLink(anchor)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    addEventListener("contextmenu", (event) => {
      if (widgetState.interactive) return;
      if (!presses.size && (!suppressClickUntil || clock() > suppressClickUntil)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    function notifyReady() {
      parent.postMessage({ type: UPDATED, loaded:true, runtimeVersion }, "*");
    }
    function setRuntimeActive(active) {
      if (runtimeActive !== active) {
        runtimeActive = active;
        if (active) {
          for (const id of pendingAnimationFrames.keys()) scheduleAnimationFrame(id);
        } else {
          for (const nativeId of nativeAnimationFrames.values()) nativeCancelAnimationFrame(nativeId);
          nativeAnimationFrames.clear();
        }
      }
      if (active) {
        document.documentElement.classList.remove("penecho-widget-paused");
        for (const animation of document.getAnimations()) {
          if (!pausedAnimations.has(animation)) continue;
          pausedAnimations.delete(animation);
          try { animation.play(); } catch {}
        }
        for (const svg of document.querySelectorAll("svg")) {
          if (!pausedSvgRoots.has(svg)) continue;
          pausedSvgRoots.delete(svg);
          try { svg.unpauseAnimations(); } catch {}
        }
        return;
      }
      for (const animation of document.getAnimations()) {
        if (animation.playState !== "running") continue;
        try {
          animation.pause();
          pausedAnimations.add(animation);
        } catch {}
      }
      for (const svg of document.querySelectorAll("svg")) {
        if (typeof svg.pauseAnimations !== "function" || svg.animationsPaused?.()) continue;
        try {
          svg.pauseAnimations();
          pausedSvgRoots.add(svg);
        } catch {}
      }
      document.documentElement.classList.add("penecho-widget-paused");
    }
    function notifyVisibleViewport() {
      try { dispatchEvent(new Event("resize")); } catch {}
    }
    function inlineSvgComputedStyles() {
      const properties = [
          "fill", "fill-opacity", "fill-rule",
          "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
          "color", "opacity", "visibility", "display",
          "font-family", "font-size", "font-style", "font-weight",
          "text-anchor", "dominant-baseline", "paint-order",
          "marker-start", "marker-mid", "marker-end",
          "stop-color", "stop-opacity",
          "transform", "transform-origin", "transform-box",
          "filter", "clip-path", "mask",
        ],
        records = [],
        backgrounds = [];
      for (const svg of document.querySelectorAll("svg")) {
        const background = getComputedStyle(svg).backgroundColor;
        if (background && background !== "transparent" && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(background) && !/\/\s*0(?:\.0+)?\s*\)$/.test(background)) {
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("data-penecho-snapshot-background", "");
          rect.setAttribute("x", "0");
          rect.setAttribute("y", "0");
          rect.setAttribute("width", "100%");
          rect.setAttribute("height", "100%");
          rect.setAttribute("fill", background);
          svg.insertBefore(rect, svg.firstChild);
          backgrounds.push(rect);
        }
        for (const element of [svg, ...svg.querySelectorAll("*")]) {
          const computed = getComputedStyle(element),
            styles = [];
          for (const property of properties) {
            const value = computed.getPropertyValue(property).trim();
            if (!value) continue;
            styles.push([property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
            element.style.setProperty(property, value, "important");
          }
          if (styles.length) records.push([element, styles]);
        }
      }
      return () => {
        for (const [element, styles] of records) {
          for (const [property, value, priority] of styles) {
            if (value) element.style.setProperty(property, value, priority);
            else element.style.removeProperty(property);
          }
        }
        for (const background of backgrounds) background.remove();
      };
    }
    let snapshotColorCanvas = null,
      snapshotColorContext = null;
    const snapshotColorCache = new Map(),
      unsupportedSnapshotColor = /\b(?:color|lab|lch|oklab|oklch|hwb)\([^()]*\)/gi;
    function snapshotLegacyColor(value) {
      if (!value) return value;
      if (!snapshotColorContext) {
        if (typeof document.createElement !== "function") return value;
        snapshotColorCanvas = document.createElement("canvas");
        snapshotColorCanvas.width = snapshotColorCanvas.height = 1;
        snapshotColorContext = snapshotColorCanvas.getContext("2d", { willReadFrequently:true });
      }
      if (!snapshotColorContext) return value;
      if (snapshotColorCache.has(value)) return snapshotColorCache.get(value);
      snapshotColorContext.clearRect(0, 0, 1, 1);
      snapshotColorContext.fillStyle = "rgba(0,0,0,0)";
      snapshotColorContext.fillStyle = value;
      snapshotColorContext.fillRect(0, 0, 1, 1);
      const [red, green, blue, alphaByte] = snapshotColorContext.getImageData(0, 0, 1, 1).data,
        alpha = Math.round(alphaByte / 255 * 1000) / 1000,
        result = alphaByte === 255 ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      snapshotColorCache.set(value, result);
      return result;
    }
    function snapshotCompatibleCssValue(value) {
      unsupportedSnapshotColor.lastIndex = 0;
      return value.replace(unsupportedSnapshotColor, snapshotLegacyColor);
    }
    function inlineSnapshotCompatibleColors() {
      const properties = [
          "color", "background-color", "background-image",
          "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
          "outline-color", "text-decoration-color", "column-rule-color",
          "box-shadow", "text-shadow",
          "fill", "stroke", "stop-color", "flood-color", "lighting-color",
        ],
        records = [];
      for (const element of [document.documentElement, ...document.querySelectorAll("*")]) {
        const computed = getComputedStyle(element),
          styles = [];
        for (const property of properties) {
          const value = computed.getPropertyValue(property).trim();
          unsupportedSnapshotColor.lastIndex = 0;
          if (!value || !unsupportedSnapshotColor.test(value)) continue;
          const compatible = snapshotCompatibleCssValue(value);
          if (compatible === value) continue;
          styles.push([property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
          element.style.setProperty(property, compatible, "important");
        }
        if (styles.length) records.push([element, styles]);
      }
      return () => {
        for (const [element, styles] of records) {
          for (const [property, value, priority] of styles) {
            if (value) element.style.setProperty(property, value, priority);
            else element.style.removeProperty(property);
          }
        }
      };
    }
    function snapshotPseudoContentText(value, element) {
      const source = String(value || "").trim();
      if (!source || ["none", "normal", "-moz-alt-content"].includes(source)) return null;
      if (source === '""' || source === "''") return "";
      const attribute = source.match(/^attr\(\s*([^\s)]+)\s*\)$/i);
      if (attribute) return element.getAttribute?.(attribute[1]) || "";
      let result = "",
        matched = false;
      source.replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, (_match, _quote, text) => {
        matched = true;
        result += text.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_escape, hex, escaped) => {
          if (hex) {
            const codePoint = Number.parseInt(hex, 16);
            return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "�";
          }
          return escaped || "";
        });
        return _match;
      });
      return matched ? result : "";
    }
    function materializeSnapshotGeneratedContent() {
      const inserted = [],
        customInputs = [],
        elements = [document.documentElement, ...document.querySelectorAll("*")];
      const restore = () => {
        for (const node of inserted) node.remove();
        for (const [element, previous] of customInputs) {
          if (previous === null) element.removeAttribute("data-penecho-snapshot-custom-input");
          else element.setAttribute("data-penecho-snapshot-custom-input", previous);
        }
      };
      try {
        for (const element of elements) {
          if (!element || element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
          const inputStyles = element.tagName === "INPUT" && ["checkbox", "radio"].includes(element.type)
            ? getComputedStyle(element) : null,
            customInput = inputStyles?.getPropertyValue("appearance") === "none";
          let carrier = null;
          if (customInput) {
            customInputs.push([element, element.getAttribute("data-penecho-snapshot-custom-input")]);
            element.setAttribute("data-penecho-snapshot-custom-input", "");
          }
          for (const pseudo of SNAPSHOT_GENERATED_PSEUDOS) {
            let computed;
            try {
              computed = getComputedStyle(element, pseudo.selector);
            } catch {
              continue;
            }
            const content = snapshotPseudoContentText(computed?.getPropertyValue("content"), element);
            if (content === null || computed.getPropertyValue("display") === "none" || computed.getPropertyValue("visibility") === "hidden") continue;
            const node = document.createElement("penecho-snapshot-pseudo");
            node.setAttribute("data-penecho-snapshot-pseudo", pseudo.selector.slice(2));
            node.setAttribute("aria-hidden", "true");
            node.textContent = content;
            for (let index = 0; index < computed.length; index++) {
              const property = computed.item(index);
              if (!property || property === "content") continue;
              const propertyValue = computed.getPropertyValue(property);
              if (propertyValue) node.style.setProperty(property, propertyValue, "important");
            }
            node.style.setProperty("animation", "none", "important");
            node.style.setProperty("transition", "none", "important");
            node.style.setProperty("pointer-events", "none", "important");
            if (customInput && !carrier) {
              // Void inputs cannot render child nodes. Keep the live control in
              // place and give its generated content an adjacent containing box.
              carrier = document.createElement("penecho-snapshot-input");
              carrier.setAttribute("aria-hidden", "true");
              for (let index = 0; index < inputStyles.length; index++) {
                const property = inputStyles.item(index), value = inputStyles.getPropertyValue(property);
                if (value) carrier.style.setProperty(property, value, "important");
              }
              const styles = {
                position:"absolute", left:`${element.offsetLeft}px`, top:`${element.offsetTop}px`,
                right:"auto", bottom:"auto", margin:"0", "box-sizing":"border-box",
                width:`${element.offsetWidth}px`, height:`${element.offsetHeight}px`,
                "min-width":"0", "min-height":"0", "max-width":"none", "max-height":"none",
                "background-color":"transparent", "background-image":"none", "border-color":"transparent",
                "box-shadow":"none", outline:"none", "pointer-events":"none", animation:"none", transition:"none",
              };
              for (const [property, value] of Object.entries(styles)) carrier.style.setProperty(property, value, "important");
              // Appending preserves author selectors such as input:checked + label.
              element.parentNode.appendChild(carrier);
              inserted.push(carrier);
            }
            const target = carrier || element;
            if (pseudo.placement === "prepend") target.insertBefore(node, target.firstChild);
            else target.appendChild(node);
            inserted.push(node);
          }
        }
      } catch (error) {
        restore();
        throw error;
      }
      return restore;
    }
    function flushSnapshotAnimationFrame() {
      // Offscreen iframes can have native rAF suspended even while active. Flush
      // one existing frame for this explicit capture, never a recurring timer.
      // Freeze the IDs so callbacks queued by this frame wait for the next one.
      const ids = [...pendingAnimationFrames.keys()], timestamp = clock();
      let flushed = 0;
      for (const id of ids) {
        const callback = pendingAnimationFrames.get(id);
        if (!callback) continue; // An earlier callback may cancel a later one.
        pendingAnimationFrames.delete(id);
        const nativeId = nativeAnimationFrames.get(id);
        if (nativeId !== undefined) {
          nativeAnimationFrames.delete(id);
          nativeCancelAnimationFrame(nativeId);
        }
        flushed++;
        try { callback(timestamp); }
        catch (error) {
          // Match native rAF: report a callback error and continue the frame.
          if (typeof globalThis.reportError === "function") globalThis.reportError(error);
          else recordRuntimeError({ kind:"error", name:error?.name, message:error?.message || String(error), file:"widget.html", error });
        }
      }
      snapshotDebugLog("snapshot-frame-flushed", { callbacks:flushed, runtimeActive });
    }
    function settleSnapshotFrame() {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (presented) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          nativeCancelAnimationFrame(frame);
          if (!presented) flushSnapshotAnimationFrame();
          resolve(presented);
        },
          timer = setTimeout(() => finish(false), 50);
        const frame = nativeRequestAnimationFrame(() => finish(true));
      });
    }
    function waitForSnapshotViewport(width, height, timeoutMs) {
      // Maximized presentation has its own live viewport. The requested size
      // remains the canvas snapshot's output size, not a resize instruction.
      const matches = () => widgetState.maximized || (Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1);
      if (matches()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = (error) => { clearTimeout(timer); removeEventListener("resize", resized); error ? reject(error) : resolve(); },
          resized = () => { if (matches()) finish(); },
          timer = setTimeout(() => finish(Error("Preview viewport did not finish resizing before capture")), Math.min(1000, timeoutMs));
        addEventListener("resize", resized);
        resized();
      });
    }
    function captureDirectRendererStyleMutations() {
      if (typeof MutationObserver !== "function" || !document.documentElement) return () => {};
      const originalStyles = new Map(),
        remember = (records) => {
          for (const record of records) if (!originalStyles.has(record.target)) originalStyles.set(record.target, record.oldValue);
        },
        observer = new MutationObserver(remember);
      observer.observe(document.documentElement, {
        subtree:true,
        attributes:true,
        attributeFilter:["style"],
        attributeOldValue:true,
      });
      return () => {
        remember(observer.takeRecords());
        observer.disconnect();
        for (const [element, value] of originalStyles) {
          if (value === null) element.removeAttribute("style");
          else element.setAttribute("style", value);
        }
      };
    }
    function imageFromUrl(url, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const image = new Image(),
          finish = (error) => {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            if (error) reject(error);
            else resolve(image);
          },
          timer = setTimeout(() => finish(Error("SVG snapshot decoding timed out")), timeoutMs);
        image.onload = () => finish();
        image.onerror = () => finish(Error("SVG snapshot could not be decoded"));
        image.src = url;
      });
    }
    function withTimeout(promise, timeoutMs, onTimeout) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(Error("Widget snapshot timed out"));
        }, timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
    function boundedSnapshotHook(hook, phase, timeoutMs = 5000) {
      if (typeof hook !== "function") return Promise.resolve();
      const boundedTimeout = Math.max(250, Math.min(5000, Number(timeoutMs) || 5000));
      let timer;
      return new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error(`Widget snapshot ${phase} hook timed out`)), boundedTimeout);
        Promise.resolve().then(() => hook()).then(resolve, reject);
      }).finally(() => clearTimeout(timer)).catch((error) => {
        throw Error(`Widget snapshot ${phase} hook failed: ${String(error?.message || error).slice(0, 200)}`);
      });
    }
    async function scienceSnapshot(message, hooks) {
      const totalTimeoutMs = Math.max(1000, Math.min(17500, Number(message.timeoutMs) || 17500)),
        hookTimeoutMs = Math.max(250, Math.min(1500, Math.floor(totalTimeoutMs * 0.15))),
        captureTimeoutMs = Math.max(500, totalTimeoutMs - hookTimeoutMs - 250);
      try {
        await boundedSnapshotHook(hooks.beforeSnapshot, "before", hookTimeoutMs);
        return await snapshotDocument({ ...message, timeoutMs:captureTimeoutMs }, true);
      } catch (error) {
        parent.postMessage({
          type:"penecho-widget-snapshot-error",
          runtimeVersion,
          requestId:message.requestId,
          error:String(error?.message || "Scientific Widget snapshot preparation failed").slice(0, 300),
          code:"WIDGET_PREPARE_FAILED",details:{stage:"before-hook",runtimeVersion},
        }, "*");
      } finally {
        try {
          await boundedSnapshotHook(hooks.afterSnapshot, "after", Math.min(1000, hookTimeoutMs));
        } catch (error) {
          console.warn("PenEcho scientific Widget snapshot restore failed:", String(error?.message || error).slice(0, 200));
        }
      }
    }
    let activeSnapshot = null, activeSnapshotRender = null;
    async function snapshot(message) {
      if(activeSnapshot || activeSnapshotRender) {
        parent.postMessage({type:"penecho-widget-snapshot-error",runtimeVersion,requestId:message.requestId,
          code:"WIDGET_RENDER_BUSY",error:"The previous Widget capture is still finishing. Wait for it before retrying.",
          details:{stage:activeSnapshotRender?"render-draining":"snapshot",runtimeVersion}},"*");
        return;
      }
      const hooks = globalThis.__penechoScienceSnapshotHooks;
      snapshotDebugLog("snapshot-request-received", {
        requestId:message.requestId,
        timeoutMs:Number(message.timeoutMs) || null,
        scienceHooks:Boolean(scienceMode && hooks),
        rendererAvailable:typeof globalThis.html2canvas === "function",
      });
      const operation = scienceMode && hooks ? scienceSnapshot(message, hooks) : snapshotDocument(message, false);
      activeSnapshot = operation;
      try { return await operation; }
      finally { if(activeSnapshot===operation)activeSnapshot=null; schedulePresentationSize(); }
    }
    async function snapshotPrimarySvg(requestedWidth, requestedHeight, scale) {
      const visible = [...document.querySelectorAll("svg")].map((svg) => ({ svg, rect:svg.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      if (visible.length !== 1) return null;
      const { svg, rect } = visible[0],
        tolerance = 2;
      if (rect.left > tolerance || rect.top > tolerance || rect.right < requestedWidth - tolerance || rect.bottom < requestedHeight - tolerance) return null;
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(requestedWidth));
      clone.setAttribute("height", String(requestedHeight));
      const source = new XMLSerializer().serializeToString(clone),
        url = URL.createObjectURL(new Blob([source], { type:"image/svg+xml" }));
      try {
        const image = await imageFromUrl(url),
          canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(requestedWidth * scale));
        canvas.height = Math.max(1, Math.floor(requestedHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw Error("Canvas renderer is unavailable");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    async function snapshotDocument(message, requirePresentedFrame = false) {
      let restoreSvgStyles = () => {},
        restoreCompatibleColors = () => {};
      const snapshotStartedAt = clock();
      let stage="presented-frame";
      try {
        let requestedWidth = Math.max(1, Number(message.width) || document.documentElement.clientWidth || 1),
          requestedHeight = Math.max(1, Number(message.height) || document.documentElement.clientHeight || 1);
        const highResolution = message.highResolution === true,
          targetScale = highResolution ? HIGH_RESOLUTION_SNAPSHOT_SCALE : 1,
          maximumDimension = highResolution ? MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION : MAX_SNAPSHOT_DIMENSION,
          maximumPixels = highResolution ? MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS : MAX_SNAPSHOT_PIXELS,
          timeoutMs = Math.max(500, Math.min(17500, Number(message.timeoutMs) || 17500));
        snapshotDebugLog("snapshot-capture-start", {
          requestId:message.requestId,
          timeoutMs,
          requestedWidth,
          requestedHeight,
          requirePresentedFrame,
          rendererAvailable:typeof globalThis.html2canvas === "function",
        });
        // Read the presented widget without pausing its live runtime. Cancelling
        // animation frames here can blank maps and canvases for the whole save.
        // OOPIF resize delivery may follow a source-update message. Capture the
        // requested responsive layout only after the actual iframe viewport agrees.
        if (mcpPreviewMode) await waitForSnapshotViewport(requestedWidth, requestedHeight, timeoutMs);
        const presentedFrame = await settleSnapshotFrame();
        if (requirePresentedFrame && !presentedFrame) throw Error("Widget frame was not presented");
        if (message.fullContent === true) {
          const root = document.documentElement, body = document.body;
          requestedWidth = Math.ceil(Math.max(requestedWidth, root.scrollWidth, body?.scrollWidth || 0));
          requestedHeight = Math.ceil(Math.max(requestedHeight, root.scrollHeight, body?.scrollHeight || 0));
          if (requestedWidth > 100000 || requestedHeight > 100000) throw Error("Widget content exceeds snapshot size limit");
        }
        const scale = Math.min(targetScale, maximumDimension / requestedWidth, maximumDimension / requestedHeight, Math.sqrt(maximumPixels / (requestedWidth * requestedHeight)));
        stage="prepare-styles";
        restoreSvgStyles = inlineSvgComputedStyles();
        restoreCompatibleColors = inlineSnapshotCompatibleColors();
        let captureExpired = false;
        const render = async () => {
          let canvas = null;
          try {
            stage="svg-render";
            canvas = await snapshotPrimarySvg(requestedWidth, requestedHeight, scale);
            if (canvas) canvas.toDataURL("image/png");
          } catch (error) {
            console.warn("PenEcho native SVG snapshot failed; using DOM renderer:", String(error?.message || error).slice(0, 300));
          }
          if (captureExpired) {
            if (canvas) canvas.width = canvas.height = 1;
            throw Error("Widget snapshot timed out");
          }
          if (!canvas) {
            stage="renderer-load";
            const domSnapshotRenderer = typeof globalThis.html2canvas === "function"
              ? globalThis.html2canvas
              : await loadSnapshotRenderer(Math.min(8000, timeoutMs));
            if(captureExpired)throw Error("Widget snapshot timed out");
            stage="dom-render";
            const restoreGeneratedContent = materializeSnapshotGeneratedContent();
            let restoreDirectRendererStyles = () => {};
            let rendering;
            try {
              restoreDirectRendererStyles = captureDirectRendererStyleMutations();
              rendering = domSnapshotRenderer(document.documentElement, {
                backgroundColor:null,
                width:requestedWidth,
                height:requestedHeight,
                windowWidth:requestedWidth,
                windowHeight:requestedHeight,
                scrollX:0,
                scrollY:0,
                scale,
                logging:false,
                useCORS:true,
                allowTaint:false,
                foreignObjectRendering:false,
                penechoDirectRendering:true,
                imageTimeout:Math.min(10000, timeoutMs),
              });
            } finally {
              // Direct parsing removes transforms and animation durations from
              // the live DOM. Restore them before the browser can paint so a
              // save cannot blank maps or move other rendered widget content.
              restoreDirectRendererStyles();
              restoreGeneratedContent();
            }
            canvas = await rendering;
          }
          if (captureExpired) {
            canvas.width = canvas.height = 1;
            throw Error("Widget snapshot timed out");
          }
          return canvas;
        };
        const rendering=render();
        activeSnapshotRender=rendering;
        const release=()=>{if(activeSnapshotRender===rendering)activeSnapshotRender=null;schedulePresentationSize();};
        rendering.then(release,release);
        const remainingMs=Math.max(1,timeoutMs-(clock()-snapshotStartedAt));
        const canvas = await withTimeout(rendering, remainingMs, () => (captureExpired = true));
        stage="encode";
        snapshotDebugLog("snapshot-capture-success", {
          requestId:message.requestId,
          durationMs:Number((clock() - snapshotStartedAt).toFixed(1)),
          width:canvas.width,
          height:canvas.height,
        });
        parent.postMessage({ type:"penecho-widget-snapshot", runtimeVersion, requestId:message.requestId, dataUrl:canvas.toDataURL("image/png"), contentWidth:requestedWidth, contentHeight:requestedHeight, width:canvas.width, height:canvas.height }, "*");
        canvas.width = canvas.height = 1;
      } catch (error) {
        snapshotDebugLog("snapshot-capture-error", {
          requestId:message.requestId,
          durationMs:Number((clock() - snapshotStartedAt).toFixed(1)),
          error:String(error?.message || "Widget snapshot failed").slice(0, 300),
        });
        parent.postMessage({ type: "penecho-widget-snapshot-error", runtimeVersion, requestId: message.requestId, error: error.message,
          code:/timed out/i.test(String(error?.message))?"WIDGET_CAPTURE_TIMEOUT":"WIDGET_CAPTURE_FAILED",
          details:{stage,elapsedMs:Math.round(clock()-snapshotStartedAt),runtimeVersion} }, "*");
      } finally {
        try {
          restoreCompatibleColors();
        } finally {
          restoreSvgStyles();
        }
      }
    }
    // Compatibility for canvases saved while the retired Fit to content action was available.
    let fitContentStyle = null;
    const fitContentElements = new Map();
    function restoreFitContentMarkers() {
      for (const [element, value] of fitContentElements) {
        if (value === null) element.removeAttribute("data-penecho-fit-scroll");
        else element.setAttribute("data-penecho-fit-scroll", value);
      }
      fitContentElements.clear();
    }
    function setFitContentLayout(enabled, refresh = false) {
      if (!enabled) {
        if (fitContentStyle) fitContentStyle.disabled = true;
        restoreFitContentMarkers();
        return;
      }
      if (fitContentStyle && !fitContentStyle.disabled && !refresh) return;
      if (fitContentStyle) fitContentStyle.disabled = true;
      restoreFitContentMarkers();
      // Read first, then apply one stylesheet. Preserve authored styles and live DOM.
      const axes = widgetState.maximized || widgetState.fitContent ? "resize" : widgetState.fitContentAxes;
      const fitWidth = axes !== "height", fitHeight = axes !== "width";
      const rootOverflow = widgetState.maximized
        ? "overflow:hidden!important;overflow:clip!important;"
        : (fitHeight ? "overflow-y:visible!important;" : "") + (fitWidth ? "overflow-x:visible!important;" : "");
      const rules = ["html,body{"
        + (fitHeight ? "height:auto!important;min-height:0!important;max-height:none!important;" : "")
        + (fitWidth ? "max-width:none!important;" : "") + rootOverflow + "}"
        + (widgetState.maximized ? "html,body{overscroll-behavior:auto!important}" : "")];
      const containers = [];
      for (const element of document.body?.querySelectorAll("*") || []) {
        if (!(element instanceof HTMLElement) || element.closest("textarea,input,select,iframe,[contenteditable],[role=grid],[role=tree],[role=treegrid],[role=listbox],[role=combobox],[role=slider],[role=spinbutton],[role=textbox],[role=menu],[role=menubar],[role=tablist]")) continue;
        const style = getComputedStyle(element);
        const vertical = fitHeight && /^(auto|scroll)$/.test(style.overflowY);
        const horizontal = fitWidth && /^(auto|scroll)$/.test(style.overflowX);
        // Viewport minimums inside padded documents otherwise grow with every
        // presentation resize. Remove them only for ordinary maximized layouts.
        const viewportMinimum = widgetState.maximized && innerHeight > 0
          && element.children.length > 0 && parseFloat(style.minHeight) >= innerHeight;
        const viewportHeight = widgetState.maximized && innerHeight > 0
          && element.children.length > 0 && parseFloat(style.height) >= innerHeight
          && (/^(hidden|clip)$/.test(style.overflowY) || Math.abs(parseFloat(style.height) - innerHeight) <= 1);
        if (!vertical && !horizontal && !viewportMinimum && !viewportHeight) continue;
        containers.push({ element, vertical, horizontal, viewportMinimum, viewportHeight,
          width:element.scrollWidth > element.clientWidth ? element.scrollWidth + element.offsetWidth - element.clientWidth : 0 });
      }
      for (const [index, item] of containers.entries()) {
        fitContentElements.set(item.element, item.element.getAttribute("data-penecho-fit-scroll"));
        if (item.element.getAttribute("data-penecho-fit-scroll") !== String(index)) item.element.setAttribute("data-penecho-fit-scroll", String(index));
        rules.push('[data-penecho-fit-scroll="' + index + '"]{'
          + (item.viewportMinimum ? "min-height:0!important;" : "")
          + (item.viewportHeight ? "height:auto!important;max-height:none!important;overflow-y:visible!important;" : "")
          + (item.vertical ? "height:auto!important;min-height:0!important;max-height:none!important;overflow-y:visible!important;flex-shrink:0!important;" : "")
          + (item.horizontal ? "max-width:none!important;overflow-x:visible!important;" + (item.width ? "min-width:" + item.width + "px!important;" : "") : "")
          + "}");
      }
      if (!fitContentStyle) {
        fitContentStyle = document.createElement("style");
        document.head.append(fitContentStyle);
      }
      const css = rules.join("\n");
      if (fitContentStyle.textContent !== css) fitContentStyle.textContent = css;
      fitContentStyle.disabled = false;
    }
    // One presentation owner: refresh authored scrolling layouts only when dirty,
    // then measure their natural extent without using the iframe viewport height.
    let presentationFrame = 0, presentationObserver = null, presentationMutations = null;
    let presentationLayoutDirty = false, lastPresentationSize = "", presentationViewportWidth = 0;
    function schedulePresentationSize(refresh = false) {
      if (!widgetState.maximized) return;
      presentationLayoutDirty ||= refresh;
      if (presentationFrame) return;
      presentationFrame = nativeRequestAnimationFrame(() => {
        presentationFrame = 0;
        if (!widgetState.maximized || !document.body || activeSnapshot || activeSnapshotRender) return;
        if (presentationLayoutDirty) {
          presentationLayoutDirty = false;
          setFitContentLayout(true, true);
        }
        const body = document.body, rect = body.getBoundingClientRect();
        let width = Math.max(1, rect.right + scrollX, body.scrollWidth);
        // The body border box excludes its trailing margin, but that margin
        // contributes to the document's extent. Include it so the outer
        // presentation scroller can reach all trailing content.
        const bottomMargin = Math.max(0, parseFloat(getComputedStyle(body).marginBottom) || 0);
        let height = Math.max(1, rect.bottom + scrollY + bottomMargin);
        // Out-of-flow content contributes to the presentation without making the
        // viewport-sized document scrollHeight the next iframe height.
        for (const element of body.querySelectorAll("*")) {
          if (element.parentElement?.closest("textarea,input,select,iframe,[contenteditable],[role=grid],[role=tree],[role=treegrid],[role=listbox],[role=combobox],[role=slider],[role=spinbutton],[role=textbox],[role=menu],[role=menubar],[role=tablist]")) continue;
          const child = element.getBoundingClientRect();
          width = Math.max(width, child.right + scrollX);
          height = Math.max(height, child.bottom + scrollY);
        }
        width = Math.min(100000, Math.ceil(width));
        height = Math.min(100000, Math.ceil(height));
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        const key = width + ":" + height;
        if (key === lastPresentationSize) return;
        lastPresentationSize = key;
        parent.postMessage({ type:"penecho-widget-presentation-size", runtimeVersion, width, height }, "*");
      });
    }
    function setPresentationLayout(refresh = true) {
      if (!widgetState.maximized) {
        setFitContentLayout(Boolean(widgetState.fitContent || widgetState.fitContentAxes), refresh);
        if (presentationFrame) nativeCancelAnimationFrame(presentationFrame);
        presentationFrame = 0;
        presentationObserver?.disconnect();
        presentationMutations?.disconnect();
        presentationObserver = presentationMutations = null;
        lastPresentationSize = "";
        presentationViewportWidth = 0;
        presentationLayoutDirty = false;
        return;
      }
      if (document.body && !presentationObserver && typeof ResizeObserver === "function") {
        presentationViewportWidth = innerWidth;
        presentationObserver = new ResizeObserver(() => schedulePresentationSize());
        presentationObserver.observe(document.body);
      }
      if (document.body && !presentationMutations && typeof MutationObserver === "function") {
        presentationMutations = new MutationObserver(records => {
          if (records.some(record => record.target !== fitContentStyle
            && record.attributeName !== "data-penecho-fit-scroll")) schedulePresentationSize(true);
        });
        presentationMutations.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true });
      }
      if (refresh) schedulePresentationSize(true);
    }
    addEventListener("resize", () => {
      if (!widgetState.maximized) return;
      const widthChanged = presentationViewportWidth !== innerWidth;
      presentationViewportWidth = innerWidth;
      // Our measured height is written back to the iframe. Reclassifying the
      // authored containers against that new height can alternately expand and
      // restore the same container forever. Only width changes require reflow
      // classification here; authored mutations already invalidate it above.
      schedulePresentationSize(widthChanged);
    });
    addEventListener("load", () => { if (widgetState.maximized) setPresentationLayout(); });
    addEventListener("message", (event) => {
      if (event.source !== parent) return;
      if (event.data?.type === PUBLIC_FETCH_RESPONSE && publicFetchRequests.has(event.data.requestId)) {
        const pending = publicFetchRequests.get(event.data.requestId);
        publicFetchRequests.delete(event.data.requestId);
        clearTimeout(pending.timer);
        if (typeof event.data.error === "string") pending.reject(Error(event.data.error));
        else if (Number.isInteger(event.data.status) && event.data.status >= 200 && event.data.status <= 599
          && (typeof event.data.body === "string" || event.data.body instanceof ArrayBuffer)) {
          const headers = new Headers();
          if (typeof event.data.contentType === "string" && event.data.contentType) headers.set("Content-Type", event.data.contentType);
          if (typeof event.data.finalUrl === "string" && event.data.finalUrl) headers.set("X-PenEcho-Final-URL", event.data.finalUrl);
          const body = [204, 205, 304].includes(event.data.status) ? null : event.data.body;
          pending.resolve(new Response(body, { status:event.data.status, headers }));
        } else pending.reject(Error("The public data response was invalid"));
      } else if (event.data?.type === "penecho-widget-fit-request") {
        const { requestId, hit } = event.data;
        if (typeof requestId !== "string" || requestId.length > 128 || !["width", "height", "resize"].includes(hit)) return;
        const previous = widgetState.fitContent ? "resize" : widgetState.fitContentAxes;
        widgetState.fitContentAxes = previous && previous !== hit ? "resize" : hit;
        setFitContentLayout(true, true);
        const body = document.body, root = document.documentElement;
        let width = Math.max(root.clientWidth, root.scrollWidth, body.scrollWidth);
        let height = Math.max(root.clientHeight, root.scrollHeight, body.scrollHeight);
        for (const element of body.querySelectorAll("*")) {
          const rect = element.getBoundingClientRect();
          width = Math.max(width, rect.right + scrollX);
          height = Math.max(height, rect.bottom + scrollY);
        }
        parent.postMessage({ type:"penecho-widget-fit-result", requestId, width:Math.ceil(width), height:Math.ceil(height) }, "*");
      } else if (event.data?.type === "penecho-widget-snapshot-request") void snapshot(event.data);
      else if (event.data?.type === "penecho-widget-state" && typeof event.data.selected === "boolean" && typeof event.data.active === "boolean"
        && Number.isFinite(event.data.scaleX) && event.data.scaleX > 0 && Number.isFinite(event.data.scaleY) && event.data.scaleY > 0) {
        const becameVisible = event.data.active && (!widgetStateReceived || !widgetState.active);
        const layoutChanged = widgetState.maximized !== (event.data.maximized === true) || widgetState.fitContent !== (event.data.fitContent === true) || widgetState.fitContentAxes !== event.data.fitContentAxes;
        widgetState = { fitContent:event.data.fitContent === true, fitContentAxes:event.data.fitContentAxes, maximized:event.data.maximized === true, selected:event.data.selected, interactive:Boolean(event.data.interactive), active:event.data.active, navigationLocked:Boolean(event.data.navigationLocked), scaleX:event.data.scaleX, scaleY:event.data.scaleY };
        setPresentationLayout(layoutChanged);
        widgetStateReceived = true;
        if (!widgetState.selected) setControlCursor();
        setRuntimeActive(widgetState.active);
        if (becameVisible) notifyVisibleViewport();
      }
    });
    addEventListener("keydown", (event) => {
      if (widgetState.interactive && event.key === "Escape" && !event.defaultPrevented) {
        parent.postMessage({ type:"penecho-widget-exit-interaction" }, "*");
      }
    });
    addEventListener("load", notifyReady, { once: true });
  }

  function snapshotError(requestId, message = "Widget snapshot failed", code = "WIDGET_CAPTURE_FAILED", details = {}) {
    const request = pendingSnapshots.get(requestId);
    snapshotDebugLog("snapshot-host-error", {
      requestId,
      error:String(message || "Widget snapshot failed").replace(/[\r\n\t]+/g, " ").slice(0, 300),
      forwarded:Boolean(request?.forwarded),
      durationMs:request ? Number((performance.now() - request.startedAt).toFixed(1)) : null,
    });
    clearTimeout(request?.timer);
    pendingSnapshots.delete(requestId);
    const error = String(message || "Widget snapshot failed").replace(/[\r\n\t]+/g, " ").slice(0, 300);
    console.warn("PenEcho widget snapshot failed:", error);
    parent.postMessage({ type:"penecho-widget-snapshot-error", requestId, error,
      code:/^WIDGET_[A-Z_]{1,40}$/.test(code)?code:"WIDGET_CAPTURE_FAILED",
      details:{stage:String(details.stage|| (request?.forwarded?"capture":"document-ready")).slice(0,60),
        elapsedMs:request?Math.round(performance.now()-request.startedAt):0,runtimeVersion} }, parentOrigin);
  }

  function forwardSnapshotRequest(requestId, request) {
    if (!innerDocumentReady || request.forwarded) {
      snapshotDebugLog("snapshot-forward-deferred", {
        requestId,
        reason:request.forwarded ? "already-forwarded" : "inner-not-ready",
      });
      return;
    }
    const remainingMs=request.timeoutMs-(performance.now()-request.startedAt)-250;
    if(remainingMs<500){snapshotError(requestId,"Widget snapshot readiness exhausted the capture budget","WIDGET_READY_TIMEOUT");return;}
    request.forwarded = true;
    // Requests queued during document loading must receive the current
    // presentation state before deciding which viewport to wait for.
    forwardWidgetState();
    snapshotDebugLog("snapshot-forwarded", { requestId, timeoutMs:remainingMs });
    inner.contentWindow?.postMessage({
      type:"penecho-widget-snapshot-request",
      requestId,
      width:request.requestedWidth,
      height:request.requestedHeight,
      timeoutMs:remainingMs,
      highResolution:request.highResolution,
      fullContent:request.fullContent,
    }, "*");
  }

  async function proxyPublicFetch(message) {
    const reply = (payload, transfer = []) => inner.contentWindow?.postMessage({ type:"penecho-widget-public-fetch-response", requestId:message.requestId, ...payload }, "*", transfer);
    try {
      const response = remoteCanvas ? await parentPublicFetch(message.url) : await fetch(publicFetchUrl, {
          method:"POST",
          credentials:"same-origin",
          cache:"no-store",
          headers:{ "Content-Type":"application/json", ...(accessSession ? { "X-PenEcho-Session":accessSession } : {}) },
          body:JSON.stringify({ url:message.url }),
        }),
        body = await response.arrayBuffer(),
        upstreamStatus = Number(response.headers.get("x-penecho-upstream-status"));
      if (body.byteLength > 5 * 1024 * 1024) throw Error("The public data response is too large");
      if (!response.ok) {
        let detail = "", errorText = "";
        try { errorText = new TextDecoder().decode(body); detail = JSON.parse(errorText)?.error || ""; } catch {}
        throw Error(detail || `The public data channel returned HTTP ${response.status}`);
      }
      reply({
        status:Number.isInteger(upstreamStatus) && upstreamStatus >= 200 && upstreamStatus <= 599 ? upstreamStatus : response.status,
        body,
        contentType:String(response.headers.get("content-type") || "").slice(0, 200),
        finalUrl:String(response.headers.get("x-penecho-final-url") || "").slice(0, PUBLIC_FETCH_MAX_URL_LENGTH),
      }, [body]);
    } catch (error) {
      reply({ error:String(error?.message || "The public data request failed").slice(0, 300) });
    }
  }

  const pendingPublicFetches = new Map();
  let nextParentPublicFetchId = 1;
  function parentPublicFetch(url) {
    if (parentOrigin !== location.origin || parent === window) return Promise.reject(Error("The public data parent is unavailable"));
    return new Promise((resolve, reject) => {
      const requestId = `widget-fetch-${nextParentPublicFetchId++}`;
      const timer = setTimeout(() => {
        pendingPublicFetches.delete(requestId);
        reject(Error("The public data request timed out"));
      }, 48000);
      pendingPublicFetches.set(requestId, { resolve, reject, timer });
      parent.postMessage({ type:"penecho-widget-host-public-fetch", requestId, url }, parentOrigin);
    });
  }
  function receiveParentPublicFetch(event) {
    if (event.source !== parent || event.origin !== location.origin || parentOrigin !== location.origin
      || event.data?.type !== "penecho-widget-host-public-fetch-result") return false;
    const message = event.data, pending = pendingPublicFetches.get(message.requestId);
    if (!pending) return true;
    pendingPublicFetches.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(Error(String(message.error)));
    else {
      try { pending.resolve(new Response(message.body, { status:message.status, headers:message.headers })); }
      catch (error) { pending.reject(error); }
    }
    return true;
  }

  function resolveImageAssets(html,assets) {
    const refs=[...new Set(html.match(/penecho-asset:[a-f0-9]{64}/g)||[])];
    if(refs.length>64)throw Error("Too many Widget image attachments");
    let total=0;
    const resolved=new Map();
    for(const ref of refs){const source=assets?.[ref];
      if(typeof source!=="string"||source.length>800000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)||(total+=source.length)>16000000)throw Error("Widget image attachment is unavailable or invalid");
      resolved.set(ref,source);
    }
    let expanded=html.length;
    return html.replace(/penecho-asset:[a-f0-9]{64}/g,ref=>{const source=resolved.get(ref);if((expanded+=source.length-ref.length)>16000000)throw Error("Widget image expansion exceeds the supported limit");return source;});
  }

  function csp(allowNestedFrames = false, scienceMode = false) {
    const frameSource = allowNestedFrames ? "frame-src 'self' data: blob:" : "frame-src 'none'";
    const scriptSources = [rendererUrl, visualExplainerVendorUrl, visualExplainerRuntimeUrl]
      .concat(scienceMode ? [visualExplorerManimWebUrl, visualExplorerManimMathJaxUrl] : [])
      .map(url => url.replace(/[?#].*$/, ""))
      .join(" ");
    return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: ${scriptSources}; style-src 'unsafe-inline' https:; connect-src https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; ${frameSource}; worker-src blob: https:; object-src 'none'; form-action 'none'; base-uri 'none'`;
  }

  function visualExplainerAllowsNestedFrames(planElement) {
    if (!planElement) return false;
    try {
      const plan = JSON.parse(planElement.textContent || "");
      return Array.isArray(plan?.regions) && plan.regions.some(region => region?.renderer === "embedded-html");
    } catch {
      return false;
    }
  }

  function safeHttpsResource(element, attribute) {
    const value = element.getAttribute(attribute);
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "https:" || url.username || url.password) return false;
      element.setAttribute(attribute, url.href);
      element.setAttribute("referrerpolicy", "no-referrer");
      if (["SCRIPT", "LINK", "IMG", "VIDEO", "AUDIO", "SOURCE"].includes(element.tagName)) element.setAttribute("crossorigin", "anonymous");
      return true;
    } catch {
      return false;
    }
  }

  function safeOutboundLink(element) {
    const value = element.getAttribute("href");
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "https:" || url.username || url.password) throw Error("unsafe link");
      element.setAttribute("href", url.href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
      element.setAttribute("referrerpolicy", "no-referrer");
      element.removeAttribute("download");
      element.removeAttribute("ping");
      return true;
    } catch {
      element.removeAttribute("href");
      element.removeAttribute("target");
      element.removeAttribute("download");
      element.removeAttribute("ping");
      return false;
    }
  }

  function inlineScriptHasWindowBinding(source) {
    const protectedNames = new Set([
      "closed", "document", "event", "external", "frameElement", "frames", "history", "length",
      "location", "name", "navigator", "opener", "origin", "parent", "self", "status", "top", "window",
    ]);
    let index = 0, parenDepth = 0, bracketDepth = 0, braceDepth = 0,
      variableBase = null, expectsVariableName = false, expectsFunctionName = false;
    const isIdentifierStart = char => /[A-Za-z_$]/.test(char),
      isIdentifierPart = char => /[A-Za-z0-9_$]/.test(char);
    while (index < source.length) {
      const char = source[index], next = source[index + 1];
      if (/\s/.test(char)) {
        index++;
        continue;
      }
      if (char === "/" && next === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index++;
        continue;
      }
      if (char === "/" && next === "*") {
        index += 2;
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index++;
        index = Math.min(source.length,index + 2);
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        const quote = char;
        index++;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
            continue;
          }
          if (source[index++] === quote) break;
        }
        continue;
      }
      if (isIdentifierStart(char)) {
        const start = index++;
        while (index < source.length && isIdentifierPart(source[index])) index++;
        const identifier = source.slice(start,index);
        if (expectsFunctionName) {
          if (protectedNames.has(identifier)) return true;
          expectsFunctionName = false;
        }
        if (identifier === "function") {
          expectsFunctionName = true;
          continue;
        }
        if (identifier === "var") {
          variableBase = { parenDepth, bracketDepth, braceDepth };
          expectsVariableName = true;
          continue;
        }
        if (variableBase && expectsVariableName) {
          if (protectedNames.has(identifier)) return true;
          expectsVariableName = false;
        }
        continue;
      }
      if (expectsFunctionName && char !== "*") expectsFunctionName = false;
      if (char === "(") parenDepth++;
      else if (char === ")") parenDepth = Math.max(0,parenDepth - 1);
      else if (char === "[") bracketDepth++;
      else if (char === "]") bracketDepth = Math.max(0,bracketDepth - 1);
      else if (char === "{") braceDepth++;
      else if (char === "}") braceDepth = Math.max(0,braceDepth - 1);
      if (variableBase && parenDepth === variableBase.parenDepth && bracketDepth === variableBase.bracketDepth && braceDepth === variableBase.braceDepth) {
        if (char === ",") expectsVariableName = true;
        else if (char === ";") {
          variableBase = null;
          expectsVariableName = false;
        }
      }
      index++;
    }
    return false;
  }

  function compatibleInlineWidgetScript(source) {
    return String(source || "").replace(/\b(?:(?:window|globalThis)\.)?parent\.penechoFetchPublic\b/g, "window.penechoFetchPublic");
  }

  function scopedInlineWidgetScript(source) {
    const script = compatibleInlineWidgetScript(source);
    return inlineScriptHasWindowBinding(script) ? `(() => {\n${script}\n})();` : script;
  }

  function scienceWidgetMode(parsed, sourceFormat, frameworkVersion) {
    const supportedSource = sourceFormat === "penecho-mcp+html" || sourceFormat === "penecho-visual-explorer+html" && frameworkVersion === "penecho-visual-explorer/1";
    if (!supportedSource) return false;
    const skills = [...parsed.querySelectorAll("meta")].filter(meta => meta.getAttribute("name") === "penecho-visual-skill");
    return skills.length === 1 && ["math-2d", "physics-2d", "math-3d"].includes(skills[0].getAttribute("content"));
  }

  function scienceUsesManim(parsed) {
    return [...parsed.querySelectorAll("script:not([src])")].some((element) => {
      const type = String(element.getAttribute("type") || "").trim().toLowerCase().split(";",1)[0];
      const source = String(element.textContent || "");
      return type === "module" && rewriteScienceModuleImports(source, authoredManimWebUrl, visualExplorerManimWebUrl) !== source;
    });
  }

  function rewriteScienceModuleImports(source, sourceUrl, targetUrl) {
    const text = String(source || ""), replacements = [], tokens = [];
    let index = 0;
    const identifierStart = /[A-Za-z_$]/, identifierPart = /[A-Za-z0-9_$]/;
    while (index < text.length) {
      const char = text[index], next = text[index + 1];
      if (/\s/.test(char)) {
        index++;
        continue;
      }
      if (char === "/" && next === "/") {
        index += 2;
        while (index < text.length && !/[\r\n]/.test(text[index])) index++;
        continue;
      }
      if (char === "/" && next === "*") {
        index += 2;
        while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
        index = Math.min(text.length, index + 2);
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        const quote = char, start = index++, valueStart = index;
        while (index < text.length) {
          if (text[index] === "\\") {
            index += 2;
            continue;
          }
          if (text[index++] === quote) break;
        }
        const value = text.slice(valueStart, Math.max(valueStart, index - 1));
        if (value === sourceUrl) {
          const previous = tokens[tokens.length - 1], beforePrevious = tokens[tokens.length - 2];
          let exactImport = previous?.text === "import" && previous.kind === "identifier";
          if (previous?.text === "(" && previous.kind === "punctuation" && beforePrevious?.text === "import" && beforePrevious.kind === "identifier") exactImport = true;
          if (previous?.text === "from" && previous.kind === "identifier") {
            let cursor = tokens.length - 2, importToken = false;
            while (cursor >= 0) {
              const token = tokens[cursor--];
              if (token.kind === "identifier" && token.text === "import") {
                importToken = true;
                break;
              }
              if (!(token.kind === "identifier" || ["{", "}", "*", ","].includes(token.text))) break;
            }
            exactImport = exactImport || importToken;
          }
          if (exactImport) replacements.push([start, index, `${quote}${targetUrl}${quote}`]);
        }
        tokens.push({ kind:"string", text:value, quote });
        continue;
      }
      if (identifierStart.test(char)) {
        const start = index++;
        while (index < text.length && identifierPart.test(text[index])) index++;
        tokens.push({ kind:"identifier", text:text.slice(start, index) });
        continue;
      }
      tokens.push({ kind:"punctuation", text:char });
      index++;
    }
    let result = text;
    for (const [start, end, replacement] of replacements.reverse()) {
      result = result.slice(0, start) + replacement + result.slice(end);
    }
    return result;
  }

  function scienceRuntime(documentVersion, waitForAuthoredReady = true) {
    const nativeRequestAnimationFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame.bind(globalThis) : null;
    let authoredReady = !waitForAuthoredReady, rendererReady = false, readyScheduled = false;
    const snapshotHooks = { beforeSnapshot:null, afterSnapshot:null };
    let restoreGetContext = () => {};
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext"),
        originalGetContext = HTMLCanvasElement.prototype.getContext;
      if (typeof originalGetContext === "function") {
        const wrappedGetContext = function(type, attributes) {
          if (type === "webgl" || type === "webgl2") attributes = { ...(attributes || {}), preserveDrawingBuffer:true };
          return originalGetContext.call(this, type, attributes);
        };
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value:wrappedGetContext, writable:true, configurable:true });
        restoreGetContext = () => {
          if (descriptor) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", descriptor);
          else delete HTMLCanvasElement.prototype.getContext;
        };
      }
    } catch {}
    function requestTwoFrames(callback) {
      const request = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame.bind(globalThis) : nativeRequestAnimationFrame;
      if (!request) return;
      request(() => request(callback));
    }
    function finishReady() {
      globalThis.__penechoSnapshotDebug?.("science-ready-state", { authoredReady, rendererReady, readyScheduled });
      if (readyScheduled || !authoredReady || !rendererReady) return;
      readyScheduled = true;
      try { restoreGetContext(); } catch {}
      requestTwoFrames(() => {
        delete globalThis.__penechoScienceRendererReady;
        globalThis.__penechoSnapshotDebug?.("document-ready-marker", { mode:"science", rendererAvailable:typeof globalThis.html2canvas === "function" });
        parent.postMessage({ type:"penecho-widget-document-ready", runtimeVersion:documentVersion }, "*");
      });
    }
    globalThis.__penechoScienceRendererReady = () => {
      rendererReady = true;
      finishReady();
    };
    globalThis.__penechoScienceSnapshotHooks = snapshotHooks;
    globalThis.penechoWidgetReady = (options) => {
      if (options && typeof options === "object") {
        snapshotHooks.beforeSnapshot = typeof options.beforeSnapshot === "function" ? options.beforeSnapshot : null;
        snapshotHooks.afterSnapshot = typeof options.afterSnapshot === "function" ? options.afterSnapshot : null;
      }
      authoredReady = true;
      finishReady();
    };
  }

  function widgetDocument(html, pluginStyles = "", documentVersion = 0, sourceFormat = "", frameworkVersion = "") {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const mcpPreview = sourceFormat === "penecho-mcp+html";
    parsed.querySelectorAll(mcpPreview ? "base, iframe, object, embed, meta[http-equiv]" : "base, iframe, object, embed, form, meta[http-equiv]").forEach((element) => element.remove());
    parsed.querySelectorAll("script[src]").forEach((element) => {
      if (!safeHttpsResource(element, "src")) element.remove();
    });
    parsed.querySelectorAll("link").forEach((element) => {
      if (String(element.getAttribute("rel") || "").toLowerCase() !== "stylesheet" || !safeHttpsResource(element, "href")) element.remove();
    });
    parsed.querySelectorAll("script:not([src])").forEach((element) => {
      const type = String(element.getAttribute("type") || "").trim().toLowerCase().split(";",1)[0];
      if (type && !["text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"].includes(type)) return;
      const original = element.textContent || "",
        scoped = scopedInlineWidgetScript(original);
      if (scoped === original) return;
      element.textContent = scoped;
      element.dataset.penechoScopedWindowBindings = "";
    });
    const scienceMode = scienceWidgetMode(parsed, sourceFormat, frameworkVersion),
      waitForAuthoredReady = scienceMode && scienceUsesManim(parsed);
    if (scienceMode) {
      parsed.querySelectorAll("script:not([src])").forEach((element) => {
        const type = String(element.getAttribute("type") || "").trim().toLowerCase();
        if (type !== "module") return;
        element.textContent = rewriteScienceModuleImports(element.textContent || "", authoredManimWebUrl, visualExplorerManimWebUrl);
      });
      const scienceBootstrap = parsed.createElement("script");
      scienceBootstrap.textContent = `(${scienceRuntime.toString()})(${JSON.stringify(documentVersion)},${JSON.stringify(waitForAuthoredReady)})`;
      parsed.head.prepend(scienceBootstrap);
    }
    parsed.querySelectorAll("img[src],video[src],audio[src],source[src]").forEach((element) => {
      const value = element.getAttribute("src") || "";
      if (/^(?:data:|blob:)/i.test(value)) {
        element.setAttribute("referrerpolicy", "no-referrer");
        return;
      }
      if (!safeHttpsResource(element, "src")) element.removeAttribute("src");
    });
    parsed.querySelectorAll("a[href]").forEach(safeOutboundLink);
    const visualPlan = parsed.querySelector("script[type='application/json'][data-penecho-visual-explainer]");
    const policy = parsed.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = csp(visualExplainerAllowsNestedFrames(visualPlan), scienceMode);
    parsed.head.prepend(policy);
    const viewport = parsed.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width,initial-scale=1";
    parsed.head.prepend(viewport);
    if (pluginStyles) {
      const pluginStyle = parsed.createElement("style");
      pluginStyle.dataset.penechoPluginStyles = "";
      pluginStyle.textContent = pluginStyles;
      // Plugin CSS provides defaults; widget-authored styles must be able to override them.
      parsed.head.insertBefore(pluginStyle, parsed.head.querySelector("style, link"));
    }
    const bridgeStyle = parsed.createElement("style");
    bridgeStyle.textContent = "html,body{background:transparent!important;color-scheme:light!important;font-size:clamp(36px,1.2cqw,52px);overscroll-behavior:contain}html.penecho-widget-dragging,html.penecho-widget-dragging *{user-select:none!important}html.penecho-widget-resize-width,html.penecho-widget-resize-width *{cursor:ew-resize!important}html.penecho-widget-resize-height,html.penecho-widget-resize-height *{cursor:ns-resize!important}html.penecho-widget-resize-corner,html.penecho-widget-resize-corner *{cursor:nwse-resize!important}html.penecho-widget-paused *,html.penecho-widget-paused *::before,html.penecho-widget-paused *::after{animation-play-state:paused!important}";
    if(mcpPreview)bridgeStyle.textContent=bridgeStyle.textContent.replace("background:transparent!important;color-scheme:light!important;font-size:clamp(36px,1.2cqw,52px);","");
    parsed.head.append(bridgeStyle);
    if (visualPlan && !scienceMode) {
      const visualReady = parsed.createElement("script");
      visualReady.textContent = `(() => { let visual=false,renderer=false,sent=false;const finish=()=>{globalThis.__penechoSnapshotDebug?.("visual-ready-state",{visual,renderer,sent});if(sent||!visual||!renderer)return;sent=true;globalThis.__penechoSnapshotDebug?.("document-ready-marker",{mode:"visual",rendererAvailable:typeof globalThis.html2canvas==="function"});parent.postMessage({type:"penecho-widget-document-ready",runtimeVersion:${JSON.stringify(documentVersion)}},"*")};addEventListener("penecho-visual-explainer-ready",()=>{visual=true;finish()},{once:true});globalThis.__penechoVisualRendererReady=()=>{renderer=true;finish()};setTimeout(()=>{visual=true;finish()},3200) })()`;
      parsed.body.append(visualReady);
      const vendor = parsed.createElement("script");
      vendor.src = visualExplainerVendorUrl;
      parsed.body.append(vendor);
      const visualRuntime = parsed.createElement("script");
      visualRuntime.src = visualExplainerRuntimeUrl;
      parsed.body.append(visualRuntime);
    }
    const renderer = parsed.createElement("script");
    renderer.src = rendererUrl;
    parsed.body.append(renderer);
    const rendererMarker = parsed.createElement("script");
    rendererMarker.textContent = `globalThis.__penechoSnapshotDebug?.("renderer-marker",{rendererAvailable:typeof globalThis.html2canvas==="function"})`;
    parsed.body.append(rendererMarker);
    if (scienceMode) {
      const rendererReady = parsed.createElement("script");
      rendererReady.textContent = "if(typeof globalThis.html2canvas===\"function\")globalThis.__penechoScienceRendererReady?.();delete globalThis.__penechoScienceRendererReady";
      parsed.body.append(rendererReady);
    } else if (visualPlan) {
      const rendererReady = parsed.createElement("script");
      rendererReady.textContent = `globalThis.__penechoVisualRendererReady?.();delete globalThis.__penechoVisualRendererReady`;
      parsed.body.append(rendererReady);
    } else {
      const ready = parsed.createElement("script");
      ready.textContent = `globalThis.__penechoSnapshotDebug?.("document-ready-marker",{mode:"regular",rendererAvailable:typeof globalThis.html2canvas==="function"});parent.postMessage({type:"penecho-widget-document-ready",runtimeVersion:${JSON.stringify(documentVersion)}},"*")`;
      parsed.body.append(ready);
    }
    const bridge = parsed.createElement("script");
    bridge.textContent = `(${runtime.toString()})(${JSON.stringify(documentVersion)},${JSON.stringify(scienceMode)},${JSON.stringify(rendererUrl)},${JSON.stringify(snapshotDebugEnabled)},${JSON.stringify(snapshotDebugId)},${JSON.stringify(mcpPreview)})`;
    if(mcpPreview) {
      const actions=parsed.createElement("script");
      actions.textContent=`addEventListener('click',event=>{const button=event.target.closest?.('[data-penecho-action]');if(!event.isTrusted||!button)return;const text=(button.getAttribute('data-penecho-prompt')||button.textContent||'').trim().slice(0,4000),action=(button.getAttribute('data-penecho-action')||'choice').slice(0,80);if(text)parent.postMessage({type:'penecho-widget-user-action',runtimeVersion:${JSON.stringify(documentVersion)},action,text},'*');});`;
      parsed.body.append(actions);
    }
    // Establish the bridge early. The end marker runs after widget-authored scripts and
    // the bundled renderer, without waiting for unrelated images or other load events.
    policy.after(bridge);
    return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  }

  function validDragMessage(message) {
    return message && ["penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && ["width", "height", "resize"].includes(message.hit)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validTouchMessage(message) {
    return message && ["penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && message.pointerType === "touch"
      && [message.localX, message.localY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validActivateMessage(message) {
    return message?.type === "penecho-widget-activate"
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validRuntimeDiagnostics(message) {
    return message && message.type === "penecho-widget-runtime-diagnostics" && message.runtimeVersion === runtimeVersion
      && typeof message.truncated === "boolean" && Array.isArray(message.errors) && message.errors.length <= 5
      && message.errors.every(error => error && typeof error === "object"
        && ["error", "unhandledrejection", "script-load"].includes(error.kind)
        && typeof error.name === "string" && error.name.length > 0 && error.name.length <= 80
        && typeof error.message === "string" && error.message.length > 0 && error.message.length <= 400
        && typeof error.file === "string" && error.file.length > 0 && error.file.length <= 300
        && Number.isInteger(error.line) && error.line >= 0 && error.line <= 10000000
        && Number.isInteger(error.column) && error.column >= 0 && error.column <= 10000000
        && Number.isInteger(error.repeatedCount) && error.repeatedCount >= 1 && error.repeatedCount <= 1000000
        && Array.isArray(error.stack) && error.stack.length <= 3
        && error.stack.every(frame => typeof frame === "string" && frame.length > 0 && frame.length <= 300));
  }
  function validVisualExplainerDiagnostics(message) {
    const diagnostics=message?.diagnostics;
    return message?.type === "penecho-visual-explainer-diagnostics" && diagnostics && typeof diagnostics === "object"
      && diagnostics.version === 1 && ["pass","warn","fail"].includes(diagnostics.status)
      && Number.isInteger(diagnostics.score) && diagnostics.score >= 0 && diagnostics.score <= 100
      && ["comfortable","compact","dense"].includes(diagnostics.density)
      && Number.isInteger(diagnostics.deterministicAttempts) && diagnostics.deterministicAttempts >= 1 && diagnostics.deterministicAttempts <= 3
      && typeof diagnostics.issueSignature === "string" && diagnostics.issueSignature.length <= 1200
      && typeof diagnostics.semanticReplanRecommended === "boolean"
      && Array.isArray(diagnostics.issues) && diagnostics.issues.length <= 12
      && diagnostics.issues.every(issue => issue && typeof issue === "object"
        && typeof issue.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(issue.code)
        && ["warning","error"].includes(issue.severity)
        && typeof issue.message === "string" && issue.message.length > 0 && issue.message.length <= 300
        && (issue.sectionId === undefined || typeof issue.sectionId === "string" && issue.sectionId.length > 0 && issue.sectionId.length <= 64));
  }
  function forwardWidgetState() {
    inner.contentWindow?.postMessage({ type:"penecho-widget-state", ...widgetState }, "*");
  }
  function announceWidgetHostReady() {
    snapshotDebugLog("host-ready-announced");
    parent.postMessage({ type:"penecho-widget-host-ready" }, parentOrigin);
  }
  function respondToWidgetHostProbe(event) {
    if (event.source !== parent || event.origin !== parentOrigin || event.data?.type !== "penecho-widget-host-probe") return false;
    announceWidgetHostReady();
    return true;
  }
  function flushDragMove() {
    dragMoveFrame = 0;
    if (!queuedDragMove) return;
    const message = queuedDragMove;
    queuedDragMove = null;
    parent.postMessage(message, parentOrigin);
  }
  function forwardDragMessage(message) {
    if (!validDragMessage(message)) return;
    if (message.type === "penecho-widget-drag-start") {
      if (forwardedDragPointer !== null) return;
      forwardedDragPointer = message.pointerId;
      parent.postMessage(message, parentOrigin);
      return;
    }
    if (message.pointerId !== forwardedDragPointer) return;
    if (message.type === "penecho-widget-drag-move") {
      queuedDragMove = message;
      if (!dragMoveFrame) dragMoveFrame = requestAnimationFrame(flushDragMove);
      return;
    }
    if (dragMoveFrame) cancelAnimationFrame(dragMoveFrame);
    flushDragMove();
    parent.postMessage(message, parentOrigin);
    forwardedDragPointer = null;
  }

  addEventListener("message", (event) => {
    if (receiveParentPublicFetch(event) || respondToWidgetHostProbe(event)) return;
    const message = event.data;
    if (event.source === parent && event.origin === parentOrigin) {
      if (message?.type === "penecho-widget-init") {
        mcpProgressState = null;
        if (typeof message.html !== "string" || message.html.length > MAX_HTML_LENGTH) return;
        if (message.pluginStyles !== undefined && (typeof message.pluginStyles !== "string" || message.pluginStyles.length > MAX_PLUGIN_STYLES_LENGTH)) return;
        snapshotDebugLog("init-received", { nextRuntimeVersion:runtimeVersion + 1, htmlLength:message.html.length });
        for (const requestId of [...pendingSnapshots.keys()]) snapshotError(requestId, "Widget changed during snapshot");
        initialized = true;
        runtimeVersion++;
        innerDocumentReady = false;
        inner.title = String(message.title || "Dynamic canvas widget").slice(0, 120);
        parent.postMessage({ type:"penecho-widget-runtime-diagnostics", errors:[], truncated:false }, parentOrigin);
        let imageHtml;
        try {imageHtml=resolveImageAssets(message.html,message.imageAssets);} catch(error) {parent.postMessage({type:"penecho-widget-runtime-diagnostics",errors:[{kind:"error",message:error.message}],truncated:false},parentOrigin);return;}
        const documentSource = widgetDocument(imageHtml, message.pluginStyles || "", runtimeVersion, message.sourceFormat, message.frameworkVersion);
        inner.removeAttribute("src");
        inner.srcdoc = documentSource;
        snapshotDebugLog("inner-srcdoc-assigned", { documentLength:documentSource.length });
      } else if (message?.type === "penecho-mcp-progress" && message.progress && JSON.stringify(message.progress).length <= 64000) {
        mcpProgressState = message.progress;
        inner.contentWindow?.postMessage({type:"penecho-mcp-progress",progress:message.progress},"*");
      } else if (message?.type === "penecho-widget-state" && typeof message.selected === "boolean" && typeof message.active === "boolean"
        && Number.isFinite(message.scaleX) && message.scaleX > 0 && Number.isFinite(message.scaleY) && message.scaleY > 0) {
        widgetState = { fitContent:message.fitContent === true, fitContentAxes:message.fitContentAxes, maximized:message.maximized === true, selected:message.selected, interactive:Boolean(message.interactive), active:message.active, navigationLocked:Boolean(message.navigationLocked), scaleX:message.scaleX, scaleY:message.scaleY };
        forwardWidgetState();
      } else if (message?.type === "penecho-widget-fit-request") {
        if (typeof message.requestId !== "string" || message.requestId.length > 128 || !["width", "height", "resize"].includes(message.hit)) return;
        inner.contentWindow?.postMessage({ type:message.type, requestId:message.requestId, hit:message.hit }, "*");
      } else if (message?.type === "penecho-widget-snapshot-request") {
        const requestedWidth = Number(message.width), requestedHeight = Number(message.height),
          timeoutMs = Math.max(1000, Math.min(SNAPSHOT_REQUEST_TIMEOUT_MS, Number(message.timeoutMs) || SNAPSHOT_REQUEST_TIMEOUT_MS));
        if (typeof message.requestId !== "string" || message.requestId.length > 128 || !Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight) || requestedWidth <= 0 || requestedHeight <= 0) {
          if (typeof message.requestId === "string" && message.requestId.length <= 128) snapshotError(message.requestId, "Widget snapshot request is invalid");
          return;
        }
        if (!initialized) {
          snapshotError(message.requestId, "Widget host is not initialized");
          return;
        }
        const timer = setTimeout(() => snapshotError(message.requestId, "Widget snapshot timed out", pendingSnapshots.get(message.requestId)?.forwarded?"WIDGET_CAPTURE_TIMEOUT":"WIDGET_READY_TIMEOUT"), timeoutMs);
        const request = { requestedWidth, requestedHeight, timeoutMs, timer, forwarded:false, highResolution:message.highResolution === true, fullContent:message.fullContent === true, startedAt:performance.now() };
        pendingSnapshots.set(message.requestId, request);
        snapshotDebugLog("snapshot-host-received", { requestId:message.requestId, timeoutMs, requestedWidth, requestedHeight });
        forwardSnapshotRequest(message.requestId, request);
      }
      return;
    }
    if (event.source !== inner.contentWindow || !message || typeof message !== "object") return;
    if (["penecho-widget-document-ready", "penecho-widget-snapshot", "penecho-widget-snapshot-error"].includes(message.type)) {
      snapshotDebugLog("inner-message", {
        type:message.type,
        requestId:typeof message.requestId === "string" ? message.requestId : null,
        messageRuntimeVersion:Number.isInteger(message.runtimeVersion) ? message.runtimeVersion : null,
        versionMatches:message.runtimeVersion === runtimeVersion,
        requestPending:typeof message.requestId === "string" ? pendingSnapshots.has(message.requestId) : null,
      });
    }
    if (message.type === "penecho-widget-presentation-size" && widgetState.maximized
      && message.runtimeVersion === runtimeVersion
      && [message.width, message.height].every(value => Number.isFinite(value) && value > 0 && value <= 100000)) {
      parent.postMessage({ type:message.type, width:message.width, height:message.height }, parentOrigin);
    } else if (message.type === "penecho-widget-fit-result" && typeof message.requestId === "string" && message.requestId.length <= 128
      && Number.isFinite(message.width) && message.width > 0 && Number.isFinite(message.height) && message.height > 0) {
      parent.postMessage({ type:message.type, requestId:message.requestId, width:message.width, height:message.height }, parentOrigin);
    } else if (message.type === "penecho-widget-exit-interaction" && widgetState.interactive) {
      parent.postMessage({ type:message.type }, parentOrigin);
    } else if (message.type === "penecho-widget-public-fetch-request") {
      if (typeof message.requestId !== "string" || !/^public-fetch-\d+$/.test(message.requestId) || message.requestId.length > 64 || typeof message.url !== "string" || message.url.length > PUBLIC_FETCH_MAX_URL_LENGTH) return;
      void proxyPublicFetch(message);
    } else if (message.type === "penecho-widget-document-ready" && message.runtimeVersion === runtimeVersion) {
      innerDocumentReady = true;
      if(mcpProgressState)inner.contentWindow?.postMessage({type:"penecho-mcp-progress",progress:mcpProgressState},"*");
      snapshotDebugLog("capture-ready-announced");
      parent.postMessage({ type:"penecho-widget-capture-ready" }, parentOrigin);
      for (const [requestId, request] of pendingSnapshots) forwardSnapshotRequest(requestId, request);
    } else if (validRuntimeDiagnostics(message)) {
      parent.postMessage({ type:message.type, errors:message.errors, truncated:message.truncated }, parentOrigin);
    } else if (validVisualExplainerDiagnostics(message)) {
      parent.postMessage({ type:message.type, diagnostics:message.diagnostics }, parentOrigin);
    } else if (message.type === "penecho-widget-user-action" && message.runtimeVersion===runtimeVersion && typeof message.text==="string" && message.text.length>0 && message.text.length<=4000 && typeof message.action==="string" && message.action.length<=80) {
      parent.postMessage({type:message.type,text:message.text,action:message.action},parentOrigin);
    } else if (message.type === "penecho-widget-updated") {
      if(message.loaded && message.runtimeVersion !== runtimeVersion)return;
      forwardWidgetState();
      const now = Date.now();
      if (!message.loaded && now - lastUpdate < UPDATE_FORWARD_INTERVAL_MS) return;
      lastUpdate = now;
      parent.postMessage({ type: "penecho-widget-updated", loaded:message.loaded===true }, parentOrigin);
    } else if (message.type === "penecho-widget-snapshot" && message.runtimeVersion === runtimeVersion && pendingSnapshots.has(message.requestId)) {
      const request = pendingSnapshots.get(message.requestId);
      if (request.fullContent) {
        if (!Number.isFinite(message.contentWidth) || !Number.isFinite(message.contentHeight)
          || message.contentWidth < request.requestedWidth || message.contentHeight < request.requestedHeight
          || message.contentWidth > 100000 || message.contentHeight > 100000) {
          snapshotError(message.requestId, "Widget full content dimensions are invalid");
          return;
        }
        request.requestedWidth = message.contentWidth;
        request.requestedHeight = message.contentHeight;
      }
      const targetScale = request.highResolution ? HIGH_RESOLUTION_SNAPSHOT_SCALE : 1,
        maximumDimension = request.highResolution ? MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION : MAX_SNAPSHOT_DIMENSION,
        maximumPixels = request.highResolution ? MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS : MAX_SNAPSHOT_PIXELS,
        maximumDataUrlLength = request.highResolution ? MAX_HIGH_RESOLUTION_SNAPSHOT_DATA_URL_LENGTH : MAX_SNAPSHOT_DATA_URL_LENGTH,
        scale = Math.min(targetScale, maximumDimension / request.requestedWidth, maximumDimension / request.requestedHeight, Math.sqrt(maximumPixels / (request.requestedWidth * request.requestedHeight))),
        expectedWidth = Math.max(1, Math.floor(request.requestedWidth * scale)),
        expectedHeight = Math.max(1, Math.floor(request.requestedHeight * scale));
      if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,") || message.dataUrl.length > maximumDataUrlLength || message.width !== expectedWidth || message.height !== expectedHeight) snapshotError(message.requestId, "Widget snapshot output is invalid");
      else {
        clearTimeout(request.timer);
        pendingSnapshots.delete(message.requestId);
        snapshotDebugLog("snapshot-host-success", {
          requestId:message.requestId,
          durationMs:Number((performance.now() - request.startedAt).toFixed(1)),
          width:message.width,
          height:message.height,
        });
        parent.postMessage({ type:message.type, requestId:message.requestId, dataUrl:message.dataUrl, width:message.width, height:message.height }, parentOrigin);
      }
    } else if (message.type === "penecho-widget-snapshot-error" && message.runtimeVersion === runtimeVersion && pendingSnapshots.has(message.requestId)) snapshotError(message.requestId, message.error, message.code, message.details||{});
    else if (validActivateMessage(message)) parent.postMessage({
      type:message.type,
      pointerId:message.pointerId,
      pointerType:message.pointerType,
      localX:message.localX,
      localY:message.localY,
      screenX:message.screenX,
      screenY:message.screenY,
    }, parentOrigin);
    else if (validDragMessage(message)) forwardDragMessage(message);
    else if (validTouchMessage(message)) parent.postMessage(message, parentOrigin);
  });

  announceWidgetHostReady();
})();
