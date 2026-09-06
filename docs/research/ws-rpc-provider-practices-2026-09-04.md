# WS RPC Provider Practices + Dead/Silent-Socket Detection

**Research date:** 2026-09-04  
**Scope:** WebSocket RPC practices for the ten-chain EVM fleet (Ethereum 1, Base 8453, BNB Smart Chain 56, Arbitrum 42161, Polygon 137, Avalanche 43114, Sonic 146, HyperEVM 999, Chiliz 88888, Robinhood Chain 4663) plus Solana.  
**System boundary:** The supplied “Our system” description is authoritative and is cited as **[SYS]**. Repository-dependent verification was intentionally dropped under the amendment.  
**Evidence labels:** **VERIFIED** means a current official provider document or upstream source was found; **INFERRED** means the conclusion is indirect, an absence in the reviewed public documentation, a mathematical/architectural derivation, or a historical/empirical measurement not stated by the provider; **OPERATOR-OBSERVED** means authoritative ground truth supplied in the task.  
**Cost labels:** **ZERO-COST** means no debit to the shared 800-CU/s budget: RFC 6455 control frames, unmetered provider-pushed data, or fields already present in delivered frames. **METERED** means a JSON-RPC request, subscription setup/renewal, delivered notification, byte allowance, credit, request unit, or provider-specific billable operation. A zero-dollar public service is called zero-cost only with respect to the shared CU budget; it is not an SLA.

## (a) Executive summary

1. **No WS-lane head polling:** `eth_blockNumber`, `net_version`, periodic `eth_getLogs`, and any denied-poll-as-miss design are disqualified by the operator ruling. **[SYS]**
2. **Primary transport liveness should be RFC 6455 ping/pong plus socket errors/close:** it is zero-cost and detects dead or half-open paths faster than default TCP keepalive, but it proves only that the peer’s WebSocket path is responsive. **VERIFIED [S1][S2][S3]**
3. **The silent provider is the irreducible case:** a socket may stay open, answer pings, retain a locally known subscription id, and still stop dispatching notifications; transport liveness alone cannot detect that failure. **INFERRED**
4. **Single-socket impossibility:** when no matching log arrives, “no qualifying chain event occurred” and “the provider dropped qualifying events” are observationally identical unless there is independent pushed reference data or a metered probe. **INFERRED**
5. **The existing 10-second owning-session heartbeat is valuable only as local task liveness:** it must not stand in for remote transport or subscription-delivery health. **[SYS]; INFERRED**
6. **Use block number, block hash, transaction/log index, and `removed` from delivered log frames:** these zero-cost fields detect regressions, duplicates, reorgs, stale delivery, and bounded gaps after the next event, but not a completely silent interval. **VERIFIED [S4]**
7. **Bind every subscription id to a socket epoch and treat it as a lease:** reconnect success is not coverage until the new socket has acknowledged every required subscription; subscription ids die with their connection. **VERIFIED [S4][CL-G1]**
8. **Budget denial is a separate state, never provider evidence:** only transport failure, lease failure, or independently corroborated pushed-data divergence may advance a provider circuit breaker. **[SYS]; INFERRED**
9. **Provider economics vary radically:** Alchemy and NodeReal meter notifications by byte, dRPC charges every notification, Chainstack charges each push, PublicNode is keyless/free but best-effort, and Ankr’s current WSS tariff makes continuous paid heads uneconomic. **VERIFIED [A3][D2][C2][P1][N2][K2]**
10. **Best-fit design:** add real protocol ping/pong, explicit socket/subscription epochs, zero-cost delivered-log invariants, budget-independent conviction, jittered reconnect visibility, and repair-only `eth_getLogs`; add a second free pushed reference only where its independence and non-metering are verified. **VERIFIED foundation [S1][S4]; INFERRED system policy**

## (b) Provider matrix

**Fleet abbreviations:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, HYPER, CHZ, RH, SOL. “Catalog/WSS” means the current official catalog exposes the network and the reviewed documentation supports WebSocket use; it does not promise identical methods or limits on every chain. “Not published” means no explicit current value was found in the reviewed official public documentation, not that no internal limit exists.

| Provider | Fleet chains served over WSS | Requested subscription types | Documented WS limits | Keepalive policy | WS billing model | SLA and machine-readable status | Free/keyless WSS tier |
|---|---|---|---|---|---|---|---|
| **Alchemy** | **VERIFIED:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, HYPER, RH, SOL; CHZ not in current supported-chain list. [A1][A2] | **VERIFIED EVM:** `newHeads`, `logs`, `newPendingTransactions`. **VERIFIED SOL:** `logsSubscribe`, `slotSubscribe`; current overview does not list `blockSubscribe`, so its availability is **INFERRED/unverified**. [A1] | **VERIFIED:** 100 concurrent sockets on Free; 2,000 on paid; 1,000 unique subscriptions/socket; 1,000 max JSON-RPC batch; 200 concurrent in-flight requests/socket. No public idle timeout, hard socket lifetime, or notification-rate cap found. [A1] | **VERIFIED:** Alchemy servers periodically send RFC 6455 pings and clients must pong. SDK additionally sends `net_version` every 30 s. No maximum lifetime is documented; SDK docs warn not to assume persistence. [A4][A6][A7] | **METERED:** `eth_subscribe`/`eth_unsubscribe` 10 CU; delivered EVM subscription bandwidth 0.04 CU/byte; `net_version` is 0 actual CU but 5 throughput CU. The held ~118-byte envelope is **INFERRED historical/empirical accounting**, not in current docs. [A3] | Enterprise SLA is custom/contractual; public status page exists. A provider-documented machine API was not found; a generic Statuspage endpoint would be **INFERRED**, not contractual. [A5][A8] | **VERIFIED keyed Free:** 30M CU/month, 300 CU/s, Smart WebSockets, up to 100 sockets. No keyless production tier. [A5][A1] |
| **QuickNode** | **VERIFIED catalog/WSS:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, HYPER, RH, SOL; CHZ not found in current catalog. [Q1][Q2] | **VERIFIED EVM:** `newHeads`, `logs`, `newPendingTransactions`. Native SOL subscriptions are documented across its Solana reference; exact `blockSubscribe` gating in the reviewed plan pages is **INFERRED/unverified**. [Q2] | Native WS idle timeout, max lifetime, subscriptions/socket, and sockets/project are not publicly specified. **VERIFIED plan throughput:** trial 15 RPS; paid published tiers 50/125/250 RPS; enterprise custom. Do not confuse QuickNode “Streams” active-stream limits with native WS subscriptions. [Q4] | Official guide demonstrates client RFC pings every 7.5 s and termination when no pong is seen for 15 s; treat those as example values, not a documented server requirement. [Q3] | Credit-based RPC plans are **VERIFIED**; public docs reviewed do not unambiguously state whether each native subscription notification debits credits, so notification billing is **INFERRED—contract-test before use as a free pushed reference**. [Q4] | Enterprise offers a contractual SLA/custom limits; public status and trust portals exist. A documented machine status API was not found. [Q4][Q5][Q6] | **VERIFIED keyed trial:** one month, 10M credits, 15 RPS, no overage. Not keyless. [Q4] |
| **Infura** | **VERIFIED WSS/reference:** ETH, BASE, BSC, ARB, POLY, AVAX, HYPER. SOL appears in the product reference, but WSS support was not established in the reviewed current pages; SONIC, CHZ, RH were not found. [I1][I2][I3] | **VERIFIED EVM:** `newHeads` and `logs`; support varies by network for pending subscriptions, so `newPendingTransactions` is **INFERRED—verify per chain**. [I2][I3] | Public idle timeout, hard lifetime, subscriptions/socket, and concurrent-socket cap not found. Daily-credit and per-second throughput quotas apply; official support says quota exhaustion can sever a WebSocket. [I4][I5] | Official guidance requires client-side management of silent failures and reconnects; no universal server RFC-ping interval or client-ping mandate is published in the reviewed pages. [I2][I6] | **METERED:** subscribe/unsubscribe consume credits even with no events; returned events consume credits under credit pricing. Example: Base `eth_subscribe` costs 5 credits. Exact per-notification cost is method/network dependent. [I2][I3] | Enterprise commitments are contractual; public Statuspage exposes status plus RSS/Atom feeds. No provider-specific SLA number for self-serve was found. [I4][I7] | **VERIFIED keyed Free/Core**, but current pricing page is internally inconsistent: its comparison table says 3M credits/day and 500 credits/s, while lower FAQ text states 6M/day and 2,000/s. Use account-enforced values, not prose. [I4] |
| **Ankr** | **VERIFIED catalog:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, CHZ, SOL; HYPER and RH were not established. WSS is plan/chain dependent and free-tier WSS is disabled in the supplied observation. [K1][K2][K4][SYS] | Standard EVM subscriptions and Solana subscriptions are offered on supported premium WS endpoints; exact per-chain support for all requested types is **INFERRED—validate before deployment**. [K2][K4] | **VERIFIED headline throughput:** Public 20 RPS, Freemium 30 RPS, Premium up to 1,500 requests/s. No public idle timeout, socket lifetime, subscriptions/socket, or concurrent-socket cap found. [K1][K2] | No official server-ping/client-ping interval found. **INFERRED:** use standards-compliant client RFC ping/pong and reconnect. [K2][S1] | **METERED/VERIFIED:** EVM-compatible subscription setup is 200 credits; Solana setup is 500. Each Solana notification is 500 credits and each “Other” notification is 100 credits. At CHZ’s roughly 3.0 s cadence, about 28,800 heads/day × 100 = **2.88M credits/day**, explaining why paid CHZ `newHeads` stays off. [K2][P2] | **VERIFIED:** Public best-effort; Premium self-serve has no individual SLA; Enterprise standard 99.9% monthly with 10% credit, negotiable 99.99%. Live RPC health dashboard exists; machine API not found. [K3] | **OPERATOR-OBSERVED:** free-tier attempt returns HTTP 401 “WebSocket is disabled.” Public/free HTTP remains available subject to limits, but free WSS must not be assumed. [SYS][K1] |
| **dRPC** | **VERIFIED catalog/WSS:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, SOL. HYPER, CHZ, and RH mainnet were not found; Robinhood testnet references do not establish RH mainnet. [D1][D4] | **VERIFIED EVM:** `newHeads`, `logs`, `newPendingTransactions`. **VERIFIED SOL:** includes `logsSubscribe`, `slotSubscribe`, `blockSubscribe`. [D2][D3] | **VERIFIED free limits:** normally 120,000 CU/min/IP, dynamically reducible to 50,400; 2 s timeout; batch 3; filters disabled; `eth_getLogs` max 10,000 logs. Paid requests are balance-limited rather than a fixed public rate. No socket-count/lifetime limits published. [D4] | No official RFC ping interval or idle-reset rule found. Reconnect is recommended; keepalive details are **INFERRED/not published**. [D2][D3] | **METERED:** 20 CU to create an EVM or Solana subscription and 20 CU for every delivered notification. [D2][D3] | No public contractual SLA found. Status service exposes per-chain components plus JSON, webhook, and RSS outputs. [D5] | **VERIFIED free/public routing:** 210M CU per rolling 30 days, public nodes only, IP-based limits; keyless public endpoints exist. Notifications still consume the stated CU accounting even when no invoice is due. [D1][D4] |
| **Chainstack** | **VERIFIED catalog/WSS:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, HYPER, RH, SOL; CHZ not found. Some newer-network availability is plan/node dependent. [C1][C6] | **VERIFIED EVM:** standard `eth_subscribe` types including heads/logs/pending where the chain node supports them. **VERIFIED SOL:** standard PubSub including `logsSubscribe`, `slotSubscribe`, and `blockSubscribe`. [C1][C7] | **VERIFIED:** WebSocket disconnect after 3,600 s of inactivity; maximum 500 concurrent WebSocket connections. No public max socket age or subscriptions/socket found. Free tier publishes 25 RPS. [C1][C3] | Activity is required before the 1 h idle timer; official examples show reconnect handling, but no required RFC ping interval is specified. [C1] | **METERED:** subscription setup is a request unit and each pushed notification consumes one request unit. [C2][C7] | **VERIFIED Enterprise SLA:** 99.9% quarterly uptime. Public status page and documented machine summary JSON endpoint are available. [C4][C5] | **VERIFIED keyed Developer tier:** 3M requests/month, 25 RPS, one node, WSS included, no card. Not keyless. [C3] |
| **PublicNode** | **VERIFIED keyless WSS:** ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, CHZ, RH, SOL. HYPER not listed. [P1][P2][P3] | The public endpoints expose standard chain RPC; exact method-by-method guarantees are not aggregated. EVM requested types and SOL `logsSubscribe`/`slotSubscribe`/`blockSubscribe` are **INFERRED—run a non-secret capability test per chain**. [P1][P2][P3] | No documented idle timeout, hard lifetime, subscriptions/socket, message-rate cap, or concurrent-socket quota. Terms permit limits/service changes at any time. [P4] | No server-ping or client-ping policy published. **INFERRED:** client RFC ping/pong is required operationally even though it cannot create an SLA. [S1][P4] | **ZERO-COST to the shared CU budget:** no account or billing meter is advertised for public endpoints. This is shared best-effort capacity, not guaranteed unmetered throughput. [P1][P4] | No contractual SLA or provider status API found; service is offered “as is” without uninterrupted-availability warranty. [P4] | **VERIFIED free and keyless WSS.** This is the broadest currently verified keyless fit for the fleet, including CHZ and RH, but not HYPER. [P1][P2] |
| **Blast / Bware** | **VERIFIED:** no current service matrix; Blast API is officially deprecated and directs migration to Alchemy. [B1] | N/A—deprecated. [B1] | N/A—deprecated. [B1] | N/A—deprecated. [B1] | N/A—deprecated. [B1] | Historical commitments no longer make it a current candidate. [B1] | No current tier. [B1] |
| **LlamaNodes** | Current RPC fleet/WSS support is **INFERRED unavailable**: the former official domain no longer presents an RPC service, and no current official provider documentation was discoverable. [L1] | **INFERRED unavailable.** [L1] | **INFERRED not published/unavailable.** [L1] | **INFERRED not published/unavailable.** [L1] | **INFERRED not published/unavailable.** [L1] | No current official SLA/status service found. **INFERRED.** [L1] | No current RPC tier found. **INFERRED.** [L1] |
| **GetBlock** | **VERIFIED catalog:** all ten EVM fleet chains plus SOL are listed with WebSocket availability across the node catalog. [G1] | Standard EVM and Solana subscriptions are available where the underlying node exposes them; the public catalog does not aggregate method-by-method guarantees, so exact requested-type coverage is **INFERRED—capability-test per chain**. [G1] | **VERIFIED plan examples:** shared Pro up to 800 RPS and 150 endpoints. Public idle timeout, max socket age, subscriptions/socket, and concurrent-socket quota not found. Dedicated service advertises no standard rate limit. [G2] | No public server/client ping interval or idle-reset policy found. **INFERRED:** implement RFC ping/pong. [S1][G1] | **METERED:** shared plans use CU; public docs do not state the exact cost of each native subscription notification. “Limitless” uses flat/RPS pricing without CU, and dedicated is contract-priced. [G2] | **VERIFIED paid SLA:** shared 99%, dedicated 99.9%, dedicated plus load balancer 99.99%; free excluded. Status service exposes machine feeds/API on the current/legacy status surfaces. [G3][G4] | **VERIFIED keyed free shared tier;** not keyless. Exact enforced allowance should be read from the current account dashboard. [G2] |
| **NodeReal** | **VERIFIED explicit WSS:** ETH, BSC, POLY, ARB. Other fleet chains may exist over HTTP or other products, but current public docs reviewed did not establish WSS for BASE, AVAX, SONIC, HYPER, CHZ, RH, or SOL. [N3][N4] | Standard EVM `eth_subscribe`; exact type support per chain is **INFERRED** beyond documented examples. [N3][N4] | FAQ says no single-endpoint/application WSS connection limit “as of now.” Public shared access is limited to 2,000 CU/min/IP; Free plan publishes 150 CUPS. No idle/lifetime/subscription cap found. [N1][N3][N4] | No official ping interval or idle policy found. **INFERRED:** standards-based client ping/pong. [S1][N3] | **METERED:** `eth_subscribe` 10 CU; delivered subscription notifications 0.04 CU/byte. [N2] | Marketing states 99.8% uptime; no public contractual SLA or machine-readable status API was found. [N5] | **VERIFIED keyed Free:** 10M CU/month, 150 CUPS, three keys. A shareable public key has stricter IP limits; it is not truly keyless. [N1][N4] |
| **Tenderly Node** | **VERIFIED broad catalog claim:** 80+/100+ networks, with ETH, BASE, BSC, ARB, POLY shown; exact WSS availability for every fleet chain is not publicly enumerated, so the remainder is **INFERRED/unverified**. [T2] | Standard EVM subscriptions are **INFERRED** from Node’s WebSocket positioning; a current public method matrix for `newHeads`/`logs`/pending was not found. [T2] | Public idle timeout, max lifetime, subscriptions/socket, rate cap, and socket cap not published. [T1][T2] | No public ping/keepalive requirement found. **INFERRED.** [T2] | Enterprise/custom pricing; no public per-notification/per-byte unit for Node WSS. **INFERRED—obtain contract schedule.** [T1] | **VERIFIED marketing/plan claim:** 99.99% uptime SLA; public status page exists. A provider-documented machine API was not found. [T2][T3] | Free plan covers product UI/dev tooling but public pricing says Node API is enterprise/custom; no free production Node WSS established. [T1] |
| **Helius** | **VERIFIED:** SOL only. [H1] | **VERIFIED current docs:** full standard Solana set, including `logsSubscribe`, `slotSubscribe`, and `blockSubscribe`, plus Helius extensions. This corrects older Helius material that described `blockSubscribe` as unavailable/unstable. [H1] | **VERIFIED:** 10-minute inactivity timeout. Free plan 10 RPS. No public max socket lifetime, subscriptions/socket, or concurrent-socket cap found. [H1][H2] | Official docs say send a ping at least once per minute; examples include both application JSON `ping` and native RFC ping. Only the RFC control frame is guaranteed **ZERO-COST** under this report’s constraints; an application JSON ping is **METERED/unclear and disqualified** unless Helius contractually confirms otherwise. [H1][S1] | **METERED:** 1 credit to open a connection; 2 credits per 0.1 MB of uncompressed streamed data. [H1] | Enterprise SLA is sales/contract based; no public numeric commitment found. Official Statuspage exists; provider-specific machine API not documented. [H2][H3] | **VERIFIED keyed Free:** 1M credits, 10 RPS, standard WebSockets. Not keyless. [H2] |
| **Triton One** | **VERIFIED:** SOL only. [R1][R2] | **VERIFIED Whirligig:** native Solana WebSockets including full `blockSubscribe`; standard log/slot subscriptions are part of the native RPC surface. [R2] | Flexible/custom limits; no public hard inactivity, max-lifetime, subscriptions/socket, message-rate, or socket-count values found. [R1] | No public RFC ping/client heartbeat interval found. **INFERRED:** negotiate and implement client protocol ping/pong. [R1][S1] | **METERED:** streaming at $0.08/GB; unary RPC adds $10/million calls plus $0.08/GB. Current PAYG requires a $125 minimum deposit. [R1] | Marketing states 99.99% reliability; contractual terms and a public machine-readable status API were not found. [R1][R3] | No free tier established; PAYG minimum deposit. [R1] |

### Matrix footnotes and held-fact adjudication

1. **Alchemy notification accounting — partly verified, partly not.** Current docs verify 0.04 CU per delivered EVM subscription byte, 10 CU for subscribe/unsubscribe, and `net_version` at 0 actual CU but 5 throughput CU. The approximately 118-byte JSON-RPC envelope is not stated in current official documentation and remains **INFERRED historical/empirical payload accounting**. The SDK’s 30-second `net_version` heartbeat is real, but it is still a JSON-RPC probe, consumes throughput capacity, and is **disqualified for this WS lane** under the operator ruling. Alchemy documents no maximum socket lifetime and explicitly warns clients not to assume a socket remains open forever. **VERIFIED [A3][A4][A7]; INFERRED envelope**
2. **Ankr economics — held fact verified and sharpened.** Current docs now publish WSS pricing: 200 credits to create an EVM-compatible subscription, 500 for Solana; each Solana notification is 500 credits and each “Other” notification is 100 credits. With CHZ’s documented roughly 2.99-second average block time, approximately 28,800 heads/day × 100 credits = **2.88M credits/day**. Free/Public/Freemium plans are HTTPS-only in the current feature table; the supplied 401 “WebSocket is disabled” response is consistent with that documentation. Paid CHZ heads therefore remain off unless a contract makes notifications unmetered. **VERIFIED [K2][P2]; OPERATOR-OBSERVED response [SYS]**
3. **Chiliz endpoints are not interchangeable.** The supplied observation that the chain-operated `rpc.chiliz.com` endpoint is HTTP-only means it must not be treated as a WSS fallback. PublicNode separately and explicitly exposes free keyless Chiliz WSS. **OPERATOR-OBSERVED [SYS]; VERIFIED [P2]**
4. **“Free” has three meanings.** A keyed free quota can still meter notifications and can be exhausted; an IP-limited keyless endpoint can still throttle or disappear; a contract can make pushed notifications unmetered without being free in dollars. For the 800-CU/s constraint, only traffic that does not debit the shared meter qualifies as **ZERO-COST**. **[SYS]; INFERRED**
5. **Status APIs are evidence, not liveness.** dRPC and Chainstack explicitly expose machine-readable status outputs; Infura/GetBlock expose machine feeds through their status services. Status pages may be delayed, scoped more broadly than one endpoint, or green during a subscription-specific failure, so they may annotate incidents but may never convict or acquit a socket. **VERIFIED [D5][C5][I7][G4]; INFERRED operational use**
6. **No-public-limit cells are not promises.** “Not published” records the result of reviewing the provider’s current official API, pricing, SLA, and WebSocket pages. Load balancers and private abuse controls may still impose undocumented limits. **INFERRED**
7. **Provider-pushed does not automatically mean zero-cost.** Alchemy, dRPC, Chainstack, NodeReal, Helius, and Triton explicitly meter notifications/bytes/request units. `newHeads` from those products is not an admissible zero-cost liveness reference unless the commercial contract overrides public metering. **VERIFIED [A3][D2][C2][N2][H1][R1]**
8. **Blast/Bware and LlamaNodes should not be silently recycled from historical provider lists.** Blast is officially deprecated; LlamaNodes lacks a current official RPC surface. Neither belongs in a new production failover set without new primary evidence. **VERIFIED [B1]; INFERRED [L1]**


## (c) Detection playbook

### C.1 Required health decomposition

The present system reports coverage as `heartbeat_live && active_gap.is_none()`. Because the 10-second heartbeat is stamped by the owning WS session, it can remain fresh while the remote provider is silent, and a silent stream may create no known `active_gap`. That boolean therefore proves neither remote transport responsiveness nor active subscription delivery. **[SYS]; INFERRED**

A detector that respects both hard constraints should maintain separate facts rather than compressing them prematurely:

```text
local_task_live     := owning task/session heartbeat is fresh
transport_live      := socket is open AND an RFC 6455 pong is fresh
socket_epoch        := increments on every physical connection
lease_live          := every required subscription was acknowledged in socket_epoch
known_gap           := a disconnect/reconnect or delivered-frame invariant bounds a repair interval
budget_state        := available | starved | denied
data_confidence     := observed_recent | sparse_unknown | independently_corroborated | suspected_stall

transport_coverage  := local_task_live && transport_live && lease_live
known_data_coverage := transport_coverage && !known_gap
```

`known_data_coverage=true` must not be advertised as proof that no notification was silently dropped. For a sparse filter, the honest state can be `known_data_coverage=true, data_confidence=sparse_unknown`. That distinction is essential to the silent-provider case. **INFERRED**

### C.2 Ranked detection techniques

#### 1. RFC 6455 ping/pong owned by the WS session

**Mechanism.** Send a WebSocket **control-frame Ping**, track exactly one outstanding challenge (optionally with an opaque nonce/timestamp), and require the matching or subsequent Pong within a deadline. RFC 6455 permits Ping at any time and requires a peer receiving it to send Pong as soon as practical. Ping/Pong control frames are separate from JSON-RPC messages. **VERIFIED [S1]**

**Catches.** A dead peer, severed route, many NAT/load-balancer half-opens, a remote WS stack that no longer reads frames, and cases where the kernel has not yet surfaced a close. It also creates traffic that prevents documented inactivity timeouts such as Chainstack’s one-hour limit and Helius’s ten-minute limit, provided the provider counts control frames as activity; whether a particular load balancer does so is **INFERRED and should be tested**. **VERIFIED [C1][H1]; INFERRED activity semantics**

**Cannot catch.** A provider whose TCP/WS front end answers Pings while the internal subscription dispatcher, chain backend, filter worker, or notification fan-out is stalled. It also cannot prove that a locally stored subscription id remains registered upstream. **INFERRED**

**Cost.** **ZERO-COST** under the operator definition: RFC 6455 control frames do not invoke JSON-RPC or debit provider method/notification CU. **[SYS][S1]**

**Recommended policy.** A starting policy of one Ping after 10 seconds of outbound idleness, a 10-second Pong deadline, and transport conviction only after two consecutive unanswered challenges is **INFERRED**, not a provider universal. Use monotonic time, suspend the watchdog during process stop-the-world/host sleep, and record `ping_sent_at`, `pong_at`, RTT, and close code. A close/error or unanswered Ping may trigger reconnect; it must not be translated into “provider dropped events” without later gap evidence. **INFERRED**

#### 2. Local application/session heartbeat—retain, but narrow its meaning

**Mechanism.** The existing owner stamps a heartbeat every 10 seconds. This proves that the task which owns the WS session is scheduled and making progress. **[SYS]**

**Catches.** Local task deadlock, executor starvation, a stopped session loop, or failure to update shared health state. **INFERRED**

**Cannot catch.** Any remote transport or provider failure if the task continues ticking. It specifically cannot detect the silent provider. **INFERRED**

**Cost.** **ZERO-COST** because it is local state. **[SYS]**

**Ruling.** Rename or expose it as `local_task_live`; do not call it socket liveness. An application **JSON-RPC** “heartbeat” such as Alchemy/viem `net_version` is a different technique: it is **METERED/disqualified** for this lane even if one provider charges 0 actual CU, because it is a poll/probe and can consume throughput CU. **VERIFIED [A3][A4][CL-V1]; [SYS]**

#### 3. TCP keepalive as a slow backstop

**Mechanism.** Enable OS TCP keepalive with explicit per-socket settings where supported. Linux defaults are commonly 7,200 seconds idle, 75 seconds between probes, and nine failed probes—far too slow for primary ingestion liveness unless tuned. **VERIFIED [S3]**

**Catches.** A disappeared host/path when no WebSocket traffic is flowing and the TCP stack eventually exhausts probes. **VERIFIED [S3]**

**Cannot catch.** A peer that continues acknowledging TCP segments while its application or subscription pipeline is not processing them. TCP acknowledgements establish receipt by the peer’s TCP implementation/receive path, not successful JSON-RPC dispatch or event delivery. **VERIFIED foundation [S2]; INFERRED application consequence**

**Cost.** **ZERO-COST** to provider CU; it is transport traffic. **[SYS]**

**Ruling.** Use tuned keepalive only as defense in depth behind RFC ping/pong. Keep its failure reason separate because it identifies path/peer failure, not necessarily provider-wide failure. **INFERRED**

#### 4. Subscription-cadence watchdogs—suspicion, never standalone conviction

**Mechanism.** Estimate expected inter-arrival from the actual stream. For a free pushed `newHeads` stream, compare elapsed time with a robust percentile of recent block intervals rather than a single nominal block time. For a log filter, estimate the filter’s own event rate; chain block time is not its event rate. **INFERRED**

**Catches.** Gross stalls on dense, regular streams; a single subscription that becomes unusually quiet while transport still pongs; delayed batches that create a large observed inter-arrival. **INFERRED**

**Cannot catch safely.** Sparse or bursty log streams. Under a Poisson approximation with event rate `λ`, the probability of legitimately seeing no matching event for window `T` is:

```text
P(no event in T) = exp(-λT)
```

At one event/hour, a five-minute watchdog is silent legitimately about `e^(-1/12) = 92.0%` of the time; even a 30-minute window is silent about `e^-0.5 = 60.7%`. At one event/minute, five minutes of silence is still legitimate about `e^-5 = 0.67%` of the time. The Poisson model itself is **INFERRED** and real on-chain activity is often more bursty, making naive thresholds worse. **INFERRED**

**Cost.** **ZERO-COST** when calculated only from timestamps of already delivered frames. A cadence check that asks `eth_blockNumber`, `net_version`, or `eth_getLogs` is **METERED and disqualified**. **[SYS]**

**Ruling.** Cadence may set `data_confidence=suspected_stall` and increase observability; it may not open the provider circuit for sparse filters. For freely pushed heads, it can contribute corroboration, but only if notification delivery is contractually or operationally unmetered. **INFERRED**

#### 5. Block-number and identity invariants from delivered log frames

**Mechanism.** On every delivered EVM log, record at minimum subscription/socket epoch, receive monotonic timestamp, `blockNumber`, `blockHash`, `transactionHash`, `transactionIndex`, `logIndex`, and `removed`. Standard Ethereum subscription payloads carry block identity and use `removed=true` for logs invalidated by a reorganization. **VERIFIED [S4][I3]**

Apply zero-cost predicates:

- block number must not regress unless the event is a valid reorg/removal path;
- duplicates are keyed by chain + block hash + transaction hash + log index, not by block height alone;
- first post-reconnect delivery bounds the end of the period requiring repair;
- a jump between matching logs bounds elapsed chain height but does **not** prove that intervening blocks contained matching logs;
- conflicting block hashes at the same height are reorg/fork evidence, not automatically provider corruption.

These predicates are **INFERRED operational rules** built from verified payload fields. **VERIFIED fields [S4]; INFERRED predicates**

**Catches.** Regressions, replay/duplicates, malformed ordering, post-reconnect stale delivery, reorg signals, and a bounded interval to inspect after an actual outage. **INFERRED**

**Cannot catch.** Total silence before another event arrives. It cannot prove a missed matching log merely because block numbers jump, because a filter may legitimately match no logs in the skipped blocks. **INFERRED**

**Cost.** **ZERO-COST**: all evidence is already in delivered frames. The eventual `eth_getLogs` repair is **METERED**, but repair is allowed after a confirmed reconnect/known gap and must not be used as a liveness canary. **[SYS]**

#### 6. Subscription id as a socket-bound lease

**Mechanism.** Assign each physical socket a monotonically increasing `socket_epoch`. Store every requested subscription as durable intent, but store the provider-returned id as `(socket_epoch, provider_subscription_id, acknowledged_at)`. A lease is live only after the current socket has returned a successful subscription acknowledgement. Ethereum subscription ids are tied to the connection; when the connection closes, subscriptions are removed. **VERIFIED [S4][CL-G1]**

**Catches.** Silent client-library reconnects that create a new transport without restoring every subscription; stale ids from a previous connection; partial resubscription; subscribe errors/timeouts; accidental listener loss. **VERIFIED foundation [S4][CL-R1]; INFERRED lease model**

**Cannot catch.** A provider that accepted the subscription and continues to acknowledge Pings but stopped delivering matching notifications. The id is evidence of past acknowledgement, not a continuously queryable lease token. **INFERRED**

**Cost.** Local epoch bookkeeping is **ZERO-COST**. Initial subscribe, resubscribe, renewal, and unsubscribe are **METERED** according to the provider’s model; at Alchemy they are 10 CU each, at dRPC 20 CU to subscribe, and Chainstack charges a request unit. **VERIFIED [A3][D2][C2]**

**Renewal policy.** Renew/rotate only on actual socket epoch change, failed lease acknowledgement, a documented provider lifetime/idle rule, or a low-frequency provider-specific policy justified by observed decay. A blind frequent renewal schedule burns CU and may create duplicates. “Subscribe new, atomically switch local routing after acknowledgement, then unsubscribe old” minimizes a gap when the provider permits overlapping subscriptions; this policy is **INFERRED**. 

#### 7. Independent cross-provider comparison using pushed data only

**Mechanism.** Consume an independent provider’s already-pushed, non-metered head/slot or matching-log stream and compare chain progression and delivery timestamps. Independence requires a different provider/control plane; two sockets behind the same provider/load balancer are useful for subscription-specific diagnosis but are not strong provider-wide corroboration. **INFERRED**

**Catches.** A primary provider that pongs but stops advancing while the reference continues; chain-wide versus provider-specific stalls; some selective subscription failures when both streams carry the same filter. **INFERRED**

**Cannot catch.** A common upstream/node failure shared by both services, synchronized filtering bugs, or a sparse primary filter when the reference only proves heads. Free public reference data can itself be throttled or wrong. **INFERRED**

**Cost.** **ZERO-COST** only when the reference notifications do not debit the shared meter. PublicNode is a currently verified keyless candidate on most fleet chains, including CHZ and RH, but it has no SLA and lacks HYPER. dRPC, Alchemy, Chainstack, NodeReal, Helius, and Triton public schedules meter pushes, so their heads are **METERED** and inadmissible for WS-lane liveness under the ruling. **VERIFIED [P1][P4][D2][A3][C2][N2][H1][R1]**

**Ruling.** A free pushed reference can raise or lower `data_confidence`; it should not suppress repair after the primary’s confirmed outage. Before production, verify method support, independence, and actual account billing with a short controlled test that does not expose keys. **INFERRED**

#### 8. Budget-independent circuit breakers with explicit conviction evidence

**Mechanism.** Maintain separate counters and causes:

```text
transport_failure:
  socket close/error; RFC pong deadline exceeded; TCP failure

lease_failure:
  connect succeeded but required subscribe acknowledgement failed/timed out;
  current socket_epoch lacks required subscription ids

data_suspicion:
  dense-stream cadence anomaly; delivered-frame regression/staleness

corroborated_data_failure:
  independent, pushed, unmetered reference advances while primary remains stalled

budget_starvation:
  CU acquisition denied; repair request deferred; never a provider miss
```

Only `transport_failure`, `lease_failure`, or `corroborated_data_failure` may advance endpoint conviction. `data_suspicion` may trigger logs/metrics or a planned low-frequency rotation, but not immediate provider conviction. `budget_starvation` changes repair availability and therefore confidence, but never the provider score. **[SYS]; INFERRED**

**Catches.** Repeated objective path/endpoint failures without repeating the chain-146/88888 incident where denied polls were counted as missed responses. **[SYS]**

**Cannot catch.** The information-theoretically silent provider when no independent pushed reference exists. **INFERRED**

**Cost.** State transitions are **ZERO-COST**. Reconnect and subscription acknowledgements may be **METERED**; any post-outage backfill is **METERED**. No half-open state may issue a poll. **[SYS]**

**Initial threshold policy.** Two consecutive unanswered protocol Pings may convict the **transport**; three failed connect-or-required-subscribe cycles inside a rolling minute may open the endpoint circuit; successful reconnect plus complete current-epoch lease acknowledgement may enter half-open. These numbers are **INFERRED starting values** and should be calibrated from RTT/incident distributions. They do not convict event loss.

#### 9. Provider status feeds as out-of-band enrichment

**Mechanism.** Read provider status JSON/RSS/webhook feeds in the control plane, not through the metered RPC lane. dRPC and Chainstack explicitly expose machine-readable outputs; Infura and GetBlock expose machine feeds through their status platforms. **VERIFIED [D5][C5][I7][G4]**

**Catches.** Declared regional, network, maintenance, or provider-wide incidents; useful correlation across many local sockets. **VERIFIED availability [D5][C5][I7][G4]; INFERRED correlation**

**Cannot catch.** A single subscription, account, endpoint, load-balancer shard, or selective silent data path; status can lag reality. Green status is not exculpatory. **INFERRED**

**Cost.** **ZERO-COST to the shared CU budget** because it is out of band. It is not provider-pushed chain data and may never be part of liveness conviction by itself. **INFERRED**

#### 10. Planned socket rotation as prevention, not detection

**Mechanism.** Close and recreate a socket on a provider-specific schedule only when a documented max lifetime/idle behavior or measured age-related degradation warrants it. Re-establish all leases, then run repair over the bounded disconnect interval. **INFERRED**

**Catches/prevents.** Long-lived state decay, stale load-balancer affinity, leaked client state, and providers that enforce an undisclosed lifetime—at the cost of self-created gaps. **INFERRED**

**Cannot catch.** It does not prove the old socket was silent or that the new one is complete. Aggressive fleet-wide rotation can create a reconnect storm. **INFERRED**

**Cost.** Socket control is **ZERO-COST**, but subscription recreation and repair are **METERED**. Therefore rotate gradually with jitter, never in lockstep, and never merely because a sparse filter was quiet. **[SYS]; INFERRED**

### C.3 Failure-mode coverage

The techniques deliberately prove different layers:

- **Local task dead:** local heartbeat detects it; protocol ping may stop only as a consequence. **INFERRED**
- **Cable/NAT/LB/peer dead:** RFC ping/pong is primary; TCP keepalive is secondary; close/error may arrive first. **VERIFIED foundation [S1][S3]**
- **Automatic reconnect without restored listeners:** socket/subscription epochs and complete lease acknowledgement detect it. **VERIFIED foundation [S4][CL-R1]**
- **Provider dispatcher silent but WS front end alive:** ping/TCP/local heartbeat do not detect it; dense cadence gives suspicion; independent free pushed data can corroborate. **INFERRED**
- **Sparse filter legitimately quiet:** remain `sparse_unknown`; do not convict. **INFERRED**
- **Delivered duplicate/reorg/regression:** frame identity and block invariants detect/classify after delivery. **VERIFIED foundation [S4]**
- **CU starvation:** explicit budget state detects it locally; it must never increment transport/provider misses. **[SYS]**
- **Known outage interval:** reconnect epoch plus delivered block bounds trigger metered repair; repair does not establish liveness. **[SYS]; INFERRED**

### C.4 What real clients implement

#### ethers.js v6

The current `WebSocketProvider` source handles socket messages and close, but its close/reconnect block remains a TODO/commented path; it provides no built-in protocol Ping scheduler in that provider. Production users must wrap reconnection, subscription intent, resubscription acknowledgement, and gap repair themselves. **VERIFIED [CL-E]**

**Fit:** safe from hidden `net_version` polling, but unsafe to assume automatic recovery. **INFERRED**

#### viem

Viem’s WebSocket RPC utility enables keepalive and reconnect by default. Its keepalive “ping” is a JSON-RPC `net_version` request, defaulting to a 30-second interval. Its reconnect configuration defaults to five attempts with a fixed 2-second delay, and its subscription plumbing replays subscriptions and captures replacement ids after reconnect. **VERIFIED [CL-V1][CL-V2]**

**Fit:** the reconnect/resubscribe machinery is useful; the default liveness mechanism is **METERED/disqualified** on this lane and must be disabled or replaced with RFC control-frame ping/pong. Fixed-delay retries also lack jitter. **[SYS]; INFERRED**

#### web3.js 4.x

The archived 4.x source defaults socket auto-reconnect to enabled with five attempts and a 5-second delay; pending request queues are rejected around disconnects. The subscription layer exposes explicit `resubscribe()` behavior. Source inspection does not establish a reliable universal guarantee that every active subscription is transparently restored solely because the transport reconnected, so applications should retain and verify subscription intent themselves. **VERIFIED reconnect/settings [CL-W1]; VERIFIED explicit resubscribe [CL-W2]; INFERRED guarantee boundary**

**Fit:** do not treat transport “connected” as lease coverage; add current-epoch acknowledgements. **INFERRED**

#### Alchemy SDK

The Alchemy SDK sends `net_version` every 30 seconds, waits for liveness failure, reconnects, maps logical subscriptions onto replacement physical ids, and offers resilient event delivery/backfill for temporary outages; its public docs warn that outages beyond roughly 120 blocks can still lose events. **VERIFIED [A4][A7]**

**Fit:** its resubscription and logical-id design are strong precedents. Its JSON-RPC heartbeat is disqualified here even though Alchemy labels it 0 actual CU, because it is a WS-lane probe and carries 5 throughput CU in the current table. Its proprietary backfill limit is not a substitute for the system’s own exact repair policy. **VERIFIED [A3][A7]; [SYS]**

#### Geth

Geth’s RPC client can reconnect the underlying connection for requests after transport failure, but subscriptions are connection-coupled: the Pub/Sub documentation says a connection close removes its subscriptions, and `ClientSubscription.Err()` is the application signal for an unexpected end and resubscription workflow. Current Geth WebSocket transport source sends idle protocol Pings and maintains Pong/read deadlines; current constants use a 30-second ping interval, a 5-second write deadline, and a 30-second Pong timeout. **VERIFIED [S4][CL-G1][CL-G2][CL-G3]**

**Fit:** Geth validates the separation between transport reconnect and subscription lifecycle. Its server/client codec behavior also demonstrates that RFC ping/pong is normal production transport practice. **INFERRED**

#### Rust alloy 2.1.1

Upstream alloy 2.1.1’s pubsub service reconnects, reissues pending requests, and restarts active subscriptions, with reconnect details logged at debug level. Its native WebSocket transport defaults to RFC ping after 10 seconds of outbound idleness and treats a missing Pong before the next ping interval as dead; the connector also has retry settings. **VERIFIED [CL-R1][CL-R2][CL-R3]**

The supplied deployment ground truth nevertheless says the running client sends **no protocol Pings**, while alloy silently auto-reconnects at debug and the system uses 1-second exponential backoff capped at 30 seconds. Both can be true if the deployment disables/bypasses the upstream native default, wraps a different transport, or uses configuration not visible here. This report does not choose among those explanations. **[SYS]; INFERRED**

**Fit:** instrument the effective runtime path. Emit socket epoch, Ping/Pong timestamps, reconnect reason, retry number, and each replacement subscription id at metrics/info level; do not assume a crate default is active merely because upstream source contains it. **INFERRED**

### C.5 Brief best practices and comparison to the supplied system

1. **Lifecycle state machine.** Model `Disconnected → Connecting → TransportLive → Subscribing → Covered → Suspect → Reconnecting/Repairing`; only `Covered` has a fresh Pong and complete current-epoch leases. The present heartbeat/gap boolean should remain as compatibility output but be backed by the decomposed facts. **INFERRED; [SYS]**
2. **Resubscribe after every physical reconnect.** Persist subscription *intent*, not provider ids. Await every new acknowledgement; subscription ids from the old socket are invalid. **VERIFIED [S4][CL-G1]**
3. **Exponential backoff with jitter.** Retain the supplied 1-second exponential schedule capped at 30 seconds, add full/decorrelated jitter, and reset only after a stable transport plus complete leases—not immediately on TCP open. This avoids synchronized storms like 88888. **VERIFIED pattern [H1]; system values [SYS]; INFERRED reset policy**
4. **Moderate multiplexing.** Reuse a socket to avoid needless connection/subscription setup, but cap subscriptions per socket below provider limits and divide critical streams into small failure domains. One socket per subscription maximizes reconnect/setup load; one socket for an entire fleet maximizes blast radius. Exact grouping is **INFERRED** and should reflect chain/provider caps such as Alchemy’s 1,000 subscriptions/socket and Chainstack’s 500 concurrent sockets. **VERIFIED limits [A1][C1]; INFERRED topology**
5. **Gap backfill only as repair.** After a confirmed transport/lease transition or known interval, use `eth_getLogs` in bounded ranges, deduplicate by immutable log identity, and handle reorg removals. The supplied max-50-block, one-per-second, CU-gated fallback is correctly categorized as repair; it must not be scheduled merely to prove liveness. **[SYS]; VERIFIED payload/reorg basis [S4]**
6. **Cross-provider redundancy.** Prefer a genuinely independent secondary and avoid assuming two branded endpoints have independent upstreams. A secondary stream is admissible for liveness only when pushed notifications are verified unmetered; otherwise it is paid redundancy/repair evidence, not zero-cost liveness. **INFERRED; [SYS]**
7. **Observe hidden reconnects.** Alloy’s debug-only recovery can make the application appear continuously alive while creating a real subscription epoch and repair interval. Promote structured reconnect/subscription metrics without changing source semantics. **VERIFIED behavior [CL-R1]; INFERRED observability policy**


## (d) The silent provider

### D.1 Definition

**The silent provider** is a failure state in which all of the following can be true at once:

- the TCP connection remains established;
- the WebSocket endpoint answers RFC 6455 Pings with Pongs;
- the local owning session continues its heartbeat;
- the client still holds the subscription id originally acknowledged for the current socket;
- no close/error is raised;
- no subscription notification arrives, either because no matching event occurred or because some provider-side data path silently stopped.

This is not merely a “dead socket.” It separates **transport availability** from **subscription-delivery availability**. **INFERRED**

### D.2 Indistinguishability result

Consider two worlds observed from one sparse `logs` subscription:

- **World A:** the chain produced no log matching the filter during interval `T`.
- **World B:** the chain produced one or more matching logs, but the provider’s subscription dispatcher dropped them; its WebSocket front end continued returning Pongs.

The client’s observations in both worlds are identical: fresh local heartbeat, fresh Pongs, same locally stored subscription id, and no log frames. No algorithm using only those observations can distinguish A from B. This is an information limitation, not a threshold-tuning problem. **INFERRED**

Therefore a provider-wide or filter-specific silent failure is **undetectable with certainty** unless the client gains at least one additional informative observation:

1. **an independent pushed reference** that is itself known to advance or carries the same filtered events; or
2. **a metered query/probe** that asks another data source what happened.

Option 2 is forbidden as a WS-lane liveness recommendation. It remains permissible only as repair after a confirmed outage/gap. **[SYS]; INFERRED**

### D.3 Every practical detection/mitigation option and its cost

1. **Local owning-session heartbeat — ZERO-COST.** Detects only local task progress. It cannot distinguish World A from World B. **[SYS]; INFERRED**
2. **Socket-ready state / kernel “ESTABLISHED” — ZERO-COST.** Shows local transport state only. A half-open or application-silent peer can remain apparently established. Cannot detect the silent provider. **VERIFIED foundation [S2]; INFERRED**
3. **TCP keepalive — ZERO-COST.** Eventually catches a missing network peer. A responsive TCP stack can ACK while the subscription application is stalled, so it cannot detect the canonical silent provider. **VERIFIED [S2][S3]**
4. **RFC 6455 Ping/Pong — ZERO-COST.** Best dead-path detector and required transport signal; cannot detect a front end that pongs while its backend is silent. **VERIFIED [S1]; INFERRED boundary**
5. **Close/error codes — ZERO-COST.** Conclusive transport evidence when received; the silent provider emits none by definition. **VERIFIED protocol basis [S1]**
6. **Expected-cadence watchdog from delivered timestamps — ZERO-COST.** Can flag statistical suspicion for dense streams. For sparse logs, high legitimate no-event probability prevents conviction. **INFERRED**
7. **Block/slot freshness already inside delivered logs — ZERO-COST.** Can prove a received event is stale and can reveal regressions or post-reconnect bounds. It provides no new observation until a frame arrives, so it cannot detect the final missed event followed by silence. **VERIFIED fields [S4]; INFERRED consequence**
8. **Provider subscription id retained in memory — ZERO-COST.** Proves only that the provider acknowledged a subscription in the past. There is no standard continuously renewed EVM lease token or notification sequence embedded in ordinary `eth_subscription` frames. Cannot prove current dispatcher health. **VERIFIED connection coupling [S4]; INFERRED absence/meaning**
9. **Forced resubscription/lease rotation — METERED.** May restore a lost registration and turns a latent problem into a new acknowledgement/failure, but it is remediation, not proof. A provider may acknowledge the replacement and remain silent. It can also create duplicates and a self-inflicted gap. **VERIFIED setup billing examples [A3][D2][C2]; INFERRED outcome**
10. **Scheduled socket rotation — METERED.** Preventive against stale state; each new subscription and any repair consumes budget. It cannot establish whether the old socket missed data. **INFERRED**
11. **Second subscription on another socket at the same provider — METERED unless contractually free.** If one receives the same event and the other does not, it detects a socket/subscription-specific failure. If both share the same stalled backend or both see no sparse event, it is inconclusive; it is not provider-independent. **INFERRED**
12. **Same-provider `newHeads` side channel — ZERO-COST only if provider pushes it unmetered; otherwise METERED and disqualified.** It can prove that some provider chain path advances, but it cannot prove a sparse log filter had a matching event, and it can share the same failure domain. **[SYS]; INFERRED**
13. **Independent provider’s free pushed heads/slots — ZERO-COST when truly unmetered.** Can prove that the chain advances while the primary is static. It detects provider-wide stalling but not exact missed sparse logs unless the primary’s expected event can be derived from pushed reference data. **INFERRED**
14. **Independent provider’s free pushed copy of the same log filter — ZERO-COST when truly unmetered.** Strongest admissible detector: if the secondary delivers event identity `E` and the primary does not within an allowed delay, primary delivery failure is corroborated. Common-mode failures and secondary errors remain possible. **INFERRED**
15. **Provider status JSON/RSS/webhook — ZERO-COST to shared CU.** Supports incident correlation but cannot prove per-socket or per-filter delivery and may lag. **VERIFIED availability for some providers [D5][C5][I7][G4]; INFERRED evidentiary weight**
16. **Application JSON-RPC heartbeat (`net_version`, `eth_blockNumber`) — METERED/disqualified.** It may show that a request path responds but still does not prove subscription delivery; it also violates the operator’s no-poll ruling. **VERIFIED implementations/cost [A3][A4][CL-V1]; [SYS]**
17. **Periodic `eth_getLogs` canary — METERED/disqualified as liveness.** It could reveal a log omitted from the stream, but using it periodically is exactly the forbidden poll. It is allowed only after a confirmed gap as repair. **[SYS]**
18. **Metered second-provider heads/logs — METERED/disqualified as the zero-cost liveness centerpiece.** It can add evidence but competes for the chronically contended budget. It may be purchased as explicit paid redundancy outside the ruling, not smuggled into the WS detector. **[SYS]**
19. **Provider-generated monotonic notification sequence/cursor included in each push — potentially ZERO-COST.** A gap in such a sequence would detect dropped notifications after the next push, but ordinary EVM `eth_subscription` does not standardize such a cursor and none of the reviewed providers documents one for standard logs. This is a future contract/product requirement, not a present technique. **INFERRED**
20. **End-to-end acknowledged delivery/stream replay product — METERED or contract-priced.** Products such as managed streams/gRPC replay systems may provide cursors and retention, but they are not equivalent to standard WS RPC and fall outside the zero-cost standard-subscription lane. **INFERRED**

### D.4 Cases that remain undetectable under the two hard constraints

The following cannot be resolved with certainty from one standard WS subscription while polling is forbidden:

- a provider-wide subscription fan-out stall where the WS edge continues to Pong;
- a selective dropped event on a sparse filter followed by no later event;
- a filter deregistered upstream while the old id remains only in client memory and the provider sends no error;
- a long delivery delay versus a true loss before the allowed latency bound expires;
- a common-mode failure affecting primary and “secondary” endpoints that share the same backend;
- a chain event that neither admissible pushed reference nor the primary delivered.

For these cases, the correct state is **unknown/suspected**, not “healthy” and not “provider convicted.” Certainty requires independent pushed evidence or a metered query. **INFERRED**

### D.5 Operational answer

The cheapest reliable stack is:

1. RFC ping/pong to prove transport;
2. current-socket subscription acknowledgements to prove registration;
3. delivered-frame block/log invariants to bound and classify what is actually observed;
4. an independent, unmetered pushed duplicate stream where certainty about silent loss is required;
5. metered `eth_getLogs` only after a real reconnect/known gap to repair.

Without step 4, the system can be highly reliable against dead sockets and honest about uncertainty, but it cannot be **sure** that a ponging sparse subscription did not miss an event. **VERIFIED foundations [S1][S4]; INFERRED conclusion**

## (e) Ranked recommendations

Each item is ranked by fit to **Constraint 1 (C1: no WS-lane polls)**, **Constraint 2 (C2: protect the 800-CU/s budget)**, and the supplied architecture.

### 1. Activate and instrument effective RFC 6455 Ping/Pong in the owning WS session

**Evidence:** **VERIFIED** protocol and upstream-client practice; interval/threshold policy **INFERRED**. [S1][CL-G3][CL-R2]  
**Cost:** **ZERO-COST.**  
**C1 fit:** Perfect—no JSON-RPC method.  
**C2 fit:** Perfect—no CU debit.  
**Architecture fit:** Highest. The current 10-second session heartbeat can schedule/observe the protocol watchdog, but the metrics must separately expose `local_task_live` and `transport_live`. Because upstream alloy 2.1.1 contains a default native Ping while the deployment ground truth says no Pings are sent, first instrument the effective runtime path rather than assuming the default is active. **[SYS]; INFERRED**

### 2. Introduce socket epochs and explicit subscription-lease acknowledgements

**Evidence:** **VERIFIED** that subscription ids are connection-bound and alloy/Alchemy rebuild subscriptions; lease abstraction **INFERRED**. [S4][A7][CL-R1]  
**Cost:** Local epoch tracking **ZERO-COST**; subscribe/resubscribe **METERED**.  
**C1 fit:** Perfect—no head poll.  
**C2 fit:** Strong—spend occurs only on initial connection/recovery, not periodically.  
**Architecture fit:** Highest. Coverage must wait until every required filter has a provider-returned id for the current physical socket. A silent alloy reconnect at debug level must create a visible epoch transition and repair boundary. **[SYS]; INFERRED**

### 3. Split local, transport, lease, data-gap, and budget health

**Evidence:** **INFERRED** architecture, compelled by the supplied failure history.  
**Cost:** **ZERO-COST.**  
**C1 fit:** Perfect.  
**C2 fit:** Perfect.  
**Architecture fit:** Highest. Replace the semantic overload of `heartbeat_live && active_gap.is_none()` with decomposed facts while preserving a compatibility aggregate. A budget denial changes `budget_state`, never transport or provider conviction. The prior chain-146/88888 failure becomes structurally impossible if counters are type-separated. **[SYS]**

### 4. Make delivered-log identity/block invariants the only zero-cost data-gap evidence from the primary stream

**Evidence:** **VERIFIED** payload fields; predicates **INFERRED**. [S4][I3]  
**Cost:** **ZERO-COST.**  
**C1 fit:** Perfect.  
**C2 fit:** Perfect.  
**Architecture fit:** Very high. Feed block number/hash/log identity into gap tracking. Treat block jumps on sparse filters as a repair bound or observation interval—not automatic proof of missing logs. Preserve `removed` handling for reorgs. **INFERRED**

### 5. Make circuit-breaker conviction budget-independent and evidence-typed

**Evidence:** **INFERRED**, directly motivated by supplied incidents.  
**Cost:** Decision logic **ZERO-COST**; reconnect/subscription setup may be **METERED**.  
**C1 fit:** Perfect when half-open uses connect + subscribe acknowledgement only.  
**C2 fit:** Very high because denial cannot self-amplify into a reconnect storm.  
**Architecture fit:** Very high. Only close/error, expired Pong, failed current-epoch lease, or independent pushed divergence can add conviction. Cadence anomaly is suspicion; `DENIED` is budget starvation. **[SYS]**

### 6. Promote alloy reconnect/resubscribe events from hidden debug behavior to structured metrics

**Evidence:** **VERIFIED** upstream reconnect/restart behavior; observability policy **INFERRED**. [CL-R1][CL-R2]  
**Cost:** **ZERO-COST** except normal recovery setup.  
**C1 fit:** Perfect.  
**C2 fit:** Strong.  
**Architecture fit:** Very high. Emit endpoint/chain, old/new socket epoch, close/error cause, retry, delay, subscription intent count, acknowledgement count, replacement ids (hashed/redacted if desired), first post-reconnect block, and repair range. No endpoint URL or key should enter logs. **INFERRED**

### 7. Retain exponential reconnect, add full/decorrelated jitter, and reset only after complete leases

**Evidence:** Backoff/reconnect practice **VERIFIED** in provider/client guidance; exact policy **INFERRED**. [H1][Q3][CL-R1]  
**Cost:** Waiting is **ZERO-COST**; each reconnect/resubscribe can be **METERED**.  
**C1 fit:** Perfect.  
**C2 fit:** High—jitter reduces synchronized subscribe/backfill demand.  
**Architecture fit:** High. Keep the supplied 1-second start and 30-second cap; randomize each delay and avoid resetting on a bare TCP open. Reset after a stable Pong and complete subscription acknowledgements. **[SYS]; INFERRED**

### 8. Keep `eth_getLogs` strictly repair-only and prioritize it separately from liveness

**Evidence:** **VERIFIED** standard recovery need/payload semantics; system policy **[SYS]**. [S4][A7]  
**Cost:** **METERED.**  
**C1 fit:** Compliant only after confirmed disconnect/reconnect or a known gap; disqualified as periodic health probe.  
**C2 fit:** Moderate—necessary spend, already CU-gated.  
**Architecture fit:** High. Continue bounded 50-block calls and one-per-second gating, but add a repair queue whose denial extends `repair_pending` without affecting provider health. Deduplicate and reorg-handle deterministically. **[SYS]; INFERRED queue semantics**

### 9. Use cadence only as a statistically calibrated suspicion channel

**Evidence:** **INFERRED**, including Poisson approximation.  
**Cost:** **ZERO-COST** from delivered timestamps.  
**C1 fit:** Perfect if it issues no query.  
**C2 fit:** Perfect.  
**Architecture fit:** Medium-high. Maintain per-filter empirical inter-arrival distributions and label sparse streams `sparse_unknown`. Never map two absent expected events to provider failure. The supplied two-missed-head scheme must not return in another form. **[SYS]**

### 10. Add an independent unmetered pushed reference where the business requires silent-loss detection

**Evidence:** Provider availability **VERIFIED** for PublicNode; independence/evidentiary design **INFERRED**. [P1][P2][P4]  
**Cost:** **ZERO-COST to shared CU** only after verifying no notification meter; operational bandwidth remains.  
**C1 fit:** Perfect—push only.  
**C2 fit:** High—no shared CU, though a free service may throttle.  
**Architecture fit:** Medium. PublicNode presently covers ETH, BASE, BSC, ARB, POLY, AVAX, SONIC, CHZ, RH, and SOL but not HYPER. Use its heads to corroborate progression or duplicate exact log filters where supported. Never treat it as an SLA or sole source. **VERIFIED coverage [P1][P2][P3]; INFERRED use**

The existing Ethereum `head_source=stream` is admissible for liveness only if its notifications are genuinely unmetered. The other nine chains’ polled heads may continue for non-WS functions, but their success, denial, or absence must not convict the WS lane. **[SYS]; INFERRED**

### 11. Use provider-specific lease/socket rotation only where justified

**Evidence:** **VERIFIED** for documented inactivity limits; generic rotation policy **INFERRED**. [C1][H1]  
**Cost:** **METERED** subscription recreation and possible repair.  
**C1 fit:** Compliant—no polling.  
**C2 fit:** Medium/low if frequent.  
**Architecture fit:** Medium. Chainstack’s one-hour inactivity and Helius’s ten-minute inactivity should normally be handled by RFC control traffic; rotate only if tests show control frames do not reset the provider’s timer or if observed age-related failures justify it. Stagger rotations. **INFERRED**

### 12. Use status feeds only to annotate and route incidents

**Evidence:** **VERIFIED** availability for selected providers; evidentiary use **INFERRED**. [D5][C5][I7][G4]  
**Cost:** **ZERO-COST to shared CU.**  
**C1 fit:** Perfect.  
**C2 fit:** Perfect.  
**Architecture fit:** Medium. A red provider/chain component can accelerate failover or explain correlated failures; green status never clears a local transport/lease failure and never proves event completeness. **INFERRED**

### 13. Choose socket grouping by blast radius, not a universal “one socket” rule

**Evidence:** Provider caps **VERIFIED**; grouping recommendation **INFERRED**. [A1][C1]  
**Cost:** More sockets are often **ZERO-COST** until caps, but each duplicated subscription/notification can be **METERED**.  
**C1 fit:** Perfect.  
**C2 fit:** Medium—over-sharding increases setup/duplicate costs; over-multiplexing increases correlated loss.  
**Architecture fit:** Medium. Group a modest number of filters per chain/provider/socket, isolate very high-volume or critical filters, and stay well below documented caps. Do not open one socket per filter by default. **INFERRED**

### Explicitly disqualified designs

- `eth_blockNumber`, `net_version`, `net_listening`, `getSlot`, or any JSON-RPC call as a periodic WS heartbeat—**METERED/disqualified**. **[SYS]**
- periodic `eth_getLogs` to discover whether the stream missed anything—**METERED/disqualified as liveness**; allowed only as repair. **[SYS]**
- metered `newHeads` merely because it is push—**METERED/disqualified** unless a contract makes notifications unmetered. **[SYS]**
- counting CU acquisition denial, rate-limit denial, queue timeout, or skipped poll as a provider miss—**disqualified**. **[SYS]**
- convicting a sparse `logs` subscription after a fixed number of expected blocks with no event—**disqualified by false-positive ambiguity**. **INFERRED**
- treating a fresh local heartbeat, open TCP state, successful Pong, old subscription id, or successful automatic reconnect as proof of delivered-event completeness—**disqualified**. **VERIFIED foundations [S1][S2][S4]; INFERRED conclusion**
- relying on a status page’s green state as proof that one socket/filter works—**disqualified**. **INFERRED**
- synchronized reconnect/rotation across chains/providers—**disqualified operationally** because it recreates storm risk and correlated CU demand. **[SYS]; INFERRED**

### Final fit verdict

The highest-value, lowest-cost change is not another chain query. It is to turn transport and subscription state into explicit evidence: **RFC Pong freshness + current-socket lease acknowledgements + delivered-frame invariants + a budget-independent breaker**. That stack catches dead sockets, half-open paths, failed resubscriptions, and known gaps without spending liveness CU. **VERIFIED foundations [S1][S4][CL-R1]; INFERRED system design**

It still cannot guarantee that a ponging provider did not silently omit a sparse event. For that guarantee, mirror the same subscription through an independent, unmetered pushed source; where none exists, report `sparse_unknown` and reserve metered queries for repair. Any stronger claim would be false. **INFERRED**


## (f) Sources

All provider facts were checked against current official pages or upstream source available on 2026-09-04. URLs below intentionally omit API keys and keyed endpoint URLs.

### System ground truth

- **[SYS]** User-supplied authoritative “Our system” description and binding operator rulings, dated 2026-09-03/04. No external URL.

### Protocol and node semantics

- **[S1]** IETF, *RFC 6455 — The WebSocket Protocol* (Ping/Pong control frames, close behavior): https://www.rfc-editor.org/rfc/rfc6455
- **[S2]** IETF, *RFC 9293 — Transmission Control Protocol (TCP)* (TCP acknowledgement/transport semantics): https://www.rfc-editor.org/rfc/rfc9293
- **[S3]** Linux kernel, *IP Sysctl — TCP keepalive settings*; supplementary `tcp(7)` manual: https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html and https://man7.org/linux/man-pages/man7/tcp.7.html
- **[S4]** Geth, *Real-time Events / JSON-RPC Pub/Sub* (connection-coupled subscriptions, buffers, log payload/reorg semantics): https://geth.ethereum.org/docs/interacting-with-geth/rpc/pubsub

### Alchemy

- **[A1]** *Subscription API Overview* (methods, billing basis, socket/subscription/request limits): https://www.alchemy.com/docs/reference/subscription-api
- **[A2]** *Chain API supported chains* and subscription endpoints: https://www.alchemy.com/docs/reference/node-supported-chains and https://www.alchemy.com/docs/reference/subscription-api-endpoints
- **[A3]** *Compute Unit Costs* (`net_version`, `eth_subscribe`, `eth_unsubscribe`, `eth_getLogs`, 0.04 CU/byte notifications): https://www.alchemy.com/docs/reference/compute-unit-costs
- **[A4]** *Do WebSockets need a ping to stay alive with Alchemy?* (30-second SDK `net_version`; server-originated Pings): https://www.alchemy.com/support/what-s-the-right-way-for-the-client-to-send-a-ping-to-alchemy
- **[A5]** *Pricing Plans*: https://www.alchemy.com/docs/reference/pricing-plans
- **[A6]** *Best Practices for Using WebSockets in Web3*: https://www.alchemy.com/docs/reference/best-practices-for-using-websockets-in-web3
- **[A7]** Alchemy SDK source and SDK documentation (heartbeat/reconnect/logical subscriptions/backfill): https://github.com/alchemyplatform/alchemy-sdk-js/blob/master/src/api/alchemy-websocket-provider.ts and https://github.com/alchemyplatform/alchemy-sdk-js/blob/master/docs-md/README.md
- **[A8]** Alchemy public status: https://status.alchemy.com/

### QuickNode

- **[Q1]** QuickNode current documentation index / chain catalog: https://www.quicknode.com/docs/llms.txt
- **[Q2]** Ethereum `eth_subscribe` reference: https://www.quicknode.com/docs/ethereum/eth_subscribe
- **[Q3]** *How to Manage WebSocket Connections With Your Ethereum Node Endpoint* (client ping/reconnect example): https://www.quicknode.com/guides/infrastructure/how-to-manage-websocket-connections-on-ethereum-node-endpoint
- **[Q4]** QuickNode pricing/plans: https://www.quicknode.com/pricing
- **[Q5]** QuickNode public status: https://status.quicknode.com/
- **[Q6]** QuickNode trust center: https://trust.quicknode.com/

### Infura

- **[I1]** Infura endpoint/network index: https://docs.infura.io/get-started/endpoints/
- **[I2]** *Subscribe to events* (WSS, subscribe/unsubscribe billing, silent failures): https://docs.infura.io/how-to/subscribe-to-events/
- **[I3]** Base `eth_subscribe` reference (types, ids, 5-credit example, reorg semantics): https://docs.infura.io/reference/base/json-rpc-methods/subscription-methods/eth_subscribe/
- **[I4]** Infura pricing: https://www.infura.io/pricing
- **[I5]** Infura rate-limit guidance: https://docs.infura.io/how-to/avoid-rate-limiting/
- **[I6]** MetaMask/Infura, *How to keep WebSocket alive*: https://support.metamask.io/develop/building-with-infura/javascript-typescript/how-to-keep-websocket-alive/
- **[I7]** Infura status, history, and feeds: https://status.infura.io/

### Ankr

- **[K1]** Ankr Web3 API overview and public/freemium/premium headline limits: https://www.ankr.com/web3-api/
- **[K2]** Ankr *Service plans* (HTTPS-only free tiers; premium WSS; 200-credit EVM subscription, 100-credit non-Solana notification, 500-credit Solana notification): https://www.ankr.com/docs/rpc-service/service-plans/
- **[K3]** Ankr *SLA & service reliability* (best-effort/Premium/Enterprise commitments): https://www.ankr.com/docs/rpc-service/sla/
- **[K4]** Ankr chain catalog, including Chiliz and Sonic: https://www.ankr.com/rpc/ , https://www.ankr.com/rpc/chiliz/ , and https://www.ankr.com/rpc/sonic/

### dRPC

- **[D1]** dRPC architecture/service overview: https://drpc.org/docs/howitworks/overview
- **[D2]** *Subscriptions for EVM Chains* (20 CU subscribe; 20 CU/notification; types): https://drpc.org/docs/pricing/subscriptions/evm
- **[D3]** *Solana WebSocket Subscriptions* (methods and 20-CU accounting): https://drpc.org/docs/pricing/subscriptions/solana
- **[D4]** dRPC rate limiting/free plan: https://drpc.org/docs/howitworks/ratelimiting
- **[D5]** dRPC public status with JSON/webhook/RSS outputs: https://status.drpc.org/

### Chainstack

- **[C1]** *Handle real-time data using WebSockets* (one-hour inactivity, 500 concurrent WS, reconnect): https://docs.chainstack.com/docs/handle-real-time-data-using-websockets-with-javascript-and-python
- **[C2]** *Request units*: https://docs.chainstack.com/docs/request-units
- **[C3]** Chainstack pricing/plan limits: https://chainstack.com/pricing/
- **[C4]** Chainstack Enterprise support/SLA: https://chainstack.com/enterprise-support-sla/
- **[C5]** Chainstack status and documented public API: https://status.chainstack.com/ and https://status.chainstack.com/public-api
- **[C6]** Chainstack protocol/tooling catalog: https://docs.chainstack.com/
- **[C7]** Solana methods and `blockSubscribe` billing note: https://docs.chainstack.com/docs/solana-methods and https://docs.chainstack.com/docs/solana-blocksubscribe-1009-error-on-websocket

### PublicNode

- **[P1]** PublicNode chain directory and keyless HTTP/WSS endpoints: https://publicnode.com/
- **[P2]** PublicNode Chiliz page (WSS and observed average block time): https://chiliz.publicnode.com/
- **[P3]** PublicNode Solana page: https://solana.publicnode.com/
- **[P4]** PublicNode terms (best-effort/as-is and mutable limits): https://www.publicnode.com/terms

### Blast/Bware and LlamaNodes

- **[B1]** Blast API official deprecation/migration notice: https://blastapi.io/
- **[L1]** Former LlamaNodes domain, which no longer exposes a current RPC provider surface as of the research date: https://llamanodes.com/ — operational unavailability is **INFERRED** because no official shutdown notice was found.

### GetBlock

- **[G1]** GetBlock node/chain catalog, including protocol availability: https://getblock.io/nodes/
- **[G2]** GetBlock pricing and current plan model: https://getblock.io/pricing/
- **[G3]** GetBlock SLA (shared/dedicated/load-balanced commitments): https://getblock.io/sla/
- **[G4]** GetBlock public status: https://status.getblock.io/

### NodeReal

- **[N1]** NodeReal pricing: https://nodereal.io/pricing
- **[N2]** NodeReal compute-unit costs (`eth_subscribe`, notification bytes): https://docs.nodereal.io/docs/compute-units-cus
- **[N3]** MegaNode FAQ and API FAQ (HTTPS/WSS; no stated WSS/app connection cap): https://docs.nodereal.io/docs/faq and https://docs.nodereal.io/docs/technical-questions
- **[N4]** NodeReal API overview/public-key constraints and WSS network table: https://docs.nodereal.io/reference/getting-started-with-your-api
- **[N5]** NodeReal MegaNode uptime marketing/custom SLA: https://nodereal.io/meganode

### Tenderly

- **[T1]** Tenderly pricing: https://tenderly.co/pricing
- **[T2]** Tenderly Node product/network/SLA page: https://tenderly.co/products/node
- **[T3]** Tenderly public status: https://status.tenderly.co/

### Helius

- **[H1]** Helius *LaserStream WebSocket* (full standard Solana methods, `blockSubscribe`, metering, inactivity, keepalive/reconnect examples): https://www.helius.dev/docs/rpc/websocket
- **[H2]** Helius plans: https://www.helius.dev/docs/billing/plans
- **[H3]** Helius status-page documentation: https://www.helius.dev/docs/support/status-page

### Triton One

- **[R1]** Triton One Solana RPC pricing/streaming model: https://triton.one/pricing
- **[R2]** Triton open-source/Whirligig page: https://triton.one/open-source
- **[R3]** Triton One service overview/reliability claims: https://triton.one/

### Client-library and node source

- **[CL-E]** ethers.js v6 `WebSocketProvider` source: https://github.com/ethers-io/ethers.js/blob/main/src.ts/providers/provider-websocket.ts
- **[CL-V1]** viem WebSocket RPC source (`net_version` keepalive): https://github.com/wevm/viem/blob/main/src/utils/rpc/webSocket.ts
- **[CL-V2]** viem socket/reconnect/resubscription source: https://github.com/wevm/viem/blob/main/src/utils/rpc/socket.ts
- **[CL-W1]** web3.js 4.x socket-provider source (auto-reconnect settings): https://github.com/web3/web3.js/blob/4.x/packages/web3-utils/src/socket_provider.ts
- **[CL-W2]** web3.js subscription source: https://github.com/web3/web3.js/blob/4.x/packages/web3-core/src/web3_subscriptions.ts
- **[CL-G1]** Geth RPC subscription source: https://github.com/ethereum/go-ethereum/blob/master/rpc/subscription.go
- **[CL-G2]** Geth RPC client source: https://github.com/ethereum/go-ethereum/blob/master/rpc/client.go
- **[CL-G3]** Geth WebSocket transport source: https://github.com/ethereum/go-ethereum/blob/master/rpc/websocket.go
- **[CL-R1]** alloy 2.1.1 pubsub service/reconnect source: https://github.com/alloy-rs/alloy/blob/v2.1.1/crates/pubsub/src/service.rs
- **[CL-R2]** alloy 2.1.1 native WebSocket transport/Ping source: https://github.com/alloy-rs/alloy/blob/v2.1.1/crates/transport-ws/src/native.rs
- **[CL-R3]** alloy 2.1.1 release tag/source tree: https://github.com/alloy-rs/alloy/tree/v2.1.1

---

**Bottom line:** ping/pong can make dead-socket detection cheap and reliable; socket-bound subscription leases can make reconnect recovery explicit; delivered log metadata can make known gaps bounded. None of those can prove that a ponging provider did not silently omit a sparse event. That last guarantee requires an independent pushed duplicate or a metered query, and the latter is excluded from WS-lane liveness by design. **VERIFIED foundations [S1][S4]; INFERRED conclusion**
