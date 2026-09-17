# R7 — fresh generation, exact HTML published through MCP

The first R7 request timed out after 300.88 seconds, after thinking-only events.
The retry used the identical request SHA256 and completed in 155.80 seconds.
The rendered Canvas receipt and unmodified screenshot are retained here.

Improved: the legend is now in separate HTML flow outside all ownership frames;
the main ingress → RPC → dispatcher route is present; Cloud bridge is inside Node.

Rejected:
- The dispatcher → binding-store path runs through the unrelated shared-operations
  node (x=995, y=418..470), crossing its text and making a false visual connection.
- The guidance branch touches the binding-store outline at x=738 rather than
  using an independent corridor; the two purple branches appear connected.
- JSON-RPC text is wider than its 50-unit edge gap and reaches neighboring nodes.
- Most nodes still have filenames plus role text, exceeding the two-slot rule.
- Access detail uses teal while HTTPS access is orange; session/binding detail
  mixes orange dispatcher and purple store without identifying the distinction.
- Large unused headroom in both frames does not compensate for cramped edge gaps.

No handwritten source repair was performed. This confirms that longer wording
alone does not ensure rule obedience; the visual feedback loop remains necessary.
