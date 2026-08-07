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
source: Public HTTPS web
connect:
recommended-refresh-seconds: 60
---

# General HTML

Use native `draw` for a very simple static sketch or annotation with about 10 or fewer basic primitives or line segments. Use this capability for larger static drawings and for animation, simulation, illustration, diagrams, custom visual experiences, live displays, small interactive tools, or browser-native behavior. Prefer a compact inline SVG inside the generated HTML; SVG is the default static and animated visual format, and canvas is appropriate only when SVG is materially unsuitable. For requested motion, prefer SVG animation with CSS, SMIL, or JavaScript as appropriate. Use ordinary `write_text`, `draw_formula`, or `plot_function` for simple prose, formulas, and single-variable function plots that do not need a custom visual.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"general"`. Generate one complete responsive HTML document yourself with inline CSS and JavaScript. Choose dimensions for the actual request; a useful standalone default is `w:2400`, `h:1400`, `refreshSeconds:0`.

HTML is the sole reusable source for this plugin. Omit `copyText` and `copyLabel`; PenEcho derives its trusted Copy HTML action directly from `html`. Do not minify. Keep stable multiline formatting for later refinement: put major HTML elements, CSS declarations, and JavaScript statements on separate lines, and prefer ordinary lines below 160 characters. Never hard-wrap strings, URLs, data, or other literals where a newline could change behavior.

The visible widget must answer visually. Unless the user explicitly asks to inspect raw data or code, never use a JSON, XML, YAML, source-code, or `<pre>` dump as the primary view. If the request calls for an established professional source format, use the Professional Diagrams capability instead: PenEcho locally renders its supported `diagram_source` formats from source alone, while unsupported formats require a faithful visual HTML view plus the professional source in `copyText`.

Placement is semantic, not a search for unused canvas space. Put the widget where it most directly solves the user's problem. When the answer annotates existing canvas content, align a transparent SVG overlay with the referenced region and draw only the new information without reproducing what is underneath—for example, overlay only the solution path on an existing maze. If existing figures or objects are the actors or targets of a requested animation, position the transparent widget over their actual locations and draw only the new motion, projectile, path, or effect; never redraw the figures or build a duplicate standalone scene. Use nearby blank space only for standalone visuals or when overlap would hide information the user still needs.

Transparency is the default. Keep `html`, `body`, the outermost layout, and the SVG root transparent; do not add an enclosing background, card, border, corner radius, or shadow unless the user explicitly asks for one. For an overlay, draw only the new answer or annotation and let the existing canvas remain visible beneath it. Make requested content prominent and readable.

## Runtime rules

The generated HTML may directly access public HTTPS APIs and load HTTPS scripts, modules, styles, fonts, images, media, or other resources when they materially improve the result. Choose data endpoints that need no OAuth or API key because the local channel solves browser CORS, not source authentication. Use ordinary `fetch(url,{credentials:"omit"})` for public HTTPS data. PenEcho automatically falls back through its server when an eligible GET encounters browser CORS or a direct network failure, so generated widgets need no CORS workaround and may use public HTTPS URLs directly. Treat the result as a standard `Response`: check `response.ok`, then consume it with `response.json()`, `response.text()`, `response.blob()`, or `response.arrayBuffer()` as appropriate.

Use stable version-pinned library URLs, encode user-derived URL parameters, use `credentials:"omit"` for direct resource requests, and show useful loading and error states. Never include secrets, authorization headers, cookies, private endpoints, or user data that was not explicitly provided for that destination. Do not use forms, storage, `sendBeacon`, or current-frame navigation. Make useful public HTTPS source URLs from fetched news and other records clickable with `<a target="_blank" rel="noopener noreferrer">`. Native HTML, CSS, JavaScript, timers, SVG, and canvas remain preferred when no dependency is needed. Dynamic SVG fully supports inline scripts, CSS animation, SMIL animation, filters, gradients, masks, and event-driven interaction. For a multi-part SVG visual, use a wrapping CSS layout with tight-viewBox panels or rebuild coordinates from a `ResizeObserver`; never make the whole widget one fixed-size viewBox that only scales to `width:100%;height:100%`. In 3D scenes, explicitly aim the camera at the subject and keep it centered after resize. Redraw canvas, SVG, and 3D visuals after viewport changes when needed. After the initial render and meaningful layout/state changes, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; do not send it on every animation frame or clock tick.

## One-shot example

User writes `我需要一个五颜六色的钟，显示当前时间` and points right. Produce one `html_widget` there with a large colorful clock, local date and seconds, an internal one-second timer, responsive layout, no network requests, and no prose outside the command.
