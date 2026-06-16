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

**Production URL:** [https://carehome-walkie-server.onrender.com](https://carehome-walkie-server.onrender.com)

| Endpoint | URL |
|---|---|
| Health check | `https://carehome-walkie-server.onrender.com/health` |
| WebSocket | `wss://carehome-walkie-server.onrender.com/ws` |

### Option A — Docker (recommended if Render created a Docker service)

This repo includes a [`Dockerfile`](./Dockerfile) at the root. Render will build it automatically.

1. Connect GitHub repo in Render → **New Web Service** → select repo.
2. **Environment:** Docker (Render detects the Dockerfile).
3. **Health Check Path:** `/health`
4. Deploy.

If you see `open Dockerfile: no such file or directory`, push the latest `main` branch (includes the Dockerfile) and redeploy.

### Option B — Native Node (via Blueprint)

1. Render → **New → Blueprint** → connect repo.
2. Render reads [`render.yaml`](./render.yaml): `rootDir: server`, Node runtime, build/start commands.

### Mobile app config

In `carehome-walkie-mobile/src/config.ts`:

```typescript
export const WS_URL = "wss://carehome-walkie-server.onrender.com/ws";
```

Verify deploy:

```bash
curl https://carehome-walkie-server.onrender.com/health
# → {"status":"ok","ts":...}
```

> **Cold starts:** Render free tier sleeps after ~15 min idle. First request may take ~30s. The mobile app reconnect loop handles this.

### Troubleshooting deploy

| Log / error | Fix |
|---|---|
| `no such file or directory` (Dockerfile) | Pull latest `main` — Dockerfile is at repo root |
| `we don't have access to your repo` | Render Dashboard → Account Settings → connect GitHub; grant access to `suulcoder/carehome-walkie-server` |
| Build succeeds but WS fails | Use `wss://` (not `ws://`) in the mobile app for Render |
| Health check fails | Set path to `/health` in Render service settings |

---

## 5b. Resilience simulator with backend on Render

The simulator runs **on your laptop**, not on Render. It sits between the phone and Render:

```
Phone → proxy (your Mac :9090) → Render (wss://carehome-walkie-server.onrender.com/ws)
```

```bash
cd simulator
npm start -- \
  --target wss://carehome-walkie-server.onrender.com/ws \
  --listen 9090 \
  --drop-rate 0.2 \
  --latency 500
```

Point the mobile app at the **proxy**, not Render directly:

```typescript
// Physical device on same Wi-Fi as your laptop
export const WS_URL = "ws://192.168.1.42:9090";
```

Automated tests (`npm run test:resilience`) still use a **local** server — they do not hit Render.

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
