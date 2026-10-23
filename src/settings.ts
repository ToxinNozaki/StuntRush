import * as BABYLON from "@babylonjs/core";
import { DEFAULT_CAR_ID, DEFAULT_BODY_HUE } from "./cars";

export type GraphicsPreset = "low" | "medium" | "high";
export type TimeOfDay = "day" | "night";
export type Weather = "clear" | "cloudy" | "snow";

/**
 * Rebindable primary drive/action keys. ArrowUp/Down/Left/Right are NOT in here —
 * they're reserved as the fixed GTA-style air-control keys (see input.ts) and stay
 * usable no matter how the player rebinds forward/back/left/right.
 */
export interface KeyBindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  airControl: string;
  reset: string;
  headlights: string;
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  airControl: "Space",
  reset: "KeyR",
  headlights: "KeyH",
};

export interface Settings {
  graphicsPreset: GraphicsPreset;
  masterVolume: number; // 0..1
  engineVolume: number; // 0..1
  timeOfDay: TimeOfDay;
  weather: Weather;
  multiplayerEnabled: boolean;
  carId: string;
  /** Body paint hue, 0-360 — the color slider's only input (see cars.ts hueToHex). */
  bodyColorHue: number;
  keyBindings: KeyBindings;
  /** Rear plate text, free-typed, sanitized/capped in carModel.ts before it's drawn. */
  plateText: string;
}

export const DEFAULT_PLATE_TEXT = "STUNT";

const STORAGE_KEY = "stuntrush_settings_v1";

const DEFAULTS: Settings = {
  graphicsPreset: "medium",
  masterVolume: 0.7,
  engineVolume: 0.8,
  timeOfDay: "day",
  weather: "clear",
  multiplayerEnabled: false,
  carId: DEFAULT_CAR_ID,
  bodyColorHue: DEFAULT_BODY_HUE,
  keyBindings: DEFAULT_KEY_BINDINGS,
  plateText: DEFAULT_PLATE_TEXT,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, keyBindings: { ...DEFAULT_KEY_BINDINGS } };
    const parsed = JSON.parse(raw);
    // Merge keyBindings separately so an older save (or one missing a newly-added
    // action) still fills in every key instead of losing the rest to a shallow spread.
    return {
      ...DEFAULTS,
      ...parsed,
      keyBindings: { ...DEFAULT_KEY_BINDINGS, ...(parsed.keyBindings ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, keyBindings: { ...DEFAULT_KEY_BINDINGS } };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / storage disabled: settings just won't persist across reloads.
  }
}

export interface GraphicsHandles {
  engine: BABYLON.Engine;
  shadowGenerator: BABYLON.ShadowGenerator;
}

/**
 * Applies a graphics preset immediately. Each preset trades real render cost for
 * quality — internal render resolution via hardware scaling, and shadow map size
 * (an empty render list is the cheap way to turn shadows off entirely: nothing to
 * rasterize into the shadow map, no per-preset branching needed at draw time).
 */
export function applyGraphicsPreset(preset: GraphicsPreset, handles: GraphicsHandles, shadowCasters: BABYLON.AbstractMesh[]) {
  const { engine, shadowGenerator } = handles;

  // Changing `mapSize` recreates the shadow map's render target internally, so any
  // renderList fetched beforehand would point at the now-discarded one. Always
  // resize first, then grab the (possibly new) shadow map before touching its list.
  switch (preset) {
    case "low":
      engine.setHardwareScalingLevel(1.5);
      shadowGenerator.getShadowMap()!.renderList = [];
      break;
    case "medium":
      engine.setHardwareScalingLevel(1.0);
      shadowGenerator.mapSize = 1024;
      shadowGenerator.getShadowMap()!.renderList = [...shadowCasters];
      break;
    case "high":
      engine.setHardwareScalingLevel(1.0);
      shadowGenerator.mapSize = 2048;
      shadowGenerator.useBlurExponentialShadowMap = true;
      shadowGenerator.getShadowMap()!.renderList = [...shadowCasters];
      break;
  }
}
