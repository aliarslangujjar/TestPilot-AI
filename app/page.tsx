const wired = [
  "Next.js 16 (App Router) + TypeScript (strict)",
  "Tailwind CSS v4 + shadcn/ui theme tokens",
  "ESLint (Next.js plugin) + Prettier",
  "Shared zod schemas in packages/schemas",
  "Supabase migrations in supabase/migrations",
  "Playwright worker placeholder in workers/playwright",
];

export default function HomePage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl rounded-lg border p-8 shadow-sm">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Scaffold
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">TestPilot AI</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Open-source AI-powered QA SaaS. The project structure is initialized — no product features
          have been implemented yet.
        </p>
        <ul className="mt-6 space-y-2">
          {wired.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className="bg-primary mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-6 text-xs">
          See <code className="bg-muted rounded px-1 py-0.5">README.md</code> and{" "}
          <code className="bg-muted rounded px-1 py-0.5">docs/PROJECT_CONTEXT.md</code> for setup,
          architecture direction, and status.
        </p>
      </div>
    </main>
  );
}
