# DECK-108 — Linear actions pending (Linear unreachable from this worker)

Worker: Bernward · security-engineer · worktree `.claude/worktrees/bernward-deck-108` · branch `agent-bernward/deck-108`.
Linear is unreachable here (no Linear MCP in this session, no API key). Replay these in order when a session with Linear access picks this up.

1. 2026-09-11 — assign DECK-108 to Bernward, set **In Progress**. (Not checked first whether someone else holds it: no read access. The 🎛 ORCHESTRATOR 20 launch prompt assigned it to Bernward.)
2. 2026-09-11 — note on DECK-108: the design of record is the DECK-109 brief §Amendment (1Password-signed clicks), confirmed by the operator's deck click ub-62c064af (2026-09-11T09:53:55Z). Layer 2 builds it. The HMAC and the root-600 deck secret are dropped.
3. 2026-09-11 — **create ONE issue, label `operator:gate`**, title `[Bernward · security-engineer] DECK-108 gate — deck password, 1Password click key, deck restart`, body below.

---

**Why:** the deck now fails closed. Until steps 1–5 are done, the Unblock screen is read-only and `fleetdeck-verify-answer` exits 1 for every answer. Run everything in **your own Terminal** (never an agent pane) and after DECK-108 is woven to main. Do the steps in this order.

1. **Deck password.** The script generates a strong password, prints it ONCE, and stores only its scrypt hash in `~/.fleetdeck/operator.json` (mode 0600):
   ```bash
   cd ~/remote-system && node scripts/deck-operator-init.js neelo
   ```
   Run it in a plain Terminal window, not tmux or screen: the script refuses there, because a multiplexer keeps scrollback that any agent can read. Save the printed password in 1Password as "fleetdeck deck sign-in", together with the printed `operator fingerprint: …` line, then press Cmd-K to clear the scrollback. Every agent can read the hash, so the password is generated, never chosen.

2. **New 1Password SSH key:** 1Password → New Item → SSH Key → Add Private Key → Generate a New Key → **Ed25519** → title exactly **`fleetdeck operator click key`** → Save, in a vault the 1Password SSH agent serves (Personal/Private by default). Never the CA key. Set this key's 1Password authorization to **ask every time**, never "remember for this app": a remembered approval lets a sign request pass with no prompt.

3. **Pin its public key.** Copy the item's "public key" field (`ssh-ed25519 AAAA…`), then:
   ```bash
   mkdir -p ~/.claude/fleet
   printf 'neelo namespaces="fleetdeck-unblock" %s\n' 'PASTE-THE-PUBLIC-KEY-HERE' > ~/.claude/fleet/allowed_signers
   chmod 644 ~/.claude/fleet/allowed_signers
   ```

4. **First Touch ID signing.** This proves that the key, the 1Password agent and allowed_signers match. 1Password asks for Touch ID once:
   ```bash
   cd ~/remote-system && node scripts/deck-click-key-check.js
   ```
   Expected: `OK — signed through op-agent and verified: neelo SHA256:…`.

5. **Restart the deck:**
   ```bash
   cd ~/remote-system && ./up.sh
   ```
   `deck.log` shows the operator sign-in as ON for `neelo`, the click signer as `op-agent` with the same `SHA256:…`, and the `operator fingerprint`. **After every restart**, compare that fingerprint with the one step 1 printed. A different value means `~/.fleetdeck/operator.json` was replaced: stop and re-run step 1.

6. **Attest (with Bernward or any seat):** open http://localhost:3131/app#unblock and sign in with the step-1 password. Click the harmless deploy-class test card that Bernward posts, and approve Touch ID. From now on, **approve a Touch ID prompt only within seconds of your own click or Sign now. Never approve a second or unexpected prompt.** The seat then runs `node ~/remote-system/bin/fleetdeck-verify-answer.js <sheet> <qid> --pin <questions[].pin from its own POST response>` → exit 0. Separately, a forged-Origin write is refused. Both outputs go on DECK-108.

---

4. 2026-09-11 — **comment on DECK-108** (signed Bernward), leave it **In Progress** (blocked on item 3 + the weave):

> **Bernward · security-engineer — DECK-108 status.** Built on `agent-bernward/deck-108`: 2f8f1e1 (layer 1: sign-in gate), 8d69791 (layer 2: 1Password-signed clicks), 2731b24 (oracle audit fixes). Design of record: DECK-109 §Amendment + seat-20 ACCEPT-1/2/3 and review R1–R4.
>
> **What changed.**
> - Every Unblock operator write needs the allowed Origin, a signed-in session (HttpOnly cookie + in-page header token) and an operator file. Without the operator file the deck fails closed (503).
> - Sign-in is a generated password with a rate limit.
> - A deploy-class click is signed through the operator's 1Password SSH key (`ssh-keygen -Y sign`, namespace `fleetdeck-unblock`), only for a click the deck saw, compare-and-set.
> - The deck certifies only signatures its own process produced, against its boot snapshot of allowed_signers.
> - Send is a pointer only.
>
> **Seats** run `node ~/remote-system/bin/fleetdeck-verify-answer.js <sheet> <qid> --pin <questions[].pin from their own POST>`. Exit 0 only when the answer is signed, valid, unexpired and current.
>
> **Signed bytes, verbatim:** `v2|sheetId|qid|choice|answeredAt|operator_id|project|expiresAt|question_sha256`. **Pin:** sha256 of `v2-pin|sheetId|qid|question_sha256|sheet_sha256`, where `sheet_sha256` = sha256 of `JSON.stringify([title, intro, project])`. Each field is escaped `%`→`%25`, then `|`→`%7C`. `question_sha256` = sha256 of ECMAScript `JSON.stringify(question)` as served. Full spec: `docs/goals/deck-108-click-certification/README.md`.
>
> **Evidence.**
> - Suite: 894 pass, 0 fail, 7 skipped (the skips are Windows/ssh tests).
> - Poisoned doubles cover: forged Origin, cookie without token, tampered choice, replay onto another sheet, expired, wrong key, wrong namespace, a substituted public key, a relabelled question (`pin-mismatch`), rollback, a signature made outside the deck, a db-written row (409 / `clickSeen` false), and a change of mind during the prompt.
> - Scratch-deck run (throwaway key, not 1Password): `EVIDENCE-scratch-deck.md`. The D-379 forgery (allowed Origin from a shell) gets **401** (it was 200). A signed-in click → CLI exit **0**. A db-tampered choice → exit **1** `invalid`. An operator-key signature made outside the deck → exit **1** `superseded`.
> - Audit trail, in order:
>   1. The GPT hunter was blocked by OpenAI moderation.
>   2. The Opus oracle ruled BLOCK (F1–F6, L1–L3); fixed in 2731b24.
>   3. The re-audit ruled BLOCK (H1, M1); fixed in 2731b24.
>   4. The final oracle ruled SHIP-WITH-FIXES (N-1: the sheet's own words in the pin; N-2: refuse cmux/zellij).
>   5. Seat 20's independent audit of 2731b24 ruled SHIP WITH FIXES (P1–P6).
>   6. Both sets are fixed at the branch tip, which the ACK names.
>
> **Open.**
> - The real attestation: one operator click on the live deck, verified by a seat with exit 0, plus a forged-Origin write refused. It waits on the weave to main and the operator gate (the `operator:gate` issue from item 3).
> - F6 (the deck serves `public/` live from the checkout) is escalated to seat 20 with the root-owned-install follow-up.
> - Residuals recorded in README.md.
