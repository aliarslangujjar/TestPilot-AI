"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/projects/dialog";
import { createTestCase, updateTestCase } from "@/lib/test-cases/actions";
import { createTestCaseSchema } from "@schemas/test-case";
import type { TestCase, TestCaseStep } from "@schemas/test-case";
import { cn } from "@/lib/utils";

const inputClass =
  "mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["draft", "active"] as const;

interface StepDraft {
  action: string;
  expected: string;
}

/**
 * Create / edit form for a manual test case, including the ordered steps
 * editor. Validates instantly with the shared zod schema; the server action
 * re-validates authoritatively.
 */
export function TestCaseFormDialog({
  workspaceId,
  projectId,
  suiteId,
  testCase,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  suiteId: string;
  testCase?: TestCase;
  onClose: () => void;
  onSaved: (testCase: TestCase, mode: "created" | "updated") => void;
}) {
  const isEdit = !!testCase;
  const [title, setTitle] = useState(testCase?.title ?? "");
  const [description, setDescription] = useState(testCase?.description ?? "");
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(
    testCase?.steps.map((s) => ({ action: s.action, expected: s.expected ?? "" })) ?? [],
  );
  const [expectedResults, setExpectedResults] = useState(testCase?.expectedResults ?? "");
  const [priority, setPriority] = useState<TestCase["priority"]>(testCase?.priority ?? "medium");
  const [tagsInput, setTagsInput] = useState(testCase?.tags.join(", ") ?? "");
  const [status, setStatus] = useState<TestCase["status"]>(testCase?.status ?? "draft");
  const [objective, setObjective] = useState(testCase?.objective ?? "");
  const [coverage, setCoverage] = useState<TestCase["coverage"]>(testCase?.coverage ?? null);
  const [assumptionsInput, setAssumptionsInput] = useState(testCase?.assumptions.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const assumptions = assumptionsInput
      .split("\n")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    const parsed = createTestCaseSchema.safeParse({
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      preconditions: preconditions.trim() ? preconditions.trim() : null,
      steps: steps.map((s) => ({
        action: s.action.trim(),
        expected: s.expected.trim() ? s.expected.trim() : null,
      })),
      expectedResults: expectedResults.trim() ? expectedResults.trim() : null,
      priority,
      tags,
      status,
      objective: objective.trim() ? objective.trim() : null,
      coverage,
      assumptions,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your entries and try again.");
      return;
    }

    setPending(true);
    try {
      const result = isEdit
        ? await updateTestCase(workspaceId, projectId, suiteId, testCase.id, parsed.data)
        : await createTestCase(workspaceId, projectId, suiteId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data, isEdit ? "updated" : "created");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={isEdit ? "Edit test case" : "New test case"}
      labelledBy="test-case-form-title"
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="case-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="case-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Login rejects wrong password"
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="case-objective" className="text-sm font-medium">
            Objective
          </label>
          <input
            id="case-objective"
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What this case verifies, in one sentence"
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="case-priority" className="text-sm font-medium">
              Priority
            </label>
            <select
              id="case-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TestCase["priority"])}
              className={cn(inputClass, "bg-background")}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0]?.toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="case-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="case-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TestCase["status"])}
              className={cn(inputClass, "bg-background")}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]?.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="case-tags" className="text-sm font-medium">
            Tags{" "}
            <span className="font-normal text-muted-foreground">(optional, comma-separated)</span>
          </label>
          <input
            id="case-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="smoke, login"
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="case-coverage" className="text-sm font-medium">
              Coverage <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              id="case-coverage"
              value={coverage ?? ""}
              onChange={(e) => setCoverage((e.target.value || null) as TestCase["coverage"])}
              className={cn(inputClass, "bg-background")}
            >
              <option value="">—</option>
              {["positive", "negative", "boundary"].map((c) => (
                <option key={c} value={c}>
                  {c[0]?.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="case-assumptions" className="text-sm font-medium">
              Assumptions{" "}
              <span className="font-normal text-muted-foreground">(optional, one per line)</span>
            </label>
            <textarea
              id="case-assumptions"
              value={assumptionsInput}
              onChange={(e) => setAssumptionsInput(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="case-description" className="text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="case-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="case-preconditions" className="text-sm font-medium">
            Preconditions <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="case-preconditions"
            value={preconditions}
            onChange={(e) => setPreconditions(e.target.value)}
            placeholder="User account exists; user is signed out."
            rows={2}
            className={inputClass}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Steps</legend>
          {steps.length === 0 && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              No steps yet — add the first one below.
            </p>
          )}
          <ol className="mt-2 space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    className="text-xs font-medium text-destructive underline-offset-4 hover:underline"
                    aria-label={`Remove step ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
                <label
                  htmlFor={`step-action-${i}`}
                  className="mt-2 block text-xs font-medium text-muted-foreground"
                >
                  Action
                </label>
                <input
                  id={`step-action-${i}`}
                  type="text"
                  value={step.action}
                  onChange={(e) => updateStep(i, { action: e.target.value })}
                  placeholder="Enter a wrong password and submit"
                  autoComplete="off"
                  className={inputClass}
                />
                <label
                  htmlFor={`step-expected-${i}`}
                  className="mt-2 block text-xs font-medium text-muted-foreground"
                >
                  Expected <span className="font-normal">(optional)</span>
                </label>
                <input
                  id={`step-expected-${i}`}
                  type="text"
                  value={step.expected}
                  onChange={(e) => updateStep(i, { expected: e.target.value })}
                  placeholder="Error message is shown; user stays signed out"
                  autoComplete="off"
                  className={inputClass}
                />
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setSteps((prev) => [...prev, { action: "", expected: "" }])}
          >
            Add step
          </Button>
        </fieldset>

        <div>
          <label htmlFor="case-expected-results" className="text-sm font-medium">
            Expected results <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="case-expected-results"
            value={expectedResults}
            onChange={(e) => setExpectedResults(e.target.value)}
            placeholder="Overall pass criteria for this test case."
            rows={2}
            className={inputClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create test case"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Re-exported for tests that construct step payloads. */
export type { TestCaseStep };
