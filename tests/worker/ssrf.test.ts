/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { createNetworkGuard } from "@/workers/playwright/src/ssrf";

function guardWithDns(mapping: Record<string, string[]>, allowLoopback = false) {
  const calls: string[] = [];
  const guard = createNetworkGuard({
    allowLoopback,
    dnsCacheTtlMs: 60_000,
    resolve: async (hostname: string) => {
      calls.push(hostname);
      return mapping[hostname] ?? [];
    },
  });
  return { guard, calls };
}

describe("network guard (SSRF boundary)", () => {
  it("allows public addresses", async () => {
    const { guard } = guardWithDns({ "app.example.com": ["93.184.216.34"] });
    expect(await guard.allowRequest("https://app.example.com/login")).toBe(true);
  });

  it("blocks private IPv4 space", async () => {
    const { guard } = guardWithDns({
      "a.test": ["10.1.2.3"],
      "b.test": ["172.16.5.4"],
      "c.test": ["192.168.1.10"],
      "d.test": ["172.31.255.1"],
    });
    for (const host of ["a.test", "b.test", "c.test", "d.test"]) {
      expect(await guard.allowRequest(`http://${host}/`)).toBe(false);
    }
    // 172.15.x is public — boundary check on the /12.
    const { guard: g2 } = guardWithDns({ "e.test": ["172.15.0.1"] });
    expect(await g2.allowRequest("http://e.test/")).toBe(true);
  });

  it("blocks loopback by default, allows it only with the test flag", async () => {
    const { guard } = guardWithDns({ "loop.test": ["127.0.0.1"] });
    expect(await guard.allowRequest("http://loop.test/")).toBe(false);
    expect(await guard.allowRequest("http://127.0.0.1:3000/")).toBe(false);

    const { guard: testGuard } = guardWithDns({ "loop.test": ["127.0.0.1"] }, true);
    expect(await testGuard.allowRequest("http://loop.test/")).toBe(true);
    expect(await testGuard.allowRequest("http://127.0.0.1:3000/")).toBe(true);
  });

  it("blocks link-local and cloud metadata endpoints", async () => {
    const { guard } = guardWithDns(
      { "meta.test": ["169.254.169.254"] },
      true, // loopback allowed, link-local still blocked
    );
    expect(await guard.allowRequest("http://meta.test/latest/meta-data/")).toBe(false);
    expect(await guard.allowRequest("http://169.254.169.254/")).toBe(false);
    expect(await guard.allowRequest("http://169.254.169.253/")).toBe(false);
  });

  it("blocks IPv6 loopback, link-local, and unique-local", async () => {
    // IP literals skip DNS and are checked directly.
    const { guard } = guardWithDns({});
    expect(await guard.allowRequest("http://[::1]/")).toBe(false);
    expect(await guard.allowRequest("http://[fe80::1]/")).toBe(false);
    expect(await guard.allowRequest("http://[fd00::1]/")).toBe(false);
    expect(await guard.allowRequest("http://[fc00::99]/")).toBe(false);
    expect(await guard.allowRequest("http://[2001:db8::1]/")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 loopback", async () => {
    const { guard } = guardWithDns({});
    expect(await guard.allowRequest("http://[::ffff:127.0.0.1]/")).toBe(false);
  });

  it("blocks dangerous hostnames regardless of DNS", async () => {
    const { guard } = guardWithDns({ localhost: ["93.184.216.34"] });
    expect(await guard.allowRequest("http://localhost/")).toBe(false);
    expect(await guard.allowRequest("http://app.localhost/")).toBe(false);
    expect(await guard.allowRequest("http://metadata.google.internal/")).toBe(false);
    expect(await guard.allowRequest("http://instance-data.compute.internal/")).toBe(false);
  });

  it("fails closed on DNS errors and unparseable URLs", async () => {
    const { guard } = guardWithDns({});
    expect(await guard.allowRequest("https://nonexistent.invalid/")).toBe(false);
    expect(await guard.allowRequest("not a url")).toBe(false);
  });

  it("blocks non-http(s) schemes except inert page-local ones", async () => {
    const { guard } = guardWithDns({});
    expect(await guard.allowRequest("about:blank")).toBe(true);
    expect(await guard.allowRequest("file:///etc/passwd")).toBe(false);
    expect(await guard.allowRequest("ftp://example.com/x")).toBe(false);
  });

  it("re-resolves per request so redirect hops are revalidated", async () => {
    const { guard, calls } = guardWithDns({
      "a.example.com": ["93.184.216.34"],
      "evil.example.net": ["169.254.169.254"],
    });
    // Simulates a redirect chain: each hop is checked independently.
    expect(await guard.allowRequest("https://a.example.com/start")).toBe(true);
    expect(await guard.allowRequest("https://evil.example.net/steal")).toBe(false);
    expect(calls).toEqual(["a.example.com", "evil.example.net"]);
  });

  it("caches DNS within the TTL", async () => {
    const { guard, calls } = guardWithDns({ "app.example.com": ["93.184.216.34"] });
    await guard.allowRequest("https://app.example.com/a");
    await guard.allowRequest("https://app.example.com/b");
    expect(calls).toEqual(["app.example.com"]);
  });
});
