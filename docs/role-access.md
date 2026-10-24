# Demo role access

Operator is unchanged: all existing pages and technical controls remain available to the hackathon team. Do not distribute its credentials to jury participants.

| Page | Bank engineer | NBG Reviewer | TPP developer |
| --- | --- | --- | --- |
| Overview | Own bank | Authorized banks | Own integration |
| Audit center | Own bank: run/review | Authorized banks: run/review | No |
| Connections | Own bank: register/upload | Read-only readiness | No |
| TPP explorer | No | No | Published connections, owner-scoped consent |
| Oversight dashboard | No | Authorized banks | No |
| Monitoring | Own bank, audit schedules | Authorized bank monitoring, audit schedules | No |
| Reports | Own bank | Authorized banks | No |
| Standards & rules | Approved applicable rules, read-only | Review and approve | No |
| Release gates | Own bank decisions, read-only | Evaluate and record decisions | No |
| Activity log | Own organization and resources | Authorized audit and review history | Own organization |
| System diagnostics | No | No | No |

NBG cannot register connections, upload specifications, edit credentials, configure technical health probes, control mock outages, or run platform self-checks. Audit schedules belong to the target bank, with a separately recorded requesting user. Raw imported response packs remain restricted to the bank and Operator; NBG sees metadata and audit findings.

## Demo identities

- `bank-bog`: organization `bank-bog`
- `bank-tbc`: organization `bank-tbc`
- `bank-gringott`: organization `bank-gringott` (fictional mock bank)
- `nbg`: combined oversight and standards reviewer; a demo identity, not evidence of NBG participation
- `tpp-demo`: organization `tpp-demo`
- Existing `operator`: unchanged

Passwords are randomly generated per installation and stored only in the ignored private `data/demo-credentials.json` file (or the configured data directory). They are never committed or exposed by HTTP. A local preview using another data directory has its own credentials; these do not automatically become production credentials.

## Existing installations

Startup idempotently adds the scoped identities without rotating Operator. Legacy shared `bank`, `reviewer`, `standards`, and `tpp` accounts are disabled and their sessions invalidated. Schedules owned by retired accounts are disabled with a reason; recreate them under the intended scoped identity.

Known synthetic mock connections using the shared `bank-demo` tenant are assigned to their adapter-specific bank tenant. Explicit nonlegacy tenant settings are preserved. Ambiguous historical runs, packs, connections and saved immutable reports are not reassigned by guesswork: they remain available to Operator and NBG. New audits belong to the appropriate bank. Existing saved report bytes are never rewritten.

Private pending connections are excluded from the TPP catalog. Only configured synthetic connections or explicitly published connections appear there. Common-interface consent remains owner-, organization-, connection-, and account-scoped.
