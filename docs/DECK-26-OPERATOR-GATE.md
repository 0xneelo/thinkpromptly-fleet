# DECK-26 blocked: restore Linear MCP authentication

Worker: Cunibert, platform engineer. Date: 2026-09-06.

This is a repository fallback for an `operator:gate`, not a filed Linear issue.
Requested labels on filing: `operator:gate`, `session:cli-worker`.
Related issue: DECK-26, project remote-system (fleetdeck), team lowcapsxyxz.

The mandatory first step, reading DECK-26 in full through Linear MCP, failed:

```text
Tool: linear_get_issue
Arguments: {"id":"DECK-26","includeRelations":true}
error_code: UNAUTHORIZED
reason: oauth_token_invalid_grant
action: TRIGGER_REAUTHENTICATION
This app connection requires reauthentication before other actions on this app can succeed.
```

No callable reauthentication tool is exposed in this session. The operator must
reauthenticate the Linear connector before this worker can read the issue and its
comments, set In Progress, add the session label, or file Linear gates and reports.
No Linear state or label change succeeded; the current issue status is unknown.

Implementation has not started. The box launchers and Claude account-selection
mechanism have not yet been investigated. No launcher, operator skill, account
configuration, or live deck file was changed. No implementation tests were run.
DECK-26 acceptance is not met, and no fleet/window improvement is claimed.

After authentication is restored, resume in `agent-deck26-launcher`:

1. Read DECK-26 and all comments in full through Linear MCP; set In Progress and
   add `session:cli-worker` while preserving existing labels.
2. Read `/home/vibe/gb-launch*.sh`, the operator's `german-box-workers` skill, and
   how the installed Claude launcher/config selects an account. Do not modify
   the operator's `~/.claude` skills or expose credentials in evidence.
3. Implement and test a repo-owned launcher/helper selecting two account config
   directories for a 3+3 Claude lane split. Document the chair cap from 11 to 20
   and concrete operator installation instructions.
4. Review every diff, commit milestones, run the appropriate suite, and push
   using a fresh broker token in `GH_TOKEN` only. Independently authenticate
   `git ls-remote` and match the full final SHA.
5. File the separate `operator:gate` for actual installation onto `/home/vibe`,
   with the reviewed artifact and installation instructions. Post the DECK-26
   report and mark Done only when its acceptance is met.

Actual installation is not authorized for this worker. Do not touch the live
deck, its `fleet.db`, or `up.sh`. Stop on broker 503, the same blocker three times,
or an operator decision requirement, as instructed by the operator.
