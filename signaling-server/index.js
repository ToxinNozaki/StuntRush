// Minimal WebRTC signaling relay. Does nothing but introduce peers to each
// other and forward SDP offers/answers and ICE candidates between them — once
// two clients have a WebRTC connection, this server is out of the data path
// entirely. Single shared room, 4 players max, matching the design doc.
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const MAX_PEERS = 4;

const wss = new WebSocketServer({ port: PORT });
const peers = new Map(); // id -> ws

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastExcept(exceptId, msg) {
  for (const [id, ws] of peers) {
    if (id !== exceptId) send(ws, msg);
  }
}

wss.on("connection", (ws) => {
  if (peers.size >= MAX_PEERS) {
    send(ws, { type: "room-full" });
    ws.close();
    return;
  }

  const id = Math.random().toString(36).slice(2, 10);
  peers.set(id, ws);
  send(ws, { type: "welcome", id, peers: [...peers.keys()].filter((p) => p !== id) });
  broadcastExcept(id, { type: "peer-joined", id });
  console.log(`[signal] ${id} joined (${peers.size}/${MAX_PEERS})`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.to !== "string") return;
    const target = peers.get(msg.to);
    if (target) send(target, { ...msg, from: id });
  });

  ws.on("close", () => {
    peers.delete(id);
    broadcastExcept(id, { type: "peer-left", id });
    console.log(`[signal] ${id} left (${peers.size}/${MAX_PEERS})`);
  });
});

console.log(`[signal] listening on ws://localhost:${PORT}`);
