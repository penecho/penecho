# Candidate v1 — original model output

Rendered unchanged via MCP as `eval-b-candidate-v1`. Initial actual viewport was
2187×1134 after the host viewport changed. A second ephemeral inspection used
1939×1134, matching the baseline; both returned `pixelVerified:true`.

Scores: entities 1, boundaries 2, relationships 1, hierarchy 1, geometry 1.
Total: 6/10; improvement, but not presentation-ready.

Improvements in the pixels:
- External model and external MCP paths are now actually connected.
- Browser/local-service frames are distinct and implementation notes are in a
  separate area. SVG geometry is no longer stretched nonuniformly.

Remaining defects:
- A tile dimension is drawn as a node; provider names, source paths and other
  implementation details still clutter several topology nodes.
- The long HTTP label exceeds its routing gap and overlaps entity/frame content.
- The server-storage sentence exceeds its intended node width.
- The MCP connection has an unexplained small diagonal offset.
- An arbitrary 1240 px page ceiling leaves broad unused margins and small labels
  in the actual host viewport; main labels are typically only 13 CSS px.
- The MathJax/CDN relationship ends at an annotation rather than a clear entity;
  some browser connections terminate on the aggregate frame instead of a
  consistently defined Canvas entity.

General revision: distinguish real entities from properties; separate details
more strictly; size routing lanes for text; preserve uniform SVG scaling and
readable labels using the available viewport. Do not prescribe coordinates or
a PenEcho-specific composition.

Reported input/output usage: 4491/8907 tokens; 137.48 seconds. The request used
`thinking.type=disabled`, but the provider still emitted 3713 thinking deltas.
