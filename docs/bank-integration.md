# Bank integration boundary

The bank adapter runtime is the intentionally deferred component. `src/contracts.mjs` defines its boundary. Do not add guessed auth or generic LLM transformations.

## Information to obtain

1. Exact sandbox, service, OpenAPI JSON/YAML, applicable Georgian profile and amendments.
2. Test-client identity, certificate/signing requirements, supported test signer, token/auth metadata and registered redirects.
3. Synthetic customer/accounts, reset process, consent lifecycle and required scopes.
4. Allowed negative checks, per-consent request quotas, rates/concurrency, permitted observation windows.
5. Permission to identify the institution and show sanitized evidence.

## Domain and IP

A stable HTTPS frontend domain and exact callback path must be registered where required. A `vercel.app` domain may be accepted only if the bank confirms it. The backend's outbound public IP is a separate value; frontend DNS is not an outbound-IP guarantee. Choose hosting that satisfies the bank's allowlist before provisioning production credentials. This local application is not deployed to Vercel yet.

## Implement and verify

- Implement the assigned bank-specific adapter methods, preserving the bank identity and per-TPP signing boundaries.
- Store secrets server-side outside evidence. Provision only synthetic sandbox identities.
- Validate original response signatures and TLS before mapping. Do not forward original signatures over normalized data.
- Persist consent mappings scoped by tenant, connection, consent and bank resource ID. Status must come from the authoritative bank flow, not an operator checkbox or browser redirect alone.
- Implement opaque pagination bounded by tenant/account/filter/adapter and validate every link origin.
- Use a pinned-address outbound transport with approved hosts, rate budget, deadlines, stop/cooldown on 429 and recorded original sanitized observations.
- Verify positive calls, authorized negative cases, revocation, mapping invariants and independent failure fixtures.
- Enable common API operations individually only after successful verification. No whole-bank compliant badge.
- Add real probe jobs and raw benchmark samples. Never turn replay timestamps into fresh external measurements.

The auditor consumes original observations; the TPP mapper consumes verified messages. Keep the two paths distinct. Standards and platform checks must retain their different bases.
