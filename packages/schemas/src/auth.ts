/**
 * Shared auth validation schemas. Used by the login, sign-up, and
 * password-reset forms so client-side validation can't drift from the
 * documented rules. (Server-side, Supabase Auth enforces its own minima;
 * these are intentionally stricter where noted.)
 */
import { z } from "zod";

export const emailSchema = z.email("Enter a valid email address.");

/** Stricter than Supabase's default minimum (6) — a deliberate choice. */
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
