---
penecho-plugin: 1
id: general
name: General HTML
name-zh: 通用 HTML
version: 1
description: Self-contained HTML for SVG drawing, transparent overlays, live visuals, and interactive browser-native experiences.
description-zh: 为 SVG 绘图、透明叠加、实时视觉和交互式浏览器体验生成自包含 HTML。
category: Creative
category-zh: 创作
source: No network
connect:
recommended-refresh-seconds: 60
---

# General HTML

Use this capability whenever the response needs a drawing, illustration, diagram, annotation overlay, custom visual experience, live display, small interactive tool, or browser-native behavior. For drawings and static visuals, prefer a compact inline SVG inside the generated HTML. SVG is the default drawing format; use canvas only when SVG is materially unsuitable. Use ordinary `write_text`, `draw_formula`, or `plot_function` for simple prose, formulas, and single-variable function plots that do not need a custom visual.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"general"`. Generate one complete responsive HTML document yourself with inline CSS and JavaScript. Choose dimensions for the actual request; a useful standalone default is `w:2400`, `h:1400`, `refreshSeconds:0`.

Placement is semantic, not a search for unused canvas space. Put the widget where it most directly solves the user's problem. When the result annotates, traces, highlights, corrects, or completes existing canvas content, align and overlap the widget with that source content as needed. Set `x`, `y`, `w`, and `h` to the source region and map the SVG `viewBox` to the widget rectangle so overlay geometry registers with the underlying pixels. For example, a requested solution path through an existing maze should be rendered as a transparent SVG overlay directly on the maze, not as a separate maze or a path placed in nearby blank space. Use a nearby blank area only for genuinely standalone visuals or when covering the source would hide information the user still needs.

Transparency is the default. Keep `html`, `body`, the outermost layout, and the SVG root transparent; do not add an enclosing background, card, border, corner radius, or shadow unless the user explicitly asks for one. For an overlay, draw only the new answer or annotation and let the existing canvas remain visible beneath it. Make requested content prominent and readable.

## Runtime rules

This plugin has no network access. Do not call `fetch`, XMLHttpRequest, WebSocket, EventSource, sendBeacon, or external assets. Use only browser-native HTML, CSS, JavaScript, timers, SVG, and canvas. Dynamic SVG is fully supported: inline scripts, CSS animation, SMIL animation, filters, gradients, masks, and event-driven interaction may be used when useful. Do not use navigation, forms, cookies, storage, secrets, or external libraries. Reflow on viewport resize and redraw canvas or SVG visuals when needed. After the initial render and meaningful layout/state changes, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; do not send it on every animation frame or clock tick.

## One-shot example

User writes `我需要一个五颜六色的钟，显示当前时间` and points right. Produce one `html_widget` there with a large colorful clock, local date and seconds, an internal one-second timer, responsive layout, no network requests, and no prose outside the command.

User draws a maze and asks `找出路径`. Produce one `html_widget` whose transparent bounds align with the existing maze and whose inline SVG draws only the solution path over the original maze.
