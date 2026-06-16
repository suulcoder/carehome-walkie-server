import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import { ClientMessage } from "./protocol";
import {
  addClient,
  removeClient,
  handlePttStart,
  handleAudioChunk,
  handlePttEnd,
  resendJoined,
} from "./room";

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

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
        addClient(clientId, msg.name, ws);
      } else {
        // Client retried join (e.g. joined response was dropped)  re-send joined
        resendJoined(clientId, ws);
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
        handlePttEnd(clientId, msg.sessionId);
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

server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[server] Health: http://localhost:${PORT}/health`);
});
