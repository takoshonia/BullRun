# Working mock bank demonstration

## What is implemented

Two unofficial synthetic bank implementations are added alongside the existing pending real sandbox connections. They use separate fictional accounts, data and wire responses. Names indicate inspiration only: neither implementation is an official TBC/BOG contract or a copy of the real bank's API. The mentor's independent TBC mock reference/OpenAPI was consulted for the separation of synthetic customers, consent and measured failure behavior; its code was not copied.

The app starts a private HTTP listener on an ephemeral loopback port. Worker threads issue actual HTTP requests to it with a per-process service credential. This credential is never included in captured observations or returned in workspace payloads. The listener is not exposed publicly and requires no additional cloud firewall port or external service. Existing Dockerfile copies src/public, so a rebuilt backend image includes this feature. The current Vercel reverse proxy configuration is preserved.

Mock audit captures persist original JSON responses, request UUIDs, timestamps, measured durations, scenario, sample types and a capture hash. Positive probes measure accounts, balances and transactions. Negative invalid/revoked consent probes are separate from positive reliability statistics. Five probes per operation is the quick default; twenty enables p95. Same-host loopback latency is never represented as actual bank latency, production uptime or an SLA. The 250 ms deadline is a chosen demo budget.

TBC-style responses use conventional AIS envelopes. BOG-style transactions use entries and BOOKED/PENDING fields. Its explicit adapter preserves decimal strings, currency, account identity and transaction status. Missing required currency returns 422 rather than inventing a value. Both adapters share the existing common contract.

## Source-linked checks

Mocks use the loan/deposit openFinance profile with fictional SVGS accounts. Selected observable assertions link to the pinned AIS, Common Protocol and Domestic source files and sections. They run as `demo_standard_assertion` with `demo_selected` applicability, separate from production approvals. This deliberate demonstration profile never marks stored draft rules approved for real banks. Full normative applicability, cryptographic bank signing, real OAuth/SCA, token exchange and certification are not claimed.

Original responses are checked before normalization. An explicit adapter does not erase an upstream standards finding. Each finding retains its expectation, observation, source locator, source hash and guidance. Reports, comparisons, schedules, explanations and quality metrics use the persisted results. AI explanation currently retains the existing deterministic fallback; QVAC is not part of this update.

## Three-minute walkthrough

1. Sign in as operator or bank engineer. Open **Mock bank lab**.
2. Click **Reset demo faults**, then **Audit both banks**. TBC-style starts healthy. BOG-style omits account currency.
3. Open the BOG-style findings. Inspect AIS-CURRENCY and the failed common account mapping. Expand original redacted evidence. Export Findings and Quality reports.
4. Click **Repair & retest** in the mock lab. Fresh HTTP evidence is collected. The comparison shows FAIL becoming PASS; the earlier failure remains in history.
5. As operator or TPP, open **TPP explorer**. Select each bank, grant demo consent, then request balances and transactions. Compare original BOG entries against common booked/pending transactions.
6. Revoke consent, request again, and observe 403. Optional: use outage or slow behavior and rerun an audit to show measured errors/timeouts.

The mock scenario is shared demo configuration, persisted across restarts. Reset restores behavior only and never removes history. A schedule targeting a mock collects fresh requests. Real pending connections still return BANK_NOT_CONNECTED.

## Installation and hosting

Apply the supplied updater locally with the app stopped. It updates code/tests/docs only, backs up replaced files and refuses changed-file conflicts. It does not replace data, .env, certificates, credentials, Git metadata or vercel.json.

Push the updated code to the team's repository. The server owner must pull that commit and rebuild/recreate the backend container using the same existing persistent Docker volume and production GEOBRIDGE_ORIGIN. A Vercel redeploy alone does not update the DigitalOcean backend. Do not recreate an empty volume or publish credentials. Verify /api/health shows bankConnections=mock_only and realBankConnections=not_configured.

Existing user accounts, approvals and audit history remain. First startup adds two mock connections and their synthetic specs; it does not replace existing real connection records. Back up the server database before deployment according to the team's existing process.

## Validation

HTTP integration tests cover the successful path, missing currency, explicit BOG mapping, repair comparison, 20-sample p95, original capture provenance, role restrictions, cross-owner and cross-bank consent rejection, account scoping, revocation, report exports, release HOLD for mock-only evidence, 503 outages, deadlines/timeouts, and preservation of production draft rules. Existing role and UI render tests cover the new pages. Browser validation is recorded separately; do not infer a full security or standards certification from tests.
