/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { analyzeGeneratedCases } from "@/lib/ai-review/analyze";
import type { GeneratedCase } from "@schemas/ai-review";

function draft(overrides: Partial<GeneratedCase> = {}): GeneratedCase {
  return {
    tempId: "11111111-1111-4111-8111-111111111111",
    title: "Login with valid credentials",
    description: "",
    preconditions: "",
    steps: [{ action: "Enter email and password, submit", expected: "Dashboard appears" }],
    expectedResults: "The user lands on the dashboard",
    priority: "medium",
    tags: [],
    objective: "",
    coverage: null,
    assumptions: [],
    ...overrides,
  };
}

describe("analyzeGeneratedCases", () => {
  it("flags ambiguous expected results with a rewrite suggestion", () => {
    const { flags, suggestions } = analyzeGeneratedCases(
      [draft({ expectedResults: "The page loads successfully" })],
      [],
    );
    const flag = flags.find((f) => f.category === "ambiguous_expected")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("warning");
    const suggestion = suggestions.find((s) => s.id === flag.suggestionId)!;
    expect(suggestion.change.kind).toBe("set_field");
    if (suggestion.change.kind === "set_field") {
      expect(suggestion.change.from).toBe("The page loads successfully");
      expect(suggestion.change.to).toContain("[TODO:");
    }
  });

  it("flags duplicates against existing cases as blockers", () => {
    const { flags, suggestions } = analyzeGeneratedCases(
      [draft({ title: "Login with valid credentials!" })],
      [{ id: "existing-1", title: "Login with valid credentials" }],
    );
    const flag = flags.find((f) => f.category === "duplicate")!;
    expect(flag.severity).toBe("blocker");
    const suggestion = suggestions.find((s) => s.id === flag.suggestionId)!;
    expect(suggestion.change).toEqual({ kind: "drop_duplicate" });
  });

  it("flags duplicates within the batch", () => {
    const { flags } = analyzeGeneratedCases(
      [draft(), draft({ tempId: "22222222-2222-4222-8222-222222222222" })],
      [],
    );
    const dupes = flags.filter((f) => f.category === "duplicate");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.tempId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("flags unsupported assumptions with a verification suggestion", () => {
    const { flags, suggestions } = analyzeGeneratedCases(
      [draft({ preconditions: "Assuming the user is already registered" })],
      [],
    );
    const flag = flags.find((f) => f.category === "unsupported_assumption")!;
    expect(flag.severity).toBe("warning");
    const suggestion = suggestions.find((s) => s.id === flag.suggestionId)!;
    expect(suggestion.change.kind).toBe("guidance");
  });

  it("flags missing negative and boundary coverage at batch level", () => {
    const { flags, suggestions } = analyzeGeneratedCases([draft()], []);
    const missing = flags.filter((f) => f.category === "missing_coverage");
    expect(missing).toHaveLength(2);
    expect(missing.every((f) => f.tempId === null)).toBe(true);
    for (const flag of missing) {
      const suggestion = suggestions.find((s) => s.id === flag.suggestionId)!;
      expect(suggestion.change.kind).toBe("add_case");
    }
  });

  it("does not flag missing coverage when negative and boundary cases exist", () => {
    const { flags } = analyzeGeneratedCases(
      [
        draft({ title: "Login with invalid password", tags: ["negative"] }),
        draft({
          tempId: "22222222-2222-4222-8222-222222222222",
          title: "Password at max length boundary",
          expectedResults: "The form accepts exactly 72 characters",
          steps: [{ action: "Enter a 72-character password", expected: "Field accepts it" }],
        }),
      ],
      [],
    );
    expect(flags.filter((f) => f.category === "missing_coverage")).toHaveLength(0);
  });

  it("flags unsupported browser actions as blockers", () => {
    const { flags } = analyzeGeneratedCases(
      [
        draft({
          steps: [{ action: "Open devtools and inspect element", expected: "Element highlighted" }],
        }),
      ],
      [],
    );
    const flag = flags.find((f) => f.category === "unsupported_browser_action")!;
    expect(flag.severity).toBe("blocker");
  });

  it("leaves a clean, well-covered batch flag-free", () => {
    const { flags } = analyzeGeneratedCases(
      [
        draft({ title: "Invalid password shows an error", tags: ["negative"] }),
        draft({
          tempId: "22222222-2222-4222-8222-222222222222",
          title: "Username at maximum length",
          expectedResults: "The field accepts exactly 30 characters",
          steps: [{ action: "Type 30 characters", expected: "All 30 appear" }],
        }),
      ],
      [],
    );
    expect(flags).toHaveLength(0);
  });
});
