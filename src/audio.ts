/**
 * Sample-based, per-car engine audio. Each car (see cars.ts's `audioProfile`) gets its
 * own set of real recorded clips — not the old single shared idle/accel/decel set every
 * car used to play identically. A profile is a handful of "bands" (gear-staged for the
 * Hellcat, low/mid/high-RPM-staged for the Nissan 350 and the generic fallback), each
 * covering a slice of a 0-1 fake-RPM range driven by speed; bands crossfade into each
 * other as fake-RPM moves, the same layered-loop technique the old 3-layer system used,
 * just with more layers and real per-car material instead of one clip set shared by all.
 * Same public shape as before (setVolumes/update/resume/dispose) plus setProfile(), so
 * the render-loop wiring in main.ts barely changed.
 */

export interface AudioBand {
  id: string;
  file: string;
  /** Fake-RPM range (0-1, see update()) this band is the loudest within. */
  rangeStart: number;
  rangeEnd: number;
}

export interface AudioProfile {
  id: "hellcat" | "nissan350" | "generic";
  idleFile: string;
  bands: AudioBand[];
  /** One-shots — not looped, not part of the crossfade graph. */
  startFile?: string;
  stopFile?: string;
  /** A throttle-lift overlay distinct from the idle/band ladder (the Nissan 350's
   *  "revdown" clip) — fades in while coasting off-throttle at speed, same spirit as
   *  the old system's dedicated "decel" layer. */
  revdownFile?: string;
  /** A rare one-shot (the Nissan 350's backfire pop) fired on a hard decel from speed. */
  backfireFile?: string;
  /** Overall volume character — the generic set (no dedicated recordings exist for
   *  Turbo/Lowpoly) is deliberately trimmed down and dulled so it reads as "lesser"
   *  than a car with real dedicated recordings, not just reused at equal volume. */
  gainTrim: number;
  /** Cutoff in Hz for an optional lowpass — only the generic profile uses this, to
   *  round off material that wasn't recorded/mixed as richly as the dedicated sets. */
  lowpassHz?: number;
  /** Fake top speed (kph) this profile's fake-RPM ladder is normalized against —
   *  cars with a higher enginePowerMultiplier should feel like they rev through the
   *  same bands faster, but that's handled by the caller passing speedKph in; this is
   *  just "what speed counts as fake-RPM 1.0" for THIS profile's recordings. */
  topSpeedKph: number;
}

const BASE = import.meta.env.BASE_URL;

export const AUDIO_PROFILES: Record<string, AudioProfile> = {
  hellcat: {
    id: "hellcat",
    idleFile: `${BASE}audio/hellcat/idle.wav`,
    startFile: `${BASE}audio/hellcat/start.wav`,
    stopFile: `${BASE}audio/hellcat/stop.wav`,
    bands: [
      { id: "first", file: `${BASE}audio/hellcat/first.wav`, rangeStart: 0, rangeEnd: 0.3 },
      { id: "second", file: `${BASE}audio/hellcat/second.wav`, rangeStart: 0.22, rangeEnd: 0.55 },
      { id: "third", file: `${BASE}audio/hellcat/third.wav`, rangeStart: 0.45, rangeEnd: 0.8 },
      { id: "fourth", file: `${BASE}audio/hellcat/fourth.wav`, rangeStart: 0.7, rangeEnd: 1 },
    ],
    gainTrim: 1,
    topSpeedKph: 230,
  },
  nissan350: {
    id: "nissan350",
    idleFile: `${BASE}audio/nissan350/idle.wav`,
    revdownFile: `${BASE}audio/nissan350/revdown.wav`,
    backfireFile: `${BASE}audio/nissan350/backfire.wav`,
    bands: [
      { id: "low", file: `${BASE}audio/nissan350/low.wav`, rangeStart: 0, rangeEnd: 0.45 },
      { id: "mid", file: `${BASE}audio/nissan350/mid.wav`, rangeStart: 0.35, rangeEnd: 0.75 },
      { id: "second", file: `${BASE}audio/nissan350/second.wav`, rangeStart: 0.6, rangeEnd: 1 },
    ],
    gainTrim: 0.95,
    topSpeedKph: 190,
  },
  generic: {
    id: "generic",
    idleFile: `${BASE}audio/generic/idle.mp3`,
    startFile: `${BASE}audio/generic/start.mp3`,
    stopFile: `${BASE}audio/generic/stop.mp3`,
    bands: [
      { id: "low", file: `${BASE}audio/generic/low.mp3`, rangeStart: 0, rangeEnd: 0.4 },
      { id: "mid", file: `${BASE}audio/generic/mid.mp3`, rangeStart: 0.3, rangeEnd: 0.75 },
      { id: "high", file: `${BASE}audio/generic/high.mp3`, rangeStart: 0.65, rangeEnd: 1 },
    ],
    gainTrim: 0.8,
    lowpassHz: 3200,
    topSpeedKph: 190,
  },
};

interface LiveBand extends AudioBand {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

export class EngineAudio {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly lowpass: BiquadFilterNode;

  private bands: LiveBand[] = [];
  private idleSource: AudioBufferSourceNode | null = null;
  private idleGain: GainNode | null = null;
  private revdownSource: AudioBufferSourceNode | null = null;
  private revdownGain: GainNode | null = null;
  private backfireBuffer: AudioBuffer | null = null;

  private profile: AudioProfile | null = null;
  private loadToken = 0;
  private ready = false;

  private engineVolume = 0.8;
  private lastSpeedKph = 0;
  private backfireCooldownUntil = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.lowpass = this.ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 20000; // effectively off until a profile asks for less
    this.masterGain = this.ctx.createGain();
    this.lowpass.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  /** Loads (or reloads) the clip set for a car. Safe to call before resume() — nothing
   *  actually plays until the AudioContext is running. A later call while an earlier
   *  one is still loading wins; the earlier one's results are discarded on arrival. */
  async setProfile(profileId: string): Promise<void> {
    const profile = AUDIO_PROFILES[profileId] ?? AUDIO_PROFILES.generic;
    if (this.profile?.id === profile.id && this.ready) return;
    const token = ++this.loadToken;
    this.ready = false;

    const [idleBuffer, bandBuffers, revdownBuffer, backfireBuffer] = await Promise.all([
      this.loadBuffer(profile.idleFile),
      Promise.all(profile.bands.map((b) => this.loadBuffer(b.file))),
      profile.revdownFile ? this.loadBuffer(profile.revdownFile) : Promise.resolve(null),
      profile.backfireFile ? this.loadBuffer(profile.backfireFile) : Promise.resolve(null),
    ]);
    if (token !== this.loadToken) return; // a newer setProfile() call superseded this one

    this.smoothLoopPoint(idleBuffer, 0.08);
    for (const buf of bandBuffers) this.smoothLoopPoint(buf, 0.08);
    if (revdownBuffer) this.smoothLoopPoint(revdownBuffer, 0.08);

    this.teardownCurrent();

    this.profile = profile;
    this.lowpass.frequency.setTargetAtTime(profile.lowpassHz ?? 20000, this.ctx.currentTime, 0.2);

    this.idleGain = this.ctx.createGain();
    this.idleGain.gain.value = 0;
    this.idleGain.connect(this.lowpass);
    this.idleSource = this.startLoop(idleBuffer, this.idleGain);

    this.bands = profile.bands.map((band, i) => {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.lowpass);
      return { ...band, buffer: bandBuffers[i], source: this.startLoop(bandBuffers[i], gain), gain };
    });

    if (revdownBuffer) {
      this.revdownGain = this.ctx.createGain();
      this.revdownGain.gain.value = 0;
      this.revdownGain.connect(this.lowpass);
      this.revdownSource = this.startLoop(revdownBuffer, this.revdownGain);
    }
    this.backfireBuffer = backfireBuffer;

    this.ready = true;
    if (profile.startFile) void this.playOneShot(profile.startFile);
  }

  private teardownCurrent() {
    this.idleSource?.stop();
    this.idleSource?.disconnect();
    this.idleGain?.disconnect();
    this.idleSource = null;
    this.idleGain = null;
    this.revdownSource?.stop();
    this.revdownSource?.disconnect();
    this.revdownGain?.disconnect();
    this.revdownSource = null;
    this.revdownGain = null;
    for (const band of this.bands) {
      band.source?.stop();
      band.source?.disconnect();
      band.gain.disconnect();
    }
    this.bands = [];
  }

  private startLoop(buffer: AudioBuffer, gain: GainNode): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    return source;
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  /** Crossfades the clip's own tail into its head in place, so loop(true) doesn't
   *  pop at the seam — these are extracted/recorded clips, not pre-authored loop points. */
  private smoothLoopPoint(buffer: AudioBuffer, fadeSeconds: number) {
    const fadeSamples = Math.min(Math.floor(fadeSeconds * buffer.sampleRate), Math.floor(buffer.length / 4));
    if (fadeSamples <= 0) return;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const tailSample = data[data.length - fadeSamples + i];
        data[i] = data[i] * t + tailSample * (1 - t);
      }
    }
  }

  private async playOneShot(url: string) {
    const buffer = await this.loadBuffer(url);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = this.engineVolume * (this.profile?.gainTrim ?? 1);
    source.connect(gain);
    gain.connect(this.lowpass);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
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
    if (!this.ready || !this.profile) return;
    const t = this.ctx.currentTime;
    const trim = this.engineVolume * this.profile.gainTrim;

    const fakeRpm = Math.min(speedKph / this.profile.topSpeedKph, 1);
    const accelerating = throttle > 0.05;
    const coasting = !accelerating && speedKph > 2;

    // Idle fades out fast once rolling at all, same shape as the old single-layer system.
    const idleTarget = Math.max(0, 1 - fakeRpm * 2.2) * trim;
    this.idleGain?.gain.setTargetAtTime(idleTarget, t, 0.12);

    for (const band of this.bands) {
      const inRange = fakeRpm >= band.rangeStart && fakeRpm <= band.rangeEnd;
      let weight = 0;
      if (inRange) {
        const mid = (band.rangeStart + band.rangeEnd) / 2;
        const half = (band.rangeEnd - band.rangeStart) / 2 || 1;
        weight = 1 - Math.abs(fakeRpm - mid) / half; // 1 at band center, 0 at its edges
      }
      band.gain.gain.setTargetAtTime(weight * trim, t, 0.12);
      if (band.source) {
        const localFrac = Math.min(Math.max((fakeRpm - band.rangeStart) / (band.rangeEnd - band.rangeStart || 1), 0), 1);
        band.source.playbackRate.setTargetAtTime(0.92 + localFrac * 0.18, t, 0.1);
      }
    }

    if (this.revdownGain) {
      this.revdownGain.gain.setTargetAtTime(coasting ? 0.55 * trim : 0, t, 0.15);
    }

    // Rare backfire pop on a hard decel from real speed — a few-second cooldown keeps
    // it a surprise, not a metronome.
    if (
      this.backfireBuffer &&
      throttle < -0.3 &&
      this.lastSpeedKph > 90 &&
      speedKph < this.lastSpeedKph - 2 &&
      t > this.backfireCooldownUntil &&
      Math.random() < 0.35
    ) {
      this.backfireCooldownUntil = t + 4;
      const source = this.ctx.createBufferSource();
      source.buffer = this.backfireBuffer;
      const gain = this.ctx.createGain();
      gain.gain.value = trim;
      source.connect(gain);
      gain.connect(this.lowpass);
      source.start();
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
    }
    this.lastSpeedKph = speedKph;
  }

  /** AudioContext requires a user gesture before it can run; call this from a click handler. */
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  dispose() {
    this.teardownCurrent();
    this.masterGain.disconnect();
    this.lowpass.disconnect();
    void this.ctx.close();
  }
}

/** A one-shot UI click, decoded fresh each call (the clip is tiny) — reuses the same
 *  AudioContext-resume-on-gesture convention the engine audio already relies on. */
let uiClickCtx: AudioContext | null = null;
let uiClickBuffer: AudioBuffer | null = null;
export async function playUiClick() {
  if (!uiClickCtx) uiClickCtx = new AudioContext();
  if (uiClickCtx.state === "suspended") await uiClickCtx.resume();
  if (!uiClickBuffer) {
    const response = await fetch(`${BASE}audio/ui/click.wav`);
    uiClickBuffer = await uiClickCtx.decodeAudioData(await response.arrayBuffer());
  }
  const source = uiClickCtx.createBufferSource();
  source.buffer = uiClickBuffer;
  const gain = uiClickCtx.createGain();
  gain.gain.value = 0.35;
  source.connect(gain);
  gain.connect(uiClickCtx.destination);
  source.start();
}
