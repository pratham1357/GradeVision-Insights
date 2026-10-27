# Local demo runbook

Everything in the demo runs on this one machine: PostgreSQL, the API, the
evaluator (real local execution), the hint-engine, a local Ollama model and the
web app. Once dependencies and the model are downloaded, **no internet
connection is needed** - `apps/web/scripts/browser-smoke.mjs` fails if the
browser requests anything from another host.

> **Safety boundary.** Student code runs as unsandboxed child processes of the
> evaluator (`LOCAL_EXECUTION_ENABLED=true`, `isolation: "none"`). This is only
> acceptable on a trusted machine with known participants. Every service binds
> to `127.0.0.1`; never change that, never port-forward, and never run this
> profile on a shared or public host. See `docs/DEPLOYMENT.md` section 6.

## One-time setup

```bash
pnpm install
cp .env.example .env
#   set SESSION_SECRET (>= 32 chars) and INTERNAL_SERVICE_TOKEN (>= 32 chars):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   set LOCAL_EXECUTION_ENABLED=true and PYTHON_BIN (python3 / python)
pnpm --filter @gradevision/shared --filter @gradevision/database \
     --filter @gradevision/grading --filter @gradevision/queue build
pnpm --filter @gradevision/database migrate:deploy
pnpm db:seed

# Ollama (Windows: winget install Ollama.Ollama; it listens on 127.0.0.1:11434)
ollama pull qwen2.5:1.5b-instruct     # the model named by OLLAMA_MODEL
```

Do not set `OLLAMA_HOST=0.0.0.0`. The hint-engine refuses a non-loopback
`OLLAMA_BASE_URL`.

## Start (four terminals, or `pnpm dev` for all of them)

```bash
pnpm --filter @gradevision/api dev           # http://127.0.0.1:4000/api/v1/health
pnpm --filter @gradevision/evaluator dev     # http://127.0.0.1:4100/health  -> provider "local"
pnpm --filter @gradevision/hint-engine dev   # http://127.0.0.1:4200/health  -> ollama, reachable, modelAvailable
pnpm --filter @gradevision/web dev           # http://localhost:5173
```

Then:

```bash
node scripts/check-local.mjs                 # READY / NOT READY (+ LAN exposure probe)
```

Warm the model once before presenting (the first hint after a cold start also
loads the model): open the exam as a student and request the AI-mentor stage,
or run the benchmark below.

## Accounts (development only)

| Role       | Email                    | Password                  |
| ---------- | ------------------------ | ------------------------- |
| Instructor | `instructor@example.edu` | `instructor-dev-password` |
| Student    | `student1@example.edu`   | `student-dev-password`    |
| Student    | `student2@example.edu`   | `student-dev-password`    |
| Admin      | `admin@example.edu`      | `admin-dev-password`      |

Use two browser profiles (or one normal + one private window) to be signed in
as instructor and student at the same time: the session lives in an HttpOnly
cookie per profile (docs/AUTH.md), so the two never interfere. Open the app at
`http://localhost:5173` (not `127.0.0.1`), so the web app and API share a site.

## 5-minute demo

1. **Instructor** (`instructor@example.edu`) - Dashboard → open the **Two Sum**
   question → scroll to **Hint stages**. It has two written stages; add stage 3
   with delivery **AI mentor (local model)** (skip if it is already there from
   an earlier run). The assessment **CS101 - Live Coding Assessment** is ACTIVE.
2. **Student** (`student1@example.edu`, second profile) - open the assessment,
   acknowledge the evidence notice, start.
3. Submit a wrong Two Sum (e.g. `print(0, 0)`) → real execution, **0/4** with
   the visible failing case; hidden tests show status only.
4. **Get hint** 1 (written) → submit another wrong attempt → hint 2 unlocks on
   that evidence (never on a timer) → submit a third wrong attempt (e.g. the
   indices in the wrong order, `print(1, 0)`) → stage 3 **AI mentor**:
   "Thinking locally…" then a short, validated hint that refers to the visible
   failure.
5. Submit a correct solution → **4/4** → **Transfer Check** (Contains Duplicate,
   hints off) → solve it.
6. **Instructor** → Results → the student's row → **Evidence summary** and
   **Evidence Replay**: attempts, test outcomes, each hint in order with its
   exact delivered text, the AI hint labelled with its provider and model, and
   the Transfer Check outcome. No mastery score, no "cheating" label.
7. Optional: `admin@example.edu` → **Administration**: search accounts, create
   a student and enrol them in CS101 Section A, change a role, deactivate an
   account (it is signed out everywhere at once), the audit trail, and system
   health.

A correct Two Sum (Python):

```python
n, target = map(int, input().split())
nums = list(map(int, input().split()))
seen = {}
for i, x in enumerate(nums):
    if target - x in seen:
        print(seen[target - x], i)
        break
    seen[x] = i
```

## Reset between runs (guarded)

The reset restores the **dedicated local demo database** to its seeded state:
it removes the seeded students' sessions and everything they produced
(submissions, evaluation runs, results, drafts, hint deliveries, integrity
events), content the demo instructor created during a rehearsal (assessments,
questions, hint stages added to seeded questions), accounts the demo admin
created, the demo accounts' audit events and sign-in sessions - then re-seeds.
Schema, migration history and anyone else's data are never touched. There are no
uploaded files in this product, so no files are deleted.

The re-seed also re-activates the four seeded accounts and restores their
roles, the two seeded assessments' status (Live Coding ACTIVE, Practice DRAFT)
and their question lists. It does **not** undo edits to the text of seeded
content (question statements, test cases, rubrics, written hint stages,
assessment titles or durations): during rehearsals, add new items rather than
editing seeded ones - new items are removed by the reset.

It refuses to run (exit code 2, nothing changed) unless **all** of these hold:
`GRADEVISION_DEMO_MODE=true`; `DEMO_DATABASE_NAME` names the database; the
command repeats it with `--confirm`; the URL host is loopback; the name is not a
test or system database; `NODE_ENV` is not `production`; and the server itself
reports that database name (checked again inside the deleting transaction).

One-time opt-in - add to `.env` (only on the machine that owns the demo database):

```
GRADEVISION_DEMO_MODE=true
DEMO_DATABASE_NAME=gradevision
```

```bash
pnpm db:demo-inspect                              # read-only: target, guard verdict, what would be removed
pnpm db:demo-reset --confirm gradevision          # pg_dump backup -> guarded reset -> re-seed
pnpm db:demo-reset --confirm gradevision --no-backup   # skip the backup (not recommended)
```

Backups land in `database/backups/<db>-<timestamp>.dump` (git-ignored). Restore
one with:

```bash
pg_restore --clean --if-exists -h 127.0.0.1 -U gradevision -d gradevision database/backups/<file>.dump
```

Test data is separate: integration tests use the `gradevision_test` database
(docs/DEVELOPMENT.md); the demo reset refuses any database that looks like a
test database, and its own tests run against `gradevision_test` through the
library function, never the CLI against the demo database.

| Reset problem                                               | Meaning / fix                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `REFUSED ... GRADEVISION_DEMO_MODE`                         | opt-in missing in `.env`                                           |
| `REFUSED ... --confirm must repeat`                         | pass `--confirm <DEMO_DATABASE_NAME>`                              |
| `REFUSED ... looks like a test database` / `not loopback`   | wrong `DATABASE_URL` - by design                                   |
| `pg_dump not found`                                         | set `PG_DUMP_BIN` to the full path, or `--no-backup`               |
| `failed - the transaction was rolled back`                  | nothing was deleted; read the message (e.g. a database constraint) |
| `Demo data was removed (committed), but the re-seed failed` | the reset itself succeeded; run `pnpm db:seed` to finish it        |

## Recovery

| Symptom                                           | Fix                                                                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI hint: "The AI mentor is unavailable right now" | `ollama list` / start the Ollama app; `node scripts/check-local.mjs`. Nothing was recorded and grades are unaffected - ask again.                                                  |
| First AI hint very slow                           | Cold model load. Request one hint before presenting; `OLLAMA_KEEP_ALIVE=30m` keeps it loaded.                                                                                      |
| Submission stays "Evaluating…"                    | Evaluator not running - start it; queued submissions are picked up automatically.                                                                                                  |
| "Your session ended. Sign in again"               | Session idle > `SESSION_IDLE_MINUTES` (60), older than 12 h, signed out elsewhere, or the account was changed by an admin. Sign in; autosaved drafts are kept.                     |
| Exam shows "Time is up" on start                  | An old session for that student - run `pnpm db:demo-reset`.                                                                                                                        |
| Hint-engine exits at startup                      | `INTERNAL_SERVICE_TOKEN` missing/short, or `OLLAMA_BASE_URL` not loopback - the message says which.                                                                                |
| Machine is slow / swapping                        | Close other apps; the model needs ~1.5 GB free RAM. Measured: cold start 5-9 s with ~1.9 GB free, 188 s with ~0.6 GB free. Set `LLM_PROVIDER=none` to run with written hints only. |

## Checks before presenting

```bash
node scripts/check-local.mjs
node apps/web/scripts/browser-smoke.mjs          # then the demo reset (it creates a session and an account)
pnpm db:demo-reset --confirm gradevision
```

## Windows PowerShell quick reference

Start (each in its own terminal, from the repository root):

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"   # if Ollama is not already running (tray icon)
pnpm --filter @gradevision/api dev
pnpm --filter @gradevision/evaluator dev
pnpm --filter @gradevision/hint-engine dev
pnpm --filter @gradevision/web dev
node scripts/check-local.mjs
```

Reset after a rehearsal:

```powershell
pnpm db:demo-inspect
pnpm db:demo-reset --confirm gradevision
```

Shut down (stops only the four GradeVision dev servers, found by their ports):

```powershell
foreach ($port in 4000, 4100, 4200, 5173) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { taskkill /PID $conn.OwningProcess /T /F | Out-Null; "stopped port $port" }
}
# Optional: unload the model to free memory (Ollama itself keeps running)
ollama stop qwen2.5:1.5b-instruct
```
