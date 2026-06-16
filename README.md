# Carehome Walkie-Talkie — Backend + Simulator

WebSocket relay server and resilience testing simulator for the carehome walkie-talkie.

**Mobile app repo**: [carehome-walkie-mobile](https://github.com/suulcoder/carehome-walkie-mobile)

---

## Contents

| Folder | What it is |
|---|---|
| `server/` | Node.js WebSocket relay — broadcasts PTT audio to all peers |
| `simulator/` | Proxy + headless fake client for resilience testing |
| `render.yaml` | One-click Render free-tier deployment |

---

## Prerequisites

- Node 20+
- Git

---

## 1. Start the relay server (local)

```bash
cd server
npm install
npm run dev
```

Server listens on:
- HTTP: `http://localhost:8080` (health check at `/health`)
- WebSocket: `ws://localhost:8080/ws`

---

## 2. Start the resilience simulator proxy

The proxy sits between the mobile app and the server, injecting bad network conditions.

```bash
cd simulator
npm install
npm start -- --target ws://localhost:8080/ws --listen 9090
```

Point the mobile app at `ws://<laptop-ip>:9090` instead of the server directly.

### All proxy flags

| Flag | Default | Purpose |
|---|---|---|
| `--target <url>` | `ws://localhost:8080/ws` | Upstream relay server URL |
| `--listen <port>` | `9090` | Port the proxy listens on |
| `--latency <ms>` | `0` | Delay every message in both directions |
| `--drop-rate <0-1>` | `0` | Randomly drop messages (simulates packet loss) |
| `--disconnect-every <sec>` | `0` (off) | Force-close connection on interval |
| `--bandwidth-kbps <kbps>` | `0` (unlimited) | Throttle throughput |

---

## 3. Run automated resilience tests (headless fake clients)

No phone needed. Starts the server internally, runs all 6 scenarios, prints pass/fail.

```bash
cd simulator
npm run test:resilience
```

Exit code `0` = all passed. Non-zero = check the output for which scenario failed.

---

## 4. All resilience test scenarios

Use these with the proxy and two instances of the mobile app (or two emulators).

| # | Scenario | Proxy command |
|---|---|---|
| 1 | Patchy Wi-Fi | `npm start -- --target ws://localhost:8080/ws --listen 9090 --drop-rate 0.2 --latency 500` |
| 2 | Short dropout | `npm start -- --target ws://localhost:8080/ws --listen 9090 --disconnect-every 10` |
| 3 | High latency | `npm start -- --target ws://localhost:8080/ws --listen 9090 --latency 800` |
| 4 | Total offline | Start proxy, use app, then `Ctrl+C` the proxy for 30s, restart it |
| 5 | Slow bandwidth | `npm start -- --target ws://localhost:8080/ws --listen 9090 --bandwidth-kbps 32 --latency 200` |
| 6 | Worst case combo | `npm start -- --target ws://localhost:8080/ws --listen 9090 --drop-rate 0.15 --latency 400 --bandwidth-kbps 48 --disconnect-every 20` |

**What to verify for each scenario:**
1. The connection banner on the mobile app changes colour correctly (green/amber/red).
2. The queue count increases when offline and drains when reconnected.
3. The listening device hears every completed PTT message — no silent drops.

---

## 5. Deploy to Render (free, $0)

1. Fork or push this repo to GitHub.
2. Go to [render.com](https://render.com) → New → Blueprint.
3. Connect your GitHub repo — Render will find `render.yaml` and provision the service automatically.
4. Copy the service URL (e.g. `https://carehome-walkie-server.onrender.com`).
5. In the mobile app `src/config.ts`, set:
   ```typescript
   export const WS_URL = "wss://carehome-walkie-server.onrender.com/ws";
   ```

> **Note on cold starts**: Render free tier sleeps after ~15 min of idle. The first connection after sleep takes ~30s. The mobile app handles this with its reconnect loop — the banner shows "Connecting…" and automatically joins once the server wakes up.

---

## 6. Verify with two devices

```bash
# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — proxy (optional, for scenario testing)
cd simulator && npm start -- --target ws://localhost:8080/ws --listen 9090 --latency 200

# Then open the mobile app on two devices/emulators
# Device A: enter name "Alice", hold PTT and speak
# Device B: enter name "Bob", listen for audio
```

---

## Protocol reference

All messages are JSON over WebSocket.

```
Client → Server
  join          { type, name, channel }
  ptt_start     { type, sessionId }
  audio_chunk   { type, sessionId, seq, pcmBase64 }
  ptt_end       { type, sessionId }
  ping          { type }

Server → Client
  joined        { type, clientId, peers[] }
  peer_joined   { type, peer }
  peer_left     { type, peerId }
  ptt_start     { type, sessionId, from }
  audio_chunk   { type, sessionId, seq, pcmBase64, from }
  ptt_end       { type, sessionId, from }
  ack           { type, sessionId, lastSeq }
  pong          { type }
```

See [RESILIENCE.md](./RESILIENCE.md) for how the protocol supports message queueing and replay.
