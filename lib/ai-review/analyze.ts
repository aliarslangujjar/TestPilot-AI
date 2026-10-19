import {
  REVIEW_FLAG_LABELS,
  type GeneratedCase,
  type ReviewFlag,
  type ReviewFlagCategory,
  type ReviewSuggestion,
} from "@schemas/ai-review";

/**
 * Deterministic review analysis for generated test-case drafts.
 *
 * No AI involved: pure heuristics flag the five review categories. Every
 * flag carries a concrete suggestion shown separately from the case itself.
 * Flag ids are deterministic so re-analysis after an edit preserves the
 * user's decisions for flags that still apply.
 */

export interface ExistingCaseRef {
  id: string;
  title: string;
}

export interface AnalysisResult {
  flags: ReviewFlag[];
  suggestions: ReviewSuggestion[];
}

// Phrases that state an outcome without anything observable.
const VAGUE_EXPECTED =
  /\b(works? as expected|behaves? as expected|works? (correctly|properly|fine)|displays? (correctly|properly)|loads? (correctly|properly|successfully)|is successful|successful)\b/i;

// Hedging that invents requirements instead of stating them.
const ASSUMPTION =
  /\b(assum(e|es|ing)|probably|likely|might be|should be configured|presumably|in most cases)\b/i;

// Negative / boundary intent markers.
const NEGATIVE =
  /\b(invalid|empty|null|negative|unauthorized|forbidden|expired|incorrect|error|failure|denied)\b/i;
const BOUNDARY =
  /\b(boundar(y|ies)|max(imum)?|min(imum)?|limit|exceed|edge case|too (long|short|large|small)|special char)\b/i;

// Manual QA cannot do these; they need devtools or automation.
const UNSUPPORTED_BROWSER_ACTION =
  /\b(inspect element|dev ?tools|view[ -]source|modify (the )?dom|change (the )?html|inject (javascript|js|script)|execute (javascript|js)|disable javascript|install (an? |the )?extension|browser extension)\b/i;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function flagId(tempId: string | null, category: ReviewFlagCategory, index: number): string {
  return `${tempId ?? "batch"}:${category}:${index}`;
}

function suggestionIdFor(flag: ReviewFlag): string {
  return `sug:${flag.id}`;
}

function makeSuggestion(
  flag: ReviewFlag,
  label: string,
  change: ReviewSuggestion["change"],
): ReviewSuggestion {
  return {
    id: suggestionIdFor(flag),
    tempId: flag.tempId,
    flagId: flag.id,
    label,
    change,
  };
}

function vagueToTemplate(text: string): string {
  return text.replace(VAGUE_EXPECTED, "[TODO: describe the exact observable outcome]");
}

function templateDraft(kind: "negative" | "boundary", tempId: string): GeneratedCase {
  const isNegative = kind === "negative";
  return {
    tempId,
    title: isNegative
      ? "Negative case: [invalid input or unauthorized action]"
      : "Boundary case: [min/max/limit value]",
    description: "",
    preconditions: "",
    steps: [
      {
        action: isNegative
          ? "[Perform the action with invalid input]"
          : "[Enter the boundary value]",
        expected: "[TODO: describe the exact observable outcome]",
      },
    ],
    expectedResults: "[TODO: describe the exact observable outcome]",
    priority: "medium",
    tags: [isNegative ? "negative" : "boundary"],
    objective: "",
    coverage: kind,
    assumptions: [],
  };
}

let templateCounter = 0;
function nextTemplateId(): string {
  // Monotonic across analyses: added drafts keep their ids in state, so a
  // reset counter could collide with an already-added template draft.
  templateCounter += 1;
  return `00000000-0000-4000-8000-${String(templateCounter).padStart(12, "0")}`;
}

/**
 * Analyze a batch of generated drafts against existing suite cases.
 * Pure function — safe to re-run after every edit.
 */
export function analyzeGeneratedCases(
  drafts: GeneratedCase[],
  existingCases: ExistingCaseRef[],
): AnalysisResult {
  const flags: ReviewFlag[] = [];
  const suggestions: ReviewSuggestion[] = [];

  const push = (
    tempId: string | null,
    category: ReviewFlagCategory,
    severity: ReviewFlag["severity"],
    message: string,
    detail: string | undefined,
    suggestion: Omit<ReviewSuggestion, "id" | "tempId" | "flagId"> | null,
  ) => {
    const sameCategory = flags.filter((f) => f.tempId === tempId && f.category === category).length;
    const flag: ReviewFlag = {
      id: flagId(tempId, category, sameCategory),
      tempId,
      category,
      severity,
      message,
      ...(detail ? { detail } : {}),
    };
    if (suggestion) {
      const full = makeSuggestion(flag, suggestion.label, suggestion.change);
      flag.suggestionId = full.id;
      suggestions.push(full);
    }
    flags.push(flag);
  };

  const seenTitles = new Map<string, string>(); // normalized -> tempId
  const existingByTitle = new Map<string, ExistingCaseRef>();
  for (const e of existingCases) existingByTitle.set(normalizeTitle(e.title), e);

  for (const draft of drafts) {
    const norm = normalizeTitle(draft.title);

    // --- duplicates (blocker) ---
    const existing = existingByTitle.get(norm);
    if (existing) {
      push(
        draft.tempId,
        "duplicate",
        "blocker",
        `Duplicates existing case "${existing.title}".`,
        "Saving both would split coverage history. Drop this draft or keep it as a distinct case with a different scope.",
        {
          label: `Drop draft (already covered by "${existing.title}")`,
          change: { kind: "drop_duplicate" },
        },
      );
    } else if (seenTitles.has(norm)) {
      push(
        draft.tempId,
        "duplicate",
        "blocker",
        "Duplicates another draft in this batch.",
        "Two drafts with the same title will create two near-identical cases.",
        { label: "Drop this duplicate draft", change: { kind: "drop_duplicate" } },
      );
    } else {
      seenTitles.set(norm, draft.tempId);
    }

    // --- ambiguous expected results (warning) ---
    const checkVague = (text: string, where: string) => {
      if (VAGUE_EXPECTED.test(text)) {
        push(
          draft.tempId,
          "ambiguous_expected",
          "warning",
          `${REVIEW_FLAG_LABELS.ambiguous_expected} in ${where}.`,
          `“${text}” states no observable outcome — two testers could read it differently.`,
          {
            label: "Insert observable-outcome placeholder",
            change:
              where === "expected results"
                ? {
                    kind: "set_field",
                    field: "expectedResults",
                    from: draft.expectedResults,
                    to: vagueToTemplate(draft.expectedResults),
                  }
                : {
                    kind: "set_step_expected",
                    stepIndex: draft.steps.findIndex((s) => s.expected === text),
                    from: text,
                    to: vagueToTemplate(text),
                  },
          },
        );
      }
    };
    checkVague(draft.expectedResults, "expected results");
    for (const step of draft.steps) checkVague(step.expected, `step “${step.action}”`);

    // --- unsupported assumptions (warning) ---
    for (const [field, text] of [
      ["description", draft.description],
      ["preconditions", draft.preconditions],
      ["expected results", draft.expectedResults],
    ] as const) {
      const match = text.match(ASSUMPTION);
      if (match) {
        push(
          draft.tempId,
          "unsupported_assumption",
          "warning",
          `Assumes “${match[0]}” in ${field}.`,
          "Generated text invented this — verify it against the requirements before keeping it.",
          {
            label: "Mark assumption verified (or edit the text first)",
            change: {
              kind: "guidance",
              text: `Verify “${match[0]}” against the requirements, then resolve.`,
            },
          },
        );
        break; // one flag per draft is enough
      }
    }

    // --- unsupported browser actions (blocker) ---
    draft.steps.forEach((step, i) => {
      if (UNSUPPORTED_BROWSER_ACTION.test(step.action)) {
        push(
          draft.tempId,
          "unsupported_browser_action",
          "blocker",
          `Step ${i + 1} needs browser internals (“${step.action}”).`,
          "Manual testers can't do this. Rewrite the step as something observable in the UI.",
          {
            label: "Acknowledge and rewrite the step manually",
            change: {
              kind: "guidance",
              text: `Rewrite step ${i + 1} as a user-visible action, then resolve.`,
            },
          },
        );
      }
    });
  }

  // --- missing negative / boundary coverage (batch-level warning) ---
  const haystack = drafts.map((d) => `${d.title} ${d.tags.join(" ")}`).join("\n");
  const hasNegative = NEGATIVE.test(haystack);
  const hasBoundary = BOUNDARY.test(haystack);
  for (const kind of ["negative", "boundary"] as const) {
    if ((kind === "negative" && hasNegative) || (kind === "boundary" && hasBoundary)) continue;
    const draft = templateDraft(kind, nextTemplateId());
    push(
      null,
      "missing_coverage",
      "warning",
      `No ${kind} cases in this batch.`,
      kind === "negative"
        ? "Happy-path-only suites miss the failures users actually hit."
        : "Limits and edge values are where defects cluster.",
      {
        label: `Add a ${kind}-case template to the batch`,
        change: { kind: "add_case", draft },
      },
    );
  }

  return { flags, suggestions };
}
