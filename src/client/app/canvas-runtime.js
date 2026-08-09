// Canvas tiles, widgets, animations, rendering, navigation, and text editing.
  const WIDGET_REFINE_PROXIMITY_PX = 24;
  const WIDGET_REFINE_HOVER_GRACE_MS = 5000;
  const WIDGET_REFINE_HINT_MS = 10000;
  const WIDGET_REFINE_CLICK_PULSE_MS = 900;
  const HAND_OBJECT_TOOLBAR_VISIBLE_MS = 10000;
  const HAND_OBJECT_TOOLBAR_FADE_MS = 220;
  const HAND_WIDGET_GESTURE_RESET_TAP_PX = 8;
  // TEMP: Keep enabled only while visually validating dirty-region shrinking.
  const SHOW_DIRTY_MASK_DEBUG_BOUNDS = false;
  const objectChromeButtons = new Map();
  const widgetRefineTouchCandidates = new Map();
  let widgetRefineConfirmationElement = null;
  let canvasWidgetGestureResetTap = null;
  let nextObjectChromeStyleId = 1;
  function normalizedWidgetSource(value) {
    return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  }
  function widgetSourceMirrorsHtml(source, html) {
    const normalizedSource = normalizedWidgetSource(source);
    return Boolean(normalizedSource) && normalizedSource === normalizedWidgetSource(html);
  }
  function widgetUsesHtmlCopySource(widget) {
    return Boolean(widget && widget.widgetType !== "diagram_source" && widget.pluginId !== "image-search"
      && (!widget.copyText || widgetSourceMirrorsHtml(widget.copyText, widget.html)));
  }
  function widgetCopySource(widget) {
    if (!widget || widget.pluginId === "image-search") return "";
    if (widget.widgetType === "diagram_source") return widget.source || widget.copyText || "";
    return widgetUsesHtmlCopySource(widget) ? widget.html : widget.copyText || "";
  }
  function widgetCopySourceLabel(widget) {
    if (!widgetCopySource(widget)) return "";
    if (widgetUsesHtmlCopySource(widget)) return "Copy HTML";
    return widget.copyLabel || (widget.sourceFormat ? `Copy ${widget.sourceFormat}` : t("copyText"));
  }
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
    clearHandToolbarTargets("text-box");
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
    clearHandToolbarTargets("image");
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
  function drawImagesToContext(context, region = null, withShadow = false) {
    for (const item of visibleImages(region)) {
      if (!withShadow) {
        context.drawImage(item.image, item.x, item.y, item.w, item.h);
        continue;
      }
      context.save();
      context.shadowColor = "rgba(15, 23, 42, .24)";
      context.shadowBlur = 18;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = 7;
      context.drawImage(item.image, item.x, item.y, item.w, item.h);
      context.restore();
    }
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
  function handToolbarKey(kind, id) {
    return `${kind}:${id}`;
  }
  function handToolbarRecord(target = state.handToolbarActiveKey) {
    if (typeof target === "string") return state.handToolbarTargets.get(target) || null;
    if (target?.handToolbarKey) return state.handToolbarTargets.get(target.handToolbarKey) || null;
    if (target?.kind && target?.id) return state.handToolbarTargets.get(handToolbarKey(target.kind, target.id)) || null;
    return null;
  }
  function handToolbarObject(target = state.handToolbarActiveKey) {
    const record = handToolbarRecord(target) || target;
    if (!record) return null;
    if (record.kind === "widget") return state.widgets.find((item) => item.id === record.id) || null;
    if (record.kind === "image") return state.images.find((item) => item.id === record.id) || null;
    if (record.kind === "animation") return state.animations.find((item) => item.id === record.id) || null;
    if (record.kind === "text-box") return state.textBoxes.find((item) => item.id === record.id) || null;
    return null;
  }
  function handToolbarEditMatches(record) {
    return Boolean(record && (record.kind === "widget" && state.widgetEdit?.id === record.id
      || record.kind === "image" && state.imageEdit?.id === record.id
      || record.kind === "animation" && state.animationEdit?.id === record.id));
  }
  function finishHandToolbarEdit(record) {
    if (!handToolbarEditMatches(record)) return false;
    if (record.kind === "widget") return acceptWidgetEdit();
    if (record.kind === "image") return acceptImageEdit({ restoreMode:false });
    return acceptAnimationEdit();
  }
  function scheduleHandObjectToolbarTick() {
    clearTimeout(state.handToolbarTimer);
    state.handToolbarTimer = 0;
    let nextAt = Infinity;
    for (const record of state.handToolbarTargets.values()) {
      if (record.holds?.size) continue;
      nextAt = Math.min(nextAt, record.hiding ? record.hideAt : record.expiresAt);
    }
    if (!Number.isFinite(nextAt)) return;
    state.handToolbarTimer = setTimeout(expireHandObjectToolbars, Math.max(0, nextAt - Date.now()));
  }
  function finishHandToolbarHide(key) {
    const record = state.handToolbarTargets.get(key);
    if (!record) return false;
    state.handToolbarTargets.delete(key);
    if (state.handToolbarActiveKey === key) state.handToolbarActiveKey = null;
    if (state.handHoverKey === key) state.handHoverKey = null;
    for (const [pointerId, focus] of state.handPointerFocusKeys) if (focus.key === key) state.handPointerFocusKeys.delete(pointerId);
    for (const [pointerId, operation] of state.handToolbarOperationPointers) if (operation.key === key) state.handToolbarOperationPointers.delete(pointerId);
    finishHandToolbarEdit(record);
    requestInteractionLayerRender();
    return true;
  }
  function expireHandObjectToolbars() {
    state.handToolbarTimer = 0;
    const now = Date.now();
    for (const [key, record] of [...state.handToolbarTargets]) {
      if (!handToolbarObject(record)) {
        finishHandToolbarHide(key);
        continue;
      }
      if (record.holds?.size) continue;
      if (record.hiding && record.hideAt <= now) finishHandToolbarHide(key);
      else if (!record.hiding && record.expiresAt <= now) {
        record.hiding = true;
        record.hideAt = now + HAND_OBJECT_TOOLBAR_FADE_MS;
      }
    }
    requestInteractionLayerRender();
    scheduleHandObjectToolbarTick();
  }
  function clearHandToolbarTarget(kind = "", id = "", options = {}) {
    const key = kind && id ? handToolbarKey(kind, id) : state.handToolbarActiveKey;
    if (!key || !state.handToolbarTargets.has(key)) return false;
    if (options.preserveInactive !== false && kind && id && state.handToolbarActiveKey !== key) return false;
    state.handToolbarTargets.delete(key);
    if (state.handToolbarActiveKey === key) state.handToolbarActiveKey = null;
    if (state.handHoverKey === key) state.handHoverKey = null;
    for (const [pointerId, focus] of state.handPointerFocusKeys) if (focus.key === key) state.handPointerFocusKeys.delete(pointerId);
    for (const [pointerId, operation] of state.handToolbarOperationPointers) if (operation.key === key) state.handToolbarOperationPointers.delete(pointerId);
    scheduleHandObjectToolbarTick();
    return true;
  }
  function clearHandToolbarTargets(kind = "") {
    let changed = false;
    for (const [key, record] of [...state.handToolbarTargets]) {
      if (kind && record.kind !== kind) continue;
      state.handToolbarTargets.delete(key);
      if (state.handToolbarActiveKey === key) state.handToolbarActiveKey = null;
      if (state.handHoverKey === key) state.handHoverKey = null;
      for (const [pointerId, focus] of state.handPointerFocusKeys) if (focus.key === key) state.handPointerFocusKeys.delete(pointerId);
      for (const [pointerId, operation] of state.handToolbarOperationPointers) if (operation.key === key) state.handToolbarOperationPointers.delete(pointerId);
      changed = true;
    }
    if (changed) scheduleHandObjectToolbarTick();
    return changed;
  }
  function hideHandObjectToolbar({ key = state.handToolbarActiveKey, animate = true, all = false } = {}) {
    const keys = all ? [...state.handToolbarTargets.keys()] : key ? [key] : [];
    if (!keys.length) return false;
    const now = Date.now();
    for (const targetKey of keys) {
      const record = state.handToolbarTargets.get(targetKey);
      if (!record) continue;
      if (!animate || HAND_OBJECT_TOOLBAR_FADE_MS <= 0) finishHandToolbarHide(targetKey);
      else if (!record.hiding) {
        record.hiding = true;
        record.hideAt = now + HAND_OBJECT_TOOLBAR_FADE_MS;
      }
    }
    requestInteractionLayerRender();
    scheduleHandObjectToolbarTick();
    return true;
  }
  function refreshHandObjectToolbar(target = state.handToolbarActiveKey) {
    const record = handToolbarRecord(target);
    if (!record || !handToolbarObject(record)) return false;
    record.expiresAt = Date.now() + HAND_OBJECT_TOOLBAR_VISIBLE_MS;
    record.hiding = false;
    record.hideAt = 0;
    scheduleHandObjectToolbarTick();
    if (record.kind === "animation" && state.handToolbarActiveKey === handToolbarKey(record.kind, record.id)) showAnimationControls(HAND_OBJECT_TOOLBAR_VISIBLE_MS + HAND_OBJECT_TOOLBAR_FADE_MS);
    requestInteractionLayerRender();
    return true;
  }
  function ensureHandToolbarRecord(kind, object) {
    if (state.mode !== "hand" || !object?.id || !["widget", "image", "animation", "text-box"].includes(kind)) return null;
    const key = handToolbarKey(kind, object.id);
    let record = state.handToolbarTargets.get(key);
    if (!record) {
      record = { kind, id:object.id, expanded:false, expiresAt:Date.now() + HAND_OBJECT_TOOLBAR_VISIBLE_MS, hiding:false, hideAt:0, holds:new Set() };
      state.handToolbarTargets.set(key, record);
    }
    return { key, record };
  }
  function setHandToolbarHold(key, token, held) {
    const record = handToolbarRecord(key);
    if (!record || !token) return false;
    if (!(record.holds instanceof Set)) record.holds = new Set();
    if (held) record.holds.add(token);
    else record.holds.delete(token);
    record.expiresAt = Date.now() + HAND_OBJECT_TOOLBAR_VISIBLE_MS;
    record.hiding = false;
    record.hideAt = 0;
    scheduleHandObjectToolbarTick();
    requestInteractionLayerRender();
    return true;
  }
  function focusHandObject(kind, object, token = "") {
    const ensured = ensureHandToolbarRecord(kind, object);
    if (!ensured) return "";
    if (token) ensured.record.holds.add(token);
    ensured.record.expiresAt = Date.now() + HAND_OBJECT_TOOLBAR_VISIBLE_MS;
    ensured.record.hiding = false;
    ensured.record.hideAt = 0;
    scheduleHandObjectToolbarTick();
    requestInteractionLayerRender();
    return ensured.key;
  }
  function releaseHandObjectFocus(key, token) {
    return setHandToolbarHold(key, token, false);
  }
  function beginHandToolbarOperation(pointerId, key) {
    if (!Number.isInteger(pointerId) || !key) return false;
    const token = `operation:${pointerId}`;
    state.handToolbarOperationPointers.set(pointerId, { key, token });
    return setHandToolbarHold(key, token, true);
  }
  function finishHandToolbarOperation(pointerId) {
    const operation = state.handToolbarOperationPointers.get(pointerId);
    if (!operation) return false;
    state.handToolbarOperationPointers.delete(pointerId);
    return releaseHandObjectFocus(operation.key, operation.token);
  }
  function activateHandObjectToolbar(target) {
    const record = handToolbarRecord(target),
      object = handToolbarObject(record);
    if (!record || !object) return false;
    const key = handToolbarKey(record.kind, record.id),
      previousKey = state.handToolbarActiveKey,
      previous = previousKey && previousKey !== key ? handToolbarRecord(previousKey) : null;
    state.handToolbarActiveKey = key;
    record.expanded = true;
    if (previous) finishHandToolbarEdit(previous);
    let activated = true;
    if (record.kind === "widget") activated = beginWidgetEdit(object);
    else if (record.kind === "image") activated = beginImageEdit(object);
    else if (record.kind === "animation") activated = beginAnimationEdit(object);
    else activated = state.textBoxes.includes(object) && !state.textEditors.size;
    if (!activated) {
      record.expanded = false;
      state.handToolbarActiveKey = null;
      return false;
    }
    if (record.kind === "animation") showAnimationControls(HAND_OBJECT_TOOLBAR_VISIBLE_MS + HAND_OBJECT_TOOLBAR_FADE_MS);
    refreshHandObjectToolbar(key);
    return true;
  }
  function showHandObjectToolbar(kind, object) {
    const ensured = ensureHandToolbarRecord(kind, object);
    if (!ensured) return false;
    const { key } = ensured;
    if (!activateHandObjectToolbar(key)) {
      state.handToolbarTargets.delete(key);
      scheduleHandObjectToolbarTick();
      return false;
    }
    requestInteractionLayerRender();
    return true;
  }
  function handObjectToolbarTargetAtPoint(point) {
    if (!point || !valid(point)) return null;
    const textBox = textBoxAtPoint(point);
    if (textBox) return { kind:"text-box", object:textBox };
    const image = imageAtPoint(point);
    if (image) return { kind:"image", object:image };
    const widgets = visibleWidgets();
    for (let index = widgets.length - 1; index >= 0; index--) {
      const widget = widgets[index], box = widgetBox(widget);
      if (!widget.pending && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { kind:"widget", object:widget };
    }
    const animation = animationPointerHit(point)?.animation;
    if (animation) return { kind:"animation", object:animation };
    return null;
  }
  function updateHandObjectHover(point) {
    if (state.mode !== "hand") point = null;
    const target = point && valid(point) ? handObjectToolbarTargetAtPoint(point) : null,
      nextKey = target ? handToolbarKey(target.kind, target.object.id) : "",
      previousKey = state.handHoverKey || "";
    if (previousKey === nextKey) return Boolean(nextKey);
    if (previousKey) releaseHandObjectFocus(previousKey, "canvas-hover");
    state.handHoverKey = nextKey;
    if (target) focusHandObject(target.kind, target.object, "canvas-hover");
    return Boolean(nextKey);
  }
  function beginHandObjectFocus(event, point) {
    if (state.mode !== "hand" || Number(event.button) !== 0) return false;
    const target = handObjectToolbarTargetAtPoint(point);
    if (!target) return false;
    const token = `pointer:${event.pointerId}`,
      key = focusHandObject(target.kind, target.object, token);
    if (!key) return false;
    state.handPointerFocusKeys.set(event.pointerId, { key, token });
    return true;
  }
  function updateHandObjectFocus(event) {
    const focus = state.handPointerFocusKeys.get(event.pointerId);
    if (!focus) return false;
    refreshHandObjectToolbar(focus.key);
    return true;
  }
  function finishHandObjectFocus(event) {
    const focus = state.handPointerFocusKeys.get(event.pointerId);
    if (!focus) return false;
    state.handPointerFocusKeys.delete(event.pointerId);
    releaseHandObjectFocus(focus.key, focus.token);
    return true;
  }
  function beginWidgetOwnedHandGesture(id) {
    state.handWidgetPointerIds.add(id);
    state.handGestureIncludesWidget = true;
    state.panGesture = null;
    state.touchGesture = null;
    setNavigating(false);
  }
  function finishWidgetOwnedHandGesture(id) {
    state.handWidgetPointerIds.delete(id);
    if (!state.handWidgetPointerIds.size && !state.touches.size) state.handGestureIncludesWidget = false;
  }
  function clearWidgetOwnedHandGestures(widget = null) {
    const pointerPrefix = widget ? `widget-host:${widget.id}:` : "",
      belongsToWidget = (id) => !pointerPrefix || String(id).startsWith(pointerPrefix),
      ids = new Set([...state.handWidgetPointerIds, ...widgetHostPointerAnchors.keys()].filter(belongsToWidget)),
      ownsDrag = Boolean(widget && state.widgetGesture?.widget === widget),
      hadWidgetGesture = ownsDrag || ids.size > 0 || !widget && state.handGestureIncludesWidget;
    if (!hadWidgetGesture) return false;
    for (const id of ids) {
      finishHandObjectFocus({ pointerId:id });
      finishWidgetRefineTouch(id);
    }
    if (widget) {
      for (const id of ids) {
        state.handWidgetPointerIds.delete(id);
        widgetHostPointerAnchors.delete(id);
      }
      if (ownsDrag) {
        state.widgetGesture = null;
        resetCanvasCursor();
      }
      state.handGestureIncludesWidget = Boolean(state.handWidgetPointerIds.size || widgetHostPointerAnchors.size);
    } else {
      state.handWidgetPointerIds.clear();
      widgetHostPointerAnchors.clear();
      state.handGestureIncludesWidget = false;
    }
    return true;
  }
  function beginCanvasWidgetGestureResetTap(event, point) {
    canvasWidgetGestureResetTap = null;
    if (state.mode !== "hand" || !state.handGestureIncludesWidget && !state.handWidgetPointerIds.size && !widgetHostPointerAnchors.size) return false;
    if (!["mouse", "touch"].includes(event.pointerType) || event.pointerType === "mouse" && Number(event.button) !== 0) return false;
    if (event.isPrimary === false || state.pointers.size || !point || !valid(point) || handObjectToolbarTargetAtPoint(point)) return false;
    canvasWidgetGestureResetTap = { id:event.pointerId, startX:event.clientX, startY:event.clientY };
    return true;
  }
  function updateCanvasWidgetGestureResetTap(event) {
    const tap = canvasWidgetGestureResetTap;
    if (!tap || tap.id !== event.pointerId) return false;
    if (state.pointers.size > 1 || Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > HAND_WIDGET_GESTURE_RESET_TAP_PX) {
      canvasWidgetGestureResetTap = null;
      return false;
    }
    return true;
  }
  function finishCanvasWidgetGestureResetTap(event) {
    const tap = canvasWidgetGestureResetTap;
    if (!tap || tap.id !== event.pointerId) return false;
    canvasWidgetGestureResetTap = null;
    if (state.mode !== "hand" || event.type === "pointercancel" || state.pointers.size || state.touches.size
      || Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > HAND_WIDGET_GESTURE_RESET_TAP_PX) return false;
    return clearWidgetOwnedHandGestures();
  }
  function cancelCanvasWidgetGestureResetTap() {
    canvasWidgetGestureResetTap = null;
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
    if (edit) clearHandToolbarTarget("image", edit.id);
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    let refineCandidate = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.imageHistoryBefore = null;
    if (edit && state.dirtyImageIds.has(edit.id)) {
      recomputeDirtyBounds();
      refineCandidate = relatchWidgetRefineCandidateFromDirty();
    }
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit && restoreMode) finishManualImageHandMode();
    else if (edit) state.imageHandReturnMode = null;
    if (edit && options.showHint) showHandStatusHint("image-confirmed", ["handImageConfirmedHint", "handAutoAIManual"]);
    if (edit && state.mode !== "hand" && !refineCandidate) schedule();
    return Boolean(edit);
  }
  function cancelImageEdit() {
    const edit = state.imageEdit,
      item = edit ? state.images.find((candidate) => candidate.id === edit.id) : null;
    if (edit) clearHandToolbarTarget("image", edit.id);
    if (item) Object.assign(item, edit.before);
    state.imageHistoryBefore = null;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    let refineCandidate = null;
    if (edit && state.dirtyImageIds.has(edit.id)) {
      recomputeDirtyBounds();
      refineCandidate = relatchWidgetRefineCandidateFromDirty();
    }
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit) finishManualImageHandMode();
    if (edit && state.mode !== "hand" && !refineCandidate) schedule();
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
    refreshHandObjectToolbar();
    requestInteractionLayerRender();
    return true;
  }
  function deleteImage(item) {
    if (!item || !state.images.includes(item)) return false;
    const edited = state.imageEdit?.id === item.id;
    clearHandToolbarTarget("image", item.id, { preserveInactive:false });
    recordImagesBefore();
    state.images = state.images.filter((candidate) => candidate !== item);
    state.dirtyImageIds.delete(item.id);
    recomputeDirtyBounds();
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
  function mergeImage(item, options = null) {
    options ||= {};
    if (!item || !state.images.includes(item)) return false;
    clearHandToolbarTarget("image", item.id, { preserveInactive:false });
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
    trackMergedImageAsDirty(item, box);
    state.images = state.images.filter((candidate) => candidate !== item);
    state.dirtyImageIds.delete(item.id);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    recomputeDirtyBounds();
    if (edited) finishManualImageHandMode();
    state.autoEligible = true;
    if (state.mode !== "hand") schedule();
    save();
    requestRender();
    setStatusKey("imageMerged");
    if (options.showHint) showHandStatusHint("image-merged", ["handImageMergedHint", "handAutoAIManual"]);
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
      state.dirtyImageIds.add(item.id);
      recomputeDirtyBounds();
      state.autoEligible = true;
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
  function capturableWidgets(region = null) {
    const widgets = visibleWidgets(region),
      pending = state.pendingWidget;
    if (!pending || !pending.shell || pending.hiddenForReplacement || !pluginEnabled(pending.pluginId) || !pluginManifests.has(pending.pluginId)
      || region && !intersection(widgetBox(pending), region) || widgets.includes(pending)) return widgets;
    return [...widgets, pending];
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
      contentVersion: 0,
      snapshotVersion: -1,
      shell: null,
      frame: null,
      hostOrigin: null,
      pending: false,
      runtimeDiagnostics: null,
    };
  }
  function restoreWidgets(items) {
    clearHandToolbarTargets("widget");
    if (activeWidgetRefinement()) supersedeActiveAI("widgets-restored");
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
    if (configuredAccessSession) url.searchParams.set("access-session", configuredAccessSession);
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
    frame.addEventListener("pointerenter", (event) => {
      if (state.mode !== "hand" || event.pointerType === "touch") return;
      updateHandObjectHover(clientPoint(event));
    });
    frame.addEventListener("pointerleave", () => updateHandObjectHover(null));
    frame.addEventListener("focus", () => focusHandObject("widget", widget, "widget-focus"));
    frame.addEventListener("blur", () => releaseHandObjectFocus(handToolbarKey("widget", widget.id), "widget-focus"));
    shell.append(frame);
    widgetLayer.append(shell);
    widget.shell = shell;
    widget.frame = frame;
    widget.hostOrigin = new URL(frame.src).origin;
    widget.runtimeDiagnostics = null;
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostReadyPromise = new Promise((resolve) => (widget.resolveHostReady = resolve));
    widget.hostStateKey = null;
    addWidgetStyleRule(widget);
    positionWidget(widget);
  }
  function unmountWidget(widget) {
    clearWidgetOwnedHandGestures(widget);
    clearHandToolbarTarget("widget", widget.id, { preserveInactive:false });
    removeWidgetStyleRule(widget);
    widget.shell?.remove();
    widget.shell = null;
    widget.frame = null;
    widget.hostOrigin = null;
    widget.initialized = false;
    widget.hostReady = false;
    widget.resolveHostReady = null;
    widget.hostReadyPromise = null;
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
      key = `${selected ? 1 : 0}:${active ? 1 : 0}:${state.navigationLocked ? 1 : 0}:${scaleX.toFixed(6)}:${scaleY.toFixed(6)}`;
    if (!force && widget.hostStateKey === key) return;
    widget.hostStateKey = key;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-state", selected, active, navigationLocked:state.navigationLocked, scaleX, scaleY }, widget.hostOrigin || location.origin);
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
  async function requestWidgetSnapshot(widget, timeoutMs = WIDGET_SNAPSHOT_TIMEOUT_MS, requireFresh = true) {
    if (widget.snapshotPromise) {
      const inFlight = widget.snapshotPromise;
      if (!requireFresh) return inFlight;
      try { await inFlight; } catch {}
      if (widget.snapshotImage && widget.snapshotVersion >= widget.contentVersion) return widget.snapshotImage;
    }
    timeoutMs = Math.max(1000, Math.min(WIDGET_SNAPSHOT_TIMEOUT_MS, Number(timeoutMs) || WIDGET_SNAPSHOT_TIMEOUT_MS));
    const snapshotPromise = (async () => {
      const previousActive = widget.renderActive,
        deadline = performance.now() + timeoutMs,
        remaining = () => Math.max(1, deadline - performance.now());
      try {
        if (!widget.frame?.contentWindow) throw Error(t("widgetExportFailed"));
        if (!widget.hostReady) {
          if (!widget.hostReadyPromise) throw Error(t("widgetExportFailed"));
          await Promise.race([
            widget.hostReadyPromise,
            new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), remaining())),
          ]);
        }
        widget.renderActive = true;
        widget.shell?.classList.remove("widget-offscreen");
        if (!widget.initialized) sendWidgetInit(widget);
        if (!widget.hostReady || !widget.initialized) throw Error(t("widgetExportFailed"));
        sendWidgetHostState(widget, undefined, undefined, true);
        const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            widgetSnapshotRequests.delete(requestId);
            reject(Error(t("widgetExportFailed")));
          }, remaining());
          widgetSnapshotRequests.set(requestId, { widget, resolve, reject, timer, contentVersion:widget.contentVersion });
          widget.frame.contentWindow.postMessage({ type:"penecho-widget-snapshot-request", requestId, width:widget.contentW, height:widget.contentH, timeoutMs:remaining() }, widget.hostOrigin || location.origin);
        });
      } finally {
        if (previousActive === false) {
          widget.renderActive = false;
          widget.shell?.classList.add("widget-offscreen");
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
    if (message.type === "penecho-widget-capture-ready") {
      return;
    }
    if (validWidgetHostActivate(message)) {
      if (state.mode === "hand") {
        const target = handObjectToolbarTargetFromWidgetMessage(widget, message);
        if (target) focusHandObject(target.kind, target.object);
      }
      return;
    }
    if (validWidgetHostDrag(message)) {
      if (message.type === "penecho-widget-drag-start") beginWidgetHostDrag(widget, message);
      else if (message.type === "penecho-widget-drag-move") updateWidgetHostDrag(widget, message);
      else finishWidgetHostDrag(widget, message);
      return;
    }
    if (validWidgetHostTouch(message)) {
      if (message.type === "penecho-widget-touch-start") beginWidgetHostTouch(widget, message);
      else if (message.type === "penecho-widget-touch-move") updateWidgetHostTouch(widget, message);
      else finishWidgetHostTouch(widget, message);
      return;
    }
    if (validWidgetRuntimeDiagnostics(message)) {
      widget.runtimeDiagnostics = {
        errors:message.errors.map(error => ({ ...error, stack:[...error.stack] })),
        truncated:message.truncated,
      };
      return;
    }
    if (message.type === "penecho-widget-updated") {
      widget.contentVersion++;
      return;
    }
    if (!["penecho-widget-snapshot", "penecho-widget-snapshot-error"].includes(message.type)) return;
    const pending = widgetSnapshotRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    widgetSnapshotRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === "penecho-widget-snapshot-error" || typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,")
      || !Number.isFinite(message.width) || message.width <= 0 || !Number.isFinite(message.height) || message.height <= 0) {
      if (message.type === "penecho-widget-snapshot-error") console.warn("PenEcho widget snapshot failed:", String(message.error || "unknown error").slice(0, 300));
      pending.reject(Error(t("widgetExportFailed")));
      return;
    }
    try {
      widget.snapshotImage = await decodeWidgetSnapshot(message.dataUrl);
      widget.snapshotVersion = pending.contentVersion;
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
  function acceptWidgetEdit(options = null) {
    options ||= {};
    const edit = state.widgetEdit;
    if (edit) clearHandToolbarTarget("widget", edit.id);
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
    if (edit && options.showHint) showHandStatusHint("widget-confirmed", ["handWidgetConfirmedHint", "handAutoAIManual"]);
    return Boolean(edit);
  }
  function cancelWidgetEdit() {
    const edit = state.widgetEdit,
      widget = edit ? state.widgets.find((item) => item.id === edit.id) : null;
    if (edit) clearHandToolbarTarget("widget", edit.id);
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
    if (result.hit === "accept") return (result.pending ? acceptPendingWidget({ showHint:true }) : acceptWidgetEdit({ showHint:true })) || true;
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
  function finishReleasedWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || event.pointerType !== "mouse" || Number(event.buttons) !== 0) return false;
    if (gesture.source !== "widget-host" && gesture.id !== event.pointerId) return false;
    return finishWidgetGesture({ pointerId:gesture.id });
  }
  function finishStaleWidgetHostGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.source !== "widget-host" || event.pointerType !== "mouse" || Number(event.button) !== 0) return false;
    return finishWidgetGesture({ pointerId:gesture.id });
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
  function validWidgetHostActivate(message) {
    return message?.type === "penecho-widget-activate"
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetRuntimeDiagnostics(message) {
    return message && message.type === "penecho-widget-runtime-diagnostics"
      && typeof message.truncated === "boolean" && Array.isArray(message.errors) && message.errors.length <= 5
      && message.errors.every(error => error && typeof error === "object"
        && ["error", "unhandledrejection", "script-load"].includes(error.kind)
        && typeof error.name === "string" && error.name.length > 0 && error.name.length <= 80
        && typeof error.message === "string" && error.message.length > 0 && error.message.length <= 400
        && typeof error.file === "string" && error.file.length > 0 && error.file.length <= 300
        && Number.isInteger(error.line) && error.line >= 0 && error.line <= 10000000
        && Number.isInteger(error.column) && error.column >= 0 && error.column <= 10000000
        && Number.isInteger(error.repeatedCount) && error.repeatedCount >= 1 && error.repeatedCount <= 1000000
        && Array.isArray(error.stack) && error.stack.length <= 3
        && error.stack.every(frame => typeof frame === "string" && frame.length > 0 && frame.length <= 300));
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
  function handObjectToolbarTargetFromWidgetMessage(widget, message) {
    const viewportPoint = widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return { kind:"widget", object:widget };
    return handObjectToolbarTargetAtPoint(clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y })) || { kind:"widget", object:widget };
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
  function beginWidgetHostTouch(widget, message) {
    if (state.mode !== "hand" || !validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-start") return false;
    const point = widgetHostViewportPoint(widget, message);
    if (!point) return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    widgetHostPointerAnchors.set(id, { clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY });
    beginWidgetOwnedHandGesture(id);
    const token = `pointer:${id}`,
      target = handObjectToolbarTargetFromWidgetMessage(widget, message),
      key = focusHandObject(target.kind, target.object, token);
    if (key) state.handPointerFocusKeys.set(id, { key, token });
    return true;
  }
  function updateWidgetHostTouch(widget, message) {
    if (state.mode !== "hand" || !validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-move") return false;
    const id = widgetHostPointerId(widget, message.pointerId),
      point = widgetHostTrackedPoint(widgetHostPointerAnchors.get(id), message) || widgetHostViewportPoint(widget, message);
    if (!point || !state.handWidgetPointerIds.has(id)) return false;
    return updateHandObjectFocus({ pointerId:id });
  }
  function finishWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-end") return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    if (!state.handWidgetPointerIds.has(id)) return false;
    finishHandObjectFocus({ pointerId:id });
    finishWidgetOwnedHandGesture(id);
    widgetHostPointerAnchors.delete(id);
    finishWidgetRefineTouch(id);
    return true;
  }
  function beginWidgetHostDrag(widget, message) {
    if (!validWidgetHostDrag(message) || message.type !== "penecho-widget-drag-start") return false;
    if (message.pointerType === "touch") {
      const id = widgetHostPointerId(widget, message.pointerId);
      if ([...state.handWidgetPointerIds].some((pointerId) => pointerId !== id)) return false;
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
    if (!gesture.pending) refreshHandObjectToolbar();
    requestInteractionLayerRender();
    return true;
  }
  function deleteWidget(widget) {
    if (!widget || widget.pending || !state.widgets.includes(widget)) return false;
    clearHandToolbarTarget("widget", widget.id, { preserveInactive:false });
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
    if (!options.allowRevisionMismatch && widget.revision !== state.userRevision) {
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
    if (replacement) {
      unmountWidget(widget);
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
      mountWidget(widget);
    } else {
      state.widgets.push(widget);
      if (widget.shell) {
        widget.shell.classList.remove("pending");
        widget.shell.tabIndex = 0;
        widget.hostStateKey = null;
        sendWidgetHostState(widget, undefined, undefined, true);
      } else mountWidget(widget);
    }
    const historyEntry = save();
    if (!replacement) recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
    requestInteractionLayerRender();
    setStatusKey("merged");
    resolve?.(true);
    if (restoreMode) finishAIDraftHandMode();
    if (options.showHint) showHandStatusHint("widget-draft-confirmed", ["handWidgetConfirmedHint", "handAutoAIManual"]);
    if (!replacement && restoreMode) showCanvasHint("canvasHintWidgetTouchHand");
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
    if (activeWidgetRefinement()) {
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
    if (widget.widgetType === "html_widget") showCanvasHint(["canvasHintWidgetAdded", "canvasHintWidgetAddedAlt", "canvasHintRefineInPlace", "canvasHintAIAddsOnly"]);
    setStatusKey("aiDone");
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
    acceptPendingWidget({ restoreMode:false });
    return Promise.resolve(state.widgets.includes(widget));
  }
  function widgetBounds(region = null) {
    let bounds = null;
    for (const widget of capturableWidgets(region)) bounds = unionLocalBounds(bounds, region ? intersection(widgetBox(widget), region) : widgetBox(widget));
    return bounds;
  }
  function drawWidgetsToContext(context, region = null) {
    for (const widget of capturableWidgets(region)) {
      if (!widget.snapshotImage) continue;
      context.drawImage(widget.snapshotImage, widget.x, widget.y, widget.w, widget.h);
    }
  }
  async function prepareVisibleWidgetSnapshots(region = null, bestEffort = true) {
    let widgets = [];
    try {
      widgets = capturableWidgets(region);
      const captured = await Promise.all(widgets.map(async (widget) => {
        try {
          const request = requestWidgetSnapshot(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true);
          if (bestEffort) await Promise.race([
            request,
            new Promise((_, reject) => setTimeout(() => reject(Error("snapshot-wait-expired")), WIDGET_HISTORY_SNAPSHOT_WAIT_MS)),
          ]);
          else await request;
        } catch (error) {
          debug("widget-snapshot-degraded", { widgetId:widget.id, error:String(error?.message || error).slice(0, 300) });
        }
        return Boolean(widget.snapshotImage);
      })),
        capturedCount = captured.filter(Boolean).length;
      return { total:widgets.length, captured:capturedCount, missing:widgets.length - capturedCount };
    } catch (error) {
      debug("widget-snapshot-preparation-failed", { error:String(error?.message || error).slice(0, 300) });
      const captured = widgets.filter((widget) => widget.snapshotImage).length;
      return { total:widgets.length, captured, missing:widgets.length - captured };
    }
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
    clearHandToolbarTargets("animation");
    state.animations = [];
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    // Legacy declarative animation scenes are intentionally no longer loaded.
    // Keeping this tolerant hook lets snapshots from older releases open silently.
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
  function acceptAnimationEdit(options = null) {
    options ||= {};
    const edit = state.animationEdit;
    if (edit) clearHandToolbarTarget("animation", edit.id);
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
    if (edit && options.showHint) showHandStatusHint("animation-confirmed", ["handAnimationConfirmedHint", "handAutoAIManual"]);
    return Boolean(edit);
  }
  function cancelAnimationEdit() {
    const edit = state.animationEdit,
      animation = edit ? state.animations.find((item) => item.id === edit.id) : null;
    if (edit) clearHandToolbarTarget("animation", edit.id);
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
    clearHandToolbarTarget("animation", animation.id, { preserveInactive:false });
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
      animationControls.classList.remove("hand-toolbar-hiding");
      if (!animationControls.hidden) animationControls.hidden = true;
      return;
    }
    const handRecord = target.kind === "confirmed" ? handToolbarRecord({ kind:"animation", id:target.animation.id }) : null;
    animationControls.classList.toggle("hand-toolbar-hiding", Boolean(handRecord?.hiding));
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
    placedContentLayer.width = screen.width;
    placedContentLayer.height = screen.height;
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
  function renderPlacedContentLayer(region = null) {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect(),
      visible = region || {
        x:Math.max(0, -state.panX / state.scale),
        y:Math.max(0, -state.panY / state.scale),
        w:Math.min(SIZE, (r.width - state.panX) / state.scale) - Math.max(0, -state.panX / state.scale),
        h:Math.min(SIZE, (r.height - state.panY) / state.scale) - Math.max(0, -state.panY / state.scale),
      };
    placedContentCtx.setTransform(d, 0, 0, d, 0, 0);
    placedContentCtx.clearRect(0, 0, r.width, r.height);
    if (visible.w <= 0 || visible.h <= 0) return;
    placedContentCtx.save();
    placedContentCtx.translate(state.panX, state.panY);
    placedContentCtx.scale(state.scale, state.scale);
    placedContentCtx.beginPath();
    placedContentCtx.rect(0, 0, SIZE, SIZE);
    placedContentCtx.clip();
    drawImagesToContext(placedContentCtx, visible, state.widgetShadowEnabled);
    drawTextBoxesToContext(placedContentCtx, visible);
    placedContentCtx.restore();
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
    ctx.restore();
    ctx.strokeStyle = state.paint.border;
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.restore();
    renderPlacedContentLayer({ x:l, y:t, w:rr - l, h:b - t });
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
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function drawHandObjectToolbarOutlines(context) {
    if (state.mode !== "hand" || !state.handToolbarTargets.size) return;
    const unit = 1 / state.scale;
    context.save();
    context.strokeStyle = "rgba(38, 121, 184, 0.42)";
    context.lineWidth = unit;
    for (const record of state.handToolbarTargets.values()) {
      if (!record.expanded) continue;
      const object = handToolbarObject(record),
        box = object && (record.kind === "widget" ? widgetBox(object)
          : record.kind === "image" ? imageBox(object)
          : record.kind === "animation" ? animationBox(object)
          : record.kind === "text-box" ? textBoxBox(object)
          : null);
      if (!box) continue;
      context.globalAlpha = record.hiding ? .28 : 1;
      context.strokeRect(box.x, box.y, box.w, box.h);
    }
    context.restore();
  }
  function widgetRefineOutlineTarget(widgetId) {
    const widget = visibleWidgets().find((item) => item.id === widgetId);
    return widget?.shell && !widget.pending && widget.renderActive !== false ? widget : null;
  }
  function strokeWidgetRefineOutline(context, widget, opacity = 1, muted = false, solid = false) {
    const box = widgetBox(widget),
      unit = 1 / state.scale;
    context.save();
    context.globalAlpha *= opacity;
    if (muted) context.strokeStyle = solid ? "#6b7280" : "rgba(107, 114, 128, 0.38)";
    else {
      context.strokeStyle = solid ? "#007aff" : "rgba(0, 122, 255, 0.34)";
    }
    context.lineWidth = (solid ? 2 : 1) * unit;
    context.setLineDash(solid ? [] : [4 * unit, 4 * unit]);
    context.lineCap = context.lineJoin = "round";
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function widgetRefineCandidateForId(widgetId) {
    const confirmation = state.widgetRefineConfirmation;
    if (confirmation?.widgetId === widgetId) return confirmation.candidate;
    return [state.widgetRefineCandidate, state.widgetRefineHoverCandidate].find(candidate => candidate?.widgetId === widgetId) || null;
  }
  function drawWidgetRefineButtonHoverOutline(context) {
    const widgetId = state.widgetRefineButtonHoverId;
    if (!["pen", "hand"].includes(state.mode) || !widgetId || state.widgetRefineClickPulse?.widgetId === widgetId) return;
    const widget = widgetRefineOutlineTarget(widgetId);
    if (widget) strokeWidgetRefineOutline(context, widget, 1, widgetRefineCandidateForId(widgetId)?.instructionMode === "implicit-polish");
  }
  function triggerWidgetRefineClickPulse(widgetId) {
    if (!widgetId) return;
    state.widgetRefineClickPulse = { widgetId, startedAt:performance.now() };
    requestInteractionLayerRender();
  }
  function drawWidgetRefineClickPulse(context) {
    const pulse = state.widgetRefineClickPulse;
    if (!pulse) return;
    const elapsed = performance.now() - pulse.startedAt;
    if (elapsed >= WIDGET_REFINE_CLICK_PULSE_MS) {
      if (state.widgetRefineClickPulse === pulse) state.widgetRefineClickPulse = null;
      return;
    }
    if (!["pen", "hand"].includes(state.mode)) return;
    const widget = widgetRefineOutlineTarget(pulse.widgetId);
    if (!widget) {
      if (state.widgetRefineClickPulse === pulse) state.widgetRefineClickPulse = null;
      return;
    }
    const progress = elapsed / WIDGET_REFINE_CLICK_PULSE_MS,
      opacity = Math.sin(progress * Math.PI * 2) ** 2;
    strokeWidgetRefineOutline(context, widget, opacity, widgetRefineCandidateForId(pulse.widgetId)?.instructionMode === "implicit-polish");
    requestInteractionLayerRender();
  }
  function currentWidgetRefineConfirmation() {
    const confirmation = state.widgetRefineConfirmation;
    if (!confirmation) return null;
    if (!validWidgetRefineCandidate(confirmation.candidate)) {
      state.widgetRefineConfirmation = null;
      return null;
    }
    const dirtyBox = confirmation.dirtyBox ? { ...confirmation.dirtyBox } : null,
      hasDirty = Boolean(confirmation.hasDirty && dirtyBox);
    return {
      ...confirmation,
      dirtyBox,
      hasDirty,
      instructionMode:hasDirty
        ? confirmation.candidate.instructionMode === "nearby-dirty" ? "nearby-dirty" : "viewport-dirty"
        : "implicit-polish",
    };
  }
  function widgetRefineEdgeMidpoints(box) {
    return [
      { x:box.x, y:box.y + box.h / 2, axis:"horizontal" },
      { x:box.x + box.w, y:box.y + box.h / 2, axis:"horizontal" },
      { x:box.x + box.w / 2, y:box.y, axis:"vertical" },
      { x:box.x + box.w / 2, y:box.y + box.h, axis:"vertical" },
    ];
  }
  function widgetRefineConnectorPoints(fromBox, toBox) {
    let closest = null;
    for (const from of widgetRefineEdgeMidpoints(fromBox))
      for (const to of widgetRefineEdgeMidpoints(toBox)) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (!closest || distance < closest.distance) closest = { from, to, distance };
      }
    if (!closest) return [];
    const { from, to } = closest;
    let points;
    if (from.axis === to.axis) {
      if (from.axis === "horizontal") {
        const middleX = (from.x + to.x) / 2;
        points = [from, { x:middleX, y:from.y }, { x:middleX, y:to.y }, to];
      } else {
        const middleY = (from.y + to.y) / 2;
        points = [from, { x:from.x, y:middleY }, { x:to.x, y:middleY }, to];
      }
    } else if (from.axis === "horizontal") points = [from, { x:to.x, y:from.y }, to];
    else points = [from, { x:from.x, y:to.y }, to];
    return points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  }
  function drawWidgetRefineConfirmation(context) {
    const confirmation = currentWidgetRefineConfirmation();
    if (!confirmation) return;
    const widget = widgetRefineOutlineTarget(confirmation.widgetId);
    if (!widget) return;
    strokeWidgetRefineOutline(context, widget, 1, !confirmation.hasDirty, true);
    if (!confirmation.dirtyBox) return;
    const box = confirmation.dirtyBox,
      widgetBounds = widgetBox(widget),
      unit = 1 / state.scale;
    context.save();
    context.strokeStyle = "#007aff";
    context.lineWidth = 2 * unit;
    context.setLineDash([]);
    context.lineCap = context.lineJoin = "round";
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.strokeStyle = "#007aff";
    context.lineWidth = 2 * unit;
    context.setLineDash([]);
    const connector = widgetRefineConnectorPoints(box, widgetBounds);
    if (connector.length > 1) {
      context.beginPath();
      context.moveTo(connector[0].x, connector[0].y);
      for (const point of connector.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
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
    if (widget.pending) {
      context.setLineDash([7 * unit, 6 * unit]);
      context.strokeRect(box.x, box.y, box.w, box.h);
      context.setLineDash([]);
    }
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
      imageEditBar.classList.remove("hand-toolbar-hiding");
      if (!imageEditBar.hidden) imageEditBar.hidden = true;
      return;
    }
    imageEditBar.classList.toggle("hand-toolbar-hiding", Boolean(handToolbarRecord({ kind:"image", id:item.id })?.hiding));
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
      if (next <= WIDGET_REFINE_PROXIMITY_PX) hits++;
    }
    return distance <= WIDGET_REFINE_PROXIMITY_PX ? { distance, hits } : null;
  }
  function boxWidgetProximity(widget, box) {
    if (!box) return null;
    const target = widgetBox(widget),
      dx = box.x + box.w < target.x ? target.x - box.x - box.w : target.x + target.w < box.x ? box.x - target.x - target.w : 0,
      dy = box.y + box.h < target.y ? target.y - box.y - box.h : target.y + target.h < box.y ? box.y - target.y - target.h : 0,
      distance = Math.hypot(dx, dy) * state.scale;
    return distance <= WIDGET_REFINE_PROXIMITY_PX ? { distance, hits:intersection(box, target) ? 1 : 0 } : null;
  }
  function validWidgetRefineCandidate(candidate) {
    return Boolean(candidate && state.widgets.includes(candidate.widget) && !candidate.widget.hiddenForReplacement
      && !candidate.widget.pending && candidate.widget.shell && candidate.widget.renderActive !== false);
  }
  function widgetRefineHintHovered(candidate) {
    return Boolean(candidate && (state.widgetRefineHoveredWidgetId === candidate.widgetId || state.widgetRefineButtonHoverId === candidate.widgetId));
  }
  function scheduleWidgetRefineHintRender() {
    clearTimeout(state.widgetRefineHintTimer);
    state.widgetRefineHintTimer = 0;
    const now = Date.now(),
      candidates = [state.widgetRefineCandidate, state.widgetRefineHoverCandidate],
      next = candidates.reduce((deadline, candidate) => candidate && !widgetRefineHintHovered(candidate) && candidate.hintUntil > now
        ? Math.min(deadline, candidate.hintUntil)
        : deadline, Infinity);
    if (!Number.isFinite(next)) return;
    state.widgetRefineHintTimer = setTimeout(() => {
      state.widgetRefineHintTimer = 0;
      requestInteractionLayerRender();
    }, Math.max(0, next - now));
  }
  function hideWidgetRefineHint() {
    let changed = false;
    for (const candidate of [state.widgetRefineCandidate, state.widgetRefineHoverCandidate]) {
      if (!candidate || !candidate.hintUntil) continue;
      candidate.hintUntil = 0;
      changed = true;
    }
    if (changed) {
      scheduleWidgetRefineHintRender();
      requestInteractionLayerRender();
    }
  }
  function widgetRefineHintVisible(candidate) {
    return Boolean(candidate && (widgetRefineHintHovered(candidate) || candidate.hintUntil > Date.now()));
  }
  function clearWidgetRefineHoverCandidate() {
    clearTimeout(state.widgetRefineHoverTimer);
    state.widgetRefineHoverTimer = 0;
    state.widgetRefineHoverCandidate = null;
    scheduleWidgetRefineHintRender();
  }
  function clearWidgetRefineCandidate() {
    clearWidgetRefineHoverCandidate();
    clearTimeout(state.widgetRefineHintTimer);
    state.widgetRefineHintTimer = 0;
    state.widgetRefineCandidate = null;
    state.widgetRefineConfirmation = null;
    requestInteractionLayerRender();
  }
  function dismissWidgetRefineCandidate() {
    clearWidgetRefineCandidate();
  }
  function latchWidgetRefineCandidate(input, kind = "stroke") {
    if (state.widgetRefineCandidate || state.pending || state.pendingWidget || state.pendingWidgetReplacement) return state.widgetRefineCandidate;
    const candidates = [];
    for (const widget of visibleWidgets()) {
      if (!widget.shell || widget.renderActive === false || widget.pending) continue;
      const dirty = kind === "text-box"
        ? boxWidgetProximity(widget, textBoxBox(input))
        : kind === "box"
          ? boxWidgetProximity(widget, input)
          : strokeWidgetProximity(widget, input);
      if (!dirty) continue;
      candidates.push({
        widget,
        widgetId:widget.id,
        instructionMode:"nearby-dirty",
        hintKey:"widgetRefineNearbyHint",
        hintUntil:Date.now() + WIDGET_REFINE_HINT_MS,
        distance:dirty.distance,
        hits:dirty.hits,
      });
    }
    candidates.sort((a, b) => a.distance - b.distance || b.hits - a.hits || state.widgets.indexOf(b.widget) - state.widgets.indexOf(a.widget));
    state.widgetRefineCandidate = candidates[0] || null;
    if (state.widgetRefineCandidate) {
      scheduleWidgetRefineHintRender();
      requestInteractionLayerRender();
    }
    return state.widgetRefineCandidate;
  }
  function relatchWidgetRefineCandidateFromDirty() {
    clearWidgetRefineCandidate();
    if (state.hotspotTrail.length) {
      const strokeCandidate = latchWidgetRefineCandidate({
        trail:state.hotspotTrail,
        last:state.hotspotTrail.at(-1),
        erase:false,
      });
      if (strokeCandidate) return strokeCandidate;
    }
    for (const id of state.dirtyTextBoxIds) {
      const item = state.textBoxes.find((candidate) => candidate.id === id);
      if (item && latchWidgetRefineCandidate(item, "text-box")) return state.widgetRefineCandidate;
    }
    for (const id of state.dirtyImageIds) {
      const item = state.images.find((candidate) => candidate.id === id);
      if (item && latchWidgetRefineCandidate(imageBox(item), "box")) return state.widgetRefineCandidate;
    }
    return null;
  }
  function currentWidgetRefineCandidate() {
    const candidate = state.widgetRefineCandidate;
    if (!candidate) return null;
    if (!validWidgetRefineCandidate(candidate)) {
      state.widgetRefineCandidate = null;
      return null;
    }
    return candidate;
  }
  function currentWidgetRefineHoverCandidate() {
    const candidate = state.widgetRefineHoverCandidate;
    if (!candidate) return null;
    if (!validWidgetRefineCandidate(candidate) || candidate.expiresAt && candidate.expiresAt <= Date.now()) {
      clearWidgetRefineHoverCandidate();
      return null;
    }
    return candidate;
  }
  function viewportHasWidgetRefineInput() {
    const visible = viewportRect();
    return Boolean(state.dirty && visible && intersection(state.dirty, visible));
  }
  function selectedWidgetRefineCandidate(widget, persistentCandidate, hoverCandidate) {
    if (!widget || activeWidgetRefinement()) return null;
    if (persistentCandidate?.widget === widget) return persistentCandidate;
    if (hoverCandidate?.widget === widget) return hoverCandidate;
    const hasDirty = viewportHasWidgetRefineInput();
    return {
      widget,
      widgetId:widget.id,
      instructionMode:hasDirty ? "viewport-dirty" : "implicit-polish",
      hintKey:hasDirty ? "widgetRefineViewportHint" : "widgetRefineNoInputHint",
      hintUntil:0,
      expiresAt:0,
    };
  }
  function widgetAtRefinePoint(point) {
    if (!point || !valid(point)) return null;
    const widgets = visibleWidgets(),
      padding = state.mode === "hand" ? 12 / Math.max(.03, state.scale) : 0;
    for (let index = widgets.length - 1; index >= 0; index--) {
      const widget = widgets[index], box = widgetBox(widget);
      if (widget.shell && widget.renderActive !== false && point.x >= box.x - padding && point.x <= box.x + box.w + padding && point.y >= box.y - padding && point.y <= box.y + box.h + padding) return widget;
    }
    return null;
  }
  function scheduleWidgetRefineHoverClear() {
    const candidate = currentWidgetRefineHoverCandidate();
    if (!candidate || state.widgetRefineHoverTimer || widgetRefineHintHovered(candidate)) return;
    candidate.expiresAt = Date.now() + WIDGET_REFINE_HOVER_GRACE_MS;
    state.widgetRefineHoverTimer = setTimeout(() => {
      state.widgetRefineHoverTimer = 0;
      if (widgetRefineHintHovered(candidate)) return;
      if (state.widgetRefineHoverCandidate === candidate) state.widgetRefineHoverCandidate = null;
      scheduleWidgetRefineHintRender();
      requestInteractionLayerRender();
    }, WIDGET_REFINE_HOVER_GRACE_MS);
  }
  function setWidgetRefineHoverCandidate(widget, showHint = true) {
    if (!widget || activeWidgetRefinement()) return null;
    const hasDirty = viewportHasWidgetRefineInput();
    clearTimeout(state.widgetRefineHoverTimer);
    state.widgetRefineHoverTimer = 0;
    let candidate = state.widgetRefineHoverCandidate;
    if (!candidate || candidate.widget !== widget || candidate.hasDirty !== hasDirty) candidate = {
      widget,
      widgetId:widget.id,
      hasDirty,
      instructionMode:hasDirty ? "viewport-dirty" : "implicit-polish",
      hintKey:hasDirty ? "widgetRefineViewportHint" : "widgetRefineNoInputHint",
      hintUntil:showHint ? Date.now() + WIDGET_REFINE_HINT_MS : 0,
      expiresAt:0,
    };
    candidate.expiresAt = 0;
    state.widgetRefineHoverCandidate = candidate;
    return candidate;
  }
  function beginWidgetRefineTouch(pointerId, widget) {
    if (!pointerId || !widget || state.mode !== "pen") return null;
    const candidate = setWidgetRefineHoverCandidate(widget, false);
    if (!candidate) return null;
    widgetRefineTouchCandidates.set(pointerId, candidate);
    state.widgetRefineHoveredWidgetId = widget.id;
    scheduleWidgetRefineHintRender();
    requestInteractionLayerRender();
    return candidate;
  }
  function finishWidgetRefineTouch(pointerId) {
    const candidate = widgetRefineTouchCandidates.get(pointerId);
    if (!candidate) return;
    widgetRefineTouchCandidates.delete(pointerId);
    if (![...widgetRefineTouchCandidates.values()].some(item => item.widgetId === candidate.widgetId)
      && state.widgetRefineHoveredWidgetId === candidate.widgetId) state.widgetRefineHoveredWidgetId = null;
    if (state.widgetRefineHoverCandidate === candidate) scheduleWidgetRefineHoverClear();
    scheduleWidgetRefineHintRender();
    requestInteractionLayerRender();
  }
  function updateWidgetRefinePointer(point) {
    state.widgetRefinePointer = point && valid(point) ? point : null;
    const widget = ["pen", "hand"].includes(state.mode) ? widgetAtRefinePoint(state.widgetRefinePointer) : null,
      previousHoverId = state.widgetRefineHoveredWidgetId,
      previousCandidate = state.widgetRefineHoverCandidate;
    const hasDirty = viewportHasWidgetRefineInput();
    state.widgetRefineHoveredWidgetId = widget?.id || null;
    if (widget && !activeWidgetRefinement()) {
      const candidate = setWidgetRefineHoverCandidate(widget);
      if (candidate && hasDirty) Object.assign(candidate, {
        instructionMode:"viewport-dirty",
        hintKey:"widgetRefineViewportHint",
      });
    }
    else scheduleWidgetRefineHoverClear();
    if (previousHoverId !== state.widgetRefineHoveredWidgetId || previousCandidate !== state.widgetRefineHoverCandidate) {
      scheduleWidgetRefineHintRender();
      requestInteractionLayerRender();
    }
  }
  function refreshWidgetRefineHoverCandidate() {
    updateWidgetRefinePointer(state.widgetRefinePointer);
  }
  function objectChromeAnchor(element) {
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect(),
      viewRect = view.getBoundingClientRect(),
      anchor = {
        x:rect.left - viewRect.left,
        y:rect.top - viewRect.top,
        width:rect.width,
        height:rect.height,
      };
    return Object.values(anchor).every(Number.isFinite) && anchor.width > 0 && anchor.height > 0 ? anchor : null;
  }
  function beginWidgetRefineConfirmation(candidate, anchor = null) {
    if (!validWidgetRefineCandidate(candidate) || activeWidgetRefinement()) return false;
    const visible = viewportRect(),
      dirtyBox = state.dirty && visible ? intersection(state.dirty, visible) : null,
      hasDirty = Boolean(dirtyBox);
    clearTimeout(state.timer);
    state.timer = 0;
    state.widgetRefineConfirmation = {
      candidate,
      widget:candidate.widget,
      widgetId:candidate.widgetId,
      anchor:anchor ? { ...anchor } : null,
      dirtyBox:dirtyBox ? { ...dirtyBox } : null,
      hasDirty,
      instructionMode:hasDirty
        ? candidate.instructionMode === "nearby-dirty" ? "nearby-dirty" : "viewport-dirty"
        : "implicit-polish",
    };
    state.widgetRefineButtonHoverId = null;
    requestInteractionLayerRender();
    return true;
  }
  function cancelWidgetRefineConfirmation() {
    if (!state.widgetRefineConfirmation) return false;
    clearWidgetRefineCandidate();
    if (state.auto && state.dirty && state.autoEligible) schedule(state.autoDelayMs);
    return true;
  }
  function confirmWidgetRefinement() {
    const confirmation = currentWidgetRefineConfirmation();
    if (!confirmation) return false;
    state.widgetRefineConfirmation = null;
    triggerWidgetRefineClickPulse(confirmation.widgetId);
    return requestWidgetRefinement(confirmation.widget, confirmation.instructionMode);
  }
  async function copyWidgetSource(widget) {
    const source = widgetCopySource(widget);
    if (!source) return false;
    const copied = await writeClipboardText(source);
    setStatusKey(copied ? "widgetSourceCopied" : "widgetSourceCopyFailed");
    return copied;
  }
  function widgetEditContext(widget, instructionMode) {
    const sourceMirrorsHtml = widgetUsesHtmlCopySource(widget);
    return {
      mode:"replace",
      widgetType:widget.widgetType,
      pluginId:widget.pluginId,
      title:widget.title,
      refreshSeconds:widget.refreshSeconds,
      instructionMode,
      box:widgetBox(widget),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(sourceMirrorsHtml ? { sourceMirrorsHtml:true } : widget.widgetType !== "diagram_source" && widget.copyText ? { source:widget.copyText, copyLabel:widget.copyLabel } : {}),
      ...(widget.widgetType === "html_widget" && widget.runtimeDiagnostics?.errors?.length ? { runtimeDiagnostics:widget.runtimeDiagnostics } : {}),
    };
  }
  function requestWidgetRefinement(widget, instructionMode) {
    if (!widget || activeWidgetRefinement() || !["pen", "hand"].includes(state.mode) || !state.widgets.includes(widget) || widget.hiddenForReplacement || state.pendingWidget || state.pendingWidgetReplacement) return false;
    clearTimeout(state.timer);
    state.timer = 0;
    clearWidgetRefineCandidate();
    supersedeActiveAI("widget-refine");
    setStatusKey("widgetRefining");
    const visible = viewportRect(),
      refineInputBox = state.dirty && visible ? intersection(state.dirty, visible) : null;
    void requestAI("answer", null, {
      captureCurrentViewport:true,
      widgetEditTarget:widget,
      widgetEditContext:widgetEditContext(widget, instructionMode),
      attentionBox:refineInputBox,
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
      items = [],
      copyLabel = widgetCopySourceLabel(widget);
    if (options.copy && copyLabel) items.push({
      key:`widget:${widget.id}:tool-copy`,
      kind:"copy",
      label:copyLabel,
      baseWidth:widgetToolLabelWidth(copyLabel, 118),
      activate:() => void copyWidgetSource(widget),
    });
    if (options.refine && state.widgetRefineConfirmation?.widgetId !== widget.id) items.push({
      key:`widget:${widget.id}:tool-refine`,
      kind:"refine",
      label:t("widgetRefine"),
      baseWidth:112,
      refineCandidate:options.refine,
      activate:(button) => void beginWidgetRefineConfirmation(options.refine, objectChromeAnchor(button)),
    });
    if (!items.length) return;
    const gap = 4,
      groupHorizontalWidth = items.reduce((sum, item) => sum + item.baseWidth, 0) + gap * (items.length - 1),
      groupVerticalWidth = Math.max(...items.map(item => item.baseWidth)),
      groupVerticalHeight = items.length * 34 + gap * (items.length - 1),
      controlScale = 1,
      widgetToolGroup = `widget-${widget.id}`;
    let horizontalOffset = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      specs.push({
        ...item,
        box,
        widget,
        widgetTool:true,
        widgetToolGroup,
        groupRefineCandidate:options.refine || null,
        groupItemCount:items.length,
        groupHorizontalWidth,
        groupVerticalWidth,
        groupVerticalHeight,
        groupHorizontalOffset:horizontalOffset,
        groupVerticalOffset:index * (34 + gap),
        controlScale,
        baseHeight:34,
        handToolbar:Boolean(options.handToolbar),
        handToolbarKey:options.handToolbarKey || "",
        handToolbarHiding:Boolean(options.handToolbarHiding),
        priority:6,
      });
      horizontalOffset += item.baseWidth + gap;
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
      const horizontalWidth = spec.groupHorizontalWidth * controlScale,
        verticalWidth = spec.groupVerticalWidth * controlScale,
        verticalHeight = spec.groupVerticalHeight * controlScale,
        hintSpace = spec.groupRefineCandidate && widgetRefineHintVisible(spec.groupRefineCandidate) ? 88 : 0,
        gap = chromeGap * controlScale,
        positions = [
          { side:"top", layout:"horizontal", x:right - horizontalWidth, y:screenBox.top - height - gap, w:horizontalWidth, h:height },
          { side:"right", layout:"vertical", x:right + gap, y:screenBox.top, w:verticalWidth, h:verticalHeight },
          { side:"right", layout:"vertical", x:right + gap, y:screenBox.top + screenBox.height / 2 - verticalHeight / 2, w:verticalWidth, h:verticalHeight },
          { side:"bottom", layout:"horizontal", x:right - horizontalWidth, y:bottom + gap, w:horizontalWidth, h:height },
          { side:"bottom", layout:"horizontal", x:screenBox.left, y:bottom + gap, w:horizontalWidth, h:height },
          { side:"left", layout:"vertical", x:screenBox.left - verticalWidth - gap, y:screenBox.top + screenBox.height / 2 - verticalHeight / 2, w:verticalWidth, h:verticalHeight },
        ].map(position => ({
          ...position,
          x:Math.max(6, Math.min(Math.max(6, viewportWidth - position.w - 6), position.x)),
          y:Math.max(6, Math.min(Math.max(6, viewportHeight - position.h - hintSpace - 12), position.y)),
        })),
        viewRect = view.getBoundingClientRect(),
        obstacles = [...document.querySelectorAll(".top-row, .toolbar, .animation-controls:not([hidden]), .image-edit-bar:not([hidden]), .selection-context-toolbar, .text-editor, .ai-embodiment, .object-chrome-button")]
          .filter(element => element.dataset.objectChromeKey !== ignoreKey && element.dataset.widgetToolGroup !== spec.widgetToolGroup)
          .map(element => {
          const rect = element.getBoundingClientRect();
          return { x:rect.left - viewRect.left, y:rect.top - viewRect.top, w:rect.width, h:rect.height };
        }),
        overlapsObstacle = position => obstacles.some(obstacle => position.x < obstacle.x + obstacle.w + 5 && position.x + position.w + 5 > obstacle.x && position.y < obstacle.y + obstacle.h + 5 && position.y + position.h + 5 > obstacle.y),
        groupPosition = positions.find(position => !overlapsObstacle(position)) || positions[0];
      const vertical = groupPosition.layout === "vertical",
        alignRight = vertical && groupPosition.side === "left";
      return {
        x:groupPosition.x + (vertical ? alignRight ? groupPosition.w - width : 0 : spec.groupHorizontalOffset * controlScale),
        y:groupPosition.y + (vertical ? spec.groupVerticalOffset * controlScale : 0),
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
  function widgetRefineConfirmationPosition(anchor, width, height, viewportWidth, viewportHeight) {
    const safeAnchor = anchor && [anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)
        ? anchor
        : { x:8, y:8, width:0, height:0 },
      min = 8,
      maxX = Math.max(min, viewportWidth - width - min),
      maxY = Math.max(min, viewportHeight - height - min);
    return {
      x:Math.max(min, Math.min(maxX, safeAnchor.x + safeAnchor.width / 2 - width / 2)),
      y:Math.max(min, Math.min(maxY, safeAnchor.y + safeAnchor.height / 2 - height / 2)),
    };
  }
  function syncWidgetRefineConfirmation() {
    const confirmation = currentWidgetRefineConfirmation();
    if (!confirmation) {
      if (widgetRefineConfirmationElement) {
        widgetRefineConfirmationElement.remove();
        widgetRefineConfirmationElement = null;
      }
      return;
    }
    const widget = widgetRefineOutlineTarget(confirmation.widgetId);
    if (!widget) return;
    if (!widgetRefineConfirmationElement) {
      const element = document.createElement("div"),
        copy = document.createElement("span"),
        yes = document.createElement("button"),
        no = document.createElement("button");
      element.className = "widget-refine-confirmation";
      copy.className = "widget-refine-confirmation-copy";
      yes.className = "widget-refine-confirmation-button confirm";
      no.className = "widget-refine-confirmation-button cancel";
      yes.type = no.type = "button";
      yes.innerHTML = OBJECT_CHROME_ICONS.accept;
      no.innerHTML = OBJECT_CHROME_ICONS.cancel;
      yes.setAttribute("aria-label", t("widgetRefineConfirm"));
      no.setAttribute("aria-label", t("widgetRefineCancel"));
      yes.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); confirmWidgetRefinement(); });
      no.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); cancelWidgetRefineConfirmation(); });
      element.append(copy, yes, no);
      objectChromeLayer.append(element);
      widgetRefineConfirmationElement = element;
    }
    const element = widgetRefineConfirmationElement,
      copy = element.querySelector(".widget-refine-confirmation-copy"),
      width = Math.max(180, Math.min(560, view.clientWidth - 24)),
      declaration = runtimeElementStyle(element, "widget-refine-confirmation");
    copy.textContent = t(confirmation.hasDirty ? "widgetRefineConfirmDirty" : "widgetRefineConfirmNoInput");
    element.classList.toggle("no-input", !confirmation.hasDirty);
    declaration?.setProperty("--widget-refine-confirm-width", `${width.toFixed(1)}px`);
    const layoutWidth = Math.max(width, element.offsetWidth || width),
      height = Math.max(42, element.offsetHeight || 42),
      screenBox = screenObjectBox(widgetBox(widget)),
      fallbackAnchor = {
        x:screenBox.left + screenBox.width / 2 - 56,
        y:Math.max(8, screenBox.top - 41),
        width:112,
        height:34,
      },
      position = widgetRefineConfirmationPosition(confirmation.anchor || fallbackAnchor, layoutWidth, height, view.clientWidth, view.clientHeight);
    declaration?.setProperty("--widget-refine-confirm-x", `${position.x.toFixed(1)}px`);
    declaration?.setProperty("--widget-refine-confirm-y", `${position.y.toFixed(1)}px`);
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
    } else if (spec.target === "text-box") {
      const item = spec.object;
      if (item && state.textBoxes.includes(item)) {
        recordTextBoxesBefore();
        state.textBoxGesture = { id:event.pointerId, item, startClientX:event.clientX, startClientY:event.clientY, startX:item.x, startY:item.y, changed:false };
        started = true;
      }
    }
    if (!started) return false;
    try { objectChromeLayer.setPointerCapture(event.pointerId); } catch {}
    return true;
  }
  function finishObjectChromeGesture(event) {
    finishHandToolbarOperation(event.pointerId);
    if (state.pendingGesture?.id === event.pointerId && !state.pendingGesture.copy) {
      state.pendingGesture = null;
      resetCanvasCursor();
      requestRender();
      return true;
    }
    if (state.widgetGesture?.id === event.pointerId) return finishWidgetGesture(event);
    if (state.imageGesture?.id === event.pointerId) return finishImageGesture(event);
    if (state.animationGesture?.id === event.pointerId) return finishAnimationGesture(event);
    if (state.textBoxGesture?.id === event.pointerId) return finishTextBoxChromeGesture(event);
    return false;
  }
  function updateTextBoxChromeGesture(event) {
    const gesture = state.textBoxGesture;
    if (!gesture || gesture.id !== event.pointerId || !state.textBoxes.includes(gesture.item)) return false;
    const item = gesture.item,
      scale = Math.max(.03, state.scale),
      x = Math.max(0, Math.min(SIZE - item.w, gesture.startX + (event.clientX - gesture.startClientX) / scale)),
      y = Math.max(0, Math.min(SIZE - item.h, gesture.startY + (event.clientY - gesture.startClientY) / scale));
    if (x === item.x && y === item.y) return true;
    item.x = x;
    item.y = y;
    gesture.changed = true;
    requestRender();
    return true;
  }
  function finishTextBoxChromeGesture(event) {
    const gesture = state.textBoxGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.textBoxGesture = null;
    if (gesture.changed) {
      state.userRevision++;
      state.dirtyTextBoxIds.add(gesture.item.id);
      recomputeDirtyBounds();
      state.autoEligible = true;
      save();
      const refineCandidate = latchWidgetRefineCandidate(gesture.item, "text-box");
      if (state.auto && !refineCandidate) schedule(Math.max(1000, state.autoDelayMs));
      if (refineCandidate) setStatusKey("widgetRefinePending");
      refreshHandObjectToolbar();
    } else {
      state.textBoxHistoryBefore = null;
      editTextBox(gesture.item);
    }
    requestRender();
    return true;
  }
  function createObjectChromeButton(key, kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `object-chrome-button ${kind}`;
    button.dataset.objectChromeKey = key;
    button.innerHTML = ["copy", "refine"].includes(kind) ? `${OBJECT_CHROME_ICONS[kind]}<span class="object-chrome-label"></span>${kind === "refine" ? '<span class="widget-refine-hint" hidden></span>' : ""}` : OBJECT_CHROME_ICONS[kind];
    ensureObjectChromeStyleRule(button);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      finishStaleWidgetHostGesture(event);
      if (button.penechoSpec?.handToolbar) {
        beginHandToolbarOperation(event.pointerId, button.penechoSpec.handToolbarKey);
        if (kind === "move") activateHandObjectToolbar(button.penechoSpec.handToolbarKey);
        refreshHandObjectToolbar(button.penechoSpec.handToolbarKey);
      }
      if (kind !== "move") {
        try { button.setPointerCapture(event.pointerId); } catch {}
        return;
      }
      beginObjectChromeMove(event, button.penechoSpec);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind === "move") return;
      if (kind === "refine") triggerWidgetRefineClickPulse(button.penechoSpec?.refineCandidate?.widgetId);
      button.penechoSpec?.activate?.(button);
    });
    button.addEventListener("pointerenter", (event) => {
      const key = button.penechoSpec?.handToolbarKey;
      if (key) setHandToolbarHold(key, `chrome-hover:${event.pointerId}:${key}`, true);
    });
    button.addEventListener("pointerleave", (event) => {
      const key = button.penechoSpec?.handToolbarKey;
      if (key) setHandToolbarHold(key, `chrome-hover:${event.pointerId}:${key}`, false);
    });
    button.addEventListener("focus", () => {
      const key = button.penechoSpec?.handToolbarKey;
      if (key) setHandToolbarHold(key, `chrome-focus:${key}`, true);
    });
    button.addEventListener("blur", () => {
      const key = button.penechoSpec?.handToolbarKey;
      if (key) setHandToolbarHold(key, `chrome-focus:${key}`, false);
    });
    if (kind === "refine") {
      button.addEventListener("pointerenter", () => {
        const candidate = button.penechoSpec?.refineCandidate;
        if (!candidate) return;
        state.widgetRefineButtonHoverId = candidate.widgetId;
        if (state.widgetRefineHoverCandidate === candidate) {
          clearTimeout(state.widgetRefineHoverTimer);
          state.widgetRefineHoverTimer = 0;
          candidate.expiresAt = 0;
        }
        scheduleWidgetRefineHintRender();
        requestInteractionLayerRender();
      });
      button.addEventListener("pointerleave", () => {
        const candidate = button.penechoSpec?.refineCandidate;
        if (state.widgetRefineButtonHoverId === candidate?.widgetId) state.widgetRefineButtonHoverId = null;
        if (state.widgetRefineHoverCandidate === candidate) scheduleWidgetRefineHoverClear();
        scheduleWidgetRefineHintRender();
        requestInteractionLayerRender();
      });
    }
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
      specs.push({ key:`${key}:accept`, kind:"accept", box, activate:() => itemIndex === null ? acceptPending({ showHint:true }) : acceptPendingItem(itemIndex), priority:5 });
      if (pendingCopyable(target)) specs.push({ key:`${key}:copy`, kind:"copy", box, activate:() => void copyPendingText(itemIndex), priority:5 });
    };
    if (pending.items) pending.items.forEach((item, index) => add(`pending-item:${index}`, pendingItemBounds(item), index, item));
    else add("pending", draftBounds(pending));
  }
  function objectChromeSpecs() {
    const persistentCandidate = currentWidgetRefineCandidate(),
      hoverCandidate = currentWidgetRefineHoverCandidate(),
      editWidget = state.mode === "hand" && state.widgetEdit ? selectedWidget() : null;
    if (state.mode !== "hand") {
      const specs = [];
      if (persistentCandidate) addWidgetToolSpecs(specs, persistentCandidate.widget, { refine:persistentCandidate });
      if (hoverCandidate && hoverCandidate.widget !== persistentCandidate?.widget) addWidgetToolSpecs(specs, hoverCandidate.widget, { refine:hoverCandidate });
      return specs;
    }
    const specs = [];
    for (const [key, record] of state.handToolbarTargets) {
      const handTarget = handToolbarObject(record),
        shared = { handToolbar:true, handToolbarKey:key, handToolbarHiding:Boolean(record.hiding) };
      if (!handTarget) continue;
      if (record.kind === "text-box" && !state.textEditors.size) {
        specs.push({ key:`text-box:${handTarget.id}:move`, kind:"move", box:textBoxBox(handTarget), target:"text-box", object:handTarget, ...shared, priority:2 });
      } else if (record.kind === "image") {
        specs.push({ key:`image:${handTarget.id}:move`, kind:"move", box:imageBox(handTarget), target:"image", object:handTarget, ...shared, priority:2 });
      } else if (record.kind === "animation") {
        const box = animationBox(handTarget);
        specs.push({ key:`animation:${handTarget.id}:move`, kind:"move", box, target:"animation", object:handTarget, ...shared, priority:2 });
        if (record.expanded && state.handToolbarActiveKey === key && state.animationEdit?.id === handTarget.id) {
          specs.push({ key:`animation:${handTarget.id}:cancel`, kind:"cancel", box, activate:cancelAnimationEdit, ...shared, priority:3 });
          specs.push({ key:`animation:${handTarget.id}:accept`, kind:"accept", box, activate:() => acceptAnimationEdit({ showHint:true }), ...shared, priority:3 });
        }
      } else if (record.kind === "widget") {
        const box = widgetBox(handTarget);
        specs.push({ key:`widget:${handTarget.id}:move`, kind:"move", box, target:"widget", object:handTarget, ...shared, priority:2 });
        if (record.expanded && state.handToolbarActiveKey === key && state.widgetEdit?.id === handTarget.id && editWidget === handTarget) {
          specs.push({ key:`widget:${handTarget.id}:cancel`, kind:"cancel", box, activate:() => deleteWidget(handTarget), ...shared, priority:3 });
          specs.push({ key:`widget:${handTarget.id}:accept`, kind:"accept", box, activate:() => acceptWidgetEdit({ showHint:true }), ...shared, priority:3 });
          addWidgetToolSpecs(specs, handTarget, { copy:true, handToolbar:true, handToolbarKey:key, handToolbarHiding:Boolean(record.hiding) });
        }
      }
    }
    pendingChromeSpecs(specs, state.pending);
    if (state.pendingWidget) {
      const widget = state.pendingWidget,
        box = widgetBox(widget);
      specs.push({ key:`pending-widget:${widget.id}:move`, kind:"move", box, target:"pending-widget", object:widget, priority:4 });
      specs.push({ key:`pending-widget:${widget.id}:cancel`, kind:"cancel", box, activate:rejectPendingWidget, priority:5 });
      specs.push({ key:`pending-widget:${widget.id}:accept`, kind:"accept", box, activate:() => acceptPendingWidget({ showHint:true }), priority:5 });
      addWidgetToolSpecs(specs, widget, { copy:true });
    }
    return specs;
  }
  function syncObjectChrome() {
    if (!objectChromeLayer) return;
    const active = new Set();
    let removedHoveredRefineButton = false;
    for (const spec of objectChromeSpecs()) {
      const button = objectChromeButtons.get(spec.key) || createObjectChromeButton(spec.key, spec.kind),
        position = objectChromePosition(spec.box, spec.kind, spec.key, spec);
      if (!position) continue;
      active.add(spec.key);
      const label = objectChromeLabel(spec.kind, spec),
        declaration = (button.penechoStyleRule || ensureObjectChromeStyleRule(button))?.["style"];
      button.penechoSpec = spec;
      button.classList.toggle("widget-tool", Boolean(spec.widgetTool));
      button.classList.toggle("solo-widget-tool", Boolean(spec.widgetTool && spec.groupItemCount === 1));
      button.classList.toggle("hand-toolbar-control", Boolean(spec.handToolbar));
      button.classList.toggle("hand-toolbar-hiding", Boolean(spec.handToolbar && spec.handToolbarHiding));
      button.classList.toggle("refine-no-input", Boolean(spec.refineCandidate?.instructionMode === "implicit-polish"));
      button.classList.toggle("refine-hovered", Boolean(spec.refineCandidate && widgetRefineHintHovered(spec.refineCandidate)));
      if (spec.widgetToolGroup) button.dataset.widgetToolGroup = spec.widgetToolGroup;
      else delete button.dataset.widgetToolGroup;
      button.setAttribute("aria-label", label);
      if (spec.kind === "refine") button.removeAttribute("title");
      else button.title = label;
      if (["copy", "refine"].includes(spec.kind)) button.querySelector(".object-chrome-label").textContent = label;
      if (spec.kind === "refine") {
        const hint = button.querySelector(".widget-refine-hint"),
          visible = widgetRefineHintVisible(spec.refineCandidate),
          hintWidth = Math.min(320, Math.max(120, view.clientWidth - 24)),
          hintLeft = Math.max(12, Math.min(Math.max(12, view.clientWidth - hintWidth - 12), position.x)) - position.x;
        hint.textContent = t(spec.refineCandidate?.hintKey || "widgetRefineHint");
        hint.hidden = !visible;
        declaration?.setProperty("--refine-hint-left", `${hintLeft.toFixed(1)}px`);
      }
      declaration?.setProperty("--object-control-x", `${position.x.toFixed(1)}px`);
      declaration?.setProperty("--object-control-y", `${position.y.toFixed(1)}px`);
      declaration?.setProperty("--object-control-scale", String(position.scale || 1));
      declaration?.setProperty("--object-control-width", `${position.baseWidth}px`);
      declaration?.setProperty("--object-control-height", `${position.baseHeight}px`);
      declaration?.setProperty("z-index", String(spec.priority || 1));
    }
    for (const [key, button] of objectChromeButtons) {
      if (active.has(key)) continue;
      if (button.penechoSpec?.kind === "refine"
        && state.widgetRefineButtonHoverId === button.penechoSpec.refineCandidate?.widgetId) {
        state.widgetRefineButtonHoverId = null;
        removedHoveredRefineButton = true;
      }
      removeObjectChromeStyleRule(button);
      button.remove();
      objectChromeButtons.delete(key);
    }
    if (removedHoveredRefineButton) requestInteractionLayerRender();
    syncWidgetRefineConfirmation();
  }
  objectChromeLayer?.addEventListener("pointermove", (event) => {
    if (finishReleasedWidgetGesture(event)) return;
    const overChromeControl = event.target?.closest?.(".object-chrome-button, .widget-refine-confirmation");
    if (event.pointerType !== "touch" && !overChromeControl) updateWidgetRefinePointer(clientPoint(event));
    if (state.pendingGesture?.id === event.pointerId) updatePendingGesture(event);
    else if (state.widgetGesture?.id === event.pointerId) updateWidgetGesture(event);
    else if (state.imageGesture?.id === event.pointerId) updateImageGesture(event);
    else if (state.animationGesture?.id === event.pointerId) updateAnimationGesture(event);
    else if (state.textBoxGesture?.id === event.pointerId) updateTextBoxChromeGesture(event);
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
    drawDirtyMaskDebugBounds(interactionCtx);
    drawWidgetRefineButtonHoverOutline(interactionCtx);
    drawWidgetRefineClickPulse(interactionCtx);
    drawWidgetRefineConfirmation(interactionCtx);
    drawHandObjectToolbarOutlines(interactionCtx);
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
  function unionDirtyBounds(current, next) {
    if (!current) return next ? { ...next } : null;
    if (!next) return { ...current };
    const x = Math.min(current.x, next.x),
      y = Math.min(current.y, next.y),
      right = Math.max(current.x + current.w, next.x + next.w),
      bottom = Math.max(current.y + current.h, next.y + next.h);
    return { x, y, w:right - x, h:bottom - y };
  }
  function dirtyInkDebugBounds() {
    let bounds = null;
    for (const [k, local] of state.dirtyInkBounds) {
      if (!local) continue;
      const [tx, ty] = k.split(",").map(Number);
      bounds = unionDirtyBounds(bounds, {
        x:tx * TILE + local.x / DIRTY_MASK_SCALE,
        y:ty * TILE + local.y / DIRTY_MASK_SCALE,
        w:local.w / DIRTY_MASK_SCALE,
        h:local.h / DIRTY_MASK_SCALE,
      });
    }
    return bounds;
  }
  function dirtyObjectDebugBounds(ids, items, boxForItem) {
    let bounds = null;
    for (const id of ids) {
      const item = items.find((candidate) => candidate.id === id);
      if (item) bounds = unionDirtyBounds(bounds, boxForItem(item));
    }
    return bounds;
  }
  function drawDirtyMaskDebugBounds(context) {
    if (!SHOW_DIRTY_MASK_DEBUG_BOUNDS) return;
    const boxes = [
      dirtyInkDebugBounds(),
      dirtyObjectDebugBounds(state.dirtyImageIds, state.images, imageBox),
      dirtyObjectDebugBounds(state.dirtyTextBoxIds, state.textBoxes, textBoxBox),
    ].filter(Boolean);
    if (!boxes.length) return;
    const unit = 1 / state.scale,
      margin = 3 * unit;
    context.save();
    context.strokeStyle = "rgba(107, 114, 128, 0.62)";
    context.lineWidth = unit;
    context.lineCap = "round";
    context.setLineDash([unit, 4 * unit]);
    for (const box of boxes) context.strokeRect(box.x - margin, box.y - margin, box.w + margin * 2, box.h + margin * 2);
    context.restore();
  }
  function mergeDirtyBox(box) {
    if (!box) return;
    state.dirty = unionDirtyBounds(state.dirty, box);
  }
  function dirtyMaskTile(tx, ty, create = true) {
    const k = key(tx, ty);
    if (!state.dirtyInkTiles.has(k) && create) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.ceil(TILE * DIRTY_MASK_SCALE);
      canvas.getContext("2d", { willReadFrequently:true });
      state.dirtyInkTiles.set(k, canvas);
      state.dirtyInkBounds.set(k, null);
    }
    return state.dirtyInkTiles.get(k) || null;
  }
  function dirtyMaskLocalBox(tx, ty, box) {
    const left = Math.max(0, (box.x - tx * TILE) * DIRTY_MASK_SCALE),
      top = Math.max(0, (box.y - ty * TILE) * DIRTY_MASK_SCALE),
      right = Math.min(TILE * DIRTY_MASK_SCALE, (box.x + box.w - tx * TILE) * DIRTY_MASK_SCALE),
      bottom = Math.min(TILE * DIRTY_MASK_SCALE, (box.y + box.h - ty * TILE) * DIRTY_MASK_SCALE);
    return right > left && bottom > top ? { x:left, y:top, w:right - left, h:bottom - top } : null;
  }
  function trackDirtyStrokeSegment(tx, ty, a, b, erase, size, box) {
    const canvas = dirtyMaskTile(tx, ty, !erase);
    if (!canvas) return;
    const context = canvas.getContext("2d", { willReadFrequently:true });
    context.save();
    context.globalCompositeOperation = erase ? "destination-out" : "source-over";
    context.strokeStyle = "#000";
    context.lineWidth = Math.max(1, size * DIRTY_MASK_SCALE);
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    context.moveTo((a.x - tx * TILE) * DIRTY_MASK_SCALE, (a.y - ty * TILE) * DIRTY_MASK_SCALE);
    context.lineTo((b.x - tx * TILE) * DIRTY_MASK_SCALE, (b.y - ty * TILE) * DIRTY_MASK_SCALE);
    context.stroke();
    context.restore();
    const k = key(tx, ty);
    if (erase) {
      state.dirtyInkBounds.delete(k);
      state.drawing?.dirtyMaskTouched?.add(k);
    }
    else state.dirtyInkBounds.set(k, unionDirtyBounds(state.dirtyInkBounds.get(k), dirtyMaskLocalBox(tx, ty, box)));
  }
  function trackMergedImageAsDirty(item, box) {
    const x0 = Math.max(0, Math.floor(box.x / TILE)),
      y0 = Math.max(0, Math.floor(box.y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.x + box.w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.y + box.h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const canvas = dirtyMaskTile(tx, ty),
          context = canvas.getContext("2d", { willReadFrequently:true });
        context.drawImage(
          item.image,
          (item.x - tx * TILE) * DIRTY_MASK_SCALE,
          (item.y - ty * TILE) * DIRTY_MASK_SCALE,
          item.w * DIRTY_MASK_SCALE,
          item.h * DIRTY_MASK_SCALE,
        );
        const k = key(tx, ty);
        state.dirtyInkBounds.set(k, unionDirtyBounds(state.dirtyInkBounds.get(k), dirtyMaskLocalBox(tx, ty, box)));
      }
  }
  function dirtyMaskAlphaBounds(canvas) {
    const { width, height } = canvas;
    if (!width || !height) return null;
    const data = canvas.getContext("2d", { willReadFrequently:true }).getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!data[(y * width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    return right < 0 ? null : { x:left, y:top, w:right - left + 1, h:bottom - top + 1 };
  }
  function recomputeDirtyBounds() {
    let next = null;
    for (const [k, canvas] of [...state.dirtyInkTiles]) {
      let local = state.dirtyInkBounds.get(k);
      if (!state.dirtyInkBounds.has(k)) {
        local = dirtyMaskAlphaBounds(canvas);
        state.dirtyInkBounds.set(k, local);
      }
      if (!local) {
        state.dirtyInkTiles.delete(k);
        state.dirtyInkBounds.delete(k);
        continue;
      }
      const [tx, ty] = k.split(",").map(Number);
      next = unionDirtyBounds(next, {
        x:tx * TILE + local.x / DIRTY_MASK_SCALE,
        y:ty * TILE + local.y / DIRTY_MASK_SCALE,
        w:local.w / DIRTY_MASK_SCALE,
        h:local.h / DIRTY_MASK_SCALE,
      });
    }
    for (const id of [...state.dirtyImageIds]) {
      const item = state.images.find((candidate) => candidate.id === id);
      if (item) next = unionDirtyBounds(next, imageBox(item));
      else state.dirtyImageIds.delete(id);
    }
    for (const id of [...state.dirtyTextBoxIds]) {
      const item = state.textBoxes.find((candidate) => candidate.id === id);
      if (item) next = unionDirtyBounds(next, textBoxBox(item));
      else state.dirtyTextBoxIds.delete(id);
    }
    state.dirty = next;
    if (!next) state.autoEligible = false;
    return next;
  }
  function clearDirtyContributionTracking() {
    state.dirtyInkTiles.clear();
    state.dirtyInkBounds.clear();
    state.dirtyImageIds.clear();
    state.dirtyTextBoxIds.clear();
  }
  function filterErasedDirtyHotspots(touchedTiles) {
    const pixels = new Map();
    state.hotspotTrail = state.hotspotTrail.filter((point) => {
      const tx = Math.floor(point.x / TILE),
        ty = Math.floor(point.y / TILE),
        k = key(tx, ty),
        canvas = state.dirtyInkTiles.get(k);
      if (touchedTiles && !touchedTiles.has(k)) return true;
      if (!canvas) return false;
      if (!pixels.has(k)) pixels.set(k, canvas.getContext("2d", { willReadFrequently:true }).getImageData(0, 0, canvas.width, canvas.height));
      const image = pixels.get(k),
        x = Math.max(0, Math.min(image.width - 1, Math.floor((point.x - tx * TILE) * DIRTY_MASK_SCALE))),
        y = Math.max(0, Math.min(image.height - 1, Math.floor((point.y - ty * TILE) * DIRTY_MASK_SCALE)));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx, py = y + dy;
          if (px >= 0 && py >= 0 && px < image.width && py < image.height && image.data[(py * image.width + px) * 4 + 3]) return true;
        }
      return false;
    });
  }
  function reconcileDirtyAfterTextBoxDeletion(deletedTextBox) {
    const deletedBox = textBoxBox(deletedTextBox);
    const latestTypedBox = state.latestTypedInput?.box,
      deletedLatestTypedInput = latestTypedBox
        && ["x", "y", "w", "h"].every((key) => Math.abs(latestTypedBox[key] - deletedBox[key]) < .001);
    if (deletedLatestTypedInput) state.latestTypedInput = null;
    state.dirtyTextBoxIds.delete(deletedTextBox.id);
    recomputeDirtyBounds();
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

  async function confirmTextEditor(editor, options = null) {
    options ||= {};
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
      state.dirtyTextBoxIds.add(item.id);
      recomputeDirtyBounds();
      state.latestTypedInput = { text: text.slice(0, TEXT_INPUT_MAX_LENGTH), box };
      state.autoEligible = true;
      const refineCandidate = latchWidgetRefineCandidate(item, "text-box");
      state.selectedTextBoxId = null;
      removeTextEditor(editor);
      blockCanvasInput(TEXT_INPUT_GUARD_MS);
      restoreTextEditorMode(editor);
      save();
      render();
      setStatusKey(mixedFallback ? "textMixedModeError" : "ready");
      if (state.auto && !refineCandidate) schedule(Math.max(1000, state.autoDelayMs));
      if (refineCandidate) setStatusKey("widgetRefinePending");
      else if (!mixedFallback && options.showHint) showHandStatusHint("text-confirmed", ["handTextConfirmedHint", "handAutoAIManual"]);
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
    let deletedTextBox = null;
    if (editor.sourceTextBoxId) {
      const index = state.textBoxes.findIndex((item) => item.id === editor.sourceTextBoxId);
      if (index >= 0) {
        recordTextBoxesBefore();
        deletedTextBox = state.textBoxes[index];
        state.textBoxes.splice(index, 1);
      }
      state.selectedTextBoxId = null;
    }
    removeTextEditor(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    if (editor.returnMode) restoreTextEditorMode(editor);
    else setCanvasMode("pen");
    if (deletedTextBox) {
      state.userRevision++;
      reconcileDirtyAfterTextBoxDeletion(deletedTextBox);
      save();
    }
    render();
    setStatusKey("ready");
    if (!deletedTextBox && !state.textEditors.size && state.auto && state.autoEligible) schedule(Math.max(1000, state.autoDelayMs));
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
    textarea.addEventListener("input", () => {
      hideWidgetRefineHint();
      if (editor.mixedMode) scheduleTextEditorPreview(editor);
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor, { showHint:true });
      }
    });
    preview.addEventListener("focus", () => focusTextEditor(editor));
    preview.addEventListener("pointerdown", () => focusTextEditor(editor));
    preview.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor, { showHint:true });
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
      confirmTextEditor(editor, { showHint:true });
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
    clearHandToolbarTarget("text-box", item.id);
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
    if (state.navigationLocked || state.touches.size < 2) return;
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
    if (state.navigationLocked) {
      setNavigating(true);
      return false;
    }
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
    if (state.navigationLocked) {
      setNavigating(true);
      return false;
    }
    state.panX += dx;
    state.panY += dy;
    updateCoordinates();
    requestRender();
    return true;
  }
  function zoomCanvasAt(clientX, clientY, deltaY) {
    if (state.navigationLocked) {
      setNavigating(true);
      return false;
    }
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
    return true;
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
    if (state.dirtyInkTiles.size || state.dirtyImageIds.size || state.dirtyTextBoxIds.size) {
      const tracked = recomputeDirtyBounds();
      if (tracked) return;
    }
    if (!box) return;
    mergeDirtyBox(box);
  }
  function invalidateRecognition() {
    supersedeActiveAI("recognition-invalidated");
    clearTimeout(state.timer);
    state.timer = 0;
    clearWidgetRefineCandidate();
    state.recognitionGeneration++;
    state.hotspotTrail = [];
    clearDirtyContributionTracking();
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
