"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Signs the user out and returns to the home page. */
export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
