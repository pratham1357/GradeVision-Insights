# Development setup

This guide gets all three developers to an identical, working local environment.

## 1. Toolchain

| Tool       | Version | Install                                           |
| ---------- | ------- | ------------------------------------------------- |
| Node.js    | 24+     | https://nodejs.org or `nvm install 24` (`.nvmrc`) |
| pnpm       | 9+      | `corepack enable` (preferred) or `npm i -g pnpm`  |
| PostgreSQL | 14+     | local install, Docker, or a hosted instance       |
| Git        | any     | https://git-scm.com                               |

Verify:

```bash
node -v   # v24.x or newer
pnpm -v   # 9.x or newer
```

## 2. Clone & install

```bash
git clone <repo-url>
cd "GradeVision Insights"
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
```

`pnpm install` links the workspace packages (`apps/*`, `services/*`, `packages/*`, `database`)
together and runs `prisma generate` (via `@gradevision/database` `postinstall`).
`@gradevision/shared` and `@gradevision/database` are consumed by the other packages via
`workspace:*`.

After `cp .env.example .env`, set a **`JWT_SECRET`** (the API refuses to start without one that
is at least 32 chars):

```bash
# add the output as JWT_SECRET=... in .env
openssl rand -base64 48
```

## 3. Build the library packages first

The apps and services import `@gradevision/shared` (and later `@gradevision/database`) from
their built output, so build them once after installing (and whenever their `src/` changes if
you are not running `pnpm dev`):

```bash
pnpm --filter @gradevision/shared --filter @gradevision/database build
```

## 4. Database

Set `DATABASE_URL` in `.env` to your local PostgreSQL, then:

```bash
pnpm db:migrate    # create/apply dev migrations (database/prisma/migrations)
pnpm db:seed       # deterministic dev data: 1 instructor, 2 enrolled students, CS101 / Section A,
                   # a DRAFT assessment (instructor authoring) + an ACTIVE one (student exam),
                   # 2 questions, test cases (visible + hidden), a 3-criterion rubric
pnpm db:studio     # browse the data
```

`pnpm db:migrate` / `db:seed` / `db:studio` load the repo-root `.env` via `dotenv-cli`, so
keep DB config in the single root `.env` (not a per-package one). Reset a broken local DB
with `pnpm --filter @gradevision/database migrate:reset`.

The domain model and its rationale are documented in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md).

### Development login credentials

Seeded by `pnpm db:seed`. **Development only** - never reuse anywhere real. The plaintext
passwords and their pre-computed Argon2id hashes are in
[`database/prisma/seed.ts`](../database/prisma/seed.ts):

| Email                    | Password                  | Role       |
| ------------------------ | ------------------------- | ---------- |
| `instructor@example.edu` | `instructor-dev-password` | INSTRUCTOR |
| `student1@example.edu`   | `student-dev-password`    | STUDENT    |
| `student2@example.edu`   | `student-dev-password`    | STUDENT    |

If you seeded before authentication existed, re-run `pnpm db:seed` to replace the old
placeholder hashes.

## 5. Run things

```bash
pnpm dev                                   # everything, in parallel
pnpm --filter @gradevision/web dev         # web only  -> http://localhost:5173
pnpm --filter @gradevision/api dev         # api only  -> http://localhost:4000
pnpm --filter @gradevision/evaluator dev   # evaluator -> http://localhost:4100
pnpm --filter @gradevision/hint-engine dev # hint-engine -> http://localhost:4200
```

Smoke-test the API (needs `DATABASE_URL` set and PostgreSQL running):

```bash
curl http://localhost:4000/api/v1/health
# {"service":"api","status":"ok","timestamp":"...","uptimeSeconds":3,
#  "checks":{"database":{"status":"up","latencyMs":5}}}
```

`/health` (unversioned) still works as a temporary alias. `/api/v1` is the
canonical prefix; requests to unimplemented routes return
`{"error":{"code":"NOT_FOUND","message":"..."}}`.

The API validates its environment on startup (`apps/api/src/env.ts`); a missing or
invalid `DATABASE_URL` / `JWT_SECRET` / port will exit with a readable message.
`pnpm --filter @gradevision/api dev` loads the repo-root `.env` via `dotenv-cli`.

Test login and the current-user endpoint:

```bash
# login -> { "data": { "accessToken": "...", "user": {...} } }
curl -sX POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"student1@example.edu","password":"student-dev-password"}'

# current user (paste the accessToken)
curl -s http://localhost:4000/api/v1/auth/me -H 'Authorization: Bearer <accessToken>'
```

Wrong password / unknown email → `401 INVALID_CREDENTIALS` (identical, no
enumeration). Missing/expired/garbage token → `401 UNAUTHORIZED`. A deactivated
user cannot log in, and `/auth/me` rejects an already-issued token once the
account is inactive.

### Auth environment variables (`apps/api`)

| Variable         | Required | Notes                                                    |
| ---------------- | -------- | -------------------------------------------------------- |
| `JWT_SECRET`     | yes      | ≥ 32 chars. `openssl rand -base64 48`. Never commit.     |
| `JWT_EXPIRES_IN` | no       | Access-token lifetime, default `15m` (ms/vercel format). |

## 6. Quality gates (run before pushing)

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test        # vitest across apps/api, apps/web and the packages/services
```

`pnpm test` has three kinds of suites:

- `apps/web` (`api-client`, `realtime`, `use-integrity-monitor`, `config-isolation`),
  `auth` / `jwt` / `password` / `realtime/watcher` / `realtime/io` — pure-logic /
  mocked, no database, no DOM.
- `instructor` / `student` / `results-hints` / `integrity` / `multi-student` /
  `realtime/io.integration` / evaluator `evaluate` — real integration tests. They
  need PostgreSQL running and the schema migrated (`DATABASE_URL`, the seeded dev
  DB locally). Each creates its own fixtures under a fixed id prefix
  (`ffffffff-…`, `eeeeeeee-…`, `dddddddd-…`, `cccccccc-…`, `bbbbbbbb-…`,
  `aaaaaaaa-…`, `71000000-…`) and removes them before and after, so seed data is
  never touched. Judge0 is never required — the evaluator suite uses a mock
  `ExecutionProvider`.
- `pnpm --filter @gradevision/api smoke` — a headless end-to-end run against the
  seeded DB (instructor activates an assessment → two students take it → submit →
  grade → realtime nudges → integrity flag → static hint). Needs `pnpm build`
  first; leaves the DB as it found it.

## Instructor workflow (manual check)

1. `pnpm --filter @gradevision/api dev` and `pnpm --filter @gradevision/web dev`.
2. http://localhost:5173, sign in as `instructor@example.edu` / `instructor-dev-password`.
3. Dashboard shows CS101 / Section A and the seeded **DRAFT** assessment.
4. Open a question → edit fields, toggle languages + starter code, add a VISIBLE
   and a HIDDEN test case, add rubric criteria, save.
5. Create an assessment for Section A, attach questions, set marks, reorder.
6. Reload the page — everything persists.
7. As `student1@example.edu` the instructor URLs redirect / the API returns `403`.

## Student workflow (manual check)

1. Same dev servers. Sign in as `student1@example.edu` / `student-dev-password`.
2. `/student` lists **CS101 - Live Coding Assessment** (the seeded ACTIVE one).
3. **Start assessment** → the exam page opens with a countdown, question sidebar,
   problem statement + examples, language selector, and the Monaco editor seeded
   with the starter code.
4. Edit the code — the save indicator shows "Saving…" then "Saved HH:MM:SS".
5. Reload the page — your code is still there (loaded from the server draft).
6. **Submit this question** → a submission is recorded (`QUEUED`). If the
   evaluator is running it is picked up within a couple of seconds; the status
   badge moves `Queued → Evaluating → Scored X/Y` and a result panel appears
   with the passed/failed test summary, rubric breakdown, and feedback.
7. **Hints** panel per question: request stage 1 (conceptual), then later stages
   unlock as you use the previous one and the delay elapses. Stage 4 is the AI
   mentor — it needs the hint-engine plus `GEMINI_API_KEY`; without a key it
   shows a clear "not configured" message and static hints still work.
8. **Finish exam** → the end screen; re-opening the assessment is no longer
   offered, and the API rejects further saves/submits with `409`.

Monaco is fetched from a CDN by `@monaco-editor/react`, so the editor needs
network access the first time it loads.

## Evaluation, hints & sandbox (services)

```bash
# 1. Infrastructure (Postgres + Redis + self-hosted Judge0)
docker compose -f infrastructure/docker/docker-compose.yml up -d
#    Postgres and Redis alone:
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis

# 2. Point .env at them (all optional - see .env.example)
#    JUDGE0_URL=http://localhost:2358     # omit -> runs FAIL with a clear reason
#    REDIS_URL=redis://localhost:6379     # omit -> evaluator polls Postgres
#    GEMINI_API_KEY=...                   # omit -> interactive hints return 503

# 3. Run the services
pnpm --filter @gradevision/evaluator dev     # -> http://localhost:4100/health
pnpm --filter @gradevision/hint-engine dev   # -> http://localhost:4200/health
```

- **No Judge0?** Everything else still works; automated runs are persisted as
  `FAILED` with `EXECUTION_UNAVAILABLE`. Judge0 1.13.1 needs privileged
  containers + cgroup v1 with swap accounting — **on Docker Desktop
  (Windows/macOS) the workers will not start**. Run `... up -d postgres redis`
  only, or run the full stack inside a Linux VM / WSL2 with cgroup v1, or point
  `JUDGE0_URL` at a separately hosted Judge0. See the header of
  `infrastructure/docker/docker-compose.yml`.
- **Local execution (real execution without Judge0; local dev / demo only).**
  When Judge0 cannot run on this machine, the evaluator can compile and run
  student programs itself with the toolchains on the host — `python3`, `node`,
  `gcc`/`g++`, `javac`/`java` — via `node:child_process` (never a shell). This
  is **real** execution: the program's actual stdout is what the grading engine
  compares. It is **off by default**; enable it in `.env` with:

  ```bash
  # only takes effect while JUDGE0_URL is unset; wins over the Gemini fallback
  LOCAL_EXECUTION_ENABLED=true
  # PYTHON_BIN / LOCAL_NODE_BIN / LOCAL_GCC_BIN / LOCAL_GXX_BIN / LOCAL_JAVAC_BIN /
  # LOCAL_JAVA_BIN default to the tool names on PATH; empty disables that language.
  ```

  What it enforces per test case: a hard wall-clock kill (the question's CPU
  limit + 3 s, else `LOCAL_EXECUTION_DEFAULT_WALL_TIME_MS`), capped stdout/stderr,
  a scrubbed child environment (no `DATABASE_URL` / API keys), a throwaway temp
  directory removed afterwards, and stdin-only test input. What it does **not**
  enforce: memory/CPU limits, network restriction, or a filesystem jail — the
  program runs as the evaluator's own OS user. **Never enable it on a shared or
  production host**; Judge0 (or a containerised successor) remains the sandbox
  for that. Java submissions must declare `public class Main` (Judge0's
  convention). A missing toolchain for a submitted language surfaces as a normal
  `EVALUATOR_ERROR` failure for that run, never a crash.

- **Temporary Gemini execution fallback (demo/testing only).** When Judge0 is
  genuinely unavailable, the evaluator can approximate execution results with a
  Gemini model so the pipeline stays functional. It is a stopgap, not a Judge0
  replacement, and is **off by default**. Enable it in `.env` with:

  ```bash
  # only takes effect while JUDGE0_URL is unset
  GEMINI_EXECUTION_FALLBACK_ENABLED=true
  GEMINI_API_KEY=<your backend Google AI Studio key>   # server-side only, never VITE_
  # GEMINI_MODEL / GEMINI_BASE_URL / GEMINI_EXECUTION_TIMEOUT_MS have safe defaults
  ```

  Selection order is: Judge0 (`JUDGE0_URL` set) → local execution (flag on +
  a toolchain present) → Gemini fallback (flag on + key present) →
  `EXECUTION_UNAVAILABLE`. The model only supplies a per-case
  mechanical outcome (compiled? crashed? what did it print?); the existing
  functional + rubric + semantic grading still computes every score. Malformed
  model output is retried once and then surfaced as a normal `EVALUATOR_ERROR`
  failure — it never hangs or crashes a worker, and hidden test data is never
  logged. To return to the real sandbox, unset the flag and set `JUDGE0_URL`.

- **The Python AST analyzer** shells out to `PYTHON_BIN` (`python3` by default).
  Set it to `python` on Windows if `python3` is not on PATH, or empty to disable.
- **Realtime is optional too.** The API attaches Socket.IO at `/realtime` on the
  same port; the web clients use it for "re-fetch now" signals. If it is
  unavailable the exam page and results dashboard fall back to interval polling
  automatically - a small "Live / Offline" dot in the exam header shows which.

## Review-2 demo (seeded data, ~3 minutes)

Two terminals: `pnpm --filter @gradevision/api dev` and
`pnpm --filter @gradevision/web dev`. Optionally a third for
`pnpm --filter @gradevision/evaluator dev` (with `JUDGE0_URL` set) — without it
the run finishes as a clean `FAILED` and the flow still demos end to end.

1. **Instructor** — sign in as `instructor@example.edu` / `instructor-dev-password`.
   Either use the seeded **CS101 - Live Coding Assessment**, or create your own:
   **New assessment** → add a question → **Activate**. Open its **Results** page
   (stat tiles, per-student rows, integrity column) and leave it open.
2. **Students** — sign in as `student1@example.edu` and `student2@example.edu`
   (`student-dev-password`) in two browser profiles. Each `/student` page picks
   up a newly-activated assessment within a few seconds. **Start exam** — they
   get independent sessions.
3. Solve **Sum of Two Integers** in Python
   (`a, b = map(int, input().split()); print(a + b)`) → **Submit this question**.
4. Watch the status badge move `Queued → Evaluating → Scored X/Y` (live via the
   socket; polling if it is offline). Expand **Result** for the test summary,
   rubric breakdown and feedback — hidden test cases show status only.
5. Back in the **instructor** dashboard: the row updates live. Click it for the
   per-question breakdown (hidden test data still redacted).
6. **Trigger a violation** — in the student tab, press <kbd>Esc</kbd> to leave
   fullscreen, or switch to another tab and back. A warning banner appears and
   the count increments.
7. In the instructor dashboard the **Flags** column ticks up; click the row →
   **Integrity events** lists the recorded `FULLSCREEN_EXIT` / `WINDOW_BLUR`
   with timestamps.
8. Student → **Finish exam**.

## 7. Conventions

- **TypeScript strict mode** everywhere; packages extend `tsconfig.base.json`.
- **ESM only** (`"type": "module"`); use `.js` extensions in relative imports for Node packages.
- Shared code goes in `packages/shared`; database access goes through `@gradevision/database`;
  keep service boundaries explicit — no direct cross-service imports.
- Prisma schema changes: edit `database/prisma/schema.prisma`, run `pnpm db:migrate`, commit the
  generated migration folder. Do not hand-edit applied migrations.
- **API modules** follow `routes → controller → service → repository` with Zod validation at the
  boundary (see `apps/api/src/modules/questions` for the full pattern, and
  [ARCHITECTURE.md](./ARCHITECTURE.md)). No Prisma in route handlers; no `process.env` outside
  `apps/api/src/env.ts`. Protect a route with `requireAuth()` / `requireRole("INSTRUCTOR")` -
  never an inline role check. Resource ownership is enforced in the **service** (against
  `req.auth.userId`); a resource that isn't yours returns 404.
- **Frontend** keeps API calls in `apps/web/src/lib/*-api.ts`, not in components; state is local
  (+ the auth context). Add routes to `apps/web/src/App.tsx` only for features that exist.
- Formatting is owned by Prettier; linting by ESLint. Do not hand-fight the formatter.

## Not set up yet (planned)

User registration, password reset, refresh tokens, SSO, enforced proctoring
(lockdown / hard blocks), camera/mic invigilation, multi-attempt exams, and
Kubernetes runtime. Do not
add these without an explicit task.
