# fd-v2-l2 — Linear / registry log

## Linear

Reachable. Main issue **DECK-56** — "[Renate · frontend-developer] fd-v2 L2 app shell:
sidebar · page header · right rail", team `fleetdeck`, state **In Progress**.

The four labels the pack names (`agent:renate`, `project:remote-system`,
`subproject:fleetdeck-v2`, `session:cli-worker`) **do not exist** in this workspace:
`addLabels` rejected every one of them with "Could not find label". The issue carries no
labels. Not a blocker; recorded here for the operator to create the labels or drop the
requirement.

## Registry

`POST http://100.125.231.25:3131/api/registry` answers **401 `unauthorized`** from the box,
for the opening call. This is the known box-side 401 (XYZ-2137), the same one L1 hit and
recorded. Per that precedent no operator gate is filed and no registry row exists for
`FD-v2-l2`; DECK-56 is the record.

Opening call attempted 2026-09-07:

```
curl -s -X POST http://100.125.231.25:3131/api/registry -H "Content-Type: application/json" \
  -d '{"host":"german-box","name":"FD-v2-l2","group":"fd-v2","task":"DECK-56","label":"fd-v2 L2 shell","role":"frontend-developer","worker":"Renate"}'
→ unauthorized (HTTP 401)
```
