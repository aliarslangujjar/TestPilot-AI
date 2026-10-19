import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "TestPilot AI — Open-source QA test management",
  description:
    "TestPilot AI is an open-source platform for organizing manual QA: projects, test suites, and test cases with workspace-grade security.",
};

const features = [
  {
    title: "Projects",
    body: "Organize testing around projects with an authorized base URL per project — stored as data, never fetched behind your back.",
  },
  {
    title: "Suites & test cases",
    body: "Group cases into suites. Write titles, preconditions, ordered steps with per-step expectations, priorities, and tags.",
  },
  {
    title: "Draft → active workflow",
    body: "Draft cases privately, activate them when they're ready, and duplicate anything with one click when requirements fork.",
  },
  {
    title: "History-preserving archive",
    body: "Archiving hides work from the default view but never deletes it. Every case you've ever written stays readable.",
  },
  {
    title: "Workspace security",
    body: "Supabase Row Level Security plus server-side membership checks on every operation. Workspaces are strictly isolated.",
  },
  {
    title: "Open source (MIT)",
    body: "The whole platform is MIT-licensed on GitHub. Self-host it, fork it, or contribute — no lock-in.",
  },
];

const roadmap = [
  "AI-assisted test case generation",
  "Playwright browser execution",
  "Test runs & results tracking",
];

function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        T
      </span>
      TestPilot AI
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="TestPilot AI home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
            <Link href="#features" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Features
            </Link>
            <Link href="#roadmap" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Roadmap
            </Link>
            <Link
              href="https://github.com/aliarslangujjar/TestPilot-AI"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              GitHub
            </Link>
            <Link href="/login" className={cn(buttonVariants({ size: "sm" }))}>
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="inline-block rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            Open source · MIT licensed
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Manual QA, organized.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            TestPilot AI is an open-source test management platform for teams who ship: projects,
            test suites, and detailed manual test cases — with workspace-grade security built in
            from day one.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
              Get started
            </Link>
            <Link
              href="https://github.com/aliarslangujjar/TestPilot-AI"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              View on GitHub
            </Link>
          </div>
        </section>

        <section id="features" className="border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Everything manual testing needs
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">
              Built for QA analysts first — the people who actually write and run the tests.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-lg border bg-card p-6">
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="roadmap" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight">On the roadmap</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">
              Honest about what&apos;s next — these are planned, not shipped.
            </p>
            <ul className="mx-auto mt-8 max-w-2xl space-y-3">
              {roadmap.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500"
                  />
                  <span className="text-sm font-medium">{item}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Planned
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">
              Start organizing your QA today
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
              Create an account, set up your first project, and write your first suite in minutes.
            </p>
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "mt-6")}>
              Get started — it&apos;s free
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo />
          <p>TestPilot AI · MIT licensed · Built for QA teams</p>
        </div>
      </footer>
    </div>
  );
}
