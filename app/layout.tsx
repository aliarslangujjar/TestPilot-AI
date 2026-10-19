import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "TestPilot AI",
  description: "Open-source AI-powered QA SaaS — project scaffold.",
};

// Sets the initial theme class before first paint so there's no flash.
// Must match the logic in components/theme-provider.tsx.
const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
