---
line: ../../lines/class-1-limits.md
step: Work 1
who: "@dsh"
started: {{when -4 12:40}}
took: 3 min
---

# Work 1: Class 1 · Limits

[Back to class-1-limits.md](../../lines/class-1-limits.md)

## Asked

> Summarize today's class into a note I can study from before the exam. Keep the formulas and the examples.

## Result

<!-- result: the agent's last message -->
Your note on limits is ready: four ideas, the two worked examples from the board, and the two answers Canvas AI wrote beside your questions.

**What a limit is.** $\lim_{x\to a} f(x) = L$ means $f(x)$ gets as close to $L$ as you like when $x$ is close enough to $a$. What happens at $x = a$ itself does not matter.

**Plug in first.** If $f$ is continuous at $a$, the limit is just $f(a)$: $\lim_{x\to 2}(x^2+1) = 5$.

**When you get $\frac{0}{0}$, simplify.** $\lim_{x\to 1}\frac{x^2-1}{x-1} = \lim_{x\to 1}(x+1) = 2$.

**Two limits to know.** $\lim_{x\to 0}\frac{\sin x}{x} = 1$ (squeeze: $\cos x \le \frac{\sin x}{x} \le 1$), and $\lim_{n\to\infty}\left(1+\frac1n\right)^n = e \approx 2.718$.

The whole note is in `files/class-1-limits/limits-notes.md`.
<!-- /result -->

## How it was done

- Read your handwriting on the Canvas and the two Canvas AI answers beside it
- Checked each example: $\frac{x^2-1}{x-1} = x+1$ for $x \ne 1$; $\frac{\sin 0.01}{0.01} = 0.99998$; $(1+\frac1{1000})^{1000} = 2.7169$
- Wrote the note as Markdown with the formulas in LaTeX
