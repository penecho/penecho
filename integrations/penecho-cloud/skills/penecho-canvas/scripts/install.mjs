#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cliInvocation, ensureMcp, isMainModule, runCli } from './setup-mcp.mjs';

export const SKILL_FILES = ['SKILL.md', 'agents/openai.yaml', 'references/mcp.json', 'scripts/setup-mcp.mjs', 'scripts/install.mjs'];
const sourceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

// A short-lived native app-server scan verifies persistent Skill state. It does
// not reload the running desktop conversation or prove that its MCP tools exist.
export async function openCodexSkillsApi({ spawnProcess = spawn } = {}) {
  const invocation = cliInvocation('codex', ['app-server', '--stdio']);
  const child = spawnProcess(invocation.command, invocation.args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let nextId = 0;
  const rejectAll = () => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Native Skill API unavailable.')); } pending.clear(); };
  child.on('error', rejectAll);
  child.on('exit', rejectAll);
  child.stdin.on('error', rejectAll);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error('Native Skill request was rejected.'));
    else request.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native Skill request timed out.')); }, 15000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const close = () => { rejectAll(); lines.close(); child.stdin.end(); child.kill(); };
  try {
    await request('initialize', { clientInfo: { name: 'penecho-installer', version: '1.1.4' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    return {
      list: cwd => request('skills/list', { cwds: [cwd], forceReload: true }),
      enable: path => request('skills/config/write', { path, enabled: true }),
      close,
    };
  } catch (error) { close(); throw error; }
}

export async function verifySkill({ host, skillPath, cwd = process.cwd(), openSkillApi = openCodexSkillsApi }) {
  if (host !== 'codex') return { status: 'unverified', reason: 'host-skill-discovery-required' };
  let api, observed;
  const canonical = async path => {
    const normalized = await realpath(path).catch(() => resolve(path));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const target = await canonical(skillPath);
  const directory = await canonical(dirname(skillPath));
  const find = async result => {
    if (!Array.isArray(result?.data)) throw new Error('Unsupported Skill discovery response.');
    for (const skill of result.data.flatMap(entry => entry.skills || [])) {
      if (skill.name === 'penecho-canvas' && typeof skill.path === 'string' && [target, directory].includes(await canonical(skill.path))) return skill;
    }
    return undefined;
  };
  try {
    api = await openSkillApi();
    observed = await find(await api.list(cwd));
    if (!observed) return { status: 'unverified', reason: 'installed-path-not-discovered' };
    if (observed.enabled === false) {
      await api.enable(observed.path);
      observed = await find(await api.list(cwd));
      if (observed?.enabled !== true) return { status: 'enable-required', reason: 'native-enable-not-verified' };
      return { status: 'enabled', verification: 'native-skills-list', changed: true };
    }
    if (observed.enabled !== true) return { status: 'unverified', reason: 'native-enable-state-unknown' };
    return { status: 'enabled', verification: 'native-skills-list', changed: false };
  } catch {
    return { status: observed?.enabled === false ? 'enable-required' : 'unverified', reason: 'native-skill-api-unavailable' };
  } finally { api?.close?.(); }
}

async function checkedFile(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Skill source must contain regular files; symbolic links are not installed.');
  return readFile(path);
}

async function safeDestination(path, root) {
  for (let current = path; current !== root && current !== dirname(current); current = dirname(current)) {
    if (await exists(current) && (await lstat(current)).isSymbolicLink()) throw new Error('A Skill installation destination is a symbolic link; it was preserved.');
  }
}

export async function installSkill({ host, surface, sourceDirectory = sourceDefault, homeDirectory = homedir(), cwd = process.cwd(), run = runCli, openSkillApi = openCodexSkillsApi }) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Select the current local host with --host codex or --host claude.');
  if (surface !== 'local') throw new Error('Persistent local installation requires a verified local Codex or Claude Code host. Claude Chat/Cowork account or sandbox installation requires its native plugin/connector UI. Finding a CLI there is insufficient.');
  const source = await realpath(sourceDirectory);
  const payloads = await Promise.all(SKILL_FILES.map(async name => {
    await safeDestination(join(source, name), source);
    return [name, await checkedFile(join(source, name))];
  }));
  if (!/^name:\s*penecho-canvas\s*$/m.test(payloads[0][1].toString())) throw new Error('The source is not the canonical penecho-canvas Skill.');
  const roots = host === 'claude' ? [join(homeDirectory, '.claude', 'skills')]
    : [join(homeDirectory, '.agents', 'skills'), join(homeDirectory, '.codex', 'skills')];
  const candidates = roots.map(root => join(root, 'penecho-canvas'));
  let destination = candidates[0];
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'SKILL.md'))) { destination = candidate; break; }
  }
  const root = resolve(homeDirectory);
  await safeDestination(destination, root);
  if (await exists(join(destination, 'SKILL.md')) && !/^name:\s*penecho-canvas\s*$/m.test((await readFile(join(destination, 'SKILL.md'))).toString())) {
    throw new Error('The existing Skill directory belongs to another Skill; it was preserved.');
  }
  // Refuse conflicting/disabled MCP before changing files. Listing also avoids
  // duplicating a verified alias or an installed plugin's production connection.
  const preflight = await ensureMcp({ host, checkOnly: true, run });
  for (const [name] of payloads) {
    const file = join(destination, name);
    await safeDestination(file, root);
    if (await exists(file) && !(await lstat(file)).isFile()) throw new Error('A Skill destination is not a regular file; the installation was preserved.');
    for (let parent = dirname(file); parent !== root && parent !== dirname(parent); parent = dirname(parent)) {
      if (await exists(parent) && !(await lstat(parent)).isDirectory()) throw new Error('A Skill parent is not a directory; the installation was preserved.');
    }
  }
  let changed = 0;
  for (const [name, content] of payloads) {
    const file = join(destination, name);
    if (await exists(file) && (await readFile(file)).equals(content)) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content); changed++;
  }
  const mcp = preflight.status === 'missing' ? await ensureMcp({ host, run }) : preflight;
  const activation = await verifySkill({ host, skillPath: join(destination, 'SKILL.md'), cwd, openSkillApi });
  return {
    host, skill: { path: destination, status: changed ? 'installed-or-updated' : 'existing', activation }, mcp,
    readiness: 'verification-required',
    next: ['host-supported-reload', 'current-session-tool-discovery', 'authenticated-read-only-profile-or-list-call'],
  };
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== '--host' || args[2] !== '--surface' || args[3] !== 'local') throw new Error('Usage: node scripts/install.mjs --host codex|claude --surface local (only after verifying the actual host).');
    console.log(JSON.stringify(await installSkill({ host: args[1], surface: args[3] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
