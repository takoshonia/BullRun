# Real TBC sandbox integration — manual authorization required

The mock TBC adapter remains unchanged. The bank-operated sandbox has a separate
operator connection card, OAuth callback and encrypted token storage. It is not
registered as a mock adapter and does not yet run the existing audit suites.
Do not label this as a completed bank connection before manual authorization
and a verified accounts read have succeeded.

## Verified on the deployment server

- Bank-provided QWAC and QSEAL PFX bundles contain private keys and their
  password works. Material is outside the repository in
  `/opt/geobridge-secrets/tbc-sandbox`, directory mode 700, files mode 600.
- TLS-verified discovery succeeds at
  `https://test-api.tbcbank.ge/.well-known/oauth-authorization-server`.
- Discovery returns authorization endpoint
  `https://test-api.tbcbank.ge/psd2/openbanking/oauth/authorize` and token endpoint
  `https://test-openbanking.tbcbank.ge/openbanking/oauth/token`.
- The initial signed consent preflight stopped during TLS validation with
  `SELF_SIGNED_CERT_IN_CHAIN`. No consent was created by that attempt.
- Follow-up investigation found the issuer download URL in the bank's public
  server certificate. Both intermediate and root were fetched over independently
  verified HTTPS from `aia.test.ob.bankingassociation.ge`; fingerprints match
  the observed chain and OpenSSL verifies the bank leaf successfully.
- With that scoped root, discovery on the original `test-openbanking` host
  returns HTTP 200, valid JSON metadata and verified TLS using our client PFX.
- A signed read-only status request for a deliberately nonexistent consent
  reaches the application and returns HTTP 403 / `CONSENT_UNKNOWN`. This is an
  expected missing-resource result, not proof of a completed AIS authorization.
  The response includes a GBA Seal certificate chain but omits `x-request-id`
  although its JWS lists that header. Strict response verification currently
  rejects this error response; do not silently bypass it for real AIS results.

## Remaining registration questions

1. Confirmation of the OAuth `client_id` and redirect registration. The
   certificate organization identifier is only a candidate client ID.
2. Determine the exact response-signature behavior on successful responses;
   the deliberately nonexistent-consent error has the issue described above.

Update: a corrected consent POST with `TPP-Redirect-URI` returned HTTP 201,
echoed our request ID, and passed strict body digest, signature, TBC signer
identity and GBA trust-chain verification. The error-path omission remains
fail-closed. The certificate organization identifier is configured as the
candidate client ID; browser authorization will confirm registration.

Public CA downloads (retrieved successfully from the deployment server with
normal HTTPS validation):

- https://aia.test.ob.bankingassociation.ge/GBANoTrustOBWACCA.crt
- https://aia.test.ob.bankingassociation.ge/GBANoTrustRootCA.crt

The authenticated root PEM is stored at
`/opt/geobridge-secrets/tbc-sandbox/gba-sandbox-root.pem`. No running app or
system trust store has been changed.

The observed TLS root identifies itself as `GBA NoTrust Root CA`, fingerprint
`8D:7D:45:70:0E:50:91:C1:D2:D6:D8:58:18:B6:BE:B2:74:A8:24:1F:AC:00:8B:F7:E8:66:F6:08:8D:D5:F9:86`.
The initial network observation alone was not a trust decision; the matching
verified-HTTPS issuer download subsequently supplied authenticated provenance.
Do not disable certificate verification or install an unverified CA system-wide.

## Transport configuration

Constructor configuration accepts paths for `passwordFile`, `qwacFile`,
`qsealCertificateFile`, `qsealKeyFile`, and optional authenticated `tlsCaFile`
and `signingCaFile`. The QSEAL PEM key remains encrypted. TLS trust additions
are scoped to this client. Response signatures require a trusted signer and
the TBC organization identifier. Diagnostic mode is only for isolated operator
preflights; its output must never become an authenticated AIS result.

The transport restricts destinations to the two sandbox hosts, pins validated
public DNS addresses per request, uses a 15-second deadline and 2 MB response
limit, does not follow redirects or retry POSTs, and observes 429 cooldowns.

## Implemented authorization controls

- Operator password sessions only; QR demo sessions are excluded.
- PKCE S256, random state and nonce, ten-minute one-use pending flow bound to
  the original live session and a separate HttpOnly/Secure/SameSite=Lax cookie
  scoped to the callback. The main Strict session cookie is unchanged.
- OAuth token exchange over verified mTLS. AES-256-GCM token storage with an
  external 32-byte key and record-specific authenticated encryption context.
- Manual reconnect on expiry. Local disconnect explicitly reports that it does
  not revoke the bank-side consent. No automatic scheduled real-bank calls.
- An operator-only accounts read with strict AIS JWS verification and redacted
  account output. Tokens, authorization codes and passwords are never returned
  by application endpoints or audit events.

## Deployment configuration and next validation

Mount the prepared directory read-only at `/run/tbc-sandbox`, accessible only
to the container's node user and root. Set `GEOBRIDGE_TBC_SANDBOX_DIR` to that
path and `GEOBRIDGE_TBC_SANDBOX_CLIENT_ID` to the registered identifier.
`token-encryption.key` must be 32 random bytes and retained across deployments;
back it up privately alongside database backups. Never generate a new key on
each startup. `GEOBRIDGE_TBC_TRUST_PROXY=1` enables validated IP parsing from
the Vercel/Caddy forwarding headers on this deployment; omit it for direct
access where forwarding headers cannot be trusted.

After deployment, sign in normally as Operator, open Connections, choose
Connect TBC sandbox and authenticate with the bank test user on TBC's page.
After returning to GeoBridge, read sandbox accounts to verify end-to-end access.

## Remaining AIS/audit work after user authorization

- Implement real AIS accounts, balances and transactions with bounded pagination;
  preserve original evidence separately from normalized common AIS data.
- Connect approved audit rules without presenting sandbox or health checks as a
  production compliance certification. Require manual bank test-user login.
- Back up the database and preserve existing container configuration before any
  deployment. No credentials or PFX files belong in GitHub or browser code.

Signature behavior follows the bank's official reference:
https://github.com/TBCBank/TBC.OpenBanking.Jws

Unit tests use a clearly marked, synthetic test-only certificate/key fixture;
they do not load the bank's private material or call bank endpoints.
