import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { applyBodyColor, applyPlateText, fixupLowAlphaMaterials, DEFAULT_MODEL_URL } from "./carModel";

/**
 * The backdrop behind the main menu: the car on a slow turntable in a dark,
 * snowing scene. Built once on first show(), then just enabled/disabled —
 * cheap to bring back each time the player returns to the menu. The model
 * itself can be swapped live (setCarModel) when the player picks a car that
 * uses a different one (see cars.ts's `modelUrl` field).
 */
export class MenuScene {
  private root: BABYLON.TransformNode | null = null;
  private snow: BABYLON.ParticleSystem | null = null;
  private rotationObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  private buildPromise: Promise<void> | null = null;
  private previewMeshes: BABYLON.AbstractMesh[] = [];
  private lastColorHex: string | null = null;
  private lastPlateText: string | null = null;
  /** The model URL currently loaded (or in flight) — guards against a stale,
   *  slower-to-resolve load clobbering a newer one if the player clicks
   *  through car choices faster than models can load. */
  private currentModelUrl: string | null = null;

  private readonly scene: BABYLON.Scene;
  private readonly camera: BABYLON.UniversalCamera;
  private readonly hemi: BABYLON.HemisphericLight;
  private readonly sun: BABYLON.DirectionalLight;

  private readonly originalHemiIntensity: number;
  private readonly originalSunIntensity: number;
  private readonly originalSunColor: BABYLON.Color3;
  private readonly originalClearColor: BABYLON.Color4;

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.UniversalCamera,
    hemi: BABYLON.HemisphericLight,
    sun: BABYLON.DirectionalLight
  ) {
    this.scene = scene;
    this.camera = camera;
    this.hemi = hemi;
    this.sun = sun;
    this.originalHemiIntensity = hemi.intensity;
    this.originalSunIntensity = sun.intensity;
    this.originalSunColor = sun.diffuse.clone();
    this.originalClearColor = scene.clearColor.clone();
  }

  async show(): Promise<void> {
    if (!this.buildPromise) this.buildPromise = this.build();
    await this.buildPromise;

    this.root!.setEnabled(true);
    if (!this.snow) this.snow = this.buildSnow();
    this.snow.start();

    // Cold, dim showroom-at-night mood — distinct from the daylight gameplay look.
    this.scene.clearColor = new BABYLON.Color4(0.04, 0.05, 0.08, 1);
    this.hemi.intensity = 0.18;
    this.sun.intensity = 0.55;
    this.sun.diffuse = new BABYLON.Color3(0.75, 0.82, 1.0);

    this.camera.position = new BABYLON.Vector3(-3.6, 1.35, -5.4);
    this.camera.setTarget(new BABYLON.Vector3(0, 0.55, 0));
    this.scene.activeCamera = this.camera;
  }

  /** Updates the turntable car's paint; safe to call before the model has loaded. */
  setBodyColor(hexColor: string) {
    this.lastColorHex = hexColor;
    if (this.previewMeshes.length > 0) applyBodyColor(this.previewMeshes, hexColor);
  }

  /** Updates the turntable car's plate; safe to call before the model has loaded. */
  setPlateText(text: string) {
    this.lastPlateText = text;
    if (this.previewMeshes.length > 0) applyPlateText(this.scene, this.previewMeshes, text);
  }

  /** Swaps the turntable car to a different model (e.g. the player picked a car with
   *  its own `modelUrl` in cars.ts). A no-op if it's already showing this model. */
  setCarModel(modelUrl: string) {
    if (modelUrl === this.currentModelUrl) return;
    if (this.buildPromise) {
      void this.buildPromise.then(() => this.loadModel(modelUrl));
    } else {
      // show() hasn't built anything yet — build() will load this URL itself.
      this.currentModelUrl = modelUrl;
    }
  }

  hide() {
    this.root?.setEnabled(false);
    // Neither stop() nor reset() actually clears already-emitted flakes (up to 11s
    // lifetime) — they'd keep drifting through the daylight gameplay scene. Disposing
    // and rebuilding fresh next show() is the only way that's actually instant.
    this.snow?.dispose();
    this.snow = null;
    this.hemi.intensity = this.originalHemiIntensity;
    this.sun.intensity = this.originalSunIntensity;
    this.sun.diffuse = this.originalSunColor;
    this.scene.clearColor = this.originalClearColor;
  }

  private async build(): Promise<void> {
    await this.loadModel(this.currentModelUrl ?? DEFAULT_MODEL_URL);

    // Reads this.root fresh every frame (rather than closing over a local variable)
    // so a later setCarModel() swap keeps rotating whatever's current.
    this.rotationObserver = this.scene.onBeforeRenderObservable.add(() => {
      // Slow, deliberate turntable — not a spin. Gives the eye time to read the car.
      if (this.root) this.root.rotation.y += this.scene.getEngine().getDeltaTime() * 0.00012;
    });

    this.snow = this.buildSnow();
  }

  /** Loads a model as the turntable preview, replacing whatever was there before. */
  private async loadModel(modelUrl: string): Promise<void> {
    this.currentModelUrl = modelUrl;
    const result = await ImportMeshAsync(modelUrl, this.scene);

    // The player picked a different car again while this one was still loading —
    // this load lost the race, so just discard it instead of flashing it on screen.
    if (this.currentModelUrl !== modelUrl) {
      for (const mesh of result.meshes) mesh.dispose();
      return;
    }

    const oldRoot = this.root;
    const root = new BABYLON.TransformNode("menuCarRoot", this.scene);
    for (const mesh of result.meshes) {
      if (mesh.parent === null) mesh.parent = root;
    }
    this.previewMeshes = result.meshes;
    fixupLowAlphaMaterials(this.previewMeshes);
    if (this.lastColorHex) applyBodyColor(this.previewMeshes, this.lastColorHex);
    if (this.lastPlateText) applyPlateText(this.scene, this.previewMeshes, this.lastPlateText);

    const bounds = root.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min);
    const scale = 4.3 / (Math.max(size.x, size.z) || 1);
    root.scaling.setAll(scale);

    const scaledBounds = root.getHierarchyBoundingVectors(true);
    const center = scaledBounds.min.add(scaledBounds.max).scale(0.5);
    root.position = new BABYLON.Vector3(-center.x, -scaledBounds.min.y, -center.z);

    this.root = root;
    oldRoot?.dispose(false, true);
  }

  private buildSnow(): BABYLON.ParticleSystem {
    const snowTexture = new BABYLON.DynamicTexture("snowflakeTex", 64, this.scene, false);
    const ctx = snowTexture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    snowTexture.update();

    const snow = new BABYLON.ParticleSystem("snow", 500, this.scene);
    snow.particleTexture = snowTexture;
    snow.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    snow.emitter = new BABYLON.Vector3(0, 6, 0);
    snow.minEmitBox = new BABYLON.Vector3(-9, 0, -9);
    snow.maxEmitBox = new BABYLON.Vector3(9, 1, 9);
    snow.direction1 = new BABYLON.Vector3(-0.3, -1, -0.1);
    snow.direction2 = new BABYLON.Vector3(0.3, -1, 0.1);
    snow.minEmitPower = 0.6;
    snow.maxEmitPower = 1.1;
    snow.minSize = 0.03;
    snow.maxSize = 0.09;
    snow.minLifeTime = 7;
    snow.maxLifeTime = 11;
    snow.emitRate = 60;
    snow.color1 = new BABYLON.Color4(1, 1, 1, 0.85);
    snow.color2 = new BABYLON.Color4(1, 1, 1, 0.5);
    snow.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    snow.gravity = new BABYLON.Vector3(0, -0.05, 0);
    snow.disposeOnStop = false;
    return snow;
  }

  dispose() {
    if (this.rotationObserver) this.scene.onBeforeRenderObservable.remove(this.rotationObserver);
    this.snow?.dispose();
    this.root?.dispose(false, true);
  }
}
