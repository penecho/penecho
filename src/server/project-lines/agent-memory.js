"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("./format.js");
const { encodeFolder } = require("./conversations.js");

// What each agent keeps in its own memory about a project's folders. PenEcho only reads these, and never copies them into the docs folder, which can be shared.
const NOTE_MOST = 1024 * 1024, CODEX_MOST = 32 * 1024 * 1024;
const readText = (file, most = NOTE_MOST) => {
  try { const stat = fs.statSync(file); return stat.isFile() && stat.size <= most ? fs.readFileSync(file, "utf8") : ""; } catch { return ""; }
};
const titleOf = name => name.replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Claude Code: one folder of notes per repository, with an index that gives each its title and a short hook.
function claudeNotes(home, folders) {
  const notes = [];
  for (const folder of folders) {
    const key = encodeFolder(folder), dir = path.join(home, "projects", key, "memory");
    let names;
    try { names = fs.readdirSync(dir).filter(name => /\.md$/i.test(name) && name !== "MEMORY.md"); } catch { continue; }
    const index = new Map([...readText(path.join(dir, "MEMORY.md")).matchAll(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]+\s*(.*))?$/gm)].map(m => [m[2], { title:m[1], hook:m[3] || "" }]));
    for (const name of names) {
      const file = path.join(dir, name), { front, body } = F.splitFront(readText(file)), listed = index.get(name);
      let at = 0;
      try { at = fs.statSync(file).mtimeMs; } catch { continue; }
      notes.push({ id:`${key}/${name}`, name:listed?.title || titleOf(front.name || name), about:listed?.hook || front.description || "", at, body });
    }
  }
  return notes.sort((a, b) => b.at - a.at);
}
// Codex: one file for everything it remembers, in task groups that each say which folder they apply to.
function codexNotes(home, folders) {
  const file = path.join(home, "memories", "MEMORY.md"), text = readText(file, CODEX_MOST);
  if (!text) return [];
  const within = folders.map(folder => new RegExp(`(?:^|[=\\s\`'"(])${escapeRe(folder)}(?:[\\s,;:\`'")/]|$)`)), seen = new Map();
  return text.split(/^(?=# Task Group: )/m).filter(group => group.startsWith("# Task Group: ")).flatMap(group => {
    const applies = group.match(/^applies_to:\s*(.*)$/m)?.[1] || "";
    if (!within.some(re => re.test(applies))) return [];
    const name = group.split("\n")[0].slice("# Task Group: ".length).trim(), times = seen.get(name) || 0;
    seen.set(name, times + 1);
    return [{ id:`${F.hashText(name)}-${times}`, name, about:group.match(/^scope:\s*(.*)$/m)?.[1] || "", at:0, body:group.trimEnd() }];
  });
}
class AgentMemory {
  constructor({ env = process.env, home = os.homedir() } = {}) {
    this.claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
    this.codexHome = env.CODEX_HOME || path.join(home, ".codex");
  }
  notes(agent, folders) {
    if (agent === "claude") return claudeNotes(this.claudeHome, folders);
    if (agent === "codex") return codexNotes(this.codexHome, folders);
    return [];
  }
  list(folders) {
    return ["claude", "codex"].map(agent => ({ agent, rows:this.notes(agent, folders).map(({ id, name, about }) => ({ id, name, about })) })).filter(group => group.rows.length);
  }
  // Only ever a note the list would show: what is asked for is matched against those, and never used as a path.
  read(agent, id, folders) {
    const note = this.notes(agent, folders).find(n => n.id === id);
    return note ? { name:note.name, md:note.body } : null;
  }
}

module.exports = { AgentMemory };
