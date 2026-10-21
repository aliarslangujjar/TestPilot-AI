/**
 * TestPilot AI — sample demo application (a browser-test TARGET).
 *
 * A tiny zero-dependency web app with a sign-in flow, built so you can
 * point TestPilot's Playwright worker at something safe and local
 * while you evaluate it. It is deliberately NOT part of the product:
 * plain Node.js, no build step, no data persistence.
 *
 * Run it:
 *   node examples/demo-app/server.mjs          # http://127.0.0.1:4321
 *   PORT=8080 node examples/demo-app/server.mjs
 *
 * Demo account (also shown on the sign-in page):
 *   email: demo@example.com   password: demo-password
 *
 * The companion sample-plan.json is a browser-test plan (spec v1)
 * that signs in and verifies the dashboard.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password";

function page(title, body) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${title} · Acme Demo Store</title></head>
  <body>
    <header><strong>Acme Demo Store</strong> — a sample app for TestPilot demos</header>
    <main>${body}</main>
  </body>
</html>`;
}

function homePage() {
  return page(
    "Home",
    `<h1>Acme Demo Store</h1>
     <p>Welcome to the demo store. This app exists so TestPilot's browser
        worker has something safe to test.</p>
     <p><a href="/login">Sign in</a></p>`,
  );
}

function loginPage(error) {
  return page(
    "Sign in",
    `<h1>Sign in</h1>
     ${error ? `<p role="alert">Invalid email or password.</p>` : ""}
     <form method="post" action="/login">
       <p>
         <label for="email">Email</label><br />
         <input id="email" name="email" type="email" autocomplete="username" required />
       </p>
       <p>
         <label for="password">Password</label><br />
         <input id="password" name="password" type="password" autocomplete="current-password" required />
       </p>
       <button type="submit">Sign in</button>
     </form>
     <p>Demo account — email: <code>${DEMO_EMAIL}</code>, password:
        <code>${DEMO_PASSWORD}</code></p>`,
  );
}

function dashboardPage() {
  return page(
    "Dashboard",
    `<h1>Dashboard</h1>
     <p>Welcome back, Demo User.</p>
     <p>You are signed in to the sample application.</p>
     <p><a href="/login">Sign out</a></p>`,
  );
}

export function createDemoAppServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, html, headers = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };

    if (req.method === "GET" && url.pathname === "/") {
      send(200, homePage());
      return;
    }
    if (req.method === "GET" && url.pathname === "/login") {
      send(200, loginPage(false));
      return;
    }
    if (req.method === "POST" && url.pathname === "/login") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        if (form.get("email") === DEMO_EMAIL && form.get("password") === DEMO_PASSWORD) {
          send(302, "", { location: "/dashboard" });
        } else {
          send(401, loginPage(true));
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/dashboard") {
      send(200, dashboardPage());
      return;
    }
    send(404, page("Not found", "<h1>Not found</h1>"));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4321);
  createDemoAppServer().listen(port, "127.0.0.1", () => {
    console.log(`Demo app listening at http://127.0.0.1:${port}`);
  });
}
