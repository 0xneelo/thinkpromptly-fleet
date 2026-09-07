# fd-v2-l6 — registry POST blocked (401)

`POST http://100.125.231.25:3131/api/registry` answers `unauthorized` / HTTP 401 from
german-box. This is the known box-side failure (XYZ-2137 covers it); it is not a new
gate and it does not block the slice.

Row that would have been written on start (2026-09-07):

```json
{"host":"german-box","name":"FD-v2-l6","group":"fd-v2","task":"DECK-49",
 "label":"fd-v2 L6 bus","role":"frontend-developer","worker":"Gerhild"}
```

Row that will be written on completion:

```json
{"host":"german-box","name":"FD-v2-l6","status":"done"}
```

Both are retried once per milestone. Linear DECK-49 carries the real state.

— Gerhild
