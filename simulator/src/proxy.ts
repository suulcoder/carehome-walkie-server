/**
 * Resilience Simulator Proxy
 *
 * Sits between the mobile app (or fake client) and the WS relay server.
 * Injects: latency, packet drops, forced disconnects, bandwidth throttling.
 *
 * Usage:
 *   npm start -- --target ws://localhost:8080/ws --listen 9090 --latency 300 --drop-rate 0.1
 */

import http from "http";
import WebSocket, { WebSocketServer } from "ws";

export interface ProxyOptions {
  target: string;
  listenPort: number;
  latencyMs: number;
  dropRate: number;
  disconnectEveryMs: number;
  bandwidthKbps: number; // 0 = unlimited
}

function parseArgs(): ProxyOptions {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    target: get("--target", "ws://localhost:8080/ws"),
    listenPort: Number(get("--listen", "9090")),
    latencyMs: Number(get("--latency", "0")),
    dropRate: Number(get("--drop-rate", "0")),
    disconnectEveryMs: Number(get("--disconnect-every", "0")) * 1000,
    bandwidthKbps: Number(get("--bandwidth-kbps", "0")),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldDrop(rate: number): boolean {
  return rate > 0 && Math.random() < rate;
}

class BandwidthThrottle {
  private bytesAllowed = 0;
  private lastRefill = Date.now();

  constructor(private kbps: number) {}

  async throttle(bytes: number): Promise<void> {
    if (this.kbps <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.bytesAllowed += (this.kbps * 1024 * elapsed) / 1000;
    this.lastRefill = now;

    if (this.bytesAllowed >= bytes) {
      this.bytesAllowed -= bytes;
      return;
    }
    // Need to wait for budget to refill
    const deficit = bytes - this.bytesAllowed;
    const waitMs = (deficit / (this.kbps * 1024)) * 1000;
    this.bytesAllowed = 0;
    await delay(waitMs);
  }
}

function messageDataToString(data: string | ArrayBuffer | Blob): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder("utf-8").decode(data);
  }
  return String(data);
}

/** Control frames that must not be dropped — keeps the session alive under packet loss. */
function isControlPayload(data: WebSocket.RawData): boolean {
  try {
    const msg = JSON.parse(data.toString()) as { type?: string };
    return (
      msg.type === "ping" ||
      msg.type === "pong" ||
      msg.type === "join" ||
      msg.type === "joined" ||
      msg.type === "ack"
    );
  } catch {
    const text = data.toString().trim();
    return text === "ping" || text === "pong";
  }
}

async function forwardMessage(
  src: WebSocket,
  dst: WebSocket,
  data: WebSocket.RawData,
  opts: ProxyOptions,
  throttle: BandwidthThrottle,
  label: string
): Promise<void> {
  if (!isControlPayload(data) && shouldDrop(opts.dropRate)) {
    console.log(`[proxy] ${label} DROP`);
    return;
  }

  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.toString());

  if (opts.latencyMs > 0) {
    await delay(opts.latencyMs);
  }

  await throttle.throttle(buf.byteLength);

  if (dst.readyState === WebSocket.OPEN) {
    dst.send(buf);
  }
}

export interface ProxyServer extends http.Server {
  terminateAllClients(): void;
}

export function startProxy(opts: ProxyOptions): ProxyServer {
  console.log(`[proxy] listening on :${opts.listenPort}`);
  console.log(`[proxy] target: ${opts.target}`);
  console.log(
    `[proxy] latency=${opts.latencyMs}ms drop=${opts.dropRate} disconnectEvery=${
      opts.disconnectEveryMs / 1000
    }s bandwidth=${opts.bandwidthKbps || "unlimited"}kbps`
  );

  const httpServer = http.createServer((_, res) => {
    res.writeHead(200);
    res.end("resilience proxy");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (clientWs) => {
    console.log(`[proxy] client connected`);
    const throttle = new BandwidthThrottle(opts.bandwidthKbps);
    const serverWs = new WebSocket(opts.target);

    // Buffer messages arriving from the client before the server connection opens
    const pendingToServer: WebSocket.RawData[] = [];
    let serverReady = false;

    let disconnectTimer: NodeJS.Timeout | null = null;

    const scheduleDisconnect = () => {
      if (opts.disconnectEveryMs <= 0) return;
      disconnectTimer = setTimeout(() => {
        console.log(`[proxy] forcing disconnect`);
        serverWs.terminate();
        clientWs.terminate();
      }, opts.disconnectEveryMs);
    };

    serverWs.on("open", () => {
      console.log(`[proxy] connected to server`);
      serverReady = true;
      scheduleDisconnect();
      // Flush any messages that arrived before the server connected
      for (const buffered of pendingToServer) {
        forwardMessage(clientWs, serverWs, buffered, opts, throttle, "C→S").catch(() => {});
      }
      pendingToServer.length = 0;
    });

    clientWs.on("message", (data) => {
      if (!serverReady) {
        pendingToServer.push(data);
        return;
      }
      forwardMessage(clientWs, serverWs, data, opts, throttle, "C→S").catch(() => {});
    });

    serverWs.on("message", (data) => {
      forwardMessage(serverWs, clientWs, data, opts, throttle, "S→C").catch(() => {});
    });

    clientWs.on("close", () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      serverWs.terminate();
    });

    serverWs.on("close", () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      clientWs.terminate();
    });

    serverWs.on("error", (e) => console.error("[proxy] server ws error:", e.message));
    clientWs.on("error", (e) => console.error("[proxy] client ws error:", e.message));
  });

  const proxyServer = httpServer as ProxyServer;
  proxyServer.terminateAllClients = () => {
    wss.clients.forEach((c) => c.terminate());
  };

  httpServer.listen(opts.listenPort);
  return proxyServer;
}

// Only run when executed directly (not imported by runScenarios)
if (require.main === module) {
  startProxy(parseArgs());
}
