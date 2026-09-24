"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("Settings exposes a catalog-backed Keyboard shortcuts page", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  const panel = html.slice(html.indexOf('id="settingsPanel"'), html.indexOf('id="configurationLayer"'));
  for (const page of ["appearance", "connections", "canvas", "shortcuts", "about"]) {
    assert.match(panel, new RegExp(`data-settings-page-target="${page}"`));
    assert.match(panel, new RegExp(`data-settings-page="${page}"`));
  }
  assert.match(panel, /id="settingsShortcutList"/);
  assert.match(panel, /id="settingsShortcutResetAll"[^>]*data-pe-button="secondary"[^>]*data-pe-density="compact"/);
  assert.match(panel, /id="settingsShortcutStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /Keyboard shortcuts use the catalog's Settings XL\/nav-content/);
  assert.match(css, /\.settings-shortcut-row\[data-pe-list="settings"\]\s*\{[^}]*min-height:\s*56px[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /@container \(max-width: 480px\)[\s\S]*?\.settings-shortcut-row\[data-pe-list="settings"\][^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("shortcut defaults cover Agent focus, save, history, editing, and workspace actions", () => {
  const source = read("src/client/app/keyboard-shortcuts.js"), build = read("scripts/build-client.js");
  assert.match(build, /src\/client\/app\/keyboard-shortcuts\.js/);
  for (const [id, chord] of [
    ["focus-agent", "Mod+k"], ["pen-tool", "p"], ["save-canvas", "Mod+s"], ["undo", "Mod+z"],
    ["redo", "Mod+Shift+z"], ["canvas-library", "Mod+o"],
    ["toggle-fullscreen", "Mod+Shift+f"], ["open-settings", "Mod+,"],
  ]) assert.match(source, new RegExp(`id:\\"${id}\\"[^\\n]*defaultChord:\\"${chord.replace(/[+]/g, "\\+")}\\"`));
  for (const hiddenId of ["tool-pen", "tool-hand", "tool-eraser", "tool-select", "tool-text", "toggle-grid", "new-canvas"]) {
    assert.doesNotMatch(source, new RegExp(`id:\\"${hiddenId}\\"`));
  }
  assert.doesNotMatch(source, /settingsShortcutGroupTools|group:"tools"|defaultChord:"g"|defaultChord:"Mod\+n"/);
  const perform = functionSource(source, "keyboardShortcutPerform");
  assert.match(perform, /if \(opening\) openCanvasAgent\(\{ focus:false, animate:true \}\)/);
  assert.match(perform, /else closeCanvasAgent\(\{ focus:false \}\)/);
  assert.match(perform, /void saveCurrentCanvas\(\)/);
  assert.match(perform, /querySelector\(`\[data-action="\$\{commandId\}"\]`\)\?\.click\(\)/);
  assert.doesNotMatch(perform, /selectCanvasToolMode|gridToggle|newCanvasBtn/);
  assert.match(perform, /openHistoryPanel\(\)/);
});

test("shortcut normalization treats Control and Command as the same cross-platform modifier", () => {
  const source = read("src/client/app/keyboard-shortcuts.js"), special = new Map([
    [" ", "Space"], ["Spacebar", "Space"], ["Esc", "Escape"], ["Left", "ArrowLeft"],
    ["Right", "ArrowRight"], ["Up", "ArrowUp"], ["Down", "ArrowDown"],
  ]);
  const key = Function("KEYBOARD_SHORTCUT_SPECIAL_KEYS", `return (${functionSource(source, "keyboardShortcutKey")});`)(special);
  const chord = Function("keyboardShortcutKey", `return (${functionSource(source, "keyboardShortcutChordFromEvent")});`)(key);
  assert.equal(chord({ key:"s", ctrlKey:true, metaKey:false, altKey:false, shiftKey:false }), "Mod+s");
  assert.equal(chord({ key:"S", ctrlKey:false, metaKey:true, altKey:false, shiftKey:true }), "Mod+Shift+s");
  assert.equal(chord({ key:"Tab", ctrlKey:false, metaKey:false, altKey:false, shiftKey:false }), "Tab");
  assert.equal(chord({ key:"Control", ctrlKey:true, metaKey:false, altKey:false, shiftKey:false }), "");
});

test("Canvas shortcut hints show the current binding and omit cleared shortcuts", () => {
  const source = read("src/client/app/keyboard-shortcuts.js"), bindings = {
    "focus-agent":"Tab", "save-canvas":"Mod+k", undo:"Mod+z", redo:"Mod+Shift+z",
  };
  const api = Function("keyboardShortcutBindings", "keyboardShortcutDisplay", `
    ${functionSource(source, "keyboardShortcutCanvasHint")}
    ${functionSource(source, "keyboardShortcutUndoRedoHint")}
    return { keyboardShortcutCanvasHint, keyboardShortcutUndoRedoHint };
  `)(bindings, (chord) => chord.replace("Mod", "Ctrl"));
  assert.deepEqual(api.keyboardShortcutCanvasHint("focus-agent", "canvasHintShortcutAgent"), {
    key:"canvasHintShortcutAgent", values:{ shortcut:"Tab" },
  });
  assert.equal(api.keyboardShortcutCanvasHint("canvas-library", "canvasHintShortcutLibrary"), null);
  assert.deepEqual(api.keyboardShortcutUndoRedoHint(), {
    key:"canvasHintShortcutUndoRedo", values:{ undo:"Ctrl+z", redo:"Ctrl+Shift+z" },
  });
});

test("shortcut recording rejects conflicts, supports clearing, and protects text and modal contexts", () => {
  const source = read("src/client/app/keyboard-shortcuts.js"), assign = functionSource(source, "keyboardShortcutAssign"), handler = functionSource(source, "handleKeyboardShortcutKeydown"), context = functionSource(source, "keyboardShortcutCanRun");
  assert.match(assign, /KEYBOARD_SHORTCUT_COMMANDS\.find\([\s\S]*?keyboardShortcutBindings\[item\.id\] === chord/);
  assert.match(assign, /settingsShortcutConflict/);
  assert.match(handler, /event\.key === "Escape"[\s\S]*?settingsShortcutCancelled/);
  assert.match(handler, /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?keyboardShortcutAssign\(keyboardShortcutRecordingId, ""\)/);
  assert.match(context, /keyboardShortcutBlockingSurfaceOpen\(\)/);
  assert.match(context, /keyboardShortcutControlOwnsKey\(event, chord\)/);
  assert.match(context, /keyboardShortcutTextEditingTarget\(event\.target\)\) return command\.id === "save-canvas"/);
  assert.match(source, /window\.addEventListener\("keydown", handleKeyboardShortcutKeydown, true\)/);
});

test("shortcut settings are localized in English and Chinese", () => {
  const core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
  for (const key of [
    "settingsNavShortcuts", "settingsShortcuts", "settingsShortcutConflict", "settingsShortcutResetAll",
    "shortcutFocusAgent", "shortcutSaveCanvasHelp", "shortcutCanvasLibrary", "shortcutSettingsHelp",
  ]) {
    assert.match(core, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
});

test("Tab toggles Agent twice from controls and editors without stealing focus", () => {
  const source=read("src/client/app/keyboard-shortcuts.js"), vm=require("node:vm"), calls=[];
  const state={interactingWidgetId:null}, panel={hidden:true,contains:target=>Boolean(target?.inPanel)};
  const context={state,settings:{},canvasAgentPanel:panel,document:{body:{classList:{contains:()=>!panel.hidden}}},
    keyboardShortcutBlockingSurfaceOpen:()=>false,canvasAgentAvailable:()=>true,
    keyboardShortcutLocalSurface:()=>false,
    keyboardShortcutTextEditingTarget:target=>Boolean(target?.editable),
    keyboardShortcutControlOwnsKey:event=>Boolean(event.target?.button),
    openCanvasAgent:options=>{calls.push(['open',options.focus]);panel.hidden=false;},
    closeCanvasAgent:options=>{calls.push(['close',options.focus]);panel.hidden=true;}};
  const api=vm.runInNewContext(`${functionSource(source,'keyboardShortcutCanRun')}\n${functionSource(source,'keyboardShortcutPerform')}\n({keyboardShortcutCanRun,keyboardShortcutPerform})`,context);
  const command={id:'focus-agent'};
  assert.equal(api.keyboardShortcutCanRun(command,{target:{}},'Tab'),true);
  api.keyboardShortcutPerform(command.id);api.keyboardShortcutPerform(command.id);
  assert.deepEqual(calls,[['open',false],['close',false]]);
  for(const target of [{editable:true},{button:true},{inPanel:true}])assert.equal(api.keyboardShortcutCanRun(command,{target},'Tab'),true);
  for(const target of [{editable:true},{button:true},{inPanel:true}])assert.equal(api.keyboardShortcutCanRun(command,{target},'Mod+k'),false);
  state.interactingWidgetId='widget';assert.equal(api.keyboardShortcutCanRun(command,{target:{}},'Tab'),true);
  state.interactingWidgetId=null;assert.equal(api.keyboardShortcutCanRun(command,{target:{},defaultPrevented:true},'Tab'),false);
});

test("pointer controls retain workspace shortcuts while keyboard navigation and editors own their keys", () => {
  const vm = require("node:vm"), source = read("src/client/app/keyboard-shortcuts.js");
  let blocking = false, local = false;
  const context = { state:{}, settings:{}, canvasAgentAvailable:()=>true,
    canvasAgentPanel:{contains:target=>Boolean(target?.agent)},
    keyboardShortcutBlockingSurfaceOpen:()=>blocking,
    document:{querySelector:()=>local},
  };
  const names = ["keyboardShortcutTextEditingTarget", "keyboardShortcutInteractiveTarget", "keyboardShortcutControl", "keyboardShortcutPointerDown", "keyboardShortcutFocusChanged", "keyboardShortcutControlOwnsKey", "keyboardShortcutChordKey", "keyboardShortcutLocalSurface", "keyboardShortcutCanvasContext", "keyboardShortcutCanRun"];
  const api = vm.runInNewContext(`let keyboardShortcutPointerControl = null;\n${names.map(name=>functionSource(source,name)).join('\n')}\n({${names.join(',')}})`, context);
  const button = {closest:selector=>selector.includes('#studioNavigator') || selector.startsWith('button') ? button : null};
  const input = {closest:selector=>selector.startsWith('input') ? input : null};
  const event = {target:button};
  const agent = {id:'focus-agent'};
  assert.equal(api.keyboardShortcutCanRun(agent,event,'Tab'),true);
  api.keyboardShortcutPointerDown(event);
  api.keyboardShortcutFocusChanged(event);
  for (const id of ['focus-agent','save-canvas','undo','redo','canvas-library']) {
    assert.equal(api.keyboardShortcutCanRun({id},event,'Tab'),true,id);
  }
  assert.equal(api.keyboardShortcutCanvasContext(event,'h'),true);
  for (const chord of ['Enter','Space','Delete','Backspace','ArrowLeft']) assert.equal(api.keyboardShortcutCanvasContext(event,chord),false,chord);
  assert.equal(api.keyboardShortcutCanRun(agent,{target:button,metaKey:true},'Mod+j'),true);
  api.keyboardShortcutFocusChanged({target:input});
  assert.equal(api.keyboardShortcutCanRun(agent,event,'Tab'),true);
  assert.equal(api.keyboardShortcutCanRun({id:'undo'},{target:input,metaKey:true},'Mod+z'),false);
  assert.equal(api.keyboardShortcutCanRun({id:'save-canvas'},{target:input,metaKey:true},'Mod+s'),true);
  api.keyboardShortcutPointerDown(event);
  for (const flag of ['defaultPrevented','isComposing','repeat']) assert.equal(api.keyboardShortcutCanRun(agent,{...event,[flag]:true},'Tab'),false);
  blocking=true;
  assert.equal(api.keyboardShortcutCanRun(agent,event,'Tab'),false);
  blocking=false;local=true;
  assert.equal(api.keyboardShortcutCanvasContext(event,'h'),false);
  local=false;context.state.interactingWidgetId='widget';
  assert.equal(api.keyboardShortcutCanRun(agent,event,'Tab'),true);
});

test("Canvas cancellation yields to editing and modal contexts and consumes only one action", () => {
  const vm = require('node:vm'), source = read('src/client/app/ui-bootstrap.js');
  const start = source.indexOf('  window.addEventListener("keydown", (e) => {', source.indexOf('window.addEventListener("keydown", handleFeatureTourKeydown'));
  const end = source.indexOf('  window.addEventListener("keyup", (e) => {',start);
  let handler, cancellations=0, contextAllowed=true;
  const context = {
    window:{addEventListener:(_,callback)=>{handler=callback;}},
    keyboardShortcutTextEditingTarget:target=>target.editable,
    keyboardShortcutCanvasContext:()=>contextAllowed,
    keyboardShortcutChordFromEvent:event=>event.key,
    document:{querySelector:()=>({open:false,hidden:true,classList:{contains:()=>false}})},
    eraserToolMenu:{hidden:true}, state:{selection:{phase:'active'}},
    cancelSelection:()=>{cancellations++;},activeWidgetRefinement:()=>false,
    closeHistorySavePanel:()=>false,
  };
  vm.runInNewContext(source.slice(start,end),context);
  const event = {key:'Escape',target:{},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  handler({...event,target:{editable:true}});
  handler({...event,defaultPrevented:true});
  contextAllowed=false;handler({...event});
  assert.equal(cancellations,0);
  contextAllowed=true;handler(event);
  assert.equal(cancellations,1);
  assert.equal(event.prevented,true);
  assert.equal(event.stopped,true);
});
