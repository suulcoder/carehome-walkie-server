import WebSocket from "ws";
import { PeerInfo, ServerMessage } from "./protocol";

interface Client {
  ws: WebSocket;
  id: string;
  name: string;
}

// Single hardcoded channel — all clients are in "carehome-1"
const clients = new Map<string, Client>();

export function resendJoined(id: string, ws: WebSocket): void {
  const peers: PeerInfo[] = [];
  clients.forEach((c) => {
    if (c.id !== id) peers.push({ id: c.id, name: c.name });
  });
  send(ws, { type: "joined", clientId: id, peers });
}

export function addClient(id: string, name: string, ws: WebSocket): void {
  const peer: PeerInfo = { id, name };

  // Notify existing clients that someone joined
  broadcast(
    { type: "peer_joined", peer },
    id // exclude the new joiner
  );

  clients.set(id, { ws, id, name });

  // Tell the new client who's already here
  const peers: PeerInfo[] = [];
  clients.forEach((c) => {
    if (c.id !== id) peers.push({ id: c.id, name: c.name });
  });
  send(ws, { type: "joined", clientId: id, peers });
}

export function removeClient(id: string): void {
  clients.delete(id);
  broadcast({ type: "peer_left", peerId: id }, id);
}

export function handlePttStart(senderId: string, sessionId: string): void {
  const sender = clients.get(senderId);
  if (!sender) return;
  broadcast(
    { type: "ptt_start", sessionId, from: { id: sender.id, name: sender.name } },
    senderId
  );
}

export function handleAudioChunk(
  senderId: string,
  sessionId: string,
  seq: number,
  pcmBase64: string
): void {
  const sender = clients.get(senderId);
  if (!sender) return;
  broadcast(
    {
      type: "audio_chunk",
      sessionId,
      seq,
      pcmBase64,
      from: { id: sender.id, name: sender.name },
    },
    senderId
  );
  // Ack back to sender so client can clear queue
  send(sender.ws, { type: "ack", sessionId, lastSeq: seq });
}

export function handlePttEnd(senderId: string, sessionId: string): void {
  const sender = clients.get(senderId);
  if (!sender) return;
  broadcast(
    { type: "ptt_end", sessionId, from: { id: sender.id, name: sender.name } },
    senderId
  );
  send(sender.ws, { type: "ack", sessionId, lastSeq: -1 });
}

function broadcast(msg: ServerMessage, excludeId?: string): void {
  const payload = JSON.stringify(msg);
  clients.forEach((client) => {
    if (client.id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
