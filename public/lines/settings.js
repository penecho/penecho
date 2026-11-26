// Settings for all of PenEcho: one window over the page, opened from the gear in the rail, project settings, or the Canvas ⋯ menu.
// Its tabs, in four groups. Project agents: Local providers (#setup: the CLIs installed here) then Preset agents (#agents, with their
// model prices at #agents/prices). Canvas: API providers (#providers: PenEcho Cloud and your API keys) then Canvas AI (#agents/canvas),
// and View (#settings/canvas). Integrations: MCP (#agents/apps). App: General (#settings/general) and Archived projects (#archived).
const SET = {
  tab:'canvas',
  agentsTab:'agents',
  form:null,
  key:null,
  keys:null,
  keysAsked:false,
  keysError:'',
  mcp:null,
  mcpAsked:false,
  mcpError:'',
  mcpBusy:false,
  suggest:null,
  suggestAsked:false,
  suggestBusy:false,
  usage:null,
  usageAsked:false,
  usageBusy:false,
  usageOpen:false,
  cloudAccountVersion:0,
  canvasAiSaved:'',
  saving:false,
  redraw:false,
  pinAll:false,
  // Presets pinned on this visit, which say when their rating starts.
  pinned:new Set(),
};
const SETTINGS_RETURN_KEY = 'penecho-settings-return';
// The page's own redraws go ahead even while a box has the focus, and the box you were in has it again after. Others wait (main.js).
function settingsRender() {
  if (SET.drawing) return;
  const active = document.activeElement;
  const was = active?.closest?.('.sys-form')
    ? { form:active.closest('.sys-form').dataset.form, name:active.name }
    : active?.id ? { id:active.id } : null;
  SET.redraw = SET.drawing = true;
  try { render(); } finally { SET.redraw = SET.drawing = false; }
  if (was?.name) $(`.sys-form[data-form="${was.form}"] [name="${was.name}"]`)?.focus({ preventScroll:true });
  else if (was?.id) document.getElementById(was.id)?.focus({ preventScroll:true });
}

// ---------- Saved agents ----------
const presetRunner = id => S.agentCheck?.agents?.find(a => a.id === id) || null;
const presetLevel = effort => (effort ? `${effort} effort` : '');
// service.js records the effort from Codex turn_context.
const RUNTIME_EFFORT_AGENTS = new Set(['codex']);
// The effort the agent's own settings give a run left on Default (configuredEffort in agents.js, defaultEffortWith in agent-model.js). dsh's belongs to its default model alone,
// an agent whose default changes with the model says it model by model, and a level the model is known not to take is not claimed for it.
const levelNotTaken = (about, model, level) => Boolean(level) && Object.hasOwn(about?.effortsFor || {}, model || about?.name || '') && !about.effortsFor[model || about.name || ''].includes(level);
function presetDefaultEffort(agent, model, about) {
  if (!about) return '';
  const level = model && about.defaultEffortFor ? about.defaultEffortFor[model] || '' : agent !== 'dsh' || !model || model === about.name ? about.effort || '' : '';
  return levelNotTaken(about, model, level) ? '' : level;
}
// A model its agent says takes no reasoning level: there is no effort to choose for it, and none its jobs could be rated by.
const takesNoLevels = (model, about) => Boolean(about) && !about.fixed && !runnerEfforts(model || about.name, about).length;
function presetNotRated(x) {
  const model = presetRunner(x.agent)?.model;
  const effort = x.auto ? model?.pickedEffort || presetDefaultEffort(x.agent, model?.picked, model) : x.effort || presetDefaultEffort(x.agent, x.model, model);
  return Boolean(x.available && x.agent !== 'penecho' && !RUNTIME_EFFORT_AGENTS.has(x.agent) &&
    model && !model.fixed && !effort && !takesNoLevels(x.auto ? model.picked : x.model, model));
}
const AGENTS_RATING_STRIP = 'penecho-agents-rating-strip';
const AGENTS_SETUP_HINT = 'penecho-agents-setup-hint';
const RAIL_SETTINGS_BADGE = 'penecho-rail-settings-badge';
const dismissedAgentNotices = new Set();
function agentNoticeDismissed(key) {
  if (dismissedAgentNotices.has(key)) return true;
  try { return localStorage.getItem(key) === 'dismissed'; } catch { return false; }
}
function dismissAgentNotice(key) {
  dismissedAgentNotices.add(key);
  try { localStorage.setItem(key, 'dismissed'); } catch { /* Keep this visit's choice. */ }
}
// Clicking the rail gear (or opening Agents while problems are shown) dismisses the rail badge so it does not keep reminding you.
const railSettingsBadgeCount = () => (agentNoticeDismissed(RAIL_SETTINGS_BADGE) ? 0 : (S.agentCheck?.problems || 0));
function dismissRailSettingsBadge() {
  if (!(S.agentCheck?.problems > 0) || agentNoticeDismissed(RAIL_SETTINGS_BADGE)) return false;
  dismissAgentNotice(RAIL_SETTINGS_BADGE);
  return true;
}
const showLocalAgentNotices = () => S.thisComputer === true && !(typeof HOSTED !== 'undefined' && HOSTED);
function agentNoticeHTML(copy, action, label, dismiss, id = '') {
  return `<div class="agent-notice"><p>${copy}</p>
    <button type="button" class="btn sm agent-setup-button" data-act="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${label}</button>
    <button type="button" class="need-close" data-act="${dismiss}" aria-label="Dismiss">×</button>
  </div>`;
}
// Two or more agents on their default effort get one amber bar whose Pin all pins each with its suggested effort, in place.
function agentsRatingStripHTML(list) {
  if (!showLocalAgentNotices() || SET.form || agentNoticeDismissed(AGENTS_RATING_STRIP)) return '';
  const unrated = list.filter(presetNotRated);
  if (SET.pinAll && unrated.length) return pinAllHTML(unrated);
  if (unrated.length < 2) return '';
  return `<div class="agent-notice is-amber"><p><strong>${unrated.length} agents aren't being rated.</strong></p>
    <button type="button" class="btn sm primary" data-act="preset-pin-all">Pin all</button>
    <button type="button" class="need-close" data-act="dismiss-agents-rating-strip" aria-label="Dismiss">×</button>
  </div>`;
}
// What "default" means for the agent now, else medium, else its first level: what pinning offers first.
function suggestedEffort(about, levels) {
  const now = about.pickedEffort || about.effort;
  if (now && levels.includes(now)) return now;
  return levels.includes('medium') ? 'medium' : levels[0] || '';
}
function pinAllHTML(unrated) {
  const rows = unrated.map(x => {
    const about = presetRunner(x.agent)?.model || {}, model = x.auto ? about.picked || about.name || '' : x.model || about.name || '';
    const levels = runnerEfforts(model, about), pick = suggestedEffort(about, levels);
    return `<div class="pin-all-row">
      <input type="checkbox" name="pin" value="${esc(x.id)}" checked aria-label="Pin ${esc(x.name)}">${av(x.agent, 24)}
      <span class="sys-text"><strong><span>${esc(x.name)}</span></strong><small>${esc(model || 'default model')}</small></span>
      ${levels.length ? `<select name="effort:${esc(x.id)}" aria-label="Effort for ${esc(x.name)}">${levels.map(level => `<option value="${esc(level)}" ${level === pick ? 'selected' : ''}>${esc(level)}</option>`).join('')}</select>`
        : `<input name="effort:${esc(x.id)}" value="${esc(pick)}" placeholder="e.g. high" aria-label="Effort for ${esc(x.name)}" maxlength="40" autocomplete="off" spellcheck="false">`}
    </div>`;
  }).join('');
  return `<form class="sys-form pin-all" data-form="pin-all">${rows}
    <footer><button type="button" class="btn sm" data-act="preset-pin-all-cancel">Cancel</button><button type="submit" class="btn sm primary" ${SET.saving ? 'disabled' : ''}>Pin ${unrated.length} agent${unrated.length === 1 ? '' : 's'}</button></footer>
  </form>`;
}
ACT['preset-pin-all'] = () => { SET.form = null; SET.pinAll = true; settingsRender(); };
ACT['preset-pin-all-cancel'] = () => { SET.pinAll = false; settingsRender(); };
async function pinAllSave(form) {
  const picked = [...form.querySelectorAll('input[name="pin"]')].filter(el => el.checked).map(el => el.value);
  const efforts = Object.fromEntries([...form.querySelectorAll('[name^="effort:"]')].map(el => [el.name.slice(7), el.value.trim()]));
  const unpinned = picked.map(savedPreset).filter(x => x && efforts[x.id] && efforts[x.id].toLowerCase() !== 'default'), chosen = S.presets?.default || '';
  if (!unpinned.length) { SET.pinAll = false; settingsRender(); return; }
  SET.saving = true; settingsRender();
  try {
    for (const x of unpinned) {
      const about = presetRunner(x.agent)?.model || {}, effort = efforts[x.id];
      if (x.auto) await pinPreset({ agent:x.agent, model:about.picked || about.name || '', effort, access:'', name:'', default:x.id === chosen, showInPicker:x.showInPicker !== false, allowDelegation:true });
      else updateAgentPresets(await api(`/agent-presets/${encodeURIComponent(x.id)}`, { method:'PATCH', body:{ agent:x.agent, model:x.model, effort, access:x.access || '', name:x.name === presetAutoName(x.agent, x.model, x.effort, x.access) ? '' : x.name, showInPicker:x.showInPicker !== false, allowDelegation:x.allowDelegation !== false } }));
    }
    SET.pinAll = false;
    toast(`Pinned ${unpinned.length} agent${unpinned.length === 1 ? '' : 's'}. Their jobs are rated from the next Work.`);
  } catch (error) { toast(error.message); }
  SET.saving = false; settingsRender();
}
function agentsSetupHintHTML() {
  if (!showLocalAgentNotices() || !S.presets || agentNoticeDismissed(AGENTS_SETUP_HINT)) return '';
  const ready = (S.presets.presets || []).filter(x => x.available && x.agent !== 'penecho');
  if (!ready.length || ready.some(x => !x.auto && x.allowDelegation !== false && (x.effort || RUNTIME_EFFORT_AGENTS.has(x.agent) || presetDefaultEffort(x.agent, x.model, presetRunner(x.agent)?.model) || takesNoLevels(x.model, presetRunner(x.agent)?.model)))) return '';
  return agentNoticeHTML('Choose a model and effort for your agents, so their jobs are rated and the Orchestrator can assign them work.',
    'open-agents', 'Set model &amp; effort', 'dismiss-agents-setup-hint');
}
function refreshAgentsSetupHint() {
  const host = $('#agentsHint');
  if (!host) return;
  const html = agentsSetupHintHTML();
  if (host.innerHTML !== html) host.innerHTML = html;
}
ACT['dismiss-agents-rating-strip'] = () => { dismissAgentNotice(AGENTS_RATING_STRIP); settingsRender(); };
ACT['dismiss-agents-setup-hint'] = () => { dismissAgentNotice(AGENTS_SETUP_HINT); refreshAgentsSetupHint(); };
// What a saved agent hands its runner, in small type. One with the runner's own settings says what those are now.
function presetFacts(x) {
  if (!x.auto) { const run = presetRuns(x); return [run.model || 'default model', presetLevel(run.effort) || 'default effort'].join(' · '); }
  const m = presetRunner(x.agent)?.model;
  return m ? [m.picked || m.name || 'default model', presetLevel(m.pickedEffort || presetDefaultEffort(x.agent, m.picked, m)) || 'default effort'].join(' · ') : '';
}
function presetAccessTag(agent, access) {
  const normal = presetRunner(agent)?.access?.normal || (agent === 'dsh' || agent === 'codex' ? 'full' : '');
  if (access === 'full' && normal !== 'full') return 'full access';
  if (access === 'folders' && normal !== 'folders') return 'project folders';
  if (access === 'reviewed' && normal !== 'reviewed') return 'reviewed';
  return '';
}
const presetAutoName = (agent, model, effort, access) => [agentInfo(agent).name, model, presetLevel(effort), presetAccessTag(agent, access)].filter(Boolean).join(' · ');
// A saved agent left on Default runs with the model and effort the agent's own settings name, as its form shows them.
function presetRuns(x) {
  const m = presetRunner(x.agent)?.model;
  return { model:x.model || m?.name || '', effort:x.effort || presetDefaultEffort(x.agent, x.model, m) };
}
// Its name in the list, unless one was typed: those, or "default" where its settings name none.
function presetTitle(x) {
  if (x.auto || x.agent === 'penecho' || x.name !== presetAutoName(x.agent, x.model, x.effort, x.access)) return x.name;
  const run = presetRuns(x);
  return presetAutoName(x.agent, run.model || 'default model', run.effort || 'default', x.access);
}
// What an agent may do with nobody there to ask (agents.js ACCESS): its own reviewer decides, only the run's folders, or everything.
const ACCESS_NAMES = { reviewed:'Reviewed', folders:'Project folders', full:'Full access' };
// What each Access choice means for a run, shown under the field (accessOf in agents.js).
const ACCESS_HINTS = {
  reviewed:'The agent\'s own safety check approves each command and turns down risky ones, or asks you in PenEcho when approval is needed.',
  folders:'Changes files only in this project\'s folders. Nobody is asked.',
  full:'Runs every command without asking, anywhere on this computer.',
};
function presetShouldShowFacts(x) {
  const facts = presetFacts(x);
  if (!facts) return false;
  const lowName = String(x.name || '').toLowerCase();
  if (!x.auto) return x.name !== presetAutoName(x.agent, x.model, x.effort, x.access);
  const m = presetRunner(x.agent)?.model;
  const model = String(m?.picked || m?.name || '').toLowerCase();
  const effort = String(m?.pickedEffort || presetDefaultEffort(x.agent, m?.picked, m)).toLowerCase();
  if (model && lowName.includes(model) && (!effort || lowName.includes(effort))) return false;
  return true;
}
// A saved preset whose CLI needs a fix or a sign-in says so, and takes you to Local providers.
function presetProviderFixHTML(x) {
  const runner = presetRunner(x.agent);
  if (runner?.state !== 'problem') return '';
  const signIn = (runner.problems || []).some(p => /sign[\s-]?in|log[\s-]?in|auth/i.test(`${p.title || ''} ${p.fix || ''}`));
  return `<button type="button" class="kind-tag is-amber is-link" data-act="open-setup" title="${esc(runner.problems?.[0]?.title || `${runner.name || x.agent} needs a fix`)}">${signIn ? 'Provider needs sign-in' : 'Provider needs fix'} → Fix</button>`;
}
// A CLI that is installed and ready but has no preset yet, on the shelf under Your preset agents.
function readyPresetRowHTML(x, chosen) {
  const about = presetRunner(x.agent)?.model, model = about?.picked || about?.name || '';
  const on = x.id === chosen;
  const add = SET.form?.from === x.id ? '' : `<button type="button" class="btn sm soft-accent" data-act="preset-copy" data-id="${esc(x.id)}">${ic('plus', 13)}Add preset</button>`;
  return `<div class="sys-row" data-preset="${esc(x.id)}">${av(x.agent, 28)}
    <span class="sys-text"><strong><span>${esc(x.name)}</span>${x.agent === 'penecho' ? '<span class="kind-tag">Built in</span>' : ''}</strong><small>${esc(model ? `Default model ${model}` : 'Default model')}</small></span>
    <span class="sys-acts">${on ? `<span class="sys-default" title="Every Ask in every project runs with it, unless a project or the Ask picks another">${ic('check', 13)}Default</span><button type="button" class="link" data-act="preset-default-clear" data-id="${esc(x.id)}">Clear</button>` : ''}${add}</span></div>`;
}
function presetRowHTML(x, chosen) {
  if (x.auto) return readyPresetRowHTML(x, chosen);
  const on = x.id === chosen, act = (name, label) => `<button type="button" class="link" data-act="${name}" data-id="${esc(x.id)}">${label}</button>`;
  const builtIn = x.agent === 'penecho' ? '<span class="kind-tag">Built in</span>' : '';
  // One chip says why a found agent isn't counted yet; its reason is in the title.
  const notRated = presetNotRated(x);
  const status = notRated ? `<span class="kind-tag is-amber" title="Jobs on the agent's default effort are not counted in ratings. Pin a model and effort so they are.">Not rated</span>`
    : SET.pinned.has(x.id) ? '<span class="kind-tag is-green">Rated from next Work</span>' : '';
  const facts = !x.available ? esc(x.why || 'Not on this computer') : presetShouldShowFacts(x) ? esc(presetFacts(x)) : '';
  const shown = notRated ? facts.replace(/default effort$/, '<span class="is-amber-text">default effort</span>') : facts;
  const off = [x.showInPicker === false ? 'Hidden from agent pickers' : '', x.allowDelegation === false ? 'Orchestrator assignments off' : ''];
  const noPrice = typeof presetNoPrice === 'function' && presetNoPrice(x)
    ? `<button type="button" class="kind-tag is-amber is-link" data-act="prices-open" data-id="${esc(x.id)}" title="PenEcho Auto and the Orchestrator can’t compare this agent’s cost. Click to get the price.">No price${ic('right', 11)}</button>` : '';
  const makeDefault = x.available ? `<button type="button" class="link is-quiet" data-act="preset-default" data-id="${esc(x.id)}">Make default</button>` : '';
  return `<div class="sys-row ${x.available ? '' : 'is-off'}" data-preset="${esc(x.id)}">${av(x.agent, 28)}
    <span class="sys-text"><strong><span>${esc(presetTitle(x))}</span>${builtIn}</strong><small>${[shown, ...off].filter(Boolean).join(' · ')}</small></span>
    <span class="sys-acts">${presetProviderFixHTML(x)}${noPrice}${status}${on ? `<span class="sys-default" title="Every Ask in every project runs with it, unless a project or the Ask picks another">${ic('check', 13)}Default</span>${act('preset-default-clear', 'Clear')}` : makeDefault}
      ${act('preset-edit', 'Edit')}${act('preset-remove', 'Remove')}</span></div>`;
}
// The levels most agents take, offered when nothing is known about the model, so effort can always be picked. A model its agent lists with no levels gets none, but one can still be typed.
const BASIC_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
function runnerEfforts(model, about) {
  if (about.fixed) return [];
  if (Object.hasOwn(about.effortsFor || {}, model)) return about.effortsFor[model];
  return about.efforts?.length ? about.efforts : BASIC_EFFORTS;
}
function effortHint(runner, model, about) {
  if (about.fixed) return `${runner.name} controls this in its own settings.`;
  const why = about.whyNone?.[model];
  return why ? `${why[0].toUpperCase()}${why.slice(1)}.` : '';
}
// Both settings pickers use the built-in agent's Cloud catalog, including when it is empty.
function cloudAgentModelOptions(about, picked) {
  const choices = about.choices || [];
  const stale = picked && !choices.includes(picked);
  const placeholder = choices.length ? `Default (${about.name || choices[0]})` : 'No Cloud models available';
  return (stale ? '<option data-unavailable selected disabled>Choose a Cloud model</option>' : '') +
    `<option value="">${esc(placeholder)}</option>` + choices.map(name =>
      `<option value="${esc(name)}" ${name === picked ? 'selected' : ''}>${esc(name)}</option>`).join('');
}
function presetModelHTML(runner, draft, about) {
  if (runner.id === 'penecho') return `<label><span>Model</span><select name="modelChoice" ${about.choices?.length ? '' : 'disabled'}>${cloudAgentModelOptions(about, draft.model)}</select></label>`;
  if (about.fixed) return `<label><span>Model</span><span>${esc(about.name || `Set in ${runner.name}`)}</span></label>`;
  const choices = [...new Set([about.picked, ...(about.choices || [])].filter(Boolean))];
  const custom = draft.customModel || Boolean(draft.model && !choices.includes(draft.model));
  const placeholder = about.name ? `Default (${about.name})` : `${runner.name}'s default`;
  const picker = choices.length ? `<label><span>Model</span><select name="modelChoice"><option value="">${esc(placeholder)}</option>${choices.map(model => `<option value="${esc(model)}" ${!custom && model === draft.model ? 'selected' : ''}>${esc(about.choiceLabels?.[model] || model)}</option>`).join('')}<option data-custom ${custom ? 'selected' : ''}>Type another model…</option></select></label>` : '';
  const input = !choices.length || custom ? `<label><span>${picker ? 'Custom model name' : 'Model'}</span><input name="model" value="${esc(draft.model)}" placeholder="${esc(placeholder)}" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false"></label>` : '';
  return `<div>${picker}${input}</div>`;
}
function presetEffortHTML(runner, draft, about) {
  if (about.fixed) return `<label><span>Effort</span></label><small>${esc(effortHint(runner, '', about))}</small>`;
  const targetModel = draft.model || about.name;
  const levels = runnerEfforts(targetModel, about), custom = draft.customEffort || Boolean(draft.effort && !levels.includes(draft.effort));
  const defaultEffort = presetDefaultEffort(runner.id, draft.model, about);
  const why = !levels.length ? effortHint(runner, targetModel, about) : '';
  // Pinning hides Default: its jobs would not be rated. It can still be typed. A model that takes no levels has only that one choice.
  const blank = draft.from && levels.length ? '' : `<option value="">${esc(defaultEffort ? `Default (${defaultEffort})` : levels.length ? 'Default' : 'None')}</option>`;
  const picker = `<label><span>Effort</span><select name="effortChoice">${blank}${levels.map(level => `<option value="${esc(level)}" ${!custom && level === draft.effort ? 'selected' : ''}>${esc(level)}</option>`).join('')}<option data-custom ${custom ? 'selected' : ''}>Type another effort…</option></select></label>`;
  const input = custom ? `<label><span>Custom effort</span><input name="effort" value="${esc(draft.effort)}" placeholder="e.g. high" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false"></label>` : '';
  const available = runnableAgents().some(a => a.id === runner.id);
  const rating = presetNotRated({ agent:runner.id, model:draft.model, effort:draft.effort, available })
    ? '<small class="preset-effort-rating">Default effort is not counted in ratings.</small>' : '';
  return `<div>${picker}${input}${why ? `<small>${esc(why)}</small>` : ''}${rating}</div>`;
}
function presetFormHTML() {
  const f = SET.form;
  const runners = S.agentCheck?.agents
    ? S.agentCheck.agents.filter(a => a.state !== 'missing' && runnableAgents().some(r => r.id === a.id))
    : runnableAgents().filter(r => r.id !== 'workbuddy').map(r => ({ id:r.id, name:r.name || agentInfo(r.id).name }));
  if (f.id && !runners.some(a => a.id === f.agent)) runners.push(presetRunner(f.agent) || { id:f.agent, name:agentInfo(f.agent).name });
  if (!runners.length) return '<p class="empty-line">No local provider can run yet. Install or fix one in <button type="button" class="sys-inline-link" data-act="open-setup">Local providers</button>.</p>';
  const r = runners.find(a => a.id === f.agent) || runners[0], m = r.model || {};
  return `<form class="sys-form" data-form="preset">
    <label><span>Local provider</span><select name="agent">${runners.map(a => `<option value="${esc(a.id)}" ${a.id === r.id ? 'selected' : ''}>${esc(a.name)}${a.state === 'problem' ? ' (needs fix)' : ''}</option>`).join('')}</select></label>
    ${presetModelHTML(r, f, m)}
    <div data-preset-effort>${presetEffortHTML(r, f, m)}</div>
    ${presetAccessHTML(r, f)}
    <label class="sys-wide ${r.access?.normal ? 'sys-span2' : ''}"><span>Name</span><input name="name" value="${esc(f.name)}" placeholder="${esc(presetAutoName(r.id, f.model, f.effort, f.access))}" maxlength="80" autocomplete="off"></label>
    ${r.access?.normal ? `<p class="sys-warn">${esc(presetAccessHint(r, f.access))}</p>` : ''}
    <fieldset class="preset-use"><legend>Where this preset is used</legend>
      <label><input type="checkbox" name="showInPicker" aria-labelledby="presetPickerLabel" aria-describedby="presetPickerHint" ${f.showInPicker ? 'checked' : ''}><span><span id="presetPickerLabel">Show in agent pickers</span><small id="presetPickerHint">Choose this preset yourself when you run a Line or start an orchestrator, or let PenEcho Auto choose it.</small></span></label>
      <label><input type="checkbox" name="allowDelegation" aria-labelledby="presetAssignmentLabel" aria-describedby="presetAssignmentHint" ${f.allowDelegation ? 'checked' : ''}><span><span id="presetAssignmentLabel">Allow orchestrator assignments</span><small id="presetAssignmentHint">Let the orchestrator choose this preset when it delegates work.</small></span></label>
    </fieldset>
    <footer><label class="sys-check"><input type="checkbox" name="makeDefault" ${f.makeDefault ? 'checked' : ''}><span>Default for every project</span></label>${presetTryHTML(f)}<button type="button" class="btn sm" data-act="preset-cancel">Cancel</button><button type="submit" class="btn sm primary" ${SET.saving ? 'disabled' : ''}>${f.id ? 'Save' : f.makeDefault ? 'Add &amp; make default' : 'Add preset'}</button></footer>
  </form>`;
}
// A short real run with the model and effort picked here, before they are saved. Its answer shows only while they stay picked.
const presetTryKey = f => [f.agent, f.model, f.effort].join('\n');
function presetTryHTML(f) {
  const t = SET.presetTry?.key === presetTryKey(f) ? SET.presetTry : null;
  const said = !t || t.running ? '' : t.ok ? `<span class="setup-tried ok preset-try-said">${ic('check', 14)}Answered</span>`
    : `<span class="preset-try-said is-failed" title="${esc(t.error)}">${esc(t.error || 'No answer')}</span>`;
  return `${said}<button type="button" class="btn sm" data-act="preset-try" ${t?.running ? 'disabled' : ''}>${t?.running ? '<i class="spin"></i>Testing' : t ? 'Test again' : 'Test run'}</button>`;
}
ACT['preset-try'] = async () => {
  const form = $('.sys-form[data-form="preset"]');
  if (!form || !SET.form) return;
  presetFormRead(form);
  const f = SET.form, key = presetTryKey(f), run = SET.presetTry = { key, running:true };
  settingsRender();
  try { Object.assign(run, (await api(`/agents/try/${encodeURIComponent(f.agent)}`, { method:'POST', body:{ model:f.model, effort:f.effort } })).tried); }
  catch (error) { Object.assign(run, { ok:false, error:error.message }); }
  run.running = false;
  if (SET.presetTry === run) settingsRender();
};
// Access options for a runner: "" is the runner's default; alternate modes depend on the runner (accessOf in agents.js).
function presetAccessOptions(a) {
  if (!a?.normal) return [];
  const list = [['', ACCESS_NAMES[a.normal]]];
  if (a.full && a.normal !== 'full') list.push(['full', ACCESS_NAMES.full]);
  if (a.reviewed && a.normal !== 'reviewed') list.push(['reviewed', ACCESS_NAMES.reviewed]);
  if (a.folders && a.normal !== 'folders') list.push(['folders', ACCESS_NAMES.folders]);
  return list;
}
function presetAccessHint(r, access) {
  const a = r.access;
  if (!a?.normal) return '';
  const options = presetAccessOptions(a);
  const effective = access && options.some(([v]) => v === access) ? access : a.normal;
  if (effective === 'full' && options.length === 1) return "Runs every command without asking, within this agent's own settings.";
  return ACCESS_HINTS[effective] || '';
}
function presetAccessHTML(r, f) {
  const options = presetAccessOptions(r.access);
  if (!options.length) return '';
  const multi = options.length > 1, selected = options.some(([v]) => v === f.access) ? f.access : '';
  return `<label><span>Access</span><select name="access" ${multi ? '' : 'disabled'}>${options.map(([v, label]) => `<option value="${v}" ${multi && v === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
}
const compareSettingsAgentNames = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:'base', numeric:true }) || a.name.localeCompare(b.name);
const settingsHosted = () => !S.thisComputer && typeof HOSTED !== 'undefined' && Boolean(HOSTED);
const savedPresetsCount = () => (S.presets?.presets || []).filter(p => !p.auto).length;
const presetRunnable = id => id !== 'workbuddy' && (typeof runnableAgents === 'function' ? runnableAgents().some(r => r.id === id) : presetRunner(id)?.state === 'ready');
// Installed and ready CLIs that have no preset yet: added from the shelf under Your preset agents, one by one or all at once.
const presetReadyToAdd = () => (S.presets?.presets || []).filter(x => x.auto && x.available && presetRunner(x.agent)?.state !== 'problem').sort(compareSettingsAgentNames);
const agentsScanning = () => Boolean(S.agentChecking || (!S.agentCheck && !S.agentCheckError));
// The effort a new preset starts with: none for PenEcho's own agent, a fixed model or one that takes no levels.
function presetStartEffort(agent, model, about) {
  if (!about || agent === 'penecho' || about.fixed) return '';
  const levels = runnerEfforts(model || about.name, about);
  return levels.length ? suggestedEffort(about, levels) : '';
}
// Two steps in one strip at the top of both Project agents tabs: the CLIs installed here, then the presets made from them.
function sysFlowStepHTML(tab, num, title, sub, { active = false, tone = '' } = {}) {
  return `<button type="button" class="sys-flow-step${active ? ' is-active' : ''}${tone === 'warn' ? ' is-warn' : ''}" data-act="settings-tab" data-tab="${tab}"${active ? ' aria-current="step"' : ''}>
    <span class="sys-flow-num">${num}</span><span class="sys-flow-copy"><strong>${title}</strong><small${tone === 'warn' ? ' class="is-amber"' : tone === 'ok' ? ' class="is-ok"' : ''}>${sub}</small></span></button>`;
}
const sysFlowHTML = (label, first, second) => `<nav class="sys-flow" aria-label="${label}">${first}<span class="sys-flow-arrow" aria-hidden="true">${ic('arrowRight', 15)}</span>${second}</nav>`;
function agentsFlowStripHTML(active) {
  let first, second;
  if (settingsHosted()) {
    const open = (HOSTED.computers || []).filter(pc => pc.open).length, ready = (S.agents || []).length;
    first = sysFlowStepHTML('setup', 1, 'Connected computers', open ? `${open} computer${open === 1 ? '' : 's'} connected` : 'Connect PenEcho on a computer', { active:active === 'setup', tone:open ? 'ok' : 'warn' });
    second = sysFlowStepHTML('agents', 2, 'Preset agents', `${ready} available`, { active:active === 'agents' });
  } else {
    const agents = S.agentCheck?.agents || [];
    const problems = agents.filter(a => a.state === 'problem').length || S.agentCheck?.problems || 0, ready = agents.filter(a => a.state === 'ready').length;
    const sub = agentsScanning() ? ['<i class="spin"></i>Checking local CLI tools…', '']
      : S.agentCheckError && !S.agentCheck ? ['Could not check local CLIs', 'warn']
      : problems ? [`${problems} ${problems === 1 ? 'needs' : 'need'} a fix · ${ready} ready`, 'warn']
      : ready ? [`${ready} ready on this computer`, 'ok'] : ['Install or sign in to a CLI tool', 'warn'];
    const saved = savedPresetsCount();
    first = sysFlowStepHTML('setup', 1, 'Local agent providers', sub[0], { active:active === 'setup', tone:sub[1] });
    second = sysFlowStepHTML('agents', 2, 'Preset agents', saved ? `${saved} saved preset${saved === 1 ? '' : 's'} active` : 'Pin model &amp; effort for Auto and Orchestrator', { active:active === 'agents' });
  }
  return sysFlowHTML('Project agents setup', first, second);
}
function agentsSectionHTML() {
  if (settingsHosted()) {
    const ready = [...(S.agents || [])].sort(compareSettingsAgentNames);
    const agentDesc = a => {
      if (a.id !== 'penecho') return 'Available via your computer';
      const models = Array.isArray(a.workers) ? a.workers.map(m => [m.displayName || m.name, m.defaultEffort ? `${m.defaultEffort} effort` : ''].filter(Boolean).join(' · ')).filter(Boolean) : [];
      return models.length ? `${models.join(', ')} · Runs on PenEcho Cloud credits` : 'Runs on PenEcho Cloud credits';
    };
    return `<section class="sys-sec" aria-labelledby="sysAgents"><header class="sys-head"><div><h2 id="sysAgents">Your agents</h2><p class="sys-sub">Working agents that pick up an Ask on a Line, work through the files, and report back. Set up custom presets in the PenEcho app on your computer.</p></div></header>
      ${ready.length ? `<div class="shelf-list">${ready.map(a => `<div class="sys-row">${av(a.id, 28)}<span class="sys-text"><strong><span>${esc(a.name)}</span>${a.builtIn || a.id === 'penecho' ? '<span class="kind-tag">Built in</span>' : ''}</strong><small>${esc(agentDesc(a))}</small></span><span class="sys-acts"><span class="sys-default">Ready</span></span></div>`).join('')}</div>` : '<p class="empty-line">Sign in or open PenEcho on a computer to manage custom agent presets.</p>'}
      <p class="sys-note">Custom agent presets are saved on the computer that runs PenEcho.</p>
    </section>`;
  }
  const all = S.presets?.presets || [], chosen = S.presets?.default || '';
  const saved = all.filter(x => !x.auto).sort(compareSettingsAgentNames), readyToAdd = presetReadyToAdd();
  const canNew = (S.agentCheck?.agents || []).some(a => a.state !== 'missing' && presetRunnable(a.id)) || readyToAdd.length > 0;
  const head = `<header class="sys-head"><div><h2 id="sysAgents">Your preset agents</h2><p class="sys-sub">Saved <strong>provider + model + effort</strong> profiles used by Lines, PenEcho Auto, and Orchestrator. Save the same model at several efforts (e.g. high and medium) so Auto learns which fits each job.</p></div>${!S.presets || SET.form || !canNew || !saved.length ? '' : `<button type="button" class="btn sm" data-act="preset-new">${ic('plus', 14)}New preset</button>`}</header>`;
  if (!S.presets) return `<section class="sys-sec" aria-labelledby="sysAgents">${head}<p class="empty-line">Restart PenEcho to save agents here.</p></section>`;
  const editing = x => SET.form?.id === x.id ? `<div class="sys-row is-editing">${presetFormHTML()}</div>` : presetRowHTML(x, chosen);
  const empty = saved.length ? ''
    : agentsScanning() && !readyToAdd.length ? '<div class="sys-empty" role="status"><i class="spin"></i><strong>Checking local providers…</strong></div>'
    : SET.form && !SET.form.id && !SET.form.from ? ''
    : `<div class="sys-empty"><strong>No preset agents yet</strong><p>${canNew ? 'Pick a local provider, a model and an effort, so Auto and the Orchestrator can use it.' : 'Install or sign in to a CLI tool in Local providers first.'}</p>
      <div class="sys-empty-acts">${canNew ? `<button type="button" class="btn sm primary" data-act="preset-new">${ic('plus', 14)}New preset</button>` : `<button type="button" class="btn sm primary" data-act="open-setup">Go to Local providers →</button>`}</div></div>`;
  const ready = readyToAdd.length ? `<section class="sys-sec sys-ready" aria-labelledby="sysReadyProviders">
      <header class="sys-head"><div><h2 id="sysReadyProviders">Ready to add from Local providers</h2><p class="sys-sub">These CLIs are installed and ready but have no preset yet. Add one so Auto and the Orchestrator can use it.</p></div>
        <button type="button" class="btn sm soft-accent" data-act="preset-quick-add-all" ${SET.saving || SET.form ? 'disabled' : ''}>Quick-add all (${readyToAdd.length})</button></header>
      <div class="shelf-list">${readyToAdd.map(x => SET.form?.from === x.id ? `${presetRowHTML(x, chosen)}<div class="sys-row is-editing is-pinning">${presetFormHTML()}</div>` : presetRowHTML(x, chosen)).join('')}</div>
    </section>` : '';
  return `<section class="sys-sec" aria-labelledby="sysAgents">${head}
    ${agentsRatingStripHTML(saved)}
    ${SET.form && !SET.form.id && !SET.form.from ? presetFormHTML() : ''}
    ${saved.length ? `<div class="shelf-list">${saved.map(editing).join('')}</div>` : empty}
    ${chosen || !saved.length ? '' : '<p class="sys-note">No default: each project picks its own working agent, or an agent that already builds.</p>'}
  </section>${ready}`;
}
// Quick-add all: one saved preset for each ready CLI, with its default model and a suggested effort.
ACT['preset-quick-add-all'] = async () => {
  const list = presetReadyToAdd(), chosen = S.presets?.default || '';
  if (SET.saving || !list.length) return;
  SET.saving = true; settingsRender();
  let added = 0;
  try {
    for (const x of list) {
      const about = presetRunner(x.agent)?.model || {}, model = about.picked || about.name || '';
      if (await pinPreset({ agent:x.agent, model, effort:presetStartEffort(x.agent, model, about), access:'', name:'', default:x.id === chosen, showInPicker:true, allowDelegation:true })) added++;
    }
  } catch (error) { toast(error.message); }
  SET.saving = false; settingsRender();
  if (added) toast(`Added ${added} preset${added === 1 ? '' : 's'} for Auto and Orchestrator.`);
};
// Agents and the prices of their models, two tabs on one page. penecho.ai has no prices of its own.
const AGENTS_PRICES = '#agents/prices';
const agentsHavePrices = () => typeof pricesHere === 'function' && pricesHere();
const agentsPricesUp = () => settingsUp() && sysTabNow() === 'agents' && SET.agentsTab === 'prices' && agentsHavePrices();
function agentsTabsHTML() {
  const on = agentsPricesUp(), n = priceWanted().length, saved = savedPresetsCount();
  const tab = (id, label, chosen, more = '') => `<button type="button" role="tab" id="agentsTab-${id}" aria-selected="${chosen}" aria-controls="sysPanel" data-act="agents-tab" data-tab="${id}">${label}${more}</button>`;
  return `${tab('agents', saved ? `Presets (${saved})` : 'Presets', !on)}${tab('prices', 'Model prices', on, n ? `<em class="setup-count" title="${n} with no price">${n}</em>` : '')}`;
}
ACT['agents-tab'] = el => { PRICES.target = ''; openSettings('agents', { sub:el.dataset.tab === 'prices' ? 'prices' : '' }); };
const savedPreset = id => (S.presets?.presets || []).find(x => x.id === id);
// Pinning a found agent (copy) opens under its row with its model and an effort already chosen: the one it shows, unless its model is known not to take it.
// Pinning the default keeps it the default.
function openPresetForm(x, copy = false, makeDefault = false) {
  const r = presetRunner(x?.agent)?.model;
  const model = copy ? r?.picked || r?.name || '' : x?.model || '', from = copy && x?.auto ? x.id : '';
  const shown = r?.pickedEffort || presetDefaultEffort(x?.agent, r?.picked, r);
  const effort = !copy ? x?.effort || '' : shown && !levelNotTaken(r, model, shown) ? shown : from ? suggestedEffort(r || {}, runnerEfforts(model || r?.name, r || {})) : '';
  SET.pinAll = false;
  SET.presetTry = null;
  SET.form = { id:copy ? '' : x?.id || '', from, agent:x?.agent || runnableAgents()[0]?.id || '', model, effort, access:copy ? '' : x?.access || '',
    name:copy || !x || x.name === presetAutoName(x.agent, x.model, x.effort, x.access) ? '' : x.name,
    makeDefault:makeDefault || Boolean(x && (!copy || from) && x.id === S.presets?.default),
    showInPicker:x?.showInPicker !== false, allowDelegation:copy || x?.allowDelegation !== false };
  settingsRender();
  requestAnimationFrame(() => $('.sys-form select, .sys-form input')?.focus());
}
ACT['preset-new'] = () => openPresetForm(null);
// + Create preset on a Local providers row: Preset agents, with a new preset's form filled in for that provider.
ACT['setup-create-preset'] = el => {
  const agent = el.dataset.agent, about = presetRunner(agent)?.model || {}, model = about.picked || about.name || '';
  openSettings('agents');
  if (typeof EMBED !== 'undefined' && EMBED) return;
  SET.pinAll = false;
  SET.presetTry = null;
  SET.form = { id:'', from:'', agent, model, effort:presetStartEffort(agent, model, about), access:'', name:'', makeDefault:false, showInPicker:true, allowDelegation:true };
  settingsRender();
  requestAnimationFrame(() => {
    const form = $('.sys-form[data-form="preset"]');
    form?.scrollIntoView?.({ block:'nearest' });
    form?.querySelector('select, input')?.focus({ preventScroll:true });
  });
};
ACT['preset-copy'] = el => openPresetForm(savedPreset(el.dataset.id), true);
ACT['preset-edit'] = el => openPresetForm(savedPreset(el.dataset.id));
// A found agent is pinned before it becomes the default, so the agent that handles most Works is rated.
ACT['preset-pin-default'] = el => openPresetForm(savedPreset(el.dataset.id), true, true);
ACT['preset-cancel'] = () => { SET.form = null; settingsRender(); };
function updateAgentPresets(presets) {
  S.presets = presets;
  refreshAgentsSetupHint();
  if (typeof loadPrices === 'function') loadPrices(true);
}
async function presetCall(path, method, body) {
  try { updateAgentPresets(await api(`/agent-presets${path}`, { method, body })); return true; }
  catch (error) { toast(error.message); return false; }
  finally { settingsRender(); }
}
ACT['preset-default'] = el => presetCall('/default', 'POST', { id:el.dataset.id }).then(ok => ok && toast(`Every project now runs with ${savedPreset(el.dataset.id)?.name || 'it'} by default.`));
ACT['preset-default-clear'] = () => presetCall('/default', 'POST', { id:'' });
ACT['preset-remove'] = el => {
  const x = savedPreset(el.dataset.id); if (!x) return;
  presetCall(`/${encodeURIComponent(x.id)}`, 'DELETE').then(ok => ok && toast(`Removed ${x.name}`, { label:'Undo', fn:() => api('/agent-presets', { method:'POST', body:{ agent:x.agent, model:x.model, effort:x.effort, access:x.access || '', name:x.name, showInPicker:x.showInPicker, allowDelegation:x.allowDelegation } }).then(r => { updateAgentPresets(r); settingsRender(); }).catch(error => toast(error.message)) }));
};
function presetFormRead(form) {
  const f = SET.form, data = new FormData(form);
  const picker = form.querySelector('[name="modelChoice"]');
  f.customModel = Boolean(picker?.querySelector('option[data-custom]')?.selected);
  f.agent = String(data.get('agent') || f.agent);
  const previousModel = f.model;
  if (!picker?.querySelector('option[data-unavailable]')?.selected) {
    f.model = String(picker && !f.customModel ? data.get('modelChoice') || '' : data.get('model') || '').trim();
  }
  const effortPicker = form.querySelector('[name="effortChoice"]');
  f.customEffort = Boolean(effortPicker?.querySelector('option[data-custom]')?.selected);
  f.effort = String(effortPicker && !f.customEffort ? data.get('effortChoice') || '' : data.get('effort') || '').trim();
  const about = presetRunner(f.agent)?.model || {};
  if (f.model !== previousModel && !f.customEffort && !runnerEfforts(f.model || about.name, about).includes(f.effort)) f.effort = '';
  if (data.has('access')) f.access = String(data.get('access') || '');
  f.name = String(data.get('name') || '').trim(); f.makeDefault = data.get('makeDefault') === 'on';
  f.showInPicker = data.has('showInPicker'); f.allowDelegation = data.has('allowDelegation');
}
// Saves a new preset and remembers it as pinned on this visit. It gives the new preset's id.
async function pinPreset(body) {
  const before = new Set((S.presets?.presets || []).map(x => x.id));
  updateAgentPresets(await api('/agent-presets', { method:'POST', body }));
  const made = (S.presets?.presets || []).find(x => !before.has(x.id));
  if (made) SET.pinned.add(made.id);
  return made;
}
async function presetSave(form) {
  presetFormRead(form);
  if (SET.form.from && (!SET.form.effort || SET.form.effort.toLowerCase() === 'default') && !takesNoLevels(SET.form.model, presetRunner(SET.form.agent)?.model)) { toast('Choose an effort, so its jobs are rated.'); return; }
  const f = SET.form, body = { agent:f.agent, model:f.model, effort:f.effort, access:f.access || '', name:f.name || '', default:f.makeDefault,
    showInPicker:f.showInPicker, allowDelegation:f.allowDelegation };
  SET.saving = true; settingsRender();
  try {
    if (f.from) {
      const made = await pinPreset(body);
      if (made) toast(`Pinned ${made.name}. Its jobs are rated from the next Work.`, { label:'Undo', fn:() => presetCall(`/${encodeURIComponent(made.id)}`, 'DELETE') });
    } else updateAgentPresets(f.id ? await api(`/agent-presets/${encodeURIComponent(f.id)}`, { method:'PATCH', body }) : await api('/agent-presets', { method:'POST', body }));
    if (!f.makeDefault && f.id && S.presets.default === f.id) updateAgentPresets(await api('/agent-presets/default', { method:'POST', body:{ id:'' } }));
    SET.form = null;
  } catch (error) { toast(error.message); }
  SET.saving = false; settingsRender();
}

// ---------- Providers: PenEcho Cloud and Canvas AI keys ----------
// The providers an API key can be for, picked from tiles as in magpie's Add a provider, but only well-known ones (PE-446): the makers'
// own APIs, relays that serve many makers' models on one key, and model servers on this computer. Each fills in its address and a
// model; the address can still be changed, and Custom takes any address in either format. One with several regions is one tile, and
// the form picks the region. A server on this computer needs no key: it is sent one it ignores. Partners come first, and a region's
// fourth item opens the partner's key page through PenEcho Cloud.
const KEY_KINDS = [['partner', 'Partners'], ['vendor', 'Vendors'], ['relay', 'Relays'], ['local', 'On this computer']];
const KEY_SERVICES = [
  { id:'kimi', kind:'partner', label:'Kimi', icon:'kimi', mono:true, model:'kimi-k3', regions:[['Global', 'https://api.moonshot.ai/v1', 'kimi-global-api', 'https://penecho.ai/go/kimi-global'], ['China', 'https://api.moonshot.cn/v1', 'kimi-china-api', 'https://penecho.ai/go/kimi-china']] },
  { id:'kimi-coding', kind:'partner', label:'Kimi Code', icon:'kimi', mono:true, model:'k3', regions:[['', 'https://api.kimi.com/coding/v1', 'kimi-global-coding', 'https://penecho.ai/go/kimi-code']] },
  { id:'linkmodel', kind:'partner', label:'LinkModel', icon:'linkmodel', regions:[['', 'https://api.linkmodel.ai/v1', '', 'https://penecho.ai/go/linkmodel']] },
  { id:'anthropic', kind:'vendor', label:'Anthropic', icon:'claude-color', format:'anthropic', model:'claude-opus-4-8', regions:[['', 'https://api.anthropic.com']] },
  { id:'openai', kind:'vendor', label:'OpenAI', icon:'openai', mono:true, model:'gpt-5.6-sol', regions:[['', 'https://api.openai.com/v1']] },
  { id:'gemini', kind:'vendor', label:'Google Gemini', icon:'gemini-color', regions:[['', 'https://generativelanguage.googleapis.com/v1beta/openai']] },
  { id:'deepseek', kind:'vendor', label:'DeepSeek', icon:'deepseek-color', regions:[['', 'https://api.deepseek.com/v1', 'deepseek-global-api']] },
  { id:'xai', kind:'vendor', label:'xAI', icon:'xai', mono:true, regions:[['', 'https://api.x.ai/v1', 'xai-global-api']] },
  { id:'mistral', kind:'vendor', label:'Mistral', icon:'mistral-color', regions:[['', 'https://api.mistral.ai/v1', 'mistral-global-api']] },
  { id:'qwen', kind:'vendor', label:'Qwen', icon:'qwen-color', regions:[['Singapore', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen-global-global-api'], ['China', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-china-global-api'], ['US', 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', 'qwen-us-global-api']] },
  { id:'glm', kind:'vendor', label:'Zhipu GLM', icon:'zhipu-color', regions:[['Global', 'https://api.z.ai/api/paas/v4', 'zai-global-api'], ['China', 'https://open.bigmodel.cn/api/paas/v4', 'zhipu-global-api']] },
  { id:'minimax', kind:'vendor', label:'MiniMax', icon:'minimax-color', model:'MiniMax-M3', regions:[['Global', 'https://api.minimax.io/v1', 'minimax-global-api'], ['China', 'https://api.minimaxi.com/v1', 'minimax-china-api']] },
  { id:'groq', kind:'vendor', label:'Groq', icon:'groq', mono:true, regions:[['', 'https://api.groq.com/openai/v1', 'groq-global-api']] },
  { id:'openrouter', kind:'relay', label:'OpenRouter', icon:'openrouter', mono:true, regions:[['', 'https://openrouter.ai/api/v1', 'openrouter-global-api']] },
  { id:'siliconflow', kind:'relay', label:'SiliconFlow', icon:'siliconcloud-color', regions:[['Global', 'https://api.siliconflow.com/v1', 'siliconflow-global-global-api'], ['China', 'https://api.siliconflow.cn/v1', 'siliconflow-global-api']] },
  { id:'together', kind:'relay', label:'Together AI', icon:'together-color', regions:[['', 'https://api.together.xyz/v1']] },
  { id:'opencode', kind:'relay', label:'OpenCode', icon:'opencode', mono:true, regions:[['Zen', 'https://opencode.ai/zen/v1', 'opencode-zen-global-api'], ['Go', 'https://opencode.ai/zen/go/v1', 'opencode-go-global-api']] },
  { id:'ollama', kind:'local', label:'Ollama', icon:'ollama', mono:true, localKey:'ollama', regions:[['', 'http://localhost:11434/v1']] },
  { id:'lmstudio', kind:'local', label:'LM Studio', icon:'lmstudio', mono:true, localKey:'lm-studio', regions:[['', 'http://localhost:1234/v1']] },
  { id:'custom', kind:'custom', label:'Custom', regions:[['', '']] },
].map(s => ({ format:'openai', model:'', ...s, regions:s.regions.map(([label, url, preset = '', keyUrl = '']) => ({ label, url, preset, keyUrl })) }));
const keyService = id => KEY_SERVICES.find(s => s.id === id) || keyService('custom');
// The provider and region a saved key is for: by its preset, else by its address, else Custom.
function keyPlaceOf(c) {
  for (const by of [r => r.preset && r.preset === c.apiPreset, (r, s) => r.url && r.url === c.apiUrl && s.format === c.apiFormat]) {
    for (const s of KEY_SERVICES) { const region = s.regions.findIndex(r => by(r, s)); if (region >= 0) return { s, region }; }
  }
  return { s:keyService('custom'), region:0 };
}
// OpenCode serves each model in its own format, so the server saves the exact path (/messages or /chat/completions) and sends the
// x-opencode-session header OpenCode asks for. The form shows the base address that was picked.
const keyFormUrl = c => (/^opencode-(?:zen|go)-global-api$/.test(c?.apiPreset || '') ? String(c.apiUrl || '').replace(/\/(?:messages|chat\/completions)$/, '') : c?.apiUrl || '');
const keyHost = url => { try { return new URL(url).host; } catch { return url || ''; } };
// Its logo (one in black only turns white in Dark), or a key for Custom.
const keyIconHTML = s => (s?.icon ? `<img class="pk-img ${s.mono ? 'is-mono' : ''}" src="lines/provider-icons/${s.icon}.svg" alt="" draggable="false">` : ic('key', 15));
// What a saved key is for, in a word: the provider, with its region when it has more than one; a custom one by its address.
function keyPlaceLabel(c) {
  const { s, region } = keyPlaceOf(c), r = s.regions[region];
  return s.id === 'custom' ? keyHost(c.apiUrl) : s.regions.length > 1 ? `${s.label} · ${r.label}` : s.label;
}
// The Canvas's own settings routes, which keep the keys. Keys never come back from them: only whether one is saved.
async function settingsCall(path, body) {
  const response = await fetch(`/api/settings${path}`, { method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store', headers:body ? { 'content-type':'application/json', accept:'application/json' } : { accept:'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'That did not work. Try again.');
  return data;
}
async function loadKeys() {
  SET.keysAsked = true;
  if (!S.thisComputer) { SET.keys = []; SET.keysError = ''; return; }
  try { const data = await settingsCall('/connections'); SET.keys = data.connections || []; SET.keysError = ''; }
  catch (error) { SET.keysError = error.message; }
  if ((S.shelfPage === 'agents' && SET.agentsTab === 'canvas') || S.shelfPage === 'providers') settingsRender();
}
const CLI_NAMES = { 'kimi-cli':'Kimi CLI', 'codex-cli':'Codex CLI', 'claude-cli':'Claude CLI' };
// A relay supplies the connection, but the model keeps its maker's identity.
function keyModelService(c) {
  const model = String(c.apiModel || '').toLowerCase().split('/').pop();
  const families = [['openai', /^(gpt-|o[1-9](?:-|$)|chatgpt-)/], ['kimi', /^(kimi-|moonshot-)/], ['anthropic', /^claude-/], ['deepseek', /^deepseek-/], ['gemini', /^gemini-/], ['qwen', /^qwen/], ['glm', /^glm-/], ['minimax', /^minimax-/], ['xai', /^grok-/], ['mistral', /^(mistral|mixtral|codestral|magistral)/]];
  const family = families.find(([, pattern]) => pattern.test(model));
  return family ? keyService(family[0]) : keyPlaceOf(c).s;
}
function keyRowHTML(c, active = canvasAiChosen()) {
  if (c.provider !== 'api') {
    return `<div class="sys-row is-off"><span class="sys-mark">${ic('x', 15)}</span><span class="sys-text"><strong>${esc(CLI_NAMES[c.provider] || c.name)}</strong><small>No longer used. Configure this CLI in its own agent settings.</small></span><span class="sys-acts">${c.removable ? `<button type="button" class="link" data-act="key-remove" data-id="${esc(c.id)}">Remove</button>` : ''}</span></div>`;
  }
  const { s } = keyPlaceOf(c), modelService = keyModelService(c);
  const place = keyPlaceLabel(c), label = modelService.id !== s.id ? `${modelService.label} · via ${place}` : place;
  // The key Canvas AI uses says so; another can be made the one in a click.
  const inUse = c.id === active;
  const use = inUse ? '<button type="button" class="link" data-act="settings-tab" data-tab="canvas-ai">Open Canvas AI →</button>'
    : c.hasApiKey ? `<button type="button" class="btn sm soft-accent" data-act="key-use" data-id="${esc(c.id)}">Use in Canvas AI</button>` : '';
  return `<div class="sys-row" data-key="${esc(c.id)}"><span class="sys-mark">${keyIconHTML(modelService)}</span><span class="sys-text"><strong><span>${esc(c.apiModel || c.name)}</span>${inUse ? '<span class="kind-tag is-accent">Active in Canvas AI</span>' : ''}</strong><small>${esc([label, s.localKey ? '' : c.hasApiKey ? 'key saved' : 'no key'].filter(Boolean).join(' · '))}</small></span>
    <span class="sys-acts">${use}<button type="button" class="link" data-act="key-edit" data-id="${esc(c.id)}">Edit</button>${c.removable ? `<button type="button" class="link" data-act="key-remove" data-id="${esc(c.id)}">Remove</button>` : ''}</span></div>`;
}
// Add a provider: a find box, then a tile for each provider under its kind. A dot marks one that has a key saved already.
const keyFindText = s => [s.label, s.id, ...s.regions.flatMap(r => [r.label, keyHost(r.url)])].join(' ').toLowerCase();
const keyFound = (s, q) => !q || keyFindText(s).includes(q.trim().toLowerCase());
function keyPickerHTML() {
  const q = SET.keyFind || '', saved = new Set((SET.keys || []).filter(c => c.provider === 'api').map(c => keyPlaceOf(c).s.id));
  const kinds = KEY_KINDS.map(([kind, title]) => {
    const list = KEY_SERVICES.filter(s => s.kind === kind);
    return `<div class="pk-kind" ${list.some(s => keyFound(s, q)) ? '' : 'hidden'}><h4>${title}</h4><div class="pk-grid">${list.map(s => `<button type="button" class="pk-tile" data-act="key-pick" data-service="${s.id}" data-find="${esc(keyFindText(s))}" title="${esc(s.regions.map(r => keyHost(r.url)).join(' · '))}" ${keyFound(s, q) ? '' : 'hidden'}>${keyIconHTML(s)}<span>${esc(s.label)}</span>${saved.has(s.id) ? '<i class="pk-dot" title="Key saved"></i>' : ''}</button>`).join('')}</div></div>`;
  }).join('');
  const none = KEY_SERVICES.every(s => s.kind === 'custom' || !keyFound(s, q));
  return `<div class="sys-picker" role="group" aria-label="Add a provider">
    <div class="pk-head"><input id="pkFind" class="pk-find" type="search" value="${esc(q)}" placeholder="Find a provider" aria-label="Find a provider" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="sys-gap"></span><button type="button" class="btn sm" data-act="key-pick" data-service="custom">${ic('plus', 14)}Custom</button><button type="button" class="btn sm" data-act="key-pick-close">Close</button></div>
    ${kinds}
    <p class="pk-none" ${none ? '' : 'hidden'}>Nothing called “<span>${esc(q.trim())}</span>”. <button type="button" class="link" data-act="key-pick" data-service="custom">Add it as Custom</button></p>
  </div>`;
}
// Finding hides tiles in place, so the box keeps its focus and what is typed.
function keyFindApply(box) {
  SET.keyFind = box.value;
  const picker = box.closest('.sys-picker'), q = box.value.trim().toLowerCase();
  picker.querySelectorAll('.pk-tile').forEach(t => { t.hidden = Boolean(q) && !t.dataset.find.includes(q); });
  picker.querySelectorAll('.pk-kind').forEach(g => { g.hidden = !g.querySelector('.pk-tile:not([hidden])'); });
  const none = picker.querySelector('.pk-none');
  none.hidden = Boolean(picker.querySelector('.pk-tile:not([hidden])'));
  none.querySelector('span').textContent = box.value.trim();
}
document.addEventListener('input', e => { if (e.target.matches?.('.pk-find')) keyFindApply(e.target); });
document.addEventListener('keydown', e => {
  if (!e.target.matches?.('.pk-find')) return;
  // Enter takes the first provider found; Escape empties the box, then closes.
  if (e.key === 'Enter') { e.preventDefault(); e.target.closest('.sys-picker').querySelector('.pk-tile:not([hidden])')?.click(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (e.target.value) { e.target.value = ''; keyFindApply(e.target); } else ACT['key-pick-close'](); }
});
function keyFormHTML() {
  const k = SET.key;
  if (k.picking) return keyPickerHTML();
  const s = keyService(k.service), local = Boolean(s.localKey), keyUrl = (s.regions[k.region] || s.regions[0]).keyUrl;
  const seg = (act, field, list) => `<div class="seg" role="radiogroup">${list.map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === k[field]}" data-act="${act}" data-value="${esc(v)}"><span>${esc(label)}</span></button>`).join('')}</div>`;
  return `<form class="sys-form" data-form="key">
    <div class="pk-chosen sys-wide"><span class="sys-mark">${keyIconHTML(s)}</span><strong>${esc(s.label)}</strong>
      ${s.id === 'custom' ? seg('key-format', 'format', [['openai', 'OpenAI format'], ['anthropic', 'Anthropic format']]) : s.regions.length > 1 ? seg('key-region', 'region', s.regions.map((r, i) => [i, r.label])) : ''}
      <span class="sys-gap"></span><button type="button" class="link" data-act="key-change">Change</button></div>
    <label class="sys-wide"><span>Address</span><input name="url" value="${esc(k.url)}" placeholder="https://…/v1" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
    <label><span>Model</span><span class="sys-inline"><input name="model" list="sysKeyModels" value="${esc(k.model)}" placeholder="${esc(s.model || 'model name')}" autocomplete="off" autocapitalize="off" spellcheck="false" required><datalist id="sysKeyModels">${(k.models || []).map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist><button type="button" class="btn sm" data-act="key-models" ${k.busy ? 'disabled' : ''}>List models</button></span></label>
    ${local ? '' : `<label class="sys-wide"><span>API key</span><span class="sys-inline"><input name="key" type="password" value="${esc(k.key)}" placeholder="${k.id && k.hasKey ? 'Saved. Type a new one to replace it.' : 'Paste your key'}" autocomplete="off" ${k.id && k.hasKey ? '' : 'required'}>${keyUrl ? `<a class="sys-get-key" href="${esc(keyUrl)}" target="_blank" rel="noopener noreferrer">Get a key ↗</a>` : ''}</span></label>`}
    ${k.id ? '' : `<label class="sys-check sys-wide"><input type="checkbox" name="useNow" ${k.useNow ? 'checked' : ''}><span>Use for Canvas AI right away</span></label>`}
    ${k.said ? `<p class="sys-said ${k.ok ? 'ok' : 'bad'}" role="status">${k.ok ? ic('check', 14) : ''}${esc(k.said)}</p>` : ''}
    <footer><button type="button" class="btn sm" data-act="key-test" ${k.busy ? 'disabled' : ''}>Test</button><span class="sys-gap"></span><button type="button" class="btn sm" data-act="key-cancel">Cancel</button><button type="submit" class="btn sm primary" ${k.busy ? 'disabled' : ''}>${k.id ? 'Save' : 'Add provider'}</button></footer>
  </form>`;
}
function cloudRowHTML() {
  const a = S.cloudAccount, m = presetRunner('penecho')?.model, credits = a?.credits?.available ?? m?.credits;
  if (a?.signedIn || m?.signedIn) {
    const left = credits !== null && credits !== undefined && Number.isFinite(Number(credits)) ? `${Number(credits).toLocaleString()} credits` : '';
    const models = SET.cloud?.models?.length ? 'Cloud models ready in Canvas AI' : SET.cloudLoading ? 'Loading Cloud models…' : '';
    return `<div class="sys-row"><span class="sys-mark is-cloud">${ic('cloud', 15)}</span><span class="sys-text"><strong><span>PenEcho Cloud</span><span class="kind-tag is-green">Connected</span></strong><small>${esc([a?.name || 'Signed in', left, models].filter(Boolean).join(' · '))}</small></span><span class="sys-acts"><button type="button" class="btn sm soft-accent" data-act="settings-tab" data-tab="canvas-ai">Pick Cloud model →</button></span></div>`;
  }
  return `<div class="sys-row"><span class="sys-mark is-cloud">${ic('cloud', 15)}</span><span class="sys-text"><strong>PenEcho Cloud</strong><small>Models paid with credits. No key needed.</small></span><span class="sys-acts"><button type="button" class="btn sm" data-act="cloud-sign-in">Sign in</button></span></div>`;
}
// ---------- Canvas AI: the model the Canvas's own AI uses ----------
// The Canvas keeps this choice in the browser (core.js selectedAiConnectionId): a key of your own by its id, or a PenEcho Cloud model
// as hosted:<id> under the signed-in account. This page is on the same origin, so it reads and writes the very same entries.
const CANVAS_AI = 'penecho-ai-connection-id';
const localAiKey = () => `${CANVAS_AI}:local:${location.origin}`;
const hostedAiKey = () => (SET.cloud?.account ? `${CANVAS_AI}:${SET.cloud.origin || 'https://penecho.ai'}:${SET.cloud.account}:local:hosted` : '');
const canvasAiSettingsOpen = () => S.shelfPage === 'agents' && SET.agentsTab === 'canvas';
const cloudSignInNeeded = () => S.cloudAccount?.signedIn === false && !S.cloudAccount.unavailable;
function refreshCloudSettings(previous, account) {
  const who = a => [a?.signedIn, a?.origin, a?.id || a?.name].join('\n');
  if (account && !account.unavailable && who(account) !== who(previous)) {
    // Discard requests and results from before sign-in, sign-out or a switch to another account.
    SET.cloudAccountVersion++;
    SET.cloud = SET.suggest = null;
    SET.cloudAsked = SET.cloudLoading = SET.suggestAsked = false;
  }
  if ((canvasAiSettingsOpen() || S.shelfPage === 'providers' || (S.shelfPage === 'settings' && SET.tab === 'general')) && $('#view')) settingsRender();
}
async function loadCloudModels() {
  if (SET.cloudLoading) return;
  const version = SET.cloudAccountVersion;
  SET.cloudAsked = SET.cloudLoading = true;
  SET.cloudRefreshAt = Infinity;
  let catalog = null;
  try {
    const response = typeof HOSTED !== 'undefined' && HOSTED && typeof hostedFetch === 'function'
      ? await hostedFetch('/cloud/models', { method:'GET' })
      : await fetch('/api/cloud/models', { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } });
    const body = response.ok ? await response.json() : null;
    if (body) catalog = { account:String(body.accountId || ''), origin:String(body.origin || ''), models:(Array.isArray(body.models) ? body.models : [])
      .filter(m => m.available === true && m.enabled !== false && !m.retiredAt && Number(m.multiplier) >= 0).sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)) };
  } catch { /* Settings offers a retry. */ }
  if (version !== SET.cloudAccountVersion) return;
  SET.cloud = catalog;
  SET.cloudLoading = false;
  SET.cloudRefreshAt = Date.now() + (catalog ? 300_000 : 60_000);
  if (canvasAiSettingsOpen() || S.shelfPage === 'providers') settingsRender();
  // orchestrator.js is the computer's only: penecho.ai leaves it out (PE-640).
  if (typeof paintPrices === 'function') paintPrices();
}
function canvasAiChosen() {
  const hosted = hostedAiKey(), store = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  if (hosted && store(`${hosted}:selected`) === 'true') return store(hosted);
  return store(localAiKey()) || (store(CANVAS_AI).startsWith('hosted:') ? '' : store(CANVAS_AI));
}
function canvasAiModelMeta(keys) {
  const own = (keys || []).filter(c => c.provider === 'api' && c.hasApiKey), cloud = SET.cloud?.models || [], chosen = canvasAiChosen();
  const known = [...own.map(c => c.id), ...cloud.map(m => `hosted:${m.id}`)], value = known.includes(chosen) ? chosen : '';
  const selectedOwn = own.find(c => c.id === value), selectedCloud = cloud.find(m => `hosted:${m.id}` === value);
  const currentLabel = selectedOwn ? (selectedOwn.apiModel || selectedOwn.name) : selectedCloud ? (selectedCloud.displayName || selectedCloud.name || selectedCloud.id) : '';
  return { own, cloud, value, currentLabel, none: !own.length && !cloud.length };
}
function canvasAiOptionsHTML(meta) {
  const { own, cloud, value } = meta;
  return [
    ...(value ? [] : ['<option value="" selected>Choose a model</option>']),
    ...(cloud.length ? [`<optgroup label="PenEcho Cloud">${cloud.map(m => `<option value="hosted:${esc(m.id)}" ${`hosted:${m.id}` === value ? 'selected' : ''}>${esc(m.displayName || m.name || m.id)}</option>`).join('')}</optgroup>`] : []),
    ...(own.length ? [`<optgroup label="Your API keys">${own.map(c => `<option value="${esc(c.id)}" ${c.id === value ? 'selected' : ''}>${esc(c.apiModel || c.name)}</option>`).join('')}</optgroup>`] : []),
  ].join('');
}
function canvasAiCardHTML(keys) {
  const signIn = cloudSignInNeeded();
  if (!signIn && (!SET.cloudAsked || Date.now() >= SET.cloudRefreshAt)) loadCloudModels();
  const meta = canvasAiModelMeta(keys);
  const providersLink = (label = 'Manage API providers') => `<button type="button" class="link sys-canvas-providers" data-act="open-providers" data-focus-id="sysTab-providers">${label}</button>`;
  let hint = meta.currentLabel
    ? `${esc(`Currently using ${meta.currentLabel}`)} · ${providersLink()}`
    : `Pick which model answers when you draw on a Canvas. ${providersLink()}`;
  let actions = '';
  if (meta.none) {
    if (S.thisComputer) actions = `<button type="button" class="btn sm primary" data-act="settings-go-keys">${ic('plus', 14)}Add API provider</button>`;
    if (signIn) {
      hint = `Sign in to PenEcho Cloud${S.thisComputer ? ' or add an API provider' : ''} to pick a model for Canvas AI. ${providersLink('API providers')}`;
      actions += '<button type="button" class="btn sm" data-act="cloud-sign-in">Sign in to Cloud</button>';
    } else {
      const status = SET.cloudLoading ? 'Loading Cloud models…' : SET.cloud ? 'No Cloud models are available.' : 'Couldn’t load Cloud models.';
      hint = `${S.cloudAccount?.signedIn ? 'Signed in to PenEcho Cloud. ' : ''}${status} ${providersLink('API providers')}`;
      if (!SET.cloudLoading && !SET.cloud) actions += '<button type="button" class="btn sm" data-act="canvas-ai-retry">Retry</button>';
    }
  }
  return `<div class="sys-canvas-ai" aria-label="Canvas AI model">
    <div class="sys-canvas-ai-copy">
      <div class="sys-canvas-ai-top">${ic('pen', 16)}<strong id="settingsCanvasAiTitle" tabindex="-1">Canvas AI</strong>${meta.currentLabel ? `<span class="kind-tag is-accent">${esc(meta.currentLabel)}</span>` : ''}${SET.canvasAiSaved ? `<span class="sys-saved" role="status">${ic('check', 13)}${esc(SET.canvasAiSaved)}</span>` : ''}</div>
      <p>The <b>drawing Canvas answer AI</b> — answers right beside your strokes when you tap AI, circle ink, or turn on Auto AI.</p>
      <small>${hint}</small>
    </div>
    <div class="sys-canvas-ai-pick">
      ${meta.none
        ? actions
        : `<select id="settingsCanvasAiSelect" class="sys-pick sys-canvas-pick" data-canvas-ai aria-label="Model for Canvas AI">${canvasAiOptionsHTML(meta)}</select>${canvasAiEffortHTML()}`}
    </div>
  </div>`;
}
ACT['canvas-ai-retry'] = button => {
  const hadFocus = document.activeElement === button;
  loadCloudModels();
  settingsRender();
  if (hadFocus) $('#settingsCanvasAiTitle')?.focus({ preventScroll:true });
};
// How hard Canvas AI thinks: the same choice as the effort menu in the Canvas AI bar (core.js keeps it as penecho-ai-effort).
const CANVAS_AI_EFFORT = 'penecho-ai-effort';
const CANVAS_AI_EFFORTS = [['config', 'Default effort'], ['none', 'No thinking'], ['low', 'Low effort'], ['medium', 'Medium effort'], ['high', 'High effort'], ['max', 'Max effort']];
function canvasAiEffort() {
  const v = lsGet(CANVAS_AI_EFFORT, '').trim().toLowerCase();
  return v && v.length <= 128 && !/[\r\n\0]/.test(v) ? v : (typeof HOSTED !== 'undefined' && HOSTED ? 'high' : 'config');
}
function canvasAiEffortHTML() {
  const now = canvasAiEffort(), known = CANVAS_AI_EFFORTS.some(([v]) => v === now);
  return `<select id="settingsCanvasAiEffort" class="sys-pick sys-canvas-effort" data-canvas-effort aria-label="Thinking effort for Canvas AI">${[...CANVAS_AI_EFFORTS, ...(known ? [] : [[now, `${now} effort`]])].map(([v, label]) => `<option value="${esc(v)}" ${v === now ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}
document.addEventListener('change', e => {
  const box = e.target;
  if (!box.matches?.('select[data-canvas-effort]') || !box.value) return;
  lsSet(CANVAS_AI_EFFORT, box.value);
  SET.canvasAiSaved = 'Saved';
  toast(`Canvas AI: ${box.selectedOptions[0]?.textContent || box.value}, from now on.`);
  requestAnimationFrame(settingsRender);
});
// Makes a PenEcho Cloud model (hosted:<id>) or a saved key the one Canvas AI uses, in the entries the Canvas reads. It throws when storage fails.
function selectCanvasAiConnection(id) {
  const hosted = hostedAiKey();
  if (id.startsWith('hosted:')) {
    if (hosted) { localStorage.setItem(hosted, id); localStorage.setItem(`${hosted}:selected`, 'true'); }
    localStorage.setItem(CANVAS_AI, id);
  } else {
    localStorage.setItem(localAiKey(), id);
    localStorage.setItem(CANVAS_AI, id);
    if (hosted) localStorage.setItem(`${hosted}:selected`, 'false');
  }
}
document.addEventListener('change', e => {
  const box = e.target;
  if (!box.matches?.('select[data-canvas-ai]') || !box.value) return;
  try {
    selectCanvasAiConnection(box.value);
    const label = box.selectedOptions[0]?.textContent || 'it';
    SET.canvasAiSaved = 'Saved';
    toast(`Canvas AI uses ${label} from now on.`);
  } catch (error) { toast(error.message); }
  requestAnimationFrame(settingsRender);
});
// Two steps in one strip at the top of API providers and Canvas AI: connect a provider, then pick the model Canvas AI uses.
function canvasFlowStripHTML(active) {
  const keys = SET.keys || [], own = keys.filter(c => c.provider === 'api' && c.hasApiKey).length;
  const cloud = Boolean(S.cloudAccount?.signedIn || presetRunner('penecho')?.model?.signedIn);
  const sources = [cloud ? 'PenEcho Cloud' : '', own ? `${own} API key${own === 1 ? '' : 's'}` : ''].filter(Boolean);
  const meta = canvasAiModelMeta(keys);
  const pick = meta.currentLabel ? [`Using ${esc(meta.currentLabel)}`, 'ok'] : meta.none ? ['Pick a model after connecting a provider', ''] : ['Choose a model', 'warn'];
  return sysFlowHTML('Canvas AI setup',
    sysFlowStepHTML('providers', 1, 'API providers', sources.length ? esc(sources.join(' · ')) : 'No provider connected yet', { active:active === 'providers', tone:sources.length ? '' : 'warn' }),
    sysFlowStepHTML('canvas-ai', 2, 'Canvas AI', pick[0], { active:active === 'canvas-ai', tone:pick[1] }));
}
function penechoSectionHTML() {
  if (!SET.keysAsked) loadKeys();
  if (!cloudSignInNeeded() && (!SET.cloudAsked || Date.now() >= SET.cloudRefreshAt)) loadCloudModels();
  const keys = SET.keys || [], active = canvasAiChosen();
  return `${canvasFlowStripHTML('providers')}<section class="sys-sec" aria-label="API providers">
    <div class="sys-subsec">
      <div class="sys-subhead"><div><h3>PenEcho Cloud</h3><p class="sys-note">Zero-key managed models for Canvas AI, paid with PenEcho Cloud credits.</p></div></div>
      <div class="shelf-list">${cloudRowHTML()}</div>
    </div>
    <div class="sys-subsec" id="sysKeys">
      <div class="sys-subhead">
        <div><h3>Your API keys &amp; local model servers</h3><p class="sys-note">Used strictly by <strong>Canvas AI</strong> (drawing answers &amp; handwriting). Project agents use <button type="button" class="sys-inline-link" data-act="open-setup">Local providers</button> instead.</p></div>
        ${!S.thisComputer || SET.key ? '' : `<button type="button" class="btn sm" data-act="key-new">${ic('plus', 14)}Add API provider</button>`}
      </div>
      ${S.thisComputer ? `
        ${SET.key && !SET.key.id ? keyFormHTML() : ''}
        <div class="shelf-list">${keys.length ? keys.map(c => SET.key?.id === c.id ? `<div class="sys-row is-editing">${keyFormHTML()}</div>` : keyRowHTML(c, active)).join('') : (SET.key && !SET.key.id ? '' : '<p class="empty-line sys-empty-keys">No API provider yet. Add one above, or use PenEcho Cloud credits.</p>')}</div>
        ${SET.keysError ? `<p class="sys-note is-bad">${esc(SET.keysError)}</p>` : ''}
      ` : '<p class="empty-line">Custom API keys are saved privately on the computer that runs PenEcho.</p>'}
    </div>
  </section>`;
}
// A new key starts at Add a provider; a saved one opens its form, keeping its own preset while its address stays the same.
function keyFormFor(c) {
  const { s, region } = c ? keyPlaceOf(c) : { s:null, region:0 };
  SET.keyFind = '';
  return { id:c?.id || '', picking:!c, useNow:!c, service:s?.id || '', region, format:c?.apiFormat || 'openai', url:keyFormUrl(c), model:c?.apiModel || '', key:'', hasKey:Boolean(c?.hasApiKey),
    saved:c ? { service:s.id, url:keyFormUrl(c), preset:c.apiPreset || '' } : null, effort:c?.effort || '', models:[], said:'', ok:false, busy:false };
}
// The box to fill first: a server on this computer needs only a model, Custom an address, the rest a key.
function keyFocus() {
  const k = SET.key; if (!k) return;
  if (k.picking) { $('#pkFind')?.focus(); return; }
  const s = keyService(k.service), box = s.localKey ? 'model' : s.id === 'custom' && !k.url ? 'url' : k.id && k.hasKey ? 'model' : 'key';
  $(`.sys-form[data-form="key"] [name="${box}"]`)?.focus();
}
function openKeyForm(c) {
  SET.key = keyFormFor(c);
  settingsRender();
  requestAnimationFrame(keyFocus);
}
ACT['key-new'] = () => openKeyForm(null);
// A tile fills in the provider's address and model; the same provider again keeps what was typed.
ACT['key-pick'] = el => {
  const k = SET.key; if (!k) return;
  const s = keyService(el.dataset.service);
  if (s.id !== k.service) Object.assign(k, { service:s.id, region:0, format:s.format, url:s.regions[0].url, model:s.model, models:[], said:'' });
  k.picking = false; SET.keyFind = '';
  settingsRender();
  requestAnimationFrame(keyFocus);
};
ACT['key-pick-close'] = () => { const k = SET.key; if (k?.service) k.picking = false; else SET.key = null; settingsRender(); requestAnimationFrame(keyFocus); };
ACT['key-change'] = () => { keyFormRead(); SET.key.picking = true; settingsRender(); requestAnimationFrame(keyFocus); };
// Another region moves the address with it, unless it was changed by hand.
ACT['key-region'] = el => {
  keyFormRead();
  const k = SET.key, s = keyService(k.service), was = s.regions[k.region], i = Number(el.dataset.value);
  if (!s.regions[i]) return;
  if (!k.url || k.url === was?.url) k.url = s.regions[i].url;
  Object.assign(k, { region:i, models:[], said:'' });
  settingsRender();
};
ACT['key-format'] = el => { keyFormRead(); Object.assign(SET.key, { format:el.dataset.value === 'anthropic' ? 'anthropic' : 'openai', models:[], said:'' }); settingsRender(); };
// From an Ask held for credits, or Canvas AI with no model: Providers, with a new key's form open.
ACT['open-keys'] = () => { SET.key = keyFormFor(null); openProviders(); requestAnimationFrame(() => document.getElementById('sysKeys')?.scrollIntoView({ block:'start' })); };
ACT['settings-go-keys'] = ACT['open-keys'];
ACT['key-use'] = el => {
  const c = (SET.keys || []).find(x => x.id === el.dataset.id); if (!c) return;
  try { selectCanvasAiConnection(c.id); SET.canvasAiSaved = 'Saved'; toast(`Canvas AI uses ${c.apiModel || c.name} from now on.`); }
  catch (error) { toast(error.message); }
  settingsRender();
};
ACT['key-edit'] = el => openKeyForm((SET.keys || []).find(c => c.id === el.dataset.id));
ACT['key-cancel'] = () => { SET.key = null; settingsRender(); };
function keyFormRead() {
  const form = $('.sys-form[data-form="key"]'), k = SET.key; if (!form || !k) return null;
  const data = new FormData(form);
  k.url = String(data.get('url') || '').trim(); k.model = String(data.get('model') || '').trim(); k.key = String(data.get('key') || '').trim();
  const useNow = form.querySelector('[name="useNow"]');
  if (useNow) k.useNow = Boolean(useNow.checked);
  const s = keyService(k.service), r = s.regions[k.region] || s.regions[0];
  // The address of a known provider stays that provider's; one changed by hand is a key for another address in the same format.
  const apiPreset = r.preset && k.url === r.url ? r.preset : k.saved && k.saved.service === s.id && k.saved.url === k.url ? k.saved.preset : '';
  return { provider:'api', apiFormat:s.id === 'custom' ? k.format : s.format, apiUrl:k.url, apiModel:k.model, apiKey:s.localKey || k.key, apiPreset, effort:k.effort };
}
async function keyBusy(fn) {
  const k = SET.key; if (!k || k.busy) return;
  k.busy = true; k.said = ''; settingsRender();
  try { await fn(k); } catch (error) { k.said = error.message; k.ok = false; }
  if (SET.key === k) { k.busy = false; settingsRender(); }
}
ACT['key-models'] = () => { const connection = keyFormRead(); keyBusy(async k => { const r = await settingsCall('/connections/models', { id:k.id, connection }); k.models = r.models || []; k.said = `${k.models.length} models found. Pick one in Model.`; k.ok = true; }); };
ACT['key-test'] = () => { const connection = keyFormRead(); keyBusy(async k => { const r = await settingsCall('/connections/test', { id:k.id, connection }); k.said = r.message || 'It answered.'; k.ok = true; }); };
function keySave() {
  const connection = keyFormRead();
  keyBusy(async k => {
    const r = await settingsCall('/connections', { action:'save', ...(k.id ? { id:k.id } : {}), connection });
    SET.keys = r.connections || SET.keys; SET.key = null;
    // A new key is what Canvas AI uses when that box was left ticked, and the first key of your own is until something else is chosen.
    let using = false;
    if ((k.useNow || !canvasAiChosen()) && r.savedId) { try { selectCanvasAiConnection(r.savedId); using = true; } catch { /* The Canvas asks for a model instead. */ } }
    // Show the persisted result now, without waiting for the independent CLI scan.
    settingsRender();
    toast(k.id ? 'Saved.' : using ? `Added. Canvas AI uses ${connection.apiModel} now.` : `Added ${connection.apiModel}.`);
  });
}
ACT['key-remove'] = async el => {
  const c = (SET.keys || []).find(x => x.id === el.dataset.id); if (!c) return;
  if (!confirm(`Remove ${c.apiModel || CLI_NAMES[c.provider] || c.name}? Its saved key is deleted from this computer.`)) return;
  try { const r = await settingsCall('/connections', { action:'delete', id:c.id }); SET.keys = r.connections || []; settingsRender(); }
  catch (error) { toast(error.message); }
};

// ---------- The Settings window ----------
// Everything set once for all of PenEcho opens in one window over the page you are on, with a tab for each part, as the Canvas's
// settings did. Each tab keeps its own address, so links made before the window still land on the right tab.
const SETTINGS_PAGES = new Set(['agents', 'providers', 'settings', 'archived', 'setup']);
const settingsUp = () => SETTINGS_PAGES.has(S.shelfPage);
// The tabs, each in its group. A workflow's steps say so in the window's header.
const SYS_GROUPS = [['agents', 'Project agents'], ['canvas', 'Canvas'], ['integrations', 'Integrations'], ['app', 'App']];
const SYS_TABS = [
  { id:'setup', label:'Local providers', icon:'setLocalProviders', page:'setup', hash:'#setup', group:'agents', domain:'Project agents · Step 1' },
  { id:'agents', label:'Preset agents', icon:'setAgents', page:'agents', sub:'agents', hash:'#agents', group:'agents', domain:'Project agents · Step 2' },
  { id:'providers', label:'API providers', icon:'setProviders', page:'providers', hash:'#providers', group:'canvas', domain:'Canvas AI · Step 1' },
  { id:'canvas-ai', label:'Canvas AI', icon:'setCanvasAi', page:'agents', sub:'canvas', hash:'#agents/canvas', group:'canvas', domain:'Canvas AI · Step 2' },
  { id:'canvas', label:'View', title:'Canvas view', icon:'navCanvases', page:'settings', sub:'canvas', hash:'#settings/canvas', group:'canvas', domain:'Canvas' },
  { id:'apps', label:'MCP', icon:'setMcp', page:'agents', sub:'apps', hash:'#agents/apps', group:'integrations', domain:'External integration' },
  { id:'general', label:'General', icon:'setGeneral', page:'settings', sub:'general', hash:'#settings/general', group:'app', domain:'App' },
  // penecho.ai's dashboard keeps its own projects, so there is nothing archived to list there.
  { id:'archived', label:'Archived', icon:'navArchive', page:'archived', hash:'#archived', local:true, group:'app', domain:'App' },
];
const sysTabs = () => SYS_TABS.filter(t => !(t.local && typeof HOSTED !== 'undefined' && HOSTED));
const sysTab = id => SYS_TABS.find(t => t.id === id) || SYS_TABS.find(t => t.id === 'agents');
// The tab on show, from the page and its section.
function sysTabNow() {
  if (S.shelfPage === 'setup') return 'setup';
  if (S.shelfPage === 'agents') return SET.agentsTab === 'canvas' ? 'canvas-ai' : SET.agentsTab === 'apps' ? 'apps' : 'agents';
  if (S.shelfPage === 'settings') return SET.tab === 'general' ? 'general' : 'canvas';
  return S.shelfPage === 'archived' ? 'archived' : 'providers';
}
// Where the gear opens: Local providers while a CLI needs a fix or no preset is saved yet, else Preset agents. penecho.ai has no CLIs to check.
function defaultSettingsTab() {
  if (typeof HOSTED !== 'undefined' && HOSTED) return 'agents';
  return (S.agentCheck?.problems || 0) > 0 || (S.presets && !(S.presets.presets || []).some(p => !p.auto)) ? 'setup' : 'agents';
}
// Opening keeps the page beneath as it is (New project too). Moving between tabs replaces the address, so Back closes the window.
function openSettings(id, { replace = false, sub = '' } = {}) {
  const t = sysTab(id), was = settingsUp(), hash = t.id === 'agents' && sub === 'prices' ? AGENTS_PRICES : t.hash;
  if (t.id === 'agents' || t.id === 'setup') dismissRailSettingsBadge();
  if (typeof EMBED !== 'undefined' && EMBED) {
    if (typeof renderRail === 'function') renderRail();
    closeSwitcher?.();
    embedTell({ leave:`/projects.html${hash}` });
    return;
  }
  SET.canvasAiSaved = '';
  closeSwitcher?.();
  if (!was) { SET.pushed = !replace; SET.from = document.activeElement; }
  S.shelfPage = t.page;
  if (t.page === 'agents') SET.agentsTab = sub || t.sub;
  if (t.page === 'settings') SET.tab = t.sub;
  S.hashWrite = hash;
  if (location.hash !== hash) {
    if (was || replace) history.replaceState(null, '', hash);
    else location.hash = hash;
  }
  if (typeof hostedAddress === 'function') hostedAddress();
  render();
}
const SETTINGS_TAB_IDS = new Set(['setup', 'agents', 'providers', 'canvas-ai', 'apps', 'canvas', 'general', 'archived']);
function openSettingsTab(tab, { replace = false } = {}) {
  openSettings(!tab ? defaultSettingsTab() : SETTINGS_TAB_IDS.has(tab) ? tab : 'agents', { replace });
}
function openProviders() { openSettings('providers'); }
const agentsHashFor = tab => tab === 'canvas' || tab === 'apps' ? `#agents/${tab}` : '#agents';
function openAgents(tab = 'agents') { openSettings(tab === 'canvas' || tab === 'canvas-ai' ? 'canvas-ai' : tab === 'apps' ? 'apps' : 'agents'); }
ACT['open-settings'] = () => openSettings(defaultSettingsTab());
ACT['open-providers'] = () => openProviders();
ACT['open-agents'] = () => openAgents();
ACT['open-canvas-settings'] = () => openSettings('canvas');
ACT['settings-tab'] = el => openSettings(el.dataset.tab);
ACT['settings-close'] = () => closeSettings();
// Closing shows the page beneath at once. A window opened from here steps Back over its own address; one opened by its
// address alone (the Canvas's settings link) goes back to where that came from.
function closeSettings() {
  if (!settingsUp()) return;
  const ret = settingsReturnInfo(), pushed = SET.pushed, from = SET.from;
  try { sessionStorage.removeItem(SETTINGS_RETURN_KEY); } catch { /* Nothing to forget. */ }
  if (window.PenEchoCanvasShell?.active) {
    Object.assign(SET, { pushed:false, from:null, form:null, key:null, canvasAiSaved:'' });
    S.shelfPage = false;
    dropSettingsModal();
    window.PenEchoCanvasShell.onSettingsClosed(pushed);
    renderRail();
    return;
  }
  if (!pushed && ret?.url) {
    if (window.PenEchoCanvasShell?.enabled?.() && window.PenEchoCanvasShell.parseCanvasUrl(ret.url)) {
      Object.assign(SET, { pushed:false, from:null, form:null, key:null, canvasAiSaved:'' });
      S.shelfPage = false;
      dropSettingsModal();
      void window.PenEchoCanvasShell.open(ret.url, { replaceHistory:true });
      return;
    }
    location.assign(ret.url);
    return;
  }
  Object.assign(SET, { pushed:false, from:null, form:null, key:null, canvasAiSaved:'' });
  S.shelfPage = false;
  const h = S.newPage ? '#new' : S.cur ? `#${routeToHash(S.route)}` : '';
  S.hashWrite = h;
  if (pushed) history.back();
  else history.replaceState(null, '', h || `${location.pathname}${location.search}`);
  render();
  if (from?.isConnected) from.focus({ preventScroll:true });
}

function settingsReturnInfo() {
  try {
    const raw = sessionStorage.getItem(SETTINGS_RETURN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const url = String(data?.url || '').trim();
    if (!url || (!(url.startsWith('/') && !url.startsWith('//')) && !url.startsWith('index.html') && !url.startsWith('?'))) return null;
    return { url, label: String(data?.label || 'Canvas').trim() || 'Canvas' };
  } catch { return null; }
}
ACT['settings-return'] = () => {
  if (window.PenEchoCanvasShell?.active) { closeSettings(); return; }
  const ret = settingsReturnInfo();
  try { sessionStorage.removeItem(SETTINGS_RETURN_KEY); } catch {}
  if (ret?.url) {
    if (window.PenEchoCanvasShell?.enabled?.() && window.PenEchoCanvasShell.parseCanvasUrl(ret.url)) {
      S.shelfPage = false;
      dropSettingsModal();
      void window.PenEchoCanvasShell.open(ret.url, { replaceHistory:true });
      return;
    }
    location.assign(ret.url);
  }
};

function lsGet(key, fallback = '') { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } }
function lsSet(key, val) { try { localStorage.setItem(key, String(val)); } catch (error) { toast(error.message); } }
function penIntelRead() {
  try { return { gestures:true, stepCheck:true, ...JSON.parse(lsGet('penecho-pen-intelligence', '{}') || '{}') }; }
  catch { return { gestures:true, stepCheck:true }; }
}
function penIntelWrite(field, value) {
  const next = { ...penIntelRead(), [field]: Boolean(value) };
  lsSet('penecho-pen-intelligence', JSON.stringify(next));
}
const sysSwitchRowHTML = (id, title, sub, checked, attr, extra = '') =>
  `<div class="sys-row sys-pref-row"><div class="sys-text"><strong id="${id}Lbl">${title}</strong><small>${sub}</small></div><div class="sys-acts">${extra}<button type="button" id="${id}" class="sys-switch ${checked ? 'on' : ''}" role="switch" aria-checked="${checked}" aria-labelledby="${id}Lbl" ${attr}><span class="sys-switch-thumb" aria-hidden="true"></span></button></div></div>`;

// Two private choices, at the bottom of General and only on this computer: anonymous action counts and anonymous
// agent/model ratings. Nothing is requested on pages other than this one, nor while the section is hidden.
function helpImproveSectionHTML(lang) {
  const runtime = String(window.PENECHO_CONFIG?.runtime || 'device');
  if ((typeof HOSTED !== 'undefined' && HOSTED) || !S.thisComputer || runtime === 'cloud' || runtime === 'viewer') return '';
  if (!SET.usageAsked) void loadUsageStatus();
  const status = SET.usage, busy = SET.usageBusy || !status;
  // Both are on by default: while the GET is in flight show them on and waiting, never flashing off.
  const enabled = status ? status.enabled === true : true;
  const ratingsEnabled = status ? status.ratingsEnabled === true : true;
  const text = lang === 'zh' ? {
    head:'帮助我们改进 PenEcho',
    usageTitle:'分享匿名使用次数',
    usageHelp:'帮助我们改进 PenEcho。仅统计操作次数（如“开始了一个 Work”），绝不包含项目或 Line 名称、文件、提示词、画作或路径。',
    ratingsTitle:'分享匿名模型评分',
    ratingsHelp:'仅分享匿名的 Agent 与模型评分及性能指标（如耗时、Token 与完成次数），绝不包含任何项目信息、文件、提示词或代码，用于提供真实评分并帮助所有人提升 Orchestrator 表现。',
    preview:'查看发送内容',
  } : {
    head:'Help us improve PenEcho',
    usageTitle:'Share anonymous usage counts',
    usageHelp:'Helps us improve PenEcho by counting actions only, like “started a Work”. Never includes project or Line names, files, prompts, drawings, or paths.',
    ratingsTitle:'Share anonymous model ratings',
    ratingsHelp:'Shares only anonymous agent and model ratings and performance metrics (such as duration, tokens, and finish counts)—never any project info, files, prompts, or code—so we can publish real-world ratings and improve Orchestrator performance for everyone.',
    preview:'See what is sent',
  };
  const row = (id, title, help, checked, act) => sysSwitchRowHTML(id, title, help, checked, `${busy ? 'disabled ' : ''}data-act="${act}"`);
  const preview = (enabled || ratingsEnabled) && status?.report ? `<details class="sys-usage-details" id="usageStatsPreview" ${SET.usageOpen ? 'open' : ''}><summary data-act="usage-stats-preview">${text.preview}</summary><pre>${esc(JSON.stringify(status.report, null, 2))}</pre></details>` : '';
  return `<section class="sys-sec" id="sysHelpImproveSec" aria-labelledby="sysHelpImprove"><header class="sys-head"><div><h2 id="sysHelpImprove">${text.head}</h2></div></header>
    <div class="shelf-list">
      ${row('usageStatsToggle', text.usageTitle, text.usageHelp, enabled, 'usage-stats-toggle')}
      ${row('modelRatingsToggle', text.ratingsTitle, text.ratingsHelp, ratingsEnabled, 'model-ratings-toggle')}
      ${preview}
    </div>
  </section>`;
}
async function loadUsageStatus(force = false) {
  if (SET.usageBusy || (SET.usageAsked && !force)) return;
  SET.usageAsked = true; SET.usageBusy = true;
  let loaded = false;
  try {
    const r = await fetch('/api/usage-stats', { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } });
    const data = await r.json().catch(() => null);
    if (!r.ok || typeof data?.enabled !== 'boolean' || typeof data?.ratingsEnabled !== 'boolean') throw new Error('Could not load privacy preferences.');
    SET.usage = data; loaded = true;
    if (data.enabled !== true && data.ratingsEnabled !== true) SET.usageOpen = false;
  } catch { /* Keep the last confirmed state; the next Settings opening retries. */ }
  SET.usageBusy = false;
  if ((loaded || force) && S.shelfPage === 'settings' && SET.tab === 'general') settingsRender();
}
// One switch at a time: the other keeps its own state and data.
async function saveUsagePreferences(changes) {
  if (SET.usageBusy || !SET.usage) return;
  SET.usageBusy = true; settingsRender();
  let failed = false;
  try {
    const r = await fetch('/api/usage-stats', { method:'POST', credentials:'same-origin', cache:'no-store', headers:{ 'content-type':'application/json', accept:'application/json' }, body:JSON.stringify(changes) });
    const data = await r.json().catch(() => null);
    if (!r.ok || typeof data?.enabled !== 'boolean' || typeof data?.ratingsEnabled !== 'boolean') throw new Error(data?.error || 'Could not save the privacy preferences.');
    SET.usage = data;
    if (data.enabled !== true && data.ratingsEnabled !== true) SET.usageOpen = false;
  } catch (error) { failed = true; toast(error.message); }
  SET.usageBusy = false;
  // A failed opt-out stays in effect in server memory: re-read so Settings never shows a stale ON switch.
  if (failed) await loadUsageStatus(true);
  else if (S.shelfPage === 'settings' && SET.tab === 'general') settingsRender();
}
ACT['usage-stats-toggle'] = () => saveUsagePreferences({ enabled: SET.usage?.enabled !== true });
ACT['model-ratings-toggle'] = () => saveUsagePreferences({ ratingsEnabled: SET.usage?.ratingsEnabled !== true });
ACT['usage-stats-preview'] = () => {
  SET.usageOpen = !SET.usageOpen;
  settingsRender();
  if (SET.usageOpen) void loadUsageStatus(true);
};

async function loadSuggestStatus() {
  const version = SET.cloudAccountVersion;
  SET.suggestAsked = true;
  const path = typeof HOSTED !== 'undefined' && HOSTED ? '/api/v1/apps/penecho-llm/suggest/status' : '/api/suggest/status';
  let access = null;
  try {
    const r = await fetch(path, { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } });
    const data = r.ok ? await r.json().catch(() => null) : null;
    access = data?.access || data || null;
  } catch { /* Show the default allowance. */ }
  if (version !== SET.cloudAccountVersion) return;
  SET.suggest = access;
  if (canvasAiSettingsOpen()) settingsRender();
}
async function saveSuggestPrefs(paidEnabled, dailyCreditLimit) {
  const version = SET.cloudAccountVersion;
  const path = typeof HOSTED !== 'undefined' && HOSTED ? '/api/v1/apps/penecho-llm/suggest/preferences' : '/api/suggest/preferences';
  SET.suggestBusy = true; settingsRender();
  try {
    const body = { paidEnabled: Boolean(paidEnabled), ...(dailyCreditLimit !== undefined ? { dailyCreditLimit: Number(dailyCreditLimit) } : {}) };
    const r = await (typeof HOSTED !== 'undefined' && HOSTED && typeof hostedCall === 'function'
      ? hostedCall(path, { method:'POST', headers:{ 'content-type':'application/json', 'x-penecho-suggest':'1' }, body:JSON.stringify(body) })
      : fetch(path, { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json', accept:'application/json', 'x-penecho-suggest':'1' }, body:JSON.stringify(body) }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || 'Could not update suggestion spending.');
    if (version === SET.cloudAccountVersion) {
      SET.suggest = data?.access || data || SET.suggest;
      toast('Saved suggestion spending.');
    }
  } catch (error) { if (version === SET.cloudAccountVersion) toast(error.message); }
  SET.suggestBusy = false; settingsRender();
}

function cloudAsksSectionHTML() {
  if (!S.thisComputer && typeof HOSTED !== 'undefined' && HOSTED) return '';
  if (S.cloudAccount?.unavailable || !S.computer) return '';
  const on = Boolean(S.computer.runsAsks);
  const signedIn = Boolean(S.cloudAccount?.signedIn);
  const disabled = !S.thisComputer || Boolean(S.computerBusy);
  const baseSub = 'Auto-fetch tasks from PenEcho Cloud and run them here, only after you click Run with an agent on penecho.ai.';
  const note = !S.thisComputer
    ? 'Change this on the computer running PenEcho.'
    : !signedIn
      ? 'Sign in to PenEcho Cloud to sync projects and fetch tasks.'
      : '';
  const extra = S.thisComputer && !signedIn ? '<button type="button" class="btn sm" data-act="cloud-sign-in">Sign in</button>' : '';
  return `<section class="sys-sec" id="sysCloudAsks" aria-labelledby="sysCloudAsksHead">
    <header class="sys-head"><div><h2 id="sysCloudAsksHead">PenEcho Cloud sync</h2><p class="sys-sub">Run tasks sent from penecho.ai on this computer.</p></div></header>
    <div class="shelf-list">
      ${sysSwitchRowHTML('prefComputerAsks', 'Run Asks sent from penecho.ai', note ? `${baseSub} ${note}` : baseSub, on, `${disabled ? 'disabled ' : ''}data-act="computer-asks-toggle"`, extra)}
    </div>
  </section>`;
}

function installedSectionHTML() {
  if (settingsHosted()) {
    const pcs = HOSTED.computers || [];
    return `${agentsFlowStripHTML('setup')}<section class="sys-sec" id="installed" aria-labelledby="sysInstalled"><header class="sys-head"><div><h2 id="sysInstalled">On your computers</h2><p class="sys-sub">Working agents installed on computers signed in to this account.</p></div></header>
      ${pcs.length ? `<div class="shelf-list">${pcs.map(pc => `<div class="sys-row"><span class="sys-mark">${ic('files', 15)}</span><span class="sys-text"><strong>${esc(pc.name || 'Computer')}</strong><small>${esc([pc.open ? 'Online now' : 'Offline', pc.runsAsks ? 'Runs Asks sent from penecho.ai' : 'Cloud Asks off', (pc.agents || []).filter(a => a.ready).map(a => a.name).join(', ') || 'No external CLI agents reported'].filter(Boolean).join(' · '))}</small></span><span class="sys-acts">${pc.open ? '<span class="sys-default">Connected</span>' : ''}</span></div>`).join('')}</div>`
        : '<p class="empty-line">No computers connected yet. Open PenEcho on your Mac or PC to see its installed agents here.</p>'}
    </section>`;
  }
  const c = S.agentCheck, checking = S.agentChecking, scanning = agentsScanning();
  const rows = c ? [...c.agents].sort((a, b) => SETUP_ORDER[a.state] - SETUP_ORDER[b.state]) : [];
  const problemCount = rows.filter(a => a.state === 'problem').length;
  const readyCount = rows.filter(a => a.state === 'ready').length;
  const missingRows = rows.filter(a => a.state === 'missing');
  const signedOutCount = missingRows.filter(a => a.builtIn).length;
  const notInstalledCount = missingRows.length - signedOutCount;
  const activeRows = rows.filter(a => a.state !== 'missing');
  const summaryBits = !c ? [] : [
    problemCount ? `<span class="setup-pill is-bad">${problemCount} ${problemCount === 1 ? 'needs' : 'need'} a fix</span>` : '',
    readyCount ? `<span class="setup-pill is-ok">${readyCount} ready</span>` : '',
    signedOutCount ? `<span class="setup-pill">${signedOutCount} signed out</span>` : '',
    notInstalledCount ? `<span class="setup-pill">${notInstalledCount} not installed</span>` : '',
  ].filter(Boolean);
  const summaryHTML = summaryBits.length ? `<div class="setup-summary" aria-label="CLI status summary">${summaryBits.join('')}</div>` : '';
  const head = `<header class="sys-head"><div><h2 id="sysInstalled">${S.thisComputer ? 'Installed CLIs &amp; built-in runner' : 'Installed CLIs on the host computer'}</h2><p class="sys-sub">Install, sign in, update, and verify local agent runtimes here. Configure models, efforts, and permissions in <strong>Preset agents</strong>.</p></div><button type="button" class="btn sm" data-act="setup-recheck" ${checking ? 'disabled' : ''}>${checking ? '<i class="spin"></i>Checking…' : `${ic('retry', 13)}Check again`}</button></header>`;
  // A check in progress says so above the rows from the last one, which stay on show.
  const notice = scanning ? `<div class="sys-notice is-checking" role="status"><i class="spin"></i><span>${c ? 'Checking local CLI tools again…' : 'Checking local CLI tools…'}</span></div>` : '';
  const strip = agentsFlowStripHTML('setup');
  if (!c) return `${strip}<section class="sys-sec setup-page" id="installed" aria-labelledby="sysInstalled">${head}${notice}${summaryHTML}${S.agentCheckError && !scanning ? `<p class="empty-line">${esc(S.agentCheckError)}</p>` : ''}</section>`;
  const missingGroupTitle = signedOutCount && notInstalledCount ? 'Not installed or signed out' : signedOutCount ? 'Signed out' : 'Not installed';
  const listsHTML = activeRows.length && missingRows.length
    ? `<div class="shelf-list">${activeRows.map(setupRowHTML).join('')}</div>
      <div class="setup-group-label"><span>${missingGroupTitle}</span><em>${missingRows.length}</em></div>
      <div class="shelf-list is-missing-list">${missingRows.map(setupRowHTML).join('')}</div>`
    : `<div class="shelf-list ${!activeRows.length && missingRows.length ? 'is-missing-list' : ''}">${rows.map(setupRowHTML).join('')}</div>`;
  return `${strip}<section class="sys-sec setup-page" id="installed" aria-labelledby="sysInstalled">${head}
    ${notice}${summaryHTML}
    ${c.agents.some(a => a.state === 'ready') ? '' : '<p class="setup-none">No CLI tool can run yet. Install one below, then click Check again.</p>'}
    ${listsHTML}</section>`;
}

function canvasAiSectionHTML() {
  if (!SET.keysAsked) loadKeys();
  if (!SET.suggestAsked) loadSuggestStatus();
  const keys = SET.keys || [];
  const autoOn = lsGet('penecho-auto-ai', 'false') === 'true';
  const delaySec = String(Math.round(Number(lsGet('penecho-auto-delay-ms', '5000')) / 1000) || (lsGet('penecho-auto-delay-ms') === '0' ? 0 : 5));
  const smartOn = lsGet('penecho-smart-suggestions', 'true') !== 'false';
  const intel = penIntelRead();
  const aiFont = lsGet('penecho-ai-font', 'ui-rounded, system-ui, sans-serif');
  const illStyle = lsGet('penecho-illustration-style', 'storybook');
  const illBg = lsGet('penecho-illustration-background', 'auto');
  const summonOn = lsGet('penecho-summon-enabled', 'true') !== 'false';
  const access = SET.suggest;
  const suggestSignIn = !access?.signedIn && cloudSignInNeeded();
  const delaySelect = `<select class="sys-pick sys-pick-sm" data-canvas-pref="autoDelaySec" aria-label="Auto AI delay">${[0, 1, 2, 3, 5, 10].map(s => `<option value="${s}" ${String(s) === delaySec ? 'selected' : ''}>${s} s</option>`).join('')}</select>`;
  const selectRow = (label, sub, pref, opts, current) => `<div class="sys-row sys-pref-row"><div class="sys-text"><strong>${label}</strong><small>${sub}</small></div><div class="sys-acts"><select class="sys-pick" data-canvas-pref="${pref}" aria-label="${esc(label)}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div></div>`;

  return `${canvasFlowStripHTML('canvas-ai')}${canvasAiCardHTML(keys)}
    <section class="sys-sec" aria-labelledby="sysCanvasAi">
      <header class="sys-head"><div><h2 id="sysCanvasAi">AI on the Canvas</h2></div></header>
      <div class="shelf-list">
        ${sysSwitchRowHTML('prefAutoAi', 'Auto AI', 'Respond to your handwriting after you pause.', autoOn, 'data-canvas-toggle="auto"', delaySelect)}
        ${sysSwitchRowHTML('prefSmartSuggest', 'Smart suggestions', 'Suggest actions beside new ink and in widget toolbars.', smartOn, 'data-canvas-toggle="smartSuggest"')}
        ${sysSwitchRowHTML('prefPenGestures', 'Pen gestures', 'Circle + ? explains, double underline typesets, L plots, strikethrough deletes.', intel.gestures !== false, 'data-canvas-toggle="gestures"')}
        ${sysSwitchRowHTML('prefStepCheck', 'Step checker', 'Marks a derivation line that looks wrong. Checks only when you tap.', intel.stepCheck !== false, 'data-canvas-toggle="stepCheck"')}
      </div>
    </section>
    <section class="sys-sec" aria-labelledby="sysCanvasDraw">
      <header class="sys-head"><div><h2 id="sysCanvasDraw">How AI draws</h2></div></header>
      <div class="shelf-list">
        ${selectRow('AI handwriting', 'The lettering AI uses when it writes onto the Canvas.', 'aiFont', [
          ['ui-rounded, system-ui, sans-serif', 'Rounded'],
          ['Bradley Hand, Segoe Print, Comic Sans MS, cursive', 'Handwritten'],
          ['Georgia, serif', 'Classic serif'],
          ['system-ui, sans-serif', 'Sans serif'],
        ], aiFont)}
        ${selectRow('Illustration style', 'Storybook uses soft pastel picture-book art; 3D uses glossy soft volumes.', 'illustrationStyle', [['storybook', 'Storybook'], ['3d', '3D']], illStyle)}
        ${selectRow('Illustration background', 'Auto adds a fitting scene when you drew none; None illustrates only your ink.', 'illustrationBackground', [['auto', 'Auto'], ['none', 'None']], illBg)}
        ${sysSwitchRowHTML('prefSummon', 'Thinking indicator', 'Show a quiet pulse while AI is working.', summonOn, 'data-canvas-toggle="summon"')}
      </div>
    </section>
    <section class="sys-sec" aria-labelledby="sysSuggestSpend">
      <header class="sys-head"><div><h2 id="sysSuggestSpend">After 500 free suggestions a day</h2></div></header>
      <div class="shelf-list">
        ${access?.signedIn && !access.subscribed ? `
          <form class="sys-row sys-spend-row" data-form="suggest-spend">
            <div class="sys-text">
              <label class="sys-check"><input type="checkbox" name="paidEnabled" ${access.paidEnabled ? 'checked' : ''} ${SET.suggestBusy ? 'disabled' : ''}><span>Use credits after 500 free daily suggestions (0.1 each)</span></label>
              <small>${esc(`${access.spentToday || 0} credits used today`)}</small>
            </div>
            <div class="sys-acts sys-spend-limit"><label><span>Daily limit</span><input type="number" name="dailyCreditLimit" min="0.1" max="1000" step="0.1" value="${esc(String(access.dailyCreditLimit ?? 50))}" ${SET.suggestBusy ? 'disabled' : ''}></label></div>
          </form>` : `<div class="sys-row"><span class="sys-mark">${ic('hint', 15)}</span><span class="sys-text"><strong>${access?.subscribed ? 'Included in your subscription' : '500 free smart suggestions daily when signed in'}</strong><small>${access?.subscribed ? 'Unlimited smart suggestions are included with your plan.' : 'Signed-in accounts can opt in to 0.1 credits per suggestion after the daily free allowance.'}</small></span><span class="sys-acts">${suggestSignIn ? '<button type="button" class="btn sm" data-act="cloud-sign-in">Sign in</button>' : ''}</span></div>`}
      </div>
    </section>`;
}

function canvasSectionHTML() {
  const hintsOn = lsGet('penecho-canvas-hints-enabled', 'true') !== 'false';
  const wheelZoom = lsGet('penecho-wheel-zoom', 'false') === 'true';
  const widgetShadow = lsGet('penecho-widget-shadow', 'false') === 'true';
  const gridMode = lsGet('penecho-grid', 'true') === 'false' ? 'none' : (lsGet('penecho-grid-style', 'dots') === 'lines' ? 'lines' : 'dots');
  return `<section class="sys-sec" aria-labelledby="sysCanvasView">
    <header class="sys-head"><div><h2 id="sysCanvasView">View</h2></div></header>
    <div class="shelf-list">
      <div class="sys-row sys-pref-row"><div class="sys-text"><strong>Canvas grid</strong><small>Choose the paper background for every Canvas.</small></div><div class="sys-acts"><div class="seg" role="radiogroup" aria-label="Canvas grid">${[['none', 'None'], ['dots', 'Dots'], ['lines', 'Lines']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${gridMode === k}" data-act="canvas-grid" data-grid="${k}"><span>${l}</span></button>`).join('')}</div></div></div>
      ${sysSwitchRowHTML('prefWheelZoom', 'Scroll to zoom', 'Off: scroll pans and pinch or ⌘ + scroll zooms.', wheelZoom, 'data-canvas-toggle="wheelZoom"')}
      ${sysSwitchRowHTML('prefCanvasHints', 'Tool & shortcut hints', 'Show tool tips and keyboard shortcuts at the bottom of the Canvas.', hintsOn, 'data-canvas-toggle="hints"')}
      ${sysSwitchRowHTML('prefWidgetShadow', 'Widget & image shadows', 'Lift widgets and cards off the Canvas with a soft shadow.', widgetShadow, 'data-canvas-toggle="widgetShadow"')}
    </div>
  </section>`;
}

async function loadMcpStatus() {
  SET.mcpAsked = true;
  if (!S.thisComputer) { SET.mcp = null; SET.mcpError = ''; return; }
  try {
    const r = await fetch('/api/mcp/status?inspectClients=1', { method:'POST', credentials:'same-origin', cache:'no-store', headers:{ 'content-type':'application/json', accept:'application/json' }, body:'{}' });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error?.message || 'Could not load MCP status.');
    SET.mcp = data; SET.mcpError = '';
  } catch (error) { SET.mcpError = error.message; }
  if (S.shelfPage === 'agents' && SET.agentsTab === 'apps') settingsRender();
}
async function configureMcpClient(client) {
  SET.mcpBusy = true; settingsRender();
  try {
    const r = await fetch('/api/mcp/configure', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json', accept:'application/json' }, body:JSON.stringify({ client }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || data?.message || 'Could not configure client.');
    toast(`Configured ${client === 'codex' ? 'Codex' : 'Claude'} for PenEcho MCP.`);
    await loadMcpStatus();
  } catch (error) { toast(error.message); }
  SET.mcpBusy = false; settingsRender();
}
ACT['mcp-configure'] = el => configureMcpClient(el.dataset.client);
ACT['mcp-copy-url'] = () => { const url = SET.mcp?.http?.initialUrl; if (url) copyText(url, 'Copied MCP URL.'); };
ACT['mcp-copy-config'] = () => {
  if (!SET.mcp?.config) return;
  copyText(JSON.stringify({ mcpServers:{ penecho:SET.mcp.config } }, null, 2), 'Copied MCP configuration JSON.');
};
ACT['mcp-recheck'] = () => { SET.mcpAsked = false; loadMcpStatus(); };

function appsSectionHTML() {
  if (!SET.mcpAsked) loadMcpStatus();
  const keepAwake = lsGet('penecho-mcp-keep-awake', 'false') === 'true';
  const scope = '<div class="sys-notice"><p><strong>Separate external integration:</strong> MCP lets outside AI apps connect <em>into</em> PenEcho to read and draw on Canvases you opt in. It does not require Canvas AI API keys or Project Agent presets.</p></div>';
  const optIn = '<p class="sys-note">Per-Canvas access is always opt-in: turn on or pause “MCP can draw here” from any Canvas’s <code>⋯</code> menu.</p>';
  if (!S.thisComputer) {
    return `${scope}<section class="sys-sec" aria-labelledby="sysApps">
      <header class="sys-head"><div><h2 id="sysApps">MCP</h2><p class="sys-sub">Let Claude, ChatGPT, or another MCP client draw directly on your Canvases.</p></div></header>
      <div class="shelf-list">
        <div class="sys-row"><span class="sys-mark is-mcp">${ic('setMcp', 15)}</span><span class="sys-text"><strong>Connect via MCP</strong><small>Open a Canvas and turn on “MCP can draw here” in its ⋯ menu, or configure local desktop clients from PenEcho on your computer.</small></span></div>
        ${sysSwitchRowHTML('prefKeepAwake', 'Keep awake while MCP is connected', 'Prevent display sleep during live MCP drawing sessions.', keepAwake, 'data-canvas-toggle="keepAwake"')}
      </div>
    </section>`;
  }
  const m = SET.mcp, url = m?.http?.initialUrl || '', clients = m?.configuredClients || {}, busy = SET.mcpBusy ? 'disabled' : '';
  const claudeOk = Boolean(clients?.claude?.configured || clients?.claudeDesktop?.configured);
  const codexOk = Boolean(clients?.codex?.configured);
  const live = m?.connectedCanvases || 0;
  const mark = (mono, color) => `<span class="av" style="--av:${color};--s:28px" aria-hidden="true">${mono}</span>`;
  const client = (id, mono, color, name, sub, ok) => `<div class="sys-row">${mark(mono, color)}<span class="sys-text"><strong><span>${name}</span>${ok ? '<span class="kind-tag is-green">Configured</span>' : ''}</strong><small>${sub}</small></span>
    <span class="sys-acts"><button type="button" class="btn sm ${ok ? '' : 'soft-accent'}" data-act="mcp-configure" data-client="${id}" ${busy}>${ok ? 'Reconfigure' : `Configure ${id === 'codex' ? 'Codex' : 'Claude'}`}</button></span></div>`;
  return `${scope}<section class="sys-sec" aria-labelledby="sysApps">
    <header class="sys-head"><div><h2 id="sysApps">Local MCP bridge</h2></div><button type="button" class="btn sm" data-act="mcp-recheck">${SET.mcpError ? 'Retry' : 'Refresh'}</button></header>
    ${SET.mcpError ? `<p class="sys-note is-bad">${esc(SET.mcpError)}</p>` : ''}
    <div class="shelf-list">
      <div class="sys-row"><span class="sys-mark is-mcp">${ic('setMcp', 15)}</span><span class="sys-text"><strong><span>${m ? (live ? `Connected · ${live} Canvas${live === 1 ? '' : 'es'} live` : 'MCP ready') : 'Checking MCP bridge…'}</span>${m ? '<span class="kind-tag is-green">Listening</span>' : ''}</strong><small>${url ? `Endpoint <code>${esc(url)}</code>` : 'Local MCP service starts automatically when PenEcho runs.'}</small></span><span class="sys-acts">${url ? '<button type="button" class="btn sm" data-act="mcp-copy-url">Copy URL</button>' : ''}${m?.config ? '<button type="button" class="btn sm" data-act="mcp-copy-config">Copy JSON</button>' : ''}</span></div>
    </div>
  </section>
  ${m?.canConfigureLocalClients ? `<section class="sys-sec" aria-labelledby="sysMcpClients">
    <header class="sys-head"><div><h2 id="sysMcpClients">One-click external app setup</h2></div></header>
    <div class="shelf-list">
      ${client('claude', 'Cl', '#d97757', 'Claude Desktop &amp; Claude Code', 'Adds PenEcho MCP to Claude on this computer.', claudeOk)}
      ${client('codex', 'Cx', '#10a37f', 'Codex', 'Adds PenEcho MCP to Codex on this computer.', codexOk)}
    </div>
  </section>` : ''}
  <section class="sys-sec" aria-labelledby="sysMcpSession">
    <header class="sys-head"><div><h2 id="sysMcpSession">Session behavior</h2></div></header>
    <div class="shelf-list">${sysSwitchRowHTML('prefKeepAwake', 'Keep awake while MCP is connected', 'Stay awake while an external MCP client has a Canvas session open.', keepAwake, 'data-canvas-toggle="keepAwake"')}</div>
    ${optIn}
  </section>`;
}

ACT['canvas-grid'] = el => {
  const mode = el.dataset.grid || 'dots';
  if (mode === 'none') lsSet('penecho-grid', 'false');
  else { lsSet('penecho-grid', 'true'); lsSet('penecho-grid-style', mode === 'lines' ? 'lines' : 'dots'); }
  settingsRender();
};
ACT['set-lang'] = el => {
  const lang = el.dataset.lang === 'zh' ? 'zh' : 'en';
  lsSet('penecho-language', lang);
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('penecho:languagechange', { detail:{ language:lang } }));
  }
  if (typeof window !== 'undefined') window.PenEchoCanvasShell?.syncSettings?.();
  if (typeof linesRefreshLanguage === 'function') linesRefreshLanguage();
  else { sysShown = {}; settingsRender(); }
};
ACT['set-scale'] = el => {
  const scale = Number(el.dataset.scale);
  if (window.PenEchoPageScale?.choices.includes(scale)) window.PenEchoPageScale.apply(scale);
};
if (typeof window !== 'undefined' && window.PenEchoPageScale) {
  window.addEventListener('penecho:page-scale-change', () => {
    if (!settingsUp() || sysTabNow() !== 'general') return;
    renderSettingsModal();
    // Touch browsers can finish the zoom reflow after the next frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const tab = $('#sysTab-general'), tabs = tab?.closest('.sysm-tabs');
      if (!tabs?.clientWidth || tabs.scrollWidth <= tabs.clientWidth) return;
      const item = tab.getBoundingClientRect(), strip = tabs.getBoundingClientRect();
      const overflow = Math.max(0, item.right - strip.right) + Math.min(0, item.left - strip.left);
      // Scroll offsets use layout pixels, while the rectangles include web page zoom.
      tabs.scrollLeft += overflow * tabs.clientWidth / strip.width;
    }));
  });
}

const CHANGELOG_URL = 'https://github.com/penecho/penecho/blob/main/CHANGELOG.md';
function generalSectionHTML() {
  const lang = lsGet('penecho-language', 'en') === 'zh' ? 'zh' : 'en';
  const pageScale = window.PenEchoPageScale, scale = pageScale?.current();
  return `<section class="sys-sec" aria-labelledby="sysGeneral"><header class="sys-head"><div><h2 id="sysGeneral">Preferences</h2></div></header>
    <div class="shelf-list">
      ${themeRow()}
      <div class="sys-row sys-pref-row"><div class="sys-text"><strong>Language</strong><small>Language used across PenEcho and Canvas.</small></div><div class="sys-acts"><div class="seg" role="radiogroup" aria-label="Language">${[['en', 'English'], ['zh', '中文']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${lang === k}" data-act="set-lang" data-lang="${k}"><span>${l}</span></button>`).join('')}</div></div></div>
      ${pageScale ? `<div class="sys-row sys-pref-row">
        <div class="sys-text"><strong id="pageZoomLabel">Page zoom</strong><small>Adjust the size of Projects and Canvas.</small></div>
        <div class="sys-acts"><div id="pageZoomOptions" class="seg" role="radiogroup" aria-labelledby="pageZoomLabel">
          ${pageScale.choices.map(value => {
            const percent = Math.round(value * 100);
            return `<button id="pageZoom${percent}" type="button" role="radio" aria-checked="${scale === value}" tabindex="${scale === value ? 0 : -1}" data-act="set-scale" data-scale="${value}">${percent}%</button>`;
          }).join('')}
        </div></div>
      </div>` : ''}
      ${S.thisComputer ? '<div class="sys-row sys-pref-row"><div class="sys-text"><strong>Other devices</strong><small>Open PenEcho from a tablet or phone on this network.</small></div><div class="sys-acts"><a class="btn sm" href="/lines/devices.html">Open</a></div></div>' : ''}
    </div>
  </section>
  ${cloudAsksSectionHTML()}
  <section class="sys-sec" aria-labelledby="sysAbout"><header class="sys-head"><div><h2 id="sysAbout">About</h2></div></header>
    <div class="shelf-list">
      ${(typeof desktopAboutHTML === 'function' && desktopAboutHTML()) || `<div class="sys-row sys-pref-row"><div class="sys-text"><strong>PenEcho 1.5.0</strong><small>Handwriting canvas &amp; Project Lines workspace.</small></div><div class="sys-acts"><a class="btn sm" href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer">Changelog</a></div></div>`}
    </div>
  </section>
  ${helpImproveSectionHTML(lang)}`;
}

function sysBodyHTML(id) {
  if (id === 'setup') return installedSectionHTML();
  if (id === 'agents') {
    const tabs = agentsHavePrices() ? '<div class="seg agents-tabs" id="agentsTabs" role="tablist" aria-label="Preset agents"></div>' : '';
    return `${agentsFlowStripHTML('agents')}${tabs}${agentsPricesUp() ? pricesHostHTML('settings') : agentsSectionHTML()}`;
  }
  if (id === 'canvas-ai') return canvasAiSectionHTML();
  if (id === 'apps') return appsSectionHTML();
  if (id === 'providers') return penechoSectionHTML();
  if (id === 'general') return generalSectionHTML();
  if (id === 'archived') return archivedProjectsHTML();
  return canvasSectionHTML();
}
// The tabs down the window's left side, in their groups. Local providers counts the problems that stop an agent working, Preset agents
// the presets saved, MCP the Canvases live, and Archived the projects in it.
function sysNavBadgeHTML(id) {
  if (id === 'setup') {
    const n = S.agentCheck?.problems || 0;
    return n ? `<em class="setup-count" title="${n} to fix">${n}</em>` : S.agentChecking ? '<em class="sys-nav-muted" title="Checking">…</em>' : '';
  }
  if (id === 'agents') { const n = savedPresetsCount(); return n ? `<em>${n}</em>` : ''; }
  if (id === 'apps') { const n = SET.mcp?.connectedCanvases || 0; return n > 0 ? `<em class="sys-nav-ok">${n} live</em>` : ''; }
  if (id === 'archived') { const n = (S.projects || []).filter(p => p.archived).length; return n ? `<em>${n}</em>` : ''; }
  return '';
}
function sysNavHTML(now) {
  const tabs = sysTabs();
  return SYS_GROUPS.map(([group, label]) => {
    const list = tabs.filter(t => t.group === group);
    return list.length ? `<div class="sysm-group" role="presentation"><div class="sysm-group-label" aria-hidden="true">${label}</div>${list.map(t => `<button type="button" id="sysTab-${t.id}" role="tab" aria-selected="${t.id === now}" aria-controls="sysPanel" tabindex="${t.id === now ? 0 : -1}" data-act="settings-tab" data-tab="${t.id}"${t.title ? ` title="${t.title}"` : ''}>${ic(t.icon, 16)}<span>${t.label}</span>${sysNavBadgeHTML(t.id)}</button>`).join('')}</div>` : '';
  }).join('');
}
// Drawn into a layer of its own over the page. Each part is written only when it changed, so a button you are on stays put,
// and a box you are typing in is not redrawn under you: the window catches up when you leave it.
let sysShown = {};
function resetSettingsCache() { sysShown = {}; }
function renderSettingsModal() {
  let host = document.getElementById('sysModal');
  const fresh = !host;
  if (fresh) {
    host = document.createElement('div');
    host.id = 'sysModal'; host.className = 'sysm-layer';
    host.innerHTML = `<div class="sysm-scrim" data-act="settings-close"></div><section class="sysm" role="dialog" aria-modal="true" aria-labelledby="sysmTitle">
      <nav class="sysm-nav"><h2 id="sysmTitle">Settings</h2><div class="sysm-tabs" role="tablist" aria-orientation="vertical" aria-labelledby="sysmTitle"></div></nav>
      <div class="sysm-main"><header class="sysm-head"><div class="sysm-back"></div><div class="sysm-title"><h3></h3><span class="sys-domain-tag"></span></div><button type="button" class="icon-btn sysm-x" data-act="settings-close" aria-label="Close settings" title="Close (Esc)">${ic('x', 18)}</button></header>
      <div class="sysm-body" id="sysPanel" role="tabpanel"></div></div></section>`;
    document.body.append(host);
    sysShown = {};
  }
  const now = sysTabNow(), t = sysTab(now), ret = settingsReturnInfo();
  if (now === 'agents' || now === 'setup') dismissRailSettingsBadge();
  // An older or shorter address (#settings/agents, #settings) takes the tab's own.
  const prices = agentsPricesUp(), hash = prices ? AGENTS_PRICES : t.hash, shown = prices ? 'prices' : now;
  if (location.hash !== hash) { S.hashWrite = hash; history.replaceState(null, '', hash); }
  const nav = sysNavHTML(now), body = sysBodyHTML(now), back = ret ? `<button type="button" class="sys-back" data-act="settings-return">${ic('left', 14)}<span>Back to ${esc(ret.label)}</span></button>` : '';
  document.title = `${t.title || t.label} · Settings · PenEcho Lines`;
  const focusId = host.contains(document.activeElement) ? document.activeElement.id : '';
  if (sysShown.nav !== nav) $('.sysm-tabs', host).innerHTML = nav;
  if (sysShown.back !== back) $('.sysm-back', host).innerHTML = back;
  $('.sysm-head h3', host).textContent = t.title || t.label;
  $('.sysm-head .sys-domain-tag', host).textContent = t.domain || '';
  const panel = $('#sysPanel', host), moved = sysShown.tab !== shown;
  panel.setAttribute('aria-labelledby', `sysTab-${now}`);
  const typing = !moved && !SET.redraw && panel.querySelector('.sys-form')?.contains(document.activeElement);
  SET.redraw = false;
  if (!typing && (moved || sysShown.body !== body)) panel.innerHTML = body;
  const strip = $('#agentsTabs', panel), tabs = strip ? agentsTabsHTML() : '';
  if (strip && strip.dataset.h !== tabs) strip.innerHTML = strip.dataset.h = tabs;
  if (prices) paintPriceLists();
  if (typeof linesTranslateTree === 'function' && typeof linesIsZh === 'function' && linesIsZh()) {
    linesTranslateTree(host);
    if (typeof linesTranslateTitle === 'function') document.title = linesTranslateTitle(document.title);
  }
  if (focusId && document.activeElement?.id !== focusId) document.getElementById(focusId)?.focus({ preventScroll:true });
  sysShown = { nav, back, body:typing ? sysShown.body : body, tab:shown };
  if (typing) return;
  // On a narrow screen the tabs are one row across the top: the one on show is scrolled into it.
  if (moved) $(`#sysTab-${now}`, host)?.scrollIntoView?.({ block:'nearest', inline:'nearest' });
  if (moved) panel.scrollTop = 0;
  if (fresh) $(`#sysTab-${now}`, host)?.focus({ preventScroll:true });
  if (moved && strip) queueMicrotask(() => loadPrices(true));
  if ((fresh || (!S.agentCheck && !S.agentCheckError)) && !S.agentChecking) queueMicrotask(() => checkAgents());
}
function dropSettingsModal() { document.getElementById('sysModal')?.remove(); sysShown = {}; SET.usageAsked = false; }
// The rail's one way in, a gear beside the account. Its number reminds you of agent problems until you click it to open Settings.
function railSettingsHTML() {
  const n = railSettingsBadgeCount();
  return `<button type="button" class="rail-gear ${settingsUp() ? 'on' : ''}" data-act="open-settings" aria-label="Settings${n ? `: ${n} to fix` : ''}" title="Settings">${ic('gear', 17)}${n ? `<em class="setup-count">${n}</em>` : ''}</button>`;
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', e => {
    if (e.key !== RAIL_SETTINGS_BADGE) return;
    if (e.newValue === 'dismissed') dismissedAgentNotices.add(RAIL_SETTINGS_BADGE);
    else dismissedAgentNotices.delete(RAIL_SETTINGS_BADGE);
    if (typeof renderRail === 'function') renderRail();
  });
}

document.addEventListener('click', e => {
  const sw = e.target.closest?.('button[data-canvas-toggle]');
  if (!sw) return;
  const kind = sw.dataset.canvasToggle, next = sw.getAttribute('aria-checked') !== 'true';
  if (kind === 'auto') lsSet('penecho-auto-ai', next);
  else if (kind === 'smartSuggest') lsSet('penecho-smart-suggestions', next);
  else if (kind === 'gestures') penIntelWrite('gestures', next);
  else if (kind === 'stepCheck') penIntelWrite('stepCheck', next);
  else if (kind === 'summon') lsSet('penecho-summon-enabled', next);
  else if (kind === 'wheelZoom') lsSet('penecho-wheel-zoom', next);
  else if (kind === 'hints') lsSet('penecho-canvas-hints-enabled', next);
  else if (kind === 'widgetShadow') lsSet('penecho-widget-shadow', next);
  else if (kind === 'keepAwake') lsSet('penecho-mcp-keep-awake', next);
  settingsRender();
});

document.addEventListener('keydown', e => {
  const zoomBtn = e.target.closest?.('#pageZoomOptions [role="radio"]');
  if (zoomBtn) {
    const buttons = [...zoomBtn.parentElement.querySelectorAll('[role="radio"]')];
    const index = buttons.indexOf(zoomBtn);
    const offset = { ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1 }[e.key];
    if (offset === undefined) return;
    e.preventDefault();
    const next = buttons[(index + offset + buttons.length) % buttons.length];
    next.focus({ preventScroll:true });
    ACT['set-scale'](next);
    return;
  }
  const tabBtn = e.target.closest?.('.sysm-tabs [role="tab"]');
  if (!tabBtn) return;
  const tabs = [...tabBtn.closest('.sysm-tabs').querySelectorAll('[role="tab"]')];
  const idx = tabs.indexOf(tabBtn);
  if (idx < 0) return;
  let nextIdx = -1;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = tabs.length - 1;
  if (nextIdx < 0) return;
  e.preventDefault();
  openSettings(tabs[nextIdx].dataset.tab);
  requestAnimationFrame(() => document.getElementById(`sysTab-${tabs[nextIdx].dataset.tab}`)?.focus());
});

// What is typed into a form is read when it is sent, and the parts that depend on a choice are drawn again when it changes.
document.addEventListener('change', e => {
  const pref = e.target.closest?.('select[data-canvas-pref]');
  if (pref) {
    const p = pref.dataset.canvasPref, v = pref.value;
    if (p === 'autoDelaySec') lsSet('penecho-auto-delay-ms', String((Number(v) || 0) * 1000));
    else if (p === 'aiFont') lsSet('penecho-ai-font', v);
    else if (p === 'illustrationStyle') lsSet('penecho-illustration-style', v);
    else if (p === 'illustrationBackground') lsSet('penecho-illustration-background', v);
    toast('Canvas setting updated.');
    return;
  }
  const spendForm = e.target.closest?.('.sys-spend-row');
  if (spendForm) {
    const cb = spendForm.querySelector('input[name="paidEnabled"]');
    const lim = spendForm.querySelector('input[name="dailyCreditLimit"]');
    if (cb) saveSuggestPrefs(cb.checked, lim ? Number(lim.value) : undefined);
    return;
  }
  const form = e.target.closest?.('.sys-form');
  if (!form) return;
  if (form.dataset.form === 'preset' && SET.form) {
    const was = SET.form.agent;
    presetFormRead(form);
    if (e.target.name === 'agent' && SET.form.agent !== was) Object.assign(SET.form, { model:'', customModel:false, effort:'', customEffort:false, access:'' });
    if (e.target.name === 'model') {
      form.querySelector('.preset-try-said')?.remove();
      const runner = presetRunner(SET.form.agent);
      if (runner) form.querySelector('[data-preset-effort]').innerHTML = presetEffortHTML(runner, SET.form, runner.model || {});
      form.querySelector('[name="name"]').placeholder = presetAutoName(SET.form.agent, SET.form.model, SET.form.effort, SET.form.access);
    }
    if (['agent', 'modelChoice', 'effortChoice', 'effort', 'access', 'makeDefault'].includes(e.target.name)) requestAnimationFrame(() => {
      settingsRender();
      if (e.target.name === 'modelChoice' && SET.form?.customModel) $('.sys-form input[name="model"]')?.focus();
      if (e.target.name === 'effortChoice' && SET.form?.customEffort) $('.sys-form input[name="effort"]')?.focus();
    });
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest?.('.sys-form');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'preset') presetSave(form);
  else if (form.dataset.form === 'pin-all') pinAllSave(form);
  else if (form.dataset.form === 'key') keySave();
});
