# TestPilot AI — Browser Test Specification (v1)

A constrained, versioned JSON format for describing browser tests. It is
**the only shape the future executor will accept**: plans are validated
with `parseBrowserTestPlan()` before anything runs, and anything outside
the spec fails closed.

> Status: specification only. The Playwright executor is still a
> placeholder — TestPilot does not execute browser tests yet, and nothing
> in the product may claim otherwise.

## Versioning

- `version` is the literal `"1"`.
- Additive changes (new actions, locators, options) keep old plans parsing.
- Breaking changes bump the version; old plans then fail validation.

## Plan shape

```json
{
  "version": "1",
  "name": "Login flow",
  "description": "Happy-path sign in.",
  "baseUrl": "https://app.example.com",
  "allowedHosts": ["app.example.com"],
  "steps": [
    { "action": "goto", "url": "/login" },
    { "action": "fill", "locator": { "by": "label", "label": "Email" }, "value": "qa@example.com" },
    { "action": "click", "locator": { "by": "role", "role": "button", "name": "Sign in" } },
    { "action": "assertUrl", "expected": "/dashboard", "match": "contains" },
    {
      "action": "assertText",
      "locator": { "by": "role", "role": "heading" },
      "text": "Welcome back"
    },
    {
      "action": "assertState",
      "locator": { "by": "role", "role": "button", "name": "Sign out" },
      "state": "visible"
    }
  ]
}
```

## Actions (closed set)

| Action        | Fields                                                                                            | Meaning                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `goto`        | `url`, `timeoutMs?`                                                                               | Navigate. Absolute URLs must be allowlisted; relative targets must start with `/`. |
| `click`       | `locator`, `timeoutMs?`                                                                           | Click the located element.                                                         |
| `fill`        | `locator`, `value`, `timeoutMs?`                                                                  | Type `value` into the located input.                                               |
| `assertText`  | `locator`, `text`, `exact?` (default `false`)                                                     | The element's text contains (or exactly equals) `text`.                            |
| `assertUrl`   | `expected`, `match` (`exact` \| `contains`, default `exact`)                                      | The current URL equals or contains `expected`.                                     |
| `assertState` | `locator`, `state` (`visible` \| `hidden` \| `enabled` \| `disabled` \| `checked` \| `unchecked`) | The element is in `state`.                                                         |

Any other `action` value (e.g. `evaluate`, `exec`, `runScript`) is a
validation error — rejected, never ignored.

## Locators (accessibility-first)

| `by`          | Fields                      |
| ------------- | --------------------------- |
| `role`        | `role` (ARIA role), `name?` |
| `label`       | `label`                     |
| `placeholder` | `placeholder`               |
| `text`        | `text`                      |
| `testId`      | `testId`                    |

No CSS or XPath selectors: plans can't depend on DOM internals, and
there is no selector language to smuggle script into.

## Limits

| Limit          | Value                      |
| -------------- | -------------------------- |
| Steps per plan | 1–50                       |
| Allowed hosts  | 1–10                       |
| Text fields    | ≤ 2000 chars (names ≤ 200) |
| Fill values    | ≤ 2000 chars               |
| `timeoutMs`    | 100–30 000 ms, optional    |

Every object is `.strict()`: unknown keys (an extra `script`, `command`,
`retries`, …) are validation errors.

## Security properties

- **No arbitrary JavaScript evaluation.** There is no `evaluate` action
  and no field that accepts code. Strict parsing rejects smuggled keys.
- **No model-generated shell commands.** There is no `exec`/`shell`
  action; the spec cannot express anything outside the browser.
- **Navigation allowlist.** `baseUrl`'s host must be in `allowedHosts`,
  and every absolute `goto` target must resolve to an allowlisted host.
- **Fail closed.** Malformed input, unknown actions/options, wrong
  versions, and oversized plans all produce validation errors, never
  partial execution.

## For the future executor

1. Parse with `parseBrowserTestPlan()`; refuse on `{ ok: false }`.
2. Execute only the six actions above, in order, against `baseUrl`.
3. Report per-step pass/fail with the flattened `errors` on parse failure.
4. AI-generated plans should flow through the human review gate
   (`docs/AI_TEST_REVIEW.md`) before activation, like manual test cases.

## Testing

`tests/browser-test/spec.test.ts` — deterministic schema tests: every
action and locator kind parses; unknown actions, smuggled script keys,
unknown locators/options, off-allowlist navigation, wrong/missing
versions, empty/malformed steps, oversized plans and fields, and
out-of-range timeouts are all rejected.
