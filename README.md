# GeoBridge

Evidence-led Georgian Open Banking assurance. Local hackathon application, build 0.1.0.

## Start on this computer

1. Double-click `Start-GeoBridge.cmd` (or run `Start-GeoBridge.ps1`). Keep the terminal open.
2. Open **http://127.0.0.1:4317**. Use this exact origin, not `localhost`, for the CSRF origin checks.
3. Open `data/demo-credentials.json`. Sign in as `operator` for the full development workspace. Passwords are generated randomly on the first launch.
4. Choose **Audit center → Run platform checks**. Open the completed run and a finding. Export Findings, Quality, JSON and CSV.

Requires Node.js 24 or newer (built-in SQLite). The launcher also detects the installed Codex runtime on this computer. No npm install or Python package installation is required.

Run tests: `node --test tests/core.test.mjs tests/integration.test.mjs tests/ui-render.test.mjs`.

## What works

- Backend-enforced sessions, password hashing, CSRF, role and tenant access checks.
- SQLite persistence, background worker execution, cancellation, restart interruption handling and bounded run queues.
- 25 executable platform assertions: cryptographic valid/tampered messages, scoped consent guards, tenant checks, redaction, target restrictions, exact mapping semantics and measurement calculations.
- Original synthetic evidence import, pinned-profile candidate checks, manual rule approval with reviewer notes, and persistent evidence references.
- Source registry with extracted Georgian text, hashes and original supplied documents. Index contents are extracted to JSON for review.
- Findings with expected/observed values, guidance, evidence mode and original redacted response; explanations in Georgian/English with honest template fallback.
- Both required report types as printable HTML, JSON result bundles and raw sample CSV export.
- Per-operation imported measurements, sample-size disclosure and correct exclusion of expected negative, warm-up and setup requests.
- Common AIS mapping preview with decimal-string precision, currency/status preservation and typed failures.
- Connection registration and JSON OpenAPI upload, proposed common API specification, bank adapter boundary, source-snapshot text comparison, run comparison and structural OpenAPI diff APIs.
- Periodic local job scheduling and scope-limited audit event history.
- Publication decisions: reject failures, hold missing/incomplete bank coverage. No external deployment is performed.

## What deliberately does not pretend to work

**No bank or mock bank runtime is connected.** This follows the agreed integration-later scope. All bank request endpoints return `BANK_NOT_CONNECTED`. The provided fictional evidence JSON is an offline response fixture, not a mock server or actual bank observation. It has no fabricated timing samples.

Bank-specific adapters, consent authorization, token exchange, bank certificates/signing, real probes and true cross-bank quality comparisons require bank setup and implementation against the assigned contracts. No customer data is served. Platform fixture results are not bank security results or Georgian JWS certification.

Normative candidates start as **drafts**. A reviewer must read complete source conditions before activation. Some checks implement only an explicitly described sub-assertion. Missing source/error mappings/lifecycle evidence remain unassessed. Counts are not a percentage of all requirements.

## Roles

| Login | Permissions |
|---|---|
| operator | Local full development access, including explicit standards-review privilege |
| bank | Own registered connections, evidence, runs, reports, schedules and candidate decisions |
| tpp | Published connection capability catalog, common mapping preview; bank data remains blocked |
| reviewer | Read authorized `bank-*` scope diagnostics, not TPP records or transaction access |
| standards | Source and candidate-rule review, draft change comparisons |

These are fictional demo identities. There is no public signup or real-bank/NBG endorsement. A production deployment needs explicit per-bank reviewer grants instead of the seeded `bank-*` demo convention.

## Live AI (optional)

Copy `.env.example` to `.env` and configure `GEOBRIDGE_AI_KEY` and `GEOBRIDGE_AI_MODEL` securely. The launcher reads `.env`; plain `node src/server.mjs` reads process environment only. Never commit real credentials. The provider endpoint is fixed to the OpenAI Chat Completions API. No raw response, customer payload or secret is sent; only controlled test facts. IDs, section references, shape and numeric claims are validated. This does **not** guarantee factual correctness: output remains advisory and evidence is visible. Missing/provider failure/invalid output uses a labelled deterministic template.

## Architecture

`Browser UI → authenticated HTTP API → SQLite records → worker thread → evidence/results → exports`

`TPP mapping preview → deterministic common-contract mapper`

`Future bank adapter → verified original bytes → auditor and explicit mapper (separate paths)`

Source: `src/server.mjs`, `store.mjs`, `engine.mjs`, `worker.mjs`, `rules.mjs`, `security.mjs`, `assurance.mjs`, `ai.mjs`. Frontend: dependency-free HTML/CSS/JS in `public/`.

## Moving to Documents/GeoBridge

The requested destination was blocked by the active Windows write policy. This complete project was built in the conversation's writable folder. Stop GeoBridge, copy this **entire folder** to `C:\Users\user\Documents\GeoBridge`, and launch `Start-GeoBridge.cmd` there. Relative paths keep working. Do not overwrite a populated project without checking it first.

## Production and submission

This is a local development application, not a production service. Do not bind it publicly as-is. See `docs/security-and-limitations.md`, `docs/standards-review.md`, `docs/bank-integration.md` and `docs/demo-script.md` before recording claims or deployment.

Keep `data/`, `.env`, credentials and local logs out of public repositories. For a clean copy, omit `data/`; new accounts will be generated. Original standards are reference material owned by their respective authors; do not assume redistribution rights from their presence here.

Dependencies: Node.js built-ins only; no third-party UI libraries, fonts, analytics or CDN assets. Node.js and SQLite retain their respective upstream licenses. This project has no selected commercial/open-source license yet; team ownership is retained.
