# Execution isolation - status, threat model and the public-hosting gate

**Status (2026-10-26): there is NO verified sandbox in this repository.** Student
code may only be executed on a single trusted machine with known participants.
A public deployment must not execute student code until the gate in section 4
is met.

## 1. What runs today

| Provider                                                               | Selected when                                   | Isolation                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `LocalExecutionProvider` (`services/evaluator/src/execution/local.ts`) | `LOCAL_EXECUTION_ENABLED=true`, no `JUDGE0_URL` | **none** (reports `isolation: "none"`)         |
| `Judge0Provider`                                                       | `JUDGE0_URL` set                                | whatever the Judge0 host provides - unverified |
| Gemini execution fallback                                              | explicitly enabled + key                        | not execution at all; never for real grading   |
| unconfigured                                                           | none of the above                               | nothing runs; submissions end `FAILED`         |

### Exact limits of `LocalExecutionProvider`

What it does: one throwaway temp directory per submission, compile and run as a
child process of the evaluator, stdin-only test input, a wall-clock kill per
case (question time limit + 3 s, default 5 s; compile 20 s), output capped per
stream (process killed beyond it), a scrubbed environment allowlist (no
`DATABASE_URL`, tokens or keys passed to the child), Python started with `-I`.

What it does **not** do:

- no memory limit, no CPU-time limit, no process/thread count limit (fork bombs);
- no network restriction - the program can open sockets, reach the LAN, the
  database on 127.0.0.1 and the hint-engine;
- no filesystem jail - the program runs as the evaluator's OS user and can read
  every file that user can read (including `.env` with `DATABASE_URL`, the
  session secret and any API keys) and write anywhere that user can write;
- no seccomp/AppArmor/job-object confinement, no separate user, no container;
- disk use is bounded only by the host.

A student who submits malicious code can therefore read secrets, alter grades
directly in the database, and affect the host. Timeouts and output validation do
not change this.

## 2. Controls in place now

- Every service binds to `127.0.0.1`; `scripts/check-local.mjs` probes the LAN
  addresses and fails if any app port is reachable.
- **Hard gate in code:** the evaluator refuses to start when
  `LOCAL_EXECUTION_ENABLED=true` and `NODE_ENV=production`
  (`services/evaluator/src/env.ts`, verified: exit code 1 with a message).
- The evaluator has no inbound API (only `/health` on loopback); it pulls work
  from the database.
- Grading is deterministic and owned by `@gradevision/grading`; no AI decides a
  score, and an AI outage cannot change a grade.

## 3. Threat model for a production execution boundary

Attacker: any authenticated student (or anyone holding a student session).
Assets: other students' code and results, hidden tests, grades, secrets,
database, the host, the network around it. Required properties of a production
boundary:

| Requirement                     | Notes                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| Per-run isolation               | fresh sandbox per submission; nothing persists between runs               |
| Non-root, unprivileged identity | user namespace / dedicated UID; no capabilities                           |
| No host secrets inside          | no env vars, no mounted `.env`, no cloud metadata (block 169.254.169.254) |
| No Docker socket                | never mount `/var/run/docker.sock` into anything that runs student code   |
| Resource limits                 | CPU time, wall clock, memory, PIDs, output bytes, disk quota              |
| Network off by default          | no egress at all for runs                                                 |
| Controlled filesystem           | read-only toolchain image + small tmpfs workdir                           |
| Kill + cleanup                  | whole process tree killed; workdir removed even on crash                  |
| Toolchain allowlist             | only the five supported languages, pinned versions                        |
| Queue + auth                    | evaluator authenticates to the sandbox; bounded input/output sizes        |

Candidate implementations (none implemented or verified here): a hardened
Judge0 on a dedicated host (needs privileged containers + cgroup setup - and is
not "safe" just because it is a third-party project: its auth token, network
isolation, limits and data handling must be reviewed and tested), nsjail or
gVisor (`runsc`) per run on a dedicated Linux VM, or Firecracker microVMs.
Any of them must run on infrastructure that holds **no** production secrets.

## 4. Public-hosting gate (all must be true before public code execution)

1. An isolation boundary meeting section 3 runs on infrastructure separate from
   the API/database, reachable only from the evaluator.
2. An escape test suite passes **inside that boundary** (never on a developer
   host): read `/etc/passwd`/home files, read env vars, open outbound sockets,
   reach 169.254.169.254 and the database, fork bomb, memory bomb, infinite
   output, disk fill, sleeping child that outlives the parent, writing outside
   the workdir. Each must be contained and leave no residue.
3. The evaluator's provider for production is that boundary;
   `LOCAL_EXECUTION_ENABLED` stays unset (the code gate enforces this).
4. Results are reviewed by someone other than the implementer.

Until then a public deployment runs with **no execution provider**: submissions
are accepted and stored but end `FAILED / EXECUTION_UNAVAILABLE`, which the UI
reports honestly. Do not expose the local evaluator to make a hosted demo work.

## 5. Related findings outside the executor

- The development machine's PostgreSQL listens on all interfaces and trusts
  every local connection from 127.0.0.1 (`pg_hba.conf`: `host all all
127.0.0.1/32 trust`). Remote logins are refused by `pg_hba`, but any local
  process - including unsandboxed student code - can connect as any role
  without a password. Recommended (requires an administrator, not done here):
  set `listen_addresses = 'localhost'` in `postgresql.conf` and change that
  `trust` line to `scram-sha-256`, then restart the PostgreSQL service.
