# Contract monitoring and reviewed balance aliases

## Scope

Configured synthetic adapters only. No external mock service is modified. Production deployment is not part of this change.

`API contract changes` is visible to Operator and NBG. Bank engineers and TPPs cannot read its schemas, proposal records or controls. TPPs use `TPP explorer` and owner-scoped simulated consents.

- Every five minutes while GeoBridge is running, configured `/openapi.json` documents are fetched with fixed-origin, bounded transports. Operator/NBG can also scan manually.
- Canonical content hashes identify immutable schema snapshots. Fetch status is separate; an outage or invalid document does not become a contract change. Repeated identical transitions are deduplicated.
- Changes retain source JSON pointers, before/after values, classification and impacted common operations where dependency references establish them. Unknown applicability remains explicit.
- Only NBG can approve an original schema baseline. Snapshot JSON is available for inspection before approval.
- TPP accounts/balances reads check an approved baseline's available structural response schema; deterministic adapters continue enforcing business invariants. Schema mismatch records are separate from document changes. No schema coverage is claimed when the upstream document omits response schemas.

## Mapping lifecycle

Candidates are immutable records pinned to a bank and schema snapshot. This implementation intentionally supports only exact `balanceAmount.sum`, `.aggregation` or `.value` to existing `balanceAmount.amount` copies. No arithmetic, currency conversion, endpoint rewriting, arbitrary destination paths or executable expressions are accepted.

A human may propose a candidate. Optional AI uses the existing provider router to select an allowlisted field or abstain. Only structural field names, destination and type are sent; sample values, tokens and credentials are not. Output is validated and stored as a draft. No semantic equivalence is inferred from a name, and no proposal activates automatically. AI failure leaves scanning, manual proposals and deterministic runtime functioning.

Operator tests the candidate against a fresh consented mock balance call and stored safe examples. Tests record exact value/currency preservation and baseline structural checks. NBG records a semantic review note and approves the tested version. Operator activates it. Fresh schema/baseline changes or subsequent tests invalidate activation eligibility. Runtime checks the pinned versions. Rollback removes the custom mapping and restores the built-in adapter, which rejects still-incompatible data.

No test proves semantic equivalence: the controlled demo is reviewable because its overlay copies the original field exactly and leaves currency and meaning unchanged.

## Reproducible UI demonstration

Use the local preview with BOG and Gringott configured. Credentials remain in the existing private demo credentials file; do not record passwords.

1. **Operator / API contract changes:** Scan both banks. These initial snapshots must be collected with the synthetic overlay disabled.
2. **NBG / API contract changes:** Expand Saved schema versions, inspect each original JSON snapshot, and approve each baseline with a source/applicability review note.
3. **TPP / TPP explorer:** Select BOG and Gringott, grant selected mock consents, then Request selected balances. Both should succeed. Consents are ephemeral and must be granted again after a server restart.
4. **Operator / API contract changes:** Enable BOG's synthetic field change, then Scan OpenAPI. Expand the schema change: original `amount` becomes `sum`. This is a labelled GeoBridge in-memory overlay, not an actual bank change.
5. **TPP / TPP explorer:** Request balances again with the same consents. BOG returns a contract error; Gringott remains successful.
6. **Operator / API contract changes:** Propose exact sum-to-amount mapping, then Test against mock. Inspect original/mapped fields and test results. Optionally Ask AI for a candidate; absence of configured AI is reported explicitly, never simulated as AI success.
7. **NBG:** Review the candidate's meaning and evidence, then Approve meaning. A suitable demo note is: "Controlled overlay copies the original amount exactly; currency, account scope and semantic meaning are unchanged."
8. **Operator:** Activate approved version. **TPP:** Request selected balances. Both succeed; original `sum`, common `amount`, unchanged decimal strings, mapping version and overlay label are shown together.
9. **Operator:** Rollback to built-in adapter. **TPP:** BOG fails closed again while Gringott succeeds. Disable the synthetic overlay and scan BOG to restore the original demo environment. Revoke batch consents when finished.

Account switching in the same browser requires signing in again. For an uninterrupted TPP recording, keep its session in a separate browser profile while another profile performs the review actions; consent references belong to that TPP user and are never shared between owners.

## Future NBG notifications

Schema changes and response mismatches write deduplicated `contract_notifications` records with `audience: nbg`, event identity, related record, timestamp, and `deliveryStatus: not_implemented`. No email, push or delivery claim is made. A future notification worker can consume these records without rescanning or inventing historical events. Delivery retries, destinations, acknowledgement and user preferences are future work.

## Limits

- This is a bounded schema-diff and structural-validation subset, not a complete OpenAPI/JSON Schema conformance engine. It checks required fields, types, enums, local refs, arrays and composition; arbitrary formats/patterns and every schema keyword are not covered. External references are not fetched.
- Some mock specifications (notably current Gringott) omit response schemas. Those reads remain adapter-validated and display that limitation.
- Mapping remediation is limited to exact balance amount aliases; more general schema/endpoint changes are detected and require engineering review.
- Runtime mapping integration covers raw accounts/balances responses; the existing paginated transaction adapter remains authoritative, without new per-page baseline validation.
- The synthetic BOG overlay persists until explicitly disabled. It affects all local users of that configured mock; the confirmation warns about this. It is not a silently expiring external-bank fault.
- Polling runs only while the server is running. No uptime/SLA or guaranteed immediate change detection is claimed.
- AI integration is tested with validated provider doubles and existing provider protocol tests, not a paid live AI invocation in this task.
- Notification delivery is intentionally not implemented.
