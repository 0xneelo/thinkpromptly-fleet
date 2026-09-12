# DECK-27 — operator:gate: Linear reauthentication required

Date: 2026-09-06
Worker: Drogo, backend developer
Branch: `agent-deck27-notifycron`
Starting HEAD: `26ebf4950cace2ad20835b8ef50d485da58c54a5`
Status: blocked before implementation; this file is a local fallback, not a Linear update.

## Gate evidence

The operator requires reading DECK-27 in full through Linear MCP, setting In Progress
and `session:cli-worker`, and posting the approach before large edits.

Three Linear MCP calls were attempted:

1. `get_issue(id="DECK-27", includeRelations=true)` failed with
   `Mcp error: -32603: Internal error`; no issue content was returned.
2. `list_comments(issueId="DECK-27", limit=250)` failed with `UNAUTHORIZED`,
   reason `oauth_token_invalid_grant`, action `TRIGGER_REAUTHENTICATION`:
   "This app connection requires reauthentication before other actions on this app can succeed."
3. `save_issue(id="DECK-27", addLabels=["operator:gate", "session:cli-worker"])`
   returned the same reauthentication error. The labels were not applied.

The issue description, acceptance criteria, comments, and DECK-23 dependency have
not been read. No In Progress/Done transition or approach/report comment was posted.

## Read-only findings before the gate

- `coordinator/README.md` identifies this repository's coordinator data as a dev
  fixture; a scheduled job must target a configured customer instance.
- `coordinator/inbox/README.md` specifies one file per event named
  `<ISO-time>-<seat>-<lane>.md`. Required fields are `seat`, `lane`, `event`,
  `event_time`, `state`, `blockers`, and `next_report`; `done-claimed` also needs evidence.
  Blockers are the full current set. Stale/wrong-owner reports are archived and
  malformed reports rejected. Notification-to-lane mapping needs investigation.
- The Fleetdeck message-bus skill distinguishes submitted delivery from a recipient
  ACK and warns that `claude-desktop:current` addresses the currently open chat.
  The DECK-27/DECK-23 delivery contract remains unverified.

## Required operator action and resumption

Reauthenticate the Linear connector. Then read DECK-27 and its comments in full,
record this gate in Linear, set In Progress and `session:cli-worker`, investigate
the lowcap notification source and delivery contract, and post the approach before
implementation. If desktop delivery requires an unresolved decision, follow the
operator's instruction to implement the inbox half and file `operator:decision`.

No implementation, scheduled job installation, live-deck service mutation, database
change, or session delivery was performed. Only the gate report was added; the test suite
was not run because there is no code diff. DECK-27 acceptance remains unmet.
