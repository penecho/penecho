#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'penecho-cloud';
export const SERVER_URL = 'https://penecho.ai/mcp';

// npm's Windows .cmd launchers cannot be spawned with shell:false. Use their
// official package entrypoint directly; never concatenate arguments into cmd.exe.
// Current Claude Code packages ship a native bin/claude.exe; older ones cli.js.
export function cliInvocation(command, args, { platform = process.platform, pathValue = process.env.PATH || '', exists = existsSync, node = process.execPath } = {}) {
  if (platform !== 'win32') return { command, args };
  const path = win32;
  const candidates = /[/\\]/.test(command)
    ? [command]
    : pathValue.split(';').filter(Boolean).flatMap(directory => [path.join(directory, `${command}.exe`), path.join(directory, `${command}.cmd`)]);
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    if (/\.exe$/i.test(candidate)) return { command: candidate, args };
    if (/\.cmd$/i.test(candidate)) {
      const entries = /(?:^|[/\\])codex(?:\.cmd)?$/i.test(command)
        ? [['@openai', 'codex', 'bin', 'codex.js']]
        : /(?:^|[/\\])claude(?:\.cmd)?$/i.test(command) ? [['@anthropic-ai', 'claude-code', 'bin', 'claude.exe'], ['@anthropic-ai', 'claude-code', 'cli.js']] : [];
      for (const packagePath of entries) {
        const entry = path.join(path.dirname(candidate), 'node_modules', ...packagePath);
        if (exists(entry)) return /\.exe$/i.test(entry) ? { command: entry, args } : { command: node, args: [entry, ...args] };
      }
      throw new Error('Unsupported Windows CLI launcher. Use the host native executable or its official npm installation.');
    }
  }
  return { command, args };
}

// Keep configuration reads private: native CLI output can contain headers.
// An add command may start normal browser OAuth, so keep that command interactive.
export function runCli(command, args, { interactive = false } = {}) {
  return new Promise(resolveResult => {
    let invocation;
    try { invocation = cliInvocation(command, args); } catch (error) { resolveResult({ status: null, error }); return; }
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...(interactive ? {} : { timeout: 45000 }),
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data; });
    child.stderr?.on('data', data => { stderr += data; });
    child.on('error', error => resolveResult({ status: null, stdout, stderr, error }));
    child.on('close', status => resolveResult({ status, stdout, stderr }));
  });
}

function isCloudBridge(command, args) {
  if (!/(?:^|[/\\])npx(?:\.cmd)?$/.test(command || '') || !Array.isArray(args)) return false;
  const urls = args.filter(arg => /^https?:\/\//.test(arg));
  return args.some(arg => /^mcp-remote(?:@[^\s]+)?$/.test(arg))
    && urls.length > 0 && urls.every(url => url === SERVER_URL);
}

function matchesConfig(host, output, name = SERVER_NAME) {
  if (host === 'codex') {
    let config;
    try { config = JSON.parse(output); } catch { return false; }
    if (config.name !== name || config.enabled === false) return false;
    const transport = config.transport || {};
    return (transport.type === 'streamable_http' && transport.url === SERVER_URL)
      || (transport.type === 'stdio' && isCloudBridge(transport.command, transport.args));
  }
  const field = name => output.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'mi'))?.[1]?.trim();
  if (/disabled|pending approval/i.test(field('Status') || '')) return false;
  const type = field('Type')?.toLowerCase();
  return (type === 'http' && field('URL') === SERVER_URL)
    || (type === 'stdio' && isCloudBridge(field('Command'), field('Args')?.split(/\s+/)));
}

async function inspect(host, run, name = SERVER_NAME) {
  const args = ['mcp', 'get', name, ...(host === 'codex' ? ['--json'] : [])];
  const result = await run(host, args);
  if (result.error) {
    throw new Error(`Cannot run ${host} MCP setup. Check that its CLI is installed and executable.`);
  }
  if (result.status === 0) {
    if (!matchesConfig(host, result.stdout, name)) {
      throw Object.assign(new Error(`The existing ${name} configuration is incompatible or disabled. It was preserved; inspect it before changing it.`), { incompatible: true });
    }
    return true;
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  // A permission/configuration/health-check error must never be treated as absence.
  if (output.toLowerCase().includes(`no mcp server named '${name}'`.toLowerCase()) || output.toLowerCase().includes(`no mcp server named "${name}"`.toLowerCase())) return false;
  throw new Error(`Could not inspect ${host}'s ${SERVER_NAME} configuration (exit ${result.status}). Check CLI/configuration access; no connection was changed.`);
}

async function findAlias(host, run) {
  const listed = await run(host, ['mcp', 'list', ...(host === 'codex' ? ['--json'] : [])]);
  if (listed.error || listed.status !== 0) throw new Error(`Could not inspect ${host}'s other MCP connections. No connection was added.`);
  let names;
  if (host === 'codex') {
    let configs;
    try { configs = JSON.parse(listed.stdout); } catch { throw new Error('Could not read the native Codex MCP list. No connection was added.'); }
    if (!Array.isArray(configs)) throw new Error('Unsupported native Codex MCP list. No connection was added.');
    names = configs.filter(config => config.enabled !== false && matchesConfig(host, JSON.stringify(config), config.name)).map(config => config.name);
  } else {
    // Plugin names may contain colons. The separator before a URL is colon + whitespace.
    if (!/^\s*\S+:\s+.+$/m.test(listed.stdout || '') && !/No MCP servers configured/i.test(listed.stdout || '')) {
      throw new Error('Could not read the native Claude MCP list. No connection was added.');
    }
    names = (listed.stdout || '').split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s*(\S+):\s+(.*)$/);
      return match && /(?:^|\s)https:\/\/penecho\.ai\/mcp(?:\s|$)/.test(match[2]) ? [match[1]] : [];
    });
  }
  // A disabled or pending alias is not a usable connection; keep it untouched
  // and continue, as the Codex list filter above already does.
  for (const name of names) {
    if (name === SERVER_NAME) continue;
    try { if (await inspect(host, run, name)) return name; }
    catch (error) { if (!error.incompatible) throw error; }
  }
  return null;
}

export async function ensureMcp({ host, checkOnly = false, run = runCli }) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Select the current host with --host codex or --host claude.');
  const result = { host, name: SERVER_NAME, url: SERVER_URL };
  if (await inspect(host, run)) return { ...result, status: 'existing' };
  const alias = await findAlias(host, run);
  if (alias) return { ...result, name: alias, status: 'existing', alias: true };
  if (checkOnly) return { ...result, status: 'missing' };

  const args = host === 'codex'
    ? ['mcp', 'add', SERVER_NAME, '--url', SERVER_URL]
    : ['mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER_NAME, SERVER_URL];
  const added = await run(host, args, { interactive: true });
  if (added.error) throw new Error(`Cannot run ${host}'s native MCP add command. Check CLI/configuration access.`);
  if (!await inspect(host, run)) {
    throw new Error(`The native ${host} command did not configure ${SERVER_NAME}. No fallback credentials or settings were created.`);
  }
  // Codex can save the connection before its automatic OAuth attempt fails.
  // Keep that connection and resume normal login rather than adding it again.
  return { ...result, status: 'added', ...(added.status !== 0 ? { authorization: 'pending' } : {}) };
}

// import.meta.url is the real path; compare the real invoked path so symlinked
// skill directories (dotfiles, Windows junctions) still run the CLI.
export const isMainModule = (argv1, moduleUrl) => {
  if (!argv1) return false;
  try { return realpathSync(resolve(argv1)) === realpathSync(fileURLToPath(moduleUrl)); } catch { return false; }
};

if (isMainModule(process.argv[1], import.meta.url)) {
  const args = process.argv.slice(2);
  const hostIndex = args.indexOf('--host');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
  const expected = ['--host', host, ...(args.includes('--check') ? ['--check'] : [])];
  try {
    if (args.length !== expected.length || args.some(arg => !expected.includes(arg))) {
      throw new Error('Usage: node scripts/setup-mcp.mjs --host codex|claude [--check]');
    }
    const result = await ensureMcp({ host, checkOnly: args.includes('--check') });
    console.log(JSON.stringify(result));
    if (result.authorization === 'pending') process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
