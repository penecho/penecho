# Echoes design review

Design-only proposals for the Echoes browse and Craft detail pages. Both previews use English. Product code, services, account data, and deployment are unchanged.

## Current proposals

- **A — Paper & Forest:** neutral white cards, a quiet grey page background, the existing Cloud navigation palette, and a forest-green primary action. Preview-led grid by default.
- **B — Warm Stone:** the same Cloud navigation and action colors, warm neutral content surfaces, compact media rows, and an editorial heading. List by default.

Both documents offer Browse / Craft detail, Dashboard / standalone context, and explicit preview states. Local interactions demonstrate search, category/type/sort controls, layout switching, favorites, hearts, comments, lineage playback, sharing, reporting, and unavailable Echo states. Import, publish, report submission, pagination, and external navigation are represented as preview interactions; they do not call production APIs.

## Source and rebuild

`preview.html` is the shared source. Run `python3 build.py` in this directory to generate `echoes-a.html` and `echoes-b.html`. All visual assets are inline SVG diagrams authored for this review. No external asset or temporary directory is needed to rebuild the proposals.

## Evidence and design-source map

| Region | Source | Applied rule |
| --- | --- | --- |
| Cloud palette and sidebar | `/Users/heack/workspace/penecho_cloud/public/console.css`, `.console-body` | Forest accent `#3B5034`, warm sidebar `#F7F7EF`, sage selection; latest user correction takes precedence over Desktop's purple accent. |
| Shell and responsive regions | `/Users/heack/workspace/penecho_design/penecho-design-language.html`, `#architecture` and `#responsive` | One navigation shell; content responds to the available parent width. |
| Controls and typography | Canonical catalog `#foundations`, `#buttons`, `#forms`, `#typography` | 30px controls, 5px field radius, 30/24px segmented control with 2px inset; native controls and visible focus. |
| Browse structure | Canonical catalog `#lists`, library grid and media-list examples | Consistent media/copy/action hierarchy; grid and compact rows preserve searchable data and actions. |
| Detail structure | Canonical catalog content-preview structure | Preview and supporting actions form distinct regions; narrow widths place the main action before the preview. |
| Product truth | Cloud `public/community.html`, `public/community-item.html`, `public/js/community-public.js` | Search, scope, type/category/sort, ranking period, social actions, author, read-only view, Echo, publication agreement, lineage, branches, comments, share/report states remain represented. |

Warm-neutral surfaces and the editorial heading are review proposals, not new approved global design-system tokens. No canonical catalog was changed.

## Confirmed incumbent issues

- Embedded mode hides `.community-site-head` in `community.css`, while the current page uses `.site-header` and `id="community-site-head"`. The outdated class selector explains why the public header remains visible in Dashboard.
- Embedded feed item links use `target="_top"`, so opening a detail exits the Dashboard shell. The proposed design keeps a coherent visual shell; production routing changes are not part of this design delivery.

## Verification

`verify.cjs` uses the installed Playwright runtime and cached Chromium. `validation.json` records checks for 1440px desktop, the 1939px Canvas content width, 768px and 390px layouts. It checks search/type filters, detail navigation, favorites, sharing dialog/Escape, lineage selection, comments, unavailable Echo, state rendering, JavaScript errors, and horizontal overflow. Screenshots sit beside these files.

The design detector reported two generic spacing warnings for the segmented track and the vertically centered toolbar. Their measured geometry intentionally follows the catalog's compact control pattern; they are not clipped-text errors.

## Canvas delivery and outstanding annotation question

- Echoes document: `doc-712a56869f218c74c5b4e5740ee33cbe92130658282c2b5c760bfc1bde4be29b`.
- Stable artifacts: `echoes-design-a` / `widget-1` and `echoes-design-b` / `widget-2`.
- Forest palette and latest English source applied successfully to both existing artifacts, preserving geometry.
- The separate `Cloud Projects · Redesign` document contains the user's visible circles around its top-left PenEcho / Cloud Projects heading and bottom-left Dark appearance control. The Echoes document has no ink tiles. A scope clarification is pending before changing the separate project-library design.

These files are local, uncommitted design artifacts in the formal 071 project on `main`. They have not been pushed, synced into Cloud product sources, or deployed.
