# Temporary Operator QR access

This is reusable full Operator access to the synthetic demo, explicitly intended for invited judges. Anyone with the QR or its link can sign in. Do not publish it in the repository. A newly issued link expires exactly 48 hours after creation; each session lasts at most eight hours and never outlives the link. Expired, revoked, disabled-user, or changed-role grants are rejected. Revoking a grant also invalidates its existing sessions.

Create on the backend host:

```sh
docker exec geobridge node scripts/demo-access.mjs issue /app/data/operator-qr.json
```

The private JSON includes `url`, `id`, and `expiresAt`. Encode `url` locally as a QR code; never submit it to an external QR-generation website. The raw token is stored only in that private delivery artifact; the authentication record stores its SHA-256 hash. The browser removes the URL fragment before redeeming it by same-origin POST. Normal HttpOnly/Secure production cookies, CSRF checks and role permissions still apply. Access issuance and redemption are logged without the raw token.

Revoke immediately using the JSON's `id` (not the token):

```sh
docker exec geobridge node scripts/demo-access.mjs revoke GRANT_ID
```

Issue a new file to create a replacement link; this does not implicitly revoke other links. Tests: `tests/demo-access.test.mjs` covers expiry, revocation and account restrictions; `tests/demo-access-http.test.mjs` verifies real HTTP redemption, origin enforcement, cookie protections and invalidation of a signed-in session.
