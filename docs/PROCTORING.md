# Assessment integrity

A deliberately **lightweight, non-invasive** approach. The goal is to give
instructors a signal that a student left the exam context - not to surveil.

## What is (and is not) collected

| Collected (client-reported)                      | Never collected                 |
| ------------------------------------------------ | ------------------------------- |
| `visibilitychange` → tab/window hidden           | Camera / microphone             |
| `blur` → exam window lost focus                  | Screen capture / screenshots    |
| `fullscreenchange` → left fullscreen             | Keystrokes / clipboard / typing |
| optional short client note (page title, seconds) | Network / process inspection    |

The browser hook (`apps/web/src/lib/use-integrity-monitor.ts`) debounces the
burst a single tab-switch fires (blur + visibility together) into one event with
a ~1.2 s cooldown, so counts stay meaningful.

## Data model

Existing schema, no migration:

- **`Violation`** — `examSessionId`, `type` (`TAB_SWITCH` / `WINDOW_BLUR` /
  `FULLSCREEN_EXIT` / `VISIBILITY_CHANGE` / `OTHER`), `severity`
  (`FULLSCREEN_EXIT`/`TAB_SWITCH` → `MEDIUM`, focus signals → `LOW`), `occurredAt`,
  `detail.note`.
- **`AuditEvent`** — one `integrity.violation` row per signal (`actorId` = student,
  `entityType` `ExamSession`, `entityId` = session id).

## API

| Method & path                                                          | Role       | Notes                                                                                          |
| ---------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `POST /api/v1/student/sessions/:sessionId/violations`                  | STUDENT    | Session owner + `IN_PROGRESS` only. 404 for another student, 409 otherwise, 400 on a bad type. |
| `GET /api/v1/assessments/:assessmentId/sessions/:sessionId/violations` | INSTRUCTOR | Ownership-scoped (`ownedBy`). 404 for a non-owner, 403 for a student.                          |

The student response and `ExamSessionView.integrity` carry only a `violationCount`
and an escalating plain-text `warning` ("Heads up…" → "Please stay in the exam
window" → "…flagged for your instructor"). Rule ids, thresholds, and storage
details are never exposed to the student.

Every recorded violation also emits `session:violation` (to the student) and
`assessment:changed` (to the instructor) over Socket.IO, so the monitoring
dashboard updates live.

## Instructor view

- **Results dashboard** (`GET .../results`) — a `Flags` column per student and
  `stats.totalViolations` / `stats.studentsWithViolations` aggregates.
- **Per-student drill-down** — the dashboard row opens a breakdown that also
  lists every `Violation` with timestamp, type, and severity.

## Out of scope

Enforced lockdown, hard blocking on violation, forced re-fullscreen, webcam/mic
invigilation, and browser-extension proctoring are intentionally **not**
implemented.
