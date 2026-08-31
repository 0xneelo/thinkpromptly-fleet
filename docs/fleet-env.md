# fleetdeck environment variables

Every variable the deck, the train broker and the box hooks read, with the failure each one
causes when it is wrong. Written for the 2am reading: **what breaks, and whether anything will
tell you.**

## How to read the "wrong value" column

| Mark | Meaning |
|---|---|
| **REFUSES** | the process throws at boot and names the bad value. You find out immediately. |
| **WARNS** | the process starts and prints a `WARNING:`/`warn:` line to `deck.log`. You find out if you look. |
| **SILENT** | nothing says anything. The symptom appears somewhere else, later, as a different bug. |

`grep -c WARNING deck.log` after every start. `0` is the answer you want.

Everything below is read **once at boot** unless the row says otherwise, so a change needs a
restart. The one exception is `FLEET_HOSTS_FILE`, whose *contents* are re-read on every call.

---

## Deck identity and role (`server.js`)

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FLEET_ROLE` | `home` | `home` is the sole `fleet.db` writer: it alone serves leases, seats, registry, bus, kill, coordinator, and it alone runs the reaper. `satellite` serves none of those and probes no hosts. Trimmed. | **REFUSES** — anything but `home`/`satellite` throws and names the value (`server.js:34`). Two decks both set to `home` is the real hazard and **nothing detects it**: both raise epochs, neither fence means anything. That is split-brain, and it is on the operator. |
| `FLEET_SELF_HOST` | `mac` | The one host this deck reaches **locally and never ssh-es to**. Fifteen behaviours turn on it: probe exclusion, warn, kill, name-close, prune. | **REFUSES** if blank/whitespace (`server.js:57`) — that is the un-expanded-template case. **WARNS** if it is still `mac` on a non-darwin platform (`server.js:2328`). Set to the wrong *real* host name: **SILENT**, and the deck ssh-polls and ssh-kills its own lanes. |
| `FLEET_NAME_CLOSE_SCRIPT` | *(unset)* | Path to the worker-name pool's `name.py`. The reaper calls `python3 <script> close <Name>` when it reaps a row that carries a worker Name. | **WARNS** when unset on a `home` deck (`server.js:2345`): the pool leaks one claim per reap. A wrong path is **SILENT-ish** — a `name-close-failed` lifecycle line per reap, no boot line. Unset on a satellite is correct and says nothing. |

## Storage

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FLEET_DB` | `<repo>/fleet.db` | The SQLite file holding sessions, leases and seats. | **REFUSES** — `assertPragmas()` (`server.js:202`) throws unless the file is `journal_mode=wal synchronous=2`. A path that does not exist is *not* an error: SQLite creates an empty db and the deck serves a fleet with no rows and epochs restarting at 1. That is **SILENT** and it is the cutover's classic mistake — check seat epochs after any move. |
| `FLEET_HOSTS_FILE` | `<repo>/hosts.json` | Fleet membership. Entries are `"name"` (Windows+WSL) or `{"name":…,"kind":"linux"}`. **Re-read on every call**, so an edit takes effect without a restart. | **SILENT at boot.** Malformed JSON fails the requests that read it, not the start-up. A host missing from the list is simply invisible: its rows are unclaimable, unkillable and never polled. |

## Listeners

The deck binds two: loopback (`127.0.0.1:PORT`, the operator's UI and every privileged local
route) and tailnet (`FLEET_TAILNET_BIND:PORT`, the box-worker surface).

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `PORT` | `3131` | Both listeners' port, and half of `FLEET_TAILNET_HOST`'s default. | **REFUSES** — `EADDRINUSE` on the loopback listener kills the process. `up.sh` replaces an existing deck on `$PORT` before starting, so this is normally handled for you. |
| `TAILNET_IP` | `100.125.231.25` (the Mac) | Only a default-supplier: it feeds `FLEET_TAILNET_BIND` and `FLEET_TAILNET_HOST` when those are unset. **The box's tailnet address is `100.85.213.20` (node `poppy-worker`)**, so a box-hosted home must set this or set both derived vars. | **WARNS** — `WARNING: tailnet listener unavailable (…) … serving LOOPBACK ONLY` (`server.js:2413-2426`), and the deck keeps running. **Loopback health checks cannot see this**: everything answers on `127.0.0.1` while every tailnet route is absent. Prove the listener from another machine, by address. |
| `FLEET_TAILNET_BIND` | `TAILNET_IP` | The address the second listener binds. The suite uses `127.0.0.2` so the loopback/tailnet split is exercised for real. | **WARNS**, as above, and never fatal — `test/http.js` and the orphan reaper both depend on the process surviving a failed tailnet bind. Prefer setting `TAILNET_IP` alone: both derived vars follow it, and one variable cannot disagree with itself. |
| `FLEET_TAILNET_HOST` | `TAILNET_IP:PORT` | The exact `Host:` header the tailnet handler requires. Anything else gets `403 forbidden` **before** auth. | **SILENT** — a mismatch is a blanket 403 for every tailnet caller, with no boot-time hint. If box workers get 403 and the Mac is fine, this is the variable. |

## Credentials

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FLEET_TAILNET_KEY` | *(unset)* | The shared bearer key required on every **write** arriving over the tailnet listener (`authorization: Bearer …`, constant-time compared). Loopback is exempt. Trimmed. | **Unset is SILENT and open** — tailnet writes are unauthenticated, and the boot line's `tailnet_key=unset` is the only trace. `up.sh:31` warns when `deploy-keys/fleet-tailnet.env` is missing, which is the practical detector. Armed but mismatched: every box POST gets `401`, which the box's own hooks log loudly. |
| `FLEETDECK_BUS_TOKEN` | *(from file)* | The message-bus bearer token, taken from the environment when set. | **SILENT** — a wrong value 401s every bus call. |
| `FLEETDECK_BUS_TOKEN_FILE` | `~/.fleetdeck-bus-token` | Where that token is read from, and **created** (mode 600) if absent. | **SILENT** — pointing it at a fresh path mints a *new* token, so every client holding the old one starts failing. The deck logs `message token created at …` when it mints. |
| `CLAUDE_BRIDGE` | `<repo>/.fleetdeck/claude-desktop-send` | The Claude Desktop send bridge the bus writes through. | **SILENT** — desktop delivery stops; nothing else notices. |

## Lifecycle numbers

Seconds in, milliseconds everywhere else. Each one falls back to its default when the value is
non-numeric or out of range — so **every row here is SILENT**, and every one of them is printed
on the `lifecycle:` boot line. Read that line rather than trusting the environment.

| Variable | Default | What it does | Wrong value (all SILENT) |
|---|---|---|---|
| `FLEET_TTL_S` | `90` | Lease lifetime. A session must heartbeat inside it. | Too short reaps live sessions; too long leaves dead ones holding names. |
| `FLEET_SUSPECT_WINDOW_S` | `2 × TTL` | The appeal window: how long a suspect row has to beat before it is reaped. | Too short removes the appeal path a slow box needs. |
| `FLEET_REAPER_TICK_S` | `30` | Sweep interval. | Too long delays every reap; too short is only load. |
| `FLEET_CASCADE_K` | `3` | Cascade guard: if a single sweep would reap more than K rows, it declines and alerts instead. `0` is a legal value and means "never cascade". | Set high, a network blip mass-reaps a live fleet. Set to `0`, a real die-off is never cleaned up automatically. |
| `FLEET_RETENTION_DAYS` | `14` | How long reaped rows are kept before pruning. | Short loses forensics; long only grows the db. |
| `FLEET_FENCE` | `bootstrap` | `strict` requires a live `seat_epoch` on every privileged local write. `bootstrap` (any other value) leaves the gate open until a seat has ever been claimed. | A typo'd `strict` silently means `bootstrap` — the gate you thought you closed is open. The boot line's `fence=` is the check. |
| `FLEET_NO_REAPER` | *(unset)* | `1` disables the reaper loop entirely. The suite sets it so tests can step `reaperTick()` by hand. | **Left set in production nothing is ever reaped** and the deck looks perfectly healthy. There is no boot warning for this one. |

## Coordinator API (`coordinator-api.js`)

This repo is the coordinator **vendor**, not an instance. Its own `coordinator/` directory is a
frozen dev fixture, and serving it would hand a caller a board that looks real and is not.

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FLEET_COORDINATOR_INSTANCES` | *(unset)* | The instance registry: either the JSON itself or a path to a file holding it, told apart by whether it parses. | **WARNS on the boot line, not with a `WARNING:`** — a registry that will not load leaves the deck serving *no* instances rather than refusing to boot (the deck also brokers every terminal in the fleet; one bad var must not take those down). `coordinator: … registry_error=…` is the trace. |
| `FLEET_COORDINATOR_DIR` | *(unset)* | Legacy single-board root, kept for callers that predate instances. | **SILENT** — a wrong path serves 503, not an error. |
| `FLEET_COORDINATOR_DEFAULT_INSTANCE` | *(unset)* | Which instance answers a request with no `?instance=`. | **SILENT** — naming an instance that is not in the registry means every un-qualified call 404s. |
| `FLEET_COORDINATOR_ALLOW_VENDOR_FIXTURE` | *(unset)* | `1` permits serving this checkout's own fixture board. **Development only.** | **SILENT and dangerous** — a caller is handed a plausible, stale board and cannot tell. Never set on a real deck. |
| `FLEET_PYTHON_BIN` | `python3` | The interpreter that runs `coordinator/*.py`. | **SILENT** — a missing binary turns every board route into a 500. |

## Train broker (`fleetdeck-train.js`, its own process on :3132)

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FLEET_TRAIN_PORT` | `3132` | The broker's port. Read by **both** the broker and the deck's proxy (`server.js:1778`), so they must agree. | **SILENT on the deck side** — a mismatch makes every `/api/ghtoken` and `/api/ghtrain` answer `train broker unreachable at …`. |
| `FLEET_TRAIN_BIND` | `127.0.0.1` | The broker's bind address, and the source of its `Host:` allowlist. | **REFUSES** — a non-loopback value throws, because the PEM-holding process may never sit on a real interface. |
| `FLEET_GH_ENV` | `<repo>/deploy-keys/github-app.env` | The GitHub App config file (`GH_APP_ID`, `GH_APP_INSTALLATION_ID`, `GH_APP_KEY_OP`). Those three are **file keys, not environment variables**. | **SILENT until used** — minting answers 500 naming the missing key. |
| `FLEET_OP_BIN` | `op` | The 1Password CLI used to fetch the App PEM. | **SILENT until used** — mint fails; Touch ID never prompts. |
| `FLEET_GH_API` | `https://api.github.com` | GitHub API base. A test seam. | **SILENT** — points token minting at the wrong host. |
| `FLEET_TRAIN_NO_LISTEN` | *(unset)* | `1` loads the broker without binding. Test seam. | Left set, the broker is not listening and the deck proxies to nothing. |
| `FLEET_TRAIN_NO_CAFFEINATE` | *(unset)* | `1` skips `caffeinate` (the Linux box has none). | Unset on Linux, `ghTrain.caffeinate` stays null; harmless. |

## Test seams — never set these on a real deck

| Variable | What it does |
|---|---|
| `FLEET_NO_LISTEN` | `1` loads `server.js` without binding either port. Unit tests require the module for its lease/reaper functions. |
| `FLEET_SSH_BIN` | Stands in a fake `ssh` (`test/fake-ssh.js`). Set on a live deck, every remote command goes somewhere else. |
| `FLEET_FAKE_SSH_STATE` | The fake ssh's JSON state file. Read by the fake, not by the deck. |

## Hooks side — the box and Mac sessions (`box/hooks/`)

Config lives in `$FD_DIR/fleet.env` (mode 0600, seeded once by `install-box.sh:177` and never
rewritten). **The environment always wins over the file** (`fd-common.sh:35-53`).

| Variable | Default | What it does | Wrong value |
|---|---|---|---|
| `FD_BASE_URL` | `http://100.125.231.25:3131` (`fd-common.sh:54`) | Where the session's claim and heartbeat POSTs go. Today: the box points at the Mac over tailnet, the Mac points at `http://localhost:3131`. **The cutover inverts both** — see `docs/goals/gb-home-migration/cutover.md` step 9. | **SILENT** — the hooks never break the session by contract, so a wrong URL is an unclaimed lane that simply never appears on the board. Check `$FD_DIR/logs/`. |
| `FD_HOST` | `german-box` | This machine's host key **as the server knows it**. Must match a `hosts.json` entry. | **SILENT** — an unknown host is rejected by the claim guard and the session runs unleased. |
| `FD_TAILNET_KEY` | *(unset)* | Must be byte-identical to the deck's `FLEET_TAILNET_KEY`. Box only — the Mac's calls are loopback and exempt. Never an argv word: it travels to curl in a 0600 `--config` file. | Mismatched: `401` on every POST, logged by name and written to `~/launch/fd-alerts/<session>.txt`. A key containing a quote, backslash or control character is **dropped with a `WARN` line**, not repaired. |
| `FD_LIVENESS` | `tmux` on the box, `pid` on the Mac | How the pinger decides its session is still alive: `tmux has-session` vs `kill -0 $FD_PID`. Defaulted from `FD_HOST` when unset (`fd-common.sh:81`). | **SILENT** — `tmux` on a Mac desktop session finds no session and the lane self-terminates its heartbeat. |
| `FD_DIR` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/fleet` | State, config and log root. Overridden by the hook test harness so it never touches the real fleet dir. | **SILENT** — points config and logs somewhere the operator will not look. |
| `FD_CURL_TIMEOUT` | `10` | Seconds any single HTTP call may take before it counts as a transient failure. | Too low turns a slow tailnet into constant transient failures. |
| `FD_PARENT_HOST` / `FD_PARENT_NAME` | *(empty)* | The parent edge, written at claim time only. **Both halves or neither** — leaving both empty is legal and renders the session as an orphan under its host. | Half-set is refused at claim (`parent_host and parent_name must be given together`). A parent host not in the fleet, or a row naming itself, is refused the same way. |
| `FD_NAME` | *(unset)* | **Test / Mac-only** override of the session name. Inside tmux the tmux session name always wins. | Set inside tmux it is ignored; set on the Mac it *is* the identity every call site must agree on. |
| `FD_WORKER`, `FD_ROLE` | *(unset)* | Worker Name and role recorded on the row at claim time. `FD_WORKER` is what `FLEET_NAME_CLOSE_SCRIPT` later releases. | **SILENT** — an unset `FD_WORKER` means the reaper logs `name-skip … row carries no usable worker Name` and the Name is never released. |
| `FD_BIN` | the hook's own directory | Where `fd-common.sh` is sourced from. | Fails the source and the hook exits 0 — by contract, silently. |
| `CLAUDE_CONFIG_DIR` | *(unset)* | Only supplies `FD_DIR`'s default. | See `FD_DIR`. |

`FD_PID`, `FD_EPOCH`, `FD_TTL_S`, `FD_TAB`, `FD_LOG_SES` are **written by the hooks**, not
configured: they live in the lease file that `lease-claim.sh:153` writes for the pinger.

## Provisioning (`mac/provision-fleet-secrets.sh`)

| Variable | Default | What it does |
|---|---|---|
| `FLEET_TAILNET_KEY_FILE` | `<repo>/deploy-keys/fleet-tailnet.env` | The file the operator's key is read from. Git-ignored, mode 0600, **never committed**. |
| `FLEETDECK_URL` | `http://100.125.231.25:3131` | The deck URL distributed to the box (`--deck-url` overrides). Becomes the box's `FD_BASE_URL`. |

`coordinator/notify.py` additionally reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; both
unset means notifications are skipped, silently and by design.
