import * as BABYLON from "@babylonjs/core";

export type GraphicsPreset = "low" | "medium" | "high";
export type TimeOfDay = "day" | "night";
export type Weather = "clear" | "cloudy" | "snow";

export interface Settings {
  graphicsPreset: GraphicsPreset;
  masterVolume: number; // 0..1
  engineVolume: number; // 0..1
  timeOfDay: TimeOfDay;
  weather: Weather;
}

const STORAGE_KEY = "stuntrush_settings_v1";

const DEFAULTS: Settings = {
  graphicsPreset: "medium",
  masterVolume: 0.7,
  engineVolume: 0.8,
  timeOfDay: "day",
  weather: "clear",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
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
