"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { signInSchema, signUpSchema } from "@schemas/auth";

type Mode = "sign-in" | "sign-up";

const inputClass =
  "mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Email/password authentication form. Sign-in and sign-up share the form;
 * the mode toggle switches which Supabase Auth call runs on submit.
 * Validation comes from the shared @schemas/auth zod schemas.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "link-expired"
      ? "That link is invalid or expired. Sign in or request a new password reset email."
      : null,
  );
  const [pending, setPending] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const schema = mode === "sign-in" ? signInSchema : signUpSchema;
    const parsed = schema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your entries and try again.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: authError } =
        mode === "sign-in"
          ? await supabase.auth.signInWithPassword(parsed.data)
          : await supabase.auth.signUp(parsed.data);
      if (authError) {
        setError(authError.message);
        return;
      }
      router.refresh();
      router.push("/dashboard/projects");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm sm:p-8">
      <div
        role="group"
        aria-label="Authentication mode"
        className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
      >
        {(
          [
            { id: "sign-in", label: "Sign in" },
            { id: "sign-up", label: "Create account" },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => switchMode(option.id)}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === option.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <h1 className="mt-6 text-xl font-semibold">
        {mode === "sign-in" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "sign-in"
          ? "Sign in to access your dashboard."
          : "Sign up to start organizing test projects."}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            {mode === "sign-in" && (
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className={inputClass}
          />
          {mode === "sign-up" && (
            <p className="mt-1.5 text-xs text-muted-foreground">At least 8 characters.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
