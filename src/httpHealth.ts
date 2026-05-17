import { createServer, type Server } from "node:http";
import { logger } from "./bot/middlewares/logger";

export async function startHttpHealthListener(): Promise<Server | undefined> {
  const raw = process.env.PORT;
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    logger.warn({ raw }, "Invalid PORT; skip HTTP health listener");
    return undefined;
  }

  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(404).end();
      return;
    }
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://internal").pathname;
    } catch {
      res.writeHead(404).end();
      return;
    }
    if (pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "GET" ? "ok" : undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info({ port }, "HTTP health listener started");
  return server;
}
