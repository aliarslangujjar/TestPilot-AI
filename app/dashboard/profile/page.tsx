import type { Metadata } from "next";

import { ProfileForm } from "@/components/profile/profile-form";
import { getProfile } from "@/lib/profile/actions";

export const metadata: Metadata = {
  title: "Profile — TestPilot AI",
  description: "View and edit your profile.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await getProfile();

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Your personal details. Workspaces and projects are managed separately.
      </p>

      {!profile.ok ? (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {profile.error}
          </p>
        </div>
      ) : (
        <ProfileForm initial={profile.data} />
      )}
    </main>
  );
}
