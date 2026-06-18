// Shared protocol types — keep in sync with mobile repo's src/services/websocket/protocol.ts

export type AudioCodec = "pcm" | "opus";

export type ClientMessage =
  | { type: "join"; name: string; channel: string; since?: number }
  | { type: "ptt_start"; sessionId: string }
  | {
      type: "audio_chunk";
      sessionId: string;
      seq: number;
      pcmBase64: string;
      codec?: AudioCodec;
    }
  | { type: "ptt_end"; sessionId: string; sampleRate?: number; chunkCount?: number; codec?: AudioCodec }
  | { type: "ping" };

export type ServerMessage =
  | { type: "joined"; clientId: string; peers: PeerInfo[] }
  | { type: "peer_joined"; peer: PeerInfo }
  | { type: "peer_left"; peerId: string }
  | { type: "ptt_start"; sessionId: string; from: PeerInfo; replay?: boolean }
  | {
      type: "audio_chunk";
      sessionId: string;
      seq: number;
      pcmBase64: string;
      from: PeerInfo;
      replay?: boolean;
      codec?: AudioCodec;
    }
  | {
      type: "ptt_end";
      sessionId: string;
      from: PeerInfo;
      sampleRate?: number;
      chunkCount?: number;
      completedAt?: number;
      replay?: boolean;
      codec?: AudioCodec;
    }
  | { type: "ack"; sessionId: string; lastSeq: number }
  | { type: "history_sync"; messages: HistoryEntry[] }
  | { type: "pong" };

export interface PeerInfo {
  id: string;
  name: string;
}

/** Serializable history row — keep in sync with mobile src/features/inbox/types.ts ServerHistoryEntry */
export interface HistoryEntry {
  sessionId: string;
  fromId: string;
  fromName: string;
  completedAt: number;
  sampleRate: number;
  chunkCount: number;
  chunks: Array<{ seq: number; pcmBase64: string }>;
  durationMs: number;
  codec?: AudioCodec;
}
