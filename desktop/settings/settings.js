"use strict";

const desktop = window.penechoDesktop;
const form = document.getElementById("settingsForm");
const submitButton = document.getElementById("submitButton");
const statusBox = document.getElementById("statusBox");
const statusTitle = document.getElementById("statusTitle");
const statusMessage = document.getElementById("statusMessage");
const statusSymbol = statusBox.querySelector(".status-symbol");
const statusAction = document.getElementById("statusAction");
const savedKeyBadge = document.getElementById("savedKeyBadge");
const cliButtons = [...document.querySelectorAll("[data-install-cli]")];
const lanAccessHint = document.getElementById("lanAccessHint");
const lanAccessAddresses = document.getElementById("lanAccessAddresses");
const lanAccessHelp = document.getElementById("lanAccessHelp");
const copyLanAddress = document.getElementById("copyLanAddress");
let currentLanguage = localStorage.getItem("penecho-setup-language") === "zh" ? "zh" : "en";
let statusActionHandler = null;
let activeProvider = "api";
let detectedLanHosts = [];
let displayedLanUrls = [];

const API_FIELDS = ["apiFormat", "apiUrl", "apiModel", "apiKey"];
const apiDrafts = {
  api:{ apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt-5.6-sol", apiKey:"" },
  kimi:{ apiFormat:"openai", apiUrl:"https://api.kimi.com/coding/v1", apiModel:"k3", apiKey:"" },
};
const KIMI_ENDPOINTS = Object.freeze({
  code:Object.freeze({ openai:"https://api.kimi.com/coding/v1", anthropic:"https://api.kimi.com/coding" }),
  platform:Object.freeze({ china:"https://api.moonshot.cn/v1", global:"https://api.moonshot.ai/v1" }),
});
const KIMI_MODELS = Object.freeze({ code:"k3", platform:"kimi-k3" });
const KIMI_PRESET_ENDPOINTS = new Set([
  ...Object.values(KIMI_ENDPOINTS.code),
  ...Object.values(KIMI_ENDPOINTS.platform),
]);
const KIMI_PRESET_MODELS = new Set(Object.values(KIMI_MODELS));

const translations = {
  zh:{
    eyebrow:"几分钟内连接 AI 画布", title:"设置你的 AI 连接", subtitle:"PenEcho 在本机运行。选择 AI 模型来源，测试一次，然后就可以开始创作。",
    stepOneTitle:"选择模型来源", stepOneBody:"对大多数用户，API 是最简单的选择。", stepTwoTitle:"本地测试", stepTwoBody:"API Key 保存在仅当前用户可读的本地凭据文件中。", stepThreeTitle:"在画布上创作", stepThreeBody:"书写或绘画，让 AI 直接以视觉内容回应。",
    localTitle:"本地桌面服务", localBody:"画布保留在你的电脑中，模型请求只发送给你选择的服务商。", configuration:"配置", settingsTitle:"连接你的模型", providerLegend:"AI 模型来源",
    apiTitle:"API", apiDescription:"推荐 · 无需安装命令行工具", recommended:"推荐", kimiDescription:"2026 开源合作伙伴 · Kimi K3", kimiCliDescription:"使用本机 Kimi Code 登录", codexDescription:"自动安装或使用已有账户", claudeDescription:"自动安装或使用已有账户",
    kimiPartnerTitle:"PenEcho 是 Kimi 2026 开源合作伙伴", otherProviders:"其他模型来源", kimiCodeLink:"Kimi Code", kimiChinaLink:"中国大陆", kimiGlobalLink:"全球", kimiOffering:"Kimi 服务", kimiRegion:"访问区域", kimiCodeOption:"Kimi Code · 订阅制", kimiPlatformOption:"开放平台 · 按量付费", globalOption:"全球", chinaOption:"中国大陆",
    apiType:"API 类型", model:"模型", baseUrl:"API 地址", apiKey:"API Key", savedLocally:"已保存在本机", apiKeyHelp:"保存在仅当前用户可读的本地凭据文件中，不会暴露给画布页面。",
    kimiCliRequired:"使用你已有的 Kimi Code CLI 登录状态。", kimiCliInstallHelp:"PenEcho 可以安装官方 Kimi Code CLI，并使用它已有的登录状态。", installGuide:"安装说明", codexRequired:"通过 Codex CLI 使用你现有的 ChatGPT 登录状态。", codexInstallHelp:"PenEcho 会安装官方 CLI，并直接使用你已有的登录状态。", claudeRequired:"通过 Claude Code 使用你现有的 Anthropic 登录状态。", claudeInstallHelp:"PenEcho 会安装官方稳定版 CLI，并直接使用你已有的登录状态。", install:"安装", modelOptional:"模型（可选）", pathOptional:"可执行文件路径（可选）",
    effort:"推理强度", imageFormat:"画布图片格式", advanced:"高级设置", advancedHelp:"网络、超时和诊断", timeout:"模型超时（秒）", autoDelay:"自动 AI 延迟（秒）", port:"本地端口", network:"网络访问",
    canvasAgentAutoOpen:"打开画布时自动打开 PenEcho Agent", canvasAgentAutoOpenHelp:"关闭后可以专心画画，需要时仍可手动打开 Agent。",
    lanAccessTitle:"在其他设备上打开 PenEcho", lanAccessHelp:"在连接同一可信网络的设备上使用以下地址，并保持 PenEcho 运行。", lanDynamicPort:"启动后系统会选择端口，并显示最终的局域网地址。", noLanAddress:"暂未检测到局域网地址。连接网络后，启动时会显示最终地址。", copyAddress:"复制地址",
    recordRequests:"记录完整 AI 请求详情", recordWarning:"用于调试，记录中可能包含私密画布内容。", keepRecords:"保留", records:"条", help:"设置帮助", submit:"测试、保存并启动", settingsStored:"设置文件：",
    testing:"正在测试连接", testingBody:"正在本地保存设置并检查模型连接……", testTimedOut:"连接测试已超时", testTimedOutBody:"设置已保存。连接测试超过 30 秒，你仍然可以启动 PenEcho 进入画布。", installing:"正在安装", installingBody:"正在从官方来源下载并校验，请稍候……", installed:"安装完成", checkingExistingSession:"正在检查现有账户登录状态……", installFailed:"自动安装未完成", success:"连接成功", launching:"PenEcho 即将启动。", savedTestFailed:"设置已保存，但连接测试失败", launchAnyway:"仍然启动", launchingSaved:"正在使用已保存的设置启动 PenEcho……", failed:"尚未连接", unexpected:"无法打开桌面设置接口。",
  },
};

function translate() {
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.dataset.english ||= element.textContent;
    const value = currentLanguage === "en" ? element.dataset.english : translations[currentLanguage]?.[element.dataset.i18n];
    if (value) element.textContent = value;
  }
  for (const button of document.querySelectorAll("[data-language]")) button.classList.toggle("active", button.dataset.language === currentLanguage);
}

function setStatus(kind, title, message, action = null) {
  statusBox.hidden = false;
  statusBox.className = `status-box ${kind}`;
  statusTitle.textContent = title;
  statusMessage.textContent = message;
  statusSymbol.textContent = kind === "success" ? "✓" : ["error", "warning"].includes(kind) ? "!" : "";
  statusActionHandler = action?.handler || null;
  statusAction.hidden = !action;
  statusAction.textContent = action?.label || "";
}

function setBusy(busy) {
  submitButton.disabled = busy;
  for (const button of cliButtons) button.disabled = busy;
}

function provider() {
  return form.elements.provider.value;
}

function updateProviderPanels() {
  const selected = provider();
  for (const panel of document.querySelectorAll("[data-provider-panel]")) panel.hidden = !panel.dataset.providerPanel.split(/\s+/).includes(selected);
  for (const element of document.querySelectorAll("[data-kimi-only]")) element.hidden = selected !== "kimi";
  updateApiFormatAvailability();
}

function updateLanAccessHint() {
  const enabled = value("host") === "0.0.0.0", port = Number(value("port"));
  lanAccessHint.hidden = !enabled;
  if (!enabled) return;
  displayedLanUrls = Number.isInteger(port) && port > 0 && port <= 65535
    ? detectedLanHosts.map(host => `http://${host}:${port}/`)
    : [];
  const fallback = port === 0
    ? (translations[currentLanguage]?.lanDynamicPort || "The system will choose a port at launch and show the final LAN address.")
    : (translations[currentLanguage]?.noLanAddress || "No LAN address is detected yet. The final address will be shown at launch.");
  lanAccessAddresses.textContent = displayedLanUrls.join("\n");
  lanAccessAddresses.hidden = displayedLanUrls.length === 0;
  lanAccessHelp.textContent = displayedLanUrls.length ? (translations[currentLanguage]?.lanAccessHelp || lanAccessHelp.dataset.english) : fallback;
  copyLanAddress.hidden = displayedLanUrls.length === 0;
}

function value(name) {
  return form.elements[name]?.value ?? "";
}

function payload() {
  return {
    provider:provider(),
    apiFormat:value("apiFormat"), apiUrl:value("apiUrl"), apiModel:value("apiModel"), apiKey:value("apiKey"),
    kimiProduct:value("kimiProduct"), kimiRegion:value("kimiRegion"), kimiCliModel:value("kimiCliModel"), kimiCliPath:value("kimiCliPath"),
    codexModel:value("codexModel"), codexPath:value("codexPath"), claudeModel:value("claudeModel"), claudePath:value("claudePath"),
    effort:value("effort"), imageFormat:value("imageFormat"), timeout:value("timeout"), autoDelay:value("autoDelay"),
    canvasAgentAutoOpen:form.elements.canvasAgentAutoOpen.checked,
    host:value("host"), port:value("port"), requestTrace:form.elements.requestTrace.checked, traceLimit:value("traceLimit"),
  };
}

function assign(name, value) {
  if (form.elements[name] && value !== undefined && value !== null) form.elements[name].value = String(value);
}

function captureApiDraft(name) {
  if (!["api", "kimi"].includes(name)) return;
  apiDrafts[name] = Object.fromEntries(API_FIELDS.map(field => [field, value(field)]));
}

function restoreApiDraft(name) {
  const draft = apiDrafts[name];
  if (!draft) return;
  for (const field of API_FIELDS) assign(field, draft[field]);
}

function updateApiFormatAvailability() {
  const anthropicOption = form.elements.apiFormat.querySelector('option[value="anthropic"]'),
    kimiPlatform = provider() === "kimi" && value("kimiProduct") === "platform";
  anthropicOption.disabled = kimiPlatform;
  if (kimiPlatform && value("apiFormat") === "anthropic") assign("apiFormat", "openai");
}

function updateKimiEndpoint(updateUrl = true, updateModel = false) {
  const product = value("kimiProduct") || "code", region = value("kimiRegion") || "global";
  updateApiFormatAvailability();
  if (updateUrl) {
    const endpoint = product === "code" ? KIMI_ENDPOINTS.code[value("apiFormat") || "openai"] : KIMI_ENDPOINTS.platform[region];
    assign("apiUrl", endpoint);
  }
  if (updateModel) assign("apiModel", KIMI_MODELS[product]);
}

function repairKimiPreset() {
  const currentUrl = value("apiUrl").trim().replace(/\/+$/, ""),
    currentModel = value("apiModel").trim();
  updateKimiEndpoint(!currentUrl || KIMI_PRESET_ENDPOINTS.has(currentUrl), !currentModel || KIMI_PRESET_MODELS.has(currentModel));
}

function changeProvider() {
  const selected = provider();
  captureApiDraft(activeProvider);
  activeProvider = selected;
  if (["api", "kimi"].includes(selected)) restoreApiDraft(selected);
  updateProviderPanels();
  if (selected === "kimi") repairKimiPreset();
}

async function initialize() {
  translate();
  if (!desktop) {
    setStatus("error", translations[currentLanguage]?.failed || "Desktop setup unavailable", translations[currentLanguage]?.unexpected || "The secure desktop bridge is unavailable.");
    submitButton.disabled = true;
    return;
  }
  try {
    const settings = await desktop.getSettings();
    detectedLanHosts = Array.isArray(settings.lanHosts) ? settings.lanHosts : [];
    document.getElementById("versionLabel").textContent = `Desktop v${settings.version}`;
    document.getElementById("configPath").textContent = settings.configFile;
    const selected = form.querySelector(`input[name="provider"][value="${CSS.escape(settings.provider)}"]`) || form.elements.provider[0];
    selected.checked = true;
    for (const name of ["apiFormat","apiUrl","apiModel","kimiProduct","kimiRegion","kimiCliModel","kimiCliPath","codexModel","codexPath","claudeModel","claudePath","effort","imageFormat","timeout","autoDelay","host","port","traceLimit"]) assign(name, settings[name]);
    form.elements.canvasAgentAutoOpen.checked = settings.canvasAgentAutoOpen !== false;
    form.elements.requestTrace.checked = settings.requestTrace === true;
    savedKeyBadge.hidden = !settings.apiKeySaved;
    form.elements.apiKey.placeholder = settings.apiKeySaved ? "Leave blank to keep saved key" : "Paste your API key";
    activeProvider = settings.provider;
    updateProviderPanels();
    if (activeProvider === "kimi") repairKimiPreset();
    if (["api", "kimi"].includes(activeProvider)) captureApiDraft(activeProvider);
    updateLanAccessHint();
  } catch (error) {
    setStatus("error", "Setup could not load", error.message || String(error));
    submitButton.disabled = true;
  }
}

for (const radio of form.elements.provider) radio.addEventListener("change", changeProvider);
form.elements.host.addEventListener("change", updateLanAccessHint);
form.elements.port.addEventListener("input", updateLanAccessHint);
form.elements.kimiProduct.addEventListener("change", () => updateKimiEndpoint(true, true));
form.elements.kimiRegion.addEventListener("change", () => updateKimiEndpoint(true));
form.elements.apiFormat.addEventListener("change", () => { if (provider() === "kimi") updateKimiEndpoint(true); });
for (const button of document.querySelectorAll("[data-language]")) button.addEventListener("click", () => {
  currentLanguage = button.dataset.language;
  localStorage.setItem("penecho-setup-language", currentLanguage);
  translate();
  updateLanAccessHint();
});
copyLanAddress.addEventListener("click", () => { if (displayedLanUrls[0]) void desktop?.copyText(displayedLanUrls[0]); });
document.getElementById("helpButton").addEventListener("click", () => void desktop?.openHelp());
statusAction.addEventListener("click", () => void statusActionHandler?.());

async function testAndLaunch() {
  setBusy(true);
  setStatus("loading", translations[currentLanguage]?.testing || "Testing connection", translations[currentLanguage]?.testingBody || "Saving settings locally and checking your model…");
  try {
    const result = await desktop.saveAndTest(payload());
    if (!result.ok) {
      const selected = provider(), missingCli = ["kimi-cli", "codex-cli", "claude-cli"].includes(selected) && /not found|executable|install/i.test(result.error || ""),
        action = missingCli
          ? { label:translations[currentLanguage]?.install || "Install", handler:() => installProvider(selected) }
          : result.saved ? { label:translations[currentLanguage]?.launchAnyway || "Launch anyway", handler:launchSavedSettings } : null;
      if (result.timedOut) {
        setStatus("warning",
          translations[currentLanguage]?.testTimedOut || "Connection test timed out",
          translations[currentLanguage]?.testTimedOutBody || "Settings were saved. The connection test exceeded 30 seconds; you can still launch PenEcho and enter the canvas.",
          action);
        return;
      }
      setStatus(result.saved ? "warning" : "error", result.saved
        ? (translations[currentLanguage]?.savedTestFailed || "Settings saved; connection test failed")
        : (translations[currentLanguage]?.failed || "Connection needs attention"), result.error || "Connection test failed.", action);
      return;
    }
    setStatus("success", translations[currentLanguage]?.success || "Connection ready", `${result.message} ${translations[currentLanguage]?.launching || "PenEcho will launch now."}`);
    const launched = await desktop.launch();
    if (!launched?.ok) setStatus("error", translations[currentLanguage]?.failed || "Unable to launch", launched?.error || "Restart PenEcho to use the saved settings.");
  } catch (error) {
    setStatus("error", translations[currentLanguage]?.failed || "Connection needs attention", error.message || String(error));
  } finally { setBusy(false); }
}

async function launchSavedSettings() {
  setBusy(true);
  setStatus("loading", translations[currentLanguage]?.launching || "Launching PenEcho", translations[currentLanguage]?.launchingSaved || "Starting PenEcho with your saved settings…");
  try {
    const launched = await desktop.launch();
    if (!launched?.ok) setStatus("error", translations[currentLanguage]?.failed || "Unable to launch", launched?.error || "Restart PenEcho to use the saved settings.");
  } catch (error) {
    setStatus("error", translations[currentLanguage]?.failed || "Unable to launch", error.message || String(error));
  } finally { setBusy(false); }
}

async function installProvider(providerName) {
  setBusy(true);
  setStatus("loading", translations[currentLanguage]?.installing || "Installing", translations[currentLanguage]?.installingBody || "Downloading and verifying the official installer…");
  try {
    const result = await desktop.installCli(providerName);
    if (!result.ok) {
      setStatus("error", translations[currentLanguage]?.installFailed || "Automatic installation did not finish", result.error || "Installation failed.");
      return;
    }
    assign({
      "kimi-cli":"kimiCliPath",
      "codex-cli":"codexPath",
      "claude-cli":"claudePath",
    }[providerName], result.executable);
    setStatus("success", translations[currentLanguage]?.installed || "Installation complete", translations[currentLanguage]?.checkingExistingSession || "Checking your existing account session…");
    await testAndLaunch();
  } catch (error) {
    setStatus("error", translations[currentLanguage]?.installFailed || "Automatic installation did not finish", error.message || String(error));
  } finally { setBusy(false); }
}

for (const button of document.querySelectorAll("[data-install-cli]")) button.addEventListener("click", () => void installProvider(button.dataset.installCli));

form.addEventListener("submit", async event => {
  event.preventDefault();
  await testAndLaunch();
});

void initialize();
