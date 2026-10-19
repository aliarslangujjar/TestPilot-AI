/** Standard result envelope for server actions. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
