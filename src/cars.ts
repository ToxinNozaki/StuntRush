import type { PlateQuadSpec } from "./carModel";

const LOWPOLY_MODEL_URL = `${import.meta.env.BASE_URL}models/ps1-car.glb`;
const HELLCAT_MODEL_URL = `${import.meta.env.BASE_URL}models/hellcat.glb`;
const PORSCHE_MODEL_URL = `${import.meta.env.BASE_URL}models/porsche-911.glb`;

/** Which sound asset set (see src/audio.ts's AUDIO_PROFILES) a car's engine uses. */
export type AudioProfileId = "hellcat" | "nissan350" | "generic";

export interface CarSpec {
  id: string;
  name: string;
  /** Scales straight-line engine/reverse force. >1 = faster off the line. */
  enginePowerMultiplier: number;
  /** Scales lateral grip and steering torque. >1 = more planted, less eager to slide. */
  gripMultiplier: number;
  /** Overrides the default Nissan model with a different car entirely. Paint color
   *  and plate text still apply best-effort (silently no-op if the model doesn't
   *  have a matching material) — see carModel.ts's BODY_PAINT_MATERIAL_NAME note. */
  modelUrl?: string;
  /** Baked turntable thumbnail for the car-select screen (see scripts/bake-thumbnails.mjs).
   *  Falls back to the live MenuScene turntable if missing. */
  thumbnailUrl?: string;
  /** Which engine sound set src/audio.ts should load for this car. */
  audioProfile: AudioProfileId;
  /** "material" (default): the model has its own plate material (Nissan's
   *  "numberplate.001", the Porsche's "plate") that applyPlateText() swaps directly —
   *  confirmed live per car, not assumed. "quad": the model has no plate geometry at
   *  all (confirmed live — e.g. the Hellcat's rear bumper has no plate recess, just a
   *  badge), so a small quad carrying the custom plate texture gets added instead; see
   *  carModel.ts's attachPlateQuad() and the required plateQuad placement below. */
  plateMode?: "material" | "quad";
  /** Required when plateMode is "quad" — per-car placement in chassis-local units
   *  (same coordinate space as the headlight/taillight offsets in carModel.ts),
   *  found by trial placement in-browser, not computed from the model's bounding box. */
  plateQuad?: PlateQuadSpec;
}

/**
 * Three performance profiles on the one Nissan chassis, per the design doc's "reuse
 * one chassis with different paint and stats" shortcut for v1 — a real stat trade-off
 * (power vs. grip), not just a cosmetic pick. Paint color is a fully separate, free
 * choice (see hueToHex below) — picking a performance profile here doesn't lock in a
 * color. The entries after "GT", added post-v1, are genuinely different cars rather
 * than stat variants on the Nissan chassis — Lowpoly from Ideas.txt's "novelty cars"
 * idea (not Lightning McQueen — that one's a real Pixar character, skipped on purpose),
 * then a Hellcat (power pick, trades away some grip) and a 911 Turbo (grip pick, trades
 * away some power) so the roster has an actual muscle-vs-sports-car choice beyond paint.
 */
export const CARS: CarSpec[] = [
  { id: "stock", name: "Stock", enginePowerMultiplier: 1, gripMultiplier: 1, audioProfile: "nissan350" },
  { id: "sport", name: "Sport", enginePowerMultiplier: 1.15, gripMultiplier: 0.9, audioProfile: "nissan350" },
  { id: "gt", name: "GT", enginePowerMultiplier: 0.9, gripMultiplier: 1.15, audioProfile: "nissan350" },
  {
    id: "lowpoly",
    name: "Lowpoly",
    enginePowerMultiplier: 1.05,
    gripMultiplier: 0.8,
    modelUrl: LOWPOLY_MODEL_URL,
    audioProfile: "generic",
  },
  {
    id: "hellcat",
    name: "Hellcat",
    enginePowerMultiplier: 1.3,
    gripMultiplier: 0.85,
    modelUrl: HELLCAT_MODEL_URL,
    audioProfile: "hellcat",
    plateMode: "quad",
    plateQuad: { offset: [0, -0.05, -2.1], rotationY: Math.PI, width: 0.32, height: 0.16 },
  },
  {
    id: "turbo",
    name: "Turbo",
    enginePowerMultiplier: 1.1,
    gripMultiplier: 1.2,
    modelUrl: PORSCHE_MODEL_URL,
    audioProfile: "generic",
  },
];

export const DEFAULT_CAR_ID = CARS[0].id;

export function getCarSpec(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

export const DEFAULT_BODY_HUE = 210;

/**
 * Converts a hue (0-360, the color slider's only input) to a hex color at a fixed
 * saturation/lightness tuned to read as glossy car paint across the whole wheel —
 * vivid but not neon, dark enough that white specular highlights still pop.
 */
export function hueToHex(hue: number, saturation = 0.62, lightness = 0.42): string {
  const h = ((hue % 360) + 360) % 360 / 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
