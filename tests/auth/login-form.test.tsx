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

  it("switches to sign-up mode", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(getSubmitButton()).toHaveTextContent("Create account");
  });

  it("requires email and password before calling auth", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(getSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/email and password/i);
    expect(signInMock).not.toHaveBeenCalled();
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
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the auth error without redirecting on failure", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
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
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(getSubmitButton());
    expect(signUpMock).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "secret123",
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
