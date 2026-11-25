"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, runCommand, diagnosticDecoder, StringDecoder } = require("./agent-process.js");
const { modelOf, effortsWith, parseAntigravityModels } = require("./agent-model.js");
const { dshSavedKeys, dshTakesFolders } = require("./agents.js");
const { prepareAgentEnv } = require("../../providers/agent-env.js");
const { dshHome, dshCredentialRef, stageDshPatch, validDshModel, effortId } = require("./dsh-models.js");
const { NOT_SET_UP } = require("../agent-core/penecho-source.js");
const { userLine, piRpcInit, piRpcUiResponse } = require("./activity.js");
const { installKind } = require("./agent-updates.js");
const { updateAgent } = require("./agent-self-update.js");

// The Agent setup page: every agent PenEcho knows, whether it is here, starts, and is signed in, and for each problem what is wrong,
// how to fix it, and a prompt to paste into an agent that does work. It holds for every project, since the agents belong to the computer.
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const firstLine = text => String(text || "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
const short = file => String(file || "").replace(os.homedir(), "~");

// Where an agent was installed but PenEcho does not look: a desktop app hands PenEcho a shorter PATH than your Terminal has.
const COMMON_FOLDERS = [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin", ".volta/bin", ".claude/local", ".opencode/bin", ".kimi-code/bin", ".pi/agent/bin", "AppData/Local/Programs/OpenAI/Codex/bin", "AppData/Local/agy/bin", "AppData/Local/omp", "AppData/Local/deepseek-harness/bin", "AppData/Roaming/npm", "AppData/Local/pnpm", "scoop/shims", "bin"];
async function findElsewhere(name, env, run) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const seen = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean).map(dir => dir.replace(/^"|"$/g, ""));
  const names = process.platform === "win32" && !path.extname(name) ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  const dirs = [...COMMON_FOLDERS.map(folder => path.join(home, folder)), ...(process.platform === "win32" ? [] : ["/opt/homebrew/bin", "/usr/local/bin"])].filter(dir => !seen.includes(dir));
  const local = dirs.flatMap(dir => names.map(file => path.join(dir, file))).find(isFile);
  if (local) return local;
  if (process.platform === "win32" || !/^[\w.-]+$/.test(name)) return "";
  const shell = env.SHELL || "/bin/zsh", answer = await run(shell, ["-lc", `command -v ${name}`], { env, timeout:5000 });
  const found = firstLine(answer.stdout);
  return answer.status === 0 && path.isAbsolute(found) && !seen.includes(path.dirname(found)) ? found : "";
}

const commandText = launch => [launch.command, ...launch.prefixArgs].join(" ");
function prompt(agent, problem, facts, steps, done) {
  return [
    `PenEcho Lines checked the coding agents on this computer, and ${agent.name} has a problem.`,
    "",
    `Problem: ${problem}`,
    ...facts.filter(Boolean).map(fact => `- ${fact}`),
    "",
    "Please fix it on this computer:",
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    "",
    `${done} Tell me what you changed. Leave PenEcho's own files alone.`,
  ].join("\n");
}
const checkLine = (agent, signIn) => `When it works, \`${agent.cli} --version\` prints a version${signIn ? ` and \`${agent.cli} ${signIn.args.join(" ")}\` says it is signed in` : ""}.`;
// Windows PowerShell 5.1 asks before each Invoke-WebRequest that lacks -UseBasicParsing, which holds an agent up.
const POWERSHELL_QUIET = "$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing']=$true";
const installStep = agent => agent.install ? `${agent.install.startsWith("irm ") ? `In Windows PowerShell run \`${POWERSHELL_QUIET}\` first, so it does not stop to ask. ` : ""}Install it with \`${agent.install}\`, or the way its official instructions say for this system.` : `Install the \`${agent.cli}\` command from ${agent.installFrom || "its official instructions"}.`;

// Whether anything answers at a model's address. Any reply counts: only silence means a run would wait there until it gives up.
async function reachUrl(url) {
  try { await fetch(url, { method:"GET", signal:AbortSignal.timeout(4000), redirect:"manual" }); return true; } catch { return false; }
}
// What an agent needs beyond starting, known from runs that failed although the agent's own app worked.
const EXTRA = {
  // dsh's headless mode reads its key only from where it starts, so PenEcho passes along the one DeepSeek Harness saved. With neither, every run stops at once.
  dsh(agent, { env, out }) {
    const version = /\d+\.\d+\.\d+/.exec(out.version)?.[0] || "";
    const updateCmd = "npm install -g @deepseek-ai/dsh@latest";
    const old = dshTakesFolders(version) ? [] : [{
      kind:"tip",
      action:"update",
      title:"Update dsh to 0.2.2 or later",
      detail:`dsh ${out.version} is older than 0.2.2, so it cannot use Full access (--permission-mode danger-full-access) or write outside the project folder (--add-dir).`,
      fix:`Update dsh to 0.2.2 or later with \`${updateCmd}\` (or update DeepSeek Harness), then Check again.`,
      command:updateCmd,
      prompt:prompt(
        agent,
        `dsh ${out.version} is installed, which is older than 0.2.2. Its headless mode does not support --permission-mode, --approval-policy, or --add-dir (added in 0.2.2), so PenEcho cannot run it with Full access or let it save files to the Line's docs folder or commit from a worktree.`,
        [`Command PenEcho runs: ${commandText(agent.launch)}`],
        [
          `Update dsh to 0.2.2 or later by running \`${updateCmd}\` (or updating the DeepSeek Harness app to 0.2.2+).`,
          "Verify `dsh --version` prints 0.2.2 or later, and make sure no older 0.2.1 `dsh` earlier on PATH shadows the updated command.",
          "Do not change PenEcho's files.",
        ],
        "When it works, `dsh --version` prints 0.2.2 or later."
      ),
    }];
    const home = dshHome(env);
    const ref = dshCredentialRef(env, agent.picked);
    if (!ref || String(env[ref] || "").trim() || Object.hasOwn(dshSavedKeys(env), ref) || isFile(path.join(home, ".env"))) return old;
    const where = short(path.join(home, ".credentials.yaml"));
    return [...old, { title:ref === "DEEPSEEK_API_KEY" ? "No DeepSeek key for runs from PenEcho" : "No key for the selected dsh model", detail:`${ref} is missing from the environment and ${where}.`, fix:"Add the API key on DeepSeek Harness's Models page, then Check again.",
      prompt:prompt(agent, `dsh headless cannot find the ${ref} credential reference.`, [`PenEcho passes along the keys DeepSeek Harness saves in ${where}, under refs.`, `Command PenEcho runs: ${commandText(agent.launch)} --profile headless --json`], ["Check whether DeepSeek Harness has the required API key saved.", "If it has none, tell me to add one on DeepSeek Harness's Models page. Do not make one up or copy one from elsewhere."], "When it works, a short run of dsh's headless mode answers.") }];
  },
};

const dshExtraProblems = new WeakMap();
function refreshDshProblems(agent, env, out) {
  const previous = dshExtraProblems.get(out) || [];
  const next = EXTRA.dsh(agent, { env:{ ...env, ...agent.launch.env }, out }).map(problem => ({ kind:"fix", ...problem }));
  out.problems = [...out.problems.filter(problem => !previous.includes(problem)), ...next];
  out.state = out.problems.some(problem => problem.kind === "fix") ? "problem" : "ready";
  dshExtraProblems.set(out, next);
}

async function checkOne(agent, { env, run, reach = reachUrl, fresh = false, modelCache = null, pickModel = null, levels = null }) {
  const out = { id:agent.id, name:agent.name, mono:agent.mono, color:agent.color, state:"ready", where:"", version:"", signedIn:null, model:null, app:agent.app ? `${agent.app.name} ${agent.app.version}` : "", access:agent.access || null, problems:[] };
  const add = (kind, problem) => { out.problems.push({ kind, ...problem }); if (kind === "fix") out.state = "problem"; };
  const pathFact = `PenEcho looks for commands in: ${String(env.PATH || "").split(path.delimiter).filter(Boolean).join(path.delimiter) || "(no PATH)"}`;

  // A setting naming a file that is not there is passed over without a word, so it is said here. A bare name, as the Canvas's own connection sets, is looked up like any command.
  if (/[\\/]/.test(agent.configured) && !isFile(path.resolve(agent.configured))) {
    add("fix", { title:`${agent.envVar} names a file that is not there`, detail:short(agent.configured), fix:`Point ${agent.envVar} at the ${agent.cli} command, or remove it.`,
      prompt:prompt(agent, `the setting ${agent.envVar} names ${agent.configured}, which is not a file.`, [pathFact], [`Find where \`${agent.cli}\` is installed, installing it if it is not.`, `Change ${agent.envVar} to that file, or remove the setting so PenEcho finds \`${agent.cli}\` itself.`], checkLine(agent)) });
  }

  // PenEcho's own agent has nothing to install. It needs only a way to reach a model.
  if (agent.builtIn && !agent.launch) {
    out.state = "missing"; out.builtIn = true;
    out.problems.push({ kind:"tip", title:"Not set up", fix:NOT_SET_UP });
    return out;
  }
  if (!agent.launch) {
    // Its app alone is enough to paste into. Runs from PenEcho still need the command.
    // An agent with only an app, as WorkBuddy, needs nothing more.
    if (agent.app?.enough && !agent.cli) return out;
    if (agent.app?.enough) {
      add("tip", { title:`Runs from PenEcho need the ${agent.cli} command`, detail:`${agent.app.name} is here for pasting asks into.`, fix:installStep(agent), command:agent.install,
        prompt:prompt(agent, `its app is installed, but the \`${agent.cli}\` command is not, so PenEcho cannot run it in the background.`, [pathFact], [installStep(agent), "Make sure it is in one of the folders PenEcho looks in."], checkLine(agent)) });
      return out;
    }
    const elsewhere = agent.cli ? await findElsewhere(agent.cli, env, run) : "";
    if (elsewhere) {
      add("fix", { title:"Installed, but PenEcho cannot find it", detail:`${short(elsewhere)} is not in a folder PenEcho looks in.`, fix:"Start PenEcho again from Terminal, or link the command into a folder PenEcho looks in.",
        prompt:prompt(agent, `\`${agent.cli}\` is installed at ${elsewhere}, but PenEcho was started without that folder on its PATH, so it cannot find it.`, [pathFact], [`Make \`${agent.cli}\` reachable from one of the folders PenEcho looks in, for example with a link to ${elsewhere}.`, "Do not move or reinstall the original."], checkLine(agent)) });
      out.where = elsewhere;
      return out;
    }
    // A bad setting stays the thing to fix, and its prompt installs the agent too. Otherwise not installed is a choice, not a problem.
    if (out.state === "problem") return out;
    out.state = "missing";
    if (!agent.cli && agent.installFrom) out.problems.push({ kind:"tip", title:"Not installed", fix:`Install the ${agent.name} app from ${agent.installFrom}.`,
      prompt:prompt(agent, "it is not installed, and I would like to use it with PenEcho.", [], [`Tell me where to download the ${agent.name} app for this system from ${agent.installFrom}. I will install it and sign in myself.`], `When it works, ${agent.name} is in the Applications folder.`) });
    if (agent.cli) out.problems.push({ kind:"tip", title:"Not installed", fix:installStep(agent), command:agent.install,
      prompt:prompt(agent, `it is not installed, and I would like to use it from PenEcho.`, [pathFact], [installStep(agent), "Make sure it is in one of the folders PenEcho looks in.", ...(agent.signIn ? [`Then tell me to run \`${agent.signIn.login}\` myself to sign in.`] : [])], checkLine(agent, agent.signIn)) });
    return out;
  }

  out.where = agent.builtIn ? "built in" : commandText(agent.launch);
  // Its own agent's models come from PenEcho Cloud, which is asked once so their names are there to pick from.
  if (agent.builtIn) await agent.launch.source?.refresh?.();
  out.model = modelOf(agent.id, env, agent.launch.source || null);
  // The one picked for PenEcho's runs, if any. A pick the agent's settings no longer name is still shown, so it can be seen and changed.
  if (out.model) Object.assign(out.model, { picked:agent.picked || "", pickedEffort:agent.pickedEffort || "" });
  if (agent.builtIn) {
    out.builtIn = true;
    if (!out.model?.choices.length) add("fix", { title:"No Cloud models available", fix:"Check your PenEcho Cloud connection, then select Check again." });
  }
  // A command inside an app may need its own setting to run as a command, not as the app, and every agent gets clean TLS/PATH env.
  env = prepareAgentEnv(env, agent.launch.env, { platform:process.platform, sandboxWindowsPath:agent.id === "codex" });
  const version = await run(agent.launch.command, [...agent.launch.prefixArgs, "--version"], { env });
  if (version.status !== 0) {
    const said = version.timedOut ? "No answer in 15 seconds." : firstLine(version.stderr) || firstLine(version.stdout) || `It stopped with code ${version.status}.`;
    add("fix", { title:"Found, but it does not start", detail:said, fix:`Run \`${agent.cli || agent.launch.command} --version\` in Terminal to see why. Reinstalling usually fixes it.`,
      prompt:prompt(agent, `PenEcho runs ${out.where}, and \`--version\` fails.`, [`What it said: ${said}`, pathFact], [`Find out why \`${out.where} --version\` fails, and fix it, reinstalling if that is what it takes.`], checkLine(agent, agent.signIn)) });
    return out;
  }
  out.version = (firstLine(version.stdout) || firstLine(version.stderr)).replace(/^[a-z-]+\s+(?=\d)/i, "").replace(/\s*\(.*\)$/, "");

  // `agy models` lists available Antigravity model slugs and display names; cache per binary+home so switching models stays instant.
  if (agent.id === "antigravity" && out.model) {
    const modelsKey = `${agent.launch.command}\0${env.HOME || ""}`;
    let listed = !fresh && modelCache?.get(modelsKey);
    if (!listed) {
      const answer = await run(agent.launch.command, [...agent.launch.prefixArgs, "models"], { env, timeout:25000 }).catch(() => null);
      const parsed = answer?.status === 0 ? parseAntigravityModels(answer.stdout) : null;
      if (parsed?.choices?.length) { listed = parsed; modelCache?.set(modelsKey, parsed); }
      else listed = modelCache?.get(modelsKey) || null;
    }
    if (listed?.choices?.length) {
      out.model.choices = [...new Set([...(out.model.choices || []), ...listed.choices])];
      out.model.choiceLabels = { ...(out.model.choiceLabels || {}), ...listed.choiceLabels };
      if (listed.effortsFor) {
        // A listed model with no tiers takes no `--effort`, so it is listed with none rather than the basic levels.
        out.model.effortsFor = { ...(out.model.effortsFor || {}), ...Object.fromEntries(listed.choices.map(slug => [slug, []])), ...listed.effortsFor };
        out.model.efforts = [];
      }
      if (out.model.name) {
        const baseLabel = out.model.name.replace(/\s*\((?:low|medium|high|xhigh|max)\)$/i, "").trim();
        const baseSlug = Object.entries(out.model.choiceLabels || {}).find(([slug, lbl]) => slug === out.model.name || lbl === baseLabel)?.[0];
        if (baseSlug && listed.effortsFor?.[baseSlug]) out.model.effortsFor[out.model.name] = listed.effortsFor[baseSlug];
      }
      // Migrate any legacy tier-suffixed pick (e.g. `gemini-4-hydrogen-xhigh`) cleanly to its base model + effort, and drop stale unsupported efforts.
      const mapped = out.model.picked && listed.variants?.[out.model.picked];
      const allowed = out.model.picked ? listed.effortsFor?.[out.model.picked] || [] : [];
      if (mapped && typeof pickModel === "function") {
        const nextEffort = listed.effortsFor?.[mapped.model]?.includes(out.model.pickedEffort) ? out.model.pickedEffort : mapped.effort;
        pickModel(agent.id, mapped.model, nextEffort);
        out.model.picked = mapped.model;
        out.model.pickedEffort = nextEffort;
      } else if (out.model.picked && out.model.pickedEffort && listed.choices.includes(out.model.picked) && !allowed.includes(out.model.pickedEffort) && typeof pickModel === "function") {
        pickModel(agent.id, out.model.picked, "");
        out.model.pickedEffort = "";
      }
    }
  }

  // An agent that works its models' levels out itself, as OpenCode does, says them in its own list: those are the ones offered, and a model it lists with none takes none.
  const known = out.model && levels ? await levels(agent.id, { fresh }).catch(() => null) : null;
  if (known) out.model.effortsFor = { ...(out.model.effortsFor || {}), ...known };

  if (agent.signIn) {
    const answer = await run(agent.launch.command, [...agent.launch.prefixArgs, ...agent.signIn.args], { env });
    // A check that itself failed to answer says nothing about sign-in, so nothing is claimed.
    let ok = null;
    try { ok = answer.timedOut || answer.missing ? null : agent.signIn.ok(answer); } catch { ok = null; }
    out.signedIn = typeof ok === "boolean" ? ok : null;
    if (out.signedIn === false) {
      add("fix", { title:"Not signed in", fix:`Run \`${agent.signIn.login}\` in Terminal and sign in in the browser it opens.`, command:agent.signIn.login,
        prompt:prompt(agent, `\`${agent.cli} ${agent.signIn.args.join(" ")}\` says it is not signed in, so every run from PenEcho stops at once.`, [`Command PenEcho runs: ${out.where}`], [`Run \`${agent.signIn.login}\`. It opens a browser where I sign in; wait for me to finish.`, `Then run \`${agent.cli} ${agent.signIn.args.join(" ")}\` again to confirm.`], checkLine(agent, agent.signIn)) });
    }
  }
  if (agent.id === "dsh") refreshDshProblems(agent, env, out);
  else for (const problem of await (EXTRA[agent.id]?.(agent, { env, reach, out }) || [])) add(problem.kind || "fix", problem);
  if (agent.app && !agent.app.ok) {
    add("tip", { title:`Update ${agent.app.name} to open conversations from PenEcho`, detail:`${agent.app.name} ${agent.app.version} is installed.`, fix:`Update ${agent.app.name} from its own menu.`,
      prompt:prompt(agent, `${agent.app.name} ${agent.app.version} is too old for PenEcho to open conversations in it.`, [], [`Update ${agent.app.name} to its latest version, or tell me how to from its menu if you cannot.`], "When it works, PenEcho's Open button lands in the app.") });
  } else if (agent.app && !agent.app.opensNew) {
    add("tip", { title:`Update ${agent.app.name} to start new conversations from PenEcho`, detail:`${agent.app.name} ${agent.app.version} is installed.`, fix:`Update ${agent.app.name} from its own menu.`,
      prompt:prompt(agent, `${agent.app.name} ${agent.app.version} opens conversations from PenEcho but cannot start new ones in a folder.`, [], [`Update ${agent.app.name} to its latest version, or tell me how to from its menu if you cannot.`], "When it works, a new conversation from PenEcho opens in the app.") });
  }
  return out;
}

// A newer version of an agent that works: said beside its version, never as a problem. PenEcho updates it with the agent's own updater
// (agent-self-update.js), and when that does not work an agent that reads this prompt does. So does it with a step to a new major version,
// which can change the agent's settings and commands.
const majorOf = version => /\d+/.exec(String(version).replace(/^\D+/, ""))?.[0] || "";
function updatePrompt(row, latest, install, said) {
  return [
    `PenEcho Lines checked the coding agents on this computer, and ${row.name} has a newer version.`,
    "",
    `- Installed: ${row.version}, run as ${row.where}`,
    `- Newest: ${latest}${majorOf(latest) === majorOf(row.version) ? "" : " (a new major version: say what changes for my settings before you update)"}`,
    ...(said ? [`- PenEcho tried its own updater, and it did not get newer. What it said: ${said.replace(/\s*\n\s*/g, " / ").slice(-600)}`] : []),
    "",
    "Please update it on this computer:",
    "1. Find out how this copy was installed (its own installer, npm, Homebrew, or another way) and update that same copy, so the command above runs the new version.",
    ...(install ? [`2. If you cannot tell, its installer is \`${install}\`.`] : []),
    "",
    `When it works, \`${row.where} --version\` prints ${latest}. Tell me what you changed. Leave PenEcho's own files alone.`,
  ].join("\n");
}

const REDACTED = "[redacted]";
const SECRET_ENV = /(?:^|_)(?:key|token|secret|password|credential|authorization)(?:_|$)/i;
function diagnosticRedactor(env, saved, refs) {
  const values = [...Object.values(saved), ...Object.entries(env).filter(([key]) => refs.has(key) || Object.hasOwn(saved, key) || SECRET_ENV.test(key)).map(([, value]) => value)];
  const variants = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    variants.add(value);
    variants.add(JSON.stringify(value).slice(1, -1));
    try { variants.add(encodeURIComponent(value)); } catch { /* The literal value is still covered. */ }
  }
  const literals = [...variants].sort((a, b) => b.length - a.length);
  return value => {
    let safe = String(value || "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\\\//g, "/")
      // Keep the endpoint visible. URL credentials can use arbitrary query names.
      .replace(/https?:\/\/[^\s"'<>\\]+/gi, url => url.split(/[?#]/, 1)[0].replace(/^(https?:\/\/)[^/]*@/i, "$1"))
      .replace(/(\b(?:proxy[-_])?authorization["']?\s*[:=][ \t]*)(?:"(?:\\.|[^"\\])*"|'[^'\r\n]*'|[^\r\n]+)/gi, `$1${REDACTED}`)
      .replace(/(\b(?:bearer|basic)\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`)
      .replace(/(\b(?:[\w-]*[-_])?(?:api[-_ ]?key|access[-_]?token|refresh[-_]?token|token|secret|password)["']?\s*[:=][ \t]*)(?:"(?:\\.|[^"\\])*"|'[^'\r\n]*'|[^\s,;}]+)/gi, `$1${REDACTED}`)
      .replace(/\b(?:sk|key|xox[baprs]|gh[pousr]|github_pat)[-_][\w-]{12,}\b/g, REDACTED);
    for (const literal of literals) safe = safe.replaceAll(literal, () => REDACTED);
    return safe;
  };
}

// Antigravity has no error event: its result says ERROR, with the reason as a plain string.
const agyFailed = event => event?.event === "result" && Boolean(event.result?.status) && event.result.status !== "SUCCESS";
// The last thing an agent said that reads as a failure: an error in its JSON lines, or else its last words on stderr.
// Only a top-level error event reads as one. Codex also reports harmless warnings as an item of type error,
// such as an under-development feature, and those must not be mistaken for the run failing.
// Pi and omp in RPC mode turn down a command with a response that did not succeed, and end a model failure with an assistant message stopped on error.
const piFailed = event => (event?.type === "response" && event.success === false) || (event?.type === "message_end" && event.message?.role === "assistant" && (event.message.stopReason === "error" || event.message.stopReason === "aborted"));
const failedEvent = stdout => stdout.split("\n").some(line => {
  try { const event = JSON.parse(line); return Boolean(event) && (event.type === "error" || event.type === "turn.failed" || agyFailed(event) || piFailed(event)); }
  catch { return false; }
});
function failureOf(stdout, safeStderr, redact) {
  let found = "";
  const look = (value, inError) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && key === "message" && inError) found = item;
      else look(item, inError || /error|fail/i.test(key));
    }
  };
  for (const line of stdout.split("\n")) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== "object") continue;
    if ((event.type === "error" || event.type === "turn.failed") && typeof event.message === "string") found = event.message;
    if (piFailed(event)) found = String(event.error || event.message?.errorMessage || "");
    if (agyFailed(event)) found = String(event.result.error || event.result.status);
    look(event, false);
  }
  return found ? redact(found) : lastWords(safeStderr);
}
// An agent's last words on stderr, from its last line that starts with "error" if there is one. Kimi ends with "See log: …" after the error itself,
// and Kimi and OpenCode can spread one error over several lines. omp ends with a hint, "Run `omp models` …", after the error itself.
function lastWords(stderr) {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const log = /^see log:/i.test(lines[lines.length - 1] || "") ? lines.pop() : "";
  const start = lines.findLastIndex(line => /^error\b/i.test(line));
  const hint = start < 0 && lines.length > 1 && /^run `/i.test(lines[lines.length - 1]);
  const words = (start >= 0 ? lines.slice(start, start + 4) : lines.slice(hint ? -2 : -1)).filter(line => !/^message:$/i.test(line)).join(" — ");
  return [words, log].filter(Boolean).join(" · ");
}
// A model address a run was waiting on when it was given up, so the person knows where it hung.
function waitedOn(text, redact) {
  const value = [...text.matchAll(/"base_?url"\s*:\s*("(?:\\.|[^"\\])*")/gi)].at(-1)?.[1];
  try { return value ? redact(JSON.parse(value)) : ""; } catch { return ""; }
}

// One short real run, the way PenEcho runs an Ask, in an empty folder. It costs a few tokens, so it runs only when asked.
const TRY_WORDS = "This is a check from PenEcho that you can run. Reply with just the word OK. Do not use any tools.";
// An agent that reads JSON lines takes a user line, the same shape a real Ask uses. Bare words fail to parse.
// A pick ({ model, effort }) runs it with that model and effort instead of its own, as a saved agent would run.
async function tryOne(agentList, id, { env, spawnFn = spawn, timeout = 120000, runtimeDirectory = os.tmpdir(), pick = null } = {}) {
  const agent = agentList.describe().find(a => a.id === id);
  if (!agent?.launch) return { ok:false, said:"", error:"Not installed." };
  const saved = id === "dsh" ? dshSavedKeys({ DSH_HOME:dshHome(env) }) : {};
  const redactDiagnostics = (commandEnv, selectedRef) => {
    const refs = new Set(id === "dsh" ? Object.keys(commandEnv || {}).filter(key => key !== "DSH_HOME") : []);
    if (selectedRef) refs.add(selectedRef);
    return diagnosticRedactor({ ...env, ...commandEnv }, saved, refs);
  };
  const folder = fs.mkdtempSync(path.join(id === "dsh" ? runtimeDirectory : os.tmpdir(), "penecho-check-"));
  let command;
  try {
    // A level the model does not take is turned down here as it is before a Work, with the agent's own list read first.
    await agentList.listLevels?.(id).catch(() => null);
    command = agentList.command(id, { workdir:folder, docs:folder, gitDir:"", also:[], resume:null, plain:true, instructions:"", name:"PenEcho check", runtimeDirectory:folder, ...(pick || {}) });
    if (command?.dshPatch) command.args = stageDshPatch(command, folder);
  } catch (error) {
    fs.rmSync(folder, { recursive:true, force:true });
    return { ok:false, said:"", error:redactDiagnostics(command?.env)(error.message) };
  }
  if (!command) { fs.rmSync(folder, { recursive:true, force:true }); return { ok:false, said:"", error:"PenEcho cannot run it in the background." }; }
  const childEnv = command.prepareEnv ? command.prepareEnv(env, command.env) : prepareAgentEnv(env, command.env, { platform:process.platform }); delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  if (command.cwd) { delete childEnv.PWD; delete childEnv.OLDPWD; }
  // Claude Code reads stream-json, so its words go in as one JSON user line, not as bare text.
  const streaming = command.input === "stream-json" && !command.promptLast;
  // Pi and omp in RPC mode read JSON commands, and quit as soon as stdin closes, before the model answers.
  // So their stdin stays open until the run ends, or the prompt is turned down, and any dialog is cancelled, with nobody there to answer.
  const rpc = command.input === "pi-rpc" && !command.promptLast;
  const said = rpc ? piRpcInit(TRY_WORDS) : streaming ? userLine(TRY_WORDS, command.dialect) : TRY_WORDS;
  const result = await new Promise(resolve => {
    let stdout = "", stderr = "", timedOut = false;
    const outputDecoder = new StringDecoder("utf8"), errorDecoder = diagnosticDecoder({ env:childEnv });
    let child;
    try { child = spawnFn(command.command, command.promptLast ? [...command.args, TRY_WORDS] : command.args, { cwd:command.cwd, env:childEnv, stdio:["pipe", "pipe", "pipe"], windowsHide:true }); }
    catch (error) { resolve({ code:-1, stdout, stderr:error.message, timedOut }); return; }
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeout);
    let pending = "", inputOpen = rpc;
    const rpcLine = line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event?.type === "extension_ui_request" && event.id && ["select", "confirm", "input", "editor"].includes(event.method) && inputOpen) child.stdin?.write(piRpcUiResponse(event.id, event.method, "", true));
      if (event?.type === "agent_end" || (event?.type === "response" && event.command === "prompt" && event.success === false)) { inputOpen = false; child.stdin?.end(); }
    };
    child.stdout?.on("data", chunk => {
      const text = typeof chunk === "string" ? chunk : outputDecoder.write(chunk);
      stdout = (stdout + text).slice(-200000);
      if (!inputOpen) return;
      const lines = (pending + text).split("\n"); pending = lines.pop();
      lines.forEach(rpcLine);
    });
    child.stderr?.on("data", chunk => { stderr = (stderr + errorDecoder.write(chunk)).slice(-20000); });
    child.stdin?.on("error", () => {});
    if (rpc) child.stdin?.write(said); else child.stdin?.end(command.promptLast ? "" : said);
    child.on("error", error => {
      stderr += `\n${error.message}`;
      // A signal error can leave a spawned dsh alive. Its patch stays until close.
      if (command.dshPatch && child.pid) return;
      clearTimeout(timer);
      resolve({ code:-1, stdout, stderr, timedOut });
    });
    child.on("close", code => { clearTimeout(timer); stdout += outputDecoder.end(); stderr += errorDecoder.end(); resolve({ code, stdout, stderr, timedOut }); });
  });
  fs.rmSync(folder, { recursive:true, force:true });
  agentList.endRun?.(id, command.proxyRun);
  // An agent may repeat the words it was given, so OK counts only outside them.
  const ok = result.code === 0 && !result.timedOut && /\bOK\b/.test(result.stdout.split(TRY_WORDS).join("")) && !failedEvent(result.stdout);
  if (ok) return { ok:true, said:"OK", error:"" };
  const ref = id === "dsh" ? dshCredentialRef(childEnv, command.dshSelection ? `${command.dshSelection.provider}/${command.dshSelection.model}` : agent.picked) : "";
  const redact = redactDiagnostics(command.env, ref);
  const safeStderr = redact(result.stderr);
  const failure = failureOf(result.stdout, safeStderr, redact);
  const waited = result.timedOut ? waitedOn(result.stdout + result.stderr, redact) : "";
  const error = result.timedOut ? `No answer in ${Math.round(timeout / 1000)} seconds.${waited ? ` It was waiting on ${waited}.` : ""}` : failure || `It stopped with code ${result.code}.`;
  const shown = redact([command.command, ...command.args].map(word => (/\s/.test(word) ? `"${word}"` : word)).join(" "));
  return { ok:false, said:"", error, problem:{ kind:"fix", title:"A test run failed", detail:error, fix:`${agent.name} starts, but a short run from PenEcho did not answer. Copy the fix prompt into an agent that works.`,
    prompt:prompt(agent, `a short test run from PenEcho failed, although ${agent.app ? `${agent.app.name} works when I use it` : "the command starts"}.`, [`What it said: ${error}`, `Command PenEcho ran, in an empty folder, with the words ${command.promptLast ? "as the last argument" : "on stdin"}: ${shown}`, ...(command.env && Object.keys(command.env).length ? [`Settings PenEcho added for it: ${Object.keys(command.env).join(", ")}`] : []), ...(safeStderr.trim() ? [`Its last words on stderr: ${safeStderr.trim().split(/\r?\n/).slice(-3).join(" / ").slice(0, 600)}`] : [])],
      [`Run that command yourself with a short prompt and find out why it fails, comparing with how ${agent.app ? "the app" : "it"} runs it.`, "Fix what is wrong in this computer's settings for that agent, backing up any file before you change it. Do not put keys into a file that did not hold them.", "If the fix belongs in PenEcho itself, say exactly what PenEcho should change instead."], "When it works, Try again on PenEcho's Agent setup page says Answered.") } };
}

function createAgentCheck(agentList, { env = agentList.env || process.env, run = runCommand, reach = reachUrl, spawnFn, maxAge = 120000, runtimeDirectory, updates = null, updater = updateAgent } = {}) {
  let last = null, lastAt = 0, running = null;
  const tries = new Map(), modelCache = new Map(), installs = new Map(), updating = new Map();
  // Re-read disk-backed agent model files (e.g. ~/.codex/models_cache.json, ~/.codex/config.toml) on cached checks
  // so models fetched by an agent's own app or CLI appear in Settings immediately without waiting for maxAge.
  function refreshModels() {
    if (!last) return;
    const described = new Map(agentList.describe().map(item => [item.id, item]));
    last = {
      ...last,
      agents:last.agents.map(row => {
        const current = described.get(row.id);
        if (!current?.launch || current.builtIn || !row.model || row.id === "antigravity" || row.id === "opencode") return row;
        const freshModel = modelOf(row.id, env, current.launch.source || null);
        if (!freshModel) return row;
        const next = {
          ...row,
          model:{ ...freshModel, picked:current.picked ?? row.model.picked ?? "", pickedEffort:current.pickedEffort ?? row.model.pickedEffort ?? "" },
        };
        if (dshExtraProblems.has(row)) dshExtraProblems.set(next, dshExtraProblems.get(row));
        return next;
      }),
    };
  }
  // Each agent is asked once in parallel; a fresh check starts over, after an install, say.
  async function check({ fresh = false } = {}) {
    // Newer versions are looked for on the side: this answer carries what is already known, and a later one what the check found.
    updates?.refreshIfDue();
    if (!fresh && last && Date.now() - lastAt < maxAge) {
      refreshModels();
      return withTries();
    }
    if (running) return running;
    if (fresh) agentList.reset();
    // A fresh check forgets earlier test runs too: whatever they found may be fixed now.
    if (fresh) tries.clear();
    const described = agentList.describe().filter(agent => agent.cli || agent.app || agent.installFrom || agent.builtIn);
    running = Promise.all(described.map(agent => checkOne(agent, { env, run, reach, fresh, modelCache, pickModel:agentList.pickModel, levels:agentList.listLevels }))).then(agents => {
      installs.clear();
      if (updates) for (const agent of described) {
        const kind = agent.launch?.command ? installKind(agent.id, agent.launch.command, { home:env.HOME || env.USERPROFILE || os.homedir(), env }) : "";
        if (kind && kind !== "app") installs.set(agent.id, { kind, agent, install:agent.install || "" });
      }
      last = { agents, checkedAt:Date.now() };
      lastAt = Date.now();
      return withTries();
    }).finally(() => { running = null; });
    return running;
  }
  // The last test run of each agent shows on its row, and a failed one is a problem to fix like any other.
  function withTries() {
    const agents = last.agents.map(row => {
      const installed = row.version ? installs.get(row.id) : null, latest = installed ? updates.newer(row.id, row.version) : "";
      const failed = latest ? updates.failed(row.id, latest) : null;
      const a = latest ? { ...row, update:{ latest, auto:majorOf(latest) === majorOf(row.version), running:updating.has(row.id), failed:Boolean(failed), prompt:updatePrompt(row, latest, installed.install, failed?.said) } } : row;
      const tried = tries.get(a.id);
      if (!tried) return a;
      const problems = tried.problem ? [...a.problems, tried.problem] : a.problems;
      return { ...a, tried:{ ok:tried.ok, error:tried.error, at:tried.at }, problems, state:tried.problem && a.state === "ready" ? "problem" : a.state };
    });
    return { ...last, agents, problems:agents.reduce((n, a) => n + a.problems.filter(p => p.kind === "fix").length, 0) };
  }
  // One agent, to the version its row offers. A Work of this agent waits for it (agents.js whenUpdated).
  function updateOne(id) {
    if (updating.has(id)) return updating.get(id);
    const installed = installs.get(id), row = last?.agents.find(a => a.id === id), latest = installed && row?.version ? updates.newer(id, row.version) : "";
    if (!latest || majorOf(latest) !== majorOf(row.version)) return Promise.resolve(null);
    const childEnv = prepareAgentEnv(env, installed.agent.launch.env, { platform:process.platform, sandboxWindowsPath:id === "codex" });
    const job = Promise.resolve().then(() => updater(installed.agent, { env:childEnv, stateDir:runtimeDirectory, version:row.version, kind:installed.kind, run }))
      .catch(error => ({ ok:false, busy:false, said:error.message })).then(result => {
        if (!result.busy) updates.setFailed(id, latest, result.ok ? null : result.said);
        // The next look reads the versions anew.
        if (result.ok) lastAt = 0;
        return result;
      }).finally(() => updating.delete(id));
    updating.set(id, job);
    agentList.setUpdating?.(id, job);
    return job;
  }
  async function update(id) {
    if (!updates) return { error:"PenEcho cannot update agents here." };
    if (!last) await check();
    const result = await updateOne(id);
    if (running) await running.catch(() => {});
    return result?.ok ? check({ fresh:true }) : { ...withTries(), ...(result?.busy ? { updateBusy:true } : {}) };
  }
  const trying = new Map();
  // With a model and effort, from a saved agent's form, the run is only answered: it says nothing about the agent's own settings.
  async function tryRun(id, pick) {
    if (pick) {
      const model = String(pick.model ?? "").trim(), effort = String(pick.effort ?? "").trim();
      if (model.length > 200 || /^-|[\0-\x1f\x7f]/.test(model)) return { error:"A model name is one line of at most 200 characters, and does not start with a dash." };
      if (id === "dsh" && model && !validDshModel(model)) return { error:"Use a dsh model name or provider/model." };
      if (effort && !effortId(effort)) return { error:"An effort is one word of letters, digits, dots or dashes." };
      const { ok, error } = await tryOne(agentList, id, { env, runtimeDirectory, pick:{ model, effort }, ...(spawnFn ? { spawnFn } : {}) });
      return { tried:{ ok, error } };
    }
    if (trying.has(id)) return trying.get(id);
    const job = tryOne(agentList, id, { env, runtimeDirectory, ...(spawnFn ? { spawnFn } : {}) }).then(async result => {
      if (trying.get(id) === job) tries.set(id, { ...result, at:Date.now() });
      if (!last) await check();
      return withTries();
    }).finally(() => { if (trying.get(id) === job) trying.delete(id); });
    trying.set(id, job);
    return job;
  }
  // The model and reasoning level PenEcho runs an agent with: one its own settings name, any other name typed for it, or none for its own.
  // A typed name is kept as it is and handed to the agent, which knows its models better than its settings file says.
  // Either one left out of the request stays as it was. A level the newly picked model does not take goes back to the agent's own.
  async function pickModel(id, { model, effort } = {}) {
    if (!last || id === "dsh" && running) await (running || check());
    const row = last.agents.find(a => a.id === id);
    if (!row?.model || row.model.fixed || !agentList.pickModel) return { error:"PenEcho cannot pick a model for this agent." };
    const name = model === undefined ? row.model.picked : String(model ?? "").trim();
    // It becomes one word on the agent's command line, so it must be one that cannot be read as anything else.
    if (name.length > 200 || /^-|[\0-\x1f\x7f]/.test(name)) return { error:"A model name is one line of at most 200 characters, and does not start with a dash." };
    if (id === "dsh" && !validDshModel(name)) return { error:"Use a dsh model name or provider/model." };
    if (id === "penecho" && name && !row.model.choices.includes(name)) return { error:"Choose a model from PenEcho Cloud." };
    const levels = effortsWith(name || row.model.name, row.model);
    let level = effort === undefined ? row.model.pickedEffort : String(effort ?? "").trim();
    if (id === "dsh" && effort !== undefined && level && !effortId(level)) return { error:"An effort is one word of letters, digits, dots or dashes." };
    if (id !== "dsh" && effort !== undefined && level && !levels.includes(level)) return { error:`${name || row.model.name || row.name} does not take the reasoning level ${level}.` };
    if (level && !levels.includes(level) && (id !== "dsh" || effort === undefined && name !== row.model.picked)) level = "";
    const changed = name !== row.model.picked || level !== row.model.pickedEffort;
    agentList.pickModel(id, name, level);
    row.model = { ...row.model, picked:name, pickedEffort:level };
    if (id === "dsh" && changed) {
      tries.delete(id);
      trying.delete(id);
      const agent = agentList.describe().find(agent => agent.id === id);
      if (agent?.launch && dshExtraProblems.has(row)) refreshDshProblems(agent, env, row);
    }
    return withTries();
  }
  return { check, tryRun, pickModel, update };
}

module.exports = { createAgentCheck, runCommand, tryOne };
