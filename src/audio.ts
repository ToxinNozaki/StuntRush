/**
 * Layered procedural engine audio (Web Audio, no samples). There's no licensed
 * engine recording in the project — the SFX library the car came up in search
 * requires an account login, which isn't something to pull assets through
 * automatically — so this is built to sound as convincing as synthesis can get,
 * and to be a drop-in replacement point: swap this class for a sample-based one
 * later without touching anything that calls it (same start/update/dispose shape).
 *
 * Layers, mixed together:
 *  - 3 detuned oscillator "cylinders" — a single oscillator reads as a kazoo;
 *    a few slightly-detuned ones beating against each other reads as an engine.
 *  - a filtered noise layer for exhaust rumble/rasp, louder under load.
 *  - a supercharger whine that only shows up under hard throttle, pitched to
 *    speed — the "loud and beautiful" ask specifically wanted this.
 *  - simulated gear steps: pitch rises through a gear, then drops at the shift
 *    point and climbs again, instead of one monotonic pitch ramp to top speed.
 */
export class EngineAudio {
  private readonly ctx: AudioContext;
  private readonly cylinders: OscillatorNode[] = [];
  private readonly cylinderGain: GainNode;
  private readonly noiseSource: AudioBufferSourceNode;
  private readonly noiseFilter: BiquadFilterNode;
  private readonly noiseGain: GainNode;
  private readonly whineOsc: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly engineGain: GainNode;
  private readonly masterGain: GainNode;

  private masterVolume = 0.7;
  private engineVolume = 0.8;

  // Simulated gear ratios: each one covers a speed band before "shifting" to the next.
  private readonly gearRatios = [3.2, 2.1, 1.5, 1.1, 0.85, 0.68];
  private readonly shiftSpeedsKph = [35, 65, 95, 125, 155];

  constructor() {
    this.ctx = new AudioContext();

    this.cylinderGain = this.ctx.createGain();
    const detunes = [-6, 0, 7];
    for (const detune of detunes) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 50;
      osc.detune.value = detune;
      osc.connect(this.cylinderGain);
      osc.start();
      this.cylinders.push(osc);
    }

    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.buildNoiseBuffer();
    this.noiseSource.loop = true;
    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 180;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseSource.start();

    this.whineOsc = this.ctx.createOscillator();
    this.whineOsc.type = "sine";
    this.whineOsc.frequency.value = 400;
    this.whineGain = this.ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain);
    this.whineOsc.start();

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.masterGain = this.ctx.createGain();

    this.cylinderGain.connect(this.engineGain);
    this.noiseGain.connect(this.engineGain);
    this.whineGain.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  setVolumes(masterVolume: number, engineVolume: number) {
    this.masterVolume = masterVolume;
    this.engineVolume = engineVolume;
    this.masterGain.gain.setTargetAtTime(masterVolume, this.ctx.currentTime, 0.05);
  }

  /**
   * @param speedKph current speed
   * @param throttle -1..1, how hard the player is on the gas (drives the whine + rasp)
   */
  update(speedKph: number, throttle = 0) {
    const t = this.ctx.currentTime;
    const { gearPitch, revFraction } = this.computeGearPitch(speedKph);

    const baseFreq = 38 + gearPitch * 210;
    for (const osc of this.cylinders) {
      osc.frequency.setTargetAtTime(baseFreq, t, 0.06);
    }

    const load = Math.max(0, throttle);
    const idle = 0.12;
    const engineLevel = (idle + revFraction * 0.55 + load * 0.33) * this.engineVolume;
    this.engineGain.gain.setTargetAtTime(engineLevel, t, 0.08);

    this.noiseFilter.frequency.setTargetAtTime(120 + revFraction * 900, t, 0.1);
    this.noiseGain.gain.setTargetAtTime((0.15 + load * 0.5) * this.engineVolume, t, 0.08);

    // Supercharger whine: only really sings under load, pitched up with speed —
    // this is the "loud, beautiful, supercharged" layer specifically asked for.
    const whineTarget = load > 0.15 ? (load - 0.15) * 1.3 : 0;
    this.whineGain.gain.setTargetAtTime(whineTarget * 0.22 * this.engineVolume, t, 0.05);
    this.whineOsc.frequency.setTargetAtTime(350 + revFraction * 900, t, 0.05);
  }

  /** Maps speed through simulated gear ratios so pitch rises-and-drops like a real car, not one long ramp. */
  private computeGearPitch(speedKph: number): { gearPitch: number; revFraction: number } {
    let gear = 0;
    for (const shiftSpeed of this.shiftSpeedsKph) {
      if (speedKph >= shiftSpeed) gear++;
      else break;
    }
    gear = Math.min(gear, this.gearRatios.length - 1);

    const bandStart = gear === 0 ? 0 : this.shiftSpeedsKph[gear - 1];
    const bandEnd = this.shiftSpeedsKph[gear] ?? bandStart + 40;
    const revFraction = Math.min(1, (speedKph - bandStart) / Math.max(1, bandEnd - bandStart));

    const gearPitch = (revFraction * 0.6 + 0.25) * (this.gearRatios[gear] / this.gearRatios[0]) * 2.6;
    return { gearPitch: Math.min(gearPitch, 1.4), revFraction };
  }

  private buildNoiseBuffer(): AudioBuffer {
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** AudioContext requires a user gesture before it can run; call this from a click handler. */
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  dispose() {
    for (const osc of this.cylinders) {
      osc.stop();
      osc.disconnect();
    }
    this.noiseSource.stop();
    this.noiseSource.disconnect();
    this.whineOsc.stop();
    this.whineOsc.disconnect();
    this.noiseFilter.disconnect();
    this.noiseGain.disconnect();
    this.whineGain.disconnect();
    this.cylinderGain.disconnect();
    this.engineGain.disconnect();
    this.masterGain.disconnect();
    void this.ctx.close();
  }
}
