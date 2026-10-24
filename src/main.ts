import * as BABYLON from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { InputManager, describeKeyCode } from "./input";
import { Game } from "./game";
import { EntryScreen } from "./menu";
import { MapSelectScreen, CarSelectScreen } from "./screens";
import { EngineAudio, playUiClick } from "./audio";
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
import { hueToHex, getCarSpec } from "./cars";
import { MAX_CHAT_LENGTH } from "./chat";

async function main() {
  const loadingScreen = document.getElementById("loadingScreen")!;
  const loadingBarFill = document.getElementById("loadingBarFill")!;
  const loadingPercent = document.getElementById("loadingPercent")!;
  const loadingLabelText = document.getElementById("loadingLabelText")!;
  const setLoadingProgress = (pct: number, label?: string) => {
    loadingBarFill.style.width = `${pct}%`;
    loadingPercent.textContent = `${Math.round(pct)}%`;
    if (label) loadingLabelText.textContent = label;
  };

  // Rotating flavor line under the loading bar — a real racing-game loading-screen
  // convention (tips/lore cycling during the wait) rather than a bare silent bar.
  const loadingTipEl = document.getElementById("loadingTip")!;
  const LOADING_TIPS = [
    "Tip: hold Space in the air to steer into a flip.",
    "Tip: press H to toggle your headlights.",
    "Tip: press C to cycle Chase / Cockpit / Cinematic cameras.",
    "Tip: the half-pipe rewards commitment, not caution.",
    "Tip: R resets you back to the track if you land wrong.",
  ];
  let tipInterval: ReturnType<typeof setInterval> | null = null;
  const startTipRotation = () => {
    let i = Math.floor(Math.random() * LOADING_TIPS.length);
    loadingTipEl.textContent = LOADING_TIPS[i];
    tipInterval = setInterval(() => {
      i = (i + 1) % LOADING_TIPS.length;
      loadingTipEl.style.opacity = "0";
      setTimeout(() => {
        loadingTipEl.textContent = LOADING_TIPS[i];
        loadingTipEl.style.opacity = "0.55";
      }, 300);
    }, 2200);
  };
  const stopTipRotation = () => {
    if (tipInterval) clearInterval(tipInterval);
    tipInterval = null;
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

  // Image-based lighting: gives every PBR car material (clearcoat paint
  // especially) something real to reflect instead of flat, lightless panels.
  // Self-hosted from the asset dump's Poly Haven CC0 HDRI (kiara_8_sunset,
  // converted offline from the raw 4K EXR to a 1024x512 Radiance .hdr with a
  // Python OpenEXR + cv2 script, downscaled since this only ever feeds blurred
  // specular/irradiance reflections, never shown directly as a skybox — see
  // DESIGN_DOC.md's asset-dump notes). Originally used Babylon's own CDN-hosted
  // default studio environment instead; replaced 2026-10-24 to remove that
  // external fetch (assets.babylonjs.com), a real risk on a restrictive school
  // network per the design doc's own risk table. `HDRCubeTexture` PMREM-filters
  // the equirectangular .hdr into a prefiltered cubemap at runtime in the
  // browser — unlike Babylon's baked `.env` format, it needs no offline IBL
  // bake tool, which is what made self-hosting impractical before now.
  scene.environmentTexture = new BABYLON.HDRCubeTexture(
    `${import.meta.env.BASE_URL}hdri/kiara-sunset.hdr`,
    scene,
    256,
    false,
    true,
    false,
    true
  );
  scene.environmentIntensity = 0.7;

  // Scene-wide tone mapping/grading — this is what makes the render feel
  // "finished" rather than default-engine-flat (the design doc's bloom/color
  // grading/vignette ask). Lives on ImageProcessingConfiguration rather than a
  // DefaultRenderingPipeline specifically so it keeps working no matter which
  // camera is active (chase/cockpit/cinematic/menu) without needing every new
  // camera re-attached to a pipeline.
  const imageProcessing = scene.imageProcessingConfiguration;
  imageProcessing.contrast = 1.12;
  imageProcessing.exposure = 1.05;
  imageProcessing.vignetteEnabled = true;
  imageProcessing.vignetteWeight = 1.4;
  imageProcessing.vignetteStretch = 0.15;
  imageProcessing.vignetteColor = new BABYLON.Color4(0, 0, 0, 1);

  // Hemi carries the ambient fill; nudged down slightly from before since the
  // environment texture above now contributes real ambient of its own — without
  // this the two would stack and wash out daytime highlights.
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.45;
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;
  sun.position = new BABYLON.Vector3(0, 60, -20);

  const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.bias = 0.0015;
  shadowGenerator.normalBias = 0.02;
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
  menuScene.setCarModel(getCarSpec(settings.carId));
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

  // --- Multiplayer chat: free-typed, sanitized on both send and receive. No
  // persistence by design (not even sessionStorage) — it's in-memory only and
  // cleared the moment the map is left. ---
  const chatLog = document.getElementById("chatLog")!;
  const chatInputRow = document.getElementById("chatInputRow")!;
  const chatInput = document.getElementById("chatInput") as HTMLInputElement;
  chatInput.maxLength = MAX_CHAT_LENGTH;

  const appendChatMessage = (label: string, text: string) => {
    chatLog.classList.remove("hidden");
    const line = document.createElement("div");
    line.className = "chatMsg";
    const nameEl = document.createElement("span");
    nameEl.className = "chatName";
    nameEl.textContent = `${label}:`;
    line.appendChild(nameEl);
    line.appendChild(document.createTextNode(text));
    chatLog.appendChild(line);
    while (chatLog.children.length > 6) chatLog.removeChild(chatLog.firstElementChild!);
    setTimeout(() => {
      line.style.opacity = "0";
      setTimeout(() => line.remove(), 1000);
    }, 7000);
  };
  game.onChatMessage = (label, text) => appendChatMessage(label, text);

  const closeChat = () => {
    chatInputRow.classList.add("hidden");
    chatInput.value = "";
    chatInput.blur();
  };
  const openChat = () => {
    if (!game.isLoaded || !settings.multiplayerEnabled) return;
    chatInputRow.classList.remove("hidden");
    chatInput.focus();
  };
  const clearChat = () => {
    closeChat();
    chatLog.replaceChildren();
    chatLog.classList.add("hidden");
  };
  // Every keystroke while composing a chat message is stopped here, before it ever
  // reaches the window-level listener InputManager/camera-cycle/menu-escape rely on
  // — otherwise typing "w" or "c" would also drive the car or cycle the camera.
  chatInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.code === "Escape") {
      closeChat();
    } else if (e.code === "Enter") {
      const raw = chatInput.value.trim();
      if (raw.length > 0) {
        const sent = game.sendChat(raw);
        if (sent) appendChatMessage("You", sent);
      }
      closeChat();
    }
  });

  const returnToMenu = async () => {
    await fadeToBlack();
    game.dispose();
    environment.reset();
    hud.classList.add("hidden");
    backButton.classList.add("hidden");
    clearChat();
    void menuScene.show();
    mapSelect.hide();
    carSelect.hide();
    entryScreen.show();
    fadeFromBlack();
  };

  const peerCountEl = document.getElementById("peerCount")!;
  game.onPeerCountChanged = (count) => {
    peerCountEl.classList.remove("hidden");
    peerCountEl.textContent = `${count} other player${count === 1 ? "" : "s"} connected`;
  };

  const SIGNALING_URL = "wss://stuntrush-signal.ss1734531235.workers.dev";

  // --- Screen flow: Entry -> Map Select -> Car Select -> (real) Loading -> Gameplay.
  // Each step reuses the sceneFade primitive between it and the next/previous one;
  // the live MenuScene turntable keeps running underneath all three menu screens. ---
  const entryScreen = new EntryScreen(
    () => {
      entryScreen.hide();
      mapSelect.show("forward");
    },
    () => {
      entryScreen.hide();
      settingsPanel.classList.remove("hidden");
    }
  );
  const mapSelect = new MapSelectScreen();
  const carSelect = new CarSelectScreen();
  carSelect.setCar(settings.carId);

  let selectedMapId: string | null = null;

  mapSelect.onNext = (mapId) => {
    selectedMapId = mapId;
    mapSelect.hide();
    carSelect.show("forward");
  };
  mapSelect.onBack = () => {
    mapSelect.hide();
    entryScreen.show();
  };
  carSelect.onBack = () => {
    carSelect.hide();
    mapSelect.show("back");
  };
  carSelect.onCarChanged = (carId) => {
    settings.carId = carId;
    saveSettings(settings);
    menuScene.setCarModel(getCarSpec(carId));
  };

  const startLoadingFlow = async (mapId: string, carId: string) => {
    await fadeToBlack();
    carSelect.hide();
    menuScene.hide();
    setLoadingProgress(0, "Loading");
    loadingScreen.classList.remove("hidden");
    fadeFromBlack();
    startTipRotation();

    if (!audio) {
      audio = new EngineAudio();
      audio.setVolumes(settings.masterVolume, settings.engineVolume);
    }
    await audio.resume();
    await audio.setProfile(getCarSpec(carId).audioProfile);
    environment.apply({ timeOfDay: settings.timeOfDay, weather: settings.weather });
    peerCountEl.classList.add("hidden");
    peerCountEl.textContent = "";

    await game.load(
      mapId,
      environment.gripMultiplier,
      settings.multiplayerEnabled ? SIGNALING_URL : null,
      carId,
      hueToHex(settings.bodyColorHue),
      settings.plateText,
      settings.nickname,
      setLoadingProgress
    );

    stopTipRotation();
    await fadeToBlack();
    loadingScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    backButton.classList.remove("hidden");
    fadeFromBlack();
  };

  const playButton = document.getElementById("playButton") as HTMLButtonElement;
  playButton.addEventListener("click", () => {
    void playUiClick();
    if (!selectedMapId) return;
    void startLoadingFlow(selectedMapId, carSelect.getSelectedCarId());
  });

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

  // --- Multiplayer nickname: free-typed, sanitized/capped before it's ever sent. ---
  const nicknameInput = document.getElementById("nicknameInput") as HTMLInputElement;
  nicknameInput.value = settings.nickname;
  nicknameInput.addEventListener("input", () => {
    settings.nickname = nicknameInput.value;
    saveSettings(settings);
  });

  setLoadingProgress(55, "Loading");
  await menuScene.show();
  entryScreen.show();
  setLoadingProgress(100, "Loading");

  document.body.classList.remove("booting");
  loadingScreen.classList.add("hidden");
  setTimeout(() => loadingScreen.remove(), 700);

  backButton.addEventListener("click", returnToMenu);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && game.isLoaded) returnToMenu();
    if (e.code === "KeyC" && game.isLoaded) game.cycleCamera();
    if (e.code === "Enter" && game.isLoaded) openChat();
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
      `${describeKeyCode(b.reset)} reset · ${describeKeyCode(b.headlights)} headlights · C camera · Enter chat`;
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

  settingsBack.addEventListener("click", () => {
    void playUiClick();
    stopListening();
    refreshBindButtons();
    settingsPanel.classList.add("hidden");
    entryScreen.show();
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
