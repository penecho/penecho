# Widget width-fit presentation acceptance — 2026-09-24

The user chose Cloud main's width-fit reading behavior and explicitly deferred font-size fallback. This supersedes the entry-scale requirement in the earlier browser viewport and single-scroll reports.

## Behavior

- Opening a Widget scales its saved page width to the available presentation width, independently of Canvas zoom and the Widget's thumbnail size.
- Toolbar 100% means fit width; 50% displays half that width. Resizing the window recomputes the scale.
- The page keeps its authored width; text and graphics scale together. No minimum-font detection or font-size overrides were added.
- Existing single outer scrolling, saved height floor, live iframe identity, and Canvas geometry preservation remain in place. This restores Cloud's width-fit policy without restoring its container-height rewriting or measured-height feedback.

## Verification

Canonical source: `/Users/heack/workspace/penecho_071_version`. An isolated loopback test instance served the official client build. Test data used the existing workflow fixture, reduced to a 300 × 400 Canvas thumbnail with a 1200 × 1600 source viewport.

- At a 1280 × 720 browser viewport, opening the thumbnail produced a 1225px rendered page width, source viewport 1200 × 1600, and scale 1.020833. The screenshot visibly showed enlarged node labels and graphics.
- Actual mouse-wheel input over the chart reached the final notes and footer; one outer vertical scrollbar was visible.
- Toolbar 50% produced 612.5px rendered width and scale 0.510417, preserving the 1200px source width.
- At 390 × 844 and toolbar 100%, rendered width was 374px, scale 0.311667, with no horizontal overflow (outer clientWidth and scrollWidth both 390). No font fallback is applied on narrow screens.
- Returning to Canvas restored the 300 × 400 thumbnail and 1200 × 1600 source viewport.
- All 125 Widget, Science Widget and Live Clay tests passed. Build, client-output freshness, and whitespace checks passed.

This is fixture-based local verification, not the user's original document or a Cloud deployment. Changes are uncommitted; no push, Cloud synchronization, deployment, installed-app replacement, or existing-service restart was performed.
