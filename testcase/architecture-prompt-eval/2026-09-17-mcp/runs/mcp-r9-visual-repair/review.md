# R9 — model repair reviewed in the actual MCP host

Disposition: accepted for this MCP architecture case at the tested 1939×1134
CSS viewport, after supervised model repair. This is not a fresh-generation
success or evidence of general reliability across models/projects.

## Provenance

- Real API returned `glm-5.3-flash`, `end_turn`; 73.76 s, 14,634 input tokens,
  6,843 output tokens, 19,145 HTML bytes.
- Input: fixed repository facts, actual local MCP guidance responses, prior
  model HTML and the preceding MCP capture with concrete review feedback.
- The model's complete HTML was published unchanged. Its SHA256 is
  `361e5667949e4a79f90b84c243441b7a864104cd0526b22fbadfe56a84304331`.
- Canvas: `MCP 架构 · R8 通用规则实测`; artifact
  `mcp-architecture-r9-review`, title `MCP 架构 · R9 配色与可读性修正版`,
  `widget-4`, revision 5. Receipt reports applied and pixelVerified.
- `canvas.webp` is the actual returned 1440×842 capture, not a standalone
  browser screenshot. DOM measurements separately use the actual CSS viewport.

## Review

- Main calls traverse HTTPS → RPC/schema → session dispatch → shared operations
  → browser. Direct HTTPS joins the ingress. The guidance branch points from
  RPC to the read-only rule loader and remains inside the Node boundary.
- Node binding storage and browser-owned documents/snapshots are distinct.
  Internal Agent reuse is optional, not part of the external MCP main chain.
  Cloud behavior is described separately without a false shortcut through the
  local HTTPS tool chain.
- Main entities have short names/roles; detailed filenames and mechanics are
  outside the map. Same-row title/role baselines align. Frames leave title and
  child padding. The legend and notes are outside the architectural frames.
- Orthogonal routes attach to their intended entities. The ingress label fits
  before its bend. The short canvasCall label does not paint over frame borders.
- Detail accents now use semantic `data-domain` keys: transport teal, host
  orange, binding purple, browser green. Mixed rule/Agent detail is neutral with
  named accents; detail order no longer determines semantic color.
- Prior capture gaps around wrapped inline identifiers disappeared after the
  model removed their decorative backgrounds. Source investigation and DOM
  fragments support a capture/inline-background interaction; this is a verified
  authoring workaround, not a runtime renderer fix.

## Bounded measurements

- 35 SVG texts: zero text-pair intersections above the probe's 2 px threshold.
- Five detail columns: zero horizontal overflow at 1939×1134.
- Flat-SVG geometry probe: 13 detected entities, 12 paths, zero paths crossing
  unrelated entities and zero unattached endpoints with a 6-unit tolerance.
- These probes do not check every semantic relationship, glyph, paint-order
  effect or arbitrary SVG construct. Actual MCP pixel and evidence review was
  also performed. The numeric probes alone are not an acceptance oracle.

All earlier versions remain available. Remaining detail density and repeated
return-path wording are minor polish; the concrete topology, obscured text,
color correspondence and alignment failures identified in this iteration are
resolved at the tested viewport.
