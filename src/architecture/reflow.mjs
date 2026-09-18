// Width is measured in document CSS pixels, never transformed canvas pixels.
export function layoutWidth(value) {
  return Number.isFinite(value) && value > 0 ? Math.max(16, Math.floor(value / 16) * 16) : 0;
}

export function serialLayouts() {
  let tail = Promise.resolve();
  return task => { const next = tail.then(task); tail = next.catch(() => {}); return next; };
}

// One latest-width request per diagram, one Worker at a time across a document.
// Keep a tiny LRU for switching between Canvas and maximized presentation widths.
export function createReflow({compute, commit, report, enqueue = task => task(), delay = 180}) {
  let width = 0, revision = 0, timer, controller, disposed = false;
  let settled = Promise.resolve(), resolveSettled = null;
  const cache = new Map();
  function finish() { resolveSettled?.(); resolveSettled = null; }
  async function run(current, target) {
    if (disposed || current !== revision) return;
    const abort = new AbortController(); controller = abort;
    try {
      let layout = cache.get(target);
      const cached = Boolean(layout);
      if (!layout) layout = await compute(target, abort.signal);
      if (disposed || current !== revision) return;
      cache.delete(target); cache.set(target,layout);
      if (cache.size > 3) cache.delete(cache.keys().next().value);
      commit(layout, target, {cached});
    } catch (error) {
      if (!disposed && current === revision && !abort.signal.aborted) report(error);
    } finally {
      if (controller === abort) controller = null;
      if (current === revision) finish();
    }
  }
  function launch() {
    clearTimeout(timer); timer = null;
    const current = revision, target = width;
    return enqueue(() => run(current,target));
  }
  return {
    request(value, immediate = false) {
      const next = layoutWidth(value);
      if (disposed || next === width) return settled;
      width = next; revision++; controller?.abort(); clearTimeout(timer); timer = null;
      if (!next) { finish(); return settled; }
      if (!resolveSettled) settled = new Promise(resolve => { resolveSettled = resolve; });
      if (immediate) void launch(); else timer = setTimeout(launch,delay);
      return settled;
    },
    whenSettled() { if (timer !== null && timer !== undefined) void launch(); return settled; },
    dispose() { disposed = true; revision++; clearTimeout(timer); controller?.abort(); cache.clear(); finish(); },
  };
}
