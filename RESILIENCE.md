# Resilience Simulator — Usage & Scenarios

This document covers how to use the simulator proxy and headless fake client to test the walkie-talkie app under adverse network conditions.

For the full architecture and UX rationale, see [RESILIENCE.md in the mobile repo](https://github.com/suulcoder/carehome-walkie-mobile/blob/main/RESILIENCE.md).

---

## How the simulator works

The simulator is a WebSocket proxy that sits between the client (mobile app or fake client) and the relay server:

```
Mobile App / Fake Client
        ↓
  Simulator Proxy  ← injects: latency, drops, disconnects, bandwidth throttle
        ↓
  WS Relay Server
```

This lets you reproduce specific network conditions deterministically, without needing a real bad Wi-Fi network.

---

## Proxy flags

| Flag | Default | What it does |
|---|---|---|
| `--target <url>` | `ws://localhost:8080/ws` | Relay server to proxy to |
| `--listen <port>` | `9090` | Port to listen on |
| `--latency <ms>` | `0` | Delay every message in both directions |
| `--drop-rate <0-1>` | `0` | Randomly discard messages (simulates packet loss) |
| `--disconnect-every <sec>` | `0` (off) | Force-close the connection every N seconds |
| `--bandwidth-kbps <kbps>` | `0` (unlimited) | Throttle throughput in kbps |

Flags can be combined freely.

---

## Test scenarios

### Scenario 1 — Patchy Wi-Fi

Simulates a carehome Wi-Fi with 20% packet loss and 500ms latency.

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --drop-rate 0.2 --latency 500
```

**Expected behaviour**: the app shows amber banner; some audio chunks are lost and re-queued; the peer still hears the message (no silent drop of the whole session).

---

### Scenario 2 — Short dropouts

The connection is forcibly closed every 10 seconds.

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --disconnect-every 10
```

**Expected behaviour**: banner flickers amber → green on each reconnect; any PTT pressed during a dropout is queued and delivered after reconnect.

---

### Scenario 3 — High latency

500ms one-way delay (1 second round-trip).

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --latency 800
```

**Expected behaviour**: speech arrives with ~800ms delay; banner stays green; app remains fully usable.

---

### Scenario 4 — Total offline

Stop the proxy (or the server) entirely for 30 seconds, then restart it.

```bash
# Start the proxy
npm start -- --target ws://localhost:8080/ws --listen 9090

# Press Ctrl+C after a few seconds
# Wait 30 seconds
# Restart the proxy with the same command
```

**Expected behaviour**: banner goes red; queue count grows as messages are held; on restart, queued sessions flush automatically.

---

### Scenario 5 — Slow bandwidth

32kbps with 200ms latency — simulates a congested carehome Wi-Fi with an old router.

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --bandwidth-kbps 32 --latency 200
```

**Expected behaviour**: audio delivers slowly (higher latency); the jitter buffer in the mobile app handles reordering; queue count may temporarily grow.

---

### Scenario 6 — Worst case combo

Combines all degradations simultaneously.

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 \
  --drop-rate 0.15 \
  --latency 400 \
  --bandwidth-kbps 48 \
  --disconnect-every 20
```

**Expected behaviour**: app remains usable despite everything; no message is silently lost; UI always reflects the current connection state.

---

## Headless automated tests

The fake client connects to the proxy and relay server programmatically, sends synthetic PTT sessions, and verifies all chunks are received by a second fake listener.

```bash
npm run test:resilience
```

Output example:
```
=== Carehome Walkie-Talkie — Resilience Test Suite ===

[runner] Starting relay server...
[runner] Server ready.

  Running: 1 – Patchy Wi-Fi (drop 20%, latency 300ms) ... PASS
  Running: 2 – Short dropouts (disconnect every 5s) ... PASS
  Running: 3 – High latency (800ms) ... PASS
  Running: 4 – Slow bandwidth (32kbps) ... PASS
  Running: 5 – Worst case combo (drop 15%, latency 300ms, 48kbps) ... PASS
  Running: 6 – No degradation (baseline) ... PASS

=== Results: 6/6 passed ===
```

Each scenario assertion:
- At least 1 (or all, for clean scenarios) audio chunks received by the listener
- Connection established within timeout
- No unhandled exceptions
