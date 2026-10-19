/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProfileForm } from "@/components/profile/profile-form";
import type { Profile } from "@schemas/profile";

const { updateProfileMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
}));

vi.mock("@/lib/profile/actions", () => ({
  getProfile: vi.fn(),
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
}));

afterEach(() => cleanup());

const INITIAL: Profile = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "ali@example.com",
  displayName: "Jane Doe",
  avatarUrl: null,
  createdAt: "2026-10-01T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileForm", () => {
  it("renders the current values and saves changes", async () => {
    const user = userEvent.setup();
    updateProfileMock.mockResolvedValue({
      ok: true,
      data: { ...INITIAL, displayName: "Janet Doe" },
    });

    render(<ProfileForm initial={INITIAL} />);
    expect(screen.getByLabelText("Display name")).toHaveValue("Jane Doe");
    expect(screen.getByText("ali@example.com")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Janet Doe");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Janet Doe" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Profile updated.");
  });

  it("shows validation errors without calling the server", async () => {
    const user = userEvent.setup();
    render(<ProfileForm initial={INITIAL} />);
    await user.type(screen.getByLabelText(/Avatar URL/), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateProfileMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Avatar URL must start with http:// or https://."),
    ).toBeInTheDocument();
  });

  it("surfaces server errors", async () => {
    const user = userEvent.setup();
    updateProfileMock.mockResolvedValue({ ok: false, error: "Nope." });
    render(<ProfileForm initial={INITIAL} />);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });
});
