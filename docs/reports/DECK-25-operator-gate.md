# DECK-25 operator:gate — Linear authentication

Worker: Zwentibold. Branch: `agent-deck25-gate`.

Execution is blocked before implementation because the required full issue read
through Linear MCP could not complete. The issue read and session-label lookup
returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and
`TRIGGER_REAUTHENTICATION`. The issue-comment read returned MCP error `-32603`.

The connector explicitly reports: “This app connection requires reauthentication
before other actions on this app can succeed.” No alternate credentials were used.

Operator action: reauthenticate the Linear app connection, then resume DECK-25
with a full issue and comment read. This file records the `operator:gate` blocker
locally; no Linear label, comment, or state transition was successfully filed.

No implementation changes or acceptance checks were performed. The 12288-byte
gate, selftest fixture, 11-lane bundle verification, and coordinator-run evidence
rule remain pending. No live deck, database, or `up.sh` access was performed.
