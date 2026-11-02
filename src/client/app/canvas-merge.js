  // Merging a newer save keeps both pages' edits. What this page changed since
  // the save it started from (its base) is laid over the newer save: the pixels
  // it changed, the object fields it changed, the objects it added or removed.
  // Everything else comes from the newer save; where both changed the same
  // pixel or field, this page's change wins. Without a known base nothing is
  // removed: the newer save keeps all it has, and this page's ink and objects
  // are laid over it.
  const CANVAS_MERGE_KINDS = ["widgets", "images", "textBoxes"];
  const CANVAS_MERGE_PREFIX = { widgets:"widget", images:"image", textBoxes:"text-box" };
  // Which document this is and its agent sessions belong to this page's copy.
  const CANVAS_MERGE_OWN_EXTENSIONS = new Set(["penechoDocument", "penechoWorkspace", "penechoObjectOrder"]);
  function canvasMergeOps() {
    const ops = typeof window === "object" ? window.PENECHO_LIVE_OPS : null;
    if (!ops) throw Error("PenEcho could not load its merge rules. Reload the page.");
    return ops;
  }
  function canvasMergeObjects(kind, base, local, remote) {
    const ops = canvasMergeOps(), blobs = new Map(), keys = new Map(), known = Array.isArray(base);
    // Images compare by the identity of their bytes, as live changes do.
    const wire = item => {
      if (kind === "images") {
        const { blob, image, ...rest } = item;
        if (!(blob instanceof Blob)) return { ...rest, src:rest.src || "" };
        if (!keys.has(blob)) { keys.set(blob, `blob:${keys.size + 1}`); blobs.set(keys.get(blob), blob); }
        return { ...rest, src:keys.get(blob) };
      }
      if (kind === "textBoxes") { const { image, ...rest } = item; return rest; }
      return item;
    };
    const stored = value => kind === "images" ? (({ src, ...rest }) => ({ ...rest, blob:blobs.get(src) }))(value) : value;
    // Each copy names image bytes differently, so a shared object compares without them.
    const same = (a, b) => ops.equal(...[a, b].map(item => kind === "images" ? (({ src, ...rest }) => rest)(wire(item)) : wire(item)));
    const baseIds = new Set((base || []).map(item => item.id)), localById = new Map(local.map(item => [item.id, item]));
    const merged = new Map(remote.map(item => [item.id, item])), order = remote.map(item => item.id), renamed = new Map();
    const changes = ops.diffObjects(kind, (base || []).map(wire), local.map(wire));
    let next = 1 + Math.max(0, ...[...(base || []), ...local, ...remote].map(item => Number(/-(\d+)$/.exec(item.id)?.[1]) || 0)), changed = false;
    for (const change of changes) {
      if (change.t !== "obj") continue;
      let id = change.id;
      if (change.put && known && merged.has(id) && !baseIds.has(id)) {
        // The newer save already holds this very object (a live change, or this
        // page's own save whose answer was lost); otherwise both pages added an
        // object under the same number, and this page's gets a new one.
        if (same(merged.get(id), localById.get(id))) continue;
        renamed.set(change.id, id = `${CANVAS_MERGE_PREFIX[kind]}-${next++}`);
      }
      const current = merged.get(id), result = ops.applyObjectOp(current ? wire(current) : null, change.put ? { ...change, id, put:{ ...change.put, id } } : { ...change, id });
      if (result === undefined) continue;
      changed = true;
      if (result === null) { merged.delete(id); continue; }
      merged.set(id, stored(result));
      if (!order.includes(id)) order.push(id);
    }
    const present = order.filter(id => merged.has(id)), reorder = changes.find(change => change.t === "order");
    const ids = reorder ? ops.applyOrder(present, reorder.ids.map(id => renamed.get(id) || id)) : present;
    // Changed only if the newer save did not already hold all of this page's changes.
    return { list:ids.map(id => merged.get(id)), changed:changed || ids.join("\n") !== remote.map(item => item.id).join("\n") };
  }
  // pixels(source) reads one tile, a stored { blob }, a { canvas } or { pixels },
  // as RGBA bytes. Merged tiles come back as { pixels }; the others keep the
  // newer save's own entry.
  async function canvasMergeTiles({ base, local, remote, pixels }) {
    const ops = canvasMergeOps(), size = ops.TILE * ops.TILE * 4, empty = new Uint8ClampedArray(size), merged = new Map(remote);
    let changed = false;
    for (const k of new Set([...(base?.keys() || []), ...local.keys()])) {
      const from = base?.get(k), to = local.get(k);
      if (from?.blob && from.blob === to?.blob) continue;
      const before = base ? (from ? await pixels(from) : empty) : null, after = to ? await pixels(to) : empty;
      const target = remote.get(k), out = target ? Uint8ClampedArray.from(await pixels(target)) : new Uint8ClampedArray(size);
      let mine = false;
      for (let i = 0; i < size; i += 4) {
        // Faint edge pixels round differently after a save, so nearly equal is unchanged.
        if (before ? ops.closePixel(before, i, after, i) : after[i + 3] === 0) continue;
        if (ops.closePixel(out, i, after, i)) continue;
        mine = true;
        out[i] = after[i]; out[i + 1] = after[i + 1]; out[i + 2] = after[i + 2]; out[i + 3] = after[i + 3];
      }
      // Nothing of this page's in this tile, or the newer save holds it already.
      if (!mine) continue;
      changed = true;
      let ink = false;
      for (let i = 3; i < size && !ink; i += 4) ink = out[i] > 0;
      if (ink) merged.set(k, { pixels:out });
      else merged.delete(k);
    }
    return { tiles:merged, changed };
  }
  function canvasMergeItem(base, local, remote, objects) {
    const ops = canvasMergeOps(), mine = field => base ? !ops.equal(base[field], local[field]) : local[field] !== undefined;
    const pick = field => mine(field) ? local[field] : remote[field];
    const own = Object.entries(local.bundleExtensions || {}).filter(([key]) => CANVAS_MERGE_OWN_EXTENSIONS.has(key));
    return {
      item:{ ...remote, ...objects, name:pick("name"), theme:pick("theme"), animations:pick("animations"), manifestExtensions:pick("manifestExtensions"),
        preservedAssets:pick("preservedAssets"), view:local.view || remote.view, bundleExtensions:{ ...(remote.bundleExtensions || {}), ...Object.fromEntries(own) } },
      changed:["name", "theme", "animations", "manifestExtensions"].some(field => base && mine(field)),
    };
  }
  // base, local and remote are { item, tiles }, tiles a Map from tile key to its
  // source. base is null when this page no longer knows what it started from.
  async function canvasMergeSaves({ base, local, remote, pixels }) {
    const objects = {};
    let changed = false;
    for (const kind of CANVAS_MERGE_KINDS) {
      const result = canvasMergeObjects(kind, base ? base.item[kind] || [] : null, local.item[kind] || [], remote.item[kind] || []);
      objects[kind] = result.list;
      changed ||= result.changed;
    }
    const tiles = await canvasMergeTiles({ base:base?.tiles || null, local:local.tiles, remote:remote.tiles, pixels }), item = canvasMergeItem(base?.item || null, local.item, remote.item, objects);
    return { item:item.item, tiles:tiles.tiles, changed:changed || tiles.changed || item.changed };
  }
  const canvasMergeTileMap = entries => new Map((entries || []).map(entry => [entry.k, entry]));
  async function canvasMergePixels(source) {
    if (source.pixels) return source.pixels;
    let canvas = source.canvas;
    if (!canvas) {
      const image = await imageFromBlob(source.blob);
      canvas = offscreen(TILE, TILE);
      canvas.getContext("2d").drawImage(image, 0, 0);
      image.close?.();
    }
    return canvas.getContext("2d", { willReadFrequently:true }).getImageData(0, 0, TILE, TILE).data;
  }
  // A merge result as a stored copy: tiles this page changed are encoded again.
  async function canvasMergeStored(result) {
    const tileEntries = await Promise.all([...result.tiles].map(async ([k, source]) => {
      if (!source.pixels) return { k, blob:source.blob };
      const canvas = offscreen(TILE, TILE);
      canvas.getContext("2d").putImageData(new ImageData(source.pixels, TILE, TILE), 0, 0);
      const blob = await canvasBlob(canvas);
      canvas.width = canvas.height = 1;
      return { k, blob };
    }));
    return { item:result.item, tileEntries };
  }
