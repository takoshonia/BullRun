# Signed mock-bank contract notifications

## What is real in this demonstration

A separate HTTP service (`examples/mock-push-bank.mjs`) wraps a configured local BOG-style mock. It changes the bank-facing payment-account **balance** response and that operation's OpenAPI schema, persists an outgoing event, and sends an actual signed HTTP POST to GeoBridge. The existing upstream mock source is not edited. Transaction amount definitions are unchanged.

GeoBridge does not synthesize the incoming event or call Scan as part of the publish action. Its webhook endpoint validates and durably stores the bank event before acknowledging it. A queue worker then triggers an immediate schema scan. The same existing diff and review workflow handles the result. Mapping proposals, AI calls, approval and activation remain separate actions.

This proves the transport and reaction pattern with a synthetic publisher. It is not a TBC/BOG partnership or evidence that either real bank offers contract-change webhooks.

## Private configuration

Leave `GEOBRIDGE_CONTRACT_WEBHOOKS=[]` when no publisher is configured. The endpoint is not usable without a configured per-bank secret.

```json
[{"connectionId":"mock-bog","secretFile":"/run/secrets/bog-contract-signing.key","demoControlKeyFile":"/run/secrets/mock-publisher-admin.key"}]
```

- The bank must also be present in `GEOBRIDGE_MOCK_TARGETS`; its origin must point to the separately configured mock publisher.
- Signing keys are at least 32 bytes, remain server-side and never appear in the workspace, event payloads, history or Git.
- `demoControlKeyFile` is optional and enables Operator-only publisher controls. It is a **different** key from the webhook signing secret. It is not required for a future real-bank webhook receiver.
- No callback URL, bank origin, schema URL or key can be supplied through the webhook payload/browser.

The sender uses `MOCK_PUSH_UPSTREAM`, `MOCK_PUSH_CALLBACK`, `MOCK_PUSH_CONNECTION_ID`, `MOCK_PUSH_SECRET_FILE`, `MOCK_PUSH_ADMIN_KEY_FILE`, `MOCK_PUSH_STATE_FILE` and `PORT`. Its CLI binds to loopback. Callback HTTP is allowed only for loopback testing; other callbacks require HTTPS. The proxy is for synthetic mocks only, not real-bank traffic.

## Protocol

`POST /api/webhooks/contracts/mock-bog` with JSON:

```json
{"type":"api.contract.changed","connectionId":"mock-bog","revision":"sum-1","synthetic":true}
```

Headers:

- `X-GeoBridge-Event-Id`: stable UUID for the event, reused on retry.
- `X-GeoBridge-Timestamp`: Unix seconds, refreshed on each delivery attempt.
- `X-GeoBridge-Signature`: `sha256=` followed by HMAC-SHA256 hex of `timestamp + '.' + eventId + '.' + rawBody`.

This is a project-specific mock protocol, not a universal banking standard. GeoBridge accepts only configured banks, exact supported event shape, valid signatures and timestamps within five minutes. Comparison is constant-time; body size is capped at 16 KB. The signed endpoint uses its own authentication, while the existing browser APIs retain session, Origin and CSRF protections.

GeoBridge acknowledges persisted receipts with HTTP 202. Duplicate event identities with the same body return the existing receipt without rerunning a processed scan. Reusing an ID with a different payload is rejected. Each bank has a bounded pending queue. Acknowledgement means **received**, not **schema scan succeeded**.

## Durability and retries

Both publisher outbox and GeoBridge receipt queue survive restart. Failed sends/scans retry up to eight attempts with bounded exponential backoff. An interrupted GeoBridge worker is resumed. Busy scans are retried, rather than silently discarding a newer notification. Distinct verified events can bypass the normal notification coalescing delay; duplicate deliveries cannot.

After retry exhaustion, history says `failed`; Operator can inspect the failure and use a manual scan. There is no automatic mapping activation. A notification is only a hint: GeoBridge fetches the schema from the fixed configured origin rather than trusting a schema in the event.

The daily scan remains a fallback for missing notifications. Availability checks remain independent. The open review page refreshes GeoBridge's notification history every three seconds only when mock push is configured; **that refresh does not fetch bank schemas**.

## Run the local demonstration

1. Start the existing BOG mock on `127.0.0.1:4183` and Gringott on `127.0.0.1:4184`.
2. Using Node 24, run `node examples/start-mock-push-demo.mjs` from the repository. This starts a publisher on 4185 and a separate GeoBridge demo on **http://127.0.0.1:4320/**. Its database, keys, publisher outbox and generated credentials live in ignored `data/push-preview/`. The existing preview and production are unchanged.
3. Sign in as Operator using that demo's private `demo-credentials.json`. Open **API changes & adapter review** and expand the BOG push demo card.
4. Capture the initial schema with **Scan OpenAPI** if it has not already been captured by the scheduler. This one initial reference is necessary for showing a diff.
5. Click **Publish mock field change**, then confirm in the in-page dialog. Do **not** click Scan again.
6. Watch **Mock bank change notifications**: the bank/revision, verified receipt time and automatic scan status appear. Status becomes `processed`; a new saved schema and balances-only diff appear below automatically.
7. NBG can inspect the same receipt/history but cannot publish changes. TPP and bank accounts cannot access the review/control API.
8. If showing TPP remediation, first approve the original baseline as NBG and grant the TPP's own bank consent. The publisher's changed response fails the existing contract until the existing mapping test/review/activation process is completed. The integration test verifies exact amount preservation after activation, with `syntheticOverlay:false` because the change came from the separate mock service.
9. Click **Restore mock field**. The mock bank emits another signed event and GeoBridge automatically captures the return to the original schema. Roll back an active custom alias as appropriate; restoration does not silently rewrite mapping approvals.

The launcher requires the upstream mock sources/services already used by the project. It does not bundle or modify those external sources. Stop the demo launcher to stop its publisher and separate backend. Publisher field state is persisted, so restore it explicitly before recording a fresh scenario.

## Verified behavior and limits

Tests cover real local HTTP delivery, automatic scans without a second Scan action, tampered/stale/forged payloads, cross-bank spoofing, duplicate/conflicting IDs, restart recovery, publisher retry identity, exact-value adapter remediation, role boundaries and unchanged CSRF protections. An older Gringott test expectation was aligned with the bank-audit visibility policy already present in main; no production access policy was relaxed.

No real bank is connected. Delivery is near-real-time, not guaranteed instantaneous. A real integration requires the bank to support a suitable event feed, register GeoBridge, agree its authentication/retry protocol and provide a test environment. That cannot be enabled unilaterally by GeoBridge. Future outgoing notifications to NBG remain separate and are still not delivered by this feature.
