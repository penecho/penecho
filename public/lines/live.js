// What an agent is doing, as a picture: the agent with the ten things it can reach, the one in use lit up.
// Worked out from the activity rows PenEcho already records (line.js loads them); nothing new is asked of the server.
// The band at the top of a running Work repaints in place, so its motion never restarts. See live.css for reduced motion.

const LIVE_STOPS = [
  ['you', 'You', 'setAgents'], ['files', 'Files', 'liveFiles'], ['edit', 'Edits', 'liveEdit'], ['tests', 'Tests', 'liveTests'], ['browser', 'Browser', 'liveBrowser'],
  ['web', 'Web', 'liveWeb'], ['git', 'Git', 'liveGit'], ['canvas', 'Canvas', 'navCanvases'], ['memory', 'Memory', 'navMemory'], ['helpers', 'Helpers', 'orchestrate'],
];
const LIVE_ICON = { ...Object.fromEntries(LIVE_STOPS.map(([id, , icon]) => [id, icon])), retry:'retry' };
// A file the way a person reads it: its last two parts.
const liveFile = target => { const m = String(target || '').match(/[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]{1,6}/); return m ? m[0].split('/').slice(-2).join('/') : ''; };
// Tools the agent did not bring itself (MCP servers, an app's own extras), known by their server when the row has one, else by name.
// Drawn from the steps agents really took: browser tools, PenEcho, other agents and background runs used to all land on Files.
const LIVE_TOOLS = [
  ['canvas', /penecho|canvas|draw|plot|widget|^(start|get|list|inspect)_sessions?$/i, 'Drawing on the Canvas'],
  ['browser', /preview|browser|chrome|javascript|computer|node_repl|tabs_|playwright|screenshot|navigate|resize_window|read_page|get_page_text|read_console|read_network|form_input|file_upload|request_access|^app_|open_application|list_apps|^(js|eval|find)$/i, 'Checking the page in a browser'],
  ['helpers', /SendMessage|send_message|TaskStop|TaskOutput|Monitor|ListAgents|list_agents|job_output|dismiss_task|claude_agent|claude_(status|result|doctor)|advisor|open_in_codex/i, 'Working with a helper'],
  ['you', /SendUserFile|PushNotification|Artifact|^present$/i, 'Showing you something'],
  ['web', /github|fetch|calendar|list_events|gmail|slack|read_thread|notion|linear|figma/i, 'Using an outside service'],
];
// The programs a command runs, one per part, without the cd, the settings in front of them, quoted text and the text of a heredoc.
const LIVE_PREFIX = /^(?:(?:\w+=\S*|do|then|else|if|!|time|nohup|sudo|exec|env|timeout\s+\S+|caffeinate(?:\s+-\w+)*)\s+)+/;
const liveProgs = t => t.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?(?:\n\1\b|$)/g, '').replace(/'[^']*'|"(?:\\[\s\S]|[^"\\])*"/g, '""').split(/&&|\|\||;|\n|\|/)
  .map(s => { const w = s.trim().replace(/^\(+/, '').replace(LIVE_PREFIX, '').split(/\s+/)[0]; return /^\w+=/.test(w) ? '' : w.split('/').pop(); })
  .filter(w => w && !/^(cd|export|set|echo|printf|for|fi|done|true|false|\[+|\]+|[{}()]+|""|-.*|#.*)$/.test(w));
const LIVE_SCRIPT = /^(node|python\d*(\.\d+)?|bash|sh|zsh|ruby|deno|bun|tsx|npx|perl)$/;
const LIVE_READ = /^(cat|sed|grep|rg|head|tail|less|nl|wc|ls|find|tree|awk|jq|diff|file|stat|du|pwd|which|basename|dirname|sort|uniq|cut|xxd|strings|shasum|md5)$/;
const LIVE_CHANGE = /^(rm|mv|cp|mkdir|ln|touch|chmod|unzip|tar|rsync)$/;
// One recorded step: which stop it reaches and what it does, in plain words. Never the raw command.
function liveKind(row) {
  if (row.kind === 'error') return ['you', 'Stopped with an error'];
  if (row.kind !== 'tool') return null;
  const v = String(row.verb || ''), t = String(row.target || ''), file = liveFile(t);
  if (/MEMORY\.md|\.penecho[\\/]memory/.test(t)) return ['memory', /\.penecho[\\/]memory(\.cmd)?['"]?\s+(apply|add|replace|delete)/.test(t) || /^(Wrote|Edited)$/.test(v) ? 'Adding to the project memory' : 'Reading the project memory'];
  if (v === 'Read') return ['files', `Reading ${file || 'a file'}`];
  if (v === 'Wrote') return ['edit', `Writing ${file || 'a file'}`];
  if (v === 'Edited') return ['edit', `Editing ${file || 'files'}`];
  if (/^Searched the web/.test(v)) return ['web', t ? `Looking on the web: ${t.slice(0, 60)}` : 'Looking on the web'];
  if (v === 'Opened') return ['web', 'Reading a web page'];
  if (/helper/.test(v)) return ['helpers', 'Asked a helper to look into something'];
  if (/Asked you/.test(v)) return ['you', 'Waiting for your answer'];
  if (/plan|wrap_up|todo/i.test(v)) return ['you', 'Telling you where it stands'];
  if (/^Searched for|^Looked for/.test(v)) return ['files', 'Looking through the code'];
  if (v === 'Ran') {
    const progs = liveProgs(t), runs = re => progs.some(p => re.test(p));
    const git = t.match(/\bgit\s+(?:-[Cc]\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*([a-z][\w-]*)/), gh = t.match(/\bgh\s+([a-z]+)/);
    if (runs(/^git$/) && git) return ['git', `Git: ${git[1]}`];
    if (runs(/^gh$/) && gh) return ['git', `GitHub: ${gh[1]}`];
    if (/node --test|npm (run )?test|pytest|unittest|run_tests|jest|vitest|cargo test|go test|qa-[\w-]+\.c?js|run_eval/.test(t)) return ['tests', 'Running the tests'];
    if (/node --check|\btsc\b|eslint|npm run (build|lint|check|typecheck)|xcodebuild|gradlew|build[\w-]*\.m?js/.test(t)) return ['tests', 'Checking that it builds'];
    if (runs(/^(adb|emulator|xcrun|simctl)$/)) return ['browser', 'Trying it on a phone'];
    if (/verify-|playwright|screenshot|chromium|measure-/.test(t)) return ['browser', /measure-/.test(t) ? 'Measuring how fast it runs' : 'Checking the page in a browser'];
    if (runs(/^(ssh|scp|aws|gcloud|az|kubectl|flyctl|vercel|wrangler)$/)) return ['web', 'Working on a server'];
    if (runs(/^(curl|wget)$/)) return ['web', 'Calling a web address'];
    // A helper or a long run going on in the background: the agent reads its output or waits for it.
    if (/\/tasks\/[\w-]+\.output|\/tool-results\//.test(t) || runs(/^(until|while|sleep)$/)) return ['helpers', 'Waiting for something running in the background'];
    if (runs(/^(ps|pgrep|lsof|kill|pkill|killall)$/)) return ['tests', 'Checking what is running'];
    if (/<<\s*'?EOF|cat\s+>>?|sed -i|apply_patch|tee\s/.test(t) || runs(LIVE_CHANGE)) return ['edit', `Changing ${file || 'files'}`];
    if (/npm (i|install|ci)\b|pip3? install|uv (sync|add)|brew install/.test(t)) return ['edit', 'Installing what it needs'];
    if (!progs.length || progs.every(p => LIVE_READ.test(p))) return ['files', file ? `Reading ${file}` : 'Looking through the code'];
    return ['files', progs.some(p => LIVE_SCRIPT.test(p)) ? 'Running a script' : 'Running a command'];
  }
  const tool = v.replace(/^Used /, '');
  for (const [stop, re, say] of LIVE_TOOLS) if (re.test(row.via || '') || re.test(tool)) return [stop, say];
  // Anything else from an MCP server is a service outside the agent; anything without one is its own.
  return [row.via ? 'web' : 'files', `Using ${tool}`];
}
// The rows of one Work, summed up: how often each stop was reached, the one in use now, whether it is thinking (no tool running), the last things done, the last thing said.
function liveState(rows) {
  const counts = {}, feed = [];
  let now = '', say = '', runningTool = null, lastKind = '', hasTool = false, hasStatefulTool = false;
  for (const row of rows) {
    if (row.kind === 'say') { say = row.text || say; lastKind = 'say'; continue; }
    // A model call being tried again is said as it is ("Trying again (2 of 8)"), and counts for no stop.
    if (row.kind === 'retry') { const t = row.text || 'Trying again'; if (feed[0]?.[1] !== t) feed.unshift(['retry', t]); lastKind = 'retry'; continue; }
    const k = liveKind(row); if (!k) continue;
    counts[k[0]] = (counts[k[0]] || 0) + 1;
    if (feed[0]?.[1] !== k[1]) feed.unshift(k);
    if (row.kind === 'error') { now = k[0]; lastKind = 'error'; continue; }
    hasTool = true;
    if (row.state !== undefined) hasStatefulTool = true;
    if (row.state === 'running') runningTool = k;
    else if (row.state === undefined) now = k[0];
    lastKind = 'tool';
  }
  let phase = 'thinking';
  if (runningTool) { phase = 'tool'; now = runningTool[0]; }
  else if (lastKind === 'error') { phase = 'tool'; }
  else if (lastKind === 'retry') { phase = 'retry'; now = ''; }
  else if (hasTool && !hasStatefulTool) { phase = 'tool'; }
  else { phase = 'thinking'; now = ''; }
  const activeLabel = runningTool ? runningTool[1] : (phase === 'tool' || phase === 'retry' ? (feed[0]?.[1] || '') : '');
  return { counts, now, phase, activeLabel, feed:feed.slice(0, 4), say };
}
// Where everything sits: the soft-mantle octopus head at center-top, ten stops in an arch around it; r is a stop's size.
let LIVE_UID = 0;
function liveLayout(small) {
  if (small) {
    return {
      W:240, H:136, c:[120, 44], R:17, r:10,
      P:[
        [60, 22, 'l'], [28, 48, 'l'], [30, 80, 'l'], [58, 106, 'l'], [96, 118, 'b'],
        [180, 22, 'r'], [212, 48, 'r'], [210, 80, 'r'], [182, 106, 'r'], [144, 118, 'b'],
      ],
    };
  }
  return {
    W:540, H:222, c:[270, 70], R:30, r:15,
    P:[
      [136, 34, 'l'], [88, 76, 'l'], [94, 122, 'l'], [142, 160, 'l'], [214, 174, 'b'],
      [404, 34, 'r'], [452, 76, 'r'], [446, 122, 'r'], [398, 160, 'r'], [326, 174, 'b'],
    ],
  };
}
// Shift a #rrggbb hex colour lighter or darker for the octopus head's subtle depth sheen.
function liveShade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex || '#1a73e8';
  const n = parseInt(m[1], 16), ch = v => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
// One tapered octopus leg sweeping from beneath the central mantle to stop i, with its centerline and inner suckers.
function liveTentacle(L, i, small) {
  const [cx, cy] = L.c, [nx, ny] = L.P[i], isLeft = i < 5, idx = i % 5, s = isLeft ? -1 : 1;
  const collar = [[.64, .44], [.52, .62], [.38, .74], [.24, .84], [.10, .88]][idx];
  const p0 = [cx + s * L.R * collar[0], cy + L.R * collar[1]];
  const ang = Math.atan2(ny - p0[1], nx - p0[0]);
  const p3 = [nx - Math.cos(ang) * (L.r + 1), ny - Math.sin(ang) * (L.r + 1)];
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1], sc = small ? .45 : 1;
  const droop = [22, 30, 36, 34, 28][idx] * sc, lift = [-20, -16, -10, 4, 8][idx] * sc;
  const p1 = [p0[0] + dx * .36 + s * (12 * sc), p0[1] + dy * .18 + droop];
  const p2 = [p0[0] + dx * .72, p3[1] + lift];
  const N = 18, hwStart = small ? 3.6 : 6.0, hwEnd = small ? .9 : 1.35;
  const pts = [], left = [], right = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    const tx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
    const ty = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
    const len = Math.hypot(tx, ty) || 1, vx = -ty / len, vy = tx / len;
    const hw = hwEnd + (hwStart - hwEnd) * Math.pow(1 - t, 1.12);
    pts.push({ x, y, vx, vy, hw });
    left.push([+(x + vx * hw).toFixed(1), +(y + vy * hw).toFixed(1)]);
    right.push([+(x - vx * hw).toFixed(1), +(y - vy * hw).toFixed(1)]);
  }
  const poly = `M${left.map(p => `${p[0]} ${p[1]}`).join(' L')} L${right.slice().reverse().map(p => `${p[0]} ${p[1]}`).join(' L')} Z`;
  const edgeL = `M${left.map(p => `${p[0]} ${p[1]}`).join(' L')}`;
  const edgeR = `M${right.map(p => `${p[0]} ${p[1]}`).join(' L')}`;
  const center = `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} C${p1[0].toFixed(1)} ${p1[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}, ${p3[0].toFixed(1)} ${p3[1].toFixed(1)}`;
  const centerRev = `M${p3[0].toFixed(1)} ${p3[1].toFixed(1)} C${p2[0].toFixed(1)} ${p2[1].toFixed(1)}, ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}, ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;
  const taps = small ? [0.24, 0.56, 0.86] : [0.24, 0.40, 0.56, 0.72, 0.86];
  const suckers = taps.map(ts => {
    const p = pts[Math.round(ts * N)], off = p.hw * .72 * s;
    return {
      cx: +(p.x + p.vx * off).toFixed(1),
      cy: +(p.y + p.vy * off).toFixed(1),
      r: +(Math.max(1.25, p.hw * .48) * (small ? .72 : .82)).toFixed(2),
    };
  });
  return { poly, edgeL, edgeR, center, centerRev, suckers, p0, p3 };
}
// Clean backdrop: subtle seabed wave horizon and hollow rising bubbles, with no background wash circle behind the octopus.
function liveSceneHTML(L, small) {
  if (small) {
    return `<g class="lv-scene" aria-hidden="true">`
      + `<path class="lv-wave" d="M8 ${L.H - 6}c18-3 36-3 54 0s36 3 54 0 36-3 54 0 36 3 46 0"/>`
      + `<circle class="lv-bubble b1" cx="14" cy="18" r="2.1"/>`
      + `<circle class="lv-bubble b2" cx="222" cy="18" r="1.8"/>`
      + `</g>`;
  }
  return `<g class="lv-scene" aria-hidden="true">`
    + `<path class="lv-wave" d="M18 ${L.H - 8}c32-4 64-4 96 0s64 4 96 0 64-4 96 0 64 4 96 0 64-4 96 0 18 2 24 0"/>`
    + `<circle class="lv-bubble b1" cx="38" cy="24" r="2.8"/>`
    + `<circle class="lv-bubble b2" cx="218" cy="24" r="2.1"/>`
    + `<circle class="lv-bubble b3" cx="506" cy="26" r="2.5"/>`
    + `<circle class="lv-bubble b2 b-crown-r" cx="326" cy="22" r="1.7"/>`
    + `</g>`;
}
// A small stop still shows what it stands for: its icon inside, and its name and how often it was used on hover.
const liveTip = (label, n) => `${label}: ${n ? `${n} time${n > 1 ? 's' : ''}` : 'not yet'}`;
function liveStopHTML(L, i, small) {
  const [id, label, icon] = LIVE_STOPS[i], [x, y, side] = L.P[i], r = L.r, isz = small ? 12 : 16;
  let labelEl = '';
  if (!small) {
    let lx = x, ly = y + r + 14, anchor = 'middle';
    if (side === 'l') { lx = x - r - 7; ly = y + 4; anchor = 'end'; }
    else if (side === 'r') { lx = x + r + 7; ly = y + 4; anchor = 'start'; }
    labelEl = `<text class="lv-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${label}<tspan class="lv-n" dx="4"></tspan></text>`;
  }
  return `<g class="lv-stop" data-stop="${id}"><title>${liveTip(label, 0)}</title>`
    + `<circle class="lv-ring" cx="${x}" cy="${y}" r="${r + 2}"/><circle class="lv-ring r2" cx="${x}" cy="${y}" r="${r + 2}"/>`
    + `<circle class="lv-bg" cx="${x}" cy="${y}" r="${r}"/>`
    + `<g class="lv-glyph" transform="translate(${x - isz / 2} ${y - isz / 2})">${ic(icon, isz).replace('class="ic"', '')}</g>`
    + `${labelEl}</g>`;
}
function liveDomePath(cx, cy, R) {
  const rx = R * 1.04, ry = R * 1.08;
  return `M${(cx - rx * .86).toFixed(1)} ${(cy + ry * .56).toFixed(1)}`
    + ` C${(cx - rx * 1.15).toFixed(1)} ${(cy + ry * .05).toFixed(1)}, ${(cx - rx * .92).toFixed(1)} ${(cy - ry * 1.05).toFixed(1)}, ${cx.toFixed(1)} ${(cy - ry * 1.05).toFixed(1)}`
    + ` C${(cx + rx * .92).toFixed(1)} ${(cy - ry * 1.05).toFixed(1)}, ${(cx + rx * 1.15).toFixed(1)} ${(cy + ry * .05).toFixed(1)}, ${(cx + rx * .86).toFixed(1)} ${(cy + ry * .56).toFixed(1)}`
    + ` Q${(cx + rx * .44).toFixed(1)} ${(cy + ry * .96).toFixed(1)} ${cx.toFixed(1)} ${(cy + ry * .92).toFixed(1)}`
    + ` Q${(cx - rx * .44).toFixed(1)} ${(cy + ry * .96).toFixed(1)} ${(cx - rx * .86).toFixed(1)} ${(cy + ry * .56).toFixed(1)} Z`;
}
// Thought Pearl (?) -> Spark (!) overlay beside the brow, toggled in place by .is-thinking and .is-aha classes.
function liveThoughtHTML(L, small) {
  const [cx, cy] = L.c;
  const mx = small ? cx + 29 : cx + 50, my = small ? cy - 28.5 : cy - 48, mr = small ? 8.2 : 12.6;
  const t1 = small ? [cx + 15.5, cy - 20.5, 1.5] : [cx + 27.5, cy - 34.5, 2.5];
  const t2 = small ? [cx + 20.5, cy - 24, 2.2] : [cx + 36, cy - 40.5, 3.8];
  const gScale = small ? .72 : 1.08, rIn = mr + (small ? 2.5 : 3.6), rOut = mr + (small ? 5.2 : 7.5);
  const rays = [-135, -90, -45, 0, 45].map(deg => {
    const rad = deg * Math.PI / 180;
    return `<line x1="${(mx + Math.cos(rad) * rIn).toFixed(1)}" y1="${(my + Math.sin(rad) * rIn).toFixed(1)}" x2="${(mx + Math.cos(rad) * rOut).toFixed(1)}" y2="${(my + Math.sin(rad) * rOut).toFixed(1)}"/>`;
  }).join('');
  return `<g class="lv-thought" aria-hidden="true">`
    + `<g class="tk-a-trail t1"><circle cx="${t1[0]}" cy="${t1[1]}" r="${t1[2]}"/></g>`
    + `<g class="tk-a-trail t2"><circle cx="${t2[0]}" cy="${t2[1]}" r="${t2[2]}"/></g>`
    + `<g class="aha-rays">${rays}</g>`
    + `<g class="tk-a-medallion">`
    + `<circle class="m-halo" cx="${mx}" cy="${my}" r="${(mr * 1.38).toFixed(1)}"/>`
    + `<circle class="m-bg" cx="${mx}" cy="${my}" r="${mr}"/>`
    + `<g class="lv-glyph-q" transform="translate(${mx} ${(my + .7).toFixed(1)}) scale(${gScale})">`
    + `<path class="q-stroke" d="M-3.0 -3.6 C-3.0 -5.9, -1.5 -7.2, 0.3 -7.2 C2.3 -7.2, 3.6 -5.9, 3.6 -4.1 C3.6 -2.4, 2.2 -1.7, 1.0 -0.9 C0.2 -0.3, 0 0.3, 0 1.4"/>`
    + `<circle class="q-dot" cx="0" cy="4.9" r="1.35"/></g>`
    + `<g class="lv-glyph-e" transform="translate(${mx} ${(my + .7).toFixed(1)}) scale(${gScale})">`
    + `<path class="e-stroke" d="M0 -7.0 L0 1.1"/><circle class="e-dot" cx="0" cy="4.9" r="1.5"/></g>`
    + `</g></g>`;
}
function liveFace(L, agent, gid) {
  const a = agentInfo(agent), [cx, cy] = L.c, R = L.R, small = L.W < 300;
  const rx = R * 1.04, ry = R * 1.08, sonarR = R + (small ? 9.5 : 13.5);
  const dome = liveDomePath(cx, cy, R);
  const shine = `M${(cx - rx * .58).toFixed(1)} ${(cy - ry * .22).toFixed(1)} Q${(cx - rx * .52).toFixed(1)} ${(cy - ry * .76).toFixed(1)} ${(cx - rx * .04).toFixed(1)} ${(cy - ry * .84).toFixed(1)}`;
  const eyeY = cy + ry * .50, eyeDx = rx * .30, er = small ? 1.8 : 2.8, pr = small ? 1.0 : 1.45;
  return `<g class="lv-face">`
    + `<circle class="lv-sonar" cx="${cx}" cy="${cy - 1}" r="${sonarR}" stroke-dasharray="4 7"/>`
    + `<circle class="tk-a-ripple" cx="${cx}" cy="${cy - 1}" r="${R + (small ? 5.5 : 8.5)}"/>`
    + `<circle class="tk-a-ripple r2" cx="${cx}" cy="${cy - 1}" r="${R + (small ? 5.5 : 8.5)}"/>`
    + `<circle class="aha-ring" cx="${cx}" cy="${cy - 1}" r="${R + (small ? 5.5 : 9)}"/>`
    + `<g class="lv-mantle">`
    + `<path class="lv-hull" fill="url(#${gid}-h)" d="${dome}"/>`
    + `<g clip-path="url(#${gid}-clip)">`
    + `<ellipse class="tk-sheen" cx="${cx}" cy="${(cy - R * .34).toFixed(1)}" rx="${(R * .74).toFixed(1)}" ry="${(R * .54).toFixed(1)}" fill="url(#${gid}-sh)"/>`
    + `<circle class="aha-flash" cx="${cx}" cy="${(cy - R * .35).toFixed(1)}" r="${(R * .78).toFixed(1)}" fill="url(#${gid}-af)"/>`
    + `</g>`
    + `<path class="lv-rim" d="${dome}"/>`
    + `<path class="lv-glint" stroke-width="${small ? 1.5 : 2.3}" d="${shine}"/>`
    + `<text class="lv-mono" x="${cx}" y="${(cy + R * .04).toFixed(1)}" font-size="${(R * .68).toFixed(1)}">${esc(a.mono)}</text>`
    + `<g class="lv-eyes">`
    + `<circle class="lv-eye" cx="${(cx - eyeDx).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${er}"/>`
    + `<circle class="lv-pupil" cx="${(cx - eyeDx + pr * .2).toFixed(1)}" cy="${(eyeY + pr * .15).toFixed(1)}" r="${pr}"/>`
    + `<circle class="lv-eye" cx="${(cx + eyeDx).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${er}"/>`
    + `<circle class="lv-pupil" cx="${(cx + eyeDx - pr * .2).toFixed(1)}" cy="${(eyeY + pr * .15).toFixed(1)}" r="${pr}"/>`
    + `</g></g></g>${liveThoughtHTML(L, small)}`;
}
// Format the LLM's latest text output for the live card: readable multi-line prose with safe inline emphasis and code.
const LIVE_SAY_MAX = 1600;
function liveSayInline(line) {
  return esc(line)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1');
}
function liveSayHTML(text) {
  let raw = String(text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!raw) return '';
  if (raw.length > LIVE_SAY_MAX) raw = `${raw.slice(0, LIVE_SAY_MAX).replace(/\s+\S*$/, '')}…`;
  const blocks = raw.split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const h = l.match(/^#{1,6}\s+(.*)$/);
      if (h) return `<strong>${liveSayInline(h[1])}</strong>`;
      return liveSayInline(l.replace(/^[-*]\s+/, '• '));
    });
    return lines.length ? `<p>${lines.join('<br>')}</p>` : '';
  }).filter(Boolean).join('');
}
// The band: drawn once for a Work, painted again by paintLive. In a narrow panel (the line panel beside a Canvas, a phone) the stops are small
// icons beside the words, so nothing is drawn too small to read.
function liveBandHTML(agent, small = false) {
  const L = liveLayout(small), a = agentInfo(agent), gid = `lv-oc-${++LIVE_UID}`;
  const hi = liveShade(a.color, 34), deep = liveShade(a.color, -26);
  const dome = liveDomePath(L.c[0], L.c[1], L.R);
  const defs = `<defs>`
    + `<radialGradient id="${gid}-h" cx="35%" cy="28%" r="72%"><stop offset="0%" stop-color="${esc(hi)}"/><stop offset="56%" stop-color="${esc(a.color)}"/><stop offset="100%" stop-color="${esc(deep)}"/></radialGradient>`
    + `<linearGradient class="lv-act-grad" id="${gid}-a" gradientUnits="userSpaceOnUse" x1="${L.c[0]}" y1="${L.c[1]}" x2="${L.c[0]}" y2="${L.c[1]}"><stop offset="0%" stop-color="${esc(a.color)}"/><stop offset="48%" stop-color="#1486b8"/><stop offset="100%" stop-color="var(--lv-accent)"/></linearGradient>`
    + `<clipPath id="${gid}-clip"><path d="${dome}"/></clipPath>`
    + `<radialGradient id="${gid}-sh" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#e0f2fe" stop-opacity=".95"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="${gid}-af" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#fef08a" stop-opacity=".95"/><stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>`
    + `</defs>`;
  const legs = LIVE_STOPS.map(([id], i) => {
    const leg = liveTentacle(L, i, small);
    const suckers = leg.suckers.map(sk => `<circle class="lv-sucker" cx="${sk.cx}" cy="${sk.cy}" r="${sk.r}"/>`).join('');
    const recall = `<path class="tk-a-inward" d="${leg.centerRev}" style="animation-delay:${(-(i * .7) % 3.4).toFixed(2)}s"/>`;
    return `<g class="lv-leg" data-stop="${id}"><path class="lv-leg-fill" d="${leg.poly}"/><path class="lv-leg-edge" d="${leg.edgeL}"/><path class="lv-leg-edge" d="${leg.edgeR}"/>${suckers}${recall}</g>`;
  }).join('');
  const stops = LIVE_STOPS.map((_, i) => liveStopHTML(L, i, small)).join('');
  const dotR = small ? 2.1 : 3.2;
  const dot = `<g class="lv-dot" hidden>${[0, -0.62].map(d =>
    `<g class="lv-dot-b"><circle class="lv-dot-halo" r="${(dotR * 2).toFixed(1)}"/><circle class="lv-dot-core" r="${dotR}"/><circle class="lv-dot-pearl" cx="${(-dotR * .28).toFixed(1)}" cy="${(-dotR * .28).toFixed(1)}" r="${(dotR * .34).toFixed(1)}"/><animateMotion dur="1.25s" begin="${d}s" repeatCount="indefinite" path=""/></g>`
  ).join('')}</g>`;
  return `<div class="lv ${small ? 'small' : ''}" data-agent="${esc(agent)}" data-small="${small}" data-gid="${gid}"><svg class="lv-pic" viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="What ${esc(a.name)} is doing">${defs}${liveSceneHTML(L, small)}<g class="lv-legs">${legs}</g>${dot}${stops}${liveFace(L, agent, gid)}</svg>
    <div class="lv-text"><div class="lv-now"><span class="lv-now-label"></span><span class="lv-state-pill" aria-hidden="true" hidden></span><time></time></div><div class="lv-say" hidden></div></div></div>`;
}
// Brief "!" spark right after thinking finishes before lighting up the next tool.
const LIVE_AHA_MS = 1000;
const LIVE_PHASE = new WeakMap();
function liveShownPhase(band, host, agent, rows, started, rawPhase) {
  let ps = LIVE_PHASE.get(band);
  if (!ps) {
    ps = { raw:rawPhase, shown:rawPhase, ahaUntil:0, timer:0, args:{ host, agent, rows, started } };
    LIVE_PHASE.set(band, ps);
    return rawPhase;
  }
  ps.args = { host, agent, rows, started };
  const nowMs = Date.now();
  if (ps.raw === 'thinking' && rawPhase === 'tool') {
    if (ps.timer && typeof clearTimeout === 'function') clearTimeout(ps.timer);
    ps.raw = rawPhase;
    ps.shown = 'aha';
    ps.ahaUntil = nowMs + LIVE_AHA_MS;
    if (typeof setTimeout === 'function') {
      ps.timer = setTimeout(() => {
        ps.timer = 0; ps.ahaUntil = 0;
        if (!band.isConnected || !host.contains(band)) return;
        const latest = ps.args;
        if (latest) paintLive(latest.host, latest.agent, latest.rows, latest.started);
      }, LIVE_AHA_MS);
    }
    return 'aha';
  }
  if (ps.shown === 'aha' && nowMs < ps.ahaUntil) {
    ps.raw = rawPhase;
    return 'aha';
  }
  if (ps.timer && typeof clearTimeout === 'function') { clearTimeout(ps.timer); ps.timer = 0; }
  ps.ahaUntil = 0;
  ps.raw = rawPhase;
  ps.shown = rawPhase;
  return rawPhase;
}
function paintLive(host, agent, rows, started) {
  if (!host) return;
  const small = (host.clientWidth || host.parentElement?.clientWidth || 600) < 460;
  let band = host.querySelector('.lv');
  if (!band || band.dataset.agent !== agent || band.dataset.small !== String(small)) { host.innerHTML = liveBandHTML(agent, small); band = host.querySelector('.lv'); }
  const st = liveState(rows), L = liveLayout(small), gid = band.dataset.gid || '';
  const shown = liveShownPhase(band, host, agent, rows, started, st.phase);
  band.classList.toggle('is-thinking', shown === 'thinking');
  band.classList.toggle('is-aha', shown === 'aha');
  const activeStop = shown === 'tool' ? st.now : '';
  for (const [id, label] of LIVE_STOPS) {
    const stop = band.querySelector(`.lv-stop[data-stop="${id}"]`), leg = band.querySelector(`.lv-leg[data-stop="${id}"]`), n = st.counts[id] || 0, isNow = activeStop === id;
    stop.classList.toggle('used', n > 0); stop.classList.toggle('now', isNow);
    leg.classList.toggle('used', n > 0); leg.classList.toggle('now', isNow);
    const fill = leg.querySelector('.lv-leg-fill'); if (fill) fill.style.fill = isNow && gid ? `url(#${gid}-a)` : '';
    const count = stop.querySelector('.lv-n'); if (count) count.textContent = n || '';
    const tip = stop.querySelector('title'); if (tip) tip.textContent = liveTip(label, n);
  }
  const dot = band.querySelector('.lv-dot'), i = LIVE_STOPS.findIndex(([id]) => id === activeStop);
  dot.toggleAttribute('hidden', i < 0);
  if (i >= 0) {
    const leg = liveTentacle(L, i, small), grad = band.querySelector('.lv-act-grad');
    if (grad) {
      grad.setAttribute('x1', leg.p0[0].toFixed(1)); grad.setAttribute('y1', leg.p0[1].toFixed(1));
      grad.setAttribute('x2', leg.p3[0].toFixed(1)); grad.setAttribute('y2', leg.p3[1].toFixed(1));
    }
    for (const motion of dot.querySelectorAll('animateMotion')) if (motion.getAttribute('path') !== leg.center) motion.setAttribute('path', leg.center);
  }
  const headline = shown === 'thinking' ? 'Thinking' : shown === 'aha' ? (small ? 'Next step' : 'Ready — next step') : (st.activeLabel || st.feed[0]?.[1] || 'Starting');
  band.querySelector('.lv-now-label').textContent = headline;
  const pill = band.querySelector('.lv-state-pill');
  if (pill) {
    if (shown === 'thinking') { pill.hidden = false; pill.className = 'lv-state-pill p-think'; pill.textContent = '?'; }
    else if (shown === 'aha') { pill.hidden = false; pill.className = 'lv-state-pill p-aha'; pill.textContent = '!'; }
    else { pill.hidden = true; pill.className = 'lv-state-pill'; pill.textContent = ''; }
  }
  const mins = started ? Math.max(0, Math.round((Date.now() - started) / 60000)) : 0;
  band.querySelector('.lv-now time').textContent = started ? (mins < 1 ? 'just now' : `${mins} min`) : '';
  const say = band.querySelector('.lv-say'), said = String(st.say || '').trim();
  say.hidden = !said;
  if (said) {
    const html = liveSayHTML(said);
    if (say.dataset.h !== html) { say.innerHTML = say.dataset.h = html; say.scrollTop = 0; }
  } else if (say.dataset.h) {
    say.innerHTML = say.dataset.h = '';
  }
}
// ---------- Small touches ----------
// A Work that has just ended drops onto its line: the page remembers, for a few seconds, which Works it saw running.
const LIVE_SEEN = new Map();
function justEnded(l, s) {
  const key = `${l.id}:${s.id}`, was = LIVE_SEEN.get(key);
  if (s.state === 'active') { LIVE_SEEN.set(key, { active:true }); return false; }
  if (was?.active) LIVE_SEEN.set(key, { endedAt:Date.now() });
  const ended = LIVE_SEEN.get(key)?.endedAt;
  return Boolean(ended && Date.now() - ended < 4000);
}
