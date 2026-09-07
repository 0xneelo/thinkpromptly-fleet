// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html
// Tool:   tools/extract-fixture.mjs   ·   regenerate with: npm run v2:fixture
//
// The seeds S2 did NOT substitute. S2's tools/dc-compile.mjs owns public/v2/fixture.js and the seeds
// in it; this file must never define one of those keys, so that FD.fixture always wins and there is
// exactly one definition of every seed. npm run v2:fixture -- --check proves the two agree.
//
// Seed data only: theme styles and behaviour handlers from the mock are deliberately not extracted.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FD = root.FD || {};
  root.FD.fixtureExtract = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  return {
    tiles: [
      {
        "name": "LC-cdx-readpath",
        "box": "german-box",
        "foot1": "gpt-5.6-sol xhigh · ~/projects/lowcap-connecto…",
        "foot2": "Pursuing goal (11m)",
        "lines": [
          {
            "t": "Interacted with /root/xyz_1630_review"
          },
          {
            "t": "Ran cargo clippy -p lowcap-pools-management --tests --no-deps"
          },
          {
            "t": "… +85 lines · Finished dev profile in 9.80s"
          },
          {
            "t": "Working (16s · esc to interrupt)"
          },
          {
            "t": "› Ask Codex to do anything"
          }
        ]
      },
      {
        "name": "LC-census-classifier",
        "box": "german-box",
        "foot1": "LC-census0:claude* · bypass permissions on",
        "foot2": "Gisberta census cla",
        "lines": [
          {
            "t": "CONTRACT.md untouched."
          },
          {
            "t": "Lane complete: XYZ-1570, XYZ-1571 d1, XYZ-1572 all delivered, reviewed, post-audited, pushed."
          },
          {
            "t": "Still needs you: mirror docs/reports/gisberta/ into Linear — the MCP has been down."
          },
          {
            "t": "✳ Churned for 18m 20s"
          },
          {
            "t": "› Ask Codex to do anything"
          }
        ]
      },
      {
        "name": "LC-chiliz-factories",
        "box": "german-box",
        "foot1": "gpt-5.6-sol xhigh · ~/projects/lowcap-connec…",
        "foot2": "Goal achieved (1h 9m)",
        "lines": [
          {
            "t": "- Signed completion and operator-gated rerun: docs/reports/frieda-chiliz-factories/LINEAR-NOTE-DONE.md"
          },
          {
            "t": "- No drain or production mutation performed."
          },
          {
            "t": "Elapsed goal time: about 1 hour 10 minutes."
          },
          {
            "t": "— Worked for 5m 18s ————————"
          },
          {
            "t": "› Ask Codex to do anything"
          }
        ]
      },
      {
        "name": "LC-comparator-smalls",
        "box": "german-box",
        "foot1": "gpt-5.6-sol high · ~/projects/lowcap-connector…",
        "foot2": "Goal achieved (29m)",
        "lines": [
          {
            "t": "- Targeted API tests passed. Reviewer and hard-crux audit: green."
          },
          {
            "t": "Commits: de431951, ee4c8218, 5bfffdd6."
          },
          {
            "t": "Goal accounting: 500,363 tokens over 29m 48s."
          },
          {
            "t": "— Worked for 30m 21s ———————"
          },
          {
            "t": "› Ask Codex to do anything"
          }
        ]
      }
    ],
    groups: [
      {
        "box": "onboarding-box",
        "n": 1,
        "items": [
          {
            "n": "ops"
          }
        ]
      },
      {
        "box": "german-box",
        "n": 13,
        "items": [
          {
            "n": "FD-deck11-boardroot"
          },
          {
            "n": "FD-deck25-gate"
          },
          {
            "n": "FD-deck26-launcher"
          },
          {
            "n": "FD-deck27-notifycron"
          },
          {
            "n": "FD-desktop-sessions-p…"
          },
          {
            "n": "FD-gb-home"
          },
          {
            "n": "FD-gk-l1-ledger"
          },
          {
            "n": "FD-gk-l2-sessionkind"
          },
          {
            "n": "FD-gk-l3-skill"
          },
          {
            "n": "FD-gk-l4-sweep"
          },
          {
            "n": "FD-gk-l5-hooks"
          },
          {
            "n": "FD-gk-l6-goalspage"
          },
          {
            "n": "FD-rhoda-machines"
          }
        ]
      }
    ],
    busGroups: [
      {
        "id": "b-train84",
        "name": "train-84",
        "members": [
          "constantin",
          "ermenhild",
          "christa",
          "dorothea"
        ],
        "pinned": true
      }
    ],
    accounts: [
      {
        "prov": "codex",
        "name": "Daniel Tabor (personal · ChatGPT)",
        "email": "admin@deus.finance",
        "id": "",
        "plan": "pro",
        "live": "live",
        "right": "just now · DESKTOP-LJMEJQN",
        "bars": [
          {
            "label": "weekly",
            "pct": 80,
            "resets": "resets in 129h 2m"
          }
        ],
        "trendPts": "",
        "seen": "rfc1918-internal · live, DESKTOP-LJMEJQN · live, ubuntu-8gb-nbg1-1 · live"
      },
      {
        "prov": "claude",
        "name": "Daniel Tabor",
        "email": "admin@deus.finance",
        "id": "8323fe6e",
        "plan": "Max 20×",
        "live": "live",
        "right": "just now · DESKTOP-LJMEJQN",
        "bars": [
          {
            "label": "5 hour",
            "pct": 12,
            "resets": "resets in 4h 26m"
          },
          {
            "label": "7 day",
            "pct": 71,
            "resets": "resets in 120h 6m"
          },
          {
            "label": "7 day Fable",
            "pct": 8,
            "resets": "resets in 120h 6m"
          }
        ],
        "trendPts": [
          1,
          3,
          4,
          4,
          1,
          3,
          3.5,
          3.5,
          3.5,
          5,
          4,
          3,
          4.5,
          4,
          3,
          2,
          3.5,
          3,
          2.5,
          3
        ],
        "trendPct": "0%",
        "seen": "rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN · live"
      },
      {
        "prov": "claude",
        "name": "Reiner Garrecht",
        "email": "neelo@vibe.trading",
        "id": "c578669c",
        "plan": "Max 20×",
        "live": "live · usage from desktop snapshot",
        "right": "just now · rfc1918-internal",
        "staleNote": "sampled 8d ago — older than the window it measured, so these have reset since",
        "bars": [
          {
            "label": "5 hour",
            "pct": null
          },
          {
            "label": "7 day",
            "pct": null
          }
        ],
        "trendPts": [
          1,
          1.5,
          2,
          2.5,
          2.5,
          3,
          3.5,
          3.5,
          4,
          5,
          2,
          2.5,
          3,
          3.5,
          4,
          4.5,
          5,
          5.5,
          6,
          6.5
        ],
        "trendPct": "77%",
        "seen": "rfc1918-internal · live, rfc1918-internal · desktop snapshot"
      },
      {
        "prov": "claude",
        "name": "Lafayette Tabor",
        "email": "lafayette@infinite-holdings.llc",
        "id": "b14f597c",
        "plan": "desktop snapshot",
        "live": "",
        "right": "just now · DESKTOP-LJMEJQN",
        "staleNote": "sampled 9d ago — older than the window it measured, so these have reset since",
        "bars": [
          {
            "label": "5 hour",
            "pct": null
          },
          {
            "label": "7 day",
            "pct": null
          },
          {
            "label": "extra usage",
            "pct": null
          }
        ],
        "trendPts": [
          2,
          4,
          5,
          5.5,
          5,
          4.5,
          4,
          3.5,
          3,
          3,
          4,
          3,
          5,
          5.5,
          5.5,
          2,
          3,
          2.5,
          3,
          3.5
        ],
        "trendPct": "42%",
        "seen": "rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN · desktop snapshot"
      },
      {
        "prov": "claude",
        "name": "Aylin Yeter",
        "email": "aylianator@gmail.com",
        "id": "d24c4827",
        "plan": "Max 20×",
        "live": "live · usage from desktop snapshot",
        "right": "3h ago · rfc1918-internal",
        "banner": "could not read usage on rfc1918-internal",
        "staleNote": "sampled 14d ago — older than the window it measured, so these have reset since",
        "bars": [
          {
            "label": "5 hour",
            "pct": null
          },
          {
            "label": "7 day",
            "pct": null
          }
        ],
        "trendPts": [
          1,
          2,
          3,
          3.5,
          3,
          4,
          4.5,
          4,
          3.5,
          4,
          3,
          4.5,
          5,
          4.5,
          2,
          4,
          4.5,
          5,
          4.5,
          7
        ],
        "trendPct": "88%",
        "seen": "rfc1918-internal · live, rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN"
      }
    ],
    machines: [
      {
        "name": "MacBook Pro",
        "kind": "macos · local",
        "sessions": "",
        "cols": [
          {
            "client": "Claude CLI",
            "sections": [
              {
                "env": "",
                "name": "Reiner Garrecht",
                "email": "neelo@vibe.trading",
                "chips": [
                  [
                    "claude_max",
                    "neutral"
                  ],
                  [
                    "Max 20×",
                    "neutral"
                  ],
                  [
                    "token-proved",
                    "good"
                  ]
                ],
                "bars": [
                  [
                    "5 hour",
                    null,
                    true
                  ],
                  [
                    "7 day",
                    null,
                    true
                  ]
                ],
                "note": "token valid in 4 h · sampled 8d ago — window has reset since"
              }
            ]
          },
          {
            "client": "Codex CLI",
            "sections": [
              {
                "env": "",
                "name": "Daniel Tabor (personal · ChatGPT)",
                "email": "admin@deus.finance",
                "chips": [
                  [
                    "pro",
                    "neutral"
                  ],
                  [
                    "token-proved",
                    "good"
                  ]
                ],
                "bars": [
                  [
                    "weekly",
                    80
                  ]
                ],
                "note": "refreshed 1d ago · resets in 129h 2m · sampled just now"
              }
            ]
          },
          {
            "client": "Claude Desktop",
            "sections": [
              {
                "env": "",
                "name": "Lafayette Tabor",
                "email": "",
                "chips": [
                  [
                    "last active 13m ago",
                    "neutral"
                  ]
                ],
                "bars": [
                  [
                    "5 hour",
                    null,
                    true
                  ],
                  [
                    "7 day",
                    null,
                    true
                  ],
                  [
                    "extra usage",
                    null,
                    true
                  ]
                ],
                "note": "sampled 9d ago — window has reset since"
              }
            ]
          },
          {
            "client": "Codex Desktop",
            "sections": [
              {
                "env": "",
                "name": "signed in, account unknown",
                "email": "",
                "chips": [],
                "bars": [],
                "note": "Codex desktop keeps the account under safeStorage/IndexedDB, which this reader cannot read · no usage data"
              }
            ]
          }
        ]
      },
      {
        "name": "german-box",
        "kind": "windows+wsl · ssh gb-deploy",
        "sessions": "65 sessions",
        "cols": [
          {
            "client": "Claude CLI",
            "sections": [
              {
                "env": "WSL",
                "name": "Daniel Tabor",
                "email": "admin@deus.finance",
                "chips": [
                  [
                    "claude_max",
                    "neutral"
                  ],
                  [
                    "Max 20×",
                    "neutral"
                  ],
                  [
                    "token-proved",
                    "good"
                  ]
                ],
                "bars": [
                  [
                    "5 hour",
                    12
                  ],
                  [
                    "7 day",
                    71
                  ],
                  [
                    "7d fable",
                    8
                  ]
                ],
                "note": "token valid in 6 h · 65 sessions run as Daniel Tabor"
              },
              {
                "env": "Windows",
                "name": "Daniel Tabor",
                "email": "admin@deus.finance",
                "chips": [
                  [
                    "config only",
                    "warn"
                  ]
                ],
                "bars": [
                  [
                    "5 hour",
                    12
                  ],
                  [
                    "7 day",
                    71
                  ]
                ],
                "note": ""
              }
            ]
          },
          {
            "client": "Codex CLI",
            "sections": [
              {
                "env": "WSL",
                "name": "Daniel Tabor (personal · ChatGPT)",
                "email": "admin@deus.finance",
                "chips": [
                  [
                    "pro",
                    "neutral"
                  ],
                  [
                    "token-proved",
                    "good"
                  ]
                ],
                "bars": [
                  [
                    "weekly",
                    80
                  ]
                ],
                "note": "refreshed 9d ago · resets in 129h 2m"
              },
              {
                "env": "Windows",
                "name": "Daniel Tabor (personal · ChatGPT)",
                "email": "admin@deus.finance",
                "chips": [
                  [
                    "plus",
                    "neutral"
                  ],
                  [
                    "token-proved",
                    "good"
                  ]
                ],
                "bars": [
                  [
                    "weekly",
                    80
                  ]
                ],
                "note": "refreshed 101d ago"
              }
            ]
          },
          {
            "client": "Claude Desktop",
            "sections": [
              {
                "env": "WSL",
                "name": "—",
                "email": "",
                "chips": [],
                "bars": [],
                "note": ""
              },
              {
                "env": "Windows",
                "name": "Daniel Tabor",
                "email": "",
                "chips": [
                  [
                    "last active 1d ago",
                    "neutral"
                  ]
                ],
                "bars": [
                  [
                    "5 hour",
                    12
                  ],
                  [
                    "7 day",
                    71
                  ],
                  [
                    "7d fable",
                    8
                  ]
                ],
                "note": "sampled just now"
              }
            ]
          },
          {
            "client": "Codex Desktop",
            "sections": [
              {
                "env": "WSL",
                "name": "—",
                "email": "",
                "chips": [],
                "bars": [],
                "note": ""
              },
              {
                "env": "Windows",
                "name": "—",
                "email": "",
                "chips": [],
                "bars": [],
                "note": ""
              }
            ]
          }
        ]
      }
    ],
    gbSessions: [
      "FD-deck11-boardroot",
      "FD-deck25-gate",
      "FD-deck26-launcher",
      "FD-deck27-notifycron",
      "FD-desktop-sessions-p…",
      "FD-gb-home",
      "FD-gk-l1-ledger",
      "FD-gk-l2-sessionkind",
      "FD-gk-l3-skill",
      "FD-gk-l4-sweep",
      "FD-gk-l5-hooks",
      "FD-gk-l6-goalspage",
      "FD-rhoda-machines"
    ],
    termLinesFor: {
      "LC-cdx-readpath": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-cdx-readpath...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-CDX-READPATH.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-CDX-READPATH.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-CDX-READPATH.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(cdx-readpath): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-cdx-readpath 41c4965] docs(cdx-readpath): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-CDX-READPATH.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "LC-census-classifier": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-census-classifier...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-CENSUS-CLASSIFIER.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-CENSUS-CLASSIFIER.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-CENSUS-CLASSIFIER.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(census-classifier): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-census-classifier 41c4965] docs(census-classifier): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-CENSUS-CLASSIFIER.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "LC-chiliz-factories": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-chiliz-factories...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-CHILIZ-FACTORIES.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-CHILIZ-FACTORIES.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-CHILIZ-FACTORIES.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(chiliz-factories): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-chiliz-factories 41c4965] docs(chiliz-factories): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-CHILIZ-FACTORIES.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "LC-comparator-smalls": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-comparator-smalls...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-COMPARATOR-SMALLS.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-COMPARATOR-SMALLS.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-COMPARATOR-SMALLS.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(comparator-smalls): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-comparator-smalls 41c4965] docs(comparator-smalls): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-COMPARATOR-SMALLS.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-deck11-boardroot": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-deck11-boardroot...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-DECK11-BOARDROOT.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-DECK11-BOARDROOT.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-DECK11-BOARDROOT.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(deck11-boardroot): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-deck11-boardroot 41c4965] docs(deck11-boardroot): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-DECK11-BOARDROOT.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-deck25-gate": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-deck25-gate...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-DECK25-GATE.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-DECK25-GATE.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-DECK25-GATE.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(deck25-gate): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-deck25-gate 41c4965] docs(deck25-gate): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-DECK25-GATE.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-deck26-launcher": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-deck26-launcher...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-DECK26-LAUNCHER.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-DECK26-LAUNCHER.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-DECK26-LAUNCHER.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(deck26-launcher): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-deck26-launcher 41c4965] docs(deck26-launcher): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-DECK26-LAUNCHER.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-deck27-notifycron": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-deck27-notifycron...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-DECK27-NOTIFYCRON.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-DECK27-NOTIFYCRON.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-DECK27-NOTIFYCRON.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(deck27-notifycron): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-deck27-notifycron 41c4965] docs(deck27-notifycron): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-DECK27-NOTIFYCRON.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-desktop-sessions-p…": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-desktop-sessions-p…...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-DESKTOP-SESSIONS-P….md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-DESKTOP-SESSIONS-P….md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-DESKTOP-SESSIONS-P….md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(desktop-sessions-p…): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-desktop-sessions-p… 41c4965] docs(desktop-sessions-p…): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-DESKTOP-SESSIONS-P….md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gb-home": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gb-home...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GB-HOME.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GB-HOME.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GB-HOME.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gb-home): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gb-home 41c4965] docs(gb-home): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GB-HOME.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l1-ledger": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l1-ledger...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L1-LEDGER.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L1-LEDGER.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L1-LEDGER.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l1-ledger): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l1-ledger 41c4965] docs(gk-l1-ledger): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L1-LEDGER.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l2-sessionkind": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l2-sessionkind...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L2-SESSIONKIND.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L2-SESSIONKIND.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L2-SESSIONKIND.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l2-sessionkind): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l2-sessionkind 41c4965] docs(gk-l2-sessionkind): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L2-SESSIONKIND.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l3-skill": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l3-skill...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L3-SKILL.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L3-SKILL.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L3-SKILL.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l3-skill): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l3-skill 41c4965] docs(gk-l3-skill): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L3-SKILL.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l4-sweep": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l4-sweep...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L4-SWEEP.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L4-SWEEP.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L4-SWEEP.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l4-sweep): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l4-sweep 41c4965] docs(gk-l4-sweep): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L4-SWEEP.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l5-hooks": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l5-hooks...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L5-HOOKS.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L5-HOOKS.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L5-HOOKS.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l5-hooks): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l5-hooks 41c4965] docs(gk-l5-hooks): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L5-HOOKS.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-gk-l6-goalspage": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-gk-l6-goalspage...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-GK-L6-GOALSPAGE.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-GK-L6-GOALSPAGE.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-GK-L6-GOALSPAGE.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(gk-l6-goalspage): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-gk-l6-goalspage 41c4965] docs(gk-l6-goalspage): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-GK-L6-GOALSPAGE.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ],
      "FD-rhoda-machines": [
        {
          "t": "• Ran git fetch origin && git status --short --branch",
          "kind": "cmd"
        },
        {
          "t": "  └ ## agent-rhoda-machines...origin/main [ahead 2]",
          "kind": "out"
        },
        {
          "t": "• Started `/root/review_gate`",
          "kind": "cmd"
        },
        {
          "t": "• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.",
          "kind": "note"
        },
        {
          "t": "• Edited NOTE-RHODA-MACHINES.md (+1 −1)",
          "kind": "cmd"
        },
        {
          "t": "     8  Execution paused before implementation: the required issue read is",
          "kind": "out"
        },
        {
          "t": "     9 −blocked by an expired app connection. Three consecutive MCP operations",
          "kind": "del"
        },
        {
          "t": "     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations",
          "kind": "add"
        },
        {
          "t": "    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and",
          "kind": "out"
        },
        {
          "t": "• Ran git add -- NOTE-RHODA-MACHINES.md && git diff --cached --check && git diff --cached --stat",
          "kind": "cmd"
        },
        {
          "t": "  └ NOTE-RHODA-MACHINES.md | 35 +++++++++++++++++++++++++++",
          "kind": "out"
        },
        {
          "t": "    1 file changed, 35 insertions(+)",
          "kind": "out"
        },
        {
          "t": "• Waiting for agents",
          "kind": "cmd"
        },
        {
          "t": "• Finished waiting",
          "kind": "cmd"
        },
        {
          "t": "  └ No agents completed yet",
          "kind": "out"
        },
        {
          "t": "• Ran git commit -m \"docs(rhoda-machines): record reauthentication gate\" && git rev-parse HEAD",
          "kind": "cmd"
        },
        {
          "t": "  └ [agent-rhoda-machines 41c4965] docs(rhoda-machines): record reauthentication gate",
          "kind": "out"
        },
        {
          "t": "    41c4965bc17496d080d3f02d310f406ac71651fa",
          "kind": "out"
        },
        {
          "t": "──────────────────────────────────────────────────────────────",
          "kind": "rule"
        },
        {
          "t": "• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.",
          "kind": "note"
        },
        {
          "t": "  Reviewed gate record: NOTE-RHODA-MACHINES.md, committed locally as 41c4965; unpushed.",
          "kind": "note"
        },
        {
          "t": "  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.",
          "kind": "note"
        },
        {
          "t": "— Worked for 1m 51s ────────────────────────────────────────",
          "kind": "rule"
        }
      ]
    },
  };
});
