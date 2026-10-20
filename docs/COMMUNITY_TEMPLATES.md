# Community Template Library

Reusable QA templates shared across workspaces, at `/dashboard/community`.
Publish from a stored test plan's detail view; import into any project
you belong to.

## Model

Publishing **snapshots** a plan's cases into `community_templates`
(migration `20261019190000_community_templates.sql`) under an explicit
license — MIT, CC BY 4.0, or CC0 1.0, chosen by the author at publish
time. The row stores the author's user id plus a **display-name
snapshot** (attribution survives profile changes), the app type
(taken from the source plan's template), tags, the validated content,
and view/import counters. No workspace or project identifiers are
stored on the template: publishing shares plan cases only, never
workspace data.

## Templates are untrusted data

Three validation layers run at publish time **and again at import and
preview time** (`lib/community/validate.ts`), because stored content
is never trusted:

1. **Strict schema** (`templateContentSchema`, `.strict()` everywhere):
   unknown keys are rejected outright, so fields like `script`, `eval`,
   `baseUrl`, or `allowedHosts` cannot be smuggled in to influence
   execution or weaken URL restrictions.
2. **Executable-content scan**: text fields must not contain
   `javascript:`/`data:text/html` URIs, `<script>`, `page.evaluate`,
   `child_process`, `eval(`/`exec(`, `process.env`, pipe-to-shell,
   `rm -rf`, or PowerShell constructs.
3. **URL restrictions**: any URL written in the text must be http(s),
   carry no embedded credentials, and must not point at loopback,
   private, link-local, or cloud-metadata hosts.

Cases are also capped (50 per template, 30 steps per case) and validated
against the same typed case schema the AI test-plan generator produces
(test type, coverage, priority, area).

## Import isolation

Importing requires membership in the **target** workspace, re-validates
the content, then creates a brand-new suite plus draft cases in the
importer's project. The suite description credits the template name,
author, and license. Imports never modify the template (only its
import counter, via a narrow SECURITY DEFINER RPC), never read the
author's workspace, and imported cases are drafts — review is on the
importer, exactly like AI-generated cases.

## Browsing, preview, counts

Any signed-in user can browse published templates (RLS: published rows
readable by all authenticated users; authors can always see their own).
Search matches name/description; filters cover app type, license, and
tag; sorting is newest / most imported / most viewed. Opening a preview
re-validates the content and bumps the view counter via
`bump_community_template_views` (counters use SECURITY DEFINER RPCs
because RLS rightly prevents users updating other authors' rows).

## Reporting abuse

Signed-in users can report a template (spam, malicious content,
copyright, inappropriate, other) — one report per user per template,
enforced by a unique constraint. Reports are private to the reporter;
they are a moderation input for service-role review, not a public
signal. Authors can unpublish (status → removed, immediately invisible
and non-importable) or delete their templates at any time; non-authors
get the same "not found" as a missing template.
