# SSH key inventory on the five boxes — read 2026-09-11 ~14:0x local by seat 20 (read-only, fingerprints only)

Gap found: the rotation spec's S5 table lists four static keys by Mac filename. The boxes carry more, including one back door and one worker-box root key. Nothing here was changed; host actions are gated (think-box: lowcap 🎛 seat under D-90).

## Per box (root / admin authorized keys)

| Box | Line | Options | Fingerprint | Comment | Holder (private half) | Verdict |
|---|---|---|---|---|---|---|
| think-box (lowcap prod VPS) | 1 | none | SHA256:pbsYM6OjUNhhe2aOlJB0VyyMCon09wvSPumYrDZCaB0 | 0xneelo-promptly-deploy-2026-06-22 | not on the Mac | S5: find holder, chain or retire |
| think-box | 2 | — | not a key | literal `PASTE_THAT_LINE_HERE` | — | junk, remove |
| think-box | 3 | **none** | SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0 | the **v1 deploy CA** as a plain login key | 1Password agent + `~/.ssh/id_ed25519` on the Mac | **back door** (root without cert/TTL/principal); remove now, independent of S1 |
| think-box | 4 | `restrict,command="/usr/bin/rrsync …"` | SHA256:BpwJGD5tnNia96b/rGRcsiigZXvw0mt0Tm3nnB8M3Xo | lowcap-backup-pull | Mac `~/.ssh/lowcap_backup_pull` | already chained — S5 approved exception, no change |
| think-box | 5 | **none** | SHA256:e/IIN6KX04bT7339zKol6CsVQ7rHK2Koxw2ZDqK/Hi0 | german-box-wsl | **german-box WSL `/home/vibe/.ssh/id_ed25519`, no passphrase** — every bypass worker on the box | **worker box has root on prod**; remove with line 3 after the lowcap seat checks its lanes |
| onboarding-box | 1, 3 | none | SHA256:hPmMN4vDu5/kHDIsHtNCnmPT7diS5BUpB4hdmPmF2ao | (no comment, listed twice) | not on the Mac | S5: find holder |
| onboarding-box | 6 | none | SHA256:lUccmXkfg/p4UQOVfCqjl+q60tJHDrv/ePpB03XRLN0 | onboarding-prod-json-sync | Mac `~/.ssh/vps-onboarding-app-sync` (also in the 1Password agent) | S5 table |
| onboarding-box | 7 | none | SHA256:x+6G8CTTgjPkFRhhgayKO/3s4zuG0S41gbTDQUNrbGs | onboarding-box-fleetdeck-20260826 | Mac `~/.ssh/onboarding-box` | S5 table |
| ivy-box | 1, 2 | none | SHA256:AiTac5bowNpODokQgtDfdeOkYHmP58Maz/JkgCrM83Q | ivy-vaults-vps (listed twice) | Mac `~/.ssh/ivy-vaults-vps` (also in the 1Password agent) | S5: add to table |
| ivy-box | 3 | none | SHA256:ZyAwsJYROMfRLkqz9swEf7EaG+PmC/eXZgJ2p7//LNY | claude-deploy-rfc1918-internal | Mac `~/.ssh/ivy-deploy` | S5 table |
| german-box (Windows admin) | — | none | SHA256:EZvcINW0oDUQV2/dC76PlLSLGUfnJE4AUyFedVStbV4 | (no comment) | not on the Mac | S5: find holder |
| german-box, rog-strix (Windows admin) | — | none | SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U | misterislez-mac-to-wsl | Mac `~/.ssh/wsl-machine` (also in the 1Password agent) | keep: the runbook's non-cert Windows recovery route |

All three Linux boxes: `TrustedUserCAKeys /etc/ssh/deploy_ca.pub` (v1 CA), `AuthorizedPrincipalsFile none`. No `cert-authority` lines anywhere. The CA as a plain key exists only on think-box.

## Consequences for the runbook

- S5's table grows from four to eight entries: add `0xneelo-promptly-deploy-2026-06-22`, `german-box-wsl`, the uncommented onboarding-box key `hPmMN…`, `ivy-vaults-vps`, and the uncommented german-box admin key `EZvcIN…`.
- think-box line 3 (CA plain key) and line 2 (junk) are removable now — they do not depend on the new CA. Line 5 too, once the lowcap seat confirms no lane relies on it. Handed to the lowcap 🎛 seat (O47) 2026-09-11 with a blob-based removal command.
- The german-box private key `/home/vibe/.ssh/id_ed25519` should be retired or passphrase-protected after line 5 is gone — operator decision (fleet box).
