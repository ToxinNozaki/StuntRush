export interface CarSpec {
  id: string;
  name: string;
  /** Scales straight-line engine/reverse force. >1 = faster off the line. */
  enginePowerMultiplier: number;
  /** Scales lateral grip and steering torque. >1 = more planted, less eager to slide. */
  gripMultiplier: number;
}

/**
 * Three performance profiles on the one chassis/physics rig, per the design doc's
 * "reuse one chassis with different paint and stats" shortcut for v1 — a real stat
 * trade-off (power vs. grip), not just a cosmetic pick. Paint color is a fully
 * separate, free choice (see hueToHex below) — picking a performance profile here
 * doesn't lock in a color.
 */
export const CARS: CarSpec[] = [
  { id: "stock", name: "Stock", enginePowerMultiplier: 1, gripMultiplier: 1 },
  { id: "sport", name: "Sport", enginePowerMultiplier: 1.15, gripMultiplier: 0.9 },
  { id: "gt", name: "GT", enginePowerMultiplier: 0.9, gripMultiplier: 1.15 },
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
