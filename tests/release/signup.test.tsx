/** @vitest-environment jsdom */
/**
 * Release-readiness scenario: account signup through the real auth
 * form (sign-up mode) with the Supabase browser client mocked —
 * success navigates into the app, a server-side rejection (duplicate
 * account) is surfaced verbatim, and invalid input never reaches the
 * auth API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginForm } from "@/components/auth/login-form";

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));

const { signInMock, signUpMock, createClientMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  signUpMock: vi.fn(),
  createClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue({
    auth: { signInWithPassword: signInMock, signUp: signUpMock },
  });
});

function getSubmitButton(): HTMLElement {
  const submit = screen.getAllByRole("button").find((b) => b.getAttribute("type") === "submit");
  if (!submit) throw new Error("submit button not found");
  return submit;
}

async function openSignup(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<LoginForm />);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("release scenario — signup", () => {
  it("creates the account and enters the app", async () => {
    const user = userEvent.setup();
    signUpMock.mockResolvedValue({ error: null });
    await openSignup(user);
    await user.type(screen.getByLabelText("Email"), "  new.qa@example.com  ");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(getSubmitButton());
    expect(signUpMock).toHaveBeenCalledWith({
      email: "new.qa@example.com",
      password: "correct horse battery",
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/projects");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a duplicate-account rejection from the auth service", async () => {
    const user = userEvent.setup();
    signUpMock.mockResolvedValue({ error: { message: "User already registered" } });
    await openSignup(user);
    await user.type(screen.getByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/already registered/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("blocks an invalid email in sign-up mode before any auth call", async () => {
    const user = userEvent.setup();
    await openSignup(user);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(signUpMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
