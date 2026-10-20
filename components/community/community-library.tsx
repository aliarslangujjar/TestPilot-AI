"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  deleteCommunityTemplate,
  getCommunityTemplate,
  importCommunityTemplate,
  listCommunityTemplates,
  reportCommunityTemplate,
  unpublishCommunityTemplate,
} from "@/lib/community/actions";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_APP_TYPE_LABELS,
  TEMPLATE_LICENSE_LABELS,
  TEMPLATE_REPORT_REASON_LABELS,
  templateAppTypeSchema,
  templateLicenseSchema,
  templateReportReasonSchema,
  type CommunityTemplate,
  type CommunityTemplateDetail,
} from "@schemas/community";

interface ProjectOption {
  id: string;
  name: string;
}

interface CommunityLibraryProps {
  workspaceId: string;
  initialTemplates: CommunityTemplate[];
  initialMine: CommunityTemplate[];
  projects: ProjectOption[];
  initialError: string | null;
}

const inputClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

export function CommunityLibrary({
  workspaceId,
  initialTemplates,
  initialMine,
  projects,
  initialError,
}: CommunityLibraryProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [mine, setMine] = useState(initialMine);
  const [error, setError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [appType, setAppType] = useState("");
  const [license, setLicense] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"newest" | "most_imported" | "most_viewed">("newest");

  const [detail, setDetail] = useState<CommunityTemplateDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [importProjectId, setImportProjectId] = useState(projects[0]?.id ?? "");
  const [suiteName, setSuiteName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<string>("spam");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const mineIds = useMemo(() => new Set(mine.map((t) => t.id)), [mine]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await listCommunityTemplates(workspaceId, {
        search,
        appType: appType ? (appType as CommunityTemplate["appType"]) : null,
        license: license ? (license as CommunityTemplate["license"]) : null,
        tag,
        sort,
      });
      if (cancelled) return;
      if (res.ok) {
        setTemplates(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceId, search, appType, license, tag, sort]);

  async function openPreview(template: CommunityTemplate) {
    setDetailBusy(true);
    setImportMessage(null);
    setReportMessage(null);
    const res = await getCommunityTemplate(workspaceId, template.id);
    setDetailBusy(false);
    if (res.ok) {
      setDetail(res.data);
      setSuiteName(`${res.data.name} (imported)`);
      setTemplates((prev) =>
        prev.map((t) => (t.id === template.id ? { ...t, viewCount: t.viewCount + 1 } : t)),
      );
    } else {
      setError(res.error);
    }
  }

  async function handleImport() {
    if (!detail || !importProjectId) return;
    setImportBusy(true);
    setImportMessage(null);
    const res = await importCommunityTemplate(workspaceId, importProjectId, detail.id, {
      suiteName: suiteName.trim(),
    });
    setImportBusy(false);
    if (res.ok) {
      setImportMessage(
        `Imported ${res.data.caseCount} cases as drafts into a new suite. They are drafts — review them before use.`,
      );
      setTemplates((prev) =>
        prev.map((t) => (t.id === detail.id ? { ...t, importCount: t.importCount + 1 } : t)),
      );
    } else {
      setImportMessage(res.error);
    }
  }

  async function handleReport() {
    if (!detail) return;
    setReportBusy(true);
    const res = await reportCommunityTemplate(workspaceId, detail.id, { reason: reportReason });
    setReportBusy(false);
    setReportMessage(res.ok ? "Report submitted. Thank you." : res.error);
  }

  async function handleUnpublish(template: CommunityTemplate) {
    const res = await unpublishCommunityTemplate(workspaceId, template.id);
    if (res.ok) {
      setMine((prev) =>
        prev.map((t) => (t.id === template.id ? { ...t, status: "removed" as const } : t)),
      );
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      if (detail?.id === template.id) setDetail(null);
    } else {
      setError(res.error);
    }
  }

  async function handleDelete(template: CommunityTemplate) {
    const res = await deleteCommunityTemplate(workspaceId, template.id);
    if (res.ok) {
      setMine((prev) => prev.filter((t) => t.id !== template.id));
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      if (detail?.id === template.id) setDetail(null);
    } else {
      setError(res.error);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Community templates</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Reusable QA templates shared by other users. Templates are validated data — importing one
        copies its cases into your project as <strong>drafts</strong>. Nothing is executed and your
        workspace data is never shared back.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="ct-search" className={labelClass}>
            Search
          </label>
          <input
            id="ct-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className={cn(inputClass, "w-56")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ct-type" className={labelClass}>
            App type
          </label>
          <select
            id="ct-type"
            value={appType}
            onChange={(e) => setAppType(e.target.value)}
            className={inputClass}
          >
            <option value="">All types</option>
            {templateAppTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_APP_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ct-license" className={labelClass}>
            License
          </label>
          <select
            id="ct-license"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            className={inputClass}
          >
            <option value="">All licenses</option>
            {templateLicenseSchema.options.map((l) => (
              <option key={l} value={l}>
                {TEMPLATE_LICENSE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ct-tag" className={labelClass}>
            Tag
          </label>
          <input
            id="ct-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="e.g. checkout"
            className={cn(inputClass, "w-36")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ct-sort" className={labelClass}>
            Sort
          </label>
          <select
            id="ct-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className={inputClass}
          >
            <option value="newest">Newest</option>
            <option value="most_imported">Most imported</option>
            <option value="most_viewed">Most viewed</option>
          </select>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No templates match. Try clearing the filters — or publish the first one from one of your
          stored test plans.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium">{t.name}</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  {TEMPLATE_LICENSE_LABELS[t.license]}
                </span>
              </div>
              {t.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                by {t.authorDisplayName} · {TEMPLATE_APP_TYPE_LABELS[t.appType]} · {t.caseCount}{" "}
                cases · {t.viewCount} views · {t.importCount} imports
                {mineIds.has(t.id) ? " · yours" : ""}
              </p>
              {t.tags.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Tags: {t.tags.join(", ")}</p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={detailBusy}
                onClick={() => void openPreview(t)}
              >
                Preview
              </Button>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section aria-label="Template preview" className="mt-8 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">{detail.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                by {detail.authorDisplayName} · {TEMPLATE_LICENSE_LABELS[detail.license]} ·{" "}
                {detail.caseCount} cases
              </p>
              {detail.description && (
                <p className="mt-2 text-sm text-muted-foreground">{detail.description}</p>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDetail(null)}>
              Close preview
            </Button>
          </div>

          <ol className="mt-4 space-y-3">
            {detail.content.cases.map((c, i) => (
              <li key={i} className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {c.title}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {c.testType} · {c.area} · {c.priority}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{c.objective}</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                  {c.steps.map((s, j) => (
                    <li key={j}>
                      {s.action} — <span className="text-muted-foreground">{s.expected}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Expected:</span> {c.expectedResults}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="ct-import-project" className={labelClass}>
                Import into project
              </label>
              <select
                id="ct-import-project"
                value={importProjectId}
                onChange={(e) => setImportProjectId(e.target.value)}
                className={inputClass}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ct-suite-name" className={labelClass}>
                New suite name
              </label>
              <input
                id="ct-suite-name"
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                className={cn(inputClass, "w-56")}
              />
            </div>
            <Button
              type="button"
              disabled={importBusy || !importProjectId || !suiteName.trim()}
              onClick={() => void handleImport()}
            >
              {importBusy ? "Importing…" : "Import as drafts"}
            </Button>
          </div>
          {importMessage && <p className="mt-2 text-sm text-muted-foreground">{importMessage}</p>}
          {importProjectId && (
            <p className="mt-1 text-xs text-muted-foreground">
              Imported cases credit the author and license in the suite description.{" "}
              <Link
                className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0")}
                href={`/dashboard/projects/${importProjectId}/suites`}
              >
                View suites
              </Link>
            </p>
          )}

          {!mineIds.has(detail.id) && (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="ct-report-reason" className={labelClass}>
                  Report this template
                </label>
                <select
                  id="ct-report-reason"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className={inputClass}
                >
                  {templateReportReasonSchema.options.map((r) => (
                    <option key={r} value={r}>
                      {TEMPLATE_REPORT_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reportBusy}
                onClick={() => void handleReport()}
              >
                {reportBusy ? "Reporting…" : "Report"}
              </Button>
              {reportMessage && <p className="text-sm text-muted-foreground">{reportMessage}</p>}
            </div>
          )}
        </section>
      )}

      {mine.length > 0 && (
        <section aria-label="Your published templates" className="mt-10">
          <h2 className="text-lg font-medium">Your published templates</h2>
          <ul className="mt-3 space-y-2">
            {mine.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.status} · {t.caseCount} cases · {t.viewCount} views · {t.importCount} imports
                    · {TEMPLATE_LICENSE_LABELS[t.license]}
                  </p>
                </div>
                <div className="flex gap-2">
                  {t.status === "published" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUnpublish(t)}
                    >
                      Unpublish
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(t)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
