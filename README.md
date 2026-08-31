# GradeVision Insights

GradeVision Insights is a large-scale academic programming assessment platform. It combines a
web-based programming assessment environment, compiler-driven code evaluation, and
approach-agnostic grading (test cases, AST/semantic analysis, and rubric-based partial credit)
with assessment integrity/proctoring and a progressive, non-code-revealing AI mentor. It is being
built as a pnpm monorepo so that the web client, REST API, and evaluation/AI services can evolve
and scale independently toward institution-scale deployment.

## Architecture

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Frontend       | React, Vite, TypeScript, Tailwind CSS        |
| Backend API    | Node.js, Express, TypeScript, REST           |
| Evaluation     | Dedicated `evaluator` service (TypeScript)   |
| AI             | Dedicated `hint-engine` service (TypeScript) |
| Database       | PostgreSQL + Prisma _(added later)_          |
| Cache / live   | Redis _(added later)_                        |
| Infrastructure | Docker, then Kubernetes _(added later)_      |

Services are independent packages with explicit boundaries. Inter-service communication,
database access, Judge0, LLM providers, WebSockets, auth, and dashboards are **not** implemented
yet — this repository currently provides the foundational development environment only.

## Repository structure

```
apps/
  web/            React + Vite + TypeScript client
  api/            Express + TypeScript REST API (GET /health)
services/
  evaluator/      Code-evaluation service scaffold
  hint-engine/    AI hint/mentor service scaffold
packages/
  shared/         Shared TypeScript types, schemas, constants
database/prisma/  Prisma schema & migrations (placeholders, designed later)
infrastructure/
  docker/         Local dev containers (added progressively)
  kubernetes/     Orchestration manifests (added progressively)
docs/             Project documentation
scripts/          Repository automation scripts
```

## Prerequisites

- **Node.js 24+** (see `.nvmrc`)
- **pnpm 9+** (`corepack enable` or `npm install -g pnpm`)
- Docker Desktop _(optional today; required once local infrastructure lands)_

## Installation

```bash
pnpm install
```

## Development commands

| Command                              | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `pnpm dev`                           | Run every package's `dev` task in parallel        |
| `pnpm --filter @gradevision/web dev` | Run only the web client (http://localhost:5173)   |
| `pnpm --filter @gradevision/api dev` | Run only the API (http://localhost:4000)          |
| `pnpm build`                         | Build `packages/*` then `apps/*` and `services/*` |
| `pnpm typecheck`                     | Run TypeScript checks across the workspace        |
| `pnpm lint`                          | Run ESLint across the workspace                   |
| `pnpm format`                        | Format the repository with Prettier               |

Copy `.env.example` to `.env` and adjust values as needed. Never commit a populated `.env`.

## Infrastructure

Docker and Kubernetes configuration will be added progressively as services mature. The
`infrastructure/` directory currently holds placeholders only.
