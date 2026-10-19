/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const { resetEmailMock, updateUserMock, createClientMock } = vi.hoisted(() => ({
  resetEmailMock: vi.fn(),
  updateUserMock: vi.fn(),
  createClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue({
    auth: { resetPasswordForEmail: resetEmailMock, updateUser: updateUserMock },
  });
});

describe("ForgotPasswordForm", () => {
  it("validates the email before sending", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(resetEmailMock).not.toHaveBeenCalled();
  });

  it("sends the reset email with a callback redirect and confirms", async () => {
    const user = userEvent.setup();
    resetEmailMock.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(resetEmailMock).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({
        redirectTo: expect.stringContaining("/auth/callback?next=/reset-password"),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /password-reset link is on its way/i,
    );
  });
});

describe("ResetPasswordForm", () => {
  it("rejects mismatched passwords", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "newpassword1");
    await user.type(screen.getByLabelText("Confirm new password"), "different222");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("updates the password and redirects to the dashboard", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({ error: null });
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "newpassword1");
    await user.type(screen.getByLabelText("Confirm new password"), "newpassword1");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(updateUserMock).toHaveBeenCalledWith({ password: "newpassword1" });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/projects");
  });
});
