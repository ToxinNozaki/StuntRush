export interface RemoteTransform {
  p: [number, number, number];
  q: [number, number, number, number];
  speedKph: number;
  airborne: boolean;
  /** Piggybacked on the transform broadcast rather than sent once, so a late joiner
   *  gets it on the very first packet instead of needing a separate handshake step. */
  nickname: string;
}

/** Messages a peer could, in principle, send on the chat channel: just free text
 *  right now, kept as a tagged type so a future kind (e.g. "typing...") doesn't
 *  need a wire-format change. */
interface ChatPayload {
  kind: "chat";
  text: string;
}

const MAX_INCOMING_CHAT_LENGTH = 200; // defensive cap; UI-side sanitizeChatText trims further

type SignalMessage =
  | { type: "welcome"; id: string; peers: string[] }
  | { type: "peer-joined"; id: string }
  | { type: "peer-left"; id: string }
  | { type: "room-full" }
  | { type: "offer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit };

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Full-mesh P2P for up to 4 players: the signaling server only ever relays SDP/ICE
 * messages to introduce peers to each other — once a WebRTC DataChannel is open,
 * car transforms flow directly between browsers, never through the server again.
 * Client-authoritative (no validation of what a peer reports): the trust boundary
 * here is "people on the same LAN/room", not the open internet.
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private selfId: string | null = null;
  private readonly connections = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly chatChannels = new Map<string, RTCDataChannel>();
  private lastSentAt = 0;

  onPeerJoined: ((id: string) => void) | null = null;
  onPeerLeft: ((id: string) => void) | null = null;
  onPeerTransform: ((id: string, transform: RemoteTransform) => void) | null = null;
  onRoomFull: (() => void) | null = null;
  /** Raw text as the peer sent it — the caller is responsible for sanitizing before
   *  display, since a modified client could bypass that peer's own sanitization. */
  onChatMessage: ((id: string, text: string) => void) | null = null;

  get connectedPeerIds(): string[] {
    return [...this.channels.keys()];
  }

  get id(): string | null {
    return this.selfId;
  }

  connect(signalingUrl: string) {
    const ws = new WebSocket(signalingUrl);
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data) as SignalMessage;
      switch (msg.type) {
        case "welcome":
          this.selfId = msg.id;
          for (const peerId of msg.peers) this.connectToExistingPeer(peerId);
          break;
        case "peer-joined":
          this.createOfferTo(msg.id);
          break;
        case "peer-left":
          this.closePeer(msg.id);
          this.onPeerLeft?.(msg.id);
          break;
        case "room-full":
          this.onRoomFull?.();
          break;
        case "offer":
          void this.handleOffer(msg.from, msg.sdp);
          break;
        case "answer":
          void this.handleAnswer(msg.from, msg.sdp);
          break;
        case "ice":
          void this.handleIce(msg.from, msg.candidate);
          break;
      }
    });
  }

  /** Called when a peer-joined event fires — nothing to do but wait; the already-
   *  connected peer is the one who initiates the offer, avoiding both sides racing. */
  private connectToExistingPeer(_peerId: string) {
    // Intentionally empty: see createOfferTo, called by the OTHER side instead.
  }

  private getOrCreateConnection(peerId: string): RTCPeerConnection {
    let pc = this.connections.get(peerId);
    if (pc) return pc;

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.connections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({ type: "ice", to: peerId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ondatachannel = (event) => {
      this.wireChannel(peerId, event.channel);
    };

    return pc;
  }

  private async createOfferTo(peerId: string) {
    const pc = this.getOrCreateConnection(peerId);
    const transformChannel = pc.createDataChannel("transform", { ordered: false, maxRetransmits: 0 });
    this.wireChannel(peerId, transformChannel);
    // Chat needs to actually arrive, unlike a transform frame that's stale a moment
    // later anyway — ordered + reliable (WebRTC's default), its own channel so a
    // reliable retransmit never blocks behind the throwaway transform traffic.
    const chatChannel = pc.createDataChannel("chat");
    this.wireChannel(peerId, chatChannel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", to: peerId, sdp: offer });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.getOrCreateConnection(peerId);
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ type: "answer", to: peerId, sdp: answer });
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.connections.get(peerId);
    if (pc) await pc.setRemoteDescription(sdp);
  }

  private async handleIce(peerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.connections.get(peerId);
    if (pc) await pc.addIceCandidate(candidate).catch(() => {});
  }

  private wireChannel(peerId: string, channel: RTCDataChannel) {
    if (channel.label === "chat") {
      this.chatChannels.set(peerId, channel);
      channel.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data.length > MAX_INCOMING_CHAT_LENGTH) return;
        try {
          const payload = JSON.parse(event.data) as ChatPayload;
          if (payload.kind === "chat" && typeof payload.text === "string") {
            this.onChatMessage?.(peerId, payload.text);
          }
        } catch {
          // malformed packet from a peer — drop it, not worth a crash over
        }
      };
      channel.onclose = () => this.chatChannels.delete(peerId);
      return;
    }

    this.channels.set(peerId, channel);
    channel.onopen = () => this.onPeerJoined?.(peerId);
    channel.onmessage = (event) => {
      try {
        const transform = JSON.parse(event.data) as RemoteTransform;
        this.onPeerTransform?.(peerId, transform);
      } catch {
        // malformed packet from a peer — drop it, not worth a crash over
      }
    };
    channel.onclose = () => this.channels.delete(peerId);
  }

  private closePeer(peerId: string) {
    this.connections.get(peerId)?.close();
    this.connections.delete(peerId);
    this.channels.delete(peerId);
    this.chatChannels.delete(peerId);
  }

  /** Broadcasts a chat message to every connected peer's reliable chat channel. */
  sendChat(text: string) {
    const payload: ChatPayload = { kind: "chat", text };
    const json = JSON.stringify(payload);
    for (const channel of this.chatChannels.values()) {
      if (channel.readyState === "open") channel.send(json);
    }
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ ...msg }));
  }

  /** Broadcasts the local car's transform to every connected peer, throttled to ~20Hz. */
  broadcastTransform(transform: RemoteTransform) {
    const now = performance.now();
    if (now - this.lastSentAt < 50) return;
    this.lastSentAt = now;

    const payload = JSON.stringify(transform);
    for (const channel of this.channels.values()) {
      if (channel.readyState === "open") channel.send(payload);
    }
  }

  dispose() {
    for (const pc of this.connections.values()) pc.close();
    this.connections.clear();
    this.channels.clear();
    this.ws?.close();
    this.ws = null;
  }
}
