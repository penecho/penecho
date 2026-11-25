"use strict";

(() => {
  const COPY = {
    en: {
      language:"Language", checkingTitle:"Opening PenEcho", checkingBody:"", checking:"One moment…",
      setupTitle:"Who can open PenEcho?", setupBody:"PenEcho can be opened on other devices on this network, such as a tablet.", setCode:"Set a 6-digit code", setCodeHelp:"Other devices type it once.", continueOpen:"No code", continueOpenHelp:"Anyone on this network can open PenEcho.",
      forgotCode:"No code at hand?", restartHelp:"Scan the QR code shown beside it.", enterTitle:"Enter the code", enterBody:"On the computer running PenEcho, open Settings (gear at the bottom of the Projects sidebar) → General → Other devices → Open to find the code.", createTitle:"Choose a code", createBody:"Six digits. Other devices type it once.", unlockStep:"6-digit code",
      back:"Back", clear:"Clear", openRiskTitle:"Open to everyone on this network?", openRiskBody:"Anyone on the same network can open your Canvases and projects and use your AI.", confirmOpen:"Open without a code",
      wrong:"That code is not right.", tooMany:"Too many tries. Try again in {seconds} seconds.", failed:"That did not work. Try again.", unavailableTitle:"PenEcho is not answering", unavailableBody:"Check that PenEcho is running, then try again.", retry:"Try again",
    },
    zh: {
      language:"语言", checkingTitle:"正在打开 PenEcho", checkingBody:"", checking:"请稍候…",
      setupTitle:"谁可以打开 PenEcho？", setupBody:"同一网络中的其他设备（比如平板）也可以打开 PenEcho。", setCode:"设置 6 位安全码", setCodeHelp:"其他设备只需输入一次。", continueOpen:"不设安全码", continueOpenHelp:"同一网络中的任何人都能打开 PenEcho。",
      forgotCode:"手边没有安全码？", restartHelp:"扫描它旁边显示的二维码即可。", enterTitle:"输入安全码", enterBody:"请在运行 PenEcho 的电脑上打开 Projects 侧栏底部的 Settings（齿轮）→ General → Other devices → Open，查看安全码。", createTitle:"设置安全码", createBody:"六位数字，其他设备只需输入一次。", unlockStep:"6 位安全码",
      back:"返回", clear:"清除", openRiskTitle:"向此网络中的所有人开放？", openRiskBody:"同一网络中的任何人都能打开你的画布和项目，并使用你的 AI。", confirmOpen:"不设安全码并打开",
      wrong:"安全码不正确。", tooMany:"尝试次数过多，请在 {seconds} 秒后重试。", failed:"没有成功，请重试。", unavailableTitle:"PenEcho 没有响应", unavailableBody:"请确认 PenEcho 正在运行，然后重试。", retry:"重试",
    },
  };

  const DEFAULT_STUDIO_PALETTE = "teal",
    REMOVED_THEMES = new Set(["arcane", "scifi", "research"]),
    STUDIO_PALETTES = new Set(["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"]),
    THEME_COLORS = { indigo:"#f8f8f9", graphite:"#f8f8f8", cobalt:"#f7f9fc", azure:"#f6fafc", teal:"#f6faf9", forest:"#f7faf7", amber:"#faf8f5", burgundy:"#faf7f8" };

  const $ = (selector) => document.querySelector(selector),
    title=$("#accessTitle"),description=$("#accessDescription"),loading=$("#accessLoading"),setup=$("#accessSetup"),pinView=$("#accessPin"),risk=$("#accessRisk"),errorBox=$("#accessError"),retryButton=$("#accessRetry"),dots=[...document.querySelectorAll("#accessPinDots i")],pinStep=$("#accessPinStep"),backButton=$("#accessPinBack");
  let language=localStorage.getItem("penecho-language")==="zh"?"zh":"en",flow="unlock",entry="",busy=false,cooldownTimer=0,cooldownUntil=0;

  function applyAppearance() {
    const storedTheme=localStorage.getItem("penecho-theme")||localStorage.getItem("ghostboard-theme"),
      storedPalette=localStorage.getItem("penecho-studio-palette"),
      removedTheme=REMOVED_THEMES.has(storedTheme),
      palette=removedTheme?DEFAULT_STUDIO_PALETTE:STUDIO_PALETTES.has(storedPalette)?storedPalette:DEFAULT_STUDIO_PALETTE;
    if(removedTheme){localStorage.setItem("penecho-theme","studio");localStorage.setItem("penecho-studio-palette",palette);}
    document.documentElement.dataset.theme="studio";
    document.documentElement.dataset.studioPalette=palette;
    document.body.dataset.theme="studio";
    document.body.dataset.studioPalette=palette;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",THEME_COLORS[palette]);
  }

  function text(key, values={}) {
    let value=COPY[language][key]||COPY.en[key]||key;
    for(const [name,replacement] of Object.entries(values))value=value.replace(`{${name}}`,String(replacement));
    return value;
  }
  function applyLanguage() {
    document.documentElement.lang=language==="zh"?"zh-CN":"en";
    document.querySelectorAll("[data-copy]").forEach(node=>{node.textContent=text(node.dataset.copy);});
    document.querySelectorAll("[data-copy-aria]").forEach(node=>node.setAttribute("aria-label",text(node.dataset.copyAria)));
    document.querySelectorAll("[data-copy-title]").forEach(node=>node.setAttribute("title",text(node.dataset.copyTitle)));
    document.querySelectorAll("[data-language]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.language===language)));
    renderPinCopy();
  }
  function show(view) {
    for(const node of [loading,setup,pinView,risk])node.hidden=node!==view;
    errorBox.hidden=true;retryButton.hidden=true;
  }
  function setHeading(titleKey,bodyKey) {
    title.textContent=text(titleKey);description.textContent=text(bodyKey);
  }
  function showError(message) { errorBox.textContent=message;errorBox.hidden=false; }
  function renderEntry() {
    dots.forEach((dot,index)=>{dot.classList.toggle("filled",index<entry.length);dot.classList.toggle("now",!busy&&index===entry.length);});
  }
  function renderPinCopy() {
    if(pinView.hidden)return;
    if(flow==="unlock") { setHeading("enterTitle","enterBody");pinStep.textContent=text("unlockStep"); }
    else { setHeading("createTitle","createBody");pinStep.textContent=text("unlockStep"); }
  }
  function beginPin(nextFlow) {
    flow=nextFlow;entry="";backButton.hidden=nextFlow==="unlock";show(pinView);renderPinCopy();renderEntry();
  }
  function addDigit(digit) {
    if(busy||Date.now()<cooldownUntil||entry.length>=6)return;
    entry+=digit;errorBox.hidden=true;pinView.classList.toggle("wrong",false);renderEntry();
    if(entry.length===6)submitPin();
  }
  function removeDigit() { if(!busy&&entry.length){entry=entry.slice(0,-1);renderEntry();} }
  function clearEntry() { if(!busy){entry="";renderEntry();} }
  async function request(path,payload) {
    const response=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body.error||text("failed")),{status:response.status,cooldownSeconds:Number(body.cooldownSeconds||0)});
    if(typeof body.accessSessionToken==="string"&&body.accessSessionToken)sessionStorage.setItem("penecho-access-session",body.accessSessionToken);
    return body;
  }
  // The server shows this form in place of /projects.html, at that same address. Going to the same address with a # in it only moves within the page, so it has to reload.
  function enterCanvas() {
    if (window.location.pathname === "/projects.html") { window.location.reload(); return; }
    window.location.replace(window.location.search.includes("linesProject=") ? `/${window.location.search}` : "/");
  }
  async function submitPin() {
    if(entry.length!==6||busy)return;
    busy=true;renderEntry();
    try {
      if(flow==="setup")await request("/api/local-access/setup-pin",{pin:entry,confirmation:entry});
      else await request("/api/local-access/unlock",{pin:entry});
      pinView.classList.toggle("ok",true);
      enterCanvas();
    } catch(error) {
      entry="";pinView.classList.toggle("wrong",true);
      if(error.status===429&&error.cooldownSeconds)startCooldown(error.cooldownSeconds);
      else showError(error.status===401?text("wrong"):error.message||text("failed"));
    } finally { busy=false;renderEntry(); }
  }
  function startCooldown(seconds) {
    clearInterval(cooldownTimer);
    let remaining=Math.max(1,Math.ceil(seconds));
    cooldownUntil=Date.now()+remaining*1000;
    showError(text("tooMany",{seconds:remaining}));
    cooldownTimer=setInterval(()=>{remaining-=1;if(remaining<=0){clearInterval(cooldownTimer);cooldownUntil=0;errorBox.hidden=true;renderEntry();}else showError(text("tooMany",{seconds:remaining}));},1000);
  }
  async function loadStatus() {
    show(loading);setup.querySelector(".access-choice-list").hidden=false;setHeading("checkingTitle","checkingBody");
    try {
      const response=await fetch("/api/local-access/status",{credentials:"same-origin",cache:"no-store"}),status=await response.json();
      if(!response.ok)throw new Error(status.error||text("failed"));
      if(typeof status.accessSessionToken==="string"&&status.accessSessionToken)sessionStorage.setItem("penecho-access-session",status.accessSessionToken);
      if(status.unlocked)return enterCanvas();
      if(status.mode==="pin") { beginPin("unlock");if(status.cooldownSeconds)startCooldown(status.cooldownSeconds);return; }
      show(setup);setHeading("setupTitle","setupBody");
    } catch {
      show(setup);setHeading("unavailableTitle","unavailableBody");setup.querySelector(".access-choice-list").hidden=true;showError(text("failed"));retryButton.hidden=false;
    }
  }

  document.querySelectorAll("[data-language]").forEach(button=>button.addEventListener("click",()=>{language=button.dataset.language;localStorage.setItem("penecho-language",language);applyLanguage();}));
  $("#accessChoosePin").addEventListener("click",()=>beginPin("setup"));
  $("#accessChooseOpen").addEventListener("click",()=>{show(risk);setHeading("openRiskTitle","openRiskBody");});
  $("#accessRiskBack").addEventListener("click",()=>{show(setup);setHeading("setupTitle","setupBody");});
  backButton.addEventListener("click",()=>{show(setup);setHeading("setupTitle","setupBody");});
  $("#accessConfirmOpen").addEventListener("click",async()=>{if(busy)return;busy=true;try{await request("/api/local-access/open",{acknowledgeRisk:true});enterCanvas();}catch(error){showError(error.message||text("failed"));busy=false;}});
  retryButton.addEventListener("click",loadStatus);
  $("#accessKeypad").addEventListener("click",event=>{const button=event.target.closest("button");if(!button)return;if(button.dataset.digit)addDigit(button.dataset.digit);if(button.dataset.action==="backspace")removeDigit();if(button.dataset.action==="clear")clearEntry();});
  document.addEventListener("keydown",event=>{if(pinView.hidden)return;if(/^\d$/.test(event.key)){event.preventDefault();addDigit(event.key);}else if(event.key==="Backspace"){event.preventDefault();removeDigit();}else if(event.key==="Delete"){event.preventDefault();clearEntry();}else if(event.key==="Enter"){event.preventDefault();submitPin();}});
  // A code copied from somewhere is typed for you.
  document.addEventListener("paste",event=>{if(pinView.hidden)return;const digits=String(event.clipboardData?.getData("text")||"").replace(/\D/g,"").slice(0,6);if(!digits)return;event.preventDefault();clearEntry();for(const digit of digits)addDigit(digit);});
  window.addEventListener?.("storage",event=>{if(event.key==="penecho-theme"||event.key==="penecho-studio-palette")applyAppearance();});
  applyAppearance();applyLanguage();loadStatus();
})();
