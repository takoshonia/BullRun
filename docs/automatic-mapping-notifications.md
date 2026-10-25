# Delivered notifications and pre-approved mapping automation

## Behavior

NBG, the affected bank and Operator receive a durable in-app notification for contract changes, response mismatches, mapping review/activation/rollback and automatic-policy decisions. Other banks and TPP users cannot read these inboxes. An authenticated server-sent event stream updates the unread badge and displays a live notice while the app is open. Offline users retain the inbox until sign-in. Delivery timestamps and per-user read state are separate. The event cursor/outbox retries interrupted delivery without duplicate messages. No email is sent or claimed; a future configured email transport should consume the outbox with its own independent delivery/receipt status.

A policy can be authorized only from a previously tested, NBG-approved exact balance mapping. It pins the bank, original/changed schema IDs and hashes, candidate hash and approved baseline. NBG records a semantic authorization note; Operator enables it only while the exact original schema is current. Policy expires after seven days. There is no wildcard matching, inferred semantic equivalence or AI in the runtime/automatic path.

When that exact original-to-changed transition is scanned, the worker runs a fresh live/saved-example mapping test. Only if the policy, schema and baseline still match does its delegated authorization permit activation. A return to the exact original schema runs a default-adapter/baseline test before restoring the built-in adapter. Manual rollback disables enabled automatic policies for that bank. Failed or interrupted jobs disable the policy for manual review. Unrecognized schema versions never qualify. Original audit failures remain immutable; yellow recovery additionally requires a successful TPP balance request after activation.

## Demo steps

1. Operator opens **API changes & adapter review**, expands BOG, and uses **Scan OpenAPI**. The separate private publisher must be configured; Gringott stays unchanged.
2. NBG inspects the original synthetic schema and approves it as baseline, recording its scope.
3. TPP grants separate simulated BOG and Gringott consents and requests both balances; both succeed.
4. Operator clicks **Publish mock field change**, then confirms. BOG's separate publisher changes its own balance response/schema and sends a signed event. GeoBridge scans automatically. Inbox notifications reach NBG and the BOG bank account.
5. TPP requests both balances again: BOG returns a contract error, Gringott succeeds independently.
6. Operator proposes the detected exact `sum` to `amount` candidate and runs **Test against mock**. NBG reviews its synthetic semantics and approves. Operator activates it. TPP repeats the request; both succeed, with unchanged exact decimal strings/currencies and mapping-version proof.
7. NBG uses **Pre-authorize exact recurrence**, explicitly authorizing that bank and the exact two schemas, mapping and tested original restoration for seven days.
8. Operator restores the mock field, scans automatically, and manually rolls back the mapping. Then enables the approved policy while the original schema is current. (Manual rollback disables already-enabled policies; enable only after restoring.)
9. Publish the exact same synthetic change again. The worker automatically tests, applies the delegated approval and activates the mapping. No new NBG/Operator approval is requested. TPP reads succeed; a successful TPP read establishes yellow resolution status for matching historical failures.
10. Restore the original field. The policy automatically tests and restores the default adapter. An unknown schema or failed test instead stops automation for review. Notification inbox and policy history show the outcomes.

## Limits

This demonstrates synthetic bank contracts, not real-bank integration or certification. Exact hashes intentionally reject even an unrelated document revision until separately reviewed. A passing test is not proof of semantic correctness; the initial explicit authorization supplies that decision. Recovery evidence is operation-specific, not an SLA. In-app delivery requires sign-in to see the inbox; live notices require the page to be open. Email, SMS and browser/OS push are not configured.
