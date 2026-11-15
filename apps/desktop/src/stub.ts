import { createServer } from "node:http";

/** Dev-only fake server (TANDEM_DESKTOP_STUB=1): serves a page and an SSE stream so the shell can be exercised. */
export function startStub(token: string): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.url?.startsWith("/api/events")) {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401).end();
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const session = {
          login: "stub", tokenSource: null, currentProjectId: null, projectsDir: "", desktop: true, version: "0",
          projects: [{ id: "a/b", owner: "a", name: "b", path: "", available: true, attention: 2 }],
        };
        res.write(`event: session\ndata: ${JSON.stringify(session)}\n\n`);
        res.write(`event: notify\ndata: ${JSON.stringify({ id: "stub:1", kind: "waiting", projectId: "a/b", title: "Tandem stub", body: "測試通知", url: "https://github.com", time: new Date().toISOString() })}\n\n`);
        const t = setInterval(() => res.write(": ping\n\n"), 20_000);
        req.on("close", () => clearInterval(t));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Tandem stub</title><h1>stub ${req.url}</h1><a href="https://example.com" target="_blank">ext</a><pre id=o></pre><script>o.textContent=JSON.stringify(window.tandemDesktop&&{v:tandemDesktop.version,keys:Object.keys(tandemDesktop)})</script>`);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ port: (srv.address() as { port: number }).port }));
  });
}
