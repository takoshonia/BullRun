# Role-specific workspaces

Each login opens its own home, with matching desktop and mobile navigation. Refresh restores the correct role home. Signing out or switching accounts clears previously viewed runs, filters and workspace data in browser memory.

| Role | Landing page | Visible work |
|---|---|---|
| Operator | Overview | Platform administration and all development workflows |
| Bank engineer | Your bank audits | Own connections, evidence, audits, monitoring, reports, applicable rules and release decisions |
| TPP developer | TPP explorer | Sanitized connection catalog, common contract and mapping preview, own activity |
| Oversight reviewer | Oversight dashboard | Authorized diagnostic evidence, measurement comparisons, coverage and reports; read-only |
| Standards reviewer | Standards review desk | Pending/approved rule counts, source snapshots, rule review, draft source changes and governance activity |

The standards role does not receive bank connection configuration or audit records. The TPP role receives a minimal capability catalog, not private connection URLs/specification hashes, audit evidence or the rule approval queue. Oversight does not receive raw response packs or raw measurement CSV exports. Backend restrictions enforce these boundaries independently of the menu.

Bank API uploads now record the specification and queue selected static declaration checks. Approved source rules can inspect JSON response declarations, UUID request headers and selected required account-schema fields. Draft rules remain NEEDS_REVIEW. Local references are resolved without fetching external schemas. Static declaration checks do not constitute a full standards audit or establish actual bank behavior. Response-evidence checks also remain review-gated. Live execution, signing and consent workflows remain bank-integration work. This update does not claim to add full standards coverage.

Additional fixes: successful logins no longer consume the failed-login throttle; CSV text cells escape formula prefixes; role routes cannot render another role's page through client state; no-data messages are role-appropriate; bank audit actions emphasize bank evidence rather than platform self-tests.

Local passwords, sessions, database records, generated credentials and Git history are not replaced by this update.
