import WebSocket, { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import http from "http";
import { ClientMessage } from "../types/protocol";
import {
  addClient,
  removeClient,
  handlePttStart,
  handleAudioChunk,
  handlePttEnd,
  resendJoinSnapshot,
} from "../services/room";

export function attachWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = nanoid(10);
    let registered = false;

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "join") {
        if (!registered) {
          registered = true;
          addClient(clientId, msg.name, ws, msg.since ?? 0);
        } else {
          resendJoinSnapshot(clientId, ws);
        }
        return;
      }

      if (!registered) return;

      switch (msg.type) {
        case "ptt_start":
          handlePttStart(clientId, msg.sessionId);
          break;
        case "audio_chunk":
          handleAudioChunk(clientId, msg.sessionId, msg.seq, msg.pcmBase64);
          break;
        case "ptt_end":
          handlePttEnd(clientId, msg.sessionId, msg.sampleRate, msg.chunkCount);
          break;
      }
    });

    ws.on("close", () => {
      if (registered) removeClient(clientId);
    });

    ws.on("error", (err) => {
      console.error(`[ws] client ${clientId} error:`, err.message);
      if (registered) removeClient(clientId);
    });
  });

  return wss;
}
