/**
 * Sample-based engine audio: real recorded engine/exhaust clips (idle, accel,
 * decel for each), looped and crossfaded by throttle state, with playbackRate
 * modulated by speed to fake an RPM rise within each fixed-length clip — the
 * standard layered-loop technique most racing games actually use, since nobody
 * records a continuous clip across the whole rev range. Same public shape as
 * the old procedural version (setVolumes/update/resume/dispose), so nothing
 * else in the game had to change to swap this in.
 */

interface Layer {
  engineBuffer: AudioBuffer;
  exhaustBuffer: AudioBuffer;
  engineSource: AudioBufferSourceNode | null;
  exhaustSource: AudioBufferSourceNode | null;
  gain: GainNode;
}

const BASE = import.meta.env.BASE_URL;
const CLIPS = {
  idle: { engine: `${BASE}audio/engine_idle.wav`, exhaust: `${BASE}audio/exhaust_idle.wav` },
  accel: { engine: `${BASE}audio/engine_accel.wav`, exhaust: `${BASE}audio/exhaust_accel.wav` },
  decel: { engine: `${BASE}audio/engine_decel.wav`, exhaust: `${BASE}audio/exhaust_decel.wav` },
} as const;

type LayerName = keyof typeof CLIPS;

export class EngineAudio {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly layers = new Map<LayerName, Layer>();
  private ready = false;

  private engineVolume = 0.8;
  private currentRate = 1;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    void this.load();
  }

  private async load() {
    const names: LayerName[] = ["idle", "accel", "decel"];
    for (const name of names) {
      const clip = CLIPS[name];
      const [engineBuffer, exhaustBuffer] = await Promise.all([
        this.loadBuffer(clip.engine),
        this.loadBuffer(clip.exhaust),
      ]);
      this.smoothLoopPoint(engineBuffer, 0.08);
      this.smoothLoopPoint(exhaustBuffer, 0.08);

      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.masterGain);

      this.layers.set(name, { engineBuffer, exhaustBuffer, engineSource: null, exhaustSource: null, gain });
    }

    for (const [, layer] of this.layers) this.startLayer(layer);
    this.ready = true;
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  /** Crossfades the clip's own tail into its head in place, so loop(true) doesn't
   *  pop at the seam — these were extracted clips, not pre-authored loop points. */
  private smoothLoopPoint(buffer: AudioBuffer, fadeSeconds: number) {
    const fadeSamples = Math.min(Math.floor(fadeSeconds * buffer.sampleRate), Math.floor(buffer.length / 4));
    if (fadeSamples <= 0) return;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples; // 0..1 across the fade window
        const tailSample = data[data.length - fadeSamples + i];
        data[i] = data[i] * t + tailSample * (1 - t);
      }
    }
  }

  private startLayer(layer: Layer) {
    layer.engineSource = this.ctx.createBufferSource();
    layer.engineSource.buffer = layer.engineBuffer;
    layer.engineSource.loop = true;
    layer.engineSource.connect(layer.gain);
    layer.engineSource.start();

    layer.exhaustSource = this.ctx.createBufferSource();
    layer.exhaustSource.buffer = layer.exhaustBuffer;
    layer.exhaustSource.loop = true;
    layer.exhaustSource.connect(layer.gain);
    layer.exhaustSource.start();
  }

  setVolumes(masterVolume: number, engineVolume: number) {
    this.engineVolume = engineVolume;
    this.masterGain.gain.setTargetAtTime(masterVolume, this.ctx.currentTime, 0.05);
  }

  /**
   * @param speedKph current speed
   * @param throttle -1..1, how hard the player is on the gas
   */
  update(speedKph: number, throttle = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    const speedFrac = Math.min(speedKph / 160, 1);
    this.currentRate = 0.55 + speedFrac * 1.1; // simulated "RPM" rise within each fixed clip

    const accelerating = throttle > 0.05;
    const coasting = !accelerating && speedKph > 2;
    const idleLevel = Math.max(0, 1 - speedFrac * 1.8); // fades out fast once rolling at all

    const targets: Record<LayerName, number> = {
      idle: idleLevel,
      accel: accelerating ? 1 : 0,
      decel: coasting ? 0.7 : 0,
    };

    for (const [name, layer] of this.layers) {
      const target = targets[name] * this.engineVolume;
      layer.gain.gain.setTargetAtTime(target, t, 0.12);
      if (layer.engineSource) layer.engineSource.playbackRate.setTargetAtTime(this.currentRate, t, 0.1);
      if (layer.exhaustSource) layer.exhaustSource.playbackRate.setTargetAtTime(this.currentRate, t, 0.1);
    }
  }

  /** AudioContext requires a user gesture before it can run; call this from a click handler. */
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  dispose() {
    for (const [, layer] of this.layers) {
      layer.engineSource?.stop();
      layer.exhaustSource?.stop();
      layer.engineSource?.disconnect();
      layer.exhaustSource?.disconnect();
      layer.gain.disconnect();
    }
    this.layers.clear();
    this.masterGain.disconnect();
    void this.ctx.close();
  }
}
