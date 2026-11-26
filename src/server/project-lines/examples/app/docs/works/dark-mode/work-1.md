---
line: ../../lines/dark-mode.md
step: Work 1
who: "@claude"
started: {{when -1 09:48}}
took: 6 min
reviewed: {{when -1 11:18}}
---

# Work 1: Dark mode

[Back to dark-mode.md](../../lines/dark-mode.md)

## Asked

> People keep asking for dark mode. What are our options? Don't build anything yet.

## Result

<!-- result: the agent's last message -->
Three ways to do it, smallest first:

| | What you get | Work |
|---|---|---|
| **A. Follow the computer** | Dark when the computer is dark, with no choice | Small |
| **B. Light, Dark or System** | A Theme menu at the top; System to start with, so most people never touch it | Small to medium |
| **C. A theme per project** | Each project in its own colours | Large, and nobody asked for it |

**I recommend B.** It is A plus one menu, and it also answers people who want dark in daylight. Whichever you choose, every colour first becomes a variable; Dark is then one more set of values. I have not changed anything.
<!-- /result -->

## How it was done

- Read `style.css` and `home.js` on the branch `homepage`, where the new homepage is
- Counted where colours are written: 28 in `style.css`, 12 in `home.js`
- Looked at how the operating system tells a page it is in dark mode (`prefers-color-scheme`)
