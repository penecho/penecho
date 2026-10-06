"use strict";
// PenEcho note cards: a compact, validated JSON source for knowledge cards and
// work notes. Every card is a General HTML Widget, but PenEcho owns its document
// (like scenes): Canvas AI, PenEcho Agent and MCP send the note object, never
// HTML. The card always renders in one fixed portrait 3:4 frame so a Canvas
// full of cards reads as a deck, and the Notes library can browse, search,
// rank and review them together. Shared by the browser (window.PENECHO_NOTE_CARD)
// and the server (require).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_NOTE_CARD = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  const FORMAT = "penecho-note-card+json",
    FRAMEWORK_VERSION = "penecho-note-card/1",
    COPY_LABEL = "Copy note",
    VERSION = 1,
    // Bump when the rendered look changes so stored library thumbnails refresh.
    LOOK = "clean-paper-1",
    // CSS size of the card document. Canvas size follows the deck (see cardSize).
    CONTENT = Object.freeze({ w:900, h:1200 }),
    ASPECT = CONTENT.h / CONTENT.w,
    MAX_SOURCE_CHARS = 640000,
    MAX_MEDIA_CHARS = 600000,
    MAX_DOCUMENT_CHARS = 700000,
    MAX_BLOCKS = 24,
    STYLES = Object.freeze(["card", "note"]),
    CALLOUT_TONES = Object.freeze(["key", "definition", "tip", "warning", "example", "question"]),
    SOURCE_KINDS = Object.freeze(["selection", "canvas-ai", "agent", "mcp", "manual", "import"]),
    // Who chose the category. Anything but "user" may be refined by PenEchoLLM;
    // a category the person picked is never changed automatically.
    CATEGORY_SOURCES = Object.freeze(["user", "model", "penecho-llm", "local"]),
    // What a card mainly is. PenEchoLLM answers this in note mode (Cloud owns
    // the wording); the ids are shared so the library can filter by them.
    NOTE_KINDS = Object.freeze({
      concept:{ en:"Concept", zh:"概念" }, definition:{ en:"Definition", zh:"定义" }, formula:{ en:"Formula", zh:"公式" },
      proof:{ en:"Proof", zh:"证明" }, example:{ en:"Worked example", zh:"例题" }, procedure:{ en:"How-to", zh:"步骤" },
      diagram:{ en:"Diagram", zh:"图解" }, reference:{ en:"Reference", zh:"资料" }, decision:{ en:"Decision", zh:"决策" },
      task:{ en:"Tasks", zh:"任务" }, idea:{ en:"Idea", zh:"想法" }, meeting:{ en:"Meeting", zh:"会议" },
      question:{ en:"Open question", zh:"疑问" }, other:{ en:"Other", zh:"其他" },
    }),
    // Built-in categories. People can add their own (id, label, color); a card
    // stores a snapshot of its category so it renders anywhere.
    CATEGORIES = Object.freeze([
      { id:"concept", en:"Concept", zh:"概念", color:"#2563eb", icon:"◆", style:"card" },
      { id:"formula", en:"Formula", zh:"公式", color:"#7c3aed", icon:"∑", style:"card" },
      { id:"example", en:"Worked example", zh:"例题", color:"#0d9488", icon:"✎", style:"card" },
      { id:"reference", en:"Reference", zh:"资料", color:"#475569", icon:"❏", style:"card" },
      { id:"idea", en:"Idea", zh:"想法", color:"#d97706", icon:"✦", style:"note" },
      { id:"work", en:"Work", zh:"工作", color:"#16a34a", icon:"▣", style:"note" },
      { id:"meeting", en:"Meeting", zh:"会议", color:"#db2777", icon:"◷", style:"note" },
      { id:"todo", en:"To-do", zh:"待办", color:"#ea580c", icon:"☑", style:"note" },
    ].map(item => Object.freeze(item))),
    BLOCK_ALIASES = Object.freeze({
      text:"markdown", paragraph:"markdown", md:"markdown", body:"markdown", heading:"markdown",
      math:"formula", latex:"formula", equation:"formula", tex:"formula",
      sketch:"ink", handwriting:"ink", drawing:"ink", original:"ink",
      picture:"image", photo:"image", figure:"image",
      plot:"graph", function:"graph", chart:"graph",
      points:"keypoints", bullets:"keypoints", list:"keypoints", takeaways:"keypoints", summary:"keypoints",
      note:"callout", tip:"callout", warning:"callout", definition:"callout", highlight:"callout",
      flashcard:"qa", question:"qa", card:"qa",
      todo:"checklist", tasks:"checklist", checkbox:"checklist", todos:"checklist",
      snippet:"code", hr:"divider", separator:"divider", blockquote:"quote",
    }),
    BLOCK_TYPES = Object.freeze(["markdown", "formula", "ink", "image", "graph", "keypoints", "callout", "qa", "checklist", "code", "quote", "table", "divider"]),
    DAY_MS = 86400000,
    // Leitner boxes for reviewing knowledge cards: again, then 1, 3, 7, 16, 35 days.
    REVIEW_INTERVAL_DAYS = Object.freeze([0, 1, 3, 7, 16, 35]);

  // One contract for Canvas AI, PenEcho Agent and MCP. Keep it compact: it is
  // sent with every note request.
  const NOTE_CONTRACT = `PenEcho note card (sourceFormat "${FORMAT}"): PenEcho renders one fixed portrait 3:4 card from a compact note object; never write HTML for it. Fields: title (required, at most 120 characters, specific and searchable), subtitle (optional), style ("card" for study knowledge such as concepts, formulas, examples or references; "note" for work notes, meetings, ideas and plans), category (one id: ${CATEGORIES.map(item => item.id).join("|")}, or a custom id the user listed), tags (at most 8 short words), summary (one sentence used for search), bookmarked (boolean), blocks (1 to 24, in reading order). Block types: {"type":"markdown","text"} (Markdown with $inline$ and $$display$$ LaTeX); {"type":"formula","latex","caption"}; {"type":"keypoints","title","items":[...at most 8]}; {"type":"callout","tone":"key|definition|tip|warning|example|question","title","text"}; {"type":"qa","question","answer"} (a flashcard; the answer stays hidden until tapped); {"type":"checklist","items":[{"text","done"}]}; {"type":"graph","expression":"y = sin(x)","parameters":{"a":1},"caption"}; {"type":"code","language","text"}; {"type":"quote","text","source"}; {"type":"table","header":true,"rows":[["a","b"]]}; {"type":"image","src":"https://… or data:image/…","alt","caption"}; {"type":"ink","ref":"selection","caption"} (the user's original handwriting, supplied by PenEcho); {"type":"divider"}. Keep a card scannable: one idea per block, about 180 words of prose at most, the user's language, faithful transcription. Prefer formula, keypoints, qa and checklist blocks over long paragraphs. Do not invent facts beyond the source; one short clarifying definition or takeaway is fine.`;

  function noteError(message, path = "") {
    const error = new Error(path ? `${path}: ${message}` : message);
    error.code = "INVALID_NOTE_CARD";
    return error;
  }
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  function text(value, max, { multiline = true } = {}) {
    if (value === undefined || value === null) return "";
    if (typeof value === "number" && Number.isFinite(value)) value = String(value);
    if (typeof value !== "string") return "";
    let out = value.replace(CONTROL, "").replace(/\r\n?/g, "\n");
    if (!multiline) out = out.replace(/\s+/g, " ");
    out = out.trim();
    if (out.length > max) out = out.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
    return out;
  }
  function hexColor(value) {
    const color = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map(c => c + c).join("")}`.toLowerCase();
    return "";
  }
  function hasCjk(value) { return /[㐀-鿿豈-﫿]/.test(String(value || "")); }
  function slug(value) {
    return String(value || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9㐀-鿿]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  }
  function categoryById(id, categories = CATEGORIES) {
    const key = String(id || "").trim().toLowerCase();
    return categories.find(item => item.id === key) || null;
  }
  function categoryLabel(category, language) {
    if (!category) return "";
    if (category.label) return category.label;
    return language === "zh" ? category.zh || category.en || category.id : category.en || category.id;
  }
  // Resolve any category hint to a stored snapshot {id,label,color,icon}.
  function normalizeCategory(value, { categories = CATEGORIES, language = "en" } = {}) {
    if (value === undefined || value === null || value === "") return null;
    const raw = typeof value === "object" && !Array.isArray(value) ? value : { id:value };
    const idText = text(raw.id ?? raw.name ?? raw.label, 40, { multiline:false });
    const known = categoryById(idText, categories) || categories.find(item => [item.en, item.zh, item.label].filter(Boolean).some(name => name.toLowerCase() === idText.toLowerCase()))
      || categoryById(idText, CATEGORIES) || CATEGORIES.find(item => [item.en, item.zh].some(name => name.toLowerCase() === idText.toLowerCase()));
    const id = known?.id || slug(idText);
    if (!id || !/^[a-z0-9㐀-鿿][a-z0-9㐀-鿿-]{0,31}$/.test(id)) return null;
    const label = text(raw.label, 32, { multiline:false }) || categoryLabel(known, language) || idText;
    return {
      id,
      label,
      color:hexColor(raw.color) || known?.color || "#475569",
      icon:text(raw.icon, 2, { multiline:false }) || known?.icon || "●",
    };
  }
  function mediaSource(value) {
    const src = String(value || "").trim();
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(src)) return src;
    if (/^https:\/\/[^\s"'<>]{1,2040}$/.test(src)) return src;
    // A reference to a picture kept by the Canvas while a model edits the text.
    if (/^penecho-note-media:\d{1,3}$/.test(src)) return src;
    return "";
  }
  function finite(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
  }
  function timeValue(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
    if (typeof value === "string" && value.trim()) { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
    return undefined;
  }
  function stringList(value, maxItems, maxLength) {
    const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
    return items.map(item => typeof item === "object" && item ? text(item.text ?? item.label ?? item.title, maxLength) : text(item, maxLength)).filter(Boolean).slice(0, maxItems);
  }

  function normalizeBlock(raw, index) {
    const path = `blocks[${index}]`;
    if (typeof raw === "string") raw = { type:"markdown", text:raw };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw noteError("each block must be an object", path);
    let type = String(raw.type || raw.kind || "").trim().toLowerCase();
    const alias = BLOCK_ALIASES[type];
    if (alias === "callout" && !raw.tone && CALLOUT_TONES.includes(type)) raw = { ...raw, tone:type };
    if (alias) type = alias;
    if (!type && typeof raw.text === "string") type = "markdown";
    if (!BLOCK_TYPES.includes(type)) throw noteError(`unsupported block type "${raw.type ?? ""}"; use ${BLOCK_TYPES.join(", ")}`, path);
    const caption = text(raw.caption, 160);
    switch (type) {
      case "markdown": {
        const value = text(raw.text ?? raw.markdown ?? raw.content ?? raw.value, 6000);
        if (!value) throw noteError("markdown text is required", path);
        return { type, text:value };
      }
      case "formula": {
        const latex = text(raw.latex ?? raw.tex ?? raw.formula ?? raw.text, 1200).replace(/^\$\$?|\$\$?$/g, "").trim();
        if (!latex) throw noteError("formula latex is required", path);
        return { type, latex, ...(caption ? { caption } : {}) };
      }
      case "ink":
      case "image": {
        const src = mediaSource(raw.src ?? raw.url ?? raw.image), ref = text(raw.ref, 40, { multiline:false });
        if (!src && !(type === "ink" && ref)) {
          if (type === "image") throw noteError("image src must be an https URL or an inline PNG, JPEG, WebP or GIF data URL", path);
          throw noteError("ink needs src or ref", path);
        }
        const w = finite(raw.w ?? raw.width, 1, 20000), h = finite(raw.h ?? raw.height, 1, 20000), alt = text(raw.alt, 160, { multiline:false });
        return { type, ...(src ? { src } : { ref }), ...(w && h ? { w:Math.round(w), h:Math.round(h) } : {}), ...(alt ? { alt } : {}), ...(caption ? { caption } : {}) };
      }
      case "graph": {
        const expressions = (Array.isArray(raw.expressions) ? raw.expressions : [raw.expression ?? raw.fn ?? raw.text]).map(item => text(item, 200, { multiline:false })).filter(Boolean).slice(0, 4);
        if (!expressions.length) throw noteError("graph expression is required", path);
        const parameters = {};
        if (raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters))
          for (const [name, value] of Object.entries(raw.parameters).slice(0, 8))
            if (/^[A-Za-z](?:_?\d)?$/.test(name) && !["x", "y", "z", "e"].includes(name) && Number.isFinite(Number(value))) parameters[name] = Number(value);
        const range = {};
        for (const key of ["xMin", "xMax", "yMin", "yMax"]) { const value = finite(raw[key], -1e6, 1e6); if (value !== undefined) range[key] = value; }
        if (range.xMin !== undefined && range.xMax !== undefined && range.xMin >= range.xMax) { delete range.xMin; delete range.xMax; }
        if (range.yMin !== undefined && range.yMax !== undefined && range.yMin >= range.yMax) { delete range.yMin; delete range.yMax; }
        return { type, expressions, ...(Object.keys(parameters).length ? { parameters } : {}), ...range, ...(caption ? { caption } : {}) };
      }
      case "keypoints": {
        const items = stringList(raw.items ?? raw.points ?? raw.text, 8, 280), title = text(raw.title, 80, { multiline:false });
        if (!items.length) throw noteError("keypoints need at least one item", path);
        return { type, ...(title ? { title } : {}), items };
      }
      case "callout": {
        const tone = CALLOUT_TONES.includes(String(raw.tone || "").toLowerCase()) ? String(raw.tone).toLowerCase() : "key",
          body = text(raw.text ?? raw.body ?? raw.content, 1400), title = text(raw.title, 80, { multiline:false });
        if (!body) throw noteError("callout text is required", path);
        return { type, tone, ...(title ? { title } : {}), text:body };
      }
      case "qa": {
        const question = text(raw.question ?? raw.q ?? raw.front, 600), answer = text(raw.answer ?? raw.a ?? raw.back, 1400);
        if (!question || !answer) throw noteError("qa needs question and answer", path);
        return { type, question, answer };
      }
      case "checklist": {
        const source = Array.isArray(raw.items) ? raw.items : stringList(raw.items ?? raw.text, 12, 240);
        const items = source.slice(0, 12).map(item => typeof item === "string" ? { text:text(item.replace(/^\s*(?:[-*]\s*)?\[[ xX]\]\s*/, ""), 240), done:/^\s*(?:[-*]\s*)?\[[xX]\]/.test(item) } : { text:text(item?.text ?? item?.label, 240), done:item?.done === true || item?.checked === true }).filter(item => item.text);
        if (!items.length) throw noteError("checklist needs at least one item", path);
        return { type, items };
      }
      case "code": {
        const value = text(raw.text ?? raw.code ?? raw.source, 4000), language = text(raw.language ?? raw.lang, 24, { multiline:false }).toLowerCase();
        if (!value) throw noteError("code text is required", path);
        return { type, ...(language ? { language } : {}), text:value };
      }
      case "quote": {
        const value = text(raw.text ?? raw.quote, 800), source = text(raw.source ?? raw.author, 120, { multiline:false });
        if (!value) throw noteError("quote text is required", path);
        return { type, text:value, ...(source ? { source } : {}) };
      }
      case "table": {
        const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, 12).map(row => (Array.isArray(row) ? row : [row]).slice(0, 6).map(cell => text(cell, 120)));
        if (!rows.length || !rows.some(row => row.some(Boolean))) throw noteError("table needs rows", path);
        return { type, header:raw.header !== false, rows };
      }
      default: return { type:"divider" };
    }
  }

  // Validate and canonicalize any note source. Unknown fields are dropped so a
  // slightly verbose model answer still renders; missing essentials throw with
  // a message the model can act on.
  function normalize(value, options = {}) {
    let raw = value;
    if (typeof raw === "string") {
      if (raw.length > MAX_SOURCE_CHARS + 20000) throw noteError("note source is too large");
      try { raw = JSON.parse(raw); } catch { throw noteError("note source must be JSON"); }
    }
    if (raw && typeof raw === "object" && raw.note && typeof raw.note === "object" && !Array.isArray(raw.note)) raw = raw.note;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw noteError("note must be an object");
    const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : Array.isArray(raw.content) ? raw.content : typeof raw.body === "string" ? [raw.body] : typeof raw.markdown === "string" ? [raw.markdown] : [];
    const blocks = rawBlocks.slice(0, MAX_BLOCKS).map(normalizeBlock);
    let title = text(raw.title ?? raw.name ?? raw.heading, 120, { multiline:false });
    if (!title) {
      const heading = blocks.find(block => block.type === "markdown" && /^#{1,3}\s+\S/.test(block.text));
      if (heading) title = text(heading.text.split("\n")[0].replace(/^#{1,3}\s+/, ""), 120, { multiline:false });
    }
    if (!title) throw noteError("title is required: a short specific name used to search for this card");
    const summary = text(raw.summary ?? raw.description, 400), subtitle = text(raw.subtitle, 200, { multiline:false });
    if (!blocks.length && summary) blocks.push({ type:"markdown", text:summary });
    if (!blocks.length) throw noteError("blocks must contain 1 to 24 content blocks");
    const language = raw.language === "zh" || raw.language === "en" ? raw.language : hasCjk(`${title}${summary}${subtitle}`) ? "zh" : options.language === "zh" ? "zh" : "en";
    const category = normalizeCategory(raw.category, { categories:options.categories || CATEGORIES, language });
    const styleName = String(raw.style || raw.variant || raw.look || "").toLowerCase(),
      style = STYLES.includes(styleName) ? styleName : /^(knowledge|knowledge[-_ ]?card|study|flashcard)$/.test(styleName) ? "card" : /^(work|memo|meeting|plain)$/.test(styleName) ? "note"
        : (categoryById(category?.id, options.categories || CATEGORIES) || categoryById(category?.id))?.style || "card";
    const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : typeof raw.tags === "string" ? raw.tags.split(/[,，#\s]+/) : [])
      .map(tag => text(String(tag ?? "").replace(/^#+/, ""), 24, { multiline:false })).filter(Boolean))].slice(0, 8);
    const mediaChars = blocks.reduce((sum, block) => sum + (block.src?.startsWith("data:") ? block.src.length : 0), 0);
    if (mediaChars > MAX_MEDIA_CHARS) throw noteError(`inline images use ${mediaChars} characters; keep them under ${MAX_MEDIA_CHARS}`);
    const sourceKind = String(raw.source?.kind ?? raw.source ?? "").toLowerCase(),
      created = timeValue(raw.created ?? raw.createdAt), updated = timeValue(raw.updated ?? raw.updatedAt),
      accent = hexColor(raw.accent);
    return {
      version:VERSION,
      title,
      ...(subtitle ? { subtitle } : {}),
      style,
      ...(category ? { category, categorySource:CATEGORY_SOURCES.includes(raw.categorySource) ? raw.categorySource : "model" } : {}),
      ...(tags.length ? { tags } : {}),
      ...(summary ? { summary } : {}),
      ...(raw.bookmarked === true || raw.favorite === true || raw.starred === true ? { bookmarked:true } : {}),
      ...(raw.styleChosen === true ? { styleChosen:true } : {}),
      ...(typeof raw.libraryId === "string" && /^[^\u0000-\u001f\u007f]{1,240}$/.test(raw.libraryId) ? { libraryId:raw.libraryId } : {}),
      ...(accent ? { accent } : {}),
      language,
      ...(SOURCE_KINDS.includes(sourceKind) ? { source:{ kind:sourceKind } } : {}),
      ...(created ? { created } : {}),
      ...(updated ? { updated } : {}),
      blocks,
    };
  }
  function validate(value, options) {
    try { return { ok:true, note:normalize(value, options) }; }
    catch (error) { return { ok:false, error:String(error?.message || error) }; }
  }
  function formatSource(value, options) {
    const note = normalize(value, options), source = JSON.stringify(note, null, 2);
    if (source.length > MAX_SOURCE_CHARS) throw noteError(`note source exceeds ${MAX_SOURCE_CHARS} characters; shrink images or text`);
    return source;
  }
  function parseSource(value, options) { return normalize(value, options); }
  function isNoteFormat(value) { return String(value || "").trim().toLowerCase() === FORMAT; }

  // ---------- Rendering ----------
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
  }
  function mix(hex, other, amount) {
    const a = hexColor(hex) || "#475569", b = hexColor(other) || "#ffffff",
      channel = (color, index) => parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
    return `#${[0, 1, 2].map(index => Math.round(channel(a, index) * (1 - amount) + channel(b, index) * amount).toString(16).padStart(2, "0")).join("")}`;
  }
  function copy(language) {
    return language === "zh"
      ? { card:"知识卡片", note:"笔记", reveal:"显示答案", hide:"隐藏答案", ink:"手写原稿", inkMissing:"手写原稿将在这里显示", graph:"函数图像", answer:"答", question:"问", points:"要点", empty:"空白卡片", page:"PenEcho" }
      : { card:"Knowledge card", note:"Note", reveal:"Show answer", hide:"Hide answer", ink:"Original handwriting", inkMissing:"Original handwriting appears here", graph:"Graph", answer:"A", question:"Q", points:"Key points", empty:"Empty card", page:"PenEcho" };
  }
  function formatDate(ms, language) {
    if (!ms) return "";
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return "";
    if (language === "zh") return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  // Math is rendered by the host (MathJax SVG on the Canvas). Without it the
  // LaTeX stays readable as code and the Canvas re-renders once MathJax loads.
  function mathHtml(latex, display, context) {
    let rendered = "";
    if (typeof context.renderMath === "function") {
      try { rendered = String(context.renderMath(latex, display) || ""); } catch { rendered = ""; }
    }
    if (rendered && rendered.length < 40000 && !/<script|\son\w+\s*=|javascript:/i.test(rendered)) { context.math++; return display ? `<div class="nc-math nc-math--display">${rendered}</div>` : `<span class="nc-math">${rendered}</span>`; }
    context.mathPending++;
    return display ? `<div class="nc-math nc-math--display"><code class="nc-tex">${escapeHtml(latex)}</code></div>` : `<code class="nc-tex">${escapeHtml(latex)}</code>`;
  }
  function inlineMarkdown(source, context) {
    const slots = [], hold = html => `\u0000${slots.push(html) - 1}\u0000`;
    let value = String(source || "")
      .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
      .replace(/\\\((.+?)\\\)/g, (_, latex) => hold(mathHtml(latex, false, context)))
      .replace(/\$(?!\s)([^$\n]*?[^$\s\\])\$(?!\d)/g, (_, latex) => hold(mathHtml(latex, false, context)))
      .replace(/\$(\S)\$/g, (_, latex) => hold(mathHtml(latex, false, context)));
    value = escapeHtml(value)
      .replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,1000})\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
    return value.replace(/\u0000(\d+)\u0000/g, (_, index) => slots[Number(index)] || "");
  }
  // A small, safe Markdown subset: headings, lists, task lists, quotes, code
  // fences, rules, display math, simple tables and paragraphs.
  function markdownToHtml(source, context = { math:0, mathPending:0 }) {
    const lines = String(source || "").split("\n"), out = [];
    let paragraph = [], list = null;
    const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${paragraph.map(line => inlineMarkdown(line, context)).join("<br>")}</p>`); paragraph = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}${list.task ? ' class="nc-tasks"' : ""}>${list.items.join("")}</${list.tag}>`); list = null; } };
    const flush = () => { flushParagraph(); flushList(); };
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        flush();
        const language = line.trim().slice(3).trim(), code = [];
        while (++index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index]);
        out.push(`<pre class="nc-pre"${language ? ` data-language="${escapeHtml(language.slice(0, 24))}"` : ""}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*\$\$/.test(line)) {
        flush();
        let latex = line.trim().replace(/^\$\$/, "");
        if (latex.endsWith("$$") && latex.length > 2) latex = latex.slice(0, -2);
        else { const more = []; while (++index < lines.length && !/\$\$\s*$/.test(lines[index])) more.push(lines[index]); if (index < lines.length) more.push(lines[index].replace(/\$\$\s*$/, "")); latex = [latex, ...more].join("\n"); }
        if (latex.trim()) out.push(mathHtml(latex.trim(), true, context));
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) { flush(); const level = Math.min(4, heading[1].length + 1); out.push(`<h${level}>${inlineMarkdown(heading[2], context)}</h${level}>`); continue; }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push("<hr>"); continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flush();
        const rows = [];
        for (; index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index]); index++) rows.push(lines[index].trim().slice(1, -1).split("|").map(cell => cell.trim()));
        index--;
        const separator = rows.length > 1 && rows[1].every(cell => /^:?-{2,}:?$/.test(cell)), body = separator ? [rows[0], ...rows.slice(2)] : rows;
        out.push(`<table>${body.slice(0, 13).map((row, rowIndex) => `<tr>${row.slice(0, 6).map(cell => rowIndex === 0 && separator ? `<th>${inlineMarkdown(cell, context)}</th>` : `<td>${inlineMarkdown(cell, context)}</td>`).join("")}</tr>`).join("")}</table>`);
        continue;
      }
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) { flush(); out.push(`<blockquote>${inlineMarkdown(quote[1], context)}</blockquote>`); continue; }
      const item = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        flushParagraph();
        const tag = /\d/.test(item[2]) ? "ol" : "ul", task = /^\[( |x|X)\]\s+/.exec(item[3]);
        if (!list || list.tag !== tag) { flushList(); list = { tag, items:[], task:false }; }
        const indent = item[1].length >= 2 ? ' class="nc-indent"' : "";
        if (task) { list.task = true; list.items.push(`<li${indent}><span class="nc-box${/x/i.test(task[1]) ? " is-done" : ""}" aria-hidden="true"></span><span${/x/i.test(task[1]) ? ' class="nc-done"' : ""}>${inlineMarkdown(item[3].slice(task[0].length), context)}</span></li>`); }
        else list.items.push(`<li${indent}>${inlineMarkdown(item[3], context)}</li>`);
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      flushList();
      paragraph.push(line.trim());
    }
    flush();
    return out.join("");
  }

  function graphMathEngine(context) {
    if (context.graphMath) return context.graphMath;
    try {
      const runtime = root?.PENECHO_SMART_SUGGEST || (typeof require === "function" ? require("./smart-suggest.js") : null);
      context.graphMath = runtime?.createGraphMath ? { math:runtime.createGraphMath(), runtime } : null;
    } catch { context.graphMath = null; }
    return context.graphMath;
  }
  // Static SVG plot of explicit curves (y = f(x) or x = f(y)), sampled locally
  // with PenEcho's eval-free math parser.
  function graphSvg(block, accent, context) {
    const engine = graphMathEngine(context);
    if (!engine) return "";
    const W = 780, H = 380, pad = { l:46, r:18, t:18, b:34 }, params = block.parameters || {},
      palette = [accent, "#e11d48", "#0891b2", "#ca8a04"], rows = [];
    for (const expression of block.expressions) {
      try {
        const equation = engine.math.equation(expression, "2d");
        if (equation.kind === "explicit" && (equation.axis === "y" || equation.axis === "x")) rows.push({ expression, axis:equation.axis, fn:equation.fn });
      } catch {}
    }
    if (!rows.length) return "";
    const first = rows.find(row => row.axis === "y") || rows[0],
      evaluate = value => first.axis === "y" ? first.fn(value, 0, params, 0) : first.fn(0, value, params, 0),
      auto = engine.runtime.graphXWindow ? engine.runtime.graphXWindow(evaluate) : { xMin:-10, xMax:10 },
      xMin = block.xMin ?? auto.xMin, xMax = block.xMax ?? auto.xMax, samples = 360, curves = [], values = [];
    for (const row of rows) {
      const points = [];
      for (let index = 0; index <= samples; index++) {
        const t = xMin + (xMax - xMin) * index / samples;
        let v;
        try { v = row.axis === "y" ? row.fn(t, 0, params, 0) : row.fn(0, t, params, 0); } catch { v = NaN; }
        points.push(Number.isFinite(v) ? v : NaN);
        if (Number.isFinite(v) && row.axis === "y") values.push(v);
      }
      curves.push({ row, points });
    }
    const windowY = engine.runtime.graphYWindow ? engine.runtime.graphYWindow(values, xMax - xMin) : { lo:-6, hi:6 },
      yMin = block.yMin ?? windowY.lo, yMax = block.yMax ?? windowY.hi,
      sx = x => pad.l + (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r), sy = y => pad.t + (yMax - y) / (yMax - yMin) * (H - pad.t - pad.b),
      step = span => { const raw = span / 8, power = 10 ** Math.floor(Math.log10(raw)), unit = [1, 2, 5, 10].find(m => m * power >= raw) * power; return unit; },
      fmt = value => Math.abs(value) < 1e-9 ? "0" : Math.abs(value) >= 1000 || Math.abs(value) < 0.01 ? value.toExponential(0) : String(Number(value.toFixed(2)));
    const grid = [], labels = [], dx = step(xMax - xMin), dy = step(yMax - yMin);
    for (let x = Math.ceil(xMin / dx) * dx; x <= xMax + 1e-9; x += dx) { grid.push(`<line x1="${sx(x).toFixed(1)}" y1="${pad.t}" x2="${sx(x).toFixed(1)}" y2="${H - pad.b}"/>`); labels.push(`<text x="${sx(x).toFixed(1)}" y="${H - pad.b + 22}" text-anchor="middle">${fmt(x)}</text>`); }
    for (let y = Math.ceil(yMin / dy) * dy; y <= yMax + 1e-9; y += dy) { grid.push(`<line x1="${pad.l}" y1="${sy(y).toFixed(1)}" x2="${W - pad.r}" y2="${sy(y).toFixed(1)}"/>`); labels.push(`<text x="${pad.l - 8}" y="${(sy(y) + 5).toFixed(1)}" text-anchor="end">${fmt(y)}</text>`); }
    const axes = [];
    if (xMin <= 0 && xMax >= 0) axes.push(`<line x1="${sx(0).toFixed(1)}" y1="${pad.t}" x2="${sx(0).toFixed(1)}" y2="${H - pad.b}"/>`);
    if (yMin <= 0 && yMax >= 0) axes.push(`<line x1="${pad.l}" y1="${sy(0).toFixed(1)}" x2="${W - pad.r}" y2="${sy(0).toFixed(1)}"/>`);
    const paths = curves.map(({ row, points }, curveIndex) => {
      let d = "", pen = false, previous = null;
      points.forEach((v, index) => {
        const t = xMin + (xMax - xMin) * index / samples;
        if (!Number.isFinite(v)) { pen = false; previous = null; return; }
        const [px, py] = row.axis === "y" ? [sx(t), sy(v)] : [sx(v), sy(t)];
        if (Math.abs(py) > H * 4 || Math.abs(px) > W * 4 || previous && Math.abs(py - previous) > H * 1.2) { pen = false; previous = row.axis === "y" ? py : null; return; }
        d += `${pen ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
        pen = true; previous = row.axis === "y" ? py : null;
      });
      return d ? `<path d="${d}" stroke="${palette[curveIndex % palette.length]}"/>` : "";
    }).join("");
    const legend = rows.map((row, index) => `<span><i style="background:${palette[index % palette.length]}"></i>${escapeHtml(row.expression)}</span>`).join("");
    return `<svg class="nc-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(rows.map(row => row.expression).join(", "))}"><defs><clipPath id="nc-clip-${context.graphs}"><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/></clipPath></defs><g class="nc-grid">${grid.join("")}</g><g class="nc-axes">${axes.join("")}</g><g class="nc-ticks">${labels.join("")}</g><g class="nc-curves" clip-path="url(#nc-clip-${context.graphs++})">${paths}</g></svg><div class="nc-legend">${legend}</div>`;
  }

  function blockHtml(block, context) {
    const words = context.words, caption = block.caption ? `<figcaption>${inlineMarkdown(block.caption, context)}</figcaption>` : "";
    switch (block.type) {
      case "markdown": return `<section class="nc-block nc-md">${markdownToHtml(block.text, context)}</section>`;
      case "formula": return `<figure class="nc-block nc-formula">${mathHtml(block.latex, true, context)}${caption}</figure>`;
      case "ink": {
        const ratio = block.w && block.h ? ` style="aspect-ratio:${block.w}/${block.h}"` : "";
        return block.src
          ? `<figure class="nc-block nc-ink"><div class="nc-ink-sheet"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || words.ink)}"${ratio}></div><figcaption><span aria-hidden="true">✎</span> ${block.caption ? inlineMarkdown(block.caption, context) : escapeHtml(words.ink)}</figcaption></figure>`
          : `<figure class="nc-block nc-ink is-missing"><div class="nc-ink-sheet">${escapeHtml(words.inkMissing)}</div></figure>`;
      }
      case "image": {
        const ratio = block.w && block.h ? ` style="aspect-ratio:${block.w}/${block.h}"` : "";
        return `<figure class="nc-block nc-image"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}"${ratio}>${caption}</figure>`;
      }
      case "graph": {
        const svg = graphSvg(block, context.accent, context);
        return `<figure class="nc-block nc-graph">${svg || `<div class="nc-graph-fallback">${block.expressions.map(expression => `<code>${escapeHtml(expression)}</code>`).join("")}</div>`}${caption}</figure>`;
      }
      case "keypoints": return `<section class="nc-block nc-points">${block.title ? `<h3>${inlineMarkdown(block.title, context)}</h3>` : ""}<ol>${block.items.map((item, index) => `<li><b class="nc-num" aria-hidden="true">${index + 1}</b><span>${inlineMarkdown(item, context)}</span></li>`).join("")}</ol></section>`;
      case "callout": return `<aside class="nc-block nc-callout nc-tone-${block.tone}">${block.title ? `<strong class="nc-callout-title">${inlineMarkdown(block.title, context)}</strong>` : ""}<div>${markdownToHtml(block.text, context)}</div></aside>`;
      case "qa": {
        const id = `nc-qa-${context.qa++}`;
        return `<section class="nc-block nc-qa"><input type="checkbox" id="${id}" class="nc-qa-toggle"${context.review ? " checked" : ""}><label for="${id}" class="nc-qa-front"><span class="nc-qa-badge">${escapeHtml(words.question)}</span><span class="nc-qa-text">${inlineMarkdown(block.question, context)}</span><span class="nc-qa-hint" data-show="${escapeHtml(words.reveal)}" data-hide="${escapeHtml(words.hide)}"></span></label><div class="nc-qa-back"><span class="nc-qa-badge">${escapeHtml(words.answer)}</span><div class="nc-qa-text">${markdownToHtml(block.answer, context)}</div></div></section>`;
      }
      case "checklist": return `<ul class="nc-block nc-check">${block.items.map((item, index) => { const id = `nc-check-${context.checks++}-${index}`; return `<li><input type="checkbox" class="nc-sr" id="${id}"${item.done ? " checked" : ""}><label for="${id}"><span class="nc-box" aria-hidden="true"></span><span class="nc-check-text">${inlineMarkdown(item.text, context)}</span></label></li>`; }).join("")}</ul>`;
      case "code": return `<pre class="nc-block nc-code"${block.language ? ` data-language="${escapeHtml(block.language)}"` : ""}><code>${escapeHtml(block.text)}</code></pre>`;
      case "quote": return `<blockquote class="nc-block nc-quote"><p>${inlineMarkdown(block.text, context)}</p>${block.source ? `<cite>${escapeHtml(block.source)}</cite>` : ""}</blockquote>`;
      case "table": return `<div class="nc-block nc-table"><table>${block.rows.map((row, index) => `<tr>${row.map(cell => index === 0 && block.header ? `<th>${inlineMarkdown(cell, context)}</th>` : `<td>${inlineMarkdown(cell, context)}</td>`).join("")}</tr>`).join("")}</table></div>`;
      default: return `<hr class="nc-block nc-divider">`;
    }
  }

  const STYLE = `
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{color-scheme:light}
.nc{--ink:#1d2330;--muted:#6b7280;--line:#ebe8e2;--paper-end:#fdfcfa;position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;border-radius:36px;font:400 24px/1.55 Inter,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;background:#fdfcfa}
.nc--card{background:#fdfcfa}
.nc--card::before{content:"";position:absolute;left:0;right:0;top:0;height:8px;background:var(--accent);z-index:1;pointer-events:none}
.nc--note{--paper-end:#ffffff;background:#fff;border-radius:30px}
.nc--note::before{content:"";position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--accent);z-index:1;pointer-events:none}
.nc-head{position:relative;padding:50px 64px 16px;flex:none}
.nc--note .nc-head{padding:44px 60px 18px 74px}
.nc-kicker{display:flex;align-items:center;gap:14px;min-height:40px;font-size:18px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:650}
.nc-chip{display:inline-flex;align-items:center;gap:8px;padding:5px 15px 5px 11px;border-radius:999px;background:transparent;box-shadow:inset 0 0 0 1.5px var(--accent-line);color:var(--accent-deep);letter-spacing:.04em;text-transform:none;font-size:19px;font-weight:700}
.nc-chip i{font-style:normal;font-size:20px}
.nc-kind{margin-left:auto}
.nc--note .nc-kind{margin-left:0}
.nc-date{display:flex;align-items:baseline;gap:12px;margin-left:auto;text-transform:none;letter-spacing:0}
.nc-date b{font-size:44px;line-height:1;color:var(--ink);font-weight:750;font-variant-numeric:tabular-nums}
.nc-title{margin:20px 0 0;font:700 50px/1.12 "Iowan Old Style","Palatino Linotype","Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif;letter-spacing:-.012em;overflow-wrap:anywhere}
.nc--note .nc-title{font:750 46px/1.15 Inter,"SF Pro Display","PingFang SC","Microsoft YaHei",system-ui,sans-serif;letter-spacing:-.018em}
.nc-scroll{position:relative;flex:1;min-height:0;display:flex}
.nc-scroll::after{content:"";position:absolute;left:0;right:12px;bottom:0;height:44px;background:linear-gradient(180deg,rgba(255,255,255,0),var(--paper-end));pointer-events:none}
.nc-body{position:relative;flex:1;min-height:0;overflow:auto;padding:22px 64px 40px;display:flex;flex-direction:column;gap:24px;scrollbar-width:thin;scrollbar-color:var(--accent-line) transparent}
.nc--note .nc-body{padding:26px 60px 34px 74px}
.nc-block{margin:0;flex:none}
.nc-md p{margin:0 0 .55em}.nc-md p:last-child{margin-bottom:0}
.nc-md h2,.nc-md h3,.nc-md h4{margin:.2em 0 .35em;line-height:1.25;font-size:30px}.nc-md h3{font-size:27px}.nc-md h4{font-size:24px;color:var(--accent-deep)}
.nc-md ul,.nc-md ol{margin:0 0 .4em;padding-left:1.25em}.nc-md li{margin:.18em 0}.nc-md li.nc-indent{margin-left:1.2em}
.nc-md li::marker{color:var(--accent)}
.nc-tasks{list-style:none;padding-left:0!important}.nc-tasks li{display:flex;gap:12px;align-items:flex-start}
.nc-box{flex:none;width:26px;height:26px;margin-top:5px;border:2.5px solid var(--accent);border-radius:8px}.nc-box.is-done{background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 12.5 4.2 4.2L19 7' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat}
.nc-done{color:var(--muted);text-decoration:line-through}
.nc-md blockquote,.nc-callout blockquote{margin:0 0 .5em;padding-left:18px;border-left:4px solid var(--accent-line);color:#3f4655}
.nc-md hr{border:0;border-top:2px dashed var(--line);margin:.6em 0}
.nc-md table,.nc-table table{border-collapse:collapse;width:100%;font-size:21px;background:#fff}.nc-md th,.nc-md td,.nc-table th,.nc-table td{border:1.5px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}.nc-md th,.nc-table th{background:var(--accent-soft);color:var(--accent-deep)}
.nc a{color:var(--accent-deep);text-decoration-thickness:2px;text-underline-offset:3px}
.nc code{font:500 .86em/1.4 "SF Mono","JetBrains Mono",Menlo,Consolas,monospace;background:rgba(15,23,42,.06);padding:.08em .32em;border-radius:6px}
.nc mark{background:var(--accent-soft);color:inherit;border-radius:4px;padding:0 .12em}
.nc-math svg{max-width:100%;height:auto;vertical-align:middle}.nc-math--display{text-align:center;margin:.2em 0;overflow-x:auto;overflow-y:hidden}
.nc-tex{white-space:pre-wrap}
.nc-formula{padding:30px 30px 24px;border-radius:18px;background:#fff;border-left:6px solid var(--accent);text-align:center;font-size:30px;box-shadow:inset 0 0 0 1.5px var(--line)}
.nc--note .nc-formula{background:#f8fafc;box-shadow:inset 0 0 0 1.5px #e6ebf2}
.nc-formula .nc-math--display svg{max-height:340px}
figcaption{margin-top:12px;color:var(--muted);font-size:19px;line-height:1.4}
.nc-ink{padding:0}.nc-ink-sheet{display:flex;align-items:center;justify-content:center;padding:18px;border-radius:22px;background:#fff;box-shadow:0 0 0 1.5px var(--line);min-height:120px;color:var(--muted);font-size:20px}
.nc-ink img,.nc-image img{display:block;max-width:100%;max-height:560px;width:auto;height:auto;object-fit:contain;margin:0 auto}
.nc-ink figcaption{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.nc-image img{border-radius:20px;box-shadow:0 0 0 1.5px var(--line)}
.nc-ink img[role="button"],.nc-image img[role="button"]{cursor:zoom-in}
.nc-ink img:focus-visible,.nc-image img:focus-visible{outline:4px solid var(--accent);outline-offset:6px}
.nc-graph{padding:18px 18px 14px;border-radius:24px;background:#fff;box-shadow:0 0 0 1.5px var(--line)}
.nc-plot{display:block;width:100%;height:auto;font:500 15px Inter,system-ui,sans-serif;fill:#64748b}.nc-grid line{stroke:#eef1f6;stroke-width:1}.nc-axes line{stroke:#64748b;stroke-width:1.6}.nc-curves path{fill:none;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round}
.nc-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px;font:500 18px/1.3 "SF Mono",Menlo,Consolas,monospace;color:#334155}.nc-legend i{display:inline-block;width:18px;height:5px;border-radius:5px;margin-right:8px;vertical-align:middle}
.nc-graph-fallback{display:flex;flex-direction:column;gap:8px;align-items:center;padding:20px;font-size:24px}
.nc-points h3{margin:0 0 12px;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-deep)}
.nc-points ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.nc-points li{display:flex;gap:16px;align-items:flex-start}
.nc-num{flex:none;width:40px;height:40px;margin-top:1px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;color:var(--accent-deep);box-shadow:inset 0 0 0 2px var(--accent);font-weight:750;font-size:20px;line-height:1}
.nc-callout{--tone:var(--accent);--wash:var(--accent-soft);padding:20px 24px;border-radius:20px;background:var(--wash);border-left:7px solid var(--tone)}
.nc-callout .nc-md,.nc-callout p{margin:0}
.nc-callout-title{display:block;margin-bottom:6px;font-size:19px;letter-spacing:.07em;text-transform:uppercase;color:var(--tone)}
.nc-tone-definition{--tone:#7c3aed;--wash:#f3eefe}.nc-tone-tip{--tone:#059669;--wash:#e9f8f2}.nc-tone-warning{--tone:#d97706;--wash:#fdf4e7}.nc-tone-example{--tone:#0284c7;--wash:#e8f4fb}.nc-tone-question{--tone:#db2777;--wash:#fcebf3}
.nc-qa{position:relative;border-radius:22px;background:#fff;box-shadow:0 0 0 1.5px var(--line),0 14px 30px -24px rgba(17,24,39,.4);overflow:hidden}
.nc-qa-toggle{position:absolute;opacity:0;pointer-events:none}
.nc-qa-front,.nc-qa-back{display:flex;gap:16px;align-items:flex-start;padding:20px 24px}
.nc-qa-front{cursor:pointer;flex-wrap:wrap}
.nc-qa-badge{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;background:var(--accent);color:#fff}
.nc-qa-back .nc-qa-badge{background:#0f766e}
.nc-qa-text{flex:1;min-width:0}.nc-qa-text p{margin:0}
.nc-qa-hint{flex-basis:100%;padding-left:56px;font-size:18px;color:var(--accent-deep);font-weight:650}
.nc-qa-hint::before{content:"↻ " attr(data-show)}
.nc-qa-back{display:none;border-top:2px dashed var(--line);background:#f7f6f3}
.nc-qa-toggle:checked~.nc-qa-back{display:flex}
.nc-qa-toggle:checked~.nc-qa-front .nc-qa-hint::before{content:"↺ " attr(data-hide)}
.nc-check{list-style:none;padding:0;display:flex;flex-direction:column;gap:12px}
.nc-sr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.nc-check li{position:relative}
.nc-check label{display:flex;gap:14px;align-items:flex-start;cursor:pointer}
.nc-check .nc-box{width:30px;height:30px;margin-top:3px;background:#fff}
.nc-check input:checked+label .nc-box{background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 12.5 4.2 4.2L19 7' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat}
.nc-check input:checked+label .nc-check-text{color:var(--muted);text-decoration:line-through}
.nc-code{margin:0;padding:22px 24px;border-radius:20px;background:#0f172a;color:#e2e8f0;font:500 19px/1.55 "SF Mono","JetBrains Mono",Menlo,Consolas,monospace;overflow:auto;white-space:pre}
.nc-code code{background:none;padding:0;color:inherit;font:inherit}
.nc-code[data-language]::before{content:attr(data-language);display:block;margin-bottom:10px;font-size:15px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8}
.nc-pre{margin:0;padding:16px 20px;border-radius:16px;background:#0f172a;color:#e2e8f0;overflow:auto;font-size:18px}.nc-pre code{background:none;color:inherit}
.nc-quote{margin:0;padding:6px 0 6px 26px;border-left:5px solid var(--accent);font:italic 500 28px/1.45 "Iowan Old Style","Songti SC","Noto Serif SC",Georgia,serif;color:#2b3140}
.nc-quote p{margin:0}.nc-quote cite{display:block;margin-top:10px;font:normal 600 19px Inter,system-ui,sans-serif;color:var(--muted)}
.nc-divider{border:0;height:0;border-top:2.5px dotted var(--accent-line);margin:2px 0}
.nc-empty{margin:auto;color:var(--muted)}
.nc-foot{position:relative;flex:none;display:flex;align-items:center;gap:16px;padding:16px 64px 40px;font-size:18px;color:var(--muted);border-top:1.5px solid var(--line);margin:0 34px}
.nc--note .nc-foot{margin:0;padding:16px 60px 30px 74px;border-top:0}
.nc-brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.06em;color:var(--accent-deep)}
.nc-brand i{width:12px;height:12px;border-radius:4px;transform:rotate(45deg);background:var(--accent);display:inline-block}
.nc-tags{flex:1;display:flex;flex-wrap:wrap;gap:6px 12px;justify-content:center;min-width:0;overflow:hidden;max-height:28px}
.nc-tags span{white-space:nowrap}.nc-tags span::before{content:"#";color:var(--accent)}
.nc-stamp{white-space:nowrap}
.nc-ribbon{position:absolute;top:0;right:56px;width:46px;height:70px;background:var(--accent);display:flex;justify-content:center;padding-top:20px;color:#fff;font-size:21px;line-height:1;z-index:2}
.nc-ribbon::after{content:"";position:absolute;left:0;top:70px;width:0;height:0;border-style:solid;border-width:0 23px 12px 23px;border-color:transparent var(--accent) transparent var(--accent)}
.nc--note .nc-ribbon{right:44px}
.nc.is-bookmarked .nc-kicker{padding-right:92px}
.nc--note.is-bookmarked .nc-kicker{padding-right:84px}
`;

  // Review reflows the same document at a readable text size, without scaling
  // a thumbnail or changing the saved card source or its Canvas dimensions.
  const REVIEW_STYLE = `
html.nc-review{zoom:.75}
.nc-review .nc{border-radius:20px}
.nc-review .nc-head{padding:24px 28px 16px}
.nc-review .nc-kicker{flex-wrap:wrap;gap:8px;font-size:16px;letter-spacing:.03em}
.nc-review .nc-chip{font-size:17px;padding:4px 10px}.nc-review .nc-chip i{font-size:18px}
.nc-review .nc-title{font-size:34px;margin-top:14px}
.nc-review .nc-body{padding:16px 28px 28px;gap:20px;overflow-wrap:anywhere}
.nc-review .nc-formula{padding:20px 16px;font-size:26px}
.nc-review .nc-qa-front,.nc-review .nc-qa-back{padding:16px;gap:12px}
.nc-review .nc-qa-hint{padding-left:52px}
.nc-review .nc-foot{padding:12px 16px;margin:0 12px;gap:12px;font-size:14px;flex-wrap:wrap}
.nc-review .nc-tags{max-height:none;overflow:visible}
.nc-review .nc-ribbon{right:24px}
`;

  // Build the card document. `renderMath(latex, display)` returns SVG markup
  // (MathJax on the Canvas); `graphMath` overrides the plot engine.
  function documentFor(value, options = {}) {
    const note = typeof value === "object" && value && Array.isArray(value.blocks) && value.version === VERSION ? value : normalize(value, options),
      language = note.language || options.language || "en", words = copy(language),
      accent = note.accent || note.category?.color || "#2563eb",
      context = { renderMath:options.renderMath, graphMath:options.graphMath, review:options.review === true, words, accent, math:0, mathPending:0, qa:0, checks:0, graphs:0 },
      body = note.blocks.map(block => blockHtml(block, context)).join("") || `<p class="nc-empty">${escapeHtml(words.empty)}</p>`,
      kind = note.style === "note" ? words.note : words.card,
      date = formatDate(note.created || note.updated, language),
      created = note.created ? new Date(note.created) : null,
      chip = note.category ? `<span class="nc-chip"><i aria-hidden="true">${escapeHtml(note.category.icon || "●")}</i>${escapeHtml(note.category.label)}</span>` : "",
      kicker = note.style === "note"
        ? `<div class="nc-kicker">${chip}<span class="nc-kind">${escapeHtml(kind)}</span>${created && Number.isFinite(created.getTime()) ? `<span class="nc-date"><b>${String(created.getDate()).padStart(2, "0")}</b>${escapeHtml(language === "zh" ? `${created.getFullYear()}年${created.getMonth() + 1}月` : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][created.getMonth()]} ${created.getFullYear()}`)}</span>` : ""}</div>`
        : `<div class="nc-kicker">${chip}<span class="nc-kind">${escapeHtml(kind)}</span></div>`,
      vars = `--accent:${accent};--accent-deep:${mix(accent, "#0b1020", 0.28)};--accent-soft:${mix(accent, "#ffffff", 0.9)};--accent-line:${mix(accent, "#ffffff", 0.7)}`;
    return `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : "en"}"${options.review === true ? ' class="nc-review"' : ""}>
<head>
<meta charset="utf-8">
<meta name="penecho-note-card" content="${VERSION}">
<meta name="penecho-note-math" content="${context.mathPending ? "pending" : "ready"}">
<title>${escapeHtml(note.title)}</title>
<style>${STYLE}${options.review === true ? REVIEW_STYLE : ""}</style>
</head>
<body>
<article class="nc nc--${note.style}${note.bookmarked ? " is-bookmarked" : ""}" style="${vars}" data-category="${escapeHtml(note.category?.id || "")}" aria-label="${escapeHtml(note.title)}">
${note.bookmarked ? `<span class="nc-ribbon" aria-label="${language === "zh" ? "已收藏" : "Bookmarked"}">★</span>` : ""}
<header class="nc-head">${kicker}<h1 class="nc-title">${escapeHtml(note.title)}</h1></header>
<div class="nc-scroll"><main class="nc-body">${body}</main></div>
<footer class="nc-foot"><span class="nc-brand"><i aria-hidden="true"></i>${escapeHtml(words.page)}</span><span class="nc-tags">${(note.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</span><span class="nc-stamp">${escapeHtml(date)}</span></footer>
</article>
</body>
</html>`;
  }
  function documentNeedsMath(html) { return /<meta name="penecho-note-math" content="pending">/.test(String(html || "")); }

  // ---------- Building notes from Canvas content ----------
  function stripInline(value) {
    return String(value || "").replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/\*\*|__|~~|==|`/g, "").replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
  }
  function onlyFormula(value) {
    const trimmed = String(value || "").trim(), match = /^\$\$?([^$]+)\$\$?$/.exec(trimmed);
    return match ? match[1].trim() : "";
  }
  // parts: { items:[{kind:"text"|"image"|"graph"|"note"|"widget", y, ...}], ink:{src,w,h,y}, language, now, category, categories }
  function noteFromParts(parts = {}) {
    const language = parts.language === "zh" ? "zh" : "en", now = Number(parts.now) || Date.now(),
      items = [...(parts.items || [])].filter(Boolean);
    if (parts.ink?.src) items.push({ kind:"ink", ...parts.ink });
    items.sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
    const blocks = [], tags = new Set();
    let title = "", category = parts.category || null, style = "";
    const firstText = items.find(item => item.kind === "text" && stripInline(item.text));
    if (firstText) {
      const lines = String(firstText.text).split("\n").map(line => line.trim()).filter(Boolean);
      const heading = stripInline(lines[0].replace(/^#{1,4}\s+/, ""));
      title = heading.slice(0, 80);
      // A short plain heading becomes the title; text with math stays on the card.
      if (lines.length === 1 && !/\$|\\\(/.test(lines[0]) && heading.length <= 80) firstText.usedAsTitle = true;
    }
    for (const item of items) {
      if (blocks.length >= MAX_BLOCKS) break;
      if (item.kind === "text") {
        if (item.usedAsTitle) continue;
        const formula = onlyFormula(item.text);
        blocks.push(formula ? { type:"formula", latex:formula } : { type:"markdown", text:String(item.text).slice(0, 6000) });
      } else if (item.kind === "ink" && item.src) blocks.push({ type:"ink", src:item.src, ...(item.w && item.h ? { w:item.w, h:item.h } : {}) });
      else if (item.kind === "image" && item.src) blocks.push({ type:"image", src:item.src, ...(item.w && item.h ? { w:item.w, h:item.h } : {}), ...(item.alt ? { alt:item.alt } : {}), ...(item.caption ? { caption:item.caption } : {}) });
      else if (item.kind === "graph" && (item.expression || item.expressions?.length)) {
        blocks.push({ type:"graph", expressions:item.expressions?.length ? item.expressions.slice(0, 4) : [item.expression], ...(item.parameters ? { parameters:item.parameters } : {}) });
        if (!title) title = String(item.expressions?.[0] || item.expression).slice(0, 80);
      } else if (item.kind === "note" && item.note) {
        const merged = item.note;
        if (!title) title = merged.title;
        if (!category && merged.category) category = merged.category;
        if (!style) style = merged.style;
        for (const tag of merged.tags || []) tags.add(tag);
        for (const block of merged.blocks || []) if (blocks.length < MAX_BLOCKS) blocks.push(block);
      } else if (item.kind === "widget" && item.src) blocks.push({ type:"image", src:item.src, ...(item.w && item.h ? { w:item.w, h:item.h } : {}), ...(item.title ? { alt:item.title, caption:item.title } : {}) });
    }
    if (!title) title = language === "zh" ? `笔记 · ${formatDate(now, "zh")}` : `Note · ${formatDate(now, "en")}`;
    if (!blocks.length) blocks.push({ type:"markdown", text:title });
    // An instant first guess; PenEchoLLM refines it once it reads the card.
    const guess = category ? null : guessCategory(title, blocks);
    return normalize({ title, style:style || undefined, category:category || guess || undefined, categorySource:category ? "model" : "local", tags:[...tags], blocks, language, source:{ kind:"selection" }, created:now, updated:now }, { categories:parts.categories, language });
  }

  function guessCategory(title, blocks) {
    const words = [title, ...blocks.map(blockText)].join("\n"), lower = words.toLowerCase();
    if (/\[[ xX]\]|\b(?:todo|to-do|action items?)\b|待办|任务/.test(words) || blocks.some(block => block.type === "checklist")) return "todo";
    if (/\b(?:meeting|agenda|attendees|minutes|sync|standup)\b|会议|纪要|议程/.test(lower)) return "meeting";
    if (/\b(?:idea|brainstorm|what if)\b|想法|灵感|点子/.test(lower)) return "idea";
    const textual = blocks.filter(block => block.type === "markdown").map(block => block.text.replace(/\$[^$]*\$/g, "")).join(" ").trim();
    if (blocks.some(block => block.type === "formula" || block.type === "graph") || /\$[^$]+\$|[=^√∫∑]/.test(words) && textual.length < 160) return "formula";
    if (/\b(?:example|solution|solve|exercise|problem)\b|例题|解：|求解/.test(lower)) return "example";
    return "concept";
  }

  // A Canvas reads as a deck: every card on it uses the same size. The first
  // card takes a comfortable height for the current view.
  function cardSize(existing = [], visible = null, canvasSize = 20000) {
    const counts = new Map();
    for (const item of existing) {
      const w = Math.round(Number(item?.w)), h = Math.round(Number(item?.h));
      if (w > 0 && h > 0 && Math.abs(h / w - ASPECT) < 0.02) counts.set(`${w}x${h}`, (counts.get(`${w}x${h}`) || 0) + 1);
    }
    if (counts.size) {
      const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0], [w, h] = key.split("x").map(Number);
      return { w, h };
    }
    const viewH = Number(visible?.h) > 0 ? Number(visible.h) : 2400, viewW = Number(visible?.w) > 0 ? Number(visible.w) : 3200;
    let h = Math.round(Math.min(viewH * 0.66, viewW * 0.42 * ASPECT));
    h = Math.max(400, Math.min(Math.round(canvasSize * 0.3), h));
    h -= h % 4;
    return { w:Math.round(h / ASPECT), h };
  }
  function overlaps(a, b, gap = 0) { return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y; }
  // Beside the source: right, left, below, above; then further along the row.
  function placeBeside(source, size, occupied = [], canvasSize = 20000, gap = null, visible = null) {
    // Match Favorite Widget imports: fit uniformly within 90% of the visible
    // Canvas and use its center when no unobstructed adjacent slot is available.
    const viewport = visible && [visible.x, visible.y, visible.w, visible.h].every(Number.isFinite) && visible.w > 0 && visible.h > 0
      ? { x:visible.x + visible.w * 0.05, y:visible.y + visible.h * 0.05, w:visible.w * 0.9, h:visible.h * 0.9 } : null;
    if (viewport) {
      const scale = Math.min(1, viewport.w / size.w, viewport.h / size.h);
      size = { w:size.w * scale, h:size.h * scale };
    }
    const space = gap ?? Math.max(40, Math.round(size.w * 0.08)),
      clamp = box => ({ ...box, x:Math.max(0, Math.min(canvasSize - box.w, Math.round(box.x))), y:Math.max(0, Math.min(canvasSize - box.h, Math.round(box.y))) }),
      base = source && [source.x, source.y, source.w, source.h].every(Number.isFinite) ? source : { x:canvasSize / 2, y:canvasSize / 2, w:0, h:0 },
      candidates = [];
    for (let step = 0; step < 6; step++) {
      const shift = step * (size.w + space);
      candidates.push({ x:base.x + base.w + space + shift, y:base.y }, { x:base.x - size.w - space - shift, y:base.y }, { x:base.x + shift, y:base.y + base.h + space }, { x:base.x + shift, y:base.y - size.h - space });
    }
    const center = viewport ? clamp({ x:viewport.x + (viewport.w - size.w) / 2, y:viewport.y + (viewport.h - size.h) / 2, ...size }) : null;
    if (viewport) {
      candidates.push(center);
      for (const y of [viewport.y, viewport.y + viewport.h - size.h]) for (const x of [viewport.x, viewport.x + viewport.w - size.w]) candidates.push({ x, y });
    }
    for (const candidate of candidates) {
      const box = clamp({ ...candidate, w:size.w, h:size.h });
      if (viewport && (box.x < viewport.x - 1 || box.y < viewport.y - 1 || box.x + box.w > viewport.x + viewport.w + 1 || box.y + box.h > viewport.y + viewport.h + 1)) continue;
      if (!occupied.some(item => overlaps(box, item, space / 2))) return box;
    }
    return center || clamp({ x:base.x + base.w + space, y:base.y, w:size.w, h:size.h });
  }

  // ---------- Search, PenEchoLLM signals and ranking ----------
  function blockText(block) {
    switch (block.type) {
      case "markdown": case "code": case "quote": case "callout": return [block.title, block.text, block.source].filter(Boolean).join(" ");
      case "formula": return [block.latex, block.caption].filter(Boolean).join(" ");
      case "graph": return [...block.expressions, block.caption].filter(Boolean).join(" ");
      case "keypoints": return [block.title, ...block.items].filter(Boolean).join(" ");
      case "qa": return `${block.question} ${block.answer}`;
      case "checklist": return block.items.map(item => item.text).join(" ");
      case "table": return block.rows.flat().join(" ");
      case "image": case "ink": return [block.alt, block.caption].filter(Boolean).join(" ");
      default: return "";
    }
  }
  function searchText(note) {
    return [note.title, note.subtitle, note.summary, note.category?.label, note.category?.id, ...(note.tags || []), ...(note.blocks || []).map(blockText)].filter(Boolean).join("\n").toLowerCase();
  }
  function digest(note) {
    const value = JSON.stringify(note);
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, "0");
  }
  function queryTokens(query) {
    const value = String(query || "").toLowerCase().normalize("NFKC"), tokens = [];
    for (const word of value.match(/[a-z0-9][a-z0-9+\-'.]*|[㐀-鿿]+/g) || []) {
      if (/[㐀-鿿]/.test(word)) { if (word.length === 1) tokens.push(word); for (let index = 0; index + 1 < word.length; index++) tokens.push(word.slice(index, index + 2)); }
      else tokens.push(word);
    }
    return [...new Set(tokens)].slice(0, 24);
  }
  function textScore(query, note) {
    const tokens = queryTokens(query);
    if (!tokens.length) return 0;
    const fields = [[String(note.title || "").toLowerCase(), 3], [[...(note.tags || []), note.category?.label || "", note.category?.id || ""].join(" ").toLowerCase(), 2], [String(note.summary || "").toLowerCase(), 1.5], [searchText(note), 1]],
      max = fields.reduce((sum, [, weight]) => sum + weight, 0);
    let total = 0;
    for (const token of tokens) {
      let best = 0;
      for (const [field, weight] of fields) {
        if (!field) continue;
        const at = field.indexOf(token);
        if (at < 0) continue;
        const wordStart = at === 0 || /[^a-z0-9]/.test(field[at - 1]);
        best = Math.max(best, weight * (wordStart || /[㐀-鿿]/.test(token) ? 1 : 0.6));
      }
      total += best / max;
    }
    return Math.min(1, total / tokens.length * 1.6);
  }
  // Cloud note-mode context: the user's categories become the category
  // choice; an optional query asks for relevance. Labels are short data only.
  function rankContext(categories = CATEGORIES, { query = "", language = "en" } = {}) {
    const list = [];
    for (const category of categories) {
      const id = String(category?.id || "");
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) || list.some(item => item.id === id)) continue;
      const label = text(categoryLabel(category, language), 32, { multiline:false }).replace(/["<>{}\[\]\\]/g, "");
      if (label) list.push({ id, label });
      if (list.length >= 12) break;
    }
    const cleanQuery = text(query, 160, { multiline:false });
    return { categories:list, ...(cleanQuery ? { query:cleanQuery } : {}) };
  }
  // Complete library snapshots are independent of Canvas documents. No media
  // is removed here; ranking gets a separate, bounded metadata projection.
  function libraryEntry(raw) {
    if (!raw || typeof raw.id !== "string" || !/^[^\u0000-\u001f\u007f]{1,240}$/.test(raw.id)) throw noteError("invalid library id");
    if (raw.saved === false) return {id:raw.id,saved:false,createdAt:timeValue(raw.createdAt) || 1,updatedAt:timeValue(raw.updatedAt) || Date.now()};
    const note = normalize(raw.note, { categories:[...(raw.note?.category ? [raw.note.category] : []), ...CATEGORIES] });
    formatSource(note);
    const entry = { id:raw.id, note, saved:raw.saved !== false, digest:digest(note),
      createdAt:timeValue(raw.createdAt) || note.created || Date.now(), updatedAt:timeValue(raw.updatedAt) || note.updated || Date.now() };
    for (const key of ["documentId", "objectId", "documentTitle"]) if (raw[key]) entry[key] = text(raw[key], key === "documentTitle" ? 160 : 240, { multiline:false });
    if (raw.locator && typeof raw.locator.id === "string" && ["local", "cloud"].includes(raw.locator.location)) entry.locator = { id:text(raw.locator.id, 240), location:raw.locator.location };
    if (raw.box && ["x", "y", "w", "h"].every(key => Number.isFinite(raw.box[key]))) entry.box = Object.fromEntries(["x", "y", "w", "h"].map(key => [key, raw.box[key]]));
    if (typeof raw.thumb === "string" && raw.thumb.length <= 700 * 1024 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw.thumb)) entry.thumb = raw.thumb;
    if (typeof raw.thumbDigest === "string") entry.thumbDigest = raw.thumbDigest.slice(0, 80);
    if (raw.review && Number.isFinite(raw.review.due)) entry.review = { due:raw.review.due, box:Math.max(0, Math.min(10, Number(raw.review.box) || 0)) };
    if (raw.llm && typeof raw.llm === "object" && JSON.stringify(raw.llm).length < 20000) entry.llm = JSON.parse(JSON.stringify(raw.llm));
    if (typeof raw.pendingBookmark === "boolean") entry.pendingBookmark = raw.pendingBookmark;
    if (raw.pendingCategory?.id) entry.pendingCategory = { id:text(raw.pendingCategory.id, 32), source:raw.pendingCategory.source === "user" ? "user" : "penecho-llm" };
    return entry;
  }
  function rankMetadata(entry, now = Date.now()) {
    const note = entry.note;
    return { id:entry.id, title:note.title, ...(note.subtitle ? { subtitle:note.subtitle } : {}),
      summary:note.summary || "", category:note.category?.label || "", tags:note.tags || [], style:note.style,
      bookmarked:Boolean(note.bookmarked), updatedAt:entry.updatedAt || note.updated || 0,
      due:reviewDue(entry, now), blockTypes:[...new Set((note.blocks || []).map(block => block.type))] };
  }
  function rankCandidates(entries, query = "", limit = query ? 64 : 200) {
    const saved = entries.filter(entry => entry.saved !== false && entry.note?.title);
    if(saved.length <= limit)return saved;
    const now = Date.now();
    return saved.map((entry,index)=>({entry,index,textual:query ? textScore(query,entry.note) : 0,recency:recency(entry,now)}))
      .sort((a,b)=>b.textual-a.textual || b.recency-a.recency || Number(Boolean(b.entry.note.bookmarked))-Number(Boolean(a.entry.note.bookmarked)) || a.index-b.index)
      .slice(0,limit).map(item=>item.entry);
  }
  function noulValue(answer) { return Number.isFinite(answer?.noul) ? Math.max(0, Math.min(1, answer.noul)) : undefined; }
  function choiceValue(answer) { return answer?.type === "choice" || answer?.choice ? { choice:String(answer.choice || ""), confidence:Number.isFinite(answer.confidence) ? answer.confidence : Number(answer.probabilities?.[answer.choice]) || 0 } : null; }
  // PenEchoLLM note-mode answers → stored signals.
  function llmSignals(answers, { query = "" } = {}) {
    if (!answers || typeof answers !== "object") return null;
    const kind = choiceValue(answers.kind), category = choiceValue(answers.category);
    const signals = {
      importance:noulValue(answers.importance), complete:noulValue(answers.complete), review:noulValue(answers.review),
      ...(kind && Object.hasOwn(NOTE_KINDS, kind.choice) ? { kind:kind.choice } : {}),
      ...(category && category.choice && category.choice !== "other" ? { category:category.choice, categoryConfidence:category.confidence } : {}),
    };
    const relevance = noulValue(answers.relevance);
    if (relevance !== undefined && query) signals.relevance = { [String(query).trim().toLowerCase()]:relevance };
    return signals;
  }
  function recency(entry, now) {
    const at = Number(entry?.updatedAt || entry?.note?.updated || entry?.createdAt || entry?.note?.created) || 0;
    return at ? Math.exp(-Math.max(0, now - at) / (14 * DAY_MS)) : 0;
  }
  function reviewDue(entry, now) {
    if ((entry?.note?.style || "card") !== "card") return false;
    const due = Number(entry?.review?.due);
    return !Number.isFinite(due) || due <= now;
  }
  // sort: smart (PenEchoLLM-informed), recent, review, title, category.
  function rankNotes(entries = [], { query = "", sort = "smart", now = Date.now(), category = "", tag = "", bookmarked = false, style = "", kind = "" } = {}) {
    const q = String(query || "").trim(), key = q.toLowerCase(), tagKey = String(tag || "").trim().toLowerCase(), out = [];
    for (const entry of entries) {
      const note = entry?.saved === false ? null : entry?.note;
      if (!note?.title) continue;
      if (category && note.category?.id !== category) continue;
      if (tagKey && !(note.tags || []).some(value => value.trim().toLowerCase() === tagKey)) continue;
      if (bookmarked && !note.bookmarked) continue;
      if (style && note.style !== style) continue;
      if (kind && entry.llm?.kind !== kind) continue;
      const llm = entry.llm?.stale ? {} : entry.llm || {}, textual = q ? textScore(q, note) : 0, relevance = q ? llm.relevance?.[key] : undefined;
      if (q && textual <= 0 && !(relevance >= 0.5)) continue;
      const importance = llm.importance ?? 0.5, complete = llm.complete ?? 0.5, due = reviewDue(entry, now),
        base = 0.32 * importance + 0.14 * complete + 0.2 * recency(entry, now) + 0.16 * (note.bookmarked ? 1 : 0) + 0.18 * (due && (llm.review ?? 0.6) >= 0.5 ? 1 : 0),
        score = q ? 0.25 * textual + 0.65 * (relevance ?? textual) + 0.1 * base : llm.priority ?? base;
      out.push({ entry, score, textual, relevance, due });
    }
    const title = item => String(item.entry.note.title || "").toLocaleLowerCase();
    const at = item => Number(item.entry.updatedAt || item.entry.note.updated || item.entry.createdAt || item.entry.note.created) || 0;
    const comparators = {
      recent:(a, b) => at(b) - at(a),
      title:(a, b) => title(a).localeCompare(title(b)),
      category:(a, b) => String(a.entry.note.category?.label || "~").localeCompare(String(b.entry.note.category?.label || "~")) || b.score - a.score,
      review:(a, b) => Number(b.due) - Number(a.due) || (Number(a.entry.review?.due) || 0) - (Number(b.entry.review?.due) || 0) || b.score - a.score,
      smart:(a, b) => b.score - a.score || at(b) - at(a),
    };
    const compare = comparators[sort] || comparators.smart;
    return out.sort((a, b) => compare(a, b) || String(a.entry.id).localeCompare(String(b.entry.id)));
  }
  // The library UI reads bounded pages. Server-side filtering must include
  // notes beyond the pages that the browser has already opened.
  function libraryPage(entries, options = {}) {
    const limit = Number(options.limit ?? 12), offset = Number(options.offset ?? 0),
      query = String(options.query || ""), category = String(options.category || ""), tag = String(options.tag || ""), sort = options.sort || "recent", style = options.style || "";
    if (!Number.isInteger(limit) || limit < 1 || limit > 48 || !Number.isInteger(offset) || offset < 0 || offset > 100000
      || query.length > 160 || category.length > 32 || tag.length > 48 || !["smart", "recent", "review", "category", "title"].includes(sort)
      || ![undefined, false, true, "0", "1"].includes(options.bookmarked)) {
      throw Object.assign(Error("Invalid Notes & Cards page."), { status:400 });
    }
    if (!["", "note", "card"].includes(style) || ![undefined,"0","1"].includes(options.due)) throw Object.assign(Error("Invalid Notes & Cards review page."),{status:400});
    const saved = entries.filter(entry => entry.saved !== false && entry.note?.title), categories = new Map(), tags = new Map(), now = Date.now(), tagKey = tag.trim().toLowerCase();
    let categoryTotal = 0, tagTotal = 0;
    for (const entry of saved) {
      const noteCategory = entry.note.category;
      // Each facet respects the opposite selection while keeping its own
      // alternatives available. Counts are computed before slicing the page.
      if (!category || noteCategory?.id === category) {
        tagTotal++;
        const seenTags = new Set();
        for (const label of entry.note.tags || []) {
          const id = label.trim().toLowerCase();
          if (!id || seenTags.has(id)) continue;
          seenTags.add(id);
          const previous = tags.get(id);
          tags.set(id, { id, label:previous?.label || label, count:(previous?.count || 0) + 1 });
        }
      }
      if (tagKey && !(entry.note.tags || []).some(value => value.trim().toLowerCase() === tagKey)) continue;
      categoryTotal++;
      if (!noteCategory?.id) continue;
      const previous = categories.get(noteCategory.id);
      categories.set(noteCategory.id, { ...noteCategory, count:(previous?.count || 0) + 1 });
    }
    const ranked = rankNotes(saved, { query, category, tag, sort, style, bookmarked:options.bookmarked === true || options.bookmarked === "1", now })
      .filter(item => options.due !== "1" || item.due);
    return { notes:ranked.slice(offset, offset + limit).map(item => item.entry), total:ranked.length, totalSaved:saved.length,
      categories:[...categories.values()], categoryTotal, tags:[...tags.values()].sort((a, b) => a.label.localeCompare(b.label)), tagTotal,
      dueCount:saved.filter(entry => reviewDue(entry, now)).length,
      nextOffset:offset + limit < ranked.length ? offset + limit : null };
  }
  // Leitner review: again → box 0 (10 minutes), good → next box, easy → skip one.
  function nextReview(review = {}, grade = "good", now = Date.now()) {
    const box = Math.max(0, Math.min(REVIEW_INTERVAL_DAYS.length - 1, Number(review?.box) || 0)),
      next = grade === "again" ? 0 : grade === "easy" ? Math.min(REVIEW_INTERVAL_DAYS.length - 1, box + 2) : Math.min(REVIEW_INTERVAL_DAYS.length - 1, box + 1),
      due = next === 0 ? now + 10 * 60000 : now + REVIEW_INTERVAL_DAYS[next] * DAY_MS;
    return { box:next, due, count:(Number(review?.count) || 0) + 1, last:now, grade };
  }

  return Object.freeze({
    FORMAT,
    FRAMEWORK_VERSION,
    LOOK,
    COPY_LABEL,
    VERSION,
    CONTENT,
    ASPECT,
    MAX_SOURCE_CHARS,
    MAX_MEDIA_CHARS,
    MAX_DOCUMENT_CHARS,
    MAX_BLOCKS,
    STYLES,
    BLOCK_TYPES,
    CALLOUT_TONES,
    CATEGORIES,
    CATEGORY_SOURCES,
    NOTE_KINDS,
    NOTE_CONTRACT,
    REVIEW_INTERVAL_DAYS,
    normalize,
    validate,
    formatSource,
    parseSource,
    isNoteFormat,
    documentFor,
    documentNeedsMath,
    markdownToHtml:(source, context) => markdownToHtml(source, { math:0, mathPending:0, ...(context || {}) }),
    normalizeCategory,
    categoryById,
    categoryLabel,
    noteFromParts,
    guessCategory,
    cardSize,
    placeBeside,
    searchText,
    textScore,
    digest,
    rankContext,
    libraryEntry,
    libraryPage,
    rankMetadata,
    rankCandidates,
    llmSignals,
    rankNotes,
    nextReview,
    escapeHtml,
  });
});
