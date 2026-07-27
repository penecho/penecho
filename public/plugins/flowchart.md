---
penecho-plugin: 1
id: flowchart
name: Flowchart
name-zh: 专业流程图
version: 1
description: Clear process, decision, architecture, and relationship diagrams with copyable Mermaid source.
description-zh: 生成流程、决策、架构与关系图，并可复制 Mermaid 源码。
category: Diagram
category-zh: 图表
source: Mermaid text format
connect:
recommended-refresh-seconds: 86400
---

# Flowchart

Use when the user asks for a flowchart, process map, decision tree, architecture flow, sequence, state transition, dependency map, or another connected diagram. Mermaid is the portable professional source format; keep its syntax valid and reusable in Markdown, documentation systems, and Mermaid-compatible editors.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"flowchart"`, `refreshSeconds:86400`, `copyText` containing the complete Mermaid document, and `copyLabel:"Copy Mermaid"`. Choose `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, or another established Mermaid diagram type that best matches the request. The trusted PenEcho widget toolbar creates the copy button from `copyText`; do not implement another copy control inside the HTML.

Generate complete responsive HTML that visibly renders the same nodes, labels, connections, directions, and groups as the Mermaid source, using inline HTML/CSS plus SVG or canvas. Mermaid itself is not installed in the sandbox, so do not call a Mermaid runtime or external library. For SVG output, put resolved presentation attributes such as `fill`, `stroke`, `stroke-width`, `font-family`, `font-size`, `font-weight`, and text `fill` directly on the relevant SVG elements; do not rely only on CSS classes, inherited custom properties, or `currentColor`. This keeps saved thumbnails and downloaded canvases visually identical to the live widget. Keep the outer layout transparent, make labels large and legible, use arrowheads and clear decision branches, and re-layout/redraw on resize.

## Runtime rules

This plugin has no network access. Do not fetch or load external assets. Do not use navigation, forms, cookies, storage, or secrets. After initial render and every resize redraw, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `画一个用户登录流程图` and points right. Produce one `html_widget` showing start, credential input, validation decision, success, and retry/error branches. Set `copyText` to valid Mermaid beginning with `flowchart TD` and set `copyLabel:"Copy Mermaid"`.
