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
pnpm db:migrate    # create/apply the dev migration (database/prisma/migrations)
pnpm db:seed       # deterministic dev data: 1 instructor, 2 students, 1 course/section,
                   # 1 draft assessment, 1 question, 4 test cases, a 3-criterion rubric
pnpm db:studio     # browse the data
```

`pnpm db:migrate` / `db:seed` / `db:studio` load the repo-root `.env` via `dotenv-cli`, so
keep DB config in the single root `.env` (not a per-package one). Reset a broken local DB
with `pnpm --filter @gradevision/database migrate:reset`.

The domain model and its rationale are documented in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md).

## 5. Run things

```bash
pnpm dev                                   # everything, in parallel
pnpm --filter @gradevision/web dev         # web only  -> http://localhost:5173
pnpm --filter @gradevision/api dev         # api only  -> http://localhost:4000
pnpm --filter @gradevision/evaluator dev   # evaluator -> http://localhost:4100
pnpm --filter @gradevision/hint-engine dev # hint-engine -> http://localhost:4200
```

Smoke-test the API:

```bash
curl http://localhost:4000/health
# {"service":"api","status":"ok","timestamp":"..."}
```

## 6. Quality gates (run before pushing)

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

## 7. Conventions

- **TypeScript strict mode** everywhere; packages extend `tsconfig.base.json`.
- **ESM only** (`"type": "module"`); use `.js` extensions in relative imports for Node packages.
- Shared code goes in `packages/shared`; database access goes through `@gradevision/database`;
  keep service boundaries explicit — no direct cross-service imports.
- Prisma schema changes: edit `database/prisma/schema.prisma`, run `pnpm db:migrate`, commit the
  generated migration folder. Do not hand-edit applied migrations.
- Formatting is owned by Prettier; linting by ESLint. Do not hand-fight the formatter.

## Not set up yet (planned)

Redis / live-session state, Judge0, LLM providers, WebSockets, authentication, API CRUD routes,
proctoring enforcement, dashboards, and Docker/Kubernetes runtime. Do not add these without an
explicit task.
