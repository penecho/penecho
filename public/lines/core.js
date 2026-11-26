// Helpers shared by every part of the prototype: DOM shortcuts, icons, avatars and the ink stroke.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8);
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 4).join('-') || 'line';
const nowClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const ACT = {};

const ICONS = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.500V20h12V9.500"/>',
  agents: '<circle cx="9" cy="8" r="3.500"/><path d="M3 20c.5-4 3-6 6-6s5.500 2 6 6"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.600c1.900.8 3 2.700 3.300 5.400"/>',
  memory: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/>',
  files: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  filesOpen: '<path d="M3 17V7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1.500"/><path d="M3 17l2.300-5.400A2 2 0 017.100 10.500H20.200a1 1 0 01.950 1.300l-1.900 5.800A2 2 0 0117.350 19H5a2 2 0 01-2-2z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4"/>',
  pen: '<path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 013 3L8 19z"/><path d="M14.500 6.500l3 3"/>',
  marker: '<path d="M8.500 14.500L5 20l5.500-3.500"/><path d="M8.500 14.500L17 5l3 3-9.500 8.500z"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  box: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  note: '<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>',
  eraser: '<path d="M8 20l-4-4a2 2 0 010-2.800l9-9a2 2 0 012.800 0l4.200 4.200a2 2 0 010 2.800L12 19.800"/><path d="M8 20h12M9 8.500l6.500 6.500"/>',
  cursor: '<path d="M6 3l13 9-6 1.500L10.500 20z"/>',
  hand: '<path d="M8 12V6a1.500 1.500 0 013 0v5M11 11V4.500a1.500 1.500 0 013 0V11M14 11V6a1.500 1.500 0 013 0v8c0 4-2.500 7-6.500 7-3 0-4.500-1.500-6-4l-2-4a1.500 1.500 0 012.500-1.500L8 14"/>',
  undo: '<path d="M9 7l-5 5 5 5"/><path d="M4 12h10a6 6 0 016 6v1"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 00-6 6v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.900 12.100L20 3M16.500 6.500l3 3M14 9l2 2"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
  star: '<path d="M12 4l2.400 5 5.600.8-4 3.900.9 5.500L12 16.600 7.100 19.200l.9-5.500-4-3.900 5.600-.8z"/>',
  clip: '<path d="M20 11.500l-8.200 8.200a5 5 0 01-7.100-7.100l8.500-8.500a3.400 3.400 0 014.800 4.800l-8.500 8.500a1.700 1.700 0 01-2.400-2.400l7.800-7.800"/>',
  send: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.500l5 5 5-5"/><path d="M5 20h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
  branch: '<circle cx="7" cy="5.500" r="2"/><circle cx="7" cy="18.500" r="2"/><circle cx="17" cy="7.500" r="2"/><path d="M7 7.500v9M17 9.500c0 4-4.500 4-10 6"/>',
  merge: '<circle cx="7" cy="5.500" r="2"/><circle cx="7" cy="18.500" r="2"/><circle cx="17" cy="14" r="2"/><path d="M7 7.500v9M7.800 7.500C9 11 12 14 15 14"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  image: '<rect x="3.500" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.500"/><path d="M4 17l5-4 3.500 3 3-2.500 4.500 3.500"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  slides: '<rect x="3" y="4.500" width="18" height="12" rx="1.500"/><path d="M12 16.500V20M8.500 20h7"/>',
  canvas: '<rect x="3.500" y="3.500" width="17" height="17" rx="2"/><path d="M7.500 15c2-4 3.500-5 5-3s3 1 4-2.500"/>',
  spark: '<path d="M12 3.500l1.800 5.700 5.700 1.800-5.700 1.800L12 18.500l-1.800-5.700L4.500 11l5.700-1.800z"/>',
  pause: '<path d="M9 5.500v13M15 5.500v13"/>',
  play: '<path d="M7.500 5l11 7-11 7z"/>',
  stop: '<rect x="6.500" y="6.500" width="11" height="11" rx="1.500"/>',
  copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="1.500"/><path d="M15.500 8.500V5.500a1 1 0 00-1-1h-9a1 1 0 00-1 1v9a1 1 0 001 1h3"/>',
  code: '<path d="M8.500 7l-5 5 5 5M15.500 7l5 5-5 5"/>',
  split: '<rect x="3.500" y="4.500" width="17" height="15" rx="2"/><path d="M12 4.500v15"/>',
  read: '<path d="M12 6.500C10 5 7 4.500 3.500 5v13.500c3.500-.5 6.500 0 8.500 1.500 2-1.500 5-2 8.500-1.500V5C17 4.500 14 5 12 6.500zM12 6.500V20"/>',
  refer: '<path d="M9 14l-5-5 5-5"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>',
  pin: '<path d="m15 3 6 6-3 1-4 5-.5 3.5-3.5-3.5L4 21l-1-1 6-6-3.5-3.5L9 10l5-4z"/>',
  more: '<circle cx="5.500" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.500" cy="12" r="1"/>',
  retry: '<path d="M19.500 12a7.500 7.500 0 11-2.300-5.400"/><path d="M19.500 3.500v4h-4"/>',
  trash: '<path d="M5 7h14M10 7V4.500h4V7M7 7l1 13h8l1-13"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.400 15a1.650 1.650 0 0 0 .330 1.820l.060.060a2 2 0 1 1-2.830 2.830l-.060-.060a1.650 1.650 0 0 0-2.800 1.170V21a2 2 0 1 1-4 0v-.090a1.650 1.650 0 0 0-2.800-1.170l-.060.060a2 2 0 1 1-2.830-2.830l.060-.060a1.650 1.650 0 0 0-1.170-2.800H3a2 2 0 1 1 0-4h.090a1.650 1.650 0 0 0 1.170-2.800l-.060-.060a2 2 0 1 1 2.830-2.830l.060.060a1.650 1.650 0 0 0 2.800-1.170V3a2 2 0 1 1 4 0v.090a1.650 1.650 0 0 0 2.800 1.170l.060-.060a2 2 0 1 1 2.830 2.830l-.060.060a1.650 1.650 0 0 0 1.170 2.800H21a2 2 0 1 1 0 4h-.090a1.650 1.650 0 0 0-1.510 1z"/>',
  panel: '<rect x="3.500" y="4.500" width="17" height="15" rx="2"/><path d="M15 4.500v15"/>',
  expand: '<path d="M4.500 9V4.500H9M15 4.500h4.500V9M19.500 15v4.500H15M9 19.500H4.500V15"/>',
  collapse: '<path d="M9 4.500V9H4.500M19.500 9H15V4.500M15 19.500V15h4.500M4.500 15H9v4.500"/>',
  pr: '<circle cx="6.500" cy="5.500" r="2"/><circle cx="6.500" cy="18.500" r="2"/><circle cx="17.500" cy="18.500" r="2"/><path d="M6.500 7.500v9M12 5.500h3.500a2 2 0 012 2v9"/><path d="M14 3l-2.500 2.500L14 8"/>',
  fit: '<rect x="6" y="7" width="12" height="10" rx="1"/><path d="M3 9V4h5M21 15v5h-5"/>',
  swap: '<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  cloud: '<path d="M7 18a4 4 0 01-.5-8 5.500 5.500 0 0110.700-1A4.500 4.500 0 0117 18z"/>',
  hint: '<circle cx="12" cy="12" r="8.500"/><path d="M12 8v5M12 16v.2"/>',
  link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1"/>',
  stats: '<path d="M5 19v-7M10 19V6M15 19v-5M20 19V9"/>',
  orchestrate: '<path d="M7.6 12.2C6.5 11 6.1 9.4 6.4 7.9C6.8 5.3 9.1 3.5 12 3.5C14.9 3.5 17.2 5.3 17.6 7.9C17.9 9.4 17.5 11 16.4 12.2"/><path d="M7.6 12.2C6.5 14.5 4.4 16.1 3.3 14.4C2.9 13.7 3.1 12.8 3.8 12.5"/><path d="M16.4 12.2C17.5 14.5 19.6 16.1 20.7 14.4C21.1 13.7 20.9 12.8 20.2 12.5"/><path d="M10.2 12.8C10 16.3 8.8 19.6 6.8 19.8C5.9 19.9 5.3 19.3 5.4 18.5"/><path d="M13.8 12.8C14 16.3 15.2 19.6 17.2 19.8C18.1 19.9 18.7 19.3 18.6 18.5"/><circle cx="9.8" cy="9" r="1.05" fill="currentColor" stroke="none"/><circle cx="14.2" cy="9" r="1.05" fill="currentColor" stroke="none"/>',
  thumbUp: '<path d="M7 11v9H4a1 1 0 01-1-1v-7a1 1 0 011-1h3zm0 0l3.1-6.5a1.5 1.5 0 012.9.6V9h4.5a1.8 1.8 0 011.8 2.1l-1 6.8a2 2 0 01-2 1.7H7"/>',
  thumbDown: '<path d="M7 13V4H4a1 1 0 00-1 1v7a1 1 0 001 1h3zm0 0l3.1 6.5a1.5 1.5 0 002.9-.6V15h4.5a1.8 1.8 0 001.8-2.1l-1-6.8a2 2 0 00-2-1.7H7"/>',
  // Deep-sea project navigation (top bar and More menu), chosen by the owner in make-designs-for-these-icons Work 5,
  // then tuned into one theme: same 4–20 frame on a y=19.5 base line, one hollow r=1.3 bubble, one shared wave, no filled dots.
  // The plain icons above (home, note, files, stats, memory, archive, trash) stay for every other use.
  navHome: '<path d="M4 19.5h16"/><path d="M5.5 19.5V13a6.5 6.5 0 0 1 13 0v6.5"/><path d="M10 19.5V15.5a2 2 0 0 1 4 0v4"/><circle cx="18.7" cy="5.3" r="1.3"/>',
  navTopics: '<circle cx="11.4" cy="12.6" r="7"/><path d="M14.4 9.6l-1.85 4.15-4.15 1.85 1.85-4.15z"/><circle cx="18.7" cy="5.3" r="1.3"/>',
  navCanvases: '<rect x="4" y="4.5" width="16" height="15" rx="3"/><path d="M7.8 14.6c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0"/><circle cx="9.2" cy="9.2" r="1.3"/>',
  navStats: '<path d="M5.5 19.5v-5.3M10 19.5v-10.2M14.5 19.5v-7M19 19.5v-8.9"/><circle cx="5.5" cy="11.6" r="1.3"/><circle cx="10" cy="6.0" r="1.3"/><circle cx="14.5" cy="9.2" r="1.3"/><circle cx="19" cy="7.3" r="1.3"/>',
  navMemory: '<path d="M5.5 11.4a6.5 6.5 0 0 1 13 0c0 1.4-1.2 2.1-2.6 2.1H8.1c-1.4 0-2.6-.7-2.6-2.1z"/><path d="M8.5 13.6c-.6 2 .6 3.6 0 5.9M12 13.6c-.6 2 .6 3.6 0 5.9M15.5 13.6c-.6 2 .6 3.6 0 5.9"/>',
  navVault: '<path d="M4 10.5C4 7 6.8 5 12 5s8 2 8 5.5v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17z"/><path d="M4 11.5h6M14 11.5h6"/><rect x="10" y="9.7" width="4" height="4" rx="1.3"/>',
  navArchive: '<circle cx="12" cy="5.8" r="1.3"/><path d="M12 7.1v12.4M8.4 10.6h7.2"/><path d="M5.6 14.4a6.4 6.4 0 0 0 12.8 0"/>',
  navDeleted: '<path d="M4.5 7.5h15"/><path d="M6.2 7.5c0 6 1.2 12 3.6 12h4.4c2.4 0 3.6-6 3.6-12"/><path d="M9.5 7.5V5.8c0-1 .9-1.3 2.5-1.3s2.5.3 2.5 1.3v1.7"/><path d="M7.8 13c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0"/>',
  // Deep-sea utility & Settings icons (top bar right, Settings sidebar),
  // chosen by the owner in make-designs-for-these-icons Work 7 on the same unified frame and motifs.
  // Project/rail Settings buttons keep the original gear icon; Canvas and Archived tabs reuse navCanvases and navArchive above.
  navSearch: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="M15.6 15.6l3.9 3.9"/><path d="M7.2 10.8a3.6 3.6 0 0 1 3.6-3.6"/>',
  navShare: '<path d="M12 14.6V5.5M8.4 9.1L12 5.5l3.6 3.6"/><path d="M3.6 18.4c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0 2.8-1.1 4.2 0 2.8 1.1 4.2 0"/>',
  setAgents: '<circle cx="10.2" cy="9.8" r="3"/><path d="M4.8 19.5c.4-3.4 2.6-5.3 5.4-5.3s5 1.9 5.4 5.3"/><path d="M16 7a2.9 2.9 0 0 1 0 5.6M17.4 14.5c1.5.8 2.4 2.6 2.6 5"/><circle cx="5.3" cy="5.3" r="1.3"/>',
  setCanvasAi: '<path d="M11 5.5c.6 4 2.5 6.4 6.5 7-4 .6-5.9 3-6.5 7-.6-4-2.5-6.4-6.5-7 4-.6 5.9-3 6.5-7z"/><circle cx="18.7" cy="5.3" r="1.3"/>',
  setMcp: '<rect x="4" y="7.5" width="6" height="9" rx="2.5"/><rect x="14" y="7.5" width="6" height="9" rx="2.5"/><path d="M10 12h4"/><circle cx="12" cy="5.3" r="1.3"/>',
  setProviders: '<circle cx="8.5" cy="15" r="4.3"/><circle cx="8.5" cy="15" r="1.3"/><path d="M11.54 11.96L19 4.5M16.6 6.9l1.9 1.9M14.4 9.1l1.5 1.5"/>',
  setLocalProviders: '<polyline points="4.5 16.5 10 11.5 4.5 6.5"/><path d="M11.5 17.5h8"/><circle cx="18.2" cy="6.2" r="1.3"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  setGeneral: '<path d="M4 6.5h9.2M15.8 6.5H20M4 12h3.2M9.8 12H20M4 17.5h10.2M16.8 17.5H20"/><circle cx="14.5" cy="6.5" r="1.3"/><circle cx="8.5" cy="12" r="1.3"/><circle cx="15.5" cy="17.5" r="1.3"/>',
  // Deep-sea live activity icons (live.js), matching the Tidecraft Monoline deep-sea set above.
  liveFiles: '<path d="M12 7.6c-2-1.3-4.6-1.7-7.5-1.2v12.1c2.9-.5 5.5-.1 7.5 1.2 2-1.3 4.6-1.7 7.5-1.2V6.4c-2.9-.5-5.5-.1-7.5 1.2zM12 7.6v12.1"/><circle cx="18.6" cy="4.8" r="1.3"/>',
  liveEdit: '<path d="M4.5 19.5l1-3.8L15.6 5.6a2 2 0 0 1 2.8 2.8L8.3 18.5z"/><path d="M13.6 7.6l2.8 2.8M11.6 19.4c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0"/><circle cx="6.2" cy="6.2" r="1.3"/>',
  liveTests: '<path d="M19.5 12a7.5 7.5 0 1 1-2.8-5.9"/><path d="M8.6 12.2l2.4 2.4 5.3-5.4"/><circle cx="18.7" cy="5.3" r="1.3"/>',
  liveBrowser: '<path d="M3 12s3.5-5.6 9-5.6S21 12 21 12s-3.5 5.6-9 5.6S3 12 3 12z"/><circle cx="12" cy="12" r="2.7"/><circle cx="18.7" cy="5.3" r="1.3"/>',
  liveWeb: '<circle cx="12" cy="12" r="7.5"/><ellipse cx="12" cy="12" rx="3.2" ry="7.5"/><path d="M4.8 12.2c2.4-1.2 4.8-1.2 7.2 0s4.8 1.2 7.2 0"/>',
  liveGit: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="7.5" r="2"/><path d="M7 8v8M17 9.5c0 4.2-4.2 3.2-10 6.5"/><circle cx="17.5" cy="16.5" r="1.3"/>',
};
function ic(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Filled from the server: the agents on this computer, plus You. Any other name found in a Topic still gets an avatar.
const AGENTS = { you:{ id:'you', name:'You', mono:'You', color:'#7a8190', role:'' } };
function agentInfo(id) {
  if (AGENTS[id]) return AGENTS[id];
  const name = String(id || 'Agent');
  return { id, name:name[0].toUpperCase() + name.slice(1), mono:name.slice(0, 2).replace(/^./, c => c.toUpperCase()), color:'#5b6472', role:'' };
}
function av(id, size = 24) {
  const a = agentInfo(id);
  return `<span class="av" style="--av:${esc(a.color)};--s:${size}px" title="${esc(a.name)}">${esc(a.mono)}</span>`;
}

// A pen stroke with real weight: thin when fast, thick when slow, tapered at both ends. A live stroke keeps its end full until the pen lifts.
function strokePath(pts, size = 3, live = false) {
  if (!pts || !pts.length) return '';
  if (pts.length < 3) {
    const [x, y] = pts[0], r = size * .55;
    return `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z`;
  }
  const n = pts.length, L = [], R = [];
  let w = size * .5;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const speed = clamp(len / 26, 0, 1), press = pts[i][2];
    const target = size * .5 * (press != null ? .55 + press * .9 : 1.2 - speed * .42);
    w += (target - w) * .35;
    const head = Math.min(1, (i + 1) / 5), tail = live ? 1 : Math.min(1, (n - i) / 7);
    const r = Math.max(.35, w * Math.min(head, tail) * (.45 + .55 * Math.min(head, tail)));
    L.push([pts[i][0] - dy * r, pts[i][1] + dx * r]);
    R.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
  }
  const outline = L.concat(R.reverse());
  let d = `M${outline[0][0].toFixed(1)},${outline[0][1].toFixed(1)}`;
  for (let i = 1; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length];
    d += `Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)},${((p[1] + q[1]) / 2).toFixed(1)}`;
  }
  return d + 'Z';
}
// The two short strokes that turn a line into an arrow, drawn in the same hand.
function arrowHeadPath(pts, size = 3, len = 15) {
  if (pts.length < 2) return '';
  const end = pts[pts.length - 1];
  let k = pts.length - 2;
  while (k > 0 && Math.hypot(end[0] - pts[k][0], end[1] - pts[k][1]) < 16) k--;
  const ang = Math.atan2(end[1] - pts[k][1], end[0] - pts[k][0]);
  const wing = s => {
    const a = ang + Math.PI + s * .5;
    const out = [];
    for (let t = 0; t <= 1.001; t += .2) out.push([end[0] + Math.cos(a) * len * t, end[1] + Math.sin(a) * len * t]);
    return strokePath(out, size);
  };
  return wing(1) + wing(-1);
}
// Seed drawings: turn a few control points into a believable hand-drawn stroke.
function handDrawn(control, seed = 7, wobble = 1.2) {
  let s = seed * 2654435761 % 4294967296;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - .5; };
  const pts = [];
  for (let i = 0; i < control.length - 1; i++) {
    const p0 = control[Math.max(0, i - 1)], p1 = control[i], p2 = control[i + 1], p3 = control[Math.min(control.length - 1, i + 2)];
    const steps = Math.max(4, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 7));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      const f = k => .5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
      pts.push([f(0) + rnd() * wobble, f(1) + rnd() * wobble]);
    }
  }
  pts.push(control[control.length - 1].slice());
  return pts;
}
const loop = (cx, cy, rx, ry, seed = 3) => {
  const c = [];
  for (let a = -2.2; a <= 4.5; a += .55) c.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  return handDrawn(c, seed, 1.4);
};

// What a dialog held goes with it, so nothing of it lingers in the page.
function closeLightbox() { const b = $('#lightbox'); if (b) { b.hidden = true; b.innerHTML = ''; b.dispatchEvent(new Event('penecho-lightbox-closed')); } }

let toastTimer = 0;
function toast(msg, action) {
  const el = $('#toast');
  if (!el) return;
  const tr = typeof linesT === 'function' ? linesT : v => v;
  el.innerHTML = `<span>${esc(tr(msg))}</span>${action ? `<button type="button" class="link" id="toastAct">${esc(tr(action.label))}</button>` : ''}`;
  el.hidden = false; el.classList.remove('leaving');
  // Above the box at the foot of the page, however tall it has grown.
  const dock = pageRect($('.dock-wrap')), vp = pageViewport();
  el.style.bottom = dock?.height && dock.top < vp.height ? `${Math.max(112, Math.round(vp.height - dock.top + 12))}px` : '';
  if (action) $('#toastAct').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3600);
}
// Small anchored menu used by every "more" control.
// Web page zoom (html { zoom }) scales getBoundingClientRect() and pointer coordinates,
// while CSS left/top/sizes, scroll offsets and offsetWidth/Height stay in layout pixels.
function pageZoomScale() {
  if (typeof window !== 'undefined' && typeof window.PenEchoPageScale?.layoutScale === 'function') return window.PenEchoPageScale.layoutScale();
  const raw = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement)?.zoom : '';
  const str = String(raw || '').trim();
  const value = str.endsWith('%') ? parseFloat(str) / 100 : parseFloat(str);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
function pageViewport() {
  const z = pageZoomScale();
  return { width:innerWidth / z, height:innerHeight / z, scale:z };
}
function pageRect(el) {
  const r = el?.getBoundingClientRect?.();
  if (!r) return null;
  const z = pageZoomScale();
  return z === 1
    ? { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }
    : { left:r.left / z, top:r.top / z, right:r.right / z, bottom:r.bottom / z, width:r.width / z, height:r.height / z };
}
function pagePoint(x, y) {
  const z = pageZoomScale();
  return { x:x / z, y:y / z };
}
let menuGeneration = 0, menuCleanup = null, menuAnchor = null, menuAlign = 'left', menuResolveAnchor = null;
function currentMenuAnchor() {
  if (menuResolveAnchor) menuAnchor = menuResolveAnchor();
  return menuAnchor;
}
// A menu that is loading is dismissible too. Closing or opening another menu cancels its response.
function beginMenuRequest(anchor) {
  closeMenu();
  menuAnchor = anchor;
  const generation = menuGeneration;
  document.addEventListener('pointerdown', menuOutside);
  document.addEventListener('keydown', menuEscape, true);
  return () => generation === menuGeneration;
}
function menuAnchorRect(anchor) {
  if (!anchor?.isConnected || !anchor.getClientRects().length) return null;
  const r = pageRect(anchor), vp = pageViewport();
  return r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vp.height && r.left < vp.width ? r : null;
}
// Re-measure after a caller adds a note, as the Run menu does for Cloud credits.
function placeMenu(m = $('#menu'), anchor = currentMenuAnchor(), align = menuAlign, point = null) {
  if (!m) return;
  const rect = menuAnchorRect(anchor); if (!rect) { closeMenu(); return; }
  const vp = pageViewport(), pt = point ? pagePoint(point.x, point.y) : null;
  const r = pt ? { left:pt.x, right:pt.x, top:pt.y, bottom:pt.y } : rect;
  // Fixed auto-width menus shrink to the space left at their previous position.
  // Measure at the viewport edge first so final width, wrapping and height agree.
  m.style.left = '8px';
  m.style.maxHeight = `${Math.max(0, vp.height - 16)}px`;
  const mr = pageRect(m), below = Math.max(0, vp.height - r.bottom - 14), above = Math.max(0, r.top - 14);
  const down = mr.height <= below || below >= above, space = down ? below : above;
  m.style.maxHeight = `${space}px`;
  const height = pageRect(m).height;
  m.style.left = clamp(align === 'right' ? r.right - mr.width : r.left, 8, Math.max(8, vp.width - mr.width - 8)) + 'px';
  m.style.top = clamp(down ? r.bottom + 6 : r.top - height - 6, 8, Math.max(8, vp.height - height - 8)) + 'px';
}
function openMenu(anchor, items, { align = 'left', className = '', resolveAnchor = null, point = null } = {}) {
  closeMenu();
  if (resolveAnchor) anchor = resolveAnchor();
  const r = menuAnchorRect(anchor); if (!r) return;
  const m = document.createElement('div');
  m.className = `menu ${className}`.trim(); m.id = 'menu'; m.setAttribute('role', 'menu');
  const rows = [];
  function renderItems(items) {
    const visible = typeof hostedMenu === 'function' ? hostedMenu(items) : items;
    const tr = typeof linesT === 'function' ? linesT : v => v;
    return visible.map(it => {
      if (it.group) {
        const contents = renderItems(it.items);
        const groupLabel = tr(it.group);
        return contents ? `<div role="group" aria-label="${esc(groupLabel)}"><div class="menu-head" aria-hidden="true">${esc(groupLabel)}</div>${contents}</div>` : '';
      }
      const i = rows.push(it) - 1;
      if (it.sep) return '<hr>';
      if (it.head) return `<div class="menu-head">${esc(tr(it.head))}</div>`;
      const state = typeof it.checked === 'boolean' ? `role="menuitemradio" aria-checked="${it.checked}"` : 'role="menuitem"';
      return `<button type="button" ${state} data-i="${i}" class="${it.on ? 'on' : ''} ${it.note ? 'has-note' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 16) : ''}${it.glyph ? `<b class="menu-glyph" aria-hidden="true">${esc(it.glyph)}</b>` : ''}${it.av ? av(it.av, 20) : ''}<span>${esc(tr(it.label))}${it.note ? `<small>${esc(tr(it.note))}</small>` : ''}</span>${it.key ? `<kbd class="menu-key">${esc(it.key)}</kbd>` : ''}${it.on ? ic('check', 15) : ''}</button>`;
    }).join('');
  }
  m.innerHTML = renderItems(items);
  document.body.append(m);
  placeMenu(m, anchor, align, point);
  menuAnchor = anchor; menuAlign = align; menuResolveAnchor = resolveAnchor;
  const expanded = anchor.hasAttribute('aria-expanded') ? anchor : null;
  expanded?.setAttribute('aria-expanded', 'true');
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const current = currentMenuAnchor();
    if (b.disabled || !menuAnchorRect(current)) { closeMenu(); return; }
    closeMenu(); current.focus({ preventScroll:true }); rows[+b.dataset.i].fn?.();
  });
  m.querySelector('button:not([disabled])')?.focus({ preventScroll:true });
  m.addEventListener('keydown', e => {
    const list = $$('button:not([disabled])', m), i = list.indexOf(document.activeElement);
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
  });
  // Image decoding and browser scroll anchoring can move the button without
  // a DOM mutation. Follow its geometry without replacing the focused menu.
  let lastRect = r, frame;
  const moved = () => {
    anchor = currentMenuAnchor();
    const next = menuAnchorRect(anchor);
    if (!next) { closeMenu(); return; }
    if (['left', 'top', 'width', 'height'].some(k => Math.abs(next[k] - lastRect[k]) > .5)) {
      lastRect = next;
      placeMenu(m, anchor, align, point);
    }
    frame = requestAnimationFrame(moved);
  };
  frame = requestAnimationFrame(moved);
  document.addEventListener('pointerdown', menuOutside);
  document.addEventListener('keydown', menuEscape, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('penecho:page-scale-change', closeMenu);
  menuCleanup = () => { expanded?.setAttribute('aria-expanded', 'false'); cancelAnimationFrame(frame); window.removeEventListener('resize', closeMenu); window.removeEventListener('penecho:page-scale-change', closeMenu); };
}
function menuOutside(e) { if (!e.target.closest('#menu') && !currentMenuAnchor()?.contains(e.target)) closeMenu(); }
function menuEscape(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  const anchor = currentMenuAnchor(); closeMenu();
  if (menuAnchorRect(anchor)) anchor.focus({ preventScroll:true });
}
function closeMenu() {
  ++menuGeneration;
  menuCleanup?.(); menuCleanup = null; menuAnchor = null; menuResolveAnchor = null;
  $('#menu')?.remove();
  document.removeEventListener('pointerdown', menuOutside);
  document.removeEventListener('keydown', menuEscape, true);
}

// Zoom between levels, as projects-v1 did: a page grows out of what you clicked and shrinks back into it.
// Only transform and opacity move, so the zoom runs on the compositor and stays smooth while the page below is still busy (PE-586).
// `zoomEnds` is when it is over: work that would draw the page again waits until then.
let zoomEnds = 0;
function zoomIn(page, rect) {
  if (!page || !rect || reducedMotion() || !page.animate) return;
  const b = pageRect(page);
  zoomEnds = performance.now() + 360;
  page.animate([
    { transformOrigin: '0 0', transform: `translate(${rect.left - b.left}px,${rect.top - b.top}px) scale(${Math.max(.02, rect.width / b.width)},${Math.max(.02, rect.height / b.height)})`, opacity: .15 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
  ], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function zoomOutClone(rectFrom, node, rectTo) {
  if (!node || !rectTo || reducedMotion() || !node.animate) return;
  const c = node.cloneNode(true);
  c.classList.add('zoom-clone');
  c.style.cssText = `position:fixed;left:${rectFrom.left}px;top:${rectFrom.top}px;width:${rectFrom.width}px;height:${rectFrom.height}px;z-index:90;pointer-events:none;overflow:hidden;background:var(--bg)`;
  document.body.append(c);
  const a = c.animate([
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
    { transformOrigin: '0 0', transform: `translate(${rectTo.left - rectFrom.left}px,${rectTo.top - rectFrom.top}px) scale(${Math.max(.02, rectTo.width / rectFrom.width)},${Math.max(.02, rectTo.height / rectFrom.height)})`, opacity: .05 },
  ], { duration: 280, easing: 'cubic-bezier(.3,.7,.2,1)' });
  a.onfinish = () => c.remove();
}
