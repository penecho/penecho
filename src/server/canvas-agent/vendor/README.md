# DeepSeek Harness MIT backports

These generated modules retain the **MIT** license in `LICENSE`, including local
adaptations. They are not relicensed under the repository's AGPL-only default.
They import the existing locked dependencies and introduce no new dependencies.

Baseline: published `@deepseek-ai/dsh-agent-loop` and `@deepseek-ai/dsh-llm-pi-ai`
**0.1.1-rc.2**. The generator verifies the SHA-256 of each published bundle.

Upstream examined on 2026-09-09:
https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed
(`0.1.5-alpha.1`, MIT). The full upgrade includes Session V3 and is not substituted
for the current session implementation.

Backports:

- https://github.com/deepseek-ai/deepseek-harness/commit/73edce1ae7ad0cbf8813d4d65b288317a16a7f5c
  Reuse identities of messages completely frozen by this agent. Every new message
  and header is still deeply frozen. Weak references do not retain discarded
  history. This is a Harness-owned traversal optimization, not a context cache.
- https://github.com/deepseek-ai/deepseek-harness/commit/7bab91d247e4a7a2e84c68e1883359f5dc718e6a
  Retain requested model identity separately from Anthropic's resolved model in
  replay. Preserve native signatures and resolved model when reconstructing
  history; avoid incorrectly degrading replay when a provider resolves an alias.

The changes are adapted to the published 0.1.1-rc.2 bundle, not copied wholesale
from the newer agent or session APIs. Named internal exports permit behavioral
regression tests. Runtime imports these two modules directly; installed packages
remain unchanged.

Generate: `node scripts/build-harness-backports.cjs`

Verify: `node scripts/build-harness-backports.cjs --check`

Review and remove these local backports when adopting an upstream version that
contains both fixes. Never regenerate against a changed package without review.
