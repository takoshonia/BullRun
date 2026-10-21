# Verification and handoff

Run `Verify-GeoBridge.ps1` or `node scripts/verify.mjs`. It executes the automated checks and updates `docs/verification.json` with the exact Node version, timestamp, exit code and output.

## Verified behavior

13 automated test groups pass. They exercise 25 real platform control assertions; synthetic-only evidence validation; exact mapping and typed failures; sample statistics; regression/spec comparisons; HTTP login/session/CSRF; background-worker persistence; findings/quality exports; cross-tenant and oversight raw-data denial; draft-rule approval permissions; template explanations; bank-not-connected errors; all ten UI view templates; and escaping untrusted names.

The UI test uses a controlled DOM harness. It verifies view generation, not visual pixel layout or browser interactions. The browser tool could not reach the local development port, so visual browser QA remains unverified. The local service itself was verified over real HTTP by the integration test's server process.

## Manual first-launch checks

1. Launch `Start-GeoBridge.cmd` and keep its terminal open. Open `http://127.0.0.1:4317`.
2. Sign in with the operator credential from `data/demo-credentials.json`.
3. Run platform assurance, inspect a signature result and export reports.
4. Use TPP explorer, validate balances, insert a missing currency and confirm an error.
5. Sign out. Use TPP login: audit writes should be denied. Use reviewer login: diagnostic reads are permitted for the development bank scope, raw response evidence is denied.
6. Import the fictional evidence file and review it. Unapproved standard rules must remain NEEDS_REVIEW; quality metrics must remain unmeasured.

## Intentionally unverified

- Bank integration and Georgian signing-profile conformance.
- Real sandbox security negatives, performance, consent authorization and cross-bank observations.
- Live AI provider integration (key/model not supplied).
- Public hosting, domain registration and static outbound IP.
- Full legal/standards conformance and all source clauses.

The source scope review is recorded separately from the candidate approval ledger. No completed standards or bank coverage is inferred from file download success.
