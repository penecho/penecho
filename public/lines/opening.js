"use strict";
// PenEcho's opening, two seconds each time PenEcho opens: a stroke becomes a Canvas, the Canvas starts a line, Claude designs,
// Codex builds and Opus reviews on it, then the camera pulls back to many lines with many agents on a timeline, as Home shows them.
// Desktop starts the clock when the native window is shown. In a browser it plays once per server boot, per tab. The Projects
// page plays it itself in a browser; the Canvas page starts it when it was opened by itself (project-lines-cover.js), and when that page goes on to
// the Projects page, the opening carries on there from where it was. A click, a key or the wheel ends it at once.
// The Canvas page goes on only once the film has stopped moving (settled), so the change of page never stalls a moving frame;
// the page it went to holds the last frame until it has drawn itself (ready), then the film fades (PE-586).
(() => {
  const RUN = 'penecho-opening-run', SEEN = 'penecho-opening-seen', DESKTOP_SEEN = 'penecho-desktop-opening-seen',
    LENGTH = 2000, HOLD = 260, FADE = 340, WAIT_PAGE = 1200;
  const kept = {
    get:key => { try { return sessionStorage.getItem(key); } catch { return null; } },
    set:(key, value) => { try { sessionStorage.setItem(key, value); } catch { /* It then plays again next time. */ } },
    drop:key => { try { sessionStorage.removeItem(key); } catch { /* Nothing was kept. */ } },
  };
  const boot = () => (document.cookie.match(/(?:^|;\s*)penecho-boot=([^;]+)/) || [])[1] || 'played';
  const query = new URLSearchParams(location.search);
  const desktopLaunch = window.penechoDesktop?.whenStartupVisible ? query.get('desktopLaunch') || '' : '';

  // Not in a frame, not on penecho.ai, not for someone who asked for less motion, and not twice for one PenEcho run.
  // A browser driven by a test sees the page at once; ?opening=1 asks for it anyway.
  function wanted() {
    if (query.get('opening') === '1') return true;
    if (window.top !== window || query.has('embed') || query.has('hosted')) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.webdriver) return false;
    return desktopLaunch ? kept.get(DESKTOP_SEEN) !== desktopLaunch : kept.get(SEEN) !== boot();
  }

  // ---------- The picture ----------
  // Each line: its name, when it draws (1 to 5), where it starts and how long it is, then its nodes: a kind and where it sits.
  // Faces are agents (cl Claude, cx Codex, op Opus, oc OpenCode, ds dsh, ag Antigravity, pn PenEcho); the rest are an Ask,
  // a Note, a Canvas, a Work, a review, a meeting and the end of a line.
  const FACES = { cl:'Cl', cx:'Cx', op:'Op', oc:'Oc', ds:'Ds', ag:'Ag', pn:'Pe' };
  const DAYS = [
    [
      ['Header redesign', 2, 150, 300, 'cv 150, ask 200, cl 290, ask 380, cl* 450'],
      ['Sign in with Google', 1, 60, 340, 'ask 60, ag 150, ask 240, cx 330, rv 400'],
      null,
      ['Search', 1, 110, 350, 'note 110, ask 170, oc 260, wk 330, oc 400, rv 460'],
      ['Dark mode', 2, 40, 370, 'ask 40, ds 120, cv 200, ask 260, ds 340, end 410'],
    ],
    [
      ['Merge flow', 3, 90, 400, 'ask 90, cx 180, ask 270, cx 350, op 430, end 490'],
      ['Settings', 4, 50, 400, 'cv 50, ask 110, cl 210, ask 300, cl 390, rv 450'],
      ['Share links', 4, 160, 300, 'ask 160, pn 250, mt 320, cx 400, end 460'],
      ['Offline mode', 5, 30, 270, 'ask 30, oc 130, ag 230, end 300'],
      ['Release notes', 5, 220, 250, 'ask 220, cl 310, cx 400, end 470'],
    ],
    [
      ['Example projects', 5, 100, 340, 'ask 100, ds 200, ask 290, ds 370, end 440'],
    ],
  ];
  const at = (x, w) => ` data-l="${x}"${w == null ? '' : ` data-w="${w}"`}`;
  function node(kind, x, anim) {
    const run = kind.endsWith('*'), k = run ? kind.slice(0, -1) : kind;
    return FACES[k] ? `<span class="po-k po-face po-${k} po-a ${anim}"${at(x)}>${FACES[k]}${run ? '<i class="po-ring"></i>' : ''}</span>`
      : `<span class="po-k po-${k === 'rv' ? 'rv' : k} po-a ${anim}"${at(x)}></span>`;
  }
  const row = (title, wave, x, w, nodes) => `<div class="po-row"><i class="po-elb po-a po-lg${wave}"></i><div class="po-ti po-a po-tx">${title}</div><div class="po-trk"><i class="po-ln po-a po-lg${wave}"${at(x, w)}></i>${nodes.split(', ').map(n => n.split(' ')).map(([k, nx]) => node(k, +nx, `po-pg${wave}`)).join('')}</div></div>`;
  // The first line, the one the opening builds: a Canvas, Claude, Codex, Opus, done.
  const hero = `<div class="po-row"><i class="po-elb po-a po-lg1"></i><div class="po-ti po-a po-tx">Homepage</div><div class="po-trk"><i class="po-ln po-a po-lhero"${at(110, 360)}></i>${node('cv', 110, 'po-pCv')}${node('cl', 210, 'po-pCl')}${node('cx', 310, 'po-pCx')}${node('op', 410, 'po-pOp')}${node('end', 470, 'po-pEnd')}</div></div>`;
  function dayName(back) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const short = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }).replace(',', '');
    return back === 0 ? `Today <em>${short}</em>` : back === 1 ? `Yesterday <em>${short}</em>` : `${d.toLocaleDateString('en-GB', { weekday:'long' })} <em>${d.toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</em>`;
  }
  const clock = `<div class="po-clk">${[['09:00', 30], ['12:00', 200], ['15:00', 370], ['18:00', 540]].map(([t, x]) => `<span${at(x)}>${t}</span>`).join('')}</div>`;
  const pic = (left, cls, body, word, who, low = false) => `<div class="po-st po-a ${cls}"${at(left)}>${body}<div class="po-stem${low ? ' po-long po-a po-c0' : ''}"></div><div class="po-cap${low ? ' po-low po-a po-c0' : ''}"><div class="po-cw">${word}</div><div class="po-cn">${who}</div></div></div>`;
  const stageHTML = () => `<div class="po-stage">
    <div class="po-cam po-a"><section class="po-card"><div class="po-surf po-a po-ch"></div><div class="po-trunk po-a po-tr"></div>
      ${DAYS.map((rows, i) => `<div class="po-day${i ? ' po-next' : ''} po-a po-ch"><div class="po-dw">${dayName(i)}</div>${clock}</div>${rows.map(r => r ? row(...r) : hero).join('')}`).join('')}
    </section></div>
    <div class="po-intro po-a">
      ${pic(140, 'po-st0', `<div class="po-picw"><div class="po-pic po-cvs po-a po-c0"><div class="po-tools"><i class="po-on"></i><i></i><i></i></div></div><div class="po-wipe po-a po-dr"><div class="po-wipe-in po-a po-dr-in"><svg class="po-ink" viewBox="0 0 240 156" aria-hidden="true"><path d="M28 104 C 44 52, 70 44, 82 78 C 92 106, 104 112, 118 84 C 132 54, 150 40, 164 66 C 174 86, 186 98, 212 58"/></svg></div></div></div>`, 'Draw', 'Canvas', true)}
      ${pic(440, 'po-st1', `<div class="po-pic"><div class="po-bar"><i></i><i></i><i></i></div><div class="po-proto"><div class="po-proto-img"><i></i><b></b></div><div class="po-proto-t"><i class="po-h" data-w="100%"></i><i data-w="84%"></i><i data-w="92%"></i><i data-w="60%"></i><i class="po-btn"></i></div></div></div>`, 'Design', 'Claude')}
      ${pic(740, 'po-st2', `<div class="po-pic po-code"><div class="po-bar"><i></i><i></i><i></i></div><div class="po-code-b">${[
        [0, ['po-t', 34], ['', 58], ['po-b', 26]], [16, ['po-v', 22], ['', 70]], [16, ['', 44], ['po-y', 30], ['', 36]], [32, ['po-t', 52], ['', 28]], [16, ['po-b', 40], ['', 22]],
      ].map(([pad, ...bits]) => `<div data-pad="${pad}">${bits.map(([c, w]) => `<i class="${c}" data-w="${w}"></i>`).join('')}</div>`).join('')}<div><i data-w="18"></i><i class="po-caret"></i></div></div></div>`, 'Build', 'Codex')}
      ${pic(1040, 'po-st3', `<div class="po-pic"><div class="po-bar"><i></i><i></i><i></i></div><div class="po-rev"><div class="po-m"><b>−</b><i data-w="120"></i></div><div class="po-p"><b>+</b><i data-w="150"></i></div><div class="po-p"><b>+</b><i data-w="96"></i></div></div><span class="po-badge po-a po-pEnd"></span></div>`, 'Review', 'Opus')}
    </div>
    <div class="po-tbox"><div class="po-ttl po-a"><img src="penecho-mark.png" alt=""><span>PenEcho Lines</span></div></div>
  </div>`;

  // Places are set through the style object, so this works on pages whose rules allow no style attributes (the Canvas page).
  function place(root) {
    const px = v => /%$/.test(v) ? v : `${v}px`;
    for (const el of root.querySelectorAll('[data-l]')) el.style.left = px(el.dataset.l);
    for (const el of root.querySelectorAll('[data-w]')) el.style.width = px(el.dataset.w);
    for (const el of root.querySelectorAll('[data-pad]')) el.style.paddingLeft = px(el.dataset.pad);
  }
  function dark() {
    const mode = document.documentElement.dataset.mode;
    if (mode) return mode === 'dark';
    let chosen = 'system';
    try { chosen = localStorage.getItem('penecho-lines-theme') || 'system'; } catch { /* System it is. */ }
    return chosen === 'dark' || (chosen !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  let shown = null;
  // `from` is how far in it already is, in ms, when it carries on from the page before.
  function play({ from = 0, waitForWindow = false } = {}) {
    if (shown || from >= LENGTH + HOLD + WAIT_PAGE) return false;
    const root = document.createElement('div');
    root.id = 'peOpening';
    root.setAttribute('aria-hidden', 'true');
    if (dark()) root.classList.add('po-dark');
    if (waitForWindow) root.classList.add('po-paused');
    root.innerHTML = stageHTML();
    place(root);
    root.style.setProperty('--at', `${-from}ms`);
    const fit = () => {
      const z = window.PenEchoPageScale?.layoutScale?.() || 1;
      root.style.setProperty('--s', String(Math.min((innerWidth / z) / 1440, (innerHeight / z) / 900)));
    };
    fit();
    addEventListener('resize', fit);
    document.documentElement.append(root);
    shown = root;
    let begun = null, ended = false, timeUp = false, drawn = !waitForWindow && !from, leaving = false;
    let timer = 0, still = 0, cap = 0;
    const stopped = [], elapsed = () => from + (begun === null ? 0 : Date.now() - begun);
    const markSeen = () => {
      kept.set(SEEN, boot());
      if (desktopLaunch) kept.set(DESKTOP_SEEN, desktopLaunch);
    };
    // Holds the last frame until a page has drawn itself, for at most `ms`.
    const waitPage = ms => { drawn = false; clearTimeout(cap); cap = setTimeout(end, ms); };
    const end = () => {
      if (ended) return;
      ended = true;
      if (begun === null) markSeen();
      clearTimeout(timer); clearTimeout(cap); clearTimeout(still);
      stopped.splice(0).forEach(resolve => resolve());
      kept.drop(RUN);
      removeEventListener('resize', fit);
      for (const type of STOP) removeEventListener(type, end, true);
      root.classList.add('po-out');
      setTimeout(() => { root.remove(); if (shown === root) shown = null; }, FADE);
    };
    const rest = Math.max(0, LENGTH + HOLD - from), STOP = ['pointerdown', 'keydown', 'wheel'];
    const waitToLeave = () => waitPage(Math.max(0, LENGTH + HOLD - elapsed()) + 3 * WAIT_PAGE);
    const begin = () => {
      if (ended) return;
      begun = Date.now();
      markSeen();
      kept.set(RUN, String(begun - from));
      root.classList.remove('po-paused');
      timer = setTimeout(() => { timeUp = true; if (drawn) end(); }, rest);
      still = setTimeout(() => stopped.splice(0).forEach(resolve => resolve()), Math.max(0, LENGTH - from));
      if (leaving) waitToLeave();
      else if (!drawn) waitPage(rest + WAIT_PAGE);
    };
    for (const type of STOP) addEventListener(type, end, { capture:true, passive:true });
    root.end = end;
    root.ready = () => { drawn = true; if (timeUp) end(); };
    // The page asking is about to go: the last frame stays until the next page takes the film over.
    root.settled = () => {
      if (ended) return Promise.resolve();
      leaving = true;
      if (begun !== null) waitToLeave();
      return elapsed() >= LENGTH ? Promise.resolve() : new Promise(resolve => stopped.push(resolve));
    };
    if (waitForWindow) {
      // CSS is loaded before the opening script. Paint its first frame in the
      // visible window before starting both clocks.
      window.penechoDesktop.whenStartupVisible().then(visible => {
        if (visible) requestAnimationFrame(() => requestAnimationFrame(begin));
        else end();
      }, end);
    } else begin();
    return true;
  }
  // An opening the page before started, and how far in it is now.
  function carried() {
    const started = Number(kept.get(RUN));
    kept.drop(RUN);
    const from = started ? Date.now() - started : NaN;
    return from >= 0 && from < LENGTH + HOLD + WAIT_PAGE ? from : null;
  }
  // settled: a promise for when nothing moves any more (at once when no film is playing). ready: the page under it has drawn itself.
  window.PenEchoOpening = { play, wanted, desktopLaunch, end:() => shown?.end?.(), settled:() => shown?.settled?.() || Promise.resolve(), ready:() => shown?.ready?.() };
  if (document.currentScript?.dataset.play !== 'self') return;
  const from = carried();
  if (from != null && (!desktopLaunch || from >= LENGTH) && window.top === window && !query.has('embed') && !query.has('hosted')) play({ from });
  else if (wanted()) play({ waitForWindow:Boolean(desktopLaunch) });
})();
