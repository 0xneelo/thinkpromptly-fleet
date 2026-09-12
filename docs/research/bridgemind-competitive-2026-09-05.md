# BridgeMind vs fleetdeck — competitive check (2026-09-05)

Verdict: partial overlap only. BridgeMind is a single-user desktop app that hosts coding CLIs in local terminal panes.
fleetdeck is a self-hosted operations deck for a fleet of coding agents on remote SSH hosts. Neither replaces the other.

## What BridgeMind is (from bridgemind.ai, docs.bridgemind.ai, llms-full.txt dated 2026-09-01)

- "The Agent Super App": one native desktop window (macOS 26; Windows/Linux since 2026-08-21, Windows still "in development" per docs).
- Three modes: Agent (named teammates with brief, memory, skills, chats), Code (project folder + terminal/thread/files/browser/iOS-simulator panes), Chat (sandboxed, no repo).
- Engines: Claude Code, Codex, Cursor Agent, Gemini CLI, GitHub Copilot, Grok Build, plus Droid, OpenCode, Kimi Code, Amp, Antigravity, Aider. Launched from PATH, billed to the user's own accounts. Not bundled.
- Multi-agent presets in Code mode: Solo, Pair, Workbench, Swarm (parallel local sessions with distinct roles).
- Agent messaging: opt-in per agent; approved teammates send "bounded messages" that appear in both chats and can wake an idle teammate. Single machine.
- Routines: in-app scheduler, runs only while the app is open, each run opens a fresh chat.
- Plugin gateway: GitHub, Linear, Slack, Stripe, Supabase, Vercel, Apollo, etc. Credentials stay in the app, never enter prompts. Approval cards for writes and spend.
- Dictation (hold Fn), Notch UI.
- Pricing: Pro only, $50/mo or $480/yr, 12,500 credits/mo, no free tier, 7-day refund.
- Company: BridgeMind LLC. Public build-in-public YouTube "Vibe coding to $1M" (~$196K at day 219). Related: BridgeVoice, BridgeAgent (beta), BridgeMCP, BridgeShot, BridgeSwarm, BridgeBench.

## What they do NOT offer (zero mentions in landing, docs, llms-full.txt, changelog titles)

- Remote hosts, SSH, WSL, tmux attach. Everything runs on the local machine.
- Cross-machine agent bus or delivery into Claude Desktop / other app sessions.
- GitHub App token broker / short-lived credentials for workers.
- Session registry that survives a vanished worker; transcript-based idle detection.
- Team credits/usage dashboard across accounts and machines.
- Self-hosting, multi-user, team or enterprise plan.

## Overlap matrix

| Capability | fleetdeck | BridgeMind |
|---|---|---|
| Terminal panes for Claude Code / Codex | tmux tiles over SSH, multi-host | local panes, 12+ CLIs |
| Multi-agent layouts / roles | orchestrator + coordinator + workers | Solo/Pair/Workbench/Swarm presets |
| Agent-to-agent messaging | durable bus (fleet.db), cross-machine, to Desktop + tmux + scripts, ACK loop | in-app, permission-gated, single machine |
| Remote / fleet | core | none |
| Session registry + idle detection | yes (transcript timestamps) | "Bridge can find any session" (v0.1.25), local |
| GitHub credentials | 1h App tokens via broker | OAuth plugin, app-managed |
| Usage dashboard | multi-account Claude/Codex windows | own credit counter |
| Scheduler | no (external cron) | Routines (app must be open) |
| Voice / plugins / agent memory | no | yes |
| Platforms | browser deck, self-hosted Node + SQLite | native desktop, hosted features |
| Pricing | internal, private | $50/mo Pro only |

## What they have that we could borrow

1. Routines: named agent + brief + schedule, fresh chat per run, errors on the row.
2. Plugin gateway with per-agent scoping and approval cards for spend/write.
3. Agent identity model: name, brief, memory budget, skills, approved places. Close to our worker name + role, but with durable memory.
4. Public read-only discovery API + llms.txt / llms-full.txt for assistants.

## Evidence gaps

- bridgemind.ai returns 403 to non-browser fetchers; content pulled via the in-app browser.
- Changelog bodies did not render as text; only release titles v0.1.22–v0.1.29 seen.
- "BridgeSwarm — multi-agent teams inside BridgeMind" is listed in llms-full.txt but has no docs page yet.
- Third-party reviews (starsearn, sanudesk) describe the older BridgeSpace line; treat their gaps as dated.

## Sources

- https://www.bridgemind.ai/ (landing: product, vibe-coding, capabilities, pricing, faq sections)
- https://www.bridgemind.ai/llms-full.txt (2026-09-01)
- https://www.bridgemind.ai/api/v1/site-info
- https://docs.bridgemind.ai/docs, /docs/agent-mode, /docs/code-mode, /docs/routines, /docs/skills-and-plugins
- https://www.bridgemind.ai/changelog (release titles only)
- https://starsearn.com/guides/bridgemind-review-2026 (June 2026)
- https://sanudesk.com/blog/bridgemind-alternatives
