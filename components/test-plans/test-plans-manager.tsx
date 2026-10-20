"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { publishCommunityTemplate } from "@/lib/community/actions";
import {
  TEMPLATE_LICENSE_LABELS,
  templateLicenseSchema,
  type TemplateLicense,
} from "@schemas/community";
import {
  convertTestPlan,
  deleteTestPlan,
  generateAndStoreTestPlan,
  getPlanGenerationEstimate,
  listTestPlans,
} from "@/lib/test-plans/plans";
import { getPlanTemplate, listPlanTemplates } from "@/lib/test-plans/templates";
import {
  PRIORITY_STRATEGY_LABELS,
  TEST_PLAN_SOURCE_LABELS,
  TEST_TYPE_LABELS,
  type PriorityStrategy,
  type StoredTestPlan,
  type TestPlanSourceKind,
  type TestType,
} from "@schemas/test-plan";
import { cn } from "@/lib/utils";

const TEST_TYPES: TestType[] = Object.keys(TEST_TYPE_LABELS) as TestType[];
const SOURCE_KINDS: TestPlanSourceKind[] = Object.keys(
  TEST_PLAN_SOURCE_LABELS,
) as TestPlanSourceKind[];
const STRATEGIES: PriorityStrategy[] = Object.keys(PRIORITY_STRATEGY_LABELS) as PriorityStrategy[];

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

function typeBadgeClass(testType: TestType): string {
  switch (testType) {
    case "negative":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
    case "boundary":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    case "security":
      return "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200";
    case "accessibility":
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200";
    case "performance":
      return "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200";
    default:
      return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
  }
}

function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case "critical":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
    case "high":
      return "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200";
    case "medium":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    default:
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

interface FormState {
  name: string;
  templateKey: string;
  sourceKind: TestPlanSourceKind;
  sourceText: string;
  testTypes: TestType[];
  coverageAreas: string[];
  priorityStrategy: PriorityStrategy;
  maxCases: number;
}

function initialForm(): FormState {
  const template = getPlanTemplate("general-web-app");
  return {
    name: "",
    templateKey: "general-web-app",
    sourceKind: "user_story",
    sourceText: "",
    testTypes: template?.defaultTestTypes ?? ["functional"],
    coverageAreas: template?.defaultCoverageAreas ?? [],
    priorityStrategy: "balanced",
    maxCases: 12,
  };
}

function NewPlanForm({
  workspaceId,
  projectId,
  onCreated,
}: {
  workspaceId: string;
  projectId: string;
  onCreated: (plan: StoredTestPlan) => void;
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [newArea, setNewArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    enabled: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(key: string) {
    const template = getPlanTemplate(key);
    if (!template) return;
    setForm((f) => ({
      ...f,
      templateKey: key,
      testTypes: template.defaultTestTypes,
      coverageAreas: template.defaultCoverageAreas,
    }));
  }

  function toggleType(type: TestType) {
    setForm((f) => ({
      ...f,
      testTypes: f.testTypes.includes(type)
        ? f.testTypes.filter((t) => t !== type)
        : [...f.testTypes, type],
    }));
  }

  async function handleEstimate() {
    if (form.sourceText.trim().length < 20) {
      setError("Describe the story, criteria, or request in at least 20 characters first.");
      return;
    }
    setEstimating(true);
    setError(null);
    try {
      const res = await getPlanGenerationEstimate(
        workspaceId,
        form.sourceText.trim(),
        form.maxCases,
      );
      if (res.ok) setEstimate(res.data);
      else setError(res.error);
    } catch {
      setError("Could not estimate usage.");
    } finally {
      setEstimating(false);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await generateAndStoreTestPlan({
        workspaceId,
        projectId,
        name: form.name.trim(),
        sourceKind: form.sourceKind,
        sourceText: form.sourceText.trim(),
        templateKey: form.templateKey,
        testTypes: form.testTypes,
        coverageAreas: form.coverageAreas,
        priorityStrategy: form.priorityStrategy,
        maxCases: form.maxCases,
      });
      if (res.ok) onCreated(res.data.plan);
      else setError(res.error);
    } catch {
      setError("Generation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const invalid =
    form.name.trim().length < 2 ||
    form.sourceText.trim().length < 20 ||
    form.testTypes.length === 0 ||
    form.coverageAreas.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="plan-name">
          Plan name
        </label>
        <input
          id="plan-name"
          className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Checkout flow v2"
          maxLength={120}
        />
      </div>

      <div>
        <p className="text-sm font-medium">Template</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {listPlanTemplates().map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => applyTemplate(t.key)}
              aria-pressed={form.templateKey === t.key}
              className={cn(
                "rounded-lg border p-3 text-left text-sm",
                form.templateKey === t.key
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/50",
              )}
            >
              <p className="font-medium">{t.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A template seeds the test types and coverage areas below — change anything you like.
        </p>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="plan-source-kind">
          Source
        </label>
        <select
          id="plan-source-kind"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={form.sourceKind}
          onChange={(e) =>
            setForm((f) => ({ ...f, sourceKind: e.target.value as TestPlanSourceKind }))
          }
        >
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {TEST_PLAN_SOURCE_LABELS[k]}
            </option>
          ))}
        </select>
        <textarea
          className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          rows={6}
          value={form.sourceText}
          onChange={(e) => setForm((f) => ({ ...f, sourceText: e.target.value }))}
          placeholder="Paste the user story, acceptance criteria, or testing request…"
          maxLength={8000}
          aria-label="Source text"
        />
      </div>

      <div>
        <p className="text-sm font-medium">Test types</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TEST_TYPES.map((t) => (
            <label
              key={t}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                form.testTypes.includes(t) ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={form.testTypes.includes(t)}
                onChange={() => toggleType(t)}
              />
              {TEST_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Coverage areas</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {form.coverageAreas.map((area) => (
            <span
              key={area}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm"
            >
              {area}
              <button
                type="button"
                aria-label={`Remove ${area}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    coverageAreas: f.coverageAreas.filter((a) => a !== area),
                  }))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            placeholder="Add a coverage area…"
            maxLength={60}
            aria-label="New coverage area"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!newArea.trim() || form.coverageAreas.length >= 10}
            onClick={() => {
              const value = newArea.trim();
              if (value && !form.coverageAreas.includes(value)) {
                setForm((f) => ({ ...f, coverageAreas: [...f.coverageAreas, value] }));
              }
              setNewArea("");
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="plan-strategy">
            Priorities
          </label>
          <select
            id="plan-strategy"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={form.priorityStrategy}
            onChange={(e) =>
              setForm((f) => ({ ...f, priorityStrategy: e.target.value as PriorityStrategy }))
            }
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {PRIORITY_STRATEGY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="plan-max-cases">
            Max cases (1–30)
          </label>
          <input
            id="plan-max-cases"
            type="number"
            min={1}
            max={30}
            className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            value={form.maxCases}
            onChange={(e) => setForm((f) => ({ ...f, maxCases: Number(e.target.value) || 1 }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={estimating}
          onClick={handleEstimate}
        >
          {estimating ? "Estimating…" : "Estimate usage"}
        </Button>
        {estimate && (
          <span className="text-xs text-muted-foreground">
            ≈ {estimate.inputTokens + estimate.outputTokens} tokens · {formatCost(estimate.costUsd)}
            {!estimate.enabled && " · AI is not enabled — generation will be refused"}
          </span>
        )}
        <div className="ml-auto">
          <Button type="button" disabled={busy || invalid} onClick={handleGenerate}>
            {busy ? "Generating…" : "Generate and store plan"}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function PlanDetail({
  workspaceId,
  projectId,
  plan,
  onChanged,
}: {
  workspaceId: string;
  projectId: string;
  plan: StoredTestPlan;
  onChanged: (plan: StoredTestPlan | null) => void;
}) {
  const [suiteName, setSuiteName] = useState(plan.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const grouped = new Map<string, typeof plan.plan.cases>();
  for (const c of plan.plan.cases) {
    const list = grouped.get(c.area) ?? [];
    list.push(c);
    grouped.set(c.area, list);
  }

  async function handleConvert() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await convertTestPlan(workspaceId, projectId, plan.id, {
        suiteName: suiteName.trim(),
      });
      if (res.ok) {
        setNotice(
          `Converted: ${res.data.caseCount} draft case${res.data.caseCount === 1 ? "" : "s"} created in the new suite.`,
        );
        const refreshed = await listTestPlans(workspaceId, projectId);
        if (refreshed.ok) {
          const updated = refreshed.data.find((p) => p.id === plan.id) ?? null;
          onChanged(updated);
        }
      } else {
        setError(res.error);
      }
    } catch {
      setError("Conversion failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await deleteTestPlan(workspaceId, projectId, plan.id);
      if (res.ok) onChanged(null);
      else setError(res.error);
    } catch {
      setError("Delete failed. Please try again.");
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  const template = getPlanTemplate(plan.templateKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <Badge
          className={
            plan.status === "converted"
              ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }
        >
          {plan.status}
        </Badge>
        <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {template?.name ?? plan.templateKey}
        </Badge>
        {plan.model && (
          <span className="text-xs text-muted-foreground">generated by {plan.model}</span>
        )}
        <div className="ml-auto">
          {confirmingDelete ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-sm text-muted-foreground">Delete this plan?</span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={handleDelete}>
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{plan.plan.summary}</p>

      <div className="space-y-4">
        {[...grouped.entries()].map(([area, cases]) => (
          <section key={area} className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-medium">{area}</h3>
            <ul className="mt-2 space-y-3">
              {cases.map((c, i) => (
                <li key={i} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{c.title}</span>
                    <Badge className={typeBadgeClass(c.testType)}>
                      {TEST_TYPE_LABELS[c.testType]}
                    </Badge>
                    <Badge className={priorityBadgeClass(c.priority)}>{c.priority}</Badge>
                    <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {c.coverage}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.objective}</p>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer">Steps ({c.steps.length})</summary>
                    <ol className="mt-1 list-decimal pl-5">
                      {c.steps.map((s, j) => (
                        <li key={j}>
                          {s.action}
                          <span className="text-muted-foreground"> — expected: {s.expected}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                  {c.assumptions.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Assumes: {c.assumptions.join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {plan.status === "draft" ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-medium">Convert into test cases</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Creates a new suite with all {plan.plan.cases.length} cases as drafts. Converted cases
            are planning material — they are not executed coverage.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="w-full max-w-sm rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
              maxLength={120}
              aria-label="Suite name"
            />
            <Button
              size="sm"
              disabled={busy || suiteName.trim().length < 2}
              onClick={handleConvert}
            >
              {busy ? "Converting…" : "Convert to suite"}
            </Button>
          </div>
          {notice && <p className="mt-2 text-sm text-green-700 dark:text-green-300">{notice}</p>}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Already converted.
          {plan.suiteId && (
            <Link
              href={`/dashboard/projects/${projectId}/suites`}
              className={cn(buttonVariants({ variant: "link", size: "sm" }))}
            >
              View suite
            </Link>
          )}
        </p>
      )}

      <PublishToCommunity workspaceId={workspaceId} projectId={projectId} plan={plan} />
    </div>
  );
}

export function TestPlansManager({
  workspaceId,
  projectId,
  projectName,
  initialPlans,
  initialError,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
  initialPlans: StoredTestPlan[];
  initialError: string | null;
}) {
  const [plans, setPlans] = useState<StoredTestPlan[]>(initialPlans);
  const [view, setView] = useState<"list" | "new" | { detail: string }>("list");
  const [error] = useState<string | null>(initialError);

  async function refresh() {
    const res = await listTestPlans(workspaceId, projectId);
    if (res.ok) setPlans(res.data);
  }

  const detailPlan =
    typeof view === "object" ? (plans.find((p) => p.id === view.detail) ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Test plans</h1>
        <span className="text-sm text-muted-foreground">{projectName}</span>
        <div className="ml-auto flex gap-2">
          {view !== "list" && (
            <Button variant="outline" size="sm" onClick={() => setView("list")}>
              Back to plans
            </Button>
          )}
          {view === "list" && (
            <Button size="sm" onClick={() => setView("new")}>
              New test plan
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {view === "new" && (
        <NewPlanForm
          workspaceId={workspaceId}
          projectId={projectId}
          onCreated={async (plan) => {
            await refresh();
            setView({ detail: plan.id });
          }}
        />
      )}

      {typeof view === "object" &&
        (detailPlan ? (
          <PlanDetail
            workspaceId={workspaceId}
            projectId={projectId}
            plan={detailPlan}
            onChanged={async (updated) => {
              await refresh();
              setView(updated ? { detail: updated.id } : "list");
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Plan not found.</p>
        ))}

      {view === "list" && (
        <>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No test plans yet. Generate one from a user story or acceptance criteria — pick a
              template, control the test types, coverage areas, and priorities, then convert the
              stored plan into a suite of draft test cases.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Plan</th>
                    <th className="py-1 pr-2 font-medium">Template</th>
                    <th className="py-1 pr-2 font-medium">Cases</th>
                    <th className="py-1 pr-2 font-medium">Status</th>
                    <th className="py-1 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => setView({ detail: p.id })}
                        >
                          {p.name}
                        </button>
                      </td>
                      <td className="py-1 pr-2 text-muted-foreground">
                        {getPlanTemplate(p.templateKey)?.name ?? p.templateKey}
                      </td>
                      <td className="py-1 pr-2">{p.plan.cases.length}</td>
                      <td className="py-1 pr-2">
                        <Badge
                          className={
                            p.status === "converted"
                              ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-1 text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Stored plans are planning material — generating a plan never claims any test was
            executed or any coverage achieved.
          </p>
        </>
      )}
    </div>
  );
}

function PublishToCommunity({
  workspaceId,
  projectId,
  plan,
}: {
  workspaceId: string;
  projectId: string;
  plan: StoredTestPlan;
}) {
  const [license, setLicense] = useState<TemplateLicense>("CC-BY-4.0");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  async function handlePublish() {
    setBusy(true);
    setMessage(null);
    const res = await publishCommunityTemplate(workspaceId, projectId, plan.id, {
      description: description.trim(),
      license,
      tags: tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    });
    setBusy(false);
    if (res.ok) {
      setPublished(true);
      setMessage(`Published as "${res.data.name}" under ${res.data.license}.`);
    } else {
      setMessage(res.error);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <h3 className="font-medium">Publish to the community library</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Shares a validated copy of this plan&apos;s cases as a public template under your name.
        Publishing does not share your workspace, project, or any executed data — only these plan
        cases.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="publish-license">
          License
        </label>
        <select
          id="publish-license"
          value={license}
          onChange={(e) => setLicense(e.target.value as TemplateLicense)}
          className="h-9 max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        >
          {templateLicenseSchema.options.map((l) => (
            <option key={l} value={l}>
              {TEMPLATE_LICENSE_LABELS[l]}
            </option>
          ))}
        </select>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="publish-description">
          Description (optional)
        </label>
        <input
          id="publish-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="What does this template cover?"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <label className="text-xs font-medium text-muted-foreground" htmlFor="publish-tags">
          Tags (comma-separated, optional)
        </label>
        <input
          id="publish-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="checkout, payments"
          className="h-9 max-w-sm rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={busy || published} onClick={() => void handlePublish()}>
          {busy ? "Publishing…" : published ? "Published" : "Publish template"}
        </Button>
        <Link
          href="/dashboard/community"
          className={cn(buttonVariants({ variant: "link", size: "sm" }))}
        >
          Open community library
        </Link>
      </div>
      {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
