# Mock quality suite and comparison

## Scope

`Mock comparison` is a separate page for Operator and NBG Reviewer. It compares selected synthetic mock assertions and one fixed sequential balance workload. It is not a real-bank ranking, regulatory certification, penetration test, production uptime assessment or SLA. Existing `Compare runs` retains its same-connection regression semantics.

Bank engineers can select `Run quality suite` in Audit center for their own configured mock only. Their audit/report remains tenant-scoped. TPP has no comparison, audit or fault-control access.

## Reproducible client plan

Suite `mock-quality-1` captures the existing accounts, balances, pagination, error-format, missing-token, unknown-account and revoked-consent checks. It adds invalid bearer-token and unknown consent-identifier probes where supported. Controlled expired tokens and restricted-account consents are explicitly not assessed, rather than inferred from an invalid-token check. The Gringott adapter does not send an independent Consent-ID header, so that probe is not assessed there.

The performance workload chooses the first discovered account and makes 3 warm-up plus 30 measured balance requests. Client concurrency is 1, transport timeout is 2000 ms, suite deadline is 90 seconds, and request budgets are bounded. Five consecutive failures stop sampling. Created consents are revoked in finally blocks; unsuccessful cleanup is recorded.

A valid measured response must return HTTP 200 and map into a nonempty common balances representation. HTTP/network/mapping failures, timeouts and 429 responses remain failures; there are no automatic retries. Warm-up, authorization and negative probes do not enter the dedicated workload metrics. Generic audit metrics may also include the ordinary functional probes; use the separately saved quality measurements for comparisons.

Demo defaults: minimum valid response rate 95%, maximum successful-request p95 500 ms. Users can configure rate 90-100% and p95 50-10000 ms. These are project demo criteria, not NBG requirements. Percentiles use successful samples only and p95 is unavailable below 20 successes. A passing verdict requires the full workload. An early-stopped reliability workload can fail if its observed failures already exceed the entire planned error budget; otherwise it remains unassessed.

## Comparability

A comparison key pins suite version and definition hashes, policy, client plan, declared runner environment, profile, normalized balance shape (count, currency and balance type), and raw response-size band. Changed balance shape or incomplete sampling removes eligibility. The runner environment can be labelled with GEOBRIDGE_BENCHMARK_ENVIRONMENT.

The response-size band is a coarse power-of-two bound, not identical bytes or an identical dataset. Infrastructure, geography and background load are not independently controlled. Matching groups mean compatible recorded workloads only. Different groups remain visible as descriptive measurements with `Comparison limited`; there is no fastest-bank leaderboard or composite trust score. Compatibility/security cells summarize mock-suite observations, not certification or independent requirement counts. Draft standard decisions remain in the individual reports.

## Execution and evidence

POST /api/mock-comparisons validates 2-5 distinct configured targets and policy, checks reviewer/operator authorization, and atomically creates a batch and tenant-owned audit jobs. A caller-generated requestId provides idempotency and rejects reused IDs with changed settings. The existing worker processes jobs sequentially. Restarted jobs are marked interrupted and incomplete comparisons stay limited. Bank accounts cannot fetch cross-bank batch data.

Quality evidence and policy are included in immutable saved report snapshots and rendered in a dedicated report section. Historical saved reports are not changed. Each comparison row links to the full audit and its saved report. No provider call is needed for measurements or verdicts.

## Controlled demonstration

Operator-only controls appear when a configured BOG or Gringott synthetic target has a private admin key. They allow only slowResponse or revokedConsentBypass. TBC has no supported administration control in this feature. Admin credentials and raw administration state are never returned to the browser.

1. Run the comparison as a healthy baseline.
2. Open Operator demo controls and enable one fault for five minutes.
3. Rerun with the same policy. Inspect the changed layer and original audit evidence.
4. Restore the selected fault and rerun to demonstrate recovery.

Changes affect other users of that mock; the UI asks for confirmation. Restoration intent is persisted before mutation, with a 60-600 second TTL (UI: 300 seconds). Expired controls restore after restart too. Failed restoration stays pending and retries every ten seconds. A flag already enabled outside GeoBridge is not overwritten. Turning off an unowned flag does nothing. Do not share Operator credentials with jury participants.

Known GeoBridge demo-control state is recorded before and after each suite. If controls change or expire during the suite, comparison eligibility is removed and otherwise-passing performance assessments become unassessed. External mock changes cannot be detected by this bookkeeping and remain a limitation.
