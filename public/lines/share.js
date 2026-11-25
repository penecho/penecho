// Share a project: a link anyone can open in a browser, without an account, to read it and add notes (never run or delete). A shared project is also kept in your
// PenEcho Cloud space, where it follows the folder. Free: the link works 7 days; Plus keeps links open until you stop sharing.
// The account row, signing in and Keep in Cloud are in cloud.js.
const shareDate = ms => new Date(ms).toLocaleDateString(undefined, { month:'short', day:'numeric' });
const shareMb = bytes => `${Math.max(1, Math.round(bytes / 1048576))} MB`;
const SHARE_LEAD = `<p>People with the link can read this project and add notes or new lines, with their name. They can't run agents or delete anything, and they don't need an account.</p>`;

// ---------- Share dialog ----------
function shareProgressHTML(p) {
  if (!p) return `<p class="share-busy">Getting the files ready…</p>`;
  if (p.phase !== 'uploading') return `<p class="share-busy">Reading the project's files…</p>`;
  const pct = p.totalBytes ? Math.round(p.bytes / p.totalBytes * 100) : Math.round(p.done / Math.max(1, p.total) * 100);
  return `<p class="share-busy">Uploading ${p.done.toLocaleString()} of ${p.total.toLocaleString()} files · ${shareMb(p.bytes)} of ${shareMb(p.totalBytes)}</p><div class="share-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;
}
function shareBodyHTML(c, syncDays = '30') {
  if (!c.signedIn) return SHARE_LEAD;
  const share = c.remote?.share;
  const hosted = typeof HOSTED !== 'undefined' && Boolean(HOSTED);
  const firstSync = !hosted && !share && !c.sync && (typeof cloudHasRemote === 'function' ? !cloudHasRemote(c) : !c.remote);
  const range = firstSync && typeof cloudSyncRangeHTML === 'function'
    ? `<div class="share-range"><div class="share-range-head"><strong>First sync history</strong>${cloudSyncRangeHTML(syncDays, { act:'', attr:'data-share-days' })}</div><p class="share-range-note">Only applies to the first upload. Synced work stays in Cloud as days grow.</p></div>`
    : '';
  const limit = c.plus ? '' : `<p class="share-until">On a free account the link works 7 days and Cloud keeps up to ${shareMb(c.maxBytes)}. <a href="${esc(`${c.origin}/dashboard.html#billing`)}" target="_blank" rel="noopener">Plus</a> keeps links open.</p>`;
  if (!share) return `${SHARE_LEAD}${range}${limit}`;
  if (share.ended) return `<p class="share-ended">This link has ended.</p>`;
  const until = share.expiresAt
    ? `<p class="share-until">Link works until ${esc(shareDate(share.expiresAt))} · <a href="${esc(`${c.origin}/dashboard.html#billing`)}" target="_blank" rel="noopener">Keep it with Plus</a></p>`
    : `<p class="share-until">Stays open until you stop sharing.</p>`;
  return `<div class="share-link"><input readonly value="${esc(c.link)}" aria-label="Link" data-share-link><button type="button" class="btn" data-share-copy>${ic('copy', 15)}Copy</button></div>${until}`;
}
function shareFooterHTML(c) {
  const share = c.remote?.share;
  if (!c.signedIn) return `<button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-share-signin>Sign in to share</button>`;
  if (!share) return `<button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-share-create>${ic('link', 15)}Create link</button>`;
  return `<button type="button" class="btn share-stop" data-share-stop>Stop sharing</button>${share.ended ? `<button type="button" class="btn primary" data-share-create>Share again</button>` : `<button type="button" class="btn primary" data-cancel>Done</button>`}`;
}

ACT['project-share'] = async el => {
  const p = project(), base = `${pathFor(p.id)}`, dialog = document.createElement('dialog');
  let state = null, watch = null, syncDays = '30';
  dialog.className = 'line-command-dialog share-dialog';
  dialog.setAttribute('aria-labelledby', 'shareTitle');
  dialog.innerHTML = `<h2 id="shareTitle">Share ${esc(p.name)}</h2><div class="share-body"><p class="share-busy">Checking PenEcho Cloud…</p></div><p class="command-error" role="alert" hidden></p><footer></footer>`;
  document.body.append(dialog);
  const stopWatch = () => { clearTimeout(watch); watch = null; };
  dialog.addEventListener('close', () => { stopWatch(); dialog.remove(); if (el?.isConnected) el.focus(); });
  const fail = error => { const box = $('.command-error', dialog); box.hidden = !error; box.textContent = error?.message || ''; };
  const draw = next => {
    state = next;
    // Sharing keeps the project in Cloud, so the Keep in Cloud button follows what the dialog learns.
    if (typeof keepSeen === 'function') keepSeen(p, state);
    const active = dialog.contains(document.activeElement) ? document.activeElement : null;
    const focusDays = active?.matches?.('[data-share-days]') ? active.dataset.days : '';
    $('.share-body', dialog).innerHTML = shareBodyHTML(state, syncDays);
    $('footer', dialog).innerHTML = shareFooterHTML(state);
    if (focusDays) $(`[data-share-days][data-days="${focusDays}"]`, dialog)?.focus();
    fail(state.signedIn && state.error && !state.remote?.rev && !state.link ? new Error(state.error) : null);
  };
  // Only the first publication needs upload progress here. A sync running elsewhere
  // must leave Create link and Copy available for the published Cloud revision.
  const run = async (button, job) => {
    fail(null);
    $$('button', dialog).forEach(b => { b.disabled = true; });
    button.setAttribute('aria-busy', 'true');
    let pending = true;
    const progress = async () => {
      try {
        const now = await api(`${base}/cloud`);
        if (pending && dialog.open && now.progress) {
          $('.share-body', dialog).innerHTML = shareProgressHTML(now.progress);
          $('footer', dialog).innerHTML = '<button type="button" class="btn" data-cancel>Close</button>';
        }
      } catch { /* The share request reports its own error. */ }
      if (pending && dialog.open) watch = setTimeout(progress, 1000);
    };
    if (button.matches('[data-share-create]') && !state.remote?.rev) watch = setTimeout(progress, 700);
    try { draw(await job()); } catch (error) { draw(state); fail(error); }
    finally { pending = false; stopWatch(); }
  };
  dialog.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-share-days]')) {
      syncDays = typeof normalizeSyncDays === 'function' ? normalizeSyncDays(t.dataset.days) : t.dataset.days;
      $$('[data-share-days]', dialog).forEach(b => {
        const checked = b.dataset.days === syncDays;
        b.setAttribute('aria-checked', String(checked));
        b.setAttribute('tabindex', checked ? '0' : '-1');
      });
      return;
    }
    if (t.matches('[data-cancel]')) return dialog.close();
    if (t.matches('[data-share-copy]')) return copyText(state.link, 'Link copied');
    if (t.matches('[data-share-create]')) return run(t, async () => {
      const hosted = typeof HOSTED !== 'undefined' && Boolean(HOSTED);
      const firstSync = !hosted && !state?.sync && (typeof cloudHasRemote === 'function' ? !cloudHasRemote(state) : !state?.remote);
      const body = firstSync ? { syncDays:typeof syncDaysPayload === 'function' ? syncDaysPayload(syncDays) : (syncDays === 'all' ? 'all' : Number(syncDays)) } : undefined;
      const next = await api(`${base}/share`, { method:'POST', ...(body ? { body } : {}) });
      if (next.link) copyText(next.link, 'Link copied');
      return next;
    });
    if (t.matches('[data-share-stop]')) return run(t, () => api(`${base}/share`, { method:'DELETE' }));
    if (t.matches('[data-share-signin]')) {
      $('.share-body', dialog).innerHTML = `<p class="share-busy">Finish signing in in your browser. This updates by itself.</p>`;
      cloudSignIn(async ok => { if (ok && dialog.open) draw(await api(`${base}/cloud`)); }).catch(fail);
    }
  });
  dialog.showModal();
  try { draw(await api(`${base}/cloud`)); }
  catch (error) { $('.share-body', dialog).innerHTML = ''; $('footer', dialog).innerHTML = `<button type="button" class="btn" data-cancel>Close</button>`; fail(error.status === 404 && !error.code ? new Error('Restart PenEcho to share projects.') : error); }
};
