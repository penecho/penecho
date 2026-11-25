"use strict";
// Measures a rendered design prototype for the defects a small preview picture hides:
// an element shown despite `hidden`, an icon off-center in its badge, clipped text, sideways overflow,
// a floating control on top of a real one, a control covered by another element, a broken image.
// It runs once in the page that is already being drawn, so it costs a few milliseconds and no extra browser.

const MARK = "PENECHO_LAYOUT_CHECK:";
const MAX_CHECKS = 8;

// Runs inside the drawn page. Keep it self-contained: it is sent as source text.
function probe() {
  const out = [], seen = new Set(), vw = innerWidth, vh = innerHeight;
  const LIMIT = 8;
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += `.${cls.join(".")}`;
    const text = String(el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 32);
    return text ? `${s} "${text}"` : s;
  };
  const add = (kind, el, detail) => {
    const where = label(el), key = `${kind}|${where}`;
    if (seen.has(key) || out.length >= LIMIT) return;
    seen.add(key);
    out.push({ kind, where, detail });
  };
  const px = n => Math.round(n);
  const box = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
    return r;
  };
  const inView = r => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const all = [...document.body.querySelectorAll("*")].slice(0, 6000);

  for (const el of document.querySelectorAll("[hidden]")) {
    if (getComputedStyle(el).display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height >= 4) add("hidden-shown", el, `has the hidden attribute but still takes ${px(r.width)}x${px(r.height)}px on screen; add [hidden] { display: none !important; }`);
  }

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "svg" || el.closest("svg")) continue;
    const r = box(el);
    if (!r || !inView(r)) continue;
    const cs = getComputedStyle(el);

    // An icon or short glyph alone in a small box should sit in its middle.
    if (r.width >= 12 && r.height >= 12 && r.width <= 64 && r.height <= 64) {
      const innerX = r.left + el.clientLeft + el.clientWidth / 2, innerY = r.top + el.clientTop + el.clientHeight / 2;
      let inner = null;
      if (el.children.length === 1 && !ownText(el)) {
        const child = el.children[0], ct = child.tagName.toLowerCase();
        if (ct === "svg" || ct === "img" || (child.children.length === 1 && child.children[0].tagName.toLowerCase() === "svg" && !ownText(child))) {
          const target = ct === "svg" || ct === "img" ? child : child.children[0];
          inner = target.getBoundingClientRect();
        }
      } else if (!el.children.length && /^\S{1,3}$/.test(el.textContent.trim()) && cs.textAlign !== "left" && cs.textAlign !== "start") {
        const range = document.createRange();
        range.selectNodeContents(el);
        inner = range.getBoundingClientRect();
      }
      if (inner && inner.width >= 4 && inner.height >= 4) {
        const dx = inner.left + inner.width / 2 - innerX, dy = inner.top + inner.height / 2 - innerY;
        const offX = Math.abs(dx) > 3 && el.clientWidth - inner.width >= 4, offY = Math.abs(dy) > 4 && el.clientHeight - inner.height >= 4;
        if (offX || offY) add("icon-off-center", el, `its icon sits ${px(dx)}px, ${px(dy)}px from the middle of the ${px(r.width)}x${px(r.height)}px box; center it (display: inline-grid; place-items: center) and check no broader rule overrides that display`);
      }
    }

    // Text cut off by its own box, without an ellipsis or line clamp saying so.
    if (ownText(el) && el.clientWidth > 0) {
      const clipsX = /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis";
      const clipsY = /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 3 && !(cs.webkitLineClamp && cs.webkitLineClamp !== "none");
      if (clipsX || clipsY) add("clipped-text", el, `text is cut off (${clipsX ? `needs ${el.scrollWidth}px, has ${el.clientWidth}px` : `needs ${el.scrollHeight}px tall, has ${el.clientHeight}px`}); let it wrap, give it room, or ellipsize on purpose`);
    }

    if (tag === "img" && el.complete && el.naturalWidth === 0) add("broken-image", el, "the image did not load; inline it as SVG or a data: URL");
  }

  const wide = document.documentElement.scrollWidth;
  if (wide > vw + 1) {
    const culprit = all.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && (!el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 1); }) || document.body;
    add("page-overflow", culprit, `the page is ${wide}px wide in a ${vw}px viewport, so it scrolls sideways`);
  }

  const controls = all.filter(el => el.matches("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex='-1'])"));
  const floating = all.filter(el => {
    if (getComputedStyle(el).position !== "fixed") return false;
    const r = box(el);
    return r && inView(r) && r.width * r.height < vw * vh * 0.25;
  });
  for (const el of controls) {
    const r = box(el);
    if (!r || !inView(r) || r.width < 4 || r.height < 4) continue;
    // A floating control (such as a Tweaks pill) must not sit on a real control.
    for (const f of floating) {
      if (f.contains(el) || el.contains(f) || f.closest("[data-proto-chrome]") === el.closest("[data-proto-chrome]") && el.closest("[data-proto-chrome]")) continue;
      const q = f.getBoundingClientRect(), w = Math.min(q.right, r.right) - Math.max(q.left, r.left), h = Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top);
      if (w >= 2 && h >= 2) add("floating-overlap", el, `the floating ${label(f)} overlaps it by ${px(w)}x${px(h)}px; move the floating element clear of it`);
    }
    // Something else is on top of the control's middle, so a click would not reach it.
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (!top || el.contains(top) || top.contains(el)) continue;
    if (el.labels && [...el.labels].some(l => l.contains(top))) continue;
    if (floating.some(f => f.contains(top))) continue;
    add("covered-control", el, `${label(top)} covers its middle, so it cannot be seen or clicked there`);
  }
  return out;
}

const PROBE = `(${probe.toString()})()`;

// For a headless browser that can only answer through its console: the probe prints its findings as one base64 line after MARK.
// A headless browser lays the page out in a shorter window and resizes it to the picture's size only as it takes the picture,
// so the probe measures once the page has settled at exactly that size, or right when the resize comes, and never at another size.
function withProbe(html, { width = 0, height = 0, settleMs = 1200 } = {}) {
  const script = `<script>(()=>{let told=false;const W=${Number(width) || 0},H=${Number(height) || 0};const tell=()=>{if(told||(W&&innerWidth!==W)||(H&&innerHeight!==H))return;told=true;let r=[];try{r=${PROBE}}catch(e){r=[]}try{console.log(${JSON.stringify(MARK)}+btoa(unescape(encodeURIComponent(JSON.stringify(r)))))}catch(e){}};addEventListener("resize",tell);const run=()=>setTimeout(tell,${Number(settleMs) || 0});document.readyState==="complete"?run():addEventListener("load",run,{once:true});})();</script>`;
  const text = String(html || ""), at = text.toLowerCase().lastIndexOf("</body>");
  return at >= 0 ? `${text.slice(0, at)}${script}${text.slice(at)}` : `${text}${script}`;
}

// Finds the probe's line in a browser's log output.
function readProbe(log) {
  const text = String(log || ""), at = text.lastIndexOf(MARK);
  if (at < 0) return null;
  const m = /^[A-Za-z0-9+/=]+/.exec(text.slice(at + MARK.length));
  if (!m) return null;
  try { return clean(JSON.parse(Buffer.from(m[0], "base64").toString("utf8"))); } catch { return null; }
}

// Only the expected shape, at most MAX_CHECKS, each field short.
function clean(list) {
  if (!Array.isArray(list)) return null;
  const cut = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  return list.filter(c => c && typeof c === "object" && c.kind).slice(0, MAX_CHECKS).map(c => ({ kind:cut(c.kind, 40), where:cut(c.where, 120), detail:cut(c.detail, 240) }));
}

// The findings as one message an agent can act on.
function describeChecks(name, checks) {
  if (!checks?.length) return "";
  return `${name}: ${checks.map(c => `${c.where} — ${c.detail}`).join("; ")}`;
}

module.exports = { MARK, MAX_CHECKS, PROBE, probe, withProbe, readProbe, clean, describeChecks };
