import { PeerInfo } from "./protocol";

interface ActiveSession {
  sessionId: string;
  from: PeerInfo;
  chunks: Map<number, string>;
}

export interface CompletedSession {
  sessionId: string;
  from: PeerInfo;
  chunks: Map<number, string>;
  sampleRate?: number;
  chunkCount?: number;
  completedAt: number;
}

const active = new Map<string, ActiveSession>();
const completed: CompletedSession[] = [];

const MAX_COMPLETED = 50;
/** Only expose messages this recent in history_sync / replay. */
const HISTORY_MAX_AGE_MS = 10 * 60 * 1000;

export function beginSession(sessionId: string, from: PeerInfo): void {
  active.set(sessionId, { sessionId, from, chunks: new Map() });
}

export function bufferChunk(sessionId: string, seq: number, pcmBase64: string): void {
  active.get(sessionId)?.chunks.set(seq, pcmBase64);
}

export function completeSession(
  sessionId: string,
  sampleRate?: number,
  chunkCount?: number
): CompletedSession | null {
  const session = active.get(sessionId);
  if (!session) return null;

  const entry: CompletedSession = {
    sessionId: session.sessionId,
    from: session.from,
    chunks: session.chunks,
    sampleRate,
    chunkCount,
    completedAt: Date.now(),
  };

  active.delete(sessionId);
  completed.push(entry);
  prune();
  return entry;
}

function prune(): void {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  while (completed.length > 0 && completed.length > MAX_COMPLETED) {
    completed.shift();
  }
  while (completed.length > 0 && completed[0].completedAt < cutoff) {
    completed.shift();
  }
}

export function getMissedSince(since: number): CompletedSession[] {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  return completed.filter(
    (session) => session.completedAt > since && session.completedAt >= cutoff
  );
}

export function getRecentHistory(limit = 10): CompletedSession[] {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const fresh = completed.filter((session) => session.completedAt >= cutoff);
  if (fresh.length === 0) return [];
  return fresh.slice(-limit).reverse();
}
