# TestPilot AI — AI Integration

Provider-independent AI service built on the **Vercel AI SDK** (`ai` +
`@ai-sdk/openai` + `@ai-sdk/anthropic`). Everything lives server-side in
`lib/ai/`; there is no AI UI yet — this is the foundation future features
(test-case generation, run summarization) will call.

## Safety model

- **Server-side only.** API keys are read from server env in
  `lib/ai/config.ts`. `resolveModel()` throws in the browser, and the
  service module is `"use server"`. Keys never cross to the client.
- **No tools, ever.** `generateStructured()` calls `generateObject` without
  `tools`. The model can only return text matching the caller's zod schema —
  it cannot execute code, visit URLs, or perform any external action. (A
  test asserts `tools` is never passed.)
- **Validated I/O.** Request fields are zod-validated (`@schemas/ai`);
  model output is parsed against the caller's zod schema by `generateObject`
  (malformed output → `AI_INVALID_RESPONSE`).
- **Input caps.** `AI_MAX_INPUT_CHARS` bounds prompt/system size before any
  paid call (oversized input → `AI_INPUT_TOO_LONG`).

## Configuration

| Variable                 | Default          | Purpose                                           |
| ------------------------ | ---------------- | ------------------------------------------------- |
| `AI_PROVIDER`            | `openai`         | `openai` or `anthropic` — an env change, not code |
| `AI_MODEL`               | provider default | Override the model id                             |
| `OPENAI_API_KEY`         | —                | Required when `AI_PROVIDER=openai`                |
| `ANTHROPIC_API_KEY`      | —                | Required when `AI_PROVIDER=anthropic`             |
| `AI_TIMEOUT_MS`          | `30000`          | Per-request timeout (1s–120s)                     |
| `AI_MAX_RETRIES`         | `2`              | Bounded SDK retries on 408/425/429/5xx (0–5)      |
| `AI_MAX_INPUT_CHARS`     | `12000`          | Max chars per prompt/system field                 |
| `AI_DAILY_REQUEST_LIMIT` | `100`            | Per-workspace requests/day                        |
| `AI_DAILY_TOKEN_LIMIT`   | `200000`         | Per-workspace (input+output) tokens/day           |

With no API key for the selected provider, the service is **disabled**:
`getAIStatus()` reports `{ enabled: false }` and calls throw
`AI_DISABLED`. Nothing is billed, nothing is called.

## Models & costs

Defaults are the cheapest capable tier per provider (override with
`AI_MODEL`):

| Provider  | Default model               | Input / 1M tokens | Output / 1M tokens |
| --------- | --------------------------- | ----------------- | ------------------ |
| OpenAI    | `gpt-4o-mini`               | ~$0.15            | ~$0.60             |
| Anthropic | `claude-3-5-haiku-20241022` | ~$0.80            | ~$4.00             |

Prices are approximate public rates as of October 2026 and change —
verify on the [OpenAI](https://platform.openai.com/docs/pricing) and
[Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)
pricing pages before budgeting. If a default model is retired, set
`AI_MODEL` to its successor; no code changes needed.

**Rough math:** a typical structured call (2k input / 300 output tokens)
costs about **$0.0005 on gpt-4o-mini** and **$0.003 on claude-3-5-haiku**.
At the default quota (100 requests/day), a workspace's worst-case daily
spend is on the order of **$0.05 (OpenAI)** or **$0.30 (Anthropic)** —
before the token quota, which caps it further.

## Quotas & usage logging

`public.ai_usage` holds one row per workspace per calendar day
(`request_count`, `input_tokens`, `output_tokens`). Migration:
`20261019120000_ai_usage.sql`.

- `checkQuota()` runs before every paid call; over either daily limit →
  `AI_QUOTA_EXCEEDED` (no provider call is made).
- `logUsage()` upserts the call's token counts after success.
- Members can `SELECT` their workspace's rows; writes go through the
  service-role client only (no insert/update/delete policies → fails
  closed).
- Quotas are **soft**: two concurrent requests can both pass the check.
  Fine for cost guardrails, not for hard accounting.

## Errors

Every failure is an `AIServiceError` with a typed `code` — switch on the
code, never on message text:

| Code                  | Meaning                            | Retryable    |
| --------------------- | ---------------------------------- | ------------ |
| `AI_DISABLED`         | No API key for the provider        | no           |
| `AI_NOT_CONFIGURED`   | Env values invalid                 | no           |
| `AI_QUOTA_EXCEEDED`   | Workspace hit a daily limit        | no           |
| `AI_TIMEOUT`          | Exceeded `AI_TIMEOUT_MS`           | yes          |
| `AI_PROVIDER_ERROR`   | Provider 4xx/5xx, network, unknown | 429/5xx only |
| `AI_INVALID_RESPONSE` | Output didn't match the zod schema | no           |
| `AI_INPUT_TOO_LONG`   | Input failed validation / char cap | no           |

Messages are user-safe; the raw error stays on `error.cause` for server
logs only.

## Usage (for future features)

```ts
import { generateStructured } from "@/lib/ai/service";
import { z } from "zod";

const Ideas = z.object({ ideas: z.array(z.string().min(1)).min(1).max(10) });

const { data } = await generateStructured({
  workspaceId, // membership is verified inside
  system: "You draft manual test ideas. Return JSON only.",
  prompt: `Feature: ${featureDescription}`,
  schema: Ideas,
  label: "test-ideas",
});
// data.ideas — typed, zod-validated
```

## Testing

All AI tests are mocked — no network, no paid calls:

- `tests/ai/config.test.ts` — env parsing, defaults, provider validation.
- `tests/ai/errors.test.ts` — SDK/network failures → typed codes.
- `tests/ai/service.test.ts` — `ai` module, workspace authz, and the admin
  client are mocked: membership gating, quotas, usage logging, the
  no-`tools` guarantee, timeout/retry mapping.
- `tests/ai/usage.test.ts` — quota checks and usage upserts.

To test against a real provider, set a key locally and call
`generateStructured` from a scratch script — never from the test suite.
