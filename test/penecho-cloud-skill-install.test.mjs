import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { installSkill, openCodexSkillsApi, SKILL_FILES, verifySkill } from '../integrations/penecho-cloud/skills/penecho-canvas/scripts/install.mjs';
import { SERVER_NAME, SERVER_URL } from '../integrations/penecho-cloud/skills/penecho-canvas/scripts/setup-mcp.mjs';

const source = fileURLToPath(new URL('../integrations/penecho-cloud/skills/penecho-canvas', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'penecho-skill-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function cli(host, { installed = false, url = SERVER_URL, enabled = true } = {}) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, host);
    if (args[1] === 'list') return { status: 0, stdout: host === 'codex' ? '[]' : 'No MCP servers configured.' };
    if (args[1] === 'add') { installed = true; return { status: 0 }; }
    assert.equal(args[1], 'get');
    return installed ? { status: 0, stdout: host === 'codex'
      ? JSON.stringify({ name: SERVER_NAME, enabled, transport: { type: 'streamable_http', url } })
      : `Type: http\nURL: ${url}\nStatus: ${enabled ? 'Needs authentication' : 'Disabled'}\n` }
      : { status: 1, stderr: `No MCP server named '${SERVER_NAME}' found.` };
  };
  return { run, calls };
}
function skillApi(skillPath, enabled = true, { discovered = true, enableFails = false } = {}) {
  const calls = [];
  return { calls, open: async () => ({
    list: async cwd => { calls.push({ method: 'skills/list', cwd }); return { data: [{ cwd, skills: discovered ? [{ name: 'penecho-canvas', path: await realpath(skillPath), enabled }, { name: 'unrelated', path: join(cwd, 'other/SKILL.md'), enabled: false }] : [], errors: [] }] }; },
    enable: async path => { calls.push({ method: 'skills/config/write', path, enabled: true }); if (enableFails) throw new Error('Rejected'); enabled = true; },
    close: () => calls.push({ method: 'close' }),
  }) };
}

for (const host of ['codex', 'claude']) {
  test(`${host}: complete persistent install, preservation, repeat and same-directory reinstall`, async t => {
    const home = await fixture(t);
    const directory = join(home, host === 'codex' ? '.agents' : '.claude', 'skills/penecho-canvas');
    const other = join(home, 'unrelated-config');
    await writeFile(other, 'preserve credentials and unrelated settings');
    const native = cli(host);
    const api = skillApi(join(directory, 'SKILL.md'));
    const options = { host, surface: 'local', sourceDirectory: source, homeDirectory: home, cwd: home, run: native.run, openSkillApi: api.open };
    const first = await installSkill(options);
    assert.equal(first.skill.path, directory);
    assert.equal(first.readiness, 'verification-required');
    assert.equal(first.mcp.status, 'added');
    for (const name of SKILL_FILES) assert.deepEqual(await readFile(join(directory, name)), await readFile(join(source, name)));
    await writeFile(join(directory, 'personal-notes.txt'), 'retain');
    const before = (await stat(join(directory, 'SKILL.md'))).mtimeMs;
    const second = await installSkill(options);
    const same = await installSkill({ ...options, sourceDirectory: directory });
    assert.equal(second.skill.status, 'existing');
    assert.equal(same.skill.status, 'existing');
    assert.equal((await stat(join(directory, 'SKILL.md'))).mtimeMs, before);
    assert.equal(native.calls.filter(call => call.args[1] === 'add').length, 1);
    assert.equal(await readFile(other, 'utf8'), 'preserve credentials and unrelated settings');
    assert.equal(await readFile(join(directory, 'personal-notes.txt'), 'utf8'), 'retain');
    assert.ok(native.calls.every(call => !call.args.includes('login') && !call.args.includes('logout')));
  });
}

test('reuse an existing supported legacy Codex Skill path instead of creating a duplicate', async t => {
  const home = await fixture(t);
  const legacy = join(home, '.codex/skills/penecho-canvas');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'SKILL.md'), '---\nname: penecho-canvas\ndescription: Old supported version\n---\n');
  const native = cli('codex', { installed: true });
  const api = skillApi(join(legacy, 'SKILL.md'));
  const result = await installSkill({ host: 'codex', surface: 'local', homeDirectory: home, run: native.run, openSkillApi: api.open });
  assert.equal(result.skill.path, legacy);
  await assert.rejects(stat(join(home, '.agents/skills/penecho-canvas')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(legacy, 'scripts/install.mjs')), await readFile(join(source, 'scripts/install.mjs')));
});

test('enable only the exact installed disabled Skill using native API and rescan', async t => {
  const home = await fixture(t);
  const target = join(home, '.agents/skills/penecho-canvas/SKILL.md');
  const api = skillApi(target, false);
  const result = await installSkill({ host: 'codex', surface: 'local', homeDirectory: home, cwd: home, run: cli('codex', { installed: true }).run, openSkillApi: api.open });
  assert.equal(result.skill.activation.status, 'enabled');
  assert.equal(result.skill.activation.changed, true);
  assert.equal(result.readiness, 'verification-required');
  assert.deepEqual(api.calls.filter(call => call.method === 'skills/config/write'), [{ method: 'skills/config/write', path: await realpath(target), enabled: true }]);
  assert.equal(api.calls.filter(call => call.method === 'skills/list').length, 2);
});

test('unavailable discovery, undiscovered paths and rejected enable never become ready', async t => {
  const home = await fixture(t);
  const target = join(home, '.agents/skills/penecho-canvas/SKILL.md');
  for (const [open, expected] of [[async () => { throw new Error('Unsupported API'); }, 'unverified'], [skillApi(target, true, { discovered: false }).open, 'unverified'], [skillApi(target, false, { enableFails: true }).open, 'enable-required']]) {
    const native = cli('codex', { installed: true });
    const result = await installSkill({ host: 'codex', surface: 'local', homeDirectory: home, cwd: home, run: native.run, openSkillApi: open });
    assert.equal(result.skill.activation.status, expected);
    assert.equal(result.readiness, 'verification-required');
    assert.ok(native.calls.every(call => call.args[0] === 'mcp' && call.args[1] === 'get'));
  }
});

test('an account or sandbox CLI does not authorize or prove persistent desktop installation', async t => {
  const home = await fixture(t);
  const native = cli('claude');
  for (const surface of [undefined, 'cowork', 'chat', 'sandbox']) {
    await assert.rejects(installSkill({ host: 'claude', surface, homeDirectory: home, run: native.run }), /Finding a CLI there is insufficient/);
  }
  assert.equal(native.calls.length, 0);
  await assert.rejects(stat(join(home, '.claude')), { code: 'ENOENT' });
});

test('conflicting or disabled MCP is refused before copying or native Skill enable', async t => {
  const home = await fixture(t);
  for (const config of [{ installed: true, url: 'https://internaltest.penecho.ai/mcp' }, { installed: true, enabled: false }]) {
    const native = cli('codex', config);
    await assert.rejects(installSkill({ host: 'codex', surface: 'local', homeDirectory: home, run: native.run, openSkillApi: () => { throw new Error('must not enable'); } }), /preserved/);
    assert.equal(native.calls.length, 1);
  }
  await assert.rejects(stat(join(home, '.agents')), { code: 'ENOENT' });
});

test('later symlink or non-file conflicts are preflighted before any existing Skill is overwritten', async t => {
  const home = await fixture(t);
  const directory = join(home, '.agents/skills/penecho-canvas');
  await mkdir(directory, { recursive: true });
  const original = '---\nname: penecho-canvas\ndescription: Existing customized Skill\n---\n';
  await writeFile(join(directory, 'SKILL.md'), original);
  await symlink(source, join(directory, 'scripts'));
  await assert.rejects(installSkill({ host: 'codex', surface: 'local', homeDirectory: home, run: cli('codex', { installed: true }).run }), /symbolic link/);
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), original);
  await rm(join(directory, 'scripts'));
  await mkdir(join(directory, 'scripts/install.mjs'), { recursive: true });
  await assert.rejects(installSkill({ host: 'codex', surface: 'local', homeDirectory: home, run: cli('codex', { installed: true }).run }), /not a regular file/);
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), original);
});

test('incomplete source is rejected without partial installation', async t => {
  const home = await fixture(t);
  const incomplete = join(home, 'unpacked');
  await cp(source, incomplete, { recursive: true });
  await rm(join(incomplete, 'scripts/setup-mcp.mjs'));
  const native = cli('claude');
  await assert.rejects(installSkill({ host: 'claude', surface: 'local', sourceDirectory: incomplete, homeDirectory: home, run: native.run }), { code: 'ENOENT' });
  assert.equal(native.calls.length, 0);
  await assert.rejects(stat(join(home, '.claude')), { code: 'ENOENT' });
});

test('native discovery matches canonical Skill paths through a temporary-root alias', async t => {
  const root = await fixture(t);
  const actual = join(root, 'actual');
  await mkdir(actual);
  await writeFile(join(actual, 'SKILL.md'), 'canonical');
  const alias = join(root, 'alias');
  await symlink(actual, alias);
  const api = skillApi(join(actual, 'SKILL.md'));
  const result = await verifySkill({ host: 'codex', skillPath: join(alias, 'SKILL.md'), cwd: root, openSkillApi: api.open });
  assert.equal(result.status, 'enabled');
});

test('bounded app-server adapter initializes, uses native Skill methods and closes its process', async () => {
  const messages = [];
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  let killed = false; child.kill = () => { killed = true; };
  child.stdin.on('data', bytes => {
    const message = JSON.parse(bytes.toString()); messages.push(message);
    if (message.id) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: message.method === 'skills/list' ? { data: [] } : {} })}\n`));
  });
  const api = await openCodexSkillsApi({ spawnProcess: (command, args, options) => { assert.equal(command, 'codex'); assert.deepEqual(args, ['app-server', '--stdio']); assert.equal(options.shell, false); return child; } });
  await api.list('/project'); await api.enable('/user/skills/penecho-canvas/SKILL.md'); api.close();
  assert.deepEqual(messages.map(message => message.method), ['initialize', 'initialized', 'skills/list', 'skills/config/write']);
  assert.deepEqual(messages[2].params, { cwds: ['/project'], forceReload: true });
  assert.deepEqual(messages[3].params, { path: '/user/skills/penecho-canvas/SKILL.md', enabled: true });
  assert.equal(killed, true);
});
