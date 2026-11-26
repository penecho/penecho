"use strict";
const path = require("node:path");
const fs = require("node:fs");

// The programs an unattended run may start, since nobody is there to approve a command: everyday tools for building, testing and looking things up.
// Claude Code gets this list as its allowed Bash tools, and the PenEcho runner checks each command against it here.
// The ones that only look or wait were refused most often in real runs (PE-485): none can run another program or write a file.
const RUN_COMMANDS = ["git", "gh", "npm", "npx", "node", "pnpm", "yarn", "python", "python3", "pip", "pytest", "go", "cargo", "make", "ls", "cat", "head", "tail", "grep", "rg", "find", "sed", "awk", "wc", "diff", "sort", "mkdir", "cp", "mv", "touch", "echo", "curl",
  "pwd", "date", "which", "sleep", "true", "false", "uname", "basename", "dirname", "realpath", "stat", "tr", "cut", "jq"];
// Commands whose arguments name what they write. A program such as node or python can still write anywhere it likes, as it can for any agent.
const WRITES_ALL = new Set(["mkdir", "touch", "mv"]), WRITES_LAST = new Set(["cp"]);

const pathMod = platform => (platform === "win32" ? path.win32 : path);
const MSYS_DRIVE = /^\/(?:cygdrive\/)?([A-Za-z])(?=\/|$)/;
const normalizeShellPath = (file, platform) => {
  const raw = String(file || "");
  if (platform !== "win32") return raw;
  return raw.replace(MSYS_DRIVE, (_, drive) => `${drive.toUpperCase()}:/`);
};
const physical = (target, platform = process.platform) => {
  const pathOps = pathMod(platform);
  if (platform !== process.platform) return pathOps.resolve(target);
  // A file that is not there yet is judged by the nearest folder that is.
  let current = pathOps.resolve(target), rest = [];
  for (;;) {
    try { return pathOps.join(fs.realpathSync(current), ...rest); } catch { /* Not there yet. */ }
    const parent = pathOps.dirname(current);
    if (parent === current) return pathOps.resolve(target);
    rest.unshift(pathOps.basename(current)); current = parent;
  }
};
function inside(roots, target, platform = process.platform) {
  const pathOps = pathMod(platform);
  const real = physical(target, platform);
  return roots.some(root => { const rel = pathOps.relative(physical(root, platform), real); return !rel || (!rel.startsWith("..") && !pathOps.isAbsolute(rel)); });
}

// One command line, cut into words and the signs between simple commands. Quotes keep their words whole; nothing is expanded.
function words(line) {
  const out = []; let word = "", has = false, quote = "";
  const push = () => { if (has) out.push({ word }); word = ""; has = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (quote === '"' && c === "\\" && i + 1 < line.length && /[$`"\\\n]/.test(line[i + 1])) word += line[++i];
      else if (quote === '"' && (c === "`" || (c === "$" && line[i + 1] === "("))) return { error:"Command substitution is not allowed." };
      else word += c;
      continue;
    }
    // $'…' and $"…" turn escapes into any character, and a # starting a word hides the rest of the line: either could hide a second command.
    if (c === "$" && (line[i + 1] === "'" || line[i + 1] === '"')) return { error:"$'…' and $\"…\" quoting is not allowed. Use plain quotes." };
    if (c === "#" && !has) return { error:"A comment (#) is not allowed in a command." };
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === "\\" && i + 1 < line.length) { word += line[++i]; has = true; continue; }
    if (c === "`" || (c === "$" && line[i + 1] === "(")) return { error:"Command substitution is not allowed." };
    if ((c === "<" || c === ">") && line[i + 1] === "(") return { error:"Process substitution is not allowed." };
    // find's {} and a name such as stash@{0} are plain words.
    if (c === "{" && line[i + 1] === "}") { word += "{}"; has = true; i++; continue; }
    if (c === "(" || c === ")" || c === "{" || c === "}") { if (has && (c === "{" || c === "}")) { word += c; continue; } return { error:"Grouping with ( ) or { } is not allowed." }; }
    if (c === " " || c === "\t") { push(); continue; }
    if (c === "\n" || c === ";") { push(); out.push({ sign:";" }); continue; }
    if (c === "&" && line[i + 1] === "&") { push(); out.push({ sign:"&&" }); i++; continue; }
    if (c === "|" && line[i + 1] === "|") { push(); out.push({ sign:"||" }); i++; continue; }
    if (c === "|") { push(); out.push({ sign:"|" }); if (line[i + 1] === "&") i++; continue; }
    if (c === ">" || c === "<" || (c === "&" && line[i + 1] === ">")) {
      // 2>&1 and the like join two outputs and write no file.
      const fd = /^\d+$/.test(word) ? word : ""; if (fd) { word = ""; has = false; } else push();
      let sign = c; if (c === "&") sign += line[++i];
      if (line[i + 1] === ">" || (sign === "<" && line[i + 1] === "<")) sign += line[++i];
      if (sign === "<<") return { error:"Here-documents are not allowed. Use the write tool to make a file." };
      if (line[i + 1] === "&") { i++; let to = ""; while (/[\d-]/.test(line[i + 1] || "")) to += line[++i]; if (!to) return { error:"That redirection is not allowed." }; continue; }
      out.push({ redirect:sign.includes(">") ? "write" : "read" });
      continue;
    }
    if (c === "&") return { error:"Running a command in the background with & is not allowed." };
    word += c; has = true;
  }
  if (quote) return { error:"The command has an unclosed quote." };
  push();
  return { words:out };
}

// Whether an unattended run may start this command line. `folders` are the ones the run may write in, `extra` whole commands allowed as they are typed (the project's memory command).
// What some listed programs can do beyond their plain use: run another program, or write a file the check would not see.
// This list is a convenience that turns a likely mistake into a clear refusal; the boundary is the OS sandbox the runner runs commands in.
const FIND_ESCAPES = /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/;
const SED_WRITES = /(?:^|[;{}\n\s0-9$/!])[wWe](?:\s|$)|s(.)(?:(?!\1).)*\1(?:(?!\1).)*\1[gpiImM0-9]*[we]/;
const AWK_ESCAPES = /\bsystem\s*\(|getline|\bprintf?\b[^;}]*[>|]|\|\s*"/;
const GIT_ESCAPES = /^(?:-c|--config-env(?:=.*)?|--exec-path(?:=.*)?|--upload-pack(?:=.*)?|--receive-pack(?:=.*)?|-u|--exec(?:=.*)?|-x|--extcmd(?:=.*)?|--tool(?:=.*)?)$/;
const GIT_RUNS = new Set(["filter-branch", "difftool", "mergetool", "daemon", "instaweb", "credential", "credential-store", "submodule"]);
// Flags whose value is a file the program writes.
const WRITE_FLAGS = { sort:["-o", "--output"], curl:["-o", "--output", "-D", "--dump-header", "-c", "--cookie-jar", "--trace", "--trace-ascii", "--stderr", "--libcurl", "--etag-save"], cp:["-t", "--target-directory"], mv:["-t", "--target-directory"] };
function flagValues(args, flags) {
  const out = [];
  for (let i = 1; i < args.length; i++) {
    for (const flag of flags) {
      if (args[i] === flag) out.push(args[i + 1] || "");
      else if (flag.startsWith("--") && args[i].startsWith(`${flag}=`)) out.push(args[i].slice(flag.length + 1));
      else if (!flag.startsWith("--") && args[i].startsWith(flag) && args[i].length > flag.length && !args[i].startsWith("--")) out.push(args[i].slice(flag.length));
    }
  }
  return out;
}
function escapes(name, args) {
  if (name === "find" && args.some(arg => FIND_ESCAPES.test(arg))) return "find's -exec, -ok, -delete and -fprint are not allowed. List with find, then act with the file tools.";
  if (name === "sed" && args.some(arg => arg === "-f" || arg.startsWith("--file") || (!arg.startsWith("-") && SED_WRITES.test(arg)))) return "sed may not write files or run commands (w, W, e) or read a script file.";
  if (name === "awk" && args.some(arg => arg === "-f" || arg.startsWith("--file") || (!arg.startsWith("-") && AWK_ESCAPES.test(arg)))) return "awk may not run commands, read with getline or write files.";
  if (name === "git") {
    if (args.slice(1).some(arg => GIT_ESCAPES.test(arg))) return "That git option can run another program. Run plain git.";
    const sub = args.slice(1).find(arg => !arg.startsWith("-")) || "";
    if (GIT_RUNS.has(sub) || (sub === "bisect" && args.includes("run"))) return `git ${sub} is not allowed in an unattended run.`;
    if (sub === "config" && !args.some(arg => ["--get", "--get-all", "--list", "-l", "--get-regexp"].includes(arg))) return "git config may only be read (--get or --list).";
  }
  if (name === "curl" && args.some(arg => arg === "-K" || arg.startsWith("--config"))) return "curl may not read a config file.";
  if (name === "gh" && ["alias", "extension"].includes(args.find((arg, i) => i > 0 && !arg.startsWith("-")))) return "gh alias and gh extension are not allowed in an unattended run.";
  return "";
}
function checkCommand(command, { cwd, folders = [], extra = [], strictReads = false, platform = process.platform } = {}) {
  const source = String(command || "");
  if (!source.trim()) return { ok:false, why:"The command is empty." };
  if (source.length > 20000 || source.includes("\0")) return { ok:false, why:"The command is too long." };
  const cut = words(source);
  if (cut.error) return { ok:false, why:cut.error };
  const roots = [cwd, ...folders].filter(Boolean);
  const pathOps = pathMod(platform);
  const home = process.env.HOME || (platform === "win32" ? process.env.USERPROFILE : "") || "~";
  // A path the shell would change before using it cannot be judged here, so a file to write is named plainly.
  let here = cwd || process.cwd();
  const at = file => {
    const expanded = String(file || "").replace(/^~(?=$|[\\/])/, home);
    return pathOps.resolve(here, normalizeShellPath(expanded, platform));
  };
  const allowed = file => {
    const raw = String(file || "");
    if (/[$`{]/.test(raw) || /^~[^\\/]/.test(raw)) return false;
    if (platform === "win32") {
      if (/^[A-Za-z]:(?![\\/])/.test(raw)) return false;
      // In Git Bash on Windows, POSIX-rooted paths other than /dev/null and /<drive>/... point into MSYS2's root.
      if (raw.startsWith("/") && !raw.startsWith("//") && !MSYS_DRIVE.test(raw)) return false;
    }
    return inside(roots, at(raw), platform);
  };
  // A command allowed as it is typed is compared word for word, so its quotes do not matter.
  const allowedAsTyped = extra.map(text => (words(String(text)).words || []).map(item => item.word ?? "").join(" "));
  const parts = [[]];
  for (const item of cut.words) { if (item.sign) parts.push([]); else parts[parts.length - 1].push(item); }
  for (const part of parts) {
    if (!part.length) continue;
    const args = [];
    for (let i = 0; i < part.length; i++) {
      if (!part[i].redirect) { args.push(part[i].word); continue; }
      const target = part[++i]?.word;
      if (!target) return { ok:false, why:"A redirection names no file." };
      if (part[i - 1].redirect === "write" && target !== "/dev/null" && !allowed(target)) return { ok:false, why:`Writing to ${target} is outside this run's folders.` };
      if (strictReads && part[i - 1].redirect === "read" && target !== "/dev/null" && !allowed(target)) return { ok:false, why:`${target} is outside this run's folders.` };
    }
    const name = args[0] || "";
    if (!name) return { ok:false, why:"A redirection has no command." };
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return { ok:false, why:"Setting a variable in front of a command is not allowed. Run the plain command." };
    const typed = args.join(" ");
    if (allowedAsTyped.some(prefix => prefix && (typed === prefix || typed.startsWith(`${prefix} `)))) continue;
    if (name === "cd") { if (!args[1] || !allowed(args[1])) return { ok:false, why:`${args[1] || "The home folder"} is outside this run's folders.` }; here = at(args[1]); continue; }
    if (!RUN_COMMANDS.includes(name)) return { ok:false, why:`${name} is not a command unattended runs may use. Allowed: ${RUN_COMMANDS.join(", ")}.` };
    const escape = escapes(name, args);
    if (escape) return { ok:false, why:escape };
    const files = args.slice(1).filter(arg => !arg.startsWith("-"));
    const targets = WRITE_FLAGS[name] ? flagValues(args, WRITE_FLAGS[name]) : [];
    if (targets.length && (WRITES_LAST.has(name) || name === "mv")) { const outside = targets.find(file => !allowed(file)); if (outside) return { ok:false, why:`${name} would write ${outside}, which is outside this run's folders.` }; }
    const written = [...(WRITES_ALL.has(name) ? files : WRITES_LAST.has(name) && !targets.length ? files.slice(-1) : name === "sed" && args.some(arg => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place")) ? files.slice(1) : []), ...targets.filter(file => file !== "-")];
    // With no OS sandbox around the shell, no argument may name a place outside the run's folders, for reading either.
    if (strictReads) {
      const named = args.slice(1).map(arg => arg.replace(/^--?[A-Za-z][\w-]*=/, "")).filter(arg => /^(?:[/\\~]|[A-Za-z]:)|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(arg) && arg !== "/dev/null");
      const far = named.find(arg => !allowed(arg));
      if (far) return { ok:false, why:`${far} is outside this run's folders.` };
    }
    const outside = written.find(file => !allowed(file));
    if (outside) return { ok:false, why:`${name} would write ${outside}, which is outside this run's folders.` };
  }
  return { ok:true };
}

module.exports = { RUN_COMMANDS, checkCommand, inside };
