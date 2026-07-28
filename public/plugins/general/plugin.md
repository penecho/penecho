---
penecho-plugin: 1
id: general
name: General HTML
name-zh: 通用 HTML
version: 1
description: Self-contained live or interactive HTML for requests that need more than ordinary canvas text and drawing.
description-zh: 为普通文字和绘图难以表达的需求生成自包含实时或交互 HTML。
category: Creative
category-zh: 创作
source: No network
connect:
recommended-refresh-seconds: 60
---

# General HTML

Use when the user explicitly requests a live display, small interactive tool, custom visual experience, or browser-native behavior that is materially better than ordinary text, formulas, static drawing, plots, or animation scenes. Examples include a colorful live clock, timer, calculator, interactive controls, or a responsive mini interface. Do not use it for normal questions, explanations, or simple static content.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"general"`. Place it at the user's arrow or box destination, or nearby blank space. Choose dimensions for the actual request; a useful default is `w:2400`, `h:1400`, `refreshSeconds:60`. Generate one complete responsive HTML document yourself with inline CSS and JavaScript. Make the requested content prominent and readable. Keep the outer layout transparent with no enclosing card background, border, or shadow.

## Runtime rules

This plugin has no network access. Do not call `fetch`, XMLHttpRequest, WebSocket, EventSource, sendBeacon, or external assets. Use only browser-native HTML, CSS, JavaScript, timers, SVG, and canvas. Do not use navigation, forms, cookies, storage, secrets, or external libraries. Reflow on viewport resize and redraw canvas or SVG visuals when needed. After the initial render and meaningful layout/state changes, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; do not send it on every animation frame or clock tick.

## One-shot example

User writes `我需要一个五颜六色的钟，显示当前时间` and points right. Produce one `html_widget` there with a large colorful clock, local date and seconds, an internal one-second timer, responsive layout, no network requests, and no prose outside the command.
