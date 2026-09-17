"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// The registry contains discovery metadata only. Rule bodies are read only by
// an explicit get_guidance(id) call and never appended to another guide.
const visualRulesDirectory = path.join(__dirname, "../canvas-agent/visual-rules");
const BASE_GUIDANCE_IDS = Object.freeze(["visual-explorer", "general-html", "math-2d", "physics-2d", "math-3d"]);
const VISUAL_RULES = Object.freeze(JSON.parse(fs.readFileSync(path.join(visualRulesDirectory, "registry.json"), "utf8")));
for (const [id, rule] of Object.entries(VISUAL_RULES)) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || BASE_GUIDANCE_IDS.includes(id) || !rule || rule.base !== "visual-explorer" || typeof rule.title !== "string" || !rule.title || typeof rule.scope !== "string" || !rule.scope) {
    throw new Error(`Invalid scoped visual rule: ${id}.`);
  }
  Object.freeze(rule);
}
const GUIDANCE_IDS = Object.freeze([...BASE_GUIDANCE_IDS, ...Object.keys(VISUAL_RULES)]);
const VISUAL_RULE_CATALOG = `## On-demand visual rules\nRead only the rule matching the requested visual region with penecho_get_guidance({id}). Each rule applies only to that region in the current artifact; it does not change other regions, future tasks, or the general Visual Explorer defaults. Reuse an unchanged hash, but never carry a rule into an unrelated task. Available rules:\n${Object.entries(VISUAL_RULES).map(([id, rule]) => `- ${id}: ${rule.title}. ${rule.scope}.`).join("\n")}`;
const cache = new Map();
// Keep route selection sourced from the same 1.2.0 contract as visual design.
const visualExplorerContract = fs.readFileSync(path.join(__dirname, "../canvas-agent/visual-explorer-contract.md"), "utf8");
const selectionParagraph = visualExplorerContract.split(/\r?\n\r?\n/).find(paragraph => paragraph.startsWith("Visual Explorer is the default route"));
if (!selectionParagraph) throw new Error("Visual Explorer selection contract is missing.");
const VISUAL_EXPLORER_SELECTION = selectionParagraph.replace('host-native `canvas_create` `type:"plot"`', '`penecho_plot`');
const NATIVE_DRAWING_ROUTING = `Apply the established task routing first. The 10-mark guideline only selects native drawing versus a Widget for standalone new drawing requests; it never replaces a selected Visual Explorer with native marks, even when its illustration needs fewer than 10 strokes. For a simple standalone sketch, at most 10 strokes or primitive marks in total may use penecho_edit_canvas action="draw_ink" for freehand strokes or penecho_draw for native shapes. A few short labels alone do not force a Widget. More complex new figures must use one HTML Widget through penecho_present_widget, composing their shapes and labels together; follow visual-explorer guidance for explanation-first results and general-html for ordinary HTML tools or interaction-first results. Count the whole figure, not each tool call; do not split a complex diagram across batches of native marks and create_text calls to evade this rule. This guideline does not convert existing Canvas objects or Widgets, constrain small edits/annotations to an existing complex figure, change bare function graphs from penecho_plot, or require Canvas output for source-only requests. Explicit user implementation constraints take precedence; if HTML/Widgets are forbidden, do not silently simplify required content or change format—explain any unresolved constraint conflict.`;
const CANVAS_RENDERING_ROUTING = `Choose the rendering tool by the requested result, existing Canvas content and editing needs; a diagram type or chat source language alone does not select HTML. ${VISUAL_EXPLORER_SELECTION} When that route fits, use penecho_present_widget with an internal HTML/CSS/SVG container, including for static visuals. ${NATIVE_DRAWING_ROUTING} Continue to edit existing objects in their current form. When the user requests both a rendered Canvas diagram and Mermaid/PlantUML chat source, provide both and keep them consistent; select the Canvas representation by the task. A chat instruction such as "do not return HTML" does not prohibit an internal Widget container and does not require one. Source-only requests do not require a Canvas artifact. Respect an explicit ban on using HTML/Widgets for implementation. Choose general-html guidance for product UI. Before authoring a Visual Explorer, read penecho_get_guidance({id:"visual-explorer"}) unless its current design contract is already in context; one read provides the complete design requirements. For a large Widget, first create a small coherent usable version, then complete the same artifact with focused source patches. Do not delay the first useful Canvas result to finish every detail. This is not a timed placeholder: the first version must already communicate the main result, and the remaining requested content must still be completed.`;
const ROUTING = `${VISUAL_EXPLORER_SELECTION} Choose by the requested result. New UI pages, product previews, ordinary HTML tools, interaction-first simulations, and live data use general-html; a new page does not automatically use Visual Explorer. Existing Canvas/page edits preserve their current source and style. Bare function graphs use penecho_plot. Load a science supplement only when the requested result needs calibrated mathematical geometry/curves (math-2d), physical simulation (physics-2d), or spatial 3-D mathematics (math-3d). A technical explanation containing formulas, matrices, or complexity notation alone stays in visual-explorer; it does not require a science renderer. Load only the closest needed supplement using penecho_get_guidance({id}). Guidance already read at the same version/hash does not need another read. Do not load science guidance for unrelated work.`;
const DELIVERY = `## Public source and delivery
Create one complete responsive HTML/CSS/SVG document with minimal JavaScript and a concise title using penecho_present_widget. New Widgets use the host available unobscured viewport. Default/page sizing takes its aspect ratio; explicit dimensions and other presets are preferred CSS content dimensions capped independently to the available width and height, not Canvas world coordinates. Read the returned actual viewport. Keep existing working chat-attachment/Data URL uploads through penecho_upload_image. For authorized local files, use the configured client.js --host-id HOST_ID --upload-image FILE --canvas-id CANVAS_ID --document-id DOCUMENT_ID --request-id ID on the agent machine; obtain both target IDs from start_session target:current and keep that exact opted-in document current/open. The server accepts WebP, PNG, JPG/JPEG, GIF, TIFF and AVIF raw files and performs bounded static conversion; HEIC/HEIF depends on its codec. Prefer WebP generally, PNG for lossless text/diagrams/transparency, JPEG for photographs. No client-side converter is needed. Direct MCP source retains its existing bounded PNG/JPEG/WebP Data URL or same-document reference contract; never pass a host path as source. Copy the returned source verbatim into <img src="RETURNED_SOURCE"> or CSS background-image:url("RETURNED_SOURCE"); replace RETURNED_SOURCE with the actual penecho-asset:<sha256> value, never a guessed hash or host path. These document-owned immutable attachments are saved with the Canvas; find existing references in assets/index.json. Use penecho_place_image for a separate Canvas image. The file upload helper reads and encodes local bytes outside model context. Do not patch binary bytes into virtual text files. HTTPS and embedded Data URLs also work; file: paths and penecho-ref object references are not resolved inside Widget HTML. Keep the canonical HTML on stable asset references when patching. Author the HTML root with width:100% and min-width:0, responsive columns with media or container queries, readable normal CSS font sizes, and vertical scrolling for excess content. Never fix the root to a pixel width or use whole-page transform/zoom to squeeze content. Source updates preserve existing artifact geometry. intent:inspect renders the exact requested viewport temporarily without a Canvas object. Keep a stable artifactId when revising. relativeTo must be an artifactId already returned in this session, never an objectId or guessed title; omit it for independent work and let the host place it. Use penecho_list_files and penecho_read_file to discover and read the returned virtual source path; virtual paths are not host filesystem paths. Use penecho_patch_file with that exact path, contentHash and a strict unified diff for existing source edits. Keep major HTML elements, CSS declarations and JavaScript statements on stable separate lines. After initial render and meaningful layout changes, post {type:"penecho-widget-updated"} to the parent, never every frame.
Use penecho_edit_canvas for supported geometry edits with the current baseRevision. Do not add internal creation fields or use tools absent from the advertised schema. Keep ordinary updates capture:false. When pixel evidence is needed, combine presentation with capture:true; use penecho_capture_canvas only for a bounded unresolved visual question. Never claim verification without returned pixels. Preserve artifact identity, placement, user edits, and unread feedback. Finish when the requested answer is complete, readable and usable. After the initial check, edit only for a data/logic error, missing requirement, broken interaction or unreadable essential content. Minor spacing, label shifts and optional polish do not justify another read/patch/capture cycle unless requested.`;

function getFullGuidance(id) {
  if (!GUIDANCE_IDS.includes(id)) throw new RangeError(`Unknown authoring guidance: ${String(id)}.`);
  if (cache.has(id)) return cache.get(id);
  let document;
  if (id === "visual-explorer") {
    const contract = visualExplorerContract;
    const start = contract.indexOf("Do not start from visual decoration.");
    const end = contract.indexOf("## PenEcho Agent source and invocation");
    if (start < 0 || end <= start) throw new Error("Visual Explorer design contract boundaries are missing.");
    document = `# Visual Explorer authoring guidance\n\n${ROUTING}\n\n${CANVAS_RENDERING_ROUTING}\n\n${contract.slice(start, end)}## Final Visual Explorer review\nCheck composition-wide typography against the design contract: font family, scale, weight, line height, and casing must form a coordinated hierarchy. Correct a concrete mismatch found in rendered evidence before delivery; do not skip this design check merely because the document is runnable.\n\n## Technical evidence quality\nState the assumptions beside conditional formulas. Use a worked numerical example or a calibrated chart when comparing quantities; never substitute an arbitrary curve for the claimed mechanism. If a figure is only schematic, label that limit clearly and do not attach quantitative conclusions to its shape.\n\n${DELIVERY}`;
    document += `\n\n${VISUAL_RULE_CATALOG}`;
  } else if (Object.hasOwn(VISUAL_RULES, id)) {
    document = fs.readFileSync(path.join(visualRulesDirectory, `${id}.md`), "utf8");
    if (!document.trim() || Buffer.byteLength(document, "utf8") > 16_000) throw new Error(`Invalid visual rule document: ${id}.`);
  } else if (id === "general-html") {
    const contract = fs.readFileSync(path.join(__dirname, "../canvas-agent/general-html-contract.md"), "utf8");
    const section = (start, end) => {
      const first = contract.indexOf(start), last = end ? contract.indexOf(end, first) : contract.length;
      if (first < 0 || last <= first) throw new Error("General HTML contract boundaries are missing.");
      return contract.slice(first, last).trim();
    };
    const authoring = section("The visible Widget must answer visually.", "## Canvas relationship");
    const relationship = section("Treat the Canvas as an existing document.", "Before adding a standalone Widget");
    const runtime = section("## Runtime safety", "## Refinement");
    document = `# General HTML authoring guidance\n\n${ROUTING}\n\n${CANVAS_RENDERING_ROUTING}\n\n## Authoring contract\nCreate one complete responsive HTML document through penecho_present_widget with a concise title, complete html with inline CSS and necessary JavaScript, a stable artifactId, and optional preferred display dimensions selected for the content. HTML is the canonical source. Do not minify. Keep major HTML elements, CSS declarations, and JavaScript statements on stable separate lines so later source diffs stay small. Use only fields in the public tool schema.\n\n${authoring}\n\n## Canvas relationship\n${relationship}\n\nFor actual product UI pages, preserve the target product's styling, page background, typography, responsive structure, and actual local interactions. Deliver one complete scrollable page as one Widget. Do not wrap a product page in an explanatory infographic. Use default/page sizing for the available viewport or explicit preferred mobile dimensions, never both a preset and dimensions. Use native labeled controls, keyboard access, visible focus, and readable text. Filters, tabs and toggles work locally without model calls. Only explicit AI requests use data-penecho-action and a bounded data-penecho-prompt; label them as requests.\n\n${runtime}\n\nThe host's Widget sandbox and Content Security Policy remain authoritative. Guidance does not enable blocked capabilities or resources; use the allowed public runtime and show a useful fallback when a resource cannot load.\n\n## Refinement\nFor an existing Widget, use penecho_list_files and penecho_read_file to read the exact virtual HTML source covering the requested change. Combine all known edits into one coherent multi-hunk penecho_patch_file patch when practical. Supply the returned contentHash and strict unified-diff headers matching the returned virtual path. Preserve unrelated content, established style and live geometry. Never use physical host paths. Do not publish a timed scaffold or repeatedly re-read after a successful patch. Reuse the returned current hash and source evidence if sufficient; read again only for incomplete source, SOURCE_CONFLICT, or a real patch mismatch. Retry an unknown outcome with identical arguments and requestId; a source conflict needs a fresh read and new requestId. Routine refinements need no intermediate capture; take one final capture only when pixel evidence matters, and another only for a concrete unresolved defect. Fix evidenced defects and stop when complete.\n\n${DELIVERY}`;
  } else {
    // Scientific evidence, markers and verified examples remain byte-for-byte
    // sourced from the same contracts as the built-in authoring path.
    document = fs.readFileSync(path.join(__dirname, `../canvas-agent/visual-skills/${id}.md`), "utf8");
  }
  const hash = crypto.createHash("sha256").update(document).digest("hex");
  const rule = VISUAL_RULES[id];
  const result = Object.freeze({ id, version:"1", hash, document, ...(rule ? { kind:"visual-rule", base:rule.base, scope:rule.scope } : {}) });
  cache.set(id, result);
  return result;
}

function getAuthoringGuidance(id, detail = "brief") {
  const full=getFullGuidance(id);
  if(detail === "full")return full;
  if(detail !== "brief")throw new RangeError("Unknown guidance detail.");
  // The default read must deliver the canonical design contract, not an
  // independent summary that silently weakens visual quality. Loading remains
  // on demand; existing explicit brief callers receive the same requirements.
  if(id === "visual-explorer" || Object.hasOwn(VISUAL_RULES,id))return {...full,detail:"brief",fullHash:full.hash};
  const document = {
    "general-html":"Build the requested real product UI with working local interactions, responsive layout and readable normal CSS type. Use width:100%, min-width:0, media/container queries and vertical scrolling; never shrink a whole page with transform/zoom. Keep source on stable separate lines and reuse uploaded asset references. Preserve geometry when editing.",
    "math-2d":"Use calibrated coordinates and consistent units for mathematical geometry/curves. Load full guidance before implementing unfamiliar renderer APIs; verify formulas, domains, axes and labels.",
    "physics-2d":"Use consistent physical units, bounded time steps and explicit controls. Load full guidance for simulation APIs and examples; verify initial conditions and conservation assumptions.",
    "math-3d":"Use calibrated 3D coordinates with readable axes and camera controls. Load full guidance for renderer contracts/examples; verify geometry and projection.",
  }[id];
  return {id,version:"2",hash:crypto.createHash("sha256").update(document).digest("hex"),detail:"brief",fullHash:full.hash,document};
}

module.exports = { GUIDANCE_IDS, VISUAL_RULES, ROUTING, NATIVE_DRAWING_ROUTING, CANVAS_RENDERING_ROUTING, VISUAL_EXPLORER_SELECTION, getAuthoringGuidance };
