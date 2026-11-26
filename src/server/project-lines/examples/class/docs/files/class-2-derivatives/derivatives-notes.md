# Class 2 · Derivatives

## 1. The derivative is a limit

$$f'(x) = \lim_{h\to 0}\frac{f(x+h)-f(x)}{h}$$

The fraction is the slope of the secant line through $(x, f(x))$ and $(x+h, f(x+h))$. As $h \to 0$ the two points come together and the secant becomes the tangent.

## 2. From the board: f(x) = x²

$$\frac{(x+h)^2 - x^2}{h} = \frac{2xh + h^2}{h} = 2x + h \;\xrightarrow{h\to 0}\; 2x$$

So $(x^2)' = 2x$. At $x = 1$ the slope is 2.

## 3. Rules

| Rule | Formula |
|---|---|
| Power | $(x^n)' = n x^{n-1}$ |
| Constant multiple | $(cf)' = c f'$ |
| Sum | $(f+g)' = f' + g'$ |
| Product | $(fg)' = f'g + fg'$ |

Example: $(3x^4 - x)' = 12x^3 - 1$.

## 4. Tangent line

At $x = a$:

$$y = f(a) + f'(a)(x - a)$$

For $f(x) = x^2$ at $a = 1$: $f(1) = 1$, $f'(1) = 2$, so $y = 1 + 2(x-1) = 2x - 1$. Canvas AI drew it on the Canvas: the secant lines get closer to it as $h$ gets smaller.

## To practise

- $(5x^3 + 2x)'$ (answer: $15x^2 + 2$)
- The tangent to $y = x^2$ at $x = 3$ (answer: $y = 6x - 9$)
