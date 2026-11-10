# Professional Diagram Test Cases

Enable **Professional Diagrams** before running these cases. Each case has
three steps:

1. On a blank canvas, enter the **Create** request and trigger a manual AI
   action.
2. Confirm the widget, write the **Refine** request on or near it, then click
   the widget's **AI Refine** button.
3. Check the expected command and Copy format. Refinement must keep the same
   command type and `sourceFormat`, preserve unaffected content, and return a
   complete replacement rather than a patch.

Create requests contain 10–20 words. Refine requests contain 5–10 words.
Hyphenated terms and format names count as one word.

## Local Renderer Cases

These must return `diagram_source`. PenEcho supplies the iframe, renderer,
shared styling, and Copy button; the model must not return HTML, CSS,
JavaScript, or external URLs in `source`.

| Case | Step 1 — Create | Step 2 — Refine | Step 3 — Expected response |
| --- | --- | --- | --- |
| Mermaid sequence | `Create a customer support sequence diagram covering ticket intake, triage, escalation, resolution, and closure.` (14) | `Add a reopened ticket branch after closure.` (7) | `diagram_source`; `sourceFormat:"mermaid"`; valid complete Mermaid; **Copy Mermaid** |
| Graphviz architecture | `Create a Graphviz architecture showing gateway, authentication, orders, payments, cache, queue, and database dependencies.` (14) | `Add analytics service consuming completed order events.` (7) | `diagram_source`; `sourceFormat:"dot"`; valid complete DOT; **Copy Graphviz DOT** |
| BPMN workflow | `Model employee expense approval as BPMN including submission, manager review, finance validation, reimbursement, and rejection.` (15) | `Add compliance review for expenses above policy limits.` (8) | `diagram_source`; `sourceFormat:"bpmn-xml"`; complete BPMN 2.0 XML with DI geometry; **Copy BPMN XML** |
| Vega-Lite finance | `Create a Vega-Lite chart comparing quarterly revenue and operating margin across four business regions.` (14) | `Highlight quarters where operating margin declines.` (6) | `diagram_source`; `sourceFormat:"vega-lite"`; complete valid Vega-Lite JSON; **Copy Vega-Lite JSON** |
| GeoJSON emergency map | `Map three hospitals, ambulance coverage polygons, and emergency routes using accurate WGS84 GeoJSON coordinates.` (14) | `Add a fourth hospital and coverage zone.` (7) | `diagram_source`; `sourceFormat:"geojson"`; complete WGS84 GeoJSON; Google/AutoNavi basemap fallback; **Copy GeoJSON** |
| SMILES molecule | `Render the complete two-dimensional molecular structure for acetylsalicylic acid using valid canonical SMILES notation.` (14) | `Replace acetylsalicylic acid with ibuprofen.` (5) | `diagram_source`; `sourceFormat:"smiles"`; one valid SMILES document; **Copy SMILES** |
| Cytoscape pathway | `Create a Cytoscape signaling pathway connecting receptor activation, kinase cascade, transcription factors, and apoptosis inhibition.` (14) | `Add negative feedback from transcription factors.` (6) | `diagram_source`; `sourceFormat:"cytoscape-json"`; complete Cytoscape elements JSON; **Copy Cytoscape JSON** |

## Professional HTML Fallback Cases

These formats are intentionally outside PenEcho's local renderer list. They
must return `html_widget`, not native `draw` or `diagram_source`. The iframe
must render a usable professional view, while `copyText` contains the complete
editable source named by `sourceFormat`. The HTML view and copied source must
contain the same nodes, labels, groups, and relationships.

| Case | Step 1 — Create | Step 2 — Refine | Step 3 — Expected response |
| --- | --- | --- | --- |
| PlantUML class model | `Create a PlantUML class diagram for customers, subscriptions, invoices, payments, and their cardinality relationships.` (14) | `Add refund entity linked to payments.` (6) | `html_widget`; `sourceFormat:"PlantUML"`; complete PlantUML in `copyText`; **Copy PlantUML** |
| DBML database schema | `Create a DBML ecommerce schema covering users, products, orders, line items, and foreign keys.` (14) | `Add inventory table linked to products.` (6) | `html_widget`; `sourceFormat:"DBML"`; complete DBML in `copyText`; **Copy DBML** |
| Draw.io boiler P&ID | `Create a professional steam boiler P&ID with feedwater, fuel, controls, safety valves, and blowdown.` (14) | `Add condensate return loop and isolation valve.` (7) | `html_widget`; `sourceFormat:"draw.io XML"`; complete importable mxGraph XML; **Copy draw.io XML** |
| Structurizr C4 | `Create a Structurizr DSL C4 container view for banking channels, services, databases, and partners.` (14) | `Add fraud detection service and relationship.` (6) | `html_widget`; `sourceFormat:"Structurizr DSL"`; complete workspace DSL; **Copy Structurizr DSL** |
| D2 cloud deployment | `Create a D2 cloud deployment diagram showing edge routing, Kubernetes workloads, storage, and monitoring.` (14) | `Add disaster recovery region with replication.` (6) | `html_widget`; `sourceFormat:"D2"`; complete D2 source; **Copy D2** |
| KiCad schematic | `Create a KiCad schematic for a regulated sensor supply with protection, filtering, and connectors.` (14) | `Add reverse polarity protection before regulator.` (6) | `html_widget`; `sourceFormat:"KiCad S-expression"`; complete importable KiCad source; **Copy KiCad S-expression** |
| SPICE circuit | `Create a SPICE common-emitter amplifier with bias network, coupling capacitors, load, and power supply.` (14) | `Change collector resistor to 4.7 kilohms.` (6) | `html_widget`; `sourceFormat:"SPICE netlist"`; complete runnable netlist; **Copy SPICE netlist** |
| WaveDrom timing | `Create a WaveDrom timing diagram for clock, request, acknowledge, data bus, and reset signals.` (14) | `Add setup and hold timing markers.` (6) | `html_widget`; `sourceFormat:"WaveDrom JSON"`; complete WaveDrom JSON; **Copy WaveDrom JSON** |
| ELK control system | `Create an ELK-based feedback control diagram with plant, controller, sensor, disturbance, and summing junctions.` (14) | `Add output filter before feedback sensor.` (6) | `html_widget`; `sourceFormat:"ELK JSON"`; ELK computes layout and HTML/SVG draws it; **Copy ELK JSON** |
| TikZ mechanics | `Create a LaTeX TikZ free-body diagram for a block sliding down a frictional incline.` (14) | `Add normal force and acceleration vectors.` (6) | `html_widget`; `sourceFormat:"LaTeX TikZ"`; complete compilable TikZ; **Copy LaTeX TikZ** |
| JSXGraph optics | `Create a JSXGraph optical bench with laser, lenses, beam splitter, detector, and measured distances.` (14) | `Add focal points and ray labels.` (6) | `html_widget`; `sourceFormat:"JSXGraph JavaScript"`; complete reusable construction code; **Copy JSXGraph JavaScript** |
| Reaction SMILES | `Create a reaction SMILES synthesis route containing reagents, intermediates, conditions, yields, and reaction arrows.` (14) | `Add purification step after second intermediate.` (6) | `html_widget`; `sourceFormat:"reaction SMILES"`; complete reaction source with semantic parity; **Copy reaction SMILES** |
| FHIR clinical pathway | `Create a FHIR CarePlan clinical sepsis pathway covering screening, antibiotics, fluids, reassessment, and escalation.` (14) | `Add intensive care escalation after reassessment.` (6) | `html_widget`; `sourceFormat:"FHIR CarePlan JSON"`; complete valid CarePlan resource; **Copy FHIR CarePlan JSON** |

## Failure Conditions

A case fails if any of the following occurs:

- a local case returns `html_widget`, or a fallback case returns native `draw`;
- the Copy button is missing, mislabeled, or copies HTML/SVG instead of the
  expected professional source;
- Refine changes the command type or `sourceFormat`;
- Refine removes unaffected nodes, relationships, labels, or layout groups;
- the preview is blank, permanently shows a rendering message, clips labels,
  overlaps connectors, or displays content different from `copyText`;
- an HTML fallback loads unrelated libraries, uses unpinned `latest` URLs, or
  leaves no usable native fallback when its external renderer fails.
