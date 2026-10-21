# Third-Party Notices

TestPilot AI is MIT-licensed (see LICENSE.md). It builds on the
open-source packages below — the direct production dependencies of
the root `package.json` (the web app and the Playwright worker
share one manifest), each listed with the license declared in its
own package.json. Transitive dependencies are covered by their own
packages' license files in `node_modules`.

Regenerate with `node scripts/generate-notices.mjs` after dependency
changes.

| Package                  | Version | License    | Author                               |
| ------------------------ | ------- | ---------- | ------------------------------------ |
| @ai-sdk/anthropic        | 4.0.82  | Apache-2.0 |                                      |
| @ai-sdk/openai           | 4.0.96  | Apache-2.0 |                                      |
| @supabase/ssr            | 0.12.7  | MIT        | Supabase, Inc.                       |
| @supabase/supabase-js    | 2.118.0 | MIT        | Supabase                             |
| ai                       | 7.0.143 | Apache-2.0 |                                      |
| class-variance-authority | 0.7.1   | Apache-2.0 | Joe Bell (https://joebell.co.uk)     |
| clsx                     | 2.1.1   | MIT        | Luke Edwards                         |
| next                     | 16.4.2  | MIT        |                                      |
| playwright               | 1.64.1  | Apache-2.0 | Microsoft Corporation                |
| react                    | 19.3.1  | MIT        |                                      |
| react-dom                | 19.3.1  | MIT        |                                      |
| tailwind-merge           | 3.7.0   | MIT        | Dany Castillo                        |
| zod                      | 4.6.7   | MIT        | Colin McDonnell <zod@colinhacks.com> |
