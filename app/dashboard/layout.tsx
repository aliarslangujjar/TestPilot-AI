import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard-nav";

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        T
      </span>
      TestPilot AI
    </Link>
  );
}

/** Dashboard shell: sidebar on desktop, compact top nav on mobile. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="flex h-16 items-center border-b px-4">
          <Brand />
        </div>
        <nav className="flex-1 p-3" aria-label="Dashboard">
          <DashboardNav />
        </nav>
        <div className="border-t p-4">
          {user?.email && <p className="truncate text-sm text-muted-foreground">{user.email}</p>}
          <div className="mt-2">
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand />
            <SignOutButton />
          </div>
          <nav className="px-4 pb-3" aria-label="Dashboard">
            <DashboardNav horizontal />
          </nav>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
