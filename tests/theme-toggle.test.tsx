/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle", () => {
  it("toggles the dark class on the document element", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /switch to light theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
