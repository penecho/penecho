"use strict";

// Shared by the MCP boundary and browser. This is semantic input, never geometry.
const COLORS = ["blue", "teal", "orange", "purple", "green", "slate"];
function validateArchitecture(value) {
  const fail = message => { throw new Error(`Architecture: ${message}`); };
  const obj = (v, path, keys) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${path} must be an object`);
    for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${path}.${key} is not supported`);
    return v;
  };
  const text = (v, path, max = 160) => {
    if (typeof v !== "string" || !v.trim() || v.length > max) fail(`${path} must be nonempty text (max ${max})`);
    return v;
  };
  const list = (v, path, max) => {
    if (!Array.isArray(v) || v.length > max) fail(`${path} must be an array (max ${max})`);
    return v;
  };
  const id = (v, path) => {
    text(v, path, 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v)) fail(`${path} must start with a letter and contain letters, digits, _ or -`);
    return v;
  };
  if (value && typeof value === "object" && ["sessionId", "artifactId", "requestId"].some(key => key in value)) {
    fail("sessionId, artifactId and requestId belong beside architecture in the tool arguments, not inside the architecture object");
  }
  obj(value, "diagram", ["version", "title", "description", "direction", "domains", "groups", "nodes", "edges", "details", "notes"]);
  if (value.version !== 1) fail("version:1 is required");
  text(value.title, "title");
  if (value.description !== undefined) text(value.description, "description", 600);
  if (value.direction !== undefined && !["RIGHT", "DOWN"].includes(value.direction)) fail("direction must be RIGHT or DOWN");
  const domains = new Set(), identities = new Set();
  for (const [i, domain] of list(value.domains ?? [], "domains", 12).entries()) {
    obj(domain, `domains[${i}]`, ["id", "label", "color"]);
    id(domain.id, `domains[${i}].id`); text(domain.label, `domains[${i}].label`, 80);
    if (domains.has(domain.id)) fail(`duplicate domain ${domain.id}`);
    domains.add(domain.id);
    if (domain.color !== undefined && !COLORS.includes(domain.color)) fail(`unknown color ${domain.color}`);
  }
  const domainRef = v => { if (v !== undefined && !domains.has(v)) fail(`unknown domain ${v}`); };
  const addId = (v, path) => { id(v, path); if (identities.has(v)) fail(`duplicate id ${v}`); identities.add(v); };
  const groups = list(value.groups ?? [], "groups", 20), groupMap = new Map();
  for (const g of groups) {
    obj(g, "group", ["id", "label", "domain", "parent"]);
    addId(g.id, "group.id"); text(g.label, "group.label", 120); domainRef(g.domain); groupMap.set(g.id, g);
  }
  for (const g of groups) {
    const seen = new Set([g.id]); let parent = g.parent;
    while (parent !== undefined) {
      if (!groupMap.has(parent) || seen.has(parent)) fail(`invalid or cyclic group parent ${parent}`);
      seen.add(parent); if (seen.size > 5) fail("group nesting exceeds 4"); parent = groupMap.get(parent).parent;
    }
  }
  const nodes = list(value.nodes, "nodes", 60), nodeIds = new Set();
  if (!nodes.length) fail("nodes cannot be empty");
  for (const n of nodes) {
    obj(n, "node", ["id", "label", "subtitle", "domain", "group", "type", "details"]);
    addId(n.id, "node.id"); nodeIds.add(n.id); text(n.label, "node.label", 100); domainRef(n.domain);
    if (n.subtitle !== undefined) text(n.subtitle, "node.subtitle", 160);
    if (n.group !== undefined && !groupMap.has(n.group)) fail(`unknown group ${n.group}`);
    if (n.type !== undefined && !["frontend","backend","database","cloud","security","messagebus","external"].includes(n.type)) fail(`unknown node type ${n.type}`);
    for (const item of list(n.details ?? [], "node.details", 12)) text(item, "node detail", 1000);
  }
  for (const g of groups) if (!nodes.some(n => n.group === g.id) && !groups.some(child => child.parent === g.id)) fail(`empty group ${g.id}`);
  const edgeIds = new Set();
  for (const [i, e] of list(value.edges, "edges", 120).entries()) {
    obj(e, "edge", ["id", "from", "to", "label", "kind", "bidirectional"]);
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) fail(`edge ${i} has an unknown endpoint`);
    if (e.id !== undefined) { id(e.id, "edge.id"); if (edgeIds.has(e.id)) fail(`duplicate edge ${e.id}`); edgeIds.add(e.id); }
    if (e.label !== undefined) text(e.label, "edge.label", 120);
    if (e.kind !== undefined && !["call","data","config","optional","return"].includes(e.kind)) fail(`unknown edge kind ${e.kind}`);
    if (e.bidirectional !== undefined && typeof e.bidirectional !== "boolean") fail("bidirectional must be boolean");
  }
  for (const d of list(value.details ?? [], "details", 20)) {
    obj(d, "detail", ["title", "domain", "items"]); text(d.title, "detail.title", 120); domainRef(d.domain);
    for (const item of list(d.items, "detail.items", 12)) text(item, "detail item", 1500);
  }
  for (const note of list(value.notes ?? [], "notes", 8)) text(note, "note", 1500);
  if (JSON.stringify(value).length > 60000) fail("diagram exceeds 60000 characters");
  return JSON.parse(JSON.stringify(value));
}

function architectureHtml(value) {
  const data = validateArchitecture(value);
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><section data-penecho-architecture><script type="application/json" data-architecture-source>' + JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026") + '</script><p role="status">正在布局架构图…</p></section></body></html>';
}
module.exports = { validateArchitecture, architectureHtml, COLORS };
