# Monitoring update

Only monitoring changed. Existing targets, permissions, probe intervals, schedules and evidence retention are preserved. No deployment or secrets are included.

Configured TBC (`tbc-mock-v1` or id `tbc`) uses GET /mock/endpoints and requires HTTP 200 with a nonempty valid operations catalogue. This is service reachability, not health or authenticated AIS availability. Other targets still use GET /api/health with status=ok. No redirects; absolute deadline and bounded response bytes. TBC does not get administration controls. Probe percentages for different probe kinds are not an equivalent bank comparison.

Targets still come only from GEOBRIDGE_MOCK_TARGETS. An explicit monitor:false remains excluded. To show TBC on a server where it is excluded, remove that flag only for the existing TBC target, preserve all other settings, and recreate the container. Use Operator > Monitoring > TBC > Configure to enable checks. New monitors remain disabled by default; the default interval remains 30 seconds. No extra service is contacted if not configured/enabled.

An additive probe_kind column preserves old samples as health evidence. The TBC reachability report filters its own kind so previous missing-health-route failures are not relabelled as reachability failures. Records are not deleted by this migration. Rolling 30-day retention is unchanged.

Each report adds 60 timestamped timeline buckets over its selected window. Colours show only intervals between adjacent probes in the same process/configuration epoch within 2.5 intervals. Time before/after observations, restart/pause and large gaps remains unknown. Tooltip includes time range, successful/failed probe counts and unknown duration. Sample outcome dots do not imply a full interval was covered. Timeline uses full-window samples, not only the last 100 detailed rows.

Expanded cards show success fraction, covered-time uptime and coverage separately, plus down/unknown durations and actual probe cadence. Summary cards show scoped service status counts, unique banks with mock AIS measurement records (not imported reports), and enabled audit schedule count. No pooled latency or misleading combined availability percentage.

Restart the local backend after applying, then refresh. Local code changes do not deploy or change DigitalOcean settings. Preserve data volume, environment, secret mounts and geobridge-mocks network for eventual deployment.
