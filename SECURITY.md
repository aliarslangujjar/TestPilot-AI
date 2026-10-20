# Security Policy

## Supported versions

TestPilot AI is pre-1.0 and moves quickly. Security fixes are applied to
the latest code on the `main` branch only — there are no maintained
release branches. If you self-host, staying current with `main` is the
supported configuration.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a
security vulnerability.** Public reports put every user at risk before
a fix exists.

Report privately instead, using either channel:

1. **GitHub private vulnerability reporting (preferred):** go to the
   repository's **Security** tab → **Advisories** → **Report a
   vulnerability**. This opens a private advisory visible only to you
   and the maintainers.
2. If that option is unavailable to you, contact the maintainer
   privately through their GitHub profile and ask for a private channel
   — describe the issue only once a private channel is established.

Please include, as far as you can:

- A description of the issue and its impact (who is affected, what an
  attacker gains).
- Steps to reproduce, ideally against a local stack — a minimal proof
  of concept helps enormously.
- Affected files/routes/migrations, if known.
- Any suggested fix (optional, very welcome).

## What to expect

This is a small open-source project maintained on a best-effort basis:

- We will acknowledge reports and work on a fix **as promptly as we
  reasonably can**, but we do not offer guaranteed response or
  remediation timelines, and there is no bug bounty program.
- We will credit reporters in the fix announcement/advisory unless you
  ask to remain anonymous.
- Please give us a reasonable opportunity to ship a fix before
  disclosing publicly. If we have gone silent for an extended period,
  a polite follow-up on the private thread is the fastest way to move
  things along.

## Scope notes

Especially in scope — the properties this project treats as
load-bearing:

- Cross-workspace or cross-user data access, RLS bypasses, or any path
  that exposes another workspace's data, reports, or artifacts.
- Leakage of secrets: service-role keys, API keys, credentials in
  public QA reports or community templates, signed-URL escapes.
- The browser-test worker: arbitrary code execution, navigation outside
  a plan's declared hosts, SSRF against local/private/metadata
  addresses, artifact access across workspaces.
- The AI pipeline: prompt-driven tool execution or data exfiltration
  (the service is designed to have no tools — a bypass is a bug).

Out of scope: reports that require a compromised user account or device,
social engineering, denial of service via volume alone, and findings in
third-party dependencies with no demonstrated impact on this project
(report those upstream; a heads-up here is still appreciated).

For the security architecture itself — auth model, RLS design, artifact
handling, and what is verified vs. planned — see
[docs/SECURITY.md](docs/SECURITY.md).
