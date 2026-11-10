  // Keep existing Ink Lab widgets editable, undoable and exportable.
  // Creation tools and automatic suggestions have been removed from Canvas.
  const livingInkModel = window.PENECHO_LIVING_INK_MODEL, livingInkRuntime = window.PENECHO_LIVING_INK,
    livingInkSourceFormat = "penecho-living-ink";
  const livingInkCopy = (en, zh) => state.language === "zh" ? zh : en;
  let livingInkDownload = null;
  function livingInkWidgetMessage(widget, message) {
    if (widget.sourceFormat !== livingInkSourceFormat || widget.pending || widget.mcpEphemeral || state.interactingWidgetId !== widget.id) return;
    if (message.type === "penecho-living-ink-download") {
      const types={"penecho-figure.svg":"image/svg+xml","penecho-figure.png":"image/png","penecho-ink-lab.html":"text/html","penecho-ink-lab.pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
      if(types[message.name]!==message.mime || !(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength>16*1024*1024)return;
      if(livingInkDownload){URL.revokeObjectURL(livingInkDownload.url);livingInkDownload.element.remove();}
      const url=URL.createObjectURL(new Blob([message.bytes],{type:message.mime})),element=document.createElement("div"),link=document.createElement("a"),close=document.createElement("button");
      element.className="living-ink-download";element.setAttribute("role","status");link.href=url;link.download=message.name;link.textContent=livingInkCopy("Download ","下载 ")+message.name;
      close.type="button";close.textContent="×";close.setAttribute("aria-label",livingInkCopy("Close download","关闭下载"));close.onclick=()=>{URL.revokeObjectURL(url);element.remove();if(livingInkDownload?.url===url)livingInkDownload=null;};
      element.append(link,close);document.body.append(element);livingInkDownload={url,element};link.click();return;
    }
    if (message.type !== "penecho-living-ink-change" || !Number.isInteger(message.revision) || message.revision < 1) return;
    let ok = false;
    try {
      const scene = livingInkModel.validate(message.document), html = livingInkRuntime.createHtml(scene, state.language);
      if (html !== widget.html) { recordWidgetsBefore();widget.html = html;widget.contentVersion++;widget.snapshotDataUrl = "";state.userRevision++;state.autoEligible = false;saveUserCanvasChange();requestRender(); }
      ok = true;
    } catch (error) { setStatus(livingInkCopy("Ink Lab could not save: ", "手绘实验室保存失败：") + String(error.message || error)); }
    widget.frame?.contentWindow?.postMessage({ type:"penecho-living-ink-saved", revision:message.revision, ok }, widget.hostOrigin || location.origin);
  }
