(() => {
  "use strict";

  const INSTALLATION_KEY = "penecho-anonymous-installation-id-v1";
  const SENT_KEY = "penecho-client-activity-sent-v1";
  const IDENTIFIER_PATTERN = /^[0-9a-f]{32,64}$/;

  function randomInstallationId() {
    try {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replaceAll("-", "");
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    } catch {
      return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
    }
  }

  function installationId() {
    try {
      const stored = String(localStorage.getItem(INSTALLATION_KEY) || "").toLowerCase();
      if (IDENTIFIER_PATTERN.test(stored)) return stored;
      const created = randomInstallationId();
      localStorage.setItem(INSTALLATION_KEY, created);
      return created;
    } catch {
      return randomInstallationId();
    }
  }

  function browserPlatform() {
    const source = `${navigator.userAgent || ""} ${navigator.platform || ""}`;
    if (/android/i.test(source)) return "android";
    if (/iphone|ipad|ipod/i.test(source)) return "ios";
    if (/windows/i.test(source)) return "windows";
    if (/macintosh|mac os|macintel/i.test(source)) return "macos";
    if (/linux/i.test(source)) return "linux";
    return "unknown";
  }

  function metadata() {
    const config = window.PENECHO_CONFIG || {};
    const runtime = String(config.runtime || "device");
    if (runtime === "viewer") return null;
    const platform = browserPlatform();
    const mobile = platform === "ios" || platform === "android";
    const client = mobile ? "mobile" : runtime === "cloud" ? "cloud" : config.desktopApp === true ? "desktop" : "web";
    const configuredPlatform = String(config.clientPlatform || "").toLowerCase();
    const reportedPlatform = mobile ? platform : new Set(["darwin", "win32", "linux"]).has(configuredPlatform)
      ? ({ darwin:"macos", win32:"windows", linux:"linux" })[configuredPlatform]
      : platform === "unknown" && runtime === "cloud" ? "web" : platform;
    const version = String(config.clientVersion || (runtime === "cloud" ? "cloud" : "unknown")).trim();
    const safeVersion = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,47}$/.test(version) ? version : "unknown";
    const origin = runtime === "cloud" ? location.origin : String(config.cloudOrigin || "https://penecho.ai");
    return { client, platform:reportedPlatform, version:safeVersion, origin };
  }

  function requestLogo() {
    try {
      const details = metadata();
      if (!details || document.visibilityState !== "visible") return;
      const url = new URL("/a/p.png", details.origin);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) return;
      const day = new Date().toISOString().slice(0, 10);
      const sentValue = `${day}|${details.client}|${details.platform}|${details.version}|${url.origin}`;
      try {
        if (localStorage.getItem(SENT_KEY) === sentValue) return;
        localStorage.setItem(SENT_KEY, sentValue);
      } catch {
        // Storage is optional; the Cloud endpoint still deduplicates the installation.
      }
      url.search = new URLSearchParams({ c:details.client, p:details.platform, v:details.version, i:installationId() }).toString();
      const image = document.createElement("img");
      image.hidden = true;
      image.width = 1;
      image.height = 1;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.fetchPriority = "low";
      let cleanupTimer = 0;
      const cleanup = () => {
        clearTimeout(cleanupTimer);
        try { image.remove(); } catch {}
      };
      image.addEventListener("load", cleanup, { once:true });
      image.addEventListener("error", cleanup, { once:true });
      image.src = url.toString();
      (document.body || document.documentElement)?.appendChild(image);
      cleanupTimer = setTimeout(cleanup, 30_000);
    } catch {
      // Anonymous activity collection must never affect the Canvas.
    }
  }

  function scheduleActivityLogo() {
    try {
      const enqueue = () => {
        try {
          if (typeof requestIdleCallback === "function") requestIdleCallback(requestLogo, { timeout:15_000 });
          else setTimeout(requestLogo, 0);
        } catch {}
      };
      const visible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", visible);
        enqueue();
      };
      if (document.visibilityState !== "visible") document.addEventListener("visibilitychange", visible);
      else if (document.readyState === "complete") enqueue();
      else window.addEventListener("load", enqueue, { once:true });
    } catch {
      // Scheduling is strictly best-effort.
    }
  }

  scheduleActivityLogo();
})();
