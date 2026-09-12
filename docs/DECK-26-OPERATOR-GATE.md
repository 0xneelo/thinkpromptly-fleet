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

On the D-136 refinement turn, `linear_get_issue` returned the same authentication
error. The explicitly requested `linear_save_comment` call with
`{"issueId":"DECK-26","body":"ACK D136"}` also returned that error. **ACK D136 has
not been posted to Linear.** The new Linear comment has not been read. Plugin
management exposes no callable reconnection action in this session.

## D-136 requirements received directly from the operator

These supersede the original fixed two-account, 3+3 build scope. They are pending
implementation, subject to reading the full issue and its new comment first:

- Rotate new lanes across every Claude account the operator holds. Refuse to
  exceed each account's per-window cap. Preserve the operator's requirement that
  a trip pauses a fraction of the fleet, never half; do not assume two accounts
  satisfy the revised requirement.
- Detect a trip from pane capture containing the `session limit` text. Idle time
  is not a trip signal.
- Never perform or handle a Claude login. The launcher only points at an
  account's config/login directory; the operator supplies each login by hand.
  Do not collect, copy, print, or automate credentials.
- Fetch `origin/main` with a broker token before every new cut; an untokened
  fetch can hang forever. Transfer prompts robustly without `wsl-tee`. Never
  send `/fast`.
- Keep launcher/helper deliverables under repo-owned `box/`, document the
  cap-20 change and operator installation, and leave `~/.claude` skills alone.

The operator references four box findings; the message explicitly lists the
fetch, prompt-transfer, and `/fast` findings. Read the new Linear comment for the
complete findings before implementation rather than inventing the missing detail.

Implementation has not started. The box launchers and Claude account-selection
mechanism have not yet been investigated. No launcher, operator skill, account
configuration, or live deck file was changed. No implementation tests were run.
DECK-26 acceptance is not met, and no fleet/window improvement is claimed.

After authentication is restored, resume in `agent-deck26-launcher`:

1. Read DECK-26 and all comments in full through Linear MCP; set In Progress and
   add `session:cli-worker` while preserving existing labels. Post `ACK D136`.
2. Read `/home/vibe/gb-launch*.sh`, the operator's `german-box-workers` skill, and
   how the installed Claude launcher/config selects an account, without handling
   login credentials. Do not modify the operator's `~/.claude` skills.
3. Implement and test the repo-owned launcher/helper against the D-136
   requirements above and the full Linear acceptance criteria. Document the chair
   cap from 11 to 20 and concrete operator installation instructions.
4. Review every diff, commit milestones, run the appropriate suite, and push
   using a fresh broker token in `GH_TOKEN` only. Independently authenticate
   `git ls-remote` and match the full final SHA.
5. File the `operator:gate` for manual account login provisioning described below,
   and the separate installation gate with the reviewed artifact and concrete
   instructions. Post the DECK-26 report and mark Done only when acceptance is met.

## Pending operator gates (not filed in Linear)

- **Manual Claude account provisioning:** the operator supplies each account
  login by hand in its own config/login directory and provides the non-secret
  directory paths for launcher selection. Worker and launcher must never perform
  or handle login, credential transfer, or token refresh. The final gate must name
  the reviewed configuration interface once the helper is implemented.
- **Install onto `/home/vibe`:** the operator installs the reviewed repo-owned
  helper and configuration using the final documentation. No install instructions
  or account path names are invented before inspecting the current box recipe.

Actual installation is not authorized for this worker. Do not touch the live
deck, its `fleet.db`, or `up.sh`. Stop on broker 503, the same blocker three times,
or an operator decision requirement, as instructed by the operator.
