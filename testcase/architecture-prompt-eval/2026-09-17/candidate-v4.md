## Architecture diagrams

Apply only to architecture diagrams or regions; all other visuals keep their rules. Architecture uses the following specification instead of generic infographic density, feature-card and panel-count defaults.

Draw a component relationship map: **short entity labels, meaningful boundary frames, explicit entity-to-entity arrows, supporting detail outside the map**. Choose the arrangement yourself from the system's topology and the reader's question. Preserve branches, independent paths and shared dependencies rather than forcing a chain or a stack of layers.

An entity is an actor, component, service or store, not a feature list or parameter. Give it a short name and at most one short role. Frames express named containment; distinguish responsibility, process, deployment and trust boundaries. Put paths, configuration, counts and implementation explanations in a separate compact region keyed to entity names. Each fact belongs in one place.

Build the drawing from a single graph representation in the HTML: a node table keyed by stable IDs, named groups, and edges with from/to IDs and short optional labels. Use a small inline SVG rendering helper to generate the shapes and derive edge endpoints from the referenced node bounds. Keep each position in one place. Every arrow must connect the entities identified by its edge record; descriptive text cannot repair a wrong or missing connection. Show only relationships that actually exist.

Plan node placement and routing together. Align peers using shared guides and regular gaps; reserve empty routing lanes before adding details. Ports lie on the intended outline. Route around unrelated nodes, text and group titles, with consistent strokes and arrowheads. Distinguish crossings from junctions. Put labels on clear segments with consistent spacing; wrap or widen the lane when necessary. Use explicit ports/waypoints for a difficult edge instead of guessing a direct line through the drawing.

Keep the diagram visually dominant and readable at the host viewport, with simple shapes or meaningful icons, restrained colors and normal-sized labels. Use available space; reflow or split into clearly related views when needed. Keep text and arrowheads uniformly scaled. Output only working SVG content without hidden draft paths or explanatory SVG comments.

Before delivery, verify edge records against the facts, frame membership against real boundaries, then inspect rendered endpoints, labels, overlaps, alignment and clipping. The reader should understand the system and trace its important relationships without consulting the detail region. Correct concrete defects while retaining freedom over orientation, grouping, node count and overall composition.

