# GeoBridge

**Open Banking API audits, evidence-backed reports, and a common interface for synthetic bank integrations.**

GeoBridge is a hackathon prototype for checking selected API requirements, explaining failures, and reviewing adapter changes before they reach a third-party provider (TPP). It combines a bank engineering workspace, an oversight/standards review workspace, and a TPP integration workspace.

**All executable bank integrations are synthetic mocks.** BOG and TBC names identify independent mock implementations, not official bank connections. Gringott is fictional. The NBG account is a demonstration role, not evidence of regulatory participation or approval. No real customer data, payments, or money movement are involved.

## What the prototype does

- **Audit center:** execute configured mock-bank HTTP audits or review saved synthetic responses as a separate action. Findings retain the expected result, observed result, source reference, evidence type, and verdict.
- **Four check categories:** selected compatibility and security scenarios, plus bounded reliability/latency workloads. **Bank comparison** shows shared checks and measured differences across configured mocks; same-bank before/after comparison is separate.
- **Reports:** automatically save a complete, versioned HTML report when an audit completes, without requiring AI. Findings/quality exports, JSON, and CSV remain available. Optional English AI analysis creates a separate saved report version with a deterministic fallback.
- **TPP explorer:** obtain simulated consent and request accounts, balances, and transactions through bank adapters and a common interface. Multi-bank balance requests retain one bank's successful result when another fails.
- **API changes & adapter review:** capture versioned OpenAPI schemas, compare revisions, record response mismatches separately, test mapping candidates, record semantic approval, activate reviewed mappings, and roll back. Default schema scans run every 24 hours; signed mock-bank notifications can trigger an earlier scan.
- **Controlled automation:** a previously tested and approved exact bank/schema/mapping transition can receive a seven-day pre-authorization. Operator enablement and fresh tests are required. Unrecognized changes do not receive guessed mappings; runtime requests do not call AI.
- **Monitoring and notifications:** health/reachability observations, scheduled audits, an activity trail, and persistent, scoped in-app notifications with live updates. Email delivery is not configured.

A working adapter does **not** erase a bank's original audit failure. Resolution badges distinguish **Handled by adapter**, **Review pending**, and **Bank action required** while preserving the recorded verdict and severity.

## 1. Run locally — no bank service or AI key required

### Prerequisites

- **Node.js 24 or newer**, including the built-in `node:sqlite` module. Check with `node --version`.
- A current browser and a writable project/data directory.
- Git and repository access if cloning; otherwise extract the submission archive and open its directory.

The main application has **no third-party npm dependencies**. An `npm install` step is not needed. Python and Docker are optional administration/deployment tools, not requirements for the basic demo.

```sh
git clone https://github.com/takoshonia/BullRun.git
cd BullRun
node --env-file-if-exists=.env src/server.mjs
```

For an extracted archive, run only the final command from its root. On Windows, double-click `Start-GeoBridge.cmd` as an alternative. Keep the terminal open.

1. Open **http://127.0.0.1:4317**. Use this exact origin; `localhost` is a different browser origin.
2. Open the locally generated **`data/demo-credentials.json`** file. Passwords are random per installation; this README contains no shared passwords.
3. Sign in as `operator` for the full technical demonstration, or use the scoped accounts below.
4. Stop the application with **Ctrl+C**. SQLite data and saved reports persist in `data/`.

The default settings work without an `.env` file. For configuration, copy `.env.example` to `.env` and restart using the command above. Plain `node src/server.mjs` reads process environment and does not load `.env` by itself. If changing `PORT`, also change `GEOBRIDGE_ORIGIN` to the exact matching URL.

`GEOBRIDGE_DATA_DIR` selects another data directory. That installation has its own database and generated credentials. Do not commit `data/`, `.env`, provider keys, or captured private credentials; see [.gitignore](.gitignore).

### Basic jury walkthrough — works offline after setup

1. **Operator → System diagnostics:** run the internal self-checks and open their results. These test GeoBridge controls, not bank compliance.
2. **Audit center → Review saved API responses → Import responses → Load fictional example.** Confirm the data is synthetic and import it.
3. Reopen **Review saved API responses**, select the imported response set, and run the review.
4. Open the completed audit. Inspect expected/observed findings and their evidence/source references. Draft standard rules remain unassessed until reviewed; do not interpret them as passes.
5. Open the **saved full report** and report-version history under the audit or **Reports**. The report exists even with no AI connection.
6. Sign in as a scoped bank, NBG, or TPP account to inspect the different workspaces. Without configured mock services, bank HTTP execution is unavailable; the common-contract preview still supports local synthetic validation.

## 2. Optional: run two mock banks and the change-notification demo

The separate simulators are **not bundled with the main application**. These commands require access to their repositories; lack of access does not prevent the basic walkthrough above.

```sh
git clone https://github.com/Barbare997/bog-mock-sandbox.git untracked/bog-mock-sandbox
git clone https://github.com/takoshonia/gringott-sandbox.git untracked/gringott-sandbox
```

Keep these checkouts separate from GeoBridge source changes and do not include their generated data/keys in a submission. Record their commit IDs with `git -C <checkout> rev-parse HEAD` when recording reproducible results.

From the GeoBridge root, use three terminals:

**Terminal A — BOG-style mock, default port 4183:**

```sh
node untracked/bog-mock-sandbox/src/server.mjs
```

**Terminal B — Gringott mock, default port 4173:**

```sh
node untracked/gringott-sandbox/server.js
```

Private mock fault controls require separate administration keys; normal simulated consent/read operations do not require those administration keys. Start from the mocks' normal, unchanged state.

**Terminal C — GeoBridge plus a separate signed-event publisher:**

Windows PowerShell:

```powershell
$env:MOCK_PUSH_GRINGOTT = 'http://127.0.0.1:4173'
node examples/start-mock-push-demo.mjs
```

macOS/Linux:

```sh
MOCK_PUSH_GRINGOTT=http://127.0.0.1:4173 node examples/start-mock-push-demo.mjs
```

Open **http://127.0.0.1:4320** and use **`data/push-preview/demo-credentials.json`**. This is separate from the default port-4317 installation. The launcher configures two bank targets and private signing/control keys; its synthetic publisher listens on port 4185. Stop it with Ctrl+C and stop the two upstream mock terminals separately.

The launcher wraps the BOG mock without editing its source. If the mock has a fixed public origin or registered redirect list, register the exact publisher callback, `http://127.0.0.1:4185/callback`, in that mock's `BOG_MOCK_REDIRECT_URIS` before starting it; do not disable redirect validation.

For the recorded flow, follow [the exact demonstration steps](docs/automatic-mapping-notifications.md):

**Both banks succeed → publish BOG's synthetic field change → signed event and automatic scan → BOG contract error / Gringott success → test, approve, activate mapping → TPP recovery → pre-authorize the exact recurrence → verify automatic recovery and original-schema restoration.**

A first-time mapping needs NBG semantic review and Operator activation. Automatic recurrence is opt-in, bank-specific, exact-schema-specific, tested again, and expires after seven days. Operator rollback disables enabled policies for that bank. Restore the mock field after the demonstration.

For running an already configured mock without the publisher, set `GEOBRIDGE_MOCK_TARGETS` as described in the [BOG](docs/bog-mock-adapter.md), [Gringott](docs/gringott-adapter.md), or [TBC](docs/tbc-mock-adapter.md) adapter guide. The TBC adapter targets an independently hosted mock; Internet access and service availability are external prerequisites.

## Demo accounts and access

| Username | Purpose and access |
| --- | --- |
| `operator` | Hackathon-team technical workspace, all pages, diagnostics, configuration, mapping tests/activation and demo controls. |
| `bank-bog`, `bank-tbc`, `bank-gringott` | Separate bank organizations: their visible audits, reports, monitoring, approved applicable rules, and notifications. No other bank's private workspace. |
| `nbg` | Demo oversight and standards review: authorized bank audits/comparisons, source/rule review, mapping semantic approval, and policy pre-authorization. No technical credential administration or TPP token access. |
| `tpp-demo` | Common-interface preview and configured mock-bank reads using its own simulated consents; no governance/audit inbox access. |

Use the **scoped accounts for the jury**; reserve Operator credentials for the team and an explicitly guided technical demonstration. Old generic `bank`, `reviewer`, `standards`, and `tpp` accounts are retired by the account-provisioning code. Actual authorization is enforced by the backend, not just hidden navigation. See [role access](docs/role-access.md).

## Short architecture overview

```text
Browser: HTML / CSS / JavaScript
  └─ Authenticated Node.js HTTP API
       ├─ SQLite: users, evidence, runs, reports, decisions, notifications
       ├─ Audit queue → worker thread → fixed-origin mock adapters → findings
       ├─ TPP common AIS → consent/account checks → bank request → approved response mapping
       ├─ Schema scheduler / signed webhook queue → diff → review / policy worker
       └─ Optional report AI jobs → validated advisory narrative / template fallback
```

| Boundary | Implementation |
| --- | --- |
| UI, page routing, immediate audit-loading feedback | [public/app.js](public/app.js), [public/style.css](public/style.css) |
| HTTP authentication, authorization and orchestration | [src/server.mjs](src/server.mjs), [src/workspace-access.mjs](src/workspace-access.mjs), [src/audit-visibility.mjs](src/audit-visibility.mjs) |
| Persistence, audit engine, worker and report documents | [src/store.mjs](src/store.mjs), [src/engine.mjs](src/engine.mjs), [src/worker.mjs](src/worker.mjs), [src/reports.mjs](src/reports.mjs) |
| Common interface, consent ownership, transport and bank implementations | [src/adapters/](src/adapters/) |
| Schema review, signed notifications and exact-mapping policies | [src/contract-review.mjs](src/contract-review.mjs), [src/contract-webhooks.mjs](src/contract-webhooks.mjs), [src/mapping-automation.mjs](src/mapping-automation.mjs) |
| Availability, measurement workloads and in-app delivery | [src/availability.mjs](src/availability.mjs), [src/mock-quality.mjs](src/mock-quality.mjs), [src/notifications.mjs](src/notifications.mjs) |
| Optional AI routing and report narrative validation | [src/ai-providers.mjs](src/ai-providers.mjs), [src/report-narrative.mjs](src/report-narrative.mjs) |

The API and worker perform deterministic checks. AI does not decide verdicts, invent measurements, execute generated adapter code, or approve mappings. Stored original evidence and normalized TPP responses have separate purposes.

## Evidence of guardrails in the code

These are implemented controls the jury can inspect, not claims of a comprehensive security assessment.

| Control | Code evidence | Verification evidence |
| --- | --- | --- |
| Salted scrypt passwords, constant-time comparison; server-side sessions, Origin/CSRF checks and account-identity binding | [security.mjs](src/security.mjs), [server.mjs](src/server.mjs) | [integration tests](tests/integration.test.mjs), [session-token tests](tests/session-token.test.mjs) |
| Bank/role isolation, including direct API access and report visibility | [workspace-access.mjs](src/workspace-access.mjs), [audit-visibility.mjs](src/audit-visibility.mjs) | [organization-access tests](tests/organization-access.test.mjs), [bank review-history tests](tests/bank-review-history.test.mjs) |
| Consent tied to owner, tenant, bank, expiry and allowed accounts; tokens kept in memory | [common-ais.mjs](src/adapters/common-ais.mjs) | [BOG tests](tests/bog-mock.test.mjs), [Gringott integration](tests/gringott-integration.test.mjs) |
| Fixed mock origins, request deadlines/budgets, bounded payloads, restricted pagination; no arbitrary redirect following | [http-transport.mjs](src/adapters/http-transport.mjs), [linked-pagination.mjs](src/adapters/linked-pagination.mjs), [registry.mjs](src/adapters/registry.mjs) | [Gringott adapter tests](tests/gringott-adapter.test.mjs), [BOG tests](tests/bog-mock.test.mjs), [registration tests](tests/connection-registration.test.mjs) |
| Redaction of authorization material and common sensitive identifiers before evidence storage | [security.mjs](src/security.mjs), [http-transport.mjs](src/adapters/http-transport.mjs) | [core tests](tests/core.test.mjs), [BOG tests](tests/bog-mock.test.mjs) |
| Exact decimal-string copying; missing, ambiguous or unsupported values fail rather than being guessed | [security.mjs](src/security.mjs), [contract-review.mjs](src/contract-review.mjs) | [contract-review tests](tests/contract-review.test.mjs) |
| Explicit baseline/mapping review, fresh passing tests, version/hash checks, rollback, expiring exact-transition automation | [contract-review.mjs](src/contract-review.mjs), [mapping-automation.mjs](src/mapping-automation.mjs) | [mapping-automation tests](tests/mapping-automation.test.mjs), [HTTP workflow test](tests/contract-webhooks-integration.test.mjs) |
| Signed bank events: HMAC, timestamp checks, bounded payload, deduplication, durable retry | [contract-webhooks.mjs](src/contract-webhooks.mjs), [mock publisher](examples/mock-push-bank.mjs) | [webhook tests](tests/contract-webhooks.test.mjs) |
| Per-user inbox/read access and affected-bank-only notifications | [notifications.mjs](src/notifications.mjs), [server.mjs](src/server.mjs) | [notification tests](tests/notifications.test.mjs), [HTTP workflow test](tests/contract-webhooks-integration.test.mjs) |
| Immutable saved report versions; report creation without AI; bounded and validated AI facts with fallback | [reports.mjs](src/reports.mjs), [report-narrative.mjs](src/report-narrative.mjs) | [saved-report tests](tests/saved-reports.test.mjs), [narrative tests](tests/report-narrative.test.mjs) |
| Comparable-workload limits, disclosed sample counts and p95 withheld below 20 successful samples | [mock-quality.mjs](src/mock-quality.mjs) | [mock-quality tests](tests/mock-quality.test.mjs) |
| Operational adapter recovery never rewrites the original bank FAIL; late audit responses cannot overwrite a different account/page | [bank-alerts.mjs](src/bank-alerts.mjs), [app.js](public/app.js) | [bank-alert tests](tests/bank-alerts.test.mjs), [audit-loading tests](tests/ui-audit-loading.test.mjs) |

Redaction and schema validation are bounded controls, not guarantees that arbitrary real customer data is safe to upload. Use synthetic evidence only.

## Tests and verification

From the root, with Node.js 24+:

```sh
npm test
```

Or invoke the same runner directly:

```sh
node --test tests/*.test.mjs
```

Tests cover deterministic rules, HTTP authorization, tenant isolation, report persistence, UI behavior, transport/mapping boundaries, notifications, and automation. Some integration tests start local HTTP servers and worker processes; the test environment must permit them. Tests use temporary databases rather than the normal demo database.

External-mock integration tests **explicitly skip** if their separate fixtures are absent. `GRINGOTT_TEST_ROOT` and `BOG_MOCK_TEST_ROOT` override the fixture paths in their respective adapter suites; the combined publisher workflow currently expects `untracked/bog-mock-sandbox/src/server.mjs`. The two-checkout layout above supports that workflow. Review the runner's pass/fail/skip summary for the actual checkout; a skipped mock test is not evidence of a successful bank integration. Historical reports under `docs/verification*` are not a substitute for a current run.

For reproducible demonstrations, record the GeoBridge/mock commits, evidence mode, selected profile/ruleset, source hashes, workload, thresholds and sample counts. Do not compare a mock audit with an uploaded file as though both were live bank measurements.

## Optional AI and deployment

AI is optional. Provider adapters support OpenAI, Gemini, Claude, Grok and configured OpenAI-compatible services through HTTP; there are no provider SDK packages. An exact supported model ID and private key configuration are needed for real provider calls. See [provider pool/failover](docs/ai-provider-pool.md) and [English report explanations](docs/english-ai-reports.md). Failover respects bounded attempts/deadlines and does not create additional provider quota.

Local setup needs no hosting account. An optional [Dockerfile](Dockerfile) packages the Node backend; production persistence requires a durable `/app/data` volume, private secrets and the correct public origin. See [deployment guidance](docs/deployment.md). The command `node scripts/build-vercel.mjs` builds a **static domain page only**; it does not deploy the full API, SQLite store, worker, or mocks. Existing Vercel frontend/proxy and backend deployments are separate from this local quick start.

## Third-party components and licences

There are no third-party npm runtime or test packages in [package.json](package.json). Platform components, embedded assets and optional integrations still have their own terms:

| Component | How it is used | Licence / status |
| --- | --- | --- |
| Node.js 24+ | HTTP server, crypto, workers, test runner, filesystem and built-in SQLite binding | Node.js is MIT-licensed; its bundled dependencies carry additional notices in the [Node.js distribution licence](https://github.com/nodejs/node/blob/v24.0.0/LICENSE). Consult the licence shipped with the installed version. |
| SQLite | Embedded database via `node:sqlite`; no separate npm SQLite package | [Public domain dedication](https://www.sqlite.org/copyright.html). |
| Embedded Helvetica Neue LT GEO webfonts: `HelveticaNeueLTGEOW82-55Rm` and `HelveticaNeueLTGEOW82-65Md` | Two base64 WOFF2 faces embedded in `public/style.css` under `GeoBridge Helvetica` | Proprietary Monotype font software, copyright 2016 Monotype Imaging Inc. The embedded name/licence metadata requires a licence agreement. **No evidence of a web-embedding/redistribution licence is included here.** Supply the applicable rights evidence or replace the fonts with suitably licensed assets before redistributing the submission. |
| BOG-style independent mock | Optional separate simulator; not bundled into this repository | [Source repository](https://github.com/Barbare997/bog-mock-sandbox). No licence declaration/file was found in the locally inspected checkout; no open-source redistribution permission is assumed. |
| Gringott simulator | Optional separate fictional bank; not bundled into this repository | [Source repository](https://github.com/takoshonia/gringott-sandbox). No licence declaration/file was found in the locally inspected checkout; no open-source redistribution permission is assumed. |
| Independently hosted TBC mock | Optional external HTTP service | Service/source licence is not declared in this repository. This integration does not imply an official bank relationship or a grant to redistribute the service. See [adapter provenance](docs/tbc-mock-adapter.md). |
| Open Banking reference documents in `sources/` | Source-linked candidate checks and human review | Rights remain with the respective authors/publishers. These documents are not granted GeoBridge's software licence; no blanket redistribution permission is asserted. [Source manifest](sources/manifest.json). |
| Python 3, optional | Private AI configuration helper; not required to run GeoBridge | [Python Software Foundation Licence v2](https://docs.python.org/3/license.html), with the interpreter's bundled notices. |
| Docker / Debian-based Node image, optional | Backend container packaging using `node:24-bookworm-slim` | The image includes Node.js and Debian packages under their respective licences; retain their included notices. Docker tooling is separately licensed. It is not an additional npm dependency. |
| AI provider APIs, Vercel and DigitalOcean, optional | External inference and hosted-demo infrastructure | Proprietary service terms, not open-source libraries bundled with the application. Credentials/subscriptions are not needed for the basic local walkthrough. |

Other named fonts in CSS are system fallback names, not additional downloaded font files. The frontend uses locally served HTML/CSS/JS, embedded fonts and logo assets; it has no analytics or external font/CDN requirement.

GeoBridge's own package is marked `private`; this checkout does **not** select an open-source licence for the project. Team-supplied branding and original code retain their owners' rights. Do not infer a project-wide MIT grant from Node.js's licence.

## Scope and limitations

- No official bank onboarding, real customer consent/SCA, production mTLS/JWS integration, real balances, or payment execution is implemented. A common format does not grant permission to access a bank.
- Security coverage consists of selected scenarios and local controls, not a complete penetration test or certification. Source rules start as drafts and implement only their stated scope.
- Mock timings describe the recorded synthetic workload/hosting conditions. Health/reachability monitoring does not establish authenticated AIS availability or a real-bank SLA.
- AI explanations and candidates are advisory. Structural success does not establish semantic equivalence; initial human review remains necessary.
- In-app notifications require sign-in to read; live notices require an open page. Email, SMS and OS/browser push are not configured.
- SQLite and the single-backend worker setup serve this prototype. Persistent backups, operational hardening and independent validation are required before handling production financial data.

Further detail: [saved reports](docs/saved-audit-reports.md), [contract review](docs/contract-change-review.md), [signed mock events](docs/mock-contract-webhooks.md), [automation demo](docs/automatic-mapping-notifications.md), and [security scope](docs/security-and-limitations.md).
