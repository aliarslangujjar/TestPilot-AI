"use client";

import { useState } from "react";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/utils";

export interface UserMenuUser {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Top-bar user menu: avatar button opening Profile + Sign out. */
export function UserMenu({ user }: { user: UserMenuUser }) {
  const [open, setOpen] = useState(false);

  const label = user.displayName?.trim() || user.email || "Account";
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        className="flex items-center gap-2 rounded-full border border-transparent p-1 hover:border-border"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          >
            {initial}
          </span>
        )}
        <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
          {user.displayName?.trim() || user.email}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Account"
            className="absolute right-0 z-50 mt-2 w-60 rounded-lg border bg-card p-1 shadow-lg"
          >
            <div className="border-b px-3 py-2">
              {user.displayName?.trim() && (
                <p className="truncate text-sm font-medium">{user.displayName.trim()}</p>
              )}
              {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
            <Link
              href="/dashboard/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "mt-1 block rounded-md px-3 py-2 text-sm",
                "text-foreground hover:bg-muted",
              )}
            >
              Profile
            </Link>
            <div className="p-1" onClick={() => setOpen(false)}>
              <SignOutButton variant="ghost" className="w-full justify-start px-3" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
