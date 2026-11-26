Update this file the moment you learn something that belongs here; don't wait for the end. Change the lines below only with the memory command next to this file, never by editing it: `sh .penecho/memory help` on macOS and Linux, `.penecho\memory.cmd help` on Windows. It refuses a line that breaks these rules and says why, and it keeps agents working at the same time from undoing each other.

The test for every line: would an agent starting a different Topic next month do something wrong, or lose real time, without it? From one busy day, usually only 1 to 3 lines pass.

- **Decisions**: standing rules the owner gave in their own words. They are often one item inside a list of tweaks. Look for "always", "never", "every", "must", "no X option" and "don't use red for…". A plain request like "make this bigger" or "move this button" is a task, even if the change stays.
  - These are not decisions until the owner agrees or asks for them: what an agent built, ideas the owner only floated, your own suggestions, and text the owner pasted from another agent.
- **Facts**: things an agent confirmed by running them that save real time. Examples: how a tool or outside service really behaves, a limit, what can't be done, how to run or restart, a needed setting or key, what must not be committed, and how agents share a worktree. These are often buried in long reports; still record them.
  - A trap in a tool stays a fact even after our code works around it.

Not here: one-off tasks and tweaks, what a page or menu shows, progress, what was built or merged, bugs in our code that are now fixed, test results, commit ids, to-dos, guesses, setup copied from docs but never run, and anything quick to find in the code, git or a Topic.

How:

- One line each, at most 200 characters, in plain English. End with exactly the Topic id and the date of the event: `(PE-12, 2026-11-08)`. State the rule or the cause, not the story of how it was found. Quote the owner when the wording matters.
- Before adding, run `show` and read every line. If one already covers it, add nothing, or replace that line if yours is newer or more correct. Put related facts in one line, for example all limits of deep links.
- Keep the owner's scope: a rule for one page or one product stays that narrow. "For now" or "this time" is not a standing rule.
- A newer word on the same thing replaces the old line. When the owner drops a decision, delete its line. Delete facts that turn out wrong or stale.
- At most 60 lines below. When the file is full, merge lines or remove the least useful one in the same `apply` as your new line. Keep, in this order: how the owner wants agents to work, decisions that are easy to undo by mistake, traps, places.
- Never edit the text above "Decisions".
- Say in your final message what you changed here.
