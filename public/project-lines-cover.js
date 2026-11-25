"use strict";
// The selected Canvas starts reading with the page, while the editor's scripts load.
// Keep this response in this page only: the folder is read afresh on every visit.
(() => {
  const q = new URLSearchParams(location.search), config = window.PENECHO_CONFIG || {};
  const project = q.get("linesProject"), source = q.get("linesCanvas");
  if (!project || !source || (!window.PenEchoHostedProjectCanvas && ["viewer", "cloud"].includes(config.runtime)) || config.browserDraftId || config.guestCanvas) return;
  const url = `/api/lines/projects/${encodeURIComponent(project)}/canvas?${new URLSearchParams({ path:source, doc:q.get("linesDoc") || "" })}`;
  window.projectLinesCanvasLoad = { url, response:(window.PenEchoHostedProjectCanvas?.fetch || fetch)(url, { credentials:"same-origin", headers:{ accept:"application/json" } }).catch(() => null) };
})();
// Hosted inside the persistent Projects shell (projects.html?shell=1): inherit desktop capabilities from
// the top-level window without spawning a duplicate sidebar iframe or flashing a white cover.
(() => {
  const q = new URLSearchParams(location.search);
  const inShell = q.get("shell") === "1" && typeof window.parent !== "undefined" && window.parent !== window;
  window.projectLinesInShell = inShell;
  // Started out of sight before any Canvas is asked for (canvas-shell.js): it opens none, and leaves the window around it as it is until one is.
  window.projectLinesWaiting = inShell && q.get("warm") === "1" && !q.get("linesCanvas");
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  let desktopPlatform = q.get("desktopPlatform") || "";
  if (!desktopPlatform && window.penechoDesktop?.titleBarInset && window.penechoDesktop.platform) {
    desktopPlatform = window.penechoDesktop.platform;
  }
  if (inShell) {
    root.classList.add("project-lines-in-shell");
    if (q.get("railHidden") === "1") root.classList.add("shell-rail-hidden");
    try {
      const parentRoot = window.parent?.document?.documentElement;
      if (!desktopPlatform && parentRoot?.dataset?.desktop) desktopPlatform = parentRoot.dataset.desktop;
      if (parentRoot?.classList?.contains("is-desktop-fullscreen")) root.classList.add("is-desktop-fullscreen");
    } catch {}
    // Same-origin shell owns the Electron preload; proxy desktop IPC cleanly through window.parent
    // while routing native menu commands/state through the shell coordinator.
    try {
      const parentDesktop = !window.penechoDesktop && window.parent?.penechoDesktop;
      if (parentDesktop) {
        const menuListeners = new Set();
        addEventListener("message", event => {
          if (event.origin !== location.origin || event.source !== window.parent) return;
          if (event.data?.source === "penecho-shell" && event.data.action === "menu-command" && typeof event.data.command === "string") {
            for (const fn of menuListeners) { try { fn(event.data.command); } catch {} }
          }
        });
        window.penechoDesktop = Object.freeze({
          platform:parentDesktop.platform,
          titleBarInset:Boolean(parentDesktop.titleBarInset),
          whenStartupVisible:() => Promise.resolve(true),
          setTheme:mode => parentDesktop.setTheme?.(mode),
          isFullscreen:() => parentDesktop.isFullscreen?.() ?? Promise.resolve(false),
          onFullscreenChange:() => () => {},
          onMenuCommand:listener => {
            if (typeof listener !== "function") return () => {};
            menuListeners.add(listener);
            return () => menuListeners.delete(listener);
          },
          setMenuState:menuState => {
            window.parent.postMessage({ source:"penecho-canvas-shell", menuState }, location.origin);
          },
          nativeEdit:command => parentDesktop.nativeEdit(command),
          installCli:provider => parentDesktop.installCli(provider),
          pickProjectFile:() => parentDesktop.pickProjectFile(),
          hasClipboardFile:() => parentDesktop.hasClipboardFile(),
          readClipboardFile:() => parentDesktop.readClipboardFile(),
          readClipboardFiles:() => parentDesktop.readClipboardFiles(),
          openProjectFile:projectId => parentDesktop.openProjectFile(projectId),
          setMcpKeepAwake:enabled => parentDesktop.setMcpKeepAwake(enabled),
        });
      }
    } catch {}
  } else if (window.penechoDesktop?.titleBarInset) {
    window.penechoDesktop.onFullscreenChange?.(full => root.classList.toggle("is-desktop-fullscreen", Boolean(full)));
    window.penechoDesktop.isFullscreen?.().then(full => root.classList.toggle("is-desktop-fullscreen", Boolean(full))).catch(() => {});
  }
  if (desktopPlatform) root.dataset.desktop = desktopPlatform;
})();
// Opened on its own, PenEcho shows PenEcho Lines from the first frame: the Canvas's own welcome never shows first, and the projects are asked for at once.
(() => {
  if (window.projectLinesInShell) return;
  const config = window.PENECHO_CONFIG || {};
  const q = new URLSearchParams(location.search);
  // A project's Canvas opens as itself, except on PenEcho's first open, when the first page covers the new Canvas in My Canvases.
  if (q.has("linesCanvas") && q.get("linesFirst") !== "1" || ["viewer", "cloud"].includes(config.runtime) || config.browserDraftId || config.guestCanvas) return;
  window.projectLinesWelcomeOpen = true;
  document.documentElement.classList.add("pls-first");
  // first=1: in the Mac app, before anything has opened the projects' folders, the list comes from PenEcho's own record and opens nothing.
  window.projectLinesFirstList = fetch("/api/lines/projects?first=1", { credentials:"same-origin", headers:{ accept:"application/json" } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  // The same answer, kept: the list above is taken by whoever draws the projects first, and opening by itself still needs to know whether this is a first open.
  window.projectLinesFirstAnswer = window.projectLinesFirstList;
})();
// A project's Canvas has the rail to its left (src/client/app/project-lines-bridge.js). Room is made for it before the page paints, so nothing moves when it arrives.
// A Canvas opened only to draw something for the box has no rail: Done takes it back.
(() => {
  if (window.projectLinesInShell) return;
  const q = new URLSearchParams(location.search), config = window.PENECHO_CONFIG || {};
  if (!q.get("linesProject") || !q.get("linesCanvas") || q.get("linesDraft") === "1" || (!window.PenEchoHostedProjectCanvas && ["viewer", "cloud"].includes(config.runtime)) || config.browserDraftId || config.guestCanvas) return;
  const root = document.documentElement;
  root.classList.add("project-lines-railed");
  // The rail is hidden or shown everywhere at once: this is the Lines pages' own choice. A narrow window starts without it.
  let hidden = matchMedia("(max-width: 899px)").matches;
  if (!hidden) try { hidden = localStorage.getItem("penecho-lines-projects-hidden") === "1"; } catch { /* It starts shown. */ }
  if (!hidden) root.classList.add("project-lines-rail-open");
})();
// When PenEcho opens on its own, cover the Canvas until the welcome or Projects destination is known.
(() => {
  if (window.projectLinesInShell) return;
  const config = window.PENECHO_CONFIG || {}, opening = window.PenEchoOpening;
  const desktop = Boolean(opening?.desktopLaunch && new URLSearchParams(location.search).size === 1);
  if ((location.search && !desktop) || location.hash || !["/", "/index.html"].includes(location.pathname) || ["viewer", "cloud"].includes(config.runtime) || config.browserDraftId || config.guestCanvas || config.playground) return;
  window.projectLinesAlone = true;
  // This is PenEcho opening: its opening plays from the first frame, and carries on on the Projects page if the page goes there (lines/opening.js).
  if (opening?.wanted()) opening.play({ waitForWindow:desktop });
})();
// A project's Canvas opens under this cover, so the Canvas this page would otherwise bring up first is never seen. The picture you clicked stays on screen until its own Canvas is ready.
// A picture opened to draw on comes where the Lines page left it, and lift(to) carries it onto the same picture on the Canvas as the cover clears, so it never jumps.
(() => {
  if (window.projectLinesInShell) {
    window.projectLinesCover = { picture:"", show() {}, lift() {} };
    return;
  }
  const alone = window.projectLinesAlone === true;
  if (!new URLSearchParams(location.search).has("linesCanvas") && !alone) return;
  let picture = "", at = null, cover = null;
  if (!alone) try {
    picture = sessionStorage.getItem("penecho-lines-opening") || "";
    at = JSON.parse(sessionStorage.getItem("penecho-lines-opening-at") || "null");
    sessionStorage.removeItem("penecho-lines-opening"); sessionStorage.removeItem("penecho-lines-opening-at");
  } catch { /* It only means a blank cover. */ }
  const placed = r => r && ["left", "top", "width", "height"].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
  const show = src => {
    if (cover) return;
    cover = document.createElement("div");
    cover.id = "projectLinesCover";
    cover.setAttribute("aria-hidden", "true");
    if (src) {
      const img = document.createElement("img"); img.src = src; img.alt = "";
      if (src === picture && placed(at)) img.style.cssText = `position:fixed;left:${at.left}px;top:${at.top}px;width:${at.width}px;height:${at.height}px;`;
      cover.append(img);
    }
    document.documentElement.append(cover);
  };
  // Where the picture is on screen now, inside its box.
  const shown = img => {
    const r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
    return { left:r.left + (r.width - w) / 2, top:r.top + (r.height - h) / 2, width:w, height:h };
  };
  const lift = to => {
    const going = cover;
    if (!going) return;
    cover = null;
    const img = going.querySelector("img");
    const glide = placed(to) && img?.naturalWidth && going.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!glide) { going.classList.add("lifted"); setTimeout(() => going.remove(), 180); return; }
      const from = shown(img);
      img.style.cssText = `position:fixed;left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px;transform-origin:0 0;`;
      going.style.pointerEvents = "none";
      // The white fades as a layer of its own: only opacity and transform move, so the lift stays smooth while the Canvas is still busy starting (PE-586).
      const sheet = document.createElement("i");
      sheet.style.cssText = "position:absolute;inset:0;background:#fff;";
      going.style.background = "transparent";
      going.prepend(sheet);
      sheet.animate([{ opacity:1 }, { opacity:0 }], { duration:240, easing:"ease-out", fill:"forwards" });
      img.animate([{ transform:`translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})` }, { transform:"none" }], { duration:260, easing:"cubic-bezier(.3,.7,.2,1)", fill:"forwards" })
        .onfinish = () => going.remove();
      // The same picture is under it by then, so only the Canvas's own buttons over it show through.
      img.animate([{ opacity:1 }, { opacity:1, offset:.55 }, { opacity:0 }], { duration:260, fill:"forwards" });
    }));
  };
  show(picture);
  window.projectLinesCover = { picture, show, lift };
  // Should the Canvas never report back, the page is still there to use.
  setTimeout(lift, alone ? 6000 : 20000);
})();
