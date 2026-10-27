# Authentication and sessions

GradeVision uses a **backend-for-frontend (BFF) session** model. Implemented and
tested 2026-10-26; replaces the earlier stateless JWT-in-localStorage design.

## 1. How a browser session works

1. `POST /api/v1/auth/login` with email + password (Argon2id). A failed login is
   always the generic `401 Invalid email or password`; 10 failures per (email,
   client address) in 15 minutes give `429`.
2. The API creates a row in `auth_sessions` for a fresh 256-bit random token and
   stores **only its SHA-256 hash**. The token is sent once, in a cookie:
   `gv_session` (`__Host-gv_session` when Secure) - `HttpOnly`, `SameSite=Strict`,
   `Path=/`, `Secure` when `SESSION_COOKIE_SECURE` (default: on in production).
   Page scripts can never read it, and nothing is stored in localStorage.
3. The response carries a **CSRF token**: `HMAC-SHA256(SESSION_SECRET, "csrf:" +
session id)`. The web app keeps it in memory only and re-reads it from
   `GET /api/v1/auth/session` after a reload.
4. Every request re-loads the session and the user: revoked, expired (absolute
   `SESSION_ABSOLUTE_HOURS`, default 12) or idle (`SESSION_IDLE_MINUTES`,
   default 60) sessions and deactivated users get `401`; the user's **current**
   role from the database is used - nothing role-related is trusted from the
   client.
5. State-changing requests authenticated by the cookie must (a) come from an
   origin listed in `API_CORS_ORIGIN` (Origin, else Referer) and (b) carry
   `X-CSRF-Token`; otherwise `403 CSRF_FAILED`. A sign-in from a foreign origin
   is refused too (login CSRF).
6. `POST /api/v1/auth/logout` revokes the session server-side and clears the
   cookie. Signing in again revokes the session the browser carried (rotation).
   An admin role change, deactivation or password reset revokes all of that
   user's sessions.

**Non-browser clients** (scripts, tests) may sign in with `mode: "token"` to get
the same opaque session token in the body and send it as
`Authorization: Bearer <token>` - same table, same checks, no CSRF needed
because browsers never attach that header automatically. Token mode is off by
default in production (`AUTH_TOKEN_LOGIN`).

**Socket.IO** authenticates the handshake with the same session (the cookie, or
an opaque token), re-checks the session, user status and role on every
`subscribe` event, keeps room joins ownership-checked, and disconnects live
sockets as soon as their session is revoked.

**CORS** is credentialed and allows only exact origins from `API_CORS_ORIGIN`;
`*` or malformed origins stop the API at startup.

### Frontend behaviour

- `apiRequest` always sends `credentials: "include"` and adds `X-CSRF-Token` to
  non-GET requests; it never sets an `Authorization` header.
- A `401` on any request other than the sign-in/session probes means "your
  session ended": the app drops to signed-out, shows _"Your session ended. Sign
  in again to continue - autosaved drafts are kept."_, and returns the user to
  their page after signing in - only if that page belongs to their role's area.
- Separate browser profiles have separate cookie jars, so two people (or roles)
  can be signed in side by side; signing out in one does not affect the other
  (verified by `apps/web/scripts/browser-smoke.mjs`).

## 2. Configuration

| Variable                  | Default                      | Notes                                                                  |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `SESSION_SECRET` ◆        | (falls back to `JWT_SECRET`) | >= 32 chars; keys CSRF tokens                                          |
| `SESSION_IDLE_MINUTES`    | `60`                         |                                                                        |
| `SESSION_ABSOLUTE_HOURS`  | `12`                         |                                                                        |
| `SESSION_COOKIE_SECURE`   | `true` in production         | must be `true` behind HTTPS                                            |
| `SESSION_COOKIE_SAMESITE` | `strict`                     | needs the web app and API on the same _site_ (same registrable domain) |
| `AUTH_TOKEN_LOGIN`        | `false` in production        | token mode for scripts                                                 |
| `PASSWORD_LOGIN_ENABLED`  | `true`                       | turn off once an identity provider is the only sign-in                 |
| `API_CORS_ORIGIN`         | `http://localhost:5173`      | exact origins, comma-separated                                         |

`JWT_EXPIRES_IN` is no longer used.

## 3. What is tested (apps/api/src/modules/auth/auth.test.ts, admin.test.ts, security.test.ts, realtime tests)

Cookie flags; only the hash stored; token mode; generic login failures;
foreign-origin sign-in refused; rotation; `GET /auth/session`; CSRF refused
without token / with a wrong token / another session's token / foreign or
missing Origin; logout invalidation; bearer path without CSRF; immediate role
change and deactivation; idle, absolute and revoked sessions; forged JWTs and
edited tokens; throttling; admin role change / deactivation / password reset
ending sessions; Socket.IO cookie handshake, revoked handshake, live disconnect
on logout, per-event re-check after deactivation. Browser: two concurrent
profiles, HttpOnly cookie not visible to scripts, empty web storage, CSRF-less
request refused, session-ended flow after a server-side logout.

## 4. Single sign-on (OIDC) - decision and next milestone

**Not implemented in this sprint, deliberately.** OIDC (authorization code +
PKCE against a locally hosted IdP such as Keycloak or Zitadel) was evaluated
against this machine and the codebase:

- Memory: the laptop has 15.7 GB with 0.6-2 GB free while browsers run. The
  local model alone needs ~1.1 GB, and under memory pressure its cold start was
  measured at 188 s (vs 5-9 s with ~1.9 GB free). A JVM IdP (Keycloak, roughly
  0.4-0.7 GB) would compete directly with it; no IdP is installed today.
- An end-to-end tested flow (issuer, audience, state, nonce, PKCE, redirect URI,
  JWKS signature, expiry, error paths, plus MFA) could not be completed and
  verified in this sprint without either skipping validation or shipping an
  untested login screen - both ruled out.

The BFF session layer above is the prerequisite either way: an OIDC login ends
by calling the same `createSession`, so cookies, CSRF, revocation, Socket.IO and
the frontend do not change. The isolated milestone is:

1. Migration: `user_identities (id, userId, issuer, subject, createdAt)` with a
   unique `(issuer, subject)`; roles stay in `users` and are never taken from
   IdP claims.
2. `GET /auth/oidc/start` (state + nonce + PKCE verifier in a short-lived,
   HttpOnly, signed cookie) and `GET /auth/oidc/callback` (code exchange,
   ID-token verification with `jose` against the issuer's JWKS: `iss`, `aud`,
   `exp`, `iat`, `nonce`; exact redirect URI), linking by `(iss, sub)` to an
   existing active account - no self-registration.
3. Tests against an in-process fake OIDC provider (generated key pair, discovery,
   JWKS and token endpoints) covering every validation failure; the real IdP is
   not needed in CI.
4. A local Keycloak/Zitadel realm export with demo identities and TOTP required
   for instructors/admins; passkeys only claimed once actually enrolled and
   exercised.
5. `PASSWORD_LOGIN_ENABLED=false` in production once SSO is live.
