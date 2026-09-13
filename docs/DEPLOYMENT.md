# Deployment

**Savepoint (2026-09-13).** The final-review product runs, complete, on one
developer machine. **No external infrastructure has been provisioned**, no
container images exist, and nothing in this repository talks to a cloud
account. This document records the deployment audit, what each unit needs to
run, the per-environment configuration, the exact execution-sandbox boundary,
and the smallest external topology that would be justified if the product has
to be reachable from outside the development machine.

## 1. Decision

External deployment was **not** created in this step, on purpose:

- The final review is a local, seeded, repeatable walkthrough
  (`docs/DEVELOPMENT.md`). Moving it to a remote host adds network latency, a
  CDN dependency for the editor, and cost, and demonstrates nothing the
  product does not already show locally.
- **Untrusted-code execution is not production-safe with the components that
  exist.** The only sandbox integration is Judge0, which needs privileged
  containers on a cgroup-v1 kernel and could not be verified here. The
  `LocalExecutionProvider` used for the review reports `isolation: "none"`.
  Putting it behind a public URL would let anyone with a student login run
  arbitrary programs on the host.
- The machine this savepoint was produced on has no Docker daemon, no AWS CLI
  and no AWS credentials, so images could not be built or tested and cloud
  resources could not be created. Instructions are given instead (section 8).

When it becomes justified (reviewers on other machines, a pilot with real
students), follow section 8. Until then, everything below describes the
verified local layout.

## 2. Deployable units

```
browser ──HTTP/WS──▶ apps/api (Express + Socket.IO at /realtime, :4000)
   ▲                     │ Prisma                │ HTTP (internal token)
   │ static bundle       ▼                       ▼
apps/web (Vite → dist/)  PostgreSQL        services/hint-engine (:4200) ──▶ Gemini (optional)
                         ▲
                         │ polls QUEUED submissions (or BullMQ when REDIS_URL is set)
                  services/evaluator (:4100) ──▶ ExecutionProvider ──▶ Judge0 | local | (Gemini stopgap) | none
```

| Unit                   | Artifact                           | Runtime need                       | Public?                     |
| ---------------------- | ---------------------------------- | ---------------------------------- | --------------------------- |
| `apps/web`             | `apps/web/dist/` static files      | any static host with SPA fallback  | yes                         |
| `apps/api`             | `node apps/api/dist/server.js`     | Node 24, PostgreSQL                | yes (only public backend)   |
| `services/evaluator`   | `node services/evaluator/dist/…`   | Node 24, PostgreSQL, a provider    | **no** (no inbound traffic) |
| `services/hint-engine` | `node services/hint-engine/dist/…` | Node 24, Gemini key for AI stage   | **no** (API-only, token)    |
| PostgreSQL             | `postgres:17`                      | migrations from `database/prisma`  | no                          |
| Redis (optional)       | `redis:7`                          | only for BullMQ instead of polling | no                          |
| Judge0 (optional)      | `judge0/judge0:1.13.1`             | privileged containers, cgroup v1   | no                          |

`infrastructure/docker/docker-compose.yml` starts **only** PostgreSQL, Redis and
Judge0 for development. It does not build or run the application units.
`infrastructure/kubernetes/` contains placeholders only.

What each unit needs of the others:

- The web bundle needs exactly one value at **build** time: `VITE_API_BASE_URL`.
  It reaches the API over REST and opens Socket.IO on the same origin at
  `/realtime`; when the socket cannot connect the pages fall back to polling
  automatically. The editor (`@monaco-editor/react`) loads Monaco from the
  jsDelivr CDN, so the browser needs internet access.
- The API needs PostgreSQL and a JWT secret. Static hint stages are served by
  the API itself; only the AI-mentor stage is forwarded to the hint-engine.
- The evaluator needs PostgreSQL and an execution provider (section 6). It
  shares no network with the API; both talk to the database.
- The hint-engine needs a Gemini key to do anything; without one it answers
  `/health` and returns 503 for hint requests, which the API turns into a clear
  `HINT_PROVIDER_UNAVAILABLE` response.

## 3. Prerequisites

- Node.js 24 (`.nvmrc`; Node 22 works with an engine warning), pnpm 9.
- PostgreSQL 14+ (17 in Compose and CI).
- For **real local execution** on the evaluator host only: `python3`, `node`,
  `gcc`/`g++`, `javac`/`java` on `PATH` (or absolute paths in `LOCAL_*_BIN`).
- For the Python semantic analyzer: `python3` (`PYTHON_BIN`).
- Docker only for the Compose services above.

## 4. Environment variables

Every service validates its variables with Zod at startup and exits with a
readable message if something is missing. The API accepts `PORT` as a fallback
for `API_PORT` on generic hosts. **Secrets are marked ◆ and are server-side
only; nothing prefixed `VITE_` may ever carry one** (a test in
`apps/web/src/config-isolation.test.ts` fails the web test suite if it does).

| Variable                                                 | Used by                 | Development                     | Final-review demo               | Production-like                                           |
| -------------------------------------------------------- | ----------------------- | ------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `NODE_ENV`                                               | all                     | `development`                   | `development`                   | `production` (info-level JSON logs)                       |
| `DATABASE_URL` ◆                                         | api, eval               | local Postgres                  | local Postgres                  | managed/VM Postgres, TLS if remote                        |
| `JWT_SECRET` ◆                                           | api                     | any ≥ 32 chars                  | any ≥ 32 chars                  | `openssl rand -base64 48`, rotated                        |
| `JWT_EXPIRES_IN`                                         | api                     | `15m`                           | `2h` (long enough for an exam)  | `15m`–`2h`                                                |
| `API_HOST` / `API_PORT`                                  | api                     | `0.0.0.0` / `4000`              | same                            | same (behind TLS termination)                             |
| `API_CORS_ORIGIN`                                        | api                     | `http://localhost:5173`         | same                            | the web origin(s), comma-separated, never `*`             |
| `HINT_ENGINE_URL`                                        | api                     | `http://localhost:4200`         | same                            | private address of the hint-engine                        |
| `INTERNAL_SERVICE_TOKEN` ◆                               | api, hints              | unset                           | unset                           | **set** (hint-engine then rejects other callers with 401) |
| `REDIS_URL`                                              | api, eval               | unset (polling)                 | unset                           | unset unless queue throughput needs it                    |
| `VITE_API_BASE_URL`                                      | web (build)             | `http://localhost:4000`         | same                            | public API origin (`https://…`)                           |
| `EVALUATOR_PORT`                                         | eval                    | `4100`                          | `4100`                          | `4100`, firewalled                                        |
| `EVALUATOR_POLL_INTERVAL_MS` / `EVALUATOR_CONCURRENCY`   | eval                    | `2000` / `2`                    | `2000` / `2`                    | tune; concurrency ≤ 16                                    |
| `PYTHON_BIN`                                             | eval                    | `python3` (`python` on Windows) | same                            | same                                                      |
| `JUDGE0_URL` / `JUDGE0_TOKEN` ◆                          | eval                    | unset                           | unset                           | set **only** to a verified Judge0                         |
| `LOCAL_EXECUTION_ENABLED`                                | eval                    | `true` on a trusted dev box     | **`true`**                      | **must stay unset** (section 6)                           |
| `LOCAL_*_BIN`, `LOCAL_EXECUTION_*_MS`                    | eval                    | defaults                        | defaults                        | n/a                                                       |
| `GEMINI_EXECUTION_FALLBACK_ENABLED`                      | eval                    | `false`                         | **`false`** (real execution)    | `false`                                                   |
| `GEMINI_API_KEY` ◆                                       | hints (+ eval fallback) | optional                        | optional (AI-mentor stage only) | set for the hint-engine only                              |
| `GEMINI_MODEL` / `GEMINI_BASE_URL` / `GEMINI_TIMEOUT_MS` | hints                   | defaults                        | defaults                        | defaults                                                  |
| `LLM_PROVIDER`                                           | hints                   | `gemini`                        | `gemini`                        | `gemini`                                                  |
| `HINT_ENGINE_PORT`                                       | hints                   | `4200`                          | `4200`                          | `4200`, firewalled                                        |
| `SHADOW_DATABASE_URL` ◆                                  | migrate dev             | unset                           | unset                           | only for `migrate dev` on managed Postgres                |

Rules that hold in every profile:

- `.env` is git-ignored; `.env.example` contains placeholders only. Never
  commit a populated file. In a hosted environment inject variables through
  the host's secret store (systemd `EnvironmentFile` with mode 600, Docker
  `env_file`, or AWS SSM Parameter Store / Secrets Manager) rather than a file
  in the repository.
- `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` and `INTERNAL_SERVICE_TOKEN`
  never reach the browser. The web bundle reads a single variable.
- Point the demo profile at **local execution, not the Gemini stopgap**: with
  `GEMINI_EXECUTION_FALLBACK_ENABLED=true` and `LOCAL_EXECUTION_ENABLED` unset,
  the evaluator grades from a model's description of the program instead of
  running it. Check the evaluator's `/health`: `execution.provider` must read
  `local` for the review.

## 5. Local deployment (the final-review setup)

```bash
pnpm install                                   # also runs prisma generate
cp .env.example .env                           # set DATABASE_URL, JWT_SECRET (>= 32 chars),
                                               # LOCAL_EXECUTION_ENABLED=true, PYTHON_BIN
pnpm --filter @gradevision/shared --filter @gradevision/database \
     --filter @gradevision/grading --filter @gradevision/queue build
pnpm --filter @gradevision/database migrate:deploy   # applies the 6 migrations in order
pnpm db:seed                                   # fixed ids, idempotent upserts
pnpm db:demo-reset                             # clears the seeded students' sessions only

# four terminals (the hint-engine is optional for the seeded trajectory,
# whose Two Sum hints are static)
pnpm --filter @gradevision/api dev             # http://localhost:4000/health
pnpm --filter @gradevision/evaluator dev       # http://localhost:4100/health -> execution.provider
pnpm --filter @gradevision/hint-engine dev     # http://localhost:4200/health
pnpm --filter @gradevision/web dev             # http://localhost:5173
```

Running the **compiled** output instead of the `tsx` watchers (what a host
would run) was verified on 2026-09-13:

```bash
pnpm build
# each process reads its variables from the environment (no .env is loaded
# when the working directory has none)
(cd apps/api             && NODE_ENV=production API_PORT=4000 API_CORS_ORIGIN=https://web.example \
   DATABASE_URL=… JWT_SECRET=… HINT_ENGINE_URL=http://127.0.0.1:4200 INTERNAL_SERVICE_TOKEN=… node dist/server.js)
(cd services/evaluator   && NODE_ENV=production DATABASE_URL=… PYTHON_BIN=python3 node dist/index.js)
(cd services/hint-engine && NODE_ENV=production INTERNAL_SERVICE_TOKEN=… GEMINI_API_KEY=… node dist/index.js)
(cd apps/web             && VITE_API_BASE_URL=https://api.example npx vite build)   # -> dist/
```

Observed: API `/health` 200 with `checks.database.status: "up"`; a preflight
from an origin not in `API_CORS_ORIGIN` receives no
`Access-Control-Allow-Origin` header while the configured origin is reflected;
login works; evaluator `/health` reports `execution.provider: "unconfigured"`
when no provider is set; hint-engine `/health` reports `provider.configured:
false` without a key and `POST /hints` returns 401 without the internal token;
the web bundle contains the configured API origin and no `localhost`,
`GEMINI` or `VITE_` strings.

Health and readiness:

| Endpoint                                | 200 means                                            | Otherwise                                  |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| API `GET /health`, `GET /api/v1/health` | process up **and** database reachable                | 503 with `status: "degraded"` when DB down |
| evaluator `GET /health`                 | process up; shows provider, Redis, Python analyzer   | connection refused                         |
| hint-engine `GET /health`               | process up; shows whether a Gemini key is configured | connection refused                         |

Evaluation progress itself is visible in the data: a submission that stays
`QUEUED` means no evaluator is polling; one that finishes `FAILED` with
`EXECUTION_UNAVAILABLE` means the evaluator has no execution provider.

## 6. Execution-provider boundary

The evaluator picks one provider at startup
(`services/evaluator/src/execution/index.ts`):

| Provider                  | Selected when                                          | What it is                                                              | Where it may run                                             |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Judge0                    | `JUDGE0_URL` set                                       | real sandboxed execution (isolate, cgroups, no network)                 | the intended production path, once a Judge0 host is verified |
| `LocalExecutionProvider`  | `LOCAL_EXECUTION_ENABLED=true` and a toolchain present | real execution as child processes of the evaluator; `isolation: "none"` | **controlled / demo hosts only**                             |
| Gemini execution fallback | `GEMINI_EXECUTION_FALLBACK_ENABLED=true` and a key     | a model's description of the run, not execution                         | demos where nothing else exists; never for real grading      |
| Unconfigured              | none of the above                                      | every run ends `FAILED` / `EXECUTION_UNAVAILABLE`                       | safe default anywhere                                        |

**`LocalExecutionProvider` is not a production sandbox.** It enforces a
wall-clock kill, capped output, a scrubbed environment and a throwaway
directory, and nothing else: no memory or CPU limits, no network restriction,
no filesystem jail, and the program runs as the evaluator's own OS user. It is
acceptable for the final review because the review runs on a single trusted
machine with known participants.

**Production untrusted-code execution is deferred; the current
`LocalExecutionProvider` is for controlled/demo environments.** No component in
this repository provides verified isolation for code written by untrusted
students on a shared host. Judge0 is integrated and is the intended path, but
self-hosting it (`infrastructure/docker/docker-compose.yml`) requires
`privileged: true` containers on a kernel booted with cgroup v1 and swap
accounting; that has not been exercised in this project. Until a Judge0 host
has been stood up and verified, an evaluator on a public deployment must run
with **no** provider (runs fail cleanly) or the deployment must be treated as
trusted/demo and documented as such.

## 7. Database: migrations, seed, demo reset

- Schema changes are Prisma migrations under `database/prisma/migrations/`,
  applied in name order: `20260901000000_init`,
  `20260901184727_add_submission_draft`,
  `20260909044037_add_question_external_reference`,
  `20260912133556_add_concepts`, `20260912140924_add_transfer_check`,
  `20260913133926_add_evidence_notice_ack`. Never recreate the schema by hand;
  run `prisma migrate deploy` (`pnpm --filter @gradevision/database migrate:deploy`,
  or `pnpm --filter @gradevision/database exec prisma migrate deploy` with
  `DATABASE_URL` in the environment). It is idempotent, needs no shadow
  database, and is what CI runs. Run it once per release **before** starting
  the new API/evaluator, from a machine that can reach the database; the
  services do not migrate on boot.
- `prisma migrate status` reports drift or pending migrations without changing
  anything; use it as the pre-deploy check.
- **Seed** (`pnpm db:seed`) upserts fixed ids (`00000000-0000-4000-8000-…`) and
  creates the development accounts `instructor@example.edu`,
  `student1@example.edu`, `student2@example.edu` with **known dev passwords**.
  Seed only databases that are demo instances; never a database holding real
  users. Do not copy a development database into a hosted one.
- **Demo reset** (`pnpm db:demo-reset`, `database/prisma/demo-reset.ts`)
  deletes the two seeded students' exam sessions on the two seeded assessments
  and the evidence those sessions produced. It touches nothing outside those
  fixed ids, so it is safe on a shared demo database and a no-op on a database
  that was never seeded. The same command applies to a hosted demo: run it
  with that database's `DATABASE_URL`.

## 8. Optional external deployment (not provisioned)

If the review must be reachable from other machines, the smallest credible
topology is **one small Linux VM plus a managed or co-located PostgreSQL**:

1. **VM** (e.g. AWS EC2 `t3.small`, Ubuntu 24.04, or any VPS): Node 24, pnpm,
   the language toolchains only if it will be a trusted demo host. Run the
   three compiled services under systemd (one unit each, `EnvironmentFile=`
   with mode 600) or under Docker Compose once images exist. Bind the API to
   `127.0.0.1` behind nginx; the evaluator and hint-engine bind to `0.0.0.0` by
   default, so block their ports at the security group / firewall.
2. **PostgreSQL**: AWS RDS `db.t4g.micro` (PostgreSQL 16/17, not publicly
   accessible, same VPC as the VM) or a `postgres:17` container on the VM with
   a volume for a throwaway demo. Apply migrations with `prisma migrate deploy`
   from the VM, then `db:seed` and `db:demo-reset`.
3. **Web**: `VITE_API_BASE_URL=https://<host>` at build time. Serve
   `apps/web/dist/` from the same nginx (`try_files $uri /index.html` for the
   client-side routes; proxy `/api/` and `/realtime` to the API with
   `Upgrade`/`Connection` headers so WebSocket works and polling still falls
   back), which keeps everything same-origin and lets `API_CORS_ORIGIN` be the
   single site origin. S3 + CloudFront is an alternative for the bundle only;
   it needs the SPA fallback configured and adds a second origin to CORS.
4. **TLS**: Let's Encrypt on nginx (or an ALB if one already exists). Do not
   serve the API over plain HTTP: bearer tokens travel in headers.
5. **Secrets**: `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, `DATABASE_URL` and
   `GEMINI_API_KEY` in the systemd environment file or SSM Parameter Store
   (SecureString), never in the repo or the web build.
6. **Execution**: either verify Judge0 on that VM (kernel booted with
   `systemd.unified_cgroup_hierarchy=0 cgroup_enable=memory swapaccount=1`,
   then `docker compose … up -d judge0 judge0-workers judge0-db judge0-redis`
   and `JUDGE0_URL=http://127.0.0.1:2358`), or leave the evaluator unconfigured,
   or accept `LOCAL_EXECUTION_ENABLED=true` **only** on a VM used by known
   reviewers for a bounded time and destroyed afterwards.

Not needed for this topology, and deliberately not introduced: ECS/Fargate,
EKS, Lambda, API Gateway, Redis, autoscaling, service mesh, tracing, a
multi-AZ VPC. Indicative cost if created: `t3.small` ≈ USD 15/month,
`db.t4g.micro` ≈ USD 12/month plus storage; stop or destroy both when the
review is over.

Smoke test for any such deployment (do not fake it with database rows):
instructor login → open **CS101 - Live Coding Assessment** → student login →
acknowledge the evidence notice and start → submit a wrong Two Sum → real
evaluation 0/4 → hint 1 → wrong → hint 2 → correct 4/4 → Transfer Check
(Contains Duplicate, no hints) → instructor Results → the student's row →
Evidence summary and Evidence Replay. The same sequence is scripted for the
local stack in `docs/DEVELOPMENT.md`.

## 9. Gemini

Gemini is used in exactly one place that affects what a student sees: the
**AI-mentor hint stage**, via `services/hint-engine` (`GEMINI_API_KEY` on that
service only; the API forwards a sanitized, fenced context and returns plain
text). It never decides grading truth, pass/fail, the assessment score, the
Transfer Check outcome, the Evidence Report, or any mastery/competence/risk
figure; those are computed by `@gradevision/grading` and deterministic API code
from persisted results. The evaluator's Gemini execution fallback is a
documented stopgap that must stay off wherever real execution is available.

## 10. Known limitations

- No container images, no infrastructure-as-code, no hosted instance. Section
  8 is a recipe, not a tested deployment.
- Untrusted-code isolation is deferred (section 6).
- The editor depends on the jsDelivr CDN for Monaco.
- Services do not migrate on boot; a release is "migrate, then restart".
- Single API process: Socket.IO rooms are in-memory, so horizontal scaling
  would need a Socket.IO adapter (out of scope; polling fallback still works).
- No rate limiting, Helmet or CSRF (listed as deferred in
  `docs/ARCHITECTURE.md`); the API relies on bearer tokens and CORS.
- The seed's development passwords are public knowledge; a hosted demo must be
  short-lived or use changed credentials.

## 11. Deferred infrastructure

Kubernetes/EKS, ECS/Fargate, Lambda/API Gateway, gVisor/Firecracker or any
custom sandbox, VM-per-submission execution, Redis-backed queueing in
production, autoscaling, observability platforms, RAG, LMS/LTI, OAuth/OIDC.
Each is a separate task with its own justification.
