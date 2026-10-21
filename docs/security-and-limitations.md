# Security controls and limits

## Enforced now

- Local-only default bind `127.0.0.1`, no public registration.
- Random initial passwords, scrypt hashes, eight-hour server sessions, HttpOnly/SameSite cookies, Secure cookies when HTTPS origin is configured.
- Exact Origin and CSRF tokens for mutations, login rate limit, 2 MB body cap, no remote spec fetching, fixed static file paths, escaped dynamic UI/report content, restrictive CSP.
- Backend roles and tenant checks for records, runs, evidence, exports, schedules, explanations and events.
- Synthetic-only import acknowledgement, recursive secret redaction, source/ruleset hashes, explicit evidence labels.
- Real RSA valid/tampered-message local assertion. This is not bank-profile JWS or qualified-certificate verification.
- No outbound bank requests. Allowlist/DNS guards are available, but a future transport must pin the validated address, preserve TLS hostname checking and reject redirects. The utility alone is not a complete DNS-rebinding defense.
- Draft normative rules require deliberate human source/applicability review. Local platform checks have an engineering basis and are not regulatory obligations.

## Before any public deployment

Use a supported HTTPS production server/reverse proxy, authenticated secret storage and rotation, hardened filesystem/database permissions, backup/retention, per-IP/session abuse limits, explicit reviewer grants, CSRF origin configuration, protected signing service and operational monitoring. Node's built-in SQLite is a single-host prototype design. Plain source hashes do not constitute tamper-proof storage.

AI output checks limit references/numeric inventions but cannot prove semantic correctness. Keep it advisory. Do not pass untrusted uploads or API response text as instructions or grant AI bank/approval tools. The fixed provider receives sanitized test facts only. No live AI was verified without a key/model.

## Honest limitations

No sandbox is configured, no bank conformance result exists, no actual probe availability/latency is recorded, and no bank-ready release can be approved from local assertions. Offline captured measurements are uploader-declared. A small sample does not establish monthly uptime. Imported captures can be altered by the uploader; this tool does not authenticate their origin.

Unknown/blocked/no data states are intentional. Missing mandatory or security-critical response values fail mapping; they are never repaired by invention. The mapping preview is not a universal bank adapter.

The seeded reviewer has a documented development convention for `bank-*` records. Production needs explicit per-organization evidence-sharing grants. No real institution or regulator has endorsed this prototype.
