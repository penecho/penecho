// On this computer (Settings → Local providers, #setup): the agents installed here, the same for every project. Each one says whether it is here,
// starts and is signed in, and each problem says what is wrong, how to fix it, and gives a prompt to paste into an agent that works.
// Models and efforts are not chosen here but in Preset agents; each row says which presets use it.
// A browser on another device sees the agents of the computer running PenEcho too; only penecho.ai has none to check.
const canCheckAgents = () => typeof S.thisComputer === 'boolean' && !(typeof HOSTED !== 'undefined' && HOSTED);
const agentsSettingsOpen = () => typeof settingsUp === 'function' && settingsUp() && typeof sysTabNow === 'function' && (sysTabNow() === 'setup' || sysTabNow() === 'agents');
async function checkAgents({ fresh = false } = {}) {
  if (!canCheckAgents() || S.agentChecking) return;
  S.agentChecking = true; S.agentCheckError = '';
  if (S.shelfPage === 'agents' || S.shelfPage === 'setup') render();
  try {
    const result = await api('/agents/check' + (fresh ? '?fresh=1' : ''));
    S.agentCheck = result.unavailable ? null : result;
    // An agent just installed or fixed can be picked from now on.
    if (fresh) await loadAgents();
  } catch (error) { S.agentCheckError = error.message; }
  S.agentChecking = false;
  if (agentsSettingsOpen() && typeof dismissRailSettingsBadge === 'function') dismissRailSettingsBadge();
  renderRail();
  refreshEmptyAgents();
  refreshRunLabels();
  if (S.shelfPage === 'agents' || S.shelfPage === 'setup' || S.shelfPage === 'settings' || S.shelfPage === 'providers' || S.route.view === 'settings') render();
}
// The agents installed here are on Settings → Local providers (#setup).
ACT['open-setup'] = () => {
  if (typeof openSettings === 'function') { openSettings('setup'); return; }
  closeSwitcher(); if (typeof EMBED !== 'undefined' && EMBED) { embedTell({ leave:'/projects.html#setup' }); return; } location.hash = 'setup';
};
ACT['setup-recheck'] = () => checkAgents({ fresh:true });

const SETUP_ORDER = { problem:0, ready:1, missing:2 };
const setupShown = () => S.shelfPage === 'agents' || S.shelfPage === 'setup' || S.route?.view === 'settings';
const DESKTOP_INSTALL_PROVIDERS = {
  codex:'codex-cli',
  claude:'claude-cli',
  opencode:'opencode-cli',
  pi:'pi-cli',
  omp:'omp-cli',
  dsh:'dsh-cli',
  kimi:'kimi-cli',
  antigravity:'antigravity-cli',
};
const canDesktopInstallAgent = id => Boolean(S.thisComputer && typeof window !== 'undefined' && window.penechoDesktop?.installCli && DESKTOP_INSTALL_PROVIDERS[id]);
const setupMark = a => `<span class="av" style="--av:${esc(a.color)};--s:30px" aria-hidden="true">${esc(a.mono)}</span>`;
function setupInstallBtnHTML(id, mode = 'install') {
  if (!canDesktopInstallAgent(id)) return '';
  const busy = Boolean(S.setupInstalling?.has(id));
  const update = mode === 'update';
  const label = update ? (busy ? '<i class="spin"></i>Updating' : 'Update') : (busy ? '<i class="spin"></i>Installing' : 'Install');
  return `<button type="button" class="btn sm primary" data-act="${update ? 'setup-update' : 'setup-install'}" data-agent="${esc(id)}" ${busy ? 'disabled' : ''}>${label}</button>`;
}
// A newer version, beside the one installed. A click lets PenEcho run the agent's own updater; a step to a new major version is a prompt for any agent.
function setupUpdateHTML(a) {
  if (!a.update?.latest) return '';
  const busy = Boolean(a.update.running || S.setupUpdating?.has(a.id));
  return `<button type="button" class="setup-upd" data-act="setup-update-to" data-agent="${esc(a.id)}" ${busy ? 'disabled' : ''}>${busy ? '<i class="spin"></i>Updating' : `${ic('download', 12)}Update to ${esc(a.update.latest)}`}</button>`;
}
// An update that did not work, or that waits for the agent to be idle, with the prompt another agent can do it from.
function setupUpdateFixHTML(a) {
  if (!a.update || a.update.running || S.setupUpdating?.has(a.id)) return '';
  const inUse = S.setupInUse?.has(a.id);
  if (!inUse && !a.update.failed) return '';
  const says = inUse ? `<b>${esc(a.name)} is in use</b> <span>Update it when it is done, or copy the prompt into another agent.</span>` : `<b>The update did not work</b> <span>Copy the prompt into any agent, and it does the update.</span>`;
  return `<div class="setup-fix ${inUse ? '' : 'is-fix'}"><p>${says}</p><div class="setup-acts"><button type="button" class="btn sm" data-act="setup-update-to" data-agent="${esc(a.id)}">Try again</button><button type="button" class="btn sm ${inUse ? '' : 'primary'}" data-act="setup-update-prompt" data-agent="${esc(a.id)}">Copy update prompt</button></div></div>`;
}
function setupRowHTML(a) {
  const guidance = { penecho:'Use PenEcho Cloud here. Configure personal API keys in your own agent.', workbuddy:'PenEcho finds and syncs your WorkBuddy work. It does not assign tasks to WorkBuddy.' }[a.id];
  const scope = guidance ? `<span class="setup-scope">${guidance}</span>` : '';
  const installError = S.setupInstallErrors?.[a.id] || '';
  const isUpdateError = S.setupInstallErrorKinds?.[a.id] === 'update';
  const installErrorHTML = installError
    ? `<div class="setup-fix is-fix"><p><b>${isUpdateError ? 'Update failed' : 'Install failed'}</b> <span>${esc(installError)}</span></p><p>${isUpdateError ? 'Try Update again, or copy the update prompt into another agent.' : 'Try Install again, or copy the install prompt into another agent.'}</p></div>`
    : '';
  // PenEcho's own agent has nothing to install: it runs when this computer is signed in to PenEcho Cloud.
  if (a.state === 'missing' && a.builtIn) {
    return `<div class="setup-row is-missing" data-agent="${esc(a.id)}">${setupMark(a)}<div class="setup-text"><div class="setup-title"><strong>${esc(a.name)}</strong></div>${scope}</div><div class="setup-head-acts"><span class="setup-state">Signed out</span><button type="button" class="btn sm" data-act="setup-sign-in" title="${esc(a.problems[0]?.fix || '')}">Sign in</button></div></div>`;
  }
  if (a.state === 'missing') {
    const install = a.problems[0], installBtn = setupInstallBtnHTML(a.id);
    const promptBtn = install ? `<button type="button" class="btn sm" data-act="setup-prompt" data-agent="${esc(a.id)}" data-i="0" title="${esc(install.fix)}">Copy install prompt</button>` : '';
    const actions = installBtn && promptBtn ? `<span class="setup-acts">${installBtn}${promptBtn}</span>` : (installBtn || promptBtn);
    return `<div class="setup-row is-missing" data-agent="${esc(a.id)}">${setupMark(a)}<div class="setup-text"><div class="setup-title"><strong>${esc(a.name)}</strong></div>${scope}</div><div class="setup-head-acts"><span class="setup-state">Not installed</span>${actions}</div>${installErrorHTML}</div>`;
  }
  const metaParts = [a.signedIn ? 'Signed in' : '', a.app, ...(a.builtIn ? [setupCloudFact(a.model)] : [])].filter(Boolean);
  const versionHTML = a.version ? `<span class="setup-ver">${esc(a.version)}</span>` : '';
  const metaHTML = metaParts.length ? `<span class="setup-meta">${metaParts.map(item => `<span>${esc(item)}</span>`).join('')}</span>` : '';
  const pathHTML = a.where && !a.builtIn ? `<code class="setup-path" title="${esc(a.where)}">${esc(homeShort(a.where))}</code>` : '';
  const state = a.state === 'ready' ? `<span class="setup-state ok">${ic('check', 13)}Ready</span>` : `<span class="setup-state bad">Needs a fix</span>`;
  const create = setupCanPreset(a) ? `<button type="button" class="btn sm soft-accent" data-act="setup-create-preset" data-agent="${esc(a.id)}">${ic('plus', 13)}Create preset</button>` : '';
  return `<div class="setup-row ${a.state === 'problem' ? 'is-problem' : ''}" data-agent="${esc(a.id)}">${setupMark(a)}<div class="setup-text"><div class="setup-title"><strong>${esc(a.name)}</strong>${versionHTML}${setupUpdateHTML(a)}${metaHTML}</div>${scope}${pathHTML}</div><div class="setup-head-acts">${state}${setupTryHTML(a)}${create}</div>
    ${setupLinkedHTML(a)}
    ${a.problems.map((p, i) => {
      const isUpdate = p.action === 'update';
      const tipActionBtn = isUpdate ? setupInstallBtnHTML(a.id, 'update') : (!a.where && p.kind === 'tip' ? setupInstallBtnHTML(a.id) : '');
      const promptLabel = isUpdate ? 'Copy update prompt' : !a.where && p.kind === 'tip' ? 'Copy install prompt' : 'Copy fix prompt';
      return `<div class="setup-fix ${p.kind === 'fix' || isUpdate ? 'is-fix' : ''}">
      <p><b>${esc(p.title)}</b>${p.detail ? ` <span>${esc(p.detail)}</span>` : ''}</p>
      <p>${setupInline(p.fix)}</p>
      <div class="setup-acts">${tipActionBtn}${p.command ? `<button type="button" class="setup-cmd" data-act="setup-command" data-agent="${esc(a.id)}" data-i="${i}" title="Copy"><code>${esc(p.command)}</code>${ic('copy', 14)}</button>` : ''}${p.prompt ? `<button type="button" class="btn sm ${p.kind === 'fix' && !tipActionBtn ? 'primary' : ''}" data-act="setup-prompt" data-agent="${esc(a.id)}" data-i="${i}">${promptLabel}</button>` : ''}</div>
    </div>`;
    }).join('')}${installErrorHTML}${setupUpdateFixHTML(a)}</div>`;
}
// What PenEcho's own agent runs on: PenEcho Cloud with its credits when signed in.
function setupCloudFact(m) {
  if (m?.signedIn) return `PenEcho Cloud${Number.isFinite(m.credits) ? ` · ${Number(m.credits).toLocaleString()} credits` : ''}`;
  return '';
}
ACT['setup-sign-in'] = () => cloudSignIn(ok => { if (ok) checkAgents({ fresh:true }); }).catch(error => toast(error.message));
// A ready provider that can run Asks gets a preset made from it in one click (settings.js, setup-create-preset). WorkBuddy runs none.
const setupCanPreset = a => a.state === 'ready' && a.id !== 'workbuddy' && (typeof runnableAgents !== 'function' || runnableAgents().some(r => r.id === a.id));
// Which saved presets run on this provider, with their models and efforts; or that none does yet.
function setupLinkedHTML(a) {
  if (!S.presets) return '';
  const linked = (S.presets.presets || []).filter(p => !p.auto && p.agent === a.id);
  if (linked.length) {
    const facts = linked.map(p => { const run = typeof presetRuns === 'function' ? presetRuns(p) : p; return [run.model || 'default model', run.effort ? `${run.effort} effort` : ''].filter(Boolean).join(' · '); });
    return `<div class="setup-linked">${ic('setAgents', 13)}<span>${linked.length} preset${linked.length === 1 ? '' : 's'}: ${esc(facts.join(', '))}</span><button type="button" class="sys-inline-link" data-act="open-agents">Manage presets</button></div>`;
  }
  if (!setupCanPreset(a)) return '';
  const model = a.model?.picked || a.model?.name || '';
  return `<div class="setup-linked is-none"><span>No preset yet${model ? ` · default model ${esc(model)}` : ''}</span></div>`;
}
// Ready is only what PenEcho can see from outside. A short real run shows the agent also answers, and a failed one turns into a fix like any other.
function setupTryHTML(a) {
  if (!a.where) return '';
  const trying = S.setupTrying?.has(a.id);
  const said = trying ? '' : a.tried?.ok ? `<span class="setup-tried ok">${ic('check', 13)}Answered</span>` : '';
  return `<span class="setup-try">${said}<button type="button" class="setup-btn" data-act="setup-try" data-agent="${esc(a.id)}" ${trying ? 'disabled' : ''}>${trying ? '<i class="spin"></i>Trying a run' : a.tried ? 'Try again' : 'Try a run'}</button></span>`;
}
ACT['setup-try'] = async el => {
  const id = el.dataset.agent;
  (S.setupTrying ||= new Set()).add(id); render();
  try { const result = await api(`/agents/try/${encodeURIComponent(id)}`, { method:'POST' }); if (!result.unavailable) S.agentCheck = result; }
  catch (error) { toast(error.message); }
  S.setupTrying.delete(id);
  if (agentsSettingsOpen() && typeof dismissRailSettingsBadge === 'function') dismissRailSettingsBadge();
  renderRail();
  if (setupShown()) render();
};
// `code` in a fix is shown as code.
const setupInline = text => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const setupProblem = el => S.agentCheck?.agents.find(a => a.id === el.dataset.agent)?.problems[+el.dataset.i];
ACT['setup-prompt'] = el => {
  const agent = S.agentCheck?.agents.find(a => a.id === el.dataset.agent);
  const p = agent?.problems[+el.dataset.i]; if (!p) return;
  // Any agent or AI chat can run the install/update/fix prompt; avoid naming a single specific app.
  copyText(p.prompt, p.action === 'update'
    ? 'Update prompt copied. Paste it into any agent.'
    : agent.state === 'missing' || (!agent.where && p.kind === 'tip')
      ? 'Install prompt copied. Paste it into any agent.'
      : 'Fix prompt copied. Paste it into any agent.');
};
async function runDesktopCliSetup(el, mode = 'install') {
  const id = el.dataset.agent, provider = DESKTOP_INSTALL_PROVIDERS[id], update = mode === 'update';
  if (!provider || typeof window === 'undefined' || !window.penechoDesktop?.installCli || S.setupInstalling?.has(id)) return;
  const name = S.agentCheck?.agents.find(a => a.id === id)?.name || id;
  if (S.setupInstallErrors) delete S.setupInstallErrors[id];
  if (S.setupInstallErrorKinds) delete S.setupInstallErrorKinds[id];
  (S.setupInstalling ||= new Set()).add(id);
  render();
  try {
    const result = await window.penechoDesktop.installCli(provider);
    if (!result?.ok) throw new Error(result?.error || `Could not ${update ? 'update' : 'install'} ${name}.`);
    const prevCheck = S.agentCheck;
    await checkAgents({ fresh:true });
    const refreshed = S.agentCheck && S.agentCheck !== prevCheck ? S.agentCheck.agents?.find(a => a.id === id) : null;
    if (refreshed && refreshed.state === 'missing') {
      const msg = `${name} installed at ${result.executable || 'this computer'}, but PenEcho still could not detect it.`;
      (S.setupInstallErrors ||= {})[id] = msg;
      (S.setupInstallErrorKinds ||= {})[id] = mode;
      toast(msg);
      return;
    }
    if (update && refreshed?.problems?.some(p => p.action === 'update')) {
      const msg = `${name} updated at ${result.executable || 'this computer'}, but PenEcho is still running ${refreshed.version || 'an older version'} from ${refreshed.where || 'another path'}.`;
      (S.setupInstallErrors ||= {})[id] = msg;
      (S.setupInstallErrorKinds ||= {})[id] = 'update';
      toast(msg);
      return;
    }
    const ver = result.version ? ` (${result.version})` : '';
    if (update) toast(`Updated ${name}${ver}.`);
    else if (result.alreadyInstalled) toast(`${name} is already installed${ver}.`);
    else if (result.status?.state === 'auth_required' && result.status.loginCommand) toast(`Installed ${name}${ver}. Run \`${result.status.loginCommand}\` to sign in.`);
    else if (result.status?.authenticationDeferred && result.status.loginCommand) toast(`Installed ${name}${ver}. Run \`${result.status.loginCommand}\` if you need to sign in.`);
    else toast(`Installed ${name}${ver}.`);
  } catch (error) {
    const msg = error.message || `Could not ${update ? 'update' : 'install'} ${name}.`;
    (S.setupInstallErrors ||= {})[id] = msg;
    (S.setupInstallErrorKinds ||= {})[id] = mode;
    toast(msg);
  } finally {
    S.setupInstalling?.delete(id);
    if (setupShown()) render();
  }
}
ACT['setup-install'] = el => runDesktopCliSetup(el, 'install');
ACT['setup-update'] = el => runDesktopCliSetup(el, 'update');

ACT['setup-update-prompt'] = el => {
  const agent = S.agentCheck?.agents.find(a => a.id === el.dataset.agent);
  if (agent?.update) copyText(agent.update.prompt, 'Update prompt copied. Paste it into any agent.');
};
ACT['setup-update-to'] = async el => {
  const id = el.dataset.agent, agent = S.agentCheck?.agents.find(a => a.id === id);
  if (!agent?.update || agent.update.running || S.setupUpdating?.has(id)) return;
  if (!agent.update.auto) { ACT['setup-update-prompt'](el); return; }
  (S.setupUpdating ||= new Set()).add(id);
  S.setupInUse?.delete(id);
  render();
  try {
    const result = await api(`/agents/update/${encodeURIComponent(id)}`, { method:'POST' });
    if (!result.unavailable) S.agentCheck = result;
    const now = result.agents?.find(a => a.id === id);
    if (result.updateBusy) (S.setupInUse ||= new Set()).add(id);
    else if (now?.version && now.version !== agent.version) toast(`Updated ${agent.name} (${now.version}).`);
  } catch (error) { toast(error.message); }
  S.setupUpdating.delete(id);
  if (setupShown()) render();
};
ACT['setup-command'] = el => { const p = setupProblem(el); if (p?.command) copyText(p.command, 'Copied. Run it in Terminal.'); };
