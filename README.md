# GradeVision Insights

GradeVision Insights is a large-scale academic programming assessment platform. It combines a
web-based programming assessment environment, compiler-driven code evaluation, and
approach-agnostic grading (test cases, AST/semantic analysis, and rubric-based partial credit)
with assessment integrity/proctoring and a progressive, non-code-revealing AI mentor. It is being
built as a pnpm monorepo so that the web client, REST API, and evaluation/AI services can evolve
and scale independently toward institution-scale deployment.

## Architecture

| Layer          | Technology                                    |
| -------------- | --------------------------------------------- |
| Frontend       | React, Vite, TypeScript, Tailwind CSS         |
| Backend API    | Node.js, Express, TypeScript, REST            |
| Evaluation     | Dedicated `evaluator` service (TypeScript)    |
| AI             | Dedicated `hint-engine` service (TypeScript)  |
| Database       | PostgreSQL + Prisma (`@gradevision/database`) |
| Cache / live   | Redis _(added later)_                         |
| Infrastructure | Docker, then Kubernetes _(added later)_       |

Services are independent packages with explicit boundaries — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The API is a layered Express app
(`routes → controller → service → repository`) that reaches PostgreSQL only through the
`@gradevision/database` package; the domain model is in
[docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md). Authentication, domain CRUD, inter-service
communication, Judge0, LLM providers, WebSockets, and dashboards are **not** implemented yet.

## Repository structure

```
apps/
  web/            React + Vite + TypeScript client
  api/            Express + TypeScript REST API (layered; GET /api/v1/health)
services/
  evaluator/      Code-evaluation service scaffold
  hint-engine/    AI hint/mentor service scaffold
packages/
  shared/         Shared TypeScript types, schemas, constants
database/         @gradevision/database - Prisma schema, client, migrations, seed
  prisma/         schema.prisma, migrations/, seed.ts
infrastructure/
  docker/         Local dev containers (added progressively)
  kubernetes/     Orchestration manifests (added progressively)
docs/             Project documentation
scripts/          Repository automation scripts
```

## Prerequisites

- **Node.js 24+** (see `.nvmrc`)
- **pnpm 9+** (`corepack enable` or `npm install -g pnpm`)
- **PostgreSQL 14+** running locally (or a connection string)
- Docker Desktop _(optional today; required once local infrastructure lands)_

## Installation

```bash
pnpm install                 # installs deps and generates the Prisma client
cp .env.example .env          # then set DATABASE_URL for your local PostgreSQL
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
| `pnpm format`                        | Format the repository with Prettier               |
| `pnpm db:generate`                   | Regenerate the Prisma client                      |
| `pnpm db:migrate`                    | Create/apply a development migration              |
| `pnpm db:seed`                       | Seed the development dataset                      |
| `pnpm db:studio`                     | Open Prisma Studio                                |

Copy `.env.example` to `.env` and adjust values as needed. Never commit a populated `.env`.

## Infrastructure

Docker and Kubernetes configuration will be added progressively as services mature. The
`infrastructure/` directory currently holds placeholders only.
