/**
 * Shared in-memory stand-in for the Supabase data plane, used by the
 * release-readiness scenarios. It implements the slice of the
 * supabase-js query-builder surface the server actions use (insert /
 * select / update / delete with eq / in / is filters, single /
 * maybeSingle, order / limit as no-ops) against plain row arrays, so
 * several action modules can run against ONE consistent fake backend
 * inside a single scenario — the closest CI-safe approximation of the
 * real journey. RLS is NOT simulated here: membership gating is
 * exercised through the workspace-authz mock in each test file, and
 * the real RLS policies are covered by the migration reviews and the
 * dedicated authorization tests.
 */
export type FakeRow = Record<string, unknown>;

interface Filter {
  col: string;
  kind: "eq" | "in" | "is" | "overlaps";
  val: unknown;
}

export class FakeAppDb {
  tables = new Map<string, FakeRow[]>();
  /** Every executed operation, for "no write happened" assertions. */
  ops: { table: string; mode: string }[] = [];

  seed(table: string, rows: FakeRow[]): void {
    this.tables.set(
      table,
      rows.map((r) => ({ ...r })),
    );
  }

  rows(table: string): FakeRow[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  client(): { from: (table: string) => FakeQuery } {
    return { from: (table: string) => new FakeQuery(this, table) };
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: FakeRow | FakeRow[] | null = null;
  private selectCalled = false;
  private wantSingle = false;
  private wantMaybe = false;

  constructor(
    private db: FakeAppDb,
    private table: string,
  ) {}

  select(): this {
    this.selectCalled = true;
    return this;
  }
  insert(payload: FakeRow | FakeRow[]): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: FakeRow): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, kind: "eq", val });
    return this;
  }
  in(col: string, val: unknown[]): this {
    this.filters.push({ col, kind: "in", val });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push({ col, kind: "is", val });
    return this;
  }
  neq(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  contains(): this {
    return this;
  }
  overlaps(col: string, val: unknown[]): this {
    this.filters.push({ col, kind: "overlaps", val });
    return this;
  }
  ilike(): this {
    return this;
  }
  or(): this {
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybe = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onFulfilled?:
      ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every((f) => {
      if (f.kind === "eq") return row[f.col] === f.val;
      if (f.kind === "in") return (f.val as unknown[]).includes(row[f.col]);
      if (f.kind === "overlaps") {
        const cell = row[f.col];
        return Array.isArray(cell) && cell.some((v) => (f.val as unknown[]).includes(v));
      }
      return row[f.col] === f.val; // is
    });
  }

  private execute(): { data: unknown; error: unknown } {
    const rows = this.db.rows(this.table);
    this.db.ops.push({ table: this.table, mode: this.mode });
    const now = new Date().toISOString();

    if (this.mode === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as FakeRow];
      // Nullable-column defaults the real schema applies; code that
      // distinguishes null from absent (e.g. revoked_at) depends on it.
      const tableDefaults: Record<string, FakeRow> = {
        public_reports: { revoked_at: null, expires_at: null, view_count: 0, last_viewed_at: null },
      };
      const inserted = list.map((r) => {
        const row: FakeRow = {
          id: crypto.randomUUID(),
          created_at: now,
          updated_at: now,
          // Column defaults the real schema applies (several list
          // queries filter on them).
          is_archived: false,
          ...(tableDefaults[this.table] ?? {}),
          ...r,
        };
        rows.push(row);
        return row;
      });
      if (!this.selectCalled) return { data: null, error: null };
      return { data: this.wantSingle ? (inserted[0] ?? null) : inserted, error: null };
    }

    if (this.mode === "update") {
      for (const row of rows) {
        if (this.matches(row)) Object.assign(row, this.payload as FakeRow, { updated_at: now });
      }
      return { data: null, error: null };
    }

    if (this.mode === "delete") {
      this.db.tables.set(
        this.table,
        rows.filter((r) => !this.matches(r)),
      );
      return { data: null, error: null };
    }

    const filtered = rows.filter((r) => this.matches(r));
    if (this.wantSingle) {
      const row = filtered[0];
      return row
        ? { data: row, error: null }
        : { data: null, error: { code: "PGRST116", message: "No rows returned." } };
    }
    if (this.wantMaybe) return { data: filtered[0] ?? null, error: null };
    return { data: filtered, error: null };
  }
}

/** Fixed identities for the release scenarios. */
export const RELEASE_USER = "11111111-1111-4111-8111-111111111111";
export const RELEASE_OTHER_USER = "22222222-2222-4222-8222-222222222222";
