"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("../fixtures/professional-diagrams");

const EXPECTED_IDS = [
  "process-flow", "decision-tree", "process-map", "swimlane", "sequence", "state",
  "uml-class", "uml-use-case", "uml-activity", "uml-component", "uml-deployment",
  "system-architecture", "component-architecture", "deployment-architecture", "c4-view",
  "network-topology", "dependency", "data-flow", "data-lineage", "er", "database-schema",
  "mind-map", "org-chart", "gantt", "timeline", "user-journey",
];

test("professional diagram fixtures cover the full first-release catalog with complete reusable source", () => {
  assert.deepEqual(fixtures.map((fixture) => fixture.id), EXPECTED_IDS);
  assert.equal(new Set(fixtures.map((fixture) => fixture.diagramKind)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.ok(fixture.nameZh && fixture.nameEn, fixture.id);
    assert.ok(fixture.source.trim(), fixture.id);
    if (fixture.sourceFormat === "plantuml") {
      assert.match(fixture.source, /^@startuml\n/);
      assert.match(fixture.source, /\n@enduml$/);
    } else if (fixture.sourceFormat === "dot") {
      assert.match(fixture.source, /^(?:digraph|graph)\s+\w+\s*\{/);
      assert.match(fixture.source, /\}$/);
    } else if (fixture.sourceFormat === "dbml") {
      assert.match(fixture.source, /^Table\s+\w+\s*\{/m);
      assert.equal((fixture.source.match(/\{/g) || []).length, (fixture.source.match(/\}/g) || []).length, fixture.id);
    } else if (fixture.sourceFormat === "mermaid") {
      assert.match(fixture.source, /^(?:flowchart|mindmap|gantt|timeline|journey)\b/m);
    } else assert.fail(`Unexpected source format: ${fixture.sourceFormat}`);
  }
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.sourceFormat)), new Set(["mermaid", "plantuml", "dot", "dbml"]));
});
