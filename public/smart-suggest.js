"use strict";
// Smart suggestions: pure logic shared by the Canvas client and node tests.
//
// PenEchoLLM is a state-space action selector. This module defines the state
// (compact facts), the closed action space (registry → questions), the policy
// that turns typed answers into 0–2 chips, local shape fitting for snapping,
// and the interactive graph widget used by the Plot suggestion.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SMART_SUGGEST = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2;

  // What the NEW dark ink is. Faded ink in the crop is context only.
  const KINDS = Object.freeze({
    none:"Nothing new worth acting on: unfinished writing, a meaningless scribble, a signature, or clean typeset content with no outstanding task",
    deletion:"A new strike-through or scribble crossing existing content to request its removal, including text inside a widget. An underline, divider or ordinary writing is not a deletion mark",
    math_expr:"A formula, expression or equation in math notation, such as y=f(x), f(x)=…, x²+y²=r², an integral, derivative, limit, sum or matrix",
    math_step:"One new line that continues a multi-line derivation or proof shown faded above it",
    shape:"Geometric shapes, constructions or spatial figures made of lines, curves, boundaries and arrows, without semantic process or entity relationships.",
    diagram:"A semantic structure of steps, participants, components, states, entities or concepts and their relationships: flowchart, workflow, sequence, architecture, state, entity relationship or mind map. Connections express meaning rather than merely geometric shapes.",
    ui_wireframe:"A screen or web page layout: rectangles standing for header, navigation, buttons, inputs, cards or images",
    notes:"Words, bullets or scattered ideas in natural language",
    question:"A question or request addressed to the assistant, written in words or expressed through visual task cues",
    code:"Program code or pseudo-code lines",
    drawing:"A picture of something: an animal, person, object, plant, vehicle or scene (not a diagram, formula or plain geometric shapes)",
  });

  // The closed action space. `kinds` powers the local agreement gate: when
  // PenEchoLLM's independent kind and action answers disagree, nothing is shown.
  const ACTIONS = Object.freeze([
    { id:"refine", kinds:["deletion", "math_expr", "math_step", "shape", "diagram", "ui_wireframe", "notes", "question", "code", "drawing"], threshold:0.5, icon:"refine", label:{ en:"Refine Widget", zh:"修改 Widget" },
      criteria:"Modify the existing target widget in place from new handwritten labels, circles, arrows or replacement sketches. Add missing fields, change text or colors, and preserve unrelated content and controls. Annotation boxes specify edits, not a new UI wireframe.",
      exec:{ type:"widget-refine" }, requires:"widget" },
    { id:"plot", kinds:["math_expr"], threshold:0.5, icon:"plot", label:{ en:"Plot graph", zh:"绘制函数图" },
      criteria:"Graph a mathematical function or coordinate equation as curves or surfaces, including a formula by itself. The function graph is the deliverable, rather than arithmetic evaluation or a general illustration.",
      exec:{ type:"ai", action:"plot", suggestion:"plot", interactivePlot:true } },
    { id:"typeset", kinds:["math_expr", "math_step", "notes", "code"], threshold:0.55, icon:"typeset", label:{ en:"Typeset", zh:"排版" },
      criteria:"Improve only typography, notation or presentation of existing text, code or math. Preserve its meaning; do not calculate, answer, continue work or reorganize ideas.",
      exec:{ type:"typeset" } },
    { id:"solve", kinds:["math_expr"], threshold:0.5, icon:"solve", label:{ en:"Solve", zh:"求解" },
      criteria:"Compute missing mathematical results: solve equations, evaluate calculations or calculus, simplify or factor expressions. A bare unsolved equation or blank equals sign suffices. Written answers call for check_step.",
      exec:{ type:"ai", action:"answer", suggestion:"solve" } },
    { id:"check_step", kinds:["math_expr", "math_step", "notes", "question", "code"], threshold:0.5, icon:"check", label:{ en:"Check", zh:"检查" },
      criteria:"Correctness checking of work already written by the user: supplied answers, completed derivation lines, or written word and character forms. Verify independent numerical answers. Verify that a complete newest derivation line follows from faded earlier equations, even when the overall derivation is unfinished. Verify short vocabulary and handwriting-practice lists for standard spelling and word forms. Correct and incorrect attempts both qualify. Check grammar or code when requested or visibly wrong. Ordinary coherent notes do not automatically request proofreading. An explicit one-line continuation is next_step; missing results are solve. Greetings, thanks, acknowledgements and farewells use answer unless verification or practice is explicit.",
      exec:{ type:"ai", action:"explain", suggestion:"check_step" } },
    { id:"next_step", kinds:["math_step", "math_expr"], threshold:0.55, icon:"next", label:{ en:"Next step", zh:"下一步" },
      criteria:"Give only one following line of a calculation, derivation or proof when requested, even after a complete equation. Also continue an incomplete new derivation line.",
      exec:{ type:"ai", action:"continue", suggestion:"next_step", focus:"new" } },
    { id:"hint", kinds:["math_expr", "math_step", "question"], threshold:0.6, icon:"hint", label:{ en:"Hint", zh:"提示" },
      criteria:"Give a clue or approach for the learner's current problem or attempted work, leaving the result to the learner. Being stuck after trying, asking how to begin, or withholding the answer shows this intent. Do not infer learning from an ordinary completion request.",
      exec:{ type:"ai", action:"hint", suggestion:"hint" } },
    { id:"practice", kinds:["math_expr", "math_step", "notes", "question", "code", "diagram"], threshold:0.55, icon:"practice", label:{ en:"Try a problem", zh:"练一题" },
      criteria:"A request for a new exercise, another similar question or a knowledge test. A conceptual lesson or knowledge notes ready for review can also invite this. Create one new unsolved practice question using the supplied topic or reference example, matching the level. Deliver only the new question, no answer or solution. Ordinary memos are not study material.",
      exec:{ type:"ai", action:"answer", suggestion:"practice" } },
    { id:"snap_shapes", kinds:["shape", "diagram", "ui_wireframe"], threshold:0.45, icon:"shape", label:{ en:"Clean up shapes", zh:"规整图形" },
      criteria:"Geometrically clean rough hand-drawn circles, boxes, triangles, lines or arrows. Unresolved problems and requested answers take priority over shape cleanup.",
      exec:{ type:"snap" }, requires:"shapes" },
    { id:"diagram", kinds:["diagram", "notes", "question", "code"], threshold:0.55, icon:"diagram", label:{ en:"Make diagram", zh:"生成结构图" },
      criteria:"Create a structured flowchart, workflow, sequence, architecture, state, entity relationship or mind map from semantic content. Nodes represent steps, participants, components, states, entities or concepts; connections express their relationships. Preserve labels, relationships, direction and order. Use only when this structured representation is intended, not merely because geometric marks or a picture are present.",
      exec:{ type:"ai", action:"plot", suggestion:"diagram" } },
    { id:"prototype", kinds:["ui_wireframe"], threshold:0.55, icon:"prototype", label:{ en:"Build prototype", zh:"生成原型" },
      criteria:"Turn an existing UI wireframe into a working clickable prototype, preserving layout, labels and component types.",
      exec:{ type:"ai", action:"plot", suggestion:"prototype" } },
    { id:"organize", kinds:["notes"], threshold:0.6, icon:"organize", label:{ en:"Organize notes", zh:"整理笔记" },
      criteria:"Group and reorder scattered existing notes or ideas into a coherent outline. Organize their meaning, rather than merely typography or creating new information.",
      exec:{ type:"ai", action:"answer", suggestion:"organize" } },
    { id:"answer", kinds:["question", "diagram", "shape", "drawing", "math_expr", "math_step", "notes", "code", "ui_wireframe"], threshold:0.55, icon:"answer", label:{ en:"Answer", zh:"回答" },
      criteria:"Respond to greetings, thanks, acknowledgements and farewells as conversation unless a specialized task is explicit. Answer general questions and requests when no specialized action fits. Preserve existing content and respond to its meaning through appropriate text, math or drawing. Conversation and questions alone do not imply learning.",
      exec:{ type:"ai", action:"answer", suggestion:"answer" } },
    { id:"create_visual", kinds:["question", "notes", "diagram", "drawing", "shape", "math_expr", "math_step", "code"], threshold:0.55, icon:"diagram", label:{ en:"Create visual", zh:"生成可视内容" },
      criteria:"Create a new requested visual from words or task cues. The visual itself is the deliverable. Existing content is reference. Function graphs are plot; semantic structured diagrams are diagram; existing sketch rendering is vivid; missing contours are finish_drawing.",
      exec:{ type:"ai", action:"plot", suggestion:"create_visual" } },
    { id:"explain", kinds:["math_expr", "math_step", "code", "diagram"], threshold:0.65, icon:"explain", label:{ en:"Explain", zh:"解释" },
      criteria:"Dense notation, code or a diagram whose meaning a reader would want explained.",
      exec:{ type:"ai", action:"explain", suggestion:"explain" } },
    { id:"animate", kinds:["math_expr", "math_step", "diagram", "question", "shape", "code", "notes", "drawing"], threshold:0.55, icon:"animate", label:{ en:"Explain with animation", zh:"动画讲解" },
      criteria:"Teach how a concept, process, proof, algorithm or system works through timed visual stages, motion or changing quantities, even from words, notation or a conceptual figure. The subject is an idea or problem; making a drawn character or object move is animate_sketch.",
      exec:{ type:"animate", action:"plot", suggestion:"animate" } },
    { id:"finish_drawing", kinds:["drawing", "question"], threshold:0.5, icon:"finish", label:{ en:"Finish drawing", zh:"补全画作" },
      criteria:"Complete missing contours or features of an existing unfinished freehand picture in the same line style and composition. Extend the source in place, rather than creating a separate illustration.",
      exec:{ type:"ai", action:"continue", suggestion:"finish_drawing" } },
    { id:"vivid", kinds:["drawing", "shape"], threshold:0.5, icon:"vivid", label:{ en:"Storybook illustration", zh:"绘本插画" }, styleLabels:{ storybook:{ en:"Storybook illustration", zh:"绘本插画" }, "3d":{ en:"3D illustration", zh:"立体插画" } },
      criteria:"Render an existing recognizable freehand picture as a finished still illustration of the same subject and pose, with a fitting simple background. A finished picture without written instructions invites this. Requested movement is animate_sketch; missing contours are finish_drawing.",
      exec:{ type:"ai", action:"plot", suggestion:"vivid" } },
    // Independent motion intent: PenEchoLLM scores this separately from vivid.
    { id:"animate_sketch", kinds:["drawing", "shape", "question", "notes"], threshold:0.5, icon:"animate_sketch", label:{ en:"Animate sketch", zh:"让画动起来" },
      criteria:"Make the existing drawing itself move: its person, animal, vehicle, plant or object walks, flies, swims, spins, sways, waves or blinks. Movement words, motion lines or a play symbol beside the drawing request this, as do requests to bring it to life.",
      exec:{ type:"ai", action:"plot", suggestion:"animate_sketch" } },
    // Capture a bounded Canvas region; explicit grouping can raise its rank.
    { id:"note", kinds:["notes", "math_expr", "math_step", "diagram", "drawing", "code", "question", "shape", "ui_wireframe"], threshold:0.5, icon:"note", label:{ en:"Organize as Note", zh:"整理为笔记" },
      criteria:"Save large selected notes or enclosed content before typeset/organize. Explicit tasks first; otherwise secondary.",
      exec:{ type:"note" }, requires:"input" },
  ]);
  const ACTION_BY_ID = new Map(ACTIONS.map(action => [action.id, action]));
  const NONE_CRITERIA = "Unfinished or meaningless ink, signatures, or coherent notes and memos without a task or presentation need. Conversation uses answer. Cancellation marks use the independent Delete gesture.";

  // `confident` is the Canvas Suggest highlight threshold: the probability the
  // top action needs before the bar marks it primary. The Agent Suggest tab
  // highlights requests at the same threshold.
  const POLICY = Object.freeze({ maxNone:0.35, minFinished:0.5, secondMin:0.22, moreMin:0.08, maxChips:2, maxMore:3, confident:0.45 });

  const ACTION_INTENT_GUIDANCE = "Honor explicit intent; otherwise choose the most specific useful operation. Missing mathematical results invite solve. Filled-in calculations and worked answers invite correctness checking, including independent items. Greetings, thanks, acknowledgements and farewells address the assistant: use answer unless a specialized task is explicit. Vocabulary or handwriting practice attempts and visible spelling or word-form errors can invite checking. An isolated correct word alone does not establish practice. Check grammar when verification is requested or an error is visible. Ordinary memos and coherent notes do not automatically request checking. A request for one following line uses next_step even when the last written equation is complete. Without that request, check a complete newest derivation line against the faded earlier steps, even if the variable is not yet isolated or the line is wrong; continue an incomplete derivation line. Rough closed geometric shapes can need cleanup without a written request; an open mid-stroke cannot. A learner showing an attempt and being stuck can need a clue without saying hint; keep the work of finding the result with the learner. Do not infer a learning goal from an ordinary request for a finished result. Creating a visual that does not yet exist is create_visual; transforming an existing sketch, cleaning an existing diagram, graphing a mathematical function and finishing missing contours are different operations. Otherwise use general-purpose answer. Input format and renderer do not determine intent. Choose none for unfinished or meaningless content with no clear useful task. Movement of a drawn subject, including bringing a drawing to life, is animate_sketch; illustrating a finished picture, even unrequested, is vivid; teaching an idea through motion is animate. Practice creates a new unsolved exercise; checking already written vocabulary or character forms is check_step.";
  const CONVERSATION_QUESTION = Object.freeze({ type:"noul", instructions:"Probability that the newest content communicates a complete social turn to the assistant: greetings (hello), thanks, praise (good job), acknowledgements (OK, okay, got it), farewells or short social replies, in any language. Return high even without a question mark. Return low for explicit specialized tasks, vocabulary or handwriting exercises, ordinary notes, unfinished writing, preservation enclosures and widget annotations. Judge communicative intent independently of action ranking." });
  const CHECK_APPLICABLE_QUESTION = Object.freeze({ type:"noul", instructions:"Probability that correctness checking is useful for the targeted content. Return high for supplied numerical answers (whether correct or wrong), complete derivation lines, short vocabulary or handwriting-practice lists (including correct word and character forms), an explicit verification request, or visible spelling, word-form, grammar or code errors. A calculation with a written result is an answer to check; a blank result or an equation with no proposed solution needs solving. Return low for greetings, thanks, praise, acknowledgements or farewells without checking/practice context; one correctly formed isolated word or bare alphabet; task lists and ordinary coherent notes; functions to graph; questions seeking information; and requests to create a NEW exercise with no attempt to check. Judge independently of the action ranking." });
  const WIDGET_REFINE_GUIDANCE = "widgetRefine identifies the existing widget overlapped by the new dark marks; its box is in image fractions. Treat circles, arrows and replacement marks as annotations. A boxed label can request adding or changing that field; a color note requests recoloring the widget. Choose refine to apply these edits in place. Do not choose prototype for an annotation box or vivid for a widget color change. Unrelated notes may use another action.";
  // Widget observations and Refine criteria need room within the provider's
  // 1536-token input budget. Ordinary ink retains its full intent policy.
  const WIDGET_ACTION_INTENT_GUIDANCE = "Honor explicit intent. Modify an existing widget with refine; creating a separate result uses another action. Unrelated notes may use the other specialized actions. Choose none when no useful task is clear.";

  // A pause starts a new unit. Earlier Canvas ink is still rendered as faded context.
  function recentStrokeUnit(strokes, gapMs = 8000) {
    if (!strokes.length) return [];
    let first=strokes.length-1;
    while(first>0 && strokes[first].at-strokes[first-1].at<=gapMs && strokes.at(-1).at-strokes[first-1].at<=30000)first--;
    return strokes.slice(first);
  }
  // Test the ink path, not its enclosing rectangle. Sparse segments can cross
  // a widget even when both sampled endpoints lie outside it.
  function strokeTouchesBox(stroke, box) {
    const points = stroke?.points || [], pad = Math.max(0, stroke?.size || 0) / 2;
    const inside = p => p.x >= box.x - pad && p.x <= box.x + box.w + pad && p.y >= box.y - pad && p.y <= box.y + box.h + pad;
    if (points.some(inside)) return true;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      let lo = 0, hi = 1;
      for (const [axis, size] of [["x", "w"], ["y", "h"]]) {
        const delta = b[axis] - a[axis], min = box[axis] - pad, max = box[axis] + box[size] + pad;
        if (!delta) { if (a[axis] < min || a[axis] > max) { hi = -1; break; } }
        else {
          const t0 = (min - a[axis]) / delta, t1 = (max - a[axis]) / delta;
          lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
        }
      }
      if (lo <= hi) return true;
    }
    return false;
  }
  function dismissAction(previous, now) {
    return {count:(previous?.until>now?previous.count:0)+1,until:now+45000};
  }

  function suggestionExecution(id, answers) {
    // The generic legacy verdict belongs only to its recommended action.
    // A missing verdict keeps the immediate local default; clicks never rank again.
    return answers?.[`execution_${id}`] ?? (answers?.action?.choice === id ? answers.execution : null);
  }

  function executionRoute(id, answer, scope = "ink") {
    // Animate sketch rigs the user's own strokes in one Canvas AI response; the
    // caller uses the Agent only when no vector ink can be rigged.
    const fixed = scope === "widget" ? ["fix_error"] : ["animate", "prototype"];
    if (fixed.includes(id)) return "penecho_agent";
    const conditional = scope === "widget" ? ["fix_layout", "apply_marks", "ask"] : ["ask", "answer", "create_visual", "explain", "solve", "practice", "diagram", "organize", "vivid", "finish_drawing"];
    return conditional.includes(id) && answer?.type === "choice" && answer.choice === "penecho_agent" ? "penecho_agent" : "canvas_ai";
  }

  // Refine routing uses existing source facts only. Ranking may offer an action,
  // but no PenEchoLLM verdict is needed to choose its executor at invocation.
  function widgetRefineRoute(widget, { actionId = "apply_marks", instruction = "" } = {}) {
    const format = String(widget?.sourceFormat || "").toLowerCase(),
      framework = String(widget?.frameworkVersion || "").toLowerCase(),
      html = String(widget?.html || "").replace(/<!--[\s\S]*?-->/g, ""),
      agent = (reason, guidance = []) => ({ executor:"penecho_agent", reason, guidance });
    if (["vivid", "animate", "animate_sketch"].includes(actionId)) return agent("widget-variant", [actionId === "vivid" ? "general-html" : "scene"]);
    const guidance = ["architecture", "sequence", "workflow"].filter(id =>
      new RegExp(`<[^>]+\\bdata-(?:penecho-${id}|${id}-source)(?=[\\s=>])`, "i").test(html));
    if (guidance.length) return agent("structured-diagram", guidance);
    if (widget?.widgetType === "diagram_source" || widget?.pluginId === "flowchart"
      || framework.startsWith("penecho-professional-diagrams")
      || ["mermaid", "dot", "bpmn-xml", "vega-lite", "geojson", "smiles", "cytoscape-json", "plantuml", "d2"].includes(format)) return agent("professional-diagram", ["professional-diagram-edit"]);
    if (/^(?:flowchart|process-flow|workflow|sequence(?:-diagram)?|architecture(?:-diagram)?|dependency|bpmn)$/.test(String(widget?.diagramKind || "").toLowerCase())) return agent("diagram-kind", ["general-html"]);
    if (format === "penecho-scene+json") return agent("scene-source", ["scene"]);
    if (format === "penecho-visual-explainer-plan+json") return agent("visual-explainer-source", ["visual-explorer"]);
    // Note cards are edited through their compact note source, never HTML.
    if (format === "penecho-note-card+json") return { executor:"canvas_ai", reason:"note-card-source", guidance:[] };
    if (["fix_error", "add_controls"].includes(actionId)) return agent("complex-action", ["general-html"]);
    if (widget?.runtimeDiagnostics?.errors?.length) return agent("runtime-error", ["general-html"]);
    if (/(?:\b(?:api|websocket|database|webgl|three\.js)\b|\b(?:add|implement|build|fix|debug|change|update)\b.{0,35}\b(?:interaction|interactive|animation|simulation|logic|algorithm|drag|playback)\b|(?:增加|添加|实现|修改|修复).{0,16}(?:交互|动画|模拟|逻辑|算法|拖拽|播放控制)|(?:接口|数据库|物理模拟|三维))/.test(String(instruction).toLowerCase())) return agent("complex-instruction", ["general-html"]);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)],
      executable = scripts.filter(([, attrs]) => !/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs)),
      code = executable.map(([, , source]) => source).join("\n");
    if (widget?.pluginId && widget.pluginId !== "general"
      || executable.some(([, attrs]) => /\bsrc\s*=/i.test(attrs))
      || /\b(?:fetch|WebSocket|XMLHttpRequest|Worker)\s*\(|\b(?:WebGLRenderer|createShader|indexedDB)\b/.test(code)) return agent("runtime-dependencies", ["general-html"]);
    // Simple SVG clocks use 4–6 KB of local JS. Count executable code separately
    // from JSON and embedded image bytes; a timer alone is not complex behavior.
    if (code.length > 12000 || html.replace(/data:image\/[^\s"'<>]+/gi, "").length > 24000) return agent("large-source", ["general-html"]);
    return { executor:"canvas_ai", reason:"simple-widget", guidance:[] };
  }

  function actionById(id) { return ACTION_BY_ID.get(id) || null; }
  // The illustration action is named after the selected illustration style.
  function label(action, language, { illustrationStyle } = {}) {
    const names = action?.styleLabels?.[illustrationStyle] || action?.label;
    return names?.[language === "zh" ? "zh" : "en"] || names?.en || "";
  }

  // Only offer actions that can actually run here (closed and executable).
  function eligibleActions(context = {}) {
    return ACTIONS.filter(action => {
      if (action.requires === "widget" && (!context.widgetRefine || context.selection || context.result)) return false;
      if (action.requires === "shapes" && !context.shapesFit) return false;
      if (action.requires === "selection" && (!context.selection || context.result)) return false;
      if (action.requires === "input" && context.result) return false;
      if (Array.isArray(context.disabled) && context.disabled.includes(action.id)) return false;
      return true;
    });
  }

  function buildQuestions(context = {}) {
    // All reviewed ink choices participate in the closed question. Cloud
    // checks the complete token budget; local proxies remain outside it.
    // Cancellation marks belong to the independent Delete gesture offer.
    const enclosure = context.noteScope === "enclosed" && !context.selection && !context.widgetRefine && !context.deletionMark;
    const actions = eligibleActions(context).filter(action => !action.proxy && (action.id !== "snap_shapes" || !context.deletionMark && !context.widgetRefine && !enclosure));
    const questions = {
      kind:{ type:"choice", instructions:context.selection ? "The image contains only the user's lasso-selected ink; everything outside the closed selection is blank. What kind of content did the user select?" : enclosure ? "The newest dark pen stroke encloses earlier content. Classify the enclosed content, using the stroke as a selection boundary." : "The image shows a crop of a handwriting canvas. Dark ink is NEW; faded content includes earlier ink, widgets, images and text for context. What is the NEW dark ink?", criteria:{ ...KINDS } },
      action:{
        type:"choice",
        instructions:(context.selection ? "Choose a useful follow-up for this explicitly selected content using only the selection image." : enclosure ? "The newest dark pen stroke groups earlier content. Save it as a note unless the enclosed content explicitly requests another task. The boundary itself is not a cleanup target." : "Choose the single useful follow-up for the newest dark content, using faded content as context.") + (context.widgetRefine && !context.selection ? " " + WIDGET_REFINE_GUIDANCE : "") + " " + (context.widgetRefine && !context.selection ? WIDGET_ACTION_INTENT_GUIDANCE : ACTION_INTENT_GUIDANCE),
        criteria:{ none:NONE_CRITERIA, ...Object.fromEntries(actions.map(action => [action.id, action.criteria])) },
      },
      finished:{ type:"noul", instructions:"Has the person finished this unit of writing or drawing (not stopped mid-expression, mid-word or mid-shape)?" },
      ...(!context.result ? { check_applicable:{ ...CHECK_APPLICABLE_QUESTION }, conversation:{ ...CONVERSATION_QUESTION } } : {}),
    };
    if (context.selection) questions.note_scope = { type:"noul", instructions:"Probability that the selected content contains at least 80 characters of prose, or at least three lines totalling 40 characters of meaningful notes. Return low for isolated words, a short formula, a picture or mostly blank space. Judge content quantity, not image size or importance." };
    if (context.selection || enclosure) questions.note_task = { type:"noul", instructions:"Probability that this content explicitly requests a specific assistant operation, such as solve, explain, check, typeset or organize. Descriptions of plans, research procedures, memo items and ordinary lesson notes are content to preserve, not requests. A grouping circle alone is not a specific operation." };
    return questions;
  }

  function formatFacts(features = {}) {
    const lines = [];
    const ink = features.ink || {};
    lines.push(`new_ink: strokes=${ink.strokes || 0} closed=${ink.closed || 0} bbox=${Math.round(ink.w || 0)}x${Math.round(ink.h || 0)} aspect=${(ink.h ? ink.w / ink.h : 0).toFixed(1)}`);
    if (features.shape) lines.push(`shape_fit: best=${features.shape.type} residual=${features.shape.residual.toFixed(3)}${features.shape.total ? ` covers=${features.shape.covers}/${features.shape.total}` : ""}`);
    if (features.overlaps?.length) lines.push(`overlaps: ${features.overlaps.slice(0, 3).join(" | ")}`);
    if (features.typedText) lines.push(`typed_text_in_region: ${JSON.stringify(String(features.typedText).slice(0, 160))}`);
    if (features.profile) lines.push(`canvas_profile: ${Object.entries(features.profile).filter(([, value]) => value >= 0.05).sort((a, b) => b[1] - a[1]).map(([name, value]) => `${name} ${value.toFixed(2)}`).join(", ") || "unknown"}`);
    if (features.persona) lines.push(`persona: ${features.persona} | locale: ${features.locale || "en"}`);
    if (features.recent?.length) lines.push(`recent: ${features.recent.slice(-4).join("; ")}`);
    return lines.join("\n").slice(0, 1500);
  }

  // Policy: turn typed answers into chips. Precision over recall.
  function decide(answers, context = {}) {
    const empty = { chips:[], more:[], reason:"" };
    const action = answers?.action, kind = answers?.kind, finished = answers?.finished;
    if (!action || action.type !== "choice" || !action.probabilities) return { ...empty, reason:"no-action" };
    if ((action.probabilities.none || 0) > POLICY.maxNone) return { ...empty, reason:"none" };
    if (finished && Number.isFinite(finished.noul) && finished.noul < POLICY.minFinished) return { ...empty, reason:"unfinished" };
    const kindChoice = kind?.type === "choice" ? kind.choice : null;
    if (kindChoice === "none") return { ...empty, reason:"kind-none" };
    const cooldown = context.cooldown || {};
    const cooling = id => {const value=cooldown[id];return typeof value==="number"?value>=2:value?.count>=2&&value.until>(context.now??Date.now());};
    const ranked = Object.entries(action.probabilities)
      .filter(([id]) => id !== "none" && ACTION_BY_ID.has(id))
      .map(([id, p]) => ({ id, p }))
      .sort((a, b) => b.p - a.p);
    const compatible = id => !kindChoice || ACTION_BY_ID.get(id).kinds.includes(kindChoice);
    const top = ranked[0];
    if (!top || top.p < ACTION_BY_ID.get(top.id).threshold) return { ...empty, reason:"low-confidence" };
    if (!compatible(top.id)) return { ...empty, reason:"disagreement" };
    if (cooling(top.id)) return { ...empty, reason:"cooldown" };
    const chips = [top];
    for (const candidate of ranked.slice(1)) {
      if (chips.length >= POLICY.maxChips) break;
      if (candidate.p >= POLICY.secondMin && compatible(candidate.id) && !cooling(candidate.id)) chips.push(candidate);
    }
    const shown = new Set(chips.map(chip => chip.id));
    const more = ranked.filter(candidate => !shown.has(candidate.id) && candidate.p >= POLICY.moreMin && compatible(candidate.id) && !cooling(candidate.id)).slice(0, POLICY.maxMore);
    return { chips, more, reason:"ok" };
  }

  // ---------- Assist v2: always offer, rank by prediction ----------
  //
  // The first version only showed a chip when PenEchoLLM was confident, finished
  // and in agreement. With a 2–3 s PenEchoLLM round trip and Auto AI firing at 5 s,
  // that window was almost never open. Assist ranks instead of gating: local
  // features give an instant prediction at pen-up, PenEchoLLM re-ranks when it
  // answers, and the bar always offers its best three actions plus Ask.

  // Count text rows from stroke boxes by merging vertically overlapping bands.
  function estimateRows(boxes) {
    const bands = (boxes || []).filter(box => box && box.h >= 0).map(box => ({ top:box.y, bottom:box.y + Math.max(1, box.h) })).sort((a, b) => a.top - b.top);
    const rows = [];
    for (const band of bands) {
      const last = rows.at(-1);
      const overlap = last ? Math.min(last.bottom, band.bottom) - Math.max(last.top, band.top) : -1;
      if (last && overlap >= Math.min(last.bottom - last.top, band.bottom - band.top) * 0.3) {
        last.top = Math.min(last.top, band.top);
        last.bottom = Math.max(last.bottom, band.bottom);
      } else rows.push({ ...band });
    }
    return rows.length;
  }

  // Motion marks drawn beside a picture: a small play triangle, or two or more
  // short parallel speed lines outside the drawing's body. Shading and hatching
  // inside the body do not count.
  function motionCues(strokes = []) {
    const usable = (strokes || []).filter(stroke => Array.isArray(stroke?.points) && stroke.points.length >= 2);
    if (usable.length < 3) return null;
    const boxOf = list => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const stroke of list) for (const point of stroke.points) { x0 = Math.min(x0, point.x); y0 = Math.min(y0, point.y); x1 = Math.max(x1, point.x); y1 = Math.max(y1, point.y); }
      return { x:x0, y:y0, w:Math.max(1, x1 - x0), h:Math.max(1, y1 - y0) };
    };
    const outside = (box, body, margin) => box.x > body.x + body.w + margin || box.x + box.w < body.x - margin || box.y > body.y + body.h + margin || box.y + box.h < body.y - margin;
    const fits = usable.map(stroke => ({ stroke, fit:fitStroke(stroke.points), box:boxOf([stroke]) }));
    // Play symbol: a small closed triangle beside a larger picture.
    for (const item of fits) {
      if (item.fit?.type !== "triangle" || item.fit.residual > 0.12) continue;
      const rest = usable.filter(stroke => stroke !== item.stroke), body = boxOf(rest), diag = Math.hypot(body.w, body.h), size = Math.hypot(item.box.w, item.box.h);
      if (rest.length >= 2 && size < diag * 0.45 && outside(item.box, body, diag * 0.02)) return { type:"play" };
    }
    // Speed lines: short parallel straight strokes trailing outside the body.
    const lines = fits.filter(item => item.fit?.type === "line").map(item => {
      const [a, b] = item.fit.outline;
      return { ...item, angle:((Math.atan2(b.y - a.y, b.x - a.x) % Math.PI) + Math.PI) % Math.PI, length:Math.hypot(b.x - a.x, b.y - a.y) };
    });
    const all = boxOf(usable), short = lines.filter(item => item.length < Math.hypot(all.w, all.h) * 0.35);
    for (const seed of short) {
      const group = short.filter(item => Math.min(Math.abs(item.angle - seed.angle), Math.PI - Math.abs(item.angle - seed.angle)) < 0.26);
      if (group.length < 2) continue;
      const rest = usable.filter(stroke => !group.some(item => item.stroke === stroke));
      if (rest.length < 2) continue;
      const body = boxOf(rest), diag = Math.hypot(body.w, body.h), cues = boxOf(group.map(item => item.stroke));
      if (group.every(item => item.length < diag * 0.5) && outside(cues, body, diag * 0.02) && !outside(cues, body, diag * 0.6)) return { type:"speed-lines" };
    }
    return null;
  }

  // ---------- Instant order: cheap ink cues and per-device learning ----------
  // Calibrated against 104 real PenEchoLLM ink/selection answers (2026-09-30 to
  // 2026-10-02, docs/verification/suggest-instant-order-20261003). An open "="
  // is a Solve request 16/17 times; an equation with a right-hand side is mostly
  // graphed; plain handwritten words get Answer or Typeset, never Plot first;
  // rectilinear line art (mazes, flows) gets Answer or Make diagram.
  const INSTANT_BUCKETS = Object.freeze(["open_equation", "derivation", "formula", "line_art", "drawing", "text_rows", "text_line", "single_mark"]);
  const INSTANT_SCORES = Object.freeze({
    open_equation:{ kind:"math_expr", scores:{ solve:2.2, typeset:0.8, practice:0.4, check_step:0.25, next_step:0.25, plot:0.2, hint:0.2, explain:0.15 } },
    derivation:{ kind:"math_step", scores:{ check_step:1.6, next_step:1.2, typeset:0.6, solve:0.5, practice:0.5, hint:0.4, explain:0.3 } },
    formula:{ kind:"math_expr", scores:{ plot:1.6, solve:1.1, typeset:0.8, practice:0.4, explain:0.3, animate:0.3 } },
    line_art:{ kind:"diagram", scores:{ answer:1.6, diagram:1.0, explain:0.3, create_visual:0.2 } },
    drawing:{ kind:"drawing", scores:{ vivid:1.2, finish_drawing:1.1, animate_sketch:0.7, answer:0.3, explain:0.2 } },
    text_rows:{ kind:"notes", scores:{ typeset:1.1, answer:1.0, check_step:0.6, organize:0.4, explain:0.3 } },
    text_line:{ kind:"notes", scores:{ answer:1.15, typeset:1.1, create_visual:0.6, plot:0.35, solve:0.3, explain:0.3, hint:0.2 } },
    single_mark:{ kind:"notes", scores:{ answer:1.0, typeset:0.8, finish_drawing:0.5, explain:0.4 } },
  });

  function inkStrokeShape(stroke) {
    const raw = (stroke?.points || []).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    if (raw.length < 2) return null;
    const points = resample(raw, 32);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, length = 0, axis = 0;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      x0 = Math.min(x0, point.x); y0 = Math.min(y0, point.y); x1 = Math.max(x1, point.x); y1 = Math.max(y1, point.y);
      if (!index) continue;
      const dx = point.x - points[index - 1].x, dy = point.y - points[index - 1].y, segment = Math.hypot(dx, dy),
        angle = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
      length += segment;
      if (Math.min(angle, Math.PI / 2 - angle) <= Math.PI / 12) axis += segment;
    }
    const first = points[0], last = points.at(-1), chord = Math.hypot(last.x - first.x, last.y - first.y),
      slope = Math.abs(Math.atan2(last.y - first.y, last.x - first.x)), w = x1 - x0, h = y1 - y0;
    // A dash: a short, nearly straight, nearly horizontal mark (both "=" bars, a minus).
    const dash = length > 0 && chord / length >= 0.85 && Math.min(slope, Math.PI - slope) <= 0.35 && w >= Math.max(2.2 * h, 1);
    return { points, x:x0, y:y0, w, h, cx:(x0 + x1) / 2, cy:(y0 + y1) / 2, length, axis, dash };
  }

  // Cheap glyph cues from stroke vectors. They only steer the instant order;
  // PenEchoLLM still decides once it answers.
  function inkCues(strokes = []) {
    const shapes = (strokes || []).map(inkStrokeShape).filter(Boolean);
    if (!shapes.length) return null;
    // A lone "=" or 二 with nothing else is not an equation to complete.
    const dashes = shapes.length >= 3 ? shapes.filter(shape => shape.dash) : [], used = new Set(), pairs = [];
    const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const stacked = (a, b) => {
      const width = Math.max(a.w, b.w), gap = Math.abs(b.cy - a.cy);
      return overlapX(a, b) >= 0.5 * Math.min(a.w, b.w) && Math.min(a.w, b.w) / width >= 0.45 && gap >= 0.12 * width && gap <= 1.1 * width;
    };
    for (const a of dashes) for (const b of dashes) {
      if (a === b || used.has(a) || used.has(b) || a.cy >= b.cy || !stacked(a, b)) continue;
      // Three stacked bars (三) or a stroke through the gap (王, 量) is not "=".
      if (dashes.some(other => other !== a && other !== b && (stacked(other, a) || stacked(other, b)) && (other.cy < a.cy || other.cy > b.cy))) continue;
      const gx0 = Math.max(a.x, b.x), gx1 = Math.min(a.x + a.w, b.x + b.w), gy0 = a.cy + a.h / 2, gy1 = b.cy - b.h / 2;
      // "=" has clear space above and below; 元 or 云 attach strokes to a bar.
      const clear = Math.max(gy1 - gy0, 1) * 0.8;
      if (shapes.some(other => other !== a && other !== b && other.points.some(point => point.x > gx0 && point.x < gx1 && point.y > a.y - clear && point.y < b.y + b.h + clear && (point.y <= a.y || point.y >= b.y + b.h || point.y > gy0 && point.y < gy1)))) continue;
      used.add(a); used.add(b);
      pairs.push({ x:Math.min(a.x, b.x), right:Math.max(a.x + a.w, b.x + b.w), w:Math.max(a.w, b.w), top:a.y, bottom:b.y + b.h, members:[a, b] });
    }
    let openEquals = 0;
    for (const pair of pairs) {
      const reach = Math.max(pair.bottom - pair.top, pair.w * 0.6), top = pair.top - reach, bottom = pair.bottom + reach;
      const rightSide = shapes.some(other => !pair.members.includes(other) && other.y < bottom && other.y + other.h > top && other.x >= pair.right - pair.w * 0.1);
      if (!rightSide) openEquals++;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, length = 0, axis = 0, longest = 0;
    for (const shape of shapes) {
      x0 = Math.min(x0, shape.x); y0 = Math.min(y0, shape.y); x1 = Math.max(x1, shape.x + shape.w); y1 = Math.max(y1, shape.y + shape.h);
      length += shape.length; axis += shape.axis; longest = Math.max(longest, shape.length);
    }
    const side = Math.max(1, x1 - x0, y1 - y0);
    // Rectilinear line art: long horizontal/vertical runs relative to the whole
    // cluster. Handwritten words and characters use many short strokes instead.
    const lineArt = !pairs.length && shapes.length <= 16 && length > 0 && axis / length >= 0.7 && longest >= 1.4 * side && length / shapes.length >= 0.5 * side;
    return { equals:pairs.length, openEquals, lineArt, dashes:dashes.length };
  }

  function instantBucket(features = {}) {
    const cues = features.cues;
    if (!cues || features.shapes || features.widgetRefine || features.deletionMark) return null;
    const strokes = features.strokes || 0, rows = features.rows || 1, aspect = features.aspect || 1;
    if (cues.openEquals) return "open_equation";
    if (cues.equals && features.newBelow && rows >= 2) return "derivation";
    if (cues.equals) return "formula";
    if (cues.lineArt) return "line_art";
    // A second line written under the first is text, not a picture.
    if (strokes >= 4 && (rows === 1 || rows === 2 && !features.newBelow) && aspect >= 0.4 && aspect <= 1.8) return "drawing";
    if (rows >= 2) return "text_rows";
    if (strokes >= 2) return "text_line";
    return "single_mark";
  }

  // Running average (then EMA after 40 samples) of PenEchoLLM rankings and the
  // user's own taps for each instant bucket. Stored per device by the client.
  function learnInstantPrior(prior = {}, bucket, distribution, { weight = 1 } = {}) {
    if (!INSTANT_BUCKETS.includes(bucket) || !distribution || !(weight > 0)) return prior || {};
    const entries = Object.entries(distribution).filter(([id, value]) => id !== "refine" && ACTION_BY_ID.has(id) && Number.isFinite(value) && value > 0),
      total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!(total > 0)) return prior || {};
    const old = prior?.[bucket] && typeof prior[bucket] === "object" ? prior[bucket] : { n:0, p:{} },
      count = Math.min(40, (Number(old.n) || 0) + weight), rate = Math.min(1, weight / count), next = {},
      target = Object.fromEntries(entries.map(([id, value]) => [id, value / total]));
    for (const id of new Set([...Object.keys(old.p || {}), ...Object.keys(target)])) {
      if (!ACTION_BY_ID.has(id)) continue;
      const value = (1 - rate) * (Number(old.p?.[id]) || 0) + rate * (target[id] || 0);
      if (value >= 0.01) next[id] = Math.round(value * 1000) / 1000;
    }
    const clean = Object.fromEntries(Object.entries(prior || {}).filter(([key]) => INSTANT_BUCKETS.includes(key)));
    return { ...clean, [bucket]:{ n:Math.round(count * 100) / 100, p:next } };
  }

  // Weight of learned evidence: grows with samples, never fully replaces the
  // calibrated table so an odd streak cannot lock the bar.
  function blendInstantPrior(probabilities, learned) {
    const n = Number(learned?.n) || 0;
    if (!(n > 0) || !learned.p) return probabilities;
    const weight = Math.min(0.55, n / (n + 6)), out = {};
    for (const id of new Set([...Object.keys(probabilities), ...Object.keys(learned.p)])) {
      if (!ACTION_BY_ID.has(id) || id === "refine") continue;
      const value = (1 - weight) * (probabilities[id] || 0) + weight * (Number(learned.p[id]) || 0);
      if (value > 0) out[id] = value;
    }
    return out;
  }

  // Instant prediction from geometry and context. Scores are relative weights
  // normalised to a distribution; they never decide visibility on their own.
  function localPredict(features = {}) {
    const scores = {}, add = (id, value) => { scores[id] = (scores[id] || 0) + value; };
    // Cartoon motion marks beside a picture ask for the picture to move.
    // An "=" pair beside writing is arithmetic, not speed lines.
    if (features.motionCue && !features.widgetRefine && !features.deletionMark && !features.cues?.equals) {
      const result = localPredict({ ...features, motionCue:null });
      const boosted = { ...result.probabilities, animate_sketch:(result.probabilities.animate_sketch || 0) + 1.6 };
      const total = Object.values(boosted).reduce((sum, value) => sum + value, 0) || 1;
      return { kind:"drawing", motionCue:features.motionCue, probabilities:Object.fromEntries(Object.entries(boosted).map(([id, value]) => [id, value / total])) };
    }
    const strokes = features.strokes || 0, rows = features.rows || 1, aspect = features.aspect || 1, profile = features.profile || {};
    let kind = "notes";
    if (features.widgetRefine) return { kind:features.deletionMark ? "deletion" : "notes", probabilities:{ refine:0.9, answer:0.1 } };
    if (features.deletionMark) return { kind:"deletion", probabilities:{} };
    // Ink with stroke cues uses the calibrated instant table; the geometric
    // fallback below remains for selections and callers without vectors.
    const bucket = instantBucket(features), instant = bucket ? INSTANT_SCORES[bucket] : null;
    if (features.shapes) {
      kind = "shape"; // Geometry alone cannot establish semantic nodes or relationships.
      add("snap_shapes", 3);
      add("answer", 0.8);
      if (features.shapes.rectangles >= 3 && !features.shapes.arrows) { add("prototype", 1.4); kind = "ui_wireframe"; }
      add("explain", 0.2);
    } else if (instant) {
      kind = instant.kind;
      for (const [id, value] of Object.entries(instant.scores)) add(id, value);
    } else if (features.newBelow && rows >= 2) {
      kind = "math_step";
      add("check_step", 1.6); add("next_step", 1.2); add("typeset", 0.7); add("practice", 0.7); add("hint", 0.5); add("explain", 0.3);
    } else if (rows === 1 && aspect >= 1.8 && strokes >= 2) {
      kind = "math_expr";
      add("typeset", 1.3); add("plot", 1.1); add("solve", 1.0); add("practice", 0.8); add("explain", 0.4); add("hint", 0.3); add("animate", 0.35);
    } else if (strokes >= 4 && rows <= 2 && aspect >= 0.4 && aspect <= 1.8) {
      // Compact multi-stroke ink that is neither a line of text nor fitted shapes
      // is most likely a picture.
      kind = "drawing";
      add("vivid", 1.2); add("finish_drawing", 1.0); add("animate_sketch", 0.8); add("typeset", 0.4); add("explain", 0.3);
    } else if (rows >= 3) {
      kind = "notes";
      add("organize", 1.2); add("typeset", 1.0); add("explain", 0.6); add("answer", 0.5);
    } else {
      add("typeset", 0.9); add("answer", 0.8); add("explain", 0.7); add("solve", 0.4);
    }
    if (features.typedText) { add("answer", 1.2); kind = "question"; }
    // Only deliberate grouping promotes Note; it remains a secondary shortcut.
    add("note", features.notePriority ? 6 : 0.12);
    // Canvas profile: a math-heavy canvas leans to math actions, and so on.
    const mathLean = (profile.math_expr || 0) + (profile.math_step || 0);
    if (mathLean > 0.3 && !features.shapes && !instant) { add("plot", mathLean); add("solve", mathLean * 0.8); add("practice", mathLean * 0.8); }
    if ((profile.drawing || 0) > 0.3 && !features.shapes && !instant) { add("vivid", profile.drawing); add("animate_sketch", profile.drawing * 0.7); }
    const total = Object.values(scores).reduce((sum, value) => sum + value, 0) || 1;
    const probabilities = Object.fromEntries(Object.entries(scores).filter(([id]) => ACTION_BY_ID.has(id)).map(([id, value]) => [id, value / total]));
    return { kind, notePriority:Boolean(features.notePriority), ...(bucket ? { bucket } : {}), probabilities:bucket ? blendInstantPrior(probabilities, features.learned?.[bucket]) : probabilities };
  }

  function cooling(cooldown, id, now) {
    const value = cooldown?.[id];
    return typeof value === "number" ? value >= 2 : value?.count >= 2 && value.until > now;
  }

  // Blend PenEchoLLM (when it has answered) with the local prediction. Output is
  // always a non-empty ranked list when there is ink; confidence only sets the
  // emphasis of the first item.
  // Older servers have no independent applicability answer. Preserve their
  // behavior; a current server's negative verdict keeps Check in More only.
  function checkApplicable(answers) {
    const value = answers?.check_applicable;
    const action = answers?.action;
    // Applicability alone overestimates what could be checked. When recognition
    // strongly identifies another task and gives Check negligible support, do
    // not resurrect Check from the geometric/learned local prior.
    if (value?.type === "noul" && action?.type === "choice" && action.choice !== "check_step" && action.choice !== "none"
      && (action.probabilities?.[action.choice] || 0) >= 0.8
      && (!Number.isFinite(action.confidence) || action.confidence >= 0.8)
      && (action.probabilities?.check_step || 0) < POLICY.secondMin) return false;
    // Two tentative scores are not a checking task. A moderate applicability
    // score is enough only when the action classifier independently agrees
    // strongly (important for real, correctly written practice answers).
    if (value?.type === "noul" && value.noul < 0.8 && action?.type === "choice"
      && ((action.probabilities?.check_step || 0) < 0.8 || Number.isFinite(action.confidence) && action.confidence < 0.8)) return false;
    // A strong social-turn verdict needs equally strong checking evidence to
    // override it. A marginal Check score must not turn thanks into an exercise.
    const threshold = answers?.conversation?.type === "noul" && answers.conversation.noul >= 0.8 ? 0.8 : 0.5;
    return value?.type !== "noul" || !Number.isFinite(value.noul) || value.noul >= threshold;
  }
  function conversationIntent(answers) {
    const action = answers?.action,
      specialized = !["none", "answer", "check_step", "typeset"].includes(action?.choice) && confidentRanking(answers);
    return answers?.conversation?.type === "noul" && answers.conversation.noul >= 0.8 && !specialized && !checkApplicable(answers);
  }
  function confidentRanking(answers, id = answers?.action?.choice) {
    const action = answers?.action;
    return action?.type === "choice" && ACTION_BY_ID.has(id)
      && (action.probabilities?.none || 0) < 0.4 && (action.probabilities?.[id] || 0) >= POLICY.confident
      && (!Number.isFinite(action.confidence) || action.confidence >= POLICY.confident)
      && (id !== "check_step" || checkApplicable(answers));
  }
  // Teach only reliable rankings. A rejected Check must not enter the learned
  // distribution through its secondary probability either.
  function instantRankingEvidence(answers) {
    if (!confidentRanking(answers) || conversationIntent(answers) && answers.action.choice !== "answer") return null;
    return Object.fromEntries(Object.entries(answers.action.probabilities)
      .filter(([id]) => ACTION_BY_ID.has(id) && (id !== "check_step" || checkApplicable(answers))));
  }

  // PenEchoLLM's confident picture verdict corrects geometric guesses made
  // before recognition: a tall subject such as a caterpillar reads as text rows,
  // and overlapping body loops can look like a grouping enclosure. An unworded
  // finished picture also cannot request a different new visual; the visual it
  // invites is its own illustration. Written requests keep create_visual.
  function pictureVerdict(answers, local) {
    const kind = answers?.kind, finished = answers?.finished;
    if (kind?.type !== "choice" || kind.choice !== "drawing" || local?.kind === "question") return false;
    const probability = Number.isFinite(kind.probabilities?.drawing) ? kind.probabilities.drawing : kind.confidence;
    return probability >= 0.8 && (finished?.type !== "noul" || !Number.isFinite(finished.noul) || finished.noul >= POLICY.minFinished);
  }
  function drawingPrior() {
    const scores = { ...INSTANT_SCORES.drawing.scores, note:0.12 }, total = Object.values(scores).reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(Object.entries(scores).map(([id, value]) => [id, value / total]));
  }

  function rankActions({ local, answers, cooldown = {}, now = Date.now(), max = 3, exclude = [] } = {}) {
    const jev = answers?.action?.type === "choice" ? answers.action.probabilities : null,
      jevKind = answers?.kind?.type === "choice" ? answers.kind.choice : null,
      noneMass = jev ? jev.none || 0 : 0,
      picture = Boolean(jev) && pictureVerdict(answers, local),
      localProbabilities = picture && local?.probabilities && local.kind !== "drawing" && !local.motionCue ? drawingPrior() : local?.probabilities || {},
      combined = {};
    for (const [id, p] of Object.entries(localProbabilities)) combined[id] = (combined[id] || 0) + p * (jev ? 0.3 : 1);
    if (jev) for (const [id, p] of Object.entries(jev)) if (id !== "none" && ACTION_BY_ID.has(id)) combined[id] = (combined[id] || 0) + p * 0.7 / Math.max(0.2, 1 - noneMass);
    if (picture && combined.create_visual) { combined.vivid = (combined.vivid || 0) + combined.create_visual; delete combined.create_visual; }
    // A locally detected motion cue keeps sketch animation visible beside a
    // static-illustration verdict without overriding a confident model.
    if (jev && local?.motionCue) combined.animate_sketch = (combined.animate_sketch || 0) + 0.3;
    if (jev) for (const action of ACTIONS) if (action.proxy && jev[action.proxy] && (!action.requires || local?.probabilities?.[action.id])) combined[action.id] = (combined[action.id] || 0) + jev[action.proxy] * (action.proxyWeight ?? 0.6) * 0.7 / Math.max(0.2, 1 - noneMass);
    const kind = jevKind && jevKind !== "none" ? jevKind : local?.kind || null;
    // A picture's own loops are not a grouping of notes; selections keep their
    // independent note_scope verdict.
    const notePriority = answers?.note_scope?.type === "noul" ? answers.note_scope.noul >= 0.75 : !picture && Boolean(local?.notePriority);
    const items = Object.entries(combined)
      .filter(([id]) => ACTION_BY_ID.has(id) && !exclude.includes(id) && !cooling(cooldown, id, now))
      .map(([id, p]) => ({ id, p:kind && !ACTION_BY_ID.get(id).kinds.includes(kind) ? p * 0.5 : p, source:jev ? "penecho-llm" : "local" }))
      .sort((a, b) => b.p - a.p);
    if (notePriority && answers?.note_task?.type === "noul" && answers.note_task.noul < 0.75) {
      // Grouped notes request preservation unless an explicit task takes priority.
      // Keep the original probability; this is the user's scope policy.
      const index = items.findIndex(item => item.id === "note");
      if (index >= 0) items.unshift(...items.splice(index, 1));
    } else if (!notePriority) {
      const index = items.findIndex(item => item.id === "note");
      if (index >= 0) items.push(...items.splice(index, 1));
    }
    // The geometric formula prior cannot distinguish equations from functions.
    // Once recognition resolves that ambiguity, an unsupported opposite action
    // belongs in More instead of lingering as the second main recommendation.
    const opposite = confidentRanking(answers) ? { plot:"solve", solve:"plot" }[answers?.action?.choice] : null,
      defer = id => id === "check_step" && !checkApplicable(answers) || id === opposite && (jev?.[id] || 0) < POLICY.moreMin,
      deferred = items.filter(item => defer(item.id)).map(item => ({ ...item, mainEligible:false })),
      eligible = deferred.length ? items.filter(item => !defer(item.id)) : items,
      conversation = conversationIntent(answers) && !notePriority;
    if (conversation) {
      const index = eligible.findIndex(item => item.id === "answer");
      if (index >= 0) eligible.unshift(...eligible.splice(index, 1));
    }
    const top = eligible[0],
      confident = Boolean(top) && (conversation && top.id === "answer" || (jev ? confidentRanking(answers, top.id) : top.p >= POLICY.confident));
    return { items:eligible.slice(0, max), more:[...deferred, ...eligible.slice(max)].slice(0, 5), confident, kind, notePriority, source:jev ? "penecho-llm" : "local" };
  }

  // Result suggestions require evidence from the new result, never the old action id.
  function rankResultActions(answers, { previousAction } = {}) {
    const ranked = rankActions({ answers, exclude:["snap_shapes", "refine", "note"] }),
      action = answers?.action,
      // Leave a new practice question for the learner. Their later written
      // attempt gets ordinary ink suggestions, including Check and Hint.
      useful = previousAction !== "practice" && action?.type === "choice" && action.probabilities && action.choice !== "none" && answers?.kind?.choice !== "none"
        && (action.probabilities.none || 0) < 0.4 && (!Number.isFinite(action.confidence) || action.confidence >= 0.8),
      // Next is an unsolicited follow-up. Use raw probability, without removing
      // none or blending local guesses; ordinary Suggest keeps its own policy.
      items = useful ? ranked.items.filter(item => (action.probabilities[item.id] || 0) >= 0.8) : [];
    return { ...ranked, items, more:[], confident:items.length > 0, routing:answers };
  }

  // Shape tool geometry: canvas-space outline polylines from a drag.
  const SHAPE_TOOLS = Object.freeze(["rectangle", "ellipse", "line", "arrow", "triangle", "axes"]);
  function shapeToolOutline(kind, start, end, options = {}) {
    if (!start || !end || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
    let dx = end.x - start.x, dy = end.y - start.y;
    if (options.constrain && ["rectangle", "ellipse", "triangle", "axes"].includes(kind)) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * side;
      dy = Math.sign(dy || 1) * side;
    }
    if (options.constrain && ["line", "arrow"].includes(kind)) {
      const length = Math.hypot(dx, dy), angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      dx = Math.cos(angle) * length;
      dy = Math.sin(angle) * length;
    }
    const x0 = Math.min(start.x, start.x + dx), y0 = Math.min(start.y, start.y + dy), x1 = Math.max(start.x, start.x + dx), y1 = Math.max(start.y, start.y + dy),
      w = x1 - x0, h = y1 - y0, tip = { x:start.x + dx, y:start.y + dy };
    if (Math.hypot(dx, dy) < (options.minSize || 4)) return null;
    const head = (from, to) => {
      const angle = Math.atan2(to.y - from.y, to.x - from.x), size = Math.max(options.headMin || 14, Math.min(Math.hypot(to.x - from.x, to.y - from.y) * 0.18, options.headMax || 60));
      return [{ x:to.x - size * Math.cos(angle - 0.5), y:to.y - size * Math.sin(angle - 0.5) }, { ...to }, { x:to.x - size * Math.cos(angle + 0.5), y:to.y - size * Math.sin(angle + 0.5) }];
    };
    if (kind === "rectangle") return [[{ x:x0, y:y0 }, { x:x1, y:y0 }, { x:x1, y:y1 }, { x:x0, y:y1 }, { x:x0, y:y0 }]];
    if (kind === "ellipse") {
      const out = [], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (let index = 0; index <= 96; index++) { const t = index / 96 * TAU; out.push({ x:cx + w / 2 * Math.cos(t), y:cy + h / 2 * Math.sin(t) }); }
      return [out];
    }
    if (kind === "line") return [[{ ...start }, tip]];
    if (kind === "arrow") return [[{ ...start }, tip], head(start, tip)];
    if (kind === "triangle") return [[{ x:(x0 + x1) / 2, y:y0 }, { x:x1, y:y1 }, { x:x0, y:y1 }, { x:(x0 + x1) / 2, y:y0 }]];
    if (kind === "axes") {
      const ox = x0 + w * 0.12, oy = y1 - h * 0.12, xEnd = { x:x1, y:oy }, yEnd = { x:ox, y:y0 };
      return [[{ x:x0, y:oy }, xEnd], head({ x:x0, y:oy }, xEnd), [{ x:ox, y:y1 }, yEnd], head({ x:ox, y:y1 }, yEnd)];
    }
    return null;
  }

  // Exponential moving average of PenEchoLLM kind answers for this canvas.
  function updateProfile(profile = {}, kindAnswer, rate = 0.25) {
    if (!kindAnswer?.probabilities) return { ...profile };
    const next = {};
    const names = new Set([...Object.keys(profile), ...Object.keys(kindAnswer.probabilities)]);
    for (const name of names) {
      if (name === "none") continue;
      const value = (1 - rate) * (profile[name] || 0) + rate * (kindAnswer.probabilities[name] || 0);
      if (value >= 0.01) next[name] = Math.round(value * 1000) / 1000;
    }
    return next;
  }

  // ---------- Geometry: shape fitting for snapping ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function pathLength(points) {
    let length = 0;
    for (let index = 1; index < points.length; index++) length += dist(points[index - 1], points[index]);
    return length;
  }
  function resample(points, count = 64) {
    const clean = points.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    if (clean.length < 2) return clean.map(point => ({ x:point.x, y:point.y }));
    const total = pathLength(clean);
    if (!(total > 0)) return [{ x:clean[0].x, y:clean[0].y }];
    const step = total / (count - 1), out = [{ x:clean[0].x, y:clean[0].y }];
    let carried = 0;
    for (let index = 1; index < clean.length && out.length < count; index++) {
      let a = clean[index - 1];
      const b = clean[index];
      let segment = dist(a, b);
      while (carried + segment >= step && out.length < count) {
        const t = (step - carried) / segment, point = { x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t };
        out.push(point);
        a = point;
        segment = dist(a, b);
        carried = 0;
      }
      carried += segment;
    }
    while (out.length < count) out.push({ x:clean.at(-1).x, y:clean.at(-1).y });
    return out;
  }
  function bounds(points) {
    const xs = points.map(point => point.x), ys = points.map(point => point.y),
      x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w:Math.max(...xs) - x, h:Math.max(...ys) - y };
  }
  function segmentDistance(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
  }
  function polygonResidual(points, vertices) {
    let total = 0;
    for (const point of points) {
      let best = Infinity;
      for (let index = 0; index < vertices.length; index++) best = Math.min(best, segmentDistance(point, vertices[index], vertices[(index + 1) % vertices.length]));
      total += best;
    }
    return total / points.length;
  }
  // Corner detection on a closed resampled loop: points where the direction
  // turns sharply, merged when they are close together.
  function closedCorners(points) {
    const n = points.length, k = Math.max(2, Math.round(n / 16)), candidates = [];
    for (let index = 0; index < n; index++) {
      const prev = points[(index - k + n) % n], cur = points[index], next = points[(index + k) % n],
        a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x), a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = TAU - turn;
      candidates.push({ index, turn });
    }
    const corners = [];
    for (const candidate of candidates.filter(c => c.turn > 0.62).sort((a, b) => b.turn - a.turn)) {
      if (corners.every(corner => Math.min(Math.abs(corner.index - candidate.index), n - Math.abs(corner.index - candidate.index)) > n / 10)) corners.push(candidate);
    }
    return corners.sort((a, b) => a.index - b.index).map(corner => points[corner.index]);
  }
  function ellipseFit(points) {
    const n = points.length, cx = points.reduce((sum, point) => sum + point.x, 0) / n, cy = points.reduce((sum, point) => sum + point.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const point of points) {
      const dx = point.x - cx, dy = point.y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    const trace = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, trace * trace / 4 - det)),
      l1 = trace / 2 + disc, l2 = Math.max(0, trace / 2 - disc),
      angle = Math.abs(sxy) < 1e-9 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy),
      a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);
    if (!(a > 0) || !(b > 0)) return null;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let error = 0;
    for (const point of points) {
      const dx = point.x - cx, dy = point.y - cy, u = (dx * cos + dy * sin) / a, v = (-dx * sin + dy * cos) / b;
      error += Math.abs(Math.hypot(u, v) - 1);
    }
    return { cx, cy, a, b, angle, residual:error / n };
  }
  function ellipseOutline(fit, segments = 96) {
    const out = [], cos = Math.cos(fit.angle), sin = Math.sin(fit.angle);
    for (let index = 0; index <= segments; index++) {
      const t = index / segments * TAU, u = fit.a * Math.cos(t), v = fit.b * Math.sin(t);
      out.push({ x:fit.cx + u * cos - v * sin, y:fit.cy + u * sin + v * cos });
    }
    return out;
  }
  function snapAngle(angle, tolerance = 0.14) {
    const quarter = Math.PI / 2, nearest = Math.round(angle / quarter) * quarter;
    return Math.abs(angle - nearest) < tolerance ? nearest : angle;
  }
  function rectangleFromCorners(corners) {
    const cx = corners.reduce((sum, point) => sum + point.x, 0) / 4, cy = corners.reduce((sum, point) => sum + point.y, 0) / 4,
      e1 = { x:corners[1].x - corners[0].x, y:corners[1].y - corners[0].y },
      e2 = { x:corners[2].x - corners[1].x, y:corners[2].y - corners[1].y },
      e3 = { x:corners[3].x - corners[2].x, y:corners[3].y - corners[2].y },
      e4 = { x:corners[0].x - corners[3].x, y:corners[0].y - corners[3].y };
    const angle = snapAngle(Math.atan2(e1.y - e3.y, e1.x - e3.x)),
      w = (Math.hypot(e1.x, e1.y) + Math.hypot(e3.x, e3.y)) / 2,
      h = (Math.hypot(e2.x, e2.y) + Math.hypot(e4.x, e4.y)) / 2,
      square = Math.abs(w - h) / Math.max(w, h) < 0.12, side = (w + h) / 2,
      ww = square ? side : w, hh = square ? side : h, cos = Math.cos(angle), sin = Math.sin(angle);
    const corner = (u, v) => ({ x:cx + u * cos - v * sin, y:cy + u * sin + v * cos });
    return { square, vertices:[corner(-ww / 2, -hh / 2), corner(ww / 2, -hh / 2), corner(ww / 2, hh / 2), corner(-ww / 2, hh / 2)] };
  }
  function rightAngled(corners) {
    for (let index = 0; index < 4; index++) {
      const a = corners[(index + 3) % 4], b = corners[index], c = corners[(index + 1) % 4],
        v1 = { x:a.x - b.x, y:a.y - b.y }, v2 = { x:c.x - b.x, y:c.y - b.y },
        cosine = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
      if (Math.abs(cosine) > 0.34) return false;
    }
    return true;
  }

  function smoothLoop(points) {
    const n = points.length;
    return points.map((point, index) => ({
      x:(points[(index + n - 1) % n].x + point.x * 2 + points[(index + 1) % n].x) / 4,
      y:(points[(index + n - 1) % n].y + point.y * 2 + points[(index + 1) % n].y) / 4,
    }));
  }
  function mergeShallowCorners(corners, diag) {
    const out = [...corners];
    while (out.length > 3) {
      const errors = out.map((point, index) => segmentDistance(point, out[(index + out.length - 1) % out.length], out[(index + 1) % out.length])),
        smallest = Math.min(...errors);
      if (smallest > diag * 0.06) break;
      out.splice(errors.indexOf(smallest), 1);
    }
    return out;
  }
  function closedTraversal(points, fit) {
    let turn = 0, travel = 0;
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      let step = Math.atan2(b.y - fit.cy, b.x - fit.cx) - Math.atan2(a.y - fit.cy, a.x - fit.cx);
      if (step > Math.PI) step -= TAU;
      if (step < -Math.PI) step += TAU;
      turn += step;
      travel += Math.abs(step);
    }
    // A loop goes around its centre once. Figure eights and repeated scribbles
    // must not become ellipses merely because their bounding boxes look round.
    return Math.abs(turn) > TAU * 0.9 && travel < TAU * 1.3;
  }

  // Fit one stroke. Residuals are scale-free; lower is better.
  function fitStroke(rawPoints) {
    const points = resample(rawPoints, 64);
    if (points.length < 8) return null;
    const box = bounds(points), diag = Math.hypot(box.w, box.h), length = pathLength(points);
    if (!(diag > 0)) return null;
    const gap = dist(points[0], points.at(-1)), closed = gap < Math.max(diag * 0.3, length * 0.1);
    if (!closed) {
      const a = points[0], b = points.at(-1), chord = dist(a, b);
      if (chord < diag * 0.6) return null;
      const residual = points.reduce((sum, point) => sum + segmentDistance(point, a, b), 0) / points.length / chord;
      // Wavy strokes (a tilde, a hand-drawn curve) are not lines.
      const deviation = Math.max(...points.map(point => segmentDistance(point, a, b))) / chord;
      if (residual > 0.04 || deviation > 0.085 || length > chord * 1.5) return null;
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      const snapped = snapAngle(angle, 0.09), mid = { x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 };
      if (snapped !== angle) angle = snapped;
      const half = chord / 2, start = { x:mid.x - Math.cos(angle) * half, y:mid.y - Math.sin(angle) * half }, end = { x:mid.x + Math.cos(angle) * half, y:mid.y + Math.sin(angle) * half };
      return { type:"line", residual, closed:false, outline:[start, end], bounds:box };
    }
    // Close the small hand-drawn gap before resampling so the seam has the
    // same spacing as the rest of the contour; smooth only for corner finding.
    const loop = resample([...points, points[0]], 65).slice(0, -1),
      cornerSets = [closedCorners(loop), closedCorners(smoothLoop(loop))].map(corners => mergeShallowCorners(corners, diag)), ellipse = ellipseFit(loop);
    if (ellipse && !closedTraversal(loop, ellipse)) return null;
    const candidates = [];
    for (const corners of cornerSets) {
      if (corners.length === 3) {
        const residual = polygonResidual(loop, corners) / diag;
        candidates.push({ type:"triangle", residual, closed:true, outline:[...corners, corners[0]], bounds:box });
      }
      if (corners.length === 4) {
        const residual = polygonResidual(loop, corners) / diag;
        if (rightAngled(corners)) {
          const rect = rectangleFromCorners(corners);
          candidates.push({ type:rect.square ? "square" : "rectangle", residual, closed:true, outline:[...rect.vertices, rect.vertices[0]], bounds:box });
        } else candidates.push({ type:"quadrilateral", residual, closed:true, outline:[...corners, corners[0]], bounds:box });
      }
    }
    if (ellipse && ellipse.residual <= 0.16) {
      const round = ellipse.b / ellipse.a > 0.82;
      const fit = round ? { ...ellipse, a:(ellipse.a + ellipse.b) / 2, b:(ellipse.a + ellipse.b) / 2, angle:0 } : ellipse;
      candidates.push({ type:round ? "circle" : "ellipse", residual:ellipse.residual * 0.5, closed:true, outline:ellipseOutline(fit), bounds:box });
    }
    const best = candidates.sort((a, b) => a.residual - b.residual)[0];
    return best && best.residual <= 0.09 ? best : null;
  }

  // Two or three strokes: a shaft plus a short head near one end is an arrow.
  function fitArrow(strokes) {
    if (strokes.length < 2 || strokes.length > 3) return null;
    const lengths = strokes.map(pathLength), order = lengths.map((length, index) => index).sort((a, b) => lengths[b] - lengths[a]);
    const shaft = fitStroke(strokes[order[0]]);
    if (shaft?.type !== "line") return null;
    const [start, end] = shaft.outline, shaftLength = dist(start, end);
    const heads = order.slice(1).map(index => strokes[index]);
    if (!heads.every(head => pathLength(head) < shaftLength * 0.6)) return null;
    const near = end => heads.every(head => head.some(point => dist(point, end) < shaftLength * 0.25));
    let tip = near(end) ? end : near(start) ? start : null;
    if (!tip) return null;
    const tail = tip === end ? start : end, angle = Math.atan2(tip.y - tail.y, tip.x - tail.x), ux = Math.cos(angle), uy = Math.sin(angle);
    // The drawn head may overshoot the shaft: the tip is the furthest head point along the shaft.
    const headPoints = heads.flat(), reach = Math.max(shaftLength, ...headPoints.map(point => (point.x - tail.x) * ux + (point.y - tail.y) * uy));
    const back = Math.min(...headPoints.map(point => (point.x - tail.x) * ux + (point.y - tail.y) * uy));
    tip = { x:tail.x + ux * reach, y:tail.y + uy * reach };
    const size = Math.max(Math.min(shaftLength * 0.22, Math.max(18, shaftLength * 0.12)), Math.min(shaftLength * 0.35, reach - back));
    const wing = sign => ({ x:tip.x - size * Math.cos(angle - sign * 0.5), y:tip.y - size * Math.sin(angle - sign * 0.5) });
    return { type:"arrow", residual:shaft.residual, closed:false, outline:[tail, tip], head:[wing(1), tip, wing(-1)], bounds:shaft.bounds };
  }

  function fitStrokes(strokes) {
    const valid = (strokes || []).filter(stroke => Array.isArray(stroke) && stroke.length >= 2);
    if (!valid.length) return [];
    const arrow = valid.length <= 3 ? fitArrow(valid) : null;
    if (arrow) return [{ ...arrow, strokeIndexes:valid.map((_, index) => index) }];
    const fits = valid.map((stroke, index) => {
      const fit = fitStroke(stroke);
      return fit ? { ...fit, strokeIndexes:[index] } : null;
    });
    // In a larger sketch, a straight shaft plus a short unfitted stroke at one
    // end is an arrow connector.
    const used = new Set();
    for (let index = 0; index < fits.length; index++) {
      if (fits[index]?.type !== "line" || used.has(index)) continue;
      const heads = [];
      for (let other = 0; other < valid.length; other++) {
        if (other === index || fits[other] || used.has(other)) continue;
        const candidate = fitArrow([valid[index], valid[other]]);
        if (candidate) heads.push({ other, candidate });
      }
      if (!heads.length) continue;
      const { other, candidate } = heads[0];
      used.add(index);
      used.add(other);
      fits[index] = { ...candidate, strokeIndexes:[index, other] };
    }
    return fits.filter(Boolean);
  }

  // Shapes matter only when they dominate the new ink. Short straight strokes
  // (minus signs, fraction bars, "=") are handwriting, not diagrams.
  function shapeSummary(fits, strokeCount, box) {
    const diag = box ? Math.hypot(box.w, box.h) : Infinity;
    const diagram = (fits || []).some(fit => fit.closed || fit.type === "arrow"),
      significant = (fits || []).filter(fit => fit.type !== "line" || Math.hypot(fit.outline[1].x - fit.outline[0].x, fit.outline[1].y - fit.outline[0].y) >= diag * (diagram ? 0.15 : 0.45));
    const covers = significant.reduce((count, fit) => count + fit.strokeIndexes.length, 0);
    if (!significant.length || covers < Math.ceil(strokeCount * 0.6)) return null;
    const best = significant.slice().sort((a, b) => a.residual - b.residual)[0];
    return { fits:significant, covers, total:strokeCount, type:best.type, residual:best.residual };
  }

  // ---------- Interactive graph widget (Plot suggestion, Graph tool) ----------
  //
  // One self-contained widget handles equations in a chosen 2D or 3D view.
  // Coordinate variables are never inferred to be slider parameters. The runtime is a
  // real function serialised into the widget, so it is linted and tested here.
  const GRAPH_COLORS = ["#2563eb", "#dc2626", "#059669", "#9333ea"];
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);
  }
  function cleanExpression(value) {
    return String(value || "").replace(/[−–—]/g, "-").replace(/[×·∗]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi")
      .trim();
  }
  // A formula that uses y as a variable is a surface z = f(x, y).
  function expressionUsesY(expression) {
    expression = cleanExpression(expression).replace(/^\s*(?:y|z|f\s*\(\s*x\s*(?:,\s*y\s*)?\))\s*=\s*/i, "");
    return /(^|[^A-Za-z_])y([^A-Za-z_]|$)/.test(expression) || /(^|[^a-z])(?:xy|yx)([^a-z]|$)/i.test(String(expression || ""));
  }
  function graphSpec(command) {
    const math = createGraphMath();
    let expressions = (Array.isArray(command?.expressions) ? command.expressions : [command?.expression]).map(cleanExpression).map(math.fromJavaScript).filter(Boolean).slice(0, 16);
    const surface = command?.mode === "3d" || command?.surface === true || command?.mode !== "2d" && expressions.some(expression => {
      if (/^[fgh]\s*\(\s*x\s*,\s*y\s*\)\s*=/.test(expression)) return true;
      try { return expression.split("=").some(side => math.compile(side).variables.includes("z")) || !expression.includes("=") && expressionUsesY(expression); } catch { return false; }
    }), mode = surface ? "3d" : "2d";
    expressions = expressions.map(expression => {
      try { return math.equation(expression,mode).shorthand ? `${surface ? "z" : "y"} = ${expression}` : expression; } catch { return expression; }
    });
    const parameters = {};
    if (command?.parameters && typeof command.parameters === "object") {
      for (const [name, value] of Object.entries(command.parameters)) {
        if (/^[a-z]$|^[a-z]_?\d$/i.test(name) && !["x", "y", "z", "e"].includes(name) && Number.isFinite(Number(value))) parameters[name] = Number(value);
        if (Object.keys(parameters).length >= 16) break;
      }
    }
    return { expressions, parameters, surface, mode };
  }

  // Robust initial y-window for curves sampled over the x-window: the x-axis is
  // always visible, outliers (asymptotes, exponentials) are clipped, and the
  // interesting part (roots, extrema) stays in view.
  function graphYWindow(values, xSpan = 20) {
    const finite = (values || []).filter(value => Number.isFinite(value) && Math.abs(value) < 1e9).sort((a, b) => a - b);
    let lo, hi;
    if (finite.length < 8) { lo = -6; hi = 6; }
    else {
      const pick = q => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
      lo = pick(0.04);
      hi = pick(0.96);
    }
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = Math.max((hi - lo) * 0.12, 0.5);
    lo -= pad;
    hi += pad;
    const maxSpan = xSpan * 12;
    if (hi - lo > maxSpan) {
      const share = -lo / (hi - lo);
      lo = -maxSpan * share;
      hi = lo + maxSpan;
    }
    return { lo, hi };
  }

  // Initial x-window: [-10, 10] unless the curve has no root or turning point
  // there, in which case the window stretches (up to |x| ≤ 100) to the nearest one
  // while keeping the origin in view.
  function graphXWindow(evaluate) {
    const features = [];
    let previous = null, previousSlope = null;
    for (let index = 0; index <= 1600; index++) {
      const x = -100 + index * 0.125;
      let y;
      try { y = evaluate(x); } catch { y = NaN; }
      if (!Number.isFinite(y)) { previous = null; previousSlope = null; continue; }
      if (previous) {
        if ((previous.y < 0) !== (y < 0) || y === 0) features.push(x);
        const slope = y - previous.y;
        if (previousSlope !== null && (previousSlope < 0) !== (slope < 0) && Math.abs(slope) > 1e-12) features.push(previous.x);
        previousSlope = slope;
      }
      previous = { x, y };
    }
    if (!features.length || features.some(x => Math.abs(x) <= 10)) return { xMin:-10, xMax:10 };
    const nearest = features.reduce((best, x) => Math.abs(x) < Math.abs(best) ? x : best, features[0]);
    return { xMin:Math.min(-2, nearest - Math.abs(nearest) * 0.4 - 3), xMax:Math.max(2, nearest + Math.abs(nearest) * 0.4 + 3) };
  }

  // Shared, dependency-free math engine, embedded in portable graph documents.
  function createGraphMath() {
    const FN = { sin:Math.sin, cos:Math.cos, tan:Math.tan, asin:Math.asin, acos:Math.acos, atan:Math.atan, arcsin:Math.asin, arccos:Math.acos, arctan:Math.atan,
      sinh:Math.sinh, cosh:Math.cosh, tanh:Math.tanh, sqrt:Math.sqrt, cbrt:Math.cbrt, abs:Math.abs, exp:Math.exp, ln:Math.log, log:Math.log10, log2:Math.log2, floor:Math.floor, ceil:Math.ceil,
      round:Math.round, sign:Math.sign, sgn:Math.sign, log10:Math.log10, sec:v => 1 / Math.cos(v), csc:v => 1 / Math.sin(v), cot:v => 1 / Math.tan(v) };
    const CONST = { pi:Math.PI, e:Math.E, tau:2 * Math.PI };
    Object.setPrototypeOf(FN,null);Object.setPrototypeOf(CONST,null);
    const SUPERSCRIPT = { "⁰":"0", "¹":"1", "²":"2", "³":"3", "⁴":"4", "⁵":"5", "⁶":"6", "⁷":"7", "⁸":"8", "⁹":"9" };
    const isDigit = c => c >= "0" && c <= "9", isLetter = c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
    function fromJavaScript(source) {
      // Hosted models may use JavaScript Math notation. Translate only known
      // math names; the expression parser still rejects property access/code.
      return String(source || "").replace(/\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|abs|exp|log10|log2|log|floor|ceil|round|sign|PI|E)\b/g,
        (_reference,name) => name === "log" ? "ln" : name === "PI" ? "pi" : name === "E" ? "e" : name);
    }
    function normalise(source) {
      let out = "";
      for (const c of fromJavaScript(source).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, text => "^(" + [...text].map(c => SUPERSCRIPT[c]).join("") + ")")) {
        if (SUPERSCRIPT[c]) out += (out.endsWith("^") ? "" : "^") + SUPERSCRIPT[c];
        else if ("−–—".includes(c)) out += "-";
        else if ("×·∗".includes(c)) out += "*";
        else if (c === "÷") out += "/";
        else if (c === "π") out += "pi";
        else if (c === "√") out += "sqrt";
        else if (c === "θ") out += "t";
        else if (c === "ω") out += "w";
        else out += c;
      }
      return out.replace(/\*\*/g, "^");
    }
    function tokenize(source) {
      const s = normalise(source), tokens = [];
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (isDigit(c) || (c === "." && isDigit(s[i + 1] || ""))) {
          let j = i;
          while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j++;
          if ((s[j] === "e" || s[j] === "E") && (isDigit(s[j + 1] || "") || ((s[j + 1] === "-" || s[j + 1] === "+") && isDigit(s[j + 2] || "")))) {
            j += 2;
            while (j < s.length && isDigit(s[j])) j++;
          }
          tokens.push(s.slice(i, j));
          i = j;
          continue;
        }
        if (isLetter(c)) {
          let j = i;
          while (j < s.length && (isLetter(s[j]) || isDigit(s[j]))) j++;
          const word = s.slice(i, j);
          // Known names stay whole; unknown runs such as "ax" or "xy" are implicit products.
          if (FN[word] || CONST[word] || word.length === 1 || /^[A-Za-z]_?\d$/.test(word)) tokens.push(word);
          else {
            let rest = word;
            while (rest) {
              const known = Object.keys(FN).concat(Object.keys(CONST)).filter(name => rest.startsWith(name)).sort((a, b) => b.length - a.length)[0];
              if (known) { tokens.push(known); rest = rest.slice(known.length); }
              else { tokens.push(rest[0]); rest = rest.slice(1); }
            }
          }
          i = j;
          continue;
        }
        if ("+-*/^(),|".includes(c)) { tokens.push(c); i++; continue; }
        throw Error("character " + c);
      }
      return tokens;
    }
    function compile(source) {
      if (String(source).length > 2000) throw Error("length");
      const tokens = tokenize(source), names = new Set();
      if (tokens.length > 1000) throw Error("length");
      let p = 0; const variables = new Set();
      const peek = () => tokens[p], take = () => tokens[p++];
      const startsAtom = t => t !== undefined && (isDigit(t[0]) || t[0] === "." || isLetter(t[0]) || t === "(");
      function expr() { let n = term(); while (peek() === "+" || peek() === "-") { const o = take(), a = n, b = term(); n = o === "+" ? (x, y, v, z) => a(x, y, v, z) + b(x, y, v, z) : (x, y, v, z) => a(x, y, v, z) - b(x, y, v, z); } return n; }
      function term() {
        let n = unary();
        for (;;) {
          if (peek() === "*" || peek() === "/") { const o = take(), a = n, b = unary(); n = o === "*" ? (x, y, v, z) => a(x, y, v, z) * b(x, y, v, z) : (x, y, v, z) => a(x, y, v, z) / b(x, y, v, z); }
          else if (startsAtom(peek())) { const a = n, b = power(); n = (x, y, v, z) => a(x, y, v, z) * b(x, y, v, z); }
          else return n;
        }
      }
      function unary() { if (peek() === "-") { take(); const a = unary(); return (x, y, v, z) => -a(x, y, v, z); } if (peek() === "+") { take(); return unary(); } return power(); }
      function power() { const base = atom(); if (peek() === "^") { take(); const ex = unary(); return (x, y, v, z) => Math.pow(base(x, y, v, z), ex(x, y, v, z)); } return base; }
      function atom() {
        const t = take();
        if (t === undefined) throw Error("end");
        if (t === "(") { const n = expr(); if (take() !== ")") throw Error(")"); return n; }
        if (t === "|") { const n = expr(); if (take() !== "|") throw Error("|"); return (x, y, v, z) => Math.abs(n(x, y, v, z)); }
        if (isDigit(t[0]) || t[0] === ".") { const k = Number(t); if (!Number.isFinite(k)) throw Error("number"); return () => k; }
        if (FN[t]) {
          const f = FN[t];
          let arg;
          // sin^2(x) means (sin x)^2.
          const ex = peek() === "^" ? (take(), atom()) : null;
          if (peek() === "(") { take(); arg = expr(); if (take() !== ")") throw Error(")"); } else arg = power();
          return ex ? (x, y, v, z) => Math.pow(f(arg(x, y, v, z)), ex(x, y, v, z)) : (x, y, v, z) => f(arg(x, y, v, z));
        }
        if (t === "x") { variables.add(t); return x => x; }
        if (t === "y") { variables.add(t); return (x, y) => y; }
        if (t === "z") { variables.add(t); return (x, y, v, z) => z; }
        if (CONST[t] !== undefined) { const k = CONST[t]; return () => k; }
        if (["f","g","h"].includes(t) && peek() === "(") throw Error("unsupported");
        if (/^[A-Za-z](?:_?\d)?$/.test(t)) { names.add(t); return (x, y, v, z) => v[t]; }
        throw Error("name " + t);
      }
      const n = expr();
      if (p !== tokens.length) throw Error("trailing");
      return { f:n, names:[...names], variables:[...variables] };
    }

    function equation(source, mode) {
      source = String(source || "").trim();
      if (!source) return { kind:"empty", names:[] };
      if (source.length > 2000) throw Error("length");
      if (/[<>≤≥{}]/.test(source)) throw Error("unsupported");
      const parts = source.split("=");
      if (parts.length > 2 || parts.some(part => !part.trim())) throw Error("equation");
      const left = parts.length === 2 ? parts[0].trim() : "", right = parts.at(-1);
      // Function notation is accepted as a plotted definition. Named calls are
      // intentionally not interpreted as multiplication by an undefined slider.
      const definition = /^([fgh])\s*\(\s*x\s*(,\s*y\s*)?\)$/.exec(left);
      const a = compile(right), axis = definition ? (definition[2] ? "z" : "y") : /^[xyz]$/.test(left) ? left : !left ? (mode === "3d" ? "z" : "y") : null;
      if (mode === "2d" && (axis === "z" || a.variables.includes("z"))) throw Error("dimension");
      if (axis && !a.variables.includes(axis)) return { kind:"explicit", axis, fn:a.f, names:a.names, variables:a.variables, shorthand:!left };
      if (/^[A-Za-z](?:_?\d)?$/.test(left) && !["x", "y", "z", "e"].includes(left)) {
        if (a.variables.length) throw Error("parameter");
        return { kind:"parameter", name:left, fn:a.f, names:a.names, variables:[] };
      }
      if (!left || definition) throw Error("equation");
      const b = compile(left), variables = [...new Set([...a.variables, ...b.variables])];
      if (mode === "2d" && variables.includes("z")) throw Error("dimension");
      if (!variables.length) throw Error("equation");
      return { kind:"implicit", fn:(x,y,v,z) => b.f(x,y,v,z) - a.f(x,y,v,z), names:[...new Set([...a.names,...b.names])], variables };
    }
    // Refine a sign-changing edge. Reject poles instead of turning a discontinuity
    // into a spurious surface. The endpoints and output are world coordinates.
    function root(fn, a, b, fa, fb, params) {
      if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
      if (fa === 0) return a;
      if (fb === 0) return b;
      if ((fa < 0) === (fb < 0)) return null;
      const tolerance = Math.max(1e-10, Math.min(Math.abs(fa), Math.abs(fb)) * 1e-5);
      for (let i=0;i<24;i++) {
        let t = fa / (fa-fb);
        if (i % 2 || !Number.isFinite(t) || t < .05 || t > .95) t = .5;
        const p = a.map((v,k) => v + t*(b[k]-v)), f = fn(p[0],p[1],params,p[2]);
        if (!Number.isFinite(f)) return null;
        if (Math.abs(f) <= tolerance) return p;
        if ((f < 0) === (fa < 0)) { a=p;fa=f; } else { b=p;fb=f; }
      }
      return null;
    }
    function contour(fn, bounds, params, nx=120, ny=100) {
      const [x0,x1,y0,y1]=bounds, points=[], values=[], lines=[];
      for(let j=0;j<=ny;j++) for(let i=0;i<=nx;i++) {
        const p=[x0+(x1-x0)*i/nx,y0+(y1-y0)*j/ny,0];points.push(p);values.push(fn(p[0],p[1],params,0));
      }
      for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) {
        const a=j*(nx+1)+i,b=a+1,c=b+nx+1,d=a+nx+1;
        for(const tri of [[a,b,c],[a,c,d]]) {
          const hits=[];
          for(let k=0;k<3;k++) {
            const u=tri[k],v=tri[(k+1)%3];
            // Half-open classification avoids duplicate vertices at grid zeros.
            if((values[u]<0)===(values[v]<0))continue;
            const p=root(fn,points[u],points[v],values[u],values[v],params);if(p)hits.push(p);
          }
          if(hits.length===2)lines.push(hits);
        }
      }
      return lines;
    }
    function polygonNormal(face) {
      // Clipping/grid zeros can leave the first three vertices collinear while
      // the remaining polygon still has area. Sum all triangles in its fan.
      const normal=[0,0,0],a=face[0];
      for(let i=1;i<face.length-1;i++) {
        const u=face[i].map((v,k)=>v-a[k]),v=face[i+1].map((v,k)=>v-a[k]);
        normal[0]+=u[1]*v[2]-u[2]*v[1];
        normal[1]+=u[2]*v[0]-u[0]*v[2];
        normal[2]+=u[0]*v[1]-u[1]*v[0];
      }
      return normal;
    }
    function mesh(row, R, params, n=36) {
      const faces=[],epsilon=R*1e-12;
      const same=(a,b)=>a.every((v,k)=>Math.abs(v-b[k])<=epsilon);
      const addFace=input=>{
        const face=[];
        for(const p of input)if(!face.length||!same(p,face[face.length-1]))face.push(p);
        if(face.length>1&&same(face[0],face[face.length-1]))face.pop();
        if(face.length>=3&&Math.hypot(...polygonNormal(face))>epsilon*epsilon)faces.push(face);
      };
      if(row.kind === "explicit") {
        const axis="xyz".indexOf(row.axis),other=[0,1,2].filter(k=>k!==axis),grid=[];
        for(let i=0;i<=n;i++)for(let j=0;j<=n;j++) {
          const p=[0,0,0];p[other[0]]=-R+2*R*i/n;p[other[1]]=-R+2*R*j/n;
          p[axis]=row.fn(p[0],p[1],params,p[2]);grid.push(p);
        }
        // Clip polygons to the box; clamping individual heights creates false
        // flat caps on functions that continue outside the visible domain.
        const clip = input => {
          let out=input;
          for(const sign of [-1,1]) {
            const before=out;out=[];
            for(let i=0;i<before.length;i++) {
              const a=before[i],b=before[(i+1)%before.length],inside=sign*a[axis]<=R,next=sign*b[axis]<=R;
              if(inside)out.push(a);
              if(inside!==next) {
                const t=(sign*R-a[axis])/(b[axis]-a[axis]),p=a.map((v,k)=>v+t*(b[k]-v));
                p[axis]=sign*R;out.push(p);
              }
            }
          }
          return out;
        };
        for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
          const a=i*(n+1)+j,b=a+n+1,c=b+1,d=a+1;
          for(const indices of [[a,b,c],[a,c,d]]) {
            const tri=indices.map(k=>grid[k]);
            if(tri.some(p=>!Number.isFinite(p[axis])))continue;
            // Do not connect opposite sides of a pole.
            const center=tri[0].map((_,k)=>(tri[0][k]+tri[1][k]+tri[2][k])/3),f=row.fn(center[0],center[1],params,center[2]);
            if(!Number.isFinite(f)||Math.abs(f-center[axis])>R)continue;
            addFace(clip(tri));
          }
        }
        return faces;
      }
      if(row.kind !== "implicit")return faces;
      const points=[],values=[],size=n+1,index=(i,j,k)=>(i*size+j)*size+k;
      for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)for(let k=0;k<=n;k++) {
        const p=[-R+2*R*i/n,-R+2*R*j/n,-R+2*R*k/n];points.push(p);values.push(row.fn(p[0],p[1],params,p[2]));
      }
      // Consistent six-tetrahedron decomposition gives matching shared faces.
      const tetrahedra=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
      const crossing=(a,b)=>root(row.fn,points[a],points[b],values[a],values[b],params);
      for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let k=0;k<n;k++) {
        const cube=[index(i,j,k),index(i+1,j,k),index(i,j+1,k),index(i+1,j+1,k),index(i,j,k+1),index(i+1,j,k+1),index(i,j+1,k+1),index(i+1,j+1,k+1)];
        const vals=cube.map(v=>values[v]);if(vals.some(v=>!Number.isFinite(v))||vals.every(v=>v>=0)||vals.every(v=>v<0))continue;
        for(const t of tetrahedra) {
          const ins=t.map(v=>cube[v]).filter(v=>values[v]<0),outs=t.map(v=>cube[v]).filter(v=>values[v]>=0);
          let face;
          if(ins.length===1)face=outs.map(v=>crossing(ins[0],v));
          else if(outs.length===1)face=ins.map(v=>crossing(v,outs[0]));
          else if(ins.length===2)face=[crossing(ins[0],outs[0]),crossing(ins[0],outs[1]),crossing(ins[1],outs[1]),crossing(ins[1],outs[0])];
          if(face&&face.every(Boolean))addFace(face);
        }
      }
      return faces;
    }
    return { compile, equation, contour, mesh, polygonNormal, fromJavaScript };
  }

  // Serialised into the widget. Must stay dependency-free and not use eval.
  function graphRuntime(D) {
    "use strict";
    const zh = D.language === "zh", T = zh
      ? { add:"+ 添加", hint2:"拖动平移 · 滚轮缩放", hint3:"拖动旋转 · 滚轮缩放 · 曲面为数值近似", play:"动画", home:"复位", in:"放大", out:"缩小", surface:"曲面", curve:"曲线", bad:"请检查运算符、括号和函数写法。", expression:"表达式", remove:"删除表达式", mode:"绘图维度", equation:"请在等号两边输入有效的表达式。", dimension:"此公式含 z，请切换到 3D。", unsupported:"暂不支持不等式、条件限制或自定义函数调用。", parameter:"参数定义不能包含坐标变量。", duplicate:"此参数已在其他行定义。", dependency:"参数定义存在循环或无效依赖。", length:"表达式过长，请限制在 2000 个字符内。", value:"参数需要有限的数值。", example2:"例如 y = sin(x) 或 x² + y² = 4", example3:"例如 z = sin(x) cos(y)", shorthand:"按以下方程绘制：", support:"支持坐标方程、隐式方程和参数（如 a = 1）。三维中，不含 z 的方程沿 z 方向延伸。" }
      : { add:"+ Add", hint2:"Drag to pan · scroll to zoom", hint3:"Drag to rotate · scroll to zoom · numerical surfaces", play:"Animate", home:"Reset view", in:"Zoom in", out:"Zoom out", surface:"Surface", curve:"Curve", bad:"Check operators, parentheses and function notation.", expression:"Expression", remove:"Remove expression", mode:"Graph dimension", equation:"Enter a valid expression on each side of the equals sign.", dimension:"This equation uses z. Switch to 3D.", unsupported:"Inequalities, restrictions and custom function calls are not supported yet.", parameter:"A parameter definition cannot contain coordinates.", duplicate:"This parameter is already defined in another row.", dependency:"Circular or invalid parameter dependency.", length:"Keep expressions within 2000 characters.", value:"A parameter must have a finite value.", example2:"e.g. y = sin(x) or x² + y² = 4", example3:"e.g. z = sin(x) cos(y)", shorthand:"Plotted as: ", support:"Coordinate equations, implicit equations and parameters (e.g. a = 1). In 3D, equations without z extend along the z axis." };
    const math = createGraphMath();
    const state = { rows:[], params:{ ...D.parameters }, view2:null, view3:D.view3 || null, anim:null, hover:null, mode:D.mode === "3d" ? "3d" : "2d" };
    const $ = id => document.getElementById(id);
    const rowsEl = $("rows"), paramsEl = $("params"), cv = $("c"), ctx = cv.getContext("2d"), readout = $("readout"), hint = $("hint"), badge = $("badge");
    $("add").textContent = T.add;
    $("zin").title = T.in; $("zout").title = T.out; $("home").title = T.home;
    $("mode").setAttribute("aria-label", T.mode);$("support").textContent = T.support;
    for(const id of ["zin","zout","home"])$(id).setAttribute("aria-label",$(id).title);
    let rowId = 0, revision = 0, interactionSequence = 0;
    const geometry = new Map();
    function interactionId(kind) { return kind + "-" + (++interactionSequence); }
    function publish(interaction) {
      const V=state.view2,w=cv.clientWidth,h=cv.clientHeight;
      parent.postMessage({type:"penecho-graph-change",...(interaction ? {interaction} : {}),document:{version:2,mode:state.mode,expressions:state.rows.map(r=>r.src),parameters:{...state.params},view3:state.view3,window2:V ? [V.cx-w/2/V.sx,V.cx+w/2/V.sx,V.cy-h/2/V.sy,V.cy+h/2/V.sy] : null}},"*");
    }
    function fmt(v) { const a=Math.abs(v);return a>=1e4||(a&&a<1e-3)?v.toExponential(2):String(+v.toFixed(a>=100?1:a>=10?2:3)); }
    function parse(row) {
      row.kind="empty";row.fn=null;row.names=[];row.axis=null;row.error="";row.shorthand=false;
      try {Object.assign(row,math.equation(row.src,state.mode));}catch(error){row.error=T[error.message]||T.bad;}row.parseError=row.error;
    }
    function showError(row) {
      row.el.classList.toggle("bad",!!row.error);row.input.setAttribute("aria-invalid",String(!!row.error));
      row.message.textContent=row.error||(row.shorthand?T.shorthand+(state.mode==="3d"?"z":"y")+" = …":"");row.message.hidden=!row.message.textContent;
    }
    function syncMode() {
      badge.textContent=state.mode==="3d"?"3D · "+T.surface:"2D · "+T.curve;hint.textContent=state.mode==="3d"?T.hint3:T.hint2;
      for(const mode of ["2d","3d"])$(mode).setAttribute("aria-pressed",String(state.mode===mode));
      for(const row of state.rows)row.input.dataset.placeholder=state.mode==="3d"?T.example3:T.example2;
    }
    for(const mode of ["2d","3d"])$(mode).onclick=()=>{
      if(mode===state.mode)return;
      // Materialize shorthand before changing dimension to preserve its meaning.
      for(const row of state.rows)if(row.shorthand){row.src=(state.mode==="3d"?"z":"y")+" = "+row.src;row.input.textContent=row.src;}
      state.mode=mode;state.hover=null;readout.classList.remove("on");refresh();
    };
    function addRow(src) {
      if(state.rows.length>=16)return;
      const row={src:String(src||""),fn:null,color:D.colors[state.rows.length%D.colors.length]};state.rows.push(row);
      const el=document.createElement("div"),dot=document.createElement("span"),body=document.createElement("div"),input=document.createElement("div"),del=document.createElement("button"),message=document.createElement("div");
      el.className="row";dot.className="dot";dot.style.background=row.color;body.className="formula-body";
      // Real text nodes wrap naturally and are also captured by the PNG renderer.
      input.className="expression";input.contentEditable = "plaintext-only";input.textContent=row.src;input.spellcheck=false;
      input.setAttribute("role","textbox");input.setAttribute("aria-multiline","true");input.setAttribute("aria-label",T.expression);
      message.id="formula-message-"+(++rowId);message.className="formula-message";message.setAttribute("aria-live","polite");input.setAttribute("aria-describedby",message.id);
      del.textContent="×";del.title=T.remove;del.setAttribute("aria-label",T.remove);
      del.onclick=()=>{const k=state.rows.indexOf(row);if(k<0)return;state.rows.splice(k,1);el.remove();if(!state.rows.length)addRow("");refresh();};
      input.oninput=()=>{
        if(input.innerText.length>2000){input.textContent=row.src;row.error=T.length;showError(row);return;}
        row.src = input.innerText;refresh();
      };
      input.onblur=()=>{if(!row.src.trim()){input.textContent="";row.src="";}};
      Object.assign(row,{el,input,message});body.append(input,message);el.append(dot,body,del);rowsEl.append(el);
    }
    function evaluateParameters() {
      const definitions=new Map(),visiting=new Set(),done=new Set(),names=new Set();
      for(const row of state.rows){
        row.error=row.parseError;for(const n of row.names)names.add(n);
        const declaration=/^\s*([A-Za-z](?:_?\d)?)\s*=/.exec(row.src),name=declaration?.[1];
        if(row.kind==="parameter" || name && !["x","y","z","e"].includes(name)){
          row.name=name || row.name;
          if(definitions.has(row.name)){row.error=T.duplicate;definitions.get(row.name).error=T.duplicate;}else definitions.set(row.name,row);
        }
      }
      for(const n of definitions.keys())state.params[n]=NaN;
      for(const n of names)if(!definitions.has(n)&&!Number.isFinite(state.params[n]))state.params[n]=1;
      function visit(n) {
        if(done.has(n))return;const row=definitions.get(n);if(!row)return;
        if(visiting.has(n)||row.error)throw Error(T.dependency);visiting.add(n);
        try{row.names.forEach(visit);const value=row.fn(0,0,state.params,0);if(!Number.isFinite(value))throw Error(T.value);state.params[n]=value;done.add(n);}
        catch(error){row.error=row.error||error.message;state.params[n]=NaN;throw error;}finally{visiting.delete(n);}
      }
      for(const n of definitions.keys())try{visit(n);}catch{}
      for(const row of state.rows)if(!row.error&&row.names.some(n=>!Number.isFinite(state.params[n])))row.error=T.dependency;
      // Keep free slider values while their expressions are temporarily incomplete.
      // Only active parameters are shown; stored values are bounded on ingestion.
      for(const n of Object.keys(state.params))if(!names.has(n)&&!definitions.has(n)&&(!Number.isFinite(state.params[n])||Object.keys(state.params).length>64))delete state.params[n];
      return {names,definitions};
    }
    function refresh(save=true) {
      state.anim=null;state.hover=null;readout.classList.remove("on");state.rows.forEach(parse);
      const parameters=evaluateParameters();syncMode();syncParams(parameters);state.rows.forEach(showError);
      $("add").disabled=state.rows.length>=16;geometry.clear();revision++;
      if(state.mode==="2d"&&!state.view2)home2();if(state.mode==="3d"&&!state.view3)home3();draw();if(save)publish();
    }
    function setParameter(name,value,definition) {
      state.params[name]=value;if(definition){definition.src=name+" = "+String(+value.toPrecision(12));definition.input.textContent=definition.src;parse(definition);}
      // Geometry keys include each row's evaluated dependencies. An animated
      // parameter must not invalidate unrelated (especially implicit) surfaces.
      evaluateParameters();state.rows.forEach(showError);revision++;draw();
      for(const out of paramsEl.querySelectorAll("output"))out.textContent=fmt(state.params[out.dataset.name]);
    }
    function syncParams({names,definitions}) {
      paramsEl.textContent="";for(const n of definitions.keys())names.add(n);
      for(const n of [...names].sort()){
        const definition=definitions.get(n),v=state.params[n];if(!Number.isFinite(v)||definition?.error)continue;
        const span=Math.max(5,Math.abs(v)*2),min=+(v-span).toFixed(3),max=+(v+span).toFixed(3);
        const wrap=document.createElement("div"),lab=document.createElement("label"),r=document.createElement("input"),out=document.createElement("output"),play=document.createElement("button");
        wrap.className="param";lab.textContent=n;r.type="range";r.id="parameter-"+n;lab.htmlFor=r.id;r.min=min;r.max=max;r.step=(max-min)/400;r.value=v;out.dataset.name=n;out.textContent=fmt(v);
        if(definition?.names.length){wrap.append(lab,out);paramsEl.append(wrap);continue;}
        let parameterInteraction=null,parameterEndTimer=0,pointerActive=false,keyActive=false;
        const beginParameter=()=>{
          clearTimeout(parameterEndTimer);parameterEndTimer=0;
          if(!parameterInteraction)parameterInteraction=interactionId("parameter");
        };
        const endParameter=()=>{
          if(!parameterInteraction || pointerActive || keyActive)return;
          clearTimeout(parameterEndTimer);
          // Range controls may dispatch their final input/change after pointerup.
          // Keep the token through that event turn before closing the interaction.
          parameterEndTimer=setTimeout(()=>{
            publish({id:parameterInteraction,phase:"end"});parameterInteraction=null;parameterEndTimer=0;
          },0);
        };
        r.onpointerdown=()=>{pointerActive=true;beginParameter();};
        r.onpointerup=r.onpointercancel=r.onlostpointercapture=()=>{pointerActive=false;endParameter();};
        r.onkeydown=e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(e.key)){keyActive=true;beginParameter();}};
        r.onkeyup=()=>{keyActive=false;endParameter();};
        r.onblur=()=>{pointerActive=keyActive=false;endParameter();};
        r.onchange=endParameter;
        r.oninput=()=>{
          beginParameter();state.anim=null;setParameter(n,Number(r.value),definition);publish({id:parameterInteraction,phase:"update"});endParameter();
        };
        play.className="play";play.title=T.play;play.textContent="▶";play.setAttribute("aria-label",T.play+" "+n);
        play.onclick=()=>{
          if(state.anim?.name===n){state.anim=null;play.textContent="▶";play.classList.remove("on");draw();publish();return;}
          for(const b of paramsEl.querySelectorAll(".play")){b.textContent="▶";b.classList.remove("on");}
          state.anim={name:n,min,max,r,out,definition,dir:1,last:0};play.textContent="■";play.classList.add("on");scheduleTick();
        };
        wrap.append(lab,r,out,play);paramsEl.append(wrap);
      }
    }
    let animationFrame=0;
    function scheduleTick() { if(!animationFrame)animationFrame=requestAnimationFrame(tick); }
    function tick(now) {
      animationFrame=0;
      const a=state.anim;if(!a)return;
      if(!a.last){a.last=now;scheduleTick();return;}
      const elapsed=now-a.last;
      if(elapsed<1000/30-.5){scheduleTick();return;}
      a.last=now;
      // Match the original 60 Hz playback speed while leaving time for the
      // rest of the Canvas. Slow frames do not slow the parameter's motion.
      let v=state.params[a.name]+(a.max-a.min)*Math.min(elapsed,100)/4000*a.dir;
      if(v>a.max){v=2*a.max-v;a.dir=-1;}if(v<a.min){v=2*a.min-v;a.dir=1;}
      setParameter(a.name,v,a.definition);a.r.value=v;a.out.textContent=fmt(v);scheduleTick();
    }
    function nice(span, target) { const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }

    // ---------- 2D ----------
    function home2() {
      const w = cv.clientWidth || 1, h = cv.clientHeight || 1, rows = state.rows.filter(r => r.kind === "explicit" && r.axis === "y" && !r.error);
      const first = rows[0], windowX = first ? D.xWindow(x => first.fn(x, 0, state.params)) : { xMin:-10, xMax:10 }, span = windowX.xMax - windowX.xMin, values = [];
      for (const r of rows) for (let i = 0; i <= 400; i++) { let y; try { y = r.fn(windowX.xMin + span * i / 400, 0, state.params); } catch { y = NaN; } values.push(y); }
      const { lo, hi } = rows.length ? D.yWindow(values, span) : { lo:-h / w * span / 2, hi:h / w * span / 2 }, sx = w / span, sy = h / (hi - lo);
      state.view2 = { cx:(windowX.xMin + windowX.xMax) / 2, cy:(hi + lo) / 2, sx, sy };
    }
    function draw2() {
      const w = cv.clientWidth, h = cv.clientHeight, V = state.view2; if (!V || !w || !h) return;
      const fs = Math.max(10, Math.round(Math.min(w, h) / 40)), lw = Math.max(1.4, Math.min(w, h) / 230);
      const X = x => w / 2 + (x - V.cx) * V.sx, Y = y => h / 2 - (y - V.cy) * V.sy, ix = px => V.cx + (px - w / 2) / V.sx;
      const x0 = ix(0), x1 = ix(w), y0 = V.cy - h / 2 / V.sy, y1 = V.cy + h / 2 / V.sy, sx = nice(x1 - x0, 9), sy = nice(y1 - y0, 7);
      ctx.lineWidth = 1; ctx.strokeStyle = "#eef2f7"; ctx.beginPath();
      for (let x = Math.ceil(x0 / sx * 5) * sx / 5; x <= x1; x += sx / 5) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), h); }
      for (let y = Math.ceil(y0 / sy * 5) * sy / 5; y <= y1; y += sy / 5) { ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); }
      ctx.stroke();
      ctx.strokeStyle = "#dde3ea"; ctx.beginPath();
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), h); }
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) { ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); }
      ctx.stroke();
      // Axes are pinned to the edge when the origin leaves the view, so both stay visible.
      const ax = Math.min(h - fs * 1.6, Math.max(fs * 0.4, Y(0))), ay = Math.min(w - fs * 0.6, Math.max(fs * 2.6, X(0)));
      ctx.strokeStyle = "#334155"; ctx.lineWidth = Math.max(1.2, lw * 0.75); ctx.beginPath(); ctx.moveTo(0, ax); ctx.lineTo(w, ax); ctx.moveTo(ay, 0); ctx.lineTo(ay, h); ctx.stroke();
      ctx.fillStyle = "#334155"; ctx.beginPath(); ctx.moveTo(w - 2, ax); ctx.lineTo(w - 2 - fs * 0.7, ax - fs * 0.35); ctx.lineTo(w - 2 - fs * 0.7, ax + fs * 0.35); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ay, 2); ctx.lineTo(ay - fs * 0.35, 2 + fs * 0.7); ctx.lineTo(ay + fs * 0.35, 2 + fs * 0.7); ctx.fill();
      ctx.font = "italic " + fs + "px ui-serif, Georgia, serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText("x", w - fs * 0.4, ax - fs * 0.35);
      ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("y", ay + fs * 0.45, fs * 0.2);
      ctx.fillStyle = "#64748b"; ctx.font = fs + "px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) { if (Math.abs(x) < sx / 2 || X(x) > w - fs * 1.5 || X(x) < fs * 1.5) continue; ctx.fillText(fmt(+x.toPrecision(10)), X(x), ax + fs * 0.35); }
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) { if (Math.abs(y) < sy / 2 || Y(y) < fs * 1.5 || Y(y) > h - fs) continue; ctx.fillText(fmt(+y.toPrecision(10)), ay - fs * 0.4, Y(y)); }
      ctx.fillText("0", ay - fs * 0.4, ax + fs * 0.6);
      for (const r of state.rows) {
        if (!r.fn || r.error || r.kind === "parameter") continue;
        if(r.kind === "implicit") {
          const key=JSON.stringify([revision,x0,x1,y0,y1]),cached=geometry.get(r);
          const lines=cached?.key===key ? cached.lines : math.contour(r.fn,[x0,x1,y0,y1],state.params);
          geometry.set(r,{key,lines});ctx.strokeStyle=r.color;ctx.lineWidth=lw*1.6;ctx.beginPath();
          for(const [a,b] of lines){ctx.moveTo(X(a[0]),Y(a[1]));ctx.lineTo(X(b[0]),Y(b[1]));}ctx.stroke();continue;
        }
        if(r.axis === "x") {
          ctx.strokeStyle=r.color;ctx.lineWidth=lw*1.6;ctx.beginPath();let previous=null;
          for(let i=0;i<=h;i++){const y=y1-(y1-y0)*i/h,x=r.fn(0,y,state.params,0),px=X(x);if(!Number.isFinite(px)||Math.abs(px)>20*w){previous=null;continue;}if(previous!==null&&Math.abs(px-previous)<w*1.5)ctx.lineTo(px,i);else ctx.moveTo(px,i);previous=px;}ctx.stroke();continue;
        }
        ctx.strokeStyle = r.color; ctx.lineWidth = lw * 1.6; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
        let pen = false, prev = null;
        const n = Math.ceil(w * 1.5);
        for (let i = 0; i <= n; i++) {
          const px = i * w / n, x = ix(px);
          let y; try { y = r.fn(x, 0, state.params); } catch { y = NaN; }
          const py = Y(y);
          if (!Number.isFinite(py) || Math.abs(py) > h * 20) { pen = false; prev = null; continue; }
          if (pen && prev !== null && Math.abs(py - prev) > h * 1.5) pen = false;
          if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
          prev = py;
        }
        ctx.stroke();
        ctx.fillStyle = r.color;
        let last = null;
        for (let i = 0; i <= n; i++) {
          const x = ix(i * w / n), y = r.fn(x, 0, state.params);
          if (Number.isFinite(y) && last && Number.isFinite(last.y) && (last.y < 0) !== (y < 0) && Math.abs(y - last.y) < (y1 - y0)) {
            const rx = last.x - last.y * (x - last.x) / (y - last.y); ctx.beginPath(); ctx.arc(X(rx), Y(0), lw * 1.6, 0, 7); ctx.fill();
          }
          last = { x, y };
        }
      }
      if (state.hover) {
        const { row, x, y } = state.hover, hr = Math.max(4, Math.min(w, h) / 70);
        ctx.fillStyle = row.color; ctx.beginPath(); ctx.arc(X(x), Y(y), hr, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = hr / 2.5; ctx.stroke();
      }
    }

    // ---------- 3D ----------
    let surfaceRenderer=null,surfaceSnapshot=false;
    function renderSurfaces(faces,w,h) {
      if(!surfaceRenderer) {
        const canvas=document.createElement("canvas");
        let gl=null;
        try {
          gl=canvas.getContext("webgl",{alpha:true,antialias:true,preserveDrawingBuffer:true});
          if(gl) {
            const shader=(type,source)=>{
              const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
              if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error("Graph surface shader");
              return s;
            },vertex=shader(gl.VERTEX_SHADER,"attribute vec4 position;attribute vec3 color;varying vec3 tint;void main(){gl_Position=position;tint=color;}"),
              fragment=shader(gl.FRAGMENT_SHADER,"precision mediump float;varying vec3 tint;void main(){gl_FragColor=vec4(tint,1.0);}"),program=gl.createProgram();
            gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
            gl.deleteShader(vertex);gl.deleteShader(fragment);
            if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error("Graph surface program");
            gl.useProgram(program);
            const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
            const position=gl.getAttribLocation(program,"position"),color=gl.getAttribLocation(program,"color");
            gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,4,gl.FLOAT,false,28,0);
            gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,3,gl.FLOAT,false,28,16);
            gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(0,0,0,0);
          }
        }catch(_error){gl=null;}
        surfaceRenderer={canvas,gl};
      }
      const renderer=surfaceRenderer,gl=renderer.gl,
        // Keep axes/text at device resolution. Bound only the animated surface
        // layer; paused views and exports retain the full-resolution depth pass.
        ratio=state.anim&&!surfaceSnapshot?Math.min(1,Math.sqrt(1500000/(cv.width*cv.height))):1,
        width=Math.max(1,Math.round(cv.width*ratio)),height=Math.max(1,Math.round(cv.height*ratio));
      if(gl&&!gl.isContextLost()) {
        if(renderer.canvas.width!==width||renderer.canvas.height!==height) {
          renderer.canvas.width=width;renderer.canvas.height=height;
        }
        gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        const count=faces.reduce((sum,face)=>sum+(face.pts.length-2)*3,0);
        if(!renderer.vertices||renderer.vertices.length<count*7)renderer.vertices=new Float32Array(count*7);
        const vertices=renderer.vertices.subarray(0,count*7);
        let offset=0;
        for(const face of faces)for(let i=1;i<face.pts.length-1;i++)for(const p of [face.pts[0],face.pts[i],face.pts[i+1]]) {
          // Preserve the existing projection in homogeneous coordinates. Depth
          // interpolation now resolves intersecting faces at each pixel.
          const k=1+.18*p.d;
          vertices[offset++]=(2*p.x/w-1)*k;vertices[offset++]=(1-2*p.y/h)*k;
          vertices[offset++]=.35*p.d;vertices[offset++]=k;
          for(const color of face.color)vertices[offset++]=color/255;
        }
        gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,count);
        ctx.drawImage(renderer.canvas,0,0,w,h);return;
      }
      // A depth-buffer fallback keeps correct occlusion when WebGL is absent or
      // its context is lost. Reuse backing pixels and perspective-correct depth.
      if(!renderer.image||renderer.image.width!==width||renderer.image.height!==height) {
        const fallback=document.createElement("canvas");fallback.width=width;fallback.height=height;
        renderer.context=fallback.getContext("2d");
        renderer.image=renderer.context.createImageData(width,height);renderer.depth=new Float32Array(width*height);
      }
      const image=renderer.image,depth=renderer.depth,sx=width/w,sy=height/h;
      image.data.fill(0);depth.fill(-Infinity);
      for(const face of faces)for(let i=1;i<face.pts.length-1;i++) {
        const points=[face.pts[0],face.pts[i],face.pts[i+1]].map(p=>({x:p.x*sx,y:p.y*sy,z:1/(1+.18*p.d)})),[a,b,c]=points,
          area=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
        if(Math.abs(area)<1e-10)continue;
        const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x))),
          y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
          const u=((b.y-c.y)*(x+.5-c.x)+(c.x-b.x)*(y+.5-c.y))/area,
            v=((c.y-a.y)*(x+.5-c.x)+(a.x-c.x)*(y+.5-c.y))/area,t=1-u-v;
          if(u< -1e-8||v< -1e-8||t< -1e-8)continue;
          const z=u*a.z+v*b.z+t*c.z,index=y*width+x;
          if(z<depth[index])continue;
          depth[index]=z;const pixel=index*4;
          image.data[pixel]=face.color[0];image.data[pixel+1]=face.color[1];image.data[pixel+2]=face.color[2];image.data[pixel+3]=255;
        }
      }
      renderer.context.putImageData(image,0,0);
      ctx.drawImage(renderer.context.canvas,0,0,w,h);
    }
    function home3() { state.view3 = { az:-0.85, el:0.55, R:5, zoom:1 }; }
    function draw3() {
      const w = cv.clientWidth, h = cv.clientHeight, V = state.view3; if (!V || !w || !h) return;
      const fs = Math.max(10, Math.round(Math.min(w, h) / 40)), R = V.R, lo = -R, hi = R, zs = 2 * R;
      const ca = Math.cos(V.az), sa = Math.sin(V.az), ce = Math.cos(V.el), se = Math.sin(V.el), scale = Math.min(w, h) * 0.26 * V.zoom, cx = w / 2, cy = h * 0.52;
      // Equal scale on all three world axes preserves spheres and angles.
      const P = (x, y, z) => {
        const X = x / R, Y = y / R, Z = z / R;
        const x1 = X * ca - Y * sa, y1 = X * sa + Y * ca;
        const depth = y1 * ce + Z * se;
        const zz = Z * ce - y1 * se;
        const persp = 1 / (1 + depth * 0.18);
        return { x:cx + x1 * scale * persp, y:cy - zz * scale * persp, d:depth };
      };
      const corners = [];
      for (const x of [-R, R]) for (const y of [-R, R]) for (const z of [lo, hi]) corners.push({ x, y, z, p:P(x, y, z) });
      const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      const farthest = corners.reduce((best, c, i) => c.p.d > corners[best].p.d ? i : best, 0);
      ctx.lineWidth = 1;
      // Back panes of the box: light grid on the three faces that meet at the farthest corner.
      ctx.strokeStyle = "#e5e7eb";
      for (const [a, b] of edges) if (a === farthest || b === farthest) { const A = corners[a].p, B = corners[b].p; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); }
      const floorZ = lo, tick = nice(2 * R, 5);
      ctx.strokeStyle = "#eef2f7";
      for (let t = Math.ceil(-R / tick) * tick; t <= R + 1e-9; t += tick) {
        let A = P(t, -R, floorZ), B = P(t, R, floorZ); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        A = P(-R, t, floorZ); B = P(R, t, floorZ); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      // Cache world geometry so rotating the camera never resamples equations.
      const quads = [];
      state.rows.forEach((r,index)=>{
        if(!r.fn||r.error||r.kind==="parameter")return;
        const key=JSON.stringify([R,...r.names.map(name=>state.params[name])]),cached=geometry.get(r),faces=cached?.key===key?cached.faces:math.mesh(r,R,state.params);
        geometry.set(r,{key,faces});
        for(const face of faces) {
          const pts=face.map(p=>P(...p)),normal=math.polygonNormal(face),length=Math.hypot(...normal);
          if(!length)continue;
          const shade=.5+.5*Math.abs((normal[0]*.3+normal[1]*.4+normal[2]*.87)/length);
          const color=hexRgb(r.color,1).map(c=>Math.round(c*shade));
          quads.push({pts,color});
        }
      });
      renderSurfaces(quads,w,h);
      // Front box edges, axes and labels.
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1;
      for (const [a, b] of edges) if (a !== farthest && b !== farthest) { const A = corners[a].p, B = corners[b].p; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); }
      ctx.fillStyle = "#475569"; ctx.font = fs + "px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const nearY = corners[farthest].y > 0 ? -R : R, nearX = corners[farthest].x > 0 ? -R : R;
      for (let t = Math.ceil(-R / tick) * tick; t <= R + 1e-9; t += tick) {
        let q = P(t, nearY * 1.12, lo); ctx.fillText(fmt(+t.toPrecision(8)), q.x, q.y);
        q = P(nearX * 1.12, t, lo); ctx.fillText(fmt(+t.toPrecision(8)), q.x, q.y);
      }
      const zt = nice(zs, 4), vertical = [[-R, -R], [-R, R], [R, -R], [R, R]].map(([x, y]) => ({ x, y, p:P(x, y, lo) })).sort((a, b) => a.p.x - b.p.x)[0];
      ctx.textAlign = "right";
      for (let t = Math.ceil(lo / zt) * zt; t <= hi + 1e-9; t += zt) { const q = P(vertical.x, vertical.y, t); ctx.fillText(fmt(+t.toPrecision(8)), q.x - fs * 0.6, q.y); }
      ctx.strokeStyle = "#94a3b8"; const zb = P(vertical.x, vertical.y, lo), zt2 = P(vertical.x, vertical.y, hi); ctx.beginPath(); ctx.moveTo(zb.x, zb.y); ctx.lineTo(zt2.x, zt2.y); ctx.stroke();
      ctx.textAlign = "center";
      ctx.font = "italic " + Math.round(fs * 1.15) + "px ui-serif, Georgia, serif"; ctx.fillStyle = "#1f2937";
      let q = P(0, nearY * 1.3, lo); ctx.fillText("x", q.x, q.y);
      q = P(nearX * 1.3, 0, lo); ctx.fillText("y", q.x, q.y);
      q = P(vertical.x, vertical.y, hi + zs * 0.16); ctx.fillText("z", q.x - fs * 0.6, q.y);
    }
    function hexRgb(hex, t) {
      const v = parseInt(hex.slice(1), 16), k = 0.55 + 0.45 * t;
      return [((v >> 16) & 255) * k, ((v >> 8) & 255) * k, (v & 255) * k];
    }
    function draw() {
      const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      if (state.mode === "3d") draw3(); else draw2();
    }
    let plotSize = { w:0, h:0, d:0 };
    function resize() {
      // CSS layout owns the viewport. Backing pixels must never feed back into
      // grid sizing, and presentation zoom must not change drawing coordinates.
      const w = cv.clientWidth, h = cv.clientHeight, d = window.devicePixelRatio || 1;
      if (!w || !h || w === plotSize.w && h === plotSize.h && d === plotSize.d) return;
      cv.width = Math.max(1, Math.round(w * d)); cv.height = Math.max(1, Math.round(h * d));
      ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
      if (state.view2 && plotSize.w && plotSize.h) {
        // Keep the mathematical window, including the user's pan and zoom.
        state.view2.sx *= w / plotSize.w;
        state.view2.sy *= h / plotSize.h;
      } else if (state.mode === "2d" && !state.view2) home2();
      if (state.mode === "3d" && !state.view3) home3();
      plotSize = { w, h, d };
      drag = null; state.hover = null; cv.classList.remove("drag"); readout.classList.remove("on");
      draw();
    }
    function pointerPoint(e) {
      const r = cv.getBoundingClientRect();
      return { x:(e.clientX - r.left) * cv.clientWidth / r.width, y:(e.clientY - r.top) * cv.clientHeight / r.height };
    }
    let drag = null;
    cv.addEventListener("pointerdown", e => {
      drag = { ...pointerPoint(e), id:interactionId("camera"), v2:state.view2 && { ...state.view2 }, v3:state.view3 && { ...state.view3 } };
      cv.setPointerCapture(e.pointerId); cv.classList.add("drag");
    });
    cv.addEventListener("pointermove", e => {
      const point = pointerPoint(e);
      if (drag) {
        if (state.mode === "3d") { const V = state.view3; V.az = drag.v3.az + (point.x - drag.x) * 0.01; V.el = Math.max(-0.2, Math.min(1.45, drag.v3.el + (point.y - drag.y) * 0.01)); }
        else { const V = state.view2; V.cx = drag.v2.cx - (point.x - drag.x) / V.sx; V.cy = drag.v2.cy + (point.y - drag.y) / V.sy; }
        state.hover = null; readout.classList.remove("on"); draw(); publish({id:drag.id,phase:"update"}); return;
      }
      if (state.mode !== "2d") return;
      const V = state.view2, px = point.x, py = point.y, x = V.cx + (px - cv.clientWidth / 2) / V.sx;
      let best = null;
      for (const row of state.rows) {
        if (!row.fn || row.error || row.kind !== "explicit" || row.axis !== "y") continue;
        const y = row.fn(x, 0, state.params); if (!Number.isFinite(y)) continue;
        const d = Math.abs(cv.clientHeight / 2 - (y - V.cy) * V.sy - py);
        if (d < 28 && (!best || d < best.d)) best = { d, row, x, y };
      }
      state.hover = best; readout.classList.toggle("on", !!best);
      if (best) readout.textContent = "x = " + fmt(best.x) + "   y = " + fmt(best.y);
      draw();
    });
    const end = () => { if(drag)publish({id:drag.id,phase:"end"});drag = null; cv.classList.remove("drag"); };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("lostpointercapture", end);
    cv.addEventListener("pointerleave", () => { state.hover = null; readout.classList.remove("on"); draw(); });
    function zoom(f, px, py) {
      if (state.mode === "3d") { state.view3.R = Math.max(0.2, Math.min(200, state.view3.R / f)); draw(); return; }
      const V = state.view2, w = cv.clientWidth, h = cv.clientHeight; px = px ?? w / 2; py = py ?? h / 2;
      const x = V.cx + (px - w / 2) / V.sx, y = V.cy - (py - h / 2) / V.sy;
      V.sx *= f; V.sy *= f; V.cx = x - (px - w / 2) / V.sx; V.cy = y + (py - h / 2) / V.sy; draw();
    }
    let wheelInteraction=null,wheelEndTimer=0;
    cv.addEventListener("wheel", e => {
      e.preventDefault();const point=pointerPoint(e);zoom(Math.exp(-e.deltaY * 0.0015),point.x,point.y);
      if(!wheelInteraction)wheelInteraction=interactionId("wheel");
      publish({id:wheelInteraction,phase:"update"});clearTimeout(wheelEndTimer);
      wheelEndTimer=setTimeout(()=>{publish({id:wheelInteraction,phase:"end"});wheelInteraction=null;wheelEndTimer=0;},180);
    }, { passive:false });
    $("zin").onclick = () => {zoom(1.25);publish();}; $("zout").onclick = () => {zoom(0.8);publish();};
    $("home").onclick = () => { if (state.mode === "3d") home3(); else home2(); draw();publish(); };
    $("add").onclick = () => { addRow(""); refresh(); rowsEl.querySelector(".row:last-child .expression")?.focus(); };
    for (const s of (D.expressions.length ? D.expressions : [""])) addRow(s);
    refresh(false);
    if(D.window2){const [a,b,c,d]=D.window2;state.view2={cx:(a+b)/2,cy:(c+d)/2,sx:cv.clientWidth/(b-a),sy:cv.clientHeight/(d-c)};}
    new ResizeObserver(resize).observe(cv.parentElement);
    window.addEventListener("resize", resize);
    resize();
    window.__penechoPrepareGraphSurfaceSnapshot=()=>{
      surfaceSnapshot=true;draw();
      return()=>{surfaceSnapshot=false;draw();};
    };
    installReadableGraphUi();
    window.penechoWidgetReady?.();
  }

  // The Canvas scales the whole iframe. Only its logical viewport controls
  // responsive layout, so Canvas zoom preserves the authored graph and UI.
  function installReadableGraphUi() {
    const app = document.querySelector(".app");
    function layout() {
      app.style.setProperty("--graph-screen-unit", "1px");
      app.classList.toggle("narrow", innerWidth < 600);
    }
    addEventListener("resize", layout);
    layout();
    // Download includes the whole formula list, even when its live panel scrolls.
    // Keep the plot's CSS dimensions fixed so its camera and bitmap do not move.
    window.__penechoPrepareGraphSnapshot = () => {
      const restoreSurface=window.__penechoPrepareGraphSurfaceSnapshot?.();
      const side = app.querySelector(".side"), plot = app.querySelector(".plot"),
        elements = [app, side, plot, document.documentElement, document.body], styles = elements.map(el => el.getAttribute("style")),
        scrollTop = side.scrollTop, plotHeight = plot.clientHeight, narrow = app.classList.contains("narrow"),
        columns = getComputedStyle(app).gridTemplateColumns;
      plot.style.height = `${plotHeight}px`; plot.style.alignSelf = "start";
      app.style.width = `${app.clientWidth}px`;
      app.style.gridTemplateColumns = columns;
      side.style.maxHeight = "none"; side.style.overflow = "visible"; side.style.height = "auto";
      side.scrollTop = 0;
      const height = Math.max(app.clientHeight, narrow ? side.scrollHeight + plotHeight : side.scrollHeight);
      app.style.height = `${height}px`;
      app.style.gridTemplateRows = narrow ? `auto ${plotHeight}px` : `${height}px`;
      // The screen viewport clips both root elements. Release that clipping for
      // the complete PNG without changing viewport units or the plot's size.
      for (const root of [document.documentElement, document.body]) {
        root.style.setProperty("overflow", "visible", "important");
        root.style.setProperty("scrollbar-width", "none", "important");
      }
      return () => {
        elements.forEach((el, i) => styles[i] === null ? el.removeAttribute("style") : el.setAttribute("style", styles[i]));
        side.scrollTop = scrollTop;
        restoreSurface?.();
      };
    };
  }

  const GRAPH_READABLE_STYLES = `
.app{--graph-screen-unit:1px;grid-template-columns:minmax(0,min(46%,max(31%,calc(280 * var(--graph-screen-unit))))) minmax(0,1fr);font-size:max(calc(16 * var(--graph-screen-unit)),clamp(16px,2.15vmin,20px));line-height:1.5;background:#fff}
.side{padding:.75em;gap:.65em;overflow-x:hidden;overflow-y:auto}
#rows{display:flex;flex-direction:column;gap:.55em;flex-shrink:0}
.row{align-items:flex-start;gap:.35em;padding:.5em;min-width:0;flex-shrink:0}
.row .dot{margin-top:.4em}.row b{font-size:1em;line-height:1.5;color:#64748b}
.expression{flex:1;min-width:0;min-height:1.5em;outline:none;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;cursor:text}
.row button{flex-shrink:0;line-height:1.5;color:#64748b}.add,.params,.hint{flex-shrink:0}
.formula-body{flex:1;min-width:0}.expression:empty:before{content:attr(data-placeholder);color:#94a3b8;font-family:ui-sans-serif,system-ui;font-size:.85em;pointer-events:none}
.formula-message{font-size:max(.75em,calc(12 * var(--graph-screen-unit)));margin-top:.35em;color:#64748b}.bad .formula-message{color:#b91c1c}.formula-message[hidden]{display:none}
.row button{display:inline}.mode{display:flex;align-self:flex-start;gap:.15em;padding:.15em;border:1px solid #e2e8f0;border-radius:.6em;background:#eef2f7;flex-shrink:0}
.mode button{font:600 .85em/1.5 ui-sans-serif,system-ui;border:0;background:transparent;color:#64748b;border-radius:.4em;padding:.2em .9em;cursor:pointer}.mode button[aria-pressed=true]{background:#fff;color:#2563eb;box-shadow:0 1px 3px #0f172a1a}
.mode button:focus-visible,.add:focus-visible,.row button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.add:disabled{opacity:.5;cursor:default}
.support{font-size:max(.75em,calc(12 * var(--graph-screen-unit)));color:#64748b;flex-shrink:0}.support summary{cursor:pointer}.support p{margin:.4em 0}
.hint,.badge{font-size:max(.78em,calc(12 * var(--graph-screen-unit)))}.hint{color:#64748b}
.app.narrow{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,auto) minmax(0,1fr)}
.app.narrow .side{max-height:40vh;border-right:0;border-bottom:1px solid #e5e7eb}.app.narrow .hint{display:none}
`;

  function graphWidgetHtml(spec, options = {}) {
    const document = { version:2, expressions:spec.expressions, parameters:spec.parameters, mode:spec.mode || (spec.surface ? "3d" : "2d"), colors:spec.colors || GRAPH_COLORS, language:options.language === "zh" ? "zh" : "en", view3:spec.view3 || null, window2:spec.window2 || null };
    const data = JSON.stringify(document).replace(/</g, "\\u003c");
    const title = escapeHtml(options.title || "Graph");
    return `<!doctype html><html lang="${document.language === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="penecho-widget-layout" content="viewport"><meta name="penecho-graph-version" content="2"><title>${title}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#fff;color:#1f2937;font:500 max(10px,2.15vmin)/1.3 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.app{display:grid;grid-template-columns:minmax(160px,31%) minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:100%;min-height:0;font:500 clamp(12px,2.15vmin,20px)/1.3 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.side{display:flex;flex-direction:column;min-width:0;min-height:0;gap:.55em;padding:.7em;border-right:1px solid #e5e7eb;background:#f8fafc;overflow:auto}
.row{display:flex;align-items:center;gap:.45em;padding:.35em .45em;border:1px solid #e2e8f0;border-radius:.55em;background:#fff}
.row:focus-within{border-color:#93c5fd;box-shadow:0 0 0 2px #dbeafe}
.dot{flex:0 0 .7em;height:.7em;border-radius:50%}
.row b{font-weight:600;color:#94a3b8;white-space:nowrap;font-size:.8em}
.row input{flex:1;min-width:0;border:0;outline:0;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;background:transparent}
.row.bad{border-color:#fca5a5}.row button{display:none;border:0;background:none;color:#94a3b8;cursor:pointer;font:inherit;padding:0 .2em}.multi .row button{display:inline}
.add{align-self:flex-start;white-space:nowrap;border:1px dashed #cbd5e1;background:#fff;color:#475569;border-radius:.5em;padding:.3em .7em;font:inherit;cursor:pointer}
.params{display:flex;flex-direction:column;gap:.55em;margin-top:.2em}
.param{display:grid;grid-template-columns:1fr auto auto;grid-template-areas:"l v p" "r r r";align-items:center;gap:.15em .4em}.param label{grid-area:l;font-family:ui-monospace,Menlo,monospace;font-weight:700;color:#334155}.param output{grid-area:v;text-align:right;font-variant-numeric:tabular-nums;color:#0f172a}.param .play{grid-area:p;width:1.8em;height:1.8em;border:1px solid #cbd5e1;background:#fff;border-radius:50%;padding:0;font:inherit;font-size:.8em;color:#2563eb;cursor:pointer}.param .play.on{background:#2563eb;color:#fff;border-color:#2563eb}.param input[type=range]{grid-area:r;width:100%;accent-color:#2563eb}
.hint{margin-top:auto;color:#94a3b8;font-size:.78em}@media (max-height:520px){.hint{display:none}}
.plot{position:relative;min-width:0;min-height:0;overflow:hidden}canvas{position:absolute;inset:0;display:block;width:100%;height:100%;cursor:grab;touch-action:none}canvas.drag{cursor:grabbing}
.tools{position:absolute;right:.6em;top:.6em;display:flex;gap:.3em;align-items:center}
.tools button{width:2em;height:2em;border:1px solid #e2e8f0;border-radius:.5em;background:#ffffffe6;color:#334155;font:600 1em/1 system-ui;cursor:pointer}
.badge{position:absolute;left:.7em;top:.6em;padding:.15em .55em;border-radius:1em;background:#eef2ff;color:#4338ca;font-size:.78em;font-weight:600}
.readout{position:absolute;left:.7em;bottom:.6em;padding:.2em .55em;border-radius:.45em;background:#0f172ad9;color:#fff;font:500 .85em ui-monospace,Menlo,monospace;pointer-events:none;opacity:0;transition:opacity .15s}
.readout.on{opacity:1}
${GRAPH_READABLE_STYLES}
</style></head><body><div class="app"><div class="side"><div class="mode" id="mode" role="group"><button id="2d" type="button">2D</button><button id="3d" type="button">3D</button></div><div id="rows"></div><button class="add" id="add">+</button><div class="params" id="params"></div><details class="support"><summary>${document.language === "zh" ? "输入帮助" : "Input help"}</summary><p id="support"></p></details><div class="hint" id="hint"></div></div>
<div class="plot"><canvas id="c"></canvas><span class="badge" id="badge"></span><div class="tools"><button id="zin">+</button><button id="zout">−</button><button id="home">⌂</button></div><div class="readout" id="readout"></div></div></div>
<script>
${createGraphMath.toString()}
${installReadableGraphUi.toString()}
(${graphRuntime.toString()})(Object.assign(${data}, { yWindow:${graphYWindow.toString()}, xWindow:${graphXWindow.toString()} }));
</script></body></html>`;
  }

  function graphDocumentData(html) {
    const match = /\}\)\(Object\.assign\((\{[^\n]*\}), \{ yWindow:/.exec(html);
    if (!match) return null;
    try { return { data:JSON.parse(match[1]), json:match[1] }; } catch { return null; }
  }
  function updateGraphDocument(html, value) {
    if (!html.includes('<meta name="penecho-graph-version" content="2">')) return null;
    const stored=graphDocumentData(html);
    if (!stored || value?.version !== 2 || !["2d","3d"].includes(value.mode) || !Array.isArray(value.expressions) || value.expressions.length<1 || value.expressions.length>16
      || value.expressions.some(s=>typeof s!=="string" || s.length>2000) || !value.parameters || typeof value.parameters!=="object" || Array.isArray(value.parameters)) return null;
    const parameters={};
    for(const [name,number] of Object.entries(value.parameters)) {
      if(!/^[A-Za-z](?:_?\d)?$/.test(name) || ["x","y","z","e"].includes(name))return null;
      if(Number.isFinite(number))parameters[name]=number;
    }
    if(Object.keys(parameters).length>64)return null;
    const v=value.view3,w=value.window2;
    if(v!=null && (!v || ![v.az,v.el,v.R,v.zoom].every(Number.isFinite) || v.R<.2 || v.R>200 || v.el<-.2 || v.el>1.45 || v.zoom<=0 || v.zoom>100))return null;
    if(w!=null && (!Array.isArray(w) || w.length!==4 || !w.every(Number.isFinite) || w[1]<=w[0] || w[3]<=w[2]))return null;
    const data={...stored.data,expressions:[...value.expressions],parameters,mode:value.mode,view3:v?{az:v.az,el:v.el,R:v.R,zoom:v.zoom}:null,window2:w?[...w]:null};
    const json=JSON.stringify(data).replace(/</g,"\\u003c");
    const title=escapeHtml((data.expressions.find(s=>s.trim()) || (data.language==="zh"?"图形":"Graph")).slice(0,110));
    const defined=new Set(data.expressions.map(s=>/^\s*([A-Za-z](?:_?\d)?)\s*=/.exec(s)?.[1]));
    const extra=Object.entries(parameters).filter(([name])=>!defined.has(name));
    return {html:html.replace(stored.json,()=>json).replace(/<title>[^<]*<\/title>/,()=>`<title>${title}</title>`),copyText:data.expressions.join("\n")+(extra.length?"\n"+extra.map(([n,v])=>`${n} = ${v}`).join(", "):"")};
  }
  function upgradeGraphWidgetHtml(html) {
    if(typeof html!=="string")return html;
    html=upgradeGraphWidgetMathNotation(html);
    html=upgradeGraphWidgetSurface(html);
    html=upgradeGraphWidgetCanvasZoom(html);
    if(html.includes('<meta name="penecho-graph-version" content="2">'))return upgradeGraphWidgetPerformance(upgradeGraphWidgetInteractions(html));
    const stored=graphDocumentData(html);
    // Only migrate the native graph runtime. Custom runtimes keep the existing
    // targeted layout repair instead of being replaced wholesale.
    if(!stored || !html.includes("function graphRuntime(D)") || !html.includes("function resize()")
      || !html.includes('row.label.textContent = row.usesY ? "z=" : "y="') || !html.includes('del.title = "Remove"'))return upgradeLegacyGraphLayout(html);
    const data=stored.data;
    if(!Array.isArray(data.expressions) || data.expressions.some(e=>typeof e!=="string") || !Array.isArray(data.colors))return html;
    const surface=data.expressions.some(expressionUsesY),mode=surface?"3d":"2d";
    // Old 3D renderers plotted every row as a height, including those without y.
    const expressions=data.expressions.map(e=>`${surface?"z":"y"} = ${cleanExpression(e).replace(/^\s*[yz]\s*=\s*/,"")}`);
    const generated=graphWidgetHtml({...data,expressions,mode},{language:data.language});
    const scriptStart=html.lastIndexOf("<script>",html.indexOf("function graphRuntime(D)")),scriptEnd=html.indexOf("</script>",scriptStart);
    if(scriptStart<0||scriptEnd<0)return html;
    return (html.slice(0,scriptStart)+generated.slice(generated.indexOf("<script>"),generated.lastIndexOf("</script>")+9)+html.slice(scriptEnd+9))
      .replace("</style>",`${GRAPH_READABLE_STYLES}</style>`)
      .replace('<div id="rows"></div>','<div class="mode" id="mode" role="group"><button id="2d" type="button">2D</button><button id="3d" type="button">3D</button></div><div id="rows"></div>')
      .replace('<div class="hint" id="hint">',`<details class="support"><summary>${data.language==="zh"?"输入帮助":"Input help"}</summary><p id="support"></p></details><div class="hint" id="hint">`)
      .replace("</head>",'<meta name="penecho-graph-version" content="2"><meta name="penecho-widget-layout" content="viewport"></head>')
      .replace("</style>",'.app{grid-template-columns:minmax(160px,31%) minmax(0,1fr);grid-template-rows:minmax(0,1fr);min-height:0}.side,.plot{min-width:0;min-height:0}.plot{overflow:hidden}.plot canvas{position:absolute;inset:0}</style>');
  }
  function upgradeGraphWidgetMathNotation(html) {
    if(!html.includes('<meta name="penecho-graph-version" content="2">') || !graphDocumentData(html))return html;
    // Repair only the shipped normalization block in saved native graphs.
    // Preserve their expressions, camera, parameters and customized runtime.
    const math=createGraphMath.toString(),start=math.indexOf('    function normalise(source) {'),end=math.indexOf('    function tokenize(source) {'),
      current=math.slice(start,end),previous=current.replace('fromJavaScript(source).replace','String(source || "").replace'),
      replacement=math.slice(math.indexOf('    function fromJavaScript(source) {'),end);
    if(!html.includes(previous))return html;
    return html.replace(previous,()=>replacement)
      .replace('round:Math.round, sign:Math.sign, sgn:Math.sign, sec:', 'round:Math.round, sign:Math.sign, sgn:Math.sign, log10:Math.log10, sec:');
  }
  function upgradeGraphWidgetSurface(html) {
    if(!html.includes('<meta name="penecho-graph-version" content="2">')||!graphDocumentData(html))return html;
    // Repair shipped geometry blocks in saved native graphs, preserving data,
    // styles, camera and any customized interaction handlers.
    const oldStart='    function mesh(row, R, params, n=36) {\n      const faces=[];\n',
      oldEdge='              if(inside!==next) { const t=(sign*R-a[axis])/(b[axis]-a[axis]);out.push(a.map((v,k)=>v+t*(b[k]-v))); }',
      oldExplicit='            const face=clip(tri);if(face.length>=3)faces.push(face);',
      oldImplicit='          if(face&&face.every(Boolean))faces.push(face);',
      oldReturn='    return { compile, equation, contour, mesh };',
      oldPush='          quads.push({pts,depth:pts.reduce((sum,p)=>sum+p.d,0)/pts.length,shade,index});',
      oldDraw=`      quads.sort((a, b) => b.depth - a.depth);
      for (const q of quads) {
        const [cr,cg,cb]=hexRgb(state.rows[q.index].color,1).map(c=>Math.round(c*q.shade));
        ctx.fillStyle=\`rgb(\${cr},\${cg},\${cb})\`;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.5;
        ctx.beginPath();ctx.moveTo(q.pts[0].x,q.pts[0].y);for(let k=1;k<q.pts.length;k++)ctx.lineTo(q.pts[k].x,q.pts[k].y);ctx.closePath();ctx.fill();ctx.stroke();
      }`,
      oldNormal=`          const pts=face.map(p=>P(...p)),a=face[0],b=face[1],c=face[2],u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
          const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
          if(length<1e-12)continue;`;
    if(![oldStart,oldEdge,oldExplicit,oldImplicit,oldReturn,oldNormal,oldPush,oldDraw].every(block=>html.includes(block)))return html;
    const math=createGraphMath.toString(),runtime=graphRuntime.toString(),
      prelude=math.slice(math.indexOf('    function polygonNormal('),math.indexOf('      if(row.kind === "explicit")')),
      edge=math.slice(math.indexOf('              if(inside!==next)'),math.indexOf('\n            }',math.indexOf('              if(inside!==next)'))),
      normal=runtime.slice(runtime.indexOf('          const pts=face.map('),runtime.indexOf('          const shade=',runtime.indexOf('          const pts=face.map('))).trimEnd(),
      renderer=runtime.slice(runtime.indexOf('    let surfaceRenderer='),runtime.indexOf('    function home3()'));
    return html.replace(oldStart,()=>prelude).replace(oldEdge,()=>edge)
      .replace(oldExplicit,'            addFace(clip(tri));').replace(oldImplicit,'          if(face&&face.every(Boolean))addFace(face);')
      .replace(oldReturn,'    return { compile, equation, contour, mesh, polygonNormal };').replace(oldNormal,()=>normal)
      .replace(oldPush,'          const color=hexRgb(r.color,1).map(c=>Math.round(c*shade));\n          quads.push({pts,color});')
      .replace(oldDraw,'      renderSurfaces(quads,w,h);').replace('    function home3()',()=>renderer+'    function home3()');
  }
  function upgradeGraphWidgetPerformance(html) {
    // Upgrade only shipped blocks together, so customized runtimes cannot gain
    // half a scheduler or lose their authored geometry/snapshot behavior.
    const runtime=graphRuntime.toString(),slice=(from,to)=>runtime.slice(runtime.indexOf(from),runtime.indexOf(to)),
      replacements=[
        ['      evaluateParameters();state.rows.forEach(showError);geometry.clear();revision++;draw();',
          '      evaluateParameters();state.rows.forEach(showError);revision++;draw();'],
        ['          if(state.anim?.name===n){state.anim=null;play.textContent="▶";play.classList.remove("on");publish();return;}',
          '          if(state.anim?.name===n){state.anim=null;play.textContent="▶";play.classList.remove("on");draw();publish();return;}'],
        ['          state.anim={name:n,min,max,r,out,definition,dir:1};play.textContent="■";play.classList.add("on");requestAnimationFrame(tick);',
          '          state.anim={name:n,min,max,r,out,definition,dir:1,last:0};play.textContent="■";play.classList.add("on");scheduleTick();'],
        [`    function tick() {
      const a=state.anim;if(!a)return;let v=state.params[a.name]+(a.max-a.min)/240*a.dir;
      if(v>a.max){v=a.max;a.dir=-1;}if(v<a.min){v=a.min;a.dir=1;}
      setParameter(a.name,v,a.definition);a.r.value=v;a.out.textContent=fmt(v);requestAnimationFrame(tick);
    }
`,slice('    let animationFrame=','    function nice(')],
        ['    let surfaceRenderer=null;','    let surfaceRenderer=null,surfaceSnapshot=false;'],
        ['      const renderer=surfaceRenderer,gl=renderer.gl;',slice('      const renderer=surfaceRenderer,','      if(gl&&!gl.isContextLost())')],
        [`        if(renderer.canvas.width!==cv.width||renderer.canvas.height!==cv.height) {
          renderer.canvas.width=cv.width;renderer.canvas.height=cv.height;
        }
        gl.viewport(0,0,cv.width,cv.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        const count=faces.reduce((sum,face)=>sum+(face.pts.length-2)*3,0),vertices=new Float32Array(count*7);`,
          slice('        if(renderer.canvas.width!==width','        let offset=0;').trimEnd()],
        ['      const width=cv.width,height=cv.height;\n',''],
        ['        const key=revision+":"+R,cached=geometry.get(r),faces=cached?.key===key?cached.faces:math.mesh(r,R,state.params);',
          '        const key=JSON.stringify([R,...r.names.map(name=>state.params[name])]),cached=geometry.get(r),faces=cached?.key===key?cached.faces:math.mesh(r,R,state.params);'],
        ['    installReadableGraphUi();\n',slice('    window.__penechoPrepareGraphSurfaceSnapshot=','    window.penechoWidgetReady')],
        ['    window.__penechoPrepareGraphSnapshot = () => {\n','    window.__penechoPrepareGraphSnapshot = () => {\n      const restoreSurface=window.__penechoPrepareGraphSurfaceSnapshot?.();\n'],
        ['        side.scrollTop = scrollTop;\n','        side.scrollTop = scrollTop;\n        restoreSurface?.();\n'],
      ];
    if(replacements.every(([,after])=>!after||html.includes(after)))return html;
    if(!html.includes('function graphRuntime(D)')||!graphDocumentData(html)
      ||!replacements.every(([before,after])=>html.includes(before)||!after||html.includes(after)))return html;
    for(const [before,after] of replacements)if(html.includes(before))html=html.replace(before,()=>after);
    return html;
  }
  function upgradeGraphWidgetCanvasZoom(html) {
    if(!html.includes("function graphRuntime(D)") || !html.includes('<canvas id="c"></canvas>') || !graphDocumentData(html))return html;
    // Repair only the shipped scale-dependent layout prefix. Keep graph data,
    // custom styles, interaction handlers and snapshot preparation untouched.
    const oldLayout=`function installReadableGraphUi() {
    const app = document.querySelector(".app");
    let scale = 1;
    function layout() {
      app.style.setProperty("--graph-screen-unit", \`\${1 / scale}px\`);
      app.classList.toggle("narrow", innerWidth * scale < 600);
    }
    addEventListener("message", event => {
      const data = event.data;
      if (event.source !== parent || data?.type !== "penecho-widget-state"
        || !Number.isFinite(data.scaleX) || data.scaleX <= 0 || !Number.isFinite(data.scaleY) || data.scaleY <= 0) return;
      scale = Math.min(1, data.scaleX, data.scaleY);
      layout();
    });
    addEventListener("resize", layout);
    layout();
`;
    const current=installReadableGraphUi.toString();
    return html.replace(oldLayout,()=>current.slice(0,current.indexOf("    // Download includes")));
  }
  function upgradeGraphWidgetInteractions(html) {
    if(!html.includes("function graphRuntime(D)") || !html.includes('<canvas id="c"></canvas>') || !graphDocumentData(html))return html;
    // Repair the exact interaction blocks previously shipped in native v2
    // graphs. Never replace the whole runtime or a customized event handler.
    const oldPublish=`    let rowId = 0, revision = 0;
    const geometry = new Map();
    function publish() {
      const V=state.view2,w=cv.clientWidth,h=cv.clientHeight;
      parent.postMessage({type:"penecho-graph-change",document:{version:2,mode:state.mode,expressions:state.rows.map(r=>r.src),parameters:{...state.params},view3:state.view3,window2:V ? [V.cx-w/2/V.sx,V.cx+w/2/V.sx,V.cy-h/2/V.sy,V.cy+h/2/V.sy] : null}},"*");
    }
`, oldParameter='        r.oninput=()=>{state.anim=null;setParameter(n,Number(r.value),definition);publish();};\n',
      oldWheel='    cv.addEventListener("wheel", e => { e.preventDefault(); const point = pointerPoint(e); zoom(Math.exp(-e.deltaY * 0.0015), point.x, point.y);publish(); }, { passive:false });\n';
    if(![oldPublish,oldParameter,oldWheel].every(block=>html.includes(block)))return html;
    const runtime=graphRuntime.toString(),block=(from,to)=>runtime.slice(runtime.indexOf(from),runtime.indexOf(to));
    return html.replace(oldPublish,()=>block("    let rowId =","    function fmt("))
      .replace(oldParameter,()=>block("        let parameterInteraction=","        play.className="))
      .replace(oldWheel,()=>block("    let wheelInteraction=",'    $("zin").onclick'))
      .replace('      drag = { ...pointerPoint(e), v2:state.view2 && { ...state.view2 }, v3:state.view3 && { ...state.view3 } };',
        '      drag = { ...pointerPoint(e), id:interactionId("camera"), v2:state.view2 && { ...state.view2 }, v3:state.view3 && { ...state.view3 } };')
      .replace('        state.hover = null; readout.classList.remove("on"); draw(); return;',
        '        state.hover = null; readout.classList.remove("on"); draw(); publish({id:drag.id,phase:"update"}); return;')
      .replace('    const end = () => { if(drag)publish();drag = null; cv.classList.remove("drag"); };',
        '    const end = () => { if(drag)publish({id:drag.id,phase:"end"});drag = null; cv.classList.remove("drag"); };')
      .replace('    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);',
        '    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);\n    cv.addEventListener("lostpointercapture", end);');
  }
  // Repair the exact resize block shipped in saved Plot widgets as they load.
  // Keep their expressions, parameters and other authored HTML/JS untouched.
  function upgradeLegacyGraphLayout(html) {
    if (typeof html !== "string" || !html.includes("function graphRuntime(D)") || !html.includes('<canvas id="c"></canvas>')) return html;
    const oldResize = `    function resize() {
      const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d)); ctx.setTransform(d, 0, 0, d, 0, 0);
      if (state.mode === "2d") home2(); else if (!state.view3) home3();
      draw();
    }
`;
    const runtime = graphRuntime.toString(), replacement = runtime.slice(runtime.indexOf("    let plotSize ="), runtime.indexOf("    let drag ="));
    if (!html.includes('<meta name="penecho-widget-layout" content="viewport">')) {
      if (!html.includes(oldResize) || !html.includes("new ResizeObserver(resize).observe(cv);")) return html;
      html = html.replace(oldResize, replacement)
      .replace("new ResizeObserver(resize).observe(cv);", 'new ResizeObserver(resize).observe(cv.parentElement);\n    window.addEventListener("resize", resize);')
      .replace("</style>", '.app{grid-template-columns:minmax(160px,31%) minmax(0,1fr);grid-template-rows:minmax(0,1fr);min-height:0;font-size:clamp(12px,2.15vmin,20px)}.side,.plot{min-width:0;min-height:0}.plot{overflow:hidden}.plot canvas{position:absolute;inset:0}</style>')
      .replace("</head>", '<meta name="penecho-widget-layout" content="viewport"></head>');
    }
    if (html.includes("function installReadableGraphUi()")) return html;
    // Only replace the shipped editor block; retain plot code, data and styles.
    const start = html.indexOf("    function addRow(src) {"), end = html.indexOf("    function refresh()", start);
    const editor = html.slice(start, end);
    if (start < 0 || end < 0 || !editor.includes('input.value = row.src; input.spellcheck = false;')
      || !editor.includes('row.src = input.value;')) return html;
    const initializer = '      input.className = "expression"; input.contentEditable = "plaintext-only"; input.textContent = row.src; input.spellcheck = false; input.setAttribute("role", "textbox"); input.setAttribute("aria-multiline", "true"); input.setAttribute("aria-label", "f(x)");\n';
    const upgradedEditor = editor.replace('input = document.createElement("input")', 'input = document.createElement("div")')
      .replace('      input.value = row.src; input.spellcheck = false; input.setAttribute("aria-label", "f(x)");\n', initializer)
      .replace('row.src = input.value;', 'row.src = input.innerText;');
    return (html.slice(0, start) + upgradedEditor + html.slice(end))
      .replace('if (c === " " || c === "\\t")', 'if (/\\s/.test(c))')
      .replace('.row:last-child input', '.row:last-child .expression')
      .replace("</style>", `${GRAPH_READABLE_STYLES}</style>`)
      .replace("    window.penechoWidgetReady?.();", `    (${installReadableGraphUi.toString()})();\n    window.penechoWidgetReady?.();`);
  }
  // Size the graph from the formula it plots and place it beside that formula:
  // to the right when it fits in view, otherwise below.
  function graphPlacement(command, options = {}) {
    const anchor = options.anchor, visible = options.visible, size = options.canvasSize || 20000;
    if (!anchor || ![anchor.x, anchor.y, anchor.w, anchor.h].every(Number.isFinite)) {
      const w = Math.max(1500, Math.min(4200, Number(command.w) || 1800)), h = Math.max(1000, Math.min(2800, Number(command.h) || 1200)),
        aspect = Math.max(1.35, Math.min(1.8, w / h)), height = Math.round(Math.min(h, w / aspect));
      return { x:Math.round(Number(command.x) || 0), y:Math.round(Number(command.y) || 0), w:Math.round(height * aspect), h:height };
    }
    const view = visible && [visible.x, visible.y, visible.w, visible.h].every(Number.isFinite) ? visible : null;
    let h = Math.round(Math.max(anchor.h * 4.2, anchor.w * 0.9, 640));
    if (view) h = Math.min(h, Math.round(view.h * 0.62));
    h = Math.max(420, Math.min(3200, h));
    // Never wider than most of the visible view.
    if (view) h = Math.max(420, Math.min(h, Math.round(view.w * 0.68 / 1.55)));
    let w = Math.round(h * 1.55);
    const gap = Math.max(40, Math.round(anchor.h * 0.35));
    // Right of the ink, else left of it, else below it; always inside the view.
    let x = anchor.x + anchor.w + gap, y = anchor.y + anchor.h / 2 - h / 2;
    if (view && x + w > view.x + view.w) {
      if (anchor.x - gap - w >= view.x) x = anchor.x - gap - w;
      else {
        y = anchor.y + anchor.h + gap;
        const room = view.y + view.h - gap * 0.5 - y;
        if (room < h && room >= 420) { h = Math.round(room); w = Math.round(h * 1.55); }
        x = Math.max(view.x + gap * 0.5, Math.min(anchor.x, view.x + view.w - w - gap * 0.5));
      }
    }
    if (view) y = Math.max(view.y + gap * 0.5, Math.min(y, view.y + view.h - h - gap * 0.5));
    return { x:Math.round(Math.max(0, Math.min(size - w, x))), y:Math.round(Math.max(0, Math.min(size - h, y))), w, h };
  }
  function graphWidgetCommand(command, options = {}) {
    const spec = graphSpec(command);
    if (!spec.expressions.length) return null;
    const placement = graphPlacement(command, options), title = spec.expressions[0].slice(0, 110);
    return {
      tool:"html_widget",
      pluginId:"general",
      sourceFormat:"penecho-graph",
      frameworkVersion:"graph/2",
      ...placement,
      title,
      refreshSeconds:0,
      html:graphWidgetHtml(spec, { title, language:options.language }),
      copyText:spec.expressions.join("\n") + (Object.keys(spec.parameters).length ? `\n${Object.entries(spec.parameters).map(([name, value]) => `${name} = ${value}`).join(", ")}` : ""),
      copyLabel:options.language === "zh" ? "复制表达式" : "Copy expression",
    };
  }

  return Object.freeze({
    ACTIONS,
    CONVERSATION_QUESTION,
    CHECK_APPLICABLE_QUESTION,
    WIDGET_REFINE_GUIDANCE,
    WIDGET_ACTION_INTENT_GUIDANCE,
    strokeTouchesBox,
    KINDS,
    POLICY,
    actionById,
    executionRoute, suggestionExecution, widgetRefineRoute,
    buildQuestions,
    decide,
    eligibleActions,
    fitStroke,
    fitStrokes,
    formatFacts,
    createGraphMath,
    graphPlacement,
    graphSpec,
    graphYWindow,
    graphXWindow,
    expressionUsesY,
    graphWidgetCommand,
    graphWidgetHtml,
    upgradeGraphWidgetHtml,
    graphDocumentData,
    updateGraphDocument,
    label,
    resample,
    shapeSummary,
    updateProfile,
    recentStrokeUnit,
    dismissAction,
    estimateRows,
    localPredict,
    inkCues,
    instantBucket,
    learnInstantPrior,
    INSTANT_BUCKETS,
    motionCues,
    checkApplicable,
    conversationIntent,
    confidentRanking,
    instantRankingEvidence,
    rankActions,
    rankResultActions,
    SHAPE_TOOLS,
    shapeToolOutline,
  });
});
