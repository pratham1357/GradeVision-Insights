# Development setup

This guide gets all three developers to an identical, working local environment.

## 1. Toolchain

| Tool    | Version | Install                                           |
| ------- | ------- | ------------------------------------------------- |
| Node.js | 24+     | https://nodejs.org or `nvm install 24` (`.nvmrc`) |
| pnpm    | 9+      | `corepack enable` (preferred) or `npm i -g pnpm`  |
| Git     | any     | https://git-scm.com                               |

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

`pnpm install` links the workspace packages (`apps/*`, `services/*`, `packages/*`) together.
`@gradevision/shared` is consumed by the other packages via `workspace:*`.

## 3. Build the shared package first

The apps and services import `@gradevision/shared` from its built output, so build it once
after installing (and any time its `src/` changes if you are not running `pnpm dev`):

```bash
pnpm --filter @gradevision/shared build
```

## 4. Run things

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

## 5. Quality gates (run before pushing)

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

## 6. Conventions

- **TypeScript strict mode** everywhere; packages extend `tsconfig.base.json`.
- **ESM only** (`"type": "module"`); use `.js` extensions in relative imports for Node packages.
- Shared code goes in `packages/shared`; keep service boundaries explicit — no direct
  cross-service imports.
- Formatting is owned by Prettier; linting by ESLint. Do not hand-fight the formatter.

## Not set up yet (planned)

Prisma schema & migrations, PostgreSQL/Redis wiring, Judge0, LLM providers, WebSockets,
authentication, proctoring, dashboards, and Docker/Kubernetes runtime. Do not add these
without an explicit task.
