"use strict";

const CANVAS_PAGE_SCALES = Object.freeze([0.9, 1, 1.1, 1.2]);
const CANVAS_PAGE_SCALE = 1;
const CANVAS_PAGE_SCALE_STORAGE_KEY = "penecho-canvas-page-scale";

function normalizeCanvasPageScale(value) {
  const requested = Number(value);
  if (requested === 1.25) return 1.2;
  return CANVAS_PAGE_SCALES.find(scale => Math.abs(scale - requested) < 0.0001) || CANVAS_PAGE_SCALE;
}

if (typeof module !== "undefined" && module.exports) module.exports = {
  CANVAS_PAGE_SCALE,
  CANVAS_PAGE_SCALES,
  CANVAS_PAGE_SCALE_STORAGE_KEY,
  normalizeCanvasPageScale,
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const root = document.documentElement;
  // The Projects shell and standalone Canvas each own their page zoom. Their
  // same-origin frames inherit it, including the Canvas kept warm by Projects.
  const parentPageScale = (() => {
    try { return window.parent !== window ? window.parent?.PenEchoPageScale : null; } catch { return null; }
  })();
  const nativePageScale = typeof window.penechoDesktop?.setPageScale === "function";
  let currentScale;

  function applyCanvasPageScale(value, { persist = true } = {}) {
    const scale = normalizeCanvasPageScale(value);
    if (persist) {
      if (parentPageScale) parentPageScale.apply(scale);
      else {
        try { localStorage.setItem(CANVAS_PAGE_SCALE_STORAGE_KEY, String(scale)); } catch {}
      }
    }
    if (scale === currentScale) return scale;
    currentScale = scale;
    // For what must line up with the window's own buttons, which native zoom does not resize.
    root.dataset.windowScale = String(Math.round(scale * 100));
    if (!parentPageScale) {
      if (nativePageScale) void window.penechoDesktop.setPageScale(scale);
      else {
        root.classList.toggle("penecho-web-page-scale", scale !== CANVAS_PAGE_SCALE);
        if (scale === CANVAS_PAGE_SCALE) delete root.dataset.penechoPageScale;
        else root.dataset.penechoPageScale = String(Math.round(scale * 100));
      }
    }
    window.dispatchEvent(new Event("penecho:page-scale-change"));
    return scale;
  }

  function syncCanvasPageScale() {
    let stored = parentPageScale?.current();
    try {
      stored = localStorage.getItem(CANVAS_PAGE_SCALE_STORAGE_KEY);
      if (!parentPageScale && Number(stored) === 1.25) localStorage.setItem(CANVAS_PAGE_SCALE_STORAGE_KEY, "1.2");
    } catch {}
    return applyCanvasPageScale(stored, { persist:false });
  }

  function readLayoutScale() {
    const readStyle = typeof window.getComputedStyle === "function" ? window.getComputedStyle : (typeof getComputedStyle === "function" ? getComputedStyle : null);
    const raw = readStyle ? readStyle(root)?.zoom : "";
    const str = String(raw || "").trim();
    const value = str.endsWith("%") ? parseFloat(str) / 100 : parseFloat(str);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  window.PenEchoPageScale = Object.freeze({
    choices:CANVAS_PAGE_SCALES,
    current:() => currentScale,
    apply:applyCanvasPageScale,
    syncFromStorage:syncCanvasPageScale,
    layoutScale:readLayoutScale,
  });
  window.addEventListener("storage", event => {
    if (event.key === CANVAS_PAGE_SCALE_STORAGE_KEY || event.key === null) syncCanvasPageScale();
  });
  syncCanvasPageScale();
}
