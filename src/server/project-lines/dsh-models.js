"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const OFFICIAL = "deepseek-official";
const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_PLUGIN = "@deepseek-ai/dsh-agent-default-model";
const DSH_PATCH_FILE = "dsh-model.patch.yml";
const OFFICIAL_MODELS = [{ id:DEFAULT_MODEL, name:"DeepSeek-V4.1-Flash" }, { id:"deepseek-v4-pro", name:"DeepSeek-V4-Pro" }];
const OFFICIAL_EFFORTS = ["off", "low", "high", "max"];
const PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const ROWS = {
  "agent-default-model": [DEFAULT_PLUGIN],
  "llm-deepseek": ["@deepseek-ai/dsh-llm-deepseek-api-key", "@deepseek-ai/dsh-llm-deepseek"],
  "llm-pi-ai": ["@deepseek-ai/dsh-llm-pi-ai"],
};
const sizes = { file:256 * 1024, catalog:2 * 1024 * 1024, files:64, choices:300 };
const snapshots = new Map();
const str = v => typeof v === "string" ? v.trim() : "";
const dict = v => v && typeof v === "object" && !Array.isArray(v) && !Object.hasOwn(v, "__jsExpr");
const entries = v => dict(v) ? Object.entries(v) : [];
const providerId = v => /^[\w.-]+$/.test(v) && !v.startsWith("-");
const modelId = v => Boolean(v && v.length <= 200 && !/^-|[\x00-\x1f\x7f]/.test(v));
const effortId = v => /^[a-z0-9][\w.-]{0,199}$/i.test(v);
const credentialRef = v => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
function validDshModel(value) {
  if (!value) return true;
  if (!modelId(value)) return false;
  const slash = value.indexOf("/");
  return slash === -1 || providerId(value.slice(0, slash)) && modelId(value.slice(slash + 1));
}
const dshHome = (env, home = env.HOME || env.USERPROFILE || os.homedir()) => path.resolve(str(env.DSH_HOME) || path.join(home, ".dsh"));

function yamlRows(text) {
  const { entryListSchema } = require("@deepseek-ai/cordis-plugin-include");
  const rows = require("js-yaml").load(text, { schema:entryListSchema });
  return Array.isArray(rows) ? rows : null;
}

function readProfile(file, limit = sizes.file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit) return { invalid:true };
    const stamp = [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
    const old = snapshots.get(file);
    if (old?.stamp === stamp) return old;
    let value = null;
    try {
      const text = fs.readFileSync(file, "utf8");
      if (Buffer.byteLength(text) <= limit) value = file.endsWith(".json") ? JSON.parse(text) : yamlRows(text);
    } catch { /* A partially written or unsupported file contributes no choices. */ }
    const saved = { stamp, value, invalid:value === null };
    if (snapshots.size >= sizes.files) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(file, saved);
    return saved;
  } catch (error) { return { invalid:error.code !== "ENOENT" }; }
}

// dsh replaces the whole config field in a patch. Read only the three model-related rows
// and bounded local data. The YAML schema parses !!js as inert expression objects.
function compose(home, profile, homeFile, homePatch) {
  const dir = path.join(home, "profiles", profile);
  const baseFile = path.join(dir, "cordis.yml"), profileFile = path.join(dir, "cordis.patch.yml");
  const manifest = readProfile(path.join(dir, "package.json"));
  const bundles = manifest.value?.dsh?.profile?.bundles;
  const shipped = profile === "headless" ? "@deepseek-ai/dsh-headless" : "@deepseek-ai/dsh-web-app";
  const knownBundles = Boolean(manifest.value && Array.isArray(bundles) && bundles.length === 2 && bundles[0] === "@deepseek-ai/dsh-base" && bundles[1] === shipped);
  const rows = new Map(knownBundles ? Object.entries(ROWS).map(([id, names]) => [id, { name:names[0] }]) : []);
  const groups = new Set();
  let from = "", understood = true, remaining = 1800;
  function visit(list, file, insert = false, depth = 0) {
    if (!Array.isArray(list)) return;
    if (depth > 10) { understood = false; return; }
    if (list.length > 600) understood = false;
    for (const row of list.slice(0, 600)) {
      if (--remaining < 0) { understood = false; return; }
      if (!dict(row)) { understood = false; continue; }
      if (!insert && row.insert) {
        // A targeted insert may depend on groups beyond the rows discovered here.
        if (row.id) understood = false;
        else visit(row.insert, file, true, depth + 1);
        continue;
      }
      const names = Object.hasOwn(ROWS, row.id) ? ROWS[row.id] : null;
      if (!names) {
        if (insert && row.group) {
          groups.add(row.id);
          if (!row.disabled) visit(row.config, file, true, depth + 1);
        } else if (!insert && (groups.has(row.id) || Array.isArray(row.config))) understood = false;
        continue;
      }
      const previous = rows.get(row.id);
      if (insert) {
        if (!names.includes(row.name)) understood = false;
        rows.set(row.id, row);
      } else if (previous && (!row.name || row.name === previous.name)) {
        rows.set(row.id, { ...previous, ...row });
      } else continue;
      if (row.id === "agent-default-model" && Object.hasOwn(row, "config")) from = file;
    }
  }
  // Bundle-based profiles load their manifest and patch list; cordis.yml is
  // only a source of legacy rows when there is no bundle manifest.
  const base = bundles ? {} : readProfile(baseFile);
  visit(base.value, baseFile, true);
  const patch = readProfile(profileFile);
  visit(patch.value, profileFile);
  visit(homePatch.value, homeFile);
  return { rows, from, canImport:knownBundles && understood && !patch.invalid && !homePatch.invalid,
    uninitialized:[manifest, base, patch, homePatch].every(file => !file.value && !file.invalid) };
}

// A configured route may rely on pi-ai's shipped catalog instead of declaring every model.
// Read just that provider's catalog data, using the bundled dependency already used by PenEcho's dsh runner.
const piCatalogs = new Map();
function piCatalog(provider) {
  if (!piCatalogs.has(provider)) {
    let models = [];
    try {
      const resolvePaths = createRequire(require.resolve("@deepseek-ai/dsh-llm-pi-ai")).resolve.paths("@earendil-works/pi-ai");
      const root = resolvePaths.find(dir => fs.existsSync(path.join(dir, "@earendil-works", "pi-ai", "package.json")));
      const data = root && readProfile(path.join(root, "@earendil-works", "pi-ai", "dist", "providers", "data", `${provider}.json`), sizes.catalog).value;
      models = entries(data).flatMap(([, family]) => entries(family).filter(([id]) => id.startsWith("chat:")).map(([, model]) => model));
    } catch { /* A route without a local list can still be typed. */ }
    if (piCatalogs.size >= sizes.files) piCatalogs.delete(piCatalogs.keys().next().value);
    piCatalogs.set(provider, models);
  }
  return piCatalogs.get(provider);
}
function piModels(provider, config) {
  const built = piCatalog(provider);
  const list = Array.isArray(config.models) && config.models.length ? config.models : built.map(model => ({ id:model.id, ...(Object.hasOwn(config.modelOverrides || {}, model.id) ? config.modelOverrides[model.id] : {}) }));
  return list.filter(dict).slice(0, sizes.choices).map(model => {
    const fallback = built.find(row => row.id === model.id);
    const levels = model.reasoningEfforts === false ? ["off"] : dict(model.reasoningEfforts) ? PI_EFFORTS.filter(level => Object.hasOwn(model.reasoningEfforts, level))
      : fallback?.reasoning ? PI_EFFORTS.filter(level => fallback.thinkingLevelMap?.[level] !== null && (PI_EFFORTS.indexOf(level) < 5 || fallback.thinkingLevelMap?.[level] !== undefined)) : ["off"];
    return { id:str(model.id), name:str(model.name) || str(fallback?.name), levels };
  });
}

function discover(env, home) {
  const root = dshHome(env, home);
  const homeFile = path.join(root, "cordis.patch.yml"), homePatch = readProfile(homeFile);
  const profiles = ["headless", "desktop", "web"].map(name => compose(root, name, homeFile, homePatch));
  const [headless] = profiles;
  const target = headless.rows.get("agent-default-model");
  const configured = target?.config;
  const provider = configured ? str(configured.provider) : OFFICIAL;
  const model = configured ? str(configured.model) : DEFAULT_MODEL;
  const defaultSelection = target && !target.disabled && target.name === DEFAULT_PLUGIN && providerId(provider) && modelId(model) ? { provider, model, effort:str(configured?.reasoningEffort) } : null;
  const providers = new Map(), models = new Map();
  function add(route, item) {
    const value = `${route}/${item.id}`;
    if (models.size < sizes.choices && modelId(item.id) && value.length <= 200 && !models.has(value)) models.set(value, { ...item, provider:route });
  }
  for (const [i, { rows }] of profiles.entries()) {
    const official = rows.get("llm-deepseek");
    if (i === 0 && !official?.disabled) {
      const config = official?.config || {};
      const list = Array.isArray(config.models) && config.models.length ? config.models : OFFICIAL_MODELS;
      for (const item of list.filter(dict).slice(0, sizes.choices)) add(OFFICIAL, { id:str(item.id), name:str(item.name), levels:config.thinking === "disabled" ? ["off"] : OFFICIAL_EFFORTS });
    }
    const pi = rows.get("llm-pi-ai");
    if (pi && !pi.disabled) for (const [route, config] of entries(pi.config?.providers).slice(0, sizes.choices)) {
      if (route === OFFICIAL || providers.has(route) || !providerId(route) || !dict(config)) continue;
      providers.set(route, { config, local:i === 0 });
      if (models.size < sizes.choices) for (const item of piModels(route, config)) add(route, item);
    }
    const row = rows.get("agent-default-model"), value = row?.config;
    if (row && !row.disabled && providerId(str(value?.provider)) && modelId(str(value?.model)) && (value.provider === OFFICIAL || providers.has(value.provider))) {
      add(value.provider, { id:value.model, name:"" });
    }
  }
  const name = defaultSelection ? `${provider}/${model}` : "";
  return { name, defaultSelection, models, providers, headless, target };
}

function resolveModel(state, name) {
  if (!name) return state.defaultSelection;
  const exact = state.models.get(name);
  if (exact) return { provider:exact.provider, model:exact.id };
  const slash = name.indexOf("/");
  if (slash !== -1) {
    const provider = name.slice(0, slash), model = name.slice(slash + 1);
    if (!providerId(provider) || !modelId(model)) throw Error("Use a dsh model name or provider/model.");
    return { provider, model };
  }
  const matches = [...state.models.values()].filter(row => row.id === name);
  const primary = state.defaultSelection?.provider;
  if (matches.some(row => row.provider === primary)) return { provider:primary, model:name };
  if (matches.length === 1) return { provider:matches[0].provider, model:name };
  if (matches.length > 1) throw Error("Several dsh providers list that model. Use provider/model.");
  return primary ? { provider:primary, model:name } : null;
}

function dshModels(env, home) {
  const state = discover(env, home);
  const { name, models } = state;
  const choices = [...new Set([name, ...models.keys()].filter(Boolean))].slice(0, sizes.choices);
  const effortsFor = new Map();
  for (const [route, model] of models) if (model.levels) effortsFor.set(route, model.levels);
  for (const { id } of models.values()) {
    if (!id.includes("/")) {
      let selected;
      try { selected = resolveModel(state, id); } catch { continue; }
      const levels = selected && effortsFor.get(`${selected.provider}/${id}`);
      if (levels) effortsFor.set(id, levels);
    }
  }
  const from = name ? state.headless.from : "";
  const official = state.headless.rows.get("llm-deepseek");
  const nativeEffort = state.defaultSelection?.provider === OFFICIAL && official && !official.disabled ? official.config?.thinking === "disabled" ? "off" : str(official.config?.reasoningEffort) || "high"
    : str(state.providers.get(state.defaultSelection?.provider)?.config.reasoning);
  return { name, effort:state.defaultSelection?.effort || nativeEffort, from:home && from.startsWith(`${home}${path.sep}`) ? `~${from.slice(home.length)}` : from,
    choices, effortsFor:Object.fromEntries(effortsFor), choiceLabels:Object.fromEntries([...models].filter(([, item]) => item.name).map(([route, item]) => [route, item.name])),
    change:"Use provider/model for a custom route. dsh uses the headless profile for its default." };
}

// The config field is replaced, so importing a provider must preserve existing headless
// routes. Do not rewrite a map whose definitions contain expressions or private headers.
const PORTABLE_FIELDS = new Set(["api", "apiKeyEnv", "baseURL", "displayName", "models", "modelOverrides", "compat", "defaultInput", "defaultContextWindow",
  "defaultMaxTokens", "reasoning", "thinkingBudgets", "cacheRetention", "transport", "timeoutMs", "websocketConnectTimeoutMs", "streamIdleTimeoutMs",
  "maxRequestImageBytes", "maxRequestImages", "imageOffloadCountQuantum", "requestImagePixelBudget", "maxRequestBytes", "retryPolicy"]);
function portableValue(value, depth = 0, budget = { left:12000 }) {
  if (depth > 12 || --budget.left < 0) return false;
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(child => portableValue(child, depth + 1, budget));
  return dict(value) && Object.entries(value).every(([key, child]) => !/key|secret|password|credential|authorization|header|token$/i.test(key) && portableValue(child, depth + 1, budget));
}
function dshCredentialRef(env, model) {
  const state = discover(env);
  let route;
  try { route = resolveModel(state, model)?.provider; } catch { return ""; }
  // The launcher initializes a new home with the shipped DeepSeek route.
  if (!model && state.headless.uninitialized) route = OFFICIAL;
  const ref = route === OFFICIAL ? str(state.headless.rows.get("llm-deepseek")?.config?.apiKeyEnv) || "DEEPSEEK_API_KEY"
    : str(state.providers.get(route)?.config.apiKeyEnv);
  return credentialRef(ref) ? ref : "";
}
function portableProvider(config, { imported = false } = {}) {
  if (!dict(config) || Object.keys(config).some(key => !PORTABLE_FIELDS.has(key))) return false;
  const { apiKeyEnv, baseURL, ...rest } = config;
  // A desktop-only route without an environment reference may depend on a stored OAuth login.
  if ((imported || apiKeyEnv !== undefined) && (typeof apiKeyEnv !== "string" || !credentialRef(apiKeyEnv))) return false;
  if (baseURL !== undefined) {
    let url;
    try { url = new URL(str(baseURL)); } catch { return false; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return false;
  }
  return portableValue(rest);
}

function dshPlan(env, model, effort, resolveDefault) {
  if (!validDshModel(model) || effort && !effortId(effort)) throw Error("Use a one-line dsh model name and a single word for effort.");
  const state = discover(env);
  const verify = !state.headless.canImport;
  if (resolveDefault) state.defaultSelection = resolveDefault(state.defaultSelection, verify);
  if (!model && !effort) return { selection:state.defaultSelection, patch:null, verify };
  if (state.target?.disabled && !verify) throw Error("Enable agent-default-model in dsh's headless profile to use a PenEcho model selection.");
  const route = resolveModel(state, model);
  if (!route) throw Error("Set a default in dsh's headless profile or enter provider/model.");
  const selection = { provider:route.provider, model:route.model, effort:effort || "" };
  const sameDefault = state.defaultSelection?.provider === route.provider && state.defaultSelection.model === route.model;
  const reasoningEffort = effort || (sameDefault ? state.defaultSelection.effort : "");
  const pi = state.providers.get(route.provider);
  const patch = [];
  if (pi && !pi.local) {
    const row = state.headless.rows.get("llm-pi-ai"), config = row?.config || {};
    const existing = entries(config.providers);
    if (!state.headless.canImport || row.disabled || row.name !== ROWS["llm-pi-ai"][0] || Object.keys(config).some(key => key !== "providers") ||
      config.providers !== undefined && !dict(config.providers) || existing.some(([, config]) => !portableProvider(config)) || !portableProvider(pi.config, { imported:true })) {
      throw Error(`Configure the ${route.provider} provider in dsh's headless profile before running this model from PenEcho.`);
    }
    patch.push({ id:"llm-pi-ai", config:{ providers:Object.fromEntries([...existing, [route.provider, pi.config]]) } });
  }
  patch.push({ id:"agent-default-model", config:{ provider:route.provider, model:route.model, ...(reasoningEffort ? { reasoningEffort } : {}) } });
  return { selection, patch, verify };
}

function stageDshPatch(command, directory) {
  if (!command.dshPatch) return command.args;
  const file = path.resolve(directory, DSH_PATCH_FILE);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(command.dshPatch), { flag:"wx", mode:0o600 });
  try { fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force:true }); }
  // dsh hands the remaining arguments to the headless parser at its first
  // app flag. The launcher overlay belongs before --json (or other app flags).
  const json = command.args.indexOf("--json");
  const at = json === -1 ? command.args.length : json;
  return [...command.args.slice(0, at), "--patch", file, ...command.args.slice(at)];
}

module.exports = { dshHome, dshModels, dshPlan, dshCredentialRef, stageDshPatch, validDshModel, effortId, yamlRows, DEFAULT_PLUGIN, DSH_PATCH_FILE };
