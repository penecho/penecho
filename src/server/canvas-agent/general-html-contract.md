# PenEcho Agent General HTML

This contract is for ordinary General HTML only. Use it when the user explicitly asks for ordinary HTML or when custom browser behavior is the defining result: interaction that changes data or views, animation, simulation, a live display, a small browser-native tool, a freeform overlay, or a custom illustration. Do not use this route for a new Visual Explorer; that always-on contract has its own source markers and review workflow.

## Authoring contract

Create one complete responsive HTML document through `canvas_create` with one Widget item:

* `type:"widget"`
* `pluginId:"general"`
* `widgetType:"html_widget"`
* a concise title
* complete `html` with inline CSS and any necessary JavaScript
* `refreshSeconds:0` unless a live public source justifies a bounded interval
* dimensions selected for the actual content
* the exact placement returned by `canvas_inspect` when a planned Widget proposal was requested

HTML is the canonical source. Omit `copyText` and `copyLabel`; PenEcho derives its trusted Copy HTML action from `html`. Do not minify. Keep major HTML elements, CSS declarations, and JavaScript statements on stable separate lines so later `canvas_patch_widget` diffs stay small.

The visible Widget must answer visually. Unless the user explicitly requests raw data or code, do not make JSON, XML, YAML, source code, or a `<pre>` dump the primary view.

For a simple result, keep the implementation simple. Prefer native HTML/CSS and compact inline SVG. Use canvas, 3D, or a third-party dependency only when it materially serves the request. Responsive reflow, hover, and small decorative motion alone do not require a complex application structure.

## Canvas relationship

Treat the Canvas as an existing document. For an overlay or annotation, align the transparent Widget with the referenced region and draw only the new information; do not recreate the underlying content. Use nearby blank space for a standalone Widget when overlap would hide information.

Keep `html`, `body`, and the outer stage transparent by default. Add the smallest useful opaque or translucent local surface only when it improves contrast, grouping, or media presentation, or when the user asks for it. Match the current Canvas palette, typography, spacing, density, line weight, and shape language when those facts are available.

Before adding a standalone Widget to a nonempty Canvas, inspect and capture the complete Canvas, then use `canvas_inspect` with `plannedWidget` for authoritative placement. After creation or a geometry change, review the complete Canvas before another mutation.

## Runtime safety

The generated HTML may use public HTTPS resources when they materially improve the result. Use version-pinned libraries and public endpoints that need no credentials. For direct requests use `fetch(url,{credentials:"omit"})`, encode user-derived URL parameters, check `response.ok`, and show useful loading and error states.

Never include secrets, authorization headers, cookies, private endpoints, hidden proxies, or user data that was not explicitly provided for that destination. Do not use forms, persistent storage, `sendBeacon`, or current-frame navigation. Useful public source links should use `target="_blank"` and `rel="noopener noreferrer"`.

After initial render and meaningful layout or state changes, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; do not send it every animation frame.

## Refinement

For an existing General HTML Widget, read the exact `widget.html` lines and patch only the requested behavior or concrete defect. Use canonical unified-diff headers `--- a/widget.html` and `+++ b/widget.html`, preserve unrelated content and established style, then inspect the rendered result only as needed.
