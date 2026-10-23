# Gringott AIS adapter

## Scope

This implements the independently hosted **Gringott synthetic mock** only. It is not the cancelled `feature/mock-banks` implementation and does not implement TBC or BOG. Existing health availability monitoring remains separate.

Architecture:

```
UI / authenticated API -> common AIS service -> adapter registry -> Gringott adapter -> fixed-origin HTTP transport
Audit worker -> Gringott capture -> redacted observations + raw sample timings -> contract checks + approved source checks -> existing reports
```

Code boundaries:

- `adapters/http-transport.mjs`: absolute request deadlines, cancellation, request UUIDs, fixed origin, no redirect following/retries, 1 MB response cap, safe evidence capture.
- `adapters/gringott.mjs`: simulated consent/code/token flow, accounts and balances, explicit transaction conversion, bounded offset pagination.
- `adapters/registry.mjs`: trusted operator configuration and idempotent scoped connection registration. No browser-supplied request URLs or private-network exemptions for real banks.
- `adapters/common-ais.mjs`: owner/tenant/connection/account-scoped interactive mock consents. Tokens are held only in memory, never returned to a browser or persisted in audit evidence. Restart requires new consent.
- `adapters/gringott-audit.mjs`: actual HTTP capture and independent lifecycle/pagination/contract findings. No administrative defect switches are invoked by an audit.
- `engine.mjs`: persists captured packs, uses the ruleset snapshot from run start, evaluates only approved profile rules, and retains original response evidence separately from normalized data.

## Configuration

Existing Gringott monitoring configuration is reused, so the deployed target `id: gringott` enables this adapter after rebuilding the backend:

```json
[{"id":"gringott","name":"Gringott mock","origin":"http://gringott:4173","tenant":"bank-demo","adminKeyFile":"/run/secrets/gringott-admin.key"}]
```

Variable: `GEOBRIDGE_MOCK_TARGETS`. For another instance of the SAME Gringott implementation, provide a different unique id and explicit `adapter: gringott-mock-v1`. Other banks require their own implementation; changing an id does not make an arbitrary API compatible.

`GEOBRIDGE_GRINGOTT_TIMEOUT_MS`: default 2000, allowed 200–10000. It is a chosen test budget, not a regulatory latency threshold. Optional locally:

```powershell
$env:GEOBRIDGE_MOCK_TARGETS='[{"id":"gringott","origin":"http://127.0.0.1:4173","tenant":"bank-demo"}]'
node src/server.mjs
```

Existing users/rules/runs are preserved. Startup adds/updates the configured `mock-gringott` connection and refuses existing id/tenant/adapter conflicts. Configuration does not mark any normative rule approved. Real bank connections remain blocked. Health reports `bankConnections: mock_only`, `realBankConnections: not_configured` when this adapter is configured.

## UI walkthrough

1. Sign in as operator or bank engineer -> Connections -> Gringott -> **Run Gringott HTTP audit**. Audit center's bank mode also executes the configured adapter.
2. Open completed results and a finding's original redacted evidence. Findings/Quality/JSON/CSV exports work through existing report routes.
3. Initially, source-linked XS2A rules remain NEEDS_REVIEW. An authorized standards reviewer must inspect profile/source applicability before approval. A successful contract check is not a standards certification. Gringott's payment accounts must NOT be judged against the separate loan/deposit profile just because those fields exist in the rule catalog.
4. To demonstrate failures, use Gringott's admin console to enable repeated pagination, revoked consent bypass or malformed errors. Retest. Disable faults and retest again; original failed runs remain in history. Audit never resets global mock state or changes faults silently.
5. As operator or TPP -> TPP explorer -> **Grant simulated consent** -> request accounts, balances or all transaction pages -> revoke consent. Upstream tokens stay private; the client receives only an opaque GeoBridge consent reference.
6. A scheduled `bank` audit for this configured connection collects fresh synthetic observations; readiness checks for unconfigured connections remain blocked.

## Evidence and metrics

Collected responses are tagged `mock_http`, adapter version, connection, profile, timestamps, UUIDs, selected response headers, raw body hash (except sensitive authorization material), redacted JSON body and measured HTTP duration. OpenAPI response is captured and its hash retained. Codes, tokens, authorization headers and sensitive authorization-response hashes are omitted. A hash is a correlation/integrity aid, not proof of bank provenance.

Account/balance/transaction requests are positive samples. Unauthenticated, unknown-account and post-revocation requests are negative samples. Consent setup/token/revocation/OpenAPI calls are setup samples. Setup and expected negative probes do not inflate positive reliability or latency metrics. Positive HTTP success does not mean all mapping/semantic checks passed; read findings separately. p95 remains withheld below the existing 20-successful-sample threshold. Same-host timings do not establish real-bank quality or monthly uptime. Availability history is its own report.

## Reliability and limits

- 45-second whole audit budget; at most 80 requests, 10 accounts, 20 transaction pages/account, declared total at most 1000. Page size 2 deliberately exercises pagination in the small fixture.
- Refuse repeated IDs, non-advancing/wrong offsets, changing totals, unknown booking status, missing fields and imprecise numeric amounts. Never fill in missing currency or silently drop transaction categories.
- No automatic retries: failures remain measurable. Real-bank adapters need method-specific retry/idempotency/quota policies rather than generic POST retries.
- Interactive requests have a 15-second whole-operation limit and the per-request deadline. At most 500 active/pending consents globally and 10 per user. Interactive tokens live at most 15 minutes, are scoped to their owner/tenant/connection/account set, and are rechecked against upstream consent status before reads. Local revocation invalidates access even if the mock's injected bypass is active.
- Controlled security auditing intentionally uses the still-known upstream token after revocation to detect that bypass. That test path is distinct from the common API's access control.
- Audit attempts cleanup after failure, but forced worker termination, process death or a network outage cannot guarantee upstream revocation. Synthetic upstream consent/token expiry or an explicit mock reset handles orphaned state. No real customer credentials are involved.
- Mock-only results never establish publication readiness: release gate remains HOLD unless independent real-bank evidence and reviewed coverage exist.

## Tests

`node --test tests/gringott-adapter.test.mjs` runs standalone unit/HTTP transport tests.

`GRINGOTT_TEST_ROOT` points at a checkout of `takoshonia/gringott-sandbox`. Locally the integration test defaults to `untracked/gringott-sandbox`; without either fixture it explicitly skips. CI should check out that separate repository into a fixture directory and set the variable. The fixture may be private and needs an appropriately scoped read token; do not embed one in the test.

`node --test tests/gringott-integration.test.mjs` starts real disposable mock + GeoBridge processes, checks consent/revocation, full pagination, tenant/owner/account/role restrictions, source-review gating, reports, secret omission, fault detection, run comparison, cancellation and restart persistence. It does not use the deployed database or reset the hosted mock.

## Deployment

Back up the existing database. Rebuild GeoBridge from this feature's commit, preserving the volume, origin, existing environment, secret mounts, private Docker network and Caddy/Vercel routing. No Gringott redeployment is required. Keep the previous container for rollback. Verify health, login, configured connection, audit/report exports and interactive consent. All health-monitoring history remains in the same SQLite volume.
