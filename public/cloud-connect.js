"use strict";

(() => {
  const cloudButton = document.getElementById("cloudAccountBtn");
  const shareCanvasButton = document.getElementById("shareCanvasBtn");
  if (!cloudButton || !shareCanvasButton) return;
  // The read-only viewer shell has its own minimal header; the Cloud Center and
  // its local-server API calls must stay silent there.
  if (window.PENECHO_CONFIG?.runtime === "viewer") return;

  const CATEGORIES = ["education", "productivity", "data", "design", "developer", "science", "business", "lifestyle", "other", "guidance", "collaboration", "learning"];
  const CATEGORY_LABELS = { guidance:"Sharing & Guidance", collaboration:"Co-creation", learning:"Learning Notes" };
  const PUBLICATION_TERMS_VERSION = "2026-08-12";
  const sessionToken = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || "");
  const configuredCloudOrigin = String(window.PENECHO_CONFIG?.cloudOrigin || "https://penecho.ai");
  const configuredCloudEnvironment = String(window.PENECHO_CONFIG?.cloudEnvironment || "prod");
  const localHostControlsAvailable = window.PENECHO_CONFIG?.runtime !== "cloud";
  const BROWSER_SIGN_IN_POLL_MS = 800;
  const BROWSER_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
  const CLOUD_STATUS_POLL_MS = 1500;
  const state = {
    status:null,
    library:null,
    selectedProjectId:null,
    busy:false,
    browserSignIn:{ id:0, timer:0, poll:null, polling:false, active:false, expiresAt:0, popup:null, authorizationUrl:"", popupBlocked:false, tone:"", message:"" },
  };

  function cloudOrigin() {
    return configuredCloudOrigin.replace(/\/$/, "");
  }

  function communityUrl(item) {
    return new URL(String(item?.shareUrl || `/community/${item?.id || ""}`), `${cloudOrigin()}/`).toString();
  }

  function cloudDevicesUrl() {
    return new URL("/dashboard.html#devices", `${cloudOrigin()}/`).toString();
  }

  function cloudDevicesLink(text) {
    return el("a", { href:cloudDevicesUrl(), target:"_blank", rel:"noopener", text });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = el("input", { readonly:"", value });
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  function apiHeaders(json = false) {
    const csrf = window.PENECHO_CONFIG?.runtime === "cloud"
      ? document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("penecho_csrf="))?.slice("penecho_csrf=".length) || ""
      : "";
    return {
      accept:"application/json",
      ...(json ? { "content-type":"application/json" } : {}),
      ...(sessionToken ? { "x-penecho-session":sessionToken } : {}),
      ...(csrf ? { "x-penecho-csrf":decodeURIComponent(csrf) } : {}),
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers:{ ...apiHeaders(options.body !== undefined), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `Cloud request failed (HTTP ${response.status}).`);
    return payload;
  }

  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
    return node;
  }

  function focusableElements(dialog) {
    return [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.getClientRects().length);
  }

  function closeOverlay(overlay) {
    stopCloudStatusWatch();
    const restoreFocus = overlay?._restoreFocus;
    overlay?.remove();
    cloudButton.setAttribute("aria-expanded", "false");
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll:true });
  }

  function dialogShell({ title, subtitle = "", share = false }) {
    const overlay = el("div", { class:"penecho-cloud-overlay" });
    overlay._restoreFocus = document.activeElement;
    const dialog = el("section", { class:`penecho-cloud-dialog${share ? " share" : ""}`, role:"dialog", "aria-modal":"true", "aria-label":title });
    const close = el("button", { class:"cloud-dialog-close", type:"button", text:"×", "aria-label":"Close", onclick:() => closeOverlay(overlay) });
    const heading = el("div", {}, [el("h2", { text:title }), subtitle ? el("p", { text:subtitle }) : null]);
    dialog.append(el("header", {}, [heading, close]));
    const body = el("div", { class:"penecho-cloud-body" });
    dialog.append(body);
    overlay.append(dialog);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) closeOverlay(overlay); });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay(overlay);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.append(overlay);
    close.focus();
    return { overlay, dialog, body };
  }

  function accountSignedIn() { return Boolean(state.status?.accountSession?.signedIn); }

  function updateCloudButton() {
    const account = state.status?.account;
    const connected = Boolean(state.status?.device?.connected);
    cloudButton.dataset.state = connected ? "connected" : accountSignedIn() ? "signed-in" : "signed-out";
    cloudButton.querySelector(".cloud-account-label").textContent = account?.name ? account.name.split(/\s+/)[0] : "Cloud";
    cloudButton.title = connected ? "PenEcho Cloud · Device linked" : accountSignedIn() ? `PenEcho Cloud · ${account?.credits || 0} credits` : "Connect PenEcho Cloud";
  }

  let statusRequestSeq = 0;

  async function refreshStatus(force = false) {
    const seq = ++statusRequestSeq;
    try {
      const status = await api(force ? "/api/cloud/account" : "/api/cloud/status");
      // A newer request already superseded this one; never let a stale,
      // slower response overwrite fresher status.
      if (seq !== statusRequestSeq) return state.status;
      state.status = status;
      updateCloudButton();
      return state.status;
    } catch (error) {
      if (seq !== statusRequestSeq) return state.status;
      if (force) throw error;
      cloudButton.dataset.state = "signed-out";
      return null;
    }
  }

  let cloudStatusTimer = 0;
  let cloudStatusPolling = false;
  let cloudStatusWatchId = 0;
  let cloudStatusPoll = null;

  function cloudStatusSignature() {
    const device = state.status?.device || {};
    const account = state.status?.account || {};
    return JSON.stringify([
      Boolean(state.status?.accountSession?.signedIn),
      account.name || "",
      Number(account.credits || 0),
      Boolean(device.configured),
      Boolean(device.enabled),
      Boolean(device.connected),
      device.state || "",
      device.id || "",
    ]);
  }

  function stopCloudStatusWatch() {
    cloudStatusWatchId++; // invalidate any in-flight poll from a previous watch
    clearTimeout(cloudStatusTimer);
    cloudStatusTimer = 0;
    cloudStatusPolling = false;
    cloudStatusPoll = null;
  }

  function startCloudStatusWatch(overlay, render) {
    stopCloudStatusWatch();
    const id = cloudStatusWatchId;
    let previous = cloudStatusSignature();
    const poll = async () => {
      // Never run two polls at once and never let a stale watch touch shared
      // flags; an in-flight poll always reschedules in its finally block.
      if (id !== cloudStatusWatchId || !overlay.isConnected || cloudStatusPolling) return;
      cloudStatusPolling = true;
      try {
        await refreshStatus();
        if (id !== cloudStatusWatchId || !overlay.isConnected) return;
        const current = cloudStatusSignature();
        if (current !== previous) {
          previous = current;
          render();
        }
      } finally {
        if (id !== cloudStatusWatchId) return; // a newer watch owns the timer and flags now
        cloudStatusPolling = false;
        if (overlay.isConnected) cloudStatusTimer = setTimeout(poll, document.visibilityState === "visible" ? CLOUD_STATUS_POLL_MS : 5000);
      }
    };
    cloudStatusPoll = poll;
    cloudStatusTimer = setTimeout(poll, CLOUD_STATUS_POLL_MS);
  }

  function stopBrowserSignInWatch() {
    state.browserSignIn.id++;
    clearTimeout(state.browserSignIn.timer);
    state.browserSignIn.timer = 0;
    state.browserSignIn.poll = null;
    state.browserSignIn.polling = false;
    state.browserSignIn.active = false;
    state.browserSignIn.expiresAt = 0;
    state.browserSignIn.popup = null;
    state.browserSignIn.authorizationUrl = "";
    state.browserSignIn.popupBlocked = false;
  }

  function browserSignInMessage(message, tone = "") {
    state.browserSignIn.message = message;
    state.browserSignIn.tone = tone;
  }

  function startBrowserSignInWatch({ started, popup, externalOpened = false, render }) {
    stopBrowserSignInWatch();
    const id = state.browserSignIn.id;
    const serverExpiry = Number(started?.expiresAt || 0);
    state.browserSignIn.active = true;
    state.browserSignIn.expiresAt = Math.min(
      Number.isFinite(serverExpiry) && serverExpiry > Date.now() ? serverExpiry : Date.now() + BROWSER_SIGN_IN_TIMEOUT_MS,
      Date.now() + BROWSER_SIGN_IN_TIMEOUT_MS,
    );
    state.browserSignIn.popup = popup || null;
    state.browserSignIn.authorizationUrl = String(started?.authorizationUrl || "");
    state.browserSignIn.popupBlocked = !popup && !externalOpened;
    browserSignInMessage(popup || externalOpened
      ? `${window.PENECHO_CONFIG?.desktopApp ? "Your default browser is open. " : ""}Complete sign-in there; PenEcho will connect here automatically.`
      : "Your browser blocked the sign-in window. Select Open sign-in page below; PenEcho will still connect automatically.", popup || externalOpened ? "" : "error");

    const renderIfOpen = () => {
      if (document.querySelector(".penecho-cloud-overlay")) render?.();
    };
    const poll = async () => {
      if (id !== state.browserSignIn.id || !state.browserSignIn.active || state.browserSignIn.polling) return;
      state.browserSignIn.polling = true;
      try {
        await refreshStatus();
        if (id !== state.browserSignIn.id) return;
        if (accountSignedIn()) {
          const popupWindow = state.browserSignIn.popup;
          stopBrowserSignInWatch();
          browserSignInMessage("Signed in. Your Cloud account is ready.", "success");
          try { if (popupWindow && !popupWindow.closed) popupWindow.close(); } catch {}
          renderIfOpen();
          return;
        }
        if (Date.now() >= state.browserSignIn.expiresAt) {
          stopBrowserSignInWatch();
          browserSignInMessage("Browser sign-in expired. Select Sign in with browser to try again.", "error");
          renderIfOpen();
          return;
        }
        const delay = document.visibilityState === "visible" ? BROWSER_SIGN_IN_POLL_MS : 1500;
        state.browserSignIn.timer = setTimeout(poll, delay);
      } finally {
        if (id === state.browserSignIn.id) state.browserSignIn.polling = false;
      }
    };
    state.browserSignIn.poll = poll;
    state.browserSignIn.timer = setTimeout(poll, BROWSER_SIGN_IN_POLL_MS);
  }

  function accountPanel(render) {
    const panel = el("section", { class:"penecho-cloud-panel" });
    panel.append(el("h3", { text:"Cloud account" }));
    if (accountSignedIn()) {
      const account = state.status.account || {};
      panel.append(el("div", { class:"cloud-account-summary" }, [
        el("div", { class:"cloud-avatar", text:String(account.name || "P").slice(0, 1).toUpperCase() }),
        el("div", {}, [el("strong", { text:account.name || "PenEcho user" }), el("span", { text:`${Number(account.credits || 0)} credits` })]),
      ]));
      const settings = el("details", { class:"cloud-secondary-settings" });
      settings.append(
        el("summary", { text:"Account settings" }),
        el("p", { text:"Signing out removes this account from this PenEcho host. It does not remove the existing device link." }),
        el("div", { class:"cloud-button-row" }, [
          el("button", { class:"cloud-button", type:"button", text:"Refresh account", onclick:async () => action(render, async () => refreshStatus(true)) }),
          el("button", { class:"cloud-button danger", type:"button", text:"Sign out on this host", onclick:async () => {
            if (!window.confirm("Sign out on this PenEcho host? The device link will remain available.")) return;
            await action(render, async () => { await api("/api/cloud/sign-out", { method:"POST", body:"{}" }); await refreshStatus(); });
          } }),
        ]),
      );
      panel.append(settings);
      return panel;
    }

    panel.append(el("div", { class:"cloud-environment" }, [el("span", { text:configuredCloudEnvironment === "uat" ? "UAT" : "Production" }), el("code", { text:cloudOrigin() })]));
    panel.append(el("p", { text:"Sign in locally. Your API keys stay on this device; private projects, community items and relayed requests use Cloud." }));
    const browserSignIn = state.browserSignIn;
    const message = el("div", {
      class:`cloud-message${browserSignIn.tone ? ` ${browserSignIn.tone}` : ""}`,
      text:browserSignIn.message,
      role:browserSignIn.tone === "error" ? "alert" : "status",
      "aria-live":browserSignIn.tone === "error" ? "assertive" : "polite",
    });
    const signIn = el("button", { class:"cloud-button primary", type:"button", text:browserSignIn.active ? "Waiting for browser…" : window.PENECHO_CONFIG?.desktopApp ? "Continue in browser" : "Sign in with browser", ...(browserSignIn.active ? { disabled:"" } : {}), onclick:async () => {
      const desktopApp = window.PENECHO_CONFIG?.desktopApp === true;
      const popup = desktopApp ? null : window.open("about:blank", "penecho-cloud-sign-in", "popup,width=760,height=760");
      await action(render, async () => {
        try {
          const started = await api("/api/cloud/sign-in/start", { method:"POST", body:JSON.stringify({ origin:cloudOrigin() }) });
          if (desktopApp) window.open(started.authorizationUrl, "_blank", "noopener");
          else if (popup) popup.location.replace(started.authorizationUrl);
          startBrowserSignInWatch({ started, popup, externalOpened:desktopApp, render });
        } catch (error) {
          try { popup?.close(); } catch {}
          throw error;
        }
      });
    } });
    const browserActions = el("div", { class:"cloud-button-row" }, signIn);
    if (browserSignIn.active && browserSignIn.authorizationUrl) {
      browserActions.append(el("a", { class:"cloud-button", href:browserSignIn.authorizationUrl, target:"_blank", rel:"noopener", text:browserSignIn.popupBlocked ? "Open sign-in page ↗" : "Open again ↗" }));
    }
    panel.append(browserActions, message);
    const details = el("details");
    details.append(el("summary", { text:"Use a one-time code instead" }));
    const code = el("input", { type:"text", autocomplete:"one-time-code", placeholder:"Paste local sign-in code" });
    details.append(field("Authorization code", code));
    details.append(el("button", { class:"cloud-button", type:"button", text:"Connect", onclick:async () => action(render, async () => {
      await api("/api/cloud/sign-in", { method:"POST", body:JSON.stringify({ origin:cloudOrigin(), code:code.value.trim() }) });
      await refreshStatus();
    }) }));
    panel.append(details);
    return panel;
  }

  function devicePanel(render) {
    const panel = el("section", { class:"penecho-cloud-panel" });
    panel.append(el("h3", { text:"Link this device" }));
    if (!accountSignedIn()) {
      panel.append(el("p", { text:"Sign in first, then use a one-time pairing key from Cloud. Linking makes this the one private host your signed-in browsers and apps can reach; API credentials stay here." }));
      return panel;
    }
    const device = state.status.device || {};
    if (device.configured) {
      panel.append(el("p", { text:`${device.name || "This device"} · ${device.connected ? "Connected" : device.enabled ? "Connecting" : "Paused"}` }));
      const actions = el("div", { class:"cloud-button-row" });
      actions.append(el("button", { class:"cloud-button", type:"button", text:device.enabled ? "Pause link" : "Enable link", onclick:async () => action(render, async () => {
        await api(`/api/cloud/device/${device.enabled ? "disable" : "enable"}`, { method:"POST", body:"{}" });
        await refreshStatus();
      }) }));
      panel.append(actions);
      const settings = el("details", { class:"cloud-secondary-settings" });
      settings.append(
        el("summary", { text:"Link settings" }),
        el("p", {}, [
          document.createTextNode("Removing the link stops remote access. You can connect this host again later with a new pairing key from "),
          cloudDevicesLink("Cloud → Devices"),
          document.createTextNode("."),
        ]),
        el("button", { class:"cloud-button danger", type:"button", text:"Remove this link", onclick:async () => {
          if (!window.confirm("Remove this device link? Remote access will stop, but you can pair this host again later.")) return;
          await action(render, async () => { await api("/api/cloud/device/revoke", { method:"POST", body:"{}" }); await refreshStatus(); });
        } }),
      );
      panel.append(settings);
      return panel;
    }
    panel.append(el("p", {}, [
      document.createTextNode("Generate a pairing key in "),
      cloudDevicesLink("PenEcho Cloud → Devices"),
      document.createTextNode(", then enter it below."),
    ]));
    const code = el("input", { type:"text", maxlength:"32", autocomplete:"one-time-code", placeholder:"Pairing key" });
    const name = el("input", { type:"text", maxlength:"80", value:"My PenEcho", placeholder:"Device name" });
    panel.append(field("Pairing key", code), field("Device name", name));
    panel.append(el("button", { class:"cloud-button primary", type:"button", text:"Link device", onclick:async () => action(render, async () => {
      await api("/api/cloud/pair", { method:"POST", body:JSON.stringify({ origin:cloudOrigin(), code:code.value.trim(), name:name.value.trim() }) });
      await refreshStatus();
    }) }));
    return panel;
  }

  function field(label, input) {
    return el("label", { class:"cloud-field" }, [el("span", { text:label }), input]);
  }

  async function action(render, task) {
    if (state.busy) return;
    state.busy = true;
    try { await task(); }
    catch (error) { window.alert(error.message || "PenEcho Cloud request failed."); }
    finally { state.busy = false; render?.(); }
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0));
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = bytes / 1024, unit = units[0];
    for (let index = 1; index < units.length && size >= 1024; index++) { size /= 1024; unit = units[index]; }
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
  }

  function cloudProjectsPanel() {
    const panel = el("section", { class:"penecho-cloud-panel cloud-projects-panel" });
    panel.append(el("div", { class:"cloud-panel-heading" }, [
      el("div", {}, [el("h3", { text:"Cloud Projects" }), el("p", { text:"Choose a project, then open or save a versioned Canvas." })]),
    ]));
    if (!accountSignedIn()) {
      panel.append(el("div", { class:"cloud-empty", text:"Sign in to save private projects and continue your work across desktop, macOS and future iOS apps." }));
      return panel;
    }
    const content = el("div", { class:"cloud-project-content" });
    panel.append(content);

    function rememberProject(projectId) {
      state.selectedProjectId = projectId || null;
      try {
        if (state.selectedProjectId) sessionStorage.setItem("penecho-cloud-center-project", state.selectedProjectId);
        else sessionStorage.removeItem("penecho-cloud-center-project");
      } catch {}
    }

    function selectedProject(projects) {
      if (!state.selectedProjectId) {
        try { state.selectedProjectId = sessionStorage.getItem("penecho-cloud-center-project"); } catch {}
      }
      const selected = projects.find((project) => project.id === state.selectedProjectId)
        || projects.find((project) => project.systemKey !== "uncategorized")
        || projects[0]
        || null;
      if (selected?.id !== state.selectedProjectId) rememberProject(selected?.id || null);
      return selected;
    }

    async function openProjectHistory(projectId) {
      const bridge = window.PenEchoCloudProjects;
      if (!bridge?.openHistory) return window.alert("Cloud project saving is not ready yet.");
      closeOverlay(panel.closest(".penecho-cloud-overlay"));
      await bridge.openHistory(projectId || null);
    }

    function renderLibrary() {
      const library = state.library || {}, workspace = library.workspace || {}, projects = Array.isArray(library.projects) ? library.projects : [], canvases = Array.isArray(library.canvases) ? library.canvases : [];
      const used = Number(workspace.storageUsedBytes || 0) + Number(workspace.storageReservedBytes || 0), limit = Number(workspace.storageLimitBytes || 0);
      const storage = el("div", { class:"cloud-storage-summary compact" }, [
        el("div", {}, [el("strong", { text:`${formatBytes(used)} used` }), el("span", { text:limit ? ` of ${formatBytes(limit)}` : "" })]),
        el("progress", { class:"cloud-storage-track", max:String(Math.max(1, limit)), value:String(Math.min(used, Math.max(1, limit))), "aria-label":"Cloud storage used" }),
        el("small", { text:"Every successful save creates an immutable revision. Concurrent edits are never silently overwritten." }),
      ]);
      const project = selectedProject(projects);
      const selector = el("select", { "aria-label":"Current Cloud project", onchange:(event) => {
        rememberProject(event.currentTarget.value);
        renderLibrary();
      } }, projects.map((candidate) => el("option", {
        value:candidate.id,
        text:candidate.name || "Untitled project",
        ...(candidate.id === project?.id ? { selected:"" } : {}),
      })));
      const picker = el("label", { class:"cloud-project-picker" }, [el("span", { text:"Project" }), selector]);
      const createName = el("input", { type:"text", maxlength:"160", placeholder:"Project name", "aria-label":"New Cloud project name" });
      const createDetails = el("details", { class:"cloud-project-create" });
      const createButton = el("button", { class:"cloud-button primary", type:"button", text:"Create", onclick:async () => action(load, async () => {
        const name = createName.value.trim();
        if (!name) throw Error("Enter a project name.");
        const created = await api("/api/cloud/projects", { method:"POST", body:JSON.stringify({ name }) });
        rememberProject(created?.project?.id || null);
        createName.value = "";
        createDetails.open = false;
      }) });
      createDetails.append(
        el("summary", { class:"cloud-button", text:"+ New project" }),
        el("div", { class:"cloud-project-create-form" }, [createName, createButton]),
      );
      const commandBar = el("div", { class:"cloud-project-toolbar" }, [
        picker,
        project ? el("button", { class:"cloud-button primary", type:"button", text:"Save current Canvas here", onclick:() => openProjectHistory(project.id) }) : null,
        createDetails,
      ]);
      const card = el("article", { class:"cloud-project-card" });
      if (project) {
        const projectCanvases = canvases.filter((canvas) => canvas.projectId === project.id);
        card.append(el("div", { class:"cloud-project-card-head" }, [
          el("div", {}, [el("h4", { text:project.name || "Untitled project" }), el("span", { text:`${projectCanvases.length} Canvas${projectCanvases.length === 1 ? "" : "es"}` })]),
        ]));
        const list = el("div", { class:"cloud-canvas-list" });
        if (!projectCanvases.length) list.append(el("div", { class:"cloud-project-empty", text:"No Canvases yet. Save the current Canvas here to start." }));
        for (const canvas of projectCanvases.slice(0, 12)) {
          const row = el("button", { class:"cloud-canvas-row", type:"button", onclick:async () => {
            const bridge = window.PenEchoCloudProjects;
            if (!bridge?.openCanvas) return window.alert("Cloud Canvas loading is not ready yet.");
            closeOverlay(panel.closest(".penecho-cloud-overlay"));
            await bridge.openCanvas(canvas.id);
          } }, [
            canvas.previewDataUrl ? el("img", { src:canvas.previewDataUrl, alt:"", loading:"lazy" }) : el("span", { class:"cloud-canvas-placeholder", text:"P" }),
            el("span", { class:"cloud-canvas-copy" }, [
              el("strong", { text:canvas.name || "Untitled Canvas" }),
              el("small", { text:`Updated ${new Intl.DateTimeFormat(document.documentElement.lang === "zh" ? "zh-CN" : "en", { dateStyle:"medium", timeStyle:"short" }).format(canvas.updatedAt || canvas.createdAt || Date.now())} · ${formatBytes(canvas.sizeBytes)}` }),
            ]),
            el("span", { class:"cloud-canvas-open", text:"Open →" }),
          ]);
          list.append(row);
        }
        card.append(list);
      }
      const projectArea = project ? card : el("div", { class:"cloud-empty", text:"No Cloud projects yet. Create one to keep this Canvas available across devices." });
      content.replaceChildren(storage, commandBar, projectArea, el("a", { class:"cloud-project-web-link", href:new URL("/dashboard.html#projects", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:"Manage revisions, Trash and recovery on the web ↗" }));
    }
    async function load() {
      content.replaceChildren(el("div", { class:"cloud-message", text:"Loading Cloud projects…" }));
      try {
        const library = await api("/api/cloud/library");
        if (library?.sync?.bundleVersion !== 2 || library.sync.conflictPolicy !== "base-revision-required") throw Error("This Cloud does not support the required project sync protocol.");
        state.library = library;
        renderLibrary();
      } catch (error) {
        content.replaceChildren(el("div", { class:"cloud-message error", text:error.message }));
      }
    }
    queueMicrotask(load);
    return panel;
  }

  async function openCloud() {
    cloudButton.setAttribute("aria-expanded", "true");
    await refreshStatus();
    const shell = dialogShell({ title:"PenEcho Cloud", subtitle:"Private projects and shared building blocks." });
    const layout = el("div", { class:"penecho-cloud-layout" });
    shell.body.append(layout);
    function render() {
      const workspace = el("div", { class:"cloud-workspace" });
      const sections = el("nav", { class:"cloud-section-tabs", "aria-label":"PenEcho Cloud area" });
      sections.append(
        el("span", { class:"cloud-section-tab active", "aria-current":"page" }, [
          el("strong", { text:"Cloud Projects" }),
          el("span", { text:"Private cross-device work" }),
        ]),
        el("a", { class:"cloud-section-tab", href:new URL("/community.html", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener" }, [
          el("strong", { text:"Craft Commons ↗" }),
          el("span", { text:"Browse public Crafts on PenEcho Cloud" }),
        ]),
      );
      workspace.append(sections, cloudProjectsPanel());
      layout.classList.toggle("remote-cloud-runtime", !localHostControlsAvailable);
      if (localHostControlsAvailable) {
        const accountColumn = el("aside", { class:"cloud-local-controls", "aria-label":"This PenEcho host" }, [accountPanel(render), devicePanel(render)]);
        layout.replaceChildren(accountColumn, workspace);
      } else {
        layout.replaceChildren(workspace);
      }
    }
    render();
    startCloudStatusWatch(shell.overlay, render);
  }

  function shareDialog({ kind, widgetId = null, favoriteAfterShare = false }) {
    if (!accountSignedIn()) {
      openCloud();
      return;
    }
    const title = "Preserve this moment", bridge=window.PenEchoCommunityCanvas;
    const shell = dialogShell({ title, subtitle:"It does not need to be finished. It only needs to be worth understanding or taking further.", share:true });
    const name = el("input", { type:"text", maxlength:"160", placeholder:kind === "widget" ? "Widget name" : "Canvas name" });
    const description = el("textarea", { rows:"3", maxlength:"1200", placeholder:"A short, useful introduction" });
    const category = el("select", {}, CATEGORIES.map(value => el("option", { value, text:CATEGORY_LABELS[value] || value[0].toUpperCase() + value.slice(1) })));
    category.value = "productivity";
    const tags = el("input", { type:"text", maxlength:"260", placeholder:"planning, dashboard, learning" }),tagCount=el("small", { class:"cloud-tag-count", text:"0 / 8 tags" });
    const status = el("span", { class:"cloud-share-status", text:"Generating preview…" }),previewImage=el("img", { alt:`Automatic ${kind} share preview` }),previewMeta=el("span", { text:"WebP · validating content" }),previewPanel=el("div", { class:"cloud-share-preview", "aria-busy":"true" }, [previewImage,previewMeta]);
    const autoFill=el("button", { class:"cloud-button cloud-ai-fill", type:"button", text:"Auto-fill with current AI", disabled:"" });
    const contribution = el("textarea", { rows:"3", maxlength:"500", placeholder:"What did you move forward?" });
    const continuation = el("textarea", { rows:"3", maxlength:"500", placeholder:"What question, detail, or direction should the next Crafter take further?" });
    const permission = el("input", { type:"checkbox" });
    const permissionLabel = el("label", { class:"cloud-publication-consent" }, [permission, el("span", {}, [
      document.createTextNode("I have the right to publish this work. Its visual and written content is shared under "),
      el("a", { href:"https://creativecommons.org/licenses/by-sa/4.0/", target:"_blank", rel:"noopener", text:"CC BY-SA 4.0" }),
      document.createTextNode(", embedded source under "),
      el("a", { href:"https://opensource.org/license/mit", target:"_blank", rel:"noopener", text:"MIT" }),
      document.createTextNode(", and listing metadata under CC0. Others may Take it further with attribution and the same visual license; published versions and existing lineage cannot be withdrawn."),
    ])]);
    const trainingPermission=el("input", { type:"checkbox" });
    const trainingPermissionLabel=el("label", { class:"cloud-publication-consent" }, [trainingPermission,el("span", {}, [
      document.createTextNode("I understand this is required to Publish. I allow PenEcho to use this public Craft to build, train, evaluate, improve, and commercialize PenEcho models and services under the "),
      el("a", { href:new URL("/terms.html#public-craft-training",`${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:"Public Craft ML License" }),
      document.createTextNode(". Private projects, drafts, Link Device traffic, API keys, and private model requests are not included."),
    ])]);
    let artifact=null,lineage=null,draftKey=null,publish=null;
    function parsedTags(){const seen=new Set();return tags.value.split(",").map(value=>value.trim()).filter(value=>{const key=value.toLocaleLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;});}
    function tagIssue(){const values=parsedTags();if(values.length>8)return "Use no more than 8 tags.";if(values.some(value=>value.length>32))return "Each tag must be 32 characters or fewer.";if(values.some(value=>!/^\p{L}[\p{L}\p{N} ._+-]*$/u.test(value)&&!/^\p{N}[\p{L}\p{N} ._+-]*$/u.test(value)))return "Tags must start with a letter or number.";return "";}
    function updatePublishAvailability(){if(publish)publish.disabled=!artifact||!permission.checked||!trainingPermission.checked||!continuation.value.trim()||Boolean(tagIssue());}
    function refreshTagCount(){const values=parsedTags(),issue=tagIssue();tagCount.textContent=issue||`${values.length} / 8 tags`;tagCount.classList.toggle("error",Boolean(issue));updatePublishAvailability();}
    function draftPayload(){return{name:name.value,description:description.value,category:category.value,tags:tags.value,contribution:contribution.value,continuation:continuation.value};}
    function saveDraft(){if(!draftKey)return;try{sessionStorage.setItem(draftKey,JSON.stringify(draftPayload()));}catch{}}
    function restoreDraft(){if(!draftKey)return false;try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||"null");if(!saved||typeof saved!=="object")return false;name.value=String(saved.name||"").slice(0,160);description.value=String(saved.description||"").slice(0,1200);category.value=CATEGORIES.includes(saved.category)?saved.category:"productivity";tags.value=String(saved.tags||"").slice(0,260);contribution.value=String(saved.contribution||"").slice(0,500);continuation.value=String(saved.continuation||"").slice(0,500);refreshTagCount();return true;}catch{return false;}}
    function clearDraft(){if(!draftKey)return;try{sessionStorage.removeItem(draftKey);}catch{}}
    for(const input of [name,description,tags,contribution,continuation])input.addEventListener("input",()=>{saveDraft();updatePublishAvailability();});
    category.addEventListener("change",saveDraft);
    tags.addEventListener("input",refreshTagCount);
    shell.body.append(el("div", { class:"cloud-share-note", text:`A rough sketch can be the first surviving record of a great idea. PenEcho captures this ${kind} automatically—no image upload—and preserves every attributed step. The validated WebP is at most 2048 × 2048 and 4 MB.` }),previewPanel);
    shell.body.append(el("div", { class:"cloud-share-ai-row" }, [autoFill,el("span", { text:"Uses the AI connection currently active on this device." })]),field("Name", name), field("Description", description), field("Category", category),field("Tags (up to 8, comma separated)", el("div", { class:"cloud-tags-input" }, [tags,tagCount])));
    shell.body.append(field("What should the next Crafter take further?",continuation));
    publish = el("button", { class:"cloud-button primary", type:"button", text:favoriteAfterShare ? "Publish this stroke & save" : "Publish this stroke", onclick:async () => {
      publish.disabled = true;
      status.className = "cloud-share-status";
      status.textContent = "Validating and uploading…";
      try {
        if (!artifact) throw new Error("Wait for the automatic preview to finish.");
        const payload = {
          kind,
          name:name.value.trim(),
          description:description.value.trim(),
          category:category.value,
          tags:parsedTags(),
          artifact,
          parentItemId:lineage?.parentItemId || null,
          contributionNote:lineage ? contribution.value.trim() : "",
          continuationPrompt:continuation.value.trim(),
          publicationTermsAccepted:permission.checked,
          publicationRightsAccepted:permission.checked,
          modelTrainingAccepted:trainingPermission.checked,
          publicationTermsVersion:PUBLICATION_TERMS_VERSION,
        };
        if (!payload.name) throw new Error("Enter a name before publishing.");
        if (tagIssue()) throw new Error(tagIssue());
        if (lineage && !payload.contributionNote) throw new Error("Tell the next Crafter what you moved forward.");
        if (!payload.continuationPrompt) throw new Error("Tell the next Crafter what is worth taking further.");
        if (!permission.checked) throw new Error("Confirm the publication rights and open licenses before publishing.");
        if (!trainingPermission.checked) throw new Error("Confirm the required public model-training permission before publishing.");
        status.textContent = lineage ? "Adding your step to the Craft lineage…" : "Publishing the first step of this Craft…";
        const result = await api("/api/cloud/community/share", { method:"POST", body:JSON.stringify(payload) });
        if (!result.item?.id) throw new Error("PenEcho Cloud did not return the published Craft.");
        clearDraft();
        let originError=null,favoriteError=null;
        try { await bridge.markPublishedOrigin?.(kind, artifact, result.item); }
        catch (error) { originError=error; }
        if (favoriteAfterShare) {
          try { await api(`/api/cloud/community/${result.item.id}/favorite`, { method:"POST", body:"{}" }); }
          catch (error) { favoriteError=error; }
        }
        status.className = `cloud-share-status ${originError||favoriteError?"error":"success"}`;
        status.textContent = originError
          ? "Craft published safely, but its local continuation link needs attention below. Do not publish again."
          : favoriteError
            ? "Craft published safely. Saving it to Favorites can be retried from its public page."
            : favoriteAfterShare ? "Craft published and saved." : "Craft published. Your local work now continues from this step.";
        const url = communityUrl(result.item);
        const localSourceMessage=el("span", { text:originError
          ? `The public Craft is safe. Retry linking this local ${kind === "widget" ? "Widget" : "Canvas"} so its next publish extends Step ${Number(result.item.generation || 0)+1}.`
          : `${result.item.generation ? `Step ${Number(result.item.generation) + 1}` : "First stroke"} is now this local ${kind === "widget" ? "Widget's" : "Canvas's"} source. Your next publish will extend it, not create a sibling branch.` });
        const resultActions=el("div", { class:"cloud-button-row" });
        if(originError){
          const retryOrigin=el("button", { class:"cloud-button", type:"button", text:"Retry local link", onclick:async()=>{
            retryOrigin.disabled=true;
            try{
              await bridge.markPublishedOrigin?.(kind,artifact,result.item);
              localSourceMessage.textContent=`Local source linked to Step ${Number(result.item.generation||0)+1}. Your next publish will extend it.`;
              status.className="cloud-share-status success";
              status.textContent="Craft published and local continuation link restored.";
              retryOrigin.remove();
            }catch(error){status.className="cloud-share-status error";status.textContent=error.message||"The local link still could not be restored.";retryOrigin.disabled=false;}
          }});
          resultActions.append(retryOrigin);
        }
        resultActions.append(
          el("button", { class:"cloud-button", type:"button", text:"Copy link", onclick:async () => { await copyText(url); status.textContent = "Public link copied."; } }),
          el("a", { class:"cloud-button", href:url, target:"_blank", rel:"noopener", text:"View public page ↗" }),
          el("button", { class:"cloud-button primary", type:"button", text:"Done", onclick:() => closeOverlay(shell.overlay) }),
        );
        const resultPanel = el("div", { class:"cloud-share-result" }, [
          el("strong", { text:"Your Craft is now part of the public commons" }),
          localSourceMessage,
          el("input", { value:url, readonly:"", "aria-label":"Public community link" }),
          resultActions,
        ]);
        shell.body.insertBefore(resultPanel, shell.body.lastElementChild);
        publish.remove();
      } catch (error) {
        status.className = "cloud-share-status error";
        status.textContent = error.message || "Could not share this item.";
        publish.disabled = false;
      }
    } });
    shell.body.append(permissionLabel,trainingPermissionLabel, el("div", { class:"cloud-share-actions" }, [status, el("button", { class:"cloud-button", type:"button", text:"Cancel", onclick:() => closeOverlay(shell.overlay) }), publish]));
    publish.disabled=true;
    autoFill.addEventListener("click",async()=>{
      autoFill.disabled=true;
      status.className="cloud-share-status";
      status.textContent="Asking your current AI to improve the listing…";
      try{
        const metadata=await bridge.suggestMetadata({kind,artifact,current:{name:name.value,description:description.value,category:category.value,tags:parsedTags(),continuationPrompt:continuation.value}});
        name.value=metadata.name;
        description.value=metadata.description;
        category.value=CATEGORIES.includes(metadata.category)?metadata.category:"productivity";
        tags.value=(metadata.tags||[]).slice(0,8).join(", ");
        continuation.value=String(metadata.continuationPrompt||continuation.value).slice(0,500);
        refreshTagCount();
        saveDraft();
        status.className="cloud-share-status success";
        status.textContent="Listing optimized. Review it, then publish.";
      }catch(error){status.className="cloud-share-status error";status.textContent=error.message||"AI auto-fill failed.";}
      finally{autoFill.disabled=!artifact;}
    });
    queueMicrotask(async()=>{
      try{
        if(!bridge)throw new Error("The Canvas community bridge is not ready.");
        artifact=kind==="widget"?await bridge.widgetArtifact(widgetId):await bridge.canvasArtifact();
        lineage=bridge.lineageForArtifact?.(kind,artifact)||null;
        const draftIdentity=lineage?.parentItemId||(kind==="widget"?artifact.widget?.id:artifact.name)||"current";
        draftKey=`penecho.community.publish.${kind}.${String(draftIdentity).slice(0,180)}`;
        if(lineage){
          shell.body.insertBefore(field("Your contribution to this Craft",contribution),permissionLabel);
          const parentStep=Number.isInteger(lineage.parentGeneration)?`Step ${lineage.parentGeneration+1}`:"a published step", parentName=lineage.parentName?` “${lineage.parentName}”`:"";
          shell.body.insertBefore(el("div", { class:"cloud-lineage-notice", text:`Building on ${parentStep}${parentName}. The original attribution and this new step will stay connected.` }),contribution.closest("label"));
        }
        const preview=artifact.communityPreview,base64=preview?.dataBase64;
        if(!base64)throw new Error("The automatic preview was not created.");
        previewImage.src=`data:image/webp;base64,${base64}`;
        previewMeta.textContent=`Automatic WebP · ${preview.width} × ${preview.height} · no image upload needed`;
        previewPanel.setAttribute("aria-busy","false");
        const suggestedName=kind==="widget"?artifact.widget?.title:artifact.name;
        if(!name.value.trim())name.value=String(suggestedName||`Untitled ${kind==="widget"?"Widget":"Canvas"}`).slice(0,160);
        if(!description.value.trim())description.value=kind==="widget"?"A reusable Widget for the PenEcho community.":"A reusable Canvas for the PenEcho community.";
        const recovered=restoreDraft();
        updatePublishAvailability();
        autoFill.disabled=false;
        status.textContent=recovered?"Preview ready. Your unfinished listing was restored.":"Preview ready.";
      }catch(error){previewPanel.classList.add("error");previewMeta.textContent=error.message||"Could not generate the preview.";status.className="cloud-share-status error";status.textContent="Sharing is unavailable until the preview is valid.";}
    });
    permission.addEventListener("change",updatePublishAvailability);
    trainingPermission.addEventListener("change",updatePublishAvailability);
  }

  async function takeFurther(itemId) {
    await refreshStatus();
    if (!accountSignedIn()) { openCloud(); throw new Error("Sign in to take this Craft further."); }
    const downloaded = await api(`/api/cloud/community/${encodeURIComponent(itemId)}/artifact`);
    const item = downloaded.item;
    if (item?.kind === "widget") {
      if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error("This PenEcho version cannot import community Widgets yet.");
      await window.PenEchoCommunityCanvas.importWidget(downloaded.artifact, item);
    } else if (item?.kind === "canvas") {
      if (!window.PenEchoCommunityCanvas?.importCanvas) throw new Error("This PenEcho version cannot import community Canvases yet.");
      await window.PenEchoCommunityCanvas.importCanvas(downloaded.artifact, item);
    } else throw new Error("This Craft is not compatible with this PenEcho version.");
    closeOverlay(document.querySelector(".penecho-cloud-overlay"));
    return item;
  }

  window.PenEchoCommunityUI = Object.freeze({
    takeFurther,
    label: (key) => (window.PENECHO_LOCALES?.zh || {})[key],
  });

  /* Saved Crafts picker: the toolbar ➕ lists favorited community Widgets. */
  const craftsButton = document.getElementById("craftsButton");
  const craftsPopover = document.getElementById("craftsPopover");
  const craftsClose = document.getElementById("craftsClose");
  const craftsList = document.getElementById("craftsList");
  const savedT = (key, fallback) => document.documentElement.lang.startsWith("zh")
    ? (window.PENECHO_LOCALES?.zh || {})[key] || fallback
    : fallback;

  function setCraftsOpen(open) {
    if (!craftsPopover) return;
    craftsPopover.hidden = !open;
    craftsPopover.setAttribute("aria-hidden", String(!open));
    craftsButton?.setAttribute("aria-expanded", String(open));
    if (open) document.body.classList.add("plugin-open");
    else document.body.classList.remove("plugin-open");
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  /* Deletion tombstones: a favorite removed while the cloud DELETE could not
     land (offline, expired session) must stay deleted. The next sync re-issues
     the DELETE for the surviving cloud copy instead of mirroring it back. */
  const FAVORITE_TOMBSTONES_KEY = "penecho-favorite-tombstones";
  function favoriteTombstones() {
    try { return JSON.parse(localStorage.getItem(FAVORITE_TOMBSTONES_KEY)) || {}; } catch { return {}; }
  }
  function writeFavoriteTombstones(tombstones) {
    try { localStorage.setItem(FAVORITE_TOMBSTONES_KEY, JSON.stringify(tombstones)); } catch {}
  }
  function rememberFavoriteTombstone(sha256) {
    if (!sha256) return;
    const entries = Object.entries({ ...favoriteTombstones(), [sha256]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 200);
    writeFavoriteTombstones(Object.fromEntries(entries));
  }
  function clearFavoriteTombstone(sha256) {
    const tombstones = favoriteTombstones();
    if (!Object.hasOwn(tombstones, sha256)) return;
    delete tombstones[sha256];
    writeFavoriteTombstones(tombstones);
  }

  async function localFavorites() {
    try { return (await api("/api/favorites")).favorites || []; }
    catch { return []; }
  }

  async function saveLocalFavorite(favorite) {
    return (await api("/api/favorites", { method:"PUT", body:JSON.stringify(favorite) })).favorite;
  }

  async function removeLocalFavorite(sha256) {
    try { await api(`/api/favorites/${encodeURIComponent(sha256)}`, { method:"DELETE" }); } catch {}
  }

  function thumbnailDataUrl(favorite) {
    if (favorite.thumbnailUrl) return favorite.thumbnailUrl;
    const base64 = favorite.thumbnail || favorite.artifact?.communityThumbnail?.dataBase64 || favorite.artifact?.communityPreview?.dataBase64;
    const contentType = favorite.thumbnail ? "image/webp" : (favorite.artifact?.communityThumbnail || favorite.artifact?.communityPreview)?.contentType || "image/webp";
    return base64 ? `data:${contentType};base64,${base64}` : null;
  }

  /* One-click favorite on a widget: local snapshot always, cloud copy when signed in. */
  async function toggleWidgetFavorite(widgetId) {
    const bridge = window.PenEchoCommunityCanvas;
    if (!bridge?.widgetArtifact || !bridge.setWidgetFavorite) throw new Error("This PenEcho version does not support widget favorites.");
    const artifact = await bridge.widgetArtifact(widgetId);
    const sha256 = await sha256Hex(JSON.stringify(artifact));
    const locals = await localFavorites();
    const existing = locals.find((entry) => entry.artifactSha256 === sha256);
    const serialized = { name:String(artifact.widget?.title || "Untitled Widget").slice(0, 160), artifact, thumbnail:artifact.communityThumbnail?.dataBase64 || "", sourceItemId:artifact.widget?.communityOriginItemId || null };
    if (existing) {
      await removeLocalFavorite(sha256);
      rememberFavoriteTombstone(sha256);
      if (accountSignedIn() && existing.cloudId) { try { await api(`/api/cloud/favorites/${encodeURIComponent(existing.cloudId)}`, { method:"DELETE" }); } catch {} }
      bridge.setWidgetFavorite(widgetId, false);
      return false;
    }
    clearFavoriteTombstone(sha256);
    let saved = await saveLocalFavorite({ ...serialized, cloudId:null });
    if (accountSignedIn()) {
      try {
        const cloudFavorite = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify(serialized) })).favorite;
        saved = await saveLocalFavorite({ ...serialized, cloudId:cloudFavorite.id });
      } catch {}
    }
    bridge.setWidgetFavorite(widgetId, true);
    return true;
  }

  /* Two-way personal-favorites sync: upload offline saves, mirror cloud saves,
     and drop local mirrors whose cloud copy was removed elsewhere. */
  async function syncFavorites() {
    if (!accountSignedIn()) return { synced: 0 };
    const [locals, cloud] = await Promise.all([
      localFavorites(),
      api("/api/cloud/favorites").then((result) => result.favorites || []).catch(() => null),
    ]);
    if (!Array.isArray(cloud)) return { synced: 0 };
    const cloudBySha = new Map(cloud.map((entry) => [entry.artifactSha256, entry]));
    let synced = 0;
    for (const entry of locals) {
      const cloudEntry = cloudBySha.get(entry.artifactSha256);
      if (cloudEntry) {
        if (entry.cloudId !== cloudEntry.id) await saveLocalFavorite({ ...entry, cloudId:cloudEntry.id });
      } else if (entry.cloudId) {
        await removeLocalFavorite(entry.artifactSha256); // removed on the cloud elsewhere
      } else {
        try {
          const uploaded = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify({ name:entry.name, artifact:entry.artifact, thumbnail:entry.thumbnail, sourceItemId:entry.sourceItemId }) })).favorite;
          await saveLocalFavorite({ ...entry, cloudId:uploaded.id });
          synced += 1;
        } catch {}
      }
    }
    const tombstones = favoriteTombstones();
    for (const cloudEntry of cloud) {
      if (locals.some((entry) => entry.artifactSha256 === cloudEntry.artifactSha256)) continue;
      const tombstonedAt = Number(tombstones[cloudEntry.artifactSha256]) || 0;
      if (tombstonedAt) {
        // A cloud copy created after the tombstone is a fresh favorite made on
        // another device — the delete intent does not cover it.
        if (Number(cloudEntry.createdAt) > tombstonedAt) clearFavoriteTombstone(cloudEntry.artifactSha256);
        else {
          try {
            await api(`/api/cloud/favorites/${encodeURIComponent(cloudEntry.id)}`, { method:"DELETE" });
            clearFavoriteTombstone(cloudEntry.artifactSha256);
          } catch { /* still offline: the tombstone retries next sync */ }
        }
        continue;
      }
      try {
        await saveLocalFavorite({ name:cloudEntry.name, artifactSha256:cloudEntry.artifactSha256, artifact:cloudEntry.artifact, thumbnail:cloudEntry.thumbnail, sourceItemId:cloudEntry.sourceItemId, cloudId:cloudEntry.id, createdAt:cloudEntry.createdAt });
        synced += 1;
      } catch {}
    }
    return { synced };
  }

  function craftsFallbackThumb() {
    const node = document.createElement("span");
    node.className = "crafts-thumb-fallback";
    node.textContent = "W";
    return node;
  }

  function craftsSourceBadge(sources) {
    const badge = document.createElement("span");
    badge.className = "crafts-source";
    const cloud = sources.includes("cloud") || sources.includes("community");
    if (cloud && sources.includes("local")) { badge.textContent = savedT("savedSourceSynced", "☁ + local"); badge.title = savedT("savedSourceCloudTitle", "Saved on PenEcho Cloud and this device"); }
    else if (cloud) { badge.textContent = sources.includes("community") ? savedT("savedSourceCommunity", "☁ community") : savedT("savedSourceCloud", "☁ cloud"); badge.title = savedT("savedSourceCloudTitle", "Saved on PenEcho Cloud"); }
    else { badge.textContent = savedT("savedSourceLocal", "local"); badge.title = savedT("savedSourceLocalTitle", "Saved on this device only — it uploads to PenEcho Cloud once you sign in"); }
    return badge;
  }

  async function addCraftToCanvas(merged) {
    const local = merged.sources.find((entry) => entry.type === "local");
    if (local) {
      if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error("This PenEcho version cannot import Widgets yet.");
      await window.PenEchoCommunityCanvas.importWidget(local.entry.artifact, local.entry.sourceItemId ? { id:local.entry.sourceItemId, name:local.entry.name } : null);
      return;
    }
    const cloudEntry = (merged.sources.find((entry) => entry.type === "cloud") || merged.sources.find((entry) => entry.type === "community"))?.entry;
    if (merged.sources.some((entry) => entry.type === "community")) return takeFurther(cloudEntry.id);
    if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error("This PenEcho version cannot import Widgets yet.");
    await window.PenEchoCommunityCanvas.importWidget(cloudEntry.artifact, cloudEntry.sourceItemId ? { id:cloudEntry.sourceItemId, name:cloudEntry.name } : null);
  }

  async function removeCraft(merged) {
    for (const source of merged.sources) {
      if (source.type === "local") { await removeLocalFavorite(source.entry.artifactSha256); rememberFavoriteTombstone(source.entry.artifactSha256); }
      else if (source.type === "cloud") { rememberFavoriteTombstone(source.entry.artifactSha256); try { await api(`/api/cloud/favorites/${encodeURIComponent(source.entry.id)}`, { method:"DELETE" }); } catch {} }
      else if (source.type === "community") { try { await api(`/api/cloud/community/${encodeURIComponent(source.entry.id)}/favorite`, { method:"DELETE" }); } catch {} }
    }
  }

  function craftsRow(merged, refresh) {
    const row = document.createElement("div");
    row.className = "crafts-row";
    const source = merged.sources[0].entry;
    const thumb = document.createElement("img");
    thumb.className = "crafts-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    const url = thumbnailDataUrl(source) || (merged.sources.some((entry) => entry.type === "community") ? `/api/cloud/community/${encodeURIComponent(source.id)}/thumbnail` : null);
    if (url) { thumb.src = url; thumb.addEventListener("error", () => thumb.replaceWith(craftsFallbackThumb())); }
    else thumb.replaceWith(craftsFallbackThumb());
    const copy = document.createElement("div");
    copy.className = "crafts-copy";
    const title = document.createElement("b");
    title.textContent = source.name || "Untitled Widget";
    const byline = document.createElement("small");
    byline.textContent = source.artifact?.widget?.title || source.description || "Community Widget";
    byline.append(document.createElement("br"), craftsSourceBadge(merged.sources.map((entry) => entry.type === "community" ? "community" : entry.type)));
    copy.append(title, byline);
    const actions = document.createElement("div");
    actions.className = "crafts-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "crafts-add";
    add.textContent = savedT("savedAdd", "Add");
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = savedT("savedAdding", "Adding…");
      try { await addCraftToCanvas(merged); setCraftsOpen(false); }
      catch (error) { add.textContent = savedT("savedAdd", "Add"); add.disabled = false; alert(error?.message || savedT("savedErrorAdd", "Could not add this Widget.")); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "crafts-remove";
    remove.textContent = "×";
    remove.title = savedT("savedRemoveTitle", "Remove from saved");
    remove.setAttribute("aria-label", `${savedT("savedRemoveTitle", "Remove from saved")}: ${source.name || ""}`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      await removeCraft(merged);
      await refresh();
    });
    actions.append(add, remove);
    row.append(thumb, copy, actions);
    return row;
  }

  async function openCrafts() {
    if (!craftsPopover) return;
    setCraftsOpen(true);
    craftsList.replaceChildren(el("p", { class:"crafts-empty", text:savedT("savedLoading", "Loading saved Widgets…") }));
    const refresh = async () => { await renderCraftsList(); };
    async function renderCraftsList() {
      const locals = await localFavorites();
      let cloudPersonal = [], community = [];
      if (accountSignedIn()) {
        await syncFavorites();
        const [personal, favorites] = await Promise.all([
          api("/api/cloud/favorites").then((result) => result.favorites || []).catch(() => []),
          api("/api/cloud/community?scope=favorites&sort=newest&limit=60").then((result) => result.items || []).catch(() => []),
        ]);
        cloudPersonal = personal;
        community = favorites.filter((item) => item.kind === "widget");
      }
      const mergedMap = new Map();
      const offer = (type, entry, sha) => {
        const key = sha || entry.artifactSha256;
        if (!key) return;
        if (!mergedMap.has(key)) mergedMap.set(key, { key, sources: [] });
        mergedMap.get(key).sources.push({ type, entry });
      };
      for (const entry of locals) offer("local", entry);
      for (const entry of cloudPersonal) offer("cloud", entry);
      for (const item of community) offer("community", item, item.artifactSha256 || item.artifact?.sha256);
      const merged = [...mergedMap.values()];
      if (!merged.length) {
        craftsList.replaceChildren(el("p", { class:"crafts-empty", text:accountSignedIn()
          ? savedT("savedEmptyIn", "No saved Widgets yet. Tap ★ on any Widget to keep it here.")
          : savedT("savedEmptyOut", "No saved Widgets yet. Tap ★ on any Widget — favorites stay on this device until you sign in to PenEcho Cloud.") }));
        return;
      }
      craftsList.replaceChildren(...merged.map((entry) => craftsRow(entry, refresh)));
    }
    try {
      await refreshStatus();
      await renderCraftsList();
    } catch (error) {
      craftsList.replaceChildren(el("p", { class:"crafts-empty", text:error?.message || savedT("savedErrorAdd", "Saved Widgets are unavailable right now.") }));
    }
  }

  craftsButton?.addEventListener("click", openCrafts);
  craftsClose?.addEventListener("click", () => setCraftsOpen(false));
  craftsPopover?.addEventListener("mousedown", (event) => { if (event.target === craftsPopover) setCraftsOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !craftsPopover?.hidden) setCraftsOpen(false); });

  cloudButton.addEventListener("click", openCloud);
  shareCanvasButton.addEventListener("click", async () => { await refreshStatus(); shareDialog({ kind:"canvas" }); });
  window.addEventListener("penecho:community-widget-action", async (event) => {
    const actionName = event.detail?.action;
    const widgetId = event.detail?.widgetId;
    if (!widgetId || !["favorite", "share"].includes(actionName)) return;
    await refreshStatus();
    if (actionName === "share") { shareDialog({ kind:"widget", widgetId }); return; }
    try { await toggleWidgetFavorite(widgetId); }
    catch (error) { alert(error?.message || savedT("savedErrorToggle", "Could not save this Widget.")); }
  });
  window.addEventListener("message", async (event) => {
    if (event.origin !== location.origin || event.data?.type !== "penecho:cloud-sign-in-result") return;
    await refreshStatus();
    if (accountSignedIn()) {
      stopBrowserSignInWatch();
      browserSignInMessage("Signed in. Your Cloud account is ready.", "success");
      document.querySelector(".penecho-cloud-overlay")?.remove();
      openCloud();
      return;
    }
    if (event.data.ok) return;
    stopBrowserSignInWatch();
    browserSignInMessage("Cloud sign-in could not be completed. Please try again.", "error");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.browserSignIn.active && state.browserSignIn.poll) {
      clearTimeout(state.browserSignIn.timer);
      state.browserSignIn.timer = 0;
      void state.browserSignIn.poll();
    }
    // Refresh the Cloud Center immediately when the page becomes visible again
    // instead of waiting out the longer hidden-tab poll interval.
    if (cloudStatusPoll) {
      clearTimeout(cloudStatusTimer);
      cloudStatusTimer = 0;
      void cloudStatusPoll();
    }
  });
  void refreshStatus();
})();
