/**
 * Headless fake client — simulates the mobile app protocol.
 * Used by runScenarios.ts to assert behaviour under bad network conditions.
 */

import WebSocket from "ws";
import { nanoid } from "nanoid";

export interface FakeClientOptions {
  url: string;
  name: string;
  timeoutMs?: number;
}

export interface ReceivedChunk {
  sessionId: string;
  seq: number;
}

export interface FakeClient {
  receivedChunks: ReceivedChunk[];
  sessionIds: string[];
  connected: boolean;
  close(): void;
  sendPtt(chunks?: number): Promise<void>;
  waitForChunks(count: number, timeoutMs: number): Promise<ReceivedChunk[]>;
  waitForConnection(timeoutMs: number): Promise<void>;
}

export function createFakeClient(opts: FakeClientOptions): Promise<FakeClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.url);
    const receivedChunks: ReceivedChunk[] = [];
    const sessionIds: string[] = [];
    let connected = false;

    const timeoutId = setTimeout(() => {
      reject(new Error(`[fakeClient:${opts.name}] connection timeout`));
    }, opts.timeoutMs ?? 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", name: opts.name, channel: "carehome-1" }));
    });

    ws.on("message", (raw) => {
      let msg: { type: string; sessionId?: string; seq?: number };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "joined") {
        clearTimeout(timeoutId);
        connected = true;
        resolve(client);
      }

      if (msg.type === "audio_chunk" && msg.sessionId != null && msg.seq != null) {
        receivedChunks.push({ sessionId: msg.sessionId, seq: msg.seq });
      }
    });

    ws.on("error", (e) => {
      clearTimeout(timeoutId);
      reject(new Error(`[fakeClient:${opts.name}] error: ${e.message}`));
    });

    ws.on("close", () => {
      connected = false;
    });

    const client: FakeClient = {
      receivedChunks,
      sessionIds,
      get connected() {
        return connected;
      },

      close() {
        ws.close();
      },

      async sendPtt(chunks = 5): Promise<void> {
        if (ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
        const sessionId = nanoid(8);
        sessionIds.push(sessionId);
        ws.send(JSON.stringify({ type: "ptt_start", sessionId }));
        for (let seq = 0; seq < chunks; seq++) {
          // Synthetic PCM16 base64 — 20ms of silence at 16kHz = 640 bytes
          const silenceBytes = Buffer.alloc(640);
          const pcmBase64 = silenceBytes.toString("base64");
          ws.send(JSON.stringify({ type: "audio_chunk", sessionId, seq, pcmBase64 }));
          await new Promise((r) => setTimeout(r, 20));
        }
        ws.send(JSON.stringify({ type: "ptt_end", sessionId }));
        return;
      },

      waitForChunks(count: number, timeoutMs: number): Promise<ReceivedChunk[]> {
        return new Promise((res, rej) => {
          const start = Date.now();
          const interval = setInterval(() => {
            if (receivedChunks.length >= count) {
              clearInterval(interval);
              res([...receivedChunks]);
            } else if (Date.now() - start > timeoutMs) {
              clearInterval(interval);
              rej(
                new Error(
                  `waitForChunks: expected ${count}, got ${receivedChunks.length} after ${timeoutMs}ms`
                )
              );
            }
          }, 50);
        });
      },

      waitForConnection(timeoutMs: number): Promise<void> {
        return new Promise((res, rej) => {
          if (connected) { res(); return; }
          const start = Date.now();
          const interval = setInterval(() => {
            if (connected) {
              clearInterval(interval);
              res();
            } else if (Date.now() - start > timeoutMs) {
              clearInterval(interval);
              rej(new Error(`waitForConnection timed out after ${timeoutMs}ms`));
            }
          }, 100);
        });
      },
    };
  });
}
