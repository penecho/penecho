  // Slides made with the PPT skill are 1280x720 Widgets marked data-penecho-slide. Download PPT turns
  // the whole deck on this Canvas into one .pptx: one PowerPoint slide per Widget, text kept editable,
  // boxes as shapes, charts drawn with the SC library as native PowerPoint charts, and other pictures and gradients as sharp images.
  const SLIDE_MARK = /\bdata-penecho-slide\b/i,
    SLIDE_REQUEST_TIMEOUT_MS = 20000,
    widgetSlideRequests = new Map();
  let pptxLibrary = null;
  const slidesCopy = (en, zh) => state.language === "zh" ? zh : en;
  function slideWidget(widget) {
    return Boolean(widget && !widget.pending && typeof widget.html === "string" && SLIDE_MARK.test(widget.html));
  }
  function slideDeckName(widget) {
    return /\bdata-penecho-deck\s*=\s*["']([^"']{1,120})["']/i.exec(widget?.html || "")?.[1] || "";
  }
  // The deck a slide belongs to, in reading order: rows from top to bottom, left to right in a row.
  function slideDeck(widget) {
    const deck = slideDeckName(widget),
      slides = state.widgets.filter(item => slideWidget(item) && slideDeckName(item) === deck),
      rowHeight = Math.max(1, Math.min(...slides.map(item => Number(item.h) || 720)) * 0.5);
    return slides.sort((a, b) => Math.round((a.y - b.y) / rowHeight) || a.x - b.x || a.y - b.y);
  }
  function slideToolbarLabel(widget) {
    const count = slideDeck(widget).length;
    return count > 1 ? slidesCopy(`Download PPT (${count} slides)`, `下载 PPT（${count} 页）`) : slidesCopy("Download PPT", "下载 PPT");
  }
  function widgetSlideMessage(widget, message) {
    const pending = widgetSlideRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    widgetSlideRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === "penecho-widget-slide" && Array.isArray(message.slide?.items)) pending.resolve(message.slide);
    else pending.reject(Error(String(message.error || slidesCopy("The slide could not be read.", "无法读取这一页。"))));
  }
  // What the slide's own check found once it rendered (empty panels, cut-off or overlapping text, hidden labels).
  async function requestWidgetSlideCheck(widget, timeoutMs = 8000) {
    let timer = 0;
    try {
      const slide = await Promise.race([requestWidgetSlide(widget, { check:true }), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
      return Array.isArray(slide?.check) ? slide.check : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  async function requestWidgetSlide(widget, { check = false } = {}) {
    if (!widget.frame?.contentWindow) throw Error(slidesCopy("Open the Canvas where this slide is, then try again.", "请打开这一页所在的画布后再试。"));
    if (!widget.hostReady && widget.hostReadyPromise) await widget.hostReadyPromise;
    const wasActive = widget.renderActive;
    widget.renderActive = true;
    widget.shell?.classList.remove("widget-offscreen");
    if (!widget.initialized) sendWidgetInit(widget);
    sendWidgetHostState(widget, undefined, undefined, true);
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          widgetSlideRequests.delete(requestId);
          reject(Error(slidesCopy("A slide took too long to answer.", "某一页响应超时。")));
        }, SLIDE_REQUEST_TIMEOUT_MS);
        widgetSlideRequests.set(requestId, { widget, resolve, reject, timer });
        widget.frame.contentWindow.postMessage({ type:"penecho-widget-slide-request", requestId, check }, widget.hostOrigin || location.origin);
      });
    } finally {
      if (wasActive === false && widget.styleRule?.style && !widget.mcpEphemeral) positionWidget(widget);
    }
  }
  // PptxGenJS ships in the Ink Lab bundle the server already serves.
  function loadPptxLibrary() {
    if (window.PENECHO_INK_TOOLS?.PptxGenJS) return Promise.resolve(window.PENECHO_INK_TOOLS.PptxGenJS);
    pptxLibrary ||= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/ink-lab-vendor.js";
      script.async = true;
      script.onload = () => window.PENECHO_INK_TOOLS?.PptxGenJS ? resolve(window.PENECHO_INK_TOOLS.PptxGenJS) : reject(Error("PowerPoint library is unavailable."));
      script.onerror = () => reject(Error("PowerPoint library is unavailable."));
      document.head.append(script);
    }).catch(error => { pptxLibrary = null; throw error; });
    return pptxLibrary;
  }
  // The slides themselves become PowerPoint in src/shared/slides-pptx.js, which the Lines pages use too.
  const { pptFilename, buildDeck } = PenEchoSlidesPptx;
  function slidesFilename(widgets) {
    return pptFilename(slideDeckName(widgets[0]) || String(widgets[0]?.title || "").replace(/^\s*\d+\s*[·.:-]\s*/, ""));
  }
  async function downloadSlidesPptx(widget) {
    if (!widget || widget.pptxBusy) return false;
    const deck = slideDeck(widget);
    if (!deck.length) return false;
    deck.forEach(item => { item.pptxBusy = true; });
    syncObjectChrome();
    setStatus(slidesCopy(`Making a PowerPoint from ${deck.length} ${deck.length === 1 ? "slide" : "slides"}…`, `正在把 ${deck.length} 页做成 PowerPoint…`));
    try {
      const [PptxGenJS, slides] = await Promise.all([loadPptxLibrary(), Promise.all(deck.map(item => requestWidgetSlide(item)))]);
      const blob = await buildDeck(PptxGenJS, slides.map((data, index) => ({ data, title:deck[index].title })), slideDeckName(deck[0]) || deck[0].title),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = slidesFilename(deck);
      try { document.body.append(link); link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      setStatus(slidesCopy(`Downloaded ${link.download}`, `已下载 ${link.download}`));
      return true;
    } catch (error) {
      setStatus(slidesCopy("Download PPT failed: ", "下载 PPT 失败：") + String(error?.message || error));
      return false;
    } finally {
      deck.forEach(item => { item.pptxBusy = false; });
      syncObjectChrome();
    }
  }
