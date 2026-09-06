# Grading engine

`@gradevision/grading` is a pure, deterministic, dependency-free package. Given a
submission's execution result and (optionally) a semantic analysis, it produces
an auditable score breakdown. The evaluator persists that breakdown verbatim;
nothing here reads the clock, the network, or a database.

## `computeEvaluation(input)`

```ts
computeEvaluation({
  language,          // ProgrammingLanguage
  criteria,          // RubricCriterionInput[] (empty => implicit criterion)
  cases,             // FunctionalCase[]  (caseId, weight, expectedOutput, visibility)
  execution,         // ExecutionResult from the ExecutionProvider (Judge0)
  semantic,          // SemanticAnalysis (available:false is fine)
}) => { functional, rubric, timing, scorePercent }
```

### 1. Functional correctness — behavioural, not structural

`evaluateFunctional` compares each case's stdout to the expected output **after
normalisation** (`normalizeOutput`: CRLF→LF, trailing whitespace per line
stripped, trailing newlines removed). A correct program that prints
`5\n` vs `5` still passes. Run statuses map as:

| Judge0 outcome         | TestOutcome                 |
| ---------------------- | --------------------------- |
| completed + match      | `PASSED`                    |
| completed + mismatch   | `FAILED`                    |
| timeout                | `TIMEOUT`                   |
| runtime/internal error | `ERROR`                     |
| compile error          | `ERROR` (+ `compileFailed`) |
| no run for the case    | `SKIPPED`                   |

`ratio = weightedEarned / weightedTotal` (falls back to `passedCount/totalCount`
when every weight is 0). This is the single number every criterion is anchored
to, so **any** correct implementation earns full functional credit — the engine
never compares against a reference algorithm.

### 2. Rubric scoring — one `CriterionScore` per criterion

`gradeRubric` switches on `RubricCriterionType`. Each criterion's persisted
`config` JSON is parsed defensively by `parseCriterionConfig` (unknown shapes
become `{}`; a bad value is ignored, never fatal).

- **FUNCTIONAL_CORRECTNESS** — `maxPoints * ratio`.
- **PERFORMANCE** — `0` when `ratio === 0`; otherwise full marks if the slowest
  case ≤ `config.targetTimeMs` (default 1000 ms), `0` at ≥ 3× target, linear
  between, then `* ratio`.
- **ALGORITHMIC_APPROACH / SEMANTIC_CORRECTNESS / CODE_QUALITY / OTHER**
  ("qualitative") — start at `base = maxPoints * ratio`. If the semantic
  analysis is unavailable, return `base` with a note (never a penalty). If it is
  available, subtract only for **concrete, named** problems:
  - a `config.forbidden` construct the analyzer actually reported
    (`maxPoints * penaltyPerViolation`, default 0.5 each);
  - CODE_QUALITY: a function longer than `config.maxFunctionLength` or nesting
    deeper than `config.maxNestingDepth`, plus analyzer `quality` findings;
  - `config.required` items are advisory unless `config.mode === "strict"`.
    Result is `clamp(base - penalties, 0, maxPoints)`.

No rubric → one implicit `FUNCTIONAL_CORRECTNESS` criterion worth 100, scored
`100 * ratio`, `criterionId: "implicit-functional"` (the evaluator does not
persist a `CriterionScore` row for it).

### 3. Semantic analysis — pluggable, fail-open

`SemanticAnalyzer { name; supports(lang); analyze(lang, code) }`. v1 is
`PythonAstAnalyzer`: it runs `python3 -c <script>` and pipes the student's source
to stdin; the script only calls `ast.parse` — **student code is never executed**.
It reports structural metrics (function/loop/branch counts, max nesting, max
function length, recursion) and findings (`forbidden` calls like `eval`/`exec`,
`os.system`, `subprocess`; `bare_except`; `while True` with no `break`; info
findings; a `long_function` quality finding).

Any other language returns `available: false`, and grading falls back to
functional correctness — so the analyzer can never falsely penalise a language
it doesn't understand.

## Idempotency & audit

The evaluator claims a submission atomically (`QUEUED → RUNNING`) and writes
exactly one `EvaluationRun` (`@@unique([submissionId, runNumber])`, always
`runNumber = 1`). `TestCaseResult` and `CriterionScore` are upserted on their
unique keys, so a retried run converges rather than duplicating. Every score,
plus the reasons behind it and the semantic summary, is persisted on the run.
