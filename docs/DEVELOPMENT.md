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
pnpm test        # vitest (apps/api)
```

`pnpm test` has two kinds of suites:

- `auth` / `jwt` / `password` — mock the repository, no database.
- `instructor` / `student` — real integration tests. They need PostgreSQL running
  and the schema migrated (`DATABASE_URL`, the seeded dev DB locally). Each
  creates its own fixtures under fixed `ffffffff-…` / `eeeeeeee-…` ids and removes
  them before and after, so seed data is never touched.

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
6. **Submit this question** → a submission is recorded (`QUEUED`); it is _not_
   evaluated (that is the next task).
7. **Finish exam** → the end screen; re-opening the assessment is no longer
   offered, and the API rejects further saves/submits with `409`.

Monaco is fetched from a CDN by `@monaco-editor/react`, so the editor needs
network access the first time it loads.

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

Redis / live-session state, Judge0, LLM providers, WebSockets, user registration, password
reset, refresh tokens, SSO, **evaluation of submissions**, results / scoring, proctoring
enforcement, and Docker/Kubernetes runtime. Do not add these without an explicit task.
