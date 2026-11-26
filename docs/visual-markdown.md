# Visual Markdown: how a PenEcho project is kept

**A project is a folder of Markdown with pictures.** You can read it on a phone, in any Markdown viewer, or in PenEcho. Agents read and write the same files. Nothing important is locked inside an app, and nobody needs an old chat to know where things stand.

The pictures are what make it more than notes. They come from the Canvas, so a Topic can explain itself with architecture, workflow and sequence diagrams, Visual Explorer pages and notes.

## The folder

```text
My project docs/                       The Vault. It need not be where the code lives.
├── README.md                          Every Line and its status. PenEcho keeps it current.
├── MEMORY.md                          What every agent should know. Changed only with .penecho/memory.
├── understanding.md                   The way in: what the project is, where it stands, its Topics. Kept by agents.
├── topics/                            Knowledge: one requirements document per subject, kept by agents. Never a Line.
│   └── canvas-feedback.md
├── lines/                             Your words: one file per Line (task), every Ask word for word. Only .md files.
│   ├── canvas-comments.md             A Line: what was asked and what was done, in order
│   └── launch-checklist.md            A note: nothing has been asked of an agent yet
├── works/
│   └── canvas-comments/
│       ├── work-1.md                  The whole of one piece of work
│       └── work-2.md
├── files/
│   ├── _incoming/                     Uploads on their way into a Line
│   └── canvas-comments/               A Line's files
│       ├── architecture.png           A picture from the Canvas
│       ├── architecture.penecho.json  Its editable source, beside it
│       ├── screen shot.png            Something you attached
│       ├── spec.md                    A file an agent wrote for this Line
│       └── merge-arrow.svg            The arrow you drew when you merged
├── archive/                           Archived Lines with their Works and files, in the same layout
│   ├── lines/  works/  files/
├── .trash/lines/<line>-<id>/          Deleted Lines with their Works and files, for a week, with deleted.json
├── .penecho/                          The memory command, topics-guide.md (the Topic rules), layout.json and the move log
└── .history/                          Earlier versions of files you edited
```

Every path is decided in one place, `src/server/project-lines/layout.js`. Links keep their depth: from `lines/x.md` a file is `../files/x/…` and a Work `../works/x/work-1.md`; from a Work, `../../files/x/…` and `../../lines/x.md`.

A folder made before 15 November 2026 (layout 1) kept Lines and Works in `topics/`. PenEcho moves it once, when it opens it with nothing running on it: every file moves, the links in every Markdown file are rewritten, each changed file is kept as it was in `.penecho/migrations/<time>/before/`, and `log.json` there lists every move. `node scripts/project-layout.cjs undo <docs folder>` moves it back (files nobody changed since get their exact old bytes back) and marks it to stay in layout 1. Until it is moved, PenEcho reads and writes it in its old places. PenEcho Cloud still sees every project by layout-1 names (`topics/<line>.md`, `topics/<line>/work-N.md`); knowledge Topics and `understanding.md` stay on the computer until Cloud reads layout 2.

Archiving a Line (Archive, Outdated, a merged branch) moves its Line, Works and files into `archive/`; Restore moves them back. Links to it in `topics/` and `understanding.md` follow. Agents' default search (`rg … lines topics`) leaves the archive out.

## One line, one file, a detail file for each piece of work

| | `lines/x.md` | `works/x/work-1.md` |
| --- | --- | --- |
| **Holds** | Where it stands, questions for you, and then every Ask and every piece of work in order: your words whole, a few words on what came of each piece of work, and its pictures | The whole of one piece of work: what it was asked, the agent's last message, its pictures, what it changed and what it did |
| **Written by** | You, here or in any editor. PenEcho keeps the status and the steps current | PenEcho, from what the agent did. An agent can link what it made under Result |
| **Rule** | Nobody rewrites the words under an Ask | One file for each piece of work |
| **Answers** | What was asked, what was done, and where is it now? | What exactly happened in this piece of work? |

A new agent reads a few small files and has what it needs: `MEMORY.md`, `understanding.md`, its Line and that Line's Topic. It follows a Details link only if it needs more. The Copy prompt button shows the estimate in tokens.

A Markdown file in `lines/` with no `status` is a note. It stays yours until you hand it to an agent, and then that same file becomes the Line. A file in `topics/` is never a Line, even with a `status`.

## A Topic file

The line on a Topic's page is read from this file. Each `## Ask` and each `## [ ] Work` is a stop on it. The front matter is the status, and anything an agent or a person writes here wins.

```markdown
---
id: CC-1
status: working
who: "@claude"
branch: penecho/canvas-comments
base: main
created: 2026-11-05 10:01
---

# Canvas comments

<!-- status: PenEcho keeps this current -->
> [!status] Working on Work 2 · @claude
<!-- /status -->

## Questions for you

Tick one here, in any Markdown editor, or in PenEcho.

**Pins or margin?** (@claude)

- [ ] Pins
- [ ] Margin

## Decided by you

- Tabs or spaces? **Tabs**

## Ask · 2026-11-05 10:01

Let people leave notes on a Canvas.

![screen shot.png](../files/canvas-comments/screen shot.png)

## [x] Work 1 · @claude · 12 min

The comment layer is in, on its own branch.

![Where comments live](../files/canvas-comments/architecture.png)

[Details](canvas-comments/work-1.md)

## Ask · 2026-11-05 10:30 · Claude desktop

Keep the notes small.

## [ ] Work 2 · @claude
```

`status` is one of `not-started`, `working`, `waiting`, `ready`, `stopped`, `paused`, `landed`, `done` or `closed`.

`## Ask` and `## Work` always count as steps. Any other kind (`Prototype`, `Grill me`, `Review`, `Merge`) needs its checkbox, so that a plain `## Review` in someone's own text is only a heading. Words anyone writes with a `##` heading of their own drop one level, so they stay inside their section.

## A detail file

```markdown
---
line: ../canvas-comments.md
step: Work 1
who: "@claude"
started: 2026-11-05 10:01
took: 12 min
from: 341e34d6
to: 7ac12f09
changes: +120 -7 4
---

# Work 1: Canvas comments

[Back to canvas-comments.md](../canvas-comments.md)

## Asked

> Let people leave notes on a Canvas.

## Result

The agent's last message, whole.

## Pictures

![Where comments live](../../files/canvas-comments/architecture.png)

## Changes

On branch `penecho/canvas-comments`: +120 −7 in 4 files.

- `src/comments.js` +96 −0

## How it was done

- Ran `npm test`
- Edited `src/comments.js`
```

While the work is going on, a `## Now` section says what it is doing, so someone reading on a phone can see. `from` and `to` are the commits this piece of work started and ended on, so its changes are its own and not the whole branch's.

## Topics written the older way

Topics used to be two files, `x.md` and `x.tasks.md`. PenEcho turns each such pair into this form the next time it looks at the folder. The activity it kept splits the work between messages, so each piece gets its own result. The two old files stay in `.history/`.

## Pictures

A picture in a Topic is an ordinary image link, so it shows up in any viewer. The `.penecho.json` source sits beside the PNG. Saving on the Canvas updates both, and every file that links the PNG shows the new picture.

## Docs folder and code folder

They are separate on purpose. A project may have no code at all, one docs folder can outlive several repositories, and it never adds noise to a code repo. To let agents working in the code find the docs, paste the short pointer from the Vault page into `AGENTS.md` or `CLAUDE.md` in the repo.

## An Ask not sent yet

An Ask can wait for you to send it. Its heading says so, and it stays at the end of the file:

```markdown
## Ask · 2026-11-05 10:30 · Not sent

Rename the sidebar.

![mock.png](../files/rename-the-sidebar/mock.png)
```

No agent is woken by it or told about it. Edit it or delete it like any other text. When the message reaches an agent, PenEcho replaces it with the Ask that agent really got, so it is never there twice. Delete `· Not sent` by hand and it counts as said, like any new Ask.

## Notes and drawings

A line also holds what you put on it yourself and nobody is asked about. A **note** is your words. A **Canvas** is a drawing, kept beside its picture so it opens on the Canvas as you left it:

```markdown
## Note · 2026-11-07 09:12

Vectors are arrows: $\vec v = (2, 1)$.

## Canvas · 2026-11-07 09:20

![Board](../files/lesson-1/drawing-k3.png)
```

Like an Ask, neither has a checkbox, and neither is work: no agent is woken by them or answers them. A note can be changed or removed; an Ask that reached an agent stays as it was, because it is what the agent read. Notes and Asks are read as Markdown, and anything that looks like LaTeX is drawn as a formula: `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, `equation` and `align` blocks, and a whole LaTeX document pasted as it is. A line holding only notes and drawings has `status: notes`.

## Lines off main

In a project with a code folder, a line that is not about the code says so in its front matter:

```markdown
---
status: notes
git: no
---
```

It has no branch and no merge, it is drawn under main on the map, apart from it, and its work happens in the docs folder. Paste names no branch for it. A line that names no code folder (`code:`) and no branch is off main too: that is a line made before the project had a code folder. Lines made for the code folder carry `code:`, and a line on a branch says `branch:`.

## Saying more

You can say more from anywhere the file can be edited: the box on the page, a new `## Ask` at the end of the file in any editor, or by ticking an answer to a question. It lands in the file word for word, with images and files as real links. PenEcho notices the change within seconds and sends the work back to an agent, with a new piece of work after your words. Changing what an earlier Ask says does the same, and tells the agent what it now reads.
