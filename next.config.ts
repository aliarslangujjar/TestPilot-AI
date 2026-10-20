import type { NextConfig } from "next";

/**
 * Baseline security headers for every response (see docs/DEPLOYMENT.md).
 * A full Content-Security-Policy is deliberately NOT set globally yet:
 * the app still relies on inline theme bootstrapping, and a wrong CSP
 * would break it silently. The public-report route sets its own strict
 * sandboxed CSP. HSTS is safe to send because production is HTTPS-only
 * behind Vercel; browsers ignore it on plain-HTTP local development.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
