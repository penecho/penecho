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
  let widgetInteractionStatusElement = null;
  let canvasWidgetGestureResetTap = null;
  let viewerAutoFitWidgetId = null;
  let viewerAutoFitCanvas = false;
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
  function textImageContentInset(image) {
    const x = Number(image?.contentInsetX),
      y = Number(image?.contentInsetY);
    return {
      x:Number.isFinite(x) ? x : 2,
      y:Number.isFinite(y) ? y : 2,
    };
  }
  let canvasTextQualityGeneration = 0;
  function textRasterPixels(image) {
    const width = Number(image?.width), height = Number(image?.height);
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width * height : 0;
  }
  function textImageRasterRatio(image) {
    const logicalWidth = Number(image?.logicalWidth), logicalHeight = Number(image?.logicalHeight),
      widthRatio = logicalWidth > 0 ? Number(image?.width) / logicalWidth : 0,
      heightRatio = logicalHeight > 0 ? Number(image?.height) / logicalHeight : 0;
    if (widthRatio > 0 && heightRatio > 0) return Math.min(widthRatio, heightRatio);
    return Math.max(widthRatio, heightRatio, 1);
  }
  function textRasterExtraPixels(item, image = item?.image) {
    const logicalWidth = Math.max(1, Number(image?.logicalWidth) || Number(item?.w) || 1),
      logicalHeight = Math.max(1, Number(image?.logicalHeight) || Number(item?.h) || 1);
    return Math.max(0, textRasterPixels(image) - logicalWidth * logicalHeight);
  }
  function desiredCanvasTextRasterRatio(scale = state.scale) {
    return Math.min(3, Math.max(1, (devicePixelRatio || 1) * Math.max(1, Number(scale) || 1)));
  }
  function textRasterRatioForBudget(item, targetRatio, remainingPixels) {
    const currentRatio = textImageRasterRatio(item?.image),
      currentPixels = textRasterPixels(item?.image),
      logicalPixels = Math.max(1, Number(item?.w) * Number(item?.h)),
      affordablePixels = Math.min(MAX_SHARP_OVERLAY_ITEM_PIXELS, currentPixels + Math.max(0, Number(remainingPixels) || 0)),
      affordableRatio = Math.sqrt(affordablePixels / logicalPixels);
    return Math.min(targetRatio, affordableRatio) > currentRatio * 1.05 ? Math.min(targetRatio, affordableRatio) : currentRatio;
  }
  function releaseTextRaster(image) {
    if (image?.tagName === "CANVAS") image.width = image.height = 1;
  }
  async function renderTextBoxImage(item, pixelRatio = desiredCanvasTextRasterRatio(), execution = null) {
    if(execution?.kind!=="mcp") {
    const fontFamily = normalizeTextBoxFontFamily(item.fontFamily),
      color = item.color || state.inkColor;
    try {
      return { image:await mixedTextImage(item.text, item.fontSize, color, item.maxWidth, 1.35, fontFamily, pixelRatio), mixedFallback:false };
    } catch {
      return { image:textImage(item.text, item.fontSize, color, item.maxWidth, 1.35, fontFamily, TEXT_INPUT_MAX_LENGTH, pixelRatio), mixedFallback:true };
    }
      }

    const fontFamily=normalizeTextBoxFontFamily(item.fontFamily),color=item.color||state.inkColor;
    const pending=renderTextBoxImage.pending||(renderTextBoxImage.pending=new Set());
    let timer,abandoned=false;
    try {
      if(pending.size>=8)throw Error("Previous MCP text rasters are still finishing");
      const operation=Promise.resolve().then(()=>mixedTextImage(item.text,item.fontSize,color,item.maxWidth,1.35,fontFamily,pixelRatio));
      pending.add(operation);
      operation.then(image=>{pending.delete(operation);if(abandoned)releaseTextRaster(image);},()=>pending.delete(operation));
      const image=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Text rendering timed out")),8_000);})]);
      return {image,mixedFallback:false};
    } catch {
      abandoned=true;
      return {image:textImage(item.text,item.fontSize,color,item.maxWidth,1.35,fontFamily,TEXT_INPUT_MAX_LENGTH,pixelRatio),mixedFallback:true};
    } finally {clearTimeout(timer);}
  }

  async function refreshVisibleTextBoxQuality() {
    const generation = ++canvasTextQualityGeneration;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (generation !== canvasTextQualityGeneration || view.classList.contains("canvas-navigation-previewing")) return false;
    const targetRatio = desiredCanvasTextRasterRatio(),
      visible = canvasRenderRegion().visible,
      candidates = visible.w > 0 && visible.h > 0 ? visibleTextBoxes(visible) : [],
      retainedExtraPixels = state.textBoxes.reduce((sum, item) => sum + textRasterExtraPixels(item), 0);
    let remainingPixels = Math.max(0, MAX_SHARP_OVERLAY_PIXELS - state.sharpOverlayPixels - retainedExtraPixels),
      changed = false;
    for (const item of candidates) {
      if (generation !== canvasTextQualityGeneration) return false;
      const currentImage = item.image,
        requestedRatio = textRasterRatioForBudget(item, targetRatio, remainingPixels);
      if (requestedRatio <= textImageRasterRatio(currentImage) * 1.05) continue;
      let rendered;
      try { rendered = await renderTextBoxImage(item, requestedRatio); }
      catch { continue; }
      const image = rendered.image,
        renderedRatio = textImageRasterRatio(image),
        renderedPixels = textRasterPixels(image),
        additionalPixels = Math.max(0, textRasterExtraPixels(item, image) - textRasterExtraPixels(item, currentImage));
      if (generation !== canvasTextQualityGeneration || !state.textBoxes.includes(item) || item.image !== currentImage
        || renderedRatio <= textImageRasterRatio(currentImage) * 1.05 || renderedPixels > MAX_SHARP_OVERLAY_ITEM_PIXELS
        || additionalPixels > remainingPixels) {
        releaseTextRaster(image);
        if (generation !== canvasTextQualityGeneration) return false;
        continue;
      }
      item.image = image;
      remainingPixels -= additionalPixels;
      changed = true;
    }
    if (generation !== canvasTextQualityGeneration || !changed) return false;
    renderTextContentLayer(canvasRenderRegion().visible);
    return true;
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
      fontFamily:item.fontFamily,
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
  async function fittedTextBoxContent(text, fontSize, color, maxWidth, fontFamily = TEXT_EDITOR_FONT_FAMILY, pixelRatio = desiredCanvasTextRasterRatio(), execution = null) {
    fontFamily = normalizeTextBoxFontFamily(fontFamily);
    const render = async () => {
      return renderTextBoxImage({ text, fontSize, color, maxWidth, fontFamily }, pixelRatio, execution);
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
      fontFamily,
      fontSize,
      maxWidth,
      width:Math.min(SIZE, width),
      height:Math.min(SIZE, height),
    };
  }
  async function renderedTextBoxRecord(item, pixelRatio = desiredCanvasTextRasterRatio(), execution = null) {
    if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim() || item.text.length > TEXT_INPUT_MAX_LENGTH) return null;
    const x = Number(item.x),
      y = Number(item.y),
      fontSize = Number(item.fontSize),
      maxWidth = Number(item.maxWidth);
    if (![x, y, fontSize, maxWidth].every(Number.isFinite) || x < 0 || y < 0 || fontSize < 1 || fontSize > 2000 || maxWidth < fontSize * 3 || maxWidth > SIZE) return null;
    const color = item.color || state.inkColor,
      fitted = await fittedTextBoxContent(item.text, fontSize, color, maxWidth, item.fontFamily, pixelRatio, execution),
      width = fitted.width,
      height = fitted.height,
      fittedX = Math.max(0, Math.min(SIZE - width, x)),
      fittedY = Math.max(0, Math.min(SIZE - height, y));
    if (width <= 0 || height <= 0) return null;
    return {
      id:typeof item.id === "string" && /^text-box-\d+$/.test(item.id) ? item.id : `text-box-${execution?.kind==="mcp" ? execution.nextTextBoxId++ : state.nextTextBoxId++}`,
      x:fittedX,
      y:fittedY,
      w:width,
      h:height,
      maxWidth:fitted.maxWidth,
      fontSize:fitted.fontSize,
      fontFamily:fitted.fontFamily,
      color:typeof item.color === "string" ? item.color : color,
      text:item.text,
      image:fitted.image,
    };
  }
  async function mcpPrepareTextBoxes(items,execution) {
    const prepared=[];execution.nextTextBoxId=1;
    try {
      for(const item of Array.isArray(items)?items.slice(0,MAX_VISIBLE_TEXT_BOXES):[]) {
        canvasAgentAssertToolExecution(execution);
        let record;
        try {
          record=item?.image&&textImageRasterRatio(item.image)>=1/1.05?textBoxHistoryRecord(item):await renderedTextBoxRecord(item,1,execution);
        }catch(error){canvasAgentAssertToolExecution(execution);continue;}
        if(!record)continue;
        try {canvasAgentAssertToolExecution(execution);}catch(error){if(record.image!==item?.image)releaseTextRaster(record.image);throw error;}
        if([item.x,item.y,item.w,item.h].every(Number.isFinite)&&item.x>=0&&item.y>=0&&item.w>0&&item.h>0&&item.x+item.w<=SIZE&&item.y+item.h<=SIZE)Object.assign(record,{x:item.x,y:item.y,w:item.w,h:item.h});
        if(prepared.some(existing=>existing.id===record.id))continue;
        const numbered=/^text-box-(\d+)$/.exec(record.id);
        if(numbered)execution.nextTextBoxId=Math.max(execution.nextTextBoxId,Number(numbered[1])+1);
        prepared.push(record);
      }
      return prepared;
    }catch(error){for(const item of prepared)if(!items.some(original=>original.image===item.image))releaseTextRaster(item.image);throw error;}
  }
  async function restoreTextBoxes(items, pixelRatio = 1) {
    canvasTextQualityGeneration++;
    clearHandToolbarTargets("text-box");
    clearTextEditors();
    state.textBoxes = [];
    state.nextTextBoxId = 1;
    state.selectedTextBoxId = null;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_TEXT_BOXES) : []) {
      let record = null;
      try {
        if (item?.image && textImageRasterRatio(item.image) >= pixelRatio / 1.05) record = textBoxHistoryRecord(item);
        else {
          record = await renderedTextBoxRecord(item, pixelRatio);
          // Raster dimensions describe typography; the saved frame describes
          // world placement. Rehydrating pixels must not reset their mapping.
          if(record&&[item.x,item.y,item.w,item.h].every(Number.isFinite)&&item.x>=0&&item.y>=0&&item.w>0&&item.h>0&&item.x+item.w<=SIZE&&item.y+item.h<=SIZE)
            Object.assign(record,{x:item.x,y:item.y,w:item.w,h:item.h});
        }
      } catch {
        // One invalid or unsupported text box must not make an otherwise valid
        // saved Canvas impossible to restore.
        continue;
      }
      if (!record || state.textBoxes.some((existing) => existing.id === record.id)) continue;
      const numbered = /^text-box-(\d+)$/.exec(record.id);
      if (numbered) state.nextTextBoxId = Math.max(state.nextTextBoxId, Number(numbered[1]) + 1);
      state.textBoxes.push(record);
    }
    positionTextEditors();
    requestRender();
    void refreshVisibleTextBoxQuality();
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
      ...(item.plotExpression ? { plotExpression:item.plotExpression } : {}),
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
      ...(item.plotExpression ? { plotExpression:item.plotExpression } : {}),
    };
  }
  function imageRecord(item) {
    if (!item || typeof item !== "object" || !(item.blob instanceof Blob) || !item.image || item.blob.size <= 0 || item.blob.size > MAX_IMAGE_SOURCE_BYTES) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, item.naturalW > 0 ? 1 : 80) || !n(item.h, item.naturalH > 0 ? 1 : 80) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const naturalW = Number(item.naturalW) || item.image.naturalWidth || item.image.width,
      naturalH = Number(item.naturalH) || item.image.naturalHeight || item.image.height,
      plotExpression = typeof item.plotExpression === "string" ? item.plotExpression.trim() : "";
    if (item.plotExpression !== undefined && (!plotExpression || plotExpression.length > 180)) return null;
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
      ...(plotExpression ? { plotExpression } : {}),
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
  function syncCanvasObjectLayerOrder() {
    const widgetInFront = state.frontCanvasObjectKind === "widget",
      selectedWidgetMaterialActive = Boolean(state.interactingWidgetId || (selectedWidgetMaterial && !selectedWidgetMaterial.hidden)),
      widgetStyle = runtimeElementStyle(widgetLayer, "widget-layer-stack"),
      imageMaterialStyle = runtimeElementStyle(imageMaterialLayer, "image-material-layer-stack"),
      imageStyle = runtimeElementStyle(placedContentLayer, "placed-content-layer-stack"),
      textEditorStyle = runtimeElementStyle(textEditorLayer, "text-editor-layer-stack");
    // Selection is a temporary lift above ink; click-to-front order survives deselection.
    // Ink follows the Widget carrier in DOM order at z-index 2.
    if (widgetStyle) widgetStyle.zIndex = selectedWidgetMaterialActive ? "3" : widgetInFront ? "2" : "1";
    if (imageMaterialStyle) imageMaterialStyle.zIndex = widgetInFront ? "1" : "2";
    if (imageStyle) imageStyle.zIndex = widgetInFront ? "1" : "2";
    if (textEditorStyle) textEditorStyle.setProperty("--text-editor-layer-z", selectedWidgetMaterialActive ? "2" : "3");
  }
  function setCanvasObjectFrontKind(kind) {
    if (!["image", "widget", "text-box"].includes(kind)) return false;
    const frontChanged = state.frontCanvasObjectKind !== kind,
      placedChanged = ["image", "text-box"].includes(kind) && state.frontPlacedCanvasObjectKind !== kind;
    if (!frontChanged && !placedChanged) return false;
    state.frontCanvasObjectKind = kind;
    if (["image", "text-box"].includes(kind)) state.frontPlacedCanvasObjectKind = kind;
    syncCanvasObjectLayerOrder();
    return true;
  }
  function restoreCanvasObjectFrontKinds(frontKind, placedKind) {
    const nextPlacedKind = ["image", "text-box"].includes(placedKind) ? placedKind : "image",
      nextFrontKind = ["image", "widget", "text-box"].includes(frontKind) ? frontKind : nextPlacedKind,
      changed = state.frontCanvasObjectKind !== nextFrontKind || state.frontPlacedCanvasObjectKind !== nextPlacedKind;
    if (!changed) return false;
    state.frontCanvasObjectKind = nextFrontKind;
    state.frontPlacedCanvasObjectKind = nextPlacedKind;
    syncCanvasObjectLayerOrder();
    return true;
  }
  function setTextBoxStackIndex(item, nextIndex) {
    const currentIndex = state.textBoxes.indexOf(item);
    if (currentIndex < 0 || !Number.isInteger(nextIndex)) return false;
    nextIndex = Math.max(0, Math.min(state.textBoxes.length - 1, nextIndex));
    if (currentIndex === nextIndex) return false;
    state.textBoxes.splice(currentIndex, 1);
    state.textBoxes.splice(nextIndex, 0, item);
    return true;
  }
  function bringTextBoxToFront(item) {
    if (!item || !state.textBoxes.includes(item)) return false;
    const stackChanged = setTextBoxStackIndex(item, state.textBoxes.length - 1),
      layerChanged = setCanvasObjectFrontKind("text-box"),
      changed = stackChanged || layerChanged;
    if (changed) requestRender();
    return changed;
  }
  function setImageStackIndex(item, nextIndex) {
    const currentIndex = state.images.indexOf(item);
    if (currentIndex < 0 || !Number.isInteger(nextIndex)) return false;
    nextIndex = Math.max(0, Math.min(state.images.length - 1, nextIndex));
    if (currentIndex === nextIndex) return false;
    state.images.splice(currentIndex, 1);
    state.images.splice(nextIndex, 0, item);
    return true;
  }
  function bringImageToFront(item) {
    if (!item || !state.images.includes(item)) return false;
    const stackChanged = setImageStackIndex(item, state.images.length - 1),
      layerChanged = setCanvasObjectFrontKind("image"),
      changed = stackChanged || layerChanged;
    if (changed && state.imageEdit?.id === item.id) state.imageEdit.changed = true;
    if (changed) requestRender();
    return changed;
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
  async function decodeStoredImage(item,execution=null) {
    if (!item || !(item.blob instanceof Blob)) return null;
    try {
      const image = await imageFromBlob(item.blob,execution);
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
    if (state.mode !== "select" && state.imageHandReturnMode === null) state.imageHandReturnMode = state.mode;
    if (state.mode !== "select") setCanvasMode("select", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function finishManualImageHandMode() {
    const returnMode = state.imageHandReturnMode;
    state.imageHandReturnMode = null;
    if (returnMode && state.mode === "select") setCanvasMode(returnMode, {
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
  function handToolbarHasActiveOperation(record) {
    return [...(record?.holds || [])].some((token) => token.startsWith("pointer:") || token.startsWith("operation:"));
  }
  function scheduleHandObjectToolbarTick() {
    clearTimeout(state.handToolbarTimer);
    state.handToolbarTimer = 0;
    let nextAt = Infinity;
    for (const record of state.handToolbarTargets.values()) {
      if (handToolbarHasActiveOperation(record)) continue;
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
      if (handToolbarHasActiveOperation(record)) continue;
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
    const allowed = ["select", "hand"].includes(state.mode) || (kind === "widget" && state.mode === "pen");
    if (!allowed || !object?.id || !["widget", "image", "animation", "text-box"].includes(kind)) return null;
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
    const previousKey = state.handToolbarActiveKey;
    if (previousKey && previousKey !== ensured.key) finishHandToolbarHide(previousKey);
    for (const key of [...state.handToolbarTargets.keys()]) {
      if (key !== ensured.key) finishHandToolbarHide(key);
    }
    if (kind === "widget") commitWidgetToolbarFront(object);
    state.handToolbarActiveKey = ensured.key;
    ensured.record.expanded = true;
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
      previousKey = state.handToolbarActiveKey;
    if (previousKey && previousKey !== key) finishHandToolbarHide(previousKey);
    for (const targetKey of [...state.handToolbarTargets.keys()]) {
      if (targetKey !== key) finishHandToolbarHide(targetKey);
    }
    state.handToolbarActiveKey = key;
    record.expanded = true;
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
    if (record.kind === "widget") commitWidgetToolbarFront(object);
    else if (record.kind === "image") bringImageToFront(object);
    else if (record.kind === "text-box") bringTextBoxToFront(object);
    if (record.kind === "animation") showAnimationControls(HAND_OBJECT_TOOLBAR_VISIBLE_MS + HAND_OBJECT_TOOLBAR_FADE_MS);
    refreshHandObjectToolbar(key);
    return true;
  }
  function showHandObjectToolbar(kind, object) {
    if (kind === "text-box") return editTextBox(object);
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
  function widgetAtPoint(point) {
    const widgets = visibleWidgets();
    for (let index = widgets.length - 1; index >= 0; index--) {
      const widget = widgets[index], box = widgetBox(widget);
      if (!widget.pending && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return widget;
    }
    return null;
  }
  function handObjectToolbarTargetAtPoint(point) {
    if (!point || !valid(point)) return null;
    const textBox = textBoxAtPoint(point),
      image = imageAtPoint(point),
      widget = widgetAtPoint(point),
      placed = state.frontPlacedCanvasObjectKind === "text-box"
        ? [{ kind:"text-box", object:textBox }, { kind:"image", object:image }]
        : [{ kind:"image", object:image }, { kind:"text-box", object:textBox }],
      ordered = state.frontCanvasObjectKind === "widget"
        ? [{ kind:"widget", object:widget }, ...placed]
        : [...placed, { kind:"widget", object:widget }],
      target = widget && (state.selectedWidgetId === widget.id || state.interactingWidgetId === widget.id)
        ? { kind:"widget", object:widget }
        : textBox ? { kind:"text-box", object:textBox } : ordered.find(candidate => candidate.object);
    if (target) return target;
    const animation = animationPointerHit(point)?.animation;
    if (animation) return { kind:"animation", object:animation };
    return null;
  }
  function updateHandObjectHover() {
    const previousKey = state.handHoverKey || "";
    state.handHoverKey = "";
    if (previousKey) releaseHandObjectFocus(previousKey, "canvas-hover");
    return false;
  }
  function beginHandObjectFocus(event, point) {
    if (state.mode !== "select" || Number(event.button) !== 0) return false;
    const target = handObjectToolbarTargetAtPoint(point);
    if (!target) return false;
    // Focus raises the selected Widget through focusHandObject.
    if (target.kind === "image") bringImageToFront(target.object);
    else if (target.kind === "text-box") bringTextBoxToFront(target.object);
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
        widget.shell?.classList.remove("is-resizing");
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
    if (state.mode !== "select" || !state.handGestureIncludesWidget && !state.handWidgetPointerIds.size && !widgetHostPointerAnchors.size) return false;
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
    if (state.mode !== "select" || event.type === "pointercancel" || state.pointers.size || state.touches.size
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
    state.imageEdit = {
      id:item.id,
      before:imageLayout(item),
      beforeIndex:state.images.indexOf(item),
      beforeFrontCanvasObjectKind:state.frontCanvasObjectKind,
      beforeFrontPlacedCanvasObjectKind:state.frontPlacedCanvasObjectKind,
      changed:false,
    };
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
      saveUserCanvasChange();
    } else if (edit) state.imageHistoryBefore = null;
    if (edit && state.dirtyImageIds.has(edit.id)) {
      recomputeDirtyBounds();
      refineCandidate = relatchWidgetRefineCandidateFromDirty();
    }
    requestRender();
    if (edit) setStatusKey(options.showHint ? "imagePlaced" : "ready");
    if (edit && restoreMode) finishManualImageHandMode();
    else if (edit) state.imageHandReturnMode = null;
    if (edit && state.mode !== "hand" && !refineCandidate) schedule();
    return Boolean(edit);
  }
  function cancelImageEdit() {
    const edit = state.imageEdit,
      item = edit ? state.images.find((candidate) => candidate.id === edit.id) : null;
    if (edit) clearHandToolbarTarget("image", edit.id);
    if (item) {
      Object.assign(item, edit.before);
      setImageStackIndex(item, edit.beforeIndex);
      restoreCanvasObjectFrontKinds(edit.beforeFrontCanvasObjectKind, edit.beforeFrontPlacedCanvasObjectKind);
    }
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
      resize = widgetResizeHit(box, point, pointerType);
    if (resize) return resize;
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
  function imageResizeCursor(point, pointerType = "mouse") {
    const hit = imagePointerHit(point, pointerType, false)?.hit;
    return hit === "resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "";
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
    bringImageToFront(result.image);
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
    saveUserCanvasChange();
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
    saveUserCanvasChange();
    if (state.mode !== "hand") schedule();
    requestRender();
    setStatusKey("imageMerged");
    return true;
  }
  function importedImagePlacement(naturalW, naturalH) {
    const visible = viewportRect() || { x:0, y:0, w:SIZE, h:SIZE },
      { width, height } = canvasViewportMetrics(),
      maxW = Math.max(80, Math.min(6000, visible.w * 0.72, Math.max(240, width * 0.52) / state.scale)),
      maxH = Math.max(80, Math.min(6000, visible.h * 0.72, Math.max(200, height * 0.52) / state.scale)),
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
      mcpRecordFeedback("image",imageBox(item),item);
      recomputeDirtyBounds();
      state.autoEligible = true;
      state.userRevision++;
      saveUserCanvasChange();
      requestRender();
      enterManualImageHandMode();
      beginImageEdit(item);
      showHandObjectToolbar("image", item);
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
    return { ...widgetBox(widget), contentW:widget.contentW, contentH:widget.contentH, fitContent:widget.fitContent === true, fitContentAxes:widget.fitContentAxes || null };
  }
  function visibleWidgets(region = null) {
    if (!widgetRuntimeEnabled()) return [];
    return state.widgets.filter((widget) => !widget.hiddenForReplacement && pluginEnabled(widget.pluginId) && pluginManifests.has(widget.pluginId) && (!region || intersection(widgetBox(widget), region)));
  }
  function syncWidgetLayerOrder() {
    let stackIndex = 1;
    for (const widget of state.widgets) {
      if (widget.styleRule?.style) widget.styleRule.style.zIndex = String(stackIndex);
      stackIndex++;
    }
    if (state.pendingWidget?.styleRule?.style) state.pendingWidget.styleRule.style.zIndex = String(stackIndex);
    // Toolbars do not change the visual/hit-test stacking order.
  }
  function setWidgetStackIndex(widget, nextIndex) {
    const currentIndex = state.widgets.indexOf(widget);
    if (currentIndex < 0 || !Number.isInteger(nextIndex)) return false;
    nextIndex = Math.max(0, Math.min(state.widgets.length - 1, nextIndex));
    if (currentIndex === nextIndex) return false;
    state.widgets.splice(currentIndex, 1);
    state.widgets.splice(nextIndex, 0, widget);
    syncWidgetLayerOrder();
    return true;
  }
  function bringHtmlWidgetToFront(widget) {
    if (!widget || !state.widgets.includes(widget)) return false;
    const stackChanged = setWidgetStackIndex(widget, state.widgets.length - 1),
      layerChanged = setCanvasObjectFrontKind("widget"),
      changed = stackChanged || layerChanged;
    if (changed && state.widgetEdit?.id === widget.id) state.widgetEdit.changed = true;
    return changed;
  }
  function commitWidgetToolbarFront(widget) {
    if (!widget || !state.widgets.includes(widget)) return false;
    if (state.widgets.at(-1) === widget && state.frontCanvasObjectKind === "widget") return false;
    recordWidgetsBefore();
    const edit = state.widgetEdit?.id === widget.id ? state.widgetEdit : null,
      wasChanged = edit?.changed;
    bringHtmlWidgetToFront(widget);
    // Clicking a toolbar commits its order independently of a later edit/cancel.
    if (edit) {
      edit.beforeIndex = state.widgets.indexOf(widget);
      edit.beforeFrontCanvasObjectKind = state.frontCanvasObjectKind;
      edit.beforeFrontPlacedCanvasObjectKind = state.frontPlacedCanvasObjectKind;
      edit.changed = wasChanged;
    }
    state.userRevision++;
    saveUserCanvasChange();
    if (edit) recordWidgetsBefore();
    return true;
  }
  function capturableWidgets(region = null) {
    const widgets = visibleWidgets(region),
      pending = state.pendingWidget;
    if (!pending || !pending.shell || pending.hiddenForReplacement || !pluginEnabled(pending.pluginId) || !pluginManifests.has(pending.pluginId)
      || region && !intersection(widgetBox(pending), region) || widgets.includes(pending)) return widgets;
    return [...widgets, pending];
  }
  const PRIVATE_WIDGET_FAVORITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function newPrivateWidgetFavoriteId() {
    const nativeId = globalThis.crypto?.randomUUID?.();
    if (PRIVATE_WIDGET_FAVORITE_ID.test(String(nativeId || ""))) return nativeId;
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16), value = character === "x" ? random : (random & 3) | 8;
      return value.toString(16);
    });
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
      ...(widget.fitContent ? { fitContent:true } : {}),
      ...(widget.fitContentAxes ? { fitContentAxes:widget.fitContentAxes } : {}),
      title: widget.title,
      refreshSeconds: widget.refreshSeconds,
      favoriteSourceId: widget.favoriteSourceId,
      ...(widget.favorite ? { favorite:true } : {}),
      ...(widget.favoriteArtifactSha256 ? { favoriteArtifactSha256:widget.favoriteArtifactSha256 } : {}),
      ...(widget.favoriteCloudId ? { favoriteCloudId:widget.favoriteCloudId } : {}),
      ...(widget.favoriteCommunityItemId ? { favoriteCommunityItemId:widget.favoriteCommunityItemId } : {}),
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType !== "diagram_source" && widget.pluginId !== "image-search" && widget.copyText ? { copyText:widget.copyText, copyLabel:widget.copyLabel } : {}),
      ...(widget.communityOriginItemId ? { communityOriginItemId:widget.communityOriginItemId } : {}),
      ...(widget.communityRootItemId ? { communityRootItemId:widget.communityRootItemId } : {}),
      ...(widget.communityOriginName ? { communityOriginName:widget.communityOriginName } : {}),
      ...(Number.isInteger(widget.communityOriginGeneration) ? { communityOriginGeneration:widget.communityOriginGeneration } : {}),
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
    if (!n(item.x) || !n(item.y) || !n(item.w, item.contentW !== undefined ? 1 : 300, SIZE) || !n(item.h, item.contentH !== undefined ? 1 : 200, SIZE) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
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
    const copyTextLimit=sourceFormat==="penecho-visual-explainer-plan+json"?MAX_VISUAL_EXPLAINER_SOURCE_LENGTH:MAX_WIDGET_COPY_TEXT_LENGTH;
    if (widgetType !== "diagram_source" && allowCopy && item.copyText !== undefined && (typeof item.copyText !== "string" || !item.copyText.trim() || item.copyText.length > copyTextLimit)) return null;
    if (widgetType !== "diagram_source" && allowCopy && item.copyLabel !== undefined && (typeof item.copyLabel !== "string" || !item.copyLabel.trim() || item.copyLabel.length > 80)) return null;
    const communityOriginItemId = typeof item.communityOriginItemId === "string" && /^[0-9a-f-]{36}$/i.test(item.communityOriginItemId) ? item.communityOriginItemId : null,
      communityRootItemId = typeof item.communityRootItemId === "string" && /^[0-9a-f-]{36}$/i.test(item.communityRootItemId) ? item.communityRootItemId : null,
      communityOriginName = typeof item.communityOriginName === "string" ? item.communityOriginName.trim().slice(0, 160) : "",
      communityOriginGeneration = Number.isInteger(item.communityOriginGeneration) && item.communityOriginGeneration >= 0 && item.communityOriginGeneration <= 100000 ? item.communityOriginGeneration : null;
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
      fitContent: item.fitContent === true,
      fitContentAxes: ["width", "height", "resize"].includes(item.fitContentAxes) ? item.fitContentAxes : null,
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
      snapshotDataUrl: "",
      snapshotHighResolution: false,
      snapshotPromise: null,
      snapshotPromiseHighResolution: false,
      contentVersion: 0,
      snapshotVersion: -1,
      shell: null,
      frame: null,
      hostOrigin: null,
      pending: false,
      runtimeDiagnostics: null,
      visualDiagnostics: null,
      visualDiagnosticWaiters: new Set(),
      communityOriginItemId,
      communityRootItemId,
      communityOriginName,
      communityOriginGeneration,
      favoriteSourceId: PRIVATE_WIDGET_FAVORITE_ID.test(String(item.favoriteSourceId || "")) ? item.favoriteSourceId : newPrivateWidgetFavoriteId(),
      favorite: item.favorite === true,
      favoriteArtifactSha256: /^[0-9a-f]{64}$/i.test(String(item.favoriteArtifactSha256 || "")) ? item.favoriteArtifactSha256.toLowerCase() : "",
      favoriteCloudId: PRIVATE_WIDGET_FAVORITE_ID.test(String(item.favoriteCloudId || "")) ? String(item.favoriteCloudId).toLowerCase() : null,
      favoriteCommunityItemId: PRIVATE_WIDGET_FAVORITE_ID.test(String(item.favoriteCommunityItemId || "")) ? String(item.favoriteCommunityItemId).toLowerCase() : null,
      favoriteBusy: false,
      downloadBusy: false,
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
  async function communityWidgetArtifact(widgetId) {
    const widget = state.widgets.find((item) => item.id === widgetId);
    if (!widget) throw Error("Select a Widget on the Canvas first.");
    const serialized = serializedWidgets().find((item) => item.id === widget.id);
    if (!serialized) throw Error("This Widget could not be prepared for sharing.");
    const image = await requestWidgetSnapshot(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true),
      maximum = 2048,
      scale = Math.min(1, maximum / Math.max(1, image.naturalWidth || image.width), maximum / Math.max(1, image.naturalHeight || image.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const communityImages = await communityImagesForCanvas(canvas, .82);
    canvas.width = canvas.height = 1;
    const publicWidget = { ...serialized };
    delete publicWidget.favorite;
    delete publicWidget.favoriteSourceId;
    delete publicWidget.favoriteArtifactSha256;
    delete publicWidget.favoriteCloudId;
    delete publicWidget.favoriteCommunityItemId;
    return { format:"penecho-widget", formatVersion:1, widget:publicWidget, ...communityImages };
  }
  function setCommunityWidgetFavorite(widgetId, favorite, busy = false, artifactSha256 = undefined, reference = undefined) {
    const widget = state.widgets.find((item) => item.id === widgetId);
    if (!widget) return false;
    if (typeof favorite === "boolean") {
      widget.favorite = favorite;
      if (!favorite) {
        widget.favoriteArtifactSha256 = "";
        widget.favoriteCloudId = null;
        widget.favoriteCommunityItemId = null;
      }
      else if (/^[0-9a-f]{64}$/i.test(String(artifactSha256 || ""))) widget.favoriteArtifactSha256 = String(artifactSha256).toLowerCase();
    }
    if (reference && typeof reference === "object") {
      if (Object.hasOwn(reference, "cloudFavoriteId")) widget.favoriteCloudId = PRIVATE_WIDGET_FAVORITE_ID.test(String(reference.cloudFavoriteId || "")) ? String(reference.cloudFavoriteId).toLowerCase() : null;
      if (Object.hasOwn(reference, "communityItemId")) widget.favoriteCommunityItemId = PRIVATE_WIDGET_FAVORITE_ID.test(String(reference.communityItemId || "")) ? String(reference.communityItemId).toLowerCase() : null;
    }
    widget.favoriteBusy = busy === true;
    syncObjectChrome();
    return widget.favorite;
  }

  async function importCommunityWidgetArtifact(artifact, origin = null, options = null) {
    if (!artifact || artifact.format !== "penecho-widget" || artifact.formatVersion !== 1 || !artifact.widget) throw Error("The community Widget is invalid.");
    if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    if (state.widgetEdit) acceptWidgetEdit();
    const visible = viewportRect(), source = { ...artifact.widget }, favoriteState = options?.favoriteState;
    delete source.id;
    // Favorite membership is private Canvas state. Never trust it from a
    // shareable artifact; only the authenticated Favorites loader may attach
    // the stable logical source identity and the current storage references.
    delete source.favorite;
    delete source.favoriteSourceId;
    delete source.favoriteArtifactSha256;
    delete source.favoriteCloudId;
    delete source.favoriteCommunityItemId;
    if (favoriteState?.selected === true) {
      source.favorite = true;
      if (PRIVATE_WIDGET_FAVORITE_ID.test(String(favoriteState.sourceWidgetId || ""))) source.favoriteSourceId = String(favoriteState.sourceWidgetId).toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(String(favoriteState.artifactSha256 || ""))) source.favoriteArtifactSha256 = String(favoriteState.artifactSha256).toLowerCase();
      if (PRIVATE_WIDGET_FAVORITE_ID.test(String(favoriteState.cloudFavoriteId || ""))) source.favoriteCloudId = String(favoriteState.cloudFavoriteId).toLowerCase();
      if (PRIVATE_WIDGET_FAVORITE_ID.test(String(favoriteState.communityItemId || ""))) source.favoriteCommunityItemId = String(favoriteState.communityItemId).toLowerCase();
    }
    // Fit the widget into the visible canvas: oversized widgets shrink
    // uniformly (content scales through the shell transform) and land centered
    // instead of spilling past the viewport edges.
    const viewerFit = options?.fitViewport === true && window.PENECHO_CONFIG?.runtime === "viewer";
    const fitScale = viewerFit ? 1 : Math.min(1, (visible.w * 0.9) / Number(source.w || 300) || 1, (visible.h * 0.9) / Number(source.h || 200) || 1);
    if (!viewerFit && fitScale > 0 && fitScale < 1) { source.w = Number(source.w || 300) * fitScale; source.h = Number(source.h || 200) * fitScale; }
    source.x = Math.max(0, Math.min(SIZE - Number(source.w || 300), visible.x + Math.max(0, (visible.w - Number(source.w || 300)) / 2)));
    source.y = Math.max(0, Math.min(SIZE - Number(source.h || 200), visible.y + Math.max(0, (visible.h - Number(source.h || 200)) / 2)));
    await enableSnapshotWidgetPlugins([source]);
    const widget = widgetRecord(source);
    if (!widget) throw Error("The community Widget is not compatible with this PenEcho version.");
    if (origin?.id && /^[0-9a-f-]{36}$/i.test(origin.id)) {
      widget.communityOriginItemId = origin.id;
      widget.communityRootItemId = origin.rootItemId || origin.id;
      widget.communityOriginName = String(origin.name || "").trim().slice(0, 160);
      widget.communityOriginGeneration = Number.isInteger(origin.generation) && origin.generation >= 0 ? origin.generation : 0;
    }
    recordWidgetsBefore();
    state.widgets.push(widget);
    if (pluginEnabled(widget.pluginId)) mountWidget(widget);
    if (viewerFit) {
      viewerAutoFitCanvas = false;
      viewerAutoFitWidgetId = widget.id;
      fit();
    }
    state.userRevision++;
    state.autoEligible = false;
    saveUserCanvasChange();
    requestRender();
    return { id:widget.id, title:widget.title };
  }
  function widgetHostUrl(manifest) {
    const url = new URL(canvasAssetUrl("widget-host.html")),
      runtime = window.PENECHO_CONFIG?.runtime;
    // The editable local app isolates Widget code on the other loopback host.
    // Cloud shells serve a host with frame-ancestors 'self', so changing only
    // the hostname there would make the iframe cross-origin and CSP-blocked.
    if (runtime !== "cloud" && runtime !== "viewer") {
      if (url.hostname === "localhost") {
        url.hostname = "127.0.0.1";
        url.searchParams.set("parent-origin", location.origin);
      } else if (url.hostname === "127.0.0.1") {
        url.hostname = "localhost";
        url.searchParams.set("parent-origin", location.origin);
      }
    }
    if (configuredAccessSession) url.searchParams.set("access-session", configuredAccessSession);
    if (runtime === "cloud" || runtime === "viewer") url.searchParams.set("remote-canvas", "1");
    if ((runtime === "cloud" || runtime === "viewer") && manifest.id === "general") url.searchParams.set("public-https", "1");
    for (const origin of manifest.connect) url.searchParams.append("connect", origin);
    return url.href;
  }
  function createWidgetResizeHandle(widget, hit) {
    const handle = document.createElement("div");
    handle.className = `canvas-widget-resize-handle ${hit === "width" ? "width" : hit === "height" ? "height" : "corner"}`;
    handle.addEventListener("pointerdown", (event) => {
      if (state.viewMode || state.spacePan || !["hand", "select"].includes(state.mode) || Number(event.button) !== 0) return;
      const pending = widget === state.pendingWidget && widget.pending === true;
      if (!pending && state.interactingWidgetId !== widget.id && !showHandObjectToolbar("widget", widget)) return;
      event.preventDefault();
      event.stopPropagation();
      finishStaleWidgetHostGesture(event);
      // Move focus out of the live iframe before capturing its border gesture.
      handle.tabIndex = -1;
      handle.focus({ preventScroll:true });
      if (!beginWidgetGesture(event, clientPoint(event), { widget, hit, pending })) return;
      widget.shell?.classList.add("is-resizing");
      try { handle.setPointerCapture(event.pointerId); } catch {}
      if (!pending) beginHandToolbarOperation(event.pointerId, handToolbarKey("widget", widget.id));
    });
    handle.addEventListener("dblclick", (event) => {
      if (state.viewMode || state.spacePan || !["hand", "select"].includes(state.mode)) return;
      event.preventDefault();
      event.stopPropagation();
      requestWidgetContentFit(widget, hit);
    });
    handle.addEventListener("pointermove", (event) => {
      if (finishReleasedWidgetGesture(event) || state.widgetGesture?.id !== event.pointerId) return;
      event.preventDefault();
      updateWidgetGesture(event);
    });
    const finish = (event) => {
      if (state.widgetGesture?.id !== event.pointerId) return;
      event.preventDefault();
      finishWidgetGesture(event);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    return handle;
  }
  function updateWidgetHostForFrameLoad(widget, loadState) {
    const reload = loadState.observed;
    loadState.observed = true;
    if (!reload) return false;
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostStateKey = null;
    widget.hostReadyPromise = new Promise((resolve) => (widget.resolveHostReady = resolve));
    return true;
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
      frame = document.createElement("iframe"),
      hostLoadState = { observed:false };
    shell.className = `canvas-widget${widget.pending ? " pending" : ""}`;
    shell.dataset.widgetId = widget.id;
    shell.tabIndex = widget.pending ? -1 : 0;
    shell.setAttribute("aria-label", `${widget.title}. ${t("widgetRefineHint")}`);
    shell.classList.add(`canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`);
    shell.addEventListener("pointerdown", (event) => {
      if (event.target === shell) handleCanvasPointerDown(event);
    });
    shell.addEventListener("keydown", (event) => {
      if (event.target === shell && event.key === "Enter") {
        event.preventDefault();
        enterWidgetInteraction(widget);
      }
    });
    frame.className = "canvas-widget-frame";
    frame.title = widget.title;
    frame.referrerPolicy = "no-referrer";
    frame.src = widgetHostUrl(manifest);
    frame.addEventListener("load", () => {
      if (widget.frame !== frame) return;
      updateWidgetHostForFrameLoad(widget, hostLoadState);
      probeWidgetHost(widget);
    });
    frame.addEventListener("focus", () => focusHandObject("widget", widget, "widget-focus"));
    frame.addEventListener("blur", () => releaseHandObjectFocus(handToolbarKey("widget", widget.id), "widget-focus"));
    shell.append(
      frame,
      createWidgetResizeHandle(widget, "width"),
      createWidgetResizeHandle(widget, "height"),
      createWidgetResizeHandle(widget, "resize"),
    );
    widgetLayer.append(shell);
    widget.shell = shell;
    widget.frame = frame;
    widget.inputPolicyKey = null;
    widget.hostOrigin = new URL(frame.src).origin;
    widget.runtimeDiagnostics = null;
    widget.visualDiagnostics = null;
    if (!(widget.visualDiagnosticWaiters instanceof Set)) widget.visualDiagnosticWaiters = new Set();
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostReadyPromise = new Promise((resolve) => (widget.resolveHostReady = resolve));
    widget.hostStateKey = null;
    addWidgetStyleRule(widget);
    syncWidgetLayerOrder();
    syncCanvasWidgetCarrier();
    positionWidget(widget);
  }
  function unmountWidget(widget) {
    if (state.interactingWidgetId === widget.id) setWidgetInteraction(null);
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
      pending.signal?.removeEventListener("abort",pending.abort);
      pending.reject(Error(t("widgetExportFailed")));
      widgetSnapshotRequests.delete(requestId);
    }
  }
  function addWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), className = `canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`;
    if (!sheet) return;
    widget.styleTransformKey = null;
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
      active = widget.maximized === true || widget.snapshotCaptureActive === true || dragging || intersectsViewport;
    widget.renderActive = active;
    widget.shell.classList.toggle("widget-offscreen", !active);
    if (active) sendWidgetInit(widget);
    return active;
  }
  let canvasWidgetCarrierPanX = Number.NaN;
  let canvasWidgetCarrierPanY = Number.NaN;
  let canvasWidgetCarrierPreviewScale = Number.NaN;
  function syncCanvasWidgetCarrier(previewScale = 1) {
    if (canvasWidgetCarrierPanX === state.panX && canvasWidgetCarrierPanY === state.panY && canvasWidgetCarrierPreviewScale === previewScale) return;
    const style = runtimeElementStyle(view, "canvas-widget-carrier");
    if (!style) return;
    style.setProperty("--canvas-widget-pan-x", `${state.panX}px`);
    style.setProperty("--canvas-widget-pan-y", `${state.panY}px`);
    style.setProperty("--canvas-widget-preview-scale", String(previewScale));
    canvasWidgetCarrierPanX = state.panX;
    canvasWidgetCarrierPanY = state.panY;
    canvasWidgetCarrierPreviewScale = previewScale;
  }
  function positionWidget(widget) {
    if (!widget.shell) return;
    const localX = widget.x * state.scale,
      localY = widget.y * state.scale,
      screenX = state.panX + localX,
      screenY = state.panY + localY,
      scaleX = state.scale * widget.w / widget.contentW,
      scaleY = state.scale * widget.h / widget.contentH,
      declaration = widget.styleRule?.style;
    if (!declaration) return;
    const sizeKey = `${widget.contentW}x${widget.contentH}`;
    if (widget.styleSizeKey !== sizeKey) {
      widget.styleSizeKey = sizeKey;
      declaration.width = `${widget.contentW}px`;
      declaration.height = `${widget.contentH}px`;
      declaration.setProperty("--widget-natural-width", `${widget.contentW}px`);
      declaration.setProperty("--widget-natural-height", `${widget.contentH}px`);
    }
    const transformKey = `${localX}:${localY}:${scaleX}:${scaleY}`;
    if (widget.styleTransformKey !== transformKey) {
      widget.styleTransformKey = transformKey;
      declaration.transform = `translate3d(${localX}px,${localY}px,0) scale(${scaleX},${scaleY})`;
      declaration.setProperty?.("--widget-resize-edge-x", `${28 / scaleX}px`);
      declaration.setProperty?.("--widget-resize-edge-y", `${28 / scaleY}px`);
      declaration.setProperty?.("--widget-resize-corner-x", `${36 / scaleX}px`);
      declaration.setProperty?.("--widget-resize-corner-y", `${36 / scaleY}px`);
    }
    updateWidgetRenderVisibility(widget, screenX, screenY);
    sendWidgetHostState(widget, scaleX, scaleY);
  }
  function positionWidgets() {
    if (!widgetRuntimeEnabled()) return;
    syncCanvasWidgetCarrier();
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) positionWidget(widget);
  }
  function probeWidgetHost(widget) {
    if (!widget.frame?.contentWindow) return false;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-host-probe" }, widget.hostOrigin || location.origin);
    return true;
  }
  function sendWidgetInit(widget) {
    if (!widget.frame?.contentWindow || !widget.hostReady || widget.initialized || widget.renderActive === false) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    let imageAssets={};
    try {if(typeof canvasImageAssetsForHtml==="function")imageAssets=canvasImageAssetsForHtml(widget.html,widget.mcpAssetDocumentId?canvasDocuments.records.get(widget.mcpAssetDocumentId):canvasDocumentsCurrent());}
    catch { /* The host reports missing attachments without aborting Canvas rendering. */ }
    widget.initialized = true;
    widget.mcpDocumentLoaded = false;
    widget.frame.contentWindow.postMessage({
      type:"penecho-widget-init",
      title:widget.title,
      html:widget.html,
      imageAssets,
      pluginStyles:manifest.styles || "",
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
    }, widget.hostOrigin || location.origin);
  }
  function sendWidgetHostState(widget, scaleX = state.scale * widget.w / widget.contentW, scaleY = state.scale * widget.h / widget.contentH, force = false) {
    if (widget.maximized) {
      const shellStyle = getComputedStyle(widget.shell);
      const available = widget.shell.clientWidth - parseFloat(shellStyle.paddingLeft) - parseFloat(shellStyle.paddingRight);
      scaleX = scaleY = available / Math.max(widget.contentW, widget.presentationWidth || 0) * (widget.presentationZoom || 100) / 100;
    }
    const interactive = canvasWidgetInteractive(widget),
      selectable = canvasWidgetSelectionEnabled(),
      selected = !state.viewMode && ["hand", "select"].includes(state.mode) && !interactive && (widget.pending === true || (state.widgetEdit?.id === widget.id && state.selectedWidgetId === widget.id)),
      inputKey = `${interactive}:${selectable}:${selected}`;
    if (widget.inputPolicyKey !== inputKey) {
      widget.inputPolicyKey = inputKey;
      widget.shell?.classList.toggle("is-interacting", interactive);
      widget.shell?.classList.toggle("is-selected", selected);
      if (widget.frame) widget.frame.inert = !interactive;
      if (widget.shell) widget.shell.tabIndex = selectable && !widget.pending ? 0 : -1;
    }
    if (!widget.frame?.contentWindow || !widget.hostReady || !Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) return;
    const active = widget.renderActive !== false,
      key = `${interactive ? 1 : 0}:${selected ? 1 : 0}:${active ? 1 : 0}:${state.navigationLocked ? 1 : 0}:${scaleX.toFixed(6)}:${scaleY.toFixed(6)}:${widget.fitContent ? 1 : 0}:${widget.fitContentAxes || ""}:${widget.maximized ? 1 : 0}`;
    syncMcpWidgetProgress(widget);
    if (!force && widget.hostStateKey === key) return;
    widget.hostStateKey = key;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-state", maximized:widget.maximized === true, fitContent:widget.fitContent === true, fitContentAxes:widget.fitContentAxes || null, selected, interactive, active, navigationLocked:state.navigationLocked, scaleX, scaleY }, widget.hostOrigin || location.origin);
  }
  function markWidgetHostReady(widget) {
    widget.hostReady = true;
    widget.resolveHostReady?.();
    widget.resolveHostReady = null;
    sendWidgetInit(widget);
    sendWidgetHostState(widget, undefined, undefined, true);
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
  function widgetSnapshotAbortError(signal) {
    return signal?.reason instanceof Error ? signal.reason : Error("Widget snapshot request was cancelled");
  }
  function waitForWidgetSnapshot(promise,signal) {
    if(!signal)return promise;
    if(signal.aborted)return Promise.reject(widgetSnapshotAbortError(signal));
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(widgetSnapshotAbortError(signal));
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
      Promise.resolve(promise).then(
        value=>{signal.removeEventListener("abort",abort);resolve(value);},
        error=>{signal.removeEventListener("abort",abort);reject(error);},
      );
    });
  }
  async function requestWidgetSnapshot(widget, timeoutMs = WIDGET_SNAPSHOT_TIMEOUT_MS, requireFresh = true, signal = null, highResolution = false, fullContent = false) {
    if(signal?.aborted)throw widgetSnapshotAbortError(signal);
    highResolution = highResolution === true;
    if (widget.snapshotPromise) {
      const inFlight = widget.snapshotPromise;
      if (!fullContent && !widget.snapshotPromiseFullContent && !requireFresh && (!highResolution || widget.snapshotPromiseHighResolution)) return waitForWidgetSnapshot(inFlight,signal);
      try { await waitForWidgetSnapshot(inFlight,signal); } catch (error) { if(signal?.aborted)throw error; }
      if(signal?.aborted)throw widgetSnapshotAbortError(signal);
      if (!fullContent && widget.snapshotImage && widget.snapshotVersion >= widget.contentVersion && (!highResolution || widget.snapshotHighResolution)) return widget.snapshotImage;
    }
    timeoutMs = Math.max(1000, Math.min(WIDGET_SNAPSHOT_TIMEOUT_MS, Number(timeoutMs) || WIDGET_SNAPSHOT_TIMEOUT_MS));
    const snapshotPromise = (async () => {
      const previousActive = widget.renderActive,
        deadline = performance.now() + timeoutMs,
        remaining = () => Math.max(1, deadline - performance.now()),
        captureFailure=(code,stage)=>Object.assign(Error("Widget snapshot timed out"),{code,details:{widgetId:widget.id,stage,elapsedMs:Math.round(timeoutMs-remaining())}});
      widget.snapshotCaptureActive = true;
      try {
        if (!widget.frame?.contentWindow) throw Error(t("widgetExportFailed"));
        if (!widget.hostReady) {
          if (!widget.hostReadyPromise) throw Error(t("widgetExportFailed"));
          await Promise.race([
            widget.hostReadyPromise,
            new Promise((_, reject) => setTimeout(() => reject(captureFailure("WIDGET_READY_TIMEOUT","host-ready")), remaining())),
          ]);
        }
        widget.renderActive = true;
        widget.shell?.classList.remove("widget-offscreen");
        if (!widget.initialized) sendWidgetInit(widget);
        if (!widget.hostReady || !widget.initialized) throw Error(t("widgetExportFailed"));
        if(signal?.aborted)throw widgetSnapshotAbortError(signal);
        sendWidgetHostState(widget, undefined, undefined, true);
        const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        return await new Promise((resolve, reject) => {
          let pending;
          const timer = setTimeout(() => {
            widgetSnapshotRequests.delete(requestId);
            if(signal&&pending?.abort)signal.removeEventListener("abort",pending.abort);
            reject(captureFailure("WIDGET_CAPTURE_TIMEOUT","host-response"));
          }, remaining());
          const abort=()=>{
            if(widgetSnapshotRequests.get(requestId)!==pending)return;
            widgetSnapshotRequests.delete(requestId);
            clearTimeout(timer);
            reject(widgetSnapshotAbortError(signal));
          };
          pending={ widget, resolve, reject, timer, contentVersion:widget.contentVersion, signal, abort, highResolution, fullContent };
          widgetSnapshotRequests.set(requestId,pending);
          signal?.addEventListener("abort",abort,{once:true});
          if(signal?.aborted){abort();return;}
          widget.frame.contentWindow.postMessage({ type:"penecho-widget-snapshot-request", requestId, width:widget.contentW, height:widget.contentH, timeoutMs:remaining(), highResolution, fullContent }, widget.hostOrigin || location.origin);
        });
      } finally {
        widget.snapshotCaptureActive = false;
        if (previousActive === false) {
          widget.renderActive = false;
          widget.shell?.classList.add("widget-offscreen");
          sendWidgetHostState(widget, undefined, undefined, true);
        }
      }
    })();
    widget.snapshotPromise = snapshotPromise;
    widget.snapshotPromiseFullContent = fullContent;
    widget.snapshotPromiseHighResolution = highResolution;
    try {
      return await snapshotPromise;
    } finally {
      if (widget.snapshotPromise === snapshotPromise) {
        widget.snapshotPromise = null;
        widget.snapshotPromiseFullContent = false;
        widget.snapshotPromiseHighResolution = false;
      }
    }
  }
  function applyWidgetPresentationSize(widget, message) {
    if (!widget.maximized || !widget.styleRule?.style) return false;
    const width = Number(message.width), height = Number(message.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 100000 || height > 100000) return false;
    const nextWidth = Math.max(widget.contentW, Math.ceil(width));
    const nextHeight = Math.max(widget.contentH, Math.ceil(height));
    if (widget.presentationWidth === nextWidth && widget.presentationHeight === nextHeight) return false;
    widget.presentationWidth = nextWidth;
    widget.presentationHeight = nextHeight;
    widget.styleRule.style.setProperty("--widget-presentation-width", `${nextWidth}px`);
    widget.styleRule.style.setProperty("--widget-presentation-height", `${nextHeight}px`);
    sendWidgetHostState(widget);
    return true;
  }
  async function handleWidgetMessage(event) {
    const widget = [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : []), ...(typeof mcpRuntime!=="undefined"?[...(mcpRuntime?.previews?.values()||[])]:[])].find((item) => item.frame?.contentWindow === event.source);
    if (!widget || event.origin !== (widget.hostOrigin || location.origin) || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if(widget.mcpEphemeral&&!["penecho-widget-host-ready","penecho-widget-capture-ready","penecho-widget-updated","penecho-widget-snapshot","penecho-widget-snapshot-error","penecho-widget-runtime-diagnostics","penecho-visual-explainer-diagnostics"].includes(message.type))return;
    if(message.type==="penecho-widget-user-action"&&typeof canvasDocumentsWidgetAction==="function") {
      canvasDocumentsWidgetAction(widget,message);return;
    }
    if (message.type === "penecho-widget-presentation-size") {
      applyWidgetPresentationSize(widget, message);
      return;
    }
    if (message.type === "penecho-widget-fit-result") {
      applyWidgetContentFit(widget, message);
      return;
    }
    if (message.type === "penecho-widget-fit" && ["width", "height", "resize"].includes(message.hit)) {
      requestWidgetContentFit(widget, message.hit);
      return;
    }
    if (message.type === "penecho-widget-exit-interaction") {
      if (state.interactingWidgetId === widget.id) setWidgetInteraction(null);
      return;
    }
    if (message.type === "penecho-widget-host-ready") {
      markWidgetHostReady(widget);
      return;
    }
    if (message.type === "penecho-widget-capture-ready") {
      return;
    }
    if (validWidgetHostActivate(message)) {
      if (state.mode === "select" && !state.interactingWidgetId) {
        const target = handObjectToolbarTargetFromWidgetMessage(widget, message);
        if (target) showHandObjectToolbar(target.kind, target.object);
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
    if (validVisualExplainerDiagnostics(message)) {
      widget.visualDiagnostics = structuredClone(message.diagnostics);
      for (const resolve of widget.visualDiagnosticWaiters || []) resolve(widget.visualDiagnostics);
      widget.visualDiagnosticWaiters?.clear();
      return;
    }
    if (message.type === "penecho-widget-updated") {
      if(message.loaded===true){
        widget.mcpDocumentLoaded = true;
        for(const resolve of widget.mcpLoadWaiters||[])resolve();
        widget.mcpLoadWaiters?.clear();
      }
      widget.contentVersion++;
      widget.snapshotDataUrl = "";
      return;
    }
    if (!["penecho-widget-snapshot", "penecho-widget-snapshot-error"].includes(message.type)) return;
    const pending = widgetSnapshotRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    const finishPending=()=>{
      if(widgetSnapshotRequests.get(message.requestId)!==pending)return false;
      widgetSnapshotRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort",pending.abort);
      return true;
    };
    if (message.type === "penecho-widget-snapshot-error" || typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,")
      || !Number.isFinite(message.width) || message.width <= 0 || !Number.isFinite(message.height) || message.height <= 0) {
      if(!finishPending())return;
      const snapshotFailure = message.type === "penecho-widget-snapshot-error"
        ? String(message.error || t("widgetExportFailed")).replace(/[\r\n\t]+/g, " ").slice(0, 300)
        : t("widgetExportFailed");
      if (message.type === "penecho-widget-snapshot-error") console.warn("PenEcho widget snapshot failed:", snapshotFailure);
      const error=Error(snapshotFailure);
      error.code=/^WIDGET_[A-Z_]{1,40}$/.test(message.code||"")?message.code:"WIDGET_CAPTURE_FAILED";
      error.details={widgetId:widget.id,stage:String(message.details?.stage||"capture").slice(0,60),
        elapsedMs:Number.isFinite(message.details?.elapsedMs)?message.details.elapsedMs:null};
      pending.reject(error);
      return;
    }
    if(pending.decoding)return;
    pending.decoding=true;
    try {
      const snapshotImage=await decodeWidgetSnapshot(message.dataUrl);
      if(pending.signal?.aborted)throw widgetSnapshotAbortError(pending.signal);
      if(widget.contentVersion!==pending.contentVersion)throw Error(t("widgetExportFailed"));
      if(!finishPending())return;
      if (pending.fullContent) {
        pending.resolve({ image:snapshotImage, dataUrl:message.dataUrl });
        return;
      }
      widget.snapshotImage = snapshotImage;
      widget.snapshotDataUrl = message.dataUrl;
      widget.snapshotHighResolution = pending.highResolution;
      widget.snapshotVersion = pending.contentVersion;
      pending.resolve(widget.snapshotImage);
    } catch (error) {
      if(finishPending())pending.reject(error);
    }
  }
  function selectedWidget() {
    return state.widgets.find((widget) => widget.id === state.selectedWidgetId) || null;
  }
  function releaseWidgetsForDrawing() {
    // Seal edits before starting the stroke's history transaction. A previous
    // click-to-front order must survive: only the temporary selection lift ends.
    if (state.widgetEdit || state.selectedWidgetId) acceptWidgetEdit();
    clearHandToolbarTargets("widget");
    if (state.interactingWidgetId) setWidgetInteraction(null, { restoreTool:false });
    // Remove the selected frost synchronously, before the first live sample.
    syncSelectedWidgetMaterial(null);
  }
  function beginWidgetEdit(widget) {
    if (!widget || widget.pending) return false;
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.widgetEdit?.id === widget.id) {
      // A source commit can seal history while keeping this Widget selected.
      recordWidgetsBefore();
      return true;
    }
    if (state.widgetEdit) acceptWidgetEdit();
    recordWidgetsBefore();
    state.selectedWidgetId = widget.id;
    state.widgetEdit = {
      id:widget.id,
      before:widgetLayout(widget),
      beforeIndex:state.widgets.indexOf(widget),
      beforeFrontCanvasObjectKind:state.frontCanvasObjectKind,
      beforeFrontPlacedCanvasObjectKind:state.frontPlacedCanvasObjectKind,
      changed:false,
    };
    syncWidgetHostStates();
    requestInteractionLayerRender();
    return true;
  }
  function acceptWidgetEdit(options = null) {
    options ||= {};
    const edit = state.widgetEdit;
    if (edit) clearHandToolbarTarget("widget", edit.id);
    state.widgetGesture?.widget.shell?.classList.remove("is-resizing");
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    if (edit?.changed) {
      state.userRevision++;
      saveUserCanvasChange();
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
      setWidgetStackIndex(widget, edit.beforeIndex);
      restoreCanvasObjectFrontKinds(edit.beforeFrontCanvasObjectKind, edit.beforeFrontPlacedCanvasObjectKind);
      positionWidget(widget);
    }
    state.widgetHistoryBefore = null;
    state.widgetGesture?.widget.shell?.classList.remove("is-resizing");
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function widgetResizeHit(box, point, pointerType = "mouse") {
    const scale = Math.max(.03, Number(state.scale) || 1),
      edge = (pointerType === "touch" ? 44 : 14) / scale,
      corner = (pointerType === "touch" ? 56 : 32) / scale,
      right = box.x + box.w,
      bottom = box.y + box.h,
      nearCorner = point.x >= right - corner && point.x <= right + edge
        && point.y >= bottom - corner && point.y <= bottom + edge,
      nearRight = Math.abs(point.x - right) <= edge
        && point.y >= box.y - edge && point.y <= bottom + edge,
      nearBottom = Math.abs(point.y - bottom) <= edge
        && point.x >= box.x - edge && point.x <= right + edge;
    if (nearCorner) return "resize";
    if (nearRight) return "width";
    if (nearBottom) return "height";
    return null;
  }
  function widgetControlHit(widget, point, pointerType = "mouse") {
    const box = widgetBox(widget),
      handle = 14 / state.scale,
      actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
      controls = [
        ...Object.entries(draftActionPoints(box, handle, false, true)).map(([hit, target]) => ({ hit, target, radius:actionRadius })),
      ],
      control = controls
        .map((item) => ({ ...item, distance:Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
        .filter((item) => item.distance <= item.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    const resizeHit = widgetResizeHit(box, point, pointerType);
    if (resizeHit) return resizeHit;
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
  function widgetResizeCursor(point, pointerType = "mouse") {
    const hit = widgetPointerHit(point, pointerType, false)?.hit;
    if (hit === "resize") return "nwse-resize";
    if (hit === "width") return "ew-resize";
    if (hit === "height") return "ns-resize";
    return "";
  }
  function syncWidgetResizeCursor(point, pointerType = "mouse") {
    if (!["hand", "select"].includes(state.mode) || state.viewMode || state.spacePan || pointerType === "touch" || state.widgetGesture || state.imageGesture) return false;
    const cursor = widgetResizeCursor(point, pointerType) || imageResizeCursor(point, pointerType);
    if (cursor) setCanvasCursor(cursor);
    else resetCanvasCursor();
    return Boolean(cursor);
  }
  let widgetFitRequestSequence = 0;
  function requestWidgetContentFit(widget, hit) {
    if (!widget || !["width", "height", "resize"].includes(hit) || state.viewMode || state.spacePan || !["hand", "select"].includes(state.mode)
      || widget.maximized || !widget.hostReady || !widget.frame?.contentWindow) return false;
    if (!widget.pending) beginWidgetEdit(widget);
    const requestId = `widget-fit-${++widgetFitRequestSequence}`;
    widget.contentFitRequest = { requestId, hit, start:widgetLayout(widget), html:widget.html };
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-fit-request", requestId, hit }, widget.hostOrigin || location.origin);
    return true;
  }
  function applyWidgetContentFit(widget, message) {
    const request = widget.contentFitRequest;
    if (!request || message.requestId !== request.requestId) return false;
    widget.contentFitRequest = null;
    const start = request.start;
    if (widget.html !== request.html || ["x", "y", "w", "h", "contentW", "contentH"].some((key) => widget[key] !== start[key])
      || !Number.isFinite(message.width) || !Number.isFinite(message.height) || message.width <= 0 || message.height <= 0) {
      sendWidgetHostState(widget, undefined, undefined, true);
      return false;
    }
    const width = request.hit !== "height", height = request.hit !== "width";
    const scaleX = start.w / start.contentW, scaleY = start.h / start.contentH;
    if (width) {
      widget.contentW = Math.max(start.contentW, Math.min(message.width, (SIZE - start.x) / scaleX));
      widget.w = widget.contentW * scaleX;
    }
    if (height) {
      widget.contentH = Math.max(start.contentH, Math.min(message.height, (SIZE - start.y) / scaleY));
      widget.h = widget.contentH * scaleY;
    }
    const previous = widget.fitContent ? "resize" : widget.fitContentAxes;
    widget.fitContentAxes = previous && previous !== request.hit ? "resize" : request.hit;
    if (!widget.pending && state.widgetEdit?.id === widget.id) state.widgetEdit.changed = true;
    positionWidget(widget);
    sendWidgetHostState(widget, undefined, undefined, true);
    refreshHandObjectToolbar();
    requestInteractionLayerRender();
    return true;
  }
  function resizeWidgetBox(start, point, hit, minimumWidth = 300, minimumHeight = 200, limit = SIZE) {
    const contentW = start.contentW ?? start.w,
      contentH = start.contentH ?? start.h;
    if (hit === "width") {
      const displayScale = start.h / contentH,
        minimum = Math.max(1, minimumWidth * displayScale),
        maximum = limit - start.x,
        width = Math.max(minimum, Math.min(maximum, point.x - start.x));
      return { ...start, w:width, contentW:width / displayScale };
    }
    if (hit === "height") {
      const displayScale = start.w / contentW,
        minimum = Math.max(1, minimumHeight * displayScale),
        maximum = limit - start.y,
        height = Math.max(minimum, Math.min(maximum, point.y - start.y));
      return { ...start, h:height, contentH:height / displayScale };
    }
    const minimumScale = Math.max(minimumWidth / contentW, minimumHeight / contentH),
      maximumScale = Math.min((limit - start.x) / start.w, (limit - start.y) / start.h),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginWidgetGesture(event, point, result) {
    if (!result?.widget) return false;
    if (result.hit === "accept") return (result.pending ? acceptPendingWidget({ showHint:true }) : acceptWidgetEdit({ showHint:true })) || true;
    if (result.hit === "cancel") return (result.pending ? rejectPendingWidget() : deleteWidget(result.widget)) || true;
    if (!result.pending) {
      beginWidgetEdit(result.widget);
      // Starting a selection must not reorder overlapping widgets.
    }
    state.widgetGesture = {
      id:event.pointerId,
      pointerType:event.pointerType,
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
    if (gesture.pointerType && gesture.pointerType !== event.pointerType) return false;
    if (gesture.source !== "widget-host" && gesture.id !== event.pointerId) return false;
    return finishWidgetGesture({ pointerId:gesture.id });
  }
  function finishInterruptedWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture) return false;
    if (event.type === "visibilitychange" && !document.hidden) return false;
    if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type)) {
      if (gesture.source === "widget-host") {
        if (gesture.pointerType !== "mouse" || event.pointerType !== "mouse" || Number(event.buttons) !== 0) return false;
      } else if (gesture.id !== event.pointerId) return false;
    }
    finishHandToolbarOperation(gesture.id);
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
  function validVisualExplainerDiagnostics(message) {
    const diagnostics=message?.diagnostics;
    return message?.type === "penecho-visual-explainer-diagnostics" && diagnostics && typeof diagnostics === "object"
      && diagnostics.version === 1 && ["pass","warn","fail"].includes(diagnostics.status)
      && Number.isInteger(diagnostics.score) && diagnostics.score >= 0 && diagnostics.score <= 100
      && ["comfortable","compact","dense"].includes(diagnostics.density)
      && Number.isInteger(diagnostics.deterministicAttempts) && diagnostics.deterministicAttempts >= 1 && diagnostics.deterministicAttempts <= 3
      && typeof diagnostics.issueSignature === "string" && diagnostics.issueSignature.length <= 1200
      && typeof diagnostics.semanticReplanRecommended === "boolean"
      && Array.isArray(diagnostics.issues) && diagnostics.issues.length <= 12
      && diagnostics.issues.every(issue=>issue&&typeof issue === "object"&&typeof issue.code === "string"&&/^[A-Z][A-Z0-9_]{1,63}$/.test(issue.code)
        && ["warning","error"].includes(issue.severity)&&typeof issue.message === "string"&&issue.message.length>0&&issue.message.length<=300
        && (issue.sectionId===undefined||typeof issue.sectionId === "string"&&issue.sectionId.length>0&&issue.sectionId.length<=64));
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
    if (state.mode !== "select" || !validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-start") return false;
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
    if (state.mode !== "select" || !validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-move") return false;
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
    if (!pending) bringHtmlWidgetToFront(widget);
    state.widgetGesture = {
      id:widgetHostPointerId(widget, message.pointerId),
      hostPointerId:message.pointerId,
      pointerType:message.pointerType,
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
    gesture.widget.shell?.classList.remove("is-resizing");
    state.widgetGesture = null;
    resetCanvasCursor();
    if (!gesture.pending && state.widgetEdit?.id === gesture.widget.id) {
      // A concurrent source commit may rebase the geometry Undo boundary.
      state.widgetEdit.changed ||= JSON.stringify(widgetLayout(gesture.widget)) !== JSON.stringify(state.widgetEdit.before);
    }
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
    saveUserCanvasChange();
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
    if (!replacement && restoreMode) showCanvasHint(widgetInteractionPresentation() === "maximized" ? "canvasHintWidgetFullscreen" : "canvasHintWidgetInline");
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
    if (widget.widgetType === "html_widget") showCanvasHint([widgetInteractionPresentation() === "maximized" ? "canvasHintWidgetFullscreen" : "canvasHintWidgetInline", "canvasHintWidgetAdded"]);
    setStatusKey("aiDone");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function widgetReplacementRecordInput(command, target) {
    return {
      ...command,
      id:target.id,
      x:target.x,
      y:target.y,
      w:target.w,
      h:target.h,
      contentW:target.contentW,
      contentH:target.contentH,
      communityOriginItemId:target.communityOriginItemId,
      communityRootItemId:target.communityRootItemId,
      communityOriginName:target.communityOriginName,
      communityOriginGeneration:target.communityOriginGeneration,
      favorite:false,
    };
  }
  function startPendingWidgetReplacement(command, target, revision) {
    if (state.pendingWidget || state.pendingWidgetReplacement || !target || !state.widgets.includes(target) || target.hiddenForReplacement || target.pluginId !== command.pluginId) return Promise.resolve(false);
    const widget = widgetRecord(widgetReplacementRecordInput(command, target));
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
  async function prepareVisibleWidgetSnapshots(region = null, bestEffort = true, signal = null, highResolution = false) {
    let widgets = [];
    try {
      widgets = capturableWidgets(region);
      const captured = await Promise.all(widgets.map(async (widget) => {
        try {
          if(signal?.aborted)throw widgetSnapshotAbortError(signal);
          const request = requestWidgetSnapshot(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, signal, highResolution);
          if (bestEffort) await Promise.race([
            request,
            new Promise((_, reject) => setTimeout(() => reject(Error("snapshot-wait-expired")), WIDGET_HISTORY_SNAPSHOT_WAIT_MS)),
          ]);
          else await request;
        } catch (error) {
          if(signal?.aborted || !bestEffort)throw error;
          debug("widget-snapshot-degraded", { widgetId:widget.id, error:String(error?.message || error).slice(0, 300) });
        }
        return Boolean(widget.snapshotImage);
      })),
        capturedCount = captured.filter(Boolean).length;
      return { total:widgets.length, captured:capturedCount, missing:widgets.length - capturedCount };
    } catch (error) {
      if(signal?.aborted || !bestEffort)throw error;
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
    const current = state.animations.map((animation) => ({
      id: animation.id,
      rendererVersion: 1,
      transform: animationBox(animation),
      scene: ANIMATION.serialize(animation.scene),
      playback: { playheadMs: animationPlayhead(animation, now), paused: Boolean(animation.paused) },
    }));
    if (current.length) return current;
    try {
      return JSON.parse(JSON.stringify(state.preservedSnapshotAnimations || []));
    } catch {
      return [];
    }
  }
  function restoreAnimations(items) {
    clearHandToolbarTargets("animation");
    state.animations = [];
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    // Legacy declarative scenes are not executed by the current renderer, but they
    // remain opaque round-trip data so loading and re-saving never destroys them.
    try {
      state.preservedSnapshotAnimations = JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
    } catch {
      state.preservedSnapshotAnimations = [];
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
      saveUserCanvasChange();
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
    saveUserCanvasChange();
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
    const { width:viewportWidth, height:viewportHeight } = canvasViewportMetrics(),
      box = target.box,
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      controlsWidth = animationControls.offsetWidth || 210,
      controlsHeight = animationControls.offsetHeight || 36,
      editControlsClearance = 28,
      controlsStyle = runtimeElementStyle(animationControls, "animation-controls"),
      x = Math.max(8, Math.min(viewportWidth - controlsWidth - 8, left + width / 2 - controlsWidth / 2)),
      y = top - controlsHeight - editControlsClearance >= 8 ? top - controlsHeight - editControlsClearance : Math.min(viewportHeight - controlsHeight - 8, top + box.h * state.scale + editControlsClearance),
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
      { width, height } = canvasViewportMetrics();
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    animationCtx.clearRect(0, 0, width, height);
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
      { width, height } = canvasViewportMetrics(),
      rect = { width, height },
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
  const CANVAS_NAVIGATION_SETTLE_MS = 80;
  const CANVAS_NAVIGATION_REBASE_VIEWPORT_RATIO = 0.60;
  const CANVAS_NAVIGATION_REBASE_MIN_PX = 192;
  let canvasNavigationPreviewFrame = 0;
  let canvasNavigationPreviewSettleTimer = 0;
  let canvasNavigationPreviewPanX = 0;
  let canvasNavigationPreviewPanY = 0;
  let canvasNavigationPreviewScale = 1;
  let canvasNavigationPreviewViewportWidth = 0;
  let canvasNavigationPreviewViewportHeight = 0;
  let canvasNavigationPreviewRebaseX = CANVAS_NAVIGATION_REBASE_MIN_PX;
  let canvasNavigationPreviewRebaseY = CANVAS_NAVIGATION_REBASE_MIN_PX;
  function canvasNavigationPreviewTransform() {
    const scale = state.scale / canvasNavigationPreviewScale;
    return {
      scale,
      x:state.panX - canvasNavigationPreviewPanX * scale,
      y:state.panY - canvasNavigationPreviewPanY * scale,
    };
  }
  function canvasNavigationPreviewDisplacement(transform = canvasNavigationPreviewTransform()) {
    const scaleDelta = transform.scale - 1;
    return {
      x:Math.max(Math.abs(transform.x), Math.abs(transform.x + canvasNavigationPreviewViewportWidth * scaleDelta)),
      y:Math.max(Math.abs(transform.y), Math.abs(transform.y + canvasNavigationPreviewViewportHeight * scaleDelta)),
    };
  }
  function applyCanvasNavigationPreview() {
    const style = runtimeElementStyle(view, "canvas-navigation-preview"),
      { scale, x, y } = canvasNavigationPreviewTransform();
    style?.setProperty("--canvas-navigation-preview-x", `${x}px`);
    style?.setProperty("--canvas-navigation-preview-y", `${y}px`);
    style?.setProperty("--canvas-navigation-preview-scale", String(scale));
    style?.setProperty("--canvas-navigation-preview-paper", state.paint.paper);
    syncCanvasWidgetCarrier(scale);
    view.classList.add("canvas-navigation-previewing");
  }
  function resetCanvasNavigationPreview() {
    if (canvasNavigationPreviewFrame) cancelAnimationFrame(canvasNavigationPreviewFrame);
    if (canvasNavigationPreviewSettleTimer) clearTimeout(canvasNavigationPreviewSettleTimer);
    canvasNavigationPreviewFrame = 0;
    canvasNavigationPreviewSettleTimer = 0;
    canvasNavigationPreviewPanX = state.panX;
    canvasNavigationPreviewPanY = state.panY;
    canvasNavigationPreviewScale = state.scale;
    syncCanvasWidgetCarrier();
    view.classList.remove("canvas-navigation-previewing");
  }
  function finishCanvasNavigationPreview() {
    if (canvasNavigationPreviewSettleTimer) clearTimeout(canvasNavigationPreviewSettleTimer);
    canvasNavigationPreviewSettleTimer = 0;
    if (!view.classList.contains("canvas-navigation-previewing")) return false;
    flushCoordinatesUpdate();
    if (!state.renderQueued) render();
    void refreshVisibleTextBoxQuality();
    return true;
  }
  function canvasNavigationPreviewStep() {
    canvasNavigationPreviewFrame = 0;
    if (!view.classList.contains("canvas-navigation-previewing")) return;
    applyCanvasNavigationPreview();
    requestCoordinatesUpdate();
    requestAnimationLayerRender();
    if (state.renderQueued) return;
    const displacement = canvasNavigationPreviewDisplacement();
    if (displacement.x >= canvasNavigationPreviewRebaseX || displacement.y >= canvasNavigationPreviewRebaseY) {
      render();
      void refreshVisibleTextBoxQuality();
    }
  }
  function requestCanvasNavigationPreview(previousPanX, previousPanY, previousScale = state.scale) {
    canvasTextQualityGeneration++;
    noteCanvasChromeInteraction();
    noteCanvasAgentNavigation();
    if (!view.classList.contains("canvas-navigation-previewing")) {
      canvasNavigationPreviewPanX = previousPanX;
      canvasNavigationPreviewPanY = previousPanY;
      canvasNavigationPreviewScale = previousScale;
      const { width, height } = canvasViewportMetrics();
      canvasNavigationPreviewViewportWidth = width;
      canvasNavigationPreviewViewportHeight = height;
      canvasNavigationPreviewRebaseX = Math.max(CANVAS_NAVIGATION_REBASE_MIN_PX, width * CANVAS_NAVIGATION_REBASE_VIEWPORT_RATIO);
      canvasNavigationPreviewRebaseY = Math.max(CANVAS_NAVIGATION_REBASE_MIN_PX, height * CANVAS_NAVIGATION_REBASE_VIEWPORT_RATIO);
      view.classList.add("canvas-navigation-previewing");
    }
    if (canvasNavigationPreviewSettleTimer) clearTimeout(canvasNavigationPreviewSettleTimer);
    canvasNavigationPreviewSettleTimer = setTimeout(finishCanvasNavigationPreview, CANVAS_NAVIGATION_SETTLE_MS);
    if (!state.renderQueued && !canvasNavigationPreviewFrame) canvasNavigationPreviewFrame = requestAnimationFrame(canvasNavigationPreviewStep);
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
  let liveInkWarmupFrame = 0;
  let liveInkNeedsWarmup = true;
  function warmLiveInkLayer() {
    if (!liveInkLayer.width || !liveInkLayer.height) return false;
    liveInkCtx.save();
    liveInkCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveInkCtx.globalCompositeOperation = "source-over";
    liveInkCtx.fillStyle = "rgba(0,0,0,0.004)";
    liveInkCtx.fillRect(0, 0, 1, 1);
    liveInkCtx.clearRect(0, 0, 1, 1);
    liveInkCtx.restore();
    liveInkNeedsWarmup = false;
    return true;
  }
  function scheduleLiveInkLayerWarmup() {
    if (!liveInkNeedsWarmup || liveInkWarmupFrame) return;
    liveInkWarmupFrame = requestAnimationFrame(() => {
      liveInkWarmupFrame = requestAnimationFrame(() => {
        liveInkWarmupFrame = 0;
        if (!state.drawing) warmLiveInkLayer();
      });
    });
  }
  function fit() {
    invalidateCanvasViewportMetrics();
    const metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height },
      d = devicePixelRatio || 1,
      width = Math.round(r.width * d),
      height = Math.round(r.height * d),
      resizeLayer = (layer) => {
        if (layer.width === width && layer.height === height) return false;
        layer.width = width;
        layer.height = height;
        return true;
      };
    resizeLayer(screen);
    resizeLayer(animationLayer);
    resizeLayer(placedContentLayer);
    resizeLayer(inkLayer);
    const liveInkResized = resizeLayer(liveInkLayer);
    if (liveInkResized) liveInkNeedsWarmup = true;
    resizeLayer(interactionLayer);
    state.animationFullRedraw = true;
    const viewerWidget = viewerAutoFitWidgetId && state.widgets.find((widget) => widget.id === viewerAutoFitWidgetId),
      viewerBounds = viewerWidget
        ? widgetBox(viewerWidget)
        : viewerAutoFitCanvas
          ? unionLocalBounds(
              unionLocalBounds(
                unionLocalBounds(
                  unionLocalBounds(visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE }), imageBounds()),
                  textBoxBounds(),
                ),
                animationBounds(),
              ),
              widgetBounds(),
            )
          : null;
    if (viewerBounds && r.width > 0 && r.height > 0) {
      // A public Craft is the page's primary content, so frame either its one
      // Widget or the complete Canvas bounds against the actual viewport
      // instead of preserving the infinite Canvas' publishing-time zoom. The
      // top inset keeps it clear of the read-only action bar; every
      // ResizeObserver pass recomputes the frame for phones, tablets and
      // resized desktop windows without changing the content's aspect ratio.
      const viewerBar = pageLayoutRect(document.querySelector(".viewer-topbar")),
        viewRect = pageLayoutRect(view),
        sideInset = Math.max(12, Math.min(40, r.width * .035)),
        topInset = Math.max(64, Math.min(r.height * .4, viewerBar && viewRect ? viewerBar.bottom - viewRect.top + 12 : r.height * .09)),
        bottomInset = Math.max(12, Math.min(32, r.height * .035)),
        availableWidth = Math.max(1, r.width - sideInset * 2),
        availableHeight = Math.max(1, r.height - topInset - bottomInset),
        nextScale = Math.max(.03, Math.min(2, availableWidth / Math.max(1, viewerBounds.w), availableHeight / Math.max(1, viewerBounds.h)));
      state.scale = nextScale;
      state.panX = sideInset + (availableWidth - viewerBounds.w * nextScale) / 2 - viewerBounds.x * nextScale;
      state.panY = topInset + (availableHeight - viewerBounds.h * nextScale) / 2 - viewerBounds.y * nextScale;
      state.viewInitialized = true;
    } else if (!state.viewInitialized && r.width > 0 && r.height > 0) {
      state.scale = INITIAL_CANVAS_SCALE;
      state.panX = (r.width - SIZE * state.scale) / 2;
      state.panY = (r.height - SIZE * state.scale) / 2;
      state.viewInitialized = true;
    }
    if (liveInkResized && state.drawing) renderLiveInkDrawing(state.drawing);
    else scheduleLiveInkLayerWarmup();
    updateCoordinates();
    requestRender();
  }
  function fitViewerCanvas() {
    if (window.PENECHO_CONFIG?.runtime !== "viewer") return false;
    viewerAutoFitWidgetId = null;
    viewerAutoFitCanvas = true;
    fit();
    return true;
  }
  function renderTextContentLayer(region = null) {
    if (!state.textBoxes.length) {
      textContentLayer.width = textContentLayer.height = 1;
      return;
    }
    const d = devicePixelRatio || 1,
      metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height },
      visible = region || {
        x:Math.max(0, -state.panX / state.scale),
        y:Math.max(0, -state.panY / state.scale),
        w:Math.min(SIZE, (r.width - state.panX) / state.scale) - Math.max(0, -state.panX / state.scale),
        h:Math.min(SIZE, (r.height - state.panY) / state.scale) - Math.max(0, -state.panY / state.scale),
      };
    const width = Math.max(1, Math.round(r.width * d)), height = Math.max(1, Math.round(r.height * d));
    if (textContentLayer.width !== width) textContentLayer.width = width;
    if (textContentLayer.height !== height) textContentLayer.height = height;
    textContentCtx.setTransform(d, 0, 0, d, 0, 0);
    textContentCtx.clearRect(0, 0, r.width, r.height);
    if (visible.w <= 0 || visible.h <= 0) return;
    textContentCtx.save();
    textContentCtx.translate(state.panX, state.panY);
    textContentCtx.scale(state.scale, state.scale);
    textContentCtx.beginPath();
    textContentCtx.rect(0, 0, SIZE, SIZE);
    textContentCtx.clip();
    drawTextBoxesToContext(textContentCtx, visible);
    textContentCtx.restore();
  }
  function renderPlacedContentLayer(region = null) {
    renderTextContentLayer(region);
    const d = devicePixelRatio || 1,
      metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height },
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
    drawPlacedCanvasObjectsToContext(placedContentCtx, visible, state.widgetShadowEnabled);
    placedContentCtx.restore();
  }
  function drawPlacedCanvasObjectsToContext(context, region = null, withShadow = false) {
    // Text has its own foreground surface so the live eraser cannot remove it.
    drawImagesToContext(context, region, withShadow);
  }
  function renderInkLayer(region = null) {
    const d = devicePixelRatio || 1,
      metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height },
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
  function clearLiveInkLayer() {
    liveInkCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveInkCtx.clearRect(0, 0, liveInkLayer.width, liveInkLayer.height);
  }
  function paintInkDisplaySegment(context, a, b, erase, size, color = state.inkColor) {
    if (!valid(a) || !valid(b)) return false;
    const d = devicePixelRatio || 1;
    context.save();
    context.setTransform(d, 0, 0, d, 0, 0);
    context.translate(state.panX, state.panY);
    context.scale(state.scale, state.scale);
    context.beginPath();
    context.rect(0, 0, SIZE, SIZE);
    context.clip();
    context.globalCompositeOperation = erase ? "destination-out" : "source-over";
    context.strokeStyle = color;
    context.lineWidth = size;
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
    return true;
  }
  const LIVE_INK_COMMIT_SAMPLE_BATCH = 16;
  let committedInkRenderFrame = 0;
  function appendLiveInkSample(drawing, point, size) {
    const previous = drawing.samples[drawing.samples.length - 1],
      sample = { point:{ x:point.x, y:point.y }, size };
    drawing.samples.push(sample);
    const painted = paintInkDisplaySegment(
      drawing.erase ? inkCtx : liveInkCtx,
      previous?.point || sample.point,
      previous ? sample.point : { x:sample.point.x + 0.01, y:sample.point.y + 0.01 },
      drawing.erase,
      size,
      drawing.color,
    );
    if (painted && !drawing.erase) liveInkNeedsWarmup = false;
  }
  function renderLiveInkDrawing(drawing) {
    clearLiveInkLayer();
    if (!drawing || !drawing.samples?.length) return;
    if (drawing.erase) renderInkLayer();
    const displayContext = drawing.erase ? inkCtx : liveInkCtx;
    const first = drawing.samples[0];
    paintInkDisplaySegment(displayContext, first.point, { x:first.point.x + 0.01, y:first.point.y + 0.01 }, drawing.erase, first.size, drawing.color);
    for (let i = 1; i < drawing.samples.length; i++) {
      const previous = drawing.samples[i - 1], current = drawing.samples[i];
      paintInkDisplaySegment(displayContext, previous.point, current.point, drawing.erase, current.size, drawing.color);
    }
    if (!drawing.erase) liveInkNeedsWarmup = false;
  }
  function commitLiveInkDrawingProgress(drawing, force = false) {
    if (!drawing?.samples?.length) return false;
    let committed = Math.max(0, Number(drawing.committedSamples) || 0);
    if (!force && drawing.samples.length - committed < LIVE_INK_COMMIT_SAMPLE_BATCH) return false;
    if (!committed) {
      const first = drawing.samples[0];
      dot(first.point, drawing.erase, first.size, true, drawing.color);
      committed = 1;
    }
    for (let i = committed; i < drawing.samples.length; i++) {
      const previous = drawing.samples[i - 1], current = drawing.samples[i];
      stroke(previous.point, current.point, drawing.erase, current.size, true, drawing.color);
    }
    drawing.committedSamples = drawing.samples.length;
    return true;
  }
  function requestCommittedInkRender() {
    if (committedInkRenderFrame) return;
    committedInkRenderFrame = requestAnimationFrame(() => {
      committedInkRenderFrame = 0;
      renderInkLayer();
      if (state.drawing?.samples?.length) renderLiveInkDrawing(state.drawing);
      else clearLiveInkLayer();
      scheduleLiveInkLayerWarmup();
    });
  }
  function commitLiveInkDrawing(drawing) {
    if (!commitLiveInkDrawingProgress(drawing, true)) return false;
    requestCommittedInkRender();
    return true;
  }
  const COORDINATES_UPDATE_INTERVAL_MS = 200;
  let coordinatesUpdateFrame = 0;
  let coordinatesUpdatePending = false;
  let coordinatesUpdatePoint = null;
  let coordinatesLastUpdatedAt = -COORDINATES_UPDATE_INTERVAL_MS;
  function updateCoordinates(point = null) {
    const { width, height } = canvasViewportMetrics(),
      x = point ? point.x : (width / 2 - state.panX) / state.scale,
      y = point ? point.y : (height / 2 - state.panY) / state.scale,
      text = `x ${Math.round(x)} · y ${Math.round(y)} · ${Math.round(state.scale * 100)}%`;
    if (coords.textContent !== text) coords.textContent = text;
  }
  function requestCoordinatesUpdate(point = null) {
    coordinatesUpdatePending = true;
    coordinatesUpdatePoint = point;
    if (coordinatesUpdateFrame) return;
    coordinatesUpdateFrame = requestAnimationFrame((now) => {
      coordinatesUpdateFrame = 0;
      if (!coordinatesUpdatePending || now - coordinatesLastUpdatedAt < COORDINATES_UPDATE_INTERVAL_MS) return;
      const pendingPoint = coordinatesUpdatePoint;
      coordinatesUpdatePending = false;
      coordinatesUpdatePoint = null;
      coordinatesLastUpdatedAt = now;
      updateCoordinates(pendingPoint);
    });
  }
  function flushCoordinatesUpdate() {
    if (coordinatesUpdateFrame) cancelAnimationFrame(coordinatesUpdateFrame);
    coordinatesUpdateFrame = 0;
    const pendingPoint = coordinatesUpdatePending ? coordinatesUpdatePoint : null;
    coordinatesUpdatePending = false;
    coordinatesUpdatePoint = null;
    coordinatesLastUpdatedAt = performance.now();
    updateCoordinates(pendingPoint);
  }
  function drawCanvasLineGrid(context, region, renderScale) {
    if (!region || region.w <= 0 || region.h <= 0) return;
    const scale = Math.max(0.03, Number(renderScale) || 1),
      step = 500,
      right = region.x + region.w,
      bottom = region.y + region.h;
    context.save();
    context.strokeStyle = state.paint.paperGrid;
    context.lineWidth = 1 / scale;
    context.beginPath();
    for (let x = Math.floor(region.x / step) * step; x <= right; x += step) {
      context.moveTo(x, region.y);
      context.lineTo(x, bottom);
    }
    for (let y = Math.floor(region.y / step) * step; y <= bottom; y += step) {
      context.moveTo(region.x, y);
      context.lineTo(right, y);
    }
    context.stroke();
    context.restore();
  }
  function canvasRenderRegion() {
    const metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height },
      l = Math.max(0, -state.panX / state.scale),
      t = Math.max(0, -state.panY / state.scale),
      rr = Math.min(SIZE, (r.width - state.panX) / state.scale),
      b = Math.min(SIZE, (r.height - state.panY) / state.scale);
    return { r, visible:{ x:l, y:t, w:rr - l, h:b - t } };
  }
  function renderCanvasBackground() {
    const d = devicePixelRatio || 1,
      { r, visible } = canvasRenderRegion();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = state.paint.outside;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);
    ctx.fillStyle = state.paint.paper;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();
    if (state.gridVisible) drawCanvasLineGrid(ctx, visible, state.scale);
    ctx.restore();
    ctx.strokeStyle = state.paint.border;
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.restore();
  }
  function renderCanvasContent() {
    resetCanvasNavigationPreview();
    const { visible } = canvasRenderRegion();
    renderPlacedContentLayer(visible);
    renderInkLayer(visible);
    renderInteractionLayer();
    positionWidgets();
    positionTextEditors();
    updateSelectionToolbar();
  }
  const canvasRenderTiming = (() => {
    let enabled = false;
    try { enabled = new URLSearchParams(location.search).get("renderTiming") === "1"; } catch {}
    const records = [];
    if (enabled) globalThis.__PENECHO_RENDER_TIMINGS__ = records;
    return { enabled, records, limit:300 };
  })();
  function canvasRenderTimedStage(record, name, work) {
    const startedAt = performance.now();
    const result = work();
    record[name] = performance.now() - startedAt;
    return result;
  }
  function renderCanvasContentTimed(record) {
    canvasRenderTimedStage(record, "resetPreviewMs", resetCanvasNavigationPreview);
    const { visible } = canvasRenderTimedStage(record, "regionMs", canvasRenderRegion);
    canvasRenderTimedStage(record, "placedContentMs", () => renderPlacedContentLayer(visible));
    canvasRenderTimedStage(record, "inkMs", () => renderInkLayer(visible));
    canvasRenderTimedStage(record, "interactionMs", renderInteractionLayer);
    canvasRenderTimedStage(record, "widgetsMs", positionWidgets);
    canvasRenderTimedStage(record, "textEditorsMs", positionTextEditors);
    canvasRenderTimedStage(record, "selectionToolbarMs", updateSelectionToolbar);
  }
  function render() {
    if (!canvasRenderTiming.enabled) {
      renderCanvasBackground();
      renderCanvasContent();
      return;
    }
    const record = {
      startedAt:performance.now(),
      navigationPreview:view.classList.contains("canvas-navigation-previewing"),
      scale:state.scale,
    };
    canvasRenderTimedStage(record, "backgroundMs", renderCanvasBackground);
    canvasRenderTimedStage(record, "contentMs", () => renderCanvasContentTimed(record));
    record.totalMs = performance.now() - record.startedAt;
    canvasRenderTiming.records.push(record);
    if (canvasRenderTiming.records.length > canvasRenderTiming.limit) canvasRenderTiming.records.splice(0, canvasRenderTiming.records.length - canvasRenderTiming.limit);
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
    if (!["select", "hand"].includes(state.mode) || !state.handToolbarTargets.size) return;
    const unit = 1 / state.scale;
    context.save();
    context.lineWidth = unit;
    for (const record of state.handToolbarTargets.values()) {
      if (!record.expanded || record.kind === "widget") continue;
      const object = handToolbarObject(record),
        box = object && (record.kind === "image" ? imageBox(object)
          : record.kind === "animation" ? animationBox(object)
          : record.kind === "text-box" ? textBoxBox(object)
          : null);
      if (!box) continue;
      context.globalAlpha = record.hiding ? .28 : 1;
      context.strokeStyle = record.kind === "image" ? state.paint.border || "#d8dbe2" : "rgba(38, 121, 184, 0.42)";
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
    if (state.mode !== "pen" || !widgetId || state.widgetRefineClickPulse?.widgetId === widgetId) return;
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
    context.strokeStyle = state.paint.accent || "#4f46e5";
    context.globalAlpha = widget.pending ? .72 : 1;
    context.lineWidth = 2 * unit;
    if (widget.pending) {
      context.setLineDash([7 * unit, 6 * unit]);
      context.strokeRect(box.x, box.y, box.w, box.h);
      context.setLineDash([]);
    }
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.stroke();
    context.restore();
  }
  function positionImageSelectionMaterial() {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) {
      imageSelectionMaterial.hidden = true;
      return;
    }
    if (imageSelectionMaterial.hidden) imageSelectionMaterial.hidden = false;
    const box = imageBox(item),
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      height = box.h * state.scale,
      materialStyle = runtimeElementStyle(imageSelectionMaterial, "canvas-image-selection");
    materialStyle?.setProperty("--image-selection-x", `${left.toFixed(1)}px`);
    materialStyle?.setProperty("--image-selection-y", `${top.toFixed(1)}px`);
    materialStyle?.setProperty("--image-selection-width", `${width.toFixed(1)}px`);
    materialStyle?.setProperty("--image-selection-height", `${height.toFixed(1)}px`);
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
    const widgets = visibleWidgets();
    for (let index = widgets.length - 1; index >= 0; index--) {
      const widget = widgets[index], box = widgetBox(widget);
      if (widget.shell && widget.renderActive !== false && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return widget;
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
    const widget = state.mode === "pen" ? widgetAtRefinePoint(state.widgetRefinePointer) : null,
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
    const rect = canvasElementLayoutRect(element),
      anchor = rect && { x:rect.left, y:rect.top, width:rect.width, height:rect.height };
    if (!anchor) return null;
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
  async function copyWidgetSource(widget, button = null) {
    const source = widgetCopySource(widget);
    if (!source) return false;
    const generation = button ? (button._copyGeneration || 0) + 1 : 0;
    if (button) button._copyGeneration = generation;
    const copied = await writeClipboardText(source);
    setStatusKey(copied ? "widgetSourceCopied" : "widgetSourceCopyFailed");
    if (button && button._copyGeneration === generation) setWidgetCopyButtonState(button, copied);
    return copied;
  }
  async function copyPlotExpression(item) {
    const expression = typeof item?.plotExpression === "string" ? item.plotExpression : "";
    if (!expression) return false;
    const copied = await writeClipboardText(expression);
    setStatusKey(copied ? "textCopied" : "textCopyFailed");
    return copied;
  }
  function widgetImageFilename(widget) {
    const title = String(widget?.title || "penecho-widget")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
      .replace(/[.\s]+$/g, "")
      .trim()
      .slice(0, 120);
    return `${title || "penecho-widget"}.png`;
  }
  async function downloadWidgetImage(widget) {
    if (!widget || widget.downloadBusy) return false;
    widget.downloadBusy = true;
    syncObjectChrome();
    setStatusKey("widgetDownloading");
    try {
      const snapshot = await requestWidgetSnapshot(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, null, true, true);
      if (!snapshot.dataUrl?.startsWith("data:image/png;base64,")) throw Error(t("widgetExportFailed"));
      const link = document.createElement("a");
      link.href = snapshot.dataUrl;
      link.download = widgetImageFilename(widget);
      document.body.append(link);
      link.click();
      link.remove();
      setStatusKey("widgetDownloaded");
      return true;
    } catch (error) {
      setStatus(`${t("widgetDownloadFailed")}: ${String(error?.message || error)}`);
      return false;
    } finally {
      widget.downloadBusy = false;
      syncObjectChrome();
    }
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
      ...(widget.widgetType === "html_widget" && widget.sourceFormat === VISUAL_EXPLAINER_SOURCE_FORMAT && widget.visualDiagnostics ? { visualDiagnostics:structuredClone(widget.visualDiagnostics) } : {}),
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
  const WIDGET_COPY_ICON_FEEDBACK_MS = 2000;
  const OBJECT_CHROME_ICONS = Object.freeze({
    interact:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>',
    move:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9V3M9 6l3-3 3 3M12 15v6M9 18l3 3 3-3M9 12H3M6 9l-3 3 3 3M15 12h6M18 9l3 3-3 3"/></svg>',
    accept:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    cancel:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    merge:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="11" rx="2"/><path d="m6.5 12 3.2-3.2 2.8 2.8 1.8-1.8 3.2 3.2M8 19c2-1.6 6-1.6 8 0"/></svg>',
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    refine:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>',
    favorite:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 6.9 19l1.1-5.6-4.2-3.9 5.7-.7Z"/></svg>',
    share:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>',
    download:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 15v5h14v-5"/></svg>',
  });
  function setWidgetCopyButtonState(button, copied = false) {
    if (!button) return;
    clearTimeout(button._copyIconResetTimer);
    button._copyIconResetTimer = 0;
    if (copied) button.dataset.copyState = "copied";
    else delete button.dataset.copyState;
    button.innerHTML = OBJECT_CHROME_ICONS[copied ? "accept" : "copy"];
    button.setAttribute("aria-label", copied ? t("widgetSourceCopied") : objectChromeLabel("copy", button.penechoSpec));
    if (!copied) return;
    button._copyIconResetTimer = setTimeout(() => {
      button._copyIconResetTimer = 0;
      if (!button.isConnected || button.dataset.copyState !== "copied") return;
      setWidgetCopyButtonState(button, false);
    }, WIDGET_COPY_ICON_FEEDBACK_MS);
  }
  function screenObjectBox(box) {
    return {
      left:state.panX + box.x * state.scale,
      top:state.panY + box.y * state.scale,
      width:box.w * state.scale,
      height:box.h * state.scale,
    };
  }
  function addWidgetToolSpecs(specs, widget, options = {}) {
    if (!widget) return;
    const box = widgetBox(widget),
      items = [],
      copyLabel = widgetCopySourceLabel(widget);
    if (["select", "hand", "pen"].includes(state.mode) && !widget.pending && options.objectToolbarKey) items.push({
      key:`widget:${widget.id}:interact`, kind:"interact", label:t("widgetInteract"),
      baseWidth:84, iconOnly:false, activate:() => { enterWidgetInteraction(widget); },
    });
    if (options.copy && copyLabel) items.push({
      key:`widget:${widget.id}:tool-copy`,
      kind:"copy",
      label:copyLabel,
      baseWidth:28,
      iconOnly:true,
      activate:(button) => void copyWidgetSource(widget, button),
    });
    if (options.refine && state.widgetRefineConfirmation?.widgetId !== widget.id) items.push({
      key:`widget:${widget.id}:tool-refine`,
      kind:"refine",
      label:t("widgetRefine"),
      baseWidth:92,
      iconOnly:false,
      refineCandidate:options.refine,
      activate:(button) => void beginWidgetRefineConfirmation(options.refine, objectChromeAnchor(button)),
    });
    if (options.community && window.PenEchoCommunityUI) {
      const favoriteLabelKey = widget.favoriteBusy ? "favoriteWidgetSaving" : widget.favorite ? "unfavoriteWidget" : "favoriteWidget";
      items.push({
        key:`widget:${widget.id}:tool-favorite`,
        kind:"favorite",
        label:window.PenEchoCommunityUI.label?.(favoriteLabelKey) || "Favorite",
        baseWidth:28,
        iconOnly:true,
        pressed:widget.favorite === true,
        busy:widget.favoriteBusy === true,
        activate:() => {
          if (widget.favoriteBusy) return;
          window.dispatchEvent(new CustomEvent("penecho:community-widget-action", { detail:{
            action:"favorite",
            widgetId:widget.id,
            favorite:widget.favorite === true,
            favoriteArtifactSha256:widget.favoriteArtifactSha256 || null,
            sourceWidgetId:widget.favoriteSourceId,
            favoriteCloudId:widget.favoriteCloudId || null,
            favoriteCommunityItemId:widget.favoriteCommunityItemId || null,
          } }));
        },
      });
      items.push({
        key:`widget:${widget.id}:tool-share`,
        kind:"share",
        label:window.PenEchoCommunityUI.label?.("shareWidget") || "Share",
        baseWidth:28,
        iconOnly:true,
        activate:() => window.dispatchEvent(new CustomEvent("penecho:community-widget-action", { detail:{ action:"share", widgetId:widget.id } })),
      });
    }
    if (options.download) items.push({
      key:`widget:${widget.id}:tool-download`,
      kind:"download",
      label:t("downloadWidget"),
      baseWidth:28,
      iconOnly:true,
      busy:widget.downloadBusy === true,
      activate:() => void downloadWidgetImage(widget),
    });
    if (!items.length) return;
    const gap = 4,
      groupHorizontalWidth = items.reduce((sum, item) => sum + item.baseWidth, 0) + gap * (items.length - 1),
      groupVerticalWidth = Math.max(...items.map(item => item.baseWidth)),
      groupVerticalHeight = items.length * 34 + gap * (items.length - 1),
      widgetToolGroup = `widget-${widget.id}-tools`;
    let horizontalOffset = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      specs.push({
        ...item,
        box,
        widget,
        widgetTool:true,
        objectToolbarItem:Boolean(options.objectToolbarKey),
        objectToolbarKey:options.objectToolbarKey || "",
        toolbarHasDecisions:options.decisions !== false,
        toolbarSlot:"tool",
        toolbarOrder:items[0]?.kind === "interact" ? index - 1 : index,
        toolbarItemCount:items.length - (items[0]?.kind === "interact" ? 1 : 0),
        widgetToolGroup,
        groupRefineCandidate:options.refine || null,
        groupItemCount:items.length,
        groupHorizontalWidth,
        groupVerticalWidth,
        groupVerticalHeight,
        groupHorizontalOffset:horizontalOffset,
        groupVerticalOffset:index * (34 + gap),
        controlScale:1,
        baseHeight:(options.objectToolbarKey || item.kind === "refine") ? 28 : 34,
        handToolbar:Boolean(options.handToolbar),
        handToolbarKey:options.handToolbarKey || "",
        handToolbarHiding:Boolean(options.handToolbarHiding),
        priority:6,
      });
      horizontalOffset += item.baseWidth + gap;
    }
  }
  function objectToolbarMinimumWidth(toolCount = 0, decisions = true) {
    const itemSize = 28,
      itemGap = 4,
      inset = 4,
      itemCount = (decisions ? 2 : 0) + Math.max(0, Math.floor(Number(toolCount) || 0));
    if (itemCount <= 0) return inset * 2;
    return itemCount * itemSize + (itemCount - 1) * itemGap + inset * 2;
  }
  function finalizeObjectToolbarWidths(specs) {
    const toolCounts = new Map(), centeredToolbars = new Map(), trailingTools = new Map();
    for (const spec of specs) {
      if (!spec.objectToolbarItem || spec.toolbarSlot !== "tool") continue;
      toolCounts.set(spec.objectToolbarKey, (toolCounts.get(spec.objectToolbarKey) || 0) + 1);
      if (spec.kind === "interact") centeredToolbars.set(spec.objectToolbarKey, spec);
      else {
        const items = trailingTools.get(spec.objectToolbarKey) || [];
        items.push(spec);
        trailingTools.set(spec.objectToolbarKey, items);
      }
    }
    for (const spec of specs) {
      if (!spec.objectToolbar) continue;
      const decisions = spec.toolbarHasDecisions !== false;
      spec.minimumWidth = objectToolbarMinimumWidth(toolCounts.get(spec.key) || 0, decisions);
      if (centeredToolbars.has(spec.key)) {
        // Keep the labeled action at screen size even when its Widget is tiny.
        // Reserve actual trailing widths, mirrored on the left for true centering.
        const center = centeredToolbars.get(spec.key),
          items = trailingTools.get(spec.key) || [],
          groupWidth = items.reduce((sum, item) => sum + item.baseWidth + 4, 0),
          sideWidth = (decisions ? 4 + 28 : 0) + 4 + groupWidth;
        spec.minimumWidth = center.baseWidth + 2 * sideWidth;
        let offset = 0;
        for (const item of items) {
          item.toolbarGroupWidth = Math.max(0, groupWidth - 4);
          item.toolbarGroupOffset = offset;
          offset += item.baseWidth + 4;
        }
      }
    }
    return specs;
  }
  function addObjectToolbarSpecs(specs, options) {
    const toolbarKey = `${options.prefix}:toolbar`,
      shared = options.shared || {},
      decisions = options.decisions !== false,
      priority = Number(options.priority) || 4;
    specs.push({
      key:toolbarKey,
      kind:"toolbar",
      label:t("objectToolbarMove"),
      box:options.box,
      target:options.target,
      object:options.object,
      objectToolbar:true,
      toolbarHasDecisions:decisions,
      minimumWidth:objectToolbarMinimumWidth(0, decisions),
      baseHeight:34,
      ...shared,
      priority,
    });
    if (!decisions) return toolbarKey;
    specs.push({
      key:`${options.prefix}:cancel`,
      kind:"cancel",
      label:options.cancelLabel,
      box:options.box,
      objectToolbarItem:true,
      objectToolbarKey:toolbarKey,
      toolbarSlot:"leading",
      baseWidth:28,
      baseHeight:28,
      activate:options.cancel,
      ...shared,
      priority:priority + 1,
    });
    specs.push({
      key:`${options.prefix}:accept`,
      kind:"accept",
      label:options.acceptLabel,
      tooltip:options.acceptTooltip || "",
      box:options.box,
      objectToolbarItem:true,
      objectToolbarKey:toolbarKey,
      toolbarSlot:"trailing",
      baseWidth:28,
      baseHeight:28,
      activate:options.accept,
      ...shared,
      priority:priority + 1,
    });
    return toolbarKey;
  }
  function objectChromePosition(box, kind, ignoreKey = "", spec = null, knownPositions = null) {
    const baseWidth = spec?.baseWidth || (kind === "move" ? 34 : kind === "refine" ? 92 : 36),
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
      clampY = (value) => Math.max(6, Math.min(Math.max(6, viewportHeight - height - 6), value));
    if (spec?.objectToolbar) {
      const toolbarWidth = Math.max(spec.minimumWidth || 100, screenBox.width);
      return { x:screenBox.left, y:screenBox.top - baseHeight, scale:1, baseWidth:toolbarWidth, baseHeight };
    }
    if (spec?.objectToolbarItem) {
      const toolbar = knownPositions?.get?.(spec.objectToolbarKey);
      if (!toolbar) return null;
      const hasDecisions = spec.toolbarHasDecisions !== false,
        toolbarWidth = toolbar.baseWidth * (toolbar.scale || 1),
        toolbarHeight = toolbar.baseHeight * (toolbar.scale || 1),
        itemGap = 4,
        inset = 4,
        itemY = toolbar.y + (toolbarHeight - height) / 2,
        leadingX = toolbar.x + inset,
        leadingInset = hasDecisions ? 28 + itemGap : 0,
        trailingInset = hasDecisions ? (spec.toolbarSlot === "trailing" ? width : 28) : 0,
        trailingX = toolbar.x + toolbarWidth - inset - trailingInset;
      let itemX;
      if (spec.toolbarSlot === "leading") itemX = leadingX;
      else if (spec.toolbarSlot === "trailing") itemX = trailingX;
      else if (spec.kind === "interact") itemX = toolbar.x + (toolbarWidth - width) / 2;
      else {
        const itemCount = Math.max(1, Number(spec.toolbarItemCount) || 1),
          itemOrder = Math.max(0, Math.min(itemCount - 1, Number(spec.toolbarOrder) || 0)),
          groupWidth = spec.toolbarGroupWidth ?? (itemCount * width + (itemCount - 1) * itemGap),
          groupLeft = Math.max(leadingX + leadingInset, trailingX - itemGap - groupWidth);
        itemX = groupLeft + (spec.toolbarGroupOffset ?? itemOrder * (width + itemGap));
        if (itemX + width > trailingX - itemGap) return null;
      }
      return { x:itemX, y:itemY, scale:controlScale, baseWidth, baseHeight };
    }
    if (spec?.widgetTool) {
      const horizontalWidth = spec.groupHorizontalWidth * controlScale,
        verticalWidth = spec.groupVerticalWidth * controlScale,
        verticalHeight = spec.groupVerticalHeight * controlScale,
        gap = chromeGap * controlScale,
        inset = 8,
        insideLeft = screenBox.left + inset,
        insideRight = right - inset,
        insideTop = screenBox.top + inset;
      const horizontalFits = horizontalWidth <= Math.max(0, insideRight - insideLeft),
        groupPosition = horizontalFits
          ? { side:"inside-top", layout:"horizontal", x:insideRight - horizontalWidth, y:insideTop, w:horizontalWidth, h:height }
          : { side:"inside-right", layout:"vertical", x:Math.max(insideLeft, insideRight - verticalWidth), y:insideTop, w:verticalWidth, h:verticalHeight },
        vertical = groupPosition.layout === "vertical";
      return {
        x:groupPosition.x + (vertical ? groupPosition.w - width : spec.groupHorizontalOffset * controlScale),
        y:groupPosition.y + (vertical ? spec.groupVerticalOffset * controlScale : 0),
        scale:controlScale,
        baseWidth,
        baseHeight,
      };
    }
    const above = screenBox.top - height - chromeGap,
      y = clampY(above >= 6 ? above : screenBox.top + chromeGap);
    let x;
    if (kind === "move") x = clampX(screenBox.left + screenBox.width / 2 - width / 2);
    else if (kind === "cancel") x = clampX(screenBox.left - width - chromeGap);
    else if (kind === "accept") x = clampX(right + chromeGap);
    else x = clampX(screenBox.left + screenBox.width / 2 + 38);
    return { x, y, scale:1, baseWidth, baseHeight };
  }
  function objectChromeLabel(kind, spec = null) {
    if (spec?.label) return spec.label;
    if (kind === "accept") return t("widgetAccept");
    if (kind === "cancel") return t("cancel");
    if (kind === "copy") return t("copyText");
    if (kind === "merge") return t("imageMerge");
    if (kind === "refine") return t("widgetRefine");
    if (kind === "favorite") return window.PenEchoCommunityUI?.label?.("favoriteWidget") || "Favorite Widget";
    if (kind === "share") return window.PenEchoCommunityUI?.label?.("shareWidget") || "Share Widget";
    if (kind === "download") return t("downloadWidget");
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
      peButton(yes, "secondary", "compact");
      peButton(no, "secondary", "compact");
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
        x:screenBox.left + screenBox.width / 2 - 46,
        y:Math.max(8, screenBox.top - 41),
        width:92,
        height:28,
      },
      position = widgetRefineConfirmationPosition(confirmation.anchor || fallbackAnchor, layoutWidth, height, view.clientWidth, view.clientHeight);
    declaration?.setProperty("--widget-refine-confirm-x", `${position.x.toFixed(1)}px`);
    declaration?.setProperty("--widget-refine-confirm-y", `${position.y.toFixed(1)}px`);
  }
  function beginObjectChromeMove(event, spec) {
    const handObjectMove = state.mode === "hand" && ["widget", "image", "animation"].includes(spec.target);
    if ((state.mode !== "select" && !handObjectMove) || state.viewMode || state.spacePan || Number(event.button) !== 0) return false;
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
    return false;
  }
  function createObjectChromeButton(key, kind, spec = null) {
    const button = document.createElement("button");
    button.type = "button";
    if (kind !== "toolbar" && !spec?.standaloneDraftControl) peButton(button, kind === "delete" ? "danger" : kind === "refine" ? "secondary" : "toolbar", "compact");
    button.className = kind === "toolbar" ? "object-chrome-button" : `object-chrome-button ${kind}`;
    button.dataset.objectChromeKey = key;
    button.innerHTML = OBJECT_CHROME_ICONS[kind] || "";
    if (kind === "interact") {
      const label = document.createElement("span");
      label.className = "widget-interact-label";
      button.append(label);
    }
    if (kind === "refine") {
      const label = document.createElement("span"),
        hint = document.createElement("span");
      button.dataset.peMaterial = "control-glass";
      button.dataset.peState = "default";
      label.className = "widget-refine-button-label";
      hint.className = "widget-refine-hint";
      hint.hidden = true;
      button.append(label, hint);
    }
    ensureObjectChromeStyleRule(button);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      finishStaleWidgetHostGesture(event);
      const dragSurface = kind === "move" || kind === "toolbar";
      if (button.penechoSpec?.handToolbar) {
        beginHandToolbarOperation(event.pointerId, button.penechoSpec.handToolbarKey);
        if (dragSurface) activateHandObjectToolbar(button.penechoSpec.handToolbarKey);
        refreshHandObjectToolbar(button.penechoSpec.handToolbarKey);
      }
      if (!dragSurface) {
        try { button.setPointerCapture(event.pointerId); } catch {}
        return;
      }
      beginObjectChromeMove(event, button.penechoSpec);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind === "move" || kind === "toolbar" || button.disabled) return;
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
      const plotExpression = target?.command?.tool === "plot_function" && typeof target.command.expression === "string"
        ? target.command.expression.trim()
        : "",
        contentCommand = target?.command || target?.textCommand || {},
        standaloneDraftControl = ["write_text", "draw_formula", "draw"].includes(contentCommand.tool);
      if (plotExpression) {
        const toolbarKey = addObjectToolbarSpecs(specs, {
          prefix:key,
          box,
          target:"pending",
          object:target,
          cancelLabel:t("cancel"),
          acceptLabel:t("widgetAccept"),
          cancel:() => itemIndex === null ? rejectPending() : rejectPendingItem(itemIndex),
          accept:() => itemIndex === null ? acceptPending({ showHint:true }) : acceptPendingItem(itemIndex),
          shared:{ itemIndex },
          priority:4,
        });
        specs.push({
          key:`${key}:copy`,
          kind:"copy",
          label:t("copyText"),
          box,
          objectToolbarItem:true,
          objectToolbarKey:toolbarKey,
          toolbarSlot:"tool",
          toolbarOrder:0,
          toolbarItemCount:1,
          baseWidth:28,
          baseHeight:28,
          activate:() => void copyPendingText(itemIndex),
          priority:6,
        });
        return;
      }
      specs.push({ key:`${key}:move`, kind:"move", box, target:"pending", itemIndex, object:target, standaloneDraftControl, priority:4 });
      specs.push({ key:`${key}:cancel`, kind:"cancel", box, standaloneDraftControl, activate:() => itemIndex === null ? rejectPending() : rejectPendingItem(itemIndex), priority:5 });
      specs.push({ key:`${key}:accept`, kind:"accept", box, standaloneDraftControl, activate:() => itemIndex === null ? acceptPending({ showHint:true }) : acceptPendingItem(itemIndex), priority:5 });
      if (pendingCopyable(target)) specs.push({ key:`${key}:copy`, kind:"copy", box, standaloneDraftControl, activate:() => void copyPendingText(itemIndex), priority:5 });
    };
    if (pending.items) pending.items.forEach((item, index) => add(`pending-item:${index}`, pendingItemBounds(item), index, item));
    else add("pending", draftBounds(pending));
  }
  function objectChromeSpecs() {
    const persistentCandidate = currentWidgetRefineCandidate(),
      hoverCandidate = currentWidgetRefineHoverCandidate();
    if (state.viewMode || state.interactingWidgetId || !["select", "hand", "pen"].includes(state.mode)) {
      const specs = [];
      if (!state.viewMode && !state.interactingWidgetId && persistentCandidate) addWidgetToolSpecs(specs, persistentCandidate.widget, { refine:persistentCandidate });
      if (!state.viewMode && !state.interactingWidgetId && hoverCandidate && hoverCandidate.widget !== persistentCandidate?.widget) addWidgetToolSpecs(specs, hoverCandidate.widget, { refine:hoverCandidate });
      return specs;
    }
    const specs = [];
    // Pen keeps its hover Refine action; Hand and Select own object toolbars.
    if (state.mode === "pen") {
      if (persistentCandidate) addWidgetToolSpecs(specs, persistentCandidate.widget, { refine:persistentCandidate });
      if (hoverCandidate && hoverCandidate.widget !== persistentCandidate?.widget) addWidgetToolSpecs(specs, hoverCandidate.widget, { refine:hoverCandidate });
    }
    for (const [key, record] of state.handToolbarTargets) {
      if (state.mode === "pen" && record.kind !== "widget") continue;
      const handTarget = handToolbarObject(record),
        shared = { handToolbar:true, handToolbarKey:key, handToolbarHiding:Boolean(record.hiding) };
      if (!handTarget) continue;
      if (record.kind === "image") {
        if (!record.expanded || state.handToolbarActiveKey !== key || state.pendingWidget) continue;
        const box = imageBox(handTarget),
          plotExpression = typeof handTarget.plotExpression === "string" ? handTarget.plotExpression : "",
          toolbarKey = addObjectToolbarSpecs(specs, {
            prefix:`image:${handTarget.id}`,
            box,
            target:"image",
            object:handTarget,
            cancelLabel:t("imageDelete"),
            acceptLabel:t("imagePlace"),
            acceptTooltip:t("imagePlaceHint"),
            cancel:() => deleteImage(handTarget),
            accept:() => {
              if (state.imageEdit?.id !== handTarget.id) beginImageEdit(handTarget);
              return acceptImageEdit({ showHint:true });
            },
            shared,
            priority:2,
          });
        if (plotExpression) {
          specs.push({
            key:`image:${handTarget.id}:copy`,
            kind:"copy",
            label:t("copyText"),
            box,
            objectToolbarItem:true,
            objectToolbarKey:toolbarKey,
            toolbarSlot:"tool",
            toolbarOrder:0,
            toolbarItemCount:1,
            baseWidth:28,
            baseHeight:28,
            activate:() => void copyPlotExpression(handTarget),
            ...shared,
            priority:3,
          });
        } else {
          specs.push({
            key:`image:${handTarget.id}:merge`,
            kind:"merge",
            label:t("imageMerge"),
            tooltip:t("imageMergeHint"),
            box,
            objectToolbarItem:true,
            objectToolbarKey:toolbarKey,
            toolbarSlot:"tool",
            toolbarOrder:0,
            toolbarItemCount:1,
            baseWidth:28,
            baseHeight:28,
            activate:() => mergeImage(handTarget, { showHint:true }),
            ...shared,
            priority:3,
          });
        }
      } else if (record.kind === "animation") {
        const box = animationBox(handTarget);
        specs.push({ key:`animation:${handTarget.id}:move`, kind:"move", box, target:"animation", object:handTarget, ...shared, priority:2 });
        if (record.expanded && state.handToolbarActiveKey === key && state.animationEdit?.id === handTarget.id) {
          specs.push({ key:`animation:${handTarget.id}:cancel`, kind:"cancel", box, activate:cancelAnimationEdit, ...shared, priority:3 });
          specs.push({ key:`animation:${handTarget.id}:accept`, kind:"accept", box, activate:() => acceptAnimationEdit({ showHint:true }), ...shared, priority:3 });
        }
      } else if (record.kind === "widget") {
        if (!record.expanded || state.handToolbarActiveKey !== key || state.pendingWidget) continue;
        const box = widgetBox(handTarget),
          toolbarKey = addObjectToolbarSpecs(specs, {
            prefix:`widget:${handTarget.id}`,
            box,
            target:"widget",
            object:handTarget,
            // An existing Widget keeps its tools but never offers draft-style
            // accept/cancel decisions; Delete and Escape still apply.
            decisions:false,
            shared,
            priority:2,
          });
        addWidgetToolSpecs(specs, handTarget, {
          copy:true,
          community:true,
          download:true,
          decisions:false,
          handToolbar:true,
          handToolbarKey:key,
          handToolbarHiding:Boolean(record.hiding),
          objectToolbarKey:toolbarKey,
        });
      }
    }
    if (state.mode !== "pen") pendingChromeSpecs(specs, state.pending);
    if (state.mode !== "pen" && state.pendingWidget) {
      const widget = state.pendingWidget,
        box = widgetBox(widget),
        toolbarKey = addObjectToolbarSpecs(specs, {
          prefix:`pending-widget:${widget.id}`,
          box,
          target:"pending-widget",
          object:widget,
          cancelLabel:t("widgetDiscard"),
          acceptLabel:t("widgetAccept"),
          cancel:rejectPendingWidget,
          accept:() => acceptPendingWidget({ showHint:true }),
          priority:4,
        });
      addWidgetToolSpecs(specs, widget, {
        copy:true,
        download:true,
        objectToolbarKey:toolbarKey,
      });
    }
    return finalizeObjectToolbarWidths(specs);
  }
  function syncObjectChrome() {
    if (!objectChromeLayer) return;
    const active = new Set();
    const knownPositions = new Map();
    const attachedWidgetShells = new Set();
    let selectedWidgetMaterialRecord = null;
    let removedHoveredRefineButton = false;
    for (const spec of objectChromeSpecs()) {
      const button = objectChromeButtons.get(spec.key) || createObjectChromeButton(spec.key, spec.kind, spec),
        position = objectChromePosition(spec.box, spec.kind, spec.key, spec, knownPositions);
      if (!position) continue;
      knownPositions.set(spec.key, position);
      if (spec.objectToolbar && spec.object?.shell) {
        attachedWidgetShells.add(spec.object.shell);
        if (["widget", "pending-widget"].includes(spec.target)) selectedWidgetMaterialRecord = { spec, position };
      }
      active.add(spec.key);
      const label = objectChromeLabel(spec.kind, spec),
        copyConfirmed = spec.kind === "copy" && button.dataset.copyState === "copied",
        declaration = (button.penechoStyleRule || ensureObjectChromeStyleRule(button))?.["style"];
      button.penechoSpec = spec;
      if (spec.objectToolbar || spec.standaloneDraftControl) {
        button.removeAttribute("data-pe-button");
        button.removeAttribute("data-pe-density");
      } else peButton(button, spec.kind === "delete" ? "danger" : spec.kind === "refine" ? "secondary" : "toolbar", "compact");
      button.classList.toggle("standalone-draft-control", Boolean(spec.standaloneDraftControl));
      button.classList.toggle("widget-tool", Boolean(spec.widgetTool));
      button.classList.toggle("widget-chrome-control", Boolean(spec.widgetTool || spec.objectToolbar || spec.objectToolbarItem));
      button.classList.toggle("object-toolbar-surface", Boolean(spec.objectToolbar));
      button.classList.toggle("object-toolbar-shell", Boolean(spec.objectToolbar));
      button.classList.toggle("widget-object-toolbar", Boolean(spec.objectToolbar && ["widget", "pending-widget"].includes(spec.target)));
      button.classList.toggle("object-toolbar-item", Boolean(spec.objectToolbarItem));
      button.classList.toggle("icon-only", Boolean(spec.iconOnly || (spec.objectToolbarItem && spec.kind !== "interact")));
      button.classList.toggle("solo-widget-tool", Boolean(spec.widgetTool && spec.groupItemCount === 1));
      button.classList.toggle("hand-toolbar-control", Boolean(spec.handToolbar));
      button.classList.toggle("hand-toolbar-hiding", Boolean(spec.handToolbar && spec.handToolbarHiding));
      button.classList.toggle("is-favorite", Boolean(spec.kind === "favorite" && spec.pressed));
      button.classList.toggle("loading", Boolean(spec.busy));
      button.classList.toggle("refine-no-input", Boolean(spec.refineCandidate?.instructionMode === "implicit-polish"));
      button.classList.toggle("refine-hovered", Boolean(spec.refineCandidate && widgetRefineHintHovered(spec.refineCandidate)));
      if (spec.widgetToolGroup) button.dataset.widgetToolGroup = spec.widgetToolGroup;
      else delete button.dataset.widgetToolGroup;
      button.setAttribute("aria-label", copyConfirmed ? t("widgetSourceCopied") : label);
      button.disabled = Boolean(spec.busy);
      if (spec.kind === "favorite") button.setAttribute("aria-pressed", String(Boolean(spec.pressed)));
      else button.removeAttribute("aria-pressed");
      if (spec.busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      if (spec.kind === "refine" || spec.objectToolbar) button.removeAttribute("title");
      else button.title = spec.tooltip || label;
      if (spec.kind === "interact") button.querySelector(".widget-interact-label").textContent = t("widgetInteractShort");
      if (spec.kind === "refine") {
        const buttonLabel = button.querySelector(".widget-refine-button-label"),
          hint = button.querySelector(".widget-refine-hint"),
          visible = widgetRefineHintVisible(spec.refineCandidate),
          hintWidth = Math.min(320, Math.max(120, view.clientWidth - 24)),
          hintLeft = Math.max(12, Math.min(Math.max(12, view.clientWidth - hintWidth - 12), position.x)) - position.x;
        buttonLabel.textContent = label;
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
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) {
      widget.shell?.classList.toggle("object-toolbar-attached", attachedWidgetShells.has(widget.shell));
    }
    syncSelectedWidgetMaterial(selectedWidgetMaterialRecord);
    for (const [key, button] of objectChromeButtons) {
      if (active.has(key)) continue;
      if (button.penechoSpec?.kind === "refine"
        && state.widgetRefineButtonHoverId === button.penechoSpec.refineCandidate?.widgetId) {
        state.widgetRefineButtonHoverId = null;
        removedHoveredRefineButton = true;
      }
      removeObjectChromeStyleRule(button);
      button._copyGeneration = (button._copyGeneration || 0) + 1;
      clearTimeout(button._copyIconResetTimer);
      button.remove();
      objectChromeButtons.delete(key);
    }
    if (removedHoveredRefineButton) requestInteractionLayerRender();
    syncWidgetRefineConfirmation();
  }
  function syncSelectedWidgetMaterial(record) {
    if (!selectedWidgetMaterial) return;
    if (!record) {
      selectedWidgetMaterial.hidden = true;
      selectedWidgetMaterial.classList.remove("hand-toolbar-hiding");
      syncWidgetLayerOrder();
      syncCanvasObjectLayerOrder();
      return;
    }
    const { spec, position } = record,
      screenBox = screenObjectBox(spec.box),
      toolbarWidth = Math.max(screenBox.width, position.baseWidth || 0),
      toolbarHeight = position.baseHeight || 34,
      materialX = position.x - state.panX,
      materialY = position.y - state.panY,
      widgetStackIndex = state.widgets.length + (state.pendingWidget ? 2 : 1),
      declaration = runtimeElementStyle(selectedWidgetMaterial, "selected-widget-material");
    selectedWidgetMaterial.hidden = false;
    selectedWidgetMaterial.classList.toggle("hand-toolbar-hiding", Boolean(spec.handToolbar && spec.handToolbarHiding));
    syncWidgetLayerOrder();
    if (spec.object?.styleRule?.style) spec.object.styleRule.style.zIndex = String(widgetStackIndex);
    syncCanvasObjectLayerOrder();
    declaration?.setProperty("--selected-widget-material-x", `${materialX.toFixed(1)}px`);
    declaration?.setProperty("--selected-widget-material-y", `${materialY.toFixed(1)}px`);
    declaration?.setProperty("--selected-widget-material-width", `${toolbarWidth.toFixed(1)}px`);
    declaration?.setProperty("--selected-widget-material-height", `${(toolbarHeight + screenBox.height).toFixed(1)}px`);
    declaration?.setProperty("--selected-widget-body-width", `${screenBox.width.toFixed(1)}px`);
    declaration?.setProperty("--selected-widget-toolbar-height", `${toolbarHeight.toFixed(1)}px`);
    declaration?.setProperty("z-index", String(widgetStackIndex));
  }
  function syncWidgetInteractionStatus() {
    const widget = state.interactingWidgetId
      ? state.widgets.find(item => item.id === state.interactingWidgetId && item.shell)
      : null;
    if (!widget || widget.maximized || !widgetRuntimeEnabled() || widget.renderActive === false) {
      if (widgetInteractionStatusElement) widgetInteractionStatusElement.hidden = true;
      return;
    }
    if (!widgetInteractionStatusElement) {
      const element = document.createElement("div"),
        label = document.createElement("span");
      element.className = "widget-interaction-status";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      label.className = "widget-interaction-status-label";
      const maximize = document.createElement("button");
      maximize.type = "button";
      maximize.title = t("widgetMaximize");
      maximize.setAttribute("aria-label", t("widgetMaximize"));
      maximize.innerHTML = OBJECT_CHROME_ICONS.interact;
      maximize.addEventListener("click", () => {
        const current = state.widgets.find(item => item.id === state.interactingWidgetId);
        if (current) switchWidgetPresentation(current, true);
      });
      element.append(label, maximize);
      view.append(element);
      widgetInteractionStatusElement = element;
    }
    const element = widgetInteractionStatusElement,
      label = element.querySelector(".widget-interaction-status-label"),
      screenBox = screenObjectBox(widgetBox(widget)),
      viewportWidth = Math.max(0, view.clientWidth),
      height = 30,
      width = Math.max(180, Math.min(Math.max(180, viewportWidth - 12), screenBox.width)),
      x = Math.max(6, Math.min(Math.max(6, viewportWidth - width - 6), screenBox.left + (screenBox.width - width) / 2)),
      y = Math.max(6, screenBox.top - height - 6),
      declaration = runtimeElementStyle(element, "widget-interaction-status");
    label.textContent = t("widgetInteracting");
    declaration?.setProperty("--widget-interaction-status-x", `${x.toFixed(1)}px`);
    declaration?.setProperty("--widget-interaction-status-y", `${y.toFixed(1)}px`);
    declaration?.setProperty("--widget-interaction-status-width", `${width.toFixed(1)}px`);
    element.hidden = false;
  }
  objectChromeLayer?.addEventListener("pointermove", (event) => {
    if (finishReleasedWidgetGesture(event)) return;
    const overChromeControl = event.target?.closest?.(".object-chrome-button, .widget-refine-confirmation");
    if (event.pointerType !== "touch" && !overChromeControl) updateWidgetRefinePointer(clientPoint(event));
    if (state.pendingGesture?.id === event.pointerId) updatePendingGesture(event);
    else if (state.widgetGesture?.id === event.pointerId) updateWidgetGesture(event);
    else if (state.imageGesture?.id === event.pointerId) updateImageGesture(event);
    else if (state.animationGesture?.id === event.pointerId) updateAnimationGesture(event);
  });
  objectChromeLayer?.addEventListener("pointerup", finishObjectChromeGesture);
  objectChromeLayer?.addEventListener("pointercancel", finishObjectChromeGesture);
  function drawPointerPreview(context) {
    const preview = state.pointerPreview;
    if (!preview || state.mode !== "eraser" && !state.drawing?.erase || !valid(preview)) return;
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
  function drawAreaEraseSelection(context) {
    const box = areaEraseBox();
    if (!box) return;
    const unit = 1 / state.scale;
    context.save();
    context.fillStyle = "rgba(220, 38, 38, .1)";
    context.strokeStyle = "rgba(220, 38, 38, .92)";
    context.lineWidth = 1.5 * unit;
    context.setLineDash([6 * unit, 4 * unit]);
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function renderInteractionLayer() {
    const d = devicePixelRatio || 1,
      metrics = canvasViewportMetrics(),
      r = { width:metrics.width, height:metrics.height };
    interactionCtx.setTransform(d, 0, 0, d, 0, 0);
    interactionCtx.clearRect(0, 0, r.width, r.height);
    interactionCtx.save();
    interactionCtx.translate(state.panX, state.panY);
    interactionCtx.scale(state.scale, state.scale);
    interactionCtx.beginPath();
    interactionCtx.rect(0, 0, SIZE, SIZE);
    interactionCtx.clip();
    if (state.viewMode) {
      if (state.selection) drawSelectionContent(state.selection, interactionCtx);
      if (state.pending) {
        interactionCtx.save();
        interactionCtx.globalAlpha = 1 - (state.pending.fadeProgress || 0);
        drawPending(state.pending, interactionCtx, { chrome:false });
        interactionCtx.restore();
      }
      interactionCtx.restore();
      syncWidgetInteractionStatus();
      return;
    }
    if (state.drawing?.preview) drawPreview(state.drawing.preview, interactionCtx);
    drawPointerPreview(interactionCtx);
    drawAreaEraseSelection(interactionCtx);
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
    positionImageSelectionMaterial();
    syncObjectChrome();
    syncWidgetInteractionStatus();
  }
  function clientPoint(e) {
    const point = canvasClientPosition(e.clientX, e.clientY);
    return {
      x: (point.x - state.panX) / state.scale,
      y: (point.y - state.panY) / state.scale,
    };
  }
  function captureDrawingTransform() {
    const metrics = canvasViewportMetrics();
    return {
      left:metrics.rect.left,
      top:metrics.rect.top,
      clientScaleX:metrics.clientScaleX,
      clientScaleY:metrics.clientScaleY,
      panX:state.panX,
      panY:state.panY,
      scale:state.scale,
    };
  }
  function captureDrawingInput(event) {
    const inputTransform = captureDrawingTransform();
    return {
      inputTransform,
      point:drawingClientPoint({ inputTransform }, event),
    };
  }
  function drawingClientPoint(drawing, event) {
    const transform = drawing.inputTransform;
    return {
      x:((Number(event.clientX) - transform.left) * transform.clientScaleX - transform.panX) / transform.scale,
      y:((Number(event.clientY) - transform.top) * transform.clientScaleY - transform.panY) / transform.scale,
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
    const { width, height } = canvasViewportMetrics(),
      agent = document.querySelector("#canvasAgentPanel"),
      agentRect = agent && !agent.hidden && document.body.classList.contains("studio-agent-docked")
        ? canvasElementLayoutRect(agent)
        : null,
      visibleWidth = agentRect?.left > 0 ? Math.min(width, agentRect.left) : width;
    return { width:visibleWidth, height };
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
        declaration.setProperty("--text-editor-preview-inset-x", `${editor.previewInsetX || 0}px`);
        declaration.setProperty("--text-editor-preview-inset-y", `${editor.previewInsetY || 0}px`);
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
    setCanvasObjectFrontKind("text-box");
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
    const delta = canvasClientDelta(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY),
      dx = delta.x,
      dy = delta.y,
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
    peButton(button, "toolbar", "compact");
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
    editor.previewInsetX = 0;
    editor.previewInsetY = 0;
  }
  function textEditorContentMetrics(editor) {
    const body = editor?.body || editor?.element?.querySelector(".text-editor-body"),
      editorRect = canvasElementLayoutRect(editor?.element),
      bodyRect = canvasElementLayoutRect(body),
      style = body && window.getComputedStyle ? window.getComputedStyle(body) : null,
      paddingLeft = Number.parseFloat(style?.paddingLeft) || 10,
      paddingRight = Number.parseFloat(style?.paddingRight) || 10,
      paddingTop = Number.parseFloat(style?.paddingTop) || 10,
      fallbackLeft = (body?.offsetLeft || 0) + paddingLeft,
      fallbackTop = (body?.offsetTop || 34) + paddingTop,
      fallbackWidth = Math.max(1, editor.widthCss - paddingLeft - paddingRight - 2);
    if (!editorRect || !bodyRect) return { x:fallbackLeft, y:fallbackTop, width:fallbackWidth };
    return {
      x:bodyRect.left - editorRect.left + paddingLeft,
      y:bodyRect.top - editorRect.top + paddingTop,
      width:Math.max(1, bodyRect.width - paddingLeft - paddingRight),
    };
  }
  function textBoxOriginFromEditor(editor, contentMetrics, contentInset, scale) {
    const editorScale = Math.max(0.03, Number(scale) || 0);
    return {
      x:editor.x + contentMetrics.x / editorScale - contentInset.x,
      y:editor.y + contentMetrics.y / editorScale - contentInset.y,
    };
  }
  function textEditorOriginFromTextBox(item, contentMetrics, contentInset, scale) {
    const editorScale = Math.max(0.03, Number(scale) || 0);
    return {
      x:item.x + contentInset.x - contentMetrics.x / editorScale,
      y:item.y + contentInset.y - contentMetrics.y / editorScale,
    };
  }
  async function renderTextEditorPreview(editor) {
    if (!editor || !editor.mixedMode || editor.committing || editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
    const revision = ++editor.previewRevision,
      text = editor.textarea.value,
      fontCss = editor.fontCss,
      contentMetrics = textEditorContentMetrics(editor),
      maxWidth = Math.max(fontCss * 3, contentMetrics.width),
      color = editor.color || state.inkColor;
    editor.preview.setAttribute("aria-busy", "true");
    let image,
      fallback = false;
    try {
      image = await mixedTextImage(text, fontCss, color, maxWidth, 1.35, editor.fontFamily, Math.min(3, devicePixelRatio || 1));
    } catch {
      image = textImage(text, fontCss, color, maxWidth, 1.35, editor.fontFamily, TEXT_INPUT_MAX_LENGTH, Math.min(3, devicePixelRatio || 1));
      fallback = true;
    }
    if (editor.cancelled || editor.committing || !editor.mixedMode || editor.previewRevision !== revision || state.textEditors.get(editor.id) !== editor) return;
    image.classList.add("text-editor-preview-canvas");
    editor.previewLogicalWidth = image.logicalWidth || image.width;
    editor.previewLogicalHeight = image.logicalHeight || image.height;
    const previewInset = textImageContentInset(image);
    editor.previewInsetX = previewInset.x;
    editor.previewInsetY = previewInset.y;
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
  function textEditorOwnsFocusTarget(editor, target) {
    return Boolean(target && (editor.element.contains(target)
      || target.closest?.("#textHelpDialog") && textHelpInvoker && editor.element.contains(textHelpInvoker)));
  }
  async function unselectTextEditor(editor) {
    if (!editor || editor.committing || editor.unselecting || editor.cancelled) return;
    const source = state.textBoxes.find(item => item.id === editor.sourceTextBoxId);
    if (source && editor.textarea.value === source.text && !editor.moved && !editor.resized) {
      state.selectedTextBoxId = null;
      removeTextEditor(editor);
      requestRender();
      return;
    }
    if (!editor.textarea.value.trim()) {
      cancelTextEditor(editor);
      return;
    }
    editor.unselecting = true;
    editor.element.classList.remove("active");
    editor.element.classList.add("unselecting");
    try {
      await confirmTextEditor(editor, { focusLoss:true });
    } catch (error) {
      // Keep the draft recoverable if formatting fails during implicit commit.
      editor.unselecting = false;
      editor.committing = false;
      editor.element.classList.remove("unselecting", "committing");
      editor.element.classList.add("active");
      editor.element.querySelectorAll("button").forEach(button => (button.disabled = false));
      setStatusKey("textMixedModeError");
    }
  }
  function unselectTextEditorsOutside(event) {
    for (const editor of [...state.textEditors.values()]) {
      if (event.type !== "blur" && textEditorOwnsFocusTarget(editor, event.target)) continue;
      void unselectTextEditor(editor);
    }
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
      if (!options.focusLoss) blockCanvasInput(TEXT_INPUT_GUARD_MS);
      if (!editor.returnMode && state.mode === "text") setCanvasMode("pen");
      supersedeActiveAI("text-input-confirmed");
      clearTimeout(state.timer);
      state.timer = 0;
      editor.element.querySelectorAll("button").forEach((button) => (button.disabled = true));
      const contentMetrics = textEditorContentMetrics(editor),
        editorScale = Math.max(0.03, state.scale);
      editor.mixedMode = true;
      const proposedFontSize = editor.fontCss / Math.max(0.03, state.scale);
      let fontSize = editor.sourceTextBoxId && !editor.resized ? editor.sourceFontSize : proposedFontSize,
        proposedMaxWidth = Math.max(fontSize * 3, contentMetrics.width / editorScale),
        color = editor.color || state.inkColor;
      let maxWidth = editor.sourceTextBoxId && !editor.resized ? editor.sourceMaxWidth : proposedMaxWidth,
        x,
        y;
      const fitted = await fittedTextBoxContent(text, fontSize, color, maxWidth, editor.fontFamily);
      if (editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
      const image = fitted.image,
        mixedFallback = fitted.mixedFallback,
        width = fitted.width,
        height = fitted.height;
      fontSize = fitted.fontSize;
      maxWidth = fitted.maxWidth;
      const contentInset = textImageContentInset(image),
        alignedOrigin = textBoxOriginFromEditor(editor, contentMetrics, contentInset, editorScale),
        preserveSourceOrigin = editor.sourceTextBoxId && !editor.moved && !editor.resized;
      x = preserveSourceOrigin ? editor.sourceX : alignedOrigin.x;
      y = preserveSourceOrigin ? editor.sourceY : alignedOrigin.y;
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
        fontFamily:fitted.fontFamily,
        color,
        text,
        image,
      };
      if (existingIndex >= 0) state.textBoxes.splice(existingIndex, 1, item);
      else state.textBoxes.push(item);
      state.userRevision++;
      state.dirtyTextBoxIds.add(item.id);
      mcpRecordFeedback("text",textBoxBox(item),item);
      recomputeDirtyBounds();
      state.latestTypedInput = { text: text.slice(0, TEXT_INPUT_MAX_LENGTH), box };
      state.autoEligible = true;
      const refineCandidate = options.focusLoss ? null : latchWidgetRefineCandidate(item, "text-box");
      if (!editor.sourceTextBoxId || state.selectedTextBoxId === editor.sourceTextBoxId) state.selectedTextBoxId = null;
      removeTextEditor(editor);
      if (!options.focusLoss) blockCanvasInput(TEXT_INPUT_GUARD_MS);
      if (!options.focusLoss) restoreTextEditorMode(editor);
      saveUserCanvasChange();
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
    if (returnMode && state.mode === "select") {
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
      saveUserCanvasChange();
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
        previewInsetX: 0,
        previewInsetY: 0,
        committing: false,
        cancelled: false,
        gesture: null,
        returnMode:typeof options.returnMode === "string" ? options.returnMode : "",
        sourceTextBoxId:typeof options.sourceTextBoxId === "string" ? options.sourceTextBoxId : "",
        sourceX:Number(options.sourceX),
        sourceY:Number(options.sourceY),
        sourceMaxWidth:Number(options.sourceMaxWidth),
        sourceFontSize:Number(options.sourceFontSize),
        fontFamily:normalizeTextBoxFontFamily(options.fontFamily),
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
    header.className = "text-editor-header object-toolbar-shell";
    title.className = "text-editor-title";
    title.dataset.i18n = "text";
    title.textContent = t("text");
    mixedModeButton.className = "text-editor-button mixed-mode";
    mixedModeButton.type = "button";
    peButton(mixedModeButton, "toolbar", "compact");
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
    header.append(cancelButton, title, helpButton, mixedModeButton, acceptButton);
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
    if (!["select", "hand"].includes(state.mode) || state.viewMode || !item || !state.textBoxes.includes(item) || state.textEditors.size) return false;
    clearHandToolbarTarget("text-box", item.id);
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.animationEdit) acceptAnimationEdit();
    bringTextBoxToFront(item);
    state.selectedTextBoxId = item.id;
    const scale = Math.max(.03, state.scale),
      editor = createTextEditor({ x:item.x, y:item.y }, {
        text:item.text,
        widthCss:Math.max(TEXT_EDITOR_MIN_WIDTH, item.maxWidth * scale + 16),
        heightCss:Math.max(TEXT_EDITOR_MIN_HEIGHT, item.h * scale + 42),
        fontCss:Math.max(8, item.fontSize * scale),
        sourceTextBoxId:item.id,
        sourceX:item.x,
        sourceY:item.y,
        sourceMaxWidth:item.maxWidth,
        sourceFontSize:item.fontSize,
        fontFamily:item.fontFamily,
        color:item.color,
        returnMode:state.mode,
      });
    if (!editor) {
      state.selectedTextBoxId = null;
      return false;
    }
    const contentMetrics = textEditorContentMetrics(editor),
      contentInset = textImageContentInset(item.image),
      editorOrigin = textEditorOriginFromTextBox(item, contentMetrics, contentInset, scale);
    editor.x = editorOrigin.x;
    editor.y = editorOrigin.y;
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
    setCanvasCursor(state.spacePan || state.viewMode && state.viewTool === "hand" || state.mode === "hand" && !state.viewMode ? "grab" : state.mode === "pen" ? "pen" : state.mode === "eraser" ? "eraser" : "crosshair");
  }
  function beginTouchGesture() {
    if (state.navigationLocked || state.touches.size < 2) return;
    const ids = [...state.touches.keys()].slice(0, 2),
      screenPoints = ids.map((id) => state.touches.get(id)),
      points = screenPoints.map((point) => canvasClientPosition(point.x, point.y));
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
    const first = canvasClientPosition(points[0].x, points[0].y),
      second = canvasClientPosition(points[1].x, points[1].y),
      center = { x:(first.x + second.x) / 2, y:(first.y + second.y) / 2 },
      distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      next = Math.max(0.03, Math.min(2, (g.scale * distance) / g.distance)),
      anchorX = (g.center.x - g.panX) / g.scale,
      anchorY = (g.center.y - g.panY) / g.scale,
      previousPanX = state.panX,
      previousPanY = state.panY,
      previousScale = state.scale;
    state.scale = next;
    state.panX = center.x - anchorX * next;
    state.panY = center.y - anchorY * next;
    requestCoordinatesUpdate();
    setNavigating(true);
    requestCanvasNavigationPreview(previousPanX, previousPanY, previousScale);
    return true;
  }
  function moveCanvas(dx, dy) {
    if (state.navigationLocked) {
      setNavigating(true);
      return false;
    }
    const delta = canvasClientDelta(dx, dy),
      previousPanX = state.panX,
      previousPanY = state.panY;
    state.panX += delta.x;
    state.panY += delta.y;
    requestCanvasNavigationPreview(previousPanX, previousPanY);
    return true;
  }
  function zoomCanvasAt(clientX, clientY, deltaY) {
    if (!Number.isFinite(deltaY) || deltaY === 0) return false;
    if (state.navigationLocked) {
      setNavigating(true);
      return false;
    }
    const point = canvasClientPosition(clientX, clientY),
      factor = Math.exp(-Math.max(-300, Math.min(300, deltaY)) * .002),
      next = Math.max(0.03, Math.min(2, state.scale * factor)),
      px = point.x,
      py = point.y,
      previousPanX = state.panX,
      previousPanY = state.panY,
      previousScale = state.scale;
    state.panX = px - ((px - state.panX) * next) / state.scale;
    state.panY = py - ((py - state.panY) * next) / state.scale;
    state.scale = next;
    requestCoordinatesUpdate();
    requestCanvasNavigationPreview(previousPanX, previousPanY, previousScale);
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
