# Independent TBC mock adapter

This connects the independently hosted hackathon mock at https://tbc-bank-mock-open-banking-api.vercel.app, not the official TBC sandbox. Reference: https://tbc-bank-mock-open-banking-api.vercel.app/reference/aisreadaccountlist. Contract: `/openapi.json`, server base `/0.8`.

## Configuration

Append this entry to the existing `GEOBRIDGE_MOCK_TARGETS` array. Preserve the Gringott entry and existing environment, volume and secret mounts:

```json
{"id":"tbc","name":"TBC independent mock","adapter":"tbc-mock-v1","origin":"https://tbc-bank-mock-open-banking-api.vercel.app","tenant":"bank-demo","monitor":false}
```

`monitor:false` excludes this target from the existing Gringott-style `/api/health` monitor: the TBC deployment does not expose that endpoint. AIS audits and their per-operation timings work independently. No TBC admin key or pasted bearer token is required. `GEOBRIDGE_TBC_MOCK_TIMEOUT_MS` defaults to 10000 (200–10000), a transport budget, not a standards threshold.

## Authorization and mapping

The adapter uses `POST /mock/docs/session` with a fresh UUID browserId, family `ais`, version `v1`. This is the same synthetic authorization helper used by the mock reference UI. It is NOT an independent OAuth/SCA/PKCE test. Raw session responses and their hashes are omitted from evidence; tokens remain in server/worker memory. No screenshot token is reused. Sessions are revoked with `DELETE /0.8/v1/consents/{id}` on completion, with best-effort cleanup after failure.

Protected calls send bearer authorization and Consent-ID. Status responses do not include validUntil, so the adapter explicitly uses the synthetic session's expiresAt for its local deadline. Restart requires a fresh interactive consent. Other common-service owner/account/role checks are shared with Gringott.

Accounts and balances use the common strict mapper. Transactions use booked/pending arrays; an absent category means empty in this mock's representation. Invalid or unknown array categories and duplicate transaction IDs fail. Next links are bounded to 20 pages and 1000 items, the configured origin and the exact account transaction path; loops, repeated IDs and external links fail. The server does not provide an independently verified total, so absence of hidden/omitted server records cannot be proved. Reports retain original responses separately from mapped data.

The shared capture runner selects this adapter and captures accounts, balances and transactions; negative unauthenticated/unknown-account/revoked-consent checks; mock problem code/detail; OpenAPI hash; and measured HTTP samples. Source rules run only when approved for the selected `xs2a-0.8` profile. Mock contract results are not official TBC compliance findings. Internet-hosted TBC mock and same-server Gringott timings are not directly comparable bank performance measurements.

Public-deployment smoke testing observed HTTP 404 for an unauthenticated accounts request and HTTP 503 for an unknown account while positive AIS reads succeeded. These remain visible contract findings rather than being converted to PASS. A 404 denial alone does not demonstrate unauthorized access; 503 may reflect the mock's current injected failure state. The adapter never changes global mock faults to obtain a passing report.

## UI and tests

Connections -> TBC independent mock -> Run HTTP audit. Existing Findings/Quality/JSON/CSV exports apply. TPP explorer -> choose the TBC connection -> Grant simulated consent -> Accounts/Balances/Transactions -> Revoke consent.

`node --test tests/*.test.mjs` includes deterministic local HTTP integration tests without depending on the public deployment. Test coverage includes session headers, expiry parsing, mapping, pagination isolation/loops/duplicates, lifecycle, stored evidence, report exports and no token leaks. A separate deployment smoke check should exercise the public mock and always revoke its own test consent; do not reset shared mock state or inject global faults without coordination.
