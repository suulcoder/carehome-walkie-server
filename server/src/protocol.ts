// Shared protocol types ù keep in sync with mobile repo's src/network/protocol.ts

export type ClientMessage =
  | { type: "join"; name: string; channel: string }
  | { type: "ptt_start"; sessionId: string }
  | { type: "audio_chunk"; sessionId: string; seq: number; pcmBase64: string }
  | { type: "ptt_end"; sessionId: string; sampleRate?: number; chunkCount?: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "joined"; clientId: string; peers: PeerInfo[] }
  | { type: "peer_joined"; peer: PeerInfo }
  | { type: "peer_left"; peerId: string }
  | { type: "ptt_start"; sessionId: string; from: PeerInfo }
  | { type: "audio_chunk"; sessionId: string; seq: number; pcmBase64: string; from: PeerInfo }
  | { type: "ptt_end"; sessionId: string; from: PeerInfo; sampleRate?: number; chunkCount?: number }
  | { type: "ack"; sessionId: string; lastSeq: number }
  | { type: "pong" };

export interface PeerInfo {
  id: string;
  name: string;
}
