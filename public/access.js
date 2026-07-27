"use strict";

(() => {
  const COPY = {
    en: {
      localCanvas:"Local Canvas", kicker:"LOCAL ACCESS", checkingTitle:"Checking this PenEcho server", checkingBody:"Confirming how this Canvas is protected.", checking:"Checking access...",
      setupTitle:"Protect this PenEcho server", setupBody:"Choose how every browser and device may access this running PenEcho instance.", scopeTitle:"Instance-wide protection", scopeBody:"This is not a code for only this browser. Once set, the same code is required by every browser and device that opens this running PenEcho instance. It helps prevent unauthorized people on your local network from accessing the Canvas.", setCode:"Set a 6-digit security code", setCodeHelp:"One shared code will protect this server from every new local-network visitor.", continueOpen:"Continue without a code", continueOpenHelp:"Anyone on this local network may be able to open this Canvas.",
      forgotLead:"A forgotten code is not a problem.", forgotCode:"Forgot the code?", restartHelp:"Restart PenEcho to clear it. Your Canvas files and settings are not affected.", enterTitle:"Enter your security code", enterBody:"Use the shared code for this running PenEcho server.", createTitle:"Create a security code", createBody:"Choose six digits for every device that opens this PenEcho server. The code is submitted as soon as the sixth digit is entered.", unlockStep:"6-digit code",
      back:"Back", clear:"Clear", openRiskTitle:"This Canvas will be open on your local network", openRiskBody:"Other people on the same network may be able to open the Canvas, use its configured AI provider, and manage local plugins.", confirmOpen:"Keep open on this LAN",
      wrong:"That security code is not correct.", tooMany:"Too many attempts. Try again in {seconds} seconds.", failed:"PenEcho could not update local access. Try again.", unavailableTitle:"This PenEcho server is unavailable", unavailableBody:"Check the local connection, then try again.", retry:"Retry",
    },
    zh: {
      localCanvas:"本地画布", kicker:"本地访问", checkingTitle:"正在检查这台 PenEcho", checkingBody:"正在确认这张画布采用的访问保护方式。", checking:"正在检查访问状态…",
      setupTitle:"保护这台 PenEcho 服务器", setupBody:"请选择所有浏览器和设备访问当前运行中 PenEcho 实例的方式。", scopeTitle:"实例级保护", scopeBody:"这不是仅针对当前浏览器的安全码。设置后，所有访问当前运行中 PenEcho 实例的浏览器和设备都必须使用同一个安全码，用于防止局域网内未经许可的人访问画布。", setCode:"设置 6 位安全码", setCodeHelp:"这是当前实例共用的安全码，所有新的局域网访问者都需要输入。", continueOpen:"不设置安全码", continueOpenHelp:"同一局域网中的任何设备都可能直接打开这张画布。",
      forgotLead:"忘记安全码也没关系。", forgotCode:"忘记安全码？", restartHelp:"重新启动 PenEcho 即可清除。画布文件和设置不会受到影响。", enterTitle:"输入安全码", enterBody:"请输入当前运行中 PenEcho 实例共用的安全码。", createTitle:"创建安全码", createBody:"请为所有访问这台 PenEcho 的设备设置 6 位数字。输入第六位后会立即提交。", unlockStep:"6 位安全码",
      back:"返回", clear:"清除", openRiskTitle:"这张画布将向局域网开放", openRiskBody:"同一网络中的其他人可能可以打开画布、使用已配置的 AI 服务，并管理本地插件。", confirmOpen:"本次在局域网保持开放",
      wrong:"安全码不正确。", tooMany:"尝试次数过多，请在 {seconds} 秒后重试。", failed:"PenEcho 无法更新本地访问设置，请重试。", unavailableTitle:"无法连接这台 PenEcho", unavailableBody:"请检查本地连接后重试。", retry:"重试",
    },
  };

  const $ = (selector) => document.querySelector(selector),
    title=$("#accessTitle"),description=$("#accessDescription"),loading=$("#accessLoading"),setup=$("#accessSetup"),pinView=$("#accessPin"),risk=$("#accessRisk"),errorBox=$("#accessError"),retryButton=$("#accessRetry"),dots=[...document.querySelectorAll("#accessPinDots i")],pinStep=$("#accessPinStep"),backButton=$("#accessPinBack");
  let language=localStorage.getItem("penecho-language")==="zh"?"zh":"en",flow="unlock",entry="",busy=false,cooldownTimer=0,cooldownUntil=0;

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
    dots.forEach((dot,index)=>dot.classList.toggle("filled",index<entry.length));
  }
  function renderPinCopy() {
    if(pinView.hidden)return;
    if(flow==="unlock") { setHeading("enterTitle","enterBody");pinStep.textContent=text("unlockStep"); }
    else { setHeading("createTitle","createBody");pinStep.textContent=text("unlockStep"); }
  }
  function beginPin(nextFlow) {
    flow=nextFlow;entry="";backButton.hidden=nextFlow==="unlock";show(pinView);renderPinCopy();renderEntry();
    document.querySelector("#accessKeypad button[data-digit]")?.focus();
  }
  function addDigit(digit) {
    if(busy||Date.now()<cooldownUntil||entry.length>=6)return;
    entry+=digit;errorBox.hidden=true;renderEntry();
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
  function enterCanvas() { window.location.replace("/"); }
  async function submitPin() {
    if(entry.length!==6||busy)return;
    busy=true;renderEntry();
    try {
      if(flow==="setup")await request("/api/local-access/setup-pin",{pin:entry,confirmation:entry});
      else await request("/api/local-access/unlock",{pin:entry});
      enterCanvas();
    } catch(error) {
      entry="";
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
  applyLanguage();loadStatus();
})();
