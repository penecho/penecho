# DeepSeek Harness MIT test-visible bundles

These generated modules retain the **MIT** license in `LICENSE`, including local
adaptations. They are not relicensed under the repository's AGPL-only default.
They import the project's exact locked production dependencies.

Baseline: published `@deepseek-ai/dsh-agent-loop` and `@deepseek-ai/dsh-llm-pi-ai`
**0.2.1-rc.5**. The generator verifies the SHA-256 of each published bundle.

The generated files add named internal exports for behavioral regression tests.
They do not modify upstream production behavior. Runtime imports retain their
existing paths so desktop packaging and the Cloud synchronization allow-list
continue to include the reviewed modules.

The previous 0.1.1-rc.2 behavioral patches are retired:

- The upstream loop now tracks fully frozen message identities in a WeakSet.
  New messages are still deeply frozen; retained messages are not walked again.
- The selected Pi stack keeps the requested alias in `model` and the provider's
  resolved identity in `responseModel`. Thinking-signature replay compares the
  requested identity. Restoring the resolved identity into `model`, as the old
  adaptation did, would break this new contract.

Provider configuration remains owned by PenEcho in memory through the upstream
volatile configuration protocol. No upstream settings/profile UI or legacy
settings migration is mounted. The internal session-projection service required
by the new loop is mounted without upstream session persistence.

Generate: `node scripts/build-harness-backports.cjs`

Verify: `node scripts/build-harness-backports.cjs --check`

Review source, API contracts, and hashes before adopting another version. Never
regenerate against a changed package without that review.
