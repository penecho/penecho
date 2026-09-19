/* Shared by the settings bundle and Node. Existing presets remain owned by their current paths. */
"use strict";
var PenEchoApiPresets = (() => {
  const entries = [
    ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1"],
    ["opencode-go", "OpenCode Go", "https://opencode.ai/zen/go/v1"],
    ["opencode-zen", "OpenCode Zen", "https://opencode.ai/zen/v1"],
    ["zhipu", "智谱 · China", "https://open.bigmodel.cn/api/paas/v4"],
    ["zai", "Z.AI · Global", "https://api.z.ai/api/paas/v4"],
    ["zhipu-coding", "智谱 Coding Plan · China", "https://open.bigmodel.cn/api/coding/paas/v4"],
    ["zai-coding", "Z.AI Coding Plan · Global", "https://api.z.ai/api/coding/paas/v4"],
    ["qwen-china", "Qwen · China (Beijing)", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
    ["qwen-global", "Qwen · Singapore", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ["qwen-us", "Qwen · US (Virginia)", "https://dashscope-us.aliyuncs.com/compatible-mode/v1"],
    ["deepseek", "DeepSeek", "https://api.deepseek.com/v1"],
    ["siliconflow", "SiliconFlow · China", "https://api.siliconflow.cn/v1"],
    ["siliconflow-global", "SiliconFlow · Global", "https://api.siliconflow.com/v1"],
    ["groq", "Groq", "https://api.groq.com/openai/v1"],
    ["mistral", "Mistral", "https://api.mistral.ai/v1"],
    ["xai", "xAI", "https://api.x.ai/v1"],
  ];
  const presets = Object.freeze(Object.fromEntries(entries.map(([family, label, url]) => {
    const id = `${family}-global-api`;
    return [id, Object.freeze({ id, family, label, region:"global", service:"api", format:"openai", url, model:"" })];
  })));
  function get(id) { return Object.hasOwn(presets, id || "") ? presets[id] : null; }
  function forFamily(family) { return get(`${family}-global-api`); }
  function isOpenCode(id) { return ["opencode-go-global-api", "opencode-zen-global-api"].includes(id); }
  // OpenCode exposes several protocols on one catalog. Only advertise models
  // served by the two protocols PenEcho currently implements. Never guess a
  // route for a new model family or send Responses/Gemini models to Chat.
  function openCodeFormat(model) {
    if (/^(?:claude-|minimax-|qwen)/i.test(model)) return "anthropic";
    if (/^(?:glm-|kimi-|deepseek-|mimo-|longcat-|hy\d|big-pickle$)/i.test(model)) return "openai";
    return null;
  }
  function route(connection) {
    const preset = get(connection.apiPreset);
    if (!preset || !isOpenCode(preset.id)) return connection;
    const apiFormat = openCodeFormat(connection.apiModel || "");
    if (!apiFormat) throw new Error("This OpenCode model requires an unsupported protocol. Load models and choose a supported model.");
    const url = String(connection.apiUrl || preset.url).replace(/\/+$/, "");
    if (![preset.url, `${preset.url}/messages`, `${preset.url}/chat/completions`].includes(url)) {
      throw new Error("Use the preset OpenCode base URL, or choose a custom API format for another endpoint.");
    }
    return { ...connection, apiFormat, apiUrl:apiFormat === "anthropic" ? `${preset.url}/messages` : preset.url };
  }
  function editorUrl(connection) {
    const preset = get(connection.apiPreset);
    if (preset && isOpenCode(preset.id) && [`${preset.url}/messages`, `${preset.url}/chat/completions`].includes(connection.apiUrl)) return preset.url;
    return connection.apiUrl;
  }
  return Object.freeze({ presets, get, forFamily, isOpenCode, openCodeFormat, route, editorUrl, maxModels:4096 });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoApiPresets;
