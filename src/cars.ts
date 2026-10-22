export interface CarSpec {
  id: string;
  name: string;
  /** Body paint color applied to the model's paint material (Material.004 in the glTF). */
  bodyColorHex: string;
  /** Scales straight-line engine/reverse force. >1 = faster off the line. */
  enginePowerMultiplier: number;
  /** Scales lateral grip and steering torque. >1 = more planted, less eager to slide. */
  gripMultiplier: number;
}

/**
 * Three paint jobs on the one chassis/physics rig, per the design doc's "reuse one
 * chassis with different paint and stats" shortcut for v1 — a real stat trade-off
 * (power vs. grip), not just a recolor, so picking one is an actual choice.
 */
export const CARS: CarSpec[] = [
  { id: "silver", name: "Silver Stock", bodyColorHex: "#9aa0a6", enginePowerMultiplier: 1, gripMultiplier: 1 },
  {
    id: "crimson",
    name: "Crimson Sport",
    bodyColorHex: "#9c1c26",
    enginePowerMultiplier: 1.15,
    gripMultiplier: 0.9,
  },
  {
    id: "cobalt",
    name: "Cobalt GT",
    bodyColorHex: "#1f3a66",
    enginePowerMultiplier: 0.9,
    gripMultiplier: 1.15,
  },
];

export const DEFAULT_CAR_ID = CARS[0].id;

export function getCarSpec(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
