/** @vitest-environment jsdom */
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

/** The mode toggle and the submit button share visible labels; the submit
 *  button is the only one with type="submit". */
function getSubmitButton(): HTMLElement {
  const submit = screen.getAllByRole("button").find((b) => b.getAttribute("type") === "submit");
  if (!submit) throw new Error("submit button not found");
  return submit;
}

describe("LoginForm", () => {
  it("renders the sign-in form by default", () => {
    render(<LoginForm />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(getSubmitButton()).toHaveTextContent("Sign in");
  });

  it("links to the forgot-password page in sign-in mode", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("switches to sign-up mode", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(getSubmitButton()).toHaveTextContent("Create account");
  });

  it("rejects an invalid email before calling auth", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("rejects a short password on sign-up", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("signs in with a trimmed email and redirects to the dashboard", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue({ error: null });
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "  user@example.com  ");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(getSubmitButton());
    expect(signInMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
    });
    expect(refreshMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("shows the auth error without redirecting on failure", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpassword");
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("signs up in create-account mode", async () => {
    const user = userEvent.setup();
    signUpMock.mockResolvedValue({ error: null });
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "secret12345");
    await user.click(getSubmitButton());
    expect(signUpMock).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "secret12345",
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/projects");
  });
});
