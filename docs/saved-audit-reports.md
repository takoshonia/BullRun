# Saved full audit reports

Every newly completed audit, including internal diagnostics and specification reviews, saves one standalone HTML report and its structured JSON snapshot. Creation uses a deterministic template and requires no AI key, network call, or external renderer.

The report combines scope, verdict counts, actions, compatibility, reliability, latency, security, expected and observed results, remediation, evidence references, measurement limitations and version identifiers. Missing assessments are explicitly marked; unavailable measurements do not become passes. Continuous availability remains a separate observation stream, and the report makes no bank SLA claim.

## Storage and failure behavior

`audit_reports` lives in the existing SQLite database. Audit completion, the first report, its run reference and audit events commit in one transaction. A report storage failure prevents a successful completion and preserves the executed results on the failed run. Retrying finalization is idempotent.

Saved HTML and JSON bytes are immutable. Database triggers reject updates and deletion. Deliberate new versions require a reason and an idempotency request UUID; earlier versions remain accessible. Schema and renderer versions are recorded separately. SHA-256 hashes detect stored-content corruption; they are not digital signatures or protection against a database administrator replacing the database.

Historical completed audits receive their first report incrementally in the background, using retained evidence. The original audit completion time and the later report creation time remain distinct. Until backfill finishes, opening that audit's full report returns a retryable 409 response.

Reports are part of normal database backups; back up SQLite consistently, including its WAL as appropriate. No separate generated-file directory is required. History has no automatic expiration in this implementation. A future retention policy requires an explicit, audited migration rather than bypassing immutability during normal application use.

## UI and API

The Reports page lists saved bank reports. Completed audit details offer **Open saved full report** and **Report version history**. Internal diagnostic reports remain accessible only to Operator through diagnostic details. The full document can be printed or saved as PDF using the browser.

- `GET /api/reports?page=1`: 50 saved report versions per page, scoped to the caller.
- `GET /api/reports/:id`: metadata and saved JSON snapshot.
- `GET /api/reports/:id/html`: exact saved HTML, with integrity checking and restrictive content security policy.
- `GET /api/runs/:id/reports`: version history.
- `POST /api/runs/:id/reports`: create a version with `{requestId, reason}`; Operator or the owning bank, authenticated and CSRF protected.
- `GET /api/runs/:id/export/full`: latest saved full report.

Bank users see their own reports, reviewers see authorized bank reports, and Operator sees authorized reports including diagnostics. TPP and standards roles cannot access saved audit reports. Snapshots project selected evidence metadata and findings rather than storing raw API response bodies or connection credentials. Existing Findings, Quality, JSON and CSV exports remain available; they are separate exports rather than these immutable report versions.

English AI explanations are described in [english-ai-reports.md](english-ai-reports.md). Email delivery and adapter mapping changes remain separate tasks.
