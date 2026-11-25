---
line: ../../lines/homepage-from-my-drawing.md
step: Work 2
who: "@codex"
started: {{when -3 13:58}}
took: 29 min
from: {{commit main}}
to: {{commit homepage}}
---

# Work 2: Homepage from my drawing

[Back to homepage-from-my-drawing.md](../../lines/homepage-from-my-drawing.md)

## Asked

> Looks right. Build it in the app like the prototype.

## Result

<!-- result: the agent's last message -->
**The homepage is built** as in the prototype, on the branch `homepage`.

- Added `home.js`, which draws the whole page; `timeline.js` is gone
- Changed `index.html`, `style.css` and `data.js`, which now has the projects and their files
- Opened it in a browser and clicked through the days and the projects

Nothing is merged into main.
<!-- /result -->

## How it was done

- Opened the prototype from the Canvas and read its page
- Made the branch `homepage` from main
- Moved the drawing code into `home.js`: the projects, the week, the lines on one trunk, newest day first, and the latest files
- Kept the prototype's times: a time that would run into the one before it shows when you point at its step
- Committed "Homepage from the drawing: projects, week, lines on a trunk, latest files"
