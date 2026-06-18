import { PORT } from "./config/env";
import { createHttpServer } from "./http/createHttpServer";
import { attachWebSocketServer } from "./websocket/handler";

const server = createHttpServer();
attachWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[server] Health: http://localhost:${PORT}/health`);
});
