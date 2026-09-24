"use strict";
// PenEcho Studio shell: presentation-only helpers for studio-shell.css.
// Controls here forward to existing Canvas buttons, so the Canvas runtime
// keeps its own flows, state and side effects unchanged.
(() => {
  const COPY = {
    en: {
      welcomeActions: "Start with PenEcho",
      welcomeAgent: "Ask PenEcho Agent",
      welcomeMcp: "Connect your AI via MCP",
    },
    zh: {
      welcomeActions: "开始使用 PenEcho",
      welcomeAgent: "询问 PenEcho Agent",
      welcomeMcp: "通过 MCP 连接你的 AI",
    },
  };

  function language() {
    return String(document.documentElement.lang || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyCopy() {
    const copy = COPY[language()];
    for (const element of document.querySelectorAll("[data-shell-copy]")) {
      const text = copy[element.dataset.shellCopy];
      if (text && element.textContent !== text) element.textContent = text;
    }
    for (const element of document.querySelectorAll("[data-shell-aria]")) {
      const text = copy[element.dataset.shellAria];
      if (text && element.getAttribute("aria-label") !== text) element.setAttribute("aria-label", text);
    }
  }

  function clickExisting(selector) {
    const target = document.querySelector(selector);
    if (!target || target.disabled || target.closest("[hidden]")) return false;
    target.click();
    return true;
  }

  // data-shell-forward="#first,#second" clicks each existing control in order,
  // one frame apart, so a closing surface finishes before the next one opens.
  function forward(steps) {
    const [selector, ...rest] = steps;
    if (!selector || !clickExisting(selector)) return;
    if (rest.length) requestAnimationFrame(() => requestAnimationFrame(() => forward(rest)));
  }

  // Title bar "More" menu: New, Library, Export and Echo forward to the
  // original buttons, which stay in the DOM for every existing handler.
  const moreButton = document.querySelector("#canvasMoreBtn");
  const moreMenu = document.querySelector("#canvasMoreMenu");
  function moreItems() {
    return moreMenu ? [...moreMenu.querySelectorAll('[role="menuitem"]')].filter((item) => !item.hidden && !item.disabled) : [];
  }
  function syncMoreItems() {
    for (const item of moreMenu?.querySelectorAll("[data-shell-forward]") || []) {
      const target = document.querySelector(String(item.dataset.shellForward).split(",")[0]);
      item.hidden = !target || target.hidden;
      item.disabled = Boolean(target?.disabled);
    }
  }
  function moreOpen() {
    return Boolean(moreMenu && !moreMenu.hidden);
  }
  function setMoreOpen(open, { focus = "" } = {}) {
    if (!moreMenu || !moreButton) return;
    if (open) syncMoreItems();
    moreMenu.hidden = !open;
    moreButton.setAttribute("aria-expanded", String(open));
    if (open && focus === "first") moreItems()[0]?.focus();
    else if (open && focus === "last") moreItems().at(-1)?.focus();
    else if (!open && focus === "button") moreButton.focus();
  }
  moreButton?.addEventListener("click", () => setMoreOpen(!moreOpen()));
  moreButton?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMoreOpen(true, { focus:event.key === "ArrowDown" ? "first" : "last" });
    }
  });
  moreMenu?.addEventListener("keydown", (event) => {
    const items = moreItems(), index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMoreOpen(false, { focus:"button" });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    } else if (event.key === "Tab") setMoreOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (moreOpen() && !moreMenu.contains(event.target) && !moreButton.contains(event.target)) setMoreOpen(false);
  }, true);

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest("[data-shell-forward]") : null;
    if (!trigger) return;
    event.preventDefault();
    if (moreMenu?.contains(trigger)) setMoreOpen(false);
    forward(String(trigger.dataset.shellForward || "").split(",").map((step) => step.trim()).filter(Boolean));
  });

  // Welcome actions sit above the drawing surface; keep their presses out of
  // Canvas gestures that listen on ancestors during the bubble phase.
  document.querySelector("#canvasAutoPausedNotice")?.addEventListener("pointerdown", event => event.stopPropagation());
  document.querySelector("#canvasWelcomeActions")?.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) event.stopPropagation();
  });

  // Keep the merged manual AI action on the existing runtime path, including
  // stopping an active request and localized accessible labels.
  const aiRun = document.querySelector("#aiToolbarRun");
  const aiOrb = document.querySelector("#aiOrb");
  const embodiment = document.querySelector("#aiEmbodiment");
  function syncAIAction() {
    if (!aiRun || !aiOrb) return;
    aiRun.disabled = aiOrb.disabled;
    const pauseAction = document.querySelector("#canvasAutoPausedNotice");
    if (pauseAction) {
      pauseAction.disabled = aiOrb.disabled;
      pauseAction.title = aiOrb.getAttribute("aria-label") || "";
    }
    for (const name of ["aria-label", "title"]) {
      const value = aiOrb.getAttribute(name) || aiOrb.getAttribute("aria-label");
      if (value) aiRun.setAttribute(name, value);
    }
    aiRun.dataset.busy = String(embodiment?.getAttribute("aria-busy") === "true");
  }
  if (aiOrb && embodiment) {
    const observer = new MutationObserver(syncAIAction);
    observer.observe(aiOrb, { attributes: true, attributeFilter: ["aria-label", "title", "disabled"] });
    observer.observe(embodiment, { attributes: true, attributeFilter: ["aria-busy"] });
    syncAIAction();
  }

  const viewControls = document.querySelector("#canvasZoomControls");
  const fitButton = document.querySelector("#canvasFitContents");
  const lockButton = document.querySelector("#canvasNavigationLock");
  const separator = document.createElement("span");
  separator.className = "canvas-view-divider";
  separator.setAttribute("aria-hidden", "true");
  function groupViewControls() {
    if (document.body.dataset.theme === "studio" && matchMedia("(min-width: 701px)").matches) {
      if (fitButton.parentElement !== viewControls) viewControls.append(separator, fitButton, lockButton);
    } else if (fitButton.parentElement === viewControls) {
      viewControls.before(fitButton, lockButton);
      separator.remove();
    }
  }
  groupViewControls();
  window.addEventListener("resize", groupViewControls);
  new MutationObserver(groupViewControls).observe(document.body, { attributes:true, attributeFilter:["data-theme"] });

  const dock = document.querySelector(".primary-tools");
  const aiTools = document.querySelector("#aiToolsSection");
  const zoomControls = document.querySelector("#canvasZoomControls");
  if (dock && aiTools && zoomControls) {
    const space = document.createElement("span");
    space.className = "shell-dock-space";
    space.setAttribute("aria-hidden", "true");
    document.body.append(space);
    let frame = 0;
    function layoutDock() {
      frame = 0;
      const body = document.body;
      if (body.dataset.theme !== "studio" || !matchMedia("(min-width: 701px)").matches) {
        delete body.dataset.shellDockLayout;
        return;
      }
      const scale = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const measure = element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left / scale, width: rect.width / scale, height: rect.height / scale };
      };
      const viewport = measure(document.querySelector("#viewport"));
      space.style.left = `${viewport.left + 16}px`;
      space.style.right = "auto";
      space.style.width = `${Math.max(0, viewport.width - 32)}px`;
      const available = measure(space);
      if (!available.width || !dock.getClientRects().length) return;
      // Measure both arrangements synchronously; only the selected result paints.
      body.dataset.shellDockMeasuring = "";
      delete body.dataset.shellDockSides;
      body.dataset.shellDockLayout = "horizontal";
      const toolsWidth = Math.ceil(measure(dock).width);
      let viewWidth = measure(zoomControls).width;
      const pauseNotice = document.querySelector("#canvasAutoPausedNotice");
      const aiSurface = pauseNotice && !pauseNotice.hidden ? pauseNotice : aiTools;
      let aiWidth = Math.ceil(measure(aiSurface).width);
      const gap = 8;
      let mode = "horizontal";
      if (viewWidth + toolsWidth + aiWidth + gap * 2 > available.width) {
        body.dataset.shellDockLayout = "vertical";
        viewWidth = measure(zoomControls).width;
        aiWidth = Math.ceil(measure(aiSurface).width);
        mode = "vertical";
        if (viewWidth + toolsWidth + aiWidth + gap * 2 > available.width) {
          mode = "rows";
          body.dataset.shellDockLayout = mode;
          viewWidth = measure(zoomControls).width;
          aiWidth = Math.ceil(measure(aiSurface).width);
          if (viewWidth + aiWidth + gap > available.width || (aiSurface === pauseNotice && aiWidth < 180)) {
            body.dataset.shellDockSides = "compact";
            viewWidth = measure(zoomControls).width;
            aiWidth = Math.ceil(measure(aiSurface).width);
          }
        }
      }
      // Prefer the canvas center, then yield to the fixed edge controls before
      // adding a second row. All measurements use the actual remaining canvas.
      const centeredX = available.left + Math.max(0, (available.width - toolsWidth) / 2);
      const toolsX = mode === "rows" ? centeredX : Math.max(available.left + viewWidth + gap,
        Math.min(centeredX, available.left + available.width - aiWidth - gap - toolsWidth));
      const aiX = available.left + available.width - aiWidth;
      const viewHeight = measure(zoomControls).height;
      const aiHeight = measure(aiSurface).height;
      const values = {
        "view-x": available.left,
        "tools-x": toolsX,
        "ai-x": aiX,
        "tools-max": available.width,
        "canvas-width": available.width,
        "notice-bottom": mode === "rows" ? 16 + Math.max(viewHeight, aiHeight) + 44 + 24 : 16 + Math.max(measure(dock).height, viewHeight, aiHeight) + 12,
        "ai-height": aiHeight,
        "view-height": viewHeight,
        "row-height": Math.max(measure(dock).height, viewHeight, aiHeight),
      };
      for (const [key, value] of Object.entries(values)) body.style.setProperty(`--pe-shell-${key}`, `${value}px`);
      body.dataset.shellDockLayout = mode;
      delete body.dataset.shellDockMeasuring;
    }
    function scheduleDockLayout() {
      if (!frame) frame = requestAnimationFrame(layoutDock);
    }
    const sizes = new ResizeObserver(scheduleDockLayout);
    for (const element of [space, dock, aiTools, zoomControls, document.querySelector("#viewport"), document.querySelector("#canvasAutoPausedNotice")]) {
      if (element) sizes.observe(element);
    }
    const changes = new MutationObserver(scheduleDockLayout);
    changes.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme", "data-canvas-mode"] });
    const canvasFrame = document.querySelector(".canvas-frame");
    if (canvasFrame) changes.observe(canvasFrame, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", scheduleDockLayout);
    changes.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-penecho-page-scale"] });
    document.fonts?.ready.then(scheduleDockLayout);
    scheduleDockLayout();
  }

  applyCopy();
  new MutationObserver(applyCopy).observe(document.documentElement, { attributes:true, attributeFilter:["lang"] });
})();
