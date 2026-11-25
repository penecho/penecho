# Class 1 · Limits

## 1. What a limit is

$$\lim_{x\to a} f(x) = L$$

$f(x)$ gets as close to $L$ as you like when $x$ is close enough to $a$ (but not equal to it). The value $f(a)$ itself does not matter; $f$ need not even be defined there.

One-sided limits: $\lim_{x\to a^-}$ from the left, $\lim_{x\to a^+}$ from the right. The limit exists only when both exist and agree.

## 2. Plug in first

If $f$ is continuous at $a$, then $\lim_{x\to a} f(x) = f(a)$.

$$\lim_{x\to 2}(x^2+1) = 2^2 + 1 = 5$$

## 3. When you get 0/0, simplify

Plugging in $x = 1$ gives $\frac{0}{0}$, which says nothing yet. Factor and cancel:

$$\lim_{x\to 1}\frac{x^2-1}{x-1} = \lim_{x\to 1}\frac{(x-1)(x+1)}{x-1} = \lim_{x\to 1}(x+1) = 2$$

The graph is the line $y = x + 1$ with a hole at $(1, 2)$.

## 4. Two limits to know

$$\lim_{x\to 0}\frac{\sin x}{x} = 1$$

Why (Canvas AI's answer): for small $x$, $\cos x \le \frac{\sin x}{x} \le 1$, and $\cos x \to 1$, so the middle is squeezed to 1.

$$\lim_{n\to\infty}\left(1+\frac1n\right)^n = e \approx 2.718$$

Canvas AI's table: $n = 1$: 2, $n = 10$: 2.594, $n = 100$: 2.705, $n = 1000$: 2.717.

## To practise

- $\lim_{x\to 3}\frac{x^2-9}{x-3}$ (answer: 6)
- $\lim_{x\to 0}\frac{\sin 3x}{x}$ (answer: 3)
