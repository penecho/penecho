---
line: ../../lines/dark-mode.md
step: Work 2
who: "@codex"
started: {{when -1 11:20}}
took: 7 min
reviewed: {{when -1 14:56}}
---

# Work 2: Dark mode

[Back to dark-mode.md](../../lines/dark-mode.md)

## Asked

> Check Claude's plan against our code. What does it miss?

## Result

<!-- result: the agent's last message -->
The plan holds. Four things it misses in our code, on the homepage branch:

1. `home.js` paints the dots itself (`NODE`, and `stroke="#94a3b8"` on each line), so they would stay light. They need classes, with their colours in `style.css`.
2. The theme has to be set in `<head>`, before `style.css`, or a dark page flashes white every time it opens.
3. The week's bars use `rgba(37, 99, 235, .18)`, which is too faint on a dark background. Dark needs its own.
4. System should follow the computer while the page is open, not only when it loads.

The agents' colours (Claude, Codex, OpenCode) read on both backgrounds and can stay as they are.
<!-- /result -->

## How it was done

- Read Claude's options on this line
- Read `index.html`, `style.css` and `home.js` on `homepage`
- Opened the page with the computer in dark mode to see what stays light
- Changed nothing
