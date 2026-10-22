import * as BABYLON from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { InputManager } from "./input";
import { Game } from "./game";
import { MenuUI } from "./menu";
import { EngineAudio } from "./audio";
import {
  loadSettings,
  saveSettings,
  applyGraphicsPreset,
  type GraphicsPreset,
  type TimeOfDay,
  type Weather,
} from "./settings";
import "./debug/errorLogger"; // installed for its side effects: catches errors from frame 1
import { DevOverlay } from "./debug/devOverlay";
import { MenuScene } from "./menuScene";
import { EnvironmentController } from "./environment";

async function main() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new BABYLON.Engine(canvas, true, { stencil: true });
  const scene = new BABYLON.Scene(engine);

  const havokInstance = await HavokPhysics();
  const havokPlugin = new BABYLON.HavokPlugin(true, havokInstance);
  scene.enablePhysics(new BABYLON.Vector3(0, -18, 0), havokPlugin);

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

  const returnToMenu = () => {
    game.dispose();
    environment.reset();
    hud.classList.add("hidden");
    backButton.classList.add("hidden");
    void menuScene.show();
    menu.show();
  };

  const peerCountEl = document.getElementById("peerCount")!;
  game.onPeerCountChanged = (count) => {
    peerCountEl.classList.remove("hidden");
    peerCountEl.textContent = `${count} other player${count === 1 ? "" : "s"} connected`;
  };

  const SIGNALING_URL = "wss://stuntrush-signal.ss1734531235.workers.dev";

  const menu = new MenuUI(async (mapId) => {
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
    await game.load(mapId, environment.gripMultiplier, settings.multiplayerEnabled ? SIGNALING_URL : null);
    hud.classList.remove("hidden");
    backButton.classList.remove("hidden");
  });
  void menuScene.show();
  menu.show();

  backButton.addEventListener("click", returnToMenu);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && game.isLoaded) returnToMenu();
  });

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

  settingsButton.addEventListener("click", () => {
    menu.hide();
    settingsPanel.classList.remove("hidden");
  });
  settingsBack.addEventListener("click", () => {
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
