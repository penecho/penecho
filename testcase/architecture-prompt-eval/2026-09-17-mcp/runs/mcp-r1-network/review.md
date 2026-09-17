# R1 — unchanged original model output

Disposition: rejected. The complete HTML was published unchanged as
`mcp-architecture-r1` / `widget-1` on the new experiment Canvas. The first
presentation applied but could not capture a hidden document; explicitly opening
that same document and capturing the existing artifact produced the saved image.
No duplicate artifact or manual source repair was used.

Observed strengths:

- Local Node and authorized-browser frames are distinct; modules are not claimed
  to be separate servers. A direct HTTPS entry bypasses stdio.
- Guidance appears as a read-only side branch; browser Widget rendering is shown.
- The major paths are orthogonal, and details are outside the main graph.

Acceptance failures:

- **Critical topology:** the graph draws HTTPS access → dispatch directly, while
  RPC/schema only connects to guidance. The required RPC → tool-dispatch branch
  is absent. Evidence: the static SVG's access→dispatch path starts at (667,220),
  on the HTTPS node; RPC has no outgoing edge to dispatch. The explanatory text
  does not repair this bypass.
- **Density/readability:** most main entities contain four lines, including file
  names and mechanics. Main titles are 13.5 SVG units in a 1880-wide viewBox;
  essential labels are small at the actual 1939 CSS-pixel host viewport.
- **Geometry:** the legend runs into the Node-frame bottom edge. Dense relation
  labels occupy small gaps; the optional Cloud arrow terminates at the browser
  frame without an explicit Cloud-side endpoint.
- **Color correspondence:** several panels mix multiple ownership groups under
  one accent, while external-client/browser accents lack direct corresponding
  detail headers. This weakens the requested color index.

Rule R2 changes generalized from these defects: exact path tracing rather than
convenient attachment; main nodes limited to names/short roles, with implementation
evidence in details; matching group names/colors; text-scale and label/legend
clearance as explicit layout inputs. R2 does not receive this HTML or coordinates.

Call metadata: 330.02 seconds, input 6,379 / output 15,224 tokens, end_turn.
