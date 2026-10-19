import Link from "next/link";

import { DashboardNav } from "@/components/dashboard-nav";
import { getProfile } from "@/lib/profile/actions";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { getCurrentWorkspace } from "@/lib/workspaces";

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

/**
 * Dashboard shell: sidebar on desktop, top bar with the user menu on all
 * sizes, compact nav on mobile.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [profileResult, workspace] = await Promise.all([getProfile(), getCurrentWorkspace()]);
  const profile = profileResult.ok ? profileResult.data : null;

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
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="md:hidden">
            <Brand />
          </div>
          <p className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
            {workspace?.name}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu
              user={{
                email: user?.email ?? null,
                displayName: profile?.displayName ?? null,
                avatarUrl: profile?.avatarUrl ?? null,
              }}
            />
          </div>
        </header>
        <nav className="border-b px-4 py-2 md:hidden" aria-label="Dashboard">
          <DashboardNav horizontal />
        </nav>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
