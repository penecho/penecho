"use strict";

(() => {
  const cloudButton = document.getElementById("cloudAccountBtn");
  const shareCanvasButton = document.getElementById("shareCanvasBtn");
  if (!cloudButton || !shareCanvasButton) return;

  const CATEGORIES = ["education", "productivity", "data", "design", "developer", "science", "business", "lifestyle", "other"];
  const PUBLICATION_TERMS_VERSION = "2026-08-11";
  const sessionToken = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || "");
  const configuredCloudOrigin = String(window.PENECHO_CONFIG?.cloudOrigin || "https://penecho.ai");
  const configuredCloudEnvironment = String(window.PENECHO_CONFIG?.cloudEnvironment || "prod");
  const requestedCommunityItem = new URLSearchParams(location.search).get("community");
  const state = { status:null, section:requestedCommunityItem ? "community" : "projects", scope:"community", kind:"widget", sort:"recommended", focusItem:/^[0-9a-f-]{36}$/i.test(requestedCommunityItem || "") ? requestedCommunityItem : null, focusQuery:"", items:[], library:null, busy:false, previewGeneration:0, previewObjectUrls:new Set() };

  function cloudOrigin() {
    return configuredCloudOrigin.replace(/\/$/, "");
  }

  function communityUrl(item) {
    return new URL(String(item?.shareUrl || `/community/${item?.id || ""}`), `${cloudOrigin()}/`).toString();
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

  async function apiImage(path) {
    const response = await fetch(path, { headers:{ ...apiHeaders(false), accept:"image/webp" } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || `Cloud image request failed (HTTP ${response.status}).`);
    }
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "image/webp") throw new Error("Cloud preview is not a WebP image.");
    const blob = await response.blob();
    if (!blob.size || blob.size > 4 * 1024 * 1024) throw new Error("Cloud preview has an invalid size.");
    return URL.createObjectURL(blob);
  }

  function releaseCommunityPreviews() {
    state.previewGeneration++;
    for (const url of state.previewObjectUrls) URL.revokeObjectURL(url);
    state.previewObjectUrls.clear();
    return state.previewGeneration;
  }

  async function loadCommunityThumbnail(image, itemId, generation) {
    try {
      const objectUrl = await apiImage(`/api/cloud/community/${encodeURIComponent(itemId)}/thumbnail`);
      if (generation !== state.previewGeneration || !image.isConnected) return URL.revokeObjectURL(objectUrl);
      state.previewObjectUrls.add(objectUrl);
      image.src = objectUrl;
    } catch {
      image.removeAttribute("src");
    }
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

  function closeOverlay(overlay) {
    releaseCommunityPreviews();
    overlay?.remove();
    cloudButton.setAttribute("aria-expanded", "false");
  }

  function dialogShell({ title, subtitle = "", share = false }) {
    const overlay = el("div", { class:"penecho-cloud-overlay" });
    const dialog = el("section", { class:`penecho-cloud-dialog${share ? " share" : ""}`, role:"dialog", "aria-modal":"true", "aria-label":title });
    const close = el("button", { class:"cloud-dialog-close", type:"button", text:"×", "aria-label":"Close", onclick:() => closeOverlay(overlay) });
    const heading = el("div", {}, [el("h2", { text:title }), subtitle ? el("p", { text:subtitle }) : null]);
    dialog.append(el("header", {}, [heading, close]));
    const body = el("div", { class:"penecho-cloud-body" });
    dialog.append(body);
    overlay.append(dialog);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) closeOverlay(overlay); });
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

  async function refreshStatus(force = false) {
    try {
      state.status = await api(force ? "/api/cloud/account" : "/api/cloud/status");
      updateCloudButton();
      return state.status;
    } catch (error) {
      if (force) throw error;
      cloudButton.dataset.state = "signed-out";
      return null;
    }
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
      const actions = el("div", { class:"cloud-button-row" });
      actions.append(el("button", { class:"cloud-button", type:"button", text:"Refresh", onclick:async () => action(render, async () => refreshStatus(true)) }));
      actions.append(el("button", { class:"cloud-button danger", type:"button", text:"Sign out", onclick:async () => action(render, async () => { await api("/api/cloud/sign-out", { method:"POST", body:"{}" }); await refreshStatus(); }) }));
      panel.append(actions);
      return panel;
    }

    panel.append(el("div", { class:"cloud-environment" }, [el("span", { text:configuredCloudEnvironment === "uat" ? "UAT" : "Production" }), el("code", { text:cloudOrigin() })]));
    panel.append(el("p", { text:"Sign in locally. Your API keys stay on this device; private projects, community items and relayed requests use Cloud." }));
    const message = el("div", { class:"cloud-message", text:"" });
    const signIn = el("button", { class:"cloud-button primary", type:"button", text:"Sign in with browser", onclick:async () => {
      await action(render, async () => {
        const started = await api("/api/cloud/sign-in/start", { method:"POST", body:JSON.stringify({ origin:cloudOrigin() }) });
        const popup = window.open(started.authorizationUrl, "penecho-cloud-sign-in", "popup,width=760,height=760");
        message.className = "cloud-message";
        message.textContent = popup ? "Complete sign-in in the Cloud window…" : "Open the Cloud authorization URL in a new tab, then return here.";
        if (!popup) window.open(started.authorizationUrl, "_blank", "noopener");
      });
    } });
    panel.append(el("div", { class:"cloud-button-row" }, signIn), message);
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
      actions.append(el("button", { class:"cloud-button danger", type:"button", text:"Revoke device", onclick:async () => {
        if (!window.confirm("Revoke this device link? You can pair it again later.")) return;
        await action(render, async () => { await api("/api/cloud/device/revoke", { method:"POST", body:"{}" }); await refreshStatus(); });
      } }));
      panel.append(actions);
      return panel;
    }
    panel.append(el("p", { text:"Generate a pairing key in PenEcho Cloud → Devices, then enter it below." }));
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
      el("div", {}, [el("h3", { text:"Cloud Projects" }), el("p", { text:"Private, versioned Canvases available in every signed-in PenEcho app." })]),
      el("button", { class:"cloud-button primary", type:"button", text:"Save current Canvas", onclick:async () => {
        const bridge = window.PenEchoCloudProjects;
        if (!bridge?.openHistory) return window.alert("Cloud project saving is not ready yet.");
        const preferred = state.library?.projects?.find((project) => project.systemKey !== "uncategorized") || state.library?.projects?.[0];
        closeOverlay(panel.closest(".penecho-cloud-overlay"));
        await bridge.openHistory(preferred?.id || null);
      } }),
    ]));
    if (!accountSignedIn()) {
      panel.append(el("div", { class:"cloud-empty", text:"Sign in to save private projects and continue your work across desktop, macOS and future iOS apps." }));
      return panel;
    }
    const content = el("div", { class:"cloud-project-content" });
    const createName = el("input", { type:"text", maxlength:"160", placeholder:"New project name", "aria-label":"New Cloud project name" });
    const createButton = el("button", { class:"cloud-button", type:"button", text:"New project", onclick:async () => action(load, async () => {
      const name = createName.value.trim();
      if (!name) throw Error("Enter a project name.");
      await api("/api/cloud/projects", { method:"POST", body:JSON.stringify({ name }) });
      createName.value = "";
    }) });
    panel.append(el("div", { class:"cloud-project-toolbar" }, [createName, createButton]), content);

    function renderLibrary() {
      const library = state.library || {}, workspace = library.workspace || {}, projects = Array.isArray(library.projects) ? library.projects : [], canvases = Array.isArray(library.canvases) ? library.canvases : [];
      const used = Number(workspace.storageUsedBytes || 0) + Number(workspace.storageReservedBytes || 0), limit = Number(workspace.storageLimitBytes || 0);
      const storage = el("div", { class:"cloud-storage-summary" }, [
        el("div", {}, [el("strong", { text:`${formatBytes(used)} used` }), el("span", { text:limit ? ` of ${formatBytes(limit)}` : "" })]),
        el("progress", { class:"cloud-storage-track", max:String(Math.max(1, limit)), value:String(Math.min(used, Math.max(1, limit))), "aria-label":"Cloud storage used" }),
        el("small", { text:"Every successful save creates an immutable revision. Concurrent edits are never silently overwritten." }),
      ]);
      const grid = el("div", { class:"cloud-project-grid" });
      for (const project of projects) {
        const projectCanvases = canvases.filter((canvas) => canvas.projectId === project.id);
        const card = el("article", { class:"cloud-project-card" });
        card.append(el("div", { class:"cloud-project-card-head" }, [
          el("div", {}, [el("h4", { text:project.name || "Untitled project" }), el("span", { text:`${projectCanvases.length} Canvas${projectCanvases.length === 1 ? "" : "es"}` })]),
          el("button", { class:"cloud-button", type:"button", text:"Save here", onclick:async () => {
            const bridge = window.PenEchoCloudProjects;
            if (!bridge?.openHistory) return window.alert("Cloud project saving is not ready yet.");
            closeOverlay(panel.closest(".penecho-cloud-overlay"));
            await bridge.openHistory(project.id);
          } }),
        ]));
        const list = el("div", { class:"cloud-canvas-list" });
        if (!projectCanvases.length) list.append(el("div", { class:"cloud-project-empty", text:"No Canvases yet. Save the current Canvas here to start." }));
        for (const canvas of projectCanvases.slice(0, 8)) {
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
        grid.append(card);
      }
      if (!projects.length) grid.append(el("div", { class:"cloud-empty", text:"No Cloud projects yet. Create one to keep this Canvas available across devices." }));
      content.replaceChildren(storage, grid, el("a", { class:"cloud-project-web-link", href:new URL("/dashboard.html#projects", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:"Manage revisions, Trash and recovery on the web ↗" }));
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

  function itemCard(item, renderItems, previewGeneration) {
    const card = el("article", { class:"cloud-item" });
    const previewImage = el("img", { alt:`Preview of ${item.name}`, loading:"lazy" });
    card.append(el("button", { class:"cloud-item-preview", type:"button", "aria-label":`View the large screenshot for ${item.name}`, onclick:() => window.open(communityUrl(item), "_blank", "noopener") }, [
      previewImage,
      el("span", { text:item.kind === "widget" ? "Widget" : "Canvas" }),
    ]));
    void loadCommunityThumbnail(previewImage, item.id, previewGeneration);
    const details = el("div", { class:"cloud-item-body" });
    details.append(el("span", { class:"cloud-item-kind", text:`${item.category} · ${item.author?.name || "PenEcho creator"}` }));
    details.append(el("h4", { text:item.name }));
    details.append(el("p", { class:"cloud-item-description", text:item.description || "Shared for the PenEcho community." }));
    const tags = el("div", { class:"cloud-item-tags" });
    for (const tag of item.tags || []) tags.append(el("span", { text:tag }));
    details.append(tags);
    details.append(el("div", { class:"cloud-item-meta" }, [
      el("span", { text:`${Number(item.forkCount || 0)} further` }),
      el("span", { text:`${Number(item.favoriteCount || 0)} saved` }),
      el("span", { text:item.generation ? `Step ${Number(item.generation) + 1}` : "First stroke" }),
    ]));
    const actions = el("div", { class:"cloud-item-actions" });
    if (accountSignedIn()) actions.append(el("button", { class:"cloud-item-action", type:"button", text:item.isFavorite ? "Saved" : "Add to Favorites", onclick:async () => action(renderItems, async () => {
        const result = await api(`/api/cloud/community/${item.id}/favorite`, { method:item.isFavorite ? "DELETE" : "POST", ...(item.isFavorite ? {} : { body:"{}" }) });
        Object.assign(item, result.item || {});
      }) }));
    else actions.append(el("button", { class:"cloud-item-action", type:"button", text:"Sign in to save", onclick:() => document.querySelector(".penecho-cloud-panel .cloud-button.primary")?.focus() }));
    actions.append(el("button", { class:"cloud-item-action", type:"button", text:"Share", onclick:async () => {
      const url = communityUrl(item);
      if (navigator.share) await navigator.share({ title:item.name, text:item.description || `Explore this ${item.kind} on PenEcho`, url }).catch((error) => { if (error?.name !== "AbortError") throw error; });
      else { await copyText(url); window.alert("Public share link copied."); }
    } }));
    if (accountSignedIn() && item.takeFurtherUrl) actions.append(el("button", { class:"cloud-item-action primary", type:"button", text:"Take it further", onclick:async () => action(renderItems, () => takeFurther(item.id)) }));
    details.append(actions);
    card.append(details);
    return card;
  }

  function communityPanel() {
    const panel = el("section", { class:"penecho-cloud-panel" });
    panel.append(el("h3", { text:"Explore Crafts" }));
    if (!accountSignedIn()) panel.append(el("p", { class:"cloud-community-guest", text:"Browse public ideas and their lineage. Sign in to save one or take it further in PenEcho." }));
    const tabs = el("div", { class:"cloud-tabs" });
    const kindTabs = el("div", { class:"cloud-kind-tabs", role:"tablist", "aria-label":"Community content type" });
    const content = el("div");
    const category = el("select", {}, [el("option", { value:"", text:"All categories" }), ...CATEGORIES.map(value => el("option", { value, text:value[0].toUpperCase() + value.slice(1) }))]);
    const sort = el("select", {}, [
      el("option", { value:"recommended", text:"Recommended" }),
      el("option", { value:"newest", text:"Newest" }),
      el("option", { value:"downloads", text:"Most downloaded" }),
      el("option", { value:"favorites", text:"Most favorited" }),
    ]);
    sort.value = state.sort;
    const search = el("input", { type:"search", placeholder:"Search community" });
    search.value = state.focusQuery;

    async function load() {
      content.replaceChildren(el("div", { class:"cloud-message", text:"Loading community…" }));
      try {
        const query = new URLSearchParams({ scope:state.scope, kind:state.kind, sort:sort.value });
        if (category.value) query.set("category", category.value);
        if (search.value.trim()) query.set("q", search.value.trim());
        const result = await api(`/api/cloud/community?${query}`);
        state.items = result.items || [];
        renderItems();
      } catch (error) {
        content.replaceChildren(el("div", { class:"cloud-message error", text:error.message }));
      }
    }
    function renderItems() {
      const previewGeneration = releaseCommunityPreviews();
      if (!state.items.length) return content.replaceChildren(el("div", { class:"cloud-empty", text:"Nothing here yet. One useful stroke can begin the first Craft." }));
      const grid = el("div", { class:"cloud-community-grid" });
      for (const item of state.items) grid.append(itemCard(item, renderItems, previewGeneration));
      content.replaceChildren(grid);
    }
    for (const [scope, label] of accountSignedIn() ? [["community", "Discover"], ["favorites", "Favorites"], ["shared", "My shares"]] : [["community", "Discover"]]) {
      tabs.append(el("button", { class:`cloud-tab${state.scope === scope ? " active" : ""}`, type:"button", text:label, onclick:(event) => {
        state.scope = scope;
        for (const button of tabs.children) button.classList.toggle("active", button === event.currentTarget);
        load();
      } }));
    }
    for (const [kind, label, description] of [["widget", "Widgets", "Reusable building blocks to take further"], ["canvas", "Canvases", "Visual ideas with an open lineage"]]) {
      kindTabs.append(el("button", { class:`cloud-kind-tab${state.kind === kind ? " active" : ""}`, type:"button", role:"tab", "aria-selected":String(state.kind === kind), onclick:(event) => {
        state.kind = kind;
        for (const button of kindTabs.children) {
          button.classList.toggle("active", button === event.currentTarget);
          button.setAttribute("aria-selected", String(button === event.currentTarget));
        }
        load();
      } }, [el("strong", { text:label }), el("span", { text:description })]));
    }
    let searchTimer;
    search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); });
    category.addEventListener("change", load);
    sort.addEventListener("change", () => { state.sort = sort.value; load(); });
    panel.append(tabs, kindTabs, el("div", { class:"cloud-community-tools" }, [field("Category", category), field("Sort by", sort), field("Search", search)]), content);
    queueMicrotask(load);
    return panel;
  }

  async function openCloud() {
    cloudButton.setAttribute("aria-expanded", "true");
    await refreshStatus();
    if (accountSignedIn() && state.focusItem) {
      state.section = "community";
      try {
        const result = await api(`/api/cloud/community/${encodeURIComponent(state.focusItem)}`);
        if (result.item) { state.kind = result.item.kind; state.focusQuery = result.item.name; }
        state.focusItem = null;
        const clean = new URL(location.href);
        clean.searchParams.delete("community");
        history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
      } catch {}
    }
    const shell = dialogShell({ title:"PenEcho Cloud", subtitle:"Private projects and shared building blocks." });
    const layout = el("div", { class:"penecho-cloud-layout" });
    shell.body.append(layout);
    function render() {
      const accountColumn = el("div", {}, [accountPanel(render), devicePanel(render)]);
      accountColumn.append(el("a", { class:"cloud-public-link", href:new URL("/community", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener" }, [
        el("strong", { text:"Explore public Crafts ↗" }),
        el("span", { text:"See how ideas grow, then continue one in PenEcho." }),
      ]));
      const workspace = el("div", { class:"cloud-workspace" });
      const sections = el("div", { class:"cloud-section-tabs", role:"tablist", "aria-label":"PenEcho Cloud area" });
      for (const [section, label, description] of [["projects", "Cloud Projects", "Private cross-device work"], ["community", "Explore", "Public Widgets and Canvas Crafts"]]) {
        sections.append(el("button", { class:`cloud-section-tab${state.section === section ? " active" : ""}`, type:"button", role:"tab", "aria-selected":String(state.section === section), onclick:() => { state.section = section; render(); } }, [el("strong", { text:label }), el("span", { text:description })]));
      }
      workspace.append(sections, state.section === "projects" ? cloudProjectsPanel() : communityPanel());
      layout.replaceChildren(accountColumn, workspace);
    }
    render();
  }

  function shareDialog({ kind, widgetId = null, favoriteAfterShare = false }) {
    if (!accountSignedIn()) {
      openCloud();
      return;
    }
    const title = kind === "widget" ? "Publish this Widget" : "Publish this Canvas", bridge=window.PenEchoCommunityCanvas;
    const shell = dialogShell({ title, subtitle:"Add one clear note, review the automatic preview, and open this Craft for others to build on.", share:true });
    const name = el("input", { type:"text", maxlength:"160", placeholder:kind === "widget" ? "Widget name" : "Canvas name" });
    const description = el("textarea", { rows:"3", maxlength:"1200", placeholder:"A short, useful introduction" });
    const category = el("select", {}, CATEGORIES.map(value => el("option", { value, text:value[0].toUpperCase() + value.slice(1) })));
    category.value = "productivity";
    const tags = el("input", { type:"text", maxlength:"260", placeholder:"planning, dashboard, learning" }),tagCount=el("small", { class:"cloud-tag-count", text:"0 / 8 tags" });
    const status = el("span", { class:"cloud-share-status", text:"Generating preview…" }),previewImage=el("img", { alt:`Automatic ${kind} share preview` }),previewMeta=el("span", { text:"WebP · validating content" }),previewPanel=el("div", { class:"cloud-share-preview", "aria-busy":"true" }, [previewImage,previewMeta]);
    const autoFill=el("button", { class:"cloud-button cloud-ai-fill", type:"button", text:"Auto-fill with current AI", disabled:"" });
    const contribution = el("textarea", { rows:"3", maxlength:"500", placeholder:"What did you move forward?" });
    const permission = el("input", { type:"checkbox" });
    const permissionLabel = el("label", { class:"cloud-publication-consent" }, [permission, el("span", {}, [
      document.createTextNode("I have the right to publish this work. Its visual and written content is shared under "),
      el("a", { href:"https://creativecommons.org/licenses/by/4.0/", target:"_blank", rel:"noopener", text:"CC BY 4.0" }),
      document.createTextNode(", embedded source under "),
      el("a", { href:"https://opensource.org/license/mit", target:"_blank", rel:"noopener", text:"MIT" }),
      document.createTextNode(". Others may Take it further with attribution; published versions and existing lineage cannot be withdrawn."),
    ])]);
    let artifact=null,lineage=null;
    function parsedTags(){return tags.value.split(",").map(value=>value.trim()).filter(Boolean).slice(0,8);}
    function refreshTagCount(){tagCount.textContent=`${parsedTags().length} / 8 tags`;}
    tags.addEventListener("input",refreshTagCount);
    shell.body.append(el("div", { class:"cloud-share-note", text:`PenEcho captures this ${kind} automatically; there is no image upload step. Every launch Craft is free. The full screenshot is validated WebP, at most 2048 × 2048 and 4 MB, with a clear list thumbnail.` }),previewPanel);
    shell.body.append(el("div", { class:"cloud-share-ai-row" }, [autoFill,el("span", { text:"Uses the AI connection currently active on this device." })]),field("Name", name), field("Description", description), field("Category", category),field("Tags (up to 8, comma separated)", el("div", { class:"cloud-tags-input" }, [tags,tagCount])));
    const publish = el("button", { class:"cloud-button primary", type:"button", text:favoriteAfterShare ? "Publish & favorite" : "Publish", onclick:async () => {
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
          publicationTermsAccepted:permission.checked,
          publicationTermsVersion:PUBLICATION_TERMS_VERSION,
        };
        if (!payload.name) throw new Error("Enter a name before publishing.");
        if (lineage && !payload.contributionNote) throw new Error("Tell the next Crafter what you moved forward.");
        if (!permission.checked) throw new Error("Confirm the publication rights and open licenses before publishing.");
        status.textContent = lineage ? "Adding your step to the Craft lineage…" : "Publishing the first step of this Craft…";
        const result = await api("/api/cloud/community/share", { method:"POST", body:JSON.stringify(payload) });
        if (favoriteAfterShare && result.item?.id) await api(`/api/cloud/community/${result.item.id}/favorite`, { method:"POST", body:"{}" });
        status.className = "cloud-share-status success";
        status.textContent = favoriteAfterShare ? "Craft published and saved." : "Craft published. Others can now take it further.";
        const url = communityUrl(result.item);
        const resultPanel = el("div", { class:"cloud-share-result" }, [
          el("strong", { text:"Your Craft is now part of the public commons" }),
          el("input", { value:url, readonly:"", "aria-label":"Public community link" }),
          el("div", { class:"cloud-button-row" }, [
            el("button", { class:"cloud-button", type:"button", text:"Copy link", onclick:async () => { await copyText(url); status.textContent = "Public link copied."; } }),
            el("a", { class:"cloud-button", href:url, target:"_blank", rel:"noopener", text:"View public page ↗" }),
            el("button", { class:"cloud-button primary", type:"button", text:"Done", onclick:() => closeOverlay(shell.overlay) }),
          ]),
        ]);
        shell.body.insertBefore(resultPanel, shell.body.lastElementChild);
        publish.remove();
      } catch (error) {
        status.className = "cloud-share-status error";
        status.textContent = error.message || "Could not share this item.";
        publish.disabled = false;
      }
    } });
    shell.body.append(permissionLabel, el("div", { class:"cloud-share-actions" }, [status, el("button", { class:"cloud-button", type:"button", text:"Cancel", onclick:() => closeOverlay(shell.overlay) }), publish]));
    publish.disabled=true;
    autoFill.addEventListener("click",async()=>{
      autoFill.disabled=true;
      status.className="cloud-share-status";
      status.textContent="Asking your current AI to improve the listing…";
      try{
        const metadata=await bridge.suggestMetadata({kind,artifact,current:{name:name.value,description:description.value,category:category.value,tags:parsedTags()}});
        name.value=metadata.name;
        description.value=metadata.description;
        category.value=CATEGORIES.includes(metadata.category)?metadata.category:"productivity";
        tags.value=(metadata.tags||[]).slice(0,8).join(", ");
        refreshTagCount();
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
        if(lineage){
          shell.body.insertBefore(field("Your contribution to this Craft",contribution),permissionLabel);
          shell.body.insertBefore(el("div", { class:"cloud-lineage-notice", text:"Building on a published Craft. The original attribution and this new step will stay connected." }),contribution.closest("label"));
        }
        const preview=artifact.communityPreview,base64=preview?.dataBase64;
        if(!base64)throw new Error("The automatic preview was not created.");
        previewImage.src=`data:image/webp;base64,${base64}`;
        previewMeta.textContent=`Automatic WebP · ${preview.width} × ${preview.height} · no image upload needed`;
        previewPanel.setAttribute("aria-busy","false");
        const suggestedName=kind==="widget"?artifact.widget?.title:artifact.name;
        if(!name.value.trim())name.value=String(suggestedName||`Untitled ${kind==="widget"?"Widget":"Canvas"}`).slice(0,160);
        if(!description.value.trim())description.value=kind==="widget"?"A reusable Widget for the PenEcho community.":"A reusable Canvas for the PenEcho community.";
        publish.disabled=!permission.checked;
        autoFill.disabled=false;
        status.textContent="Preview ready.";
      }catch(error){previewPanel.classList.add("error");previewMeta.textContent=error.message||"Could not generate the preview.";status.className="cloud-share-status error";status.textContent="Sharing is unavailable until the preview is valid.";}
    });
    permission.addEventListener("change",()=>{ publish.disabled=!artifact||!permission.checked; });
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

  window.PenEchoCommunityUI = Object.freeze({ takeFurther });

  cloudButton.addEventListener("click", openCloud);
  shareCanvasButton.addEventListener("click", async () => { await refreshStatus(); shareDialog({ kind:"canvas" }); });
  window.addEventListener("penecho:community-widget-action", async (event) => {
    await refreshStatus();
    const actionName = event.detail?.action;
    const widgetId = event.detail?.widgetId;
    if (!widgetId || !["favorite", "share"].includes(actionName)) return;
    shareDialog({ kind:"widget", widgetId, favoriteAfterShare:actionName === "favorite" });
  });
  window.addEventListener("message", async (event) => {
    if (event.source && event.data?.type === "penecho:cloud-sign-in-result") {
      await refreshStatus(true).catch(() => {});
      document.querySelector(".penecho-cloud-overlay")?.remove();
      if (accountSignedIn()) openCloud();
    }
  });
  refreshStatus().then(() => { if (state.focusItem) openCloud(); });
})();
