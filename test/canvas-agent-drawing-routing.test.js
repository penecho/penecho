'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ANIMATED_EXPLANATION_ROUTING, NATIVE_DRAWING_ROUTING, CANVAS_RENDERING_ROUTING, VISUAL_EXPLORER_SELECTION, getAuthoringGuidance } = require('../src/server/mcp/authoring-guidance.js');
const { WORKSPACE_INSTRUCTIONS } = require('../src/server/mcp/guidance.js');

test('Agent and external MCP share native-first drawing and structured-renderer routing', async () => {
  const { DOCUMENT_TOOL_INSTRUCTIONS } = await import('../src/server/canvas-agent/document-tools.mjs');
  for (const instructions of [DOCUMENT_TOOL_INSTRUCTIONS, WORKSPACE_INSTRUCTIONS,
    getAuthoringGuidance('visual-explorer').document, getAuthoringGuidance('general-html', 'full').document]) {
    assert.ok(instructions.includes(CANVAS_RENDERING_ROUTING));
    assert.equal(instructions.split(NATIVE_DRAWING_ROUTING).length - 1, 1);
    assert.ok(instructions.indexOf(VISUAL_EXPLORER_SELECTION) < instructions.indexOf(NATIVE_DRAWING_ROUTING));
    assert.match(instructions, /Prefer native drawing for freehand completion/);
    assert.match(instructions, /action="draw_ink"/);
    assert.match(instructions, /More than 10 strokes or primitive marks, or a curve with many points, is not a reason to switch to HTML/);
    assert.match(instructions, /Finish drawing continues only missing contours in place/);
    assert.match(instructions, /For supported animation, physics and 3D illustrations, prefer penecho_present_widget with scene/);
    assert.match(instructions, /penecho_get_guidance\(\{id:"scene",detail:"full"\}\)/);
    assert.match(instructions, /Never invent unsupported fields/);
    assert.match(instructions, /respect each advertised tool's item\/point limits/);
    assert.doesNotMatch(instructions, /at most 10 strokes|must use one HTML Widget/);
    assert.match(instructions, /Explicit user implementation constraints take precedence/);
    assert.match(instructions, /do not silently simplify required content or change format/);
  }
});

test('direct Agent and MCP give animated explanations priority before the static explanation default',async()=>{
  const { DOCUMENT_TOOL_INSTRUCTIONS }=await import('../src/server/canvas-agent/document-tools.mjs');
  for(const instructions of [DOCUMENT_TOOL_INSTRUCTIONS,WORKSPACE_INSTRUCTIONS,
    getAuthoringGuidance('visual-explorer').document,getAuthoringGuidance('general-html','full').document]) {
    assert.ok(instructions.includes(ANIMATED_EXPLANATION_ROUTING));
    assert.ok(instructions.indexOf(ANIMATED_EXPLANATION_ROUTING)<instructions.indexOf(VISUAL_EXPLORER_SELECTION));
  }
  assert.match(ANIMATED_EXPLANATION_ROUTING,/Pythagorean theorem fit motion actors and beats/);
  assert.match(ANIMATED_EXPLANATION_ROUTING,/pause and replay/);
  assert.match(ANIMATED_EXPLANATION_ROUTING,/blank capture, readiness failure or tool timeout is unresolved work/);
});

test('drawing guidance preserves Visual Explorer, small annotations, plots and source-only boundaries', () => {
  const requiredBoundaries = [
    /Apply the established task routing for explanation-first results/,
    /does not replace a selected Visual Explorer/,
    /A few short labels alone do not force a Widget/,
    /follow visual-explorer guidance for a coordinated explanation and general-html for ordinary HTML tools or interaction-first results/,
    /convert existing Canvas objects or Widgets/,
    /Continue editing existing content in its current form/,
    /For function graphs use penecho_plot/,
    /require Canvas output for source-only requests/,
  ];
  for (const boundary of requiredBoundaries) assert.match(NATIVE_DRAWING_ROUTING, boundary);
});
