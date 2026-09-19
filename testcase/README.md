# Manual scenarios and local evidence

The three scenario documents in this directory are curated manual test inputs.
Automated diagram fixtures live in [`test/fixtures/diagrams/`](../test/fixtures/diagrams/).

All other `testcase/` contents are local-only and ignored by Git. This includes
model requests/responses, job and session records, browser readbacks, screenshots,
layout iterations, and test output. Historical local copies may be retained, but
they are not dependencies of a checkout, build, or automated test run.

Reusable verification scripts belong in `scripts/`; write their generated output
to ignored `test-results/`. Do not force-add local evidence to version control.
