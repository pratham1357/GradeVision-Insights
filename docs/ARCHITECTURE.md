# Architecture

GradeVision Insights is a pnpm monorepo. Each deployable unit is its own package
with an explicit dependency direction and no hidden coupling.

```
apps/web ──HTTP──▶ apps/api ──▶ @gradevision/database ──▶ Prisma ──▶ PostgreSQL
        └─ws─┘        │  │
                     │  ├─ @gradevision/shared     (cross-app types/constants)
                     │  ├─ @gradevision/queue       (BullMQ; optional Redis)
                     │  └─ @gradevision/grading     (deterministic scoring)
                     │
                     ├──HTTP──▶ services/hint-engine  ──▶ LLM provider (Gemini)
                     │
  (queue / DB) ─────▶ services/evaluator ──▶ Judge0 sandbox
                           └─ @gradevision/grading
```

`apps/web ─ws─ apps/api` is Socket.IO at `/realtime` for live "re-fetch" signals;
it is optional and the client falls back to polling.

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

`modules/health`, `modules/auth`, `modules/courses`, `modules/assessments`,
`modules/questions`, `modules/student`, `modules/integrity`, and
`modules/results` (a shared `mapper.ts`, no router) are implemented (routes →
controller → service → repository). `courses` / `assessments` / `questions` are
the instructor authoring slice; `student` is the student assessment-taking
slice; `integrity` is assessment integrity (below). `realtime/` (outside
`modules/`) is the Socket.IO layer. `modules/users` is still a route boundary
only.

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

## Instructor assessment-authoring

The first product vertical slice: an instructor signs in, sees their sections,
and builds assessments from coding questions (languages + starter code, VISIBLE /
HIDDEN test cases, rubric criteria). No student-facing endpoints exist yet.

### Endpoints (all `requireRole("INSTRUCTOR")`)

```
GET    /api/v1/courses                                  sections the instructor teaches (+ course)
GET    /api/v1/courses/sections/:sectionId              one owned section

GET    /api/v1/assessments                              the instructor's assessments
POST   /api/v1/assessments                              create (always DRAFT)
GET    /api/v1/assessments/:id                          detail incl. ordered questions
PATCH  /api/v1/assessments/:id                          edit fields (DRAFT only) / status transition
POST   /api/v1/assessments/:id/questions                attach an owned question (marks)
PATCH  /api/v1/assessments/:id/questions/:questionId    change marks / position
DELETE /api/v1/assessments/:id/questions/:questionId    detach
POST   /api/v1/assessments/:id/questions/reorder        set full question order

GET    /api/v1/questions                                the instructor's question bank
POST   /api/v1/questions                                create (title, statement, difficulty, languages…)
GET    /api/v1/questions/:id                            full detail (languages, test cases, rubric)
PUT    /api/v1/questions/:id                            replace scalar fields + language set
POST   /api/v1/questions/:id/test-cases                 add a VISIBLE or HIDDEN case
PATCH  /api/v1/questions/:id/test-cases/:testCaseId     edit
DELETE /api/v1/questions/:id/test-cases/:testCaseId     delete
GET    /api/v1/questions/:id/rubric                     rubric + ordered criteria
PUT    /api/v1/questions/:id/rubric/criteria            sync the criteria list (create/update/delete/reorder)
```

### Ownership & authorization

Every request is `authenticate → requireRole("INSTRUCTOR") → controller → service`.
The service is the authorization boundary: it re-derives ownership from
`req.auth.userId` on every call — a section by `section.instructorId`, an
assessment by its section's instructor (or `createdById` for a section-less
draft), a question by `question.createdById`, and test cases / rubric criteria
transitively through their question.

**IDOR is prevented by scoping, not by hiding buttons.** Repository queries carry
the ownership predicate (`findFirst({ where: { id, createdById } })`), so another
instructor's id in the URL simply does not match. A resource that exists but
isn't yours returns **404**, not 403, so existence isn't confirmed. (403 is only
for the role gate — a STUDENT hitting an instructor route.)

### Assessment lifecycle (MVP)

New assessments are `DRAFT`. Content fields (`title`, `description`,
`durationMinutes`) and question changes are allowed only while `DRAFT`
(otherwise `409 ASSESSMENT_NOT_EDITABLE`). Legal status transitions
(`ALLOWED_TRANSITIONS` in the service, `409 INVALID_STATUS_TRANSITION` otherwise):
`DRAFT`/`SCHEDULED` → `SCHEDULED`/`ACTIVE`/`CLOSED`/`ARCHIVED`; `ACTIVE` → `CLOSED`
only (an in-progress exam is never yanked out from under a student);
`CLOSED` → `DRAFT`/`ACTIVE`/`ARCHIVED`. Activating / closing an assessment emits
`assessment:changed` and fans `session:changed` out to every in-progress session,
so open exam pages and the monitoring dashboard react without a reload. Questions
are shared entities linked through `AssessmentQuestion` (never copied); the join
row carries `position` and `points`.

### Frontend

`apps/web` is a small React Router app with two guarded areas -
`RequireInstructor` and `RequireStudent` (`components/RequireRole.tsx`); `/`
sends each role to its home. Guards are UX only; the API enforces the same
independently. API calls go through `src/lib/instructor-api.ts` /
`src/lib/student-api.ts` (typed wrappers over `apiRequest`) and the `useApi`
hook; there is no global state library. Instructor pages: `/dashboard`,
`/assessments/*`, `/questions/*`.

## Student assessment-taking

The second product slice: a student takes a timed, live assessment.

### Endpoints (all `requireRole("STUDENT")`)

```
GET  /api/v1/student/assessments                                  ACTIVE assessments the student is enrolled for
POST /api/v1/student/assessments/:assessmentId/session            start or resume the (single) attempt
GET  /api/v1/student/sessions/:sessionId                          full exam view + server-authoritative timing
POST /api/v1/student/sessions/:sessionId/finish                   end the whole attempt (-> SUBMITTED)
PUT  /api/v1/student/sessions/:sessionId/questions/:qid/draft     save / autosave code (idempotent upsert)
POST /api/v1/student/sessions/:sessionId/questions/:qid/submissions  submit a code snapshot (-> QUEUED)
```

### Eligibility & ownership

Discovery is filtered in the query: `assessment.status = ACTIVE` **and** the
student has an `ACTIVE` `Enrollment` in the assessment's section **and** `now` is
within `startsAt`/`endsAt` if set. A DRAFT/SCHEDULED/CLOSED assessment is never
visible or startable.

Every session/draft/submission operation loads the session with
`where: { id, studentId: req.auth.userId }` - another student's id in the URL
simply doesn't match, so it is a **404**. Drafts and submissions are reached only
_through_ an owned session, so they inherit that scoping. Hidden test cases are
excluded at the query level (`where: { visibility: "VISIBLE" }` + a narrow
`select`), so their input/output never leaves the database on a student request.

### Sessions, time, and state

- **One attempt per student per assessment** (`attemptNumber = 1`, enforced by
  `@@unique([assessmentId, studentId, attemptNumber])`). Starting again while
  `IN_PROGRESS` resumes the same session; starting after it is
  `SUBMITTED`/`EXPIRED` is a `409`. A concurrent double-start loses the P2002
  race gracefully and returns the winning session.
- **`expiresAt` is computed and persisted at start** (`startedAt + durationMinutes`,
  or `endsAt`, or `null` for no limit). Server time is authoritative: every
  session read and every draft/submit re-checks `now > expiresAt` and persists
  `EXPIRED`. Each response carries `SessionTiming` (`status`, `expiresAt`,
  `serverTime`, `remainingSeconds`); the frontend countdown is derived from that,
  never from the device clock, and re-syncs on every write.
- After expiry: draft/submit return `409`; the exam view still returns the saved
  drafts and submissions (work is preserved, editing is locked).
- **`SubmissionDraft`** (new table) is the mutable per-question editor buffer -
  one row per `(session, question)`, `upsert`ed on autosave. This is state the
  schema comment earmarks for Redis "later"; a small table keeps autosave durable
  across a reload without adding infrastructure now, and the API surface will not
  change when Redis fronts or replaces it. `Submission` stays the immutable
  history (one row per submit, `attemptNumber` incrementing, `status = QUEUED`).
  A submit optionally enqueues a BullMQ job (`@gradevision/queue`); without Redis
  it is a no-op and the evaluator's PostgreSQL poller picks the row up.

## Automated evaluation pipeline

`services/evaluator` consumes `QUEUED` submissions - from a BullMQ worker when
`REDIS_URL` is set, otherwise by polling `submission.status = QUEUED`. Both paths
call the same `evaluateSubmission(submissionId, deps)`:

1. **Atomic claim.** `updateMany({ where: { id, status: QUEUED }, data: { status: RUNNING } })`
   - only the caller whose update affected a row proceeds; a second worker or a
     re-poll of a finished submission gets `{ status: "skipped" }`. A single
     `EvaluationRun` (`@@unique([submissionId, runNumber])`, always `runNumber = 1`)
     is upserted, so a submission can never accumulate multiple final scores
     (**idempotent**).
2. **Execute.** The submission, question, language, and **all** active test cases
   (visible + hidden) are loaded and sent to the Judge0 sandbox. Judge0 is
   abstracted behind `ExecutionProvider`; when `JUDGE0_URL` is unset the run is
   marked `FAILED` with `EXECUTION_UNAVAILABLE` - it never silently passes.
   A **temporary, off-by-default** `GeminiExecutionProvider` can stand in for
   Judge0 for a demo (`GEMINI_EXECUTION_FALLBACK_ENABLED=true` + a backend
   `GEMINI_API_KEY`, only while `JUDGE0_URL` is unset). It is not a sandbox and
   not a second grader: it returns the same internal `ExecutionResult` (a
   per-case mechanical outcome only), and steps 3-4 are unchanged. Malformed
   model output → one retry → normal `EVALUATOR_ERROR` failure. See
   [DEVELOPMENT.md](DEVELOPMENT.md).
3. **Grade** (see below).
4. **Persist.** `TestCaseResult` per case (status, output/error truncated,
   time/memory), `CriterionScore` per rubric criterion, `EvaluationRun`
   (`totalScore`, `maxScore`, `providerMetadata` with the semantic summary),
   and `submission.status = COMPLETED` / `FAILED` - all in one transaction.

Compile errors, runtime errors, timeouts, and evaluator faults each map to a
distinct persisted status; nothing throws past the transaction.

### Grading (`@gradevision/grading`)

Pure, deterministic, dependency-free. `computeEvaluation` combines:

- **Functional correctness** - behavioural: outputs are compared after
  whitespace normalisation, so a correct alternative implementation with
  different formatting still passes. Weighted per test case for partial credit.
- **Rubric scoring** - one `CriterionScore` per `RubricCriterion`, driven by the
  criterion's `config` JSON. Qualitative criteria (`ALGORITHMIC_APPROACH`,
  `CODE_QUALITY`, ...) **start at `maxPoints x functionalRatio`** and only lose
  points for named, concrete problems (a forbidden construct actually found, a
  function over the configured length). A correct solution is never penalised
  merely for differing from an expected algorithm. No rubric -> one implicit
  100-point functional criterion.
- **Semantic analysis** - `SemanticAnalyzer` interface; v1 is a Python `ast`
  analyzer (`python3 -c <script>`, code is parsed, never executed). Any other
  language returns `available: false` and grading falls back to functional
  correctness, so the analyzer can never falsely penalise.

### Progressive hints

`services/hint-engine` is a backend-only process. `LLMProvider` interface;
`GeminiProvider` reads `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_BASE_URL`
from the environment (nothing hard-coded) and calls the REST API with plain
`fetch`. `POST /hints` returns guidance text; without a key it returns `503`
`PROVIDER_NOT_CONFIGURED` - never a fabricated hint.

The API (`/api/v1/student/sessions/:id/questions/:qid/hints`) owns progression:
stage 1 or "previous stage used", plus evidence-based escalation (stage _N_
needs N − 1 persisted unsuccessful evaluated attempts on the question; a passing
latest attempt stops further escalation - see `hint-policy.ts` and
`docs/AI_HINTS.md`; `unlockDelaySeconds` is legacy and no longer gates anything).
`STATIC` stages return `HintStage.content`; `INTERACTIVE`
stages forward the minimum context (title, statement, latest code, earlier
hints) to the hint-engine. `HintUsage` (`@@unique([examSessionId, hintStageId])`)
makes a repeat request idempotent.

### Results

- Student: `GET /api/v1/student/submissions/:id` (ownership: submission ->
  session -> `studentId`). Hidden test cases return status + timing only - name,
  input, expected and actual output are stripped.
- Instructor: `GET /api/v1/assessments/:id/results` (ownership-scoped via
  `ownedBy`). Per-student, per-question score summary, assessment-level
  aggregates (`stats`: average / high / low score, started / submitted / graded
  counts, integrity totals), and a gradebook total (`question.points x
rubricPercent`). `GET .../sessions/:sessionId/result` drills into one student
  - the same `toEvaluationDetail` mapper, so **hidden test input/expected/actual
    output stay redacted even for the instructor**.

### Instructor monitoring (`modules/monitoring`, INSTRUCTOR/ADMIN only)

- `GET /api/v1/monitoring/students` - the instructor's real student roster,
  built from `User`/`Enrollment`/`ExamSession`/`Submission`/`EvaluationRun`/
  `Violation`. Every query is scoped to `section.instructorId`; there are no ids
  in the request, so there is nothing to enumerate. Per student: sections,
  assessments assigned/started/submitted, submission count, latest submission +
  score, mean graded score, violation count + `flagged` (>= 3), last activity.
- `GET /api/v1/monitoring/system` - API-process runtime metrics measured on the
  spot: uptime / boot time, a short `process.cpuUsage()` sample, `memoryUsage()`,
  a `SELECT 1` latency probe, and in-memory request counters (in-flight, total,
  last / rolling-average server-side processing time - fed by
  `requestMetricsMiddleware`). Operational counters only: no env vars, secrets,
  connection strings, file paths, or stack traces. A metric that cannot be read
  is `null`, never invented. The dashboard polls both (20s / 10s); neither
  depends on Socket.IO.

## Assessment integrity

Lightweight and non-invasive: the browser reports only page-focus and
fullscreen state (`visibilitychange`, `blur`, `fullscreenchange`) - no camera,
microphone, screen capture, or keystroke logging. `useIntegrityMonitor`
debounces the burst a single tab-switch fires and `POST`s to
`/api/v1/student/sessions/:id/violations` (STUDENT, session-owner, `IN_PROGRESS`
only). Each call writes a `Violation` row (severity by type) plus an
`integrity.violation` `AuditEvent`, and pushes `session:violation` +
`assessment:changed` over the socket.

The student sees an escalating banner and a count (`ExamSessionView.integrity`);
internal rule ids / thresholds are never exposed. The instructor sees counts on
the results dashboard and the full list at
`GET /api/v1/assessments/:id/sessions/:sessionId/violations` (ownership-scoped).

## Realtime (`apps/api/src/realtime`)

Socket.IO is attached to the same HTTP server at `/realtime` (only in
`server.ts`; `createApp()` stays pure Express, so tests are unaffected). It is a
**pure enhancement over REST** - it carries only "something changed, re-fetch"
signals, never data.

- **Auth**: the handshake carries the same access token as REST
  (`authenticateSocket`). Every room join is ownership-checked - a student may
  only join `session:<own-session>`, an instructor only `assessment:<owned>`.
- **Change detection**: the API cannot see the evaluator's DB writes, so
  `RealtimeWatcher` polls the newest `EvaluationRun` / `Violation` /
  `ExamSession` / `Assessment` `updatedAt` per _subscribed_ scope (only while
  someone is connected) and emits `session:changed` / `assessment:changed` — the
  ~3 s safety net. Direct actions (`submitCode`, `recordViolation`, an
  instructor status change) emit immediately.
- **Reconnect**: `connectRealtime` re-subscribes on every (re)connect and fires
  `onReady` once per confirmed subscription; the exam page / dashboard re-fetch
  on `onReady` so any gap during a disconnect self-heals.
- **Fallback**: the exam page and results dashboard keep their interval polling
  and simply slow it down while the socket is connected (`onStatus`). A dropped
  socket resumes fast polling. No second state store - the socket handler just
  calls the same `refresh()` / `reload()`.

### Student frontend

`src/lib/student-api.ts` + `useApi`. Pages: `/student` (available assessments,
start/resume) and `/student/exam/:sessionId` (`ExamPage`). The exam page holds
editor buffers locally, autosaves the current question (debounced, plus on
question/language switch), shows a save indicator, and runs a display-only
countdown seeded from `SessionTiming`. A reload re-fetches the session and
restores every draft. Monaco is via `@monaco-editor/react` (loaded on demand);
`src/lib/monaco.ts` maps GradeVision language ids to Monaco's. The editor is an
authoring surface only - it never executes code.

## Service boundaries: evaluator & hint-engine

`services/evaluator` (execution + grading) and `services/hint-engine`
(progressive hints / AI mentor) are **separate processes**. The API never
imports them: it reaches the hint-engine over HTTP and hands submissions to the
evaluator via a queue (or the shared database). `@gradevision/grading` and
`@gradevision/queue` are the only shared code. Judge0 lives _inside_ the
evaluator, behind `ExecutionProvider` - never in the API or the database.

## Deferred (not in this codebase yet)

User registration, password reset, email verification, refresh tokens, token
revocation, OAuth / SSO; enforced proctoring (lockdown browser, hard blocks),
camera/mic invigilation, multi-attempt exams, rate limiting, Helmet/CSRF,
Kubernetes, and production deployment. Each is a separate task.
