"use strict";
(() => {
  const MAX_HTML_LENGTH = 200000,
    MAX_PLUGIN_STYLES_LENGTH = 32000,
    MAX_SNAPSHOT_DIMENSION = 2400,
    MAX_SNAPSHOT_PIXELS = 4800000,
    MAX_SNAPSHOT_DATA_URL_LENGTH = 28 * 1024 * 1024,
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
    rendererUrl = new URL("widget-renderer.js", location.href).href,
    publicFetchUrl = new URL("api/widget-fetch", location.href).href,
    connect = new URL(location.href).searchParams.getAll("connect"),
    inner = document.createElement("iframe");
  let initialized = false,
    lastUpdate = 0,
    forwardedDragPointer = null,
    queuedDragMove = null,
    dragMoveFrame = 0,
    innerDocumentUrl = null,
    runtimeVersion = 0,
    innerDocumentReady = false,
    widgetState = { selected:false, active:true, navigationLocked:false, scaleX:1, scaleY:1 };
  const pendingSnapshots = new Map();

  inner.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  inner.setAttribute("title", "Dynamic canvas widget");
  inner.addEventListener("load", forwardWidgetState);
  document.body.append(inner);
  function releaseInnerDocumentUrl() {
    if (!innerDocumentUrl) return;
    URL.revokeObjectURL(innerDocumentUrl);
    innerDocumentUrl = null;
  }
  addEventListener("pagehide", releaseInnerDocumentUrl, { once:true });
  function runtime(runtimeVersion) {
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
      MAX_SNAPSHOT_DIMENSION = 2400,
      MAX_SNAPSHOT_PIXELS = 4800000,
      SNAPSHOT_GENERATED_PSEUDOS = [
        { selector:"::before", placement:"prepend" },
        { selector:"::after", placement:"append" },
      ],
      PUBLIC_FETCH_MAX_URL_LENGTH = 16 * 1024;
    let widgetState = { selected:false, active:true, navigationLocked:false, scaleX:1, scaleY:1 },
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
      diagnosticsTimer = 0,
      diagnosticsTruncated = false;
    const runtimeErrors = new Map();
    const clock = () => typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
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
        }, 45000);
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
      const radius = (pointerType === "touch" ? CONTROL_RADIUS_PX : 16),
        scaleX = Math.max(.0001, Number(widgetState.scaleX) || 1),
        scaleY = Math.max(.0001, Number(widgetState.scaleY) || 1),
        width = Math.max(1, document.documentElement.clientWidth),
        height = Math.max(1, document.documentElement.clientHeight),
        distance = (x, y) => Math.hypot((clientX - x) * scaleX, (clientY - y) * scaleY),
        controls = [
          { hit:"resize", distance:distance(width, height) },
          { hit:"width", distance:distance(width, height / 2) },
          { hit:"height", distance:distance(width / 2, height) },
        ].filter((item) => item.distance <= radius).sort((a, b) => a.distance - b.distance);
      return controls[0]?.hit || null;
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
    }
    addEventListener("pointerdown", (event) => {
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
      const press = presses.get(event.pointerId);
      if (!press) return;
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
      if (presses.has(event.pointerId)) finishPress({ pointerId:event.pointerId }, true);
    }, { capture:true });
    addEventListener("blur", () => {
      for (const press of [...presses.values()]) finishPress({ pointerId:press.pointerId }, true);
    });
    addEventListener("click", (event) => {
      if (suppressClickUntil && clock() <= suppressClickUntil) {
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
      if (!presses.size && (!suppressClickUntil || clock() > suppressClickUntil)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    function notifyReady() {
      parent.postMessage({ type: UPDATED }, "*");
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
        elements = [document.documentElement, ...document.querySelectorAll("*")];
      try {
        for (const element of elements) {
          if (!element || element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
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
            if (pseudo.placement === "prepend") element.insertBefore(node, element.firstChild);
            else element.appendChild(node);
            inserted.push(node);
          }
        }
      } catch (error) {
        for (const node of inserted) node.remove();
        throw error;
      }
      return () => {
        for (const node of inserted) node.remove();
      };
    }
    function settleSnapshotFrame() {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (presented) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(presented);
        },
          timer = setTimeout(() => finish(false), 50);
        nativeRequestAnimationFrame(() => finish(true));
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
    async function snapshot(message) {
      let restoreSvgStyles = () => {},
        restoreCompatibleColors = () => {};
      try {
        const requestedWidth = Math.max(1, Number(message.width) || document.documentElement.clientWidth || 1),
          requestedHeight = Math.max(1, Number(message.height) || document.documentElement.clientHeight || 1),
          scale = Math.min(1, MAX_SNAPSHOT_DIMENSION / requestedWidth, MAX_SNAPSHOT_DIMENSION / requestedHeight, Math.sqrt(MAX_SNAPSHOT_PIXELS / (requestedWidth * requestedHeight))),
          timeoutMs = Math.max(500, Math.min(17500, Number(message.timeoutMs) || 17500));
        // Read the presented widget without pausing its live runtime. Cancelling
        // animation frames here can blank maps and canvases for the whole save.
        await settleSnapshotFrame();
        restoreSvgStyles = inlineSvgComputedStyles();
        restoreCompatibleColors = inlineSnapshotCompatibleColors();
        let captureExpired = false;
        const render = async () => {
          let canvas = null;
          try {
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
            const domSnapshotRenderer = globalThis.html2canvas;
            if (typeof domSnapshotRenderer !== "function") throw Error("Widget renderer is unavailable");
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
        const canvas = await withTimeout(render(), timeoutMs, () => (captureExpired = true));
        parent.postMessage({ type:"penecho-widget-snapshot", runtimeVersion, requestId:message.requestId, dataUrl:canvas.toDataURL("image/png"), width:canvas.width, height:canvas.height }, "*");
        canvas.width = canvas.height = 1;
      } catch (error) {
        parent.postMessage({ type: "penecho-widget-snapshot-error", runtimeVersion, requestId: message.requestId, error: error.message }, "*");
      } finally {
        try {
          restoreCompatibleColors();
        } finally {
          restoreSvgStyles();
        }
      }
    }
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
      } else if (event.data?.type === "penecho-widget-snapshot-request") void snapshot(event.data);
      else if (event.data?.type === "penecho-widget-state" && typeof event.data.selected === "boolean" && typeof event.data.active === "boolean"
        && Number.isFinite(event.data.scaleX) && event.data.scaleX > 0 && Number.isFinite(event.data.scaleY) && event.data.scaleY > 0) {
        const becameVisible = event.data.active && (!widgetStateReceived || !widgetState.active);
        widgetState = { selected:event.data.selected, active:event.data.active, navigationLocked:Boolean(event.data.navigationLocked), scaleX:event.data.scaleX, scaleY:event.data.scaleY };
        widgetStateReceived = true;
        setRuntimeActive(widgetState.active);
        if (becameVisible) notifyVisibleViewport();
      }
    });
    addEventListener("load", notifyReady, { once: true });
  }

  function snapshotError(requestId, message = "Widget snapshot failed") {
    clearTimeout(pendingSnapshots.get(requestId)?.timer);
    pendingSnapshots.delete(requestId);
    const error = String(message || "Widget snapshot failed").replace(/[\r\n\t]+/g, " ").slice(0, 300);
    console.warn("PenEcho widget snapshot failed:", error);
    parent.postMessage({ type:"penecho-widget-snapshot-error", requestId, error }, parentOrigin);
  }

  function forwardSnapshotRequest(requestId, request) {
    if (!innerDocumentReady || request.forwarded) return;
    request.forwarded = true;
    inner.contentWindow?.postMessage({
      type:"penecho-widget-snapshot-request",
      requestId,
      width:request.requestedWidth,
      height:request.requestedHeight,
      timeoutMs:Math.max(500, request.timeoutMs - 250),
    }, "*");
  }

  async function proxyPublicFetch(message) {
    const reply = (payload, transfer = []) => inner.contentWindow?.postMessage({ type:"penecho-widget-public-fetch-response", requestId:message.requestId, ...payload }, "*", transfer);
    try {
      const response = await fetch(publicFetchUrl, {
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

  function csp() {
    return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: ${rendererUrl}; style-src 'unsafe-inline' https:; connect-src https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; frame-src 'none'; worker-src blob: https:; object-src 'none'; form-action 'none'; base-uri 'none'`;
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

  function widgetDocument(html, pluginStyles = "", documentVersion = 0) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("base, iframe, object, embed, form, meta[http-equiv]").forEach((element) => element.remove());
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
    parsed.querySelectorAll("img[src],video[src],audio[src],source[src]").forEach((element) => {
      const value = element.getAttribute("src") || "";
      if (/^(?:data:|blob:)/i.test(value)) {
        element.setAttribute("referrerpolicy", "no-referrer");
        return;
      }
      if (!safeHttpsResource(element, "src")) element.removeAttribute("src");
    });
    parsed.querySelectorAll("a[href]").forEach(safeOutboundLink);
    const policy = parsed.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = csp();
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
    bridgeStyle.textContent = "html,body{background:transparent!important;color-scheme:light!important;font-size:clamp(36px,1.2cqw,52px);touch-action:none!important;overscroll-behavior:contain}html.penecho-widget-dragging,html.penecho-widget-dragging *{cursor:grabbing!important;user-select:none!important}html.penecho-widget-paused *,html.penecho-widget-paused *::before,html.penecho-widget-paused *::after{animation-play-state:paused!important}";
    parsed.head.append(bridgeStyle);
    const renderer = parsed.createElement("script");
    renderer.src = rendererUrl;
    parsed.body.append(renderer);
    const ready = parsed.createElement("script");
    ready.textContent = `parent.postMessage({type:"penecho-widget-document-ready",runtimeVersion:${JSON.stringify(documentVersion)}},"*")`;
    parsed.body.append(ready);
    const bridge = parsed.createElement("script");
    bridge.textContent = `(${runtime.toString()})(${JSON.stringify(documentVersion)})`;
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
  function forwardWidgetState() {
    inner.contentWindow?.postMessage({ type:"penecho-widget-state", ...widgetState }, "*");
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
    const message = event.data;
    if (event.source === parent && event.origin === parentOrigin) {
      if (message?.type === "penecho-widget-init") {
        if (typeof message.html !== "string" || message.html.length > MAX_HTML_LENGTH) return;
        if (message.pluginStyles !== undefined && (typeof message.pluginStyles !== "string" || message.pluginStyles.length > MAX_PLUGIN_STYLES_LENGTH)) return;
        for (const requestId of [...pendingSnapshots.keys()]) snapshotError(requestId, "Widget changed during snapshot");
        initialized = true;
        runtimeVersion++;
        innerDocumentReady = false;
        inner.title = String(message.title || "Dynamic canvas widget").slice(0, 120);
        parent.postMessage({ type:"penecho-widget-runtime-diagnostics", errors:[], truncated:false }, parentOrigin);
        releaseInnerDocumentUrl();
        innerDocumentUrl = URL.createObjectURL(new Blob([widgetDocument(message.html, message.pluginStyles || "", runtimeVersion)], { type:"text/html" }));
        inner.src = innerDocumentUrl;
      } else if (message?.type === "penecho-widget-state" && typeof message.selected === "boolean" && typeof message.active === "boolean"
        && Number.isFinite(message.scaleX) && message.scaleX > 0 && Number.isFinite(message.scaleY) && message.scaleY > 0) {
        widgetState = { selected:message.selected, active:message.active, navigationLocked:Boolean(message.navigationLocked), scaleX:message.scaleX, scaleY:message.scaleY };
        forwardWidgetState();
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
        const timer = setTimeout(() => snapshotError(message.requestId, "Widget snapshot timed out"), timeoutMs);
        const request = { requestedWidth, requestedHeight, timeoutMs, timer, forwarded:false };
        pendingSnapshots.set(message.requestId, request);
        forwardSnapshotRequest(message.requestId, request);
      }
      return;
    }
    if (event.source !== inner.contentWindow || !message || typeof message !== "object") return;
    if (message.type === "penecho-widget-public-fetch-request") {
      if (typeof message.requestId !== "string" || !/^public-fetch-\d+$/.test(message.requestId) || message.requestId.length > 64 || typeof message.url !== "string" || message.url.length > PUBLIC_FETCH_MAX_URL_LENGTH) return;
      void proxyPublicFetch(message);
    } else if (message.type === "penecho-widget-document-ready" && message.runtimeVersion === runtimeVersion) {
      innerDocumentReady = true;
      parent.postMessage({ type:"penecho-widget-capture-ready" }, parentOrigin);
      for (const [requestId, request] of pendingSnapshots) forwardSnapshotRequest(requestId, request);
    } else if (validRuntimeDiagnostics(message)) {
      parent.postMessage({ type:message.type, errors:message.errors, truncated:message.truncated }, parentOrigin);
    } else if (message.type === "penecho-widget-updated") {
      forwardWidgetState();
      const now = Date.now();
      if (now - lastUpdate < UPDATE_FORWARD_INTERVAL_MS) return;
      lastUpdate = now;
      parent.postMessage({ type: "penecho-widget-updated" }, parentOrigin);
    } else if (message.type === "penecho-widget-snapshot" && message.runtimeVersion === runtimeVersion && pendingSnapshots.has(message.requestId)) {
      const request = pendingSnapshots.get(message.requestId),
        scale = Math.min(1, MAX_SNAPSHOT_DIMENSION / request.requestedWidth, MAX_SNAPSHOT_DIMENSION / request.requestedHeight, Math.sqrt(MAX_SNAPSHOT_PIXELS / (request.requestedWidth * request.requestedHeight))),
        expectedWidth = Math.max(1, Math.floor(request.requestedWidth * scale)),
        expectedHeight = Math.max(1, Math.floor(request.requestedHeight * scale));
      if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,") || message.dataUrl.length > MAX_SNAPSHOT_DATA_URL_LENGTH || message.width !== expectedWidth || message.height !== expectedHeight) snapshotError(message.requestId, "Widget snapshot output is invalid");
      else {
        clearTimeout(request.timer);
        pendingSnapshots.delete(message.requestId);
        parent.postMessage({ type:message.type, requestId:message.requestId, dataUrl:message.dataUrl, width:message.width, height:message.height }, parentOrigin);
      }
    } else if (message.type === "penecho-widget-snapshot-error" && message.runtimeVersion === runtimeVersion && pendingSnapshots.has(message.requestId)) snapshotError(message.requestId, message.error);
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

  parent.postMessage({ type: "penecho-widget-host-ready" }, parentOrigin);
})();
