# Standards applicability review

Reviewed scope: source index, document structure, relevant AIS/consent/data/protocol requirements for the agreed account-information prototype. This is an engineering scoping review, not exhaustive normative extraction or a legal determination. Every executable normative candidate still requires human review.

## Source hierarchy

The organizer's assigned sandbox and applicable contract/version must be recorded. Applicable authoritative requirements establish expectations; the bank's OpenAPI describes declared behavior. Examples do not overrule normative clauses. AI is never the authority. Index/document conflicts are NEEDS_REVIEW.

## Collection findings

| Document | Treatment |
|---|---|
| AIS 0.1.0-20240808 | Index says current for loans/deposits. Payment-account sections 6.1–6.3 are unfinished; not a replacement for legacy payment-account AIS. |
| Consents 0.1.0-20240619 | Current for loans/deposits per index. Scope/frequency/permission rules and conditional coexistence require bank capability evidence. |
| Common Protocol Features 2.0.0, 2026-06-12 | Newer common protocol. Distinct from legacy JWS. JSON, error types, UUID request IDs, authorization and signing require profile-specific treatment. |
| Domestic Definitions 1.0.1 | Data semantics, multicurrency identifiers and distinct loan/deposit balance types. |
| Payments 1.2.0 | Registered source, outside current AIS runtime. Do not start transfers. Index describes expanded services and 12 June 2026 standard-payment updates. |
| Push AIS 0.1.0-20251208 | Current but ecosystem support not mandatory per index. Optional, not a baseline failure condition. |
| Identity Assurance 0.4.1-20250419 | Index marks under discussion, not active. Exclude from conformance gates; distinguish older active identity service from this draft. |
| Archived versions | Retained for historical comparisons only. Never execute them as additional current baselines. |
| XS2A 0.8.RC3 / IAA 0.8.RC1 / JWS 0.5.RC1 | Needed for legacy payment-account interfaces. Legacy Word snapshots were fetched from the official association CDN; pin exact assigned profile and review the relevant clauses before activating rules. |

## Material ambiguities and conditions

- AIS text includes a 1 January 2025 payment/cards rollout statement, while the index says the newer payment-account format is not active. Do not declare banks legally late; request authoritative applicability clarification.
- Consent §10.1 coexistence is conditional on payment/card support and legacy interface coexistence. Loan/deposit-only newer consents have an exception. It is not a universal requirement to duplicate all consents.
- Available and accessible account sets differ. Consent category changes what fields may be returned. Never broaden access to make a response pass.
- Account-list tables have conditional and forbidden fields. A field-name locator is not sufficient context for approval; inspect its full row and references.
- AIS pagination §5.6 uses a 50-transaction boundary with contractual exceptions. Loan/deposit profile only unless separately applicable.
- Common §4.2 forbids the Berlin error prefix in returned type despite using it in an informative example. Test normative text, not example copying.
- Common §4.5 UUID requirement and idempotency behavior are separate assertions. Request-ID syntax does not prove safe replay.
- Domestic loan principal is negative, remaining credit nonnegative, total obligation nonpositive, next installment nonnegative. Preserve balance subtype and reference date.
- Reference-only sources include external Berlin Group definitions. Missing those exact error/schema mappings blocks complete conformance assertions.

## Implemented candidate pack

16 draft candidates cover observable account fields, JSON, request ID, error prefix, balance sign and lifecycle placeholders. They are intentionally not auto-approved. The runtime executes approved observable checks only, retaining source hash and review note. Coexistence and revocation stay NOT_ASSESSED without actual lifecycle execution. Whole cryptographic JWS profiles, TLS certificate paths and external auth are not claimed by local RSA tests.

Original-source manifest `sources/manifest.json` hashes original bytes; source registry hashes extracted text separately. `sources/index-extracted.json` preserves readable cell values without screenshot OCR.

## Next bank-dependent review

Get assigned service/profile and amendment list. Review exact bank signing and certificate setup. Confirm authoritative error mappings, permitted negative tests, allowed rates and consent quotas. Map supported operations explicitly, approve test fixtures independently, then activate a pinned ruleset with reviewer identity. Never treat all unimplemented clauses as passed.
