# fd-v2-l7 — behaviour inventory: SSH keys + GitHub train

Extracted 2026-09-07 from `public/keys.html`, `public/keys.js`, `server.js` by a reader. Ledger D14. The mock's four cards already match today's page almost 1:1.

## 1. Data

- `GET /api/sshkeys` (`server.js:2731`, `sshkeys()` `:2022-2062`) → `{certs:[], keys:[]}`. `certs[]` (`parseCert` `:2005-2020`): `{dir, keyId, serial, signingCA, principals:[], validFrom, validTo, validToEpoch}` (nulls on miss; sorted `dir` desc, stamp `YYYYMMDD-HHMMSS`; the `current` symlink dir excluded server- and client-side `keys.js:141`). `keys[]` (`:2044-2060`): `{name, type, fingerprint, comment}` from `ssh-keygen -lf` — **`type` is the real algorithm, never hard-coded** (mock hard-codes ED25519 → improvise real value). Sorted by name.
- `GET /api/ghtrain` (`server.js:2815-2818` → broker): `{active, expiresAt}` or `{ok:false, error}`; broker unreachable = 503 text `'train broker unreachable at <bind>:<port> — is the com.fleetdeck.train launch agent loaded?'` (`:2136-2138`).

## 2. Mint (`keys.js:1-20, 184-227`)

- TTL chips `['1h','4h','8h']`, default `1h`, `.sel` on click. Principal chips `['root','vibe']`, both selected by default; titles `root` → `"VPS boxes: think · onboarding · ivy"`, `vibe` → `"german-box"`; guard `'pick at least one principal'`.
- `POST /api/sshkeys/mint {ttl, principals:'root,vibe'}`; server (`:2732-2747`): POST only, Origin must be allowed (403 `forbidden`), body required (400 `bad request body`), `TTL_MS[ttl]` + `SAFE_PRINCIPALS=/^[a-z0-9_][a-z0-9_.,-]*$/i` (400 `'ttl must be 1h, 4h or 8h; principals must be names like root or root,vibe'`).
- `mint()` (`:2074-2103`): spawns `MINT_SH -t <ttl> -n <principals>` with `SSH_AUTH_SOCK=OP_AGENT_SOCK` (Touch ID; hint `"Minting pops a 1Password approval on the Mac — click Allow there."`), timeout 120 s; ok → `{ok:true, outdir}`; fail → 502 `{ok:false, error: stderr || 'mint failed (exit N)'}`.
- UI: button disabled + `'Minting…'`; success flashes the new cert card (`flashDir`); failure → `#mint-error` = `r.error||'mint failed'`; always `load()` after.

## 3. GitHub train (`keys.js:113-134, 230-258`)

- Three states: `train.ok===false` → amber pill `'BROKER DOWN'` + error text (`train.error||'the train broker is not answering'`); `active && expiresAt>now` → green pill `'ACTIVE'` + mono countdown; else pill `'INACTIVE'`.
- Countdown `left(epoch)`: `h:mm` if ≥1 h else `mm:ss`, zero-padded; ticks every 1 s; crossing zero forces a full render.
- Start chips (same TTLs): disable + `'Touch ID…'`, `POST /api/ghtrain {ttl}` (server re-checks `TTL_MS`, 400 `'ttl must be 1h, 4h or 8h'`); error → `r.error||'could not start train'`. `End train` (`#train-end`, only while live): `POST /api/ghtrain/end {}`; error → `'could not end train'`. Both POSTs Origin-gated (403); GET has no gate.
- Hint text: `"Starting a train pops one Touch ID on the Mac. While active, agents self-serve 1h tokens: "` + `curl -s localhost:3131/api/ghtoken`.
- Poll `setInterval(load, 30000)`.

## 4. Certificates (`certCard`, `keys.js:47-92`)

- `live = validToEpoch > now`. Pill `ACTIVE` (green) / `EXPIRED`. Row: mono `keyId||dir`, muted `"<principals.join(', ')||'no principals'> · until <validTo||'?'>"`, live countdown.
- Button `'Kill now'` (live; confirm `'Kill this cert now? Agents using it lose access immediately.'`) or `'Delete'` (expired, no confirm) → `POST /api/sshkeys/delete {dir}`; server `deleteCertDir` (`:2107-2121`) validates the dir inside `CERTS_DIR` (400 `'not a cert directory'`), `rm -rf`, unlinks the `current` alias if it pointed there; error → `r.error||'delete failed'`; `load()` after. **Ruling O9: "Kill now" = this delete.**
- Copy line (live only): code = `-o IdentitiesOnly=yes -o IdentityAgent=none -i <dir>/deployer -o CertificateFile=<dir>/deployer-cert.pub` (`:5-6`); Copy → clipboard, label `'Copied'` for 1.5 s.
- Empty: `'no certs yet — mint one above'`.

## 5. Keys table (`keysTable`, `keys.js:94-110`)

Columns Name · Type · Fingerprint · Comment; no sort; `'?'` fallbacks for type/fingerprint.

## 6. Errors, keys, ids, timers

- Load failure → `#certs` replaced by `'cannot reach fleetdeck'`; 403 text surfaces as `'HTTP 403'` via `post()` fallback (`keys.js:180`); 405 `method not allowed`.
- No localStorage. Old ids: `#ttls #principals #mint #mint-error #train-status #train-ttls #train-end #train-error #certs #pubkeys #refresh`. Timers: 30 s poll, 1 s tick, 1.5 s copy-label revert.

## 7. Mock counterparts (D14) and improvisations

- Mint card, GitHub train card, Certificates card, Keys table map 1:1 to the above.
- Improvise and document: principal chips source (ruling O9 says `hosts.json` users, but `hosts.json` has no user field → keep `root`/`vibe` from the current constant, note the gap); real key `type` per row (mock hard-codes ED25519); the `dir` token for delete has no mock field — carry it as a `data-*` hook; the `BROKER DOWN` state has no mock design.
