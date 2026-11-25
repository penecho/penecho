// A browser preference, like folded projects. Opening a project never changes its position.
const PROJECT_ORDER_KEY = 'penecho-project-order-v1';
const LINE_ORDER_KEY = 'penecho-rail-line-positions-v1';
let railLinePositions = readLists(LINE_ORDER_KEY);
function readProjectOrders() {
  const saved = readLists(PROJECT_ORDER_KEY), clean = {};
  for (const group of ['pinned', 'recent']) if (Array.isArray(saved[group])) clean[group] = [...new Set(saved[group].filter(id => typeof id === 'string' && id))];
  return clean;
}
let projectOrders = readProjectOrders(), railProjectGesture = null;
function railProjectOrder(group, projects) {
  const saved = projectOrders[group] || [];
  // Cloud/account callbacks can paint the rail before the project list has arrived.
  if (!projects.length) return projects;
  const known = new Map(projects.map(p => [p.id, p])), ranked = new Set(saved), fresh = projects.filter(p => !ranked.has(p.id)).map(p => p.id);
  // Another tab may know about projects this tab has not fetched yet. Keep their ranks dormant;
  // pruning on render would make tabs with different list snapshots overwrite each other's order.
  const ids = [...saved, ...fresh];
  if (fresh.length) { projectOrders[group] = ids; writeLists(PROJECT_ORDER_KEY, projectOrders); }
  return ids.filter(id => known.has(id)).map(id => known.get(id));
}
function moveRailProject(id, target, after = false) {
  const p = summaryOf(id), to = summaryOf(target);
  if (!p || !to || id === target || p.archived || to.archived || p.myCanvases || to.myCanvases || !!p.pinned !== !!to.pinned) return false;
  const group = p.pinned ? 'pinned' : 'recent', shown = railGroups()[group].map(p => p.id);
  if (!shown.includes(id) || !shown.includes(target)) return false;
  const next = shown.filter(x => x !== id); next.splice(next.indexOf(target) + Number(after), 0, id);
  if (next.join('\n') === shown.join('\n')) return false;
  const all = S.projects.filter(p => !p.archived && !p.myCanvases && !!p.pinned === !!to.pinned);
  const ids = railProjectOrder(group, all).map(p => p.id).filter(x => x !== id);
  ids.splice(ids.indexOf(target) + Number(after), 0, id);
  projectOrders[group] = ids;
  writeLists(PROJECT_ORDER_KEY, projectOrders);
  return true;
}
function focusRailProject(id) {
  const unit = $$('.rail-project', $('#railList')).find(el => el.dataset.project === id);
  const control = unit?.querySelector('.rail-row');
  control?.focus({ preventScroll:true });
  control?.scrollIntoView({ block:'nearest' });
}
function announceProjectOrder(id) {
  const p = summaryOf(id); if (!p) return;
  const group = p.pinned ? 'pinned' : 'recent', shown = railGroups()[group];
  toast(`${p.name}: position ${shown.findIndex(p => p.id === id) + 1} of ${shown.length} in ${group === 'pinned' ? 'favourite projects' : 'projects'}.`);
}

// Both kinds of row share pointer capture, scrolling, cancellation and keyboard controls.
function railOrderItem(el, projectOnly = false) {
  const line = !projectOnly && el?.closest?.('#railList .rail-line-item');
  if (line) {
    if (line.closest('[hidden]')) return null;
    const control = line.querySelector('.rail-line'), { p, line:id, railGroup } = control.dataset;
    const unit = line.parentElement.classList.contains('rail-line-unit') ? line.parentElement : line;
    const parent = unit.parentElement.closest('.rail-sub-lines');
    return { line:true, control, unit, header:line, id:railLineKey(p, id), pid:p, group:railGroup === 'pinned' ? 'pins' : 'lines',
      parentId:parent?.dataset.railParent || '', parentTitle:parent?.previousElementSibling.querySelector('.rail-title').textContent || '' };
  }
  const unit = el?.closest?.('#railList .rail-project');
  if (!unit) return null;
  return { line:false, control:unit.querySelector('.rail-row'), unit, header:unit.querySelector('.rail-item'), id:unit.dataset.project, group:unit.dataset.projectGroup };
}
function orderMembers(item, visible = false) {
  if (!item.line) return railGroups()[item.group].map(p => ({ key:p.id }));
  const p = summaryOf(item.pid);
  if (!p || (item.group !== 'pins' && !railIsOpen(p))) return [];
  const pick = railPick(p), roots = item.group === 'pins' ? pick.pinned : pick.shown;
  if (!item.parentId) return item.group === 'pins' || visible ? roots : pick.rest;
  const parent = pick.byId.get(item.parentId);
  for (let f = parent; f; f = f.parent) {
    if (!f.open || (!f.parent && !roots.includes(f))) return [];
  }
  return parent?.children || [];
}
function sameOrderScope(a, b) {
  return a.line === b.line && a.group === b.group && (!a.line || (a.pid === b.pid && a.parentId === b.parentId));
}
function orderSnapshot(rows) {
  const queue = [...rows], keys = [];
  for (const f of queue) {
    keys.push([f.key, f.parent?.key]);
    for (const child of f.children || []) queue.push(child);
  }
  return JSON.stringify(keys);
}
function moveOrderItem(item, target, after) {
  return item.line ? moveRailLine(orderMembers(item), item.id, target, after) : moveRailProject(item.id, target, after);
}
function finishOrderItem(item, changed) {
  renderRail();
  if (!item.line) { focusRailProject(item.id); if (changed) announceProjectOrder(item.id); return; }
  const control = $$('.rail-line[data-line]', $('#railList')).find(el => railLineKey(el.dataset.p, el.dataset.line) === item.id);
  control?.focus({ preventScroll:true }); control?.scrollIntoView({ block:'nearest' });
  if (changed && control) {
    const rows = orderMembers(item);
    const scope = item.parentId ? `sub-Lines of ${item.parentTitle}` : 'top-level Lines';
    toast(`${control.querySelector('.rail-title').textContent}: position ${rows.findIndex(f => f.key === item.id) + 1} of ${rows.length} in ${scope}.`);
  }
}
const dragControl = el => el.closest?.('#railList .rail-row[data-p], #railList .rail-line[data-line]');
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && railProjectGesture) { e.preventDefault(); e.stopImmediatePropagation(); endRailProjectGesture(false); return; }
  projectOrderClick = null;
  const control = dragControl(e.target);
  if (!control || !['ArrowUp', 'ArrowDown'].includes(e.key) || !(e.altKey && e.shiftKey)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (railProjectGesture) return;
  const item = railOrderItem(control);
  if (!item) return;
  const rows = orderMembers(item), index = rows.findIndex(f => f.key === item.id);
  if (index < 0) return;
  const down = e.key === 'ArrowDown', next = index + (down ? 1 : -1), target = rows[next];
  if (target && moveOrderItem(item, target.key, down)) {
    if (item.line && !item.parentId && item.group !== 'pins' && next >= RAIL_LINES) railLineModes.set(item.pid, 'all');
    finishOrderItem(item, true);
  }
}, true);

document.addEventListener('pointerdown', e => {
  projectOrderClick = null;
  if (e.button || !e.isPrimary || railProjectGesture) return;
  const control = dragControl(e.target);
  if (!control) return;
  const item = railOrderItem(control), touch = e.pointerType === 'touch';
  if (!item) return;
  const visible = new Set(orderMembers(item, true).map(f => f.key));
  if (!visible.has(item.id)) return;
  const g = railProjectGesture = { ...item, pointer:e.pointerId, x0:e.clientX, y0:e.clientY, x:e.clientX, y:e.clientY, active:false, target:null,
    visible, snapshot:orderSnapshot(orderMembers(item)) };
  // Permit normal touch scrolling before a hold completes.
  if (touch) g.hold = setTimeout(() => activateRailProjectGesture(g), 350);
});
function activateRailProjectGesture(g) {
  if (railProjectGesture !== g || g.active || !g.unit.isConnected) return;
  g.active = true; clearTimeout(g.hold);
  const header = g.header, rect = header.getBoundingClientRect(), z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1;
  g.offset = g.y0 - rect.top;
  g.ghost = header.cloneNode(true); g.ghost.classList.add('project-order-ghost'); g.ghost.setAttribute('aria-hidden', 'true'); g.ghost.inert = true;
  Object.assign(g.ghost.style, { left:`${rect.left / z}px`, top:`${rect.top / z}px`, width:`${rect.width / z}px` });
  g.mark = document.createElement('div'); g.mark.className = 'project-order-mark'; g.mark.hidden = true;
  document.body.append(g.ghost, g.mark); g.unit.classList.add('is-reordering'); document.body.classList.add('project-reordering');
  g.control.setPointerCapture(g.pointer);
  const frame = () => {
    if (railProjectGesture !== g) return;
    const host = $('#railList'), b = host.getBoundingClientRect();
    if (g.x >= b.left && g.x <= b.right && g.y >= b.top && g.y <= b.bottom) {
      const speed = g.y < b.top + 28 ? -8 : g.y > b.bottom - 28 ? 8 : 0;
      if (speed) host.scrollTop += speed;
    }
    updateRailProjectGesture(g); g.frame = requestAnimationFrame(frame);
  };
  frame();
}
function scopeOrderItems(container, g) {
  if (!container) return [];
  const items = [];
  for (const child of container.children) {
    const row = child.classList.contains('rail-line-unit') ? child.firstElementChild : child;
    const item = railOrderItem(row, !g.line);
    if (item && sameOrderScope(g, item) && g.visible.has(item.id)) items.push(item);
  }
  return items;
}
function pickRailOrderByY(items, y) {
  for (const item of items) {
    const b = item.unit.getBoundingClientRect();
    if (y <= b.bottom) {
      const h = item.line ? item.header.getBoundingClientRect() : b;
      return { over:item, after:y > h.top + h.height / 2 };
    }
  }
  return { over:items.at(-1), after:true };
}
function resolveRailOrderDrop(g, el, over) {
  if (over && sameOrderScope(g, over) && g.visible.has(over.id)) return { over };
  if (!el) return null;
  if (g.line) {
    if (g.group === 'pins') {
      const pins = el.closest?.('#railList .rail-pins') || (el.classList?.contains('rail-sec') && el.nextElementSibling?.classList.contains('rail-pins') ? el.nextElementSibling : null);
      const items = scopeOrderItems(pins, g);
      if (!items.length) return null;
      if (el.classList?.contains('rail-sec')) return { over:items[0], after:false };
      if (el === pins) return pickRailOrderByY(items, g.y);
      return null;
    }
    if (g.parentId) {
      const parentHit = over && over.line && over.pid === g.pid && over.id === railLineKey(g.pid, g.parentId);
      const subs = parentHit
        ? [...over.unit.children].find(c => c.classList.contains('rail-sub-lines'))
        : el.classList?.contains('rail-sub-lines') && el.dataset.railParent === g.parentId ? el : null;
      const items = scopeOrderItems(subs, g);
      if (!items.length) return null;
      return parentHit ? { over:items[0], after:false } : pickRailOrderByY(items, g.y);
    }
    const proj = el.closest?.('#railList .rail-project');
    if (!proj || proj.dataset.project !== g.pid || el.closest?.('.rail-sub-lines')) return null;
    const lines = [...proj.children].find(c => c.classList.contains('rail-lines')), items = scopeOrderItems(lines, g);
    if (!items.length) return null;
    if (el.closest?.('.rail-item, .rail-line.is-new')) return { over:items[0], after:false };
    if (el.closest?.('.rail-more')) return { over:items.at(-1), after:true };
    if (el === lines) return pickRailOrderByY(items, g.y);
    return null;
  }
  const host = $('#railList'), items = scopeOrderItems(host, g);
  if (!items.length) return null;
  if (el.closest?.('#railList .rail-sec-projects')) {
    const first = host.querySelector('.rail-project');
    if (first?.dataset.projectGroup === g.group) return { over:items[0], after:false };
  }
  if (el.tagName === 'HR' && el.parentElement === host) {
    return g.group === 'recent' ? { over:items[0], after:false } : { over:items.at(-1), after:true };
  }
  return null;
}
function updateRailProjectGesture(g) {
  const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1;
  g.ghost.style.top = `${(g.y - g.offset) / z}px`;
  const host = $('#railList'), bounds = host.getBoundingClientRect();
  const el = document.elementFromPoint(g.x, g.y), over = railOrderItem(el, !g.line);
  g.target = null; g.mark.hidden = true;
  const inside = g.x >= bounds.left && g.x <= bounds.right && g.y >= bounds.top && g.y <= bounds.bottom;
  const hit = inside ? resolveRailOrderDrop(g, el, over) : null;
  const valid = Boolean(hit);
  document.body.classList.toggle('is-invalid-drop', !valid);
  if (!valid || hit.over.unit === g.unit) return;
  const target = hit.over, b = target.unit.getBoundingClientRect(), h = target.line ? target.header.getBoundingClientRect() : b;
  const after = typeof hit.after === 'boolean' ? hit.after : g.y > h.top + h.height / 2;
  const indent = target.line ? Number(target.header.style.getPropertyValue('--rail-depth')) * 14 : 0;
  g.target = { id:target.id, after };
  Object.assign(g.mark.style, { left:`${h.left / z + indent + 4}px`, width:`${h.width / z - indent - 8}px`, top:`${Math.min(bounds.bottom / z - 3, Math.max(bounds.top / z, (after ? b.bottom : b.top) / z - 1))}px` });
  g.mark.hidden = false;
}
document.addEventListener('pointermove', e => {
  const g = railProjectGesture; if (!g || e.pointerId !== g.pointer) return;
  g.x = e.clientX; g.y = e.clientY;
  if (!g.active && Math.hypot(g.x - g.x0, g.y - g.y0) > 6) {
    if (g.hold) { endRailProjectGesture(false); return; } // A swipe before the hold remains ordinary scrolling.
    activateRailProjectGesture(g);
  }
  if (g.active) { e.preventDefault(); updateRailProjectGesture(g); }
}, { passive:false });
// Prevent the first touchmove after the hold, without disabling scrolling from initial contact.
document.addEventListener('touchmove', e => { if (railProjectGesture?.active && e.cancelable) e.preventDefault(); }, { passive:false });
document.addEventListener('pointerup', e => { const g = railProjectGesture; if (g && e.pointerId === g.pointer) { if (g.active) { g.x = e.clientX; g.y = e.clientY; updateRailProjectGesture(g); } endRailProjectGesture(true); } });
document.addEventListener('pointercancel', e => { if (railProjectGesture?.pointer === e.pointerId) endRailProjectGesture(false); });
document.addEventListener('lostpointercapture', e => { if (railProjectGesture?.pointer === e.pointerId) endRailProjectGesture(false); });
addEventListener('blur', () => endRailProjectGesture(false));
addEventListener('pagehide', () => endRailProjectGesture(false));
addEventListener('resize', () => endRailProjectGesture(false));
addEventListener('storage', e => {
  if (e.key !== null && e.key !== PROJECT_ORDER_KEY && e.key !== LINE_ORDER_KEY) return;
  endRailProjectGesture(false);
  if (!e.key || e.key === PROJECT_ORDER_KEY) projectOrders = readProjectOrders();
  if (!e.key || e.key === LINE_ORDER_KEY) railLinePositions = readLists(LINE_ORDER_KEY);
  renderRail();
});
let projectOrderClick = null;
document.addEventListener('click', e => {
  const held = projectOrderClick;
  if (!held) return;
  const item = railOrderItem(e.target);
  if (item?.id === held.id || e.pointerId === held.pointer) { e.preventDefault(); e.stopImmediatePropagation(); projectOrderClick = null; }
}, true);
document.addEventListener('contextmenu', e => {
  if (!railProjectGesture?.active) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
function endRailProjectGesture(commit) {
  const g = railProjectGesture; if (!g) return;
  clearTimeout(g.hold); cancelAnimationFrame(g.frame); railProjectGesture = null;
  if (!g.active) return;
  projectOrderClick = { id:g.id, pointer:g.pointer };
  if (g.control.hasPointerCapture(g.pointer)) g.control.releasePointerCapture(g.pointer);
  g.ghost.remove(); g.mark.remove(); g.unit.classList.remove('is-reordering'); document.body.classList.remove('project-reordering', 'is-invalid-drop');
  // A pin, deletion, or list refresh that changed membership invalidates the original target.
  const changed = commit && g.target && orderSnapshot(orderMembers(g)) === g.snapshot
    && orderMembers(g, true).some(f => f.key === g.target.id) && moveOrderItem(g, g.target.id, g.target.after);
  finishOrderItem(g, changed);
}
