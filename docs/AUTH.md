# Authentication

TestPilot AI uses **Supabase Auth** (email/password). Social login and SSO are
**deferred** — not implemented, not on the near-term roadmap.

## Flows

| Flow            | Entry point        | What happens                                                                     |
| --------------- | ------------------ | -------------------------------------------------------------------------------- |
| Sign up         | `/login` (toggle)  | `supabase.auth.signUp()` → profile row auto-created by DB trigger → `/dashboard` |
| Sign in         | `/login`           | `supabase.auth.signInWithPassword()` → `/dashboard`                              |
| Sign out        | Dashboard header   | `supabase.auth.signOut()` → `/`                                                  |
| Forgot password | `/forgot-password` | `resetPasswordForEmail()` sends a link (generic confirmation, see below)         |
| Reset password  | Email link         | `/auth/callback?next=/reset-password` exchanges the code → `/reset-password`     |

## Redirect URLs

Email links (password reset, and email confirmation if ever enabled) point at
the app's callback route, never directly at a page:

- **Reset link target:** `<SITE_URL>/auth/callback?next=/reset-password`
- The route exchanges the one-time `code` for a session, then redirects to
  `next`. `next` is validated to a same-origin path (`/…`, not `//…` or
  absolute URLs) to block open-redirect attacks; invalid values fall back to
  `/dashboard`.
- Missing/expired codes redirect to `/login?error=link-expired`, which shows
  an explanatory notice.

### Supabase configuration (owner's step)

In the Supabase dashboard → **Authentication → URL Configuration**:

1. **Site URL:** the production URL (e.g. `https://app.example.com`).
2. **Redirect URLs:** add every URL that receives auth links, one per line:
   - `http://127.0.0.1:54321/auth/v1/callback` (local CLI default)
   - `http://localhost:3000/auth/callback?next=/reset-password` (local dev)
   - `https://<production-domain>/auth/callback?next=/reset-password` (production)
3. Redirects are built from `window.location.origin` at runtime, so no extra
   env var is needed — but the production domain must be allow-listed above or
   Supabase will refuse to send the link.

## Session handling

- Sessions live in **httpOnly cookies** managed by `@supabase/ssr`; tokens
  never touch `localStorage` or client-side JS.
- `proxy.ts` (Next.js 16 convention) runs on every request: it refreshes the
  session and validates it with `supabase.auth.getUser()` — never
  `getSession()` alone, whose result is not trustworthy server-side.
- **Protected routes** (enforced in `proxy.ts`, i.e. on the server before any
  page renders): `/dashboard/*` and `/reset-password`. Signed-out visitors go
  to `/login`; signed-in users visiting `/login` or `/forgot-password` go to
  `/dashboard`.
- Client components read the session only for display (dashboard header email)
  and sign-out; authorization decisions always happen server-side.

## Validation

Shared zod schemas in `packages/schemas/src/auth.ts`:

- Email must be a valid address (all forms).
- Sign-in: password non-empty. Sign-up / reset: password ≥ 8 characters
  (stricter than Supabase's default minimum of 6 — deliberate).
- Reset form: confirmation must match.
- The forgot-password confirmation message is intentionally generic — it never
  reveals whether an account exists for the address.

## Secrets

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
  publishable key) are exposed to the browser.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only; `lib/supabase/admin.ts` throws
  if ever imported in a browser bundle.
- No secrets are committed; see `.env.example` for the required names.
