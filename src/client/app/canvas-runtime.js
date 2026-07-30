// Canvas tiles, widgets, animations, rendering, navigation, and text editing.
  const objectChromeButtons = new Map();
  let nextObjectChromeStyleId = 1;
  function tile(tx, ty, create = true) {
    const k = key(tx, ty);
    if (!tiles.has(k) && create) {
      const c = document.createElement("canvas");
      c.width = c.height = TILE;
      c.getContext("2d", { willReadFrequently: true });
      tiles.set(k, c);
      state.inkBounds.set(k, null);
    }
    return tiles.get(k);
  }
  function retainSharpOverlay(image, box) {
    if (!image || !box) return;
    const pixels = image.width * image.height;
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > MAX_SHARP_OVERLAY_ITEM_PIXELS) return;
    const overlay = { image, box: { ...box }, pixels };
    state.sharpOverlays.push(overlay);
    state.sharpOverlayPixels += pixels;
    while (state.sharpOverlayPixels > MAX_SHARP_OVERLAY_PIXELS && state.sharpOverlays.length > 1) {
      const removed = state.sharpOverlays.shift();
      state.sharpOverlayPixels -= removed.pixels;
    }
  }
  function clearSharpOverlays() {
    state.sharpOverlays = [];
    state.sharpOverlayPixels = 0;
  }
  function invalidateSharpOverlays(box) {
    if (!box || !state.sharpOverlays.length) return;
    state.sharpOverlays = state.sharpOverlays.filter((overlay) => {
      if (!intersection(overlay.box, box)) return true;
      state.sharpOverlayPixels -= overlay.pixels;
      return false;
    });
    state.sharpOverlayPixels = Math.max(0, state.sharpOverlayPixels);
  }
  function drawSharpOverlays(context, region = null) {
    for (const overlay of state.sharpOverlays) {
      if (region && !intersection(overlay.box, region)) continue;
      context.drawImage(overlay.image, overlay.box.x, overlay.box.y, overlay.box.w, overlay.box.h);
    }
  }

  function textBoxBox(item) {
    return { x:item.x, y:item.y, w:item.w, h:item.h };
  }
  function textBoxHistoryRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      maxWidth:item.maxWidth,
      fontSize:item.fontSize,
      color:item.color,
      text:item.text,
      image:item.image,
    };
  }
  function storedTextBoxes() {
    return state.textBoxes.map(({ image, ...item }) => ({ ...item }));
  }
  function textBoxHistoryState() {
    return state.textBoxes.map(textBoxHistoryRecord);
  }
  function recordTextBoxesBefore() {
    if (!state.textBoxHistoryBefore) state.textBoxHistoryBefore = textBoxHistoryState();
  }
  function visibleTextBoxes(region = null) {
    return state.textBoxes.filter((item) => item.id !== state.selectedTextBoxId && (!region || intersection(textBoxBox(item), region)));
  }
  function textBoxBounds(region = null) {
    let bounds = null;
    for (const item of visibleTextBoxes(region)) bounds = unionLocalBounds(bounds, region ? intersection(textBoxBox(item), region) : textBoxBox(item));
    return bounds;
  }
  function drawTextBoxesToContext(context, region = null) {
    for (const item of visibleTextBoxes(region)) context.drawImage(item.image, item.x, item.y, item.w, item.h);
  }
  function textBoxAtPoint(point) {
    for (let index = state.textBoxes.length - 1; index >= 0; index--) {
      const item = state.textBoxes[index],
        box = textBoxBox(item);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
  }
  async function fittedTextBoxContent(text, fontSize, color, maxWidth) {
    const render = async () => {
      try {
        return { image:await mixedTextImage(text, fontSize, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY), mixedFallback:false };
      } catch {
        return { image:textImage(text, fontSize, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH), mixedFallback:true };
      }
    };
    maxWidth = Math.min(SIZE, Math.max(fontSize * 3, maxWidth));
    let result = await render(),
      width = result.image.logicalWidth || result.image.width,
      height = result.image.logicalHeight || result.image.height;
    for (let attempt = 0; attempt < 3 && (width > SIZE || height > SIZE); attempt++) {
      const scale = Math.min(SIZE / width, SIZE / height) * 0.995;
      fontSize = Math.max(1, fontSize * scale);
      maxWidth = Math.min(SIZE, Math.max(fontSize * 3, maxWidth * scale));
      result = await render();
      width = result.image.logicalWidth || result.image.width;
      height = result.image.logicalHeight || result.image.height;
    }
    return {
      ...result,
      fontSize,
      maxWidth,
      width:Math.min(SIZE, width),
      height:Math.min(SIZE, height),
    };
  }
  async function renderedTextBoxRecord(item) {
    if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim() || item.text.length > TEXT_INPUT_MAX_LENGTH) return null;
    const x = Number(item.x),
      y = Number(item.y),
      fontSize = Number(item.fontSize),
      maxWidth = Number(item.maxWidth);
    if (![x, y, fontSize, maxWidth].every(Number.isFinite) || x < 0 || y < 0 || fontSize < 1 || fontSize > 2000 || maxWidth < fontSize * 3 || maxWidth > SIZE) return null;
    const color = item.color || state.inkColor,
      fitted = await fittedTextBoxContent(item.text, fontSize, color, maxWidth),
      width = fitted.width,
      height = fitted.height,
      fittedX = Math.max(0, Math.min(SIZE - width, x)),
      fittedY = Math.max(0, Math.min(SIZE - height, y));
    if (width <= 0 || height <= 0) return null;
    return {
      id:typeof item.id === "string" && /^text-box-\d+$/.test(item.id) ? item.id : `text-box-${state.nextTextBoxId++}`,
      x:fittedX,
      y:fittedY,
      w:width,
      h:height,
      maxWidth:fitted.maxWidth,
      fontSize:fitted.fontSize,
      color:typeof item.color === "string" ? item.color : color,
      text:item.text,
      image:fitted.image,
    };
  }
  async function restoreTextBoxes(items) {
    clearTextEditors();
    state.textBoxes = [];
    state.nextTextBoxId = 1;
    state.selectedTextBoxId = null;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_TEXT_BOXES) : []) {
      let record = null;
      if (item?.image) {
        record = textBoxHistoryRecord(item);
      } else record = await renderedTextBoxRecord(item);
      if (!record || state.textBoxes.some((existing) => existing.id === record.id)) continue;
      const numbered = /^text-box-(\d+)$/.exec(record.id);
      if (numbered) state.nextTextBoxId = Math.max(state.nextTextBoxId, Number(numbered[1]) + 1);
      state.textBoxes.push(record);
    }
    positionTextEditors();
    requestRender();
  }

  function imageBox(item) {
    return { x:item.x, y:item.y, w:item.w, h:item.h };
  }
  function imageLayout(item) {
    return imageBox(item);
  }
  function imageHistoryRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
      image:item.image,
    };
  }
  function storedImageRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
    };
  }
  function imageRecord(item) {
    if (!item || typeof item !== "object" || !(item.blob instanceof Blob) || !item.image || item.blob.size <= 0 || item.blob.size > MAX_IMAGE_SOURCE_BYTES) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 80) || !n(item.h, 80) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const naturalW = Number(item.naturalW) || item.image.naturalWidth || item.image.width,
      naturalH = Number(item.naturalH) || item.image.naturalHeight || item.image.height;
    if (!n(naturalW, 1, MAX_IMAGE_DIMENSION) || !n(naturalH, 1, MAX_IMAGE_DIMENSION) || naturalW * naturalH > MAX_IMAGE_PIXELS) return null;
    return {
      id:typeof item.id === "string" && /^image-\d+$/.test(item.id) ? item.id : `image-${state.nextImageId++}`,
      x:Math.round(item.x),
      y:Math.round(item.y),
      w:Math.round(item.w),
      h:Math.round(item.h),
      naturalW:Math.round(naturalW),
      naturalH:Math.round(naturalH),
      sourceName:typeof item.sourceName === "string" ? item.sourceName.trim().slice(0, 160) : "",
      blob:item.blob,
      image:item.image,
    };
  }
  function imageHistoryState() {
    return state.images.map(imageHistoryRecord);
  }
  function storedImages() {
    return state.images.map(storedImageRecord);
  }
  function recordImagesBefore() {
    if (!state.imageHistoryBefore) state.imageHistoryBefore = imageHistoryState();
  }
  function restoreImages(items) {
    state.images = [];
    state.nextImageId = 1;
    state.selectedImageId = null;
    state.imageEdit = null;
    state.imageGesture = null;
    state.imageHandReturnMode = null;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []) {
      const record = imageRecord(item);
      if (!record || state.images.some((existing) => existing.id === record.id)) continue;
      const numbered = /^image-(\d+)$/.exec(record.id);
      if (numbered) state.nextImageId = Math.max(state.nextImageId, Number(numbered[1]) + 1);
      state.images.push(record);
    }
  }
  async function decodeStoredImage(item) {
    if (!item || !(item.blob instanceof Blob)) return null;
    try {
      const image = await imageFromBlob(item.blob);
      return imageRecord({ ...item, image });
    } catch {
      return null;
    }
  }
  async function decodeStoredImages(items) {
    return (await Promise.all((Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []).map(decodeStoredImage))).filter(Boolean);
  }
  function visibleImages(region = null) {
    return state.images.filter((item) => !region || intersection(imageBox(item), region));
  }
  function imageBounds(region = null) {
    let bounds = null;
    for (const item of visibleImages(region)) bounds = unionLocalBounds(bounds, region ? intersection(imageBox(item), region) : imageBox(item));
    return bounds;
  }
  function drawImagesToContext(context, region = null) {
    for (const item of visibleImages(region)) context.drawImage(item.image, item.x, item.y, item.w, item.h);
  }
  function selectedImage() {
    return state.images.find((item) => item.id === state.selectedImageId) || null;
  }
  function enterManualImageHandMode() {
    if (state.mode !== "hand" && state.imageHandReturnMode === null) state.imageHandReturnMode = state.mode;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function finishManualImageHandMode() {
    const returnMode = state.imageHandReturnMode;
    state.imageHandReturnMode = null;
    if (returnMode && state.mode === "hand") setCanvasMode(returnMode, {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function beginImageEdit(item) {
    if (!item || !state.images.includes(item)) return false;
    if (state.imageEdit?.id === item.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.animationEdit) acceptAnimationEdit();
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    recordImagesBefore();
    state.selectedImageId = item.id;
    state.imageEdit = { id:item.id, before:imageLayout(item), changed:false };
    requestInteractionLayerRender();
    setStatusKey("imageSelected");
    return true;
  }
  function acceptImageEdit(options) {
    options ||= {};
    const restoreMode = options.restoreMode !== false;
    const edit = state.imageEdit;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.imageHistoryBefore = null;
    if (edit && state.mode !== "hand") schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit && restoreMode) finishManualImageHandMode();
    else if (edit) state.imageHandReturnMode = null;
    return Boolean(edit);
  }
  function cancelImageEdit() {
    const edit = state.imageEdit,
      item = edit ? state.images.find((candidate) => candidate.id === edit.id) : null;
    if (item) Object.assign(item, edit.before);
    state.imageHistoryBefore = null;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit && state.mode !== "hand") schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit) finishManualImageHandMode();
    return Boolean(edit);
  }
  function imageControlHit(item, point, pointerType = "mouse") {
    const box = imageBox(item),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      controls = [
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((candidate) => ({ ...candidate, distance:Math.hypot(point.x - candidate.target.x, point.y - candidate.target.y) }))
        .filter((candidate) => candidate.distance <= candidate.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function imageAtPoint(point) {
    for (let index = state.images.length - 1; index >= 0; index--) {
      const item = state.images[index], box = imageBox(item);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
  }
  function imagePointerHit(point, pointerType = "mouse", includeUnselected = false) {
    const selected = selectedImage();
    if (selected && state.imageEdit) {
      const hit = imageControlHit(selected, point, pointerType);
      if (hit) return { image:selected, hit };
    }
    if (!includeUnselected) return null;
    const item = imageAtPoint(point);
    return item ? { image:item, hit:"move" } : null;
  }
  function resizeImageBox(start, point, hit) {
    const minimumWidth = 80, minimumHeight = 80,
      maximumWidth = SIZE - start.x,
      maximumHeight = SIZE - start.y;
    if (hit === "width") return { ...start, w:Math.max(minimumWidth, Math.min(maximumWidth, point.x - start.x)) };
    if (hit === "height") return { ...start, h:Math.max(minimumHeight, Math.min(maximumHeight, point.y - start.y)) };
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min(maximumWidth / start.w, maximumHeight / start.h),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginImageGesture(event, point, result) {
    if (!result?.image) return false;
    beginImageEdit(result.image);
    state.imageGesture = {
      id:event.pointerId,
      image:result.image,
      hit:result.hit,
      startPoint:point,
      start:imageLayout(result.image),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const point = clientPoint(event), item = gesture.image;
    if (gesture.hit === "move") {
      item.x = Math.max(0, Math.min(SIZE - item.w, gesture.start.x + point.x - gesture.startPoint.x));
      item.y = Math.max(0, Math.min(SIZE - item.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(item, resizeImageBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(item[key] - gesture.start[key]) > 0.01);
    requestRender();
    requestInteractionLayerRender();
    return true;
  }
  function finishImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.imageGesture = null;
    resetCanvasCursor();
    if (gesture.changed && state.imageEdit?.id === gesture.image.id) state.imageEdit.changed = true;
    requestInteractionLayerRender();
    return true;
  }
  function deleteImage(item) {
    if (!item || !state.images.includes(item)) return false;
    const edited = state.imageEdit?.id === item.id;
    recordImagesBefore();
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    save();
    if (edited) finishManualImageHandMode();
    if (state.mode !== "hand") schedule();
    requestRender();
    setStatusKey("imageDeleted");
    return true;
  }
  function mergeImage(item) {
    if (!item || !state.images.includes(item)) return false;
    const edited = state.imageEdit?.id === item.id;
    recordImagesBefore();
    const box = imageBox(item);
    invalidateSharpOverlays(box);
    const x0 = Math.max(0, Math.floor(box.x / TILE)),
      y0 = Math.max(0, Math.floor(box.y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.x + box.w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.y + box.h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        recordBefore(tx, ty);
        const canvas = tile(tx, ty);
        canvas.getContext("2d").drawImage(item.image, item.x - tx * TILE, item.y - ty * TILE, item.w, item.h);
        extendInkBounds(key(tx, ty), {
          x: Math.max(0, item.x - tx * TILE),
          y: Math.max(0, item.y - ty * TILE),
          w: Math.min(TILE, item.x + item.w - tx * TILE) - Math.max(0, item.x - tx * TILE),
          h: Math.min(TILE, item.y + item.h - ty * TILE) - Math.max(0, item.y - ty * TILE),
        });
      }
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    mergeDirty(box.x, box.y, 0);
    mergeDirty(box.x + box.w, box.y + box.h, 0);
    if (edited) finishManualImageHandMode();
    if (state.mode !== "hand") {
      state.autoEligible = true;
      schedule();
    }
    save();
    requestRender();
    setStatusKey("imageMerged");
    return true;
  }
  function importedImagePlacement(naturalW, naturalH) {
    const visible = viewportRect() || { x:0, y:0, w:SIZE, h:SIZE },
      rect = view.getBoundingClientRect(),
      maxW = Math.max(80, Math.min(6000, visible.w * 0.72, Math.max(240, rect.width * 0.52) / state.scale)),
      maxH = Math.max(80, Math.min(6000, visible.h * 0.72, Math.max(200, rect.height * 0.52) / state.scale)),
      scale = Math.min(maxW / naturalW, maxH / naturalH),
      w = Math.max(80, naturalW * scale),
      h = Math.max(80, naturalH * scale),
      x = Math.max(0, Math.min(SIZE - w, visible.x + (visible.w - w) / 2)),
      y = Math.max(0, Math.min(SIZE - h, visible.y + (visible.h - h) / 2));
    return { x, y, w, h };
  }
  function imageImportError(key) {
    const error = Error(t(key));
    error.statusKey = key;
    return error;
  }
  async function prepareImportedImage(file) {
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    if (file.type && !file.type.toLowerCase().startsWith("image/")) throw imageImportError("imageUnsupported");
    let source;
    try { source = await imageFromBlob(file); } catch { throw imageImportError("imageUnsupported"); }
    const sourceW = source.naturalWidth || source.width,
      sourceH = source.naturalHeight || source.height;
    if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) throw imageImportError("imageUnsupported");
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / sourceW, MAX_IMAGE_DIMENSION / sourceH, Math.sqrt(MAX_IMAGE_PIXELS / (sourceW * sourceH))),
      naturalW = Math.max(1, Math.round(sourceW * scale)),
      naturalH = Math.max(1, Math.round(sourceH * scale)),
      canvas = offscreen(naturalW, naturalH),
      context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, naturalW, naturalH);
    const blob = await canvasBlob(canvas, "image/webp", 0.92);
    canvas.width = canvas.height = 1;
    if (!blob || blob.size <= 0 || blob.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    const image = await imageFromBlob(blob);
    return { blob, image, naturalW, naturalH };
  }
  function canvasIdentityGeneration() {
    return state.snapshotLoadGeneration;
  }
  async function addImageFile(file) {
    if (state.imageImporting) return;
    cancelWidgetRefinement("image-import-started");
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    const expectedIdentityGeneration = canvasIdentityGeneration();
    state.imageImporting = true;
    imagePickerButton.disabled = true;
    setStatusKey("imageLoading");
    try {
      const prepared = await prepareImportedImage(file);
      if (expectedIdentityGeneration !== canvasIdentityGeneration()) return;
      if (state.pending) acceptPending();
      if (state.pendingWidgetReplacement) rejectPendingWidget(AI_CANCELLED);
      else if (state.pendingWidget) acceptPendingWidget();
      if (state.images.length >= MAX_VISIBLE_IMAGES) throw imageImportError("imageLimitReached");
      if (state.selection) commitSelection();
      if (state.selection) {
        setStatusKey(selectionAIStatusKey());
        return;
      }
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.animationEdit) acceptAnimationEdit();
      if (state.imageEdit) acceptImageEdit();
      recordImagesBefore();
      const item = imageRecord({
        id:`image-${state.nextImageId++}`,
        ...importedImagePlacement(prepared.naturalW, prepared.naturalH),
        ...prepared,
        sourceName:typeof file.name === "string" ? file.name : "",
      });
      if (!item) throw imageImportError("imageImportFailed");
      state.images.push(item);
      state.userRevision++;
      save();
      requestRender();
      enterManualImageHandMode();
      beginImageEdit(item);
      setStatusKey("imageAdded");
    } catch (error) {
      setStatusKey(error?.statusKey || "imageImportFailed");
    } finally {
      state.imageImporting = false;
      imagePickerButton.disabled = false;
      imagePickerInput.value = "";
    }
  }
  function widgetBox(widget) {
    return { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  }
  function widgetLayout(widget) {
    return { ...widgetBox(widget), contentW:widget.contentW, contentH:widget.contentH };
  }
  function visibleWidgets(region = null) {
    if (!widgetRuntimeEnabled()) return [];
    return state.widgets.filter((widget) => !widget.hiddenForReplacement && pluginEnabled(widget.pluginId) && pluginManifests.has(widget.pluginId) && (!region || intersection(widgetBox(widget), region)));
  }
  function serializedWidgets() {
    return state.widgets.map((widget) => ({
      id: widget.id,
      widgetType: widget.widgetType,
      pluginId: widget.pluginId,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      contentW: widget.contentW,
      contentH: widget.contentH,
      title: widget.title,
      refreshSeconds: widget.refreshSeconds,
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType !== "diagram_source" && widget.pluginId !== "image-search" && widget.copyText ? { copyText:widget.copyText, copyLabel:widget.copyLabel } : {}),
    }));
  }
  function recordWidgetsBefore() {
    if (!state.widgetHistoryBefore) state.widgetHistoryBefore = serializedWidgets();
  }
  function widgetRecord(item) {
    if (!item || typeof item !== "object" || typeof item.pluginId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pluginId) || item.pluginId.length > 64) return null;
    const runtime = diagramRuntime(),
      widgetType = item.widgetType === "diagram_source" || item.tool === "diagram_source" ? "diagram_source" : "html_widget",
      source = widgetType === "diagram_source" && diagramSourceFits(item.source) ? item.source : "",
      normalizedSourceFormat = widgetType === "diagram_source" && source ? runtime?.normalizeFormat(item.sourceFormat) || canonicalStoredDiagramFormat(item.sourceFormat) : "",
      html = widgetType === "diagram_source"
        ? runtime?.documentFor({ sourceFormat:normalizedSourceFormat, source, title:item.title, diagramKind:item.diagramKind }) || ""
        : typeof item.html === "string" ? item.html : "";
    if (widgetType === "html_widget" && (!html.trim() || html.length > MAX_WIDGET_HTML_LENGTH)
      || widgetType === "diagram_source" && (!source || !normalizedSourceFormat || html.length > MAX_WIDGET_HTML_LENGTH)) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 300, SIZE) || !n(item.h, 200, SIZE) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const contentW = item.contentW ?? item.w,
      contentH = item.contentH ?? item.h;
    if (!Number.isFinite(contentW) || contentW < 300 || contentW > MAX_WIDGET_CONTENT_DIMENSION
      || !Number.isFinite(contentH) || contentH < 200 || contentH > MAX_WIDGET_CONTENT_DIMENSION) return null;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 120 || !(item.refreshSeconds === 0 || n(item.refreshSeconds, 60, 86400))) return null;
    const allowCopy = item.pluginId !== "image-search";
    const diagramKind = typeof item.diagramKind === "string" ? item.diagramKind.trim() : "",
      inferredSourceFormat = item.pluginId === "flowchart" && item.copyText && item.sourceFormat === undefined ? "mermaid" : "",
      sourceFormat = typeof item.sourceFormat === "string" ? item.sourceFormat.trim() : inferredSourceFormat,
      frameworkVersion = typeof item.frameworkVersion === "string" ? item.frameworkVersion.trim() : "";
    if (diagramKind.length > 80 || sourceFormat.length > 80 || frameworkVersion.length > 120) return null;
    if (widgetType !== "diagram_source" && allowCopy && item.copyText !== undefined && (typeof item.copyText !== "string" || !item.copyText.trim() || item.copyText.length > MAX_WIDGET_COPY_TEXT_LENGTH)) return null;
    if (widgetType !== "diagram_source" && allowCopy && item.copyLabel !== undefined && (typeof item.copyLabel !== "string" || !item.copyLabel.trim() || item.copyLabel.length > 80)) return null;
    return {
      id: typeof item.id === "string" && /^widget-\d+$/.test(item.id) ? item.id : `widget-${state.nextWidgetId++}`,
      widgetType,
      pluginId: item.pluginId,
      x: Math.round(item.x),
      y: Math.round(item.y),
      w: Math.round(item.w),
      h: Math.round(item.h),
      contentW: Math.round(contentW),
      contentH: Math.round(contentH),
      title: item.title.trim(),
      refreshSeconds: Math.round(item.refreshSeconds),
      html,
      source,
      diagramKind,
      sourceFormat: widgetType === "diagram_source" ? normalizedSourceFormat : sourceFormat,
      frameworkVersion: widgetType === "diagram_source" ? runtime?.VERSION || DIAGRAM_RUNTIME_VERSION : frameworkVersion,
      copyText: widgetType === "diagram_source" ? source : allowCopy && typeof item.copyText === "string" ? item.copyText.trim() : "",
      copyLabel: widgetType === "diagram_source" ? runtime?.copyLabel(normalizedSourceFormat) || `Copy ${normalizedSourceFormat}` : allowCopy && typeof item.copyText === "string" ? String(item.copyLabel || (sourceFormat ? `Copy ${sourceFormat}` : "Copy source")).trim() : "",
      snapshotImage: null,
      shell: null,
      frame: null,
      hostOrigin: null,
      pending: false,
    };
  }
  function restoreWidgets(items) {
    if (state.activeAI?.widgetEdit) supersedeActiveAI("widgets-restored");
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED, { restoreMode:false, status:false });
    state.pendingWidgetReplacement = null;
    clearWidgetRefineCandidate();
    for (const widget of state.widgets) unmountWidget(widget);
    state.widgets = [];
    state.selectedWidgetId = null;
    state.widgetEdit = null;
    state.widgetGesture = null;
    state.nextWidgetId = 1;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_WIDGETS) : []) {
      const widget = widgetRecord(item);
      if (!widget || state.widgets.some((existing) => existing.id === widget.id)) continue;
      const numbered = /^widget-(\d+)$/.exec(widget.id);
      if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
      state.widgets.push(widget);
      if (pluginEnabled(widget.pluginId)) mountWidget(widget);
    }
  }
  function widgetHostUrl(manifest) {
    const url = new URL("widget-host.html", location.href);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      url.searchParams.set("parent-origin", location.origin);
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      url.searchParams.set("parent-origin", location.origin);
    }
    for (const origin of manifest.connect) url.searchParams.append("connect", origin);
    return url.href;
  }
  function mountWidget(widget) {
    if (widget.shell || !pluginEnabled(widget.pluginId)) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    if (widget.widgetType === "diagram_source") {
      const runtime = diagramRuntime(),
        html = runtime?.documentFor({ sourceFormat:widget.sourceFormat, source:widget.source, title:widget.title, diagramKind:widget.diagramKind }) || "";
      if (!html || html.length > MAX_WIDGET_HTML_LENGTH) return;
      widget.html = html;
      widget.frameworkVersion = runtime.VERSION;
      widget.copyText = widget.source;
      widget.copyLabel = runtime.copyLabel(widget.sourceFormat);
    }
    const shell = document.createElement("section"),
      frame = document.createElement("iframe");
    shell.className = `canvas-widget${widget.pending ? " pending" : ""}`;
    shell.dataset.widgetId = widget.id;
    shell.tabIndex = widget.pending ? -1 : 0;
    shell.setAttribute("aria-label", `${widget.title}. ${t("widgetRefineHint")}`);
    shell.classList.add(`canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`);
    frame.className = "canvas-widget-frame";
    frame.title = widget.title;
    frame.referrerPolicy = "no-referrer";
    frame.src = widgetHostUrl(manifest);
    shell.append(frame);
    widgetLayer.append(shell);
    widget.shell = shell;
    widget.frame = frame;
    widget.hostOrigin = new URL(frame.src).origin;
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostReadyPromise = new Promise((resolve) => (widget.resolveHostReady = resolve));
    widget.hostStateKey = null;
    widget.contentReady = false;
    widget.readyPromise = new Promise((resolve) => (widget.resolveReady = resolve));
    addWidgetStyleRule(widget);
    positionWidget(widget);
  }
  function unmountWidget(widget) {
    if (state.widgetHostPan?.widget === widget) {
      state.widgetHostPan = null;
      setNavigating(false);
    }
    removeWidgetStyleRule(widget);
    widget.shell?.remove();
    widget.shell = null;
    widget.frame = null;
    widget.hostOrigin = null;
    widget.initialized = false;
    widget.hostReady = false;
    widget.resolveHostReady = null;
    widget.hostReadyPromise = null;
    widget.contentReady = false;
    widget.resolveReady = null;
    widget.readyPromise = null;
    for (const [requestId, pending] of widgetSnapshotRequests) {
      if (pending.widget !== widget) continue;
      clearTimeout(pending.timer);
      pending.reject(Error(t("widgetExportFailed")));
      widgetSnapshotRequests.delete(requestId);
    }
  }
  function addWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), className = `canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`;
    if (!sheet) return;
    try {
      sheet.insertRule(`.${className} { width: ${widget.contentW}px; height: ${widget.contentH}px; }`, sheet.cssRules.length);
      widget.styleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      widget.styleRule = null;
    }
  }
  function removeWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), rule = widget?.styleRule;
    if (!sheet || !rule) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    widget.styleRule = null;
  }
  function updateWidgetRenderVisibility(widget, screenX, screenY) {
    if (!widget.shell) return;
    const viewportWidth = view.clientWidth,
      viewportHeight = view.clientHeight,
      displayWidth = widget.w * state.scale,
      displayHeight = widget.h * state.scale,
      dragging = state.widgetGesture?.widget === widget,
      intersectsViewport = viewportWidth <= 0 || viewportHeight <= 0
        || (screenX < viewportWidth && screenY < viewportHeight && screenX + displayWidth > 0 && screenY + displayHeight > 0),
      active = dragging || intersectsViewport;
    widget.renderActive = active;
    widget.shell.classList.toggle("widget-offscreen", !active);
    if (active) sendWidgetInit(widget);
    return active;
  }
  function positionWidget(widget) {
    if (!widget.shell) return;
    const screenX = state.panX + widget.x * state.scale,
      screenY = state.panY + widget.y * state.scale,
      scaleX = state.scale * widget.w / widget.contentW,
      scaleY = state.scale * widget.h / widget.contentH,
      declaration = widget.styleRule?.style;
    if (!declaration) return;
    const sizeKey = `${widget.contentW}x${widget.contentH}`;
    if (widget.styleSizeKey !== sizeKey) {
      widget.styleSizeKey = sizeKey;
      declaration.width = `${widget.contentW}px`;
      declaration.height = `${widget.contentH}px`;
    }
    declaration.transform = `translate3d(${screenX}px,${screenY}px,0) scale(${scaleX},${scaleY})`;
    updateWidgetRenderVisibility(widget, screenX, screenY);
    sendWidgetHostState(widget, scaleX, scaleY);
  }
  function positionWidgets() {
    if (!widgetRuntimeEnabled()) return;
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) positionWidget(widget);
  }
  function sendWidgetInit(widget) {
    if (!widget.frame?.contentWindow || !widget.hostReady || widget.initialized || widget.renderActive === false) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    widget.initialized = true;
    widget.frame.contentWindow.postMessage({
      type:"penecho-widget-init",
      title:widget.title,
      html:widget.html,
      pluginStyles:manifest.styles || "",
    }, widget.hostOrigin || location.origin);
  }
  function sendWidgetHostState(widget, scaleX = state.scale * widget.w / widget.contentW, scaleY = state.scale * widget.h / widget.contentH, force = false) {
    if (!widget.frame?.contentWindow || !widget.hostReady || !Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) return;
    const selected = widget.pending === true || (state.widgetEdit?.id === widget.id && state.selectedWidgetId === widget.id),
      active = widget.renderActive !== false,
      key = `${selected ? 1 : 0}:${active ? 1 : 0}:${scaleX.toFixed(6)}:${scaleY.toFixed(6)}`;
    if (!force && widget.hostStateKey === key) return;
    widget.hostStateKey = key;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-state", selected, active, scaleX, scaleY }, widget.hostOrigin || location.origin);
  }
  function syncWidgetHostStates() {
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) sendWidgetHostState(widget);
  }
  function decodeWidgetSnapshot(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error("Widget snapshot could not be decoded"));
      image.src = dataUrl;
    });
  }
  async function waitForWidgetContent(widget) {
    if (widget.contentReady) return;
    if (!widget.readyPromise) throw Error(t("widgetExportFailed"));
    await Promise.race([
      widget.readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), WIDGET_SNAPSHOT_TIMEOUT_MS)),
    ]);
  }
  async function requestWidgetSnapshot(widget) {
    if (widget.snapshotPromise) return widget.snapshotPromise;
    const snapshotPromise = (async () => {
      const previousActive = widget.renderActive;
      try {
        if (!widget.hostReady && widget.hostReadyPromise) await Promise.race([
          widget.hostReadyPromise,
          new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), WIDGET_SNAPSHOT_TIMEOUT_MS)),
        ]);
        if (!widget.initialized) {
          widget.renderActive = true;
          sendWidgetInit(widget);
          sendWidgetHostState(widget, undefined, undefined, true);
        }
        await waitForWidgetContent(widget);
        if (!widget.frame?.contentWindow) throw Error(t("widgetExportFailed"));
        const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            widgetSnapshotRequests.delete(requestId);
            reject(Error(t("widgetExportFailed")));
          }, WIDGET_SNAPSHOT_TIMEOUT_MS);
          widgetSnapshotRequests.set(requestId, { widget, resolve, reject, timer });
          widget.frame.contentWindow.postMessage({ type:"penecho-widget-snapshot-request", requestId, width:widget.contentW, height:widget.contentH }, widget.hostOrigin || location.origin);
        });
      } finally {
        if (previousActive === false) {
          widget.renderActive = false;
          sendWidgetHostState(widget, undefined, undefined, true);
        }
      }
    })();
    widget.snapshotPromise = snapshotPromise;
    try {
      return await snapshotPromise;
    } finally {
      if (widget.snapshotPromise === snapshotPromise) widget.snapshotPromise = null;
    }
  }
  async function handleWidgetMessage(event) {
    const widget = [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])].find((item) => item.frame?.contentWindow === event.source);
    if (!widget || event.origin !== (widget.hostOrigin || location.origin) || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if (message.type === "penecho-widget-host-ready") {
      widget.hostReady = true;
      widget.resolveHostReady?.();
      widget.resolveHostReady = null;
      sendWidgetInit(widget);
      sendWidgetHostState(widget, undefined, undefined, true);
      return;
    }
    if (message.type === "penecho-widget-activate") {
      if (state.mode === "hand" && !widget.pending && state.widgets.includes(widget)) beginWidgetEdit(widget);
      return;
    }
    if (validWidgetHostDrag(message)) {
      if (message.type === "penecho-widget-drag-start") beginWidgetHostDrag(widget, message);
      else if (message.type === "penecho-widget-drag-move") {
        if (!updateWidgetHostDrag(widget, message) && message.pointerType === "touch") updateWidgetHostTouch(widget, { ...message, type:"penecho-widget-touch-move" });
      }
      else finishWidgetHostDrag(widget, message);
      return;
    }
    if (validWidgetHostTouch(message)) {
      if (message.type === "penecho-widget-touch-start") beginWidgetHostTouch(widget, message);
      else if (message.type === "penecho-widget-touch-move") updateWidgetHostTouch(widget, message);
      else finishWidgetHostTouch(widget, message);
      return;
    }
    if (validWidgetHostNavigation(message)) {
      handleWidgetHostNavigation(widget, message);
      return;
    }
    if (message.type === "penecho-widget-updated") {
      widget.contentReady = true;
      widget.resolveReady?.();
      widget.resolveReady = null;
      return;
    }
    if (!["penecho-widget-snapshot", "penecho-widget-snapshot-error"].includes(message.type)) return;
    const pending = widgetSnapshotRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    widgetSnapshotRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === "penecho-widget-snapshot-error" || typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,")) {
      pending.reject(Error(t("widgetExportFailed")));
      return;
    }
    try {
      widget.snapshotImage = await decodeWidgetSnapshot(message.dataUrl);
      pending.resolve(widget.snapshotImage);
    } catch (error) {
      pending.reject(error);
    }
  }
  function selectedWidget() {
    return state.widgets.find((widget) => widget.id === state.selectedWidgetId) || null;
  }
  function beginWidgetEdit(widget) {
    if (!widget || widget.pending) return false;
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.widgetEdit?.id === widget.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    recordWidgetsBefore();
    state.selectedWidgetId = widget.id;
    state.widgetEdit = { id:widget.id, before:widgetLayout(widget), changed:false };
    syncWidgetHostStates();
    requestInteractionLayerRender();
    return true;
  }
  function acceptWidgetEdit() {
    const edit = state.widgetEdit;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.widgetHistoryBefore = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelWidgetEdit() {
    const edit = state.widgetEdit,
      widget = edit ? state.widgets.find((item) => item.id === edit.id) : null;
    if (widget) {
      Object.assign(widget, edit.before);
      positionWidget(widget);
    }
    state.widgetHistoryBefore = null;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function widgetControlHit(widget, point, pointerType = "mouse") {
    const box = widgetBox(widget),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
      controls = [
        ...Object.entries(draftActionPoints(box, handle, false, true)).map(([hit, target]) => ({ hit, target, radius:actionRadius })),
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((item) => ({ ...item, distance:Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
        .filter((item) => item.distance <= item.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function widgetPointerHit(point, pointerType = "mouse", includeUnselected = false) {
    if (!widgetRuntimeEnabled()) return null;
    if (state.pendingWidget) {
      const hit = widgetControlHit(state.pendingWidget, point, pointerType);
      if (hit && hit !== "move") return { widget:state.pendingWidget, hit, pending:true };
      if (includeUnselected && hit === "move") return { widget:state.pendingWidget, hit, pending:true };
    }
    const selected = selectedWidget();
    if (selected && state.widgetEdit) {
      const hit = widgetControlHit(selected, point, pointerType);
      if (hit && hit !== "move") return { widget:selected, hit, pending:false };
      if (includeUnselected && hit === "move") return { widget:selected, hit, pending:false };
    }
    if (includeUnselected) {
      const widgets = visibleWidgets();
      for (let index = widgets.length - 1; index >= 0; index--) {
        const widget = widgets[index],
          box = widgetBox(widget);
        if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { widget, hit:"move", pending:false };
      }
    }
    return null;
  }
  function resizeWidgetBox(start, point, hit, minimumWidth = 300, minimumHeight = 200, limit = SIZE) {
    const contentW = start.contentW ?? start.w,
      contentH = start.contentH ?? start.h;
    if (hit === "width") {
      const displayScale = start.h / contentH,
        minimum = Math.max(minimumWidth, minimumWidth * displayScale),
        maximum = limit - start.x,
        width = Math.max(minimum, Math.min(maximum, point.x - start.x));
      return { ...start, w:width, contentW:width / displayScale };
    }
    if (hit === "height") {
      const displayScale = start.w / contentW,
        minimum = Math.max(minimumHeight, minimumHeight * displayScale),
        maximum = limit - start.y,
        height = Math.max(minimum, Math.min(maximum, point.y - start.y));
      return { ...start, h:height, contentH:height / displayScale };
    }
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min((limit - start.x) / start.w, (limit - start.y) / start.h),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginWidgetGesture(event, point, result) {
    if (!result?.widget) return false;
    if (result.hit === "accept") return (result.pending ? acceptPendingWidget() : acceptWidgetEdit()) || true;
    if (result.hit === "cancel") return (result.pending ? rejectPendingWidget() : deleteWidget(result.widget)) || true;
    if (!result.pending) beginWidgetEdit(result.widget);
    state.widgetGesture = {
      id:event.pointerId,
      widget:result.widget,
      pending:result.pending,
      hit:result.hit,
      startPoint:point,
      start:widgetLayout(result.widget),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesturePoint(gesture, point) {
    const widget = gesture.widget;
    if (gesture.hit === "move") {
      widget.x = Math.max(0, Math.min(SIZE - widget.w, gesture.start.x + point.x - gesture.startPoint.x));
      widget.y = Math.max(0, Math.min(SIZE - widget.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(widget, resizeWidgetBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(widget[key] - gesture.start[key]) > 0.01);
    positionWidget(widget);
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    return updateWidgetGesturePoint(gesture, clientPoint(event));
  }
  function validWidgetHostDrag(message) {
    return message && ["penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && ["width", "height", "resize"].includes(message.hit)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetHostTouch(message) {
    return message && ["penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && message.pointerType === "touch"
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetHostNavigation(message) {
    if (!message || !["penecho-widget-pan-start", "penecho-widget-pan-move", "penecho-widget-pan-end", "penecho-widget-wheel"].includes(message.type)) return false;
    if (message.type === "penecho-widget-wheel")
      return [message.localX, message.localY, message.deltaY].every((value) => Number.isFinite(value) && Math.abs(value) <= 10000000);
    return Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff && message.pointerType === "mouse"
      && [message.localX, message.localY, message.screenX, message.screenY].every((value) => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function widgetHostPointerId(widget, pointerId) {
    return `widget-host:${widget.id}:${pointerId}`;
  }
  function widgetHostViewportPoint(widget, message) {
    const rect = widget.frame?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x:rect.left + message.localX * rect.width / widget.contentW,
      y:rect.top + message.localY * rect.height / widget.contentH,
    };
  }
  function widgetHostTrackedPoint(anchor, message) {
    if (!anchor) return null;
    return {
      x:anchor.clientX + (message.screenX - anchor.screenX) * screenClientRatio,
      y:anchor.clientY + (message.screenY - anchor.screenY) * screenClientRatio,
    };
  }
  function calibrateScreenClientRatio(event, moved) {
    const current = { screenX:event.screenX, screenY:event.screenY, clientX:event.clientX, clientY:event.clientY };
    if (![current.screenX, current.screenY, current.clientX, current.clientY].every(Number.isFinite)) return;
    const previous = screenCalibration.get(event.pointerId);
    screenCalibration.set(event.pointerId, current);
    if (!moved || !previous) return;
    const dsX = current.screenX - previous.screenX, dsY = current.screenY - previous.screenY,
      dcX = current.clientX - previous.clientX, dcY = current.clientY - previous.clientY,
      ds2 = dsX * dsX + dsY * dsY;
    if (ds2 < 16) return;
    const candidate = (dcX * dsX + dcY * dsY) / ds2;
    if (!Number.isFinite(candidate) || candidate <= 0.25 || candidate >= 4) return;
    screenClientRatio = Math.min(4, Math.max(0.25, screenClientRatio * 0.7 + candidate * 0.3));
  }
  function releaseWidgetHostTouch(widget, pointerId) {
    const id = widgetHostPointerId(widget, pointerId);
    widgetHostPointerAnchors.delete(id);
    state.pointers.delete(id);
    state.touches.delete(id);
    if (state.panGesture?.id === id) state.panGesture = null;
    if (state.touchGesture?.ids?.includes(id)) state.touchGesture = null;
    if (!state.touches.size) setNavigating(false);
  }
  function beginWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-start") return false;
    const point = widgetHostViewportPoint(widget, message);
    if (!point) return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    state.pointers.set(id, point);
    state.touches.set(id, point);
    widgetHostPointerAnchors.set(id, { clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY });
    if (state.touches.size < 2) return true;
    state.textTap = null;
    if (state.pendingGesture) state.pendingGesture = null;
    if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
    if (state.selectedWidgetId) acceptWidgetEdit();
    if (state.animationGesture) finishAnimationGesture({ pointerId:state.animationGesture.id });
    if (state.selectedAnimationId) acceptAnimationEdit();
    finishDrawing("pen");
    beginTouchGesture();
    return true;
  }
  function updateWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-move") return false;
    const id = widgetHostPointerId(widget, message.pointerId),
      old = state.pointers.get(id),
      point = widgetHostTrackedPoint(widgetHostPointerAnchors.get(id), message) || widgetHostViewportPoint(widget, message);
    if (!old || !point || !state.touches.has(id)) return false;
    state.pointers.set(id, point);
    state.touches.set(id, point);
    if (state.touches.size >= 2) {
      if (!state.touchGesture) beginTouchGesture();
      return updateTouchGesture();
    }
    if (!state.panGesture || state.panGesture.id !== id) state.panGesture = { id, last:old };
    moveCanvas(point.x - old.x, point.y - old.y);
    state.panGesture.last = point;
    setNavigating(true);
    return true;
  }
  function finishWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-end") return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    if (!state.pointers.has(id) && !state.touches.has(id)) return false;
    state.pointers.delete(id);
    state.touches.delete(id);
    widgetHostPointerAnchors.delete(id);
    state.touchGesture = null;
    if (state.touches.size === 1) {
      const [remainingId, point] = state.touches.entries().next().value;
      state.panGesture = { id:remainingId, last:point };
    } else state.panGesture = null;
    if (!state.touches.size) setNavigating(false);
    return true;
  }
  function handleWidgetHostNavigation(widget, message) {
    if (!validWidgetHostNavigation(message)) return false;
    if (message.type === "penecho-widget-wheel") {
      const point = widgetHostViewportPoint(widget, message);
      if (!point) return false;
      zoomCanvasAt(point.x, point.y, message.deltaY);
      return true;
    }
    const id = widgetHostPointerId(widget, message.pointerId);
    if (message.type === "penecho-widget-pan-start") {
      const point = widgetHostViewportPoint(widget, message);
      if (!point || state.widgetHostPan) return false;
      if (state.selectedImageId) acceptImageEdit({ restoreMode:false });
      if (state.selectedWidgetId) acceptWidgetEdit();
      if (state.selectedAnimationId) acceptAnimationEdit();
      state.widgetHostPan = {
        id,
        widget,
        last:point,
        anchor:{ clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY },
      };
      setNavigating(true);
      return true;
    }
    const pan = state.widgetHostPan;
    if (!pan || pan.id !== id || pan.widget !== widget) return false;
    if (message.type === "penecho-widget-pan-move") {
      const point = widgetHostTrackedPoint(pan.anchor, message) || widgetHostViewportPoint(widget, message);
      if (!point) return false;
      moveCanvas(point.x - pan.last.x, point.y - pan.last.y);
      pan.last = point;
      setNavigating(true);
      return true;
    }
    state.widgetHostPan = null;
    setNavigating(false);
    return true;
  }
  function beginWidgetHostDrag(widget, message) {
    if (!validWidgetHostDrag(message) || message.type !== "penecho-widget-drag-start") return false;
    if (message.pointerType === "touch") {
      const id = widgetHostPointerId(widget, message.pointerId);
      if ([...state.touches.keys()].some((pointerId) => pointerId !== id)) return false;
      releaseWidgetHostTouch(widget, message.pointerId);
    }
    if (state.widgetGesture || state.pendingGesture || state.animationGesture || state.selectionGesture || state.drawing || state.panGesture || state.touchGesture) return false;
    const pending = widget === state.pendingWidget && widget.pending === true;
    if (!pending && (!state.widgets.includes(widget) || !beginWidgetEdit(widget))) return false;
    const viewportPoint = widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    state.widgetGesture = {
      id:widgetHostPointerId(widget, message.pointerId),
      hostPointerId:message.pointerId,
      source:"widget-host",
      widget,
      pending,
      hit:message.hit,
      startPoint:clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }),
      hostAnchor:{ clientX:viewportPoint.x, clientY:viewportPoint.y, screenX:message.screenX, screenY:message.screenY },
      start:widgetLayout(widget),
      changed:false,
    };
    setCanvasCursor(message.hit === "resize" ? "nwse-resize" : message.hit === "width" ? "ew-resize" : message.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    const viewportPoint = widgetHostTrackedPoint(gesture.hostAnchor, message) || widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    return updateWidgetGesturePoint(gesture, clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }));
  }
  function finishWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || message.type !== "penecho-widget-drag-end" || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    updateWidgetHostDrag(widget, message);
    return finishWidgetGesture({ pointerId:gesture.id });
  }
  function finishWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.widgetGesture = null;
    resetCanvasCursor();
    if (gesture.changed && !gesture.pending && state.widgetEdit?.id === gesture.widget.id) state.widgetEdit.changed = true;
    positionWidget(gesture.widget);
    requestInteractionLayerRender();
    return true;
  }
  function deleteWidget(widget) {
    if (!widget || widget.pending || !state.widgets.includes(widget)) return false;
    recordWidgetsBefore();
    unmountWidget(widget);
    state.widgets = state.widgets.filter((item) => item !== widget);
    if (state.selectedWidgetId === widget.id) {
      state.selectedWidgetId = null;
      state.widgetEdit = null;
      state.widgetGesture = null;
    }
    state.userRevision++;
    save();
    requestInteractionLayerRender();
    setStatusKey("widgetDeleted");
    return true;
  }
  function acceptPendingWidget(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    const widget = state.pendingWidget;
    if (!widget) return;
    const replacement = state.pendingWidgetReplacement;
    const pendingBefore = capturePendingHistoryState();
    if (widget.revision !== state.userRevision) {
      rejectPendingWidget(AI_CANCELLED);
      setStatusKey("canvasChanged");
      return;
    }
    recordWidgetsBefore();
    state.pendingWidget = null;
    state.pendingWidgetReplacement = null;
    widget.pending = false;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    if (replacement) {
      const index = state.widgets.indexOf(replacement.target);
      if (index < 0 || replacement.target.id !== widget.id || replacement.target.pluginId !== widget.pluginId) {
        replacement.target.hiddenForReplacement = false;
        mountWidget(replacement.target);
        resolve?.(AI_CANCELLED);
        state.widgetHistoryBefore = null;
        if (restoreMode) finishAIDraftHandMode();
        return;
      }
      state.widgets.splice(index, 1, widget);
    } else state.widgets.push(widget);
    mountWidget(widget);
    const historyEntry = save();
    if (!replacement) recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
    requestInteractionLayerRender();
    setStatusKey("merged");
    resolve?.(true);
    if (restoreMode) finishAIDraftHandMode();
  }
  function rejectPendingWidget(result = AI_REJECTED, options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false,
      updateStatus = options?.status !== false;
    const widget = state.pendingWidget;
    if (!widget) return;
    state.pendingWidget = null;
    const replacement = state.pendingWidgetReplacement;
    state.pendingWidgetReplacement = null;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    if (replacement?.target && state.widgets.includes(replacement.target)) {
      replacement.target.hiddenForReplacement = false;
      mountWidget(replacement.target);
    }
    requestInteractionLayerRender();
    if (updateStatus) setStatusKey(result === AI_CANCELLED ? "canvasChanged" : "draftRejected");
    resolve?.(result);
    if (restoreMode) finishAIDraftHandMode();
  }
  function cancelWidgetRefinement(reason = "widget-refine-cancelled", options) {
    let cancelled = false;
    if (state.activeAI?.widgetEdit) {
      supersedeActiveAI(reason);
      cancelled = true;
    }
    if (state.pendingWidgetReplacement) {
      rejectPendingWidget(AI_CANCELLED, options);
      cancelled = true;
    }
    clearWidgetRefineCandidate();
    return cancelled;
  }
  function startPendingWidget(command, revision) {
    if (state.pendingWidget || state.widgets.length >= MAX_VISIBLE_WIDGETS) return Promise.resolve(false);
    const widget = widgetRecord({ ...command, id:`widget-${state.nextWidgetId++}` });
    if (!widget || !pluginEnabled(widget.pluginId)) return Promise.resolve(false);
    widget.pending = true;
    widget.revision = revision;
    state.pendingWidget = widget;
    enterAIDraftHandMode();
    mountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey("draftReady");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function startPendingWidgetReplacement(command, target, revision) {
    if (state.pendingWidget || state.pendingWidgetReplacement || !target || !state.widgets.includes(target) || target.hiddenForReplacement || target.pluginId !== command.pluginId) return Promise.resolve(false);
    const widget = widgetRecord({
      ...command,
      id:target.id,
      x:target.x,
      y:target.y,
      w:target.w,
      h:target.h,
      contentW:target.contentW,
      contentH:target.contentH,
    });
    if (!widget || !pluginEnabled(widget.pluginId) || revision !== state.userRevision) return Promise.resolve(false);
    widget.pending = true;
    widget.revision = revision;
    target.hiddenForReplacement = true;
    unmountWidget(target);
    state.pendingWidget = widget;
    state.pendingWidgetReplacement = { target, targetId:target.id, pluginId:target.pluginId, revision };
    enterAIDraftHandMode();
    mountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey("widgetReplacementReady");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function widgetBounds(region = null) {
    let bounds = null;
    for (const widget of visibleWidgets(region)) bounds = unionLocalBounds(bounds, region ? intersection(widgetBox(widget), region) : widgetBox(widget));
    return bounds;
  }
  function drawWidgetsToContext(context, region = null) {
    for (const widget of visibleWidgets(region)) {
      if (!widget.snapshotImage) continue;
      context.drawImage(widget.snapshotImage, widget.x, widget.y, widget.w, widget.h);
    }
  }
  async function snapshotVisibleWidgets() {
    for (const widget of visibleWidgets()) await requestWidgetSnapshot(widget);
  }

  function animationBox(animation) {
    return { x: animation.x, y: animation.y, w: animation.w, h: animation.h };
  }
  function createAnimationPlayback(now = performance.now()) {
    return { playheadMs: 0, paused: false, startedAt: now };
  }
  function playbackPlayhead(scene, playback, now = performance.now()) {
    const base = Math.max(0, playback?.playheadMs || 0),
      elapsed = playback?.paused ? 0 : Math.max(0, now - (playback?.startedAt || now)),
      total = base + elapsed,
      duration = Math.max(1, scene.durationMs);
    return scene.loop ? total % duration : Math.min(duration, total);
  }
  function selectedAnimation() {
    return state.animations.find((animation) => animation.id === state.selectedAnimationId) || null;
  }
  function animationPlayhead(animation, now = performance.now()) {
    return playbackPlayhead(animation.scene, animation, now);
  }
  function pendingAnimationEntries(pending = state.pending) {
    if (!pending) return [];
    if (!pending.items) {
      if (!pending.animationScene) return [];
      pending.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: pending, pending, itemIndex: null, scene: pending.animationScene, playback: pending.animationPlayback, box: draftBounds(pending) }];
    }
    return pending.items.flatMap((item, itemIndex) => {
      if (!item.animationScene) return [];
      item.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: item, pending, itemIndex, scene: item.animationScene, playback: item.animationPlayback, box: pendingItemBounds(item) }];
    });
  }
  function pendingAnimationControlTarget() {
    const entries = pendingAnimationEntries();
    if (!entries.length) return null;
    if (!state.pending?.items) return entries[0];
    return entries.find((entry) => entry.itemIndex === state.pending.selectedIndex) || null;
  }
  function animationControlTarget() {
    const pending = pendingAnimationControlTarget();
    if (pending) return pending;
    const animation = selectedAnimation();
    return animation ? { kind: "confirmed", animation, scene: animation.scene, playback: animation, box: animationBox(animation) } : null;
  }
  function animationTargetPlayhead(target, now = performance.now()) {
    return target?.kind === "confirmed" ? animationPlayhead(target.animation, now) : playbackPlayhead(target.scene, target.playback, now);
  }
  function serializedAnimations(now = performance.now()) {
    return state.animations.map((animation) => ({
      id: animation.id,
      rendererVersion: 1,
      transform: animationBox(animation),
      scene: ANIMATION.serialize(animation.scene),
      playback: { playheadMs: animationPlayhead(animation, now), paused: Boolean(animation.paused) },
    }));
  }
  function restoreAnimations(items) {
    state.animations = [];
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    const now = performance.now(),
      usedIds = new Set();
    for (const saved of Array.isArray(items) ? items : []) {
      if (state.animations.length >= MAX_VISIBLE_ANIMATIONS) break;
      const scene = ANIMATION?.normalize(saved?.scene, SIZE),
        transform = saved?.transform;
      if (!scene || !transform || ![transform.x, transform.y, transform.w, transform.h].every(Number.isFinite) || transform.w <= 0 || transform.h <= 0 || transform.x < 0 || transform.y < 0 || transform.x + transform.w > SIZE || transform.y + transform.h > SIZE) continue;
      const playheadMs = Math.max(0, Math.min(scene.durationMs, Number(saved.playback?.playheadMs) || 0)),
        paused = Boolean(saved.playback?.paused);
      let id = typeof saved.id === "string" && saved.id.length <= 128 && !usedIds.has(saved.id) ? saved.id : "";
      const numberedId = /^animation-(\d+)$/.exec(id);
      if (numberedId) state.nextAnimationId = Math.max(state.nextAnimationId, Number(numberedId[1]) + 1);
      if (!id) {
        do id = "animation-" + state.nextAnimationId++;
        while (usedIds.has(id));
      }
      usedIds.add(id);
      state.animations.push({
        id,
        scene,
        x: transform.x,
        y: transform.y,
        w: transform.w,
        h: transform.h,
        playheadMs,
        paused,
        startedAt: now,
      });
    }
    requestAnimationLayerRender();
  }
  function recordAnimationsBefore() {
    if (!state.animationHistoryBefore) state.animationHistoryBefore = serializedAnimations();
  }
  function beginAnimationEdit(animation) {
    if (!animation) return false;
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.animationEdit?.id === animation.id) return true;
    if (state.animationEdit) acceptAnimationEdit();
    const now = performance.now();
    recordAnimationsBefore();
    state.selectedAnimationId = animation.id;
    state.animationEdit = {
      id: animation.id,
      before: {
        x: animation.x,
        y: animation.y,
        w: animation.w,
        h: animation.h,
        playheadMs: animationPlayhead(animation, now),
        paused: Boolean(animation.paused),
      },
      changed: false,
    };
    return true;
  }
  function acceptAnimationEdit() {
    const edit = state.animationEdit;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.animationHistoryBefore = null;
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelAnimationEdit() {
    const edit = state.animationEdit,
      animation = edit ? state.animations.find((item) => item.id === edit.id) : null;
    if (animation) {
      Object.assign(animation, edit.before, { startedAt: performance.now() });
    }
    state.animationHistoryBefore = null;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function addAnimation(scene, transform = scene, playback = null) {
    if (!pluginEnabled("animation") || state.animations.length >= MAX_VISIBLE_ANIMATIONS) return null;
    const normalized = ANIMATION?.normalize(scene, SIZE);
    if (!normalized) return null;
    recordAnimationsBefore();
    const now = performance.now(),
      playheadMs = playback ? playbackPlayhead(normalized, playback, now) : 0,
      paused = Boolean(playback?.paused);
    const animation = {
      id: "animation-" + state.nextAnimationId++,
      scene: normalized,
      x: transform.x,
      y: transform.y,
      w: transform.w,
      h: transform.h,
      playheadMs,
      paused,
      startedAt: now,
    };
    state.animations.push(animation);
    requestAnimationLayerRender();
    return animation;
  }
  function deleteSelectedAnimation() {
    const target = animationControlTarget();
    if (target?.kind === "pending") {
      hideAnimationControls();
      if (target.itemIndex == null) rejectPending();
      else rejectPendingItem(target.itemIndex);
      return;
    }
    const animation = selectedAnimation();
    if (!animation) return;
    recordAnimationsBefore();
    state.animations = state.animations.filter((item) => item !== animation);
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    state.userRevision++;
    save();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    setStatusKey("animationDeleted");
  }
  function toggleSelectedAnimationPlayback() {
    const target = animationControlTarget();
    if (!target) return;
    const playback = target.playback;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    const now = performance.now();
    if (playback.paused) {
      playback.paused = false;
      playback.startedAt = now;
    } else {
      playback.playheadMs = animationTargetPlayhead(target, now);
      playback.paused = true;
    }
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function restartSelectedAnimation() {
    const target = animationControlTarget();
    if (!target) return;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    target.playback.playheadMs = 0;
    target.playback.startedAt = performance.now();
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function drawAnimationInstance(context, animation, now) {
    const playhead = animationPlayhead(animation, now);
    context.save();
    context.translate(animation.x, animation.y);
    context.scale(animation.w / animation.scene.w, animation.h / animation.scene.h);
    ANIMATION.render(context, animation.scene, playhead);
    context.restore();
  }
  function visibleAnimations(region = null) {
    if (!pluginEnabled("animation")) return [];
    return state.animations.filter((animation) => !region || intersection(animationBox(animation), region));
  }
  function drawAnimationsToContext(context, region, now = performance.now()) {
    for (const animation of visibleAnimations(region)) drawAnimationInstance(context, animation, now);
  }
  function visiblePlayingAnimations(region = viewportRect()) {
    if (!pluginEnabled("animation") || document.hidden || !region) return [];
    return visibleAnimations(region).filter((animation) => !animation.paused && (animation.scene.loop || animationPlayhead(animation) < animation.scene.durationMs));
  }
  function hideAnimationControls() {
    clearTimeout(state.animationControlsTimer);
    state.animationControlsTimer = 0;
    state.animationControlsUntil = 0;
    if (!animationControls.hidden) animationControls.hidden = true;
    requestInteractionLayerRender();
  }
  function animationControlChromeVisible(target = animationControlTarget(), now = performance.now()) {
    return Boolean(pluginEnabled("animation") && target && state.animationControlsUntil > now);
  }
  function pendingAnimationChromeVisible(pending, itemIndex = null, now = performance.now()) {
    const target = pendingAnimationControlTarget();
    return Boolean(target && target.pending === pending && target.itemIndex === itemIndex && animationControlChromeVisible(target, now));
  }
  function animationEditChromeVisible(now = performance.now()) {
    const target = animationControlTarget();
    return Boolean(target?.kind === "confirmed" && state.animationEdit && selectedAnimation() && animationControlChromeVisible(target, now));
  }
  function expireAnimationControls() {
    hideAnimationControls();
    if (selectedAnimation()) acceptAnimationEdit();
  }
  function showAnimationControls(duration = ANIMATION_CONTROLS_VISIBLE_MS) {
    if (!pluginEnabled("animation") || !animationControlTarget()) {
      hideAnimationControls();
      return;
    }
    clearTimeout(state.animationControlsTimer);
    state.animationControlsUntil = performance.now() + duration;
    if (animationControls.hidden) animationControls.hidden = false;
    positionAnimationControls();
    state.animationControlsTimer = setTimeout(expireAnimationControls, duration);
  }
  function positionAnimationControls() {
    const target = animationControlTarget();
    if (!pluginEnabled("animation") || !target) {
      if (!animationControls.hidden) animationControls.hidden = true;
      return;
    }
    if (performance.now() >= state.animationControlsUntil) {
      if (!animationControls.hidden) animationControls.hidden = true;
      if (target.kind === "confirmed") acceptAnimationEdit();
      return;
    }
    const rect = view.getBoundingClientRect(),
      box = target.box,
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      controlsWidth = animationControls.offsetWidth || 210,
      controlsHeight = animationControls.offsetHeight || 36,
      editControlsClearance = 28,
      controlsStyle = runtimeElementStyle(animationControls, "animation-controls"),
      x = Math.max(8, Math.min(rect.width - controlsWidth - 8, left + width / 2 - controlsWidth / 2)),
      y = top - controlsHeight - editControlsClearance >= 8 ? top - controlsHeight - editControlsClearance : Math.min(rect.height - controlsHeight - 8, top + box.h * state.scale + editControlsClearance),
      nextX = Math.round(x) + "px",
      nextY = Math.round(y) + "px",
      nextLabel = t(target.playback.paused ? "animationPlay" : "animationPause");
    if (animationControls.hidden) animationControls.hidden = false;
    if (controlsStyle?.getPropertyValue("--animation-controls-x") !== nextX) controlsStyle?.setProperty("--animation-controls-x", nextX);
    if (controlsStyle?.getPropertyValue("--animation-controls-y") !== nextY) controlsStyle?.setProperty("--animation-controls-y", nextY);
    if (animationPlayPause.textContent !== nextLabel) animationPlayPause.textContent = nextLabel;
  }
  function animationScreenBox(animation, padding = 3) {
    const box = animationBox(animation);
    return {
      x: state.panX + box.x * state.scale - padding,
      y: state.panY + box.y * state.scale - padding,
      w: box.w * state.scale + padding * 2,
      h: box.h * state.scale + padding * 2,
    };
  }
  function sameAnimationScreenBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function clippedScreenBox(box, rect) {
    const left = Math.max(0, box.x),
      top = Math.max(0, box.y),
      right = Math.min(rect.width, box.x + box.w),
      bottom = Math.min(rect.height, box.y + box.h);
    return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null;
  }
  function mergeAnimationDirtyRects(rects) {
    const merged = [];
    for (const rect of rects) {
      let next = rect;
      for (let index = merged.length - 1; index >= 0; index--) {
        const prior = merged[index],
          touches = next.x <= prior.x + prior.w && next.x + next.w >= prior.x && next.y <= prior.y + prior.h && next.y + next.h >= prior.y;
        if (!touches) continue;
        next = unionLocalBounds(next, prior);
        merged.splice(index, 1);
      }
      merged.push(next);
    }
    return merged;
  }
  function drawAnimationScreenRegion(screenRegion, now) {
    const logicalRegion = {
      x: (screenRegion.x - state.panX) / state.scale,
      y: (screenRegion.y - state.panY) / state.scale,
      w: screenRegion.w / state.scale,
      h: screenRegion.h / state.scale,
    };
    animationCtx.save();
    animationCtx.beginPath();
    animationCtx.rect(screenRegion.x, screenRegion.y, screenRegion.w, screenRegion.h);
    animationCtx.clip();
    animationCtx.translate(state.panX, state.panY);
    animationCtx.scale(state.scale, state.scale);
    animationCtx.beginPath();
    animationCtx.rect(0, 0, SIZE, SIZE);
    animationCtx.clip();
    drawAnimationsToContext(animationCtx, logicalRegion, now);
    animationCtx.restore();
  }
  function clearAnimationLayer() {
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect();
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    animationCtx.clearRect(0, 0, rect.width, rect.height);
    state.animationScreenBoxes.clear();
    state.animationRenderedPlayheads.clear();
    state.animationFullRedraw = true;
  }
  function renderAnimationLayer(now = performance.now()) {
    if (!pluginEnabled("animation")) {
      clearAnimationLayer();
      return;
    }
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect(),
      visible = viewportRect(),
      animations = visibleAnimations(visible),
      currentBoxes = new Map(animations.map((animation) => [animation.id, animationScreenBox(animation)])),
      currentPlayheads = new Map(animations.map((animation) => [animation.id, animationPlayhead(animation, now)]));
    let dirty = [];
    if (state.animationFullRedraw) dirty.push({ x: 0, y: 0, w: rect.width, h: rect.height });
    else {
      for (const [id, oldBox] of state.animationScreenBoxes) {
        const nextBox = currentBoxes.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox)) dirty.push(oldBox);
      }
      for (const [id, nextBox] of currentBoxes) {
        const oldBox = state.animationScreenBoxes.get(id),
          previousPlayhead = state.animationRenderedPlayheads.get(id),
          nextPlayhead = currentPlayheads.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox) || previousPlayhead === undefined || Math.abs(previousPlayhead - nextPlayhead) > 0.01) dirty.push(nextBox);
      }
    }
    dirty = mergeAnimationDirtyRects(dirty.map((box) => clippedScreenBox(box, rect)).filter(Boolean));
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    for (const region of dirty) {
      animationCtx.clearRect(region.x, region.y, region.w, region.h);
      drawAnimationScreenRegion(region, now);
    }
    state.animationScreenBoxes = currentBoxes;
    state.animationRenderedPlayheads = currentPlayheads;
    state.animationFullRedraw = false;
  }
  function animationFrameStep(now) {
    state.animationFrame = 0;
    const playing = visiblePlayingAnimations(),
      pendingAnimations = pendingAnimationEntries(),
      pendingPlaying = pendingAnimations.filter((entry) => !document.hidden && !entry.playback.paused && (entry.scene.loop || animationTargetPlayhead(entry, now) < entry.scene.durationMs)),
      renderObjectCount = playing.reduce((sum, animation) => sum + animation.scene.objects.length, 0) + pendingPlaying.reduce((sum, entry) => sum + entry.scene.objects.length, 0),
      minimumFrameMs = 1000 / (renderObjectCount > 24 ? 30 : 60);
    if (!playing.length && !pendingPlaying.length || now - state.animationLastFrame >= minimumFrameMs - 0.5) {
      state.animationLastFrame = now;
      renderAnimationLayer(now);
      if (pendingAnimations.length) renderInteractionLayer();
    }
    if (playing.length || pendingPlaying.length) state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function requestAnimationLayerRender() {
    if (!pluginEnabled("animation") || state.animationFrame || document.hidden) return;
    state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function stopAnimationFrames() {
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
  function requestRender() {
    requestAnimationLayerRender();
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }
  function requestInteractionLayerRender() {
    if (state.interactionRenderQueued) return;
    state.interactionRenderQueued = true;
    requestAnimationFrame(() => {
      state.interactionRenderQueued = false;
      renderInteractionLayer();
    });
  }
  function forTiles(x, y, w, h, fn, create = true) {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((x + w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((y + h) / TILE) - 1);
    if (x1 < x0 || y1 < y0) return;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const c = tile(tx, ty, create);
        if (c) fn(c, tx, ty);
      }
  }
  function fit() {
    const r = view.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    screen.width = Math.round(r.width * d);
    screen.height = Math.round(r.height * d);
    animationLayer.width = screen.width;
    animationLayer.height = screen.height;
    inkLayer.width = screen.width;
    inkLayer.height = screen.height;
    interactionLayer.width = screen.width;
    interactionLayer.height = screen.height;
    state.animationFullRedraw = true;
    if (!state.viewInitialized && r.width > 0 && r.height > 0) {
      state.scale = Math.max(0.03, Math.min(2, Math.max(r.width, r.height) / 10000 * INITIAL_VIEW_ZOOM));
      state.panX = (r.width - SIZE * state.scale) / 2;
      state.panY = (r.height - SIZE * state.scale) / 2;
      state.viewInitialized = true;
    }
    updateCoordinates();
    requestRender();
  }
  function renderInkLayer(region = null) {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect(),
      visible = region || {
        x:Math.max(0, -state.panX / state.scale),
        y:Math.max(0, -state.panY / state.scale),
        w:Math.min(SIZE, (r.width - state.panX) / state.scale) - Math.max(0, -state.panX / state.scale),
        h:Math.min(SIZE, (r.height - state.panY) / state.scale) - Math.max(0, -state.panY / state.scale),
      };
    inkCtx.setTransform(d, 0, 0, d, 0, 0);
    inkCtx.clearRect(0, 0, r.width, r.height);
    if (visible.w <= 0 || visible.h <= 0) return;
    inkCtx.save();
    inkCtx.translate(state.panX, state.panY);
    inkCtx.scale(state.scale, state.scale);
    inkCtx.beginPath();
    inkCtx.rect(0, 0, SIZE, SIZE);
    inkCtx.clip();
    forTiles(visible.x, visible.y, visible.w, visible.h, (canvas, tx, ty) => inkCtx.drawImage(canvas, tx * TILE, ty * TILE), false);
    drawSharpOverlays(inkCtx, visible);
    inkCtx.restore();
  }
  function updateCoordinates() {
    const r = view.getBoundingClientRect(),
      x = (r.width / 2 - state.panX) / state.scale,
      y = (r.height / 2 - state.panY) / state.scale;
    coords.textContent = `x ${Math.round(x)} · y ${Math.round(y)} · ${Math.round(state.scale * 100)}%`;
  }
  function render() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = state.paint.outside;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);
    ctx.fillStyle = state.paint.paper;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const l = Math.max(0, -state.panX / state.scale),
      t = Math.max(0, -state.panY / state.scale),
      rr = Math.min(SIZE, (r.width - state.panX) / state.scale),
      b = Math.min(SIZE, (r.height - state.panY) / state.scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();
    if (state.gridVisible) {
      ctx.strokeStyle = state.paint.paperGrid;
      ctx.lineWidth = 1 / state.scale;
      ctx.beginPath();
      for (let x = Math.floor(l / 500) * 500; x < rr; x += 500) {
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
      }
      for (let y = Math.floor(t / 500) * 500; y < b; y += 500) {
        ctx.moveTo(l, y);
        ctx.lineTo(rr, y);
      }
      ctx.stroke();
    }
    drawImagesToContext(ctx, { x:l, y:t, w:rr - l, h:b - t });
    drawTextBoxesToContext(ctx, { x:l, y:t, w:rr - l, h:b - t });
    ctx.restore();
    ctx.strokeStyle = state.paint.border;
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.restore();
    renderInkLayer({ x:l, y:t, w:rr - l, h:b - t });
    renderInteractionLayer();
    positionWidgets();
    positionTextEditors();
    updateSelectionToolbar();
  }
  function drawSelectedAnimation(context) {
    const selected = pluginEnabled("animation") && animationEditChromeVisible() ? selectedAnimation() : null;
    if (!selected) return;
    const box = animationBox(selected),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function drawHandModeOutlines(context) {
    if (state.mode !== "hand") return;
    const unit = 1 / state.scale,
      boxes = [
        ...visibleImages().map(imageBox),
        ...visibleAnimations().map(animationBox),
        ...visibleTextBoxes().map(textBoxBox),
        ...visibleWidgets().map(widgetBox),
      ];
    if (!boxes.length) return;
    context.save();
    context.globalAlpha = 0.42;
    context.strokeStyle = "#2679b8";
    context.lineWidth = unit;
    context.setLineDash([4 * unit, 5 * unit]);
    for (const box of boxes) context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function drawWidgetChrome(context) {
    if (!widgetRuntimeEnabled()) return;
    const widget = state.pendingWidget || (state.widgetEdit ? selectedWidget() : null);
    if (!widget) return;
    const box = widgetBox(widget),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = widget.pending ? "#72b7e5" : "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function positionImageEditBar() {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) {
      if (!imageEditBar.hidden) imageEditBar.hidden = true;
      return;
    }
    if (imageEditBar.hidden) imageEditBar.hidden = false;
    const rect = view.getBoundingClientRect(),
      box = imageBox(item),
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      height = box.h * state.scale,
      barWidth = imageEditBar.offsetWidth || 200,
      barHeight = imageEditBar.offsetHeight || 210,
      gap = 12,
      style = runtimeElementStyle(imageEditBar, "image-edit-bar");
    let x = left + width + gap;
    if (x + barWidth > rect.width - 8) x = left - barWidth - gap;
    if (x < 8) x = Math.max(8, Math.min(rect.width - barWidth - 8, left + width / 2 - barWidth / 2));
    const y = Math.max(8, Math.min(rect.height - barHeight - 8, top + height / 2 - barHeight / 2));
    style?.setProperty("--image-edit-bar-x", `${x.toFixed(1)}px`);
    style?.setProperty("--image-edit-bar-y", `${y.toFixed(1)}px`);
  }
  function drawImageChrome(context) {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) return;
    const box = imageBox(item),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function pointDistanceToWidget(point, widget) {
    const box = widgetBox(widget),
      dx = point.x < box.x ? box.x - point.x : point.x > box.x + box.w ? point.x - box.x - box.w : 0,
      dy = point.y < box.y ? box.y - point.y : point.y > box.y + box.h ? point.y - box.y - box.h : 0;
    return Math.hypot(dx, dy);
  }
  function strokeWidgetProximity(widget, drawing) {
    if (!drawing || drawing.erase) return null;
    const points = [...drawing.trail];
    if (drawing.last && points.at(-1) !== drawing.last) points.push(drawing.last);
    if (!points.length) return null;
    let distance = Infinity,
      hits = 0;
    for (const point of points) {
      const next = pointDistanceToWidget(point, widget) * state.scale;
      distance = Math.min(distance, next);
      if (next <= 48) hits++;
    }
    return distance <= 48 ? { distance, hits } : null;
  }
  function clearWidgetRefineCandidate() {
    state.widgetRefineCandidate = null;
    requestInteractionLayerRender();
  }
  function dismissWidgetRefineCandidate() {
    clearWidgetRefineCandidate();
  }
  function latchWidgetRefineCandidate(drawing) {
    if (state.widgetRefineCandidate || state.mode === "hand" || state.pending || state.pendingWidget || state.pendingWidgetReplacement) return state.widgetRefineCandidate;
    const candidates = [];
    for (const widget of visibleWidgets()) {
      if (!widget.shell || widget.renderActive === false || widget.pending) continue;
      const dirty = strokeWidgetProximity(widget, drawing);
      if (!dirty) continue;
      candidates.push({
        widget,
        widgetId:widget.id,
        instructionMode:"nearby-dirty",
        distance:dirty.distance,
        hits:dirty.hits,
      });
    }
    candidates.sort((a, b) => a.distance - b.distance || b.hits - a.hits || state.widgets.indexOf(b.widget) - state.widgets.indexOf(a.widget));
    state.widgetRefineCandidate = candidates[0] || null;
    if (state.widgetRefineCandidate) requestInteractionLayerRender();
    return state.widgetRefineCandidate;
  }
  function currentWidgetRefineCandidate() {
    const candidate = state.widgetRefineCandidate;
    if (!candidate || state.mode === "hand") return null;
    if (!state.widgets.includes(candidate.widget) || candidate.widget.hiddenForReplacement || candidate.widget.pending || candidate.widget.renderActive === false) {
      state.widgetRefineCandidate = null;
      return null;
    }
    return candidate;
  }
  async function copyWidgetSource(widget) {
    if (!widget || typeof widget.copyText !== "string" || !widget.copyText) return false;
    const copied = await writeClipboardText(widget.copyText);
    setStatusKey(copied ? "widgetSourceCopied" : "widgetSourceCopyFailed");
    return copied;
  }
  function widgetEditContext(widget, instructionMode) {
    return {
      mode:"replace",
      widgetType:widget.widgetType,
      pluginId:widget.pluginId,
      title:widget.title,
      instructionMode,
      box:widgetBox(widget),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.widgetType !== "diagram_source" && widget.copyText ? { source:widget.copyText, copyLabel:widget.copyLabel } : {}),
    };
  }
  async function requestWidgetRefinement(widget, instructionMode) {
    if (!widget || state.mode === "hand" || !state.widgets.includes(widget) || widget.hiddenForReplacement || state.pendingWidget || state.pendingWidgetReplacement) return false;
    const revision = state.userRevision;
    clearWidgetRefineCandidate();
    supersedeActiveAI("widget-refine");
    setStatusKey("widgetRefining");
    try {
      await requestWidgetSnapshot(widget);
    } catch (error) {
      if (state.userRevision === revision) setStatus(`${t("aiError")}${error.message}`);
      return false;
    }
    if (state.userRevision !== revision || !state.widgets.includes(widget) || widget.hiddenForReplacement) return false;
    void requestAI("answer", null, {
      captureCurrentViewport:true,
      widgetEditTarget:widget,
      widgetEditContext:widgetEditContext(widget, instructionMode),
    });
    return true;
  }
  const OBJECT_CHROME_ICONS = Object.freeze({
    move:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9V3M9 6l3-3 3 3M12 15v6M9 18l3 3 3-3M9 12H3M6 9l-3 3 3 3M15 12h6M18 9l3 3-3 3"/></svg>',
    accept:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    cancel:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    refine:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>',
  });
  function screenObjectBox(box) {
    return {
      left:state.panX + box.x * state.scale,
      top:state.panY + box.y * state.scale,
      width:box.w * state.scale,
      height:box.h * state.scale,
    };
  }
  function widgetToolLabelWidth(label, minimum = 108) {
    return Math.max(minimum, Math.min(220, 44 + String(label || "").length * 7.2));
  }
  function addWidgetToolSpecs(specs, widget, options = {}) {
    if (!widget) return;
    const box = widgetBox(widget),
      items = [];
    if (options.copy && widget.copyText) items.push({
      key:`widget:${widget.id}:tool-copy`,
      kind:"copy",
      label:widget.copyLabel || (widget.sourceFormat ? `Copy ${widget.sourceFormat}` : t("copyText")),
      baseWidth:widgetToolLabelWidth(widget.copyLabel || `Copy ${widget.sourceFormat || "source"}`, 118),
      activate:() => void copyWidgetSource(widget),
    });
    if (options.refine) items.push({
      key:`widget:${widget.id}:tool-refine`,
      kind:"refine",
      label:t("widgetRefine"),
      baseWidth:112,
      activate:() => void requestWidgetRefinement(widget, options.refine.instructionMode),
    });
    if (!items.length) return;
    const gap = 4,
      groupBaseWidth = items.reduce((sum, item) => sum + item.baseWidth, 0) + gap * (items.length - 1),
      controlScale = 1,
      widgetToolGroup = `widget-${widget.id}`;
    let groupOffset = 0;
    for (const item of items) {
      specs.push({
        ...item,
        box,
        widget,
        widgetTool:true,
        widgetToolGroup,
        groupBaseWidth,
        groupOffset,
        controlScale,
        baseHeight:34,
        priority:6,
      });
      groupOffset += item.baseWidth + gap;
    }
  }
  function objectChromePosition(box, kind, ignoreKey = "", spec = null) {
    const baseWidth = spec?.baseWidth || (kind === "move" ? 34 : kind === "refine" ? 112 : 36),
      baseHeight = spec?.baseHeight || 34,
      controlScale = spec?.controlScale || 1,
      width = baseWidth * controlScale,
      height = baseHeight * controlScale,
      viewportWidth = view.clientWidth,
      viewportHeight = view.clientHeight,
      screenBox = screenObjectBox(box),
      right = screenBox.left + screenBox.width,
      bottom = screenBox.top + screenBox.height,
      chromeGap = 7;
    if (viewportWidth <= 0 || viewportHeight <= 0 || right < -8 || bottom < -8 || screenBox.left > viewportWidth + 8 || screenBox.top > viewportHeight + 8) return null;
    const clampX = (value) => Math.max(6, Math.min(Math.max(6, viewportWidth - width - 6), value)),
      clampY = (value) => Math.max(6, Math.min(Math.max(6, viewportHeight - height - 6), value)),
      above = screenBox.top - height - chromeGap,
      y = clampY(above >= 6 ? above : screenBox.top + chromeGap);
    if (spec?.widgetTool) {
      const groupWidth = spec.groupBaseWidth * controlScale,
        groupHeight = height,
        gap = chromeGap * controlScale,
        clampGroupX = (value) => Math.max(6, Math.min(Math.max(6, viewportWidth - groupWidth - 6), value)),
        clampGroupY = (value) => Math.max(6, Math.min(Math.max(6, viewportHeight - groupHeight - 6), value)),
        positions = [
          { x:right - groupWidth, y:screenBox.top - groupHeight - gap },
          { x:right + gap, y:screenBox.top },
          { x:right + gap, y:screenBox.top + screenBox.height / 2 - groupHeight / 2 },
          { x:right - groupWidth, y:bottom + gap },
          { x:screenBox.left, y:bottom + gap },
          { x:screenBox.left - groupWidth - gap, y:screenBox.top + screenBox.height / 2 - groupHeight / 2 },
        ].map(position => ({ x:clampGroupX(position.x), y:clampGroupY(position.y) })),
        viewRect = view.getBoundingClientRect(),
        obstacles = [...document.querySelectorAll(".top-row, .toolbar, .animation-controls:not([hidden]), .image-edit-bar:not([hidden]), .selection-context-toolbar, .text-editor, .ai-embodiment, .object-chrome-button")]
          .filter(element => element.dataset.objectChromeKey !== ignoreKey && element.dataset.widgetToolGroup !== spec.widgetToolGroup)
          .map(element => {
          const rect = element.getBoundingClientRect();
          return { x:rect.left - viewRect.left, y:rect.top - viewRect.top, w:rect.width, h:rect.height };
        }),
        overlapsObstacle = position => obstacles.some(obstacle => position.x < obstacle.x + obstacle.w + 5 && position.x + groupWidth + 5 > obstacle.x && position.y < obstacle.y + obstacle.h + 5 && position.y + groupHeight + 5 > obstacle.y),
        groupPosition = positions.find(position => !overlapsObstacle(position)) || positions[0];
      return {
        x:groupPosition.x + spec.groupOffset * controlScale,
        y:groupPosition.y,
        scale:controlScale,
        baseWidth,
        baseHeight,
      };
    }
    let x;
    if (kind === "move") x = clampX(screenBox.left + screenBox.width / 2 - width / 2);
    else if (kind === "cancel") x = clampX(screenBox.left - width - 7);
    else if (kind === "accept") x = clampX(right + 7);
    else x = clampX(screenBox.left + screenBox.width / 2 + 38);
    return { x, y, scale:1, baseWidth, baseHeight };
  }
  function objectChromeLabel(kind, spec = null) {
    if (spec?.label) return spec.label;
    if (kind === "accept") return t("widgetAccept");
    if (kind === "cancel") return t("cancel");
    if (kind === "copy") return t("copyText");
    if (kind === "refine") return t("widgetRefine");
    return t("hand");
  }
  function beginObjectChromeMove(event, spec) {
    if (state.mode !== "hand" || Number(event.button) !== 0) return false;
    const point = clientPoint(event);
    let started = false;
    if (spec.target === "pending") {
      beginPendingGesture(event, "move", spec.itemIndex);
      started = true;
    } else if (spec.target === "pending-widget") {
      started = beginWidgetGesture(event, point, { widget:spec.object, hit:"move", pending:true });
    } else if (spec.target === "widget") {
      started = beginWidgetGesture(event, point, { widget:spec.object, hit:"move", pending:false });
    } else if (spec.target === "image") {
      started = beginImageGesture(event, point, { image:spec.object, hit:"move" });
    } else if (spec.target === "animation") {
      started = beginAnimationGesture(event, point, { animation:spec.object, hit:"move" });
    }
    if (!started) return false;
    try { objectChromeLayer.setPointerCapture(event.pointerId); } catch {}
    return true;
  }
  function finishObjectChromeGesture(event) {
    if (state.pendingGesture?.id === event.pointerId && !state.pendingGesture.copy) {
      state.pendingGesture = null;
      resetCanvasCursor();
      requestRender();
      return true;
    }
    if (state.widgetGesture?.id === event.pointerId) return finishWidgetGesture(event);
    if (state.imageGesture?.id === event.pointerId) return finishImageGesture(event);
    if (state.animationGesture?.id === event.pointerId) return finishAnimationGesture(event);
    return false;
  }
  function createObjectChromeButton(key, kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `object-chrome-button ${kind}`;
    button.dataset.objectChromeKey = key;
    button.innerHTML = ["copy", "refine"].includes(kind) ? `${OBJECT_CHROME_ICONS[kind]}<span></span>` : OBJECT_CHROME_ICONS[kind];
    ensureObjectChromeStyleRule(button);
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (kind !== "move") return;
      event.preventDefault();
      beginObjectChromeMove(event, button.penechoSpec);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind !== "move") button.penechoSpec?.activate?.();
    });
    objectChromeLayer.append(button);
    objectChromeButtons.set(key, button);
    return button;
  }
  function ensureObjectChromeStyleRule(button) {
    if (!button || button.penechoStyleRule) return button?.penechoStyleRule || null;
    const sheet = textEditorStyleSheet(),
      className = button.penechoStyleClass || `object-chrome-position-${nextObjectChromeStyleId++}`;
    button.penechoStyleClass = className;
    button.classList.add(className);
    if (!sheet) return null;
    try {
      sheet.insertRule(`.${className} { --object-control-x: 0px; --object-control-y: 0px; z-index: 1; }`, sheet.cssRules.length);
      button.penechoStyleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      button.penechoStyleRule = null;
    }
    return button.penechoStyleRule;
  }
  function removeObjectChromeStyleRule(button) {
    const rule = button?.penechoStyleRule,
      sheet = textEditorStyleSheet();
    if (!rule || !sheet) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    button.penechoStyleRule = null;
  }
  function pendingChromeSpecs(specs, pending) {
    if (!pending) return;
    const add = (key, box, itemIndex = null, target = pending) => {
      specs.push({ key:`${key}:move`, kind:"move", box, target:"pending", itemIndex, object:target, priority:4 });
      specs.push({ key:`${key}:cancel`, kind:"cancel", box, activate:() => itemIndex === null ? rejectPending() : rejectPendingItem(itemIndex), priority:5 });
      specs.push({ key:`${key}:accept`, kind:"accept", box, activate:() => itemIndex === null ? acceptPending() : acceptPendingItem(itemIndex), priority:5 });
      if (pendingCopyable(target)) specs.push({ key:`${key}:copy`, kind:"copy", box, activate:() => void copyPendingText(itemIndex), priority:5 });
    };
    if (pending.items) pending.items.forEach((item, index) => add(`pending-item:${index}`, pendingItemBounds(item), index, item));
    else add("pending", draftBounds(pending));
  }
  function objectChromeSpecs() {
    if (state.mode !== "hand") {
      const specs = [],
        candidate = currentWidgetRefineCandidate();
      if (candidate) addWidgetToolSpecs(specs, candidate.widget, { refine:candidate });
      return specs;
    }
    const specs = [];
    for (const image of visibleImages()) specs.push({ key:`image:${image.id}:move`, kind:"move", box:imageBox(image), target:"image", object:image, priority:1 });
    for (const animation of visibleAnimations()) specs.push({ key:`animation:${animation.id}:move`, kind:"move", box:animationBox(animation), target:"animation", object:animation, priority:1 });
    for (const widget of visibleWidgets()) specs.push({ key:`widget:${widget.id}:move`, kind:"move", box:widgetBox(widget), target:"widget", object:widget, priority:2 });
    if (state.animationEdit) {
      const animation = selectedAnimation();
      if (animation) {
        const box = animationBox(animation);
        specs.push({ key:`animation:${animation.id}:cancel`, kind:"cancel", box, activate:cancelAnimationEdit, priority:3 });
        specs.push({ key:`animation:${animation.id}:accept`, kind:"accept", box, activate:acceptAnimationEdit, priority:3 });
      }
    }
    if (state.widgetEdit) {
      const widget = selectedWidget();
      if (widget) {
        const box = widgetBox(widget);
        specs.push({ key:`widget:${widget.id}:cancel`, kind:"cancel", box, activate:() => deleteWidget(widget), priority:3 });
        specs.push({ key:`widget:${widget.id}:accept`, kind:"accept", box, activate:acceptWidgetEdit, priority:3 });
        addWidgetToolSpecs(specs, widget, { copy:true });
      }
    }
    pendingChromeSpecs(specs, state.pending);
    if (state.pendingWidget) {
      const widget = state.pendingWidget,
        box = widgetBox(widget);
      specs.push({ key:`pending-widget:${widget.id}:move`, kind:"move", box, target:"pending-widget", object:widget, priority:4 });
      specs.push({ key:`pending-widget:${widget.id}:cancel`, kind:"cancel", box, activate:rejectPendingWidget, priority:5 });
      specs.push({ key:`pending-widget:${widget.id}:accept`, kind:"accept", box, activate:acceptPendingWidget, priority:5 });
      addWidgetToolSpecs(specs, widget, { copy:true });
    }
    return specs;
  }
  function syncObjectChrome() {
    if (!objectChromeLayer) return;
    const active = new Set();
    for (const spec of objectChromeSpecs()) {
      const button = objectChromeButtons.get(spec.key) || createObjectChromeButton(spec.key, spec.kind),
        position = objectChromePosition(spec.box, spec.kind, spec.key, spec);
      if (!position) continue;
      active.add(spec.key);
      const label = objectChromeLabel(spec.kind, spec),
        declaration = (button.penechoStyleRule || ensureObjectChromeStyleRule(button))?.["style"];
      button.penechoSpec = spec;
      button.classList.toggle("widget-tool", Boolean(spec.widgetTool));
      button.classList.toggle("solo-widget-tool", Boolean(spec.widgetTool && spec.groupBaseWidth === spec.baseWidth));
      if (spec.widgetToolGroup) button.dataset.widgetToolGroup = spec.widgetToolGroup;
      else delete button.dataset.widgetToolGroup;
      button.setAttribute("aria-label", label);
      button.title = spec.kind === "refine" ? t("widgetRefineHint") : label;
      if (["copy", "refine"].includes(spec.kind)) button.querySelector("span").textContent = label;
      declaration?.setProperty("--object-control-x", `${position.x.toFixed(1)}px`);
      declaration?.setProperty("--object-control-y", `${position.y.toFixed(1)}px`);
      declaration?.setProperty("--object-control-scale", String(position.scale || 1));
      declaration?.setProperty("--object-control-width", `${position.baseWidth}px`);
      declaration?.setProperty("--object-control-height", `${position.baseHeight}px`);
      declaration?.setProperty("z-index", String(spec.priority || 1));
    }
    for (const [key, button] of objectChromeButtons) {
      if (active.has(key)) continue;
      removeObjectChromeStyleRule(button);
      button.remove();
      objectChromeButtons.delete(key);
    }
  }
  objectChromeLayer?.addEventListener("pointermove", (event) => {
    if (state.pendingGesture?.id === event.pointerId) updatePendingGesture(event);
    else if (state.widgetGesture?.id === event.pointerId) updateWidgetGesture(event);
    else if (state.imageGesture?.id === event.pointerId) updateImageGesture(event);
    else if (state.animationGesture?.id === event.pointerId) updateAnimationGesture(event);
  });
  objectChromeLayer?.addEventListener("pointerup", finishObjectChromeGesture);
  objectChromeLayer?.addEventListener("pointercancel", finishObjectChromeGesture);
  function drawPointerPreview(context) {
    const preview = state.pointerPreview;
    if (!preview || state.mode !== "eraser" || !valid(preview)) return;
    const radius = logicalWidth(state.eraser) / 2,
      unit = 1 / state.scale;
    context.save();
    context.strokeStyle = `${state.inkColor}cc`;
    context.lineWidth = 1.2 * unit;
    context.setLineDash([3.5 * unit, 3 * unit]);
    context.beginPath();
    context.arc(preview.x, preview.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  function renderInteractionLayer() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    interactionCtx.setTransform(d, 0, 0, d, 0, 0);
    interactionCtx.clearRect(0, 0, r.width, r.height);
    interactionCtx.save();
    interactionCtx.translate(state.panX, state.panY);
    interactionCtx.scale(state.scale, state.scale);
    interactionCtx.beginPath();
    interactionCtx.rect(0, 0, SIZE, SIZE);
    interactionCtx.clip();
    if (state.drawing?.preview) drawPreview(state.drawing.preview, interactionCtx);
    drawPointerPreview(interactionCtx);
    if (state.selection) drawSelection(state.selection, interactionCtx);
    drawHandModeOutlines(interactionCtx);
    drawSelectedAnimation(interactionCtx);
    if (state.pending) {
      interactionCtx.save();
      interactionCtx.globalAlpha = 1 - (state.pending.fadeProgress || 0);
      drawPending(state.pending, interactionCtx);
      interactionCtx.restore();
    }
    drawWidgetChrome(interactionCtx);
    drawImageChrome(interactionCtx);
    interactionCtx.restore();
    positionAnimationControls();
    positionImageEditBar();
    syncObjectChrome();
  }
  function clientPoint(e) {
    const r = view.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - state.panX) / state.scale,
      y: (e.clientY - r.top - state.panY) / state.scale,
    };
  }
  function blockCanvasInput(duration = 1000) {
    state.textInputBlockedUntil = Math.max(state.textInputBlockedUntil, Date.now() + duration);
    resetCanvasCursor();
  }
  function mergeDirtyBox(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = { ...box };
      return;
    }
    const right = Math.max(state.dirty.x + state.dirty.w, box.x + box.w),
      bottom = Math.max(state.dirty.y + state.dirty.h, box.y + box.h);
    state.dirty = {
      x: Math.min(state.dirty.x, box.x),
      y: Math.min(state.dirty.y, box.y),
      w: right - Math.min(state.dirty.x, box.x),
      h: bottom - Math.min(state.dirty.y, box.y),
    };
  }
  function textEditorScreenPoint(editor) {
    return { left: editor.x * state.scale + state.panX, top: editor.y * state.scale + state.panY };
  }
  function textEditorViewportSize() {
    const rect = view.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function resizeTextEditorDimensions(gesture, hit, dx, dy, minWidth, minHeight, maxWidth, maxHeight) {
    const startWidth = gesture.startWidth,
      startHeight = gesture.startHeight,
      startFontCss = gesture.startFontCss;
    if (hit === "width") {
      return { widthCss: Math.max(minWidth, Math.min(maxWidth, startWidth + dx)), heightCss: startHeight, fontCss: startFontCss };
    }
    if (hit === "height") {
      return { widthCss: startWidth, heightCss: Math.max(minHeight, Math.min(maxHeight, startHeight + dy)), fontCss: startFontCss };
    }
    const minimumScale = Math.max(minWidth / startWidth, minHeight / startHeight),
      maximumScale = Math.max(minimumScale, Math.min(maxWidth / startWidth, maxHeight / startHeight)),
      requestedScale = Math.max((startWidth + dx) / startWidth, (startHeight + dy) / startHeight),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { widthCss: startWidth * scale, heightCss: startHeight * scale, fontCss: startFontCss * scale };
  }
  function keepTextEditorInsideCanvas(editor) {
    const logicalWidth = editor.widthCss / Math.max(0.03, state.scale),
      logicalHeight = editor.heightCss / Math.max(0.03, state.scale);
    editor.x = Math.max(0, Math.min(SIZE - logicalWidth, editor.x));
    editor.y = Math.max(0, Math.min(SIZE - logicalHeight, editor.y));
  }
  function keepTextEditorVisible(editor) {
    const viewport = textEditorViewportSize(),
      inset = 8,
      scale = Math.max(0.03, state.scale),
      point = textEditorScreenPoint(editor),
      maxLeft = Math.max(inset, viewport.width - editor.widthCss - inset),
      maxTop = Math.max(inset, viewport.height - editor.heightCss - inset),
      canvasLeft = state.panX,
      canvasTop = state.panY,
      canvasRight = state.panX + SIZE * scale - editor.widthCss,
      canvasBottom = state.panY + SIZE * scale - editor.heightCss,
      minLeft = Math.max(inset, canvasLeft),
      minTop = Math.max(inset, canvasTop),
      boundedMaxLeft = Math.min(maxLeft, canvasRight),
      boundedMaxTop = Math.min(maxTop, canvasBottom),
      left = boundedMaxLeft >= minLeft ? Math.min(boundedMaxLeft, Math.max(minLeft, point.left)) : Math.min(maxLeft, Math.max(inset, point.left)),
      top = boundedMaxTop >= minTop ? Math.min(boundedMaxTop, Math.max(minTop, point.top)) : Math.min(maxTop, Math.max(inset, point.top));
    if (Math.abs(left - point.left) > 0.5) editor.x = (left - state.panX) / scale;
    if (Math.abs(top - point.top) > 0.5) editor.y = (top - state.panY) / scale;
    keepTextEditorInsideCanvas(editor);
  }
  function positionTextEditors() {
    const visible = state.textEditors.size > 0;
    textEditorLayer.hidden = !visible;
    textInputHint.hidden = !visible;
    for (const editor of state.textEditors.values()) {
      keepTextEditorInsideCanvas(editor);
      keepTextEditorVisible(editor);
      const point = textEditorScreenPoint(editor),
        active = editor.id === state.activeTextEditorId,
        declaration = editor.styleRule?.["style"];
      if (declaration) {
        declaration.left = `${Math.round(point.left)}px`;
        declaration.top = `${Math.round(point.top)}px`;
        declaration.width = `${Math.round(editor.widthCss)}px`;
        declaration.height = `${Math.round(editor.heightCss)}px`;
        declaration.zIndex = String(editor.zIndex || 1);
        declaration.setProperty("--text-editor-font-size", `${editor.fontCss}px`);
        declaration.setProperty("--text-editor-ink", editor.color || state.inkColor);
        if (editor.previewLogicalWidth) declaration.setProperty("--text-editor-preview-width", `${editor.previewLogicalWidth}px`);
        else declaration.removeProperty("--text-editor-preview-width");
        if (editor.previewLogicalHeight) declaration.setProperty("--text-editor-preview-height", `${editor.previewLogicalHeight}px`);
        else declaration.removeProperty("--text-editor-preview-height");
      }
      editor.element.classList.toggle("active", active);
    }
    textEditorLayer.setAttribute("aria-hidden", String(!visible));
  }
  function textEditorStyleSheet() {
    if (state.textEditorStyleSheet) return state.textEditorStyleSheet;
    state.textEditorStyleSheet = [...document.styleSheets].find((sheet) => /(?:^|\/)style\.css(?:\?|$)/.test(sheet.href || "")) || null;
    return state.textEditorStyleSheet;
  }
  function addTextEditorStyleRule(editor) {
    const sheet = textEditorStyleSheet();
    if (!sheet) return;
    const className = `text-editor-instance-${editor.id}`;
    editor.element.classList.add(className);
    try {
      sheet.insertRule(`.${className} { left: 0px; top: 0px; width: ${Math.round(editor.widthCss)}px; height: ${Math.round(editor.heightCss)}px; }`, sheet.cssRules.length);
      editor.styleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      editor.styleRule = null;
    }
  }
  function removeTextEditorStyleRule(editor) {
    const rule = editor?.styleRule,
      sheet = textEditorStyleSheet();
    if (!rule || !sheet) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    editor.styleRule = null;
  }
  function focusTextEditor(editor, input = false) {
    if (!editor) return;
    state.activeTextEditorId = editor.id;
    editor.zIndex = ++state.nextTextEditorZ;
    positionTextEditors();
    if (input && !editor.textarea.hidden) editor.textarea.focus({ preventScroll: true });
  }
  function textEditorPointerDown(event, editor, hit) {
    event.preventDefault();
    event.stopPropagation();
    focusTextEditor(editor, hit === "body");
    if (hit === "body") return;
    editor.gesture = {
      id: event.pointerId,
      hit,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: editor.x,
      startY: editor.y,
      startWidth: editor.widthCss,
      startHeight: editor.heightCss,
      startFontCss: editor.fontCss,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }
  function updateTextEditorGesture(event, editor) {
    const gesture = editor.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startClientX,
      dy = event.clientY - gesture.startClientY,
      viewport = textEditorViewportSize();
    if (gesture.hit === "move") {
      editor.x = gesture.startX + dx / Math.max(0.03, state.scale);
      editor.y = gesture.startY + dy / Math.max(0.03, state.scale);
      editor.moved = true;
    } else {
      const point = textEditorScreenPoint(editor),
        maxWidth = Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - Math.max(8, point.left) - 8),
        maxHeight = Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - Math.max(8, point.top) - 8),
        next = resizeTextEditorDimensions(gesture, gesture.hit, dx, dy, TEXT_EDITOR_MIN_WIDTH, TEXT_EDITOR_MIN_HEIGHT, maxWidth, maxHeight);
      editor.widthCss = next.widthCss;
      editor.heightCss = next.heightCss;
      editor.fontCss = next.fontCss;
      editor.resized = true;
      if (editor.mixedMode && (gesture.hit === "width" || gesture.hit === "corner")) scheduleTextEditorPreview(editor);
    }
    positionTextEditors();
  }
  function finishTextEditorGesture(event, editor) {
    if (editor.gesture?.id !== event.pointerId) return;
    const hit = editor.gesture.hit;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    editor.gesture = null;
    if (editor.mixedMode && (hit === "width" || hit === "corner")) scheduleTextEditorPreview(editor, 0);
  }
  function textEditorButton(button, key, className) {
    button.type = "button";
    button.className = `text-editor-button ${className || ""}`;
    button.dataset.i18nTitle = key;
    button.dataset.i18nAria = key;
    button.setAttribute("aria-label", t(key));
    button.setAttribute("title", t(key));
    if (className === "confirm") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.3 3.4 3.4 7.8-8"/></svg>';
    else if (className === "cancel") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"/></svg>';
    else button.textContent = t(key);
    return button;
  }
  function removeTextEditor(editor) {
    if (!editor) return;
    editor.cancelled = true;
    cancelTextEditorPreview(editor, true);
    removeTextEditorStyleRule(editor);
    editor.element.remove();
    state.textEditors.delete(editor.id);
    if (state.activeTextEditorId === editor.id) {
      const next = state.textEditors.values().next().value || null;
      if (next) focusTextEditor(next);
      else state.activeTextEditorId = null;
    }
    positionTextEditors();
  }
  function clearTextEditors() {
    for (const editor of state.textEditors.values()) {
      editor.cancelled = true;
      cancelTextEditorPreview(editor, true);
      removeTextEditorStyleRule(editor);
      editor.element.remove();
    }
    state.textEditors.clear();
    state.activeTextEditorId = null;
    state.selectedTextBoxId = null;
    state.textTap = null;
    positionTextEditors();
  }
  function cancelTextEditorPreview(editor, clear = false) {
    if (!editor) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = 0;
    editor.previewRevision++;
    if (!clear || !editor.preview) return;
    editor.preview.replaceChildren();
    editor.preview.removeAttribute("aria-busy");
    editor.preview.removeAttribute("data-fallback");
    editor.previewLogicalWidth = 0;
    editor.previewLogicalHeight = 0;
  }
  async function renderTextEditorPreview(editor) {
    if (!editor || !editor.mixedMode || editor.committing || editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
    const revision = ++editor.previewRevision,
      text = editor.textarea.value,
      fontCss = editor.fontCss,
      maxWidth = Math.max(fontCss * 3, editor.widthCss - 16),
      color = editor.color || state.inkColor;
    editor.preview.setAttribute("aria-busy", "true");
    let image,
      fallback = false;
    try {
      image = await mixedTextImage(text, fontCss, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, Math.min(3, devicePixelRatio || 1));
    } catch {
      image = textImage(text, fontCss, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH, Math.min(3, devicePixelRatio || 1));
      fallback = true;
    }
    if (editor.cancelled || editor.committing || !editor.mixedMode || editor.previewRevision !== revision || state.textEditors.get(editor.id) !== editor) return;
    image.classList.add("text-editor-preview-canvas");
    editor.previewLogicalWidth = image.logicalWidth || image.width;
    editor.previewLogicalHeight = image.logicalHeight || image.height;
    editor.preview.replaceChildren(image);
    editor.preview.toggleAttribute("data-fallback", fallback);
    editor.preview.setAttribute("aria-label", text || t("textPreview"));
    editor.preview.setAttribute("aria-busy", "false");
    positionTextEditors();
  }
  function scheduleTextEditorPreview(editor, delay = TEXT_EDITOR_PREVIEW_INTERVAL_MS) {
    if (!editor?.mixedMode || editor.committing || editor.cancelled) return;
    if (delay > 0 && editor.previewTimer) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = setTimeout(() => {
      editor.previewTimer = 0;
      void renderTextEditorPreview(editor);
    }, Math.max(0, delay));
  }
  function updateTextEditorMixedMode(editor) {
    const button = editor?.mixedModeButton;
    if (!button) return;
    const labelKey = editor.mixedMode ? "textEditMode" : "textMixedMode";
    button.classList.toggle("active", editor.mixedMode);
    button.setAttribute("aria-pressed", String(editor.mixedMode));
    button.dataset.i18nTitle = labelKey;
    button.dataset.i18nAria = labelKey;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("title", t(labelKey));
    editor.element.classList.toggle("previewing", editor.mixedMode);
    editor.textarea.hidden = editor.mixedMode;
    editor.preview.hidden = !editor.mixedMode;
  }
  function toggleTextEditorMixedMode(editor) {
    if (!editor || editor.committing) return;
    editor.mixedMode = !editor.mixedMode;
    updateTextEditorMixedMode(editor);
    if (editor.mixedMode) {
      focusTextEditor(editor);
      scheduleTextEditorPreview(editor, 0);
      editor.preview.focus({ preventScroll: true });
    } else {
      cancelTextEditorPreview(editor, true);
      focusTextEditor(editor, true);
    }
  }
  function openTextHelp(editor, invoker) {
    const dialog = document.querySelector("#textHelpDialog");
    if (!dialog) return;
    if (editor && state.textEditors.get(editor.id) === editor) focusTextEditor(editor);
    textHelpInvoker = invoker || null;
    if (!dialog.open) dialog.showModal();
  }
  function closeTextHelp() {
    const dialog = document.querySelector("#textHelpDialog");
    if (dialog?.open) dialog.close();
  }
  function restoreTextEditorAfterHelp() {
    blockCanvasInput(300);
    const invoker = textHelpInvoker;
    textHelpInvoker = null;
    if (invoker?.isConnected && !invoker.disabled) invoker.focus({ preventScroll: true });
  }
  function textEditorContentOffset(editor) {
    const body = editor?.body || editor?.element?.querySelector(".text-editor-body"),
      left = body?.offsetLeft || 0,
      top = body?.offsetTop || 36;
    return { x: left + 8, y: top + 8 };
  }

  async function confirmTextEditor(editor) {
    if (!editor) return;
    if (editor.commitPromise) return editor.commitPromise;
    const text = editor.textarea.value;
    if (!text.trim()) {
      setStatusKey("textEmpty");
      return;
    }
    const commitPromise = (async () => {
      editor.committing = true;
      editor.cancelled = false;
      editor.element.classList.add("committing");
      cancelTextEditorPreview(editor);
      blockCanvasInput(TEXT_INPUT_GUARD_MS);
      if (!editor.returnMode && state.mode === "text") setCanvasMode("pen");
      supersedeActiveAI("text-input-confirmed");
      clearTimeout(state.timer);
      state.timer = 0;
      editor.element.querySelectorAll("button").forEach((button) => (button.disabled = true));
      const contentOffset = textEditorContentOffset(editor),
        editorScale = Math.max(0.03, state.scale);
      editor.x += contentOffset.x / editorScale;
      editor.y += contentOffset.y / editorScale;
      editor.mixedMode = true;
      const proposedFontSize = editor.fontCss / Math.max(0.03, state.scale);
      let fontSize = editor.sourceTextBoxId && !editor.resized ? editor.sourceFontSize : proposedFontSize,
        proposedMaxWidth = Math.max(fontSize * 3, (editor.widthCss - 16) / Math.max(0.03, state.scale)),
        color = editor.color || state.inkColor;
      let maxWidth = editor.sourceTextBoxId && !editor.resized ? editor.sourceMaxWidth : proposedMaxWidth,
        x = editor.sourceTextBoxId && !editor.moved ? editor.sourceX : editor.x,
        y = editor.sourceTextBoxId && !editor.moved ? editor.sourceY : editor.y;
      const fitted = await fittedTextBoxContent(text, fontSize, color, maxWidth);
      if (editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
      const image = fitted.image,
        mixedFallback = fitted.mixedFallback,
        width = fitted.width,
        height = fitted.height;
      fontSize = fitted.fontSize;
      maxWidth = fitted.maxWidth;
      x = Math.max(0, Math.min(SIZE - width, x));
      y = Math.max(0, Math.min(SIZE - height, y));
      const
        box = { x, y, w: width, h: height },
        existingIndex = editor.sourceTextBoxId ? state.textBoxes.findIndex((item) => item.id === editor.sourceTextBoxId) : -1;
      recordTextBoxesBefore();
      const item = {
        id:existingIndex >= 0 ? state.textBoxes[existingIndex].id : `text-box-${state.nextTextBoxId++}`,
        x,
        y,
        w:width,
        h:height,
        maxWidth,
        fontSize,
        color,
        text,
        image,
      };
      if (existingIndex >= 0) state.textBoxes.splice(existingIndex, 1, item);
      else state.textBoxes.push(item);
      state.userRevision++;
      mergeDirtyBox(box);
      state.latestTypedInput = { text: text.slice(0, TEXT_INPUT_MAX_LENGTH), box };
      state.hotspotTrail.push({ x: x + width / 2, y: y + height / 2 });
      if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
      state.autoEligible = true;
      state.selectedTextBoxId = null;
      removeTextEditor(editor);
      blockCanvasInput(TEXT_INPUT_GUARD_MS);
      restoreTextEditorMode(editor);
      save();
      render();
      setStatusKey(mixedFallback ? "textMixedModeError" : "ready");
      if (state.auto) schedule(Math.max(1000, state.autoDelayMs));
    })();
    editor.commitPromise = commitPromise;
    try {
      return await commitPromise;
    } finally {
      if (editor.commitPromise === commitPromise) editor.commitPromise = null;
    }
  }
  function restoreTextEditorMode(editor) {
    const returnMode = editor?.returnMode;
    if (returnMode && state.mode === "hand") {
      setCanvasMode(returnMode, {
        preserveSelection:true,
        skipDraftFinalize:true,
        preserveWidgetRefinement:true,
      });
    } else if (!returnMode && state.mode === "text") setCanvasMode("pen");
  }
  function cancelTextEditor(editor) {
    if (!editor || editor.committing) return;
    if (editor.sourceTextBoxId) state.selectedTextBoxId = null;
    removeTextEditor(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    if (editor.returnMode) restoreTextEditorMode(editor);
    else setCanvasMode("pen");
    render();
    setStatusKey("ready");
    if (!state.textEditors.size && state.auto && state.autoEligible) schedule(Math.max(1000, state.autoDelayMs));
  }
  function createTextEditor(point, options = null) {
    options ||= {};
    if (!options.sourceTextBoxId && state.textBoxes.length >= MAX_VISIBLE_TEXT_BOXES) return null;
    supersedeActiveAI("text-input-started");
    if (!state.timer && state.auto && state.dirty && state.autoEligible) schedule();
    const viewport = textEditorViewportSize(),
      widthCss = Math.min(Number(options.widthCss) || TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - 24)),
      heightCss = Math.min(Number(options.heightCss) || TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - 24)),
      editor = {
        id: state.nextTextEditorId++,
        x: point.x,
        y: point.y,
        widthCss,
        heightCss,
        fontCss: Number(options.fontCss) || TEXT_EDITOR_FONT_CSS,
        zIndex: 1,
        mixedMode: false,
        previewRevision: 0,
        previewTimer: 0,
        previewLogicalWidth: 0,
        previewLogicalHeight: 0,
        committing: false,
        cancelled: false,
        gesture: null,
        returnMode:typeof options.returnMode === "string" ? options.returnMode : "",
        sourceTextBoxId:typeof options.sourceTextBoxId === "string" ? options.sourceTextBoxId : "",
        sourceX:Number(options.sourceX),
        sourceY:Number(options.sourceY),
        sourceMaxWidth:Number(options.sourceMaxWidth),
        sourceFontSize:Number(options.sourceFontSize),
        moved:false,
        resized:false,
        color:typeof options.color === "string" ? options.color : state.inkColor,
      },
      root = document.createElement("section"),
      header = document.createElement("header"),
      title = document.createElement("span"),
      mixedModeButton = document.createElement("button"),
      body = document.createElement("div"),
      textarea = document.createElement("textarea"),
      preview = document.createElement("div");
    const helpButton = textEditorButton(document.createElement("button"), "textHelp", "help"),
      acceptButton = textEditorButton(document.createElement("button"), "textConfirm", "confirm"),
      cancelButton = textEditorButton(document.createElement("button"), "textCancel", "cancel");
    editor.element = root;
    editor.textarea = textarea;
    editor.preview = preview;
    editor.body = body;
    editor.mixedModeButton = mixedModeButton;
    root.className = "text-editor active";
    root.dataset.editorId = String(editor.id);
    root.dataset.i18nAria = "text";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t("text"));
    header.className = "text-editor-header";
    title.className = "text-editor-title";
    title.dataset.i18n = "text";
    title.textContent = t("text");
    mixedModeButton.className = "text-editor-button mixed-mode";
    mixedModeButton.type = "button";
    mixedModeButton.dataset.i18n = "textMixedModeShort";
    mixedModeButton.dataset.i18nTitle = "textMixedMode";
    mixedModeButton.dataset.i18nAria = "textMixedMode";
    mixedModeButton.textContent = t("textMixedModeShort");
    mixedModeButton.setAttribute("aria-label", t("textMixedMode"));
    mixedModeButton.setAttribute("title", t("textMixedMode"));
    mixedModeButton.setAttribute("aria-pressed", "false");
    preview.id = `textEditorPreview${editor.id}`;
    mixedModeButton.setAttribute("aria-controls", preview.id);
    helpButton.textContent = "?";
    helpButton.setAttribute("aria-haspopup", "dialog");
    helpButton.setAttribute("aria-controls", "textHelpDialog");
    acceptButton.textContent = "✓";
    cancelButton.textContent = "×";
    header.append(title, helpButton, mixedModeButton, acceptButton, cancelButton);
    body.className = "text-editor-body";
    textarea.className = "text-editor-input";
    textarea.rows = 4;
    textarea.maxLength = TEXT_INPUT_MAX_LENGTH;
    textarea.dataset.i18nPlaceholder = "textPlaceholder";
    textarea.dataset.i18nAria = "text";
    textarea.placeholder = t("textPlaceholder");
    textarea.setAttribute("aria-label", t("text"));
    textarea.value = typeof options.text === "string" ? options.text.slice(0, TEXT_INPUT_MAX_LENGTH) : "";
    preview.className = "text-editor-preview";
    preview.hidden = true;
    preview.tabIndex = 0;
    preview.setAttribute("role", "region");
    preview.setAttribute("aria-label", t("textPreview"));
    body.append(textarea, preview);
    root.append(header, body);
    for (const kind of ["width", "height", "corner"]) {
      const handle = document.createElement("span");
      handle.className = `text-editor-handle ${kind}`;
      handle.dataset.textHandle = kind;
      root.append(handle);
      handle.addEventListener("pointerdown", (event) => textEditorPointerDown(event, editor, kind));
    }
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      textEditorPointerDown(event, editor, "move");
    });
    root.addEventListener("pointerdown", (event) => {
      if (event.target === textarea || event.target.closest("button") || event.target.closest(".text-editor-preview") || event.target.closest(".text-editor-handle")) return;
      textEditorPointerDown(event, editor, "body");
    });
    root.addEventListener("pointermove", (event) => updateTextEditorGesture(event, editor));
    root.addEventListener("pointerup", (event) => finishTextEditorGesture(event, editor));
    root.addEventListener("pointercancel", (event) => finishTextEditorGesture(event, editor));
    textarea.addEventListener("focus", () => focusTextEditor(editor));
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor(editor);
      }
    });
    preview.addEventListener("focus", () => focusTextEditor(editor));
    preview.addEventListener("pointerdown", () => focusTextEditor(editor));
    preview.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor(editor);
      }
    });
    helpButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTextHelp(editor, helpButton);
    });
    mixedModeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTextEditorMixedMode(editor);
    });
    acceptButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      confirmTextEditor(editor);
    });
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelTextEditor(editor);
    });
    textEditorLayer.append(root);
    addTextEditorStyleRule(editor);
    updateTextEditorMixedMode(editor);
    keepTextEditorInsideCanvas(editor);
    state.textEditors.set(editor.id, editor);
    focusTextEditor(editor, true);
    positionTextEditors();
    return editor;
  }
  function editTextBox(item) {
    if (state.mode !== "hand" || !item || !state.textBoxes.includes(item) || state.textEditors.size) return false;
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.animationEdit) acceptAnimationEdit();
    state.selectedTextBoxId = item.id;
    const scale = Math.max(.03, state.scale),
      editor = createTextEditor({ x:item.x, y:item.y }, {
        text:item.text,
        widthCss:Math.max(TEXT_EDITOR_MIN_WIDTH, item.maxWidth * scale + 16),
        heightCss:Math.max(TEXT_EDITOR_MIN_HEIGHT, item.h * scale + 48),
        fontCss:Math.max(8, item.fontSize * scale),
        sourceTextBoxId:item.id,
        sourceX:item.x,
        sourceY:item.y,
        sourceMaxWidth:item.maxWidth,
        sourceFontSize:item.fontSize,
        color:item.color,
        returnMode:"hand",
      });
    if (!editor) {
      state.selectedTextBoxId = null;
      return false;
    }
    const offset = textEditorContentOffset(editor);
    editor.x -= offset.x / scale;
    editor.y -= offset.y / scale;
    positionTextEditors();
    setStatusKey("ready");
    render();
    return true;
  }
  function setCanvasCursor(cursor) {
    screen.classList.remove("cursor-crosshair", "cursor-pen", "cursor-eraser", "cursor-grab", "cursor-grabbing", "cursor-nwse-resize", "cursor-ew-resize", "cursor-ns-resize");
    screen.classList.add(`cursor-${cursor}`);
  }
  function resetCanvasCursor() {
    setCanvasCursor(state.mode === "hand" ? "grab" : state.mode === "pen" ? "pen" : state.mode === "eraser" ? "eraser" : "crosshair");
  }
  function beginTouchGesture() {
    if (state.touches.size < 2) return;
    const ids = [...state.touches.keys()].slice(0, 2),
      points = ids.map((id) => state.touches.get(id));
    state.touchGesture = {
      ids,
      center: {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      scale: state.scale,
      panX: state.panX,
      panY: state.panY,
    };
    state.panGesture = null;
  }
  function updateTouchGesture() {
    const g = state.touchGesture;
    if (!g) return false;
    const points = g.ids.map((id) => state.touches.get(id));
    if (points.some((p) => !p)) return false;
    const center = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      r = view.getBoundingClientRect(),
      next = Math.max(0.03, Math.min(2, (g.scale * distance) / g.distance)),
      anchorX = (g.center.x - r.left - g.panX) / g.scale,
      anchorY = (g.center.y - r.top - g.panY) / g.scale;
    state.scale = next;
    state.panX = center.x - r.left - anchorX * next;
    state.panY = center.y - r.top - anchorY * next;
    updateCoordinates();
    setNavigating(true);
    render();
    return true;
  }
  function moveCanvas(dx, dy) {
    state.panX += dx;
    state.panY += dy;
    updateCoordinates();
    requestRender();
  }
  function zoomCanvasAt(clientX, clientY, deltaY) {
    const rect = view.getBoundingClientRect(),
      factor = deltaY < 0 ? 1.12 : 0.89,
      next = Math.max(0.03, Math.min(2, state.scale * factor)),
      px = clientX - rect.left,
      py = clientY - rect.top;
    state.panX = px - ((px - state.panX) * next) / state.scale;
    state.panY = py - ((py - state.panY) * next) / state.scale;
    state.scale = next;
    updateCoordinates();
    requestRender();
    wheelNavigating();
  }
  function valid(p) {
    return p.x >= 0 && p.x <= SIZE && p.y >= 0 && p.y <= SIZE;
  }
  function mergeDirty(x, y, p = 10) {
    const a = {
      x: Math.max(0, x - p),
      y: Math.max(0, y - p),
      w: Math.min(SIZE, x + p) - Math.max(0, x - p),
      h: Math.min(SIZE, y + p) - Math.max(0, y - p),
    };
    if (!state.dirty) state.dirty = a;
    else {
      const b = state.dirty,
        x1 = Math.min(a.x, b.x),
        y1 = Math.min(a.y, b.y),
        x2 = Math.max(a.x + a.w, b.x + b.w),
        y2 = Math.max(a.y + a.h, b.y + b.h);
      state.dirty = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  function restoreDirty(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = box;
      return;
    }
    const x = Math.min(box.x, state.dirty.x),
      y = Math.min(box.y, state.dirty.y),
      right = Math.max(box.x + box.w, state.dirty.x + state.dirty.w),
      bottom = Math.max(box.y + box.h, state.dirty.y + state.dirty.h);
    state.dirty = { x, y, w: right - x, h: bottom - y };
  }
  function discardUncapturableInput(hotspotCount, usedDirty) {
    if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
    state.dirty = null;
    state.autoEligible = false;
    if (!usedDirty) state.lastUserBox = null;
  }
  function invalidateRecognition() {
    const active=state.activeAI;
    if(active&&!active.superseded){active.superseded=true;active.dirtyRestored=true;active.controller.abort();if(state.activeAI===active){state.activeAI=null;setBusy(false)}}
    clearTimeout(state.timer);
    state.timer = 0;
    state.recognitionGeneration++;
    state.hotspotTrail = [];
    state.dirty = null;
    state.autoEligible = false;
    state.lastUserBox = null;
  }
  function cloneCanvas(source) {
    if (!source) return null;
    const copy = document.createElement("canvas");
    copy.width = copy.height = TILE;
    copy.getContext("2d").drawImage(source, 0, 0);
    return copy;
  }
