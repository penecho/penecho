import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boundedText, textOutput } from './text.mjs'

// Running a shell command for an agent: one foreground command in its own process group, with bounded output, a deadline and a clean end.
// projectBashTool is the Canvas engine's tool: an OS sandbox around one project folder, with no network.
// The PenEcho runner for Lines uses runProjectShell and projectBashText with its own rule, the list of commands unattended runs may use (run-commands.js).
const PROJECT_BASH_COMMAND_LIMIT = 20_000

export function assertProjectCommand(command) {
  const source = String(command || '')
  if (!source.trim()) throw new Error('bash requires a non-empty command.')
  if (source.length > PROJECT_BASH_COMMAND_LIMIT || source.includes('\0')) throw new Error('The bash command is invalid or too large.')
  if (/(?:^|[\s"'`=:(])~(?:[\/\s"'`]|$)|\$(?:\{HOME\}|HOME)(?:[\/\s"'`]|$)/.test(source)) {
    throw new Error('Home-directory paths are outside the selected project.')
  }
  if (/(?:^|[\/\s"'`])\.\.(?:[\/\s"'`]|$)/.test(source)) throw new Error('Parent-directory traversal is outside the selected project.')
}

export function criticalProjectCommand(command) {
  const checks = [
    [/\b(?:rm|rmdir)\b/, 'This command removes project files.'],
    [/\bgit\s+(?:reset|clean|checkout|restore|switch|commit|push|rebase|merge)\b/, 'This command can materially change Git history or project files.'],
    [/\b(?:npm|pnpm|yarn|bun)\s+(?:install|uninstall|remove|add|update|upgrade|publish|link)\b/, 'This command changes project dependencies or publishes a package.'],
    [/\b(?:pip|pip3|uv|poetry|cargo|go)\s+(?:install|uninstall|remove|add|update|publish|get)\b/, 'This command changes dependencies or installs software.'],
    [/\b(?:chmod|chown|kill|pkill|killall|sudo|dd|mkfs|mount|umount)\b/, 'This command changes permissions, processes, or system-level state.'],
    [/\b(?:docker|podman)\b/, 'This command controls containers.'],
    [/(?:curl|wget)[^\n|;]*(?:\||;|&&)\s*(?:sh|bash|zsh)\b/, 'This command downloads and executes code.'],
  ]
  const highRisk = checks.find(([pattern]) => pattern.test(command))?.[1]
  if (highRisk) return highRisk
  const source = String(command || '').trim()
  if (/[\r\n;&|<>`$(){}]/.test(source)) return 'This Bash command uses shell composition or expansion and is not provably read-only.'
  // A command name is not a capability grammar: seemingly read-only programs
  // such as file(1) and tree(1) also have output modes. Keep the no-prompt set
  // intentionally closed and tiny; all richer Bash remains available after a
  // controlled-mode approval.
  if (/^pwd(?:\s+-(?:L|P))?$/.test(source)) return ''
  if (/^ls(?:\s+-[ACFHLRSUacdfghiklmnopqrstuvwx1]+)?(?:\s+\.)?$/.test(source)) return ''
  if (/^cat(?:\s+(?:--\s+)?[A-Za-z0-9._\/-]+)+$/.test(source)) return ''
  return 'This Bash command is outside PenEcho’s closed no-write command grammar.'
}

export function redactRuntimePath(text, session) {
  let output = String(text || '')
  for (const [privatePath, label] of [[session?.projectRuntimeDirectory, '<project-runtime>'], [session?.project?.path, '.']]) {
    if (privatePath) output = output.split(String(privatePath)).join(label)
  }
  return output
}

export function projectBashText(result, session) {
  let output = String(result.stdout?.text || '')
  const stderr = String(result.stderr?.text || '')
  if (stderr) output += `${output && !output.endsWith('\n') ? '\n' : ''}[stderr]\n${stderr}`
  output = redactRuntimePath(output, session)
  if (!output) output = '(no output)'
  const markers = []
  if (result.stdout?.truncated || result.stderr?.truncated) markers.push('[output truncated]')
  if (result.sandbox?.denied) markers.push('[project sandbox denied file access]')
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`)
  return boundedText(`${output}${markers.length ? `${output.endsWith('\n') ? '' : '\n'}${markers.join('\n')}` : ''}`, 100_000)
}

function executableAt(paths) {
  for (const candidate of paths) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate } catch {}
  }
  return ''
}

let cachedProjectShellSupport

function shellLiteral(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function probeProjectShellSupport(support) {
  // The sandbox matches real paths: on macOS the temporary folder is behind a link (/var → /private/var), so it is resolved first.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'penecho-bash-probe-')))
  try {
    const projectRoot = join(base, 'project'), runtimeRoot = join(base, 'runtime'), outsideRoot = join(base, 'outside')
    mkdirSync(projectRoot, { mode:0o700 }); mkdirSync(runtimeRoot, { mode:0o700 }); mkdirSync(outsideRoot, { mode:0o700 })
    writeFileSync(join(projectRoot, 'inside.txt'), 'inside', { mode:0o600 })
    writeFileSync(join(outsideRoot, 'secret.txt'), 'outside-secret', { mode:0o600 })
    const command = [
      'set -eu',
      'test "$(cat inside.txt)" = inside',
      'printf written > probe-written.txt',
      `if cat ${shellLiteral(join(outsideRoot, 'secret.txt'))} >/dev/null 2>&1; then exit 91; fi`,
      `if printf escaped > ${shellLiteral(join(outsideRoot, 'escaped.txt'))} 2>/dev/null; then exit 92; fi`,
      "if printf x >/dev/udp/127.0.0.1/9 2>/dev/null; then exit 93; fi",
    ].join('\n')
    const argv = projectShellArgv(support, command, projectRoot, runtimeRoot), probe = spawnSync(argv[0], argv.slice(1), {
      cwd:projectRoot,
      env:{ PATH:process.platform === 'darwin' ? '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' : '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin', HOME:runtimeRoot, TMPDIR:runtimeRoot, LANG:'C.UTF-8', LC_ALL:'C.UTF-8' },
      stdio:'ignore', timeout:3_000, windowsHide:true,
    })
    return probe.status === 0 && !probe.error
      && readFileSync(join(projectRoot, 'probe-written.txt'), 'utf8') === 'written'
      && readFileSync(join(outsideRoot, 'secret.txt'), 'utf8') === 'outside-secret'
      && !existsSync(join(outsideRoot, 'escaped.txt'))
  } catch { return false }
  finally { rmSync(base, { recursive:true, force:true }) }
}

export function projectShellSupport() {
  if (cachedProjectShellSupport !== undefined) return cachedProjectShellSupport
  const bash = executableAt(['/bin/bash', '/usr/bin/bash'])
  if (!bash) return (cachedProjectShellSupport = null)
  let support = null
  if (process.platform === 'darwin') {
    const runner = executableAt(['/usr/bin/sandbox-exec'])
    support = runner ? { kind:'seatbelt', runner, bash } : null
  } else if (process.platform === 'linux') {
    const runner = executableAt(['/usr/bin/bwrap', '/bin/bwrap'])
    support = runner ? { kind:'bwrap', runner, bash } : null
  }
  if (!support) return (cachedProjectShellSupport = null)
  // Prove positive in-project read/write and negative outside read/write and
  // networking before exposing Bash. Merely launching the runner is not a
  // confinement capability probe.
  return (cachedProjectShellSupport = probeProjectShellSupport(support) ? support : null)
}

function seatbeltString(value) {
  return `"${String(value).replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

function seatbeltProjectProfile(projectRoot, runtimeRoot) {
  const readSubpaths = [projectRoot, runtimeRoot, '/System/Library', '/System/Cryptexes', '/usr/bin', '/usr/lib', '/usr/sbin', '/usr/share', '/bin', '/sbin', '/Library/Apple', '/Library/Frameworks', '/Library/Developer', '/Applications/Xcode.app', '/opt/homebrew/bin', '/opt/homebrew/lib', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/usr/local/bin', '/usr/local/lib', '/usr/local/Cellar', '/usr/local/opt']
  const readLiterals = ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom']
  const filters = readSubpaths.map(path => `(subpath ${seatbeltString(path)})`).join(' ')
  const forms = [
    '(version 1)', '(deny default)', '(import "system.sb")',
    '(deny network*)', '(deny file-read*)', '(deny file-write*)', '(deny appleevent-send)',
    '(deny signal (target others))', '(deny process-info* (target others))',
    '(deny mach-lookup (global-name-prefix "com.apple.lsd") (global-name-prefix "com.apple.coreservices") (global-name-prefix "com.apple.launchservices"))',
    '(allow process-fork)', '(allow signal (target self))', '(allow signal (target children))',
    '(allow process-info* (target self))', '(allow process-info* (target children))',
    `(allow process-exec ${filters})`, `(allow file-map-executable ${filters})`,
  ]
  forms.push(`(allow file-read* ${filters} ${readLiterals.map(path => `(literal ${seatbeltString(path)})`).join(' ')})`)
  forms.push(`(allow file-write* (subpath ${seatbeltString(projectRoot)}) (subpath ${seatbeltString(runtimeRoot)}) (literal ${seatbeltString('/dev/null')}))`)
  forms.push(`(deny file-read* file-write* (subpath ${seatbeltString(join(projectRoot, '.penecho'))}))`)
  return forms.join(' ')
}

function bwrapSystemPathArgs() {
  const args = ['--dir', '/usr', '--dir', '/usr/local']
  for (const path of ['/usr/bin', '/usr/lib', '/usr/lib64', '/usr/sbin', '/usr/share', '/usr/local/bin', '/usr/local/lib', '/usr/local/share']) if (existsSync(path)) args.push('--ro-bind', path, path)
  for (const path of ['/bin', '/sbin', '/lib', '/lib64']) {
    if (!existsSync(path)) continue
    const info = lstatSync(path)
    if (info.isSymbolicLink()) args.push('--symlink', readlinkSync(path), path)
    else if (info.isDirectory()) args.push('--ro-bind', path, path)
  }
  args.push('--dir', '/etc')
  for (const path of ['/etc/ssl', '/etc/pki']) if (existsSync(path)) args.push('--ro-bind', path, path)
  for (const path of ['/etc/ld.so.cache']) if (existsSync(path)) args.push('--ro-bind', path, path)
  return args
}

function projectShellArgv(support, command, projectRoot, runtimeRoot) {
  if (support.kind === 'seatbelt') return [support.runner, '-p', seatbeltProjectProfile(projectRoot, runtimeRoot), '--', support.bash, '--noprofile', '--norc', '-c', command]
  return [
    support.runner, '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    ...bwrapSystemPathArgs(), '--dir', '/project', '--dir', '/runtime', '--bind', projectRoot, '/project', '--bind', runtimeRoot, '/runtime', '--tmpfs', '/project/.penecho',
    '--chdir', '/project', '--', support.bash, '--noprofile', '--norc', '-c', command,
  ]
}

// The Lines runner's shell: the same OS sandbox, around every folder the run may use (each read/write at its own path), a private
// runtime folder for HOME and TMPDIR, and the system's programs. Nothing else on the computer can be read: not the stored keys, not
// other projects. `network`: the commands unattended runs may use include some that need it (npm, pip, git, gh, go, cargo, curl).
const SYSTEM_READ_DARWIN = ['/System/Library', '/System/Cryptexes', '/usr/bin', '/usr/lib', '/usr/libexec', '/usr/sbin', '/usr/share', '/bin', '/sbin', '/Library/Apple', '/Library/Frameworks', '/Library/Developer', '/Applications/Xcode.app', '/opt/homebrew', '/usr/local', '/private/etc', '/private/var/db/timezone', '/private/var/select']
export function runShellArgv(support, command, { roots = [], runtimeRoot, read = [], network = true }) {
  const rw = [...new Set(roots.filter(Boolean))]
  if (support.kind === 'seatbelt') {
    const readable = [...rw, runtimeRoot, ...SYSTEM_READ_DARWIN, ...read].map(path => `(subpath ${seatbeltString(path)})`).join(' ')
    const writable = [...rw, runtimeRoot].map(path => `(subpath ${seatbeltString(path)})`).join(' ')
    const profile = [
      '(version 1)', '(deny default)', '(import "system.sb")',
      network ? '(allow network*)' : '(deny network*)', '(deny file-read*)', '(deny file-write*)', '(deny appleevent-send)',
      '(deny signal (target others))', '(deny process-info* (target others))',
      '(deny mach-lookup (global-name-prefix "com.apple.lsd") (global-name-prefix "com.apple.coreservices") (global-name-prefix "com.apple.launchservices"))',
      '(allow process-fork)', '(allow signal (target self))', '(allow signal (target children))',
      '(allow process-info* (target self))', '(allow process-info* (target children))',
      `(allow process-exec ${readable})`, `(allow file-map-executable ${readable})`,
      `(allow file-read-metadata)`,
      `(allow file-read* ${readable} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/tty") (literal "/dev/dtracehelper"))`,
      `(allow file-write* ${writable} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))`,
      // Apple's git, python3 and the like are xcrun shims: they keep a cache in the user's temporary folder and read Xcode's settings.
      '(allow file-read* file-write* (regex #"^/private/var/folders/[^/]+/[^/]+/[TC]/xcrun_db"))',
      `(allow file-read* (literal "/Library/Preferences/com.apple.dt.Xcode.plist") (literal ${seatbeltString(join(process.env.HOME || '/var/empty', 'Library/Preferences/com.apple.dt.Xcode.plist'))}))`,
    ].join(' ')
    return [support.runner, '-p', profile, '--', support.bash, '--noprofile', '--norc', '-c', command]
  }
  return [
    support.runner, '--die-with-parent', '--new-session', '--unshare-pid', ...(network ? [] : ['--unshare-net']), '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    ...bwrapSystemPathArgs(), ...(network ? ['--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf', '--ro-bind-try', '/etc/hosts', '/etc/hosts'] : []),
    ...read.flatMap(path => ['--ro-bind-try', path, path]), ...[runtimeRoot, ...rw].flatMap(path => ['--bind', path, path]),
    '--chdir', rw[0] || runtimeRoot, '--', support.bash, '--noprofile', '--norc', '-c', command,
  ]
}

export function killProjectProcess(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio:'ignore', windowsHide:true, timeout:5_000 }) } catch {}
    try { child.kill('SIGKILL') } catch {}
    return
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

export function runProjectShell(argv, { cwd, env, timeoutMs, signal, onChild }) {
  return new Promise((resolveRun, rejectRun) => {
    signal?.throwIfAborted()
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached:process.platform !== 'win32', windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] })
    // Whoever started the command may need to end it when they are told to stop.
    onChild?.(child)
    let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0, stdoutTruncated = false, stderrTruncated = false, timedOut = false, aborted = false
    const append = (chunk, stream) => {
      const text = Buffer.from(chunk).toString('utf8'), bytes = Buffer.byteLength(text), current = stream === 'stdout' ? stdoutBytes : stderrBytes, remaining = Math.max(0, 100_000 - current)
      if (stream === 'stdout') { stdout += text.slice(0, remaining); stdoutBytes += bytes; if (bytes > remaining) stdoutTruncated = true }
      else { stderr += text.slice(0, remaining); stderrBytes += bytes; if (bytes > remaining) stderrTruncated = true }
    }
    child.stdout.on('data', chunk => append(chunk, 'stdout'))
    child.stderr.on('data', chunk => append(chunk, 'stderr'))
    child.once('error', error => rejectRun(new Error(`The project bash sandbox is unavailable: ${error.message}`)))
    const abort = () => { aborted = true; killProjectProcess(child) }
    signal?.addEventListener('abort', abort, { once:true })
    const timer = setTimeout(() => { timedOut = true; killProjectProcess(child) }, timeoutMs)
    timer.unref?.()
    child.once('close', (exitCode, signalName) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      // A foreground shell can detach background children. Always terminate
      // the dedicated process group after the requested command settles.
      killProjectProcess(child)
      if (aborted) return rejectRun(signal?.reason instanceof Error ? signal.reason : new Error('The project command was cancelled.'))
      const denied = exitCode !== 0 && /operation not permitted|permission denied|read-only file system/i.test(stderr)
      resolveRun({ stdout:{ text:stdout, truncated:stdoutTruncated }, stderr:{ text:stderr, truncated:stderrTruncated }, exitCode, signal:signalName, timedOut, timeoutMs, sandbox:{ denied, enforcement:'full' } })
    })
  })
}

export function projectBashTool(session, { assertProjectRoot = () => {} } = {}) {
  return defineTool({
    name:'bash',
    description:'Run one foreground Bash command in an OS sandbox that exposes the selected project read/write, a private ephemeral runtime, and only system executables required to run commands. Host user files outside the project are not mounted/readable.',
    parameters:{
      command:{ type:'string', required:true },
      timeout_ms:{ type:'number', description:'Optional timeout in milliseconds, capped at 120000.' },
    },
    output:textOutput(),
    async execute(args, exec) {
      const command = String(args.command || '')
      assertProjectCommand(command)
      const approvalReason = criticalProjectCommand(command)
      if (session.accessMode === 'controlled' && approvalReason) {
        const decision = await session.rpc('project_approval', {
          command:boundedText(command, 4_000),
          reason:approvalReason,
          projectName:session.project.name,
        }, exec.callId, exec.signal)
        if (decision?.allowed !== true) throw new Error('The user did not authorize this command.')
      }
      const support = projectShellSupport()
      if (!support) throw new Error('A fully read/write-confined Bash runner is not available on this PenEcho host.')
      const runtimeDirectory = session.projectRuntimeDirectory, home = join(runtimeDirectory, 'home'), temporary = join(runtimeDirectory, 'tmp')
      await mkdir(home, { recursive:true, mode:0o700 })
      await mkdir(temporary, { recursive:true, mode:0o700 })
      const canonicalRuntime = await realpath(runtimeDirectory), timeoutMs = Math.max(1_000, Math.min(120_000, Number(args.timeout_ms) || 30_000))
      const visibleRuntime = support.kind === 'bwrap' ? '/runtime' : canonicalRuntime
      const env = { PATH:process.platform === 'darwin' ? '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' : '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin', HOME:join(visibleRuntime, 'home'), XDG_CONFIG_HOME:join(visibleRuntime, 'home', '.config'), XDG_CACHE_HOME:join(visibleRuntime, 'home', '.cache'), TMPDIR:join(visibleRuntime, 'tmp'), LANG:'C.UTF-8', LC_ALL:'C.UTF-8', TERM:'dumb', NO_COLOR:'1' }
      assertProjectRoot(session.project.path)
      return projectBashText(await runProjectShell(projectShellArgv(support, command, session.project.path, canonicalRuntime), { cwd:session.project.path, env, timeoutMs, signal:exec.signal }), session)
    },
  })
}
