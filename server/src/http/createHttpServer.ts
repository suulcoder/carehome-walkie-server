import http from "http";

export function createHttpServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
