// One Topic on one page: its line across the top, its one Markdown file down the middle, and on the right the detail of whichever piece of work you open.
const LIVE = {};
const LINE_FOLDED_KEY = 'penecho-line-folded-v1';
try { if (typeof S === 'object' && S && typeof localStorage !== 'undefined' && localStorage.getItem(LINE_FOLDED_KEY) === '1') S.lineFolded = true; } catch { /* Private browsing still works for this visit. */ }
const liveOf = (p, l) => LIVE[`${p.id}:${l.slug}`] ||= {};
const topicApi = (p, l, verb) => `${pathFor(p.id)}/topics/${encodeURIComponent(l.slug)}/${verb}`;
const plainOut = text => String(text || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/`/g, '');
const DIFF_LINES = 800;
function diffHTML(files) {
  if (!files.length) return '<p class="muted">No changes on this branch yet.</p>';
  return files.map(f => `<section class="diff"><header><code>${esc(f.path)}</code><span class="row-diff"><i>+${f.add}</i> <u>−${f.del}</u></span></header><div class="diff-body">${f.lines.slice(0, DIFF_LINES).map(L => {
    const cls = L.startsWith('@@') ? 'hk' : L[0] === '+' ? 'add' : L[0] === '-' ? 'del' : '';
    return `<div class="dl ${cls}"><code>${esc(L)}</code></div>`;
  }).join('')}${f.lines.length > DIFF_LINES ? `<div class="dl hk"><code>${f.lines.length - DIFF_LINES} more lines</code></div>` : ''}</div></section>`).join('');
}
// The files right in the line's folder. A folder inside it, such as an agent's scratch runs or caches, is one entry of its own, not every file in it.
const topicFiles = (p, l) => { const at = `files/${l.slug}/`; return p.files.filter(f => f.path.startsWith(at) && !f.path.slice(at.length).includes('/') && !/\.penecho\.json$|\.diagram\.json$|\.explorer\.html$|merge-arrow\.svg$/.test(f.path)); };
function topicFolders(p, l) {
  const at = `files/${l.slug}/`, count = new Map();
  for (const f of p.files) if (f.path.startsWith(at)) { const rest = f.path.slice(at.length), cut = rest.indexOf('/'); if (cut > 0) { const dir = at + rest.slice(0, cut); count.set(dir, (count.get(dir) || 0) + 1); } }
  return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([path, files]) => ({ path, files }));
}
const folderChip = f => `<button type="button" class="file-ref" data-act="open-folder" data-path="${esc(f.path)}" title="${esc(`${f.files} ${f.files === 1 ? 'file' : 'files'}`)}">${ic('files', 15)}<span>${esc(f.path.split('/').pop())}</span></button>`;
// A folder opens in the Vault, unfolded down to it.
ACT['open-folder'] = el => {
  const p = project(), path = el.dataset.path, dirs = ((S.vaultDirs ||= Object.create(null))[p.id] ||= Object.create(null));
  path.split('/').forEach((seg, i, all) => { dirs[`/${all.slice(0, i + 1).join('/')}`] = true; });
  go({ view:'vault' });
  $(`#vaultTree details.tree-dir[data-dir="${CSS.escape(`/${path}`)}"]`)?.scrollIntoView({ block:'start' });
};
function fileChip(f) {
  const name = f.path.split('/').pop();
  const md = /\.md$/i.test(name), act = f.workPreview ? 'preview-work-file' : md ? 'open-doc' : 'open-asset';
  return `<button type="button" class="file-ref" data-act="${act}" data-${md ? 'doc' : 'path'}="${esc(f.path)}">${ic(FILE_ICON(name), 15)}<span>${esc(name)}</span></button>`;
}
function askFiles(ask, p = project(), pending = false) {
  if (!ask.files?.length) return '';
  return `<div class="ask-files">${ask.files.map(f => pending ? `<button type="button" class="file-ref" disabled title="Saving attachment">${ic(FILE_ICON(f.name), 15)}<span>${esc(f.name)}</span></button>` : f.image && fileEntry(p, f.path) ? `<button type="button" class="ask-img" data-act="open-asset" data-path="${esc(f.path)}"><img src="${esc(assetUrl(p, f.path))}" alt="${esc(f.name)}"><span>${esc(f.name)}</span></button>` : `<button type="button" class="file-ref" data-act="open-asset" data-path="${esc(f.path)}">${ic(FILE_ICON(f.name), 15)}<span>${esc(f.name)}</span></button>`).join('')}</div>`;
}
// Pictures you attached or marked up belong to your words, not to the result.
function resultPictures(p, l) {
  const yours = new Set([...l.ask.files, ...l.ask.later.flatMap(x => x.files || [])].map(f => f.path));
  return l.pictures.filter(pic => fileEntry(p, pic.path) && !yours.has(pic.path));
}
const resultFiles = (p, l) => { const yours = new Set([...l.ask.files, ...l.ask.later.flatMap(x => x.files || [])].map(f => f.path)), pics = new Set(l.pictures.map(pic => pic.path)); return topicFiles(p, l).filter(f => !yours.has(f.path) && !pics.has(f.path) && !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.path)); };
const shortPath = path => String(path).replace(/^\/(?:Users|home)\/[^/]+/, '~');
// What you put on a line yourself: an Ask, a note, a drawing. None of it is work.
const isYours = LINE_STATUS.isYours;
const isWork = LINE_STATUS.isWork;
const isEnd = s => s.kind === 'merge' || s.kind === 'deliver';
const latestWork = l => [...l.stations].reverse().find(x => isWork(x) && x.state !== 'todo' && x.state !== 'off');
// Work you stopped, a stopped Work you discarded, or one carried on under your next Ask, stays greyed out and counts for nothing.
const OFF_TEXT = { stopped:'Stopped by you', discarded:'Discarded', ended:'Stopped' };
const offText = s => OFF_TEXT[s.off] || OFF_TEXT.stopped;
// Why a Work stopped, in plain words (N5): its usage limit, an error, or you.
const STOP_WHY = { limit:'Stopped: hit its usage limit', error:'Stopped with an error', stopped:'You stopped it' };
const stopWhyOf = s => s.off === 'discarded' ? '' : s.stopWhy || (s.off === 'stopped' ? 'stopped' : s.state === 'error' ? 'error' : '');
// "2:10pm", with the day when it is not today.
function clockOf(iso) {
  const d = new Date(iso); if (!+d) return '';
  const h = d.getHours(), m = d.getMinutes(), time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, d - Date.now() > 6 * 864e5 ? { month:'short', day:'numeric' } : { weekday:'short' })} ${time}`;
}
const stopWhyWords = s => { const why = stopWhyOf(s), at = why === 'limit' && s.resetsAt ? clockOf(s.resetsAt) : ''; return why ? `${STOP_WHY[why]}${at ? `, resets ${at}` : ''}` : ''; };
// A Work that carried its own conversation on did not start from the line file, so it says nothing.
function contextWords(s) {
  const c = s.context; if (!c?.sent || c.resumed) return '';
  return `${new Intl.NumberFormat().format(c.sent)} prompt bytes sent, including PenEcho instructions. Model usage is recorded separately.`;
}
// The two faces with a baton passing between them, when one agent carried on after another stopped.
function handoffHTML(s) {
  const c = s.carriedFrom; if (!c?.agent) return '';
  return `<div class="lpp-handoff"><span class="ho-faces" aria-hidden="true">${av(c.agent, 20)}<span class="ho-track"><i class="ho-baton"></i></span>${av(s.agent, 20)}</span><span>${esc(agentInfo(s.agent).name)} carried on after ${esc(agentInfo(c.agent).name)} stopped</span></div>`;
}
const workSubHTML = s => { const hand = handoffHTML(s), ctx = contextWords(s), tokens = typeof tokenWorkHTML === 'function' ? tokenWorkHTML(s) : ''; return hand || ctx || tokens ? `<div class="lpp-sub">${hand}${tokens}${!tokens && ctx ? `<p class="lpp-context">${esc(ctx)}</p>` : ''}</div>` : ''; };
// The Work another agent can carry on: the latest one, if it stopped, and nothing runs on the line.
function carryWork(l) {
  if (l.running || l.archived || l.closed) return null;
  const s = [...l.stations].reverse().find(x => isWork(x) && !x.unsent && (x.state !== 'off' || x.off === 'stopped'));
  return s && (s.state === 'error' || s.off === 'stopped') ? s : null;
}
// The Work whose Asks can be sent again (PE-403): the latest Work, if it failed, stopped or was discarded, with an Ask of its own, and nothing running on the line.
function resendWork(l) {
  if (l.running || l.archived || l.closed) return null;
  const works = l.stations.filter(x => isWork(x) && !x.unsent), s = works[works.length - 1];
  if (!s || !(s.state === 'error' || (s.state === 'off' && (s.off === 'stopped' || s.off === 'discarded')))) return null;
  const i = l.stations.indexOf(s), near = [];
  for (let j = i - 1; l.stations[j]?.kind === 'ask'; j--) near.push(l.stations[j]);
  for (let j = i + 1; l.stations[j]?.kind === 'ask'; j++) near.push(l.stations[j]);
  return near.some(x => !x.unsent && !x.finishedAsk) ? s : null;
}
const resendButton = (l, s) => `<button type="button" class="btn sm lp-resend" data-act="resend-work" data-line="${esc(l.id)}" data-step="${esc(s.id)}" title="Its Ask goes back to Not sent, here, so you can choose who runs it">${ic('send', 14)}Send again</button>`;
const continueButton = (l, s, cls = 'btn sm primary') => s?.canContinue && can('continue-work') && !l.archived && !l.closed
  ? `<button type="button" class="${cls} lp-continue" data-act="continue-work" data-line="${esc(l.id)}" data-step="${esc(s.id)}" title="Continue in the same session without dropping previous work">${ic('play', 14)}Continue</button>` : '';
const lineContinue = (l, cls) => l.status === 'stopped' && !lineWorking(l) && l.continueStep
  ? continueButton(l, stationById(l, l.continueStep), cls) : '';
// A Work waiting for the one running to end (PE-558). Remove from queue gives its Ask back as Not sent; Stop would end the running Work too.
const isQueued = (l, s) => isWork(s) && s.state === 'todo' && !s.unsent && !l.closed && !l.archived && l.stations.some(x => x !== s && isWork(x) && x.state === 'active');
const unqueueButton = (l, s, running) => `<button type="button" class="btn sm lp-unqueue" data-act="unqueue-work" data-line="${esc(l.id)}" data-step="${esc(s.id)}" title="${esc(running ? `Waits for ${agentInfo(running.agent).name} to finish. Its Ask goes back to Not sent.` : 'Its Ask goes back to Not sent.')}">${ic('x', 14)}Remove from queue</button>`;
const carryButton = (l, s) => (availableAgents().length ? `<button type="button" class="btn sm primary lp-carry" data-act="carry-on" data-line="${esc(l.id)}" data-step="${esc(s.id)}" aria-haspopup="menu">Carry on with${ic('down', 14)}</button>` : '');
// Stop is there while a job (or an Orchestrator background review) is actively running or waiting to start on this line (not on an idle Needs-you pause).
const canStop = l => !l.closed && !l.archived && (Boolean(l.running) || l.stations.some(s => isWork(s) && (s.state === 'active' || (s.state === 'todo' && l.status === 'working'))) || (typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.lineReviewing?.(l))));
const lineStopButton = (l, cls = 'btn sm') => !l.elsewhere && canStop(l)
  ? `<button type="button" class="${cls}" data-act="line-do" data-verb="stop" data-line="${esc(l.id)}">${ic('stop', 14)}Stop</button>` : '';
const waitingWhyOf = l => l?.why || l?.stations?.find(s => isWork(s) && s.state === 'wait')?.why || '';
const isBlockedWaitingWhy = why => why === 'Not sent' || /^Out of credits/i.test(why || '') || /^Working on /i.test(why || '');
function isWaitingReplyLine(l) {
  if (!l || l.closed || l.archived || l.elsewhere || l.running) return false;
  if (l.asking?.kind === 'tool' && l.asking.answerable) return false;
  if (typeof l.waitingForReply === 'boolean') return l.waitingForReply;
  if (l.status === 'waiting' && !isBlockedWaitingWhy(waitingWhyOf(l)) && openQuestions(l).length) return true;
  if (l.status === 'waiting') {
    const why = waitingWhyOf(l);
    return Boolean(why) && !isBlockedWaitingWhy(why);
  }
  return false;
}
// Followed conversations are controlled by the app or terminal where they started.
function followedStopTarget(l, s) {
  if (!l.elsewhere || l.closed || l.archived || !s || !isWork(s) || !(s.state === 'active' || s.asked)) return null;
  if (s.stopIn) return s.stopIn;
  // Older servers report ownership only for the Line. Use it only for one unambiguous Work.
  if (!l.running || s.agent !== l.runAgent || l.stations.some(other => other !== s && isWork(other) && (other.state === 'active' || other.asked))) return null;
  const chat = l.conversations?.[s.agent] || (l.conversation?.agent === s.agent ? l.conversation : null);
  return { agent:s.agent, app:chat?.opensApp || (chat?.canOpen && chat.app), terminal:Boolean(chat?.terminal) };
}
function followedStopButton(l, s, target) {
  const name = target.app || agentInfo(target.agent).name;
  const opens = S.thisComputer && target.app;
  const hint = opens ? `Open ${name}, then stop the running conversation there.` : target.terminal
    ? `Stop this Work in the original ${name} terminal.` : `Stop this conversation in ${name} on the computer where it is running.`;
  return `<button type="button" class="btn sm followed-stop" data-act="${opens ? 'open-desktop' : 'stop-help'}" data-line="${esc(l.id)}" data-step="${esc(s.id)}" data-agent="${esc(target.agent)}" data-stop-hint="${esc(hint)}" title="${esc(hint)}">${ic('stop', 14)}${opens ? `Stop in ${esc(name)}` : 'How to stop'}</button>`;
}
// Only finished work can be reviewed. A server from before this says nothing about it, and then the page offers nothing.
const canReview = LINE_STATUS.canReview;
const isReviewed = s => canReview(s) && s.reviewed;
const READABLE = /\.(md|markdown|txt)$/i;
const MD_FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const MD_RESULT_OPEN = /^\s*<!--\s*result:[^\n]*-->\s*$/;
const MD_RESULT_CLOSE = /^\s*<!--\s*\/result\s*-->\s*$/;
const MD_WRAPPER_LINE = /^\s*<!--\s*(?:result:[^\n]*|\/result|penecho:[^\n]*)\s*-->\s*$/;
const mdFenceCloser = (lines, start, ch, len) => {
  for (let i = start + 1; i < lines.length; i++) {
    const m = MD_FENCE_OPEN.exec(lines[i]);
    if (m && m[1][0] === ch && m[1].length >= len && /^\s*$/.test(lines[i].slice(m[0].length))) return i;
  }
  return -1;
};
const mdResultCloser = (lines, start) => {
  let unclosedFallback = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (MD_RESULT_CLOSE.test(lines[i])) return i;
    const fm = MD_FENCE_OPEN.exec(lines[i]);
    if (fm) {
      const close = mdFenceCloser(lines, i, fm[1][0], fm[1].length);
      if (close > i) {
        if (unclosedFallback < 0) {
          for (let j = i + 1; j < close; j++) {
            if (!MD_RESULT_CLOSE.test(lines[j])) continue;
            let next = j + 1;
            while (next < lines.length && !lines[next].trim()) next++;
            if (next >= lines.length || /^## /.test(lines[next])) {
              unclosedFallback = j;
              break;
            }
          }
        }
        i = close;
      }
    }
  }
  return unclosedFallback;
};
const mdSection = (md, name) => {
  const lines = String(md).split(/\r?\n/);
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === `## ${name}`) { at = i; break; }
    if (MD_RESULT_OPEN.test(lines[i])) { const close = mdResultCloser(lines, i); if (close > i) { i = close; continue; } }
    const fm = MD_FENCE_OPEN.exec(lines[i]);
    if (fm) { const close = mdFenceCloser(lines, i, fm[1][0], fm[1].length); if (close > i) i = close; }
  }
  if (at < 0) return '';
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
    if (MD_RESULT_OPEN.test(lines[i])) { const close = mdResultCloser(lines, i); if (close > i) { i = close; continue; } }
    const fm = MD_FENCE_OPEN.exec(lines[i]);
    if (fm) { const close = mdFenceCloser(lines, i, fm[1][0], fm[1].length); if (close > i) i = close; }
  }
  const slice = lines.slice(at + 1, end), skip = new Set();
  for (let i = 0; i < slice.length; i++) {
    if (MD_RESULT_OPEN.test(slice[i])) {
      skip.add(i);
      const close = mdResultCloser(slice, i);
      if (close > i) skip.add(close);
      continue;
    }
    if (MD_WRAPPER_LINE.test(slice[i])) skip.add(i);
    const fm = MD_FENCE_OPEN.exec(slice[i]);
    if (fm) { const close = mdFenceCloser(slice, i, fm[1][0], fm[1].length); if (close > i) i = close; }
  }
  return slice.filter((_, i) => !skip.has(i)).join('\n').trim();
};

// ---------- The line, down the side, with room for words ----------
const firstLine = text => String(text || '').replace(/\s*\n\s*/g, ' ').trim();
// What apps add around your words when a conversation is read back: their own context blocks, an interrupted marker, attachment notes. None of it is what you asked. A tag you typed yourself, like <b>, has no dash in it and stays.
const askOnly = text => LINE_STATUS.askOnly(text);
const askVisible = s => LINE_STATUS.askVisible(s);
const dayOf = when => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(when || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : ''; };
const stateWord = s => s.finishedAsk ? 'finished and reviewed' : s.isTodo ? 'todo' : s.toReview ? 'not all reviewed' : s.unsent ? 'not sent' : s.state === 'off' ? offText(s).toLowerCase() : s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : s.state === 'wait' ? (s.finished || s.kind === 'merge' ? 'finished' : 'needs you') : s.state === 'error' ? 'stopped' : 'not started';
// What a stop says, wherever there is room for words.
function stopWords(s) {
  if (isOrchReview(s)) {
    if (s.reviewing) return 'Orchestrator review · Reviewing…';
    if (s.reviewStopped) return `Orchestrator review · ${s.state === 'off' ? 'Stopped by you' : stopWhyWords(s) || 'Stopped'}`;
    const words = reviewScoreWords(s.review?.score, s.review?.verdict);
    return words ? `Orchestrator review · ${words}` : 'Orchestrator review';
  }
  if (s.kind === 'note') return firstLine(s.text) || 'Note';
  if (s.kind === 'canvas') return firstLine(s.text) || s.pictures?.[0]?.title || 'Drawing';
  // A meeting from MeetCue says its title line: what it was, when, how long (meetcue.js).
  if (s.kind === 'meeting') return typeof meetingWords === 'function' ? meetingWords(s) : 'Meeting';
  if (s.kind === 'ask') { const files = s.files || []; return firstLine(askOnly(s.text)) || (files.length && !files.some(f => f.image) ? files[0].name : files.length || s.pictures?.length || /\[Attached:/.test(s.text) ? 'See the picture' : s.refers?.[0]?.words || s.refers?.[0]?.label || ''); }
  if (isEnd(s)) return s.state === 'todo' ? 'Not finished' : stepLabel(s);
  if (s.state === 'active') return s.now || 'Working';
  if (s.state === 'todo') return 'Not started';
  if (s.state === 'off') return s.stopWhy && s.off !== 'discarded' ? stopWhyWords(s) : offText(s);
  if (s.state === 'error' && s.stopWhy === 'limit') return stopWhyWords(s);
  if (s.state === 'error' || s.state === 'wait') return firstLine(s.why || s.out) || stepLabel(s);
  return firstLine(s.out) || 'Done';
}
// A finished Work says in words whether you have reviewed it, so the two never look alike.
const reviewTag = s => canReview(s) ? `<span class="lps-rev ${s.reviewed ? 'is-on' : ''}">${s.reviewed ? `${ic('check', 10)}Reviewed` : 'Not reviewed'}</span>` : '';
function workStopBadge(s) {
  if (s.state === 'active') return '<span class="lps-badge is-run">Working</span>';
  if (s.state === 'wait') return '<span class="lps-badge is-warn">Needs you</span>';
  if (s.state === 'error') return '<span class="lps-badge is-bad">Stopped</span>';
  if (s.state === 'off') return `<span class="lps-badge is-off">${esc(s.off === 'discarded' ? 'Discarded' : 'Stopped')}</span>`;
  if (s.state === 'todo') return '<span class="lps-badge is-off">Queued</span>';
  if (canReview(s)) return s.reviewed
    ? `<span class="lps-badge is-done">${ic('check', 10)}Reviewed</span>`
    : '<span class="lps-badge is-review">Unreviewed</span>';
  return '';
}
function orchReviewStopBadge(s) {
  if (s.reviewing) return '<span class="lps-badge is-run">Reviewing…</span>';
  if (s.reviewStopped) return `<span class="lps-badge ${s.state === 'off' ? 'is-off' : 'is-bad'}">${esc(s.state === 'off' ? 'Stopped' : s.stopWhy === 'limit' ? 'Limit' : 'Stopped')}</span>`;
  if (s.review?.ignored) return '<span class="lps-badge is-off">Ignored</span>';
  const headline = typeof reviewHeadlineOf === 'function' ? reviewHeadlineOf(s.review) : { text:'', cls:'', verdict:'', score:null };
  if (headline.verdict === 'unverified') return '<span class="lps-badge is-off">Unverified</span>';
  if (headline.score != null) return `<span class="lps-score ${esc(headline.cls)}">${esc(`${headline.score}/5`)}</span>`;
  return headline.text ? `<span class="lps-badge is-off">${esc(headline.text)}</span>` : '';
}
function stopRow(p, l, s, curI, first = s.index === 0, last = s.index === l.stations.length - 1, stopIdx = null) {
  const kind = isOrchReview(s) ? 'orch-review' : isYours(s) ? s.kind : isEnd(s) ? 'end' : 'work', words = stopWords(s), pics = s.kind === 'ask' ? (s.files || []).filter(f => f.image && fileEntry(p, f.path)) : s.kind === 'canvas' ? (s.pictures || []).filter(pic => fileEntry(p, pic.path)) : [];
  const rvInfo = kind === 'orch-review' && !s.reviewing && !s.reviewStopped ? s.review : null;
  const rvUnverified = Boolean(rvInfo && typeof reviewVerdictOf === 'function' && reviewVerdictOf(rvInfo) === 'unverified');
  const rvIgnored = Boolean(rvInfo?.ignored);
  const workMeta = kind === 'work' ? (() => {
    const hasAgent = Boolean(s.agent && s.agent !== 'you');
    const who = hasAgent ? `${av(s.agent, 14)}<span class="lps-agent">${esc(agentInfo(s.agent).name)}</span>` : '';
    const detail = s.took || (s.state === 'active' && s.now ? s.now : '');
    return who || detail ? `<span class="lps-meta">${who}${detail ? `<span class="lps-took">${esc(detail)}</span>` : ''}</span>` : '';
  })() : '';
  const text = kind === 'note' ? `<span class="lps-row"><span class="lps-note">${texInline(plainOut(words))}</span></span>`
    : kind === 'canvas' ? `<span class="lps-row"><span class="lps-note">${esc(words || 'Drawing')}</span>${pics.length ? `<span class="lps-pic-n" aria-hidden="true">${ic('canvas', 11)}</span>` : ''}</span>`
    : kind === 'meeting' ? `<span class="lps-row"><span class="lps-note">${esc(words)}</span></span>`
    : kind === 'ask' ? `<span class="lps-row"><span class="lps-yours">${texInline(plainOut(words)) || 'Ask'}</span>${pics.length ? `<span class="lps-pic-n" title="${pics.length} image${pics.length === 1 ? '' : 's'}">${ic('image', 11)}${pics.length > 1 ? `<span>${pics.length}</span>` : ''}</span>` : ''}</span>${s.finishedAsk ? `<span class="lps-sub"><span class="lps-badge is-done">${ic('check', 10)}Reviewed</span></span>` : s.unsent ? '<span class="lps-sub"><span class="lps-badge is-warn">Not sent</span></span>' : ''}`
    : kind === 'work' ? `<span class="lps-row"><span class="lps-title">${esc(stepLabel(s))}</span>${workStopBadge(s)}</span>${workMeta}`
    : kind === 'orch-review' ? `<span class="lps-row"><span class="lps-title">Review</span>${orchReviewStopBadge(s)}</span><span class="lps-meta">${s.agent ? av(s.agent, 14) : ic('orchestrate', 13)}<span class="lps-agent">${esc(reviewStopMeta(s))}</span>${s.took ? `<span class="lps-took">${esc(s.took)}</span>` : ''}</span>`
    : `<span class="lps-end">${esc(words)}</span>`;
  return `<button type="button" class="lps k-${kind} st-${s.state} ${s.isTodo ? 'is-todo' : ''} ${s.toReview ? 'to-review' : ''} ${isReviewed(s) ? 'is-reviewed' : ''} ${s.unsent ? 'is-unsent' : ''} ${rvUnverified ? 'is-unverified' : ''} ${rvIgnored ? 'is-ignored' : ''} ${(stopIdx ?? s.index) > curI ? 'after' : ''} ${first ? 'first' : ''} ${last ? 'last' : ''} ${S.lineSel?.id === s.id ? 'sel' : ''}" data-act="line-stop" data-line="${esc(l.id)}" data-step="${esc(s.id)}" aria-label="${esc(stepLabel(s))}, ${esc(stateWord(s))}${isReviewed(s) ? ', reviewed' : ''}: ${esc(plainOut(words))}"><span class="lps-node">${kind === 'ask' ? '' : kind === 'orch-review' && !s.reviewing && !s.reviewStopped ? ic('orchestrate', 11) : nodeIcon(s, s.kind === 'merge' && s.state === 'wait')}</span><span class="lps-txt">${text}</span></button>`;
}
function listHTML(p, l) {
  const stations = threadStations(l), curI = stations.indexOf(currentStation(l)), shown = stations.filter(s => s.kind !== 'ask' || askVisible(s));
  let html = '', day = '';
  for (let i = 0; i < shown.length; i++) {
    const s = shown[i], first = i === 0, last = i === shown.length - 1, d = isYours(s) ? dayOf(s.when) : '';
    const idx = stations.indexOf(s);
    if (d && d !== day) { day = d; html += `<div class="lps-day ${first ? 'first' : ''} ${idx > curI ? 'after' : ''}">${esc(d)}</div>`; }
    html += stopRow(p, l, s, curI, first, last, idx);
  }
  return html;
}
// What a stop says in full, when you point at it on a folded line.
function showStopCard(p, l, s, el, extra = '') {
  let card = $('#stopCard');
  if (!card) { card = document.createElement('div'); card.id = 'stopCard'; document.body.append(card); }
  const when = isYours(s) ? s.when : s.took, pics = s.kind === 'ask' ? (s.files || []).filter(f => f.image && fileEntry(p, f.path)) : (s.pictures || []).filter(pic => fileEntry(p, pic.path));
  const orchBody = () => {
    if (s.reviewing) return 'Reviewing in the background…';
    if (s.reviewStopped) return s.state === 'off' ? 'Stopped by you' : (stopWhyWords(s) || s.why || 'Stopped');
    const h = typeof reviewHeadlineOf === 'function' ? reviewHeadlineOf(s.review) : { text:'' };
    const note = typeof reviewNoteOf === 'function' && s.review ? reviewNoteOf(s.review) : '';
    return [h.text, note].filter(Boolean).join(' — ') || 'Orchestrator review';
  };
  const words = isOrchReview(s) ? esc(orchBody()) : isYours(s) ? texInline(s.kind === 'note' ? s.text : stopWords(s)) : inlineSay(stopWords(s));
  const info = isOrchReview(s) ? ((!s.reviewing && !s.reviewStopped && s.review) || s.reviewPending || s.reviewStopped || {}) : null;
  const cardExtra = extra || (info ? [reviewModeLabel(info), reviewWhyText(info)].filter(Boolean).join(' · ') : '');
  card.innerHTML = `<header><strong>${esc(stepLabel(s))}</strong>${s.agent && s.agent !== 'you' ? `${av(s.agent, 16)}<span>${esc(agentInfo(s.agent).name)}</span>` : ''}${when ? `<span>${esc(when)}</span>` : ''}</header><div class="sc-w ${s.kind === 'ask' ? 'is-yours' : ''}">${words}</div>${pics.length ? `<div class="sc-p">${pics.slice(0, 3).map(x => `<img src="${esc(assetUrl(p, x.path))}" alt="">`).join('')}</div>` : ''}${cardExtra ? `<div class="sc-x">${esc(cardExtra)}</div>` : ''}`;
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const r = typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect(), h = card.offsetHeight, w = card.offsetWidth, folded = el.classList.contains('lps');
  card.style.left = `${clamp(folded ? r.right + 8 : r.left, 8, Math.max(8, vp.width - w - 8))}px`;
  card.style.top = `${folded ? clamp(r.top - 6, 8, Math.max(8, vp.height - h - 8)) : r.top - h - 8 > 4 ? r.top - h - 8 : r.bottom + 8}px`;
}
function hideStopCard() { $('#stopCard')?.remove(); }

// ---------- The head ----------
// What moves the work on sits beside the title. Archive is in the `…` menu, where a slip of the hand does not reach it.
function lineHeadActions(p, l, state, cur) {
  const line = esc(l.id);
  if (l.archived) return `<button type="button" class="btn sm" data-act="reopen-line" data-line="${line}">Back to lines</button>`;
  if (l.queued) return `${availableAgents().length ? `<button type="button" class="btn sm primary" data-act="line-do" data-verb="start" data-line="${line}">${ic('play', 15)}Start now</button>` : `<button type="button" class="btn sm primary" data-act="copy-prompt" data-line="${line}">${ic('copy', 15)}Copy prompt</button>`}${endStoppedButton(p, l)}`;
  if (l.landed || state === 'notes') return lineStopButton(l);
  if (state === 'ready') return `${lineStopButton(l)}${canMerge(p, l) ? `<button type="button" class="btn sm" data-act="merge-now" data-line="${line}" aria-label="Merge ${esc(l.branch)} into ${esc(mergeTarget(p, l).name)}">${ic('merge', 15)}Merge<span class="lp-merge-to"> into ${esc(mergeTarget(p, l).name)}…</span></button>` : ''}`;
  const stop = lineStopButton(l);
  if (state === 'error' && lineWorking(l)) return stop;
  if (state === 'error') return endStoppedButton(p, l);
  if (l.elsewhere) return '';
  // Waiting on you (or a non-working Line) can end here too: Mark reviewed is offered whenever no job is working.
  return `${stop}${endStoppedButton(p, l)}`;
}
// Saved split plans are historical content. Their lines use the ordinary line workflow.
function legacyParentHTML(p, l) {
  const parent = l.parent && lineById(p, l.parent);
  return parent ? `<button type="button" class="link legacy-parent" data-act="open-line" data-line="${esc(parent.id)}" title="${esc(parent.title)}">${ic('left', 13)}<span>From ${esc(parent.title)}</span></button>` : '';
}
function placeLegacyParts(p, l) {
  const thread = $('#lpThread'); if (!thread) return;
  let host = $('#lpLegacyParts', thread);
  if (!(l.partList || []).length) { host?.remove(); return; }
  if (!host) { host = document.createElement('section'); host.id = 'lpLegacyParts'; host.className = 'legacy-parts'; host.setAttribute('aria-label', 'Saved parts'); }
  const html = `<h3>Parts</h3><ol>${l.partList.map(part => {
    const child = part.slug && lineById(p, part.slug);
    const title = child ? `<button type="button" class="link" data-act="open-line" data-line="${esc(child.id)}">${esc(part.title)}</button>` : `<strong>${esc(part.title)}</strong>`;
    return `<li>${title}<p>${esc(part.words)}</p></li>`;
  }).join('')}</ol>`;
  if (host.dataset.h !== html) { host.dataset.h = html; host.innerHTML = html; }
  const ask = [...l.stations].reverse().find(s => s.kind === 'ask' && s.via === 'Plan and split');
  const work = ask && l.stations.slice(l.stations.indexOf(ask) + 1).find(isWork), after = work && document.getElementById(`item-${work.id}`);
  if (after) { if (after.nextElementSibling !== host) after.after(host); }
  else if (host.nextElementSibling !== $('#lpAsks', thread)) thread.insertBefore(host, $('#lpAsks', thread));
}
function subLineStatusInfo(x) {
  if (x.archived || x.closed) return { key:'archived', cls:'s-archived', label:'Archived', bucket:6 };
  if (lineNeedsYou(x)) return { key:'wait', cls:'s-wait', label:'Needs you', bucket:0 };
  if (lineWorking(x) || lineState(x) === 'working' || (typeof isReviewPending === 'function' ? isReviewPending(x) : typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.isReviewPending?.(x)))) return { key:'working', cls:'s-working', label:'Working', bucket:1 };
  const st = lineState(x);
  if (st === 'error') return { key:'error', cls:'s-error', label:'Stopped', bucket:2 };
  if (isTodo(x)) return { key:'todo', cls:'s-todo', label:'Todo', bucket:3 };
  if (toReview(x)) return { key:'review', cls:'s-review', label:'To review', bucket:3 };
  if (x.queued || st === 'backlog') return { key:'queued', cls:'s-queued', label:'Queued', bucket:4 };
  const label = lineReviewed(x) ? STATE_TEXT.reviewed : st === 'notes' ? STATE_TEXT.notes : STATE_TEXT.ready;
  return { key:'done', cls:'s-landed', label, bucket:5 };
}
// Always-visible parent Orchestrator strip inside #lpHead (outside .lp-meta so phones keep it too, PE-764/PE-765).
function parentBarHTML(p, l) {
  if (!l?.orchestratedBy && !l?.orchestratedBySlug) return '';
  const parents = typeof parentLinesOf === 'function' ? parentLinesOf(p, l) : [];
  if (parents.length === 1) {
    const parent = parents[0], info = subLineStatusInfo(parent);
    return `<div class="lp-parent-bar${parent.archived ? ' is-archived' : ''}" id="lpParentBar" role="navigation" aria-label="Parent Orchestrator Line">
      <span class="lp-parent-tag">${ic('orchestrate', 13)}Sub-Line of</span>
      <button type="button" class="lp-parent-link" data-act="open-line" data-line="${esc(parent.id)}" title="${esc(parent.title)}">
        <code class="lp-parent-code">${esc(parent.code || parent.id)}</code>
        <span class="lp-parent-title">${esc(parent.title)}</span>
        <span class="fl-state ${info.cls}">${esc(info.label)}</span>
        <span class="lp-parent-arrow" aria-hidden="true">↗</span>
      </button>
    </div>`;
  }
  if (parents.length > 1) {
    return `<div class="lp-parent-bar is-ambiguous" id="lpParentBar" role="navigation" aria-label="Parent Orchestrator Line">
      <span class="lp-parent-tag">${ic('orchestrate', 13)}Sub-Line of</span>
      <button type="button" class="lp-parent-link lp-parent-pick" data-act="parent-pick" data-line="${esc(l.id)}" aria-haspopup="menu">
        <code class="lp-parent-code">${esc(l.orchestratedBy)}</code>
        <span class="lp-parent-title">${parents.length} matching Lines</span>
        ${ic('down', 13)}
      </button>
    </div>`;
  }
  return `<div class="lp-parent-bar is-missing" id="lpParentBar" role="navigation" aria-label="Parent Orchestrator Line">
    <span class="lp-parent-tag">${ic('orchestrate', 13)}Sub-Line of</span>
    <span class="lp-parent-missing" title="This parent Line was deleted, moved, or is not synced here.">
      <code class="lp-parent-code">${esc(l.orchestratedBy)}</code>
      <span class="lp-parent-note">Parent not in this project</span>
    </span>
  </div>`;
}
function lineHeadHTML(p, l) {
  const state = lineState(l), pinned = isPinned(p, l), diff = l.diff && (l.diff.add || l.diff.del) ? `<span class="row-diff"><i>+${l.diff.add}</i> <u>−${l.diff.del}</u></span>` : '';
  const roleBadge = l.orchestratorRef ? `<span class="lp-role-badge" title="Orchestrator Line">${ic('orchestrate', 12)}Orchestrator</span>` : '';
  const parentBar = parentBarHTML(p, l);
  return `<div class="lp-head-row${state === 'error' || l.archived ? ' has-key-status' : ''}">${projectsToggleHTML()}<button type="button" class="icon-btn lp-show" data-act="line-side" aria-label="Show the line" title="Show the line">${ic('panel', 18)}</button>
    <h1 id="lpTitle" title="${esc(l.title)}">${esc(l.title)}</h1>
    <div class="lp-meta">${legacyParentHTML(p, l)}${roleBadge}${stateChip(state, l)}${l.branch ? branchChip(p, l) : l.newBranchFrom ? `<span class="row-branch is-new" title="Starts when you paste this">${ic('branch', 13)}New branch from ${esc(l.newBranchFrom)}</span>` : ''}${diff}${l.commit ? `<code class="commit">${esc(l.commit)}</code>` : ''}</div>
    <div class="lp-acts">${walkHTML(p, l)}${chatButtons(l)}${lineHeadActions(p, l, state, currentStation(l))}${l.archived ? '' : `<button type="button" class="icon-btn lp-pin" data-act="line-pin" data-line="${esc(l.id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} this line" title="${pinned ? 'Unpin' : 'Pin'} this line">${ic('star', 17)}</button>`}<button type="button" class="icon-btn" data-act="line-menu" data-line="${esc(l.id)}" aria-label="More for this Line" aria-haspopup="menu">${ic('more', 18)}</button></div></div>${parentBar}${typeof tokenLineHTML === 'function' ? tokenLineHTML(l) : ''}${madeHTML(p, l)}`;
}

// ---------- The next line in the same filter ----------
// A line opened from a filtered list (a count, the Filter box or a concept on the home, or Find) keeps that list, so you go on to the next one
// without going back: review one, then Next to review. The order is the one you saw. A line that leaves the filter, such as the one you just
// reviewed, is skipped; one that joins it comes last. Opening a line from anywhere else ends it.
const WALK_WORDS = { working:'Next working', stopped:'Next stopped', you:'Next needing you', todo:'Next todo', review:'Next to review', done:'Next finished', unread:'Next unread', send:'Next to send' };
function walkFrom(p) {
  if (S.route.view === 'home' && Pano.rowsEl?.isConnected) {
    if (!mapFilter(p) && !(Pano.words[p.id] || '').trim()) return null;
    return { p:p.id, from:'home', ids:[...new Set([...$$('.hl-row', Pano.rowsEl).map(r => r.dataset.row), ...shownLines(p).map(l => l.id)])] };
  }
  if (S.route.view === 'find' && FIND.data?.project === p.id) return { p:p.id, from:'find', f:FIND.status === 'all' ? '' : FIND.status, ids:[...new Set($$('#findBody .fl').map(el => el.dataset.line))] };
  return null;
}
// The lines in the filter now: the home's own rules, or Find's status over the lines it found.
function walkLive(p, w) {
  if (w.from === 'home') return new Set(shownLines(p).map(l => l.id));
  return new Set(w.ids.filter(id => { const l = lineById(p, id); return l && !l.archived && LINE_STATUS.matches(l, w.f); }));
}
function walkOnGo(route) {
  const by = S.walkGo; S.walkGo = false;
  if (route.view !== 'line' || by) return;
  const p = project(); if (!p) { S.walk = null; return; }
  if (S.route.view === 'home' || S.route.view === 'find') { S.walk = walkFrom(p); return; }
  // Back from a file, or a line of the same list from the sidebar, keeps it.
  const w = S.walk; if (w && (w.p !== p.id || !(w.ids.includes(route.line) || walkLive(p, w).has(route.line)))) S.walk = null;
}
function walkSteps(p, l) {
  const w = S.walk; if (!w || w.p !== p.id) return null;
  const live = walkLive(p, w), seen = new Set(w.ids), order = [...w.ids, ...[...live].filter(id => !seen.has(id))], at = order.indexOf(l.id);
  if (at < 0) return null;
  const others = order.filter(id => id !== l.id && live.has(id) && lineById(p, id)); if (!others.length) return null;
  const left = new Set(others), next = order.slice(at + 1).find(id => left.has(id)) || others[0], prev = order.slice(0, at).reverse().find(id => left.has(id)) || others[others.length - 1];
  return { next, prev, left:others.length, done:!live.has(l.id), words:WALK_WORDS[w.from === 'home' ? mapFilter(p) : w.f] || 'Next line' };
}
// Once the line you are on has left the filter, Next is the thing to press.
function walkHTML(p, l) {
  const w = walkSteps(p, l); if (!w) return '';
  const name = id => esc(lineById(p, id)?.title || '');
  return `<span class="lp-walk" role="group" aria-label="Lines in this filter">${w.left > 1 ? `<button type="button" class="icon-btn" data-act="walk" data-line="${esc(w.prev)}" aria-label="Previous: ${name(w.prev)}" title="Previous: ${name(w.prev)} (Alt+↑)">${ic('left', 16)}</button>` : ''}<button type="button" class="btn sm ${w.done ? 'primary' : ''}" data-act="walk" data-line="${esc(w.next)}" aria-label="${w.words}, ${w.left} left: ${name(w.next)}" title="${name(w.next)} (Alt+↓)"><span class="lp-walk-w">${w.words}</span><em>${w.left}</em>${ic('right', 14)}</button></span>`;
}
// A line to review opens at the first Work you have not reviewed.
ACT['walk'] = el => {
  const l = lineById(project(), el.dataset.line); if (!l) return;
  S.walkGo = true;
  go({ view:'line', line:l.id, ...(toReview(l) ? { step:nextToReview(l).id } : {}) });
};
addEventListener('keydown', e => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || S.route.view !== 'line') return;
  if (e.target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  const b = $$('#lpHead .lp-walk [data-act="walk"]'), to = e.key === 'ArrowDown' ? b[b.length - 1] : b.length > 1 ? b[0] : null;
  if (to) { e.preventDefault(); ACT['walk'](to); }
});

// ---------- The one file, down the middle ----------
const LONG_WORDS = 900, LONG_LINES = 14;
// What you can do with a node waits in a small toolbar at its top right, shown on hover, so the page shows only what was said.
const nodeTool = (act, icon, label, s, line = '') => `<button type="button" class="lp-tool" data-act="${act}" data-step="${esc(s.id)}"${line ? ` data-line="${esc(line)}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">${ic(icon, 15)}</button>`;
const nodeTools = (l, s, buttons, on = false) => { const all = buttons.filter(Boolean).join(''); return all ? `<div class="lp-tools ${on ? 'is-on' : ''}" role="toolbar" aria-label="${esc(KIND[s.kind]?.label || 'Node')}">${all}</div>` : ''; };
// penecho.ai keeps no trash to bring an Ask or a Work back from, so there only what was always removable goes; its server refuses the rest.
const deletableHere = (l, s) => !HOSTED || (!l.archived && !l.closed && (['note', 'canvas', 'meeting'].includes(s.kind) || s.state === 'off'));
const deleteTool = (l, s) => deletableHere(l, s) ? nodeTool('yours-drop', 'trash', 'Delete', s, l.id) : '';
function toolCopy(s, { words, paths, refers = [] }) {
  const apart = filesApart(paths), out = [];
  if (!apart || words || refers.length) out.push(nodeTool('copy-step', 'copy', apart ? 'Copy the words' : 'Copy', s));
  if (apart) out.push(nodeTool('copy-files', 'clip', `Copy ${copiedLabel(paths)}`, s));
  return out;
}
const canToggleStepTask = (l, s) => Boolean(l && !l.archived && !l.closed && !HOSTED && s && ['ask', 'note', 'canvas'].includes(s.kind) && !s.pendingFiles);
const taskStepKey = (p, l, s) => `${p?.id || ''}:${l?.id || ''}:${s?.id || ''}`;
function applyPendingTasks(p, l, s, text) {
  const pending = S.taskPending?.get(taskStepKey(p, l, s));
  if (!pending?.size || typeof toggleTaskInMd !== 'function') return text;
  let out = String(text ?? '');
  for (const [index, entry] of pending) out = toggleTaskInMd(out, index, entry.checked, entry.expected);
  return out;
}
function toggleStepTask(box) {
  const card = box.closest('[data-step]'), stepId = card?.dataset.step, index = Number(box.dataset.taskIndex);
  const expected = box.dataset.taskText || '';
  const p = project(), l = p && lineById(p, S.route.line), s = l && stepId && stationById(l, stepId);
  if (!canToggleStepTask(l, s) || !Number.isInteger(index) || index < 0) return;
  const checked = Boolean(box.checked);
  box.closest('li.task')?.classList.toggle('done', checked);
  const sKey = taskStepKey(p, l, s), lKey = `${p.id}:${l.id}`;
  const pendingMap = (S.taskPending ||= new Map()), stepPending = pendingMap.get(sKey) || new Map();
  const seq = (S.taskSeq = (S.taskSeq || 0) + 1);
  stepPending.set(index, { checked, expected, seq });
  pendingMap.set(sKey, stepPending);
  if (card) card.dataset.h = itemHTML(p, l, s);
  const counts = (S.taskCounts ||= new Map()), queues = (S.taskQueues ||= new Map());
  counts.set(lKey, (counts.get(lKey) || 0) + 1);
  const prev = queues.get(lKey) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    let failed = null;
    try {
      await api(topicApi(p, l, 'toggle-task'), { method:'POST', body:{ step:stepId, index, checked, ...(expected ? { expected } : {}) } });
      const known = S.docs[docKey(p.id, l.topicPath)];
      if (known) known.mtime = 0;
    } catch (error) {
      failed = error;
      if (stepPending.get(index)?.seq === seq) {
        stepPending.delete(index);
        if (!stepPending.size) pendingMap.delete(sKey);
      }
      toast(error.message);
    } finally {
      const left = Math.max(0, (counts.get(lKey) || 1) - 1);
      if (left) counts.set(lKey, left); else counts.delete(lKey);
      if (!left) {
        await loadState(p.id, { force:true }).catch(() => {});
        if (!counts.get(lKey)) {
          for (const [k, m] of [...pendingMap.entries()]) {
            if (!k.startsWith(`${lKey}:`)) continue;
            for (const [idx, entry] of [...m.entries()]) if (entry.seq <= seq) m.delete(idx);
            if (!m.size) pendingMap.delete(k);
          }
        }
        if (S.cur === p.id && S.route.view === 'line' && S.route.line === l.id) refreshLine();
      } else if (failed && S.cur === p.id && S.route.view === 'line' && S.route.line === l.id) {
        refreshLine();
      }
    }
  });
  queues.set(lKey, run);
  run.finally(() => { if (queues.get(lKey) === run) queues.delete(lKey); });
}
function askItem(p, l, s) {
  const said = applyPendingTasks(p, l, s, askOnly(s.text)), long = said.length > LONG_WORDS || said.split('\n').length > LONG_LINES, open = S.openAsks?.has(s.id);
  const quotes = (s.refers || []).map(r => r.step && stationById(l, r.step) ? `<button type="button" class="lp-quote" data-act="line-stop" data-line="${esc(l.id)}" data-step="${esc(r.step)}" title="Go to ${esc(r.label)}">${quoteInner(r.label, r.words)}</button>` : `<div class="lp-quote">${quoteInner(r.label, r.words)}</div>`).join('');
  const pics = askPictures(p, l, s);
  if (!said && !quotes && !pics && !s.unsent && !s.finishedAsk && !s.make) return '';
  return `<section class="lp-ask ${s.unsent ? 'is-unsent' : ''}" id="item-${esc(s.id)}" data-step="${esc(s.id)}"${typeof fromMark === 'function' ? fromMark(l, s) : ''}>
    ${quotes}
    ${said ? `<div class="lp-words words md-words ${long && !open ? 'clamped' : ''}">${wordsMd(said, p, { interactive: canToggleStepTask(l, s) })}</div>` : ''}
    ${long ? `<button type="button" class="link lp-more" data-act="ask-more" data-step="${esc(s.id)}">${open ? 'Show less' : 'Show all'}</button>` : ''}
    ${typeof makeTagHTML === 'function' ? makeTagHTML(s) : ''}
    ${pics}
    ${s.finishedAsk ? `<p class="lp-ask-finished" role="status">${ic('check', 15)}<strong>Finished &amp; reviewed</strong><span>Marked by you.</span></p>` : ''}
    ${s.unsent ? unsentFoot(p, l, s) : nodeTools(l, s, [...toolCopy(s, askParts(p, l, s)), l.archived || l.closed ? '' : nodeTool('line-refer', 'refer', 'Refer to this in the box', s), deleteTool(l, s)], copiedNow(l, s))}
  </section>`;
}
// None of this is in the Markdown, which only says Not sent.
const defaultPresetAgent = () => (typeof defaultPreset === 'function' ? defaultPreset()?.agent || '' : '');
const unsentWanted = (p, l, s) => { const key = `${l.id}/${s.id}`; return S.handed?.[key]?.agent || S.askFor?.[key] || l.conversation?.agent || l.agent || defaultPresetAgent() || p.defaultAgent; };
function unsentAgent(p, l, s) {
  const list = availableAgents(), wanted = unsentWanted(p, l, s);
  return list.find(a => a.id === wanted) || list.find(a => a.app) || list[0] || null;
}
// The agent that last worked on this line itself, or in this project for pasting into an app. One that only reviewed a Work here did not work on it.
const lastWork = x => [...(x?.stations || [])].reverse().find(s => s.agent && s.agent !== 'you' && !isYours(s) && s.kind !== 'orch-review' && s.state !== 'todo') || null;
const workedOn = x => lastWork(x)?.agent || '';
const lineWorker = l => workedOn(l) || l?.conversation?.agent || '';
function lastWorker(p, l) {
  if (lineWorker(l)) return lineWorker(l);
  for (const x of [...allLines(p)].sort((a, b) => (b.statusAt || 0) - (a.statusAt || 0))) if (workedOn(x)) return workedOn(x);
  return '';
}
// Pasting may fall back on whichever agent is here, but going to an app must not. It goes to the agent this Ask was already pasted to, or to the one that last worked in this project. Before any agent has worked here, it stays a copy.
const openingAgent = (p, l, s) => { const wanted = S.handed?.[`${l.id}/${s.id}`]?.agent || lastWorker(p, l); return wanted ? availableAgents().find(a => a.id === wanted) || null : null; };
// A conversation already on this line has read its file, so your words are enough. Anywhere else, the file comes too.
const knowsLine = l => Boolean(l.conversation?.agent);
// With context also takes you to the agent's app when it can, and the arrow says so. The server has the last word when it is pressed.
const pasteOpens = (l, s) => { const a = S.thisComputer && !(l.running && !l.elsewhere) ? openingAgent(project(), l, s) : null; if (!a?.opens) return ''; if (a.opensIn === 'app') return `Copies, then opens ${appName(a)}`; const where = a.opensIn ? 'a terminal' : appName(a); return l.conversations?.[a.id] ? `Copies, then opens this conversation in ${where}` : `Copies, then starts a new conversation in ${where}`; };
const pasteButton = (l, s, context, primary) => { const opens = context ? pasteOpens(l, s) : ''; return `<button type="button" class="btn sm${primary ? ' unsent-go' : ''}" data-act="${context ? 'unsent-context' : 'unsent-plain'}" data-line="${esc(l.id)}" data-step="${esc(s.id)}"${opens ? ` title="${esc(opens)}"` : ''}>${ic('copy', 14)}Paste ${context ? 'with' : 'without'} context${opens ? ic('arrow', 13) : ''}</button>`; };
const pasteWithContext = (l, s) => S.handed?.[`${l.id}/${s.id}`]?.context !== false;
function pasteSplit(p, l, s) {
  const primary = !runAgent(p, l);
  return `<span class="paste-split">${pasteButton(l, s, pasteWithContext(l, s), primary)}<button type="button" class="btn sm paste-pick${primary ? ' unsent-go' : ''}" data-act="unsent-paste-pick" data-line="${esc(l.id)}" data-step="${esc(s.id)}" aria-haspopup="menu" aria-label="Choose paste mode" title="Choose paste mode">${ic('down', 14)}</button></span>`;
}
const unsentSecond = (done, step) => `<button type="button" class="btn sm${done.filesCopied ? '' : ' unsent-go'}" data-act="unsent-files" ${step}>${ic('clip', 14)}Copy ${esc(filesLabel(done))}</button>`;
// The agents PenEcho can run itself. An app alone, such as Kimi's without its command line, only takes a paste.
const runnableAgents = () => availableAgents().filter(a => a.runs !== false);
// Run goes to the one you picked for this line, else the one that last worked on it, else Settings' default or the project's fallback.
function runAgent(p, l) {
  const list = runnableAgents(), pick = id => list.find(a => a.id === id);
  if (!list.length) return null;
  return pick(S.runWith?.[l.id]) || pick(lineWorker(l)) || pick(defaultPresetAgent()) || pick(p.defaultAgent) || pick('codex') || pick('claude') || list[0] || null;
}
// The saved agent Run uses: the one picked on this line, else the last worker's saved agent, else PenEcho's default when Run goes to its runner, else that runner as itself.
function runPreset(p, l) {
  const a = runAgent(p, l); if (!a) return null;
  const picked = typeof presetById === 'function' ? presetById(S.runPresetOn?.[l.id]) : null, chosen = typeof defaultPreset === 'function' ? defaultPreset() : null;
  const presets = typeof runnablePresets === 'function' ? runnablePresets() : [];
  const prev = lastWork(l);
  const selected = prev?.selected?.model;
  const model = prev?.selected && (!selected || selected.includes('/')) ? selected || '' : prev?.picked?.model || selected || '';
  const effort = prev?.picked?.effort || prev?.selected?.effort || '';
  const prior = prev?.agent === a.id && (model || effort || (prev.selected && prev.savedAgent))
    ? { id:'', inherited:true, sourceWorkId:prev.id, agent:a.id, model, effort, name:[a.name, model, effort ? `${effort} effort` : ''].filter(Boolean).join(' · ') }
    : prev?.agent === a.id && (prev.savedAgentId || prev.savedAgent)
    ? presets.find(x => !x.auto && x.agent === a.id && prev.savedAgentId && x.id === prev.savedAgentId) || presets.find(x => !x.auto && x.agent === a.id && prev.savedAgent && x.name === prev.savedAgent) || null
    : null;
  const inherited = prior || (prev?.agent === a.id ? { id:'', inherited:true, sourceWorkId:prev.id, agent:a.id, name:a.name, auto:true } : null);
  return picked?.agent === a.id ? picked : inherited || (chosen?.agent === a.id ? chosen : presets.find(x => x.agent === a.id && x.auto) || null);
}
// The runner's own settings are still a concrete choice, even when no saved agent is selected.
function runLabel(a, preset) {
  const x = preset || { agent:a.id, name:a.name, auto:true };
  const facts = typeof presetShouldShowFacts === 'function' && presetShouldShowFacts(x) ? presetFacts(x) : '';
  return [x.name, facts].filter(Boolean).join(' · ');
}
// With a Work running here, Run with either steers into it (same agent, model and effort, and it can take words mid-turn) or runs next (PE-558).
const setupOf = preset => preset && !preset.auto ? `${preset.model || ''}|${preset.effort || ''}` : '|';
// Inherited from the Work running now, it is that run's own setup, even when the agent has since reported a model the run was not started with (PE-618).
const fromRunningWork = (l, preset) => Boolean(preset?.inherited && preset.sourceWorkId && stationById(l, preset.sourceWorkId)?.state === 'active');
const draftHasRefs = s => Boolean(s && (s.hasRefs || (s.files && s.files.length) || (s.pictures && s.pictures.length) || (s.refers && s.refers.length) || s.canvas || s.make));
function runMode(l, agent, preset, step = null) {
  if (!l.running || !l.runAgent) return '';
  if (l.elsewhere) return 'next';
  if (l.runHasQuestions && draftHasRefs(step)) return 'next';
  return l.runSteers && agent === l.runAgent && (fromRunningWork(l, preset) || setupOf(preset) === (l.runSetup || '|')) ? 'steer' : 'next';
}
const runVerb = (mode, name) => mode === 'steer' ? `Steer into ${name}` : mode === 'next' ? `Run with ${name} next` : `Run with ${name}`;
const runWhy = (mode, l) => mode === 'steer' ? `Goes into the Work ${agentInfo(l.runAgent).name} is doing now` : mode === 'next' ? `Starts when ${agentInfo(l.runAgent).name} finishes` : '';
const orchAutoChoice = (p, l, s = null) => {
  if (HOSTED || !l?.orchestratorRef) return false;
  if (typeof ORCHSET === 'object' && ORCHSET.missing) return false;
  if (typeof orchSettings === 'function' && orchSettings(p)) return true;
  if (typeof loadOrchSettings === 'function' && typeof ORCHSET === 'object' && !ORCHSET.loading) {
    queueMicrotask(() => loadOrchSettings(p));
  }
  return s?.savedAgentId === 'auto' || S.runPresetOn?.[l.id] === 'auto';
};
function runChoice(p, l, s = null) {
  const picks = typeof runPresets === 'function' ? runPresets() : [];
  const allowAuto = orchAutoChoice(p, l, s);
  const explicitAuto = allowAuto && S.runPresetOn?.[l.id] === 'auto';
  const explicitPick = Boolean(S.runWith?.[l.id] || S.runPresetOn?.[l.id]);
  if (explicitAuto || (!explicitPick && allowAuto && s?.savedAgentId === 'auto')) {
    const mode = l.running && l.runAgent ? 'next' : '';
    return { a:{ id:'', name:'PenEcho Auto' }, preset:{ id:'auto', name:'PenEcho Auto', auto:true }, name:'PenEcho Auto', more:runnableAgents().length > 0 || picks.length > 0 || !can('agents'), mode };
  }
  if (!explicitPick && s?.savedAgentId && s.savedAgentId !== 'auto' && typeof presetById === 'function') {
    const savedPreset = presetById(s.savedAgentId);
    const savedRunner = savedPreset && savedPreset.available !== false ? runnableAgents().find(x => x.id === savedPreset.agent) : null;
    if (savedPreset && savedRunner) {
      const more = runnableAgents().length > 1 || picks.some(x => x.id !== savedPreset.id) || allowAuto || !can('agents');
      return { a:savedRunner, preset:savedPreset, name:runLabel(savedRunner, savedPreset), more, mode:runMode(l, savedRunner.id, savedPreset, s) };
    }
  }
  const a = runAgent(p, l); if (!a) return null;
  const preset = runPreset(p, l);
  let name = runLabel(a, preset);
  if (typeof HOSTED !== 'undefined' && HOSTED && !HOSTED.onComputer && a.id === 'penecho' && typeof hostedModelSelection === 'function' && typeof hostedModelLabel === 'function') {
    const cloudModel = hostedModelLabel(hostedModelSelection(l.slug || l.id));
    if (cloudModel) name = `PenEcho · ${cloudModel}`;
  }
  const more = runnableAgents().length > 1 || picks.some(x => x.id !== preset?.id) || allowAuto || !can('agents');   // Hosted: one agent, and the menu says what it runs on (hosted.js)
  return { a, preset, name, more, mode:runMode(l, a.id, preset, s) };
}
const runSnapAttrs = (l, mode) => mode === 'steer'
  ? ` data-run-mode="steer" data-run-agent="${esc(l.runAgent || '')}" data-run-step="${esc(l.runStep || '')}" data-run-launch="${esc(l.runLaunch || '')}"`
  : mode ? ` data-run-mode="${esc(mode)}"` : '';
function runSplit(p, l, s) {
  if (cloudRunSending(p, l, s.id)) return sendingRunHTML(l, s);
  const choice = runChoice(p, l, s); if (!choice) return '';
  const { a, preset, name, more, mode } = choice, step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`, why = runWhy(mode, l);
  return `<span class="run-split${more ? '' : ' is-one'}"><button type="button" class="btn sm run-main" data-act="unsent-run" data-agent="${esc(a.id)}" data-preset="${esc(preset?.id || '')}"${runSnapAttrs(l, mode)} ${step}${why ? ` title="${esc(why)}"` : ''}>${ic('play', 13)}<span>${esc(runVerb(mode, name))}</span></button>${more ? `<button type="button" class="btn sm run-pick" data-act="unsent-run-pick" ${step} aria-haspopup="menu" aria-label="Run with another agent" title="Run with another agent">${ic('down', 14)}</button>` : ''}</span>`;
}
function runAutoButton(l, step) {
  if (HOSTED || l.orchestratorRef || typeof runPresets !== 'function' || !runPresets().length) return '';
  const label = runVerb(l.running && l.runAgent ? 'next' : '', 'PenEcho Auto');
  return `<button type="button" class="btn sm" data-act="unsent-run-auto" ${step}>${ic('spark', 14)}${label}</button>`;
}
function unsentSendHTML(p, l, s, fallbackLabel = 'Send') {
  if (cloudRunSending(p, l, s.id)) return sendingRunHTML(l, s);
  const step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`, choice = s.held ? null : runChoice(p, l, s);
  if (!choice) return `<button type="button" class="btn sm" data-act="open-step" ${step}>${esc(fallbackLabel)}</button>`;
  const { a, preset, name, more, mode } = choice;
  return `<span class="send-two${more ? '' : ' is-one'}"><button type="button" class="btn sm" data-act="unsent-run" data-agent="${esc(a.id)}" data-preset="${esc(preset?.id || '')}"${runSnapAttrs(l, mode)} ${step} title="${esc(runVerb(mode, name))}">${mode === 'steer' ? 'Steer' : 'Send'}</button>${more ? `<button type="button" class="btn sm send-two-pick" data-act="unsent-run-pick" ${step} aria-haspopup="menu" aria-label="Send with another agent" title="Send with another agent">${ic('down', 14)}</button>` : ''}</span>`;
}
// Agent checks finish after the first paint. Update labels in place without disturbing a draft or keyboard focus.
function refreshRunLabels() {
  for (const el of $$('[data-act="unsent-run"]')) {
    if (el.disabled) continue;
    const p = project(), l = p && lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step), choice = l && runChoice(p, l, s);
    if (!choice) continue;
    const { a, preset, name, mode } = choice;
    el.dataset.agent = a.id; el.dataset.preset = preset?.id || '';
    if (mode) el.dataset.runMode = mode; else delete el.dataset.runMode;
    if (mode === 'steer') { el.dataset.runAgent = l.runAgent || ''; el.dataset.runStep = l.runStep || ''; el.dataset.runLaunch = l.runLaunch || ''; }
    else { delete el.dataset.runAgent; delete el.dataset.runStep; delete el.dataset.runLaunch; }
    if (el.classList.contains('run-main')) { const label = $('span', el); if (label) label.textContent = runVerb(mode, name); if (runWhy(mode, l)) el.title = runWhy(mode, l); else el.removeAttribute('title'); }
    else { el.title = runVerb(mode, name); el.textContent = mode === 'steer' ? 'Steer' : 'Send'; }
  }
}
const unsentFinish = (l, s) => s.canFinishUnsent ? `<div class="unsent-finish"><span>Already completed elsewhere?</span><button type="button" class="btn sm" data-act="unsent-finish" data-line="${esc(l.id)}" data-step="${esc(s.id)}">${ic('check', 14)}Mark finished &amp; reviewed</button></div>` : '';
function unsentFoot(p, l, s) {
  if (l.archived || l.closed) return `<p class="unsent-note"><strong class="unsent-mark">Not sent yet.</strong></p>${HOSTED ? '' : nodeTools(l, s, [nodeTool('unsent-drop', 'trash', 'Delete', s, l.id)])}`;
  if (s.held && typeof heldAskHTML === 'function') { const held = heldAskHTML(p, l, s); if (held) return held + unsentFinish(l, s); }   // Cloud: an Ask held back says why (cloud.js)
  const agent = unsentAgent(p, l, s), done = S.handed?.[`${l.id}/${s.id}`], step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`, hint = done ? esc(pasteHint(done)) : '', size = fileEntry(p, l.topicPath)?.size;
  return `<div class="unsent-box"><p class="unsent-note">${ic('hint', 15)}<span><strong class="unsent-mark">Not sent yet.</strong>${can('paste') ? ' Run it here, or paste it into your agent and press Send there.' : ''}</span></p>
      ${agent ? `<div class="unsent-acts">${runSplit(p, l, s)}${runAutoButton(l, step)}${pasteSplit(p, l, s)}</div>
      <p class="unsent-about">With context just passes this line's .md file as a reference: your original asks and a short note on each work${size ? `, about ${fmtTokens(tokensForSize(size))} tokens` : ''}. Full work details aren't passed.</p>` : ''}
      ${hint ? `<div class="unsent-hint">${ic('check', 14)}<span>${hint}</span>${done.attachments ? unsentSecond(done, step) : ''}</div>` : ''}
      ${unsentFinish(l, s)}</div>
    <footer class="lp-from lp-unsent"><time>${esc(s.when)}</time><div class="lp-unsent-acts"><button type="button" class="ghost tiny" data-act="unsent-edit" ${step}>${ic('pen', 13)}Edit</button><button type="button" class="ghost tiny" data-act="unsent-drop" ${step}>Delete</button></div></footer>`;
}
// What happened is said only when it is not what you would expect: a new conversation, or a wait for the app's turn.
function ranNote(r, name) {
  if (r?.next) return `Runs with ${name} when ${agentInfo(r.next).name} finishes.`;
  if (r?.after) return `Runs with ${name} when the turn going on in the app ends.`;
  if (r?.fresh) return `${name}'s app has this line's conversation open, so this runs in a new conversation that reads the line.`;
  return '';
}
// ---------- Starting an agent: on the page at once, started behind it ----------
// Starting an agent can take seconds (a branch, its app, Cloud). A click that starts one changes the page at once, and every state that arrives
// keeps that change until the server answers. Then the server's own state is shown, and a run that failed says why.
const STARTING = new Map();
const startKey = (p, l, verb, step) => `${p.id}/${l.id}/${verb}/${step || ''}`;
const cloudRunSending = (p, l, step) => Boolean(p && l && STARTING.get(startKey(p, l, 'run-unsent', step))?.cloud);
const sendingRunHTML = (l, s) => `<button type="button" class="btn sm" data-act="unsent-run" data-line="${esc(l.id)}" data-step="${esc(s.id)}" disabled aria-busy="true">Sending…</button>`;
// Called for every state that arrives (state.js). A change the server's state already holds is let go.
function keepStarting(p) {
  for (const [key, e] of STARTING) {
    if (e.project !== p.id || e.cloud) continue;
    const l = lineById(p, e.line);
    if (!l || !e.apply(l)) STARTING.delete(key);
  }
}
function letStartGo(l) {
  const id = project()?.id;
  for (const [key, e] of STARTING) if (e.project === id && e.line === l?.id && !e.cloud) STARTING.delete(key);
}
async function actAtOnce(l, verb, body, apply) {
  const p = project(), key = startKey(p, l, verb, body.step);
  if (verb !== 'answer' && STARTING.has(key)) return false;
  const cloud = Boolean(HOSTED && verb === 'run-unsent');
  if ((cloud ? Boolean(stationById(l, body.step)?.unsent) : apply(l)) === false) return false;
  const entry = { project:p.id, line:l.id, apply, cloud };
  STARTING.set(key, entry);
  const clear = () => { if (STARTING.get(key) === entry) STARTING.delete(key); };
  try {
    refreshAfterChange();
    return await api(topicApi(p, l, verb), { method:'POST', body });
  }
  finally {
    if (!cloud) clear();
    try { await loadState(p.id, { force:true }); } catch { /* The next poll brings it. */ }
    clear();
    refreshAfterChange();
  }
}
// The line working, with this agent.
const lineStarts = agent => l => {
  const at = Date.now();
  Object.assign(l, { running:true, runAgent:agent || l.runAgent || l.agent || '', runStarted:at, status:'working', statusAt:at, asking:null, queued:false });
  return true;
};
function startingWork(ask, agent, mode) {
  return { ...ask, id:`starting-${ask.id}`, kind:'work', label:KIND.work.label, state:mode === 'next' ? 'todo' : 'active', unsent:false, via:'', held:null, agent:agent || '',
    when:nowWhen(), text:'', out:'', now:mode === 'next' ? '' : 'Starting…', refers:[], make:null, pendingFiles:undefined, files:[], pictures:[], detail:'', diff:null, why:'',
    canFinishUnsent:false, finishedAsk:false, reviewed:false, toReview:false, isTodo:false, asked:false, wait:false, finished:false, took:'' };
}
// Run with: the Ask as sent and, unless its words go into the Work already running, a Work after it. False once the server's state has it (the Ask Not sent is gone).
function asksSent(step, agent, mode) {
  let work = null;
  return l => {
    const ask = stationById(l, step);
    if (!ask?.unsent) return false;
    work ||= startingWork(ask, agent, mode);
    Object.assign(ask, { unsent:false, via:'', held:null, canFinishUnsent:false });
    if (mode !== 'steer' && !stationById(l, work.id)) {
      l.stations.splice(l.stations.indexOf(ask) + 1, 0, work);
      l.stations.forEach((x, i) => { x.index = i; });
    }
    if (!mode) lineStarts(agent)(l);
    l.updatedAt = l.lastActivityAt = Math.max(l.updatedAt || 0, Date.now());
    return true;
  };
}
const steerSnapshot = (l, mode) => mode === 'steer'
  ? { expectedMode:'steer', ...(l.runAgent ? { expectedAgent:l.runAgent } : {}), ...(l.runStep ? { expectedStep:l.runStep } : {}), ...(l.runLaunch ? { expectedLaunch:l.runLaunch } : {}) }
  : mode ? { expectedMode:mode } : null;
async function runUnsent(p, l, step, agent, presetId = '', expected = null) {
  if (!p || !l || STARTING.has(startKey(p, l, 'run-unsent', step)) || !stationById(l, step)?.unsent) return;
  const isAuto = presetId === 'auto';
  if (isAuto && HOSTED) return;
  const a = isAuto ? null : (agent ? runnableAgents().find(x => x.id === agent) : runAgent(p, l));
  const preset = isAuto ? { id:'auto', name:'PenEcho Auto', auto:true } : presetById(presetId);
  // The main button carries no id for an inherited setup; the page's guess of steer or next uses the same one its label did.
  const shown = !isAuto && !presetId && a ? runPreset(p, l) : null, guess = !isAuto ? (preset || (shown?.agent === a?.id ? shown : null)) : null;
  if (isAuto && l.orchestratorRef) {
    delete S.runWith?.[l.id];
    (S.runPresetOn ||= {})[l.id] = 'auto';
  } else if (!isAuto) {
    if (a) (S.runWith ||= {})[l.id] = a.id;
    if (preset) (S.runPresetOn ||= {})[l.id] = preset.id;
    else if (a) delete S.runPresetOn?.[l.id];
  }
  try {
    const draft = stationById(l, step);
    const snap = expected || steerSnapshot(l, isAuto ? (l.running && l.runAgent ? 'next' : '') : (a ? runMode(l, a.id, guess, draft) : ''));
    const mode = snap?.expectedMode || '';
    const r = await actAtOnce(l, 'run-unsent', { step, agent:isAuto ? '' : (a?.id || ''), ...(preset ? { preset:preset.id } : {}), ...(snap || {}) }, asksSent(step, isAuto ? '' : (a?.id || ''), mode));
    const picked = r?.auto?.agent;
    const autoNote = picked && (l.orchestratorRef
      ? `Orchestrator started · ${typeof ORCH_KIND === 'object' && ORCH_KIND[r.auto.kind] ? `${ORCH_KIND[r.auto.kind]} job → ` : ''}${picked}`
      : `PenEcho Auto picked ${picked}${r.mode === 'queued' ? ' for the next Work' : ''}.`);
    const note = autoNote || ranNote(r, preset?.name || a?.name || 'the agent');
    if (note) toast(note);
  } catch (error) { toast(HOSTED && error.offline ? 'Could not confirm the run. Check the Line before trying again.' : error.message); }
}
ACT['unsent-run'] = el => {
  const p = project();
  const snap = el.dataset.runMode
    ? { expectedMode:el.dataset.runMode, ...(el.dataset.runMode === 'steer' ? { ...(el.dataset.runAgent ? { expectedAgent:el.dataset.runAgent } : {}), ...(el.dataset.runStep ? { expectedStep:el.dataset.runStep } : {}), ...(el.dataset.runLaunch ? { expectedLaunch:el.dataset.runLaunch } : {}) } : {}) }
    : null;
  runUnsent(p, lineById(p, el.dataset.line), el.dataset.step, el.dataset.agent, el.dataset.preset, snap);
};
// Follow this logical Ask through its first save, but never across navigation.
// The save renames IDs and replaces the hash in place; normal navigation changes the route or transition.
function unsentTarget(el) {
  const view = $('#view'), projectId = S.cur, route = S.route, snapshot = { ...route }, hash = typeof location === 'object' && location ? location.hash : '';
  const transition = typeof navigationTransition === 'undefined' ? 0 : navigationTransition;
  const { line, step } = el.dataset, saved = id => typeof savedId === 'function' ? savedId(id) : id;
  return () => {
    if (!view?.isConnected || $('#view') !== view || S.cur !== projectId || S.route !== route || S.newPage || S.shelfPage) return null;
    if (typeof navigationTransition !== 'undefined' && navigationTransition !== transition) return null;
    const mapped = { ...snapshot };
    for (const key of ['line', 'step']) if (mapped[key]) mapped[key] = saved(mapped[key]);
    if (Object.keys({ ...mapped, ...route }).some(key => mapped[key] !== route[key])) return null;
    const renamed = mapped.line !== snapshot.line || mapped.step !== snapshot.step;
    const expectedHash = renamed && typeof routeToHash === 'function' ? '#' + routeToHash(mapped) : hash;
    if (typeof location === 'object' && location && location.hash !== expectedHash) return null;
    const p = project(), l = p && lineById(p, saved(line)), s = l && stationById(l, saved(step));
    return s?.unsent && s.kind === 'ask' ? { p, l, s } : null;
  };
}
// An open menu follows only the unique visible, enabled control for that Ask.
function unsentMenuAnchor(el, target = unsentTarget(el)) {
  const act = el.dataset.act;
  return () => {
    const at = target(); if (!at) return null;
    const matches = $$('[data-act="unsent-run-pick"], [data-act="unsent-paste-pick"]', $('#view')).filter(a => a.dataset.act === act && a.dataset.line === at.l.id && a.dataset.step === at.s.id && !a.disabled && menuAnchorRect(a));
    return matches.length === 1 ? matches[0] : null;
  };
}
// After selection, scrolling is harmless; saving or navigation still must not run a stale Ask.
function chooseUnsent(target, run) {
  const at = target(); if (!at) return;
  const ready = () => { const now = target(); if (now) run(now); };
  if (typeof whenAskSaved === 'function') whenAskSaved(at.p.id, at.l.id, at.s.id, ready);
  else ready();
}
ACT['unsent-run-auto'] = el => chooseUnsent(unsentTarget(el), ({ p, l, s }) => runUnsent(p, l, s.id, '', 'auto'));
const compareRunMenuRow = (a, b) =>
  String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity:'base', numeric:true })
  || String(a.label || '').localeCompare(String(b.label || ''))
  || String(a.note || '').localeCompare(String(b.note || ''), undefined, { sensitivity:'base', numeric:true });
// The arrow picks who runs it. Picking runs it, as the menu says.
ACT['unsent-run-pick'] = el => {
  const p = project(), l = lineById(p, el.dataset.line);
  if ($('#menu.run-menu')) { closeMenu(); return; }
  // Saved agents, alphabetically by name, with what they run on in small type. A server without them lists the runners.
  const draft = stationById(l, el.dataset.step);
  const current = runChoice(p, l, draft);
  const saved = runPresets(), on = current?.preset?.id || '', now = current?.a?.id || '', target = unsentTarget(el);
  const hasPresets = saved.length || S.presets?.presets?.some(x => x.showInPicker === false);
  const run = (agent, preset = '', shownMode = '') => {
    const snap = steerSnapshot(l, shownMode);
    return () => chooseUnsent(target, ({p, l, s}) => runUnsent(p, l, s.id, agent, preset, snap));
  };
  const when = mode => ({ steer:'Steers in', next:'Runs next' })[mode] || '';
  const autoMode = l.running && l.runAgent ? 'next' : '';
  const autoEntries = orchAutoChoice(p, l, draft)
    ? [{ row:{ label:'PenEcho Auto', icon:'spark', note:['Model and effort chosen automatically', when(autoMode)].filter(Boolean).join(' · '), on:on === 'auto', fn:run('', 'auto', autoMode) }, credit:{ id:'' } }]
    : [];
  const entries = (hasPresets
    ? saved.map(x => { const mode = runMode(l, x.agent, x, draft); return { row:{ label:x.auto ? runLabel(agentInfo(x.agent), x) : presetTitle(x), av:x.agent, note:[!x.auto && presetShouldShowFacts(x) ? presetFacts(x) : '', when(mode)].filter(Boolean).join(' · '), on:x.id === on, fn:run(x.agent, x.id, mode) }, credit:{ id:x.auto ? x.agent : '' } }; })
    : runnableAgents().map(a => { const mode = runMode(l, a.id, null, draft); return { row:{ label:runLabel(a, null), av:a.id, note:when(mode), on:a.id === now, fn:run(a.id, '', mode) }, credit:a }; })
  ).sort((a, b) => compareRunMenuRow(a.row, b.row));
  const allEntries = [...autoEntries, ...entries];
  openMenu(el, [{ head:'Run with' }, ...allEntries.map(x => x.row), ...(S.thisComputer && hasPresets ? [{ sep:true }, { label:'Manage agents…', icon:'gear', fn:() => { if (typeof openAgents === 'function') openAgents(); else location.hash = 'agents'; } }] : [])], { align:'left', className:'run-menu', resolveAnchor:unsentMenuAnchor(el, target) });
  if (typeof runMenuCredits === 'function') runMenuCredits($('#menu'), allEntries.map(x => x.credit));
};
ACT['unsent-plain'] = el => { const p = project(), l = lineById(p, el.dataset.line), s = stationById(l, el.dataset.step); pasteToAgent(l, s.id, unsentAgent(p, l, s)).catch(error => toast(error.message)); };
ACT['unsent-context'] = el => { const l = lineById(project(), el.dataset.line); pasteToAgent(l, el.dataset.step, null, true).catch(error => toast(error.message)); };
// Like Run with, choosing a menu item performs it; the main button repeats the last paste for this Ask.
ACT['unsent-paste-pick'] = el => {
  const l = lineById(project(), el.dataset.line), s = stationById(l, el.dataset.step), context = pasteWithContext(l, s);
  if ($('#menu.paste-menu')) { closeMenu(); return; }
  const target = unsentTarget(el);
  openMenu(el, [{ head:'Paste' }, ...[true, false].map(withContext => ({ label:`Paste ${withContext ? 'with' : 'without'} context`, icon:'copy', on:withContext === context, fn:() => chooseUnsent(target, ({l, s}) => pasteToAgent(l, s.id, withContext ? null : unsentAgent(project(), l, s), withContext).catch(error => toast(error.message))) }))], { align:'left', resolveAnchor:unsentMenuAnchor(el, target) });
  $('#menu')?.classList.add('paste-menu');
};
ACT['unsent-files'] = el => { const l = lineById(project(), el.dataset.line); copyAskFiles(l, el.dataset.step).catch(error => toast(error.message)); };
// Edit moves it to the box, attachments and all. Sending it from there makes it an Ask again. On a line with nothing else, the box is the one that starts a new line.
ACT['unsent-edit'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step), form = $('.lp-dock .composer'); if (!s) return;
  try {
    const taken = await act(l, 'take-unsent', { step:s.id });
    delete S.handed?.[`${l.id}/${s.id}`];
    if (taken.alone || !form) {
      if (l.orchestratorRef && !HOSTED && typeof orchBoxKey === 'function') {
        const key = orchBoxKey(p);
        askIntoBox(project(), key, l, s, taken);
        if (typeof rememberBoxes === 'function') rememberBoxes();
        go({ view:'orchestrator' });
        requestAnimationFrame(() => $('#orchGoal')?.focus());
        return;
      }
      askIntoBox(project(), `home-${p.id}`, l, s, taken);
      go({ view:'home' });
      requestAnimationFrame(() => focusBox($$('.composer').find(x => x.dataset.comp === `home-${p.id}`)));
      return;
    }
    askIntoBox(project(), form.dataset.comp, l, s, taken);
    refreshAfterChange();
    focusBox($('.lp-dock .composer'));
  } catch (error) { toast(error.message); }
};
ACT['unsent-drop'] = el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  confirmDeleteNode(l, s, el, async seen => {
    const archived = l.archived;
    await act(l, 'drop-unsent', { step:s.id, seen }, p);
    delete S.handed?.[`${l.id}/${s.id}`];
    if (S.cur !== p.id) return;
    const left = lineById(project(), l.id);
    if (left && (archived || !left.closed)) { refreshAfterChange(); toast('Ask deleted'); return; }
    go({ view:archived ? 'archive' : l.orchestratorRef && !HOSTED ? 'orchestrator' : 'home' });
    if (!left) toast('Line deleted', can('restore-line') ? { label:'Undo', fn:() => restoreLine(l.id, p) } : null);
  });
};
ACT['unsent-finish'] = async el => {
  const l = lineById(project(), el.dataset.line), s = l && stationById(l, el.dataset.step);
  if (!s?.unsent || !s.canFinishUnsent || el.disabled) return;
  el.disabled = true;
  try {
    await act(l, 'finish-unsent', { step:s.id });
    delete S.handed?.[`${l.id}/${s.id}`];
    refreshAfterChange();
    toast('Marked finished & reviewed');
  } catch (error) { toast(error.message); }
  finally { el.disabled = false; }
};
// Every picture has two clear actions: click it to preview, or use the labelled button to edit. On an Ask not sent yet, what you draw becomes that picture. Once it has gone to an agent, what you draw waits in the box.
function picturePreview(p, path, name, { url = assetUrl(p, path), pending = false } = {}) {
  // penecho.ai draws no page into a picture (no browser there): a Canvas made from a page shows the page itself, sandboxed (hosted.js).
  const live = typeof hostedLivePage === 'function' ? hostedLivePage(p, path) : '';
  if (live) return `<div class="pic-preview pic-live" role="img" aria-label="${esc(name)}"><iframe sandbox="allow-scripts" tabindex="-1" aria-hidden="true" data-live-page="${esc(live)}" title="${esc(name)}"></iframe></div>`;
  return `<button type="button" class="pic-preview" ${pending ? 'disabled title="Saving attachment"' : `data-act="preview-asset" data-path="${esc(path)}"`} aria-label="Preview ${esc(name)}">${url ? `<img src="${esc(url)}" alt="${esc(name)}">` : ''}</button>`;
}
function askPictures(p, l, s) {
  const files = s.pendingFiles || s.files || [], pics = files.filter(f => f.image), others = files.filter(f => !f.image);
  return `${pics.length ? `<div class="t-pics">${pics.map(f => {
    const pending = Boolean(s.pendingFiles) || !fileEntry(p, f.path), url = s.pendingFiles ? f.url : assetUrl(p, f.path);
    return `<div class="t-pic">${picturePreview(p, f.path, f.name, { url, pending })}${l.archived || l.closed ? '' : `<button type="button" class="t-pic-edit" ${pending ? 'disabled title="Saving attachment"' : `data-act="draw-picture" data-path="${esc(f.path)}" title="Edit on canvas"`}>${ic('pen', 14)}<span>Edit on canvas</span></button>`}</div>`;
  }).join('')}</div>` : ''}${others.length ? askFiles({ files:others }, p, Boolean(s.pendingFiles)) : ''}`;
}
function drawPicture(el, beforeOpen = null) {
  const form = $('.lp-dock .composer'), waiting = el.closest('.lp-ask.is-unsent'), from = $('.pic-preview', el.closest('.t-pic, .lp-big-pic') || el) || el;
  if (form) return openDrawing(project(), form, { seed:el.dataset.path, from, ask:waiting ? { line:S.route.line, step:waiting.dataset.step, path:el.dataset.path } : null, beforeOpen });
}
ACT['draw-picture'] = el => drawPicture(el)?.catch(error => toast(error.message));
function bigPic(p, path, name, edit, preview) {
  return `<div class="lp-pic lp-big-pic"><div class="lp-draw-view">${picturePreview(p, path, name, preview)}</div><div class="lp-draw-foot"><strong title="${esc(name)}">${esc(name)}</strong>${edit}</div></div>`;
}
// A note's pictures, large and first, then its other files after its words.
function notePictures(p, l, s) {
  const files = s.pendingFiles || s.files || [], pics = files.filter(f => f.image);
  return pics.map(f => {
    const pending = Boolean(s.pendingFiles) || !fileEntry(p, f.path), url = s.pendingFiles ? f.url : assetUrl(p, f.path);
    return bigPic(p, f.path, f.name, l.archived || l.closed ? '' : `<button type="button" class="btn sm line-pic-edit" ${pending ? 'disabled title="Saving attachment"' : `data-act="draw-picture" data-path="${esc(f.path)}" title="Edit on canvas"`}>${ic('pen', 14)}<span>Edit on canvas</span></button>`, { url, pending });
  }).join('');
}
function fvScopeKeys(p, buttons) {
  const keys = [], seen = new Set();
  for (const btn of buttons) {
    const k = btn.dataset.kind, path = btn.dataset.path;
    if (!path || k === 'artifact' || k === 'line' || btn.dataset.code) continue;
    const it = typeof fvItem === 'function' ? fvItem(p, path) : null;
    if (!it || it.kind === 'artifact' || seen.has(it.key)) continue;
    seen.add(it.key);
    keys.push(it.key);
  }
  return keys;
}
function fvOpenScoped(p, path, scope) {
  const it = typeof fvItem === 'function' ? fvItem(p, path) : null;
  if (!it || it.kind === 'artifact') return false;
  if (!scope.keys.includes(it.key)) scope.keys.push(it.key);
  scope.origin = it.key;
  fvOpen(p, it.key, { scope });
  return true;
}
function pageScope(p, el) {
  const panelPics = el.closest?.('#lppResult .result-pics'), group = panelPics || el.closest?.('.lp-drawing') || el.parentElement;
  const panel = el.closest?.('#lpPanel[data-step]'), work = el.closest?.('[data-step]');
  return { kind:'pages', container:panelPics ? 'panel' : 'drawing', line:S.route.line || '', step:panel?.dataset?.step || work?.dataset?.step || '', keys:fvScopeKeys(p, group ? $$('[data-act="open-page"]', group) : [el]) };
}
// A page an agent drew is a picture on its Canvas and stays a page, one you can use. Canvases & files lists it; so does the line it came from.
const canvasPage = (p, c) => (c && p.files?.find(f => f.kind === 'page' && f.path === c.source.replace(/\.penecho\.json$/, '.explorer.html'))) || null;
const pageButton = (p, c, cls = 'btn sm line-pic-edit') => { const f = canvasPage(p, c); return f ? `<button type="button" class="${cls} line-page-open" data-act="open-page" data-path="${esc(f.path)}" title="Open the page and use it">${ic('page', 14)}<span>Open page</span></button>` : ''; };
ACT['open-page'] = el => {
  const p = project(), path = el.dataset.path;
  if (!fvOpenScoped(p, path, pageScope(p, el))) fvOpen(p, path);
};
function picButton(p, l, pic, cls) {
  const c = canvasByPath(p, pic.path);
  return `<div class="${cls}">${picturePreview(p, pic.path, pic.title)}${c ? `<button type="button" class="line-pic-edit" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(l.topicPath)}" title="Edit on canvas">${ic('pen', 14)}<span>Edit on canvas</span></button>${pageButton(p, c, 'line-pic-edit line-page-open')}` : ''}</div>`;
}
function workAsking(l, s) {
  if (!s) return null;
  if (s.asking) return s.asking;
  const a = l?.asking;
  if (a?.kind === 'tool' && (a.step ? a.step === s.id : s.asked)) return a;
  return null;
}
function workQuestions(l, s) {
  if (!s) return openQuestions(l);
  if (Array.isArray(s.questions)) return s.questions;
  const all = openQuestions(l);
  if (!all.length) return [];
  const tagged = all.filter(q => q.workId);
  if (tagged.length) return tagged.filter(q => q.workId === s.id);
  const waitWork = l.stations?.find(x => isWork(x) && x.state === 'wait');
  const target = waitWork || latestWork(l);
  return target === s ? all : [];
}
function workWaitingReply(l, s) {
  if (!s) return isWaitingReplyLine(l);
  if (typeof s.waitingReply === 'boolean') return s.waitingReply;
  const waitWork = l?.stations?.find(x => isWork(x) && x.state === 'wait');
  return Boolean(isWaitingReplyLine(l) && !openQuestions(l).length && waitWork === s);
}
function topicChooserHTML(p, l, sOrOpts = null, maybeOpts = {}) {
  const isOpts = Boolean(sOrOpts && !sOrOpts.id && ('inPanel' in sOrOpts));
  const s = isOpts ? null : sOrOpts;
  const { inPanel = false } = isOpts ? sOrOpts : (maybeOpts || {});
  if (!l || l.closed || l.archived || l.elsewhere || (typeof HOSTED !== 'undefined' && HOSTED?.read)) return '';
  const toolAsk = s ? workAsking(l, s) : l.asking;
  if (toolAsk?.kind === 'tool' && toolAsk.answerable) return '';
  const stepId = s?.id || '';
  const stepAttr = stepId ? ` data-step="${esc(stepId)}"` : '';
  const rev = (s && 'questionRev' in s ? s.questionRev : l.questionRev) || '';
  const openQs = s ? workQuestions(l, s) : openQuestions(l);
  const waitReply = s ? workWaitingReply(l, s) : isWaitingReplyLine(l);
  const drafts = (S.qDrafts && S.qDrafts[qDraftKey(l.id, '__topic__', rev, p.id, stepId)]) || {};
  const draftNote = typeof drafts.__note === 'string' ? drafts.__note : '';
  const stop = !inPanel && canStop(l) ? `<button type="button" class="btn sm q-stop" data-act="line-do" data-verb="stop" data-line="${esc(l.id)}">${ic('stop', 14)}Stop</button>` : '';
  if (openQs.length) {
    const line = esc(l.id);
    const who = openQs[0].from || s?.agent || l.runAgent || l.agent || 'agent';
    const blocks = openQs.map(q => {
      const qid = esc(q.id);
      const picked = typeof drafts[q.id] === 'string' ? drafts[q.id] : '';
      return `<div class="q-block q-qblock" data-q-block="${qid}"><p>${inlineSay(q.text)}</p>${q.options.length ? `<div class="q-opts is-choice-list" role="group" aria-label="${esc(q.text)}">${q.options.map(o => {
        const on = picked === o;
        return `<button type="button" class="btn sm q-opt q-choice${on ? ' is-picked' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-act="pick-q-opt" data-line="${line}"${stepAttr} data-q="${qid}" data-a="${esc(o)}"><span class="q-opt-dot" aria-hidden="true">${on ? ic('check', 12) : ''}</span><span class="q-opt-label">${inlineSay(o)}</span></button>`;
      }).join('')}</div>` : ''}</div>`;
    }).join('');
    const targetQ = esc(openQs.length === 1 ? openQs[0].id : '__topic__');
    const goWord = (waitReply || isWaitingReplyLine(l)) && openQs.length === 1 ? 'Continue' : 'Reply';
    return `<article class="q-card is-topic-q${openQs.length > 1 ? ' is-multi-q' : ''}${inPanel ? ' is-panel-q' : ''}" data-project="${esc(p.id)}"${stepAttr} data-question-rev="${esc(rev)}" data-q-card="${openQs.length === 1 ? esc(openQs[0].id) : 'topic'}"><div class="q-from">${av(who, 22)}<span>${esc(agentInfo(who).name)} is asking you</span>${stop}</div>${blocks}<div class="q-custom"><input type="text" class="q-input" data-q-kind="topic" data-line="${line}"${stepAttr} data-q="${targetQ}" value="${esc(draftNote)}" placeholder="Add optional feedback, or type your own reply…" aria-label="Reply or optional feedback"><button type="button" class="btn sm primary q-go-btn" data-act="submit-q-topic" data-line="${line}"${stepAttr} data-q="${targetQ}">${goWord} ↵</button></div></article>`;
  }
  if (!waitReply) return '';
  const waitWork = s || l.stations?.find(x => isWork(x) && x.state === 'wait');
  const who = s?.agent || l.asking?.agent || waitWork?.agent || l.runAgent || l.agent || 'agent';
  const prompt = s?.why || waitingWhyOf(l) || s?.out || l.asking?.questions?.[0]?.text || 'Needs your reply to continue.';
  const line = esc(l.id);
  return `<article class="q-card is-waiting-reply${inPanel ? ' is-panel-q' : ''}" data-project="${esc(p.id)}"${stepAttr} data-question-rev="${esc(rev)}" data-q-card="__waiting__"><div class="q-from">${av(who, 22)}<span>${esc(agentInfo(who).name)} is waiting for you</span>${stop}</div><p>${inlineSay(prompt)}</p><div class="q-custom"><input type="text" class="q-input" data-q-kind="waiting" data-line="${line}"${stepAttr} data-q="__waiting__" value="${esc(draftNote)}" placeholder="Type your reply to continue…" aria-label="Reply to continue"><button type="button" class="btn sm primary q-go-btn" data-act="submit-q-topic" data-line="${line}"${stepAttr} data-q="__waiting__">Continue ↵</button></div></article>`;
}
function questionsHTML(p, l) {
  return '';
}
// Where you answer: local actionable Work options/prompts first, then the agent's own app when a click can open it, else the command that opens it, else the job detail chooser.
function answerAct(l, cls = 'btn sm primary', a = l.asking, explicit = false) {
  const line = esc(l.id);
  const canChooseLocal = Boolean(l && !l.closed && !l.archived && !l.elsewhere && !(typeof HOSTED !== 'undefined' && HOSTED?.read));
  const localWork = !explicit
    ? (l.stations?.find(s => isWork(s) && ((s.asking?.kind === 'tool' && s.asking.answerable && s.asking.isBlocking !== false) || (canChooseLocal && s.questions?.length)))
      || (canChooseLocal ? l.stations?.find(s => isWork(s) && s.waitingReply) : null))
    : null;
  if (localWork) return `<button type="button" class="${cls}" data-act="need-reply" data-line="${line}" data-step="${esc(localWork.id)}">Answer</button>`;
  const chat = a?.kind === 'tool' ? l.conversations?.[a.agent] || l.conversation : null;
  const stepAttr = a?.step ? ` data-step="${esc(a.step)}"` : '';
  if (a?.kind === 'tool' && a.answerable) return `<button type="button" class="${cls}" data-act="need-reply" data-line="${line}"${stepAttr}>Answer</button>`;
  if (chat?.canOpen || chat?.opensApp) return `<button type="button" class="${cls}" data-act="open-desktop" data-line="${line}" data-agent="${esc(a.agent)}">Answer in ${esc(chat.app || agentInfo(a.agent).name)}${ic('arrow', 13)}</button>`;
  if (chat?.terminal) return `<button type="button" class="${cls}" data-act="copy-command" data-command="${esc(chat.terminalFull || chat.terminal)}" title="Copy the command">Answer in ${esc(chat.terminal)}${ic('copy', 13)}</button>`;
  return `<button type="button" class="${cls}" data-act="need-reply" data-line="${line}"${stepAttr}>Answer</button>`;
}
// Interactive question card for live answerable CLI tool prompts; read-only choices + external link for unowned followed runs.
function askedHTML(l, s = null) {
  const a = s ? workAsking(l, s) : l.asking;
  if (!a) return '';
  const ownerStep = a.step || s?.id || '';
  if (a.kind === 'tool' && a.answerable) {
    const line = esc(l.id), req = esc(a.id || ''), step = esc(ownerStep), launch = esc(a.launchId || '');
    const qs = Array.isArray(a.questions) ? a.questions : [];
    const drafts = (S.qDrafts && S.qDrafts[qDraftKey(l.id, a.id || '', '', project()?.id, ownerStep)]) || {};
    if (a.approval || a.requestType === 'approval') {
      const toolLabel = esc(a.toolName || 'Tool');
      const inputBlock = a.toolInput ? `<pre class="q-tool-input"><code>${esc(a.toolInput)}</code></pre>` : '';
      return `<article class="q-card lpp-asked is-answerable is-approval" data-req-card="${req}"${step ? ` data-step="${step}"` : ''}><div class="q-from">${av(a.agent, 22)}<span>${esc(agentInfo(a.agent).name)} wants permission to use ${toolLabel}</span></div>${inputBlock}<div class="q-opts"><button type="button" class="btn sm primary" data-act="answer-tool" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${esc(qs[0]?.id || 'approve')}" data-a="allow">Allow</button><button type="button" class="btn sm" data-act="answer-tool" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${esc(qs[0]?.id || 'approve')}" data-a="deny">Deny</button></div></article>`;
    }
    const isMultiQ = qs.length > 1;
    const blocks = qs.map((q, qi) => {
      const rawQid = q.id || q.text || `q-${qi + 1}`;
      const qid = esc(rawQid);
      const opts = Array.isArray(q.options) ? q.options : [];
      const vals = Array.isArray(q.optionValues) ? q.optionValues : null;
      const optVal = (o, oi) => (vals && vals[oi] !== undefined ? String(vals[oi]) : (typeof o === 'string' ? o : String(o?.value ?? o?.label ?? '')));
      const optLabel = o => (typeof o === 'string' ? o : String(o?.label ?? o?.value ?? ''));
      const inputType = q.isSecret ? 'password' : 'text';
      const inputAttr = q.isSecret ? ' autocomplete="off"' : '';
      const savedDraft = q.isSecret ? '' : (drafts[rawQid] || '');
      let body = '';
      if (q.multiSelect && opts.length) {
        const pickedSet = new Set(Array.isArray(savedDraft) ? savedDraft : []);
        body = `<div class="q-checks" data-q-multi="${qid}">${opts.map((o, oi) => {
          const label = optLabel(o), val = optVal(o, oi);
          return `<label class="q-check"><input type="checkbox" value="${esc(val)}"${pickedSet.has(val) ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        }).join('')}${isMultiQ ? '' : `<div class="q-multi-go"><button type="button" class="btn sm primary" data-act="answer-tool-multi" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${qid}">Submit</button></div>`}</div>`;
      } else if (opts.length) {
        const picked = typeof savedDraft === 'string' ? savedDraft : '';
        body = `<div class="q-opts">${opts.map((o, oi) => {
          const label = optLabel(o), val = optVal(o, oi);
          if (isMultiQ) {
            const on = picked === val;
            return `<button type="button" class="btn sm q-opt${on ? ' is-picked' : ''}" aria-pressed="${on}" data-act="pick-tool-opt" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${qid}" data-a="${esc(val)}">${esc(label)}</button>`;
          }
          return `<button type="button" class="btn sm" data-act="answer-tool" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${qid}" data-a="${esc(val)}">${esc(label)}</button>`;
        }).join('')}</div>`;
      }
      const perQInput = isMultiQ
        ? `<div class="q-custom"><input type="${inputType}"${inputAttr} class="q-input" data-q-kind="tool-multi" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${qid}" value="${esc(typeof savedDraft === 'string' && !opts.some((o, oi) => optVal(o, oi) === savedDraft) ? savedDraft : '')}" placeholder="${q.isSecret ? 'Enter secret reply' : 'Or type a reply'}" aria-label="Reply for ${esc(q.text)}"></div>`
        : '';
      return `<div class="q-block" data-q-block="${qid}" data-q-multi-select="${q.multiSelect ? '1' : '0'}"${q.isSecret ? ' data-q-secret="1"' : ''}><p>${esc(q.text)}</p>${body}${perQInput}</div>`;
    }).join('');
    if (isMultiQ) {
      return `<article class="q-card lpp-asked is-answerable is-multi-q" data-req-card="${req}"${step ? ` data-step="${step}"` : ''}><div class="q-from">${av(a.agent, 22)}<span>${esc(agentInfo(a.agent).name)} is asking you</span></div>${blocks}<div class="q-multi-go"><button type="button" class="btn sm primary" data-act="answer-tool-all" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}">Submit answers</button></div></article>`;
    }
    const firstQ = qs[0] || {};
    const firstQid = esc(firstQ.id || firstQ.text || '');
    const firstType = firstQ.isSecret ? 'password' : 'text';
    const firstAttr = firstQ.isSecret ? ' autocomplete="off"' : '';
    const firstDraft = firstQ.isSecret ? '' : (typeof drafts[firstQ.id || firstQ.text || ''] === 'string' ? drafts[firstQ.id || firstQ.text || ''] : '');
    return `<article class="q-card lpp-asked is-answerable" data-req-card="${req}"${step ? ` data-step="${step}"` : ''}><div class="q-from">${av(a.agent, 22)}<span>${esc(agentInfo(a.agent).name)} is asking you</span></div>${blocks}<div class="q-custom"><input type="${firstType}"${firstAttr} class="q-input" data-q-kind="tool" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${firstQid}" value="${esc(firstDraft)}" placeholder="${firstQ.isSecret ? 'Enter secret reply ↵' : 'Or type a reply &amp; Steer ↵'}" aria-label="Custom reply"><button type="button" class="btn sm primary" data-act="answer-tool-custom" data-line="${line}" data-req="${req}" data-step="${step}" data-launch="${launch}" data-q="${firstQid}">Steer ↵</button></div></article>`;
  }
  return `<article class="q-card lpp-asked"${ownerStep ? ` data-step="${esc(ownerStep)}"` : ''}><div class="q-from">${av(a.agent, 22)}<span>${esc(agentInfo(a.agent).name)} is asking you</span></div>${a.questions.map(q => `<p>${esc(q.text)}</p>${q.options.length ? `<ul class="q-choices">${q.options.map(o => `<li>${esc(typeof o === 'string' ? o : o?.label || '')}</li>`).join('')}</ul>` : ''}`).join('')}<div class="lp-go">${answerAct(l, 'btn sm primary', a, true)}</div></article>`;
}
function workWords(l, s) {
  if (s.asked) return s.why;
  if (s.state === 'active') return s.now || 'Working';
  if (s.state === 'error') return (s.stopWhy === 'limit' && stopWhyWords(s)) || s.why || s.out || 'Stopped';
  if (s.state === 'wait') return s.out || s.why || '';
  if (s.state === 'todo') return '';
  if (s.state === 'off') return s.stopWhy && s.off !== 'discarded' ? stopWhyWords(s) : offText(s);
  return s.out || 'Done';
}
const reviewSay = s => s.reviewed ? 'Reviewed. Click to mark as not reviewed' : 'Mark as reviewed';
function reviewMark(l, s) {
  if (!canReview(s)) return '';
  return `<button type="button" class="lp-mark" role="checkbox" aria-checked="${s.reviewed}" aria-label="${reviewSay(s)}" title="${reviewSay(s)}" data-act="work-reviewed" data-line="${esc(l.id)}" data-step="${esc(s.id)}"><span class="lp-tick">${ic('check', 11)}</span><span class="lp-word">Reviewed</span></button>`;
}
// The server takes a rating only for a Work that finished or was stopped; a failed run still on its line can be resumed.
const isReviewWork = s => s.kind === 'review' || s.isReview;
const isOrchReview = s => Boolean(s && (s.kind === 'orch-review' || s.isOrchReview));
const reviewStepId = id => (typeof orchReviewStepId === 'function' ? orchReviewStepId(id) : `${id}--review`);
function reviewAgentOf(info) {
  if (info?.agent) return info.agent;
  const by = String(info?.by || '').trim();
  if (!by) return '';
  if (typeof S === 'object' && Array.isArray(S?.presets?.presets)) {
    const preset = S.presets.presets.find(p => (info.presetId && p.id === info.presetId) || p.name === by);
    if (preset?.agent) return preset.agent;
  }
  if (typeof AGENTS === 'object' && AGENTS) {
    const match = Object.values(AGENTS)
      .filter(a => a && a.id && a.id !== 'you' && a.name)
      .sort((a, b) => b.name.length - a.name.length)
      .find(a => by === a.name || by.startsWith(`${a.name} ·`) || by.startsWith(`${a.name} `));
    if (match) return match.id;
  }
  return '';
}
function makeOrchReviewStation(l, s) {
  if (!s || !isWork(s) || isReviewWork(s) || !(s.reviewing || (s.reviewStopped && typeof s.reviewStopped === 'object') || (s.review && typeof s.review === 'object'))) return null;
  if (typeof orchReviewStation === 'function') {
    const built = orchReviewStation(l, s);
    if (built) { if (!built.agent) built.agent = reviewAgentOf(built.review || built.reviewPending || built.reviewStopped); return built; }
  }
  const pending = s.reviewing && s.reviewPending && typeof s.reviewPending === 'object' ? s.reviewPending : null;
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const r = !s.reviewing && !stopped && s.review && typeof s.review === 'object' ? s.review : null;
  const info = r || pending || stopped || {};
  const unexpected = Boolean(stopped && stopped.stopWhy !== 'stopped');
  const state = s.reviewing ? 'active' : stopped ? (unexpected ? 'error' : 'off') : 'done';
  return {
    id:reviewStepId(s.id),
    index:s.index,
    kind:'orch-review',
    isOrchReview:true,
    workId:s.id,
    workLabel:typeof stepLabel === 'function' ? stepLabel(s) : (s.label || 'Work'),
    workAgent:s.agent || '',
    workTook:s.took || '',
    label:'Orchestrator review',
    state,
    ...(stopped && !unexpected ? { off:'stopped' } : {}),
    ...(stopped?.stopWhy ? { stopWhy:stopped.stopWhy } : {}),
    ...(stopped?.reason ? { why:stopped.reason } : {}),
    ...(stopped?.resetsAt ? { resetsAt:stopped.resetsAt } : {}),
    ...(stopped?.canContinue ? { canContinue:true } : {}),
    reviewing:Boolean(s.reviewing),
    review:r,
    reviewPending:pending,
    reviewStopped:stopped,
    agent:reviewAgentOf(info),
    took:r?.took || '',
    when:r?.at || stopped?.stoppedAt || pending?.startedAt || '',
    out:r ? (reviewNoteOf(r) || (r.verdict === 'unverified' ? 'Unverified' : r.score ? `${r.score}/5` : '')) : stopped ? (stopped.reason || 'Stopped') : 'Reviewing…',
    text:'',
    files:[],
    pictures:[],
    refers:[],
    detail:'',
  };
}
function lineStation(l, id) {
  if (!l || !id) return null;
  const direct = typeof stationById === 'function' ? stationById(l, id) : l.stations?.find(s => s.id === id);
  if (direct) {
    if (isOrchReview(direct) && !direct.agent) direct.agent = reviewAgentOf(direct.review || direct.reviewPending || direct.reviewStopped);
    return direct;
  }
  const m = /^(.+)--review$/.exec(String(id));
  if (!m) return null;
  const work = l.stations?.find(s => s.id === m[1]);
  return work ? makeOrchReviewStation(l, work) : null;
}
function threadStations(l) {
  const existing = new Set((l?.stations || []).filter(isOrchReview).map(s => s.id));
  const out = [];
  for (const s of l?.stations || []) {
    if (isOrchReview(s)) {
      if (!s.agent) s.agent = reviewAgentOf(s.review || s.reviewPending || s.reviewStopped);
      out.push(s);
      continue;
    }
    out.push(s);
    if (!existing.has(reviewStepId(s.id))) {
      const rv = makeOrchReviewStation(l, s);
      if (rv) out.push(rv);
    }
  }
  return out;
}
const canRate = s => isWork(s) && !s.unsent && !isReviewWork(s) && !isOrchReview(s) && (s.state === 'done' || s.state === 'off');
function ratingBadge(s) {
  if (isReviewWork(s) || isOrchReview(s) || (s.rating !== 'good' && s.rating !== 'bad')) return '';
  const good = s.rating === 'good';
  const tip = s.ratingNote ? `${good ? 'Good' : 'Not good'}: ${s.ratingNote}` : good ? 'Rated good' : 'Rated not good';
  return `<span class="lp-rate-badge is-${esc(s.rating)}" title="${esc(tip)}" aria-label="${esc(tip)}">${ic(good ? 'thumbUp' : 'thumbDown', 12)}</span>`;
}
function orchRatingBadge(s) {
  const score = Number(s.orchScore);
  if (isReviewWork(s) || isOrchReview(s) || !(score >= 1 && score <= 5)) return '';
  const label = s.review ? `Orchestrator review: ${score}/5` : `Orchestrator: ${score}/5`;
  const by = s.review ? reviewBySummary(s.review) : '';
  const tip = by ? `${label} by ${by}${s.orchNote ? ` — ${s.orchNote}` : ''}` : s.orchNote ? `${label}: ${s.orchNote}` : label;
  return `<span class="lp-orch-badge" title="${esc(tip)}" aria-label="${esc(tip)}">${ic('orchestrate', 12)}<span>${score}/5</span></span>`;
}
const reviewModeLabel = info => info?.mode === 'user' ? 'User assigned' : info?.mode === 'auto' ? 'Auto reviewer' : '';
const reviewModeShort = info => info?.mode === 'user' ? 'Assigned' : info?.mode === 'auto' ? 'Auto' : '';
function reviewSpecsOf(info) {
  if (!info || typeof info !== 'object') return { model:'', effort:'' };
  let model = String(info.model || '').trim();
  let effort = String(info.effort || '').trim();
  if ((!model || !effort) && typeof S === 'object' && Array.isArray(S?.presets?.presets)) {
    const preset = (info.presetId && S.presets.presets.find(p => p && p.id === info.presetId && (!info.agent || p.agent === info.agent))) || null;
    if (preset) {
      if (!model) model = String(preset.model || preset.effectiveModel || '').trim();
      if (!effort) effort = String(preset.effort || preset.effectiveEffort || '').trim();
    }
  }
  return { model, effort };
}
function reviewExtraSpecsOf(info, by = String(info?.by || '').trim()) {
  const { model, effort } = reviewSpecsOf(info);
  const lowBy = by.toLowerCase();
  const hasModel = Boolean(model && lowBy.includes(model.toLowerCase()));
  const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasEffort = Boolean(effort && new RegExp(`(?:^|[·\\s(])${escRe(effort)}\\s+effort(?:$|[·\\s)])`, 'i').test(by));
  return { model:hasModel ? '' : model, effort:hasEffort ? '' : effort };
}
function reviewSpecsHTML(specs, cls = 'rv-agent-specs') {
  if (!specs?.model && !specs?.effort) return '';
  return `<span class="${cls}">${specs.model ? `<code>${esc(specs.model)}</code>` : ''}${specs.model && specs.effort ? ' · ' : ''}${specs.effort ? `${esc(specs.effort)} effort` : ''}</span>`;
}
function reviewBySummary(info) {
  const by = String(info?.by || '').trim();
  const extra = reviewExtraSpecsOf(info, by);
  return [by, extra.model, extra.effort ? `${extra.effort} effort` : ''].filter(Boolean).join(' · ');
}
function reviewWhyText(info) {
  const why = String(info?.why || '').trim();
  if (why) return why;
  if (info?.mode === 'user') return 'Assigned by you in Orchestrator settings (Reviewer).';
  if (info?.mode === 'auto') return 'Auto-picked by the Orchestrator from available reviewers that did not do this work.';
  return info?.by ? 'Selected by the Orchestrator as an independent reviewer (selection reason was not recorded for this earlier review).' : '';
}
function reviewStopMeta(s) {
  const info = (!s.reviewing && !s.reviewStopped && s.review) || s.reviewPending || s.reviewStopped || {};
  const mode = reviewModeShort(info);
  if (mode) return mode;
  return info.by ? info.by.split(' · ')[0] : 'Orchestrator';
}
const canControlReview = l => Boolean(!HOSTED && l && !l.archived && !l.closed);
function reviewStopButtonHTML(l, workId, cls = 'btn sm') {
  if (!canControlReview(l) || !workId) return '';
  return `<button type="button" class="${cls} lp-rv-stop" data-act="review-stop" data-line="${esc(l.id)}" data-work="${esc(workId)}" title="Stop this review">${ic('stop', 14)}Stop</button>`;
}
function reviewContinueButtonHTML(l, s, cls = 'btn sm primary') {
  const stopped = s?.reviewStopped;
  const allow = typeof can === 'function' ? can('continue-work') : true;
  if (!canControlReview(l) || !stopped || !allow || !(s.canContinue || stopped.canContinue)) return '';
  const workId = isOrchReview(s) ? s.workId : s.id;
  return `<button type="button" class="${cls} lp-continue" data-act="review-continue" data-line="${esc(l.id)}" data-work="${esc(workId)}" title="Continue this review from where it stopped">${ic('play', 14)}Continue</button>`;
}
function reviewResendButtonHTML(p, l, s, cls = 'btn sm', { picker = true, force = false, label = 'Send again', title = 'Start this review again from scratch' } = {}) {
  const stopped = s?.reviewStopped;
  if (!canControlReview(l) || (!force && !stopped)) return '';
  const workId = isOrchReview(s) ? s.workId : s.id;
  const workSt = isOrchReview(s) ? (l.stations?.find(x => x.id === workId) || null) : s;
  const info = picker && p && workSt ? workReviewCandidates(p, workSt) : null;
  const hasPicker = Boolean(info && info.eligible.length > 0);
  const main = `<button type="button" class="${cls} lp-resend" data-act="review-resend" data-line="${esc(l.id)}" data-work="${esc(workId)}" title="${esc(title)}">${ic('send', 14)}${esc(label)}</button>`;
  if (!hasPicker) return main;
  return `<span class="rv-resend-split">${main}<button type="button" class="${cls} rv-resend-pick" data-act="review-resend-pick" data-line="${esc(l.id)}" data-work="${esc(workId)}" aria-haspopup="menu" aria-label="Choose reviewer to re-review" title="Choose reviewer">${ic('down', 13)}</button></span>`;
}
function reviewStopHeadline(s, stopped) {
  const target = { state:stopped?.stopWhy === 'stopped' ? 'off' : 'error', off:stopped?.stopWhy === 'stopped' ? 'stopped' : '', stopWhy:stopped?.stopWhy || 'error', resetsAt:stopped?.resetsAt || 0 };
  const words = typeof stopWhyWords === 'function' ? stopWhyWords(target) : '';
  return words || (stopped?.stopWhy === 'stopped' ? 'You stopped it' : stopped?.stopWhy === 'limit' ? 'Stopped: hit its usage limit' : 'Stopped with an error');
}
function reviewStopRawReason(stopped, headline) {
  const raw = String(stopped?.reason || '').trim();
  if (!raw || raw === headline || stopped?.stopWhy === 'stopped') return '';
  if (stopped?.stopWhy === 'limit' && headline) return '';
  return raw;
}
function orchRateCardHTML(s, l = null) {
  if (isReviewWork(s) || isOrchReview(s)) return '';
  const lineId = l?.id || (typeof S === 'object' ? S?.route?.line : '') || '';
  const hasReview = Boolean(s.review && typeof s.review === 'object');
  if (s.reviewing) {
    const pending = s.reviewPending && typeof s.reviewPending === 'object' ? s.reviewPending : null;
    const mode = reviewModeLabel(pending);
    const byText = reviewBySummary(pending);
    const stopBtn = l ? reviewStopButtonHTML(l, s.id) : '';
    const openBtn = lineId ? `<button type="button" class="btn sm lpp-orch-open" data-act="line-work" data-line="${esc(lineId)}" data-step="${esc(reviewStepId(s.id))}">View review</button>` : '';
    return `<section class="lpp-orch-rate is-reviewing" aria-label="Orchestrator review">
      <div class="lpp-orch-rate-head"><span class="lpp-orch-rate-label">${ic('orchestrate', 14)}<span>Orchestrator review</span></span>${mode ? `<span class="rv-mode is-${esc(pending.mode)}">${esc(mode)}</span>` : ''}<span class="lpp-orch-wait"><i class="spin" aria-hidden="true"></i>Reviewing…</span></div>
      ${byText || pending?.why ? `<p class="lpp-orch-note">${byText ? `<strong>${esc(byText)}</strong>` : ''}${byText && pending?.why ? ' — ' : ''}${pending?.why ? esc(pending.why) : ''}</p>` : ''}
      ${stopBtn || openBtn ? `<div class="lpp-orch-foot">${stopBtn}${openBtn}</div>` : ''}
    </section>`;
  }
  if (s.reviewStopped && typeof s.reviewStopped === 'object') {
    const stopped = s.reviewStopped;
    const mode = reviewModeLabel(stopped);
    const unexpected = stopped.stopWhy !== 'stopped';
    const headline = reviewStopHeadline(s, stopped);
    const raw = reviewStopRawReason(stopped, headline);
    const contBtn = l ? reviewContinueButtonHTML(l, s) : '';
    const resendBtn = l ? reviewResendButtonHTML(typeof project === 'function' ? project() : null, l, s) : '';
    const openBtn = lineId ? `<button type="button" class="btn sm lpp-orch-open" data-act="line-work" data-line="${esc(lineId)}" data-step="${esc(reviewStepId(s.id))}">View review</button>` : '';
    return `<section class="lpp-orch-rate ${unexpected ? 'is-stopped' : 'is-off'}" aria-label="Orchestrator review">
      <div class="lpp-orch-rate-head"><span class="lpp-orch-rate-label">${ic('orchestrate', 14)}<span>Orchestrator review</span></span>${mode ? `<span class="rv-mode is-${esc(stopped.mode)}">${esc(mode)}</span>` : ''}<span class="${unexpected ? 'rv-status-error' : 'rv-status-off'}">${esc(unexpected ? 'Stopped' : 'Stopped by you')}</span></div>
      <p class="lpp-orch-note"><strong>${esc(headline)}</strong>${raw ? ` — ${esc(raw)}` : ''}</p>
      ${contBtn || resendBtn || openBtn ? `<div class="lpp-orch-foot">${contBtn}${resendBtn}${openBtn}</div>` : ''}
    </section>`;
  }
  const score = Number(s.orchScore);
  const hasScore = score >= 1 && score <= 5;
  const r = hasReview ? s.review : null;
  if (!hasScore && !(r && (r.verdict === 'unverified' || r.ignored))) return '';
  const mode = r ? reviewModeLabel(r) : '';
  const verdict = r ? reviewVerdictOf(r) : '';
  const headBadge = r?.ignored
    ? '<span class="rv-ignored-badge">Ignored in stats</span>'
    : verdict === 'unverified'
      ? '<strong class="rv-score v-unverified">Unverified</strong>'
      : verdict
        ? `<strong class="lpp-orch-rate-score">${esc(reviewHeadlineOf(r).text)}</strong>`
        : `<strong class="lpp-orch-rate-score">${score}/5</strong>`;
  const byText = r ? (reviewBySummary(r) || s.orchBy) : s.orchBy;
  const noteText = s.orchNote || (r ? reviewNoteOf(r) : '');
  const openBtn = hasReview && lineId ? `<button type="button" class="btn sm lpp-orch-open" data-act="line-work" data-line="${esc(lineId)}" data-step="${esc(reviewStepId(s.id))}">View review details</button>` : '';
  return `<section class="lpp-orch-rate${r?.ignored ? ' is-off' : ''}" aria-label="${hasReview ? 'Orchestrator review' : 'Orchestrator rating'}">
    <div class="lpp-orch-rate-head"><span class="lpp-orch-rate-label">${ic('orchestrate', 14)}<span>${hasReview ? 'Orchestrator review' : 'Orchestrator rating'}</span></span>${mode ? `<span class="rv-mode is-${esc(r.mode)}">${esc(mode)}</span>` : ''}${headBadge}${byText ? `<span class="lpp-orch-by">${esc(byText)}</span>` : ''}</div>
    ${r?.why ? `<p class="lpp-orch-why">${esc(r.why)}</p>` : ''}
    ${noteText ? `<p class="lpp-orch-note">${esc(noteText)}</p>` : ''}
    ${openBtn ? `<div class="lpp-orch-foot">${openBtn}</div>` : ''}
  </section>`;
}
// ---------- On-demand Work review button (Quiet Split beside Refer) ----------
const WORK_REVIEW_PICK = new Map();
const workReviewKey = (p, l, s) => `${p?.id || ''}\0${l?.id || ''}\0${s?.id || ''}`;
const canManualReview = (l, s) => Boolean(!HOSTED && l && !l.archived && !l.closed && s && isWork(s) && !isReviewWork(s) && !isOrchReview(s) && !s.unsent && s.state === 'done');
function workReviewModelOf(raw) {
  const m = String(raw || '').trim().toLowerCase();
  if (!m || m === 'default' || m === 'auto') return '';
  return m;
}
function sameReviewerAsWork(r, s) {
  if (!r || !s) return false;
  if (r.id && s.savedAgentId && r.id === s.savedAgentId) return true;
  const agent = String(r.agent || '').trim();
  if (!agent || !s.agent) return false;
  const mine = workReviewModelOf(r.model);
  const theirs = workReviewModelOf(s.model || s.selected?.model || s.picked?.model || '');
  if (!mine || !theirs) return agent === s.agent;
  if (mine === theirs) return true;
  if (agent === s.agent) {
    const aliasOf = (short, full) => /^[a-z0-9]{3,}$/.test(short) && (full.includes(`-${short}-`) || full.endsWith(`-${short}`) || full.startsWith(`${short}-`));
    if (aliasOf(mine, theirs) || aliasOf(theirs, mine)) return true;
  }
  return false;
}
function workReviewCandidates(p, s) {
  if (typeof orchSettings !== 'function') return null;
  const set = orchSettings(p);
  if (!set || !Array.isArray(set.reviewers)) return null;
  const presets = Array.isArray(S?.presets?.presets) ? S.presets.presets : [];
  const all = set.reviewers.filter(r => r && r.id).map(r => {
    const preset = presets.find(x => x.id === r.id);
    return {
      id:r.id,
      name:r.name || preset?.name || r.id,
      agent:r.agent || preset?.agent || '',
      model:r.model || preset?.model || preset?.effectiveModel || '',
      effort:r.effort || preset?.effort || preset?.effectiveEffort || '',
    };
  });
  const eligible = all.filter(r => !sameReviewerAsWork(r, s));
  const defaultId = set.reviewer && set.reviewer !== 'auto' ? set.reviewer : 'auto';
  return { set, defaultId, eligible };
}
function workReviewSelected(p, l, s, info) {
  const savedPick = WORK_REVIEW_PICK.get(workReviewKey(p, l, s));
  const defaultPick = info.defaultId !== 'auto' && info.eligible.some(r => r.id === info.defaultId) ? info.defaultId : 'auto';
  const id = savedPick && (savedPick === 'auto' || info.eligible.some(r => r.id === savedPick)) ? savedPick : defaultPick;
  if (id === 'auto') return { id:'auto', name:'PenEcho Auto', auto:true };
  return info.eligible.find(r => r.id === id) || { id:'auto', name:'PenEcho Auto', auto:true };
}
function workReviewButtonHTML(p, l, s) {
  if (!canManualReview(l, s) || typeof orchSettings !== 'function') return '';
  const info = workReviewCandidates(p, s);
  if (!info) {
    if (typeof loadOrchSettings === 'function' && typeof ORCHSET === 'object' && !ORCHSET.missing && !ORCHSET.loading) {
      queueMicrotask(() => loadOrchSettings(p));
    }
    return '';
  }
  if (!info.eligible.length) return '';
  const selected = workReviewSelected(p, l, s, info);
  const busy = Boolean(s.reviewing);
  const done = !busy && Boolean(s.review && typeof s.review === 'object');
  const label = stepLabel(s);
  const targetName = busy ? (s.reviewPending?.by || selected.name) : selected.name;
  const icon = busy ? '<span class="spin" aria-hidden="true"></span>' : selected.auto ? ic('orchestrate', 14) : ic('eye', 13.5);
  const verb = busy ? 'Reviewing with' : done ? 'Review again ·' : 'Review with';
  const tip = busy
    ? `Reviewing ${label} with ${targetName} — click to open review`
    : done
      ? `Run another review of ${label} with ${selected.name}`
      : `Ask ${selected.name} to review ${label}`;
  return `<span class="rev-split${busy ? ' is-busy' : done ? ' is-done' : ''}" data-rev-split="${esc(s.id)}">
    <button type="button" class="rev-main" data-act="work-review" data-line="${esc(l.id)}" data-step="${esc(s.id)}" data-reviewer="${esc(selected.id)}" title="${esc(tip)}">
      <span class="rev-ic" aria-hidden="true">${icon}</span>
      <span class="rev-text"><span class="rev-verb">${verb}</span> <span class="rev-target">${esc(targetName)}</span></span>
    </button>
    <button type="button" class="rev-pick" data-act="work-review-pick" data-line="${esc(l.id)}" data-step="${esc(s.id)}" aria-haspopup="menu" aria-label="Choose reviewer" title="Choose reviewer"${busy ? ' disabled' : ''}>${ic('down', 13)}</button>
  </span>`;
}
// ---------- The Orchestrator's reviewer node and right-panel detail ----------
// PenEcho draws it in a separate node from the Work so the reviewer never looks like the Work agent reviewing itself.
// Every word in it comes from the server: escaped.
const REVIEW_WORD = { 5:'Complete and verified', 4:'Minor gaps', 3:'Needs rework', 2:'Seriously flawed', 1:'Unusable' };
const REVIEW_VERDICT = {
  ready:{ label:'Ready', cls:'v-ready', step:5 },
  caveats:{ label:'Check caveats', cls:'v-caveats', step:4 },
  fix:{ label:'Fix needed', cls:'v-fix', step:2 },
  unverified:{ label:'Unverified', cls:'v-unverified', step:0 },
};
const REVIEW_STATES = new Set(['done', 'partly', 'missed', 'extra']);
const REVIEW_BARS = [
  ['asked', 'Asked', 'All requirements and limits satisfied'],
  ['proven', 'Proven', 'Verified with tests, checks, or sources'],
  ['safe', 'Safe', 'Only what the job needed was touched'],
  ['report', 'Report', 'Final report matches actual changes'],
];
const REVIEW_BARS_V2 = [
  ['outcome', 'Outcome', 'Finished what was asked, accurately and well (60%)'],
  ['verification', 'Verification', 'Backed by real tests, checks, or inspected evidence (20%)'],
  ['safety', 'Safety & Scope', 'No regressions, broken limits, or unintended breakage (20%)'],
];
const REVIEW_FINDING_LABEL = { bug:'Bug', gap:'Gap', risk:'Risk', unverified:'Unverified' };
// A score is 1 to 5 to one decimal. Its words are the nearest step's; 5 is kept for 4.8 and over, so 4.5 still reads as minor gaps.
const reviewScoreOf = value => { const n = Number(value); return value != null && value !== '' && n >= 1 && n <= 5 ? Math.round(n * 10) / 10 : null; };
const reviewStep = n => (n == null ? 0 : n >= 4.8 ? 5 : Math.min(4, Math.round(n)));
const reviewVerdictOf = r => { const v = String(r?.verdict || '').trim().toLowerCase(); return Object.hasOwn(REVIEW_VERDICT, v) ? v : ''; };
const reviewIsV2 = r => Boolean(r && typeof r === 'object' && (r.schema === 2 || 'verdict' in r || 'outcome' in r || 'verification' in r || 'safety' in r));
function reviewHeadlineOf(r) {
  const verdict = reviewVerdictOf(r);
  const score = reviewScoreOf(r?.score);
  if (verdict) {
    if (verdict === 'unverified') return { text:'Unverified', cls:'v-unverified', verdict:'unverified', score:null };
    const info = REVIEW_VERDICT[verdict];
    return { text:score != null ? `${info.label} · ${score}/5` : info.label, cls:info.cls, verdict, score };
  }
  const word = REVIEW_WORD[reviewStep(score)];
  return { text:word ? `${score}/5 · ${word}` : '', cls:word ? `s-${reviewStep(score)}` : '', verdict:'', score };
}
function reviewScoreWords(value, verdict = '') {
  const v = String(verdict || '').trim().toLowerCase();
  if (v && Object.hasOwn(REVIEW_VERDICT, v)) return reviewHeadlineOf({ score:value, verdict:v }).text;
  const n = reviewScoreOf(value);
  return n == null ? '' : `${n}/5 · ${REVIEW_WORD[reviewStep(n)]}`;
}
// Each side is rated 0 to 5. A review kept before that had 0, 1 or 2.
const reviewMarkOf = (v, scale) => (typeof v !== 'number' || !(v >= 0 && v <= 5) ? null : scale === 5 ? Math.round(v * 10) / 10 : [0, 3, 5][v] ?? null);
// The bar is as long as the rating; its colour is the nearest step's.
const reviewBarAttrs = m => `class="rv-bar m-${Math.round(m)}" style="--w:${m * 20}%"`;
function reviewFindingsOf(r) {
  return (Array.isArray(r?.findings) ? r.findings : [])
    .map(f => {
      const kind = String(f?.kind || '').trim().toLowerCase();
      const where = String(f?.where || '').trim();
      const detail = String(f?.detail || '').trim();
      return Object.hasOwn(REVIEW_FINDING_LABEL, kind) && detail ? { kind, where, detail } : null;
    })
    .filter(Boolean);
}
const reviewActionableFindings = r => reviewFindingsOf(r).filter(f => f.kind === 'bug' || f.kind === 'gap' || f.kind === 'risk');
function reviewFindingsHTML(findings) {
  if (!findings.length) return '';
  const row = f => `<li class="rv-finding is-${esc(f.kind)}"><span class="rv-fkind is-${esc(f.kind)}">${esc(REVIEW_FINDING_LABEL[f.kind])}</span>${f.where ? `<code class="rv-fwhere">${esc(f.where)}</code>` : ''}<span class="rv-fdetail">${esc(f.detail)}</span></li>`;
  return `<div class="rv-part"><h4>Findings</h4><ul class="rv-findings">${findings.map(row).join('')}</ul></div>`;
}
function reviewMismatchHTML(r) {
  const detail = String(r?.reportMismatch || '').trim();
  return detail ? `<p class="rv-mismatch" role="note"><strong>Report note</strong><span>${esc(detail)}</span></p>` : '';
}
function reviewFixPromptOf(workLabel, findings) {
  const items = findings.map(f => `- [${REVIEW_FINDING_LABEL[f.kind] || f.kind}]${f.where ? ` (${f.where})` : ''} ${f.detail}`).join('\n');
  return `Please fix the issues flagged in the review of ${workLabel || 'this Work'}:\n${items}`;
}
function reviewSendFixesButtonHTML(l, s, r) {
  if (!canControlReview(l) || !r) return '';
  const workId = isOrchReview(s) ? s.workId : s.id;
  const actionable = reviewActionableFindings(r);
  if (!actionable.length) return '';
  return `<button type="button" class="btn sm rv-send-fixes" data-act="review-send-fixes" data-line="${esc(l.id)}" data-work="${esc(workId)}" title="Add these findings as an Ask on this line">${ic('send', 13)}Send fixes</button>`;
}
function reviewWorkTook(s) {
  const rawTook = isOrchReview(s) ? s.workTook : s.took;
  return rawTook && !/^\d{4}-\d{2}-\d{2}/.test(rawTook) ? String(rawTook) : '';
}
// Omit missing or zero measurements.
function reviewFacts(r) {
  const f = r.facts && typeof r.facts === 'object' ? r.facts : {}, n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const cost = n(f.cost), files = n(f.files), added = n(f.added), removed = n(f.removed), checks = n(f.checks);
  const money = cost ? (typeof orchMoney === 'function' ? orchMoney(cost) : `$${cost.toFixed(2)}`) : '';
  return [money, files && `${files} file${files === 1 ? '' : 's'}`, (added || removed) && `+${added} −${removed}`, checks && `${checks} check${checks === 1 ? '' : 's'} run`].filter(Boolean);
}
function reviewReqListHTML(reqs) {
  if (!reqs.length) return '';
  const req = x => {
    const state = REVIEW_STATES.has(x.state) ? x.state : '';
    return `<li class="rv-req${state ? ` is-${state}` : ''}"><i class="rv-mark" aria-hidden="true"></i><span class="rv-text">${state === 'extra' ? '<em>(not asked)</em> ' : ''}${esc(String(x.text).trim())}</span>${state ? `<span class="rv-state">${state}</span>` : ''}</li>`;
  };
  return `<div class="rv-part"><h4>What you asked</h4><ul class="rv-reqs">${reqs.map(req).join('')}</ul></div>`;
}
const reviewNoteHTML = note => (note ? `<div class="rv-part"><h4>Review note</h4><p class="rv-note">${esc(note)}</p></div>` : '');
// The reviewer's note: how the work was finished and why it scored so. A review kept before notes reads its places to look at instead.
function reviewNoteOf(r) {
  const note = String(r.note || '').trim();
  if (note) return note;
  return (Array.isArray(r.look) ? r.look : []).map(x => [String(x?.where || '').trim(), String(x?.why || '').trim()].filter(Boolean).join(' — ')).filter(Boolean).slice(0, 2).join(' ');
}
function reviewPartsOf(s) {
  const r = s?.review;
  if (!r || typeof r !== 'object') return null;
  const headline = reviewHeadlineOf(r);
  const score = headline.score, word = REVIEW_WORD[reviewStep(score)];
  const reqs = (Array.isArray(r.requirements) ? r.requirements : []).filter(x => x && String(x.text || '').trim());
  const findings = reviewFindingsOf(r);
  return { r, score, word, headline, v2:reviewIsV2(r), reqs, findings, workTook:reviewWorkTook(s), facts:reviewFacts(r), note:reviewNoteOf(r) };
}
function reviewBarsHTML(r, v2) {
  if (v2) {
    if (reviewVerdictOf(r) === 'unverified') return '';
    const hasAny = REVIEW_BARS_V2.some(([key]) => key in r);
    if (!hasAny) return '';
    const items = REVIEW_BARS_V2.map(([key, label]) => {
      if (r[key] === null) {
        return `<span class="rv-bar is-na" role="img" aria-label="${label}: N/A"><span class="rv-bar-head"><span>${label}</span><span class="rv-n">N/A</span></span><i aria-hidden="true"></i></span>`;
      }
      const m = reviewMarkOf(r[key], 5);
      return m == null ? '' : `<span ${reviewBarAttrs(m)} role="img" aria-label="${label}: ${m} of 5"><span class="rv-bar-head"><span>${label}</span><span class="rv-n">${m}</span></span><i aria-hidden="true"></i></span>`;
    }).join('');
    return items ? `<div class="rv-bars is-v2">${items}</div>` : '';
  }
  const bars = REVIEW_BARS.map(([key, label]) => {
    const m = reviewMarkOf(r[key], r.scale);
    return m == null ? '' : `<span ${reviewBarAttrs(m)} role="img" aria-label="${label}: ${m} of 5"><span class="rv-bar-head"><span>${label}</span><span class="rv-n">${m}</span></span><i aria-hidden="true"></i></span>`;
  }).join('');
  return bars ? `<div class="rv-bars">${bars}</div>` : '';
}
function reviewCardBodyHTML(parts, showWorkTook = true) {
  const { r, v2, reqs, findings, workTook, facts, note } = parts;
  const bodyFacts = showWorkTook && workTook ? [workTook, ...facts] : facts;
  return `<div class="lp-review-body">
    ${reviewReqListHTML(reqs)}
    ${reviewBarsHTML(r, v2)}
    ${reviewMismatchHTML(r)}
    ${reviewFindingsHTML(findings)}
    ${bodyFacts.length ? `<p class="rv-facts">${bodyFacts.map(esc).join(' · ')}</p>` : ''}
    ${reviewNoteHTML(note)}
  </div>`;
}
function reviewCardHTML(l, s) {
  if (!s || isReviewWork(s) || (!isWork(s) && !isOrchReview(s))) return '';
  if (s.reviewing) return '<p class="lp-review-wait" role="status"><i class="spin" aria-hidden="true"></i>Reviewing…</p>';
  const parts = reviewPartsOf(s);
  if (!parts) return '';
  const { r, headline } = parts;
  const mode = reviewModeLabel(r), why = String(r.why || '').trim(), byText = reviewBySummary(r);
  return `<section class="lp-review${r.ignored ? ' is-ignored' : ''}" aria-label="Orchestrator review">
    <header><span class="rv-by">Orchestrator review${byText ? ` · ${esc(byText)}` : ''}</span>${mode ? `<span class="rv-mode is-${esc(r.mode)}">${esc(mode)}</span>` : ''}${r.ignored ? '<span class="rv-ignored-badge">Ignored in stats</span>' : ''}${headline.text ? `<strong class="rv-score ${esc(headline.cls)}">${esc(headline.text)}</strong>` : ''}</header>
    ${why ? `<p class="rv-why-line">${esc(why)}</p>` : ''}
    ${reviewCardBodyHTML(parts)}
  </section>`;
}
function orchReviewItem(p, l, s) {
  const on = S.lineSel?.id === s.id, line = esc(l.id), step = esc(s.id);
  const pending = s.reviewing && s.reviewPending && typeof s.reviewPending === 'object' ? s.reviewPending : null;
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const r = !s.reviewing && !stopped && s.review && typeof s.review === 'object' ? s.review : null;
  const info = r || pending || stopped || {};
  const mode = info.mode === 'user' || info.mode === 'auto' ? info.mode : '';
  const modeText = reviewModeLabel(info);
  const by = String(info.by || '').trim();
  const specsHTML = reviewSpecsHTML(reviewExtraSpecsOf(info, by), 'rv-agent-specs');
  const whoHTML = by || specsHTML
    ? `<span class="rv-agent-who">${by ? `<span class="rv-agent-name">${esc(by)}</span>` : ''}${by && specsHTML ? '<span class="rv-agent-sep" aria-hidden="true">·</span>' : ''}${specsHTML}</span>`
    : '';
  const why = reviewWhyText(info);
  const headline = r ? reviewHeadlineOf(r) : { text:'', cls:'', verdict:'' };
  const unexpected = Boolean(stopped && stopped.stopWhy !== 'stopped');
  const ndState = s.reviewing ? 'active' : stopped ? (unexpected ? 'error' : 'off') : 'done';
  const ndIcon = s.reviewing ? '<i class="spin" aria-hidden="true"></i>' : stopped ? (unexpected ? ic('x', 12) : ic('stop', 11)) : ic('orchestrate', 12);
  const headStatus = s.reviewing
    ? '<span class="rv-status-wait">Reviewing…</span>'
    : stopped
      ? `<span class="${unexpected ? 'rv-status-error' : 'rv-status-off'}">${esc(unexpected ? (stopped.stopWhy === 'limit' ? 'Usage limit' : 'Stopped') : 'Stopped by you')}</span>`
      : headline.text ? `<strong class="rv-score ${esc(headline.cls)}">${esc(headline.text)}</strong>` : '';
  let body = '';
  let actions = '';
  if (s.reviewing) {
    body = `<p class="lp-review-wait" role="status"><i class="spin" aria-hidden="true"></i>Reviewing ${esc(s.workLabel)} in the background…</p>`;
    const stopBtn = reviewStopButtonHTML(l, s.workId);
    if (stopBtn) actions = `<div class="lp-go">${stopBtn}</div>`;
  } else if (stopped) {
    const stopHead = reviewStopHeadline(s, stopped);
    const raw = reviewStopRawReason(stopped, stopHead);
    body = `<p class="lp-review-stopped" role="alert"><strong>${esc(stopHead)}</strong>${raw ? `<span>${esc(raw)}</span>` : ''}</p>`;
    const contBtn = reviewContinueButtonHTML(l, s);
    const resendBtn = reviewResendButtonHTML(p, l, s);
    if (contBtn || resendBtn) actions = `<div class="lp-go">${contBtn}${resendBtn}</div>`;
  } else if (r) {
    const parts = reviewPartsOf(s);
    const sendFixes = reviewSendFixesButtonHTML(l, s, r);
    body = reviewCardBodyHTML(parts, !sendFixes);
    if (sendFixes) {
      const duration = parts.workTook ? `<span class="rv-facts rv-work-took">Work took ${esc(parts.workTook)}</span>` : '';
      actions = `<footer class="rv-actions rv-footer">${sendFixes}${duration}</footer>`;
    }
  }
  const stateCls = s.reviewing ? 'is-reviewing' : stopped ? (unexpected ? 'is-error' : 'is-off') : r?.ignored ? 'is-ignored' : headline.verdict === 'unverified' ? 'is-unverified' : '';
  return `<article class="lp-orch-review ${stateCls} ${on ? 'on' : ''}" id="item-${step}" data-step="${step}" data-act="line-work" data-line="${line}" tabindex="0" role="button" aria-pressed="${on}" aria-label="Open Orchestrator review of ${esc(s.workLabel)}">
    <header class="lp-rv-head">
      <span class="nd st-${ndState} lp-rv-nd">${ndIcon}</span>
      <strong>Orchestrator review</strong>
      <span class="rv-of">of ${esc(s.workLabel)}</span>
      ${modeText ? `<span class="rv-mode is-${esc(mode)}">${esc(modeText)}</span>` : ''}
      ${r?.ignored ? '<span class="rv-ignored-badge">Ignored in stats</span>' : ''}
      ${headStatus}
      ${s.reviewing ? '' : nodeTools(l, s, [deleteTool(l, s)])}
      <span class="lp-open">${ic('right', 15)}</span>
    </header>
    ${whoHTML || why ? `<div class="rv-agent-why">${whoHTML}${why ? `<span class="rv-why">${esc(why)}</span>` : ''}</div>` : ''}
    ${body}
    ${actions}
  </article>`;
}
function orchReviewPanelHead(l, s) {
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const info = (!s.reviewing && !stopped && s.review) || s.reviewPending || stopped || {};
  const agent = s.agent || reviewAgentOf(info);
  const whoName = agent ? agentInfo(agent).name : (info.by || 'Reviewer');
  const unexpected = Boolean(stopped && stopped.stopWhy !== 'stopped');
  const chip = s.reviewing ? 'working' : stopped ? (unexpected ? 'error' : 'off') : 'landed';
  const chipText = s.reviewing ? 'Reviewing' : stopped ? (unexpected ? 'Stopped' : 'Stopped by you') : 'Done';
  const expand = typeof panelExpandButton === 'function' ? panelExpandButton() : '';
  const controls = s.reviewing
    ? reviewStopButtonHTML(l, s.workId)
    : stopped
      ? `${reviewContinueButtonHTML(l, s)}${reviewResendButtonHTML(null, l, s, 'btn sm', { picker:false })}`
      : '';
  return `<div class="lpp-title"><h2>Orchestrator review</h2><span class="chip c-${chip}">${esc(chipText)}</span><span class="lpp-who">${agent ? av(agent, 20) : ic('orchestrate', 16)}<span class="lpp-who-name">${esc(whoName)}</span></span>${s.took ? `<time>${esc(s.took)}</time>` : ''}</div>
    <div class="lpp-tools">${controls}${expand}<button type="button" class="icon-btn" data-act="panel-close" aria-label="Close">${ic('x', 18)}</button></div>`;
}
function orchReviewPanelWhere(l, s) {
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const info = (!s.reviewing && !stopped && s.review) || s.reviewPending || stopped || {};
  const { model, effort } = reviewSpecsOf(info);
  const at = info.at ? clockOf(info.at) : stopped?.stoppedAt ? `Stopped ${clockOf(stopped.stoppedAt)}` : info.startedAt ? `Started ${clockOf(info.startedAt)}` : '';
  const parts = [];
  if (model || effort) parts.push(`<span class="wc-how">${model ? `<code title="${esc(model)}">${esc(model)}</code>` : '<span>Default model</span>'}${effort ? `<span class="wc-sep" aria-hidden="true">·</span><span>${esc(effort)} effort</span>` : ''}</span>`);
  if (at) parts.push(`<span class="lpp-rv-at">${esc(at)}</span>`);
  return parts.length ? `<section class="where-card" aria-label="Reviewer details">${parts.join('')}</section>` : '';
}
function reviewRawOutputOf(p, l, s) {
  const r = !s?.reviewing && !s?.reviewStopped && s?.review && typeof s.review === 'object' ? s.review : null;
  const saved = String(r?.rawOutput || '').trim();
  if (saved) return saved;
  if (p && l && s && typeof activityOf === 'function' && typeof rowsOfStep === 'function') {
    const rows = rowsOfStep(activityOf(p, l), s);
    if (rows.length) {
      let lastStart = -1;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].kind === 'start') { lastStart = i; break; }
      }
      const tail = lastStart >= 0 ? rows.slice(lastStart + 1) : rows;
      const said = tail.filter(row => row.kind === 'say' && row.text).map(row => String(row.text).trim()).filter(Boolean);
      if (said.length) return said.join('\n\n');
      const allSaid = rows.filter(row => row.kind === 'say' && row.text).map(row => String(row.text).trim()).filter(Boolean);
      if (allSaid.length) return allSaid.at(-1);
    }
  }
  return String(r?.notes || '').trim();
}
function reviewViewBarHTML(mode) {
  const raw = mode === 'raw';
  return `<div class="lpp-rv-viewbar">
    <div class="seg" role="tablist" aria-label="Review view">
      <button type="button" role="tab" aria-selected="${!raw}" data-act="review-panel-mode" data-mode="summary"><span>Summary</span></button>
      <button type="button" role="tab" aria-selected="${raw}" data-act="review-panel-mode" data-mode="raw"><span>Original output</span></button>
    </div>
  </div>`;
}
function reviewRawCardHTML(p, l, s) {
  const raw = reviewRawOutputOf(p, l, s);
  const copyBtn = raw ? `<button type="button" class="btn sm" data-act="review-copy-raw" data-step="${esc(s.id)}">${ic('copy', 13)}Copy</button>` : '';
  return `<section class="lpp-rv-card lpp-rv-raw-card" aria-label="Original output">
    <header class="lpp-rv-raw-head"><h4>Original output</h4>${copyBtn}</header>
    ${raw ? `<pre class="lpp-rv-raw-pre">${esc(raw)}</pre>` : '<p class="muted lpp-rv-note">No original output was recorded for this review.</p>'}
  </section>`;
}
function orchReviewPanelHTML(p, l, s) {
  const pending = s.reviewing && s.reviewPending && typeof s.reviewPending === 'object' ? s.reviewPending : null;
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const r = !s.reviewing && !stopped && s.review && typeof s.review === 'object' ? s.review : null;
  const info = r || pending || stopped || {};
  const agent = s.agent || reviewAgentOf(info);
  const mode = info.mode === 'user' || info.mode === 'auto' ? info.mode : '';
  const modeText = reviewModeLabel(info);
  const by = String(info.by || '').trim() || (agent ? agentInfo(agent).name : 'Orchestrator reviewer');
  const why = reviewWhyText(info);
  const workWho = s.workAgent && s.workAgent !== 'you' ? `${av(s.workAgent, 16)}<span>${esc(agentInfo(s.workAgent).name)}</span>` : '';
  const targetRow = `<div class="lpp-rv-target">
    <span class="lpp-rv-target-who">Reviewing <strong>${esc(s.workLabel)}</strong>${workWho ? ` <span class="lpp-rv-work-agent">by ${workWho}</span>` : ''}</span>
    <button type="button" class="btn sm" data-act="line-work" data-line="${esc(l.id)}" data-step="${esc(s.workId)}">Open ${esc(s.workLabel)}</button>
  </div>`;
  const accessText = info.contextMode === 'line'
    ? 'Same Line context and workspace access as a regular job'
    : typeof info.tools === 'boolean'
      ? (info.tools ? 'Read-only workspace & check access (inspected changed files and ran non-mutating checks as needed)' : 'Judged from Work report, recorded steps, and diff')
      : '';
  const whyCard = `<section class="lpp-rv-card lpp-rv-why-card" aria-label="Why this reviewer was used">
    <header class="lpp-rv-card-head">
      <span class="lpp-rv-card-title">${ic('orchestrate', 14)}<span>Orchestrator reviewer</span></span>
      ${modeText ? `<span class="rv-mode is-${esc(mode)}">${esc(modeText)}</span>` : ''}
    </header>
    <div class="lpp-rv-who-row">
      ${agent ? av(agent, 22) : `<span class="lpp-rv-who-ic">${ic('orchestrate', 18)}</span>`}
      <div class="lpp-rv-who-meta">
        <strong>${esc(by)}</strong>
        ${reviewSpecsHTML(reviewSpecsOf(info), 'lpp-rv-specs')}
      </div>
    </div>
    ${why ? `<dl class="lpp-rv-dl"><div><dt>Why this agent</dt><dd>${esc(why)}</dd></div>${accessText ? `<div><dt>Review access</dt><dd>${esc(accessText)}</dd></div>` : ''}</dl>` : accessText ? `<dl class="lpp-rv-dl"><div><dt>Review access</dt><dd>${esc(accessText)}</dd></div></dl>` : ''}
  </section>`;

  if (s.reviewing) {
    const started = pending?.startedAt ? clockOf(pending.startedAt) : '';
    return `<div class="lpp-rv">
      <section class="lpp-rv-verdict is-active" role="status">
        <div class="lpp-rv-verdict-main"><i class="spin" aria-hidden="true"></i><strong>Reviewing ${esc(s.workLabel)}…</strong></div>
        ${started ? `<span class="lpp-rv-time">Started ${esc(started)}</span>` : ''}
      </section>
      ${targetRow}
      ${whyCard}
    </div>`;
  }

  if (stopped) {
    const unexpected = stopped.stopWhy !== 'stopped';
    const headline = reviewStopHeadline(s, stopped);
    const raw = reviewStopRawReason(stopped, headline);
    const contBtn = reviewContinueButtonHTML(l, s);
    const resendBtn = reviewResendButtonHTML(p, l, s);
    const viewMode = S.reviewPanelMode === 'raw' ? 'raw' : 'summary';
    return `<div class="lpp-rv">
      <div class="at-error ${unexpected ? '' : 'is-off'}" role="alert">${ic('hint', 16)}<span><strong>${esc(headline)}</strong>${raw ? `<br>${esc(raw)}` : ''}</span></div>
      ${reviewViewBarHTML(viewMode)}
      ${viewMode === 'raw' ? reviewRawCardHTML(p, l, s) : `${contBtn || resendBtn ? `<div class="lp-go">${contBtn}${resendBtn}</div>` : ''}${targetRow}${whyCard}`}
    </div>`;
  }

  const parts = reviewPartsOf(s);
  if (!parts) return `<div class="lpp-rv">${targetRow}${whyCard}</div>`;
  const viewMode = S.reviewPanelMode === 'raw' ? 'raw' : 'summary';
  const { headline, v2, reqs, findings, workTook, facts, note } = parts;
  const verdictBanner = `<section class="lpp-rv-verdict${r.ignored ? ' is-ignored' : ''}" aria-label="Review verdict">
      <div class="lpp-rv-verdict-main">
        ${headline.text ? `<strong class="rv-score ${esc(headline.cls)}">${esc(headline.text)}</strong>` : '<strong>Reviewed</strong>'}
        ${r.ignored ? '<span class="rv-ignored-badge">Ignored in stats</span>' : headline.verdict === 'unverified' ? '<span class="rv-unverified-note">Excluded from agent ranking</span>' : ''}
      </div>
      ${r.at ? `<span class="lpp-rv-time">${esc(clockOf(r.at))}</span>` : ''}
    </section>`;
  if (viewMode === 'raw') {
    return `<div class="lpp-rv">
      ${verdictBanner}
      ${reviewViewBarHTML('raw')}
      ${reviewRawCardHTML(p, l, s)}
    </div>`;
  }
  const axes = v2
    ? (headline.verdict === 'unverified' ? '' : REVIEW_BARS_V2.map(([key, label, desc]) => {
        if (!(key in r)) return '';
        if (r[key] === null) {
          return `<div class="lpp-rv-axis is-na">
            <div class="lpp-rv-axis-head"><strong>${label}</strong><span class="lpp-rv-axis-desc">${desc}</span><span class="lpp-rv-axis-n">N/A</span></div>
            <span class="rv-bar is-na" role="img" aria-label="${label}: N/A"><i aria-hidden="true"></i></span>
          </div>`;
        }
        const m = reviewMarkOf(r[key], 5);
        if (m == null) return '';
        return `<div class="lpp-rv-axis">
          <div class="lpp-rv-axis-head"><strong>${label}</strong><span class="lpp-rv-axis-desc">${desc}</span><span class="lpp-rv-axis-n">${m}/5</span></div>
          <span ${reviewBarAttrs(m)} role="img" aria-label="${label}: ${m} of 5"><i aria-hidden="true"></i></span>
        </div>`;
      }).join(''))
    : REVIEW_BARS.map(([key, label, desc]) => {
        const m = reviewMarkOf(r[key], r.scale);
        if (m == null) return '';
        return `<div class="lpp-rv-axis">
          <div class="lpp-rv-axis-head"><strong>${label}</strong><span class="lpp-rv-axis-desc">${desc}</span><span class="lpp-rv-axis-n">${m}/5</span></div>
          <span ${reviewBarAttrs(m)} role="img" aria-label="${label}: ${m} of 5"><i aria-hidden="true"></i></span>
        </div>`;
      }).join('');
  const files = Array.isArray(r.files) ? r.files.filter(Boolean) : [];
  const reviewTook = r.took ? `Review took ${r.took}` : '';
  const helpers = Number(r.helpersCount) > 0 ? `${r.helpersCount} helper report${r.helpersCount === 1 ? '' : 's'}` : '';
  const allFacts = [workTook, ...facts, reviewTook, helpers].filter(Boolean);
  const notes = String(r.notes || '').trim();
  const mismatch = reviewMismatchHTML(r);
  return `<div class="lpp-rv">
    ${verdictBanner}
    ${reviewViewBarHTML('summary')}
    ${targetRow}
    ${whyCard}
    ${axes || mismatch ? `<section class="lpp-rv-card" aria-label="Rating breakdown"><h4>Score breakdown</h4>${axes ? `<div class="lpp-rv-axes">${axes}</div>` : ''}${mismatch}</section>` : ''}
    ${findings.length ? `<section class="lpp-rv-card" aria-label="Findings">${reviewFindingsHTML(findings)}</section>` : ''}
    ${reqs.length ? `<section class="lpp-rv-card" aria-label="Requirements check">${reviewReqListHTML(reqs)}</section>` : ''}
    ${note ? `<section class="lpp-rv-card" aria-label="Review note">${reviewNoteHTML(note)}</section>` : ''}
    ${notes ? `<section class="lpp-rv-card" aria-label="Reviewer notes"><h4>Reviewer notes</h4><div class="at-say lpp-rv-notes">${typeof sayHTML === 'function' ? sayHTML(notes) : `<p>${esc(notes)}</p>`}</div></section>` : ''}
    ${allFacts.length || files.length ? `<section class="lpp-rv-card" aria-label="Evidence checked">
      <h4>Evidence checked</h4>
      ${allFacts.length ? `<p class="rv-facts">${allFacts.map(esc).join(' · ')}</p>` : ''}
      ${files.length ? `<ul class="lpp-rv-files">${files.map(f => `<li><code>${esc(f)}</code></li>`).join('')}</ul>` : ''}
    </section>` : ''}
  </div>`;
}
function rateButtonsHTML(l, s, cls = '') {
  if (!canRate(s)) return '';
  const lid = esc(l.id), sid = esc(s.id);
  return `<div class="lp-rate ${cls}" role="group" aria-label="Rate this work">
    <button type="button" class="lp-rate-btn is-good" data-act="work-rate" data-line="${lid}" data-step="${sid}" data-rating="good" aria-pressed="${s.rating === 'good'}" title="Rate good">${ic('thumbUp', 13)}<span>Good</span></button>
    <button type="button" class="lp-rate-btn is-bad" data-act="work-rate" data-line="${lid}" data-step="${sid}" data-rating="bad" aria-pressed="${s.rating === 'bad'}" title="Rate not good">${ic('thumbDown', 13)}<span>Not good</span></button>
  </div>`;
}
const WORK_SCOPES = [['light', 'Light'], ['standard', 'Standard'], ['heavy', 'Heavy']];
function scopeChipsHTML(l, s) {
  if (!canRate(s)) return '';
  const lid = esc(l.id), sid = esc(s.id);
  const manual = s.scope || '', current = manual || s.orchScope || 'standard';
  const hint = manual ? 'Set by you · click again to reset' : s.orchScope ? `Auto (${s.orchScopeSource || 'orchestrator'}) · click to override` : 'Default (standard) · click to override';
  return `<div class="lpp-scope-row"><span class="lpp-scope-label" title="${esc(hint)}">Difficulty</span><div class="lp-scope" role="group" aria-label="Task difficulty">${WORK_SCOPES.map(([key, label]) => {
    const isManual = manual === key, isAuto = !manual && current === key;
    return `<button type="button" class="lp-scope-btn${isManual ? ' is-set' : isAuto ? ' is-auto' : ''}" data-act="work-scope" data-line="${lid}" data-step="${sid}" data-scope="${key}" aria-pressed="${isManual}" title="${esc(label)}">${label}</button>`;
  }).join('')}</div></div>`;
}
function rateBoxHTML(l, s) {
  if (!canRate(s)) return '';
  const lid = esc(l.id), sid = esc(s.id), rated = s.rating === 'good' || s.rating === 'bad';
  return `<div class="lpp-rate-box" data-rate-box="${sid}">
    <div class="lpp-rate-row"><span class="lpp-rate-label">Was this work helpful?</span>${rateButtonsHTML(l, s, 'is-box')}</div>
    ${scopeChipsHTML(l, s)}
    ${rated ? `<div class="lpp-rate-note"><input type="text" class="rate-note-input" data-step="${sid}" maxlength="280" value="${esc(s.ratingNote || '')}" placeholder="Optional: why did this go well or poorly?"><button type="button" class="btn sm rate-note-save" data-act="work-rate-note" data-line="${lid}" data-step="${sid}">Save note</button></div>` : ''}
  </div>`;
}
function workItem(p, l, s) {
  const on = S.lineSel?.id === s.id, color = STATE_COLOR[lineState(l)] || 'var(--ink3)', words = workWords(l, s), pics = s.pictures.filter(pic => fileEntry(p, pic.path)), line = esc(l.id);
  // A Work you stopped on a non-error line shows Carry on with here, under the Work.
  // Show Continue on every eligible stopped Work card (beside Send again / Carry on with) as well as in the panel.
  const resume = continueButton(l, s);
  const carry = carryWork(l) === s && lineState(l) !== 'error' ? (resume ? carryButton(l, s).replace(' primary', '') : carryButton(l, s)) : '';
  // Send again sits under any Work that failed, beside Carry on with when that is here too.
  const resend = resendWork(l) === s ? resendButton(l, s) : '';
  const queued = isQueued(l, s) ? unqueueButton(l, s, l.stations.find(x => isWork(x) && x.state === 'active')) : '';
  const ask = workAsking(l, s), qs = workQuestions(l, s), waitReply = workWaitingReply(l, s);
  const askingNow = Boolean(s.asked || (ask && ask.isBlocking !== false));
  const waitingOnYou = Boolean(askingNow || qs.length > 0 || waitReply);
  const dotState = waitingOnYou ? 'wait' : s.state;
  const stop = queued ? `<div class="lp-go">${queued}</div>` : (askingNow && ask && !ask.answerable) ? `<div class="lp-go">${answerAct(l, 'btn sm primary', ask)}</div>` : s.state === 'wait' && !s.finished && s.wait ? `<div class="lp-go"><button type="button" class="btn sm primary" data-act="approve-step" data-line="${line}">${ic('check', 15)}${s.kind === 'grill' ? 'Go ahead' : 'Approve and continue'}</button></div>` : resume || carry || resend ? `<div class="lp-go">${resume}${carry}${resend}</div>` : '';
  const tools = s.state === 'active' || queued ? '' : nodeTools(l, s, [deleteTool(l, s)]);
  const mark = reviewMark(l, s);
  const headActs = tools || mark ? `<span class="lp-work-tools">${tools}${mark}</span>` : '';
  return `<article class="lp-work w-${dotState} ${resume || carry || resend ? 'can-carry' : ''} ${isReviewed(s) ? 'is-reviewed' : ''} ${on ? 'on' : ''} ${typeof justEnded === 'function' && justEnded(l, s) ? 'just-ended' : ''}" id="item-${esc(s.id)}" data-step="${esc(s.id)}" data-act="line-work" data-line="${line}" tabindex="0" role="button" aria-pressed="${on}" aria-label="Open ${esc(stepLabel(s))}"${typeof fromMark === 'function' ? fromMark(l, s) : ''}>
    <header><span class="nd st-${dotState}" style="--c:${color}">${waitingOnYou ? '' : nodeIcon(s, false)}</span><strong>${esc(stepLabel(s))}</strong>${waitingOnYou ? `<span class="line-hint line-answer">Waiting on you</span>` : ''}${s.diff ? `<span class="row-diff"><i>+${s.diff.add}</i> <u>−${s.diff.del}</u></span>` : ''}${ratingBadge(s)}${orchRatingBadge(s)}${headActs}<span class="lp-open">${ic('right', 15)}</span></header>
    ${workSubHTML(s)}
    ${pics.length ? `<div class="lp-pics lp-pics-big">${pics.map(pic => { const c = canvasByPath(p, pic.path); return bigPic(p, pic.path, pic.title || 'Picture', c ? `${pptDownloadButton(c)}<button type="button" class="btn sm line-pic-edit" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(l.topicPath)}" title="Edit on canvas">${ic('pen', 14)}<span>Edit on canvas</span></button>` : ''); }).join('')}</div>` : ''}
    ${outputsHTML(p, l, s, canvasPages(p, s, pics))}
    ${askingNow && ask?.questions?.length ? ask.questions.map(q => `<p class="lp-sum">${inlineSay(q.text)}</p>`).join('') : words ? `<p class="lp-sum">${inlineSay(words)}</p>` : ''}
    ${stop}
  </article>`;
}
// What a Work made besides its Canvases (work-outputs.js on the server): its pictures small, then one card for each page, document,
// deck, Claude Artifact, line or prototype in the code folder, so what it made is on the line and not only in its result.
const OUT_ICON = { page:'page', document:'doc', slides:'slides', data:'data', media:'play', artifact:'link', line:'branch' };
const outputThere = (p, o) => (o.kind === 'artifact' || o.code ? true : o.kind === 'line' ? Boolean(lineById(p, o.line)) : Boolean(fileEntry(p, o.path)));
const outputName = (p, o) => o.title || (o.kind === 'line' ? lineById(p, o.line)?.title : '') || String(o.path).split('/').pop();
// A page drawn on one of the Work's Canvases is in its list too, as the result links it, not only as a button under the picture (PE-511).
const canvasPages = (p, s, pics) => pics.map(pic => canvasPage(p, canvasByPath(p, pic.path))).filter(f => f && !(s.outputs || []).some(o => o.path === f.path)).map(f => ({ kind:'page', path:f.path }));
function outputsHTML(p, l, s, more = []) {
  const outs = [...more, ...(s.outputs || [])].filter(o => outputThere(p, o)); if (!outs.length) return '';
  const pics = outs.filter(o => o.kind === 'picture'), rest = outs.filter(o => o.kind !== 'picture');
  const card = o => { const name = outputName(p, o), away = o.kind === 'artifact' || o.code; return `<button type="button" class="lp-out" data-act="open-output" data-kind="${esc(o.kind)}" data-path="${esc(o.path)}"${o.line ? ` data-line="${esc(o.line)}"` : ''}${o.code ? ` data-code="1" data-topic="${esc(l.id)}" data-step="${esc(s.id)}"` : ''} title="${esc(o.code ? shortPath(o.path) : name)}"><span class="lp-out-ic">${ic(OUT_ICON[o.kind] || FILE_ICON(o.path), 17)}</span><strong>${esc(name)}</strong>${ic(away ? 'expand' : 'right', 14)}</button>`; };
  return `${pics.length ? `<div class="lp-pics lp-out-pics">${pics.map(o => `<div class="lp-pic" title="${esc(outputName(p, o))}">${picturePreview(p, o.path, outputName(p, o))}</div>`).join('')}</div>` : ''}${rest.length ? `<div class="lp-outs">${rest.map(card).join('')}</div>` : ''}`;
}
// What the line's Works made, in one row under its name, so nobody opens Work after Work to find it (PE-1190): each Canvas with its page,
// document, deck, table, video, Artifact and prototype, newest first, and on an orchestrator's line its parts' too. Plain pictures stay
// on the Works they were made for. A line of one Work shows them on that Work alone.
const MADE_FIRST = 6, MADE_ICON = { drawn:'canvas', ...OUT_ICON };
function madeItems(p, made) {
  const seen = new Set(), out = [];
  for (const o of made) {
    const c = o.kind === 'drawn' ? canvasByPath(p, o.path) : null;
    if (o.kind === 'drawn' && !c || seen.has(o.path)) continue;
    const page = c ? canvasPage(p, c)?.path || '' : '';
    seen.add(o.path).add(page);
    out.push({ ...o, ...(c ? { source:c.source, slides:Boolean(c.slides), title:c.title || o.title, page } : {}) });
  }
  // A prototype is one thing: its page, found again as a link of its own, is the Canvas's.
  return out.filter(o => o.source || !out.some(x => x.page === o.path));
}
function lineMade(p, l) {
  const made = [];
  for (const x of [l, ...(l.orchestratorRef ? subLinesOf(p, l) : [])]) for (const s of [...(x.stations || [])].reverse()) {
    if (!isWork(s) || s.state === 'todo' || s.off === 'discarded') continue;
    for (const pic of s.pictures || []) made.push({ kind:'drawn', path:pic.path, title:pic.title, line:x.id, step:s.id });
    for (const o of s.outputs || []) if (o.kind !== 'picture' && o.kind !== 'line' && outputThere(p, o)) made.push({ ...o, line:x.id, step:s.id });
  }
  return madeItems(p, made);
}
function madeChips(p, items, key) {
  const all = Boolean(S.madeAll?.[key]), shown = all ? items : items.slice(0, MADE_FIRST), left = items.length - shown.length;
  const chip = o => {
    const name = o.source ? o.title || 'Canvas' : outputName(p, o), path = o.page || o.path, kind = o.page ? 'page' : o.source ? 'canvas' : o.kind;
    return `<span class="made-item"><button type="button" class="made-open" data-act="open-made" data-kind="${esc(kind)}" data-path="${esc(path)}"${o.code ? ` data-code="1" data-topic="${esc(o.line)}" data-step="${esc(o.step)}"` : ''} title="${esc(name)}">${ic(MADE_ICON[o.page ? 'page' : o.slides ? 'slides' : o.kind] || FILE_ICON(o.path), 15)}<span>${esc(name)}</span></button>${o.source ? `<button type="button" class="made-edit" data-act="open-canvas" data-canvas="${esc(o.source)}" aria-label="Edit ${esc(name)} on canvas" title="Edit on canvas">${ic('pen', 13)}</button>` : ''}</span>`;
  };
  return `<div class="made" role="group" aria-label="Deliverables">${shown.map(chip).join('')}${left ? `<button type="button" class="made-more" data-act="made-all" data-key="${esc(key)}">+${left}</button>` : ''}</div>`;
}
function madeHTML(p, l) {
  if (EMBED) return '';
  const subs = l.orchestratorRef && typeof subLinesOf === 'function' ? subLinesOf(p, l).length : 0;
  if (!subs && l.stations.filter(s => isWork(s) && s.state !== 'todo').length < 2) return '';
  const items = lineMade(p, l);
  return items.length ? madeChips(p, items, l.id) : '';
}
ACT['made-all'] = el => {
  (S.madeAll ||= {})[el.dataset.key] = true;
  if (S.route.view === 'orchestrator' && typeof orchPaintSessions === 'function') orchPaintSessions(); else refreshLine();
};
// The folder's list of files may not be read yet where the row is shown; the viewer needs it, and only it says that a Canvas has a page.
ACT['open-made'] = async el => {
  const p = project(), { kind, path } = el.dataset, canvas = kind === 'canvas';
  if (kind !== 'artifact' && !el.dataset.code && !listsFiles(p) && (canvas || !fvItem(p, path))) await readNeeds(p, { parts:['files'] }).catch(() => { /* Opened as it can be without it. */ });
  const now = project(), page = canvas && now ? canvasPage(now, canvasByPath(now, path)) : null;
  if (page) Object.assign(el.dataset, { kind:'page', path:page.path });
  ACT['open-output'](el);
};
function outputScope(p, el) {
  const made = el.closest?.('.made');
  if (made) return { kind:'made', line:S.route.line || '', step:'', keys:fvScopeKeys(p, $$('.made-open', made)) };
  const group = el.closest?.('.lp-outs');
  const work = el.closest?.('.lp-work[data-step]');
  return { kind:'outputs', line:S.route.line || '', step:work?.dataset?.step || '', keys:fvScopeKeys(p, group ? $$('.lp-out[data-act="open-output"]', group) : [el]) };
}
ACT['open-output'] = el => {
  const p = project(), { kind, path } = el.dataset;
  if (kind === 'artifact') { window.open(path, '_blank', 'noopener'); return; }
  if (kind === 'line') { go({ view:'line', line:el.dataset.line }, { from:el }); return; }
  // A prototype in the code folder opens in the browser of the computer running PenEcho. Anywhere else its path is what can be given.
  if (el.dataset.code) {
    const l = lineById(p, el.dataset.topic);
    if (!S.thisComputer || !l) { copyText(path, `Copied ${shortPath(path)}`); return; }
    api(topicApi(p, l, 'open-output'), { method:'POST', body:{ step:el.dataset.step, path } }).catch(error => toast(error.status === 404 && !error.code ? 'Restart PenEcho to open this from here.' : error.message));
    return;
  }
  if (fvOpenScoped(p, path, outputScope(p, el))) return;
  if (/\.md$/i.test(path)) { ACT['preview-work-file'](el); return; }
  openLightbox(p, path);
};
function endItem(p, l, s) {
  const line = esc(l.id), on = S.lineSel?.id === s.id;
  const readOnly = typeof HOSTED !== 'undefined' && HOSTED?.read;
  const todoBtn = todoMark(l, p);
  const showReview = !readOnly && !lineWorking(l) && (s.toReview || (s.isTodo && nextToReview(l)) || canMarkReviewed(l));
  const subs = l.orchestratorRef && typeof subLinesOf === 'function' ? subLinesOf(p, l) : [];
  const treePlan = subs.length && typeof reviewTreePlan === 'function' ? reviewTreePlan(p, l) : null;
  const showTree = Boolean(treePlan && !readOnly && (treePlan.subMarkableCount > 0 || (!HOSTED && treePlan.subStoppedCount + treePlan.subWaitingCount > 0)));
  const treeSaving = Boolean(S.treeReviewSaving?.has(`${p.id}:${l.id}`));
  if (s.state === 'todo') {
    if (l.archived || l.closed || lineWorking(l) || (!todoBtn && !showReview && !showTree)) return '';
    const wait = lineNeedsYou(l), err = !wait && lineState(l) === 'error';
    const stateCls = wait ? 'is-wait' : err ? 'is-error' : '';
    const ndState = wait ? 'wait' : err ? 'error' : 'todo';
    const label = wait ? STATE_TEXT.wait : err ? STATE_TEXT.error : 'Not finished';
    const icon = wait ? '<b aria-hidden="true">!</b>' : err ? ic('x', 12) : '';
    return `<div class="lp-end lp-end-pending ${stateCls}" id="item-${esc(s.id)}">
      <header><span class="nd st-${ndState}" style="--c:${STATE_COLOR[wait ? 'wait' : lineState(l)] || 'var(--ink3)'}">${icon}</span><strong>${esc(label)}</strong>
        <span class="lp-end-actions">${todoBtn}${showReview ? `<button type="button" class="btn sm lp-all-reviewed" data-act="all-reviewed" data-line="${line}"${S.lineMarkSaving?.has(`${p.id}:${l.id}`) ? ' disabled aria-busy="true"' : ''}>${ic('check', 14)}Mark reviewed</button>` : ''}${showTree ? `<button type="button" class="btn sm lp-tree-reviewed" data-act="review-tree-menu" data-line="${line}" aria-haspopup="dialog"${treeSaving ? ' disabled aria-busy="true"' : ''}>Mark with sub-Lines…</button>` : ''}</span></header>
    </div>`;
  }
  return `<article class="lp-work lp-end w-${s.state} ${s.isTodo ? 'is-todo' : ''} ${s.toReview ? 'to-review' : ''} ${on ? 'on' : ''}" id="item-${esc(s.id)}" data-step="${esc(s.id)}" data-act="line-work" data-line="${line}" tabindex="0" role="button" aria-pressed="${on}" aria-label="Open ${esc(stepLabel(s))}">
    <header><span class="nd st-${s.state}" style="--c:${STATE_COLOR[lineState(l)] || 'var(--ink3)'}">${ic(s.isTodo ? 'box' : s.toReview ? 'eye' : 'check', 12)}</span><strong>${esc(stepLabel(s))}</strong>${s.when ? `<time>${esc(s.when)}</time>` : ''}
      <span class="lp-end-actions">${todoBtn}${showReview ? `<button type="button" class="btn sm lp-all-reviewed" data-act="all-reviewed" data-line="${line}"${S.lineMarkSaving?.has(`${p.id}:${l.id}`) ? ' disabled aria-busy="true"' : ''}>${ic('check', 14)}Mark all reviewed</button>` : ''}${showTree ? `<button type="button" class="btn sm lp-tree-reviewed" data-act="review-tree-menu" data-line="${line}" aria-haspopup="dialog"${treeSaving ? ' disabled aria-busy="true"' : ''}>Mark with sub-Lines…</button>` : ''}</span>${s.state === 'done' && !s.finished ? nodeTools(l, s, [deleteTool(l, s)]) : ''}<span class="lp-open">${ic('right', 15)}</span></header>
  </article>`;
}
// A note is your own words on the page, with no bubble. It can be changed, unlike an Ask, which is what an agent read.
function noteItem(p, l, s) {
  const editable = !l.archived && !l.closed;
  const editing = editable && S.editNote === `${l.id}/${s.id}`, line = esc(l.id), step = esc(s.id);
  const otherFiles = (s.pendingFiles || s.files || []).filter(f => !f.image);
  const quotes = (s.refers || []).map(r => r.step && stationById(l, r.step) ? `<button type="button" class="lp-quote" data-act="line-stop" data-line="${line}" data-step="${esc(r.step)}" title="Go to ${esc(r.label)}">${quoteInner(r.label, r.words)}</button>` : `<div class="lp-quote">${quoteInner(r.label, r.words)}</div>`).join('');
  const tools = [nodeTool('note-copy', 'copy', 'Copy', s, l.id)];
  if (editable) tools.push(nodeTool('note-edit', 'pen', 'Edit', s, l.id), nodeTool('line-refer', 'refer', 'Refer to this in the box', s));
  tools.push(deleteTool(l, s));
  return `<section class="lp-note ${editing ? 'is-editing' : ''}" id="item-${step}" data-step="${step}"${typeof fromMark === 'function' ? fromMark(l, s) : ''}>
    ${quotes}
    ${editing ? `<textarea class="lp-note-edit" id="noteEdit" data-line="${line}" data-step="${step}" rows="5" aria-label="Note">${esc(s.text)}</textarea><div class="lp-note-acts"><button type="button" class="btn sm primary" data-act="note-save" data-line="${line}" data-step="${step}">Save</button><button type="button" class="btn sm" data-act="note-cancel">Cancel</button><span class="muted">Markdown and LaTeX</span></div>`
      : `${notePictures(p, l, s)}<div class="lp-note-words words md-words">${wordsMd(applyPendingTasks(p, l, s, s.text), p, { interactive: canToggleStepTask(l, s) })}</div>${otherFiles.length ? askFiles({ files:otherFiles }, p, Boolean(s.pendingFiles)) : ''}`}
    ${editing ? '' : nodeTools(l, s, tools, S.copiedNote === `${l.id}/${s.id}`)}
  </section>`;
}
// A drawing is the thing itself: open it and keep drawing.
function canvasItem(p, l, s) {
  const pics = (s.pictures || []).filter(pic => fileEntry(p, pic.path)), line = esc(l.id), step = esc(s.id);
  const c = pics.map(pic => canvasByPath(p, pic.path)).find(Boolean), name = pics[0]?.title || 'Drawing';
  return `<section class="lp-drawing" id="item-${step}" data-step="${step}"${typeof fromMark === 'function' ? fromMark(l, s) : ''}>
    ${pics.length ? pics.map(pic => `<div class="lp-draw-view">${picturePreview(p, pic.path, pic.title)}</div>`).join('') : '<p class="muted lp-draw-gone">The drawing is not in the folder any more.</p>'}
    ${s.text ? `<div class="lp-note-words words md-words">${wordsMd(applyPendingTasks(p, l, s, s.text), p, { interactive: canToggleStepTask(l, s) })}</div>` : ''}
    <footer class="lp-draw-foot"><strong title="${esc(name)}">${esc(name)}</strong>${pptDownloadButton(c)}${pageButton(p, c)}${c && !l.archived && !l.closed ? `<button type="button" class="btn sm line-pic-edit" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(l.topicPath)}" title="Edit on canvas">${ic('pen', 14)}<span>Edit on canvas</span></button>` : ''}</footer>
    ${nodeTools(l, s, [l.archived || l.closed ? '' : nodeTool('line-refer', 'refer', 'Refer to this in the box', s), deleteTool(l, s)])}
  </section>`;
}
ACT['note-edit'] = el => { S.editNote = `${el.dataset.line}/${el.dataset.step}`; refreshLine(); const t = $('#noteEdit'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
ACT['note-cancel'] = () => { S.editNote = null; refreshLine(); };
ACT['note-save'] = el => {
  const l = lineById(project(), el.dataset.line), text = $('#noteEdit')?.value.trim();
  if (!text) { toast('A note needs some words. Delete it instead.'); return; }
  act(l, 'edit-note', { step:el.dataset.step, text }).then(() => { S.editNote = null; refreshAfterChange(); }).catch(error => toast(error.message));
};
ACT['note-copy'] = async el => {
  const l = lineById(project(), el.dataset.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  if (await copyText(s.text, 'Copied the note')) { S.copiedNote = `${l.id}/${s.id}`; setTimeout(() => { if (S.copiedNote === `${l.id}/${s.id}`) { S.copiedNote = null; } }, 1600); }
};
// Deleting a node asks twice (PE-1144): what goes, then whether you are sure.
const removedWord = kind => ({ canvas:'Drawing', note:'Note', meeting:'Meeting', ask:'Ask', merge:'Merge', deliver:'Delivery', 'orch-review':'Review' })[kind] || 'Work';
// Which node was shown: an Ask's, note's or drawing's id is only its place, so the server deletes it only while it is still this one (service.js isSeen).
const nodeSeen = (l, s) => ({ kind:s.kind, when:s.when || '', text:String(s.text || '').slice(0, 400), chars:String(s.text || '').length, count:l.stations.filter(x => x.kind === s.kind).length });
function confirmDeleteNode(l, s, anchor, run) {
  const unsent = Boolean(s.unsent), name = unsent ? 'Ask' : isWork(s) ? stepLabel(s) : removedWord(s.kind), dialog = document.createElement('dialog');
  const words = String(s.kind === 'ask' ? askOnly(s.text) : s.text || s.out || s.pictures?.[0]?.title || '').replace(/\s+/g, ' ').trim();
  // The only thing on its line takes the line with it, unless a branch there has commits not merged yet.
  const seen = nodeSeen(l, s), alone = unsent && l.stations.filter(x => !x.finished).length === 1, branch = alone && !l.noBranch && !l.mergeOf && !l.archived;
  const kept = HOSTED ? (alone ? 'Nothing else is on the line, so the line is archived.' : unsent ? 'It can’t be brought back.' : 'You can undo it right after.')
    : alone ? `Nothing else is on the line, so the line goes too. You can restore it from Deleted for 7 days.${branch ? ' If its branch has commits that aren’t merged, the line stays and only the Ask goes, for good.' : ''}` : unsent ? 'It can’t be brought back.' : 'You can restore it from Deleted for 7 days.';
  const review = isWork(s) && threadStations(l).some(x => isOrchReview(x) && x.workId === s.id);
  let sure = false;
  dialog.className = 'line-command-dialog node-delete-dialog';
  dialog.setAttribute('aria-labelledby', 'nodeDeleteTitle');
  const draw = () => {
    dialog.innerHTML = sure
      ? `<form><h2 id="nodeDeleteTitle">Are you sure?</h2><p>Agents will no longer find this ${esc(removedWord(s.kind))} in the line. ${kept}</p><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Yes, delete</button></footer></form>`
      : `<form><h2 id="nodeDeleteTitle">Delete ${esc(name)}?</h2>${words ? `<p class="node-delete-words">${esc(words.length > 160 ? `${words.slice(0, 159)}…` : words)}</p>` : ''}${review ? '<p>Its Orchestrator review goes with it.</p>' : ''}<footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Delete</button></footer></form>`;
    $('[data-cancel]', dialog).onclick = () => dialog.close();
    $('form', dialog).onsubmit = async e => {
      e.preventDefault();
      if (!sure) { sure = true; draw(); return; }
      const submit = $('button[type="submit"]', dialog); submit.disabled = true;
      try { await run(seen); dialog.close(); }
      catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = false; }
    };
    // Enter pressed twice by habit never deletes.
    $('[data-cancel]', dialog).focus();
  };
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); });
  dialog.showModal();
  draw();
}
function restoreYours(lineId, removed) {
  const l = lineById(project(), lineId); if (!l) return;
  act(l, 'restore-yours', { removed }).then(() => { refreshAfterChange(); toast('Brought back'); }).catch(error => toast(error.message));
}
ACT['yours-drop'] = el => {
  const l = lineById(project(), el.dataset.line), s = l && lineStation(l, el.dataset.step); if (!s) return;
  const p = project();
  if (!['note', 'canvas', 'meeting'].includes(s.kind) && (l.running || l.elsewhere)) { toast('Wait for work to finish before deleting this.'); return; }
  confirmDeleteNode(l, s, el, async seen => {
    const result = await act(l, 'drop-yours', { step:s.id, seen }, p);
    if (S.cur !== p.id) return;
    if (S.route.view === 'line' && S.route.line === l.id && S.route.step === s.id) { S.route = { view:'line', line:l.id }; syncHash(true); }
    refreshAfterChange();
    toast(`${removedWord(s.kind)} deleted`, result?.removed ? { label:'Undo', fn:() => restoreYours(l.id, result.removed) } : null);
  });
};
// Above each card: what it is (or the agent who did it) and when, so the middle reads down as one column.
const KL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nodeWhen(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(when || ''); if (!m) return when || '';
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${m[1]}-${m[2]}-${m[3]}` === today ? `${m[4]}:${m[5]}` : `${+m[3]} ${KL_MONTHS[+m[2] - 1]} ${m[4]}:${m[5]}`;
}
function kindLine(l, s) {
  if (isEnd(s)) return '';
  if (isOrchReview(s)) {
    const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
    const info = (!s.reviewing && !stopped && s.review) || s.reviewPending || stopped || {};
    const agent = s.agent || reviewAgentOf(info);
    const whoName = agent ? agentInfo(agent).name : (info.by || 'Orchestrator reviewer');
    const mark = agent ? `<span class="lp-kl-av">${av(agent, 18)}</span>` : `<span class="lp-kl-orch-ic">${ic('orchestrate', 15)}</span>`;
    const when = s.reviewing ? (info.startedAt ? nodeWhen(info.startedAt) : '') : stopped ? (stopped.stoppedAt ? nodeWhen(stopped.stoppedAt) : '') : (s.took || (info.at ? nodeWhen(info.at) : ''));
    return `<div class="lp-kl k-orch-review">${mark}<b>${esc(whoName)}</b><span class="lp-kl-via lp-kl-orch">Orchestrator review</span>${when ? `<time title="${esc(info.at || stopped?.stoppedAt || info.startedAt || when)}">${esc(when)}</time>` : ''}</div>`;
  }
  const yours = isYours(s) || s.kind === 'ask', k = yours ? s.kind : 'work', when = yours ? s.when : s.took;
  const name = yours ? KIND[s.kind]?.label || 'Note' : s.agent && s.agent !== 'you' ? agentInfo(s.agent).name : 'You';
  const mark = !yours && s.agent && s.agent !== 'you' ? `<span class="lp-kl-av">${av(s.agent, 18)}</span>` : `<i class="mk mk-${k}"></i>`;
  return `<div class="lp-kl k-${k}">${mark}<b>${esc(name)}</b>${when ? `<time title="${esc(when)}">${esc(nodeWhen(when))}</time>` : ''}${s.kind === 'ask' && s.via && !s.unsent && !s.finishedAsk ? `<span class="lp-kl-via">${esc(s.via)}</span>` : ''}</div>`;
}
const itemHTML = (p, l, s) => isOrchReview(s) ? orchReviewItem(p, l, s) : s.kind === 'ask' ? askItem(p, l, s) : s.kind === 'note' ? noteItem(p, l, s) : s.kind === 'canvas' ? canvasItem(p, l, s) : s.kind === 'meeting' && typeof meetingItem === 'function' ? meetingItem(p, l, s) : isEnd(s) ? endItem(p, l, s) : workItem(p, l, s);
function threadHTML(p, l) {
  // A drawing of your own. What an agent can make is in the box right below, so no Make with AI here (PE-478).
  const adds = l.archived || l.closed ? '' : `<div class="lp-thread-adds"><button type="button" class="lp-newcv" data-act="line-draw">${ic('plus', 16)}<span>Add new canvas</span></button></div>`;
  return threadStations(l).map(s => { const item = itemHTML(p, l, s); return item ? (isEnd(s) || s.state !== 'todo' ? kindLine(l, s) : '') + item : ''; }).join('') + `<div id="lpAsks">${questionsHTML(p, l)}</div>${adds}`;
}
// The real Canvas opens; what you draw comes back as a Canvas node at the end of this line.
ACT['line-draw'] = el => {
  const p = project(), l = lineById(p, S.route.line), form = $('.lp-dock .composer');
  if (l && form) openDrawing(p, form, { from:el, toLine:l.slug }).catch(error => toast(error.message));
};

// ---------- The detail of one piece of work, on the right ----------
const workPanelDocked = () => innerWidth > 860 && !(typeof EMBED !== 'undefined' && EMBED);
let panelRoute = null;
function selectedStep(l, r) {
  const s = r.step && lineStation(l, r.step);
  // A stop not reached yet has nothing to show.
  if (s && s.kind !== 'ask' && !(isEnd(s) && s.state === 'todo')) return s;
  // A Work (or Orchestrator review) opened by default is being read too. Navigation gives the next visit a fresh route.
  if (r === panelRoute && S.lineSel && (isWork(S.lineSel) || isOrchReview(S.lineSel))) {
    const reading = lineStation(l, S.lineSel.id);
    if (reading) return reading;
  }
  // Your words are in the file. What answered them is what opens.
  const answer = s?.kind === 'ask' && l.stations.slice(s.index + 1).find(x => isWork(x) && x.state !== 'todo');
  if (answer && workPanelDocked()) return answer;
  // A finished request has something to read, so the latest work opens by itself when there is room for it.
  if (S.panelShut === l.id || !workPanelDocked()) return null;
  // The line's Topic comes first, while no Work is picked (PE-457, merge.js).
  if (typeof topicFirst === 'function' && topicFirst(project(), l)) return null;
  return l.stations.find(s => isWork(s) && (s.asked || (s.asking?.kind === 'tool' && s.asking.isBlocking !== false) || s.questions?.length)) || l.stations.find(s => isWork(s) && (s.waitingReply || s.state === 'wait')) || latestWork(l) || null;
}
// Always in view under a Work, with a result or not: actions beside Details, then a quiet line of where and how it ran.
function whereParts(l, s) {
  const who = s?.agent && s.agent !== 'you' ? s.agent : l.runAgent || l.agent, chat = who ? l.conversations?.[who] : l.conversation;
  // Paths and commands are cut from the left so the end stays readable. The marks keep a leading ~/ or a trailing / from jumping to the other side.
  const endFirst = (text, whole = text) => `<code title="${esc(whole)}">&lrm;${esc(text)}&lrm;</code>`;
  const way = chat?.canOpen ? `<button type="button" class="wc-act" data-act="open-desktop" data-line="${esc(l.id)}" data-agent="${esc(chat.agent)}" data-step="${esc(s.id)}" title="Open in ${esc(chat.app)} desktop" aria-label="Open in ${esc(chat.app)} desktop"><span>${esc(chat.app)}<span class="wc-desktop"> desktop</span></span>${ic('arrow', 12)}</button>`
    : chat?.opensApp ? `<button type="button" class="wc-act" data-act="open-desktop" data-line="${esc(l.id)}" data-agent="${esc(chat.agent)}" title="Open ${esc(chat.opensApp)}" aria-label="Open ${esc(chat.opensApp)}"><span>${esc(chat.opensApp)}</span>${ic('arrow', 12)}</button>`
    : chat?.terminal ? `<button type="button" class="wc-act wc-cmd" data-act="copy-command" data-command="${esc(chat.terminalFull || chat.terminal)}" aria-label="Copy this command" title="Copy command: ${esc(chat.terminalFull || chat.terminal)}">${endFirst(chat.terminal, chat.terminalFull || chat.terminal)}${ic('copy', 12)}</button>` : '';
  // Both files by their full path, ready to paste into another agent or chat.
  const p = project(), root = p?.vault?.path || p?.docsPath || '';
  const full = rel => !rel || /^(?:\/|[A-Za-z]:[\\/])/.test(rel) || !root ? rel : `${root.replace(/[\\/]+$/, '')}/${rel}`;
  const workAbs = s.detail && root ? full(s.detail) : '';
  const lineAbs = l.topicAbsolutePath || (l.topicPath && root ? full(l.topicPath) : '');
  const refs = [workAbs && `Work file: ${workAbs}`, lineAbs && `Line file: ${lineAbs}`].filter(Boolean).join('\n');
  const file = s.detail && refs
    ? `<span class="wc-split"><button type="button" class="wc-split-main lpp-doc" data-act="preview-work-file" data-doc="${esc(s.detail)}" title="Open Work file (${esc(full(s.detail))})">${ic('doc', 12)}<span>Work file</span></button><button type="button" class="wc-split-copy" data-act="copy-refs" data-refs="${esc(refs)}" aria-label="Copy Work and Line file paths" title="${esc(`Copy paths\n${refs}`)}">${ic('copy', 12)}</button></span>`
    : s.detail
      ? `<button type="button" class="wc-act lpp-doc" data-act="preview-work-file" data-doc="${esc(s.detail)}" title="Open Work file (${esc(full(s.detail))})">${ic('doc', 12)}<span>Work file</span></button>`
      : refs
        ? `<button type="button" class="wc-act" data-act="copy-refs" data-refs="${esc(refs)}" aria-label="Copy Line file path" title="${esc(`Copy path\n${refs}`)}">${ic('copy', 12)}<span>Copy path</span></button>`
        : '';
  const folder = l.workdir ? `<button type="button" class="wc-folder" data-act="copy-path" data-path="${esc(l.workdir)}" aria-label="Copy this folder's path" title="Copy folder path: ${esc(l.workdir)}">${ic('files', 12)}${endFirst(shortPath(l.workdir), l.workdir)}<span class="wc-copy-ic">${ic('copy', 11)}</span></button>` : '';
  const branch = l.branch ? `<span class="wc-branch" title="${esc(l.branch)}">${ic('branch', 12)}<code>${esc(l.branch)}</code></span>` : '';
  const place = folder || branch ? `<span class="wc-place${folder ? '' : ' is-branch-only'}">${folder}${branch}</span>` : '';
  const model = typeof WORK_PRICING !== 'undefined' ? WORK_PRICING.modelOf(s) : '', effort = s.picked?.effort || s.selected?.effort;
  const how = who && who !== 'you' ? `<span class="wc-how">${model || effort
    ? `${model ? `<code title="${esc(model)}">${esc(model)}</code>` : '<span>Model not recorded</span>'}<span class="wc-sep" aria-hidden="true">·</span>${effort ? `<span>${esc(effort)} effort</span>` : '<span>effort not recorded</span>'}`
    : '<span>Model and effort not recorded</span>'}</span>` : '';
  return { acts:[way, file].filter(Boolean).join(''), meta:[place, how].filter(Boolean).join('') };
}
const whereActions = (l, s) => whereParts(l, s).acts;
function whereCard(l, s) {
  const { meta } = whereParts(l, s);
  return meta ? `<section class="where-card" aria-label="Where this work is">${meta}</section>` : '';
}
function panelExpandButton() {
  const on = Boolean(S.panelPopped);
  const label = on ? 'Back to side panel' : 'Larger view';
  return `<button type="button" class="icon-btn lpp-expand" data-act="panel-pop" aria-pressed="${on}" aria-label="${label}" title="${label}">${ic(on ? 'collapse' : 'expand', 16)}</button>`;
}
function ensurePanelBackdrop(page = $('#linePage')) {
  if (!page) return null;
  let back = $('#lpPanelBackdrop', page);
  if (!back) {
    back = document.createElement('div');
    back.className = 'lp-panel-backdrop';
    back.id = 'lpPanelBackdrop';
    back.hidden = true;
    const panel = $('#lpPanel', page);
    if (panel) page.insertBefore(back, panel); else page.append(back);
  }
  if (!back.dataset.bound) {
    back.dataset.bound = '1';
    let hadMenuOnDown = false;
    back.addEventListener('pointerdown', () => { hadMenuOnDown = typeof $ === 'function' && Boolean($('#menu')); }, true);
    back.addEventListener('click', e => {
      if (e.target !== back) return;
      if (hadMenuOnDown) { hadMenuOnDown = false; return; }
      setPanelPopped(false, { focus:true });
    });
  }
  return back;
}
function syncPanelPop() {
  const page = $('#linePage'), panel = $('#lpPanel');
  if (!page || !panel) { S.panelPopped = false; return false; }
  const head = $('#lppHead', panel);
  const allowed = Boolean(S.lineSel && head && !panel.hidden && workPanelDocked());
  if (!allowed) S.panelPopped = false;
  const on = Boolean(S.panelPopped);
  page.classList.toggle('panel-popped', on);
  panel.classList.toggle('is-popped', on);
  if (on) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
  }
  const back = on ? ensurePanelBackdrop(page) : $('#lpPanelBackdrop', page);
  if (back) back.hidden = !on;
  const btn = $('[data-act="panel-pop"]', panel);
  if (btn) {
    const label = on ? 'Back to side panel' : 'Larger view';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const holder = document.createElement('span');
    holder.innerHTML = ic(on ? 'collapse' : 'expand', 16);
    const svg = $('svg', btn), nextSvg = holder.firstElementChild;
    if (svg && nextSvg) svg.replaceWith(nextSvg);
    else if (!svg && nextSvg) btn.append(nextSvg);
  }
  return on;
}
function setPanelPopped(next, { focus = false } = {}) {
  const want = Boolean(next) && Boolean(S.lineSel) && Boolean($('#lppHead')) && !$('#lpPanel')?.hidden && workPanelDocked();
  const changed = Boolean(S.panelPopped) !== want;
  S.panelPopped = want;
  syncPanelPop();
  if (changed) {
    const p = typeof project === 'function' ? project() : null;
    const l = p && typeof lineById === 'function' ? lineById(p, S.route?.line) : null;
    const s = l && S.lineSel ? (typeof stationById === 'function' ? stationById(l, S.lineSel.id) : S.lineSel) : null;
    const head = $('#lppHead');
    if (head && l && s) head.dataset.h = panelHead(l, s);
    if (s && $('#lppRows') && typeof paintRows === 'function') paintRows(p, l, s);
  }
  if (focus) $('#lpPanel [data-act="panel-pop"]')?.focus({ preventScroll:true });
}
function panelHead(l, s) {
  if (isOrchReview(s)) return orchReviewPanelHead(l, s);
  if (s.kind === 'meeting' && typeof meetingPanelHead === 'function') return meetingPanelHead(l, s);
  const chip = s.finished && s.state === 'wait' ? 'ready' : s.state === 'active' ? 'working' : s.state === 'done' ? 'landed' : s.state === 'wait' ? 'wait' : s.state === 'error' ? 'error' : s.state === 'off' ? 'off' : 'todo';
  const text = s.finished && s.state === 'wait' ? 'Finished' : s.state === 'off' ? (s.off === 'stopped' && ['error', 'limit'].includes(s.stopWhy) ? 'Stopped' : offText(s)) : { done:'Done', active:'Working', wait:'Needs you', error:'Stopped', todo:'Not started' }[s.state];
  const target = followedStopTarget(l, s);
  const discard = isWork(s) && s.state === 'error' && !l.archived && !l.closed ? `<button type="button" class="btn sm" data-act="discard-work" data-line="${esc(l.id)}" data-step="${esc(s.id)}">Discard</button>` : isQueued(l, s) ? unqueueButton(l, s, l.stations.find(x => isWork(x) && x.state === 'active')) : '';
  return `<div class="lpp-title"><h2>${esc(s.toReview && s.kind === 'merge' ? 'Merge' : stepLabel(s))}</h2>${isEnd(s) ? '' : `<span class="chip c-${chip}">${esc(text)}</span>`}${s.agent && s.agent !== 'you' ? `<span class="lpp-who">${av(s.agent, 20)}<span class="lpp-who-name">${esc(agentInfo(s.agent).name)}</span></span>` : ''}${s.took && !isEnd(s) ? `<time>${esc(s.took)}</time>` : ''}${ratingBadge(s)}${orchRatingBadge(s)}</div>
    <div class="lpp-tools">${continueButton(l, s)}${target ? followedStopButton(l, s, target) : ''}${reviewMark(l, s)}${discard}${panelExpandButton()}<button type="button" class="icon-btn" data-act="panel-close" aria-label="Close">${ic('x', 18)}</button></div>`;
}
function panelBody(p, l, s) {
  if (isOrchReview(s)) {
    // What the reviewer did sits under Details, as a Work's steps do, and shows live while it reads.
    const open = detailsOpen(s);
    return `<div class="lpp-scroll" id="lppScroll">
      <div id="lppLive"></div>
      <div id="lppOrchReview"></div>
      <div class="lpp-more-in" id="lppDetails" ${open ? '' : 'hidden'}><section class="act" id="lppRows" aria-label="What the reviewer did"></section></div>
    </div>
    <footer class="lpp-bottom">
      <div class="lpp-bottom-bar">
        <button type="button" class="lpp-foot" id="lppFoot" data-act="panel-details" data-step="${esc(s.id)}" aria-expanded="${open}" aria-controls="lppDetails"><span>Details<span id="lppCount"></span></span>${ic(open ? 'down' : 'up', 14)}</button>
        <div class="lpp-foot-acts" id="lppWhereActs"><button type="button" class="wc-act" data-act="line-work" data-line="${esc(l.id)}" data-step="${esc(s.workId)}"><span>Open ${esc(s.workLabel)}</span>${ic('right', 12)}</button></div>
      </div>
      <div id="lppWhere">${orchReviewPanelWhere(l, s)}</div>
    </footer>`;
  }
  if (s.kind === 'meeting' && typeof meetingPanelBody === 'function') return meetingPanelBody(p, l, s);
  // Finished with nothing merged has no merge to show, even on a Topic that once had a branch.
  if (s.kind === 'merge' && (s.state === 'wait' || (s.state === 'done' && !s.finished))) return `<div class="lpp-scroll" id="lppScroll">${mergePanel(p, l, s)}</div>`;
  if (s.kind === 'deliver' || s.finished) {
    const files = topicFiles(p, l), folders = topicFolders(p, l);
    return `<div class="lpp-scroll" id="lppScroll"><div class="sc-todo">${ic(s.isTodo ? 'box' : 'check', 30)}<h3>${s.state === 'todo' ? 'Not finished yet' : stepLabel(s)}</h3>${files.length || folders.length ? `<div class="msg-files center">${folders.map(folderChip).join('')}${files.map(fileChip).join('')}</div>` : ''}</div></div>`;
  }
  const latest = latestWork(l) === s, open = detailsOpen(s);
  return `<div class="lpp-scroll" id="lppScroll">
    <div class="lpp-summary">
      <div id="lppTokens">${typeof tokenWorkHTML === 'function' ? tokenWorkHTML(s,l.id) : ''}</div>
      <div id="lppResultTools"></div>
    </div>
    <div id="lppLive"></div>
    <section class="result" id="lppResult" aria-label="Result"></section>
    <div class="result-files" id="lppDocs"></div>
    ${latest ? `<div id="lppMade">${panelMade(p, l)}</div>` : ''}
    <div class="lpp-more-in" id="lppDetails" ${open ? '' : 'hidden'}>
      <section class="act" id="lppRows" aria-label="What the agent did"></section>
      <div id="lppChanges"></div>
    </div>
  </div>
  <footer class="lpp-bottom">
    <div class="lpp-bottom-bar">
      <button type="button" class="lpp-foot" id="lppFoot" data-act="panel-details" data-step="${esc(s.id)}" aria-expanded="${open}" aria-controls="lppDetails"><span>Details<span id="lppCount"></span></span>${ic(open ? 'down' : 'up', 14)}</button>
      <div class="lpp-foot-acts" id="lppWhereActs">${whereActions(l, s)}</div>
    </div>
    <div id="lppWhere">${whereCard(l, s)}</div>
  </footer>`;
}
const detailsOpen = s => Boolean(S.detailsShown?.[s.id] ?? (s.state === 'active' || s.state === 'error' || s.asked));
// What the agent made that is not a picture. A prototype runs right here.
function panelMade(p, l) {
  const proto = `files/${l.slug}/prototype.html`, hasProto = fileEntry(p, proto), files = resultFiles(p, l).filter(f => f.path !== proto), folders = topicFolders(p, l);
  return `${hasProto ? `<div class="conv-proto pf"><div class="pf-bar"><i></i><i></i><i></i><span>prototype.html</span><a class="btn sm" href="${esc(fileUrl(p, proto, true))}">${ic('down', 14)}Download</a></div><iframe class="pf-frame" sandbox="allow-scripts" src="${esc(assetUrl(p, proto))}" title="Prototype"></iframe></div>` : ''}${files.length || folders.length ? `<div class="conv-files msg-files">${folders.map(folderChip).join('')}${files.map(fileChip).join('')}</div>` : ''}`;
}
// What a Work's result holds, for showing and for copying alike.
function resultParts(p, s, md) {
  const pics = s.pictures.filter(pic => fileEntry(p, pic.path)), raw = md ? mdSection(md, 'Result') : '', text = raw || (s.state === 'todo' ? '' : s.out), stopped = s.state === 'active' ? '' : md ? mdSection(md, 'Stopped') : s.state === 'error' ? s.why : '';
  const links = LINE_STATUS.markdownLinks(raw).map(link => ({ name:link.name, path:linkedPath(s.detail, link.href) })).filter(f => fileEntry(p, f.path) && !pics.some(pic => pic.path === f.path));
  return { pics, text, stopped, links };
}
// ---------- Copy: the raw words, with what is attached ----------
const docsFile = (p, rel) => `${p.vault.path.replace(/[\\/]+$/, '')}/${rel}`;
const isPicturePath = path => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
const copiedLabel = paths => filesLabel({ attachments:paths.length, what:paths.every(isPicturePath) ? 'picture' : 'file' });
const canCopyFiles = () => S.thisComputer && /Mac/.test(navigator.platform);
// Words and files never share a paste: Claude's box and OpenCode's keep only the files and cancel the words, and Codex's keeps only the words. So each has a button of its own, and your words are never at risk.
const filesApart = paths => paths.length > 0 && canCopyFiles();
// Where a file has no button of its own, its path is what reaches the agent. In the form a pasted Ask takes, so PenEcho still tells your words from the list if this comes back from a conversation.
// What it refers to comes first, so your own words are read last, as the request.
const copyForm = (p, { words, paths, refers = [] }) => [...refers, String(words || '').trim(), paths.length && !filesApart(paths) ? ['Attached:', ...paths.map(rel => docsFile(p, rel))].join('\n') : ''].filter(Boolean).join('\n\n');
// A quote as the server tells it: background, each line marked, so an agent does not take the earlier words for a new request.
const referForm = (file, { label, words }) => {
  const quoted = String(words || '').split('\n').filter(line => line.trim());
  return [`For context only, not a new request: this refers to ${label} in ${file}${quoted.length ? ', which said:' : '.'}`, ...quoted.map(line => `> ${line}`)].join('\n');
};
function askParts(p, l, s) {
  const paths = (s.files || []).filter(f => fileEntry(p, f.path)).map(f => f.path);
  return { words:askOnly(s.text), paths, refers:(s.refers || []).map(r => referForm(docsFile(p, (r.step && stationById(l, r.step)?.detail) || l.topicPath), r)) };
}
// What a Work has attached is what its panel shows: its pictures, the files its result links to, and on the latest Work the files made on this line.
function workParts(p, l, s, md) {
  const { pics, links, text, stopped } = resultParts(p, s, md), made = latestWork(l) === s ? resultFiles(p, l) : [];
  return { words:text || stopped, paths:[...new Set([...pics, ...links, ...made].map(f => f.path))] };
}
const copyForcedKeys = new Map();
const copyPartsOf = async (p, l, s) => {
  if (s.kind === 'ask') return askParts(p, l, s);
  let md = '';
  if (s.detail) {
    const known = docById(s.detail, p), entryMtime = fileEntry(p, s.detail)?.mtime || 0;
    const settled = s.state !== 'active' && s.state !== 'todo';
    const hasKnownResult = Boolean(known?.md && mdSection(known.md, 'Result'));
    const missing = settled && Boolean(s.out) && !hasKnownResult;
    const forceKey = `${p.id}|${s.detail}|${s.state}|${s.out || ''}|${entryMtime}`;
    const force = missing && copyForcedKeys.get(s.detail) !== forceKey;
    try {
      const doc = await loadDoc(p, s.detail, { force });
      md = doc?.md || '';
      if (force && (mdSection(md, 'Result') || !mdSection(md, 'Now'))) copyForcedKeys.set(s.detail, forceKey);
    } catch {
      if (hasKnownResult) md = known.md;
      else if (settled) throw new Error('Could not load the full result. Try again.');
      else md = known?.md || '';
    }
  }
  return workParts(p, l, s, md);
};
const copiedNow = (l, s) => (S.copied?.line === l.id && S.copied.step === s.id ? S.copied : null);
function copyButtons(s, { words, paths, refers = [] }, cls, size) {
  const step = `data-step="${esc(s.id)}"`, apart = filesApart(paths);
  return `${apart && !(words || refers.length) ? '' : `<button type="button" class="${cls} lp-copy-btn" data-act="copy-step" ${step}>${ic('copy', size)}${apart ? 'Copy text' : 'Copy'}</button>`}${apart ? `<button type="button" class="${cls} lp-copy-btn" data-act="copy-files" ${step}>${ic('clip', size)}Copy ${esc(copiedLabel(paths))}</button>` : ''}`;
}
// A result's copy: one Copy, or Copy ▾ when words and files go apart. Just after the words were copied, the files are one click away.
function resultCopyHTML(l, s, copying) {
  const { words, paths } = copying;
  if (!filesApart(paths) || !words) return copyButtons(s, copying, 'btn sm', 14);
  if (copiedNow(l, s)) return `<button type="button" class="btn sm lp-copy-btn" data-act="copy-files" data-step="${esc(s.id)}">${ic('clip', 14)}Copy ${esc(copiedLabel(paths))}</button>`;
  return `<button type="button" class="btn sm lp-copy-btn" data-act="copy-menu" data-step="${esc(s.id)}" data-files="${esc(copiedLabel(paths))}" aria-haspopup="menu">${ic('copy', 14)}Copy${ic('down', 12)}</button>`;
}
ACT['copy-menu'] = el => openMenu(el, [
  { label:'Copy text', icon:'copy', fn:() => ACT['copy-step'](el) },
  { label:`Copy ${el.dataset.files}`, icon:'clip', fn:() => ACT['copy-files'](el) },
], { align:'right' });
ACT['copy-step'] = async el => {
  const p = project(), l = lineById(p, S.route.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  let parts;
  try { parts = await copyPartsOf(p, l, s); }
  catch (err) { toast(err?.message || 'Could not load the full result. Try again.'); return; }
  const { paths } = parts;
  await copyText(copyForm(p, parts), filesApart(paths) ? `Copied the text. Paste it, then copy ${copiedLabel(paths)}.` : 'Copied');
  S.copied = paths.length ? { line:l.id, step:s.id } : null;
  refreshLine();
};
ACT['copy-files'] = async el => {
  const p = project(), l = lineById(p, S.route.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  let parts;
  try { parts = await copyPartsOf(p, l, s); }
  catch (err) { toast(err?.message || 'Could not load the full result. Try again.'); return; }
  const { paths } = parts;
  // If the files cannot go on the clipboard, where they are still can.
  if (!await pasteboard({ paths })) { await copyText(paths.map(rel => docsFile(p, rel)).join('\n'), 'Could not copy the files, so their paths are copied instead.'); return; }
  toast(`Copied ${copiedLabel(paths)}. Press ${/Mac/.test(navigator.platform) ? '⌘V' : 'Ctrl+V'} in the same box.`);
  S.copied = null;
  refreshLine();
};
// A picture the result links to is shown above it, or as a file under it, so Reading leaves out its Markdown instead of showing "!Title".
const withoutShownPictures = (p, s, pics, text) => (s.detail ? String(text).replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (m, href) => { const at = linkedPath(s.detail, href); return pics.some(pic => pic.path === at) || fileEntry(p, at) ? '' : m; }) : text);
function resultToolsHTML(p, l, s, md) {
  const ask = typeof workAsking === 'function' ? workAsking(l, s) : (s?.asking || (l?.asking && (!l.asking.step || l.asking.step === s?.id) ? l.asking : null));
  if (ask?.kind === 'tool' || s.state === 'todo') return '';
  const { pics, text, stopped } = resultParts(p, s, md);
  if (s.state === 'off' && !text && !pics.length && !stopped && !(isWork(s) && stopWhyWords(s))) return '';
  const source = S.resultMode === 'source', copying = workParts(p, l, s, md), canCopy = copying.words || copying.paths.length;
  // Copy and the source switch sit beside the token summary, above the result (PE-562).
  const tools = text ? `<button type="button" class="icon-btn lpp-src" data-act="result-mode" data-mode="${source ? 'read' : 'source'}" aria-pressed="${source}" aria-label="Markdown source" title="${source ? 'Back to reading' : 'Markdown source'}">${ic('code', 16)}</button>` : '';
  return tools || canCopy ? `<div class="lpp-result-tools${source || copiedNow(l, s) ? ' is-held' : ''}">${canCopy ? `<div class="lpp-copy">${resultCopyHTML(l, s, copying)}</div>` : ''}${tools}</div>` : '';
}
function resultHTML(p, l, s, doc) {
  const md = doc?.md;
  const { pics, text, stopped, links } = resultParts(p, s, md), source = S.resultMode === 'source';
  const ask = typeof workAsking === 'function' ? workAsking(l, s) : (s?.asking || (l?.asking && (!l.asking.step || l.asking.step === s?.id) ? l.asking : null));
  if (ask?.kind === 'tool') return askedHTML(l, s);
  if (s.state === 'todo') return `<p class="muted lpp-empty">Not started yet.</p>`;
  const why = isWork(s) ? stopWhyWords(s) : '';
  if (s.state === 'off' && !text && !pics.length && !stopped && !why) return `<p class="muted lpp-empty">${s.off === 'discarded' ? 'Discarded.' : 'Stopped before it started.'}</p>`;
  // An error says what went wrong under its plain words; a limit or your Stop says all there is in them.
  const raw = stopped && (!why || stopWhyOf(s) === 'error') ? stopped : '';
  const panelChooser = topicChooserHTML(p, l, s, { inPanel:true });
  return `${stopped || why ? `<div class="at-error ${s.state === 'off' ? 'is-off' : ''}" role="alert">${ic('hint', 16)}<span>${why ? `<strong>${esc(why)}</strong>` : ''}${raw ? `${why ? '<br>' : ''}${esc(raw)}` : ''}</span></div>` : ''}
    ${pics.length ? `<div class="result-pics">${pics.map(pic => `<figure class="lpp-fig">${picButton(p, l, pic, 'result-pic')}<figcaption><span>${esc(pic.title)}</span>${l.archived || l.closed ? '' : `<button type="button" class="link" data-act="conv-about" data-path="${esc(pic.path)}">Ask about this</button>`}</figcaption></figure>`).join('')}</div>` : ''}
    ${text ? `<div class="result-text">${source ? `<div class="src">${highlightSource(text)}</div>` : `<div class="at-say">${sayHTML(withoutShownPictures(p, s, pics, text), (label, href) => workFileAnchor(label, href, p, doc || { path:s.detail }))}</div>`}</div>` : !pics.length && !stopped && s.state === 'done' ? '<p class="muted lpp-empty">The agent left no message for this one.</p>' : ''}
    ${links.length ? `<div class="result-files">${links.map(f => fileChip({ path:f.path, workPreview:true })).join('')}</div>` : ''}
    ${panelChooser}
    ${l.archived || l.closed ? '' : `<div class="lpp-actions" role="group" aria-label="Work actions"><button type="button" class="lpp-act-btn" data-act="line-refer" data-step="${esc(s.id)}">${ic('refer', 13.5)}<span>Refer</span></button>${workReviewButtonHTML(p, l, s)}</div>`}
    ${orchRateCardHTML(s, l)}
    ${rateBoxHTML(l, s)}`;
}
async function fillPanel(p, l, s) {
  if (typeof isOrchReview === 'function' && isOrchReview(s)) {
    const paintReviewCard = () => {
      const host = $('#lppOrchReview');
      if (!host) return;
      const next = orchReviewPanelHTML(p, l, s);
      if (host.dataset.h !== next) { host.dataset.h = next; host.innerHTML = next; }
    };
    paintReviewCard();
    if (s.reviewing && S.detailsShown?.[s.id] === undefined) {
      const box = $('#lppDetails'), foot = $('#lppFoot');
      if (box?.hidden) {
        box.hidden = false;
        if (foot) {
          foot.setAttribute('aria-expanded', 'true');
          $('svg', foot)?.replaceWith(Object.assign(document.createElement('span'), { innerHTML:ic('down', 14) }).firstElementChild);
        }
      }
    }
    if ($('#lppRows')) {
      await loadActivity(p, l).catch(() => {});
      if (s.detail && typeof loadDoc === 'function' && !rowsOfStep(activityOf(p, l), s).length) {
        await loadDoc(p, s.detail).catch(() => {});
      }
      if (S.cur === p.id && S.lineSel?.id === s.id) {
        paintRows(p, l, s);
        if (S.reviewPanelMode === 'raw') paintReviewCard();
      }
    }
    return;
  }
  if (s.kind === 'meeting' && typeof fillMeetingPanel === 'function') { await fillMeetingPanel(p, l, s); return; }
  const tokenHost = $('#lppTokens');
  if (tokenHost && typeof tokenWorkHTML === 'function') { const next=tokenWorkHTML(s,l.id); if(tokenHost.dataset.h !== next) { tokenHost.dataset.h=next;tokenHost.innerHTML=next; } }
  const stillHere = () => S.cur === p.id && S.lineSel?.id === s.id && S.route.view === 'line' && S.route.line === l.id;
  const host = $('#lppResult');
  if (host) {
    const first = s.detail ? docById(s.detail, p) : null;
    const paint = doc => {
      const md = doc?.md;
      const cur = document.activeElement;
      const ask = typeof workAsking === 'function' ? workAsking(l, s) : (s?.asking || (l?.asking && (!l.asking.step || l.asking.step === s?.id) ? l.asking : null));
      const identity = JSON.stringify([l.id, s.id, s.questionRev, s.waitingReply, ask]);
      const unchanged = host.dataset.prompt === identity;
      if (unchanged && host.contains(cur) && (cur?.closest?.('.q-card') || cur?.classList?.contains('rate-note-input'))) return;
      host.dataset.prompt = identity;
      const scroller = $('#lppScroll'), prevTop = scroller ? scroller.scrollTop : 0;
      const toolsHost = $('#lppResultTools'), tools = resultToolsHTML(p, l, s, md);
      if (toolsHost && toolsHost.dataset.h !== tools) { toolsHost.dataset.h = tools; toolsHost.innerHTML = tools; }
      const next = resultHTML(p, l, s, doc);
      if (host.dataset.h !== next) {
        host.dataset.h = next;
        host.innerHTML = next;
        if (scroller && prevTop) scroller.scrollTop = prevTop;
      }
    };
    paint(first);
    const chooser = host.querySelector?.('.q-card');
    if (chooser && host._revealed !== host.dataset.prompt) {
      host._revealed = host.dataset.prompt;
      chooser.scrollIntoView?.({ block:'nearest' });
    }
    clearTimeout(host._resultRetryTimer);
    host._resultRetryTimer = 0;
    const reqSeq = (host._resultSeq = (host._resultSeq || 0) + 1);
    if (s.detail) {
      const entryMtime = fileEntry(p, s.detail)?.mtime || 0;
      const missingResult = s.state !== 'active' && s.state !== 'todo' && Boolean(s.out) && !(first?.md && mdSection(first.md, 'Result'));
      const missingStopped = s.state === 'error' && !(first?.md && mdSection(first.md, 'Stopped'));
      const forceKey = `${s.detail}|${s.state}|${s.out || ''}|${entryMtime}`;
      const force = (missingResult || missingStopped) && host._forcedResultKey !== forceKey;
      const retries = [1500, 3000, 6000, 10000], staleRetries = [1500, 3000];
      const fetchDetail = (attempt, mustForce, staleAttempt = 0) => loadDoc(p, s.detail, { force:mustForce }).then(doc => {
        if (!stillHere() || $('#lppResult') !== host || host._resultSeq !== reqSeq) return;
        paint(doc);
        const stillMissing = (missingResult && !(doc?.md && mdSection(doc.md, 'Result'))) || (missingStopped && !(doc?.md && mdSection(doc.md, 'Stopped')));
        if (!stillMissing || staleAttempt >= staleRetries.length) {
          if (force) host._forcedResultKey = forceKey;
          return;
        }
        host._resultRetryTimer = setTimeout(() => {
          if (stillHere() && $('#lppResult') === host && host._resultSeq === reqSeq) fetchDetail(attempt, true, staleAttempt + 1);
        }, staleRetries[staleAttempt]);
      }).catch(() => {
        if (!stillHere() || $('#lppResult') !== host || host._resultSeq !== reqSeq || attempt >= retries.length) return;
        host._resultRetryTimer = setTimeout(() => {
          if (stillHere() && $('#lppResult') === host && host._resultSeq === reqSeq) fetchDetail(attempt + 1, true, staleAttempt);
        }, retries[attempt]);
      });
      fetchDetail(0, force);
    }
  }
  // What this piece of work changed. Work older than this page's records counts the branch as a whole, if it is the latest.
  const changes = $('#lppChanges'), wholeBranch = !s.diff && latestWork(l) === s && l.branch && l.diff?.files && !l.landed;
  if (changes && (s.diff || wholeBranch)) api(s.diff ? `${topicApi(p, l, 'diff')}?step=${encodeURIComponent(s.id)}` : topicApi(p, l, 'diff')).then(data => {
    if (!stillHere()) return;
    liveOf(p, l).diff = data;
    const sig = JSON.stringify(data.files.map(f => [f.path, f.add, f.del]));
    if (changes.dataset.sig !== sig) { changes.dataset.sig = sig; changes.innerHTML = changesCard(l, data.files); }
    // Documents this Work changed can be read as they are, before anything is merged. The ones the whole branch changes are on the Memory page.
    const docs = $('#lppDocs');
    if (docs && s.diff && !l.landed && l.branch) { const next = data.files.filter(f => READABLE.test(f.path)).map(f => `<button type="button" class="file-ref" data-act="open-branch-doc" data-line="${esc(l.id)}" data-path="${esc(f.path)}">${ic('doc', 15)}<span>${esc(f.path)}</span></button>`).join(''); if (docs.dataset.h !== next) { docs.dataset.h = next; docs.innerHTML = next; } }
  }).catch(() => {});
  const whole = $('#stepDiff');
  if (whole) api(topicApi(p, l, 'diff')).then(data => { if (stillHere() && $('#stepDiff')) $('#stepDiff').innerHTML = diffHTML(data.files) + (data.truncated ? '<p class="muted">This change is too large to show in full.</p>' : ''); }).catch(() => {});
  if ($('#lppRows')) { await loadActivity(p, l).catch(() => {}); if (stillHere()) paintRows(p, l, s); }
}
function panelInto(p, l, s) {
  const panel = $('#lpPanel'), page = $('#linePage'); if (!panel || !page) return;
  panelRoute = S.route;
  if (S.lineSel?.id !== s?.id) S.reviewPanelMode = 'summary';
  S.lineSel = s || null;
  // With no Work open, the line's Topic, if it is in one (merge.js).
  const shown = typeof topicPlaceHTML === 'function' ? topicPlaceHTML(p, l) : '', topic = s ? '' : shown;
  page.classList.toggle('has-panel', Boolean(s || topic));
  panel.hidden = !s && !topic;
  panel.dataset.step = s?.id || '';
  if (!s) {
    S.panelPopped = false;
    panel.innerHTML = topic;
    panel.dataset.h = topic;
    syncPanelPop();
    return;
  }
  panel.dataset.h = '';
  const head = panelHead(l, s);
  panel.innerHTML = `<header class="lpp-head" id="lppHead">${head}</header>${panelBody(p, l, s)}`;
  const headEl = $('#lppHead', panel);
  if (headEl) headEl.dataset.h = head;
  syncPanelPop();
  if (!panel.dataset.rateBound) {
    panel.dataset.rateBound = '1';
    panel.addEventListener('keydown', e => {
      choiceKeydown(e);
      if (e.key === 'Enter' && e.target.classList?.contains('rate-note-input')) {
        const save = e.target.closest('[data-rate-box]')?.querySelector('.rate-note-save');
        if (save) { e.preventDefault(); save.click(); }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.classList?.contains('q-input')) {
        e.preventDefault();
        e.target.closest('.q-custom')?.querySelector('button[data-act]')?.click();
      }
    });
    panel.addEventListener('input', e => {
      if (!e.target.classList?.contains('q-input')) return;
      const lineId = e.target.dataset.line || '', kind = e.target.dataset.qKind || '', card = e.target.closest('.q-card'), stepId = e.target.dataset.step || card?.dataset.step || '';
      if (kind === 'topic' || kind === 'waiting') {
        saveQDraft(lineId, '__topic__', '__note', e.target.value, card?.dataset.questionRev, stepId);
        syncQDraftUI(lineId);
      } else if (e.target.dataset.req && e.target.dataset.q && e.target.closest('[data-q-block]')?.dataset.qSecret !== '1') {
        saveQDraft(lineId, e.target.dataset.req, e.target.dataset.q, e.target.value, undefined, stepId);
      }
    });
  }
  fillPanel(p, l, s);
}

// ---------- What the agent did ----------
const ACTIVITY = {};
const activityOf = (p, l) => ACTIVITY[`${p.id}:${l.slug}`] ||= { rows:new Map(), seq:0, running:false, started:0, now:'', loaded:false };
async function loadActivity(p, l) {
  // A line still being saved has no file yet, so nothing has run on it.
  if (typeof isSaving === 'function' && isSaving(l.slug)) return false;
  const a = activityOf(p, l), data = await api(topicApi(p, l, `activity?after=${a.seq}`));
  for (const row of data.rows) a.rows.set(row.i, row);
  const changed = data.seq !== a.seq || data.running !== a.running || !a.loaded;
  a.seq = data.seq; a.running = data.running; a.started = data.started; a.now = data.now; a.reviews = data.reviews || {}; a.loaded = true;
  return changed;
}
// Enough Markdown for what agents say: paragraphs, lists, code and tables stay readable, and nothing from it can run.
function inlineSay(text) {
  return esc(text).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1');
}
// The whole reply can link to a web page or a file referenced by its Work. On the map and in lists the words sit inside a button, and a link cannot, so inlineSay keeps only its label.
function sayInline(text, fileLink) {
  const held = [], hold = html => { held.push(html); return `\u0000${held.length - 1}\u0000`; };
  const webLink = (label, url) => hold(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
  // Protect code before parsing links. Escape the label and destination exactly once.
  const codeHeld = String(text ?? '').replace(/\u0000/g, '').replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  const restore = words => words.replace(/\u0000(\d+)\u0000/g, (_, n) => held[+n] || '');
  const linked = replaceMarkdownLinks(holdMath(codeHeld, hold, false), ({ image, name, href }) => {
    if (/^https?:\/\//i.test(href)) return (image ? '!' : '') + webLink(restore(esc(name)), esc(href));
    const anchor = !image && fileLink?.(name, href);
    return anchor ? hold(restore(anchor)) : (image ? '!' : '') + name;
  });
  return esc(linked)
    .replace(/(^|[\s(（])(https?:\/\/[^\s<\u0000]+)/g, (_, before, found) => {
      const url = found.replace(/(?:[.,;:!?。，；：！？）」》]|&#39;|&quot;)+$/, ''), rest = found.slice(url.length);
      return `${before}${webLink(url, url)}${rest}`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => held[+n]);
}
function sayHTML(text, fileLink) {
  const inline = words => sayInline(words, fileLink);
  const out = []; let list = null, para = [], table = null;
  const flush = () => { if (para.length) { out.push(`<p>${para.map(line => inline(line)).join('<br>')}</p>`); para = []; } if (list) { out.push(`<${list.tag}>${list.items.map(x => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`); list = null; } if (table) { const [head, ...body] = table.filter(r => !r.every(c => /^:?-{2,}:?$/.test(c))); out.push(`<div class="say-table"><table><thead><tr>${(head || []).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); table = null; } };
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(MD_FENCE_OPEN);
    if (fence) {
      flush();
      const ch = fence[1][0], len = fence[1].length, code = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].match(MD_FENCE_OPEN);
        if (close && close[1][0] === ch && close[1].length >= len && /^\s*$/.test(lines[i].slice(close[0].length))) break;
        code.push(lines[i++]);
      }
      out.push(`<pre>${esc(code.join('\n'))}</pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) { if (para.length || list) flush(); (table ||= []).push(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())); continue; }
    if (table) flush();
    if (!para.length && /^ {0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/), number = line.match(/^\s*\d+[.)]\s+(.*)$/), heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { flush(); out.push(`<p class="say-h">${inline(heading[1])}</p>`); continue; }
    if (bullet || number) { const tag = bullet ? 'ul' : 'ol'; if (para.length || list?.tag !== tag) flush(); (list ||= { tag, items:[] }).items.push((bullet || number)[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list) flush();
    para.push(line);
  }
  flush();
  return out.join('');
}
function toolRow(row, l) {
  const info = describeToolRow(row, l);
  const icon = row.questions && row.state === 'running' ? ic('hint', 14) : row.state === 'running' ? '<i class="spin"></i>' : row.state === 'failed' ? ic('x', 14) : ic(info.icon || 'check', 14);
  const verbHTML = info.verb ? `<span class="at-verb">${esc(info.verb)}</span>` : '';
  const targetHTML = toolRowTargetHTML(row, info);
  const badgeHTML = info.badge ? `<span class="at-badge is-${esc(info.badgeTone || 'muted')}">${esc(info.badge)}</span>` : '';
  const thumbsHTML = toolRowThumbsHTML(row, l);
  const body = toolBodyHTML(row, info, l, { includeMeta:true });
  const chevHTML = body ? `<span class="at-chev" aria-hidden="true">${ic('right', 11)}</span>` : '';
  const head = `<span class="at-icon">${icon}</span><span class="at-main">${verbHTML}${targetHTML}${chevHTML}</span>${badgeHTML}${thumbsHTML}`;
  return body
    ? `<details class="at s-${esc(row.state)}" data-row="${row.i}"><summary>${head}</summary><div class="at-body">${body}</div></details>`
    : `<div class="at s-${esc(row.state)}" data-row="${row.i}">${head}</div>`;
}
function toolRowThumbsHTML(row, l) {
  if (!row.pictures?.length) return '';
  const shown = row.pictures.slice(0, 2), extra = row.pictures.length - shown.length;
  const src = name => apiUrl(topicApi(project(), l, `activity-picture?name=${encodeURIComponent(name)}`));
  return `<span class="at-row-thumbs" aria-hidden="true">${extra > 0 ? `<span class="at-group-more">+${extra}</span>` : ''}${shown.map(name => `<img class="at-row-thumb" src="${esc(src(name))}" alt="" loading="lazy">`).join('')}</span>`;
}
function toolRowTargetHTML(row, info) {
  if (!info.detail) return '';
  const title = esc(info.fullTitle || info.detail);
  if (info.asCode && (row.verb === 'Read' || row.verb === 'Wrote' || row.verb === 'Edited')) {
    const raw = String(info.detail);
    const slash = raw.lastIndexOf('/');
    if (slash > 0 && slash < raw.length - 1) {
      const dir = raw.slice(0, slash), name = raw.slice(slash + 1);
      return `<span class="at-file" title="${title}"><span class="at-file-name">${esc(name)}</span><span class="at-file-dir">${esc(dir)}</span></span>`;
    }
    return `<span class="at-file" title="${title}"><span class="at-file-name">${esc(raw)}</span></span>`;
  }
  return info.asCode
    ? `<code title="${title}">${esc(info.detail)}</code>`
    : `<span class="at-target" title="${title}">${esc(info.detail)}</span>`;
}
function stripCommandCd(command) {
  let text = String(command || '').trim();
  while (/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/.test(text)) {
    text = text.replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/, '').trim();
  }
  return text;
}
function parseCheckOutcome(kind, output, state) {
  if (state === 'running') return { badge:'Running', tone:'run' };
  const text = String(output || '');
  if (kind === 'test') {
    const nodePass = text.match(/^ℹ pass (\d+)/m), nodeFail = text.match(/^ℹ fail (\d+)/m);
    if (nodePass || nodeFail) {
      const p = Number(nodePass?.[1] || 0), f = Number(nodeFail?.[1] || 0);
      if (f > 0) return { badge:p > 0 ? `${f} failed, ${p} passed` : `${f} failed`, tone:'fail' };
      if (p > 0) return { badge:`${p} passed`, tone:'pass' };
    }
    const genFail = text.match(/\b(\d+)\s+failed\b/i), genPass = text.match(/\b(\d+)\s+(?:passed|passing)\b/i);
    if (genFail && Number(genFail[1]) > 0) {
      const f = Number(genFail[1]), p = Number(genPass?.[1] || 0);
      return { badge:p > 0 ? `${f} failed, ${p} passed` : `${f} failed`, tone:'fail' };
    }
    if (genPass && Number(genPass[1]) > 0) return { badge:`${Number(genPass[1])} passed`, tone:'pass' };
    if (state === 'failed') return { badge:'Failed', tone:'fail' };
    if (state === 'done') return { badge:'Passed', tone:'pass' };
  }
  if (kind === 'browser') {
    const okMatch = text.match(/"ok"\s*:\s*(true|false)/);
    const ceEmpty = /"consoleErrors"\s*:\s*\[\s*\]/.test(text), peEmpty = /"pageErrors"\s*:\s*\[\s*\]/.test(text);
    if (state === 'failed' || okMatch?.[1] === 'false') return { badge:'Failed', tone:'fail' };
    if (okMatch?.[1] === 'true' && ceEmpty && peEmpty) return { badge:'0 errors', tone:'pass' };
    if (okMatch?.[1] === 'true' || state === 'done') return { badge:'Passed', tone:'pass' };
  }
  if (kind === 'build') {
    if (state === 'failed') return { badge:'Failed', tone:'fail' };
    if (state === 'done') return { badge:'Passed', tone:'pass' };
  }
  if (state === 'failed') {
    const code = text.match(/Command exited with code (\d+)/i);
    return { badge:code ? `Exit ${code[1]}` : 'Failed', tone:'fail' };
  }
  return { badge:'', tone:'' };
}
function extractTestNames(clean) {
  const matches = [...clean.matchAll(/(?:^|\s)([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/g)].map(m => m[1].split('/').pop());
  const uniq = [...new Set(matches)];
  if (!uniq.length) return '';
  return uniq.length === 1 ? uniq[0] : `${uniq[0]} (+${uniq.length - 1})`;
}
function beforeShellOp(text) {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '|' || ch === ';' || (ch === '&' && text[i + 1] === '&')) return text.slice(0, i).trim();
  }
  return text.trim();
}
function extractSearchSummary(clean, l) {
  const head = beforeShellOp(clean);
  const qm = head.match(/^(?:rg|grep)\b(?:\s+-[A-Za-z0-9-]+|\s+--[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?)*\s+(?:"([^"]+)"|'([^']+)'|(\S+))(.*)$/);
  if (!qm) return head.slice(0, 120);
  const pattern = (qm[1] ?? qm[2] ?? qm[3] ?? '').trim();
  const rest = (qm[4] || '').replace(/--[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+)|\s+(?:"[^"]*"|'[^']*'|\S+))?/g, '').replace(/\s-[A-Za-z]+/g, '').trim();
  const scope = rest ? rest.split(/\s+/).filter(Boolean).slice(0, 2).map(s => shortTarget(s.replace(/^['"]|['"]$/g, ''), l)).join(', ') : '';
  const pat = pattern.length > 42 ? `${pattern.slice(0, 42)}…` : pattern;
  return scope ? `${pat} in ${scope}` : pat;
}
function describeCommand(command, output, state, summary, l) {
  const raw = String(command || ''), clean = stripCommandCd(raw), firstLine = clean.split('\n')[0].trim();
  let icon = 'code', verb = 'Ran', detail = firstLine.slice(0, 140), asCode = true, checkKind = '';
  const hasTest = /\bnode\s+--test\b|\bnpm\s+(?:run\s+)?test\b|\bpytest\b|\bunittest\b|\bjest\b|\bvitest\b|\bcargo\s+test\b|\bgo\s+test\b/.test(clean);
  const hasBuild = /\bnpm\s+run\s+(?:build|check|lint|typecheck)[\w:-]*|\bnode\s+--check\b|\btsc\b|\beslint\b|\bxcodebuild\b|\bcargo\s+build\b/.test(clean);
  const hasBrowser = /\$(?:env:)?PENECHO_BROWSER_HELPER|browser-call\.js|\bplaywright\b|\bchromium\b|verify-[\w-]+|screenshot/i.test(clean);
  if (/\$(?:env:)?PENECHO_ORCH_HELPER|orch-call\.js/.test(clean)) {
    icon = 'orchestrate'; verb = 'Orchestrator'; asCode = false;
    const action = clean.match(/"do"\s*:\s*"([^"]+)"/)?.[1] || '';
    const route = clean.match(/"route"\s*:\s*"([^"]+)"/)?.[1] || '';
    detail = action === 'decide' && route ? `decide (${route})` : action || 'call';
  } else if (/MEMORY\.md|\.penecho[\\/]memory/.test(clean)) {
    icon = 'memory'; verb = 'Memory'; asCode = false;
    detail = /\.penecho[\\/]memory(?:\.cmd)?['"]?\s+(?:apply|add|replace|delete)/.test(clean) ? 'Updated project memory' : 'Read project memory';
  } else if (hasBrowser) {
    icon = 'liveBrowser'; verb = 'Browser check'; checkKind = 'browser'; asCode = false;
    const page = clean.match(/(?:https?:\/\/[^\s'"\\]+)|([\w-]+\.html)/)?.[0] || '';
    const script = !page ? (clean.match(/\b([\w.-]+\.(?:c?js|mjs|ts))\b/)?.[1] || '') : '';
    detail = page ? page.split('/').pop().slice(0, 80) : script || 'Headless browser';
  } else if (hasTest) {
    icon = 'liveTests'; verb = hasBuild ? 'Build & tests' : 'Tests'; checkKind = 'test'; asCode = false;
    const names = extractTestNames(clean);
    const scripts = [...clean.matchAll(/npm\s+run\s+([\w:-]+)/g)].map(m => m[1]);
    detail = hasBuild && scripts.length ? `${scripts[0]}, ${names || 'tests'}` : names || 'Test suite';
  } else if (hasBuild) {
    icon = 'check'; verb = 'Build & check'; checkKind = 'build'; asCode = false;
    const scripts = [...clean.matchAll(/npm\s+run\s+([\w:-]+)/g)].map(m => m[1]);
    detail = scripts.length ? [...new Set(scripts)].slice(0, 3).join(', ') : firstLine.slice(0, 100);
  } else if (/^git\b/.test(clean)) {
    icon = 'branch'; asCode = false;
    const parts = clean.split('&&').map(s => s.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(p => /^(?:git|ls|npm run check)\b/.test(p))) {
      verb = 'Git';
      detail = parts.map(p => beforeShellOp(p).replace(/^git\s+/, '').slice(0, 44)).slice(0, 2).join(' · ');
    } else {
      const head = beforeShellOp(clean);
      const sub = head.match(/^git\s+(?:-[Cc]\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*([a-z][\w-]*)/)?.[1] || '';
      verb = sub ? `Git ${sub}` : 'Git';
      detail = head.replace(/^git\s+(?:-[Cc]\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*[a-z][\w-]*\s*/, '').trim().slice(0, 100);
    }
  } else if (/^(?:rg|grep)\b/.test(clean)) {
    icon = 'search'; verb = 'Searched'; asCode = false;
    detail = extractSearchSummary(clean, l);
  } else if (/^(?:ls|find|tree|cat|head|tail|sed|wc|stat)\b/.test(clean)) {
    icon = 'read'; verb = /^(?:ls|find|tree)\b/.test(clean) ? 'Listed' : 'Inspected'; asCode = true;
    const head = beforeShellOp(firstLine);
    detail = head.replace(/^(?:ls|find|tree|cat|head|tail|sed|wc|stat)\s+(?:-[A-Za-z0-9]+\s+)*/, '').trim().slice(0, 110) || head.slice(0, 110);
  } else if (/^npm\s+(?:i|install|ci)\b|^pip3?\s+install\b|^brew\s+install\b/.test(clean)) {
    icon = 'pen'; verb = 'Installed'; asCode = false; detail = firstLine.slice(0, 110);
  }
  const outcome = parseCheckOutcome(checkKind, output, state);
  const cleanSummary = typeof summary === 'string' ? summary.trim() : '';
  if (cleanSummary) {
    return {
      icon,
      verb:'',
      detail:cleanSummary,
      asCode:false,
      fullTitle:clean || raw,
      badge:outcome.badge,
      badgeTone:outcome.tone,
      checkKind,
      rawCommand:raw,
    };
  }
  return {
    icon,
    verb,
    detail,
    asCode,
    fullTitle:clean || raw,
    badge:outcome.badge,
    badgeTone:outcome.tone,
    checkKind,
    rawCommand:raw,
  };
}
function describeToolRow(row, l) {
  const v = String(row.verb || ''), t = String(row.target || '');
  if (v === 'Ran' && row.code) return describeCommand(t, row.output, row.state, row.summary, l);
  if (v === 'Read') {
    const file = t ? shortTarget(t, l) : '';
    const detail = file && row.range ? `${file}:${row.range}` : file;
    return { icon:'read', verb:'Read', detail, asCode:true, fullTitle:file || t, badge:row.state === 'failed' ? 'Failed' : '', badgeTone:row.state === 'failed' ? 'fail' : '', checkKind:'', files:file ? [file] : [] };
  }
  if (v === 'Wrote') {
    const file = t ? shortTarget(t, l) : '';
    return { icon:'doc', verb:'Created', detail:file, asCode:true, fullTitle:file || t, badge:row.state === 'failed' ? 'Failed' : '', badgeTone:row.state === 'failed' ? 'fail' : '', checkKind:'', files:file ? [file] : [] };
  }
  if (v === 'Edited') {
    const files = Array.isArray(row.files) && row.files.length ? row.files.map(f => shortTarget(f, l)) : (t ? [shortTarget(t, l)] : []);
    const detail = files.length > 1 ? `${files[0]} (+${files.length - 1})` : (files[0] || t);
    return { icon:'pen', verb:'Edited', detail, asCode:true, fullTitle:files.join(', ') || t, badge:row.state === 'failed' ? 'Failed' : '', badgeTone:row.state === 'failed' ? 'fail' : '', checkKind:'', files };
  }
  if (/^Searched for|^Looked for/.test(v)) return { icon:'search', verb:v, detail:t, asCode:true, fullTitle:t, badge:'', badgeTone:'', checkKind:'' };
  if (/^Searched the web/.test(v)) return { icon:'liveWeb', verb:'Web search', detail:t, asCode:false, fullTitle:t, badge:'', badgeTone:'', checkKind:'' };
  if (v === 'Opened') return { icon:'link', verb:'Opened', detail:t, asCode:false, fullTitle:t, badge:'', badgeTone:'', checkKind:'' };
  if (/helper/.test(v)) return { icon:'orchestrate', verb:'Helper', detail:t, asCode:false, fullTitle:t, badge:'', badgeTone:'', checkKind:'' };
  if (v === 'Updated its plan') {
    const todos = Array.isArray(row.todos) ? row.todos : [];
    const done = todos.filter(x => x.status === 'completed').length;
    const detail = todos.length ? `${done}/${todos.length} done` : t;
    return { icon:'check', verb:'Plan', detail, asCode:false, fullTitle:detail, badge:'', badgeTone:'', checkKind:'' };
  }
  if (v === 'Asked you') return { icon:'hint', verb:'Asked you', detail:row.questions?.[0]?.text || '', asCode:false, fullTitle:row.questions?.[0]?.text || '', badge:'', badgeTone:'', checkKind:'' };
  return { icon:'check', verb:v, detail:t ? shortTarget(t, l) : '', asCode:Boolean(t), fullTitle:t, badge:row.state === 'failed' ? 'Failed' : '', badgeTone:row.state === 'failed' ? 'fail' : '', checkKind:'' };
}
function todoListHTML(todos) {
  if (!Array.isArray(todos) || !todos.length) return '';
  return `<ul class="at-todos">${todos.map(item => {
    const st = item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'active' : 'pending';
    const mark = st === 'done' ? ic('check', 12) : st === 'active' ? '<i class="spin" aria-hidden="true"></i>' : '<i class="at-todo-dot" aria-hidden="true"></i>';
    return `<li class="is-${st}"><span class="at-todo-mark">${mark}</span><span>${esc(item.text)}</span></li>`;
  }).join('')}</ul>`;
}
function toolBodyHTML(row, info, l, { includeMeta = false } = {}) {
  const parts = [];
  if (Array.isArray(row.todos) && row.todos.length) parts.push(todoListHTML(row.todos));
  if (includeMeta && Array.isArray(row.files) && row.files.length > 1) {
    parts.push(`<pre>${esc(row.files.map(f => (l ? shortTarget(f, l) : f)).join('\n'))}</pre>`);
  } else if (includeMeta && !row.code && (info.fullTitle || row.target)) {
    const label = info.fullTitle || (l ? shortTarget(row.target, l) : row.target);
    const full = row.range && !String(label).endsWith(`:${row.range}`) ? `${label}:${row.range}` : label;
    if (full) parts.push(`<div class="at-meta"><code>${esc(full)}</code></div>`);
  }
  const rawCmd = row.code && info.rawCommand ? `$ ${info.rawCommand}` : '';
  const out = String(row.output || '');
  if (rawCmd || out) parts.push(`<pre>${rawCmd && out ? `${esc(rawCmd)}\n\n${esc(out)}` : esc(rawCmd || out)}</pre>`);
  if (l && row.pictures?.length) parts.push(toolPictures(row, l));
  return parts.join('');
}
function briefFileChipHTML(entry) {
  const base = entry.path.split(/[\\/]/).filter(Boolean).pop() || entry.path;
  const prefix = entry.created ? '+' : '';
  const mult = entry.count > 1 ? `<em>×${entry.count}</em>` : '';
  return `<button type="button" class="at-chip${entry.created ? ' is-new' : ''}" data-act="act-jump" data-row="${entry.lastRow}" title="${esc(entry.path)}">${prefix ? `<b class="at-chip-plus" aria-hidden="true">+</b>` : ''}<span>${esc(base)}</span>${mult}</button>`;
}
function briefCheckHTML(item, rowPrefix) {
  const { row, info } = item;
  const icon = row.state === 'running' ? '<i class="spin" aria-hidden="true"></i>' : row.state === 'failed' ? ic('x', 13) : ic('check', 13);
  const label = [info.verb, info.detail].filter(Boolean).join(' · ') || row.verb || 'Check';
  const badge = info.badge ? `<span class="at-badge is-${esc(info.badgeTone || 'muted')}">${esc(info.badge)}</span>` : '';
  const body = toolBodyHTML(row, info);
  const head = `<span class="at-check-ic">${icon}</span><span class="at-check-label" title="${esc(info.fullTitle || label)}">${esc(label)}</span>${badge}`;
  return body
    ? `<details class="at-check s-${esc(row.state)}" data-row="${rowPrefix}-${row.i}"><summary>${head}</summary>${body}</details>`
    : `<div class="at-check s-${esc(row.state)}">${head}</div>`;
}
// Structured progress briefing at the top of a Work's Details: plan, files changed, checks/tests, issues, and explored files.
function activityBriefHTML(rows, l) {
  const changed = new Map(), read = new Map(), checks = [], issues = [];
  let latestTodos = null;
  for (const row of rows) {
    if (row.kind !== 'tool') continue;
    const info = describeToolRow(row, l);
    if (Array.isArray(row.todos) && row.todos.length) latestTodos = row.todos;
    if (row.verb === 'Edited' || row.verb === 'Wrote') {
      const files = info.files?.length ? info.files : [];
      for (const filePath of files) {
        if (!filePath || /^\.{1,2}$/.test(filePath)) continue;
        const prev = changed.get(filePath);
        if (prev) { prev.count++; prev.lastRow = row.i; }
        else changed.set(filePath, { path:filePath, created:row.verb === 'Wrote', count:1, lastRow:row.i });
      }
    } else if (row.verb === 'Read') {
      const filePath = info.files?.[0] || '';
      if (filePath && !/^\.{1,2}$/.test(filePath)) {
        const prev = read.get(filePath);
        if (prev) { prev.count++; prev.lastRow = row.i; read.delete(filePath); read.set(filePath, prev); }
        else read.set(filePath, { path:filePath, created:false, count:1, lastRow:row.i });
      }
    }
    if (info.checkKind) {
      checks.push({ row, info });
    } else if (row.state === 'failed') {
      issues.push({ row, info });
    }
  }
  const changedList = [...changed.values()];
  const readList = [...read.values()].filter(entry => !changed.has(entry.path)).reverse();
  const hasSubstance = Boolean(latestTodos?.length || changedList.length || checks.length || issues.length || readList.length >= 2);
  if (!hasSubstance) return '';
  const sections = [];
  if (latestTodos?.length) {
    const done = latestTodos.filter(x => x.status === 'completed').length;
    sections.push(`<div class="at-brief-row at-brief-plan"><span class="at-brief-k">Plan<em>${done}/${latestTodos.length}</em></span><div class="at-brief-v">${todoListHTML(latestTodos)}</div></div>`);
  }
  if (changedList.length) {
    const head = changedList.slice(0, 6), rest = changedList.slice(6);
    const chips = `${head.map(briefFileChipHTML).join('')}${rest.length ? `<details class="at-brief-more" data-group="brief-changed"><summary>+${rest.length} more</summary><div class="at-chips">${rest.map(briefFileChipHTML).join('')}</div></details>` : ''}`;
    sections.push(`<div class="at-brief-row"><span class="at-brief-k">Changed<em>${changedList.length}</em></span><div class="at-brief-v at-chips">${chips}</div></div>`);
  }
  if (checks.length) {
    const ordered = [...checks].reverse(), shown = ordered.slice(0, 4), rest = ordered.slice(4);
    const items = `${shown.map(item => briefCheckHTML(item, 'brief-chk')).join('')}${rest.length ? `<details class="at-brief-more" data-group="brief-checks"><summary>+${rest.length} earlier ${rest.length === 1 ? 'check' : 'checks'}</summary><div class="at-checks">${rest.map(item => briefCheckHTML(item, 'brief-chk')).join('')}</div></details>` : ''}`;
    sections.push(`<div class="at-brief-row"><span class="at-brief-k">Checks<em>${checks.length}</em></span><div class="at-brief-v at-checks">${items}</div></div>`);
  }
  if (issues.length) {
    const shown = [...issues].reverse().slice(0, 3);
    sections.push(`<div class="at-brief-row"><span class="at-brief-k is-fail">Issues<em>${issues.length}</em></span><div class="at-brief-v at-checks">${shown.map(item => briefCheckHTML(item, 'brief-err')).join('')}</div></div>`);
  }
  if (readList.length) {
    const head = readList.slice(0, 6), rest = readList.slice(6);
    const chips = `${head.map(briefFileChipHTML).join('')}${rest.length ? `<details class="at-brief-more" data-group="brief-read"><summary>+${rest.length} more</summary><div class="at-chips">${rest.map(briefFileChipHTML).join('')}</div></details>` : ''}`;
    sections.push(`<div class="at-brief-row"><span class="at-brief-k">${changedList.length ? 'Also read' : 'Read'}<em>${readList.length}</em></span><div class="at-brief-v at-chips">${chips}</div></div>`);
  }
  return `<section class="at-brief" aria-label="Work progress summary">${sections.join('')}</section>`;
}
function liveFooterText(rows, l, a, s, reviewStep) {
  const running = rows.filter(r => r.kind === 'tool' && r.state === 'running');
  if (running.length > 1) return `Running ${running.length} steps in parallel`;
  if (running.length === 1) {
    const info = describeToolRow(running[0], l);
    return [info.verb, info.detail].filter(Boolean).join(' · ') || stepNow(a, s);
  }
  const last = rows[rows.length - 1];
  if (last?.kind === 'retry' && last.text) return last.text;
  if (reviewStep) return stepNow(a, s);
  if (rows.some(r => r.kind === 'tool')) return 'Thinking…';
  return stepNow(a, s);
}
// What the agent saw when it read a picture, as its own app shows it.
function toolPictures(row, l) {
  if (!row.pictures?.length) return '';
  const src = name => apiUrl(topicApi(project(), l, `activity-picture?name=${encodeURIComponent(name)}`));
  return `<div class="at-pictures">${row.pictures.map(name => `<a href="${esc(src(name))}" target="_blank" rel="noopener"><img src="${esc(src(name))}" alt="" loading="lazy"></a>`).join('')}</div>`;
}
// Agents report real paths, and a folder can be reached through a link (macOS's /var and /private/var), so both spellings count.
const samePrefix = (text, folder) => [folder, `/private${folder}`].find(x => x && (text === x || text.startsWith(`${x}/`)));
function shortTarget(target, l) {
  const text = String(target), work = samePrefix(text, l.workdir), docs = samePrefix(text, project()?.vault?.path);
  if (work) return text.slice(work.length).replace(/^\//, '') || '.';
  return docs ? `docs/${text.slice(docs.length).replace(/^\//, '')}` : shortPath(text);
}
function toolGroupFile(target, l) {
  const short = target ? shortTarget(target, l) : '';
  const name = short ? short.split(/[\\/]/).filter(Boolean).pop() || short : '';
  return name && name.length <= 36 ? name : '';
}
function toolGroupBucket(row, l) {
  const v = String(row.verb || ''), t = String(row.target || '');
  if (/MEMORY\.md|\.penecho[\\/]memory/.test(t)) {
    const writing = /\.penecho[\\/]memory(\.cmd)?['"]?\s+(apply|add|replace|delete)/.test(t) || v === 'Wrote' || v === 'Edited';
    return writing
      ? { key:'memory-write', past:['updated memory', n => `updated memory ${n} times`], active:'updating memory' }
      : { key:'memory-read', past:['recalled a memory', n => `recalled ${n} memories`], active:'recalling a memory' };
  }
  if (v === 'Ran') return { key:'ran', past:['ran a command', n => `ran ${n} commands`], active:'running a command' };
  if (v === 'Read') return { key:'read', file:toolGroupFile(t, l), past:[f => f ? `read <span class="at-group-file">${esc(f)}</span>` : 'read a file', n => `read ${n} files`], active:f => f ? `reading <span class="at-group-file">${esc(f)}</span>` : 'reading a file' };
  if (v === 'Edited') return { key:'edit', file:toolGroupFile(t, l), past:[f => f ? `edited <span class="at-group-file">${esc(f)}</span>` : 'edited a file', n => `edited ${n} files`], active:f => f ? `editing <span class="at-group-file">${esc(f)}</span>` : 'editing a file' };
  if (v === 'Wrote') return { key:'write', file:toolGroupFile(t, l), past:[f => f ? `wrote <span class="at-group-file">${esc(f)}</span>` : 'wrote a file', n => `wrote ${n} files`], active:f => f ? `writing <span class="at-group-file">${esc(f)}</span>` : 'writing a file' };
  if (/^Searched for|^Looked for/.test(v)) return { key:'search', past:['searched the code', n => `searched ${n} times`], active:'searching the code' };
  if (/^Searched the web/.test(v)) return { key:'web-search', past:['searched the web', n => `searched the web ${n} times`], active:'searching the web' };
  if (v === 'Opened') return { key:'web-open', past:['opened a web page', n => `opened ${n} web pages`], active:'opening a web page' };
  if (/helper/.test(v)) return { key:'helper', past:['asked a helper', n => `asked ${n} helpers`], active:'asking a helper' };
  if (v === 'Updated its plan') return { key:'plan', past:['updated its plan', () => 'updated its plan'], active:'updating its plan' };
  if (v === 'Asked you') return { key:'ask', past:['asked you', () => 'asked you'], active:'asking you' };
  const tool = v.replace(/^Used\s+/, '').trim();
  return { key:'tool', tool, past:[name => name ? `used ${esc(name)}` : 'used a tool', n => `used ${n} tools`], active:name => name ? `using ${esc(name)}` : 'using a tool' };
}
function toolGroupCap(html) {
  return html.replace(/^([a-z])/, (_, ch) => ch.toUpperCase());
}
function toolGroupSummaryHTML(rows, l, live) {
  const order = [], map = new Map();
  for (const row of rows) {
    const b = toolGroupBucket(row, l);
    let entry = map.get(b.key);
    if (!entry) {
      entry = { b, count:0, running:0, file:b.file || '', tools:new Set() };
      map.set(b.key, entry);
      order.push(entry);
    }
    entry.count++;
    if (live && row.state === 'running') entry.running++;
    if (!entry.file && b.file) entry.file = b.file;
    if (b.tool) entry.tools.add(b.tool);
  }
  const clauses = order.map(entry => {
    const { b, count, running, file, tools } = entry;
    if (count === 1) {
      const fn = running ? b.active : b.past[0];
      return typeof fn === 'function' ? fn(b.key === 'tool' ? [...tools][0] || '' : file) : fn;
    }
    if (b.key === 'tool' && tools.size === 1) return `used ${esc([...tools][0])} ${count} times`;
    return b.past[1](count);
  });
  const shown = clauses.length > 4 ? [...clauses.slice(0, 3), `${clauses.length - 3} more`] : clauses;
  return shown.length ? toolGroupCap(shown.join(', ')) : `${rows.length} ${rows.length === 1 ? 'step' : 'steps'}`;
}
function toolGroupThumbsHTML(rows, l) {
  const pics = rows.flatMap(r => r.pictures || []);
  if (!pics.length) return '';
  const shown = pics.slice(0, 3), extra = pics.length - shown.length;
  const src = name => apiUrl(topicApi(project(), l, `activity-picture?name=${encodeURIComponent(name)}`));
  return `<span class="at-group-thumbs" aria-hidden="true">${extra > 0 ? `<span class="at-group-more">+${extra}</span>` : ''}${shown.map(name => `<img class="at-group-thumb" src="${esc(src(name))}" alt="" loading="lazy">`).join('')}</span>`;
}
function toolGroup(rows, l, live) {
  const hasRunning = Boolean(live && rows.some(r => r.state === 'running'));
  const hasFailed = rows.some(r => r.state === 'failed');
  const summary = toolGroupSummaryHTML(rows, l, live);
  const thumbs = toolGroupThumbsHTML(rows, l);
  return `<details class="at-group${hasRunning ? ' is-running' : ''}${hasFailed ? ' has-failed' : ''}" data-group="g${rows[0].i}"><summary><span class="at-group-main">${hasRunning ? '<i class="spin" aria-hidden="true"></i>' : ''}<span class="at-group-label">${summary}<span class="at-group-chev" aria-hidden="true">${ic('right', 12)}</span></span></span>${thumbs}</summary><div class="at-group-body">${rows.map(row => toolRow(row, l)).join('')}</div></details>`;
}
// A review is not one of the Line's runs: it is live while its reviewer reads, from when it started, saying what it does now.
const stepLive = (a, s) => (isOrchReview(s) ? Boolean(s.reviewing) : a.running && s.state === 'active');
const stepStarted = (a, s) => (isOrchReview(s) ? Date.parse(s.reviewPending?.startedAt || '') || a.started : a.started);
const stepNow = (a, s) => (isOrchReview(s) ? a.reviews?.[s.id] || 'Reviewing' : a.now || 'Working');
function rowsOfStep(a, s) {
  const rows = [...a.rows.values()].filter(row => row.step === s.id && row.kind !== 'me').sort((x, y) => x.i - y.i);
  if (typeof isOrchReview === 'function' && isOrchReview(s) && rows.length) {
    let from = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].kind === 'start' && !rows[i].resumed) { from = i; break; }
    }
    if (from > 0) return rows.slice(from);
  }
  return rows;
}
function rowsHTML(p, l, a, s) {
  const rows = rowsOfStep(a, s), live = stepLive(a, s) || (a.running && s.asked), reviewStep = typeof isOrchReview === 'function' && isOrchReview(s);
  const parts = [];
  let lastSay = null;
  if (!live && !reviewStep) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.kind === 'tool') break;
      if (r.kind === 'say' && !r.thinking) { lastSay = r; break; }
    }
  }
  let tools = [];
  const endTools = open => { if (tools.length) { parts.push(toolGroup(tools, l, open)); tools = []; } };
  for (const row of rows) {
    if (row.kind === 'tool') { tools.push(row); continue; }
    endTools(false);
    if (row.kind === 'start') parts.push(`<div class="at-start">${av(row.agent, 20)}<span>${esc(row.via ? `${agentInfo(row.agent).name} in ${row.via}` : `${agentInfo(row.agent).name} ${row.resumed ? 'carried on' : 'started'}`)}</span><time>${esc(shortWhen(row.at))}</time></div>`);
    // For a regular Work, the final non-thinking reply after all tools is already shown verbatim above. Intermediate texts and block thinking summaries stay visible between action groups.
    else if (row.kind === 'say') {
      if (row !== lastSay) {
        const trimmed = String(row.text || '').trim();
        const isRawJson = reviewStep && /^\{[\s\S]*\}$/.test(trimmed);
        parts.push(`<div class="at-say${row.thinking ? ' is-thinking' : ''}">${isRawJson ? `<pre class="lpp-rv-raw-pre">${esc(trimmed)}</pre>` : sayHTML(row.text)}</div>`);
      }
    }
    else if (row.kind === 'error') parts.push(`<div class="at-error" role="alert">${ic('hint', 16)}<span>${esc(row.text)}</span></div>`);
    else parts.push(`<p class="at-note">${esc(row.text)}</p>`);
  }
  endTools(live);
  return parts.join('');
}
const elapsed = started => { const s = Math.max(0, Math.round((Date.now() - started) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
function paintRows(p, l, s) {
  const host = $('#lppRows'); if (!host || S.lineSel?.id !== s.id) return;
  const a = activityOf(p, l), rows = rowsOfStep(a, s), live = stepLive(a, s), started = stepStarted(a, s), reviewStep = typeof isOrchReview === 'function' && isOrchReview(s);
  const sig = `${a.seq}|${live}|${s.state}|${s.id}`, count = $('#lppCount'), n = rows.filter(row => row.kind === 'tool').length;
  const nonStart = rows.filter(row => row.kind !== 'start').length;
  // The picture of what it is doing, while it runs (live.js).
  const band = $('#lppLive');
  if (band) { if (live && typeof paintLive === 'function') paintLive(band, s.agent && s.agent !== 'you' ? s.agent : (l.runAgent || l.agent || 'claude'), rows, started); else if (band.firstChild) band.innerHTML = ''; }
  if (count) count.textContent = n ? ` · ${n} ${n === 1 ? 'step' : 'steps'}` : reviewStep && nonStart ? ` · ${nonStart} ${nonStart === 1 ? 'entry' : 'entries'}` : '';
  if (host.dataset.sig !== sig) {
    // What you opened stays open while new rows arrive.
    const opened = new Set($$('details[open]', host).map(d => d.dataset.row || d.dataset.group));
    host.dataset.sig = sig;
    const scroller = $('#lppScroll'), prevTop = scroller ? scroller.scrollTop : 0, stick = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    // A record from another machine has only the file (or saved review output) to go by.
    const fromFile = !rows.length && s.detail ? mdSection(docById(s.detail, p)?.md || '', 'How it was done') : '';
    const reviewFallback = !rows.length && reviewStep ? String(s.review?.rawOutput || s.review?.notes || '').trim() : '';
    host.innerHTML = `${rows.length ? `${activityBriefHTML(rows, l)}<div class="act-rows">${rowsHTML(p, l, a, s)}</div>` : fromFile ? `<div class="at-say lpp-how">${sayHTML(fromFile)}</div>` : reviewFallback ? `<div class="act-rows"><div class="at-say"><pre class="lpp-rv-raw-pre">${esc(reviewFallback)}</pre></div></div>` : ''}${live ? `<div class="at-live"><i class="spin"></i><span class="at-now">${esc(liveFooterText(rows, l, a, s, reviewStep))}</span><time class="at-time" data-started="${started}" title="Total elapsed time">${elapsed(started)}</time></div>` : ''}`;
    $$('details', host).forEach(d => { if (opened.has(d.dataset.row || d.dataset.group)) d.open = true; });
    if (live && stick) scroller.scrollTop = scroller.scrollHeight;
    else if (scroller && prevTop) scroller.scrollTop = prevTop;
    if (reviewStep && S.reviewPanelMode === 'raw' && typeof orchReviewPanelHTML === 'function') {
      const rvHost = $('#lppOrchReview');
      if (rvHost) { const next = orchReviewPanelHTML(p, l, s); if (rvHost.dataset.h !== next) { rvHost.dataset.h = next; rvHost.innerHTML = next; } }
    }
  } else {
    const time = $('.at-time', host), now = $('.at-now', host); if (time) time.textContent = elapsed(started);
    if (now && live) now.textContent = liveFooterText(rows, l, a, s, reviewStep);
  }
}
// While a Topic is on screen its activity follows the agent closely. Everything else keeps to the slower poll.
if (typeof ACT === 'object' && ACT) {
  ACT['act-jump'] = el => {
    const host = $('#lppRows'), id = el.dataset.row;
    if (!host || !id) return;
    const row = $(`.act-rows [data-row="${CSS.escape(id)}"]`, host);
    if (!row) return;
    const group = row.closest('details.at-group');
    if (group) group.open = true;
    if (row.tagName === 'DETAILS') row.open = true;
    row.scrollIntoView?.({ block:'center', behavior:reducedMotion() ? 'auto' : 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 900);
  };
}
async function pollActivity() {
  const r = S.route, p = project(); if (!p || document.hidden || r.view !== 'line' || S.activityBusy) return;
  const l = lineById(p, r.line); if (!l) return;
  S.activityBusy = true;
  try {
    await loadActivity(p, l);
    if (S.cur !== p.id || S.route !== r) return;
    const a = activityOf(p, l);
    const s = S.lineSel && lineStation(l, S.lineSel.id);
    if (s) paintRows(p, l, s);
    // The agent or a background review just started or stopped, so the rest of the page should say so now.
    const liveReviewing = Object.keys(a.reviews || {}).length > 0;
    const stateReviewing = Boolean(l.stations?.some(x => x.reviewing));
    if (a.running !== Boolean(l.running) || liveReviewing !== stateReviewing) poll();
    if (a.running && a.now) $$('.lp-work.w-active').forEach(work => { const now = $('.lp-sum', work), nows = a.nows || {}, said = nows[work.dataset.step] || (Object.keys(nows).length ? '' : a.now); if (now && said) now.innerHTML = inlineSay(said); });
  } catch { /* The main poll reports a lost connection. */ } finally { S.activityBusy = false; }
}

// ---------- The page ----------
// What the box invites you to say depends on what the work is waiting for.
function boxWords(l) {
  const cur = currentStation(l);
  const unans = l.asking?.kind === 'tool' && !l.asking.answerable ? l.asking : l.stations?.find(s => s.asking?.kind === 'tool' && !s.asking.answerable)?.asking;
  if (unans) return `To answer ${agentInfo(unans.agent).name}, use the button above.`;
  return cur.kind === 'grill' && lineState(l) === 'wait' ? 'Your answer' : cur.state === 'wait' && cur.wait ? 'What should change?' : 'Add to this line. Type / for quick starts.';
}
const reviewCount = l => { const works = l.stations.filter(canReview); return { done:works.filter(s => s.reviewed).length, total:works.length }; };
const reviewRing = ({ done, total }) => `${total ? done / total * 100 : 0} 100`;
const reviewWords = ({ done, total }) => `${done} of ${total} Works reviewed`;
function reviewProgress(l) {
  const n = reviewCount(l);
  return `<span class="lp-prog ${n.total && n.done === n.total ? 'is-done' : ''}" id="lpProg" role="status" aria-label="${reviewWords(n)}" title="${reviewWords(n)}" ${n.total ? '' : 'hidden'}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle class="ring-bg" cx="8" cy="8" r="6.4"/><circle class="ring-fg" cx="8" cy="8" r="6.4" pathLength="100" stroke-dasharray="${reviewRing(n)}"/></svg><span class="lp-prog-n"><b>${n.done}</b><span class="lp-prog-of">/${n.total}</span></span></span>`;
}
// Painted in place, so the ring moves.
function paintProgress(l) {
  const el = $('#lpProg'); if (!el) return;
  const n = reviewCount(l);
  el.hidden = !n.total; el.title = reviewWords(n); el.setAttribute('aria-label', reviewWords(n)); el.classList.toggle('is-done', n.total > 0 && n.done === n.total);
  $('b', el).textContent = n.done; $('.lp-prog-of', el).textContent = `/${n.total}`; $('.ring-fg', el).setAttribute('stroke-dasharray', reviewRing(n));
}
// The counts over the thread are its filters, as on the home: press one to see only those Works, each with the Ask it answered, and press it again to see the whole line.
const LINE_FILTERS = {
  working: s => isWork(s) && (s.state === 'active' || Boolean(s.reviewing)),
  stopped: s => isWork(s) && s.state === 'error',
  you: s => isWork(s) && (s.state === 'wait' || s.asked || Boolean(s.questions?.length) || Boolean(s.waitingReply)),
  review: s => canReview(s) && !s.reviewed && !s.reviewing,
  done: s => isWork(s) && s.state === 'done' && !s.reviewing && !(canReview(s) && !s.reviewed),
};
// One filter, for the line on screen, in memory only. What it has shown stays while it is on, so a Work you mark does not vanish under your pointer, and anything new on the line shows too.
const lineFilter = l => (S.lineFilter?.line === l.id && LINE_FILTERS[S.lineFilter.f] ? S.lineFilter : null);
function lineShown(l) {
  const lf = lineFilter(l); if (!lf) return null;
  const show = new Set(), test = LINE_FILTERS[lf.f];
  let asks = [];
  for (const s of l.stations) {
    const fresh = !lf.known.has(s.id);
    if (s.kind === 'ask') { asks.push(s.id); if (fresh) show.add(s.id); continue; }
    if (isOrchReview(s)) continue;
    if (!isWork(s)) { if (fresh && s.state !== 'todo') show.add(s.id); continue; }
    if (test(s) || lf.kept.has(s.id) || fresh) { lf.kept.add(s.id); show.add(s.id); asks.forEach(id => show.add(id)); }
    asks = [];
  }
  for (const s of threadStations(l)) {
    if (!isOrchReview(s)) continue;
    const workId = s.workId || '';
    const reviewStoppedUnexpected = Boolean(s.reviewStopped && s.reviewStopped.stopWhy !== 'stopped');
    if ((workId && show.has(workId)) || (lf.f === 'working' && s.reviewing) || (lf.f === 'stopped' && reviewStoppedUnexpected)) {
      show.add(s.id);
      if (workId && ((lf.f === 'working' && s.reviewing) || (lf.f === 'stopped' && reviewStoppedUnexpected))) show.add(workId);
    }
  }
  return show;
}
function subLineWhen(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff >= 0 && diff < 60000) return 'just now';
  if (diff >= 0 && diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff >= 0 && diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (typeof shortWhen === 'function') return shortWhen(ms);
  const d = new Date(ms);
  return +d ? d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '';
}
function sortedSubLines(p, l) {
  const subs = typeof subLinesOf === 'function' ? subLinesOf(p, l) : [];
  return [...subs].sort((a, b) => {
    const ba = subLineStatusInfo(a).bucket, bb = subLineStatusInfo(b).bucket;
    if (ba !== bb) return ba - bb;
    const ta = a.lastActivityAt || a.statusAt || 0, tb = b.lastActivityAt || b.statusAt || 0;
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
}
function subLinesSummaryText(subs, compact = false) {
  const active = subs.filter(x => !x.archived);
  if (!active.length) return subs.length ? `${subs.length} archived` : '';
  const counts = { wait:0, working:0, stopped:0, review:0, queued:0 };
  for (const x of active) {
    const k = subLineStatusInfo(x).key;
    if (k === 'wait') counts.wait++;
    else if (k === 'working') counts.working++;
    else if (k === 'error') counts.stopped++;
    else if (k === 'review' || k === 'todo') counts.review++;
    else if (k === 'queued') counts.queued++;
  }
  const parts = [];
  if (counts.wait) parts.push(`${counts.wait} need you`);
  if (counts.working) parts.push(`${counts.working} working`);
  if (counts.stopped) parts.push(`${counts.stopped} stopped`);
  if (counts.review) parts.push(`${counts.review} to review`);
  if (!parts.length && counts.queued) parts.push(`${counts.queued} queued`);
  if (!parts.length) return 'all reviewed';
  return (compact ? parts.slice(0, 2) : parts).join(' · ');
}
function subLineRowHTML(p, parent, x) {
  const info = subLineStatusInfo(x);
  const unread = !x.archived && typeof lineUnread === 'function' && lineUnread(p, x);
  const icon = info.key === 'working' ? '<span class="lp-sub-ic is-working" aria-hidden="true"><i class="spin"></i></span>'
    : info.key === 'wait' ? '<span class="lp-sub-ic is-wait" aria-hidden="true"><b class="dot-b">!</b></span>'
    : info.key === 'error' ? `<span class="lp-sub-ic is-error" aria-hidden="true">${ic('x', 13)}</span>`
    : info.key === 'review' ? '<span class="lp-sub-ic is-review" aria-hidden="true"><i class="lp-sub-diamond"></i></span>'
    : info.key === 'todo' ? `<span class="lp-sub-ic is-todo" aria-hidden="true">${ic('box', 12)}</span>`
    : info.key === 'queued' ? '<span class="lp-sub-ic is-queued" aria-hidden="true"></span>'
    : info.key === 'archived' ? `<span class="lp-sub-ic is-archived" aria-hidden="true">${ic('archive', 12)}</span>`
    : `<span class="lp-sub-ic is-done" aria-hidden="true">${ic('check', 12)}</span>`;
  let rev = '';
  if (!x.archived) {
    const rc = reviewCount(x);
    const reviewingWork = (x.stations || []).find(s => isWork(s) && s.reviewing);
    const activeWork = (x.stations || []).find(s => isWork(s) && s.state === 'active');
    if (reviewingWork && rc.done < rc.total) rev = `<span class="lp-sub-rev is-run">Reviewing ${esc(reviewingWork.label || 'Work 1')}</span>`;
    else if (rc.total > 0 && rc.done < rc.total) rev = `<span class="lp-sub-rev is-pending">${rc.done}/${rc.total} to review</span>`;
    else if (rc.total > 0 && rc.done === rc.total) rev = `<span class="lp-sub-rev is-done">${rc.done}/${rc.total} reviewed</span>`;
    else if (activeWork) rev = `<span class="lp-sub-rev is-run">${esc(activeWork.label || 'Work 1')} running</span>`;
  }
  const when = subLineWhen(x.lastActivityAt || x.statusAt);
  return `<button type="button" class="lp-sub-row${unread ? ' is-unread' : ''}${x.archived ? ' is-archived' : ''}" data-act="open-line" data-line="${esc(x.id)}" data-from-parent="${esc(parent.id)}">
    <span class="lp-sub-main">${icon}${x.code ? `<code class="lp-sub-code">${esc(x.code)}</code>` : ''}<span class="lp-sub-title">${esc(x.title)}</span>${unread ? '<span class="lp-sub-unread" title="Unread" aria-label="Unread"></span>' : ''}</span>
    <span class="lp-sub-meta">${rev}<span class="fl-state ${info.cls}">${esc(info.label)}</span>${when ? `<time class="lp-sub-when">${esc(when)}</time>` : ''}<span class="lp-sub-go" aria-hidden="true">${ic('right', 14)}</span></span>
  </button>`;
}
function orchRoutePartsList(routeParts) {
  return String(routeParts || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean).map(raw => {
    const idx = raw.indexOf('→');
    return idx >= 0 ? { task:raw.slice(0, idx).trim(), owner:raw.slice(idx + 1).trim() } : { task:raw, owner:'' };
  });
}
function lineRouteBandHTML(l, subsCount) {
  if ((HOSTED && !HOSTED.onComputer) || !l?.orchestratorRef || !l.route) return '';
  const label = typeof orchRouteLabel === 'function' ? orchRouteLabel(l.route, subsCount > 0) : '';
  if (!label) return '';
  const parts = orchRoutePartsList(l.routeParts);
  const multiParts = parts.length >= 2;
  const partsOpen = multiParts && Boolean(S.routePartsOpen?.has(l.id));
  const isActive = (l.route === 'delegate' || l.route === 'split') && subsCount > 0;
  const titleAttr = !multiParts && l.routeParts ? ` title="${esc(l.routeParts)}"` : '';
  return `<div class="lp-route-band${isActive ? ' is-active' : ''}"${titleAttr}>
    <div class="lp-route-row">
      <span class="lp-route-ic" aria-hidden="true">${ic('orchestrate', 14)}</span>
      <p class="lp-route-text"><strong class="lp-route-label">${esc(label)}</strong>${l.routeWhy ? `<span class="lp-route-sep" aria-hidden="true"> · </span><span class="lp-route-why">${esc(l.routeWhy)}</span>` : ''}${multiParts ? ` <button type="button" class="lp-route-parts-btn" data-act="route-parts-toggle" data-line="${esc(l.id)}" aria-expanded="${partsOpen}">${parts.length} parts ${ic(partsOpen ? 'up' : 'down', 12)}</button>` : ''}</p>
    </div>
    ${partsOpen ? `<ul class="lp-route-parts">${parts.map(pt => `<li><span class="lp-rp-task">${esc(pt.task)}</span>${pt.owner ? `<span class="lp-rp-arrow" aria-hidden="true">→</span><span class="lp-rp-owner">${esc(pt.owner)}</span>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}
function subLinesHTML(p, l) {
  if (!p || !l?.orchestratorRef) return '';
  const subs = sortedSubLines(p, l);
  const routeHtml = lineRouteBandHTML(l, subs.length);
  if (!subs.length) return routeHtml;
  const active = subs.filter(x => !x.archived), archived = subs.filter(x => x.archived);
  const folded = Boolean(S.subLinesFolded?.has(l.id));
  const expanded = Boolean(S.subLinesExpanded?.has(l.id));
  const showArchived = Boolean(S.subLinesArchivedOpen?.has(l.id));
  const primary = active.length ? active : archived;
  const shown = !expanded && primary.length > 5 ? primary.slice(0, 5) : primary;
  const routeLabel = routeHtml && typeof orchRouteLabel === 'function' ? orchRouteLabel(l.route, true) : '';
  const summary = [folded && routeLabel ? routeLabel : '', subLinesSummaryText(subs)].filter(Boolean).join(' · ');
  const plan = typeof reviewTreePlan === 'function' ? reviewTreePlan(p, l) : null;
  const saving = Boolean(S.treeReviewSaving?.has(`${p.id}:${l.id}`));
  return `<header class="lp-sublines-head">
      <button type="button" class="lp-sublines-toggle" data-act="sublines-fold" data-line="${esc(l.id)}" aria-expanded="${!folded}">
        ${ic(folded ? 'right' : 'down', 14)}
        <span class="lp-sublines-label">Sub-Lines</span>
        <span class="lp-sublines-count">${subs.length}</span>
        ${summary ? `<span class="lp-sublines-sum">${esc(summary)}</span>` : ''}
      </button>
      ${plan?.canOpen ? `<button type="button" class="btn sm lp-sub-review-btn" data-act="review-tree-menu" data-line="${esc(l.id)}" aria-haspopup="dialog"${saving ? ' disabled aria-busy="true"' : ''}>${ic('check', 14)}<span>Mark reviewed</span>${ic('down', 12)}</button>` : ''}
    </header>
    ${folded ? '' : `<div class="lp-sublines-body">
      ${routeHtml}
      <div class="lp-sub-list">${shown.map(x => subLineRowHTML(p, l, x)).join('')}</div>
      ${primary.length > 5 ? `<button type="button" class="lp-sublines-foot" data-act="sublines-more" data-line="${esc(l.id)}">${expanded ? 'Show fewer' : `Show all ${primary.length} sub-Lines`}</button>` : ''}
      ${active.length && archived.length ? `<div class="lp-sub-arch-wrap">
        <button type="button" class="lp-sublines-arch-toggle" data-act="sublines-archived" data-line="${esc(l.id)}" aria-expanded="${showArchived}">${ic(showArchived ? 'down' : 'right', 13)}<span>${archived.length} archived sub-Line${archived.length === 1 ? '' : 's'}</span></button>
        ${showArchived ? `<div class="lp-sub-list is-archived-list">${archived.map(x => subLineRowHTML(p, l, x)).join('')}</div>` : ''}
      </div>` : ''}
    </div>`}`;
}
function filtersHTML(l, p = typeof project === 'function' ? project() : null) {
  const f = lineFilter(l)?.f || '';
  // The one you pressed stays shown at 0, so it can be pressed again.
  const one = (key, cls, words) => { const n = l.stations.filter(LINE_FILTERS[key]).length; return n || f === key ? `<button type="button" class="sum-f ${cls}" data-act="line-filter" data-f="${key}" aria-pressed="${f === key}">${words(n)}</button>` : ''; };
  let out = one('working', 'sum-work', n => `<i class="spin"></i>${n} working`) + one('stopped', 'sum-stop', n => `${ic('x', 14)}${n} stopped`) + one('you', 'sum-you', n => `<b class="dot-b" aria-hidden="true">!</b>${n} need you`) + one('review', 'sum-review', n => `${ic('eye', 14)}${n} to review`) + one('done', 'sum-done', n => `${ic('check', 14)}${n} finished`);
  const subs = p && l?.orchestratorRef && typeof subLinesOf === 'function' ? subLinesOf(p, l) : [];
  if (subs.length) {
    const sum = subLinesSummaryText(subs, true);
    const label = `${subs.length} sub-Line${subs.length === 1 ? '' : 's'}${sum ? ` · ${sum}` : ''}`;
    out += `<button type="button" class="sum-f sum-subs" data-act="focus-sublines" title="Jump to sub-Lines">${ic('orchestrate', 14)}${esc(label)}</button>`;
  }
  return out;
}
const filterBarHeight = () => $('#lpFilters')?.offsetHeight || 0;
const filteredOut = el => Boolean(el?.closest('.lf-out'));
// The counts, and which items show. Run after anything redraws the thread or the line down the side.
function applyLineFilter(l) {
  const bar = $('#lpFilters');
  if (bar) { const next = filtersHTML(l); if (bar.dataset.h !== next) { bar.dataset.h = next; bar.innerHTML = next; } bar.hidden = !next; }
  const show = lineShown(l), out = id => Boolean(show) && !show.has(id);
  $$('#lpThread [id^="item-"]').forEach(el => { const hide = out(el.id.slice(5)), k = el.previousElementSibling; el.classList.toggle('lf-out', hide); if (k?.classList.contains('lp-kl')) k.classList.toggle('lf-out', hide); });
  // A day with nothing left in it loses its date too.
  let day = null, any = false;
  for (const el of $('#lpList')?.children || []) {
    if (el.classList.contains('lps-day')) { day?.classList.toggle('lf-out', !any); day = el; any = false; continue; }
    const hide = out(el.dataset.step); el.classList.toggle('lf-out', hide); any ||= !hide;
  }
  day?.classList.toggle('lf-out', !any);
}
// What you were reading stays where it was: the first item in view that is still shown. If none is, the line starts from the top.
ACT['line-filter'] = el => {
  const l = lineById(project(), S.route.line), box = $('#lpScroll'); if (!l || !box) return;
  const rectOf = node => typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect();
  const b = rectOf(box), edge = b.top + filterBarHeight();
  const inView = $$('#lpThread [id^="item-"]').filter(n => { const r = rectOf(n); return !filteredOut(n) && r.bottom > edge && r.top < b.bottom; }).map(n => ({ n, top:rectOf(n).top }));
  const f = lineFilter(l)?.f === el.dataset.f ? '' : el.dataset.f;
  S.lineFilter = f ? { line:l.id, f, known:new Set(l.stations.map(s => s.id)), kept:new Set() } : null;
  applyLineFilter(l);
  const anchor = inView.find(x => !filteredOut(x.n));
  if (anchor) box.scrollTop += rectOf(anchor.n).top - anchor.top; else box.scrollTop = 0;
  // The panel's arrows step through what is shown.
  const head = $('#lppHead'), s = S.lineSel; if (head && s) { const next = panelHead(l, s); head.dataset.h = next; head.innerHTML = next; }
  spyLine();
};
function lineDockHTML(p, l) {
  return l.archived || l.closed || typeof composerHTML !== 'function' ? '' : `<div class="lp-dock">${composerHTML('conv-' + p.id + '-' + l.slug, { placeholder:boxWords(l), preview:true, on:'step', topic:l.id })}</div>`;
}
function lineHTML(p, r) {
  const l = lineById(p, r.line);
  if (!l) return `<div class="page"><p class="empty-line">This Topic no longer exists.</p></div>`;
  if (typeof fvBackTo === 'function') fvBackTo(`${p.id}:line`);
  const s = selectedStep(l, r);
  S.lineSel = s;
  const backParent = typeof lineParentOrigin === 'function' ? lineParentOrigin(p.id, l.id) : null;
  const backOrch = !backParent && lineOrchestratorOrigin(p.id, l.id);
  const backLabel = backParent ? (backParent.fromCode || backParent.fromTitle || p.name) : backOrch ? 'Orchestrator' : p.name;
  const backTitle = backParent ? `Back to ${backParent.fromTitle || backParent.fromCode}` : '';
  const subsHtml = typeof subLinesHTML === 'function' ? subLinesHTML(p, l) : '';
  const subsRouteOnly = Boolean(subsHtml && !(typeof subLinesOf === 'function' && subLinesOf(p, l).length));
  return `<div class="lp ${S.lineFolded ? 'folded' : ''} ${s ? 'has-panel' : ''}" id="linePage" style="--c:${STATE_COLOR[(typeof isReviewPending === 'function' ? isReviewPending(l) : typeof LINE_STATUS !== 'undefined' && LINE_STATUS.isReviewPending?.(l)) ? 'working' : lineState(l)] || 'var(--ink2)'}">
    <aside class="lp-side" id="lpSide" aria-label="The line">
      <div class="lp-side-top">${projectsToggleHTML()}<button type="button" class="ghost lp-back" data-act="line-back" data-line="${esc(l.id)}"${backTitle ? ` title="${esc(backTitle)}"` : ''}>${ic('left', 16)}<span>${esc(backLabel)}</span></button>${reviewProgress(l)}<button type="button" class="icon-btn lp-fold" data-act="line-fold" aria-label="${S.lineFolded ? 'Expand the line' : 'Fold the line'}" title="${S.lineFolded ? 'Expand the line' : 'Fold the line'}" aria-pressed="${Boolean(S.lineFolded)}">${ic('panel', 18)}</button></div>
      <div class="lp-list" id="lpList">${listHTML(p, l)}</div>
      <div class="lp-topic-side" id="lpTopicSide"></div>
    </aside>
    <header class="lp-head" id="lpHead">${lineHeadHTML(p, l)}</header>
    <main class="lp-main" id="lpScroll">
      <div class="pano-sum lp-filters" id="lpFilters" role="group" aria-label="Filter the Works" hidden></div>
      <div class="lp-cloud" id="lpCloud">${typeof lineConflictHTML === 'function' ? lineConflictHTML(p, l) : ''}</div>
      <section class="lp-sublines${subsRouteOnly ? ' is-route-only' : ''}" id="lpSubLines" aria-label="${subsRouteOnly ? 'Orchestrator route' : 'Sub-Lines'}" ${subsHtml ? '' : 'hidden'}>${subsHtml}</section>
      <div class="lp-sheet" id="lpThread">${threadHTML(p, l)}</div>
      <div class="lp-topic" id="lpTopic"></div>
      ${lineDockHTML(p, l)}
    </main>
    <div class="lp-panel-backdrop" id="lpPanelBackdrop" hidden></div>
    <aside class="lp-panel" id="lpPanel" ${s ? '' : 'hidden'} aria-label="This piece of work"></aside>
  </div>`;
}
// A line before it exists: its page with one empty node, and the box. Nothing is made until you add its first node.
function newLineHTML(p) {
  return `<div class="lp is-new" id="linePage">
    <aside class="lp-side" aria-label="The line">
      <div class="lp-side-top">${projectsToggleHTML()}<button type="button" class="ghost lp-back" data-act="line-back">${ic('left', 16)}<span>${esc(p.name)}</span></button></div>
      <div class="lp-list"><div class="lps is-empty first last" aria-hidden="true"><span class="lps-node"></span><span class="lps-txt"></span></div></div>
    </aside>
    <header class="lp-head">${projectsToggleHTML()}<h1>${EMBED ? 'This Canvas' : 'New line'}</h1></header>
    <main class="lp-main">
      ${EMBED ? `<div class="embed-start"><strong>Nothing about this Canvas yet</strong><span>Write a note, or ask AI about what you drew.</span></div>` : '<div class="lp-sheet"></div>'}
      <div class="lp-dock">${composerHTML('home-' + p.id, { placeholder:EMBED ? 'Write a note, or ask AI about this Canvas.' : composerWords(p), preview:true })}</div>
    </main>
  </div>`;
}
function itemTop(id) {
  const el = document.getElementById(`item-${id}`), box = $('#lpScroll'); if (!el || !box) return null;
  const rectOf = node => typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect();
  return rectOf(el).top - rectOf(box).top + box.scrollTop - 14 - filterBarHeight();
}
function scrollToItem(id, { smooth = true } = {}) {
  // Going to something the filter hides shows the whole line again.
  if (filteredOut(document.getElementById(`item-${id}`))) { S.lineFilter = null; const l = lineById(project(), S.route.line); if (l) applyLineFilter(l); }
  const box = $('#lpScroll'), top = itemTop(id); if (top == null) return;
  box.scrollTo({ top:Math.max(0, top), behavior:smooth && !reducedMotion() ? 'smooth' : 'auto' });
}
function scrollToLatest({ smooth = true } = {}) {
  const l = lineById(project(), S.route.line); if (!l) return;
  const shown = lineShown(l), ask = [...l.stations].reverse().find(s => s.kind === 'ask' && (!shown || shown.has(s.id)));
  if (ask) scrollToItem(ask.id, { smooth });
}
function flashItem(id) { const el = document.getElementById(`item-${id}`); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
// As you read down the file, the line shows where you are.
function spyLine() {
  const box = $('#lpScroll'), list = $('#lpList'); if (!box || !list || S.route.view !== 'line') return;
  const rectOf = node => typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect();
  const limit = rectOf(box).top + 60 + filterBarHeight(), items = $$('#lpThread [data-step]').filter(el => !filteredOut(el));
  let here = items[0];
  for (const el of items) if (rectOf(el).top <= limit) here = el;
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && items.length) here = items[items.length - 1];
  markHere(here?.dataset.step);
}
function markHere(id, { centre = false } = {}) {
  const list = $('#lpList'); if (!id || !list) return;
  $$('.lps', list).forEach(el => el.classList.toggle('here', el.dataset.step === id));
  const row = $('.lps.here', list); if (!row) return;
  const rectOf = node => typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect();
  const r = rectOf(row), b = rectOf(list);
  if (centre) list.scrollTop += r.top - b.top - b.height / 2 + r.height / 2;
  else if (r.top < b.top + 24 || r.bottom > b.bottom - 24) list.scrollTo({ top:list.scrollTop + r.top - b.top - b.height / 2 + r.height / 2, behavior:reducedMotion() ? 'auto' : 'smooth' });
}
function mountLine(p, r) {
  const l = lineById(p, r.line); if (!l) return;
  const box = $('#lpScroll');
  S.lineSig = null;
  panelInto(p, l, S.lineSel);
  const thread = $('#lpThread');
  const subsEl = $('#lpSubLines');
  if (subsEl) subsEl.dataset.h = subsEl.innerHTML;
  for (const s of threadStations(l)) {
    const card = document.getElementById(`item-${s.id}`);
    if (card && thread?.contains(card)) card.dataset.h = itemHTML(p, l, s);
  }
  thread?.addEventListener('keydown', e => {
    choiceKeydown(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.classList?.contains('q-input')) {
      e.preventDefault();
      const btn = e.target.closest('.q-custom')?.querySelector('button[data-act]');
      btn?.click();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && (e.target.classList?.contains('lp-work') || e.target.classList?.contains('lp-meeting') || e.target.classList?.contains('lp-orch-review'))) { e.preventDefault(); e.target.click(); }
  });
  thread?.addEventListener('input', e => {
    if (!e.target.classList?.contains('q-input')) return;
    const lineId = e.target.dataset.line || '', kind = e.target.dataset.qKind || '';
    if (kind === 'topic' || kind === 'waiting') {
      saveQDraft(lineId, '__topic__', '__note', e.target.value, e.target.closest('.q-card')?.dataset.questionRev);
      syncQDraftUI(lineId);
    } else if (e.target.dataset.req && e.target.dataset.q && e.target.closest('[data-q-block]')?.dataset.qSecret !== '1') {
      saveQDraft(lineId, e.target.dataset.req, e.target.dataset.q, e.target.value);
    }
  });
  thread?.addEventListener('change', e => {
    const box = e.target.closest?.('input[type="checkbox"][data-task-index]');
    if (!box || box.disabled) return;
    toggleStepTask(box);
  });
  let ticking = false;
  box.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; spyLine(); }); }, { passive:true });
  box.addEventListener('pointerdown', () => $('#linePage')?.classList.remove('side-open'));
  const list = $('#lpList');
  let stopHoverTimer = 0, stopHoverRow = null;
  const clearStopHover = () => { if (stopHoverTimer) { clearTimeout(stopHoverTimer); stopHoverTimer = 0; } stopHoverRow = null; hideStopCard(); };
  list.addEventListener('pointerover', e => {
    const row = e.target.closest?.('.lps:not(.is-empty)');
    if (!row) { clearStopHover(); return; }
    if (row === stopHoverRow) return;
    clearStopHover();
    stopHoverRow = row;
    const show = () => {
      if (stopHoverRow !== row || !row.isConnected) return;
      const pCur = project(), lCur = lineById(pCur, S.route.line), sCur = lineStation(lCur, row.dataset.step);
      if (sCur) showStopCard(pCur, lCur, sCur, row);
    };
    if (S.lineFolded) show();
    else stopHoverTimer = setTimeout(show, 260);
  });
  list.addEventListener('pointerleave', clearStopHover);
  list.addEventListener('pointerdown', clearStopHover);
  placeLegacyParts(p, l);
  applyLineFilter(l);
  if (r.step && document.getElementById(`item-${r.step}`)) { scrollToItem(r.step, { smooth:false }); if (lineStation(l, r.step)?.kind === 'ask') flashItem(r.step); } else scrollToLatest({ smooth:false });
  pollActivity();
  spyLine();
  markHere($('.lps.here', list)?.dataset.step, { centre:true });
  if (typeof fvPendingTry === 'function') (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fvPendingTry) : fvPendingTry());
}
function unmountLine() {
  S.lineSel = null; S.sideOpen = false; S.panelPopped = false;
  const back = $('#lpPanelBackdrop'); if (back) back.hidden = true;
  $('#lpPanel')?.classList.remove('is-popped');
  $('#linePage')?.classList.remove('panel-popped');
  closeReviewTreePopover();
}
// Only what really changed is redrawn, so your place on the page and anything you opened stay put.
function refreshLine() {
  const p = project(), r = S.route, l = lineById(p, r.line), page = $('#linePage');
  if (!l) { if (page && typeof render === 'function') render(); return; }
  if (!page) { if (typeof render === 'function') render(); return; }
  page.style.setProperty('--c', STATE_COLOR[lineState(l)] || 'var(--ink2)');
  const dock = $('.lp-dock', page);
  if (l.archived || l.closed) dock?.remove();
  else if (!dock && typeof composerHTML === 'function') {
    const scroll = $('#lpScroll', page);
    scroll?.insertAdjacentHTML('beforeend', lineDockHTML(p, l));
    if (scroll && typeof wireComposers === 'function') wireComposers(scroll);
  }
  const head = $('#lpHead'), headNext = lineHeadHTML(p, l); if (head && head.dataset.h !== headNext) { head.dataset.h = headNext; head.innerHTML = headNext; }
  const subsEl = $('#lpSubLines');
  if (subsEl) {
    const subsNext = subLinesHTML(p, l);
    const routeOnly = Boolean(subsNext && !(typeof subLinesOf === 'function' && subLinesOf(p, l).length));
    if (subsEl.dataset.h !== subsNext) { subsEl.dataset.h = subsNext; subsEl.innerHTML = subsNext; }
    subsEl.classList.toggle('is-route-only', routeOnly);
    subsEl.setAttribute('aria-label', routeOnly ? 'Orchestrator route' : 'Sub-Lines');
    subsEl.hidden = !subsNext;
  }
  const was = S.lineSel, s = selectedStep(l, r);
  S.lineSel = s || null;
  paintProgress(l);
  const list = $('#lpList');
  if (list) { const next = listHTML(p, l); if (list.dataset.h !== next) { list.dataset.h = next; const top = list.scrollTop; list.innerHTML = next; list.scrollTop = top; spyLine(); } }
  const thread = $('#lpThread');
  if (thread) {
    const before = $$('[data-step]', thread).map(el => el.dataset.step);
    const stations = threadStations(l);
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i], next = itemHTML(p, l, st), el = document.getElementById(`item-${st.id}`);
      if (el && el.dataset.h === next) continue;
      if (el && !next) { el.remove(); continue; }
      if (!next) continue;
      const holder = document.createElement('div'); holder.innerHTML = next; const fresh = holder.firstElementChild; fresh.dataset.h = next;
      if (el) el.replaceWith(fresh);
      else {
        const later = stations.slice(i + 1).map(x => document.getElementById(`item-${x.id}`)).find(Boolean);
        thread.insertBefore(fresh, later || $('#lpAsks', thread));
        if (!reducedMotion()) fresh.classList.add('lp-new');
      }
    }
    // An Ask you took back, here or in the Markdown, is gone from the page too.
    const still = new Set(stations.map(st => `item-${st.id}`));
    $$('[id^="item-"]', thread).forEach(el => { if (!still.has(el.id)) el.remove(); });
    // A card whose place changed moves there too, such as an Ask that leaves the end of the line, once sent, for above the Work it starts.
    const order = stations.map(st => document.getElementById(`item-${st.id}`)).filter(Boolean), shown = $$('[id^="item-"]', thread);
    if (order.some((el, i) => shown[i] !== el)) for (const el of order) thread.insertBefore(el, $('#lpAsks', thread));
    // The small line above each card follows its card, whatever moved.
    $$('.lp-kl', thread).forEach(el => el.remove());
    for (const st of stations) { const el = document.getElementById(`item-${st.id}`), k = el && st.state !== 'todo' ? kindLine(l, st) : ''; if (k) el.insertAdjacentHTML('beforebegin', k); }
    const asks = $('#lpAsks', thread), curFocus = document.activeElement, q = questionsHTML(p, l);
    if (asks && !(curFocus?.classList?.contains('q-input') && asks.contains(curFocus)) && asks.dataset.h !== q) { asks.dataset.h = q; asks.innerHTML = q; }
    placeLegacyParts(p, l);
    applyLineFilter(l);
    if (before.length && $$('[data-step]', thread).length > before.length) { const scroller = $('#lpScroll'); if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 420) scrollToLatest(); }
  }
  const panel = $('#lpPanel');
  if (panel) {
    if ((was?.id || '') !== (s?.id || '')) panelInto(p, l, s);
    // No Work open: the line's Topic, redrawn only when it changed (merge.js).
    else if (!s) { if (typeof topicPlaceHTML === 'function' && panel.dataset.h !== topicPlaceHTML(p, l)) panelInto(p, l, null); }
    else if (s) {
      if (typeof topicPlaceHTML === 'function') topicPlaceHTML(p, l);
      const h = $('#lppHead'), nextHead = panelHead(l, s);
      if (h && h.dataset.h !== nextHead) {
        const focusAct = h.contains(document.activeElement) ? document.activeElement.dataset?.act : '';
        h.dataset.h = nextHead;
        h.innerHTML = nextHead;
        if (focusAct) $(`[data-act="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(focusAct) : focusAct}"]`, h)?.focus({ preventScroll:true });
      }
      syncPanelPop();
      const scroller = $('#lppScroll'), prevTop = scroller ? scroller.scrollTop : 0;
      if (isOrchReview(s)) {
        const where = $('#lppWhere'); if (where) { const nextWhere = orchReviewPanelWhere(l, s); if (where.dataset.h !== nextWhere) { where.dataset.h = nextWhere; where.innerHTML = nextWhere; } }
        fillPanel(p, l, s);
      } else {
        // Only the latest Work shows what the line made: a Work that went back to Not started has made nothing.
        const made = $('#lppMade'); if (made) { const nextMade = latestWork(l) === s ? panelMade(p, l) : ''; if (made.dataset.h !== nextMade) { made.dataset.h = nextMade; made.innerHTML = nextMade; if (scroller && prevTop) scroller.scrollTop = prevTop; } }
        const whereActs = $('#lppWhereActs'); if (whereActs) { const nextActs = whereActions(l, s); if (whereActs.dataset.h !== nextActs) { whereActs.dataset.h = nextActs; whereActs.innerHTML = nextActs; } }
        const where = $('#lppWhere'); if (where) { const nextWhere = whereCard(l, s); if (where.dataset.h !== nextWhere) { where.dataset.h = nextWhere; where.innerHTML = nextWhere; } }
        fillPanel(p, l, s);
      }
    }
  }
  const dockForm = $('.lp-dock .composer');
  if (dockForm) {
    const ta = $('.cmp-input', dockForm), ph = boxWords(l);
    if (ta && ta.placeholder !== ph) { ta.placeholder = ph; ta.setAttribute('aria-label', ph); }
    syncComposer(dockForm);
  }
}
function pickStep(l, s, { scroll = true } = {}) {
  const p = project();
  S.panelShut = null;
  S.route = { view:'line', line:l.id, step:s.id };
  syncHash(true);
  panelInto(p, l, s);
  $$('#lpThread .lp-work, #lpThread .lp-meeting, #lpThread .lp-orch-review').forEach(el => { const on = el.dataset.step === s.id; el.classList.toggle('on', on); el.setAttribute('aria-pressed', on); });
  $$('#lpList .lps').forEach(el => el.classList.toggle('sel', el.dataset.step === s.id));
  $('#linePage')?.classList.remove('side-open');
  if (scroll) scrollToItem(s.id);
}
ACT['line-stop'] = el => {
  const l = lineById(project(), el.dataset.line), s = lineStation(l, el.dataset.step); if (!s) return;
  if (s.kind === 'meeting' || isOrchReview(s)) { pickStep(l, s); return; }
  if (isYours(s)) { $('#linePage')?.classList.remove('side-open'); scrollToItem(s.id); flashItem(s.id); return; }
  if (s.state === 'todo' && isEnd(s)) { scrollToLatest(); return; }
  pickStep(l, s.toReview ? nextToReview(l) : s);
};
// To review opens the first Work still waiting for you. Merge in the head still opens the merge.
ACT['line-work'] = el => { const l = lineById(project(), el.dataset.line), s = lineStation(l, el.dataset.step); if (s) pickStep(l, s.toReview ? nextToReview(l) : s, { scroll:Boolean(s.toReview || el.closest?.('#lpPanel')) }); };
ACT['panel-pop'] = el => {
  if (el?.dataset?.pop === 'close') { setPanelPopped(false, { focus:true }); return; }
  setPanelPopped(!S.panelPopped, { focus:true });
};
ACT['panel-close'] = () => {
  S.panelPopped = false;
  const p = project(), l = lineById(p, S.route.line);
  if (!l) { syncPanelPop(); return; }
  S.panelShut = l.id;
  S.route = { view:'line', line:l.id };
  syncHash(true);
  panelInto(p, l, null);
  $$('#lpThread .lp-work.on, #lpThread .lp-meeting.on, #lpThread .lp-orch-review.on').forEach(el => { el.classList.remove('on'); el.setAttribute('aria-pressed', 'false'); });
  $$('#lpList .lps.sel').forEach(el => el.classList.remove('sel'));
};
ACT['panel-details'] = el => {
  const l = lineById(project(), S.route.line), s = lineStation(l, el.dataset.step), box = $('#lppDetails'), scroller = $('#lppScroll'); if (!s || !box) return;
  const open = box.hidden;
  (S.detailsShown ||= {})[s.id] = open;
  box.hidden = !open;
  el.setAttribute('aria-expanded', String(open));
  $('svg', el)?.replaceWith(Object.assign(document.createElement('span'), { innerHTML:ic(open ? 'down' : 'up', 14) }).firstElementChild);
  if (open) scroller.scrollTo({ top:box.offsetTop - scroller.offsetTop - 8, behavior:reducedMotion() ? 'auto' : 'smooth' });
  else scroller.scrollTo({ top:0 });
};
ACT['ask-more'] = el => {
  const open = S.openAsks ||= new Set(), id = el.dataset.step;
  if (open.has(id)) open.delete(id); else open.add(id);
  const p = project(), l = lineById(p, S.route.line), s = stationById(l, id), box = document.createElement('div');
  box.innerHTML = askItem(p, l, s);
  document.getElementById(`item-${id}`)?.replaceWith(box.firstElementChild);
};
ACT['line-back'] = () => {
  const parentOrigin = typeof lineParentOrigin === 'function' ? lineParentOrigin(S.cur, S.route.line) : null;
  if (parentOrigin && lineById(project(), parentOrigin.fromLine)) {
    go({ view:'line', line:parentOrigin.fromLine }, { back:true, restoredOrigin:parentOrigin.parentOrchestratorOrigin || null, restoredHomeLinesOrigin:parentOrigin.parentHomeLinesOrigin || null });
    const scroller = $('#lpScroll');
    if (scroller) scroller.scrollTop = parentOrigin.top || 0;
    if (typeof spyLine === 'function') spyLine();
    return;
  }
  const origin = lineOrchestratorOrigin(S.cur, S.route.line);
  go({ view:origin ? 'orchestrator' : 'home' }, { back:true });
  if (origin) $('#view').scrollTop = origin.top;
};
ACT['line-fold'] = el => {
  S.lineFolded = !S.lineFolded;
  try { localStorage.setItem(LINE_FOLDED_KEY, S.lineFolded ? '1' : '0'); } catch { /* Keep in memory if storage is unavailable. */ }
  $('#linePage')?.classList.toggle('folded', S.lineFolded);
  const btn = el?.classList?.contains('lp-fold') ? el : $('.lp-fold');
  if (btn) {
    const label = S.lineFolded ? 'Expand the line' : 'Fold the line';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-pressed', String(Boolean(S.lineFolded)));
  }
  hideStopCard();
};
ACT['line-side'] = () => { $('#linePage')?.classList.toggle('side-open'); };
ACT['result-mode'] = el => { S.resultMode = el.dataset.mode; const p = project(), l = lineById(p, S.route.line), s = S.lineSel && stationById(l, S.lineSel.id); if (l && s) { const host = $('#lppResult'); if (host) { host.dataset.h = ''; fillPanel(p, l, s); } } };
ACT['review-panel-mode'] = el => {
  S.reviewPanelMode = el.dataset.mode === 'raw' ? 'raw' : 'summary';
  const p = project(), l = lineById(p, S.route.line), s = S.lineSel && lineStation(l, S.lineSel.id);
  if (l && s && isOrchReview(s)) {
    const host = $('#lppOrchReview');
    if (host) { host.dataset.h = ''; fillPanel(p, l, s); }
  }
};
ACT['review-copy-raw'] = el => {
  const p = project(), l = lineById(p, S.route.line), s = l && lineStation(l, el.dataset.step || S.lineSel?.id);
  const raw = s ? reviewRawOutputOf(p, l, s) : '';
  if (raw) copyText(raw, 'Copied original review output');
};
ACT['copy-path'] = el => copyText(el.dataset.path, 'Copied the folder path');
ACT['copy-refs'] = el => copyText(el.dataset.refs, 'Copied the Work and Line file paths');
ACT['copy-command'] = el => copyText(el.dataset.command, 'Copied the command');
ACT['stop-help'] = el => toast(el.dataset.stopHint);
ACT['open-desktop'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line);
  try {
    await api(topicApi(p, l, 'open-desktop'), { method:'POST', body:{ ...(el.dataset.agent ? { agent:el.dataset.agent } : {}), ...(el.dataset.step ? { step:el.dataset.step } : {}), ...(el.dataset.stopHint ? { forStop:true } : {}) } });
    if (el.dataset.stopHint) toast('Use the stop control in the running conversation.');
  }
  catch (error) { toast(error.message); }
};
function viewerHTML(name, md, source, markdown = /\.(md|markdown)$/i.test(name), doc = null) {
  const p = project(), view = source || !markdown ? `<div class="src">${highlightSource(md)}</div>` : `<div class="viewer-doc">${renderMd(md, p, { compact:true, doc, previewLinks:Boolean(doc) })}</div>`;
  const owner = markdown ? lineOfDoc(p, doc) : null;
  return `<div class="lb-card viewer-card" role="dialog" aria-label="${esc(name)}">
    <header class="viewer-header"><strong title="${esc(name)}">${esc(name)}</strong>
      <div class="viewer-tools">
        ${owner ? `<a class="link viewer-line" href="#${esc(routeToHash({ view:'line', line:owner.id }))}" data-act="viewer-line" data-line="${esc(owner.id)}" title="${esc(owner.title)}">Jump to Line</a>` : ''}
        <div class="seg" role="tablist" aria-label="How to show this file"><button type="button" role="tab" aria-selected="${!source}" data-act="viewer-mode" data-mode="read"><span>Reading</span></button><button type="button" role="tab" aria-selected="${!!source}" data-act="viewer-mode" data-mode="source"><span>Source</span></button></div>
        ${markdown ? `<button type="button" class="btn sm" data-act="viewer-copy" aria-label="Copy Markdown" title="Copy Markdown">${ic('copy', 15)}Copy</button>` : ''}
      </div>
      <button type="button" class="icon-btn" data-act="lb-close" aria-label="Close">${ic('x', 18)}</button>
    </header><div class="viewer-body">${view}</div></div>`;
}
ACT['open-branch-doc'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line);
  try {
    const { md } = await api(`${topicApi(p, l, 'branch-file')}?path=${encodeURIComponent(el.dataset.path)}`);
    showViewer(el.dataset.path.split('/').pop(), md);
  } catch (error) { toast(error.message); }
};
ACT['viewer-mode'] = el => {
  if (!S.viewer) return;
  const { name, md, markdown, doc } = S.viewer, box = $('#lightbox');
  box.innerHTML = viewerHTML(name, md, el.dataset.mode === 'source', markdown, doc);
  $('[aria-selected="true"]', box)?.focus();
};
ACT['viewer-copy'] = () => copyText(S.viewer.md, 'Copied the Markdown');
ACT['viewer-line'] = el => {
  closeLightbox();
  ACT['open-line'](el);
};
function showViewer(name, md, markdown, doc = null) {
  const b = $('#lightbox');
  S.viewer = { name, md, markdown, doc };
  b.innerHTML = viewerHTML(name, md, false, markdown, doc); b.hidden = false;
  $('[data-act="lb-close"]', b).focus();
}
// Quotes this in the line's box, so what you write next says what it is about, and the agent is told.
ACT['line-refer'] = el => {
  const l = lineById(project(), S.route.line), s = l && stationById(l, el.dataset.step), form = $('.lp-dock .composer'); if (!s || !form) return;
  const c = comp(form.dataset.comp), words = plainOut(isYours(s) ? askOnly(s.text) || stopWords(s) : s.out).split('\n')[0].slice(0, 140);
  c.refers ||= [];
  if (!c.refers.some(r => r.step === s.id)) c.refers.push({ line:l.id, step:s.id, label:isYours(s) ? stepLabel(s) : stepLabel(s), words });
  // Clear overlays before focusing the composer. Docked details can stay open.
  const panel = $('#lpPanel');
  if (S.panelPopped) setPanelPopped(false);
  else if (panel && !panel.hidden && getComputedStyle(panel).position === 'absolute') ACT['panel-close']();
  syncComposer(form);
  $('.cmp-input', form).focus();
};
const WORK_REVIEW_BUSY = new Set();
function syncOrchReviewStation(l, s) {
  const rv = l?.stations?.find(x => isOrchReview(x) && (x.workId === s.id || x.id === reviewStepId(s.id)));
  if (!rv) return;
  const next = makeOrchReviewStation(l, s);
  if (next) Object.assign(rv, next, { index:rv.index, detail:rv.detail || next.detail });
}
async function startWorkReview(p, l, s, reviewerId) {
  if (!p || !l || !s || s.reviewing) return;
  const key = workReviewKey(p, l, s);
  if (WORK_REVIEW_BUSY.has(key)) return;
  const chosen = String(reviewerId || 'auto').trim() || 'auto';
  WORK_REVIEW_PICK.set(key, chosen);
  WORK_REVIEW_BUSY.add(key);
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator/review`, { method:'POST', body:{ line:l.id, work:s.id, reviewer:chosen } });
    s.reviewing = true;
    s.reviewStopped = null;
    if (r?.reviewPending) s.reviewPending = r.reviewPending;
    syncOrchReviewStation(l, s);
    refreshLine();
    refreshAfterChange();
    const who = r?.reviewPending?.by || (chosen === 'auto' ? 'PenEcho Auto' : 'reviewer');
    const stepId = r?.step || reviewStepId(s.id);
    toast(`Started review with ${who}`, {
      label:'View review',
      fn:() => {
        const curL = lineById(project(), l.id), rv = curL && lineStation(curL, stepId);
        if (curL && rv) pickStep(curL, rv);
      },
    });
  } catch (error) {
    toast(error?.status === 404 && !error.code ? 'Restart PenEcho to start a review from here.' : (error?.message || 'Could not start review.'));
  } finally {
    WORK_REVIEW_BUSY.delete(key);
  }
}
async function stopWorkReview(p, l, s) {
  if (!p || !l || !s || !s.reviewing) return;
  const key = workReviewKey(p, l, s);
  if (WORK_REVIEW_BUSY.has(key)) return;
  WORK_REVIEW_BUSY.add(key);
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator/review/stop`, { method:'POST', body:{ line:l.id, work:s.id } });
    s.reviewing = false;
    s.reviewPending = null;
    if (r?.reviewStopped) s.reviewStopped = r.reviewStopped;
    syncOrchReviewStation(l, s);
    refreshLine();
    refreshAfterChange();
    toast('Stopped review');
  } catch (error) {
    toast(error?.status === 404 && !error.code ? 'Restart PenEcho to stop a review from here.' : (error?.message || 'Could not stop review.'));
  } finally {
    WORK_REVIEW_BUSY.delete(key);
  }
}
async function continueWorkReview(p, l, s) {
  if (!p || !l || !s || s.reviewing || !s.reviewStopped) return;
  const key = workReviewKey(p, l, s);
  if (WORK_REVIEW_BUSY.has(key)) return;
  WORK_REVIEW_BUSY.add(key);
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator/review/continue`, { method:'POST', body:{ line:l.id, work:s.id } });
    s.reviewing = true;
    s.reviewStopped = null;
    if (r?.reviewPending) s.reviewPending = r.reviewPending;
    syncOrchReviewStation(l, s);
    refreshLine();
    refreshAfterChange();
    toast(`Continuing review with ${r?.reviewPending?.by || 'reviewer'}`);
  } catch (error) {
    toast(error?.status === 404 && !error.code ? 'Restart PenEcho to continue a review from here.' : (error?.message || 'Could not continue review.'));
  } finally {
    WORK_REVIEW_BUSY.delete(key);
  }
}
async function resendWorkReview(p, l, s, reviewerId = '') {
  if (!p || !l || !s || s.reviewing) return;
  const key = workReviewKey(p, l, s);
  if (WORK_REVIEW_BUSY.has(key)) return;
  WORK_REVIEW_BUSY.add(key);
  try {
    const chosen = String(reviewerId || '').trim();
    const r = await api(`${pathFor(p.id)}/orchestrator/review/resend`, { method:'POST', body:{ line:l.id, work:s.id, ...(chosen ? { reviewer:chosen } : {}) } });
    s.reviewing = true;
    s.reviewStopped = null;
    if (r?.reviewPending) s.reviewPending = r.reviewPending;
    syncOrchReviewStation(l, s);
    refreshLine();
    refreshAfterChange();
    toast(`Started review with ${r?.reviewPending?.by || 'reviewer'}`);
  } catch (error) {
    toast(error?.status === 404 && !error.code ? 'Restart PenEcho to resend a review from here.' : (error?.message || 'Could not resend review.'));
  } finally {
    WORK_REVIEW_BUSY.delete(key);
  }
}
const resolveReviewWork = (l, id) => {
  const found = l && stationById(l, id);
  return found && isOrchReview(found) ? (l.stations?.find(x => x.id === found.workId) || null) : found;
};
ACT['review-stop'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = resolveReviewWork(l, el.dataset.work || el.dataset.step);
  if (l && s) stopWorkReview(p, l, s);
};
ACT['review-continue'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = resolveReviewWork(l, el.dataset.work || el.dataset.step);
  if (l && s) continueWorkReview(p, l, s);
};
ACT['review-resend'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = resolveReviewWork(l, el.dataset.work || el.dataset.step);
  if (l && s) resendWorkReview(p, l, s, el.dataset.reviewer || '');
};
async function sendReviewFixes(p, l, s) {
  if (!p || !l || !s || !s.review) return;
  if (l.archived || l.closed) { toast('Reopen this Line to send an Ask.'); return; }
  const findings = reviewActionableFindings(s.review);
  if (!findings.length) return;
  const key = `${workReviewKey(p, l, s)}:fixes`;
  if (WORK_REVIEW_BUSY.has(key)) return;
  WORK_REVIEW_BUSY.add(key);
  try {
    const label = typeof stepLabel === 'function' ? stepLabel(s) : (s.label || s.id);
    const text = reviewFixPromptOf(label, findings);
    const lineId = typeof savedId === 'function' ? savedId(l.id) : l.id;
    const baseBody = { text, attachments:[], refers:[], topic:lineId };
    if (S.panelPopped && typeof setPanelPopped === 'function') setPanelPopped(false);
    if (typeof showAtOnce === 'function' && typeof saveBehind === 'function') {
      const box = typeof boxKey === 'function' ? boxKey(`conv-${p.id}-${l.slug || l.id}`) : `conv-${p.id}-${l.slug || l.id}`;
      const took = { text, files:[], refers:[], make:null };
      const e = showAtOnce(project(p.id) || p, { kind:'ask', text, took, here:l, offMain:false, open:true });
      const saved = await saveBehind(e, box, took, topic => api(`${pathFor(p.id)}/unsent`, { method:'POST', body:{ ...baseBody, topic } }));
      if (!saved) return;
    } else {
      const saved = await api(`${pathFor(p.id)}/unsent`, { method:'POST', body:baseBody });
      if (typeof loadState === 'function') await loadState(p.id, { force:true }).catch(() => {});
      refreshAfterChange();
      if (saved?.step && typeof scrollToItem === 'function') scrollToItem(saved.step);
    }
    toast('Added fixes as an Ask — click Run with to start.');
  } catch (error) {
    toast(error?.message || 'Could not send fixes.');
  } finally {
    WORK_REVIEW_BUSY.delete(key);
  }
}
ACT['review-send-fixes'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = resolveReviewWork(l, el.dataset.work || el.dataset.step);
  if (l && s) sendReviewFixes(p, l, s);
};
ACT['review-resend-pick'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = resolveReviewWork(l, el.dataset.work || el.dataset.step);
  if (!l || !s || s.reviewing) return;
  if ($('#menu.rev-menu')) { closeMenu(); return; }
  const info = workReviewCandidates(p, s);
  if (!info || !info.eligible.length) return;
  const sorted = [...info.eligible].sort((a, b) => compareRunMenuRow({ label:a.name, note:'' }, { label:b.name, note:'' }));
  const presetNote = r => [r.model, r.effort ? `${r.effort} effort` : '', r.id === info.defaultId ? 'Setting' : ''].filter(Boolean).join(' · ');
  const items = [
    { head:'Send review again with' },
    { label:'PenEcho Auto', icon:'orchestrate', note:`Picks best-rated coding agent that did not do this work${info.defaultId === 'auto' ? ' · Setting' : ''}`, fn:() => resendWorkReview(p, l, s, 'auto') },
    ...sorted.map(r => ({ label:r.name, av:r.agent || undefined, note:presetNote(r), fn:() => resendWorkReview(p, l, s, r.id) })),
    { sep:true },
    { label:'Orchestrator settings…', icon:'gear', fn:() => { if (typeof ORCHSET === 'object') ORCHSET.openAfterLoad = true; go({ view:'orchestrator' }); } },
  ];
  openMenu(el.closest('.rv-resend-split') || el, items, { align:'left', className:'run-menu rev-menu' });
};
ACT['work-review'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = l && stationById(l, el.dataset.step);
  if (!l || !s) return;
  if (s.reviewing) {
    const rv = lineStation(l, reviewStepId(s.id));
    if (rv) pickStep(l, rv);
    return;
  }
  startWorkReview(p, l, s, el.dataset.reviewer || 'auto');
};
ACT['work-review-pick'] = el => {
  const p = project(), l = lineById(p, el.dataset.line || S.route.line), s = l && stationById(l, el.dataset.step);
  if (!l || !s || s.reviewing) return;
  if ($('#menu.rev-menu')) { closeMenu(); return; }
  const info = workReviewCandidates(p, s);
  if (!info || !info.eligible.length) return;
  const selected = workReviewSelected(p, l, s, info);
  const sorted = [...info.eligible].sort((a, b) => compareRunMenuRow({ label:a.name, note:'' }, { label:b.name, note:'' }));
  const presetNote = r => {
    const facts = [r.model, r.effort ? `${r.effort} effort` : ''].filter(Boolean).join(' · ');
    return [facts, r.id === info.defaultId ? 'Setting' : ''].filter(Boolean).join(' · ');
  };
  const items = [
    { head:'Review with' },
    {
      label:'PenEcho Auto',
      icon:'orchestrate',
      note:`Picks best-rated coding agent that did not do this work${info.defaultId === 'auto' ? ' · Setting' : ''}`,
      on:selected.id === 'auto',
      fn:() => startWorkReview(p, l, s, 'auto'),
    },
    ...sorted.map(r => ({
      label:r.name,
      av:r.agent || undefined,
      note:presetNote(r),
      on:selected.id === r.id,
      fn:() => startWorkReview(p, l, s, r.id),
    })),
    { sep:true },
    {
      label:'Orchestrator settings…',
      icon:'gear',
      fn:() => {
        if (typeof ORCHSET === 'object') ORCHSET.openAfterLoad = true;
        go({ view:'orchestrator' });
      },
    },
  ];
  const anchor = el.closest('.rev-split') || el;
  const resolveAnchor = () => {
    const split = $(`.rev-split[data-rev-split="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s.id) : s.id}"]`, $('#lpPanel') || document);
    return split && menuAnchorRect(split) ? split : null;
  };
  openMenu(anchor, items, { align:'left', className:'run-menu rev-menu', resolveAnchor });
};
// From a picture to the box, so you can say what you want done with it.
ACT['conv-about'] = el => {
  const input = $('.lp-dock .cmp-input'); if (!input) return;
  if (S.panelPopped) setPanelPopped(false);
  input.value = `About ${el.dataset.path}: ${input.value}`;
  input.dispatchEvent(new Event('input', { bubbles:true }));
  input.focus();
};
const CHANGES_SHOWN = 3;
function changesCard(l, files) {
  if (!files.length) return '';
  const diff = (add, del) => `<span class="row-diff"><i>+${add}</i> <u>−${del}</u></span>`, line = esc(l.id);
  const rows = files.slice(0, CHANGES_SHOWN).map(f => `<button type="button" class="chg-row" data-act="open-changes" data-line="${line}" data-path="${esc(f.path)}" title="${esc(f.path)}">${ic('code', 15)}<span>${esc(f.path.split('/').pop())}</span>${diff(f.add, f.del)}</button>`).join('');
  const all = files.length > CHANGES_SHOWN ? `<button type="button" class="chg-row chg-all" data-act="open-changes" data-line="${line}"><span>See all</span>${diff(files.reduce((n, f) => n + f.add, 0), files.reduce((n, f) => n + f.del, 0))}</button>` : '';
  return `<section class="changes" aria-label="Files changed"><header>Edited ${files.length} ${files.length === 1 ? 'file' : 'files'}</header>${rows}${all}</section>`;
}
ACT['open-changes'] = el => {
  const p = project(), l = lineById(p, el.dataset.line), all = liveOf(p, l).diff?.files || [], path = el.dataset.path, files = path ? all.filter(f => f.path === path) : all, b = $('#lightbox');
  b.innerHTML = `<div class="lb-card viewer-card" role="dialog" aria-label="Changes"><header><strong>${esc(path ? path.split('/').pop() : `${all.length} files`)}</strong><button type="button" class="icon-btn" data-act="lb-close" aria-label="Close">${ic('x', 18)}</button></header><div class="viewer-body">${diffHTML(files)}</div></div>`;
  b.hidden = false;
};

// ---------- What you can do to a Topic ----------
async function sendFeedback(l, { text, files, picture }) {
  if (l.archived || l.closed) throw new Error('Reopen this Line to send an Ask.');
  const p = project(), attachments = files?.length ? await uploadFiles(p, files, `files/${l.slug}`) : [];
  await act(l, 'feedback', { text, attachments, picture });
  pollActivity();
  const known = S.docs[docKey(p.id, l.topicPath)]; if (known) known.mtime = 0;
}
async function answerFromBox(el, doc, opts, onChange) {
  // Structured options object from Reader.bind: { line, checked, expectedText, questionText, ownerProject }
  const legacy = el && typeof doc === 'string';
  const box = legacy ? { line: -1, checked: /\[[xX]\]/.test(doc), expectedText: '', questionText: '', boxLine: doc, ownerProject: project() } : (opts || {});
  if (legacy) { doc = el; el = null; }
  const owner = box.ownerProject || project();
  const patched = Number.isInteger(box.line) && box.line >= 0 && typeof toggleTaskLineInDoc === 'function'
    ? toggleTaskLineInDoc(doc.md, box.line, Boolean(box.checked), box.expectedText)
    : null;
  const boxLine = patched ? patched.line : (box.boxLine || '');
  const label = (boxLine.match(/\[[ xX]\]\s*(.+)$/) || [])[1]?.trim() || '';
  // Only a positive check inside the top-level "Questions for you" section under a matching question heading answers a structured question.
  if (box.checked && (box.questionSource || box.questionText) && label) {
    await loadState(owner.id, { force:true }).catch(() => {});
    const p = project(owner.id) || owner, l = lineOfDoc(p, doc);
    const q = l && openQuestions(l).find(x => x.text === box.questionText && x.options.includes(label));
    if (l && !l.archived && !l.closed && (box.questionSource || q)) {
      checkAnswerOk(await act(l, 'answer', box.questionSource ? { sourceHash:box.questionSource, sourceLine:box.line, answer:label } : { question:q.id, questionRev:l.questionRev, answer:label }, p));
      toast(`Recorded in ${l.slug}.md`);
      refreshAfterChange();
      return;
    }
    throw new Error('That question changed. Refresh and try again.');
  }
  const p = project(owner.id) || owner, l = lineOfDoc(p, doc);
  if (!patched || HOSTED?.read || l?.archived || l?.closed) {
    throw new Error('Only the answer to a question is yours to tick here.');
  }
  await saveDoc(p, doc, patched.md);
  onChange?.();
  refreshAfterChange();
}
function qDraftKey(lineId, req, revision, projectId = project()?.id, stepId = '') {
  const line = lineById(project(projectId), lineId);
  const step = stepId && line?.stations ? line.stations.find(st => st.id === stepId) : null;
  const rev = req === '__topic__' ? (revision ?? (step && 'questionRev' in step ? step.questionRev : line?.questionRev) ?? '') : (step?.asking?.launchId || line?.asking?.launchId || '');
  const scope = JSON.stringify([projectId, lineId, stepId, req === '__topic__' ? 'markdown' : 'tool']);
  const key = JSON.stringify([projectId, lineId, ...(stepId ? [stepId] : []), req, rev]);
  const previous = (S.qDraftScopes ||= {})[scope];
  if (req !== '__topic__' && previous && previous !== key && S.qDrafts) delete S.qDrafts[previous];
  S.qDraftScopes[scope] = key;
  return key;
}
function saveQDraft(lineId, req, qid, val, revision, stepId = '') {
  if (!req || !qid) return;
  const k = qDraftKey(lineId, req, revision, project()?.id, stepId);
  (S.qDrafts ||= {})[k] ||= {};
  S.qDrafts[k][qid] = val;
  if (req === '__topic__') syncQDraftUI(lineId);
}
function choiceKeydown(event) {
  const choice = event.target.closest?.('.q-choice');
  if (!choice || !['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'].includes(event.key)) return;
  const choices = [...choice.parentElement.querySelectorAll('.q-choice')];
  const delta = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (choices.indexOf(choice) + delta + choices.length) % choices.length;
  event.preventDefault();
  choices[index].focus();
}
function clearQDraft(lineId, req, stepId = '', launchId) {
  if (launchId !== undefined) {
    const key = JSON.stringify([project()?.id, lineId, ...(stepId ? [stepId] : []), req, launchId]);
    if (S.qDrafts) delete S.qDrafts[key];
    return;
  }
  if (req && S.qDrafts) delete S.qDrafts[qDraftKey(lineId, req, undefined, project()?.id, stepId)];
}
function checkAnswerOk(res) {
  if (res?.ok === false) throw new Error(res?.error || 'Could not send your answer.');
  return res;
}
function syncQDraftUI(lineId) {
  if (!lineId || typeof document === 'undefined' || !document.querySelectorAll) return;
  const draftsFor = el => {
    const card = el.closest?.('.q-card');
    const stepId = el.dataset?.step || card?.dataset?.step || '';
    return S.qDrafts?.[qDraftKey(lineId, '__topic__', card?.dataset?.questionRev, project()?.id, stepId)] || {};
  };
  const checkIcon = typeof ic === 'function' ? ic('check', 12) : '';
  for (const btn of document.querySelectorAll('[data-act="pick-q-opt"]')) {
    if (btn.dataset?.line !== lineId) continue;
    const on = draftsFor(btn)[btn.dataset.q || ''] === (btn.dataset.a ?? '');
    btn.classList?.toggle?.('is-picked', on);
    btn.setAttribute?.('aria-pressed', on ? 'true' : 'false');
    const dot = btn.querySelector?.('.q-opt-dot');
    if (dot) dot.innerHTML = on ? checkIcon : '';
  }
  for (const input of document.querySelectorAll('.q-input[data-q-kind="topic"], .q-input[data-q-kind="waiting"]')) {
    if (input.dataset?.line !== lineId || input === document.activeElement) continue;
    const note = draftsFor(input).__note || '';
    if (input.value !== note) input.value = note;
  }
}
ACT['pick-q-opt'] = el => {
  const lineId = el.dataset.line || '', qid = el.dataset.q || '', val = el.dataset.a ?? '';
  if (!lineId || !qid) return;
  const card = el.closest?.('.q-card');
  const stepId = el.dataset.step || card?.dataset?.step || '';
  const k = qDraftKey(lineId, '__topic__', card?.dataset?.questionRev, project()?.id, stepId);
  const drafts = (S.qDrafts ||= {})[k] ||= {};
  if (drafts[qid] === val) delete drafts[qid];
  else drafts[qid] = val;
  syncQDraftUI(lineId);
};
ACT['submit-q-topic'] = async el => {
  const card = el.closest?.('.q-card') || null;
  const l = lineById(project(), el.dataset.line);
  if (!l) return;
  const input = card && $('.q-input', card);
  const stepId = el.dataset.step || card?.dataset?.step || '';
  const stepObj = stepId && l?.stations ? l.stations.find(st => st.id === stepId) : null;
  const revision = card?.dataset.questionRev || '';
  const currentRev = (stepObj && 'questionRev' in stepObj ? stepObj.questionRev : l.questionRev) || '';
  if ((card?.dataset.project && card.dataset.project !== project().id) || revision !== currentRev) {
    toast('The questions changed. Review the updated choices before replying.');
    return;
  }
  const k = qDraftKey(l.id, '__topic__', revision, project()?.id, stepId);
  const drafts = { ...(S.qDrafts?.[k] || {}) };
  if (input && typeof input.value === 'string') drafts.__note = input.value;
  if (card?.querySelectorAll) {
    for (const btn of card.querySelectorAll('.q-choice.is-picked[data-q][data-a]')) {
      if (!(btn.dataset.q in drafts)) drafts[btn.dataset.q] = btn.dataset.a;
    }
  }
  const note = String(drafts.__note || '').trim();
  const openQs = stepObj ? workQuestions(l, stepObj) : openQuestions(l);
  const pickedAnswers = {};
  for (const q of openQs) {
    const val = typeof drafts[q.id] === 'string' ? drafts[q.id].trim() : '';
    if (val) pickedAnswers[q.id] = val;
  }
  const pickedCount = Object.keys(pickedAnswers).length;
  if (!pickedCount && !note) { input?.focus?.(); return; }
  let body;
  if (openQs.length === 0) {
    body = { question:'__waiting__', answer:note, note };
  } else if (openQs.length === 1) {
    const only = openQs[0], sel = pickedAnswers[only.id] || '';
    body = sel && note ? { question:only.id, answer:sel, note } : { question:only.id, answer:sel || note };
  } else if (pickedCount > 0) {
    body = { answers:pickedAnswers, ...(note ? { note } : {}) };
  } else {
    body = { question:'__waiting__', answer:note, note };
  }
  if (stepId) body.stepId = stepId;
  if (revision) body.questionRev = revision;
  try {
    const result = checkAnswerOk(await api(topicApi(project(), l, 'answer'), { method:'POST', body }));
    if (S.qDrafts) delete S.qDrafts[k];
    toast(replyOutcome(result, l));
    await loadState(project().id, { force:true });
    refreshAfterChange();
  } catch (error) {
    toast(error.message);
  }
};
ACT['answer-q'] = async el => {
  const l = lineById(project(), el.dataset.line), q = l.questions.find(x => x.id === el.dataset.q);
  // The question leaves at once; the agent it was waiting for carries on behind it.
  try { checkAnswerOk(await actAtOnce(l, 'answer', { question:q.id, answer:el.dataset.a }, x => { x.questions = (x.questions || []).filter(y => y.id !== q.id); return true; })); toast(`Recorded in ${l.slug}.md`); }
  catch (error) { toast(error.message); }
};
ACT['answer-q-custom'] = async el => {
  if (el.closest?.('.q-card')?.classList?.contains('is-topic-q')) return ACT['submit-q-topic'](el);
  const card = el.closest?.('.q-card'), input = card && $('.q-input', card), answer = input?.value?.trim() || '';
  if (!answer) { input?.focus?.(); return; }
  const l = lineById(project(), el.dataset.line), q = l?.questions?.find(x => x.id === el.dataset.q);
  if (!l || !q) return;
  try {
    checkAnswerOk(await actAtOnce(l, 'answer', { question:q.id, answer }, x => { x.questions = (x.questions || []).filter(y => y.id !== q.id); return true; }));
    clearQDraft(l.id, '__topic__');
    toast(`Recorded in ${l.slug}.md`);
  } catch (error) {
    const liveCard = document.querySelector(`.q-card[data-q-card="${CSS.escape ? CSS.escape(q.id) : q.id}"]`) || card;
    const liveInput = liveCard && $('.q-input', liveCard);
    if (liveInput) { liveInput.value = answer; liveInput.focus?.(); }
    toast(error.message);
  }
};
ACT['pick-tool-opt'] = el => {
  const block = el.closest('[data-q-block]');
  if (!block) return;
  for (const btn of $$('[data-act="pick-tool-opt"]', block)) {
    const on = btn === el;
    btn.classList.toggle('is-picked', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const input = $('.q-input', block);
  if (input) input.value = '';
  const stepId = el.dataset.step || el.closest?.('.q-card')?.dataset?.step || '';
  if (block.dataset.qSecret !== '1') saveQDraft(el.dataset.line || '', el.dataset.req || '', el.dataset.q || '', el.dataset.a || '', undefined, stepId);
};
ACT['answer-tool'] = async el => {
  const l = lineById(project(), el.dataset.line);
  if (!l) return;
  const req = el.dataset.req || '', stepId = el.dataset.step || '', launchId = el.dataset.launch || '', qid = el.dataset.q || '', val = el.dataset.a || '';
  try {
    checkAnswerOk(await actAtOnce(l, 'answer', { requestId:req, ...(stepId ? { stepId } : {}), ...(launchId ? { launchId } : {}), question:qid, answer:val, answers:qid ? { [qid]:val } : undefined }, x => {
      const targetStep = stepId && stationById(x, stepId);
      if (targetStep && targetStep.asking) targetStep.asking = null;
      if (x.asking && (!stepId || !x.asking.step || x.asking.step === stepId)) x.asking = null;
      return true;
    }));
    clearQDraft(l.id, req, stepId, launchId);
    toast('Sent your answer.');
  } catch (error) { toast(error.message); }
};
ACT['answer-tool-multi'] = async el => {
  const block = el.closest('[data-q-block]') || el.closest('.q-card'), l = lineById(project(), el.dataset.line);
  if (!block || !l) return;
  const checks = [...$$('.q-checks input[type="checkbox"]:checked', block)].map(x => x.value).filter(Boolean);
  if (!checks.length) { toast('Select at least one option.'); return; }
  const req = el.dataset.req || '', stepId = el.dataset.step || '', launchId = el.dataset.launch || '', qid = el.dataset.q || '';
  try {
    checkAnswerOk(await actAtOnce(l, 'answer', { requestId:req, ...(stepId ? { stepId } : {}), ...(launchId ? { launchId } : {}), question:qid, answer:checks.join(', '), answers:{ [qid]:checks } }, x => {
      const targetStep = stepId && stationById(x, stepId);
      if (targetStep && targetStep.asking) targetStep.asking = null;
      if (x.asking && (!stepId || !x.asking.step || x.asking.step === stepId)) x.asking = null;
      return true;
    }));
    clearQDraft(l.id, req, stepId, launchId);
    toast('Sent your answer.');
  } catch (error) { toast(error.message); }
};
ACT['answer-tool-all'] = async el => {
  const card = el.closest('.q-card'), l = lineById(project(), el.dataset.line);
  if (!card || !l) return;
  const req = el.dataset.req || '', stepId = el.dataset.step || card.dataset.step || '', launchId = el.dataset.launch || '';
  const blocks = [...$$('[data-q-block]', card)];
  const answers = {};
  for (const block of blocks) {
    const qid = block.dataset.qBlock || '';
    const isMulti = block.dataset.qMultiSelect === '1';
    const input = $('.q-input', block);
    const typed = input?.value?.trim() || '';
    if (isMulti) {
      const checks = [...$$('.q-checks input[type="checkbox"]:checked', block)].map(x => x.value).filter(Boolean);
      const list = typed ? [...checks, typed] : checks;
      if (!list.length) { toast('Please answer every question before submitting.'); input?.focus(); return; }
      answers[qid] = list;
      if (block.dataset.qSecret !== '1') saveQDraft(l.id, req, qid, list, undefined, stepId);
    } else {
      const picked = $('[data-act="pick-tool-opt"].is-picked', block)?.dataset?.a || '';
      const val = typed || picked;
      if (!val) { toast('Please answer every question before submitting.'); input?.focus(); return; }
      answers[qid] = val;
      if (block.dataset.qSecret !== '1') saveQDraft(l.id, req, qid, val, undefined, stepId);
    }
  }
  try {
    checkAnswerOk(await actAtOnce(l, 'answer', { requestId:req, ...(stepId ? { stepId } : {}), ...(launchId ? { launchId } : {}), answers }, x => {
      const targetStep = stepId && stationById(x, stepId);
      if (targetStep && targetStep.asking) targetStep.asking = null;
      if (x.asking && (!stepId || !x.asking.step || x.asking.step === stepId)) x.asking = null;
      return true;
    }));
    clearQDraft(l.id, req, stepId, launchId);
    toast('Sent your answers.');
  } catch (error) { toast(error.message); }
};
ACT['answer-tool-custom'] = async el => {
  const card = el.closest('.q-card'), input = card && $('.q-input', card), answer = input?.value?.trim() || '';
  if (!answer) { input?.focus(); return; }
  const l = lineById(project(), el.dataset.line);
  if (!l) return;
  const req = el.dataset.req || '', stepId = el.dataset.step || card?.dataset?.step || '', launchId = el.dataset.launch || '', qid = el.dataset.q || '';
  const isSecret = input?.type === 'password';
  try {
    checkAnswerOk(await actAtOnce(l, 'answer', { requestId:req, ...(stepId ? { stepId } : {}), ...(launchId ? { launchId } : {}), question:qid, answer, answers:qid ? { [qid]:answer } : undefined }, x => {
      const targetStep = stepId && stationById(x, stepId);
      if (targetStep && targetStep.asking) targetStep.asking = null;
      if (x.asking && (!stepId || !x.asking.step || x.asking.step === stepId)) x.asking = null;
      return true;
    }));
    clearQDraft(l.id, req, stepId, launchId);
    toast('Sent your answer.');
  } catch (error) {
    if (!isSecret) saveQDraft(l.id, req, qid, answer, undefined, stepId);
    const liveCard = document.querySelector(`.q-card[data-req-card="${CSS.escape ? CSS.escape(req) : req}"]`) || card;
    const liveInput = liveCard && $('.q-input', liveCard);
    if (liveInput && !isSecret) { liveInput.value = answer; liveInput.focus(); }
    toast(error.message);
  }
};
// Any click on a line leads to the same page, at that place on it.
// A line in the sidebar may be in another project: that project opens on it, where you left it if it is the line you left.
ACT['open-line'] = el => {
  if (typeof railExpandParent === 'function') railExpandParent(el);
  if (el.dataset.p && el.dataset.p !== S.cur) {
    const last = lastProjectRoute(el.dataset.p);
    switchProject(el.dataset.p, { route:last.view === 'line' && last.line === el.dataset.line ? last : { view:'line', line:el.dataset.line } });
    return;
  }
  const fromParent = el.dataset.fromParent, p = project(), parent = fromParent && p && lineById(p, fromParent);
  const lineOrigin = parent && el.dataset.line && el.dataset.line !== parent.id ? {
    project:S.cur,
    line:el.dataset.line,
    fromLine:parent.id,
    fromCode:parent.code || parent.id,
    fromTitle:parent.title || parent.code || parent.id,
    top:$('#lpScroll')?.scrollTop || 0,
    parentOrchestratorOrigin:lineOrchestratorOrigin(S.cur, parent.id) || null,
    parentHomeLinesOrigin:typeof currentHomeLinesOrigin === 'function' ? currentHomeLinesOrigin(S.cur, parent.id) : null,
  } : null;
  go({ view:'line', line:el.dataset.line }, { from:el, ...(lineOrigin ? { lineOrigin } : {}) });
};
ACT['open-step'] = el => { const l = lineById(project(), el.dataset.line), s = l && stationById(l, el.dataset.step); go({ view:'line', line:el.dataset.line, step:s?.toReview ? nextToReview(l).id : el.dataset.step }, { from:el }); };
const STARTS = new Set(['start', 'retry']);
ACT['continue-work'] = async el => {
  const l = lineById(project(), el.dataset.line), step = el.dataset.step;
  if (!l || !can('continue-work') || !stationById(l, step)?.canContinue) return;
  try {
    await actAtOnce(l, 'continue', { step }, line => {
      const work = stationById(line, step);
      if (!work?.canContinue) return false;
      if (line.continueStep === step) {
        lineStarts(work.agent)(line);
        Object.assign(line, { canContinue:false, continueStep:'', why:'' });
      } else line.running = true;
      Object.assign(work, { state:'active', canContinue:false, off:'', why:'', stopWhy:'', resetsAt:'', now:'Continuing…' });
      return true;
    });
  } catch (error) { toast(error.message); }
};
ACT['line-do'] = async el => {
  const p = project(), verb = el.dataset.verb;
  let l = lineById(p, el.dataset.line);
  el.disabled = true;
  // Stop works while an agent is still starting (PE-600): the server ends the start before the agent runs, so the line no longer shows it starting.
  if (verb === 'stop') letStartGo(l);
  // Start and Try again show the line working at once; the agent starts behind it.
  try {
    if (!l) {
      await loadState(p.id, { force:true, needs:{ lines:[el.dataset.line] } });
      if (project()?.id !== p.id) return;
      l = lineById(project(), el.dataset.line);
      if (!l) throw Error('This Line is no longer available.');
    }
    const starts = STARTS.has(verb), result = await (starts ? actAtOnce(l, verb, {}, lineStarts('')) : act(l, verb));
    if (starts && result === false) { el.disabled = false; return; }
    toast({ start:`Started ${l.title}`, retry:`Trying ${l.title} again`, stop:`Stopped ${l.title}` }[verb] || 'Done'); refreshAfterChange();
  }
  catch (error) { el.disabled = false; toast(error.message); }
};
ACT['discard-work'] = async el => {
  const l = lineById(project(), el.dataset.line);
  el.disabled = true;
  try { await act(l, 'discard', { step:el.dataset.step }); refreshAfterChange(); }
  catch (error) { el.disabled = false; toast(error.message); }
};
// Send again: the failed Work leaves, its Ask is Not sent where it was, and Run with or Paste there picks who does it this time.
ACT['resend-work'] = async el => {
  const l = lineById(project(), el.dataset.line);
  el.disabled = true;
  try {
    const r = await act(l, 'resend', { step:el.dataset.step });
    refreshAfterChange();
    requestAnimationFrame(() => document.getElementById(`item-${r?.steps?.[0] || ''}`)?.scrollIntoView({ block:'center', behavior:'smooth' }));
    toast('Not sent yet. Choose who runs it.');
  } catch (error) { el.disabled = false; toast(error.message); }
};
// Out of the queue: the Work goes, its Ask is Not sent where Asks wait, and the Work running now carries on.
ACT['unqueue-work'] = async el => {
  const l = lineById(project(), el.dataset.line);
  el.disabled = true;
  try {
    const r = await act(l, 'unqueue', { step:el.dataset.step });
    if (S.lineSel?.id === el.dataset.step) ACT['panel-close']();
    refreshAfterChange();
    requestAnimationFrame(() => document.getElementById(`item-${r?.steps?.[0] || ''}`)?.scrollIntoView({ block:'center', behavior:'smooth' }));
    toast('Out of the queue. Not sent yet.');
  } catch (error) { el.disabled = false; toast(error.message); }
};
ACT['reopen-line'] = async el => {
  const l = lineById(project(), el.dataset.line);
  try { await act(l, 'reopen', l.archiveOperation ? { archiveOperation:l.archiveOperation } : {}); toast(`${l.title} is back on the lines.`); render(); }
  catch (error) { toast(error.message); }
};
// The branches that would leave the map with commits not yet where they merge to: no line stays on them once these are archived.
function unmergedLeaving(p, going) {
  const ids = new Set(going.map(l => l.id)), found = new Map();
  for (const l of going) {
    const info = branchInfo(p, l);
    if (!l.branch || l.mergeOf || found.has(l.branch) || info.merged || info.mergeable !== true) continue;
    if (allLines(p).some(x => x.branch === l.branch && !x.mergeOf && !x.archived && !ids.has(x.id))) continue;
    found.set(l.branch, { line:l, branch:l.branch, into:mergeTarget(p, l).name, ahead:info.ahead || 0 });
  }
  return [...found.values()];
}
// Archive asks first when it would hide unmerged work. Resolves 'archive', 'merge' (with the line whose Merge to open) or null.
function archiveWarning(p, going, anchor) {
  const left = unmergedLeaving(p, going);
  if (!left.length) return Promise.resolve({ choice:'archive' });
  const one = left.length === 1 ? left[0].line : null, mergeStep = one && canMerge(p, one) && [...one.stations].reverse().find(s => s.kind === 'merge' && s.state === 'wait');
  const commits = n => (n ? `${n} ${n === 1 ? 'commit' : 'commits'}` : 'commits');
  return new Promise(resolve => {
    let answer = null;
    const dialog = document.createElement('dialog');
    dialog.className = 'line-command-dialog archive-warn';
    dialog.setAttribute('aria-labelledby', 'archiveWarnTitle');
    dialog.innerHTML = `<form><h2 id="archiveWarnTitle">Archive without merging?</h2><ul>${left.map(b => `<li><code>${esc(b.branch)}</code> has ${commits(b.ahead)} not in <code>${esc(b.into)}</code></li>`).join('')}</ul><footer><button type="button" class="btn" data-cancel>Cancel</button>${mergeStep ? `<button type="button" class="btn" data-merge>${ic('merge', 15)}Merge first</button>` : ''}<button type="submit" class="btn primary">Archive anyway</button></footer></form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); if (!answer && anchor?.isConnected) anchor.focus(); resolve(answer); });
    $('[data-cancel]', dialog).onclick = () => dialog.close();
    if (mergeStep) $('[data-merge]', dialog).onclick = () => { answer = { choice:'merge', line:one, step:mergeStep }; dialog.close(); };
    $('form', dialog).onsubmit = e => { e.preventDefault(); answer = { choice:'archive' }; dialog.close(); };
    dialog.showModal();
    $('[data-cancel]', dialog).focus();
  });
}
function openMergeFor(l, s) {
  if (S.route.view === 'line' && S.route.line === l.id) { pickStep(l, s, { scroll:false }); return; }
  go({ view:'line', line:l.id, step:s.id });
}
// A Topic stays on the lines until you do this, however long ago it finished.
// Outdated (PE-425) archives it the same way, marked as no longer valid or replaced by newer work. A line in the Archive already only gets the mark.
const OUTDATED_SAY = 'No longer valid, or replaced by newer work. It goes to the Archive.';
async function archiveLine(l, anchor, outdated = false, p = project()) {
  const group = !outdated && l.orchestratorRef ? archiveScope(p, [l]) : null;
  const was = l.archived, answer = was ? { choice:'archive' } : await archiveWarning(p, group?.moving || [l], anchor);
  if (answer?.choice === 'merge') {
    if (S.cur === p.id) openMergeFor(answer.line, answer.step);
    else switchProject(p.id, { route:{ view:'line', line:answer.line.id, step:answer.step.id } });
    return;
  }
  if (answer?.choice !== 'archive') return;
  try {
    const result = await act(l, outdated ? 'outdated' : 'close', group ? { expectedChildren:group.roots[0].children.map(child => child.id) } : {}, p);
    const archived = new Set(result?.archivedLines || [l.id]);
    if (S.cur === p.id) S.plan = S.plan.filter(x => !archived.has(x.from));
    const undo = outdated && was ? () => act(l, 'outdated', { outdated:false }, p) : () => act(l, 'reopen', result?.archiveOperation ? { archiveOperation:result.archiveOperation } : {}, p);
    const count = archived.size - 1;
    toast(outdated ? (was ? 'Marked outdated' : 'Outdated and archived') : count ? `Archived job and ${count} ${count === 1 ? 'sub-session' : 'sub-sessions'}` : 'Archived', { label:'Undo', fn:() => undo().then(refreshAfterChange).catch(error => toast(error.message)) });
    refreshAfterChange();
    if (!was && S.cur === p.id && (anchor?.dataset.act === 'rail-line-menu' ? S.route.line === l.id : S.route.view !== 'home')) go({ view:'home' });
  } catch (error) { toast(error.message); }
}
ACT['archive-line'] = el => archiveLine(lineById(project(), el.dataset.line), el);
ACT['line-outdated'] = el => archiveLine(lineById(project(), el.dataset.line), el, true);
function linkedChats(l) { return Object.values(l.conversations || (l.conversation ? { one:l.conversation } : {})).filter(Boolean); }
// The conversations of a line, as one button of agent faces: one opens it at once, more open a menu (PE-478).
function chatButtons(l) {
  const current = currentStation(l), target = followedStopTarget(l, current);
  const stop = target ? followedStopButton(l, current, target) : '';
  if (!S.thisComputer || (l.running && !l.elsewhere)) return stop;
  const chats = linkedChats(l);
  if (target?.app && chats.length === 1 && chats[0].agent === target.agent) return stop;
  if (chats.length > 1) return stop + `<button type="button" class="chat-direct chat-faces" data-act="line-chats" data-line="${esc(l.id)}" aria-haspopup="menu" aria-label="Agent conversations: ${esc(chats.map(c => c.canOpen ? c.app : agentInfo(c.agent).name).join(', '))}" title="Agent conversations"><span class="chat-stack">${chats.slice(0, 3).map(c => av(c.agent, 20)).join('')}</span>${ic('down', 12)}</button>`;
  return stop + chats.map(c => {
    const name = c.canOpen ? c.app : agentInfo(c.agent).name, inner = `${av(c.agent, 18)}<span>${esc(name)}</span>`;
    if (c.canOpen) return `<button type="button" class="chat-direct" data-act="open-desktop" data-line="${esc(l.id)}" data-agent="${esc(c.agent)}" title="Open in ${esc(c.app)}" aria-label="Open ${esc(l.title)} in ${esc(c.app)}">${inner}</button>`;
    if (c.opensApp) return `<button type="button" class="chat-direct" data-act="open-desktop" data-line="${esc(l.id)}" data-agent="${esc(c.agent)}" title="Open ${esc(c.opensApp)}" aria-label="Open ${esc(c.opensApp)}">${inner}</button>`;
    if (c.terminal) return `<button type="button" class="chat-direct" data-act="copy-command" data-command="${esc(c.terminalFull || c.terminal)}" title="Copy ${esc(c.terminal)}">${inner}</button>`;
    return `<span class="chat-direct">${inner}</span>`;
  }).join('');
}
ACT['line-chats'] = el => {
  const p = project(), l = lineById(p, el.dataset.line); if (!l) return;
  const run = (act, data) => ACT[act]({ dataset:{ line:l.id, ...data } });
  openMenu(el, linkedChats(l).map(c => {
    const name = c.canOpen ? c.app : agentInfo(c.agent).name;
    if (c.canOpen) return { label:name, av:c.agent, note:`Open in ${c.app}`, fn:() => run('open-desktop', { agent:c.agent }) };
    if (c.opensApp) return { label:name, av:c.agent, note:`Open ${c.opensApp}`, fn:() => run('open-desktop', { agent:c.agent }) };
    if (c.terminal) return { label:name, av:c.agent, note:`Copy ${c.terminal}`, fn:() => run('copy-command', { command:c.terminalFull || c.terminal }) };
    return { label:name, av:c.agent, disabled:true };
  }), { align:'right' });
};
// Dialogs keep input and destructive confirmation separate from the menu action.
function lineDialog(l, mode, anchor, p = project()) {
  const deleting = mode === 'delete', dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'lineCommandTitle');
  dialog.innerHTML = `<form><h2 id="lineCommandTitle">${deleting ? 'Delete line?' : 'Rename line'}</h2>${deleting ? `<p><strong>${esc(l.title)}</strong> will leave this project’s lines. It stays in Deleted for 7 days, where you can restore it.</p><p>Code, Git branches, agent conversations, work details and attachments stay where they are.</p>` : `<label for="lineTitleInput">Title</label><input id="lineTitleInput" name="title" maxlength="160" required value="${esc(l.title)}" autocomplete="off">`}<p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn ${deleting ? 'danger' : 'primary'}">${deleting ? 'Delete line' : 'Save title'}</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      const result = await api(`${pathFor(p.id)}/topics/${encodeURIComponent(l.id)}/${mode}`, { method:'POST', body:deleting ? { confirm:l.id, baseHash:l.topicHash } : { title:$('input', dialog).value, baseHash:l.topicHash } });
      dialog.close();
      await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined });
      if (deleting && S.cur === p.id) { S.plan = S.plan.filter(x => x.from !== l.id); if (S.route.line === l.id) go({ view:'home' }); else refreshAfterChange(); }
      else refreshAfterChange();
      if (deleting && !result.warning) toast('Line deleted', can('restore-line') ? { label:'Undo', fn:() => restoreLine(l.id, p) } : null); else toast(result.warning || 'Title saved.');
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = false; }
  };
  dialog.showModal();
  if (deleting) $('[data-cancel]', dialog).focus(); else $('input', dialog).select();
}
async function toggleLinePin(p, l, button) {
  if (!l || l.archived || button?.getAttribute('aria-busy') === 'true') return;
  const on = !isPinned(p, l), focused = button && document.activeElement === button;
  button?.setAttribute('aria-busy', 'true');
  try {
    await pinLine(p, l, on);
    renderRail();
    if (S.cur === p.id && !EMBED?.rail) { if (S.route.view === 'home') Pano.update(); else refreshLine(); }
    if (focused && button.dataset.act === 'rail-line-menu') railLineMenuButton(p.id, l.id)?.focus({ preventScroll:true });
    else if (focused && S.cur === p.id) $$('[data-act="line-pin"]').find(el => el.dataset.line === l.id)?.focus({ preventScroll:true });
    toast(on ? 'Pinned' : 'Unpinned');
  } catch (error) { toast(error.message); }
  finally { button?.removeAttribute('aria-busy'); }
}
ACT['line-pin'] = el => { const p = project(); return toggleLinePin(p, lineById(p, el.dataset.line), el); };
function railLineMenuButton(pid, id) {
  return $('#railList .rail-line[data-p="' + CSS.escape(pid) + '"][data-line="' + CSS.escape(id) + '"]')?.nextElementSibling;
}
ACT['rail-line-menu'] = el => {
  const row = el.previousElementSibling, { p:pid, line:id } = row.dataset;
  if (HOSTED?.read || isSaving(id)) return;
  if (currentMenuAnchor() === el && $('#menu')) { closeMenu(); return; }
  const summary = summaryOf(pid);
  if (!summary) return;
  const f = railPick(summary).byId.get(id);
  if (!f) return;
  // Resolve the owning project when an action needs its details. Opening the menu never downloads a project.
  const run = fn => async () => {
    try {
      let p = project(pid), l = p && lineById(p, id);
      if (pid !== S.cur || !l?.topicHash || p.partial === 'rail') {
        await loadState(pid, { force:true, needs:{ lines:[id] } });
        p = project(pid); l = p && lineById(p, id);
      }
      if (p?.readOnly) { toast('This project is read only.'); return; }
      if (!l || railLineHidden(l, shownState(l))) { renderRail(); return; }
      await fn(p, l, railLineMenuButton(pid, id) || el);
    } catch (error) { toast(error.message); }
  };
  const canReviewFamily = (p, l) => {
    if (p.readOnly || !l?.orchestratorRef || allLines(p).some(x => x.id !== l.id && x.orchestratorRef === l.orchestratorRef)) return false;
    const plan = reviewTreePlan(p, l);
    return Boolean(plan.subs.length && plan.canOpen);
  };
  const owner = f.hasSubLines && project(pid);
  const show = (anchor, familyDisabled) => openMenu(anchor, [
    { label:f.pinned ? 'Unpin' : 'Pin', icon:'pin', fn:run((p, l, anchor) => isPinned(p, l) === f.pinned && toggleLinePin(p, l, anchor)) },
    { label:'Archive', icon:'archive', fn:run((p, l, anchor) => archiveLine(l, anchor, false, p)) },
    { label:'Mark reviewed', icon:'check', disabled:f.running || !f.canReviewLine, fn:run((p, l) => markLineReviewed(p, l)) },
    ...(f.hasSubLines ? [{ label:'Mark reviewed…', icon:'check', disabled:familyDisabled, fn:run((p, l, current) => {
      if (canReviewFamily(p, l)) openReviewTreePopover(current, p, l);
      else if (current.isConnected && document.activeElement === current && !$('#menu')) show(current, true);
    }) }] : []),
    { sep:true },
    { label:'Delete', icon:'trash', disabled:f.running, fn:run((p, l, anchor) => l.running ? toast('Wait for work to finish before deleting this Line.') : lineDialog(l, 'delete', anchor, p)) },
  ], { align:'right', resolveAnchor:() => anchor.isConnected ? anchor : railLineMenuButton(pid, id) });
  show(el, Boolean(owner && owner.partial !== 'rail' && !canReviewFamily(owner, lineById(owner, id))));
};
function copyLineReference(p, l) {
  const target = HOSTED && !HOSTED.shared
    ? `${location.origin}/lines/${encodeURIComponent(HOSTED.key)}#line/${encodeURIComponent(l.id)}`
    : l.topicAbsolutePath || l.topicPath;
  return copyText(`PenEcho Line ${l.code || l.id} (${p.name})\n${target}`, 'Line reference copied');
}
ACT['line-menu'] = el => {
  const p = project(), l = lineById(p, el.dataset.line);
  if (!l) return;
  const folder = l.folder || l.workdir;
  const subs = l.orchestratorRef && typeof subLinesOf === 'function' ? subLinesOf(p, l) : [];
  const treePlan = subs.length && typeof reviewTreePlan === 'function' ? reviewTreePlan(p, l) : null;
  openMenu(el, [
    { group:'This Line', items:[
      ...(treePlan?.canOpen ? [{ label:'Mark reviewed…', icon:'check', fn:() => openReviewTreePopover(el, p, l) }] : []),
      { label:'Copy Line reference', note:'Paste into another session to find this Line', icon:'copy', fn:() => copyLineReference(p, l) },
      { label:'Open Line file', note:l.topicPath.split('/').pop(), icon:'doc', fn:() => openDoc(l.topicPath, el) },
      { label:'Copy Line file path', icon:'copy', disabled:!l.topicAbsolutePath, fn:() => copyText(l.topicAbsolutePath, 'Line file path copied') },
      { label:'Rename', icon:'pen', fn:() => lineDialog(l, 'rename', el) },
      { label:'Move to project…', icon:'swap', disabled:Boolean(l.branch) || Boolean(l.running), fn:() => moveLineMenu(l, el) },
      ...(typeof meetcueLineItems === 'function' ? meetcueLineItems(p, l) : []),
    ] },
    { group:'Git branch', items:l.branch ? [
      { label:'Copy branch name', icon:'copy', fn:() => copyText(l.branch, `Copied ${l.branch}`) },
    ] : [] },
    { group:'Working folder', items:folder ? [
      { label:'Copy folder path', icon:'copy', fn:() => copyText(folder, `Copied ${folder}`) },
      ...(S.thisComputer && S.openFolderLabel ? [{ label:S.openFolderLabel, icon:'files', fn:() => api(topicApi(p, l, 'open-folder'), { method:'POST', body:{} }).catch(error => toast(error.message)) }] : []),
    ] : [] },
    { group:'Restore Line items', items:(l.removed || []).slice(0, 6).map(r => ({
      label:`${removedWord(r.kind)}${r.words ? `: ${r.words.length > 34 ? `${r.words.slice(0, 33)}…` : r.words}` : ''}`,
      icon:r.kind === 'canvas' ? 'canvas' : r.kind === 'note' ? 'note' : 'check', fn:() => restoreYours(l.id, r.removed),
    })) },
    { group:'Archive and delete', items:[
      ...(l.archived ? [] : [{ label:'Archive', icon:'archive', fn:() => archiveLine(l, el) }]),
      ...(l.outdated ? [] : [{ label:'Mark outdated', icon:'archive', note:OUTDATED_SAY, fn:() => archiveLine(l, el, true) }]),
      { label:l.running ? 'Delete (wait for work to finish)' : 'Delete', icon:'trash', disabled:l.running, fn:() => lineDialog(l, 'delete', el) },
    ] },
  ], { align:'right' });
};
// Carry on with ▾ (N5): your saved agents, as in Run with, each starting a new conversation from the line's file. A server without them lists the other agents here.
// A limit that says when it resets offers waiting too, which only closes the menu.
ACT['carry-on'] = el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  const saved = runPresets(), all = availableAgents(), others = all.filter(a => a.id !== s.agent);
  const hasPresets = saved.length || S.presets?.presets?.some(x => x.showInPicker === false);
  const items = (hasPresets
    ? saved.map(x => ({ label:x.auto ? runLabel(agentInfo(x.agent), x) : presetTitle(x), av:x.agent, note:!x.auto && presetShouldShowFacts(x) ? presetFacts(x) : '', fn:() => carryOnWith(l, s, x.agent, x.id, x.name) }))
    : (others.length ? others : all).map(a => ({ label:a.name, av:a.id, fn:() => carryOnWith(l, s, a.id, '', a.name) }))
  ).sort(compareRunMenuRow);
  if (stopWhyOf(s) === 'limit' && s.resetsAt && s.agent && s.agent !== 'you') items.push({ sep:true }, { label:`Wait until ${clockOf(s.resetsAt)} and use ${agentInfo(s.agent).name}`, fn:() => {} });
  if (S.thisComputer && hasPresets) items.push({ sep:true }, { label:'Manage agents…', icon:'gear', fn:() => { if (typeof openAgents === 'function') openAgents(); else location.hash = 'agents'; } });
  openMenu(el, [{ head:'Carry on with' }, ...items], { align:'left', className:'run-menu' });
};
async function carryOnWith(l, s, agent, preset, name) {
  try { await actAtOnce(l, 'carry-on', { agent, preset, step:s.id }, lineStarts(agent)); toast(`${name} carries on`); }
  catch (error) { toast(error.message); }
}
ACT['pick-agent'] = el => {
  const l = lineById(project(), el.dataset.line), s = stationById(l, el.dataset.step);
  openMenu(el, availableAgents().map(a => ({ label:a.name, av:a.id, on:s.agent === a.id, fn:() => act(l, 'assign', { agent:a.id, step:s.index }).then(refreshAfterChange).catch(error => toast(error.message)) })));
};
// Merge opens the choices on this page. PenEcho never merges: each choice is an Ask, and the agent merges as a piece of work.
ACT['merge-now'] = el => {
  const p = project(), l = lineById(p, el.dataset.line), s = [...l.stations].reverse().find(x => x.kind === 'merge' && x.state === 'wait');
  if (s) pickStep(l, s, { scroll:false });
};
const mergeAgent = (p, l) => agentInfo(l.agent || defaultPresetAgent() || p.defaultAgent || availableAgents()[0]?.id || 'claude').name;
// Into the parent first for a branch from a branch, then the trunk. Only this Topic is offered when other Topics share the branch.
function mergeChoices(p, l) {
  const trunk = l.base || p.trunk, up = mergeTarget(p, l), others = lineMates(p, l) - 1, d = l.diff || { add:0, del:0, files:0 };
  const what = `<span class="row-diff"><i>+${d.add}</i> <u>−${d.del}</u></span> in ${d.files} ${d.files === 1 ? 'file' : 'files'}`;
  const along = others > 0 ? `${others} other ${others === 1 ? 'Topic goes' : 'Topics go'} with it` : '';
  const rows = [];
  if (up.to) rows.push({ to:up.to, into:up.name, scope:'branch', title:'Into parent', lines:[what, along] });
  rows.push({ to:'', into:trunk, scope:'branch', title:'Whole branch', lines:[what, up.to ? `What ${up.name} has comes too` : along] });
  if (others > 0) rows.push({ to:up.to || '', into:up.name, scope:'topic', title:'Only this Topic', lines:[`${mergeAgent(p, l)} separates it first`] });
  return rows;
}
// Either choice starts a new line whose Ask, Not sent, says how to merge, and opens it. It is run or pasted from there like any other Ask.
ACT['merge-ask'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), { to, scope } = el.dataset, buttons = $$('.merge-choice button');
  buttons.forEach(b => { b.disabled = true; });
  try {
    const { slug, step } = await act(l, 'merge', { to:to || null, scope });
    ACT['panel-close']();
    go({ view:'line', line:slug });
    if (step) setTimeout(() => scrollToItem(step), 400);
  } catch (error) { buttons.forEach(b => { b.disabled = false; }); toast(error.message); }
};
function mergePanel(p, l, s) {
  const ready = s.state === 'wait', done = s.state === 'done';
  const choice = (c, i) => `<div class="merge-choice${i === 0 ? ' first' : ''}"><div class="mc-text"><strong>${esc(c.title)} ${ic('right', 13)} <code>${esc(c.into)}</code></strong>${c.lines.filter(Boolean).map(x => `<span>${x}</span>`).join('')}</div>
    <button type="button" class="btn sm${i === 0 ? ' primary' : ''}" data-act="merge-ask" data-line="${esc(l.id)}" data-to="${esc(c.to)}" data-into="${esc(c.into)}" data-scope="${c.scope}">${c.scope === 'topic' ? `Ask ${esc(mergeAgent(p, l))}` : `${ic('merge', 14)}Merge`}</button></div>`;
  return `<div class="sc sc-merge">
    ${ready ? `<div class="merge-choices">${mergeChoices(p, l).map(choice).join('')}</div>${mergeOutcomeHTML(p, l)}` : ''}
    ${done ? `<p class="merge-done">${ic('check', 16)}${esc(plainOut(s.out) || (l.commit ? `Merged as ${l.commit}` : 'Merged'))}</p>` : ''}
    ${l.branch ? '<h3 class="sc-h">Changes</h3><div id="stepDiff"><p class="muted">Opening…</p></div>' : ''}
  </div>`;
}
// One click, without opening the Work. The box, the panel, the count and the line follow at once, and go back if it could not be saved.
function showReviewed(p, l, s) {
  settleEnd(l);
  const box = document.getElementById(`item-${s.id}`), head = $('#lppHead');
  box?.classList.toggle('is-reviewed', s.reviewed);
  $$('.lp-mark').filter(m => m.dataset.step === s.id).forEach(m => { m.setAttribute('aria-checked', s.reviewed); m.setAttribute('aria-label', reviewSay(s)); m.title = reviewSay(s); });
  // The same elements stay, so the tick moves and the keyboard stays on it.
  if (box) box.dataset.h = itemHTML(p, l, s);
  if (head && S.lineSel?.id === s.id) head.dataset.h = panelHead(l, s);
  refreshLine();
  if (typeof renderRail === 'function') renderRail();
}
ACT['work-reviewed'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step); if (!s) return;
  const on = !s.reviewed, step = s.id;
  s.reviewed = on;
  showReviewed(p, l, s);
  try { await act(l, 'review', { step, reviewed:on }); refreshLine(); if (typeof renderRail === 'function') renderRail(); }
  catch (error) {
    const line = lineById(project(), l.id), back = line && stationById(line, step);
    if (back) { back.reviewed = !on; showReviewed(project(), line, back); }
    toast(error.message);
  }
};
async function saveWorkRating(lineId, stepId, rating, note) {
  const p = project(), l = lineById(p, lineId), s = l && stationById(l, stepId);
  if (!s) return;
  const prev = { rating:s.rating || '', ratingNote:s.ratingNote || '' };
  const nextRating = rating || '';
  const nextNote = nextRating ? (note !== undefined ? String(note).replace(/\s+/g, ' ').trim().slice(0, 280) : (s.ratingNote || '')) : '';
  if (nextRating) s.rating = nextRating; else delete s.rating;
  if (nextNote) s.ratingNote = nextNote; else delete s.ratingNote;
  if (S.route.view === 'line') refreshLine();
  else if (S.route.view === 'stats' && typeof refreshStats === 'function') refreshStats(true);
  try {
    await act(l, 'rate', { step:stepId, rating:nextRating || null, ...(note !== undefined ? { note:nextNote } : {}) });
    if (S.route.view === 'line') refreshLine();
    else if (S.route.view === 'stats' && typeof refreshStats === 'function') {
      refreshStats(true);
      if (typeof loadOrchestrator === 'function') loadOrchestrator(project(), true);
    }
    toast(nextRating ? (note !== undefined ? 'Rating note saved.' : `Rated ${nextRating === 'good' ? 'good' : 'not good'}.`) : 'Rating cleared.');
  } catch (error) {
    const line = lineById(project(), l.id), back = line && stationById(line, stepId);
    if (back) {
      if (prev.rating) back.rating = prev.rating; else delete back.rating;
      if (prev.ratingNote) back.ratingNote = prev.ratingNote; else delete back.ratingNote;
    }
    if (S.route.view === 'line') refreshLine();
    else if (S.route.view === 'stats' && typeof refreshStats === 'function') {
      refreshStats(true);
      if (typeof loadOrchestrator === 'function') loadOrchestrator(project(), true);
    }
    toast(error.message);
  }
}
ACT['work-rate'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step);
  if (!s) return;
  const picked = el.dataset.rating;
  const next = s.rating === picked ? '' : picked;
  await saveWorkRating(l.id, s.id, next);
};
ACT['work-rate-note'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step);
  if (!s || !s.rating) return;
  const box = el.closest('[data-rate-box]') || document;
  const input = box.querySelector(`.rate-note-input[data-step="${CSS.escape(s.id)}"]`) || box.querySelector('.rate-note-input');
  await saveWorkRating(l.id, s.id, s.rating, input ? input.value : '');
};
async function saveWorkScope(lineId, stepId, scope) {
  const p = project(), l = lineById(p, lineId), s = l && stationById(l, stepId);
  if (!s) return;
  const prev = s.scope || '';
  const next = scope || '';
  if (next) s.scope = next; else delete s.scope;
  if (S.route.view === 'line') refreshLine();
  else if (S.route.view === 'stats' && typeof refreshStats === 'function') refreshStats(true);
  try {
    await act(l, 'scope', { step:stepId, scope:next || null });
    if (S.route.view === 'line') refreshLine();
    else if (S.route.view === 'stats' && typeof refreshStats === 'function') {
      refreshStats(true);
      if (typeof loadOrchestrator === 'function') loadOrchestrator(project(), true);
    }
    toast(next ? `Difficulty set to ${next[0].toUpperCase() + next.slice(1)}.` : 'Difficulty reset to automatic.');
  } catch (error) {
    const line = lineById(project(), l.id), back = line && stationById(line, stepId);
    if (back) { if (prev) back.scope = prev; else delete back.scope; }
    if (S.route.view === 'line') refreshLine();
    toast(error.message);
  }
}
ACT['work-scope'] = async el => {
  const p = project(), l = lineById(p, el.dataset.line), s = l && stationById(l, el.dataset.step);
  if (!s) return;
  const picked = el.dataset.scope || '';
  const next = s.scope === picked ? '' : picked;
  await saveWorkScope(l.id, s.id, next);
};
function todoMark(l, p = project()) {
  const canMark = typeof canMarkTodo === 'function' ? canMarkTodo : (LINE_STATUS.canMarkTodo || canTodo);
  if ((typeof HOSTED !== 'undefined' && HOSTED?.read) || typeof l.todo !== 'boolean' || !canMark(l)) return '';
  const on = isTodo(l);
  return `<button type="button" class="btn sm ghost-b lp-todo" data-act="line-todo" data-line="${esc(l.id)}" aria-pressed="${on}" title="${on ? 'Restore the usual review or finished status' : 'Keep this line pending without marking any Work reviewed'}"${S.lineTodoSaving?.has(`${p.id}:${l.id}`) ? ' disabled aria-busy="true"' : ''}>${ic('box', 14)}${on ? 'Clear todo' : 'Mark todo'}</button>`;
}
// Review and Todo are separate choices. Accept Todo immediately after Review,
// but write it second because review-all clears Todo on the server.
const lineMarks = new Map();
const lineMarkSnapshot = l => ({
  todo:l.todo, status:l.status, landed:l.landed, asking:l.asking,
  questions:Array.isArray(l.questions) ? l.questions.slice() : l.questions,
  stations:new Map(l.stations.map(s => [s.id, { state:s.state, off:s.off, reviewed:s.reviewed }])),
});
function applyLineMark(l, op) {
  if (typeof l.todo === 'boolean') l.todo = op.todo;
  for (const s of l.stations) if (op.reviewed?.includes(s.id) && canReview(s)) s.reviewed = true;
  if (op.endLine) {
    if (!['ready', 'landed'].includes(lineState(l))) { l.status = 'done'; l.landed = true; }
    l.asking = null;
    if (Array.isArray(l.questions)) l.questions = [];
    for (const s of l.stations) {
      if (isWork(s) && (s.state === 'error' || s.state === 'wait' || (op.endOpen && s.state === 'todo'))) { s.state = 'off'; s.off = 'stopped'; if (op.reviewEnded !== false) s.reviewed = true; }
      else if (isEnd(s) && s.state === 'todo') s.state = 'done';
    }
  }
}
function replayLineMarks(l, entry) {
  l.todo = entry.base.todo;
  if (entry.endTouched) {
    l.status = entry.base.status; l.landed = entry.base.landed;
    l.asking = entry.base.asking;
    if (Array.isArray(entry.base.questions)) l.questions = entry.base.questions.slice();
  }
  for (const s of l.stations) {
    const had = entry.base.stations.get(s.id);
    if (!had) continue;
    if (entry.endTouched) { s.state = had.state; s.off = had.off; }
    if ((entry.touched.has(s.id) || entry.endTouched) && typeof had.reviewed === 'boolean') s.reviewed = had.reviewed;
  }
  for (const op of entry.pending) applyLineMark(l, op);
  settleEnd(l);
}
// State responses may arrive between the two clicks or their acknowledgments.
// Retain the raw values for rollback, then replay only these pending choices.
const treeMarks = new Map();
function keepLineMarks(p) {
  for (const [key, entry] of lineMarks) {
    if (entry.project !== p.id) continue;
    const l = lineById(p, entry.line); if (!l) continue;
    entry.base = lineMarkSnapshot(l);
    entry.awaitingRead = false;
    replayLineMarks(l, entry);
    if (!entry.pending.length) lineMarks.delete(key);
  }
  for (const [, batch] of treeMarks) {
    if (batch.project !== p.id) continue;
    for (const [id, op] of batch.ops) {
      const l = lineById(p, id); if (!l) continue;
      applyLineMark(l, op);
      settleEnd(l);
    }
  }
}
function refreshLineMarks(p) {
  if (S.cur !== p.id) { renderRail(); return; }
  const focused = document.activeElement, act = focused?.dataset?.act, line = focused?.dataset?.line;
  refreshAfterChange();
  if (act === 'line-todo' && !focused.isConnected) $$('.lp-todo').find(b => b.dataset.line === line)?.focus({ preventScroll:true });
}
function saveLineMark(p, l, op) {
  const key = `${p.id}:${l.id}`, saving = S.lineMarkSaving ||= new Set(), todos = S.lineTodoSaving ||= new Set();
  let entry = lineMarks.get(key);
  if (!entry) {
    entry = { project:p.id, line:l.id, slug:l.slug, base:lineMarkSnapshot(l), touched:new Set(), endTouched:false, pending:[], tail:Promise.resolve() };
    lineMarks.set(key, entry);
  }
  for (const id of op.reviewed || []) entry.touched.add(id);
  if (op.endLine) entry.endTouched = true;
  entry.pending.push(op); saving.add(key);
  if (op.verb === 'todo') todos.add(key);
  replayLineMarks(l, entry); refreshLineMarks(p);
  entry.tail = entry.tail.then(async () => {
    try {
      // Bind the request to its original project even if the person navigates.
      await api(`${pathFor(entry.project)}/topics/${encodeURIComponent(entry.slug)}/${op.verb}`, { method:'POST', body:op.verb === 'todo' ? { todo:op.todo } : {} });
      entry.base.todo = op.todo;
      for (const id of op.reviewed || []) { const had = entry.base.stations.get(id); if (had) had.reviewed = true; }
      if (op.endLine) {
        if (!['ready', 'landed'].includes(lineState(entry.base))) { entry.base.status = 'done'; entry.base.landed = true; }
        entry.base.asking = null;
        if (Array.isArray(entry.base.questions)) entry.base.questions = [];
        for (const s of l.stations) {
          const had = entry.base.stations.get(s.id);
          if (!had) continue;
          if (isWork(s) && (had.state === 'error' || had.state === 'wait' || (op.endOpen && had.state === 'todo'))) { had.state = 'off'; had.off = 'stopped'; if (op.reviewEnded !== false) had.reviewed = true; }
          else if (isEnd(s) && had.state === 'todo') had.state = 'done';
        }
      }
      entry.awaitingRead = true;
      invalidateStateReads(p.id);
      // Todo can be changed again once it is saved, without waiting for the read below (PE-595).
      if (op.verb === 'todo') { todos.delete(key); refreshLineMarks(p); }
      // A failed refresh is not a failed write. Keep the acknowledged marks;
      // the next successful poll will reconcile them with the folder.
      try { await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined }); }
      catch (error) { toast(error.message); }
    } catch (error) { toast(error.message); }
    finally {
      entry.pending.shift();
      if (op.verb === 'todo') todos.delete(key);
      const back = project(p.id) && lineById(project(p.id), entry.line);
      if (back) replayLineMarks(back, entry);
      invalidateStateReads(p.id);
      if (!entry.pending.length) { if (!entry.awaitingRead) lineMarks.delete(key); saving.delete(key); }
      refreshLineMarks(p);
    }
  });
  return entry.tail;
}
ACT['line-todo'] = async el => {
  const canMark = typeof canMarkTodo === 'function' ? canMarkTodo : (LINE_STATUS.canMarkTodo || canTodo);
  const p = project(), l = lineById(p, el.dataset.line); if (!l || !canMark(l)) return;
  if (S.lineTodoSaving?.has(`${p.id}:${l.id}`)) return;
  const focused = document.activeElement === el, route = S.route;
  const nextTodo = !isTodo(l);
  const nonFinished = nextTodo && !['ready', 'landed'].includes(lineState(l)) && lineState(l) !== 'notes';
  const hasQuestions = nextTodo && Boolean(l.asking || (l.questions || []).length);
  const endLine = nonFinished || hasQuestions;
  await saveLineMark(p, l, { verb:'todo', todo:nextTodo, endLine, endOpen:nonFinished, reviewEnded:false });
  // Native disabled buttons cannot retain keyboard focus. Restore it after
  // saving only if the person has stayed here and not focused another control.
  if (focused && S.cur === p.id && S.route === route && document.activeElement === document.body) $$('.lp-todo').find(b => b.dataset.line === l.id)?.focus({ preventScroll:true });
};
// Mark reviewed is offered whenever no job is working in the Line (PE-527, PE-773): it marks finished and stopped Works reviewed and ends stopped/waiting Lines.
const endStoppedButton = (p, l, cls = 'btn sm') => HOSTED?.read || !canMarkReviewed(l) ? '' : `<button type="button" class="${cls}" data-act="all-reviewed" data-line="${esc(l.id)}" title="Mark this line reviewed"${S.lineMarkSaving?.has(`${p.id}:${l.id}`) ? ' disabled aria-busy="true"' : ''}>${ic('check', 14)}Mark reviewed</button>`;
// The To review card ticks every finished or stopped Work at once, clears Todo, ends non-working stopped/waiting Lines, and puts everything back if saving fails.
async function markLineReviewed(p, l) {
  if (!l || lineWorking(l)) return;
  const saving = S.lineMarkSaving ||= new Set(), key = `${p.id}:${l.id}`; if (saving.has(key)) return;
  const marked = l.stations.filter(s => canReview(s) && !s.reviewed);
  const nonFinished = !['ready', 'landed'].includes(lineState(l)) && lineState(l) !== 'notes';
  const hasQuestions = Boolean(l.asking || (l.questions || []).length);
  const endLine = nonFinished || hasQuestions;
  if (!marked.length && !l.todo && !endLine && !canMarkReviewed(l)) return;
  await saveLineMark(p, l, { verb:'review-all', todo:false, reviewed:marked.map(s => s.id), endLine, endOpen:nonFinished });
  if (typeof markLinesRead === 'function') markLinesRead(project(p.id) || p, [l.id]);
}
ACT['all-reviewed'] = el => { const p = project(); return markLineReviewed(p, lineById(p, el.dataset.line)); };

// ---------- Orchestrator sub-Lines, duplicate parent picker & bulk review (PE-764/PE-765) ----------
const fmtParentDate = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return +d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
};
ACT['parent-pick'] = el => {
  const p = project(), l = p && lineById(p, el.dataset.line); if (!l) return;
  const parents = parentLinesOf(p, l);
  if (!parents.length) return;
  if (parents.length === 1) { go({ view:'line', line:parents[0].id }, { from:el }); return; }
  openMenu(el, [
    { head:`${parents.length} Lines share ${l.orchestratedBy}` },
    ...parents.map(parent => {
      const date = fmtParentDate(parent.createdAt) || String(parent.started || '').slice(0, 10);
      const details = [parent.archived ? 'Archived' : 'Active', parent.topicPath || parent.slug, date].filter(Boolean).join(' · ');
      return { label:parent.title || parent.slug, note:details, icon:parent.archived ? 'archive' : 'orchestrate', fn:() => go({ view:'line', line:parent.id }) };
    }),
  ], { align:'left', className:'run-menu' });
};
ACT['sublines-fold'] = el => {
  const id = el.dataset.line; if (!id) return;
  const set = S.subLinesFolded ||= new Set();
  if (set.has(id)) set.delete(id); else set.add(id);
  refreshLine();
};
ACT['sublines-more'] = el => {
  const id = el.dataset.line; if (!id) return;
  const set = S.subLinesExpanded ||= new Set();
  if (set.has(id)) set.delete(id); else set.add(id);
  refreshLine();
};
ACT['sublines-archived'] = el => {
  const id = el.dataset.line; if (!id) return;
  const set = S.subLinesArchivedOpen ||= new Set();
  if (set.has(id)) set.delete(id); else set.add(id);
  refreshLine();
};
ACT['route-parts-toggle'] = el => {
  const id = el.dataset.line; if (!id) return;
  const set = S.routePartsOpen ||= new Set();
  if (set.has(id)) set.delete(id); else set.add(id);
  refreshLine();
};
ACT['focus-sublines'] = () => {
  const l = lineById(project(), S.route.line);
  if (l && S.subLinesFolded?.has(l.id)) { S.subLinesFolded.delete(l.id); refreshLine(); }
  const host = $('#lpSubLines'), box = $('#lpScroll');
  if (!host || host.hidden || !box) return;
  const rectOf = node => typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect();
  const top = rectOf(host).top - rectOf(box).top + box.scrollTop - 10 - filterBarHeight();
  box.scrollTo({ top:Math.max(0, top), behavior:reducedMotion() ? 'auto' : 'smooth' });
};

function classifyLineForTreeReview(x) {
  if (!x || x.archived) return { kind:'archived', works:0, hasTodo:false };
  if (lineWorking(x)) return { kind:'running', works:0, hasTodo:false };
  // A Line that needs you can be ended too when the person ticks it in (PE-922), as long as an agent's Work or question is there to end.
  if (lineNeedsYou(x)) return { kind:'waiting', works:(x.stations || []).filter(s => canReview(s) && !s.reviewed).length, hasTodo:Boolean(x.todo), endable:canMarkReviewed(x) };
  const st = lineState(x);
  if (x.queued || st === 'backlog') return { kind:'queued', works:0, hasTodo:false };
  const unreviewed = (x.stations || []).filter(s => canReview(s) && !s.reviewed).length;
  const nonFinished = !['ready', 'landed', 'notes'].includes(st);
  if (nonFinished) {
    const openWorks = (x.stations || []).filter(s => isWork(s) && (s.state === 'error' || s.state === 'wait' || s.state === 'todo')).length;
    return { kind:'stopped', works:unreviewed + openWorks, hasTodo:Boolean(x.todo) };
  }
  if (unreviewed > 0 || Boolean(x.todo)) return { kind:'mark', works:unreviewed, hasTodo:Boolean(x.todo) };
  return { kind:'already-reviewed', works:0, hasTodo:false };
}
function reviewTreePlan(p, l, { includeStopped = false, includeWaiting = false } = {}) {
  const hosted = typeof HOSTED !== 'undefined' && Boolean(HOSTED);
  const readOnly = typeof HOSTED !== 'undefined' && Boolean(HOSTED?.read);
  const allowStopped = Boolean(includeStopped && !hosted), allowWaiting = Boolean(includeWaiting && !hosted);
  const subs = typeof subLinesOf === 'function' ? subLinesOf(p, l) : [];
  const parentClass = classifyLineForTreeReview(l);
  const parentSingleAvailable = !readOnly && !lineWorking(l) && canMarkReviewed(l);
  const entries = [{ line:l, role:'parent', ...parentClass }, ...subs.map(x => ({ line:x, role:'child', ...classifyLineForTreeReview(x) }))];
  const toMark = entries.filter(e => e.kind === 'mark' || (allowStopped && e.kind === 'stopped') || (allowWaiting && e.kind === 'waiting' && e.endable));
  const running = entries.filter(e => e.kind === 'running');
  const waiting = entries.filter(e => e.kind === 'waiting');
  const endableWaiting = waiting.filter(e => e.endable);
  const stopped = entries.filter(e => e.kind === 'stopped');
  const queued = entries.filter(e => e.kind === 'queued');
  const archived = entries.filter(e => e.kind === 'archived');
  const alreadyReviewed = entries.filter(e => e.kind === 'already-reviewed');
  const subMarkableCount = entries.filter(e => e.role === 'child' && e.kind === 'mark').length;
  const subStoppedCount = entries.filter(e => e.role === 'child' && e.kind === 'stopped').length;
  const subWaitingCount = endableWaiting.filter(e => e.role === 'child').length;
  const anyTreeMarkable = entries.some(e => e.kind === 'mark' || (!hosted && (e.kind === 'stopped' || (e.kind === 'waiting' && e.endable))));
  const canOpen = !readOnly && Boolean(parentSingleAvailable || anyTreeMarkable);
  return { parentClass, parentSingleAvailable, subs, entries, toMark, running, waiting, endableWaiting, stopped, queued, archived, alreadyReviewed, subMarkableCount, subStoppedCount, subWaitingCount, anyTreeMarkable, canOpen };
}

let reviewPopState = null;
function closeReviewTreePopover() {
  if (!reviewPopState) return;
  const { el, anchor, onDown, onKey, onResize } = reviewPopState;
  reviewPopState = null;
  document.removeEventListener('pointerdown', onDown);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('penecho:page-scale-change', onResize);
  el?.remove();
  if (anchor?.isConnected) anchor.setAttribute('aria-expanded', 'false');
}
function placeReviewTreePopover(pop, anchor) {
  if (!pop || !anchor?.isConnected) return;
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const r = rectOf(anchor);
  if (!r || (!r.width && !r.height)) { pop.style.left = '16px'; pop.style.top = '64px'; return; }
  pop.style.left = '8px';
  const mr = rectOf(pop);
  const below = Math.max(0, vp.height - r.bottom - 14), above = Math.max(0, r.top - 14);
  const down = mr.height <= below || below >= above;
  pop.style.left = `${clamp(r.right - mr.width, 8, Math.max(8, vp.width - mr.width - 8))}px`;
  pop.style.top = `${clamp(down ? r.bottom + 6 : r.top - mr.height - 6, 8, Math.max(8, vp.height - mr.height - 8))}px`;
}
function reviewTreePopoverHTML(p, l, { scope, includeStopped, includeWaiting }) {
  const hosted = typeof HOSTED !== 'undefined' && Boolean(HOSTED);
  const plan = reviewTreePlan(p, l, { includeStopped, includeWaiting });
  const parentCode = l.code || l.id;
  const parentUnrev = (l.stations || []).filter(s => canReview(s) && !s.reviewed).length;
  const parentDesc = lineWorking(l) ? 'Still working'
    : !plan.parentSingleAvailable ? 'Already reviewed'
    : parentUnrev > 0 ? `${parentCode} · ${parentUnrev} ${parentUnrev === 1 ? 'Work' : 'Works'}`
    : `${parentCode} · ${subLineStatusInfo(l).label}`;
  const codesOf = list => list.map(e => e.line.code || e.line.id).join(', ');
  const markNames = plan.toMark.map(e => `${e.line.code || e.line.id}${e.kind === 'stopped' ? ' (settle)' : e.kind === 'waiting' ? ' (end)' : e.works > 0 ? ` (${e.works} ${e.works === 1 ? 'Work' : 'Works'})` : ''}`).join(', ');
  const totalWorks = plan.toMark.reduce((n, e) => n + e.works, 0);
  const treeSummary = plan.toMark.length
    ? `${plan.toMark.length} ${plan.toMark.length === 1 ? 'Line' : 'Lines'}${totalWorks ? ` · ${totalWorks} ${totalWorks === 1 ? 'Work' : 'Works'}` : ''}`
    : (plan.stopped.length || plan.endableWaiting.length) && !hosted ? `Check ${plan.stopped.length ? 'stopped' : 'needs you'} below to include` : 'Nothing ready to mark';
  const applyCount = scope === 'parent' ? (plan.parentSingleAvailable ? 1 : 0) : plan.toMark.length;
  const applyLabel = scope === 'parent' ? 'Mark this Line reviewed' : `Mark ${applyCount} ${applyCount === 1 ? 'Line' : 'Lines'} reviewed`;
  const saving = Boolean(S.treeReviewSaving?.has(`${p.id}:${l.id}`));
  return `<div class="lp-rp-head"><strong>Mark reviewed</strong><button type="button" class="icon-btn tiny" data-rp-close aria-label="Close">${ic('x', 15)}</button></div>
    <div class="lp-rp-options" role="radiogroup" aria-label="Scope">
      <label class="lp-rp-opt${scope === 'parent' ? ' is-on' : ''}${plan.parentSingleAvailable ? '' : ' is-disabled'}">
        <input type="radio" name="lpReviewScope" value="parent"${scope === 'parent' ? ' checked' : ''}${plan.parentSingleAvailable ? '' : ' disabled'}>
        <span class="lp-rp-opt-body"><strong>This Line only</strong><small>${esc(parentDesc)}</small></span>
      </label>
      <label class="lp-rp-opt${scope === 'tree' ? ' is-on' : ''}">
        <input type="radio" name="lpReviewScope" value="tree"${scope === 'tree' ? ' checked' : ''}>
        <span class="lp-rp-opt-body"><strong>This Line + sub-Lines</strong><small>${esc(treeSummary)}</small></span>
      </label>
    </div>
    ${scope === 'tree' ? `<div class="lp-rp-preview">
      ${plan.toMark.length ? `<div class="lp-rp-row is-mark">${ic('check', 13)}<span><b>Will mark reviewed:</b> ${esc(markNames)}</span></div>` : '<div class="lp-rp-row is-muted"><span>No finished unreviewed Lines right now.</span></div>'}
      ${plan.running.length ? `<div class="lp-rp-row is-run"><i class="spin" aria-hidden="true"></i><span><b>Will skip (working):</b> ${esc(codesOf(plan.running))}</span></div>` : ''}
      ${!hosted && plan.endableWaiting.length ? `<label class="lp-rp-optin"><input type="checkbox" data-rp-waiting${includeWaiting ? ' checked' : ''}><span>Also end &amp; mark ${plan.endableWaiting.length} ${plan.endableWaiting.length === 1 ? 'Line that needs' : 'Lines that need'} you, clearing ${plan.endableWaiting.length === 1 ? 'its' : 'their'} questions (${esc(codesOf(plan.endableWaiting))})</span></label>` : ''}
      ${plan.waiting.length > (hosted ? 0 : plan.endableWaiting.length) ? `<div class="lp-rp-row is-wait"><b class="dot-b" aria-hidden="true">!</b><span><b>Will skip (needs you):</b> ${esc(codesOf(hosted ? plan.waiting : plan.waiting.filter(e => !e.endable)))}</span></div>` : ''}
      ${!hosted && plan.stopped.length ? `<label class="lp-rp-optin"><input type="checkbox" data-rp-stopped${includeStopped ? ' checked' : ''}><span>Also settle &amp; mark ${plan.stopped.length} stopped ${plan.stopped.length === 1 ? 'Line' : 'Lines'} (${esc(codesOf(plan.stopped))})</span></label>` : ''}
      ${hosted && plan.stopped.length ? `<div class="lp-rp-row is-muted"><span><b>Will skip (stopped):</b> ${esc(codesOf(plan.stopped))}</span></div>` : ''}
      ${plan.archived.length ? `<div class="lp-rp-row is-muted">${ic('archive', 13)}<span><b>Archived (skipped):</b> ${esc(codesOf(plan.archived))}</span></div>` : ''}
    </div>` : ''}
    <footer class="lp-rp-foot">
      <button type="button" class="btn sm" data-rp-close>Cancel</button>
      <button type="button" class="btn sm primary" data-act="review-tree-apply" data-line="${esc(l.id)}"${!applyCount || saving ? ' disabled' : ''}>${esc(applyLabel)}</button>
    </footer>`;
}
function openReviewTreePopover(anchor, p, l) {
  if (!p || !l || HOSTED?.read) return;
  if (reviewPopState?.anchor === anchor && $('#lpReviewPop')) { closeReviewTreePopover(); return; }
  closeMenu();
  closeReviewTreePopover();
  const plan = reviewTreePlan(p, l);
  if (!plan.canOpen) return;
  const preferTree = !plan.parentSingleAvailable || plan.subMarkableCount > 0 || (!HOSTED && plan.subStoppedCount + plan.subWaitingCount > 0);
  const state = { project:p.id, line:l.id, scope:preferTree ? 'tree' : 'parent', includeStopped:false, includeWaiting:false, anchor };
  const pop = document.createElement('div');
  pop.id = 'lpReviewPop';
  pop.className = 'lp-review-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Mark reviewed scope');
  const paint = () => {
    const curP = project(state.project) || p, curL = lineById(curP, state.line) || l;
    pop.innerHTML = reviewTreePopoverHTML(curP, curL, state);
    placeReviewTreePopover(pop, anchor);
  };
  pop.addEventListener('change', e => {
    if (e.target.name === 'lpReviewScope') {
      state.scope = e.target.value; paint();
      pop.querySelector(`input[name="lpReviewScope"][value="${CSS.escape(state.scope)}"]`)?.focus?.({ preventScroll:true });
    } else if (e.target.matches?.('[data-rp-stopped]')) {
      state.includeStopped = e.target.checked; paint();
      pop.querySelector('[data-rp-stopped]')?.focus?.({ preventScroll:true });
    } else if (e.target.matches?.('[data-rp-waiting]')) {
      state.includeWaiting = e.target.checked; paint();
      pop.querySelector('[data-rp-waiting]')?.focus?.({ preventScroll:true });
    }
  });
  pop.addEventListener('click', e => {
    if (e.target.closest?.('[data-rp-close]')) { closeReviewTreePopover(); anchor?.focus?.({ preventScroll:true }); }
  });
  const onDown = e => { if (!e.target.closest?.('#lpReviewPop') && !anchor?.contains?.(e.target)) closeReviewTreePopover(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeReviewTreePopover(); anchor?.focus?.({ preventScroll:true }); } };
  const onResize = () => closeReviewTreePopover();
  document.body.append(pop);
  if (anchor?.setAttribute) anchor.setAttribute('aria-expanded', 'true');
  reviewPopState = { ...state, el:pop, onDown, onKey, onResize, getState:() => state };
  paint();
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('penecho:page-scale-change', onResize);
  pop.querySelector('[data-act="review-tree-apply"]:not([disabled]), input:not([disabled])')?.focus?.({ preventScroll:true });
}
ACT['review-tree-menu'] = el => {
  const p = project(), l = p && lineById(p, el.dataset.line);
  if (p && l) openReviewTreePopover(el, p, l);
};
ACT['review-tree-apply'] = async el => {
  const state = reviewPopState?.getState?.();
  const p = project(state?.project) || project(), l = p && lineById(p, state?.line || el.dataset.line);
  const scope = state?.scope || 'tree', includeStopped = Boolean(state?.includeStopped && !HOSTED), includeWaiting = Boolean(state?.includeWaiting && !HOSTED);
  closeReviewTreePopover();
  if (!p || !l) return;
  if (scope === 'parent') { await markLineReviewed(p, l); return; }
  await markTreeReviewed(p, l, { includeParent:true, includeSubLines:true, includeStopped, includeWaiting });
};
function formatReviewTreeToast(res) {
  const marked = res?.marked || [], skipped = res?.skipped || [], errors = res?.errors || [];
  const works = marked.reduce((n, m) => n + (Number(m.worksMarked) || 0), 0);
  const settled = marked.filter(m => m.settled).length;
  const head = marked.length
    ? `Marked ${marked.length} ${marked.length === 1 ? 'Line' : 'Lines'} reviewed${works ? ` (${works} ${works === 1 ? 'Work' : 'Works'})` : settled ? ` (${settled} settled)` : ''}`
    : 'Nothing new to mark reviewed';
  const group = (reason, label) => {
    const list = skipped.filter(s => s.reason === reason);
    if (!list.length) return '';
    const codes = list.slice(0, 3).map(s => s.code || s.slug).join(', ') + (list.length > 3 ? `, +${list.length - 3}` : '');
    return `${list.length} ${label} (${codes})`;
  };
  const parts = [group('running', 'working'), group('waiting', 'waiting'), group('stopped', 'stopped')].filter(Boolean);
  const tail = parts.length ? `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`} skipped` : '';
  const err = errors.length ? `${errors.length} failed` : '';
  return `${[head, tail, err].filter(Boolean).join(' · ')}.`;
}
function restoreLineSnapshot(x, snap) {
  if (!x || !snap) return;
  x.todo = snap.todo; x.status = snap.status; x.landed = snap.landed; x.asking = snap.asking;
  if (Array.isArray(snap.questions)) x.questions = snap.questions.slice();
  for (const s of x.stations || []) {
    const had = snap.stations.get(s.id);
    if (!had) continue;
    s.state = had.state; s.off = had.off;
    if (typeof had.reviewed === 'boolean') s.reviewed = had.reviewed;
  }
  settleEnd(x);
}
async function markTreeReviewed(p, l, { includeParent = true, includeSubLines = true, includeStopped = false, includeWaiting = false } = {}) {
  if (!p || !l || HOSTED?.read) return null;
  const saving = S.treeReviewSaving ||= new Set(), key = `${p.id}:${l.id}`;
  if (saving.has(key)) return null;
  const allowStopped = Boolean(includeStopped && !HOSTED), allowWaiting = Boolean(includeWaiting && !HOSTED);
  const plan = reviewTreePlan(p, l, { includeStopped:allowStopped, includeWaiting:allowWaiting });
  const predicted = plan.toMark.filter(e => (e.role === 'parent' ? includeParent : includeSubLines));
  const snapshots = new Map(), ops = new Map();
  saving.add(key);
  for (const e of predicted) {
    const x = e.line;
    snapshots.set(x.id, lineMarkSnapshot(x));
    const revIds = (x.stations || []).filter(s => canReview(s) && !s.reviewed).map(s => s.id);
    const settling = (e.kind === 'stopped' && allowStopped) || (e.kind === 'waiting' && allowWaiting);
    const op = { todo:false, reviewed:revIds, endLine:settling, endOpen:settling && !['ready', 'landed', 'notes'].includes(lineState(x)) };
    ops.set(x.id, op);
    applyLineMark(x, op);
    settleEnd(x);
  }
  treeMarks.set(key, { project:p.id, ops });
  refreshLineMarks(p);
  try {
    const res = await api(`${pathFor(p.id)}/topics/${encodeURIComponent(l.slug)}/review-tree`, {
      method:'POST',
      body:{ includeParent, includeSubLines, includeStopped:allowStopped, includeWaiting:allowWaiting },
    });
    treeMarks.delete(key);
    const markedSet = new Set((res?.marked || []).map(m => m.slug));
    const curP = project(p.id) || p;
    for (const [id, snap] of snapshots) {
      if (!markedSet.has(id)) restoreLineSnapshot(lineById(curP, id), snap);
    }
    const readSlugs = [
      ...(res?.marked || []).map(m => m.slug),
      ...(res?.skipped || []).filter(s => s.reason === 'already-reviewed').map(s => s.slug),
    ];
    if (typeof markLinesRead === 'function') markLinesRead(curP, readSlugs);
    invalidateStateReads(p.id);
    try { await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined }); }
    catch (error) { toast(error.message); }
    const freshP = project(p.id) || curP;
    if (typeof markLinesRead === 'function') markLinesRead(freshP, readSlugs);
    toast(formatReviewTreeToast(res));
    return res;
  } catch (error) {
    treeMarks.delete(key);
    const curP = project(p.id) || p;
    for (const [id, snap] of snapshots) restoreLineSnapshot(lineById(curP, id), snap);
    toast(error.message);
    return null;
  } finally {
    treeMarks.delete(key);
    saving.delete(key);
    refreshLineMarks(project(p.id) || p);
  }
}
ACT['review-tree'] = el => {
  const p = project(), l = p && lineById(p, el.dataset.line);
  return p && l ? markTreeReviewed(p, l, {
    includeParent:el.dataset.includeParent !== 'false',
    includeSubLines:el.dataset.includeSubLines !== 'false',
    includeStopped:el.dataset.includeStopped === 'true',
    includeWaiting:el.dataset.includeWaiting === 'true',
  }) : null;
};
ACT['approve-step'] = async el => {
  const l = lineById(project(), el.dataset.line);
  el.disabled = true;
  try { await actAtOnce(l, 'approve', {}, lineStarts('')); toast('The agent is carrying on.'); }
  catch (error) { el.disabled = false; toast(error.message); }
};

// ---------- The line moves between the home and this page ----------
const centerOf = el => { const b = flightRect(el); return { x:b.left + b.width / 2, y:b.top + b.height / 2 }; };
const flightRect = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
const flightTitle = el => {
  if (!el) return null;
  const style = getComputedStyle(el), matrix = style.transform && style.transform !== 'none' ? new DOMMatrixReadOnly(style.transform) : null;
  const raw = el.getBoundingClientRect(), box = typeof raw.toJSON === 'function' ? raw.toJSON() : raw, z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1;
  const rect = z === 1 ? box : { ...box, left:box.left / z, top:box.top / z, right:box.right / z, bottom:box.bottom / z, width:box.width / z, height:box.height / z, x:(box.x ?? box.left) / z, y:(box.y ?? box.top) / z };
  return { ...rect, fontSize:parseFloat(style.fontSize) * (matrix ? Math.hypot(matrix.a, matrix.b) : 1) };
};
// Measure the rendered line, including the fewer nodes shown on a narrow screen.
function lineOnHome(id) {
  const row = $(`.hl-row[data-row="${CSS.escape(id)}"]`), track = row && $('.hl-track', row);
  if (!track?.getClientRects().length) return null;
  const b = flightRect(track), band = flightRect($('#view'));
  if (b.bottom < band.top || b.top > band.bottom) return null;
  const stops = {}, l = lineById(project(), id);
  for (const el of $$('.st', track)) {
    const nd = $('.nd', el); if (!nd?.getClientRects().length) continue;
    const s = el.dataset.step || (el.classList.contains('st-end') && l.stations.find(isEnd)?.id);
    if (!s) continue;
    const ring = getComputedStyle(nd, '::before');
    stops[s] = { ...centerOf(nd), r:parseFloat(ring.width) / 2 || 5 };
  }
  const first = Object.values(stops)[0]; if (!first) return null;
  const curve = getComputedStyle(track, '::before');
  return { stops, first,
    fork:{ x:b.left + parseFloat(curve.left), y:b.top + parseFloat(curve.top) + parseFloat(curve.height) / 2 },
    title:flightTitle($('.hl-title', row)), weight:2 };
}
function lineOnPage() {
  const list = $('#lpList'); if (!list) return null;
  // A long line runs past the ends of its list. What is out of sight travels from the edge, unseen, not from far off the screen.
  const band = flightRect(list), stops = {};
  $$('.lps[data-step]', list).forEach(el => { const node = $('.lps-node', el), at = centerOf(node), ring = getComputedStyle(node, '::before'), y = clamp(at.y, band.top - 8, band.bottom + 8); stops[el.dataset.step] = { x:at.x, y, r:y !== at.y ? 0 : (ring.content === 'none' ? node.offsetWidth : parseFloat(ring.width) || node.offsetWidth) / 2 }; });
  const first = Object.values(stops)[0]; if (!first) return null;
  const lead = $('.lps-day.first, .lps.first', list), stem = lead && getComputedStyle(lead, '::before');
  const top = lead ? flightRect(lead).top + (parseFloat(stem.top) || 0) : first.y;
  return { stops, first, fork:{ x:first.x, y:Math.min(first.y, Math.max(band.top, top)) }, title:flightTitle($('#lpTitle')), weight:3 };
}
// Back on the home, the line you were on is on screen, even if it moved while you were away or you came by a link.
function showRow(id) {
  const view = $('#view'), row = $(`.hl-row[data-row="${CSS.escape(id)}"]`); if (!row) return;
  const box = flightRect(view), y = flightRect(row).top;
  if (y < box.top + 50 || y > box.bottom - 150) view.scrollTop += y - box.top - box.height * .35;
}
const lerp = (a, b, k) => a + (b - a) * k;
const easeBoth = k => k * k * (3 - 2 * k);
const FLIGHT_MS = 520;
// Missing history collapses onto the track in station order, never onto the badge above it.
function flightStops(l, geometry) {
  const known = l.stations.map((s, i) => geometry.stops[s.id] ? i : -1).filter(i => i >= 0);
  return l.stations.map((s, i) => {
    if (geometry.stops[s.id]) return geometry.stops[s.id];
    const after = known.find(j => j > i), before = known.filter(j => j < i).pop();
    const a = before === undefined ? null : geometry.stops[l.stations[before].id], b = after === undefined ? null : geometry.stops[l.stations[after].id];
    const k = a && b ? (i - before) / (after - before) : 0, edge = a || b || geometry.first;
    return { x:a && b ? lerp(a.x, b.x, k) : edge.x, y:a && b ? lerp(a.y, b.y, k) : edge.y, r:0 };
  });
}
// Shared, bounded tangents keep every join smooth without overshooting a stop or folding the line.
function flightCurve(points) {
  const tangent = points.map((p, i) => Object.fromEntries(['x', 'y'].map(axis => {
    const before = i ? p[axis] - points[i - 1][axis] : null, after = i < points.length - 1 ? points[i + 1][axis] - p[axis] : null;
    return [axis, before === null ? after || 0 : after === null ? before : before * after <= 0 ? 0 : Math.sign(after) * Math.min(Math.abs(before), Math.abs(after))];
  })));
  return points.slice(1).map((p, i) => { const a = points[i], u = tangent[i], v = tangent[i + 1]; return `C${a.x + u.x / 3},${a.y + u.y / 3} ${p.x - v.x / 3},${p.y - v.y / 3} ${p.x},${p.y}`; });
}
let flightCleanups = [];
function cleanFlight() { const jobs = flightCleanups; flightCleanups = []; jobs.forEach(fn => fn()); }
function hideForFlight(el) { if (!el) return; const before = el.style.visibility; el.style.visibility = 'hidden'; flightCleanups.push(() => { el.style.visibility = before; }); }
// One moving line, drawn above the page while it travels. Whatever it stands in for stays hidden until it arrives.
function flyLine(l, from, to, { onEnd, duration = FLIGHT_MS, title } = {}) {
  const origin = flightStops(l, from), destination = flightStops(l, to);
  // A stop out of sight at both ends is not part of what you see move.
  const inSight = l.stations.filter((s, i) => origin[i].r > 0 || destination[i].r > 0), stops = inSight.length ? inSight : l.stations, reached = l.stations.indexOf(currentStation(l));
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), n = stops.length, cur = Math.max(0, stops.filter(s => l.stations.indexOf(s) <= reached).length - 1);
  const a = stops.map(s => origin[l.stations.indexOf(s)]), b = stops.map(s => destination[l.stations.indexOf(s)]);
  // Each stop keeps its own colour on the way, so nothing changes when it arrives.
  const paintOf = s => s.toReview ? ['var(--amber-mark)', 'var(--amber-mark)'] : s.unsent ? ['var(--paper)', 'var(--amber-mark)'] : s.state === 'todo' ? ['var(--paper)', 'var(--l-todo)'] : s.state === 'active' ? ['var(--paper)', 'var(--c-run)'] : s.state === 'error' ? ['var(--red)', 'var(--red)'] : s.state === 'off' ? ['var(--l-todo)', 'var(--l-todo)'] : isEnd(s) ? ['var(--c-end)', 'var(--c-end)'] : s.kind === 'ask' ? ['var(--c-ask-fill)', 'var(--c-ask)'] : s.state === 'wait' ? ['var(--amber-mark)', 'var(--amber-mark)'] : ['var(--c-work)', 'var(--c-work)'];
  svg.setAttribute('class', 'fly-layer'); svg.setAttribute('aria-hidden', 'true');
  const shape = attrs => { const el = document.createElementNS(NS, 'path'); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.append(el); return el; };
  const done = shape({ fill:'none', stroke:'var(--l-line)', 'stroke-linecap':'round', 'stroke-linejoin':'round' });
  const rest = shape({ fill:'none', stroke:'var(--l-todo)', 'stroke-dasharray':'1 7', 'stroke-linecap':'round' });
  const dots = stops.map(s => { const el = document.createElementNS(NS, 'circle'), [fill, ring] = paintOf(s); el.setAttribute('class', 'fly-node'); el.setAttribute('fill', fill); el.setAttribute('stroke', ring); el.setAttribute('stroke-width', fill === ring ? 0 : 2); svg.append(el); return el; });
  document.body.append(svg);
  let over = false, raf, current;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    svg.remove();
    S.flying = false; S.flightEnd = null; S.flightSnapshot = null;
    onEnd?.();
    cleanFlight();
    if (S.flyMissed) { S.flyMissed = false; refreshAfterChange(); }
  };
  S.flying = true;
  // Moving on before it arrives ends it, so two lines are never on the way at once.
  S.flightEnd = finish;
  S.flightSnapshot = () => ({ lineId:l.id, ...current, title:flightTitle(title?.effect.target) });
  const draw = k => {
    const pts = stops.map((s, i) => ({ x:lerp(a[i].x, b[i].x, k), y:lerp(a[i].y, b[i].y, k), r:lerp(a[i].r ?? 5, b[i].r ?? 5, k) }));
    const fork = { x:lerp(from.fork.x, to.fork.x, k), y:lerp(from.fork.y, to.fork.y, k) }, weight = lerp(from.weight ?? 1.75, to.weight ?? 1.75, k);
    const segments = flightCurve([fork, ...pts]);
    done.setAttribute('d', `M${fork.x},${fork.y}${segments.slice(0, cur + 1).join('')}`);
    rest.setAttribute('d', cur < n - 1 ? `M${pts[cur].x},${pts[cur].y}${segments.slice(cur + 1).join('')}` : '');
    done.setAttribute('stroke-width', weight); rest.setAttribute('stroke-width', weight);
    pts.forEach((q, i) => { dots[i].setAttribute('cx', q.x); dots[i].setAttribute('cy', q.y); dots[i].setAttribute('r', q.r); dots[i].setAttribute('stroke-width', q.r && dots[i].getAttribute('fill') !== dots[i].getAttribute('stroke') ? 2 : 0); });
    if (title) title.currentTime = k * duration;
    current = { stops:Object.fromEntries(stops.map((s, i) => [s.id, pts[i]])), first:pts[0], fork, weight };
  };
  draw(0);
  const t0 = performance.now();
  const frame = t => { if (over) return; const raw = clamp((t - t0) / duration, 0, 1); draw(easeBoth(raw)); if (raw === 1) finish(); else raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
}
function endFlight() { S.flightEnd?.(); cleanFlight(); document.querySelectorAll('.fly-ghost').forEach(el => el.remove()); }
function ghostOf(node, hide) {
  if (!node) return null;
  const b = flightRect(node), g = node.cloneNode(true);
  g.classList.add('fly-ghost');
  g.inert = true;
  g.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;margin:0;overflow:hidden;pointer-events:none;z-index:38;`;
  g.removeAttribute('id');
  hide?.(g);
  document.body.append(g);
  flightCleanups.push(() => g.remove());
  return g;
}
const fadeGhost = (g, duration = 220) => { if (!g) return; const a = g.animate([{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(.992)' }], { duration, easing:'ease-out', fill:'forwards' }); a.onfinish = () => g.remove(); };
const flipTitle = (el, from, duration = FLIGHT_MS) => {
  if (!el || !from?.width) return;
  const b = flightRect(el), s = from.fontSize ? from.fontSize / parseFloat(getComputedStyle(el).fontSize) : from.height / b.height;
  const animation = el.animate([{ transformOrigin:'0 0', transform:`translate(${from.left - b.left}px,${from.top - b.top}px) scale(${s})` }, { transformOrigin:'0 0', transform:'none' }], { duration, easing:'linear', fill:'both' });
  animation.pause(); animation.currentTime = 0;
  flightCleanups.push(() => animation.cancel());
  return animation;
};
// From the home: the line swings across to its place at the side, and everything else comes up around it.
function flightToLine(lineId, fromEl, interrupted) {
  if (reducedMotion()) return null;
  const onHome = interrupted?.lineId === lineId ? interrupted : lineOnHome(lineId), rect = !onHome && fromEl?.isConnected ? flightRect(fromEl) : null;
  const ghost = ghostOf($('#view > *'), g => { const row = $(`.hl-row[data-row="${CSS.escape(lineId)}"]`, g); $('.hl-track', row || g)?.style.setProperty('visibility', 'hidden'); $('.row-title-text', row || g)?.style.setProperty('visibility', 'hidden'); }), railGhost = ghostOf($('#rail'));
  return () => {
    const p = project(), l = lineById(p, lineId), to = lineOnPage(); if (!l || !to) { ghost?.remove(); railGhost?.remove(); return; }
    let from = onHome;
    if (!from && rect) { const at = { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 }; from = { stops:{}, first:at, fork:at, title:null }; }
    fadeGhost(ghost); fadeGhost(railGhost);
    // Only the first time: these are redrawn as work moves on, and must not fade in again each time.
    const page = $('#linePage'), list = $('#lpList');
    page?.classList.add('lp-rise');
    const timer = setTimeout(() => page?.classList.remove('lp-rise'), 1000);
    flightCleanups.push(() => { clearTimeout(timer); page?.classList.remove('lp-rise'); });
    if (!from) return;
    page?.classList.add('lp-title-flight');
    flightCleanups.push(() => page?.classList.remove('lp-title-flight'));
    hideForFlight(list);
    flyLine(l, from, to, { title:flipTitle($('#lpTitle'), from.title) });
  };
}
// And back: it swings to its row on the home, which fills in around it.
function flightToHome(lineId, interrupted) {
  if (reducedMotion()) return null;
  const from = interrupted?.lineId === lineId ? interrupted : lineOnPage(), ghost = ghostOf($('#linePage'), g => { $('.lp-list', g)?.style.setProperty('visibility', 'hidden'); $('#lpTitle', g)?.style.setProperty('visibility', 'hidden'); });
  return () => {
    const l = lineById(project(), lineId), to = lineOnHome(lineId), page = $('#view > *');
    fadeGhost(ghost);
    page?.animate?.([{ opacity:0 }, { opacity:1 }], { duration:280, easing:'ease-out' });
    if (!l || !from || !to) return;
    const row = $(`.hl-row[data-row="${CSS.escape(lineId)}"]`);
    hideForFlight($('.hl-track', row));
    flyLine(l, from, to, { title:flipTitle($('.hl-title', row), from.title) });
  };
}

// ---------- Draw on any Markdown file. Your marks become a picture with your words. ----------
const marksFor = key => S.marks[key] ||= [];
function currentMarks() {
  const r = S.route;
  if (r.view === 'markup') return marksFor(`doc:${r.doc}`);
  return null;
}
function unsentMarks() { const m = currentMarks(); return m ? m.filter(x => !x.sent).length : 0; }
async function marksPicture(l, dir, marks) {
  const raster = await rasterize(marksDataUri(marks));
  const saved = await api(`${pathFor(project().id)}/upload?dir=${encodeURIComponent(dir)}&name=my-marks.png`, { method:'POST', raw:new Blob([raster.bytes], { type:'image/png' }) });
  marks.forEach(m => { m.sent = true; });
  return { path:saved.path, name:'My marks' };
}
ACT['toggle-side'] = () => { S.sideHidden = !S.sideHidden; $('.step-body')?.classList.toggle('side-hidden', S.sideHidden); setTimeout(() => SHEET?.fit(), 0); };
function markupHTML(p, r) {
  const doc = docById(r.doc, p);
  if (!doc) { loadDoc(p, r.doc).then(() => { if (S.route.view === 'markup') render(); }).catch(error => toast(error.message)); return '<div class="page"><p class="empty-line">Opening…</p></div>'; }
  return `<div class="step-page markup-page" id="stepPage">
    <header class="step-top">
      <button type="button" class="ghost back" data-act="markup-back">${ic('left', 17)}<span>${esc(doc.path.split('/').pop())}</span></button>
      <div class="step-path"><strong class="markup-title">Draw on this file, then say what should change</strong></div>
      <div class="step-acts"><button type="button" class="icon-btn" data-act="toggle-side" aria-label="Show or hide the panel" title="Show or hide the panel">${ic('panel', 19)}</button></div>
    </header>
    <div class="step-body ${S.sideHidden ? 'side-hidden' : ''}">
      <div class="sheet-wrap" id="sheetWrap"><div class="sheet-stage"><div class="sheet-content" style="width:900px" id="sheetContent"><div class="sc sc-doc">${renderMd(doc.md, p, { compact:true, doc })}</div></div><svg class="ink-layer" aria-hidden="true"></svg><div class="note-layer"></div></div>${dockHTML()}</div>
      <aside class="step-side" aria-label="Feedback"><div class="side-scroll" id="sideScroll"><div class="side-head"><h2>Your marks</h2></div><p class="side-why plain">They are saved as a picture, linked from this file, with your words.</p></div><div class="side-composer">${composerHTML('markup-' + doc.path, { placeholder:'What should change?', on:'markup' })}</div></aside>
    </div>
  </div>`;
}
function mountMarkup(p, r) {
  if (!$('#sheetWrap')) return;
  SHEET?.destroy();
  SHEET = new Sheet($('#sheetWrap'), { marks:currentMarks(), tool:'pen', onChange:() => syncComposer($('.side-composer .composer')) });
}
ACT['draw-doc'] = el => go({ view:'markup', doc:el.dataset.doc }, { from:el });
ACT['markup-back'] = () => openDoc(S.route.doc, null, { back:true });
SEND.markup = async ({ text, files }) => {
  const p = project(), doc = await loadDoc(p, S.route.doc, { force:true }), l = lineOfDoc(p, doc), marks = (currentMarks() || []).filter(m => !m.sent);
  // Find which section the marks sit on, so the words point at the right place.
  let where = '';
  if (marks.length) {
    const top = marksBounds(marks).y, hit = $$('#sheetContent .md-sec').filter(x => x.offsetTop <= top + 8).pop();
    if (hit) where = `On "${$('.md-h2', hit).textContent}": `;
  }
  const words = where + (text || 'See my marks.');
  const picture = marks.length ? await marksPicture(l, l ? `files/${l.slug}` : 'files', marks) : null;
  if (l) await sendFeedback(l, { text:words, files, picture });
  else {
    const refs = files.length ? await uploadFiles(p, files, 'files') : [];
    await saveDoc(p, doc, appendedMd(doc, words, picture ? [...refs, { path:picture.path, name:'my-marks.png' }] : refs));
    await loadState(p.id, { force:true });
  }
  toast(`Added to ${doc.path.split('/').pop()}`);
  openDoc(doc.path, null, { back:true });
};
