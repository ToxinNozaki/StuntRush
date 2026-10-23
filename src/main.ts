import * as BABYLON from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { InputManager, describeKeyCode } from "./input";
import { Game } from "./game";
import { MenuUI } from "./menu";
import { EngineAudio } from "./audio";
import {
  loadSettings,
  saveSettings,
  applyGraphicsPreset,
  DEFAULT_KEY_BINDINGS,
  type GraphicsPreset,
  type TimeOfDay,
  type Weather,
  type KeyBindings,
} from "./settings";
import "./debug/errorLogger"; // installed for its side effects: catches errors from frame 1
import { DevOverlay } from "./debug/devOverlay";
import { MenuScene } from "./menuScene";
import { EnvironmentController } from "./environment";
import { hueToHex } from "./cars";

async function main() {
  const loadingScreen = document.getElementById("loadingScreen")!;
  const loadingBarFill = document.getElementById("loadingBarFill")!;
  const loadingPercent = document.getElementById("loadingPercent")!;
  const setLoadingProgress = (pct: number) => {
    loadingBarFill.style.width = `${pct}%`;
    loadingPercent.textContent = `${Math.round(pct)}%`;
  };

  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new BABYLON.Engine(canvas, true, { stencil: true });
  const scene = new BABYLON.Scene(engine);
  setLoadingProgress(10);

  const havokInstance = await HavokPhysics();
  // false = step with Havok's own fixed internal timestep rather than the raw
  // variable frame delta. With the raw delta, a multi-second gap (tab backgrounded,
  // a stutter) makes Havok take ONE step across that whole gap — suspension/gravity
  // forces integrated over several seconds in one shot, launching the car into orbit.
  // The fixed step just simulates "slower" through a stall instead of exploding.
  const havokPlugin = new BABYLON.HavokPlugin(false, havokInstance);
  scene.enablePhysics(new BABYLON.Vector3(0, -18, 0), havokPlugin);
  setLoadingProgress(40);

  scene.clearColor = new BABYLON.Color4(0.55, 0.65, 0.75, 1);

  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;
  sun.position = new BABYLON.Vector3(0, 60, -20);

  const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
  shadowGenerator.useBlurExponentialShadowMap = true;
  let shadowCasters: BABYLON.AbstractMesh[] = [];

  // The render loop starts immediately, before any map is loaded, so Babylon always
  // needs a valid active camera or scene.render() throws every frame. This one just
  // sits idle behind the menu; Game.load()/dispose() swap in and back out the real one.
  const idleCamera = new BABYLON.UniversalCamera("idleCamera", new BABYLON.Vector3(0, 5, -10), scene);
  idleCamera.setTarget(BABYLON.Vector3.Zero());
  scene.activeCamera = idleCamera;

  const input = new InputManager();
  const game = new Game(scene, input, idleCamera);
  const menuScene = new MenuScene(scene, idleCamera, hemi, sun);
  const environment = new EnvironmentController(scene, hemi, sun);

  const settings = loadSettings();
  input.setBindings(settings.keyBindings);
  menuScene.setBodyColor(hueToHex(settings.bodyColorHue));
  let audio: EngineAudio | null = null;

  const applyPreset = (preset: GraphicsPreset) => {
    settings.graphicsPreset = preset;
    saveSettings(settings);
    applyGraphicsPreset(preset, { engine, shadowGenerator }, shadowCasters);
    for (const button of presetButtons) {
      button.classList.toggle("selected", button.dataset.preset === preset);
    }
  };

  game.onCarVisualReady = (meshes) => {
    shadowCasters = meshes;
    applyGraphicsPreset(settings.graphicsPreset, { engine, shadowGenerator }, shadowCasters);
  };

  const hud = document.getElementById("hud")!;
  const backButton = document.getElementById("backButton")!;

  // Menu <-> gameplay swap happens instantly underneath; this just masks the cut
  // with a brief fade so it reads as a transition instead of a hard jump-cut.
  const sceneFade = document.getElementById("sceneFade")!;
  const FADE_MS = 450;
  const fadeToBlack = () =>
    new Promise<void>((resolve) => {
      sceneFade.classList.add("active");
      setTimeout(resolve, FADE_MS);
    });
  const fadeFromBlack = () => sceneFade.classList.remove("active");

  const returnToMenu = async () => {
    await fadeToBlack();
    game.dispose();
    environment.reset();
    hud.classList.add("hidden");
    backButton.classList.add("hidden");
    void menuScene.show();
    menu.show();
    fadeFromBlack();
  };

  const peerCountEl = document.getElementById("peerCount")!;
  game.onPeerCountChanged = (count) => {
    peerCountEl.classList.remove("hidden");
    peerCountEl.textContent = `${count} other player${count === 1 ? "" : "s"} connected`;
  };

  const SIGNALING_URL = "wss://stuntrush-signal.ss1734531235.workers.dev";

  const menu = new MenuUI(async (mapId, carId) => {
    await fadeToBlack();
    menu.hide();
    menuScene.hide();
    if (!audio) {
      audio = new EngineAudio();
      audio.setVolumes(settings.masterVolume, settings.engineVolume);
    }
    await audio.resume();
    environment.apply({ timeOfDay: settings.timeOfDay, weather: settings.weather });
    peerCountEl.classList.add("hidden");
    peerCountEl.textContent = "";
    await game.load(
      mapId,
      environment.gripMultiplier,
      settings.multiplayerEnabled ? SIGNALING_URL : null,
      carId,
      hueToHex(settings.bodyColorHue),
      settings.plateText
    );
    hud.classList.remove("hidden");
    backButton.classList.remove("hidden");
    fadeFromBlack();
  });
  menu.setCar(settings.carId);
  menu.onCarChanged = (carId) => {
    settings.carId = carId;
    saveSettings(settings);
  };

  // --- Paint color slider: a single hue drives both the preview and the live car. ---
  const colorSlider = document.getElementById("colorSlider") as HTMLInputElement;
  const paintHueValue = document.getElementById("paintHueValue")!;
  colorSlider.value = String(settings.bodyColorHue);
  paintHueValue.textContent = `${settings.bodyColorHue}°`;
  colorSlider.addEventListener("input", () => {
    settings.bodyColorHue = Number(colorSlider.value);
    paintHueValue.textContent = `${settings.bodyColorHue}°`;
    saveSettings(settings);
    menuScene.setBodyColor(hueToHex(settings.bodyColorHue));
  });

  // --- License plate text: free-typed, sanitized/capped when it's actually drawn. ---
  const plateInput = document.getElementById("plateInput") as HTMLInputElement;
  plateInput.value = settings.plateText;
  menuScene.setPlateText(settings.plateText);
  plateInput.addEventListener("input", () => {
    settings.plateText = plateInput.value;
    saveSettings(settings);
    menuScene.setPlateText(settings.plateText);
  });

  setLoadingProgress(55);
  await menuScene.show();
  menu.show();
  setLoadingProgress(100);

  document.body.classList.remove("booting");
  loadingScreen.classList.add("hidden");
  setTimeout(() => loadingScreen.remove(), 700);

  backButton.addEventListener("click", returnToMenu);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && game.isLoaded) returnToMenu();
    if (e.code === "KeyC" && game.isLoaded) game.cycleCamera();
  });

  const CAMERA_MODE_LABELS: Record<string, string> = {
    chase: "Chase",
    cockpit: "Cockpit",
    cinematic: "Cinematic",
  };
  const cameraModeEl = document.getElementById("cameraMode")!;
  game.onCameraModeChanged = (mode) => {
    cameraModeEl.textContent = CAMERA_MODE_LABELS[mode] ?? mode;
  };

  // --- Settings panel ---
  const settingsPanel = document.getElementById("settings")!;
  const settingsButton = document.getElementById("settingsButton")!;
  const settingsBack = document.getElementById("settingsBack")!;
  const presetButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#presetRow button")
  );
  const masterSlider = document.getElementById("masterVolume") as HTMLInputElement;
  const masterValue = document.getElementById("masterVolumeValue")!;
  const engineSlider = document.getElementById("engineVolume") as HTMLInputElement;
  const engineValue = document.getElementById("engineVolumeValue")!;

  masterSlider.value = String(Math.round(settings.masterVolume * 100));
  masterValue.textContent = masterSlider.value;
  engineSlider.value = String(Math.round(settings.engineVolume * 100));
  engineValue.textContent = engineSlider.value;

  for (const button of presetButtons) {
    button.addEventListener("click", () => applyPreset(button.dataset.preset as GraphicsPreset));
  }
  applyPreset(settings.graphicsPreset);

  masterSlider.addEventListener("input", () => {
    settings.masterVolume = Number(masterSlider.value) / 100;
    masterValue.textContent = masterSlider.value;
    saveSettings(settings);
    audio?.setVolumes(settings.masterVolume, settings.engineVolume);
  });
  engineSlider.addEventListener("input", () => {
    settings.engineVolume = Number(engineSlider.value) / 100;
    engineValue.textContent = engineSlider.value;
    saveSettings(settings);
    audio?.setVolumes(settings.masterVolume, settings.engineVolume);
  });

  // --- Environment toggles (time of day / weather), on the map-select screen ---
  const timeOfDayButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#timeOfDayRow button")
  );
  const weatherButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#weatherRow button")
  );

  const selectEnvButton = (buttons: HTMLButtonElement[], value: string) => {
    for (const button of buttons) {
      button.classList.toggle("selected", button.dataset.value === value);
    }
  };
  selectEnvButton(timeOfDayButtons, settings.timeOfDay);
  selectEnvButton(weatherButtons, settings.weather);

  for (const button of timeOfDayButtons) {
    button.addEventListener("click", () => {
      settings.timeOfDay = button.dataset.value as TimeOfDay;
      saveSettings(settings);
      selectEnvButton(timeOfDayButtons, settings.timeOfDay);
    });
  }
  for (const button of weatherButtons) {
    button.addEventListener("click", () => {
      settings.weather = button.dataset.value as Weather;
      saveSettings(settings);
      selectEnvButton(weatherButtons, settings.weather);
    });
  }

  const multiplayerButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#multiplayerRow button")
  );
  selectEnvButton(multiplayerButtons, settings.multiplayerEnabled ? "on" : "off");
  for (const button of multiplayerButtons) {
    button.addEventListener("click", () => {
      settings.multiplayerEnabled = button.dataset.value === "on";
      saveSettings(settings);
      selectEnvButton(multiplayerButtons, button.dataset.value!);
    });
  }

  // --- Rebindable controls ---
  const controlsHint = document.getElementById("controlsHint")!;
  const refreshControlsHint = () => {
    const b = settings.keyBindings;
    controlsHint.textContent =
      `${describeKeyCode(b.forward)}${describeKeyCode(b.back)}${describeKeyCode(b.left)}${describeKeyCode(b.right)}` +
      `/Arrows drive · ${describeKeyCode(b.airControl)} air control + Arrows/Mouse to flip · ` +
      `${describeKeyCode(b.reset)} reset · ${describeKeyCode(b.headlights)} headlights · C camera`;
  };
  refreshControlsHint();

  const bindButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".bindRow button[data-action]")
  );
  const refreshBindButtons = () => {
    for (const button of bindButtons) {
      const action = button.dataset.action as keyof KeyBindings;
      button.textContent = describeKeyCode(settings.keyBindings[action]);
    }
  };
  refreshBindButtons();

  let listeningFor: HTMLButtonElement | null = null;
  const stopListening = () => {
    if (listeningFor) listeningFor.classList.remove("listening");
    listeningFor = null;
    window.removeEventListener("keydown", onBindKeydown, true);
  };
  const onBindKeydown = (e: KeyboardEvent) => {
    if (!listeningFor) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      stopListening();
      refreshBindButtons();
      return;
    }
    const action = listeningFor.dataset.action as keyof KeyBindings;
    // Keep bindings 1:1 — if the pressed key is already bound elsewhere, swap it
    // with whatever this action used to have, rather than letting two actions
    // silently share one key.
    const previousCode = settings.keyBindings[action];
    const conflictAction = (Object.keys(settings.keyBindings) as (keyof KeyBindings)[]).find(
      (a) => a !== action && settings.keyBindings[a] === e.code
    );
    settings.keyBindings = { ...settings.keyBindings, [action]: e.code };
    if (conflictAction) settings.keyBindings[conflictAction] = previousCode;
    saveSettings(settings);
    input.setBindings(settings.keyBindings);
    refreshControlsHint();
    stopListening();
    refreshBindButtons();
  };

  for (const button of bindButtons) {
    button.addEventListener("click", () => {
      stopListening();
      listeningFor = button;
      button.classList.add("listening");
      button.textContent = "Press a key…";
      window.addEventListener("keydown", onBindKeydown, true);
    });
  }

  const resetBindingsButton = document.getElementById("resetBindings")!;
  resetBindingsButton.addEventListener("click", () => {
    stopListening();
    settings.keyBindings = { ...DEFAULT_KEY_BINDINGS };
    saveSettings(settings);
    input.setBindings(settings.keyBindings);
    refreshControlsHint();
    refreshBindButtons();
  });

  settingsButton.addEventListener("click", () => {
    menu.hide();
    settingsPanel.classList.remove("hidden");
  });
  settingsBack.addEventListener("click", () => {
    stopListening();
    refreshBindButtons();
    settingsPanel.classList.add("hidden");
    menu.show();
  });

  scene.onBeforeRenderObservable.add(() => {
    audio?.update(game.isLoaded ? game.vehicleSpeedKph : 0, game.isLoaded ? game.vehicleThrottle : 0);
    const telemetry = game.vehicleTelemetry;
    if (telemetry) environment.followPosition(telemetry.position);
  });

  new DevOverlay(engine, scene, () => game.vehicleTelemetry);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

main();
