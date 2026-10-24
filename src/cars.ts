const LOWPOLY_MODEL_URL = `${import.meta.env.BASE_URL}models/ps1-car.glb`;
const HELLCAT_MODEL_URL = `${import.meta.env.BASE_URL}models/hellcat.glb`;
const PORSCHE_MODEL_URL = `${import.meta.env.BASE_URL}models/porsche-911.glb`;

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
  { id: "stock", name: "Stock", enginePowerMultiplier: 1, gripMultiplier: 1 },
  { id: "sport", name: "Sport", enginePowerMultiplier: 1.15, gripMultiplier: 0.9 },
  { id: "gt", name: "GT", enginePowerMultiplier: 0.9, gripMultiplier: 1.15 },
  {
    id: "lowpoly",
    name: "Lowpoly",
    enginePowerMultiplier: 1.05,
    gripMultiplier: 0.8,
    modelUrl: LOWPOLY_MODEL_URL,
  },
  {
    id: "hellcat",
    name: "Hellcat",
    enginePowerMultiplier: 1.3,
    gripMultiplier: 0.85,
    modelUrl: HELLCAT_MODEL_URL,
  },
  {
    id: "turbo",
    name: "Turbo",
    enginePowerMultiplier: 1.1,
    gripMultiplier: 1.2,
    modelUrl: PORSCHE_MODEL_URL,
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
