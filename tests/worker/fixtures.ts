import { createServer, type Server } from "node:http";

/** Tiny local web app for driver integration tests (loopback only). */
export async function startTestServer(): Promise<{
  server: Server;
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Welcome</h1><a href="/login">Sign in</a></body></html>`);
    } else if (url === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body><form action="/dashboard" method="get">` +
          `<label>Email <input name="email" placeholder="Email"></label>` +
          `<button type="submit">Sign in</button></form></body></html>`,
      );
    } else if (url.startsWith("/dashboard")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Dashboard</h1><button>Sign out</button></body></html>`);
    } else if (url === "/redirect-evil") {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
