---
line: ../../lines/homepage-from-my-drawing.md
step: Work 1
who: "@claude"
started: {{when -3 09:31}}
took: 11 min
reviewed: {{when -3 13:57}}
---

# Work 1: Homepage from my drawing

[Back to homepage-from-my-drawing.md](../../lines/homepage-from-my-drawing.md)

## Asked

> Make a clickable prototype of this homepage, on the Canvas. Keep to what I drew.

## Result

<!-- result: the agent's last message -->
**A clickable prototype of your drawing is on the Canvas.** Projects on the left, the week across the top, every line on one trunk with its steps, and the latest files on the right. Click a day to see only its lines, or a project to switch.

I kept to what you drew. Two things I chose: the newest day is at the top, and each step has its time under it, unless it would run into the one before; that one shows when you point at the step.

Double-click the prototype on the Canvas to try it.
<!-- /result -->

## How it was done

- Read your drawing: four areas, the trunk, and the notes "one line = one thing" and "click a day"
- Read `data.js` for real line names and times, so the prototype shows this project's week
- Wrote the prototype as one page, `files/homepage-from-my-drawing/prototype.explorer.html`; PenEcho put it on the Canvas
- Clicked each day and each project in it
