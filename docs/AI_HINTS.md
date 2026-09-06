# Progressive AI hints

Two moving parts:

- **`services/hint-engine`** — a backend-only process that turns a hint request
  into guidance text via an LLM. Never reachable from the browser.
- **The API** (`apps/api`, student module) — owns hint _policy_: progression,
  unlock delays, persistence, and what context is allowed to leave the system.

## Stages (`HintStage` / `HintUsage`)

Each question has ordered `HintStage` rows:

| Stage | Intent                        | `deliveryType` |
| ----- | ----------------------------- | -------------- |
| 1     | conceptual nudge              | `STATIC`       |
| 2     | more specific direction       | `STATIC`       |
| 3     | approach & debugging guidance | `STATIC`       |
| 4     | interactive AI mentor         | `INTERACTIVE`  |

`STATIC` stages return `HintStage.content` from the database. `INTERACTIVE`
stages call the hint-engine.

### Endpoints

- `GET /api/v1/student/sessions/:sid/questions/:qid/hints` — every stage with
  `available` / `lockedReason`; `content` only for stages this session has
  already consumed.
- `POST …/hints` `{ stageNumber }` — request a stage.

### Progression rules (enforced in `student.service.ts`)

1. **Order** — stage 1, or the previous stage already has a `HintUsage` for this
   session. Otherwise `409 HINT_LOCKED`.
2. **Delay** — `unlockDelaySeconds` must have elapsed since `session.startedAt`.
   Otherwise `409 HINT_LOCKED`.
3. **Idempotency** — `HintUsage` is unique on `(examSessionId, hintStageId)`; a
   repeat request for a consumed stage returns the same content.
4. The session must be `IN_PROGRESS` and the question must be in its assessment.

## The provider abstraction (`services/hint-engine`)

```ts
interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateHint(request: HintRequest): Promise<string>; // never a full solution
}
```

`GeminiProvider` is the v1 implementation — plain `fetch` to the Gemini REST
`generateContent` endpoint, zero SDK. **Everything is env-driven**, nothing is
hard-coded:

| Variable          | Default                                            |
| ----------------- | -------------------------------------------------- |
| `GEMINI_API_KEY`  | _(none — provider reports unconfigured)_           |
| `GEMINI_MODEL`    | `gemini-2.0-flash`                                 |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` |
| `LLM_PROVIDER`    | `gemini`                                           |

Swapping in another LLM (or Ollama) means adding one file that implements
`LLMProvider` — the HTTP contract (`POST /hints`) does not change.

### Prompt

A fixed system prompt ("patient tutor… never a complete solution… under 90
words") plus a per-stage user prompt built by `buildHintPrompt`. Only the
**minimum context** is sent: stage number, language, question title/statement,
the student's latest code (if any), and the text of earlier hints (so the model
escalates instead of repeating).

## Failure behaviour — never a fake hint

| Situation                        | Result                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| No `GEMINI_API_KEY`              | hint-engine `503 PROVIDER_NOT_CONFIGURED`; API → `503 HINT_PROVIDER_UNAVAILABLE`     |
| Provider error / timeout / block | hint-engine `502 PROVIDER_ERROR` (no details); API → `503 HINT_PROVIDER_UNAVAILABLE` |
| Static stages                    | always work, regardless of provider state                                            |

The API never forwards provider error text, API keys, or model names to the
client, and never persists a fabricated hint as `CONSUMED`.

## Security

- All hint state is scoped to `req.auth.userId` via the exam session.
- Optional `INTERNAL_SERVICE_TOKEN`: when set, the API sends it as a bearer and
  the hint-engine requires it on `POST /hints`.
