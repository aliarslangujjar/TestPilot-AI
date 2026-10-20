import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Network guard: SSRF boundary for the worker's browser contexts.
 *
 * Every request (including each redirect hop) is resolved through DNS and
 * checked against blocked IP space: private, loopback, link-local, and
 * known cloud metadata endpoints. Hostname denylists catch the obvious
 * names; IP checks catch DNS indirection.
 *
 * Residual risks (documented in docs/BROWSER_WORKER.md):
 * - DNS rebinding inside the cache TTL (default 30s).
 * - A user allowlisting a hostname that resolves to a private IP — the
 *   IP check still blocks it; there is no override except the test-only
 *   allowLoopback flag.
 */

export interface NetworkGuardOptions {
  /**
   * TEST-ONLY: allow loopback addresses so integration tests can hit a
   * local server. Never true in production.
   */
  allowLoopback?: boolean;
  /** Injectable DNS resolver for tests. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** DNS cache TTL in ms (default 30s). */
  dnsCacheTtlMs?: number;
}

export interface NetworkGuard {
  /** true = let the request proceed; false = abort it. */
  allowRequest(url: string): Promise<boolean>;
}

/** Hostnames that are never reachable, even if DNS resolves them elsewhere. */
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".internal",
  "metadata.google.internal",
  "instance-data",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "instance-data.compute.internal",
]);

function isIpLiteral(host: string): boolean {
  return (host.includes(".") && /^[0-9.]+$/.test(host)) || host.includes(":");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string, allowLoopback: boolean): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable: fail closed
  if (!allowLoopback && inCidr(value, "127.0.0.0", 8)) return true;
  if (inCidr(value, "10.0.0.0", 8)) return true;
  if (inCidr(value, "172.16.0.0", 12)) return true;
  if (inCidr(value, "192.168.0.0", 16)) return true;
  if (inCidr(value, "169.254.0.0", 16)) return true; // link-local + cloud metadata
  if (inCidr(value, "0.0.0.0", 8)) return true;
  return false;
}

function isBlockedIpv6(ip: string, allowLoopback: boolean): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6: check the embedded IPv4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1], allowLoopback);
  if (!allowLoopback && (lower === "::1" || lower === "0:0:0:0:0:0:0:1")) return true;
  const first = lower.split(":")[0] ?? "";
  const firstInt = Number.parseInt(first, 16);
  if (Number.isNaN(firstInt)) return true; // unparseable: fail closed
  if ((firstInt & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstInt & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

export function isBlockedIp(ip: string, allowLoopback: boolean): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip, allowLoopback) : isBlockedIpv4(ip, allowLoopback);
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function defaultResolve(hostname: string): Promise<string[]> {
  try {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
}

export function createNetworkGuard(options: NetworkGuardOptions = {}): NetworkGuard {
  const allowLoopback = options.allowLoopback ?? false;
  const resolve = options.resolve ?? defaultResolve;
  const ttlMs = options.dnsCacheTtlMs ?? 30_000;
  const cache = new Map<string, { addresses: string[]; expiresAt: number }>();

  async function resolveCached(hostname: string): Promise<string[]> {
    const now = Date.now();
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now) return cached.addresses;
    const addresses = await resolve(hostname);
    cache.set(hostname, { addresses, expiresAt: now + ttlMs });
    return addresses;
  }

  return {
    async allowRequest(url: string): Promise<boolean> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return false; // unparseable: fail closed
      }

      // Non-network schemes: allow only inert page-local ones.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return url === "about:blank" || parsed.protocol === "data:" || parsed.protocol === "blob:";
      }

      const rawHostname = parsed.hostname;
      if (!rawHostname) return false;
      // Node keeps brackets on IPv6 literals ("[::1]"); strip them.
      const hostname = rawHostname.replace(/^\[|\]$/g, "");
      if (!hostname) return false;
      if (isBlockedHostname(hostname)) return false;

      // IP literal: check directly, no DNS needed.
      if (isIpLiteral(hostname)) {
        return !isBlockedIp(hostname, allowLoopback);
      }

      // Resolve and check every returned address. DNS failure = no route.
      const addresses = await resolveCached(hostname.toLowerCase());
      if (addresses.length === 0) return false;
      return !addresses.some((ip) => isBlockedIp(ip, allowLoopback));
    },
  };
}
