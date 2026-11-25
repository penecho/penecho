# PenEcho Design Prototypes

Build the requested product screen full-bleed. Use the supplied sketch for layout, labels and component types. For a revision, edit the supplied source in place. Keep the brand, component geometry, status symbols, textures, chronological order, copy and existing interactions unless the request changes them.

Make the primary action and the information needed to take it visible on first render. Wire the main path to its next meaningful state with local, keyboard-accessible controls. Use realistic content, including a long label. Check narrow layouts for wrapping and access to actions. Keep design commentary outside the screen.

Start with `<!doctype html>` and mark the root `<html data-penecho-prototype>`. Set the authored background, color scheme and natural UI typography on the page. Use self-contained CSS, one scoped script and inline assets with zero network requests. Use real buttons for in-page actions. Avoid forms, frames, relative/hash navigation and persistent storage in the Canvas sandbox. Keep the HTML readable for focused patches, well below 150,000 characters (hard limit 200,000). Notify the host after initial render and meaningful state changes via `window.parent.postMessage({ type: "penecho-widget-updated" }, "*")`.

Scope component styles to their roles. Center icons in their wrappers, give shrinking flex children `min-width: 0`, and use `[hidden] { display: none !important; }` so a hidden flex bar occupies no space. Put requested variant or state switches in a collapsed **Tweaks** control marked `data-proto-chrome`. Leave room for product controls, including bottom-left rail and footer buttons, and the host's bottom-right 40px resize area. Keep both the trigger and its open panel reachable.

## Working with project files and previews

### Plan before writing HTML

- **Existing product or prototype.** Locate the current editable file, its rendered reference and the relevant shipped components. Check for a newer revision of the same screen. Use the user's chosen version as the baseline when specified. Identify the requested change and the few details that must survive it. Reuse actual markup, icons, spacing and behavior. Preserve placement and annotations by editing the intended Canvas artifact in place.
- **New product.** Identify the user's goal, the data it needs, and the shortest path to success. Choose typography, surfaces, accent, spacing and one distinguishing detail appropriate to this product. Use a system font stack and CSS variables for properties the reviewer can adjust. Show important information without hovering or opening a menu.
- Include the states needed to try the requested path. Add review controls only for meaningful alternatives. Provide visible focus and accessible labels, sufficient contrast, and touch equivalents for hover actions.

### Deliver on the current route

- **Lines Make.** Write the requested `.explorer.html` in the Line's files folder. For several directions on one Canvas, use one file with a compact option switch unless separate Canvases were requested. For a Lines inline Prototype step, use its specified HTML path.
- **Canvas-bound or MCP.** For separate alternatives use sibling Widgets on the same Canvas with comparison placement (`intent: "compare"`, `role: "alternative"`, `relativeTo` the first Widget and `relation: "beside"`). For a revision, patch the existing Widget using its current content hash where supported.

### Visual self-check

Inspect the current result. On Lines use the matching freshly rendered PNG for an Explorer; an inline Prototype step uses its inline preview. On MCP request `capture: true` or `intent: "inspect"` on the default view. Compare with the original at the same state and scale, including small icons, legend shapes, list order and action placement. Look for clipping, unexpected strips and overlapping controls. PenEcho's layout check can flag these defects on Lines. Address its findings in the same file.

Check the primary interaction and its resulting state where the route permits. Inspect a narrow view and keyboard access when available. Fix concrete defects, recheck, and report the inspected state and any unverified path separately. A static preview alone establishes appearance.
