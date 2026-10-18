import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TestPilot AI",
  description: "Open-source AI-powered QA SaaS — project scaffold.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
