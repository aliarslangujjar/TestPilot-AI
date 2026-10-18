import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";
import { apiErrorSchema, paginationSchema } from "@schemas/index";

describe("scaffold smoke tests", () => {
  it("cn() merges tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", { "font-bold": true })).toBe("text-sm font-bold");
  });

  it("paginationSchema applies sane defaults", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: "3" }).page).toBe(3);
  });

  it("apiErrorSchema requires code and message", () => {
    expect(apiErrorSchema.safeParse({ code: "NOT_FOUND" }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: "NOT_FOUND", message: "Missing" }).success).toBe(true);
  });
});
