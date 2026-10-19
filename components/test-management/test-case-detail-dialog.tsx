"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/projects/dialog";
import type { TestCase } from "@schemas/test-case";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/components/projects/project-detail-dialog";

/** Read-only detail view for a manual test case. */
export function TestCaseDetailDialog({
  testCase,
  onClose,
  onEdit,
}: {
  testCase: TestCase;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Dialog title={testCase.title} labelledBy="test-case-detail-title" onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            testCase.status === "active"
              ? "bg-green-100 text-green-900"
              : "bg-slate-100 text-slate-700",
          )}
        >
          {testCase.status}
        </span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-900">
          {testCase.priority}
        </span>
        {testCase.isArchived && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
            Archived
          </span>
        )}
        {testCase.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
          >
            #{t}
          </span>
        ))}
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        {testCase.description && (
          <div>
            <dt className="font-medium text-muted-foreground">Description</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{testCase.description}</dd>
          </div>
        )}
        {testCase.preconditions && (
          <div>
            <dt className="font-medium text-muted-foreground">Preconditions</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{testCase.preconditions}</dd>
          </div>
        )}
        <div>
          <dt className="font-medium text-muted-foreground">Steps ({testCase.steps.length})</dt>
          <dd className="mt-1">
            {testCase.steps.length === 0 ? (
              <span className="text-muted-foreground">No steps defined.</span>
            ) : (
              <ol className="space-y-2">
                {testCase.steps.map((step, i) => (
                  <li key={i} className="rounded-md border p-3">
                    <p className="font-medium">
                      <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                      {step.action}
                    </p>
                    {step.expected && (
                      <p className="mt-1 text-muted-foreground">
                        <span className="font-medium">Expected:</span> {step.expected}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </dd>
        </div>
        {testCase.expectedResults && (
          <div>
            <dt className="font-medium text-muted-foreground">Expected results</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{testCase.expectedResults}</dd>
          </div>
        )}
        <div className="flex gap-6">
          <div>
            <dt className="font-medium text-muted-foreground">Created</dt>
            <dd className="mt-0.5">{formatDateTime(testCase.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Last updated</dt>
            <dd className="mt-0.5">{formatDateTime(testCase.updatedAt)}</dd>
          </div>
        </div>
      </dl>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Dialog>
  );
}
