# Note cards and knowledge cards

A note card is a General HTML Widget whose document PenEcho builds from a compact
note source (`penecho-note-card+json`), the same way scenes work. People, Canvas AI,
PenEcho Agent and MCP all create the same object, and every card appears in the
Notes view of the Library.

## One type, two looks

Notes and knowledge cards are one object type with one source format, one size and
one library. Only the look differs:

| Look | `style` | Used for | Visual |
| --- | --- | --- | --- |
| Knowledge card | `card` | concepts, formulas, worked examples, references | flat near-white paper, category bar on the top edge, serif title, flashcards |
| Work note | `note` | meetings, ideas, plans, to-dos | plain white sheet, date block, continuous coloured spine |

The look follows the category until the person picks a look (`styleChosen`), and can
be switched at any time from the card chooser.

Every card renders in a fixed portrait 3:4 frame (900 × 1200 CSS px). On a Canvas, all
cards share one size: the first card takes a comfortable height for the current view,
and later cards reuse it (`cardSize`). Edge handles scale the whole card, so the shape
never changes. On the Canvas the card has its own frame: rounded corners and a
soft contact shadow, without offset paper layers.

Maximized browsing initially fits the whole card within the space below the toolbar,
including its full height. This fit can be below 50% and follows window resizing.
The card retains its authored dimensions and its own body scroll area; the outer
presentation does not need to scroll until the person zooms in for closer reading.
Returning to the fit zoom or reopening the card restores automatic fitting.
In either Canvas maximization or the Notes & Cards reader, clicking an original
handwriting image or picture opens a window-sized image viewer. Keyboard users
can focus the image and press Enter or Space. The viewer supports fit, actual size,
zoom and scrolling; Escape closes it and preserves the card's reading position.

## Content

A card has a searchable `title` and 1–24 blocks in reading order:

| Block | Purpose |
| --- | --- |
| `markdown` | text, lists, task lists, quotes, simple tables, `$inline$` and `$$display$$` LaTeX |
| `formula` | one display formula with an optional caption |
| `ink` | the original handwriting (a transparent image of the lassoed strokes) |
| `image` | a picture (https or inline data URL) |
| `graph` | an explicit curve such as `y = sin(x)`, plotted as SVG with the eval-free parser |
| `keypoints` | numbered takeaways |
| `callout` | key, definition, tip, warning, example or question |
| `qa` | a flashcard; the answer is hidden until tapped (no scripts) |
| `checklist` | tasks with done states |
| `code`, `quote`, `table`, `divider` | as named |

Optional fields: `subtitle`, `category`, `categorySource`, `tags` (≤ 8), `summary`,
`bookmarked`, `accent`, `style`, `styleChosen`, `language`, `created`, `updated`.
Knowledge cards and work notes show the title without a subtitle row; existing
subtitle values remain available for search and ranking. Work notes use plain
paper without decorative horizontal rules across the body, header or footer.
New captures retain handwriting up to 1760 pixels on the longest edge and pictures
or Widget snapshots up to 1520 pixels, twice the previous capture limits. Handwriting
is rendered at twice the Canvas resolution and prefers lossless PNG. Existing saved
captures retain their original pixels. Encoding still adapts to the storage budget;
small imported pictures retain their source resolution. Inline pictures are limited
to 600,000 characters in total, with a Note-only generated document limit of 700,000.
Organize as Note counts media inside selected Note cards together with captured
handwriting and pictures. When their combined source exceeds the budget, it
re-encodes the copies for the new card instead of dropping pictures; the original
cards and Canvas ink remain unchanged. Building the local fallback is deferred
until it is needed, so a local Note validation error cannot prevent the AI request
from starting. AI results also retain pictures copied from selected Note cards.
Math is rendered on the Canvas with MathJax SVG; before MathJax loads,
the LaTeX source shows and the card re-renders once MathJax is ready.

## Categories

Built-in categories: Concept, Formula, Worked example, Reference (knowledge cards)
and Idea, Work, Meeting, To-do (work notes). People can add their own (name, colour,
look) in the Notes view. A card stores a snapshot of its category so it renders on
any device.

Categories are assigned automatically and stay editable:

1. Canvas AI, PenEcho Agent or MCP choose one when they create the card
   (`categorySource: "model"`); a quick local guess covers cards made without a
   model (`"local"`).
2. People can refine the category from the chooser or library. A category the
   person picks (`"user"`) is never changed automatically. Library ranking does
   not submit rendered cards or run per-card category requests.

The chooser beside a new card shows which source set the category ("set
automatically by PenEchoLLM — tap to change").

## Organize as Note (Suggest Bar)

The ordinary ink and lasso action spaces both include **Organize as Note**. The
Suggest Bar shows it when it ranks among the visible suggestions; it is not a
permanent shortcut. It can rank near the front for a substantial text selection or an existing-content
region enclosed by a user's pen stroke. Small fragments and ordinary unselected
writing do not promote it; ranking determines its visibility. A large empty selection or a plain
geometric loop does not qualify. Selection classification also checks the text
scope from the image, including loaded handwriting without vector history.
For qualified grouped notes, classification independently checks whether the
content explicitly requests another operation. Without such a request, Note
comes first even when automatic organization, formatting or practice could also
help. Explicit operations retain their own priority. A pen enclosure targets the
earlier content; its boundary is not offered for geometric cleanup by the model.
Clicking a ranked Note action captures a read-only region; an enclosing stroke
limits that capture to its polygon, rather than all nearby dirty input.

1. PenEcho gathers what the lasso holds, in reading order: handwriting (as one
   transparent image), text boxes, images, graph widgets (as graph blocks), existing
   note cards (merged) and other widgets (as snapshots).
2. With a Canvas AI connection, the selection goes to Canvas AI with the `note`
   suggestion focus. The model returns a note object: it transcribes handwriting
   into Markdown and LaTeX, names the card, picks a category from the user's list
   and may place `{"type":"ink","ref":"selection"}`. PenEcho inserts the original
   handwriting there (or at the end) and keeps pictures and graphs the model cannot
   reproduce.
3. Without a connection, or if the model returns nothing usable, PenEcho inserts the
   instant local card instead.
4. The card lands beside the selection at the deck size, in one undoable step. The
   chooser offers category, bookmark, look and the library.

Tools menu (shapes button): **New note** and **Notes library**.

## Notes view in the Library

The Notes view lives in the Library, beside Recent and Favorites. Open it from:

- the title bar **…** menu → **Notes & cards**;
- the Library sidebar → **Notes & cards**;
- the recent-work sidebar footer → **Notes & cards**;
- the Suggest Bar tools menu, the card chooser or the card toolbar;
- **Mod+Shift+E** (configurable in Settings → Keyboard shortcuts).

It lists independent saved snapshots, as uniform 3:4 tiles from rendered
thumbnails. **Save to Notes & Cards** is separate from Bookmark and Fav. New
committed notes are saved automatically; the chooser shows the saved state.
Bookmark marks useful notes for filtering; Fav retains the existing private
Widget-favorite behavior.

Library previews render at 900×1200 from the saved note source, independently
of the original Canvas and its live scroll position. The encoder prefers WebP
at quality 0.96 within the 700 KiB data-URL limit. Capture waits for the preview
iframe's actual 900×1200 viewport, including cross-origin process resize delivery.
Oversized previews try lower
WebP qualities, then JPEG when needed for compatibility; resolution decreases
only if these encodings still exceed the limit. Preview versions invalidate
both the previous 360×480 JPEG and 900×1200 lossless caches. Visible library
entries regenerate in a serial background queue, including
notes whose original Canvas is closed or unavailable. Late captures are discarded
after source changes, removal or an account switch; note content stays intact.

- Search by title, tags, category and content (English words and Chinese bigrams).
- Canvas startup does not read the Notes & Cards library or poll it. Opening
  Notes & Cards requests 12 snapshots; downward scrolling requests another
  bounded page. Search, categories, tags, bookmarks, counts and sorting operate on the
  entire account on the server, including notes outside the loaded pages.
  A short first page also responds to downward wheel input and the Load more
  button. Closing the library aborts its outstanding page request.
- The Notes & Cards Library replaces the Canvas Projects/Locations sidebar
  with Categories followed by Tags. Both sections show counts across all matching pages and
  independent All controls; Categories also offers Add category. Tags are
  collected from every saved note/card, including unloaded pages, with casing
  variants grouped together. Selecting a category limits the tag list and its
  counts to that category; selecting a tag limits the category list and its counts
  to cards containing that tag. Each facet keeps alternatives within the opposite
  selection available, and clearing either filter expands the opposite list.
  A category and an exact tag combine with bookmark
  and search filters. Clicking a selected tag clears only that tag. Narrow
  layouts use horizontally scrollable category and tag rows; saved custom
  categories from other devices remain available before local settings know them.
- Sort defaults to **Recently edited**, newest edit first. Smart · PenEchoLLM,
  due for review, by category and A–Z remain available.
- Detail: title, tags and summary without a duplicate preview or source title;
  standalone reading and adding to the current Canvas lead the actions. Bookmark,
  review and optional source Canvas are grouped separately, followed by editable
  category, compact storage status and metadata priority. Removal requires an
  explicit confirmation, with Cancel focused first; canceling or pressing Escape
  keeps the saved entry. The confirmation explains that the Canvas original stays.
- **Review** due knowledge cards within the current category/tag/search/bookmark
  filters with Leitner boxes (again, 1, 3, 7, 16, 35 days). Show card opens the
  complete original document, including every answer, math and media, in the
  sandboxed Widget host. Body text reflows at a readable size and scrolls;
  grading controls stay visible. Rendering does not use the thumbnail or
  truncate the source, and does not change the saved card.
  Review fetches batches of 12 only after the person starts reviewing. After
  grading, the next batch reads the remaining due cards, up to 40 per session.

Standalone reading works without the original Canvas. Adding to the current
Canvas links the same snapshot; subsequent source edits update it. Removing a
library entry preserves the Canvas original and writes a synchronization marker,
so reopening an old Canvas cannot silently restore it. The original's chooser
offers **Save to Notes & Cards** to explicitly restore the entry. A bookmark or
category changed in the library for a closed Canvas is applied when it opens.

### Durability and synchronization

- Local server snapshots live in `PENECHO_STATE_DIR/notes-and-cards` (default CLI
  state directory: `~/.penecho`). Each acknowledged write is atomically replaced
  and flushed to disk; previous revisions remain in `history/` for recovery.
- IndexedDB `penecho-note-library` is a recovery cache. Existing local entries
  migrate to the server, without silently discarding entries at a count limit.
  The Cloud browser cache is scoped by account.
- Signed-in local servers upload complete snapshots through `/api/v1/notes`.
  The durable outbox retries on startup and every 30 seconds; Cloud changes
  download independently. An account switch cannot upload another account's
  already linked notes. Cloud-browser creation writes directly to that account.
- Cloud PostgreSQL table `notes_and_cards` references the account, with no Canvas
  foreign key. Notes count toward the workspace storage quota. A failed quota
  check or concurrent-version check preserves the acknowledged backup. Device
  conflicts retain the local copy and the Cloud copy and display a conflict tag.
- Tiles show device/server and Cloud acknowledgement or pending/conflict status.
  Closing or deleting a Canvas never deletes its library snapshot. Closing the
  browser with an unacknowledged backup uses the browser's unsaved-work guard.

## PenEchoLLM ranking

One `note_rank` request contains bounded metadata records: title, subtitle,
summary, category, tags, look, bookmark, edit time, review due state and block
types. It contains no image, handwriting raster or full body. Cloud creates one
independent probability question per candidate in that HTTP request. Browse
priority considers usefulness, recency, bookmarks and review; search probability
measures semantic relevance to the supplied query.

The pinned tokenizer checks the complete input for **each question** against
1536 tokens, including shared facts and framing. The full library is never put
in shared facts. Oversized Unicode metadata is compacted by trimming optional
summary/subtitle/tags before the title. The request uses one HTTP call: 100 notes
fit as 100 independent questions, each under its own limit. Large libraries use
at most 200 browse candidates and 64 search candidates in the shared contract.
The paged library submits only the currently displayed snapshots for model
inference. Every saved note remains browsable and participates in server text
search even when it has not been downloaded by the browser.

Smart order uses the returned priority, with the existing local bookmark,
recency and review score as fallback. Search blends `0.25·text + 0.65·relevance +
0.10·base`; missing model relevance falls back to local text. Results are cached
by metadata, query and day, and edits during inference cannot receive stale
scores. Thumbnails serve display and preview only.

## Creating cards from AI, Agent and MCP

- **Canvas AI**: `html_widget` with `sourceFormat:"penecho-note-card+json"` and a
  `note` object (or `tool:"note_card"`). The server validates it, retries once with
  the validation error, and builds the document.
- **PenEcho Agent**: `canvas_create` item `{type:"note", note, placement}`, or
  `penecho_present_widget` with `note`.
- **MCP**: `penecho_present_widget({artifactId, title, note})`; guidance id
  `note-card`.
- **Edits**: patch `objects/<id>/widget.source` (the note JSON). Pictures appear as
  `penecho-note-media:N` references that PenEcho restores; `widget.html` is read-only.
  Canvas AI Refine uses the same source with a note-specific patch policy.

## Files

- `public/note-card.js` — source validation, document, deck geometry, local card,
  ranking, review (shared by browser and server; unit-tested).
- `src/client/app/note-cards.js` — Organize as Note, chooser, Notes view, PenEchoLLM
  ranking, Agent/MCP helpers.
- `public/smart-suggest.js` — the `note` action (selection only).
- `src/server/main.js` — `note` suggestion focus, `normalizedNoteCommand`, retry.
- `src/server/mcp/*`, `src/server/canvas-agent/runtime.mjs`, `src/server/widget-patch.js`.
- `test/note-card.test.js`.
