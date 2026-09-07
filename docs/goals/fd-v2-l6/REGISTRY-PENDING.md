# fd-v2-l6 — registry POST blocked (401)

`POST http://100.125.231.25:3131/api/registry` answers `unauthorized` / HTTP 401 from
german-box. This is the known box-side failure (XYZ-2137 covers it); it is not a new
gate and it did not block the slice. Retried once per milestone, including at close.

Opening row (2026-09-07, HTTP 401):

```json
{"host":"german-box","name":"FD-v2-l6","group":"fd-v2","task":"DECK-49",
 "label":"fd-v2 L6 bus","role":"frontend-developer","worker":"Gerhild"}
```

Closing row (2026-09-07, HTTP 401):

```json
{"host":"german-box","name":"FD-v2-l6","status":"done"}
```

Linear DECK-49 carries the real state and is **Done**, with the full gate table and the
behaviour checklist in its closing comment. Both rows should be replayed by whoever has a
working credential for the deck.

— Gerhild
