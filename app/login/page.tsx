import { Suspense } from "react";
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — TestPilot AI",
  description: "Sign in or create a TestPilot AI account.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* useSearchParams() inside LoginForm requires a Suspense boundary
          for static prerendering. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
