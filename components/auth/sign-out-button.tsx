"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Signs the user out and returns to the home page. */
export function SignOutButton({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }

  return (
    <Button type="button" variant={variant} size="sm" onClick={handleSignOut} className={className}>
      Sign out
    </Button>
  );
}
