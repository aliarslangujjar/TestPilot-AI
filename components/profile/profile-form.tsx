"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/components/projects/project-detail-dialog";
import { updateProfile } from "@/lib/profile/actions";
import { updateProfileSchema, type Profile } from "@schemas/profile";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Edit the signed-in user's own profile. */
export function ProfileForm({ initial }: { initial: Profile }) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const previewUrl = avatarUrl.trim();
  const avatarInitial = (displayName.trim() || initial.email || "?").charAt(0).toUpperCase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setNotice(null);

    const parsed = updateProfileSchema.safeParse({ displayName, avatarUrl });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const result = await updateProfile(parsed.data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        setNotice("Profile updated.");
      }
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 max-w-xl">
      {notice && (
        <p role="status" className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-900">
          {notice}
        </p>
      )}
      {serverError && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}

      <div className="mb-6 flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-16 w-16 rounded-full border object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground"
          >
            {avatarInitial}
          </span>
        )}
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{initial.email ?? "—"}</p>
          <p>Member since {formatDateTime(initial.createdAt)}</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="profile-display-name" className="mb-1 block text-sm font-medium">
            Display name
          </label>
          <input
            id="profile-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            placeholder="Jane Doe"
            className={cn(inputClass, fieldErrors.displayName && "border-destructive")}
            aria-invalid={!!fieldErrors.displayName}
            aria-describedby={fieldErrors.displayName ? "profile-display-name-error" : undefined}
          />
          {fieldErrors.displayName && (
            <p id="profile-display-name-error" className="mt-1 text-xs text-destructive">
              {fieldErrors.displayName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="profile-avatar-url" className="mb-1 block text-sm font-medium">
            Avatar URL <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="profile-avatar-url"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/me.png"
            className={cn(inputClass, fieldErrors.avatarUrl && "border-destructive")}
            aria-invalid={!!fieldErrors.avatarUrl}
            aria-describedby={fieldErrors.avatarUrl ? "profile-avatar-url-error" : undefined}
          />
          {fieldErrors.avatarUrl && (
            <p id="profile-avatar-url-error" className="mt-1 text-xs text-destructive">
              {fieldErrors.avatarUrl}
            </p>
          )}
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
