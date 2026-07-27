"use strict";
(() => {
  const MAX_HTML_LENGTH = 40000,
    MAX_COPY_TEXT_LENGTH = 16000,
    MAX_SNAPSHOT_DIMENSION = 2400,
    MAX_SNAPSHOT_PIXELS = 4800000,
    MAX_SNAPSHOT_DATA_URL_LENGTH = 28 * 1024 * 1024,
    SNAPSHOT_REQUEST_TIMEOUT_MS = 15000,
    parentOrigin = location.origin,
    rendererUrl = new URL("widget-renderer.js", location.href).href,
    connect = new URL(location.href).searchParams.getAll("connect"),
    inner = document.createElement("iframe"),
    copySourceButton = document.querySelector("#widgetCopySource");
  let initialized = false,
    lastUpdate = 0,
    forwardedDragPointer = null,
    queuedDragMove = null,
    dragMoveFrame = 0,
    widgetState = { selected:false, scaleX:1, scaleY:1 },
    copySourceText = "";
  const pendingSnapshots = new Map();

  inner.setAttribute("sandbox", "allow-scripts");
  inner.setAttribute("title", "Dynamic canvas widget");
  document.body.append(inner);
  copySourceButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  copySourceButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!copySourceText) return;
    let nativeCopy = null;
    try {
      nativeCopy = navigator.clipboard?.writeText ? navigator.clipboard.writeText(copySourceText) : null;
    } catch {}
    const field = document.createElement("textarea");
    field.value = copySourceText;
    field.setAttribute("readonly", "");
    field.setAttribute("tabindex", "-1");
    Object.assign(field.style, { position:"fixed", left:"-10000px", top:"0", opacity:"0" });
    document.body.append(field);
    try {
      field.focus({ preventScroll:true });
    } catch {
      field.focus();
    }
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try {
      copied = Boolean(document.execCommand?.("copy"));
    } catch {}
    field.remove();
    try {
      copySourceButton.focus({ preventScroll:true });
    } catch {
      copySourceButton.focus();
    }
    if (nativeCopy) {
      try {
        await nativeCopy;
        copied = true;
      } catch {}
    }
    parent.postMessage({ type:"penecho-widget-copy-source-result", copied }, parentOrigin);
  });

  function updateCopySourceScale() {
    const scaleX = Math.max(.0001, Number(widgetState.scaleX) || 1),
      scaleY = Math.max(.0001, Number(widgetState.scaleY) || 1);
    copySourceButton.style.transform = `scale(${1 / scaleX},${1 / scaleY})`;
  }

  function runtime() {
    const UPDATED = "penecho-widget-updated",
      DRAG_START = "penecho-widget-drag-start",
      DRAG_MOVE = "penecho-widget-drag-move",
      DRAG_END = "penecho-widget-drag-end",
      TOUCH_START = "penecho-widget-touch-start",
      TOUCH_MOVE = "penecho-widget-touch-move",
      TOUCH_END = "penecho-widget-touch-end",
      HOLD_MS = 500,
      MOVE_TOLERANCE_PX = 8,
      CONTROL_RADIUS_PX = 26,
      MAX_SNAPSHOT_DIMENSION = 2400,
      MAX_SNAPSHOT_PIXELS = 4800000;
    let widgetState = { selected:false, scaleX:1, scaleY:1 },
      suppressClickUntil = 0;
    const presses = new Map();
    const clock = () => typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
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
      if (!widgetState.selected) return "move";
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
      return controls[0]?.hit || "move";
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
      if (!press) return;
      clearHoldTimer(press);
      press.clientX = Number(event.clientX);
      press.clientY = Number(event.clientY);
      press.screenX = Number(event.screenX);
      press.screenY = Number(event.screenY);
      if (press.active) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        pointerMessage(DRAG_END, { ...press, cancelled });
        suppressClickUntil = clock() + 650;
      }
      if (press.pointerType === "touch") pointerMessage(TOUCH_END, { ...press, cancelled });
      if (press.captured) try { document.documentElement.releasePointerCapture(press.pointerId); } catch {}
      presses.delete(event.pointerId);
      if (![...presses.values()].some((item) => item.active)) document.documentElement.classList.remove("penecho-widget-dragging");
    }
    addEventListener("pointerdown", (event) => {
      if (presses.has(event.pointerId) || Number(event.button) !== 0 || !["mouse", "pen", "touch"].includes(event.pointerType)) return;
      const press = {
        pointerId:event.pointerId,
        pointerType:event.pointerType,
        clientX:Number(event.clientX),
        clientY:Number(event.clientY),
        startX:Number(event.screenX),
        startY:Number(event.screenY),
        screenX:Number(event.screenX),
        screenY:Number(event.screenY),
        hit:controlHit(Number(event.clientX), Number(event.clientY), event.pointerType),
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
      if (widgetState.selected && press.hit !== "move" && touchCount() < 2) {
        activateHold(press);
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (!widgetState.selected && touchCount() < 2) press.timer = setTimeout(() => activateHold(press), HOLD_MS);
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
        event.preventDefault();
        event.stopImmediatePropagation();
        pointerMessage(DRAG_MOVE, press);
        return;
      }
      const moved = Math.hypot(screenX - press.startX, screenY - press.startY) > MOVE_TOLERANCE_PX;
      if (press.pointerType === "touch" && (press.navigation || touchCount() >= 2 || (!widgetState.selected && moved))) {
        if (moved || touchCount() >= 2) {
          clearHoldTimer(press);
          press.navigation = true;
          capturePointer(press);
          suppressClickUntil = clock() + 650;
          event.preventDefault();
          event.stopImmediatePropagation();
          pointerMessage(TOUCH_MOVE, press);
        }
        return;
      }
      if (!moved) return;
      clearHoldTimer(press);
      if (widgetState.selected) {
        activateHold(press);
        event.preventDefault();
        event.stopImmediatePropagation();
        pointerMessage(DRAG_MOVE, press);
      } else presses.delete(event.pointerId);
    }, { capture:true, passive:false });
    addEventListener("pointerup", (event) => finishPress(event), { capture:true, passive:false });
    addEventListener("pointercancel", (event) => finishPress(event, true), { capture:true, passive:false });
    addEventListener("click", (event) => {
      if (!suppressClickUntil || clock() > suppressClickUntil) {
        suppressClickUntil = 0;
        return;
      }
      suppressClickUntil = 0;
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
    function inlineSvgComputedStyles() {
      const properties = [
          "fill", "fill-opacity", "fill-rule",
          "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
          "color", "opacity", "visibility", "display",
          "font-family", "font-size", "font-style", "font-weight",
          "text-anchor", "dominant-baseline", "paint-order",
          "marker-start", "marker-mid", "marker-end",
          "stop-color", "stop-opacity",
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
            attributes = [];
          for (const property of properties) {
            const value = computed.getPropertyValue(property).trim();
            if (!value) continue;
            attributes.push([property, element.hasAttribute(property), element.getAttribute(property)]);
            element.setAttribute(property, value);
          }
          if (attributes.length) records.push([element, attributes]);
        }
      }
      return () => {
        for (const [element, attributes] of records) {
          for (const [property, present, value] of attributes) {
            if (present) element.setAttribute(property, value);
            else element.removeAttribute(property);
          }
        }
        for (const background of backgrounds) background.remove();
      };
    }
    async function snapshot(message) {
      let restoreSvgStyles = () => {};
      try {
        const requestedWidth = Math.max(1, Number(message.width) || document.documentElement.clientWidth || 1),
          requestedHeight = Math.max(1, Number(message.height) || document.documentElement.clientHeight || 1),
          scale = Math.min(1, MAX_SNAPSHOT_DIMENSION / requestedWidth, MAX_SNAPSHOT_DIMENSION / requestedHeight, Math.sqrt(MAX_SNAPSHOT_PIXELS / (requestedWidth * requestedHeight)));
        if (typeof globalThis.html2canvas !== "function") throw Error("Widget renderer is unavailable");
        restoreSvgStyles = inlineSvgComputedStyles();
        const canvas = await globalThis.html2canvas(document.documentElement, {
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
          imageTimeout:10000,
        });
        parent.postMessage({ type:"penecho-widget-snapshot", requestId:message.requestId, dataUrl:canvas.toDataURL("image/png"), width:canvas.width, height:canvas.height }, "*");
        canvas.width = canvas.height = 1;
      } catch (error) {
        parent.postMessage({ type: "penecho-widget-snapshot-error", requestId: message.requestId, error: error.message }, "*");
      } finally {
        restoreSvgStyles();
      }
    }
    addEventListener("message", (event) => {
      if (event.source !== parent) return;
      if (event.data?.type === "penecho-widget-snapshot-request") void snapshot(event.data);
      else if (event.data?.type === "penecho-widget-state" && typeof event.data.selected === "boolean"
        && Number.isFinite(event.data.scaleX) && event.data.scaleX > 0 && Number.isFinite(event.data.scaleY) && event.data.scaleY > 0) {
        widgetState = { selected:event.data.selected, scaleX:event.data.scaleX, scaleY:event.data.scaleY };
      }
    });
    addEventListener("load", notifyReady, { once: true });
  }

  function snapshotError(requestId, message = "Widget snapshot failed") {
    clearTimeout(pendingSnapshots.get(requestId)?.timer);
    pendingSnapshots.delete(requestId);
    parent.postMessage({ type:"penecho-widget-snapshot-error", requestId, error:message }, parentOrigin);
  }

  function csp() {
    const origins = connect.length ? connect.join(" ") : "'none'";
    const images = connect.length ? `data: blob: ${connect.join(" ")}` : "data: blob:";
    return `default-src 'none'; script-src 'unsafe-inline' ${rendererUrl}; style-src 'unsafe-inline'; connect-src ${origins}; img-src ${images}; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  }

  function widgetDocument(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("base, iframe, object, embed, form, link[rel='stylesheet'], meta[http-equiv], script[src]").forEach((element) => element.remove());
    const policy = parsed.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = csp();
    parsed.head.prepend(policy);
    const viewport = parsed.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width,initial-scale=1";
    parsed.head.prepend(viewport);
    const bridgeStyle = parsed.createElement("style");
    bridgeStyle.textContent = "html,body{background:transparent!important;color-scheme:light!important;touch-action:none!important;overscroll-behavior:contain}html.penecho-widget-dragging,html.penecho-widget-dragging *{cursor:grabbing!important;user-select:none!important}";
    parsed.head.append(bridgeStyle);
    const renderer = parsed.createElement("script");
    renderer.src = rendererUrl;
    parsed.body.append(renderer);
    const bridge = parsed.createElement("script");
    bridge.textContent = `(${runtime.toString()})()`;
    parsed.body.append(bridge);
    return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  }

  function validDragMessage(message) {
    return message && ["penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && ["move", "width", "height", "resize"].includes(message.hit)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validTouchMessage(message) {
    return message && ["penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && message.pointerType === "touch"
      && [message.localX, message.localY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
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
        if (initialized || typeof message.html !== "string" || message.html.length > MAX_HTML_LENGTH) return;
        if (message.copyText !== undefined && (typeof message.copyText !== "string" || !message.copyText.trim() || message.copyText.length > MAX_COPY_TEXT_LENGTH)) return;
        if (message.copyLabel !== undefined && (typeof message.copyLabel !== "string" || !message.copyLabel.trim() || message.copyLabel.length > 80)) return;
        initialized = true;
        inner.title = String(message.title || "Dynamic canvas widget").slice(0, 120);
        copySourceText = typeof message.copyText === "string" ? message.copyText.trim() : "";
        copySourceButton.hidden = !copySourceText;
        if (copySourceText) {
          copySourceButton.textContent = String(message.copyLabel || "Copy source").trim();
          copySourceButton.setAttribute("aria-label", copySourceButton.textContent);
          copySourceButton.title = copySourceButton.textContent;
          updateCopySourceScale();
        }
        inner.srcdoc = widgetDocument(message.html);
      } else if (message?.type === "penecho-widget-state" && typeof message.selected === "boolean"
        && Number.isFinite(message.scaleX) && message.scaleX > 0 && Number.isFinite(message.scaleY) && message.scaleY > 0) {
        widgetState = { selected:message.selected, scaleX:message.scaleX, scaleY:message.scaleY };
        updateCopySourceScale();
        forwardWidgetState();
      } else if (message?.type === "penecho-widget-snapshot-request" && initialized) {
        const requestedWidth = Number(message.width), requestedHeight = Number(message.height);
        if (typeof message.requestId !== "string" || message.requestId.length > 128 || !Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight) || requestedWidth <= 0 || requestedHeight <= 0) return;
        const timer = setTimeout(() => pendingSnapshots.delete(message.requestId), SNAPSHOT_REQUEST_TIMEOUT_MS);
        pendingSnapshots.set(message.requestId, { requestedWidth, requestedHeight, timer });
        inner.contentWindow?.postMessage({ type:message.type, requestId:message.requestId, width:requestedWidth, height:requestedHeight }, "*");
      }
      return;
    }
    if (event.source !== inner.contentWindow || !message || typeof message !== "object") return;
    if (message.type === "penecho-widget-updated") {
      forwardWidgetState();
      const now = Date.now();
      if (now - lastUpdate < 500) return;
      lastUpdate = now;
      parent.postMessage({ type: "penecho-widget-updated" }, parentOrigin);
    } else if (message.type === "penecho-widget-snapshot" && pendingSnapshots.has(message.requestId)) {
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
    } else if (message.type === "penecho-widget-snapshot-error" && pendingSnapshots.has(message.requestId)) snapshotError(message.requestId, "Widget content could not be rendered");
    else if (validDragMessage(message)) forwardDragMessage(message);
    else if (validTouchMessage(message)) parent.postMessage(message, parentOrigin);
  });

  parent.postMessage({ type: "penecho-widget-host-ready" }, parentOrigin);
})();
