# DECK-108 — Linear actions pending (Linear unreachable from this worker)

Worker: Bernward · security-engineer · worktree `.claude/worktrees/bernward-deck-108` · branch `agent-bernward/deck-108`.
Linear is unreachable here (no Linear MCP in this session, no API key). Replay these in order when a session with Linear access picks this up.

1. 2026-09-11 — assign DECK-108 to Bernward, set **In Progress**. (Not checked first whether someone else holds it: no read access. The 🎛 ORCHESTRATOR 20 launch prompt assigned it to Bernward.)
2. 2026-09-11 — note on DECK-108: the design of record is the DECK-109 brief §Amendment (1Password-signed clicks), confirmed by the operator's deck click ub-62c064af (2026-09-11T09:53:55Z). Layer 2 builds it. The HMAC and the root-600 deck secret are dropped.
3. 2026-09-11 — **create ONE issue, label `operator:gate`**, title `[Bernward · security-engineer] DECK-108 gate — deck password, 1Password click key, deck restart`, body below.

---

**Why:** the deck now fails closed. Until steps 1–5 are done, the Unblock screen is read-only and `fleetdeck-verify-answer` exits 1 for every answer. Run everything in **your own Terminal** (never an agent pane) and after DECK-108 is woven to main. Do the steps in this order.

1. **Deck password** (the scrypt hash goes into `~/.fleetdeck/operator.json`, mode 0600; nothing else is stored):
   ```bash
   cd ~/remote-system && node scripts/deck-operator-init.js neelo
   ```
   Type a password of 12+ characters twice. A password from a 1Password generator is fine; save it in 1Password as "fleetdeck deck sign-in".

2. **New 1Password SSH key:** 1Password → New Item → SSH Key → Add Private Key → Generate a New Key → **Ed25519** → title exactly **`fleetdeck operator click key`** → Save, in a vault the 1Password SSH agent serves (Personal/Private by default). Never the CA key.

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
   `deck.log` shows the operator sign-in as ON for `neelo` and the click signer as `op-agent` with the same `SHA256:…`.

6. **Attest (with Bernward or any seat):** open http://localhost:3131/app#unblock and sign in with the step-1 password. Click the harmless deploy-class test card that Bernward posts, and approve Touch ID. The seat then runs `node ~/remote-system/bin/fleetdeck-verify-answer.js <sheet> <qid>` → exit 0. Separately, a forged-Origin write is refused. Both outputs go on DECK-108.
