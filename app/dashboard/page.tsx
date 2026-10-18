import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = {
  title: "Dashboard — TestPilot AI",
  description:
    "Sample dashboard preview with demo metrics, run outcomes, and recent runs. No real browser tests have been executed.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
