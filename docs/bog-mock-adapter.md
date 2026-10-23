# BOG-style independent mock adapter

Source: https://github.com/Barbare997/bog-mock-sandbox. This is an unofficial synthetic simulator, not Bank of Georgia's sandbox or evidence about the real bank. Its OpenAPI contracts are authored documentation-derived mock contracts. The GeoBridge integration covers legacy `/v1` payment-account AIS only, using the existing `xs2a-0.8` profile. Payments, cards, extended AIS and loan/deposit routes are not enabled by this adapter.

## Configuration and hosting

Clone the mock separately, build its Dockerfile and run it on the shared private `geobridge-mocks` network with alias `bog-mock`. Bind its host port only to `127.0.0.1:4183`. Use the supplied unprivileged image, read-only root filesystem, capability dropping and a bounded memory limit. The mock has no persistent customer database; synthetic state resets on restart. No additional paid server is required by this setup.

Append to `GEOBRIDGE_MOCK_TARGETS`, preserving existing entries:

```json
{"id":"bog","name":"BOG independent mock","adapter":"bog-mock-v1","origin":"http://bog-mock:4183","tenant":"bank-demo","adminKeyFile":"/run/secrets/bog-admin.key"}
```

Mount the mock's private admin key read-only into GeoBridge at that path. Without adminKeyFile the adapter and monitoring still work, but GeoBridge cannot switch mock availability. The mock requires `X-BOG-Mock-Admin-Key`; the shared monitor selects that header for this adapter, retaining Gringott's separate header. Health uses `GET /api/health`, HTTP 200 with status=ok. Configure monitoring explicitly in Monitoring; installation does not invent uptime before the first probe.

`GEOBRIDGE_BOG_MOCK_TIMEOUT_MS` defaults to 2000 (allowed 200–10000). The audit budget is 45 seconds, with 80 requests maximum. These are chosen testing limits, not regulatory thresholds. The mock's default slow-response defect adds 1200 ms, so it can increase observed latency without necessarily exceeding the default timeout.

For a public mock console, terminate TLS at Caddy and set `BOG_MOCK_PUBLIC_ORIGIN` to that exact HTTPS origin. Also allowlist `http://bog-mock:4183/callback` in `BOG_MOCK_REDIRECT_URIS` for the internal adapter's callback validation. The callback is validated but never followed over HTTP by the adapter. Console administration remains key-protected. Retrieve the key only in your server terminal and paste it into the console's Fault lab; do not commit it or send it in chat.

## Authorization and data boundaries

The adapter creates a **non-recurring** synthetic all-account consent to avoid expiring a different user's recurring consent. It generates a new state/verifier, sends S256 PKCE, reads the bounded mock approval form, explicitly approves the simulation and validates the exact same-origin callback and returned state. The code is exchanged once; no redirects are followed. This is automated **mock approval**, not independent verification of real SCA, identity, mTLS or JWS. HTML approval challenges, redirect codes, verifiers and token-response bodies/hashes are suppressed in evidence; tokens remain in memory. Interactive consent ownership/account restrictions are inherited from the common AIS service.

Accounts/balances use strict mapping. Transaction reads explicitly request `bookingStatus=both`, `dateFrom=2020-01-01`, `pageSize=3`; the date covers this mock's October 2026 fixtures, not an assertion of all-time history. Both booked and pending arrays are required. Shared linked pagination is capped at 20 pages and 1000 transactions and rejects external/off-account links, conflicting next links, repeated IDs and loops. This mock additionally exposes `mockPagination`: the adapter checks advancing page number, fixed filters/page size, stable declared total and final count. It cannot independently prove the bank's declared total is truthful. Decimal-string amounts and booking status are preserved.

## Audit and UI

The shared audit captures the mock's OpenAPI hash, positive accounts/balances/transaction requests, negative missing-bearer/unknown-account/revoked-consent cases and the BOG mock's `tppMessages` error envelope. Contract findings remain distinct from approved source-linked XS2A rules. Existing Findings/Quality/JSON/CSV exports apply; timings from different hosting environments do not establish comparative real-bank performance.

Connections -> BOG independent mock -> Run HTTP audit. TPP explorer -> select BOG -> Grant simulated consent -> read accounts/balances/transactions -> Revoke consent. Monitoring -> BOG -> configure health checks and API OFF/ON controls. Audits never change mock faults or reset shared state.

Local fault integration tests verify missing currency, numeric amounts, repeated pagination, revoked-consent bypass, malformed errors, missing balance route, rate limiting and response timeout. Other mock fault switches are not automatically claims of tested source requirements: for example wrong loan principal sign is outside the legacy payment-account profile, and a missing response request ID is not currently checked by the client-request-ID source rule.

## Verification and deployment

`BOG_MOCK_TEST_ROOT` points to a checkout of the mock; local tests default to `untracked/bog-mock-sandbox`. Without the fixture the actual-mock integration test explicitly skips. CI should pin the mock commit and provide this checkout. `node --test tests/*.test.mjs` runs adapter/common-service/report regressions; the mock's own `node --test tests/http.test.mjs` verifies its separate simulator implementation.

Back up GeoBridge's database before replacement. Preserve its volume, existing mock targets, secret mounts, network, public origin and routing. Keep the previous container for rollback. Validate all three readiness endpoints, a fresh BOG audit, four report exports, interactive consent/read/revoke and BOG health monitoring. Restore every live test fault to its prior state; do not alter existing Gringott or TBC fault settings.
