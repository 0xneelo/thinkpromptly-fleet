# DECK-108 — scratch-deck evidence (2026-09-11T13:15Z)

NOT the attestation. A throwaway deck on its own port and db, with the operator key replaced by a throwaway ed25519 file signer (never 1Password), driven by real curl and the real CLI. The attestation is a real operator click on the live deck after the gate (LINEAR-PENDING.md item 3). Before DECK-108, the first request below (allowed Origin from a shell, no session) returned 200.

```
deck: operator sign-in ON for neelo · click signer file · key SHA256:NpzE/+LFUiKa40OIc9iJsV7J0Kf5WC1nv+QQHzmJbbE · operator fingerprint: 02e60b39
scratch deck http://127.0.0.1:34767 · sheet ub-a5afc082 · signer file:<throwaway ed25519> (not 1Password)
the seat records from its own POST response: deploy-demo=5e65ea6981f1… deploy-demo-2=9f713abc64fc…

$ curl -X PUT …/answers/deploy-demo -H 'origin: http://127.0.0.1:34767'   # the D-379 forgery: allowed Origin from a shell, no session
{"error":"sign in required"} HTTP 401
[exit 0]

$ curl -X PUT …/answers/deploy-demo -H 'origin: http://127.0.0.1:5173'   # foreign Origin
forbidden HTTP 403
[exit 0]

$ curl -X POST /api/operator/signin (wrong password)
{"error":"wrong password"} HTTP 401
[exit 0]

signed in as neelo (HttpOnly cookie + x-fleetdeck-session header token)

$ curl -X POST …/deploy-demo/sign with the cookie only (a leaked cookie, no header token)
{"error":"sign in required"} HTTP 401
[exit 0]

signed-in click → sign: sigState signed · sigValid true · key SHA256:NpzE/+LFUiKa40OIc9iJsV7J0Kf5WC1nv+QQHzmJbbE

$ node bin/fleetdeck-verify-answer.js ub-a5afc082 deploy-demo --pin <pin>
sheet: ub-a5afc082 · DECK-108 demo · harmless deploy card
posted: 2026-09-11T13:14:45.622Z · reply: -
project: remote-system
question: deploy-demo · deploy nothing (demo card)
choice: deploy-now (deploy (demo))
answeredAt: 2026-09-11T13:14:45.948Z
operator_id: neelo
expiresAt: 2026-09-11T15:14:45.979Z
key: SHA256:NpzE/+LFUiKa40OIc9iJsV7J0Kf5WC1nv+QQHzmJbbE
sig_valid: true
[exit 0]

$ node bin/fleetdeck-verify-answer.js ub-a5afc082 deploy-demo --pin <pin>   # after UPDATE … SET choice='hold' in fleet.db
sheet: ub-a5afc082 · DECK-108 demo · harmless deploy card
posted: 2026-09-11T13:14:45.622Z · reply: -
project: remote-system
question: deploy-demo · deploy nothing (demo card)
choice: hold (hold)
answeredAt: 2026-09-11T13:14:45.948Z
operator_id: neelo
expiresAt: 2026-09-11T15:14:45.979Z
key: -
sig_valid: false
reason: invalid
[exit 1]

$ node bin/fleetdeck-verify-answer.js ub-a5afc082 deploy-demo-2 --pin <pin>   # a row signed by the operator key outside the deck, written into fleet.db
sheet: ub-a5afc082 · DECK-108 demo · harmless deploy card
posted: 2026-09-11T13:14:45.622Z · reply: -
project: remote-system
question: deploy-demo-2 · a second demo card the operator never touches
choice: deploy-now (deploy (demo))
answeredAt: 2026-09-11T13:14:46.152Z
operator_id: neelo
expiresAt: 2026-09-11T14:14:46.152Z
key: SHA256:NpzE/+LFUiKa40OIc9iJsV7J0Kf5WC1nv+QQHzmJbbE
sig_valid: false
reason: superseded
[exit 1]
```
