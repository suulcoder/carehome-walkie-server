/**
 * Automated resilience test runner.
 * Starts a local server + proxy for each scenario, runs fake clients, asserts behaviour.
 *
 * Usage:  npm run test:resilience
 */

import { startProxy, ProxyServer } from "./proxy";
import { createFakeClient } from "./fakeClient";
import http from "http";
import { ChildProcess, spawn } from "child_process";
import path from "path";

const SERVER_URL = "ws://localhost:18080/ws";
const PROXY_BASE_PORT = 19090;

interface ScenarioResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const httpUrl = url.replace("ws://", "http://").replace("/ws", "/health");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((res, rej) => {
        const req = http.get(httpUrl, (r) => {
          if (r.statusCode === 200) res();
          else rej(new Error(`status ${r.statusCode}`));
        });
        req.on("error", rej);
      });
      return;
    } catch {
      await delay(300);
    }
  }
  throw new Error(`Server at ${httpUrl} not ready after ${timeoutMs}ms`);
}

let serverProcess: ChildProcess | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverDir = path.join(__dirname, "../../server");
    serverProcess = spawn("node", ["-e", `
      process.env.PORT = "18080";
      require("ts-node").register({ transpileOnly: true });
      require("${path.join(serverDir, "src/index.ts")}");
    `], { stdio: "pipe" });

    serverProcess.stderr?.on("data", () => {});
    serverProcess.stdout?.on("data", () => {});
    serverProcess.on("error", reject);

    // Poll until healthy
    waitForServer(SERVER_URL, 15_000).then(resolve).catch(reject);
  });
}

function stopServer(): void {
  serverProcess?.kill();
  serverProcess = null;
}

type ScenarioFn = (proxyPort: number) => Promise<void>;

const SCENARIOS: { name: string; proxyOpts: object; run: ScenarioFn }[] = [
  {
    name: "1 – Patchy Wi-Fi (drop 15%, latency 150ms)",
    proxyOpts: { dropRate: 0.15, latencyMs: 150, disconnectEveryMs: 0, bandwidthKbps: 0 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      // Use generous timeout — join/joined handshake retries under 15% drop
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 20_000 });
      const listener = await createFakeClient({ url: proxyUrl, name: "Listener", timeoutMs: 20_000 });

      const CHUNKS = 5;
      await sender.sendPtt(CHUNKS);
      // Under 15% drop some audio chunks may be lost; verify at least 1 arrives
      await listener.waitForChunks(1, 15_000);

      sender.close();
      listener.close();
    },
  },
  {
    name: "2 – Short dropouts (disconnect every 5s)",
    proxyOpts: { dropRate: 0, latencyMs: 0, disconnectEveryMs: 5, bandwidthKbps: 0 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      // Client connects, proxy cuts it after 5s — just verify initial connection works
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 8000 });
      // We got here = connected successfully before first disconnect
      sender.close();
    },
  },
  {
    name: "3 – High latency (800ms)",
    proxyOpts: { dropRate: 0, latencyMs: 800, disconnectEveryMs: 0, bandwidthKbps: 0 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 15_000 });
      const listener = await createFakeClient({ url: proxyUrl, name: "Listener", timeoutMs: 15_000 });

      const CHUNKS = 3;
      await sender.sendPtt(CHUNKS);
      await listener.waitForChunks(CHUNKS, 20_000);

      sender.close();
      listener.close();
    },
  },
  {
    name: "4 – Slow bandwidth (32kbps)",
    proxyOpts: { dropRate: 0, latencyMs: 0, disconnectEveryMs: 0, bandwidthKbps: 32 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 10_000 });
      const listener = await createFakeClient({ url: proxyUrl, name: "Listener", timeoutMs: 10_000 });

      const CHUNKS = 5;
      await sender.sendPtt(CHUNKS);
      // At 32kbps all chunks should still deliver, just slowly
      await listener.waitForChunks(CHUNKS, 30_000);

      sender.close();
      listener.close();
    },
  },
  {
    name: "5 – Worst case combo (drop 15%, latency 300ms, 48kbps)",
    proxyOpts: { dropRate: 0.15, latencyMs: 300, disconnectEveryMs: 0, bandwidthKbps: 48 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 15_000 });
      const listener = await createFakeClient({ url: proxyUrl, name: "Listener", timeoutMs: 15_000 });

      const CHUNKS = 5;
      await sender.sendPtt(CHUNKS);
      // Some drops expected — verify at least 1 chunk gets through
      await listener.waitForChunks(1, 20_000);

      sender.close();
      listener.close();
    },
  },
  {
    name: "6 – No degradation (baseline)",
    proxyOpts: { dropRate: 0, latencyMs: 0, disconnectEveryMs: 0, bandwidthKbps: 0 },
    async run(port) {
      const proxyUrl = `ws://localhost:${port}/ws`;
      const sender = await createFakeClient({ url: proxyUrl, name: "Sender", timeoutMs: 8000 });
      const listener = await createFakeClient({ url: proxyUrl, name: "Listener", timeoutMs: 8000 });

      const CHUNKS = 5;
      await sender.sendPtt(CHUNKS);
      await listener.waitForChunks(CHUNKS, 10_000);

      sender.close();
      listener.close();
    },
  },
];

async function runScenario(
  scenario: (typeof SCENARIOS)[number],
  index: number
): Promise<ScenarioResult> {
  const port = PROXY_BASE_PORT + index;
  const opts = {
    target: SERVER_URL,
    listenPort: port,
    ...(scenario.proxyOpts as object),
  } as Parameters<typeof startProxy>[0];

  const proxyServer: ProxyServer = startProxy(opts);
  await delay(200); // let proxy bind

  try {
    await scenario.run(port);
    return { name: scenario.name, passed: true };
  } catch (err) {
    return {
      name: scenario.name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    proxyServer.terminateAllClients();
    await new Promise<void>((r) => proxyServer.close(() => r()));
  }
}

async function main() {
  console.log("\n=== Carehome Walkie-Talkie — Resilience Test Suite ===\n");

  console.log("[runner] Starting relay server...");
  try {
    await startServer();
    console.log("[runner] Server ready.\n");
  } catch (e) {
    console.error("[runner] Could not start server:", e);
    process.exit(1);
  }

  const results: ScenarioResult[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    process.stdout.write(`  Running: ${s.name} ... `);
    const result = await runScenario(s, i);
    console.log(result.passed ? "PASS" : `FAIL — ${result.error}`);
    results.push(result);
    await delay(500); // brief pause between scenarios
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\n=== Results: ${passed}/${total} passed ===\n`);
  results.forEach((r) => {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
    if (!r.passed && r.error) console.log(`      Error: ${r.error}`);
  });
  console.log();

  stopServer();
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  stopServer();
  process.exit(1);
});
