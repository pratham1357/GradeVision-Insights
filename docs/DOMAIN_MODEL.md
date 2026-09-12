# Domain Model

Initial PostgreSQL domain model for GradeVision Insights, defined in
[`database/prisma/schema.prisma`](../database/prisma/schema.prisma) and owned by the
`@gradevision/database` workspace package.

This document covers **what is modelled and why**. Authentication, Judge0 wiring,
AST/semantic analysis, proctoring enforcement, and LLM hint generation are **not**
part of this task — only the data they will read and write.

## 1. Major entities

| Domain            | Models                                              |
| ----------------- | --------------------------------------------------- |
| Users & org       | `User`, `Course`, `Section`, `Enrollment`           |
| Assessments       | `Assessment`, `AssessmentQuestion` (explicit join)  |
| Questions         | `Question`, `QuestionLanguage`                      |
| Test cases        | `TestCase`                                          |
| Rubric grading    | `Rubric`, `RubricCriterion`                         |
| Exam attempts     | `ExamSession`                                       |
| Submissions       | `Submission`                                        |
| Evaluation        | `EvaluationRun`, `TestCaseResult`, `CriterionScore` |
| Integrity         | `Violation`                                         |
| Progressive hints | `HintStage`, `HintUsage`                            |
| Audit             | `AuditEvent`                                        |

All primary keys are UUID (`uuid(7)`, time-ordered for index locality) stored as
native PostgreSQL `uuid`. Major mutable entities carry `createdAt` / `updatedAt`;
append-only result rows carry only `createdAt`. Enums are used only for stable,
finite state sets (roles, statuses, visibility, criterion type, severity).

## 2. Important relationships

- `Course 1—* Section 1—* Enrollment *—1 User` — a student's membership in a
  section. `@@unique([studentId, sectionId])` prevents double-enrollment.
- `Assessment *—* Question` **through `AssessmentQuestion`**, which also carries
  `position` and `points`. `@@unique([assessmentId, questionId])` stops a question
  being added to the same assessment twice.
- `Question 1—* TestCase`, `Question 1—* QuestionLanguage`
  (`@@unique([questionId, language])`), `Question 1—1 Rubric 1—* RubricCriterion`.
- `Assessment 1—* ExamSession *—1 User` — one row per student attempt.
  `@@unique([assessmentId, studentId, attemptNumber])`.
- `ExamSession 1—* Submission *—1 Question` — full submission history;
  `@@unique([examSessionId, questionId, attemptNumber])`.
- `Submission 1—* EvaluationRun 1—* TestCaseResult` and
  `EvaluationRun 1—* CriterionScore *—1 RubricCriterion`.
- `ExamSession 1—* Violation`, `ExamSession 1—* HintUsage *—1 HintStage`.
- `User 1—* AuditEvent` (nullable actor for system events).

**Delete behaviour.** Academic and evaluation history is protected. Relations into
`User`, `Question`, `Assessment`, `ExamSession`, `Submission`, `TestCase`, and
`RubricCriterion` use `Restrict` or `SetNull`; only genuinely subordinate rows
(`AssessmentQuestion`, `QuestionLanguage`, `TestCase`, `Rubric`/`RubricCriterion`
under a question, `EvaluationRun` children, `Enrollment`, `Violation`, `HintUsage`)
cascade from their parent. Prefer status/`isArchived` fields over hard deletes.

## 3. Why `Submission` and `EvaluationRun` are separate

A `Submission` is an **immutable snapshot of student input** — source code,
language, when it was submitted. An `EvaluationRun` is **one grading attempt over
that snapshot** — status, scores, timings, compiler output, errors.

They are separate because:

- **Re-evaluation.** Rubrics, test cases, or the evaluator itself change; we must
  be able to re-grade an old submission without mutating or losing the original,
  producing a second `EvaluationRun` (`@@unique([submissionId, runNumber])`).
- **Async workers.** Submitting is synchronous and cheap; evaluation is queued and
  runs later on separate worker processes. `EvaluationRun.status`
  (`PENDING → RUNNING → COMPLETED/FAILED/CANCELLED`) plus `startedAt`/`completedAt`
  is the work-item state a worker transitions, independent of the submission.
- **Auditability.** Score history is a sequence of runs, each with its own
  provider metadata and per-test / per-criterion breakdown.

## 4. Why `TestCase` visibility exists

`TestCase.visibility` (`VISIBLE` | `HIDDEN`, default `HIDDEN`) records whether a
case may ever be shown to a student. It exists so the API can later return visible
cases (input + expected output) to students while **never** exposing hidden inputs
or expected outputs. Modelling it as a column — defaulting to `HIDDEN` — makes safe
behaviour the default and lets a single query filter `where: { visibility: VISIBLE }`.

`category` (`STANDARD`, `SAMPLE`, `EDGE`, `PERFORMANCE`, `STRESS`) is **orthogonal**
to visibility, so an edge-case taxonomy can grow via an additive enum change
without reshaping `Question` or `TestCase`.

`TestCaseResult` stores the student's own `stdout`/`stderr` for a case but never the
expected output (that stays on `TestCase`); the API still gates hidden-case detail.

## 5. Why rubric criteria are separate from `Question`

Grading is not "does output match the reference solution". A question owns one
`Rubric`, which owns many `RubricCriterion` rows — e.g. functional correctness,
semantic correctness, algorithmic approach, performance, code quality — each with
its own `maxPoints`, `type`, `position`, and an optional machine-readable `config`
JSON for evaluator rules.

Separating them means:

- criteria can be added, reweighted, or reordered without touching `Question`;
- partial credit is first-class: each `EvaluationRun` produces one
  `CriterionScore` per criterion (`@@unique([evaluationRunId, rubricCriterionId]`)),
  so a submission can score full marks on approach and partial on performance;
- the evaluator, AST analyzer, and semantic analysis can each own specific
  criterion types without a schema change.

Only per-criterion machine rules live in JSON (`RubricCriterion.config`); the
rubric structure itself is relational.

## 6. How the model supports approach-agnostic grading

- **No reference-solution table.** Nothing ties a `Question` to a single canonical
  implementation. Correctness is evidence gathered per run.
- **Multiple independent signals per run.** `TestCaseResult` (functional) and
  `CriterionScore` (semantic / approach / performance / quality) attach to the same
  `EvaluationRun`, so functional pass-rate is one input among several rather than
  the whole grade.
- **`RubricCriterion.type` + `config`** let later analyzers contribute scores for
  properties of the _approach_ (complexity, data-structure choice, no banned
  constructs) rather than output equality.
- **History preserved.** Re-running evaluation with an improved analyzer creates a
  new `EvaluationRun`; prior scores remain for audit and comparison.

## 7. PostgreSQL vs. future Redis / live-session state

| Belongs in PostgreSQL (this schema)                     | Belongs in Redis / live layer (later)              |
| ------------------------------------------------------- | -------------------------------------------------- |
| Users, courses, sections, enrollments                   | Auth sessions / JWT denylist                       |
| Assessment & question definitions, rubrics, test cases  | Per-attempt countdown timer, server clock skew     |
| `ExamSession` lifecycle + `expiresAt` (source of truth) | Live "seconds remaining", heartbeat/presence       |
| Submitted code snapshots and their status               | Unsaved editor buffer / autosave drafts            |
| `EvaluationRun` queue state + results                   | Transient job locks, worker leases, retry backoff  |
| `Violation` evidence log                                | Real-time proctoring event stream / alerting       |
| `HintStage` config, `HintUsage` unlock records          | Hint cooldown countdown, chat transcript streaming |
| `AuditEvent`                                            | Rate-limit counters                                |

Rule of thumb: durable, must-survive-restart, needs-to-be-audited → PostgreSQL.
Ephemeral, per-connection, reconstructable → Redis.

## 8. Intentionally deferred

- **Authentication** — `User.passwordHash` is a nullable placeholder; no sessions,
  tokens, or password logic.
- **"One active attempt per student per assessment"** — enforced later as a partial
  unique index on `ExamSession` (`WHERE status IN ('NOT_STARTED','IN_PROGRESS')`),
  which Prisma cannot express in-schema yet. `attemptNumber` uniqueness is in place.
- **Judge0** — an execution mechanism, not the grader. No Judge0 fields in the
  schema; provider-specific payloads are confined to `EvaluationRun.providerMetadata`.
- **AST / semantic analysis & rubric auto-scoring** — the evaluator writes
  `CriterionScore` rows; how it computes them is out of scope here.
- **Proctoring enforcement** — `Violation` is an evidence store; the browser is
  treated as untrusted and no automated action is modelled.
- **LLM hints** — `HintStage`/`HintUsage` are configuration and usage logs only.
- **Redis / live-session models**, WebSockets, API CRUD, and UI.
- **Secrets** — no API keys, DB passwords, or Judge0 credentials in the schema.

## 9. Concepts: instructor-authored labels (`Concept`, `QuestionConcept`)

A `Concept` is a reusable programming concept ("Recursion", "Hash Maps") and
`QuestionConcept` is the explicit many-to-many join to `Question` (same shape as
`AssessmentQuestion`: its own id plus `@@unique([questionId, conceptId])`).
Removing a question cascades its associations; a concept that is still attached
to a question cannot be deleted (`Restrict`).

Concepts are **instructor-authored metadata, never inferred**: no hierarchy,
prerequisites, weights, mastery or confidence scores, and nothing tags a
question automatically. Instructors assign them through the question endpoints
(`conceptIds` on create/update, omitted = unchanged) and read the vocabulary
from `GET /api/v1/concepts`. Students never read or mutate them.

The join exists so later layers can aggregate persisted evidence per concept -
`Student -> Submission -> Question -> QuestionConcept -> Concept` - without a
further schema change. That aggregation is deliberately not built yet.
