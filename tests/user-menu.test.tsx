/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UserMenu } from "@/components/user-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

describe("UserMenu", () => {
  it("opens a menu with profile and sign-out actions", async () => {
    const user = userEvent.setup();
    render(
      <UserMenu user={{ email: "ali@example.com", displayName: "Jane Doe", avatarUrl: null }} />,
    );

    expect(screen.queryByRole("menuitem", { name: "Profile" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    const profileLink = screen.getByRole("menuitem", { name: "Profile" });
    expect(profileLink).toHaveAttribute("href", "/dashboard/profile");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the avatar image when one is set", () => {
    render(
      <UserMenu
        user={{
          email: "ali@example.com",
          displayName: null,
          avatarUrl: "https://example.com/me.png",
        }}
      />,
    );
    const menuButton = screen.getByRole("button", { name: /account menu/i });
    const img = menuButton.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://example.com/me.png");
  });
});
