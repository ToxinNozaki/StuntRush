import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

const MAX_PEERS = 4;

/**
 * Same protocol as the Node/ws version in signaling-server/: welcome, peer-joined,
 * peer-left, room-full, and a dumb relay for offer/answer/ice messages (whatever
 * `to` field they carry). The client side (src/multiplayer.ts) doesn't know or
 * care which relay it's talking to — only the URL changes.
 */
export class Room extends DurableObject<Env> {
  private readonly sockets = new Map<string, WebSocket>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (this.sockets.size >= MAX_PEERS) {
      server.accept();
      server.send(JSON.stringify({ type: "room-full" }));
      server.close(1000, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSession(ws: WebSocket) {
    ws.accept();
    const id = crypto.randomUUID().slice(0, 8);
    this.sockets.set(id, ws);

    const existingPeers = [...this.sockets.keys()].filter((peerId) => peerId !== id);
    ws.send(JSON.stringify({ type: "welcome", id, peers: existingPeers }));
    this.broadcastExcept(id, { type: "peer-joined", id });

    ws.addEventListener("message", (event) => {
      let msg: Record<string, unknown> | null = null;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!msg || typeof msg.to !== "string") return;
      const target = this.sockets.get(msg.to);
      if (target) target.send(JSON.stringify({ ...msg, from: id }));
    });

    const cleanup = () => {
      this.sockets.delete(id);
      this.broadcastExcept(id, { type: "peer-left", id });
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  private broadcastExcept(exceptId: string, msg: object) {
    const payload = JSON.stringify(msg);
    for (const [id, ws] of this.sockets) {
      if (id !== exceptId) ws.send(payload);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single shared room for now — one Durable Object instance, deterministically
    // addressed by name, holds everyone. Per-map rooms would just be a different name.
    const id = env.ROOM.idFromName("default-room");
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
  },
};
