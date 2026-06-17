import WebSocket from "ws";
import { HistoryEntry, PeerInfo, ServerMessage } from "./protocol";
import {
  beginSession,
  bufferChunk,
  completeSession,
  CompletedSession,
  getMissedSince,
  getRecentHistory,
} from "./sessionBuffer";

interface Client {
  ws: WebSocket;
  id: string;
  name: string;
}

const clients = new Map<string, Client>();
const HISTORY_LIMIT = 10;
const DEFAULT_SAMPLE_RATE = 16_000;

function pcmDurationMsFromChunks(chunks: Map<number, string>, sampleRate: number): number {
  let bytes = 0;
  chunks.forEach((pcmBase64) => {
    bytes += Buffer.from(pcmBase64, "base64").length;
  });
  return Math.round((bytes / 2 / sampleRate) * 1000);
}

function sessionToHistoryEntry(session: CompletedSession): HistoryEntry {
  const chunks = [...session.chunks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seq, pcmBase64]) => ({ seq, pcmBase64 }));
  const sampleRate = session.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const chunkCount = session.chunkCount ?? chunks.length;

  return {
    sessionId: session.sessionId,
    fromId: session.from.id,
    fromName: session.from.name,
    completedAt: session.completedAt,
    sampleRate,
    chunkCount,
    chunks,
    durationMs: pcmDurationMsFromChunks(session.chunks, sampleRate),
  };
}

function sendHistorySync(ws: WebSocket): void {
  const messages = getRecentHistory(HISTORY_LIMIT).map(sessionToHistoryEntry);
  send(ws, { type: "history_sync", messages });
}

function broadcastHistorySync(): void {
  const messages = getRecentHistory(HISTORY_LIMIT).map(sessionToHistoryEntry);
  const payload: ServerMessage = { type: "history_sync", messages };
  const json = JSON.stringify(payload);
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json);
    }
  });
}

export function resendJoined(id: string, ws: WebSocket): void {
  const peers: PeerInfo[] = [];
  clients.forEach((c) => {
    if (c.id !== id) peers.push({ id: c.id, name: c.name });
  });
  send(ws, { type: "joined", clientId: id, peers });
}

export function addClient(id: string, name: string, ws: WebSocket, since = 0): void {
  evictStaleClientsWithName(name, id);

  const peer: PeerInfo = { id, name };

  broadcast({ type: "peer_joined", peer }, id);

  clients.set(id, { ws, id, name });

  const peers: PeerInfo[] = [];
  clients.forEach((c) => {
    if (c.id !== id) peers.push({ id: c.id, name: c.name });
  });
  send(ws, { type: "joined", clientId: id, peers });
  replayMissedSessions(ws, since);
  sendHistorySync(ws);
}

export function replayMissedSessionsForClient(id: string, since: number): void {
  const client = clients.get(id);
  if (!client) return;
  replayMissedSessions(client.ws, since);
  sendHistorySync(client.ws);
}

function replayMissedSessions(ws: WebSocket, since: number): void {
  const missed = getMissedSince(since);
  if (missed.length === 0) return;

  for (const session of missed) {
    send(ws, {
      type: "ptt_start",
      sessionId: session.sessionId,
      from: session.from,
      replay: true,
    });

    const expected = session.chunkCount ?? session.chunks.size;
    for (let seq = 0; seq < expected; seq++) {
      const pcmBase64 = session.chunks.get(seq);
      if (!pcmBase64) continue;
      send(ws, {
        type: "audio_chunk",
        sessionId: session.sessionId,
        seq,
        pcmBase64,
        from: session.from,
      });
    }

    send(ws, {
      type: "ptt_end",
      sessionId: session.sessionId,
      from: session.from,
      sampleRate: session.sampleRate,
      chunkCount: expected,
      completedAt: session.completedAt,
      replay: true,
    });
  }
}

export function removeClient(id: string): void {
  clients.delete(id);
  broadcast({ type: "peer_left", peerId: id }, id);
}

function evictStaleClientsWithName(name: string, keepId: string): void {
  for (const [existingId, client] of clients) {
    if (existingId === keepId || client.name !== name) continue;
    try {
      client.ws.close(4000, "replaced by newer connection");
    } catch {
      // non-fatal
    }
    clients.delete(existingId);
    broadcast({ type: "peer_left", peerId: existingId });
  }
}

export function handlePttStart(senderId: string, sessionId: string): void {
  const sender = clients.get(senderId);
  if (!sender) return;

  beginSession(sessionId, { id: sender.id, name: sender.name });
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

  bufferChunk(sessionId, seq, pcmBase64);
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
  send(sender.ws, { type: "ack", sessionId, lastSeq: seq });
}

export function handlePttEnd(
  senderId: string,
  sessionId: string,
  sampleRate?: number,
  chunkCount?: number
): void {
  const sender = clients.get(senderId);
  if (!sender) return;

  const completed = completeSession(sessionId, sampleRate, chunkCount);
  broadcast(
    {
      type: "ptt_end",
      sessionId,
      from: { id: sender.id, name: sender.name },
      sampleRate,
      chunkCount,
      completedAt: completed?.completedAt,
    },
    senderId
  );
  send(sender.ws, { type: "ack", sessionId, lastSeq: -1 });
  broadcastHistorySync();
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
