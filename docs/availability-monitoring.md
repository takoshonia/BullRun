# Synthetic API availability monitoring

Implemented against main's existing monitoring UI, independently of the cancelled feature/mock-banks deployment. Nothing is auto-deployed. Existing users, runs, rules and schedules are retained. SQLite gains two additive tables and an index; no destructive migration runs.

## Deployment configuration

1. Deploy the prepared Gringott mock as a private container using its README. Do not publish port 4173 on a public interface. Retain the admin key privately on the host.
2. Connect GeoBridge to the same user-defined Docker network (`geobridge-mocks`). The mock hostname is `gringott`. Preserve GeoBridge's existing `geobridge-data:/app/data` volume, production origin, loopback published port and other environment settings. Back up SQLite consistently before replacing the container.
3. Mount `/etc/gringott/admin.key` read-only into BOTH containers at `/run/secrets/gringott-admin.key`. Its containing host directory must be root-only and the mounted file readable by the container's node user. Do not commit/copy keys into images.
4. Add this process environment value to GeoBridge:

```json
[{"id":"gringott","name":"Gringott mock","origin":"http://gringott:4173","tenant":"bank-demo","adminKeyFile":"/run/secrets/gringott-admin.key"}]
```

Variable: `GEOBRIDGE_MOCK_TARGETS`. Optional adminKeyFile: omit to disable the GeoBridge switch but keep monitoring. No key/target origins are returned to the browser. This narrow synthetic configuration deliberately permits private HTTP service addresses; it DOES NOT relax general real-bank URL restrictions. Never configure a production bank or arbitrary untrusted URL here. Monitoring currently supports only health endpoints that return HTTP 200 and JSON `status: ok`.

Mock source currently lives under `untracked/gringott-sandbox`, outside tracked application sources. Package/deploy it separately; it is not part of the GeoBridge Docker image. Full Gringott AIS/consent adapter remains separate work.

## User walkthrough

1. Sign in as operator, open Monitoring, find Synthetic API availability.
2. Configure: enable, interval 5 seconds for a quick demo (30 seconds for normal operation), deadline 1–2 seconds. Deadline must be shorter than interval. Settings persist across restart; enabled monitors resume automatically.
3. Wait for a successful probe (UP). API OFF makes health, AIS and simulated OAuth requests receive no headers/body; the monitor reaches its absolute deadline. Existing in-flight requests can still finish. The admin control remains available.
4. Wait for DOWN and at least two failed probes. The scheduler continues checking; no browser tab needs to remain open.
5. API ON restores new requests. Wait for UP and inspect the closed incident. Current state is observed, never inferred from pressing the switch.
6. Report & export shows checks, success %, estimated covered-time uptime, estimated down time, unknown time, incidents and last 100 detailed probes. JSON and CSV exports are available; the report also appears in Reports. The default window is rolling 24 hours; API accepts `from` and `to` Unix milliseconds for windows up to 30 days.

Gringott console also has API OFF/ON controls after admin unlock. `POST /api/admin/availability` accepts `{"online":false,"mode":"no_response"}` or `{"online":false,"mode":"http_503"}`. Restore with `{"online":true}`. Requires `X-Gringott-Admin-Key`. It works during both outage modes. Mock availability resets to ON on mock process restart, because it is synthetic in-memory state.

## Measurement semantics

- Success = HTTP 200, valid JSON, `status` exactly `ok`. HTTP error, redirect, malformed/oversized body, connection failure or deadline expiry fails the probe. No redirects are followed; bodies are limited to 8 KiB; absolute deadlines include DNS/connect/body time.
- Success % = successful probes / all recorded probes. This is distinct from estimated uptime %.
- Estimated duration uses the last sampled state between adjacent probe completions. A failed sample marks DOWN until the next adjacent sample, including recovery. The interval must stay in the same process/configuration epoch and within 2.5 configured intervals. Scheduling is best effort, not real time.
- Time before the first sample, after the last sample, while paused, across restart/configuration changes, or across a large scheduling gap is UNKNOWN. It is excluded from uptime's denominator and disclosed separately as coverage. No uninterrupted downtime is claimed across unknown gaps.
- Incidents start at first detected failure, record preceding success when known, and close at first successful adjacent observation. Duration from detection is an estimate; a timeout is recorded when its deadline expires. Unknown gaps interrupt incidents. No exact outage boundary or monthly SLA is inferred.
- Current status is unknown if evidence is stale or from before the current process/configuration epoch. Paused is explicit. Historical samples survive restarts.
- At most one probe per target is in flight, and manual requests respect the interval. Up to 10 operator-configured targets. Settings: interval 5–3600s, deadline 1–10s shorter than interval. No catch-up storm for missed probes.
- Evidence retention is rolling 30 days, pruned on probe completion. Back up the database for longer history. Default report is the last 24 hours; it does not invent uptime for the full window.

## Permissions and boundaries

Operator/bank can configure scoped targets and request due probes. Oversight can read scoped reports only. Only operator can switch a mock. TPP/standards cannot read monitoring. Existing session, tenant and CSRF checks apply. The mock independently requires its admin key.

One long-running GeoBridge instance owns the scheduler, consistent with the current SQLite architecture. Do not horizontally scale this implementation without a distributed job lease and shared storage. Same-host mock timings and outages are synthetic; a health endpoint does not prove balances/transactions or token authorization work. Full bank operation probes require explicit bank adapters, permitted quotas and approved test scope.

## Verification

`node --test tests/availability.test.mjs` checks estimation, unknown gaps, restarts, pause, interval/deadline constraints, target validation, interval throttling, real HTTP silence/errors/redirects/oversized responses. Run the existing application suite as well.

`node untracked/gringott-availability-e2e.mjs` runs the actual prepared mock and GeoBridge locally with disposable credentials/database and verifies UP → silent timeout → repeated failures → recovery, incident/report persistence during the run, CSRF, role permissions, secret isolation and JSON/CSV exports. It does not modify deployed data. Requires Node 24+.

