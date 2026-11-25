"use strict";
// Settings → Other devices, on the computer that runs PenEcho: the switch, the address and its QR code, the code, New code,
// Without a code, and how many devices are remembered. It reads and changes /api/local-access/network (this computer only).
(() => {
  const COPY = {
    en: { back:"Back", title:"Other devices", lead:"Open PenEcho on a tablet or phone on this network.", away:"Open this page on the computer that runs PenEcho.", on:"On this network",
      locked:"Typing the code is locked after too many wrong tries. Make a new code.", noAddress:"This computer has no address on a network right now.", copy:"Copy", copied:"Copied",
      newCode:"New code", noCode:"Without a code", risk:"Anyone on this network can open your Canvases and projects and use your AI.", riskYes:"Turn on", cancel:"Cancel",
      count:n => n === 0 ? "" : n === 1 ? "1 device remembered" : `${n} devices remembered`, failed:"That did not work. Try again." },
    zh: { back:"返回", title:"其他设备", lead:"在同一网络的平板或手机上打开 PenEcho。", away:"请在运行 PenEcho 的电脑上打开此页面。", on:"在此网络中开放",
      locked:"输错次数过多，安全码已锁定。请生成新的安全码。", noAddress:"这台电脑当前没有网络地址。", copy:"复制", copied:"已复制",
      newCode:"新安全码", noCode:"不需要安全码", risk:"同一网络中的任何人都能打开你的画布和项目，并使用你的 AI。", riskYes:"开启", cancel:"取消",
      count:n => n === 0 ? "" : `已记住 ${n} 台设备`, failed:"没有成功，请重试。" },
  };
  const $ = selector => document.querySelector(selector);
  let language = localStorage.getItem("penecho-language") === "zh" ? "zh" : "en", view = null, shownKey = "", keyUntil = 0, keyFor = "", busy = false;
  const text = key => COPY[language][key] ?? COPY.en[key] ?? key;
  function applyLanguage() {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-copy]").forEach(node => { node.textContent = text(node.dataset.copy); });
    document.querySelectorAll("[data-copy-aria]").forEach(node => node.setAttribute("aria-label", text(node.dataset.copyAria)));
    document.querySelectorAll("[data-copy-title]").forEach(node => node.setAttribute("title", text(node.dataset.copyTitle)));
    document.querySelectorAll("[data-language]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.language === language)));
    if (view) render();
  }
  async function call(path, body) {
    const response = await fetch(`/api/local-access/network${path}`, { method:body ? "POST" : "GET", credentials:"same-origin", cache:"no-store", headers:body ? { "Content-Type":"application/json" } : {}, ...(body ? { body:JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || text("failed")), { status:response.status });
    return data;
  }
  const fail = error => { const box = $("#devError"); box.textContent = error?.message || text("failed"); box.hidden = false; };
  // The QR carries a key that works once, for ten minutes: a new one whenever a device used it, or it is about to run out.
  async function freshKey() {
    if (!view?.on || !view.addresses.length) return;
    try {
      const { url, expiresAt } = await call("/key");
      shownKey = url; keyUntil = Number(expiresAt) || 0; keyFor = `${view.code}:${view.devices.length}`;
      $("#devQr").src = `/api/local-access/network/qr.svg?u=${encodeURIComponent(url)}`;
    } catch (error) { fail(error); }
  }
  function render() {
    $("#devBody").hidden = false; $("#devAway").hidden = true;
    $("#devOn").setAttribute("aria-checked", String(view.on));
    $("#devOpen").hidden = !view.on;
    if (!view.on) return;
    const address = view.addresses[0] || "", open = !view.askCode;
    $("#devNoAddress").hidden = Boolean(address);
    $("#devScan").hidden = !address;
    $("#devAddress").textContent = address.replace(/^https?:\/\//, "");
    $("#devLocked").hidden = !view.codeLocked || open;
    $("#devCodeBlock").hidden = open;
    [...$("#devCode").children].forEach((cell, index) => { cell.textContent = view.code[index] || ""; });
    $("#devNewCode").hidden = view.codeFromEnvironment;
    $("#devNoCode").setAttribute("aria-checked", String(open));
    $("#devCount").textContent = COPY[language].count(view.devices.length);
  }
  async function load() {
    try {
      view = await call("");
      render();
      if (view.on && view.addresses.length && (!shownKey || keyFor !== `${view.code}:${view.devices.length}` || Date.now() > keyUntil - 60_000)) await freshKey();
    } catch (error) {
      if (error.status === 403) { $("#devBody").hidden = true; $("#devAway").hidden = false; }
      else fail(error);
    }
  }
  async function change(body) {
    if (busy) return;
    busy = true; $("#devError").hidden = true;
    try { view = await call("", body); shownKey = ""; render(); await freshKey(); }
    catch (error) { fail(error); }
    finally { busy = false; }
  }
  $("#devOn").addEventListener("click", () => change({ on:!view?.on }));
  $("#devNewCode").addEventListener("click", () => change({ newCode:true }));
  $("#devNoCode").addEventListener("click", () => { if (!view) return; if (view.askCode) $("#devRisk").hidden = false; else change({ askCode:true }); });
  $("#devRiskYes").addEventListener("click", () => { $("#devRisk").hidden = true; change({ askCode:false }); });
  $("#devRiskNo").addEventListener("click", () => { $("#devRisk").hidden = true; });
  $("#devAddress").addEventListener("click", async () => {
    const button = $("#devAddress"), address = view?.addresses[0];
    if (!address) return;
    try { await navigator.clipboard.writeText(address); const was = button.textContent; button.textContent = text("copied"); setTimeout(() => { button.textContent = was; }, 1200); } catch { /* It can still be read and typed. */ }
  });
  document.querySelectorAll("[data-language]").forEach(button => button.addEventListener("click", () => { language = button.dataset.language; localStorage.setItem("penecho-language", language); applyLanguage(); }));
  applyLanguage();
  load();
  setInterval(() => { if (!document.hidden && !busy) load(); }, 4000);
})();
