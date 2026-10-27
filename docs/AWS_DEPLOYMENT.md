# AWS deployment plan (not provisioned)

**Status:** design and tracked configuration only. No AWS resources, DNS records
or secrets have been created, and nothing has been deployed. Every step below
needs explicit approval before it is executed.

## 1. What Amplify Hosting can and cannot do here

`apps/web` is a static Vite SPA with one build-time variable
(`VITE_API_BASE_URL`), so **Amplify Hosting can host the web app** -
`amplify.yml` (repository root, monorepo `appRoot: apps/web`) and
`apps/web/customHttp.yml` are prepared for it.

Amplify Hosting does **not** run the Express API, Socket.IO, the evaluator, the
hint-engine, PostgreSQL or a model server. Those need the backend below.

## 2. Recommended MVP architecture

```
app.example.edu (Amplify Hosting, static SPA, CloudFront)  ──HTTPS──▶  api.example.edu
                                                                     │  TLS: ALB + ACM (or nginx + Let's Encrypt on the VM)
                                                                     ▼
                                       one Linux host (EC2) running, under systemd or containers:
                                         - apps/api        (public only via ALB/nginx; binds 127.0.0.1)
                                         - services/hint-engine (loopback only)
                                         - services/evaluator   (no inbound; execution UNCONFIGURED - see gate)
                                                                     │ private subnet
                                                                     ▼
                                       Amazon RDS for PostgreSQL (not public, encrypted, automated backups)
```

Why this shape: one small API process already holds Socket.IO rooms in memory
and the login throttle in process; a single host keeps that correct without new
infrastructure. Redis is not needed (the evaluator polls PostgreSQL).

Alternatives (compare before choosing - no prices are quoted here; use the AWS
Pricing Calculator for your region):

| Option                      | Operational effort | Notes                                                                                         |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| EC2 + RDS (recommended MVP) | low-medium         | you patch the OS; simplest networking; cheapest steady state of the three                     |
| ECS Fargate + ALB + RDS     | medium             | no OS patching; needs images, task definitions, ALB stickiness for Socket.IO polling          |
| App Runner + RDS            | low                | verify WebSocket support first (Socket.IO falls back to long-polling); one instance for rooms |

**Same-site domains are required.** Session cookies are `SameSite=Strict`, so the
web app and the API must share a registrable domain (e.g. `app.example.edu` and
`api.example.edu`). The default `*.amplifyapp.com` domain plus an API elsewhere
is cross-site: browsers would not send the cookie and sign-in would fail. A
custom domain on both is a deployment prerequisite.

## 3. Amplify configuration

1. Connect the repository; Amplify detects `amplify.yml`. Set the monorepo app
   root to `apps/web` (`AMPLIFY_MONOREPO_APP_ROOT=apps/web`).
2. Environment variable (public, compiled into the bundle):
   `VITE_API_BASE_URL=https://api.example.edu`. Never put secrets in `VITE_*`;
   `apps/web/src/config-isolation.test.ts` fails if a `VITE_` name looks like one.
3. Rewrites and redirects (SPA fallback), JSON for the console:
   ```json
   [
     {
       "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
       "target": "/index.html",
       "status": "200"
     }
   ]
   ```
4. Custom headers: `apps/web/customHttp.yml` - replace `API_ORIGIN`. The CSP was
   exercised locally against the production build (browser smoke 28/28, no
   violations); Amplify's handling of the file is not yet verified.
5. Custom domain `app.example.edu` with the Amplify-managed certificate.

## 4. Environment inventory

Public (web build): `VITE_API_BASE_URL` only.

Server, non-secret: `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT`,
`API_CORS_ORIGIN=https://app.example.edu`, `SESSION_IDLE_MINUTES`,
`SESSION_ABSOLUTE_HOURS`, `SESSION_COOKIE_SECURE=true`,
`SESSION_COOKIE_SAMESITE=strict`, `AUTH_TOKEN_LOGIN=false`,
`PASSWORD_LOGIN_ENABLED=true` (until SSO), `HINT_ENGINE_URL=http://127.0.0.1:4200`,
`HINT_ENGINE_TIMEOUT_MS`, `HINT_ENGINE_HOST=127.0.0.1`, `EVALUATOR_HOST=127.0.0.1`,
`LLM_PROVIDER`, `EVALUATOR_POLL_INTERVAL_MS`, `EVALUATOR_CONCURRENCY`.

Secrets - store in AWS Secrets Manager or SSM Parameter Store (SecureString),
inject at runtime, never commit, never log:

| Name                     | Used by                                          |
| ------------------------ | ------------------------------------------------ |
| `DATABASE_URL`           | api, evaluator                                   |
| `SESSION_SECRET`         | api                                              |
| `INTERNAL_SERVICE_TOKEN` | api, hint-engine                                 |
| `GEMINI_API_KEY`         | hint-engine (only if `LLM_PROVIDER=gemini`)      |
| `JUDGE0_TOKEN`           | evaluator (only with a verified isolated Judge0) |

Must stay **unset** in production: `LOCAL_EXECUTION_ENABLED` (the evaluator
refuses to start with it), `GEMINI_EXECUTION_FALLBACK_ENABLED`,
`GRADEVISION_DEMO_MODE`, `DEMO_DATABASE_NAME`.

## 5. AI hints in production

The local Ollama model is a development/demo dependency, not a production one.
Production choices, set explicitly - there is never a silent fallback:

- `LLM_PROVIDER=none`: written hints only; the AI stage reports unavailable.
- `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` from the secret store: a cloud
  model receives the sanitized hint context (no hidden tests, no identities);
  record this in the privacy notice.
- A self-hosted model on a separate GPU host behind the hint-engine, reachable
  only privately - a separate cost decision.

AI hints are optional; grading never depends on them.

## 6. Production safety gates (deployment blockers)

1. **Code execution:** no public code execution until
   `docs/EXECUTION_ISOLATION.md` section 4 is met. Until then the evaluator runs
   with no provider and submissions end `EXECUTION_UNAVAILABLE`.
2. **Custom domains** for web and API (same site) with TLS.
3. **First admin** created with `apps/api/scripts/create-admin.mjs` - the seed
   (with its public development passwords) must never run against production.
4. **SSO** (`docs/AUTH.md` section 4) if password sign-in is not acceptable to
   the institution.
5. Socket.IO and the login throttle are single-process: run one API instance,
   or add a Socket.IO adapter + shared rate-limit store before scaling out.
6. `prisma migrate deploy` run against the production database from a trusted
   host with network access to RDS.

## 7. Operations

- **Health:** ALB/target health on `GET /api/v1/health` (checks the database);
  evaluator and hint-engine `/health` on loopback for a local watchdog.
- **Migrations:** take an RDS snapshot, run `pnpm --filter @gradevision/database
exec prisma migrate deploy`, then restart the API and evaluator. Migrations in
  this repo are additive; a rollback is a redeploy of the previous build (schema
  stays forward-compatible). Destructive schema changes need an expand/contract
  plan and are not allowed without one.
- **Backups:** RDS automated backups with point-in-time recovery; a manual
  snapshot before every release; rehearse a restore into a scratch instance.
- **Logging:** `NODE_ENV=production` emits JSON logs; ship to CloudWatch Logs
  with retention set. Logs carry request ids and error codes - never passwords,
  session tokens, cookies or API keys.
- **Monitoring:** alarms on API 5xx rate, health-check failures, RDS CPU/storage.
- **Abuse limits:** API JSON body limit 1 MB; login throttle per (email,
  address); add an AWS WAF rate-based rule on the ALB for request floods.
- **Cost guardrails:** AWS Budgets with email alerts, smallest viable instance
  sizes, no NAT gateway unless required, stop or delete non-production stacks.

## 8. Step-by-step runbook (after approval)

1. Register/confirm the domain; plan `app.` and `api.` records.
2. Create the RDS PostgreSQL instance (private, encrypted, backups on).
3. Create the EC2 host in a VPC subnet that can reach RDS; security group: 443
   from the internet to the ALB (or nginx) only; SSH restricted or SSM Session
   Manager instead.
4. Install Node 24 + pnpm; deploy the built `apps/api`, `services/evaluator`,
   `services/hint-engine` (`pnpm build`); configure systemd units with an
   `EnvironmentFile` (mode 600) populated from the secret store.
5. Run `prisma migrate deploy`; run `create-admin.mjs` for the first admin.
6. TLS on the ALB (ACM) or nginx (Let's Encrypt); forward `/api/` and
   `/realtime` with WebSocket upgrade headers.
7. Amplify: connect repo, set app root and `VITE_API_BASE_URL`, rewrites,
   headers, custom domain.
8. Smoke test against the deployed site: sign-in as each role, two browsers,
   assessment create/activate, student start, submission (expect
   `EXECUTION_UNAVAILABLE` until the execution gate is met), results, admin
   account management, sign-out.
