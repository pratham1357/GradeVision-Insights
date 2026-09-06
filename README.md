# GradeVision Insights

GradeVision Insights is a large-scale academic programming assessment platform. It combines a
web-based programming assessment environment, compiler-driven code evaluation, and
approach-agnostic grading (test cases, AST/semantic analysis, and rubric-based partial credit)
with assessment integrity/proctoring and a progressive, non-code-revealing AI mentor. It is being
built as a pnpm monorepo so that the web client, REST API, and evaluation/AI services can evolve
and scale independently toward institution-scale deployment.

## Architecture

| Layer          | Technology                                                    |
| -------------- | ------------------------------------------------------------- |
| Frontend       | React, Vite, TypeScript, Tailwind CSS                         |
| Backend API    | Node.js, Express, TypeScript, REST                            |
| Evaluation     | `evaluator` service + Judge0 sandbox + `@gradevision/grading` |
| AI             | `hint-engine` service + Gemini (env-driven `LLMProvider`)     |
| Database       | PostgreSQL + Prisma (`@gradevision/database`)                 |
| Cache / queue  | Redis + BullMQ (`@gradevision/queue`) — optional              |
| Infrastructure | Docker Compose (Kubernetes _added later_)                     |

Services are independent packages with explicit boundaries — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The API is a layered Express app
(`routes → controller → service → repository`) that reaches PostgreSQL only through the
`@gradevision/database` package; the domain model is in
[docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md). Implemented so far: first-stage JWT auth,
the **instructor assessment-authoring** workflow (courses/sections, assessments, coding
questions, VISIBLE/HIDDEN test cases, rubric criteria), and the **student
assessment-taking** workflow (discovery, timed exam sessions, autosaving Monaco editor,
per-question submissions), and the **automated evaluation pipeline** (async
Judge0-backed execution of visible + hidden tests, deterministic rubric/semantic
grading, student + instructor results) plus **progressive AI hints** (static
stages then an env-configured LLM mentor) — with a small React console for each
role. WebSockets / live proctoring are **not** implemented yet.

## Repository structure

```
apps/
  web/            React + Vite console — instructor authoring + student exam (React Router, Tailwind, Monaco)
  api/            Express + TypeScript REST API (layered; /api/v1/{health,auth,courses,assessments,questions,student})
services/
  evaluator/      Async submission evaluation: BullMQ/poll → Judge0 → grading → persist
  hint-engine/    Backend-only progressive-hint LLM provider (Gemini via fetch)
packages/
  shared/         Shared TypeScript types, schemas, constants
  grading/        Pure deterministic scoring engine (functional + rubric + semantic)
  queue/          BullMQ evaluation-queue wiring (optional Redis)
database/         @gradevision/database - Prisma schema, client, migrations, seed
  prisma/         schema.prisma, migrations/, seed.ts
infrastructure/
  docker/         docker-compose.yml (Postgres + Redis + self-hosted Judge0)
  kubernetes/     Orchestration manifests (added progressively)
docs/             Project documentation
scripts/          Repository automation scripts
```

## Prerequisites

- **Node.js 24+** (see `.nvmrc`)
- **pnpm 9+** (`corepack enable` or `npm install -g pnpm`)
- **PostgreSQL 14+** running locally (or a connection string)
- Docker _(optional — needed for the self-hosted Judge0 sandbox and Redis; see
  [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md))_
- `python3` on PATH _(optional — powers the Python AST semantic analyzer)_

## Installation

```bash
pnpm install                 # installs deps and generates the Prisma client
cp .env.example .env          # then set DATABASE_URL and JWT_SECRET (>= 32 chars)
pnpm db:migrate               # apply migrations to your database
pnpm db:seed                  # load the deterministic development dataset
```

## Development commands

| Command                              | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `pnpm dev`                           | Run every package's `dev` task in parallel        |
| `pnpm --filter @gradevision/web dev` | Run only the web client (http://localhost:5173)   |
| `pnpm --filter @gradevision/api dev` | Run only the API (http://localhost:4000/api/v1)   |
| `pnpm build`                         | Build `packages/*` then `apps/*` and `services/*` |
| `pnpm typecheck`                     | Run TypeScript checks across the workspace        |
| `pnpm lint`                          | Run ESLint across the workspace                   |
| `pnpm test`                          | Run tests (vitest; `apps/api` auth suite)         |
| `pnpm format`                        | Format the repository with Prettier               |
| `pnpm db:generate`                   | Regenerate the Prisma client                      |
| `pnpm db:migrate`                    | Create/apply a development migration              |
| `pnpm db:seed`                       | Seed the development dataset                      |
| `pnpm db:studio`                     | Open Prisma Studio                                |

Copy `.env.example` to `.env` and adjust values as needed. Never commit a populated `.env`.

## Infrastructure

`infrastructure/docker/docker-compose.yml` brings up PostgreSQL, Redis, and a
self-hosted Judge0 sandbox for local development:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

All three are optional — the API and evaluator degrade cleanly without Redis
(PostgreSQL polling) or Judge0 (runs marked `FAILED` with a clear reason).
Kubernetes manifests will be added progressively.
