# Architecture

GradeVision Insights is a pnpm monorepo. Each deployable unit is its own package
with an explicit dependency direction and no hidden coupling.

```
apps/web ──HTTP──▶ apps/api ──▶ @gradevision/database ──▶ Prisma ──▶ PostgreSQL
                      │
                      ├── @gradevision/shared        (cross-app types/constants)
                      │
   services/evaluator ┘  (separate service, called later — not wired yet)
   services/hint-engine   (separate service, called later — not wired yet)
```

## Frontend → API

`apps/web` (React + Vite) is a pure client. It talks to `apps/api` over HTTP at
`VITE_API_BASE_URL` and knows nothing about the database or Prisma. The canonical
API base path is `/api/v1` (`API_V1_PREFIX` in `@gradevision/shared`). The client
and API share only the small HTTP contract in `@gradevision/shared` (response
envelopes, the version prefix, `AuthUser` / `UserRole`) — never Prisma types.

Auth plumbing only (no login UI yet): `src/lib/api-client.ts` (prefixes `/api/v1`,
attaches the bearer token, unwraps `{ data }` / `{ error }`), `src/lib/auth-storage.ts`
(the single place a token is stored), and `src/lib/auth-context.tsx`
(`AuthProvider` / `useAuth`). **Security tradeoff:** the token currently lives in
`localStorage` (XSS-readable). `auth-storage.ts` is the only file that touches
storage and `api-client.ts` the only one that sends the header, so moving to an
`httpOnly` cookie later is a two-file change, not an architecture change. The JWT
secret never exists in the frontend.

## API layered architecture (`apps/api/src`)

```
server.ts    process entry: load env, start HTTP server, graceful shutdown
app.ts       build the Express app: middleware, routers, error handling (no I/O)
env.ts       the ONE validated config source (Zod); nothing else reads process.env
config/      derived app config (API prefix, body limits, CORS options)
middleware/  request id, request logging, body validation, 404 + error handler
routes/      central API router mounted at /api/v1
modules/     one folder per domain area — the vertical slices
  <module>/
    <module>.routes.ts       HTTP shape only: path + method + middleware
    <module>.controller.ts   translate HTTP ⇄ domain; no business rules
    <module>.service.ts      business logic; orchestrates repositories
    <module>.repository.ts   data access via @gradevision/database
    <module>.schema.ts       Zod schemas for request payloads
services/    app-wide infrastructure (database ping/disconnect)
utils/       ApiError, response helpers, logger
```

`modules/health` and `modules/auth` are fully implemented (routes → controller →
service → repository). `users`, `courses`, `assessments`, and `questions`
currently contain only their route boundary; CRUD is deferred.

### Request lifecycle

`requestId → requestLogger → cors → json/urlencoded (1 MB cap) → /api/v1 router →
notFoundHandler → errorHandler`.

All errors converge on one handler and are returned as
`{ "error": { "code", "message", "details"? } }`. `details` is attached only to
4xx (client) errors. Stack traces and internal messages are never sent to clients;
5xx responses are always the generic `INTERNAL_ERROR`. Successful feature
endpoints return `{ "data": ... }`; the health endpoint is intentionally exempt so
uptime probes get a flat body.

## API → database

`apps/api` depends on `@gradevision/database` and imports the **single** Prisma
client (`prisma`) it exports. The API never constructs its own `PrismaClient`.

```
apps/api  →  @gradevision/database  →  Prisma  →  PostgreSQL
```

### Why Prisma is isolated in the database package

- **One client, one schema owner.** Multiple `PrismaClient` instances exhaust the
  connection pool and drift apart. The domain model has exactly one home
  (`database/prisma/schema.prisma`) and one generated client.
- **Swappable data layer.** Consumers depend on `@gradevision/database`'s surface,
  not on Prisma internals, so migrations/tuning stay in one place.
- **Reuse.** A future worker in `services/evaluator` can use the same package
  without copying schema or client setup.

### Why route handlers contain no business logic

Handlers are thin: parse/validate the HTTP request, call a service, shape the
response. Business rules and persistence live in `service` / `repository` so they
can be unit-tested without Express, reused by non-HTTP callers (queue workers,
scripts), and kept free of framework details. Prisma calls never appear in a
route handler.

## Authentication & authorization

First stage: **stateless HS256 JWT access tokens**. No refresh tokens, no
sessions table, no SSO yet.

```
Client
  │  POST /api/v1/auth/login  { email, password }
  ▼
API  ── loginSchema (Zod, email normalised) ──▶ auth.service.login
                                                  │  findUserByEmail
                                                  │  verifyPassword (Argon2id)
                                                  │  isActive?
                                                  ▼
                                          signAccessToken  → { accessToken, user }
  │
  │  Authorization: Bearer <jwt>   (on every subsequent request)
  ▼
authenticate ──▶ verify signature + expiry ──▶ req.auth = { userId, role }   (401 on any failure)
  ▼
requireRole(...) ──▶ req.auth.role ∈ allowed?   (403 if not)
  ▼
controller ──▶ service ──▶ repository
```

**Password hashing** — Argon2id via `@node-rs/argon2` (prebuilt native bindings;
no build toolchain on any platform). Parameters follow the OWASP 2024 cheat
sheet (19 MiB / t=2 / p=1). `hashPassword` / `verifyPassword` live in
`modules/auth/password.ts`; `User.passwordHash` stays a hash and is never
returned by the API. Unknown-email logins still run a dummy verify so response
timing does not reveal whether an account exists.

**JWT contents** — `{ sub: <userId>, role: <UserRole>, iat, exp }` and nothing
else: no name, no email, no password, no mutable state. Secret and lifetime come
from `JWT_SECRET` / `JWT_EXPIRES_IN` (validated in `env.ts`; the API refuses to
start without a ≥32-char secret). The secret is never logged and never reaches
the frontend.

**Authentication vs authorization** — separate middleware. `authenticate`
answers "who is this?" purely from the verified token (identity/role from the
request body is never trusted). `requireRole(...roles)` answers "may they?" and
returns 403 for an authenticated user without a listed role. `requireAuth()` /
`requireRole()` are factories returning `[authenticate, ...]`, so a route opts in
explicitly and role checks never live inside controllers.

**Account status** — `authenticate` only checks the token, so a token stays
technically valid until it expires. `GET /auth/me` re-loads the user on every
call and rejects (401) a user who has been deleted or deactivated. Any future
endpoint needing fresh status does the same via the repository.

**Current limitations** (documented, to be addressed later):

- No token revocation / blacklist. A leaked or stale token is usable until `exp`
  (kept short — default 15 min). Deactivating a user blocks new logins and
  `/auth/me`, but not an in-flight token on other endpoints until they add a
  status re-check.
- Role changes are not reflected in an already-issued token until it expires.
- Single symmetric secret (HS256); no key rotation.

**Future** — refresh tokens (rotating, persisted, revocable), `httpOnly` cookie
delivery, asymmetric keys (RS256/EdDSA) for multi-service verification, and
institutional SSO/OAuth (OIDC) can be layered on without changing the
`authenticate → authorize → controller` shape.

## Service boundaries: evaluator & hint-engine

`services/evaluator` (compiler-driven execution + grading) and
`services/hint-engine` (progressive hints / AI mentor) stay **separate
processes**. They are not imported by `apps/api` and there is no inter-service
communication yet. When wired, the API will reach them over HTTP (and later a
queue); each can scale independently. Judge0 is an execution detail that will live
_inside_ the evaluator, not in the API or the database.

## Deferred (not in this codebase yet)

User registration, password reset, email verification, refresh tokens, token
revocation, OAuth / SSO; all domain CRUD (users, courses, assessments,
questions), exam sessions, submissions, evaluation, Judge0 and code execution,
AST/semantic analysis, proctoring enforcement, Socket.IO, AI/LLM integration,
hint timers, Redis / live-session state, rate limiting, Helmet/CSRF, Kubernetes,
and production deployment. Each is a separate task.
