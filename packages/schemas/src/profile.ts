import { z } from "zod";

/** Shared profile validation (single-user, own row only). */

export const displayNameSchema = z
  .string()
  .trim()
  .max(100, "Display name must be 100 characters or fewer.")
  .nullish();

export const avatarUrlSchema = z
  .string()
  .trim()
  .max(2048, "Avatar URL is too long.")
  .nullish()
  .refine((v) => v == null || v === "" || /^https?:\/\//i.test(v), {
    message: "Avatar URL must start with http:// or https://.",
  });

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  avatarUrl: avatarUrlSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const profileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;
