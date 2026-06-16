# Carehome Walkie-Talkie — Backend + Simulator

WebSocket relay server and resilience testing simulator for the carehome walkie-talkie.

**Mobile app repo**: [carehome-walkie-mobile](https://github.com/suulcoder/carehome-walkie-mobile)

---

## Production (Render)

The relay server is deployed and used by default by the mobile app.

| Endpoint | URL |
|---|---|
| Health check | `https://carehome-walkie-server.onrender.com/health` |
| WebSocket | `wss://carehome-walkie-server.onrender.com/ws` |

Verify:

```bash
curl https://carehome-walkie-server.onrender.com/health
# → {"status":"ok","ts":...}
```

Mobile app config ([`carehome-walkie-mobile/src/config.ts`](https://github.com/suulcoder/carehome-walkie-mobile/blob/main/src/config.ts)):

```typescript
export const WS_URL = "wss://carehome-walkie-server.onrender.com/ws";
```

> **Cold starts:** Render free tier sleeps after ~15 min idle. First request may take ~30s.

---

## Contents

| Folder | What it is |
|---|---|
| `server/` | Node.js WebSocket relay — broadcasts PTT audio to all peers |
| `simulator/` | Proxy + headless fake client for resilience testing |
| `Dockerfile` | Used by Render for deployment |
| `render.yaml` | Blueprint for Native Node deploy (alternative) |

---

## Prerequisites

- Node 20+
- Git

---

## Quick start (use production — no server setup)

1. Clone and run the [mobile app](https://github.com/suulcoder/carehome-walkie-mobile).
2. The app connects to `wss://carehome-walkie-server.onrender.com/ws` out of the box.
3. Open on two devices, enter different names, test push-to-talk.

---

## Local development

Run the relay server on your machine when you want to develop or debug the backend without Render.

```bash
cd server
npm install
npm run dev
```

| Endpoint | URL |
|---|---|
| Health check | `http://localhost:8080/health` |
| WebSocket | `ws://localhost:8080/ws` |

Then change `WS_URL` in the mobile app — see the mobile README section **Local development**.

---

## Resilience simulator

The simulator runs **on your laptop**. It injects latency, packet loss, disconnects, and bandwidth throttling between the app and the backend.

### Against production (Render)

```bash
cd simulator
npm install
npm start -- \
  --target wss://carehome-walkie-server.onrender.com/ws \
  --listen 9090 \
  --drop-rate 0.2 \
  --latency 500
```

Point the mobile app at the proxy (`ws://<laptop-ip>:9090`), not Render directly.

### Against local server

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --drop-rate 0.2 --latency 500
```

### Proxy flags

| Flag | Default | Purpose |
|---|---|---|
| `--target <url>` | `ws://localhost:8080/ws` | Upstream server (`wss://carehome-walkie-server.onrender.com/ws` for Render) |
| `--listen <port>` | `9090` | Port the proxy listens on |
| `--latency <ms>` | `0` | Delay every message in both directions |
| `--drop-rate <0-1>` | `0` | Randomly drop messages (simulates packet loss) |
| `--disconnect-every <sec>` | `0` (off) | Force-close connection on interval |
| `--bandwidth-kbps <kbps>` | `0` (unlimited) | Throttle throughput |

### Manual test scenarios

| # | Scenario | Command |
|---|---|---|
| 1 | Patchy Wi-Fi | `npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --drop-rate 0.2 --latency 500` |
| 2 | Short dropout | `npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --disconnect-every 10` |
| 3 | High latency | `npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --latency 800` |
| 4 | Total offline | Start proxy, use app, `Ctrl+C` proxy for 30s, restart |
| 5 | Slow bandwidth | `npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --bandwidth-kbps 32 --latency 200` |
| 6 | Worst case combo | `npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --drop-rate 0.15 --latency 400 --bandwidth-kbps 48 --disconnect-every 20` |

For local server testing, replace `--target` with `ws://localhost:8080/ws`.

**What to verify:** connection banner colours, queue count, audio heard on the listening device.

### Automated tests (headless, no phone)

Uses a **local** server internally — does not hit Render.

```bash
cd simulator
npm run test:resilience
```

Exit code `0` = all 6 scenarios passed.

---

## Deploy / redeploy to Render

Already live at [carehome-walkie-server.onrender.com](https://carehome-walkie-server.onrender.com).

To redeploy after pushing to `main`:

1. Render Dashboard → service → **Manual Deploy** → latest commit.
2. Or enable auto-deploy on push.

The repo includes a [`Dockerfile`](./Dockerfile) (Render Docker) and [`render.yaml`](./render.yaml) (Blueprint / Native Node). Health check path: `/health`.

### Troubleshooting

| Log / error | Fix |
|---|---|
| `open Dockerfile: no such file or directory` | Pull latest `main` — Dockerfile is at repo root |
| `we don't have access to your repo` | Render → Account Settings → connect GitHub; grant access to the repo |
| WS connection fails from app | Use `wss://` (not `ws://`) for Render |
| Health check fails | Set path to `/health` in Render service settings |

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

See [RESILIENCE.md](./RESILIENCE.md) for message queueing, replay, and simulator details.
