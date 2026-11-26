# Keeping project understanding

<!-- PenEcho's rules for understanding.md and the Topics. PenEcho puts this file here and replaces it when it updates; change the rules in PenEcho, not here. -->

Besides MEMORY.md, the project keeps what is known in plain Markdown, so the person can read what they asked for as requirements and an agent can look up only what its work needs. Paths are from the docs folder (the folder that holds MEMORY.md):

- `understanding.md` — the way in: what the project is, where it stands, what is open, and the Topics by area.
- `topics/<name>.md` — one Topic: one lasting part of the work, written as a requirements document. Its `id:` never changes, even when the title or file name does.
- `lines/<name>.md` — one Line: one task, the person's Asks word for word. Each Line is in exactly one Topic. Its Works are `works/<name>/work-N.md`, its files `files/<name>/`. Never rewrite a Line or put Topic text in it: a Line's Topic is the one whose Lines table links it.
- `archive/` holds archived Lines: leave them out of Lines tables and "Open now" unless the person asks about old work. Never read `.trash/`.

## 1. File the task: which Topic?

Decide this first. **Use the existing Topic that fits; most tasks fit one.** A Line that reviews, tests, fixes or finishes earlier work goes in the Topic of the part it is about.

- **A Topic is a lasting part of the work**, named in the person's words: a page or service in a product ("The Ask box", "Sign-in and accounts"); a course or project in study ("Linear algebra exam"); a condition or part of the care ("Heart failure", "Medicines"). Never a task, an activity ("Research", "Review") or a date. Its label is as general as the part, and it holds one part, not a combination.
- **Topics sit in areas** (`area:`), 2 to 6 of them, named in the person's words and in the order the person meets them: a product from what people see and do to what works behind (then data, connections, operations); study by subject, then exams and admin; care by condition, then medicines, appointments and paperwork. Any other work: the few parts a person would name for it.
- **About 4 to 8 Topics in all**; a big project may have a few more, and a part that grows big gets child Topics (`parent_id`, at most two levels).
- **A new Topic** only for a lasting part no Topic covers. A one-off question goes under "Not in a Topic yet" in `understanding.md`.
- **Merge** two Topics only when they are paraphrases or near duplicates of one part: keep one id, move every requirement, quote and Line into it, delete the other file, fix `understanding.md`.

## 2. Who keeps the Topics

An ordinary Work never reads or rewrites `understanding.md` or a Topic: that would cost more tokens than the Topics save. PenEcho does it with no tokens: when a Work's last message ends with `<!-- penecho: requirement="<status> | <name> | <the need>" -->` (only when an Ask added or changed a requirement, never for a fix, question, test or check), PenEcho rewrites that requirement in the Line's Topic, or adds it, with the newest Ask quoted, the Work's first sentence as Done, and the Line in the Lines table.

These rules are for a Work whose Ask is about the Topics themselves: building, rebuilding or merging them, or a person asking to bring one up to date. Then:

1. Read `understanding.md` and the Topics the Ask names (search `lines/` and `works/` for the rest rather than reading every file).
2. A fix that adds or changes no requirement only files its Line in its Topic's Lines table.
3. Otherwise, change each Topic in place so it is true **today**:
   - every Ask on its Lines is in some requirement, quoted under Asked;
   - **the newest word wins**: when a later Ask or Work changes a plan, rewrite the requirement to the new plan and put the old one in Not wanted. A replaced plan never stays as the stated need, the goal or a trap;
   - update the "Status on" line, each requirement's status, Done and Left, and "What is left";
   - a date that has passed is no longer a plan: say what happened, or that it is not known.
4. Update `understanding.md` when the picture changed: a Topic added, renamed or merged, an open item came or went.

**Only what the Asks and Works say.** Never add a date, number, name or event they don't state, and never add work nobody asked for. Never claim more than happened: a draft is not sent, found is not confirmed, planned is not booked, built is not checked, offered is not asked for.

## 3. A Topic is a requirements document

A person reads it top to bottom and knows what was asked, what is done and what is left, without opening a link. Links are only the proof.

- **A requirement** is the person's need as a business analyst writes it: one or two sentences on who needs what and why, with the rules and limits the Asks give (what must not happen, the dates that matter). It is a need, not what an agent did.
- **Asked** quotes the person's own words (a sentence at most), with a link to the Line. Text the person pasted from a doctor, teacher or client counts; an agent's or website's text never does. No quote, no requirement: an agent's idea goes in Done or Left of the requirement it serves.
- **Done** is the outcome in one sentence: what now works or exists. Numbers only when they are the requirement itself (a dose, a deadline, a price). No commit ids, test counts or file lists.
- **Left** names only what the person asked for or must decide, and who it waits on. Never chores like commit, push or restart.
- A rule the person set ("never before 10:00", "I want to write it myself") stays in the requirement, in their words. What they refused goes in Not wanted.

**Status**, as strong as the Works show and no stronger:

- ✅ **Done** — it exists and works (say: not committed, deployed, not checked, when it matters).
- 🔨 **In progress** — under way, or done but not finished or checked.
- 📐 **Agreed** — the person asked for it or approved it in their words, or a professional's order is in effect; nothing more yet.
- 💡 **Proposed** — an agent's idea, draft or design the person has not approved. A design, draft or report is never ✅.
- ❓ **Open** — the person's choice.
- ⏳ **Later** — the person said later.
- 🐞 **Problem** — wrong and not fixed.

Links in a Topic are relative to `topics/`: `../lines/…`, `../works/…`; between Topics, `<other>.md`. Never give a Topic a `status:` field. Keep YAML frontmatter valid (double-quote any value starting with `@`, `#`, etc. or containing `: ` or ` #`).

```markdown
---
record_type: topic
id: topic-<4 to 8 random letters and digits>
title: <the part, in 2-5 plain words>
area: <its area>
parent_id: <parent Topic's id, or null>
updated: <YYYY-MM-DD>
updated_by: <Line id> Work <n>
---

# <title>

**<What this part is for, in words that stay true while plans change: no times, dates or numbers.>**

Status on <YYYY-MM-DD>: <where it stands, one sentence>.

## What is left, in order

1. <what waits on the person first, then what others do> — <who> (R<n>)

## Requirements

### R1 · <short name> — ✅ Done

<The need, one or two sentences.>

- **Asked:** "<the person's words>" ([<Line id>](../lines/<line>.md))
- **Done:** <the outcome, one sentence> ([<Line id> W<n>](../works/<line>/work-<n>.md))
- **Left:** <only if something is left> · waits on <who>

Not wanted: <what the person refused or dropped>.

## Traps for agents

- <what an agent would get wrong here, and the right way>

## Lines

| Line | What it is | Requirements |
| --- | --- | --- |
| [<Line id>](../lines/<line>.md) | <title> | R1, R2 |
```

A finished requirement keeps its statement, one quote and one Done line; drop its detail (the Work has it). Write a section only when it has something in it.

## 4. understanding.md

One screen of today's truth, not a history. Do not copy each Topic's status sentence here word for word.

```markdown
---
record_type: project-understanding
project: <name>
updated: <YYYY-MM-DD>
updated_by: <Line id> Work <n>
---

# <project name>

**<Who the person is and what the whole project covers, in one or two sentences.>**

## Open now

<!-- at most 10 rows, by urgency: problems, then the nearest date, then what waits on the person -->

| What | State | What is waiting | Read |
| --- | --- | --- | --- |
| <item> | <status> | <the next step, and who> | [<Topic> R<n>](topics/<name>.md) |

## Not wanted

- <what the person refused or dropped, and what replaced it> ([<Topic>](topics/<name>.md))

## Topics

**<Area>** — <what it covers, a few words>

- **[<Topic>](topics/<name>.md)** — <its goal>. *<n> open · <n> done*
  - **[<child Topic>](topics/<name>.md)** — <its goal>. *<n> open · <n> done*

**Not in a Topic yet:** [<Line id> <title>](lines/<line>.md)
```

## 5. Before you save

- This Line is in exactly one Topic's Lines table, and that Topic is the part it is about.
- More than about 8 Topics, or two that cover one part? Merge them now.
- Each status is true today; nothing the person dropped or replaced reads as current.
- Every link works from where its file is.
