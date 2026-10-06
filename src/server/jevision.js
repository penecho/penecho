"use strict";

// PenEchoLLM client transport. Upstream credentials, protocol and action policy
// belong exclusively to Cloud. Legacy environment names retain enable/mock settings.
const CLOUD_SUGGEST_PATH = "/api/v1/apps/penecho-llm/suggest";
// Cloud permits 30 seconds of queue wait, then 12 seconds of execution.
// Allow two more seconds for transport and trial initialization.
const CLOUD_SUGGEST_TIMEOUT_MS = 44000;
function cloudJeVisionConfig(connector, env = process.env, fileValues = {}) {
  const read = key => env[key] ?? fileValues[key], session = connector.status();
  const mock = String(read("PENECHO_JEVISION_MOCK") || "");
  return {
    url:`${session.origin || connector.defaultOrigin}${CLOUD_SUGGEST_PATH}`,
    model:"PenEchoLLM", timeoutMs:CLOUD_SUGGEST_TIMEOUT_MS,
    mock:/^(0|false|off|no)$/i.test(mock)?"":mock,
    configured:!/^(0|false|off|no)$/i.test(String(read("PENECHO_JEVISION_ENABLED"))) && Boolean(session.origin || connector.defaultOrigin),
  };
}
async function requestCloudJeVision(connector, config, request, { signal, requestTracer } = {}) {
  const started = Date.now(), trace = requestTracer?.begin(config, request, request);
  const deadline = AbortSignal.timeout(config.timeoutMs), requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    requestSignal.throwIfAborted();
    let result;
    if(config.mock) {
      await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Number(process.env.PENECHO_JEVISION_MOCK_DELAY_MS)||90)));
      requestSignal.throwIfAborted();
      result={ok:true,answers:mockModeAnswers(request,config.mock)};
    } else {
      trace?.sending();
      result=await connector.suggestionRequest("", {method:"POST",body:request,signal:requestSignal,timeoutMs:config.timeoutMs,responseTrace:trace});
    }
    requestSignal.throwIfAborted();
    if (!result.ok || !result.answers) throw Object.assign(new Error("Cloud suggestions are unavailable."), {status:502});
    const normalized={answers:result.answers,model:"PenEchoLLM",latencyMs:Date.now()-started,access:result.access,chargedCredits:result.chargedCredits,cached:result.cached===true};
    trace?.complete(normalized);return normalized;
  } catch(error) {
    trace?.fail(error,{cancelled:Boolean(signal?.aborted),timedOut:error.name==="TimeoutError"});throw error;
  }
}

// Deterministic local demonstration fixture; it never calls an upstream model.
function mockAnswers(questions, facts, mode) {
  const pick = (id, preferred) => {
    const question = questions[id];
    if (!question) return;
    const options = Object.keys(question.criteria),
      choice = options.includes(preferred) ? preferred : options.includes("none") ? "none" : options[0],
      probabilities = Object.fromEntries(options.map(option => [option, option === choice ? 0.82 : 0.18 / Math.max(1, options.length - 1)]));
    return { type:"choice", choice, confidence:0.82, probabilities };
  };
  const shape = /shape_fit: best=(\w+) residual=([\d.]+)/.exec(facts || ""),
    goodShape = shape && Number(shape[2]) <= 0.12,
    strokes = Number(/strokes=(\d+)/.exec(facts || "")?.[1] || 0),
    forced = mode && mode !== "auto" && mode !== "1" && mode !== "true" && mode !== "on" ? mode : "";
  const aspect = Number(/aspect=([\d.]+)/.exec(facts || "")?.[1] || 0),
    drawing = !goodShape && strokes >= 4 && aspect >= 0.4 && aspect <= 1.8;
  let action = forced || (goodShape ? "snap_shapes" : drawing ? "vivid" : strokes >= 3 ? "typeset" : "none");
  const kindFor = { refine:"notes", vivid:"drawing", animate_sketch:"drawing", finish_drawing:"drawing", animate:"math_expr", snap_shapes:"shape", plot:"math_expr", typeset:"math_expr", solve:"math_expr", check_step:"math_step", next_step:"math_step", prototype:"ui_wireframe", diagram:"diagram", organize:"notes", note:"notes", answer:"question", create_visual:"question", explain:"math_expr", hint:"math_expr", practice:"math_expr" };
  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "noul") answers[id] = { type:"noul", noul:0.9 };
    else if (id === "action") answers[id] = pick(id, action);
    else if (id === "kind") answers[id] = pick(id, kindFor[action] || "none");
    else answers[id] = pick(id, "");
  }
  return answers;
}

// Option ids of the Cloud-owned questions for the non-ink modes. The mock only
// needs ids; the wording and criteria live exclusively in Cloud.
const MOCK_MODE_OPTIONS = Object.freeze({
  gesture:{ command:null, gesture:["none","explain","typeset","plot","animate","chart","delete"] },
  step:{ step:["follows","doubtful","not_step","unclear"], error:null },
  index:{ kind:["none","formula","derivation","graph","geometry","circuit","chemistry","diagram","wireframe","table","todo","notes","question","code","drawing","music","map"],
    subject:["other","math","physics","chemistry","biology","computing","engineering","business","language","art"] },
  // Note mode: the category options are the user's own category ids.
  note:{ kind:Object.keys(require("../../public/note-card.js").NOTE_KINDS) },
});
const MOCK_GESTURES = Object.freeze({ enclosure:"explain", question:"explain", double_underline:"typeset", underline:"none", axes:"plot", arrow:"animate", strike:"delete", scribble:"delete", check:"none" });
function mockChoice(options, choice, confidence = 0.82) {
  const picked = options.includes(choice) ? choice : options[0];
  return { type:"choice", choice:picked, confidence, probabilities:Object.fromEntries(options.map(option => [option, option === picked ? confidence : (1 - confidence) / Math.max(1, options.length - 1)])) };
}
// Deterministic answers for every mode, so local demonstrations exercise the
// same client paths as Cloud. PENECHO_JEVISION_MOCK_<MODE> forces one choice.
function mockModeAnswers(request, mock) {
  const mode = request?.mode, context = request?.context || {}, env = name => String(process.env[`PENECHO_JEVISION_MOCK_${name}`] || "");
  const execution=mockChoice(["canvas_ai","penecho_agent"],env("EXECUTION")||"canvas_ai");
  const executions=ids=>({execution,...Object.fromEntries(ids.map(id=>[`execution_${id}`,execution]))});
  if (mode === "route") return {execution:mockChoice(["canvas_ai","penecho_agent"],env("EXECUTION")||"canvas_ai")};
  if (mode === "widget") {
    const actions = Array.isArray(context.actions) ? context.actions : [],
      preferred = mock !== "auto" && actions.includes(mock) ? mock : context.marks && actions.includes("apply_marks") ? "apply_marks" : context.errors && actions.includes("fix_error") ? "fix_error"
        : actions.includes("scene_replay") ? "scene_replay" : "none";
    return { ...executions(actions.filter(id=>["fix_layout","apply_marks"].includes(id))), action:mockChoice(["none", ...actions], preferred), ...(context.marks ? { marks_intent:{ type:"noul", noul:0.9 } } : {}) };
  }
  if (mode === "gesture") {
    const gesture = env("GESTURE") || MOCK_GESTURES[context.shape] || "none";
    return { command:{ type:"noul", noul:gesture === "none" ? 0.1 : 0.92 }, gesture:mockChoice(MOCK_MODE_OPTIONS.gesture.gesture, gesture, 0.86) };
  }
  if (mode === "step") {
    const step = env("STEP") || "follows";
    return { step:mockChoice(MOCK_MODE_OPTIONS.step.step, step, 0.8), error:{ type:"noul", noul:step === "doubtful" ? 0.84 : 0.08 } };
  }
  if (mode === "index") return { kind:mockChoice(MOCK_MODE_OPTIONS.index.kind, env("INDEX_KIND") || "formula"), subject:mockChoice(MOCK_MODE_OPTIONS.index.subject, env("INDEX_SUBJECT") || "math") };
  // Agent composer: the first candidates are likely, the rest fall below the
  // display floor. PENECHO_JEVISION_MOCK_AGENT names a request to rank first.
  if (mode === "agent") {
    const prompts = Array.isArray(context.prompts) ? context.prompts : [], first = env("AGENT"),
      ordered = first && prompts.includes(first) ? [first, ...prompts.filter(id => id !== first)] : prompts,
      scores = [0.82, 0.58, 0.31, 0.18];
    return Object.fromEntries(ordered.map((id, index) => [`prompt_${id}`, { type:"noul", noul:scores[index] ?? 0.04 }]));
  }
  if (mode === "note_rank") return Object.fromEntries((context.notes || []).map((note,index) => [`note_${index}`, {type:"noul",noul:note.bookmarked ? 0.9 : 0.65}]));
  if (mode === "note") {
    const categories = Array.isArray(context.categories) ? context.categories.map(item => String(item?.id || "")).filter(Boolean) : [],
      noul = (name, fallback) => ({ type:"noul", noul:Math.max(0, Math.min(1, Number(env(name)) || fallback)) });
    return {
      kind:mockChoice(MOCK_MODE_OPTIONS.note.kind, env("NOTE_KIND") || "concept"),
      category:mockChoice(["other", ...categories], env("NOTE_CATEGORY") || categories[0] || "other", 0.74),
      importance:noul("NOTE_IMPORTANCE", 0.72), complete:noul("NOTE_COMPLETE", 0.8), review:noul("NOTE_REVIEW", 0.66),
      ...(context.query ? { relevance:noul("NOTE_RELEVANCE", 0.7) } : {}),
    };
  }
  const questions = require("../../public/smart-suggest.js").buildQuestions({ shapesFit:context.shapesFit, deletionMark:context.deletionMark, widgetRefine:context.widgetRefine, selection:mode === "selection", result:mode === "result" });
  return {...mockAnswers(questions, "", mock === "auto" ? (mode === "result" ? "explain" : context.widgetRefine ? "refine" : context.noteScope ? "note" : context.shapesFit ? "snap_shapes" : "typeset") : mock), ...(mode === "selection" ? { note_scope:{ type:"noul", noul:context.noteScope === "large_text" ? 0.95 : 0.1 } } : {}), ...(questions.note_task ? {note_task:{type:"noul",noul:0.1}} : {}),...executions(["answer","create_visual","explain","solve","practice","diagram","organize","vivid","finish_drawing"])};
}

function createRateLimiter(limit=40,windowMs=60000,now=()=>Date.now()) {
  const stamps=[];return ()=>{const current=now();while(stamps.length&&current-stamps[0]>=windowMs)stamps.shift();if(stamps.length>=limit)return false;stamps.push(current);return true;};
}
module.exports={createRateLimiter,CLOUD_SUGGEST_PATH,cloudJeVisionConfig,requestCloudJeVision,mockAnswers,mockModeAnswers,MOCK_MODE_OPTIONS};
