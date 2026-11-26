---
line: ../../lines/dark-mode.md
step: Work 3
who: "@codex"
started: {{when -1 14:58}}
took: 22 min
from: {{commit homepage}}
to: {{commit dark-mode}}
---

# Work 3: Dark mode

[Back to dark-mode.md](../../lines/dark-mode.md)

## Asked

> Build B with your four points. Make it a new branch from homepage, since dark mode is for the new homepage.

## Result

<!-- result: the agent's last message -->
**Dark mode is in,** as option B with the four points, on a new branch `dark-mode` made from `homepage`.

- Added `theme.js`: Light, Dark or System, kept on this computer and set before the page paints
- `style.css`: every colour is a variable, with a second set for Dark
- `home.js`: the dots, lines and trunk get classes instead of colours
- `index.html`: the Theme menu at the top right

It is built on the homepage, so it merges after `homepage`. Nothing is merged into main.
<!-- /result -->

## How it was done

- Made the branch `dark-mode` from `homepage`
- Moved every colour in `style.css` into variables, then added the Dark set
- Gave the dots and lines in `home.js` classes, and kept the agents' own colours
- Checked Light, Dark and System, and switched the computer to dark with the page open
- Committed "Dark mode: Light, Dark or System" on `dark-mode`
