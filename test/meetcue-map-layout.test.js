"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const MM = require("../public/lines/meetcue-map.js");
const { getExample } = require("../src/server/project-lines/meetcue-examples.js");

function boxesOverlap(a, b, tol = 0.5) {
  return a.x + tol < b.x + b.w && b.x + tol < a.x + a.w && a.y + tol < b.y + b.h && b.y + tol < a.y + a.h;
}

test("layoutMap is deterministic and produces identical SVG output on repeated runs", () => {
  const ex = getExample("example-launch-sync");
  const map = MM.normalizeMapPayload(ex);
  assert.ok(map);
  const a = MM.renderMapSvg(map, { uid: "det", measure: MM.estimate });
  const b = MM.renderMapSvg(map, { uid: "det", measure: MM.estimate });
  assert.deepEqual(a.layout, b.layout);
  assert.equal(a.html, b.html);
  assert.ok(a.layout.tree, "uses MeetCue top-down tree layout");
  assert.equal(Object.keys(a.layout.frames).length, 3);
  assert.equal(Object.keys(a.layout.nodes).length, 8);
  assert.match(a.html, /class="mm-root"/);
  assert.match(a.html, /class="mm-branch"/);
  assert.match(a.html, /class="mm-branch-label"/);
  assert.match(a.html, /class="mm-glyph"/);
  assert.match(a.html, /class="mm-mark done"/);
  assert.match(a.html, /class="mm-mark ask"/);
});

test("normalizeMapPayload supports native MeetCue data.map including hubs, edge kinds, and item badges", () => {
  const nativePayload = {
    map: {
      title: "Architecture review",
      gist: "Align on storage tier and regional failover.",
      topics: [
        { id: "t1", label: "Storage tier", status: "done", sofar: ["Move blobs to R2"], ahead: [] },
        { id: "t2", label: "Failover plan", status: "active", sofar: ["Active-passive in EU"], ahead: ["RTO under 30s?"] },
      ],
      nodes: [
        { id: "core1", label: "Infra Team", kind: "org", note: "Platform owners", topic: "" },
        { id: "n1", label: "R2 Bucket", kind: "system", note: "Zero egress", topic: "t1" },
        { id: "n2", label: "Cache Layer", kind: "system", note: "Edge TTL", topic: "t1" },
        { id: "n3", label: "EU Replica", kind: "place", note: "Frankfurt", topic: "t2" },
        { id: "n4", label: "RTO Target", kind: "metric", note: "< 30s", topic: "t2" },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", label: "warms", kind: "flow" },
        { id: "e2", from: "n3", to: "n4", label: "meets", kind: "support" },
      ],
      tree: {
        thread: "Storage migration and EU failover.",
        hubs: [{ id: "h1", label: "Reliability", frames: ["t1", "t2"] }],
        frames: [
          { id: "t1", hub: "h1" },
          { id: "t2", parent: "t1", rel: "requires" },
        ],
      },
      items: [
        { list: "open", about: ["n4"] },
        { list: "asks", done: false, about: ["n4"] },
        { list: "decided", about: ["n1"] },
      ],
    },
  };

  const map = MM.normalizeMapPayload(nativePayload);
  const { html, layout } = MM.renderMapSvg(map, { uid: "nat", measure: MM.estimate });
  assert.equal(layout.tree.hubs.length, 1);
  assert.equal(layout.tree.hubs[0].label, "Reliability");
  // Core node (topic: "") is placed beside the root card inside root.w.
  const coreNode = layout.nodes.core1;
  assert.equal(coreNode.frame, "");
  assert.ok(coreNode.x >= layout.tree.root.x + 380, "core node sits to the right of the root title card");
  assert.match(html, /class="mm-hub"/);
  assert.match(html, /class="mm-edge k-flow"/);
  assert.match(html, /class="mm-edge k-support"/);
  assert.match(html, /class="mm-badge open"[^>]*><circle[^>]*\/><text[^>]*>2<\/text>/);
  assert.match(html, /class="mm-badge done"[^>]*><circle[^>]*\/><text[^>]*>✓<\/text>/);
});

test("normalizeMapPayload reconstructs partner { meeting, whole_diagram, diagrams } with core nodes and inferred topics", () => {
  const partner = {
    meeting: { title: "Vendor sync", gist: "Pricing and delivery schedule." },
    whole_diagram: {
      nodes: [
        { id: "c0", label: "Acme Corp", kind: "org", note: "Primary vendor", topic: "" },
        { id: "n1", label: "Unit Cost", kind: "metric", note: "$10.50", topic: "Price" },
        { id: "n2", label: "Volume Tier", kind: "concept", note: "10k units", topic: "Price" },
        { id: "n3", label: "Warehouse", kind: "place", note: "Shenzhen", topic: "Logistics" },
      ],
      edges: [
        { from: "n1", to: "n2", label: "scales with", kind: "depends" },
      ],
    },
    diagrams: [
      {
        topic: "Price",
        status: "done",
        sofar: ["$10.50 locked"],
        ahead: ["Volume discount?"],
        nodes: [
          { id: "n1", label: "Unit Cost", kind: "metric", note: "$10.50" },
          { id: "n2", label: "Volume Tier", kind: "concept", note: "10k units" },
        ],
        edges: [{ from: "n1", to: "n2", label: "scales with", kind: "depends" }],
      },
    ],
  };

  const map = MM.normalizeMapPayload(partner);
  assert.equal(map.title, "Vendor sync");
  assert.equal(map.gist, "Pricing and delivery schedule.");
  // Price from diagrams + Logistics inferred from whole_diagram.nodes
  assert.deepEqual(map.topics.map(t => t.label), ["Price", "Logistics"]);
  assert.equal(map.nodes.find(n => n.id === "c0").topic, "");
  // With explicit isWhole:true and no tree hierarchy, uses MeetCue's two-column mind-map layout around the center core.
  const { layout } = MM.renderMapSvg(map, { uid: "part", isWhole: true, measure: MM.estimate });
  assert.equal(Object.keys(layout.frames).length, 2);
  assert.equal(layout.nodes.c0.frame, "");
  assert.ok(layout.core, "core entities sit between left and right topic columns when tree is absent");
  // When tree layout is explicitly forced (columns: false), core sits beside the root card.
  const forcedTree = MM.renderMapSvg(map, { uid: "part-tree", columns: false, measure: MM.estimate });
  assert.ok(forcedTree.layout.nodes.c0.x > forcedTree.layout.tree.root.x + 380);
});

test("shared core nodes stay core in both whole_diagram and diagrams-only payloads and all cross-group edges route", () => {
  // Variant A: whole_diagram marks c0 with topic: "" while per-topic diagrams repeat c0 without topic.
  const withWhole = {
    meeting: { title: "Supplier call", gist: "Prices and delivery." },
    whole_diagram: {
      nodes: [
        { id: "c0", label: "Acme", kind: "org", note: "Core supplier", topic: "" },
        { id: "n1", label: "Unit price", kind: "metric", note: "$10.50", topic: "Price" },
        { id: "n2", label: "Truck", kind: "system", note: "Tuesdays", topic: "Delivery" },
      ],
      edges: [
        { from: "c0", to: "n1", label: "sets" },
        { from: "c0", to: "n2", label: "sends" },
        { from: "n1", to: "n2", label: "funds" },
      ],
    },
    diagrams: [
      { topic: "Price", status: "done", sofar: ["$10.50 agreed"], ahead: [], nodes: [{ id: "c0", label: "Acme", kind: "org" }, { id: "n1", label: "Unit price", kind: "metric", note: "$10.50" }], edges: [{ from: "c0", to: "n1", label: "sets" }] },
      { topic: "Delivery", status: "upcoming", sofar: [], ahead: [], nodes: [{ id: "c0", label: "Acme", kind: "org" }, { id: "n2", label: "Truck", kind: "system", note: "Tuesdays" }], edges: [{ from: "c0", to: "n2", label: "sends" }] },
    ],
  };
  const mapA = MM.normalizeMapPayload(withWhole);
  assert.equal(mapA.nodes.find(n => n.id === "c0").topic, "", "explicit whole_diagram core node must not be stolen by diagrams");
  const renderedA = MM.renderMapSvg(mapA, { uid: "coreA", isWhole: true, measure: MM.estimate });
  assert.equal(renderedA.layout.nodes.c0.frame, "");
  assert.equal(renderedA.layout.edges.length, 3, "all 3 cross-group edges must be routed in tree-free full map");

  // Variant B: legacy diagrams-only payload (no whole_diagram); c0 appears unassigned in both diagrams -> classified as core.
  const diagramsOnly = { meeting: withWhole.meeting, diagrams: withWhole.diagrams };
  const mapB = MM.normalizeMapPayload(diagramsOnly);
  assert.equal(mapB.nodes.find(n => n.id === "c0").topic, "", "shared unassigned node across diagrams must be classified as core");
  const renderedB = MM.renderMapSvg(mapB, { uid: "coreB", isWhole: true, measure: MM.estimate });
  assert.equal(renderedB.layout.nodes.c0.frame, "");
  assert.equal(renderedB.layout.edges.length, 2, "both core-to-topic edges must be routed");
});

test("tree-free 10-topic 60-node partner map uses compact two-column layout instead of an ultra-wide single row", () => {
  const topics = Array.from({ length: 10 }, (_, i) => `议题${i + 1}：核心推演与政策应对`);
  const diagrams = topics.map((topic, ti) => {
    const tNodes = Array.from({ length: 6 }, (_, j) => ({
      id: `tf_${ti}_${j}`, label: `节点${ti + 1}-${j + 1}`, kind: MM.KINDS[(ti + j) % MM.KINDS.length], note: "关键要点",
    }));
    const tEdges = Array.from({ length: 5 }, (_, j) => ({
      from: `tf_${ti}_${Math.floor(j / 2)}`, to: `tf_${ti}_${j + 1}`, label: "关联",
    }));
    return { topic, status: ti < 5 ? "done" : "active", sofar: ["已讨论结论"], ahead: [], nodes: tNodes, edges: tEdges };
  });
  const wholeNodes = [
    { id: "core_team", label: "策略组", kind: "org", note: "跨议题核心", topic: "" },
    ...diagrams.flatMap(d => d.nodes.map(n => ({ ...n, topic: d.topic }))),
  ];
  const wholeEdges = [
    ...diagrams.flatMap(d => d.edges),
    { from: "core_team", to: "tf_0_0", label: "主讲" },
    { from: "core_team", to: "tf_5_0", label: "跟进" },
    { from: "tf_0_5", to: "tf_1_0", label: "传导" },
  ];
  const map = MM.normalizeMapPayload({ meeting: { title: "无树结构完整会议" }, whole_diagram: { nodes: wholeNodes, edges: wholeEdges }, diagrams });
  assert.equal(MM.hasTreeHierarchy(map), false);
  const { layout } = MM.renderMapSvg(map, { uid: "tf60", isWhole: true, measure: MM.estimate });
  assert.equal(Object.keys(layout.frames).length, 10);
  assert.equal(Object.keys(layout.nodes).length, 61);
  assert.equal(layout.edges.length, 53, "all 50 intra-topic + 3 cross-group edges routed");
  const width = layout.bounds.maxX - layout.bounds.minX;
  assert.ok(width < 1800, `two-column tree-free layout width (${width}) should be far narrower than a 10-card single row`);
  const leftFrames = Object.values(layout.frames).filter(f => f.side === "left");
  const rightFrames = Object.values(layout.frames).filter(f => f.side === "right");
  assert.ok(leftFrames.length >= 3 && rightFrames.length >= 3, "topics split across both columns");
});

test("prototype-key node/topic IDs like constructor and __proto__ do not crash layout", () => {
  const map = MM.normalizeMapPayload({
    map: {
      title: "Prototype safety",
      topics: [
        { id: "constructor", label: "Topic A", status: "done", sofar: ["ok"], ahead: [] },
        { id: "toString", label: "Topic B", status: "active", sofar: [], ahead: [] },
      ],
      nodes: [
        { id: "constructor", label: "Ctor", kind: "concept", topic: "constructor" },
        { id: "hasOwnProperty", label: "Prop", kind: "metric", topic: "constructor" },
        { id: "valueOf", label: "Val", kind: "person", topic: "toString" },
      ],
      edges: [
        { id: "constructor", from: "constructor", to: "hasOwnProperty", label: "links", kind: "flow" },
        { id: "toString", from: "hasOwnProperty", to: "valueOf", label: "cross", kind: "rel" },
      ],
    },
  });
  const { html, layout } = MM.renderMapSvg(map, { uid: "proto", isWhole: true, measure: MM.estimate });
  assert.equal(Object.keys(layout.nodes).length, 3);
  assert.ok(html.includes('data-node="constructor"'));
});

test("mountMap fits narrow viewports without clipping, zoom-out never zooms in, pointercancel does not select, and destroy cleans up", () => {
  const listeners = new Map();
  const makeClassList = () => {
    const s = new Set();
    return {
      add: c => s.add(c),
      remove: c => s.delete(c),
      toggle: (c, on) => (on ? s.add(c) : s.delete(c)),
      has: c => s.has(c),
    };
  };
  const makeEl = (attrs = {}) => {
    const el = {
      attrs: { ...attrs },
      dataset: {},
      style: {},
      classList: makeClassList(),
      getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
      setAttribute: (k, v) => { el.attrs[k] = String(v); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 420 }),
      addEventListener: (t, fn) => { const list = listeners.get(el) || []; list.push([t, fn]); listeners.set(el, list); },
      removeEventListener: (t, fn) => { const list = listeners.get(el) || []; listeners.set(el, list.filter(([et, ef]) => !(et === t && ef === fn))); },
      closest: () => null,
    };
    return el;
  };

  const nodeA = makeEl({ "data-node": "a", "aria-pressed": "false" });
  const nodeB = makeEl({ "data-node": "b", "aria-pressed": "false" });
  nodeA.closest = sel => (sel === "[data-node]" ? nodeA : null);
  const edgeAB = makeEl({ "data-from": "a", "data-to": "b" });
  const world = makeEl();
  world.querySelectorAll = sel => (sel === ".mm-node" ? [nodeA, nodeB] : sel === ".mm-edge" ? [edgeAB] : [edgeAB]);
  const svg = makeEl();
  svg.setPointerCapture = () => {};
  const fitBtn = makeEl({ "data-mm-act": "fit" });
  const canvas = makeEl();
  canvas.clientWidth = 360;
  canvas.clientHeight = 420;
  const stage = makeEl();
  stage.isConnected = true;
  stage.clientWidth = 360;
  stage.clientHeight = 420;
  stage.dataset = { minx: "0", miny: "0", maxx: "3600", maxy: "600", edges: JSON.stringify([["a", "b"]]) };
  stage.querySelector = sel => (sel === ".mm-canvas" ? canvas : sel === "svg.mm-svg" ? svg : sel === ".mm-world" ? world : sel === '[data-mm-act="fit"]' ? fitBtn : null);
  stage.querySelectorAll = sel => (sel === "[data-mm-act]" ? [fitBtn] : sel === '[data-mc-map="1"]' ? [stage] : []);

  let roDisconnected = 0;
  const origRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() { roDisconnected++; }
  };
  try {
    const ctrl = MM.mountMap(stage);
    const v0 = ctrl.getView();
    // 360px wide - 44 controls - 36 pad = 280px available; 3600 wide map must fit inside 280px (k <= 280/3600 = 0.0778).
    assert.ok(v0.k <= 280 / 3600 + 1e-6, `fit scale ${v0.k} must not clip 3600-wide map in 360px viewport`);

    // Zooming out from an already-small fitted view must NEVER zoom IN.
    ctrl.zoomBy(0.8);
    assert.ok(ctrl.getView().k <= v0.k + 1e-9, `zoom-out (${ctrl.getView().k}) must not exceed previous scale (${v0.k})`);

    // pointercancel must clean up and NEVER trigger node selection.
    const svgHandlers = Object.fromEntries((listeners.get(svg) || []).map(([t, fn]) => [t, fn]));
    svgHandlers.pointerdown({ button: 0, pointerType: "touch", pointerId: 1, clientX: 50, clientY: 50, target: nodeA });
    svgHandlers.pointercancel({ pointerId: 1 });
    assert.equal(nodeA.classList.has("sel"), false, "pointercancel must not select node");

    // Keyboard Enter selects node and sets aria-pressed="true".
    let prevented = false;
    svgHandlers.keydown({ key: "Enter", target: nodeA, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(nodeA.classList.has("sel"), true);
    assert.equal(nodeA.getAttribute("aria-pressed"), "true");

    // unmountAll disconnects observer, removes listeners, and allows clean remount.
    assert.equal(MM.unmountAll(stage), 1);
    assert.equal(roDisconnected, 1);
    assert.equal((listeners.get(svg) || []).length, 0);
    assert.equal(stage.__mmMounted, false);
    assert.ok(MM.mountMap(stage), "stage can be remounted cleanly after unmount");
    MM.unmountAll(stage);
  } finally {
    globalThis.ResizeObserver = origRO;
  }
});

test("single-topic rendering uses MeetCue topic frame without meeting root card", () => {
  const ex = getExample("example-launch-sync");
  const single = MM.normalizeTopicDiagram(ex.diagrams[0], 0);
  const { html, layout } = MM.renderMapSvg(single, { uid: "t0", columns: true, isWhole: false, measure: MM.estimate });
  assert.equal(layout.tree, undefined);
  assert.equal(Object.keys(layout.frames).length, 1);
  assert.doesNotMatch(html, /class="mm-root"/);
  assert.match(html, /class="mm-frame st-done"/);
  assert.match(html, /class="mm-mark done"/);
  assert.match(html, /class="mm-mark ask"/);
  assert.match(html, /class="mm-glyph"/);
  assert.match(html, /class="mm-edge k-owns"/);
  assert.match(html, /Pro at \$12\/mo/);
});

test("60-node, 10-topic Chinese full meeting map lays out all nodes with zero overlaps inside frames or between frames", () => {
  const topics = [
    "中期选举：变与不变",
    "AI回调：泡沫破裂还是逢跌抄底？",
    "外部变局对中国：出口依赖AI超级周期",
    "美国AI开支：总额不变但时长拉长",
    "算力结构性转移：海外建算力与效率",
    "行业分化：闭眼买数据中心硬件的时代结束",
    "10月CPI：油价输入型通胀",
    "财政：政策转向条件未成熟",
    "资金回流：美国AI降温能否利好中国",
    "中美股市：AI敞口已过多",
  ];
  const kinds = MM.KINDS;
  const edgeKinds = MM.EDGE_KINDS;
  const nodes = [];
  const edges = [];
  const diagrams = topics.map((topic, ti) => {
    const tNodes = [];
    const tEdges = [];
    for (let j = 0; j < 6; j++) {
      const id = `n_${ti}_${j}`;
      const node = {
        id,
        label: `${topic.slice(0, 4)}节点${j + 1}`,
        kind: kinds[(ti * 6 + j) % kinds.length],
        note: `关键观察与数据点 ${ti + 1}.${j + 1}`,
        topic,
      };
      tNodes.push(node);
      nodes.push(node);
    }
    for (let j = 0; j < 5; j++) {
      const e = {
        from: `n_${ti}_${Math.floor(j / 2)}`,
        to: `n_${ti}_${j + 1}`,
        label: j % 2 === 0 ? "驱动" : "制约",
        kind: edgeKinds[(ti + j) % edgeKinds.length],
      };
      tEdges.push(e);
      edges.push(e);
    }
    return {
      topic,
      status: ti < 7 ? "done" : ti === 7 ? "active" : "upcoming",
      sofar: [`已确认：${topic.slice(0, 8)}的核心逻辑`],
      ahead: ti % 2 === 0 ? [`待观察：${topic.slice(0, 6)}的后续催化？`] : [],
      nodes: tNodes,
      edges: tEdges,
    };
  });

  const payload = {
    meeting: {
      title: "宏观策略与AI资本开支深度讨论",
      gist: "围绕美国中期选举、AI资本开支节奏、算力迁移、通胀与财政转向展开10大议题推演。",
    },
    whole_diagram: {
      topic: "Full meeting map",
      nodes,
      edges,
      tree: {
        thread: "美国中期选举与AI资本开支周期交织，影响中美通胀、财政与股市资金流向。",
        hubs: [
          { id: "h_us", label: "美国宏观与AI周期", frames: topics.slice(0, 6) },
          { id: "h_cn", label: "中国宏观与市场应对", frames: topics.slice(6) },
        ],
        frames: [
          { id: topics[0], hub: "h_us" },
          { id: topics[1], hub: "h_us" },
          { id: topics[2], parent: topics[1], rel: "传导至出口" },
          { id: topics[3], parent: topics[1], rel: "核心分歧" },
          { id: topics[4], parent: topics[3], rel: "结构演进" },
          { id: topics[5], parent: topics[3], rel: "行业影响" },
          { id: topics[6], hub: "h_cn" },
          { id: topics[7], parent: topics[6], rel: "约束政策" },
          { id: topics[8], hub: "h_cn" },
          { id: topics[9], parent: topics[8], rel: "估值映射" },
        ],
      },
    },
    diagrams,
  };

  const map = MM.normalizeMapPayload(payload);
  assert.equal(map.topics.length, 10);
  assert.equal(map.nodes.length, 60, "must NOT truncate at <60 nodes");
  const { html, layout } = MM.renderMapSvg(map, { uid: "zh60", measure: MM.estimate });
  assert.equal(Object.keys(layout.frames).length, 10);
  assert.equal(Object.keys(layout.nodes).length, 60);
  assert.equal(layout.tree.hubs.length, 2);

  // Verify no two topic frames overlap each other.
  const frameList = Object.values(layout.frames);
  for (let i = 0; i < frameList.length; i++) {
    for (let j = i + 1; j < frameList.length; j++) {
      assert.equal(
        boxesOverlap(frameList[i], frameList[j]),
        false,
        `frames "${frameList[i].label}" and "${frameList[j].label}" must not overlap`
      );
    }
  }

  // Verify no two entity boxes overlap inside any frame, and every box sits within its frame.
  for (const frame of frameList) {
    const inside = Object.values(layout.nodes).filter(n => n.frame === frame.id);
    assert.equal(inside.length, 6, `frame ${frame.label} should hold all 6 nodes`);
    for (let i = 0; i < inside.length; i++) {
      const a = inside[i];
      assert.ok(a.x >= frame.x && a.y >= frame.y && a.x + a.w <= frame.x + frame.w + 1 && a.y + a.h <= frame.y + frame.h + 1,
        `node ${a.id} must stay inside frame ${frame.id}`);
      for (let j = i + 1; j < inside.length; j++) {
        assert.equal(
          boxesOverlap(a, inside[j]),
          false,
          `nodes ${a.id} and ${inside[j].id} inside frame ${frame.id} must not overlap`
        );
      }
    }
  }
  assert.ok(html.includes('data-node="n_9_5"'));
});

test("strict XSS escaping and cyclic tree protection", () => {
  const malicious = {
    map: {
      title: '<script>alert("t")</script>',
      gist: '"><img src=x onerror=alert(1)>',
      topics: [
        {
          id: 't1" onclick="evil()',
          label: '<b>Topic & "quotes"</b>',
          status: 'done" onload="bad()',
          sofar: ["<svg/onload=alert(2)>"],
          ahead: ["'single' & <tag>"],
        },
        { id: "t2", label: "Topic 2", status: "active" },
      ],
      nodes: [
        { id: 'n1" onmouseover="x()', label: '<img src=x>', kind: 'person" bad="1', note: 'a & b < c > d', topic: 't1" onclick="evil()' },
        { id: "n2", label: "Node 2", kind: "metric", note: "", topic: 't1" onclick="evil()' },
      ],
      edges: [
        { id: "e1", from: 'n1" onmouseover="x()', to: "n2", label: "<script>bad</script>", kind: 'flow" evil="1' },
      ],
      tree: {
        thread: '<iframe src="evil">',
        hubs: [{ id: "h1", label: "<script>hub</script>", frames: ["t2"] }],
        frames: [
          { id: 't1" onclick="evil()', parent: "t2", rel: '<b onclick="x">rel</b>' },
          { id: "t2", parent: 't1" onclick="evil()', rel: "cycle" },
        ],
      },
    },
  };

  const map = MM.normalizeMapPayload(malicious);
  const { html } = MM.renderMapSvg(map, { uid: 'bad"id', measure: MM.estimate });
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<img\s/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /<svg\/onload/i);
  assert.doesNotMatch(html, /"\s+on(?:error|load|click|mouseover)=/i);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;svg/onload=alert(2)&gt;"));
  assert.ok(html.includes('data-frame="t1&quot; onclick=&quot;evil()"'));
});

test("extractTopicDiagrams prefers native data.map (preserving edge kinds and core nodes) and renderMapDom builds safe zero-innerHTML DOM", () => {
  const payload = {
    meeting: { title: "Native sync", gist: "Pricing & rollout" },
    map: {
      title: "Native sync",
      gist: "Pricing & rollout",
      topics: [
        { id: "t1", label: "Pricing", status: "done", sofar: ["$12/mo locked"], ahead: [] },
        { id: "t2", label: "Digest only", status: "active", sofar: ["Review Q4"], ahead: ["Budget?"] },
      ],
      nodes: [
        { id: "core1", label: "Acme", kind: "org", note: "Partner", topic: "" },
        { id: "n1", label: "Pro Tier", kind: "metric", note: "$12/mo", topic: "t1" },
        { id: "n2", label: "Discount <script>x</script>", kind: "concept", note: "", topic: "t1" },
      ],
      edges: [
        { id: "e1", from: "core1", to: "n1", label: "sponsors", kind: "support" },
        { id: "e2", from: "n1", to: "n2", label: "blocks", kind: "conflict" },
      ],
      tree: {
        thread: "Pricing & rollout",
        hubs: [],
        frames: [{ id: "t1" }, { id: "t2", parent: "t1", rel: "leads to" }],
      },
    },
    diagrams: [
      { topic: "Pricing", status: "done", sofar: ["$12/mo locked"], ahead: [], nodes: [{ id: "n1", label: "Pro Tier", kind: "metric" }], edges: [] },
    ],
  };

  const topics = MM.extractTopicDiagrams(payload);
  assert.equal(topics.length, 2, "includes digest-only topic from native map");
  assert.equal(topics[0].nodes.length, 3, "includes linked core node in topic diagram");
  assert.deepEqual(topics[0].edges.map(e => e.kind), ["support", "conflict"], "preserves edge kinds");

  // Fake strict DOM that forbids innerHTML.
  const makeNode = (tag) => ({
    tag: tag.toLowerCase(),
    children: [],
    attributes: {},
    className: "",
    _text: "",
    get textContent() { return this._text + this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(_v) { throw new Error("innerHTML forbidden"); },
    append(...kids) { this.children.push(...kids); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
  });
  const fakeDoc = { createElement: makeNode, createElementNS: (_ns, tag) => makeNode(tag) };
  const map = MM.normalizeMapPayload(payload);
  const { element, layout } = MM.renderMapDom(fakeDoc, map, { uid: "dom1", isWhole: true, interactive: true, measure: MM.estimate });
  assert.ok(element);
  assert.equal(element.attributes["data-mc-map"], "1");
  assert.ok(layout.tree);
  const all = (n, acc = []) => { acc.push(n); for (const c of n.children || []) all(c, acc); return acc; };
  const nodes = all(element);
  assert.equal(nodes.filter(n => n.tag === "script").length, 0);
  assert.equal(nodes.filter(n => n.tag === "g" && n.attributes["data-node"]).length, 3);
  assert.ok(nodes.some(n => n.tag === "g" && n.attributes.class === "mm-edge k-conflict"));
  assert.ok(element.textContent.includes("Discount"));
  assert.ok(element.textContent.includes("<script>x</script>"));
});

test("flat native tree renders with root card and thread (1:1 phone parity) and extractTopicDiagrams is edge-order invariant", () => {
  const flatNative = {
    map: {
      title: "Weekly standup",
      gist: "Two independent topics.",
      topics: [
        { id: "t1", label: "Frontend", status: "done", sofar: ["Shipped v2"], ahead: [] },
        { id: "t2", label: "Backend", status: "active", sofar: ["DB indexed"], ahead: ["Load test?"] },
      ],
      nodes: [
        { id: "c1", label: "Alice", kind: "person", topic: "" },
        { id: "c2", label: "Bob", kind: "person", topic: "" },
        { id: "n1", label: "Web UI", kind: "system", topic: "t1" },
        { id: "n2", label: "API", kind: "system", topic: "t2" },
      ],
      // Edge order tests that core c2 (linked only to c1, NOT directly to t1's n1) does not leak into t1 regardless of order.
      edges: [
        { id: "e1", from: "n1", to: "c1", label: "owned by", kind: "owns" },
        { id: "e2", from: "c1", to: "c2", label: "reports to", kind: "rel" },
      ],
      tree: {
        thread: "Frontend shipped; backend indexing complete.",
        hubs: [],
        frames: [{ id: "t1" }, { id: "t2" }],
      },
    },
  };
  const map = MM.normalizeMapPayload(flatNative);
  assert.equal(MM.hasNativeTree(map), true);
  assert.equal(MM.hasTreeHierarchy(map), false);
  const { html, layout } = MM.renderMapSvg(map, { uid: "flat", isWhole: true, measure: MM.estimate });
  assert.ok(layout.tree, "flat native tree uses treeLayout with root card");
  assert.match(html, /class="mm-root"/);
  assert.ok(html.includes("Frontend shipped; backend indexing complete."));

  const topicsA = MM.extractTopicDiagrams(flatNative);
  const reversed = { map: { ...flatNative.map, edges: [...flatNative.map.edges].reverse() } };
  const topicsB = MM.extractTopicDiagrams(reversed);
  assert.deepEqual(topicsA[0].nodes.map(n => n.id).sort(), ["c1", "n1"]);
  assert.deepEqual(topicsB[0].nodes.map(n => n.id).sort(), ["c1", "n1"]);
});
