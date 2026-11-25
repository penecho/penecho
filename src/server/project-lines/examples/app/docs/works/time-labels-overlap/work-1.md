---
line: ../../lines/time-labels-overlap.md
step: Work 1
who: "@claude"
started: {{when -5 10:10}}
took: 8 min
from: {{commit main}}
to: {{commit fix-time-labels}}
---

# Work 1: Time labels overlap

[Back to time-labels-overlap.md](../../lines/time-labels-overlap.md)

## Asked

> The times under the dots run into each other when steps are close together, see the circle. Fix it so they stay readable.

## Result

<!-- result: the agent's last message -->
**Fixed.** A time that would run into the one before it now moves to a second row, and when that row is full too it waits until you point at its dot. On the Order form line, 09:30 and 09:38 show; 09:44 and 09:52 show when you point at them.

- Added `labels.js`, which `timeline.js` now uses
- Added `labels.test.js`: 3 tests, all pass
- Changed `style.css`: rows are 12 px taller, for the second row of times

The change is on the branch `fix-time-labels`.
<!-- /result -->

## How it was done

- Looked at your picture: the circle is round the Order form line, four steps eight minutes apart
- Read `timeline.js`: every time was put straight under its dot, whatever was next to it
- Wrote `placeLabels` in `labels.js` and its tests, then ran `node --test`
- Opened `index.html` in a browser and checked the Order form and Menu page lines
- Committed "Time labels no longer run into each other" on `fix-time-labels`
