## Architecture diagrams

Apply only to architecture diagrams or regions; all other visuals keep their rules. Architecture uses the following specification instead of generic infographic density, feature-card and panel-count defaults.

Draw a component relationship map: **short entity labels, meaningful boundary frames, explicit entity-to-entity arrows, supporting detail outside the map**. Choose the arrangement yourself from the system's topology and the reader's question. Preserve branches, independent paths and shared dependencies rather than forcing a chain or a stack of layers.

An entity is an actor, component, service or store, not a feature list or parameter. Give it a short name and at most one short role. Frames express named containment; distinguish responsibility, process, deployment and trust boundaries. Put paths, configuration, counts and implementation explanations in a separate compact region keyed to entity names. Each fact belongs in one place.

Build the drawing from a single graph representation in the HTML: a node table keyed by stable IDs, named groups, and edges with from/to IDs and short optional labels. Use a small inline SVG rendering helper to generate the shapes and derive edge endpoints from the referenced node bounds. Keep each position in one place. Every arrow must connect the entities identified by its edge record; descriptive text cannot repair a wrong or missing connection. Show only relationships that actually exist.

Plan connected entities together before filling the page. Prefer shared rows/columns so important connections are straight horizontal or vertical. Reposition nodes before adding bends; otherwise use orthogonal routing lanes. Diagonals are an exception only when they materially improve the explanation. Compute every endpoint and bend from node ports plus chosen lane coordinates: a horizontal segment retains its start y, a vertical segment retains its start x. Do not enter detached absolute endpoint/bend coordinates. Check every intended orthogonal segment before rendering. Paths must avoid unrelated nodes, labels and frame titles; keep crossings distinct from junctions and use consistent strokes/arrowheads.

Derive each edge label's position from a clear segment of that edge, rather than maintaining a separate absolute label coordinate. Measure text bounds, reserve enough lane space and align labels on comparable edges. If a label overlaps another label/node/title, expand the gap or move the route and its label together. Do not use a large white backing to hide the collision. Keep arrow tips on the intended node outline after every layout adjustment.

Use one semantic color mapping across the main graph and its detail region: the same component/group name gets the same accent in both places so the reader can match them immediately. Choose distinct, restrained colors for meaningful roles/domains, and maintain contrast. Retain explicit names too; color is an aid, not the only identifier. Do not color unrelated details merely by their order on the page.

Text overlap or occlusion is a delivery failure. Reserve space for actual label bounds, including group titles and arrowheads. Place parallel-edge labels on consistent guides; wrap or widen gaps when needed. Keep labels clear of nodes, other labels and bends. A backing may interrupt its own line but must not cover unrelated content. Reposition or reroute before reducing type size.

Keep the diagram visually dominant and readable at the host viewport, with simple shapes or meaningful icons, restrained colors and normal-sized labels. Use available space; reflow or split into clearly related views when needed. Keep text and arrowheads uniformly scaled. Output only working SVG content without hidden draft paths or explanatory SVG comments.

Before delivery, verify edge records against the facts, frame membership against real boundaries, then inspect rendered endpoints, labels, overlaps, alignment and clipping. The reader should understand the system and trace its important relationships without consulting the detail region. Correct concrete defects while retaining freedom over orientation, grouping, node count and overall composition.

