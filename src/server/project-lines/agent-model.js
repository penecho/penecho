"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dshModels } = require("./dsh-models.js");

// The defaults and model choices visible in each agent's own settings. Reading them starts no runner.
// If the settings name no default, the runner can still pick one at launch.
const short = (file, home) => String(file || "").replace(home, "~");
// These files are read for every saved agent each time the agents are listed, and opening one can take long on Windows. So what was in one is kept until the file changes.
const READ_MOST = 60, readMemo = new Map();
function held(file) {
  let stamp;
  try { const s = fs.statSync(file); stamp = `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { readMemo.delete(file); return { text:"" }; }
  let known = readMemo.get(file);
  if (known?.stamp === stamp) return known;
  try { known = { stamp, text:fs.readFileSync(file, "utf8") }; } catch { readMemo.delete(file); return { text:"" }; }
  if (readMemo.size >= READ_MOST) readMemo.delete(readMemo.keys().next().value);
  readMemo.set(file, known);
  return known;
}
const read = file => held(file).text;
// JSON with comments, as OpenCode allows. Comments are taken out only outside strings.
function readJson(file) {
  const known = held(file), { text } = known; if (!text) return null;
  if ("json" in known) return known.json;
  try { known.json = JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (all, string) => string || "").replace(/,(\s*[}\]])/g, "$1")); } catch { known.json = null; }
  return known.json;
}
// A top-level key in TOML: only lines before the first [table], so a profile's model is not taken for the default.
function tomlTop(text, key) {
  const top = String(text).split(/^\s*\[/m)[0];
  const match = top.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]+)["']`, "m"));
  return match ? match[1].trim() : "";
}
const text = value => (typeof value === "string" ? value.trim() : "");
function qualifiedModel(providerValue, modelValue) {
  const provider = text(providerValue), model = text(modelValue);
  if (!model || /[\s<>]/.test(model) || /^default$/i.test(model) || /[\s/<>]/.test(provider)) return "";
  return provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model;
}
// OpenCode's legacy assistant metadata has modelID/providerID; current sessions store a nested model.
function openCodeModel(info) {
  const nested = info?.model;
  return qualifiedModel(info?.providerID ?? nested?.providerID, info?.modelID ?? nested?.id ?? nested);
}
// The models an agent's own settings name, to pick one for PenEcho's runs. Only names are read: never a key or an address.
const CHOICES_MOST = 300;
const unique = list => [...new Set(list.map(text).filter(Boolean))].slice(0, CHOICES_MOST);
// Each [table] of a TOML file with its own lines, so a key is read from the table it belongs to.
const tomlTables = textValue => String(textValue).split(/^\s*(?=\[)/m).map(part => ({ name:(part.match(/^\[\s*([^\]]+?)\s*\]/) || [])[1] || "", body:part }));
// A table's own lines, without its [name], and two kinds of value in them: a list of words, and true or false. null where the key is not there.
const tomlInside = table => (table ? table.body.replace(/^\[[^\]]*\]/, "") : "");
const tomlList = (body, key) => { const found = String(body).match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m")); return found ? [...found[1].matchAll(/["']([^"'\n]+)["']/g)].map(word => word[1].trim()) : null; };
const tomlFlag = (body, key) => { const found = String(body).match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\b`, "m")); return found ? found[1] === "true" : null; };
// Claude Code takes these short names for its own models, and they follow its newest ones.
const CLAUDE_NAMES = ["fable", "opus", "sonnet", "haiku"];
// A full Claude model name, as claude-opus-5-5, claude-haiku-4-5-20251001 or claude-fable-5-1[1m].
const CLAUDE_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/;
// Families in the order of the short names, then the newest version first, the plain name before its [1m] one.
function claudeOrder(a, b) {
  const [x, y] = [a, b].map(id => id.match(CLAUDE_ID)), rank = m => (CLAUDE_NAMES.indexOf(m[1]) + 1 || CLAUDE_NAMES.length + 1);
  return rank(x) - rank(y) || x[1].localeCompare(y[1]) || y[2] - x[2] || (y[3] || 0) - (x[3] || 0) || Boolean(x[4]) - Boolean(y[4]) || a.localeCompare(b);
}
// The full names Claude Code keeps in its own .claude.json: the ones its /model menu adds, and each model it has a price for.
function claudeKnownModels(env, home) {
  const config = readJson(path.join(env.CLAUDE_CONFIG_DIR || home, ".claude.json")) || {};
  const offered = Array.isArray(config.additionalModelOptionsCache) ? config.additionalModelOptionsCache.map(option => option?.value) : [];
  const priced = config.additionalModelCostsCache && typeof config.additionalModelCostsCache === "object" ? Object.keys(config.additionalModelCostsCache) : [];
  return unique([...offered, ...priced]).filter(id => CLAUDE_ID.test(id)).sort(claudeOrder);
}
// How hard each agent thinks, as its own command takes it. Codex and OpenCode list the levels per model instead, in effortsFor.
// Claude Code's `--effort`, Pi's `--thinking` (read in its own list of them), and Kimi Code's [thinking] effort, which PenEcho maps to these three.
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"], PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"], KIMI_EFFORTS = ["low", "high", "max"];

const OMP_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];
const yamlValue = value => String(value).replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
// The plain `key: value` lines directly under one top-level key of a YAML file.
function yamlUnder(textValue, key) {
  const out = {}; let inside = false;
  for (const line of String(textValue).split(/\r?\n/)) {
    if (/^\S/.test(line)) { inside = new RegExp(`^${key}:\\s*$`).test(line); continue; }
    const m = inside && line.match(/^  ([\w.-]+):\s*(\S.*)$/);
    if (m) out[m[1]] = yamlValue(m[2]);
  }
  return out;
}
// Every model in omp's models.yml: its provider/id, whether it says it reasons, and the levels it lists under `thinking`, where it lists any.
function ompModels(textValue) {
  const out = []; let inProviders = false, provider = "", inModels = false, model = null, at = "";
  for (const line of String(textValue).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) { inProviders = /^providers:\s*$/.test(line); provider = ""; inModels = false; model = null; continue; }
    if (!inProviders) continue;
    const head = line.match(/^  ([^\s:#][^:]*):\s*$/);
    if (head) { provider = yamlValue(head[1]); inModels = false; model = null; continue; }
    if (/^ {4}\S/.test(line)) { inModels = /^ {4}models:\s*$/.test(line); model = null; continue; }
    if (!inModels || !provider) continue;
    if (/^ {6}-(?: |$)/.test(line)) { model = { id:"", reasoning:null, efforts:null }; out.push(model); at = ""; }
    if (!model) continue;
    const key = line.match(/^ {6}(?:- | {2})([\w.-]+):\s*(.*)$/);
    if (key) {
      at = key[1];
      if (at === "id" && yamlValue(key[2])) model.id = `${provider}/${yamlValue(key[2])}`;
      if (at === "reasoning" && /^(?:true|false)$/.test(yamlValue(key[2]))) model.reasoning = yamlValue(key[2]) === "true";
      continue;
    }
    // thinking: { efforts: [low, high] }, written out as omp does, one level to a line, or on the line of `efforts` itself.
    const under = /^thinking(?:\.efforts)?$/.test(at) && line.match(/^ {10}([\w.-]+):\s*(.*)$/);
    if (under) { at = under[1] === "efforts" ? "thinking.efforts" : "thinking"; if (under[1] === "efforts") model.efforts = (under[2].match(/^\[(.*)\]/)?.[1] || "").split(",").map(yamlValue).filter(Boolean); continue; }
    const level = at === "thinking.efforts" && line.match(/^ {10,}- (\S.*)$/);
    if (level) model.efforts.push(yamlValue(level[1]));
  }
  return out.filter(found => found.id);
}
// What Pi does with `--thinking` for a model its models.json describes (read on the wire, 0.84.2): one that does not say it reasons is sent no level at all.
// One that does takes off to high, and xhigh or max only where its thinkingLevelMap names them; a level the map sets to null is not taken.
// Any other level is quietly changed to the nearest one it takes.
const piLevels = model => (model.reasoning !== true ? [] : PI_EFFORTS.filter(level => { const mapped = model.thinkingLevelMap?.[level]; return mapped !== null && (mapped !== undefined || !["xhigh", "max"].includes(level)); }));

const MODEL = {
  claude(env, home) {
    const dir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), file = path.join(dir, "settings.json"), where = short(file, home);
    const settings = readJson(file) || {};
    const change = `Run \`/model\` in Claude Code, or set \`"model"\` in \`${where}\`.`;
    // The names it maps its short names to, when its settings change them.
    const mapped = ["ANTHROPIC_DEFAULT_FABLE_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"].map(key => text(env[key]) || text(settings.env?.[key]));
    // The level a run takes when PenEcho hands over none: a CLAUDE_CODE_EFFORT_LEVEL in the settings' own `env` comes before the shell's.
    // The settings' "effortLevel" is not read: an unattended run did not take it, and went at the model's own level (read on the wire, 2.1.300).
    const effort = text(settings.env?.CLAUDE_CODE_EFFORT_LEVEL) || text(env.CLAUDE_CODE_EFFORT_LEVEL);
    const known = claudeKnownModels(env, home);
    if (text(env.ANTHROPIC_MODEL)) return { name:text(env.ANTHROPIC_MODEL), effort, from:"ANTHROPIC_MODEL", change:"Change or remove the ANTHROPIC_MODEL setting PenEcho was started with.", choices:unique([env.ANTHROPIC_MODEL, ...CLAUDE_NAMES, ...mapped, ...known]), efforts:CLAUDE_EFFORTS };
    // An ANTHROPIC_MODEL in the settings' env comes before their "model".
    const name = text(settings.env?.ANTHROPIC_MODEL) || text(settings.model);
    return { name, effort, from:name ? where : "", change, choices:unique([name, ...CLAUDE_NAMES, ...mapped, ...known]), efforts:CLAUDE_EFFORTS };
  },
  codex(env, home) {
    const dir = env.CODEX_HOME || path.join(home, ".codex"), file = path.join(dir, "config.toml"), where = short(file, home), config = read(file);
    const name = tomlTop(config, "model"), effort = tomlTop(config, "model_reasoning_effort");
    // Each profile's model, and the models Codex last fetched for its own picker, leaving out the ones it hides there.
    const profiles = tomlTables(config).filter(t => /^profiles\./.test(t.name)).map(t => tomlTop(t.body.replace(/^\[[^\]]*\]/, ""), "model"));
    const catalog = readJson(path.join(dir, "models_cache.json"))?.models || [];
    const cached = catalog.filter(model => model && model.visibility !== "hide").map(model => model.slug || model.id);
    // Each of those models says which reasoning levels it takes.
    const effortsFor = Object.fromEntries(catalog.filter(model => (model?.slug || model?.id) && Array.isArray(model.supported_reasoning_levels)).map(model => [text(model.slug || model.id), unique(model.supported_reasoning_levels.map(level => typeof level === "string" ? level : level?.effort))]));
    const efforts = unique(["low", "medium", "high", "xhigh", ...Object.values(effortsFor).flat(), effort]);
    return { name, effort, from:name || effort ? where : "", change:`Pick one with \`/model\` in Codex, or set \`model\` in \`${where}\`.`, choices:unique([name, ...profiles, ...cached]), efforts, effortsFor };
  },
  opencode(env, home) {
    const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
    const files = [env.OPENCODE_CONFIG, ...["opencode.json", "opencode.jsonc", "config.json"].map(name => path.join(dir, name))].filter(Boolean);
    const file = files.find(candidate => text(readJson(candidate)?.model)) || "";
    const where = short(file || path.join(dir, "opencode.json"), home);
    const name = file ? text(readJson(file).model) : "";
    // Each provider's models, as provider/model, from every settings file it reads.
    const models = files.flatMap(candidate => Object.entries(readJson(candidate)?.provider || {}).flatMap(([provider, entry]) => Object.entries(entry?.models || {}).map(([model, about]) => [`${provider}/${model}`, about])));
    // A model's variants are its reasoning levels, which `opencode run --variant` takes. An explicit `"variants": {}` means none,
    // while a model omitting `variants` stays open until OpenCode's own list says them all (parseOpenCodeModels).
    const effortsFor = Object.fromEntries(models.filter(([, about]) => about && typeof about === "object" && Object.hasOwn(about, "variants")).map(([id, about]) => [id, openCodeVariants(about.variants)]));
    return { name, from:file ? where : "", change:`Set \`"model"\` in \`${where}\`, as provider/model.`, choices:unique([name, ...models.map(([id]) => id)]), effortsFor };
  },
  pi(env, home) {
    const agentDir = env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), file = path.join(agentDir, "settings.json"), where = short(file, home), settings = readJson(file) || {};
    const model = text(settings.defaultModel), provider = text(settings.defaultProvider);
    // A model's own id can hold a slash, as a gateway's auto/kimi-k3.1-pro does, so only a model already starting with its provider is left as it is.
    const name = model ? (provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model) : "";
    // Its own providers' models, as provider/id, which is how `pi --model` takes them.
    const providers = Object.entries(readJson(path.join(agentDir, "models.json"))?.providers || {});
    const listed = providers.flatMap(([id, entry]) => {
      const models = Array.isArray(entry?.models) ? entry.models.map(m => (typeof m === "string" ? m : m?.id)) : Object.keys(entry?.models || {});
      return models.filter(Boolean).map(m => `${id}/${m}`);
    });
    // Each model described there says which levels it takes. One of Pi's built-in models is not described, so every level stays open for it.
    const effortsFor = Object.fromEntries(providers.flatMap(([id, entry]) => (Array.isArray(entry?.models) ? entry.models : []).filter(m => m && typeof m === "object" && m.id).map(m => [`${id}/${m.id}`, piLevels(m)])));
    return { name, effort:text(settings.defaultThinkingLevel), from:model ? where : "", change:`Pick one with \`/model\` in Pi, or set \`defaultModel\` in \`${where}\`.`, choices:unique([name, ...listed]), efforts:PI_EFFORTS, effortsFor };
  },
  kimi(env, home) {
    const file = path.join(env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), "config.toml"), where = short(file, home), config = read(file), name = tomlTop(config, "default_model");
    const tables = tomlTables(config), models = tables.map(t => ({ id:(t.name.match(/^models\.(?:"([^"]+)"|'([^']+)'|([\w./-]+))$/) || []).slice(1).find(Boolean), body:tomlInside(t) })).filter(m => m.id);
    const providers = Object.fromEntries(tables.map(t => [(t.name.match(/^providers\.(?:"([^"]+)"|'([^']+)'|([\w./:-]+))$/) || []).slice(1).find(Boolean), tomlTop(tomlInside(t), "type")]).filter(([id]) => id));
    const thinking = tomlInside(tables.find(t => t.name === "thinking")), off = tomlFlag(thinking, "enabled") === false, level = tomlTop(thinking, "effort");
    // What Kimi Code does with a level, model by model (read on the wire, 0.35.0). A model without a thinking capability, or whose thinking these settings turn off,
    // runs with none, whatever level is handed over. A non-kimi provider ignores KIMI_MODEL_THINKING_EFFORT and uses [thinking] from config.toml instead.
    // One that lists its levels is offered those. Handed none, it runs at the level in the environment PenEcho was started with,
    // else at the settings' level where it lists that one, else at its own default; a model that lists no levels is then sent none, so no default is claimed for it.
    const effortsFor = {}, defaultEffortFor = {}, whyNone = {}, shell = text(env.KIMI_MODEL_THINKING_EFFORT);
    for (const model of models) {
      const can = tomlList(model.body, "capabilities"), levels = tomlList(model.body, "support_efforts") || [];
      const provider = tomlTop(model.body, "provider"), providerType = provider ? providers[provider] || "" : "";
      const thinks = Boolean(can && (can.includes("always_thinking") || (can.includes("thinking") && !off)));
      const nonKimi = Boolean(providerType && providerType !== "kimi");
      if (!thinks || nonKimi) effortsFor[model.id] = [];
      else if (levels.length) effortsFor[model.id] = unique(levels);
      if (!thinks && can?.includes("thinking")) whyNone[model.id] = `thinking is switched off in ${where}`;
      else if (nonKimi) whyNone[model.id] = `Kimi Code ignores KIMI_MODEL_THINKING_EFFORT for ${providerType} providers; set [thinking] in ${where}`;
      defaultEffortFor[model.id] = !thinks || nonKimi ? "" : shell || (levels.length ? (levels.includes(level) ? level : tomlTop(model.body, "default_effort")) : "");
    }
    return { name, effort:defaultEffortFor[name] || "", from:name ? where : "", change:`Set \`default_model\` in \`${where}\`.`, choices:unique([name, ...models.map(m => m.id)]), efforts:KIMI_EFFORTS, effortsFor, defaultEffortFor, whyNone };
  },
  dsh:dshModels,
  // omp keeps a model for each role, written provider/id:level, and lists each provider's models in models.yml.
  omp(env, home) {
    const dir = path.join(home, ".omp", "agent"), file = path.join(dir, "config.yml"), where = short(file, home);
    const role = yamlUnder(read(file), "modelRoles").default || "", cut = role.match(/^(.*):([a-z]+)$/);
    const name = cut && OMP_EFFORTS.includes(cut[2]) ? cut[1] : role, effort = cut && OMP_EFFORTS.includes(cut[2]) ? cut[2] : "";
    const models = ompModels(read(path.join(dir, "models.yml")));
    // What `--thinking` does with a level (read on the wire, 19.0.1): a model that lists its levels takes those, and any other level is quietly changed to the nearest one;
    // a model that says it does not reason is sent none. `auto`, where omp picks the level itself as it goes, holds for every model that reasons.
    const effortsFor = Object.fromEntries(models.filter(m => m.reasoning === false || Array.isArray(m.efforts)).map(m => [m.id, m.reasoning === false || !m.efforts.length ? [] : unique([...m.efforts, "auto"])]));
    // The role's level goes with a run that is handed no model. Handed one, even the role's own, omp runs it at a level of its choosing, so no default is claimed for any (defaultEffortFor).
    return { name, effort, from:name ? where : "", change:"Pick one with `/model` in omp.", choices:unique([name, ...models.map(m => m.id)]), efforts:OMP_EFFORTS, effortsFor, defaultEffortFor:{} };
  },
  // agy saves the model picked with /model by its label, as "Gemini 3.8 Flash (High)", while `--model` takes a slug from `agy models`
  // (tier-suffixed slugs collapse into base models + `effortsFor` during `agent-check`).
  antigravity(env, home) {
    const file = path.join(home, ".gemini", "antigravity-cli", "settings.json"), where = short(file, home), name = text(readJson(file)?.model);
    return { name, from:name ? where : "", change:"Pick one with `/model` in agy. Pick a model from the list or choose `Type another…` for any slug from `agy models`.", choices:[], efforts:CLAUDE_EFFORTS };
  },
  // PenEcho's own agent runs on PenEcho Cloud's models when this computer is signed in.
  // The names come from PenEcho itself, which is why this one is handed its source.
  penecho(env, home, source) {
    const about = source?.models?.() || { name:"", effort:"", from:"", choices:[], efforts:[], effortsFor:{}, defaultEffortFor:{} };
    return { name:about.name, effort:about.effort || "", from:about.from, choices:unique(about.choices), efforts:about.efforts, effortsFor:about.effortsFor || {}, defaultEffortFor:about.defaultEffortFor || {}, signedIn:Boolean(about.signedIn), credits:Number.isFinite(about.credits) ? about.credits : null,
      change:"Configure personal API keys in your own agent." };
  },
};

// { name, effort, from, change, choices, efforts, effortsFor }. An empty name means the agent's own default. An agent PenEcho has no reader for says nothing.
// `effort` is the level a run takes when it is handed none, and no model. An agent whose default changes with the model adds defaultEffortFor (defaultEffortWith).
// `fixed` marks an agent that takes no model from PenEcho, so none can be picked for it. `source` is PenEcho's own list, for its own agent.
function modelOf(id, env = process.env, source = null) {
  const reader = MODEL[id]; if (!reader) return null;
  try { return { effort:"", choices:[], efforts:[], effortsFor:{}, ...reader(env, env.HOME || env.USERPROFILE || os.homedir(), source) }; } catch { return null; }
}
const AGY_TIER = /^(.*)-(low|medium|high|xhigh|max)$/i;
const AGY_TIER_ORDER = ["low", "medium", "high", "xhigh", "max"];
// `agy models` prints spinner frames followed by `<slug>\t<Label>` (piped) or `<slug>  <Label>` (TTY).
// Tier-suffixed entries (`gemini-4-hydrogen-xhigh` / `Gemini 4 Hydrogen (XHigh)`) share one base model whose `--effort` accepts those tiers;
// suffixes mismatching `--effort` fail with a conflict error in `agy`, so group variants into base models + `effortsFor`.
function parseAntigravityModels(output) {
  const clean = String(output || "").replace(/\r[^\n]*\r|\x1b\[[0-9;?]*[A-Za-z]/g, "\n");
  const choices = [], choiceLabels = {}, tiers = {}, variants = {}, seen = new Set();
  for (const raw of clean.split(/[\r\n]+/)) {
    const line = raw.trim();
    if (!line || /Fetching available models/i.test(line)) continue;
    const match = line.match(/^([a-z0-9][a-z0-9._:-]*)(?:\t+|\s{2,})(\S.*)$/i);
    if (!match) continue;
    const rawSlug = match[1].trim(), rawLabel = match[2].trim();
    const split = rawSlug.match(AGY_TIER);
    const tier = split && (!rawLabel || new RegExp(`\\(${split[2]}\\)$`, "i").test(rawLabel)) ? split[2].toLowerCase() : "";
    const slug = tier ? split[1] : rawSlug;
    const label = tier ? rawLabel.replace(/\s*\((?:low|medium|high|xhigh|max)\)$/i, "").trim() : rawLabel;
    if (!seen.has(slug)) { seen.add(slug); choices.push(slug); }
    if (label && !choiceLabels[slug]) choiceLabels[slug] = label;
    if (tier) {
      (tiers[slug] ||= new Set()).add(tier);
      variants[rawSlug] = { model:slug, effort:tier };
    }
  }
  const effortsFor = Object.fromEntries(Object.entries(tiers).map(([slug, set]) => [slug, AGY_TIER_ORDER.filter(level => set.has(level))]));
  return { choices:choices.slice(0, CHOICES_MOST), choiceLabels, effortsFor, variants };
}
// The reasoning levels open with a model: that model's own, where the agent lists them per model, or the agent's list. None where nothing says.
// A model its agent lists with no levels takes none. When nothing is known about the model, the levels most agents take,
// so effort can always be picked (BASIC_EFFORTS in settings.js).
const BASIC_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const effortsWith = (model, about) => {
  if (Object.hasOwn(about?.effortsFor || {}, model)) return about.effortsFor[model];
  return about?.efforts?.length ? about.efforts : BASIC_EFFORTS;
};
// The level a run takes when it is handed none, with `model` (the agent's own when empty), as far as the agent's settings say. Nothing where they do not say:
// an agent whose default changes with the model says it model by model, and a level the model is known not to take is not claimed for it.
const defaultEffortWith = (model, about) => {
  const level = model && about?.defaultEffortFor ? about.defaultEffortFor[model] || "" : about?.effort || "", name = model || about?.name || "";
  return level && Object.hasOwn(about?.effortsFor || {}, name) && !about.effortsFor[name].includes(level) ? "" : level;
};
const openCodeVariants = variants => (variants && typeof variants === "object" && !Array.isArray(variants) ? unique(Object.entries(variants).filter(([, about]) => !about?.disabled).map(([level]) => level)) : []);
// `opencode models --verbose` prints each model as provider/model on a line of its own, then what OpenCode knows of it as JSON, whose variants are the levels `--variant` takes for it.
// A model with none takes none. null when the output is not that list.
function parseOpenCodeModels(output) {
  const out = {};
  for (const part of String(output || "").split(/^(?=[^\s{}[\]"][^\n]*\n\{)/m)) {
    const cut = part.indexOf("\n"), id = part.slice(0, cut).trim();
    if (cut < 0 || !/^[^\s/]+\/\S+$/.test(id)) continue;
    try { const about = JSON.parse(part.slice(cut + 1)); if (about && typeof about === "object") out[id] = openCodeVariants(about.variants); } catch { /* Not a model's lines. */ }
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { modelOf, qualifiedModel, openCodeModel, effortsWith, defaultEffortWith, BASIC_EFFORTS, tomlTop, parseAntigravityModels, parseOpenCodeModels };
