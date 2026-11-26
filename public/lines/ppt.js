// Slides are chosen in the box as the Slides chip, with its templates as kinds (make.js). Download PPT, on the Canvas or on its card here, saves a deck as PowerPoint.

// ---------- Download PPT from a Canvas card ----------
// A Canvas with slides on it downloads as one PowerPoint file from its card, without opening it. Each slide is drawn
// off screen in the Widget host the Canvas uses, reads itself, and becomes an editable slide with native charts
// (src/shared/slides-pptx.js, the same builder as Download PPT on the Canvas).
const PPT_BUSY = new Set(), PPT_AT_ONCE = 3, PPT_SLIDE_TIMEOUT = 30000;
function pptDownloadButton(c, cls = 'btn sm') {
  if (!c?.slides) return '';
  const busy = PPT_BUSY.has(c.source);
  return `<button type="button" class="${cls} ppt-download" data-act="ppt-download" data-canvas="${esc(c.source)}" title="${c.slides} ${c.slides === 1 ? 'slide' : 'slides'}" ${busy ? 'disabled aria-busy="true"' : ''}>${ic('download', 14)}<span>${busy ? 'Making PPT…' : 'Download PPT'}</span></button>`;
}
function syncPptButtons(source) {
  const c = canvasByPath(project(), source);
  document.querySelectorAll('.ppt-download').forEach(b => { if (b.dataset.canvas === source && c) b.outerHTML = pptDownloadButton(c, [...b.classList].filter(x => x !== 'ppt-download').join(' ')); });
}
// The Widget host sits on the other loopback name when PenEcho is opened on one, as the Canvas keeps it. penecho.ai serves these pages,
// the Widget host and the PowerPoint builder from the Canvas's own folder (hosted.js), so there the addresses are relative, and the
// host is the one the Canvas page there opens, on the same address (its content policy frames only its own).
const pptHere = () => typeof HOSTED !== 'undefined' && Boolean(HOSTED);
function pptHostUrl() {
  const url = new URL(pptHere() ? 'widget-host.html' : '/widget-host.html', location.href);
  if (pptHere()) { url.searchParams.set('remote-canvas', '1'); url.searchParams.set('public-https', '1'); return url.href; }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') { url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'; url.searchParams.set('parent-origin', location.origin); }
  return url.href;
}
function pptScript(src, ready) {
  if (ready()) return Promise.resolve(ready());
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true;
    script.onload = () => ready() ? resolve(ready()) : reject(Error('PowerPoint is not available here. Restart PenEcho and try again.'));
    script.onerror = () => { script.remove(); reject(Error('PowerPoint is not available here. Restart PenEcho and try again.')); };
    document.head.append(script);
  });
}
const pptLibraries = () => Promise.all([pptScript(pptHere() ? 'vendor/ink-lab-vendor.js' : '/ink-lab-vendor.js', () => window.PENECHO_INK_TOOLS?.PptxGenJS), pptScript(pptHere() ? 'lines/slides-pptx.js' : '/lines/slides-pptx.js', () => window.PenEchoSlidesPptx)]);
function pptReadSlide(slide, hostUrl) {
  const frame = document.createElement('iframe'), origin = new URL(hostUrl).origin, requestId = `ppt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  frame.title = slide.title || 'Slide';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1; frame.inert = true;
  Object.assign(frame.style, { position:'fixed', left:'-20000px', top:'0', width:'1280px', height:'720px', border:'0', pointerEvents:'none' });
  return new Promise((resolve, reject) => {
    let started = false;
    const finish = (error, data) => { clearTimeout(timer); removeEventListener('message', receive); frame.remove(); if (error) reject(error); else resolve(data); };
    const timer = setTimeout(() => finish(Error(`“${slide.title || 'A slide'}” took too long to draw.`)), PPT_SLIDE_TIMEOUT);
    const receive = event => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const m = event.data;
      if (m?.type === 'penecho-widget-host-ready' && !started) {
        started = true;
        const send = message => frame.contentWindow.postMessage(message, origin);
        send({ type:'penecho-widget-init', html:slide.html, title:slide.title, language:document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en' });
        send({ type:'penecho-widget-state', active:true, selected:false, interactive:false, maximized:false, scaleX:1, scaleY:1 });
        // The host holds this until the slide has drawn.
        send({ type:'penecho-widget-slide-request', requestId });
      } else if (m?.requestId === requestId && m.type === 'penecho-widget-slide' && Array.isArray(m.slide?.items)) finish(null, m.slide);
      else if (m?.requestId === requestId && m.type === 'penecho-widget-slide-error') finish(Error(m.error || `“${slide.title || 'A slide'}” could not be read.`));
    };
    addEventListener('message', receive);
    frame.src = hostUrl;
    document.body.append(frame);
  });
}
async function pptReadAll(slides) {
  const hostUrl = pptHostUrl(), out = new Array(slides.length);
  let next = 0;
  const worker = async () => { while (next < slides.length) { const i = next++; out[i] = { data:await pptReadSlide(slides[i], hostUrl), title:slides[i].title }; } };
  await Promise.all(Array.from({ length:Math.min(PPT_AT_ONCE, slides.length) }, worker));
  return out;
}
ACT['ppt-download'] = async el => {
  const p = project(), source = el.dataset.canvas;
  if (!p || !source || PPT_BUSY.has(source)) return;
  PPT_BUSY.add(source); syncPptButtons(source);
  try {
    const [deck, [PptxGenJS, builder]] = await Promise.all([api(`${pathFor(p.id)}/canvas-slides?path=${encodeURIComponent(source)}`), pptLibraries()]);
    if (!deck.slides?.length) throw Error('This Canvas has no slides any more.');
    const blob = await builder.buildDeck(PptxGenJS, await pptReadAll(deck.slides), deck.title),
      url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = builder.pptFilename(deck.title);
    try { document.body.append(link); link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  } catch (error) {
    toast(`Download PPT failed: ${error.message}`);
  } finally {
    PPT_BUSY.delete(source); syncPptButtons(source);
  }
};
