# G3 — prod VPS ssh alerts reach Telegram

Owner seat: 🎛 ORCHESTRATOR 20 · remote-system. Written 2026-09-10.
Source: handoff from lowcap session `great-wescoff-4ea076-ad`, operator's words:
"hand this off to a fleetdeck operator so we can build the tg bot from there".
Goal ledger: G3 (`docs/operator-goals/ledger.json`).

## What is already live (lowcap prod VPS, root@138.199.198.246, alias `vps-deploy`)

- sshd keys/certs only, LogLevel VERBOSE; fail2ban escalating bans.
- `/usr/local/sbin/ssh-login-alert` — PAM session hook, Telegram message on a login from an IP not in `/var/lib/ssh-login-alert/known-ips`.
- `/usr/local/sbin/ssh-daily-summary` + timer 06:00 UTC — 24 h brute-force summary, sendMessage → pinChatMessage → unpin previous. `--print` = dry run.
- Missing: `/etc/ssh-alert.env`. Nothing is sent until it exists.

Reference: lowcap memory `~/.claude/projects/-Users-misterislez-projects-lowcap-connector/memory/prod-vps-ssh-hardened-2026-09-10.md`.

## Contract the VPS expects

```
/etc/ssh-alert.env   owner root, mode 600, exactly two lines, no quotes, no comments
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>
```

Parser splits on the first `=`. The bot must be able to pin: a private chat works; in a group the bot needs admin with `can_pin_messages`.

## Decision: new bot, not the coordinator bot

`coordinator/notify.py` reads `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from the environment. No bot handle, chat, or setup doc exists anywhere in this repo (`docs/coordinator/SURFACES-v2.md` documents only the env names). There is no coordinator bot to reuse. Create a dedicated bot.

## The split

| Slice | Owner | Why |
|---|---|---|
| Create the bot, pick the chat, store the token | operator | BotFather and 1Password need the operator's Telegram and Touch ID |
| Chat id lookup | operator (one command, reads the token through `op read`) | the token must never enter an agent's context, argv, URL, or file |
| Write `/etc/ssh-alert.env` on the VPS | operator (same reason) | lowcap ruling D-90: prod config writes are seat-only; the lowcap 🎛 seat (36) cannot Touch ID |
| Run the two tests, report back | lowcap 🎛 seat 36 or seat 20 | read-mostly; the test cleans its own known-ips line |
| Later: roll the kit to onboarding-box and ivy-box | a fleetdeck lane | reuse `mac/provision-fleet-secrets.sh` + `box/fleet-env-set.sh` shape |

## Steps

1. **Operator, Telegram app (~3 min).** `@BotFather` → `/newbot` → name `fleet ssh alerts`, username `<yours>_sshalerts_bot`. Copy the token once. Open the new bot's chat and send it any message, so `getUpdates` has one update.
2. **Operator, 1Password (~2 min).** New item `ssh-alert telegram`, fields `token` (the bot token, concealed) and `chat_id` (fill after step 3). Note the vault name; the commands below use `<vault>`.
3. **Operator, chat id (~1 min).** Prints only the chat id, never the token:

   ```bash
   curl -s "https://api.telegram.org/bot$(op read 'op://<vault>/ssh-alert telegram/token')/getUpdates" | python3 -c 'import json,sys;u=json.load(sys.stdin)["result"];print(u[-1]["message"]["chat"]["id"] if u else "NO UPDATE — message the bot first")'
   ```

   Put the number into the `chat_id` field of the 1Password item.
4. **Operator, VPS write (~1 min).** Values flow 1Password → stdin → ssh; nothing lands in argv or on the Mac disk:

   ```bash
   { printf 'TELEGRAM_BOT_TOKEN=%s\n' "$(op read 'op://<vault>/ssh-alert telegram/token')"; printf 'TELEGRAM_CHAT_ID=%s\n' "$(op read 'op://<vault>/ssh-alert telegram/chat_id')"; } | ssh vps-deploy 'umask 077; cat > /etc/ssh-alert.env.tmp && chown root:root /etc/ssh-alert.env.tmp && chmod 600 /etc/ssh-alert.env.tmp && mv /etc/ssh-alert.env.tmp /etc/ssh-alert.env && wc -l /etc/ssh-alert.env && stat -c "%U %a" /etc/ssh-alert.env'
   ```

   Expect `2 /etc/ssh-alert.env` and `root 600`.
5. **Seat 36 or seat 20, tests.** Tell the operator to watch the chat.

   ```bash
   ssh vps-deploy /usr/local/sbin/ssh-daily-summary
   ```
   → one message in the chat, pinned, rc 0.

   ```bash
   ssh vps-deploy 'PAM_TYPE=open_session PAM_RHOST=192.0.2.99 PAM_USER=test /usr/local/sbin/ssh-login-alert; sleep 3; sed -i "/^192\.0\.2\.99$/d" /var/lib/ssh-login-alert/known-ips'
   ```
   → "ssh login: test@ubuntu-4gb-nbg1-1 from NEW IP 192.0.2.99 …" arrives.
6. **Report back** to `great-wescoff-4ea076-ad` or the lowcap 🎛 seat, then mark G3 done.

## Rules that travel with this

- ssh to the VPS only over the deploy cert (`ssh vps-deploy`). Never the 1Password ssh agent, never `ssh-add`.
- fail2ban does not whitelist the operator's IP. Do not loop failing logins.
- `ssh-keygen -L` prints Mac local time (EEST, UTC+3).
- The token never appears in a repo, argv, URL, log, evidence file, or chat message.

## Later (optional, ask 6 from the handoff)

Roll hook + summary + timer to onboarding-box and ivy-box with the same env contract. Package as a fleetdeck lane: a `mac/provision-ssh-alert.sh` following `mac/provision-fleet-secrets.sh:83-139` (stdin-piped values, `umask 077`, mode 600, atomic mv), one bot, one chat, host name in the message text.
