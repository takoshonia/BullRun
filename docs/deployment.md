# Deployment

## First: obtain a real domain for TBC

The root vercel.json builds only deployment/domain into vercel-output. It does not deploy the Node server, publish banking documents or expose local passwords. Import this repository into Vercel, use the Other preset (framework null), root ./ and the repository's configured build settings. No environment variables are required for the domain-only deployment. Confirm the actual production domain in Vercel after deployment; a project name does not guarantee a particular available domain. Give TBC the confirmed domain, not a preview deployment URL.

The page honestly says integration is in preparation. No callback endpoint is implemented or simulated. Do not start bank authorization until its callback, state validation and token exchange are implemented and tested.

## Full application backend

Run Dockerfile on a single long-running server with persistent /app/data. Node 24 is required. Set GEOBRIDGE_ORIGIN to the exact public HTTPS origin, GEOBRIDGE_HOST=0.0.0.0 and GEOBRIDGE_DATA_DIR=/app/data. The host supplies PORT. The persistent directory must be writable by the node user (UID 1000). Keep a backup of this directory; never commit it. Worker threads and scheduler execute inside the same server process. Do not scale to multiple replicas with this scheduler/SQLite architecture.

deployment/render.yaml.example is an optional paid Render configuration, not an active automatic deployment. Review price before using it. Free ephemeral hosting does not preserve this application's database. The image excludes local accounts and creates separate random hosted demo credentials on first startup; retrieve demo-credentials.json privately from the persistent volume. Do not print or publicly serve that file. Health check: /api/health. No bank certificates or AI keys are bundled.

Once the backend works, set BACKEND_URL in Vercel to its HTTPS origin without a trailing slash. Replace root vercel.json with deployment/vercel-backend.example.json and redeploy. All paths are proxied to that fixed backend, keeping browser requests on the Vercel origin. GEOBRIDGE_ORIGIN on the backend must match that Vercel origin. Verify secure session cookies, CSRF, role isolation, job completion, and persistence after restart before sharing the working demo.

TBC's consent-page public IP and the backend's outbound IP may differ. Confirm which require allowlisting. A Vercel domain does not establish a fixed outbound IP. Certificates and AIS consent/token integration remain separate implementation work.

References: https://vercel.com/kb/guide/is-sqlite-supported-in-vercel ; https://vercel.com/docs/project-configuration/vercel-json ; https://render.com/docs/disks
