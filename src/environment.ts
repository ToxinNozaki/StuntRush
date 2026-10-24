import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

const PLANE_MODEL_URL = `${import.meta.env.BASE_URL}models/plane.glb`;

export type TimeOfDay = "day" | "night";
export type Weather = "clear" | "cloudy" | "snow";

export interface EnvironmentOptions {
  timeOfDay: TimeOfDay;
  weather: Weather;
}

const DAY_SKY = new BABYLON.Color4(0.55, 0.65, 0.75, 1);
const NIGHT_SKY = new BABYLON.Color4(0.025, 0.035, 0.07, 1);

/**
 * Sky, clouds, day/night lighting and precipitation for actual gameplay (separate
 * from the menu's own snow/lighting in menuScene.ts). Deliberately cheap: one
 * static cloud texture that scrolls instead of volumetric clouds, CPU particle
 * systems instead of anything shader-heavy, and weather/time only change a few
 * material and light properties rather than swapping geometry.
 */
export class EnvironmentController {
  private readonly cloudLayer: BABYLON.Mesh;
  private readonly cloudMaterial: BABYLON.StandardMaterial;
  private stars: BABYLON.ParticleSystem | null = null;
  private snow: BABYLON.ParticleSystem | null = null;
  private cloudScrollObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

  private readonly scene: BABYLON.Scene;
  private readonly hemi: BABYLON.HemisphericLight;
  private readonly sun: BABYLON.DirectionalLight;

  private readonly baseHemiIntensity: number;
  private readonly baseSunIntensity: number;
  private readonly baseSunDiffuse: BABYLON.Color3;

  /** Multiplies tire grip — weather's one real gameplay effect, not just visual. */
  gripMultiplier = 1;

  // Distant background planes — purely atmospheric (no collision, no gameplay
  // effect), one in flight at a time, respawning on a random delay. Uses a real
  // low-poly 737 model (public/models/plane.glb, from the asset dump) loaded once
  // and cloned per flight — cheaper than re-importing the glb every 15-45 seconds.
  private planeActive = false;
  private planeTemplate: BABYLON.TransformNode | null = null;
  private planeTemplateLoadPromise: Promise<BABYLON.TransformNode> | null = null;
  private planeSpawning = false;
  private planeRoot: BABYLON.TransformNode | null = null;
  private planeProgress = 0;
  private planeDurationSec = 1;
  private planeStart = BABYLON.Vector3.Zero();
  private planeEnd = BABYLON.Vector3.Zero();
  private planeWaitSec = 0;
  private planeUpdateObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

  constructor(scene: BABYLON.Scene, hemi: BABYLON.HemisphericLight, sun: BABYLON.DirectionalLight) {
    this.scene = scene;
    this.hemi = hemi;
    this.sun = sun;
    this.baseHemiIntensity = hemi.intensity;
    this.baseSunIntensity = sun.intensity;
    this.baseSunDiffuse = sun.diffuse.clone();

    this.cloudMaterial = new BABYLON.StandardMaterial("cloudMat", scene);
    this.cloudMaterial.diffuseTexture = this.buildCloudTexture();
    this.cloudMaterial.diffuseTexture.hasAlpha = true;
    this.cloudMaterial.useAlphaFromDiffuseTexture = true;
    this.cloudMaterial.disableLighting = true;
    this.cloudMaterial.backFaceCulling = false;
    (this.cloudMaterial.diffuseTexture as BABYLON.Texture).uScale = 4;
    (this.cloudMaterial.diffuseTexture as BABYLON.Texture).vScale = 4;

    this.cloudLayer = BABYLON.MeshBuilder.CreatePlane("cloudLayer", { size: 1400 }, scene);
    this.cloudLayer.rotation.x = Math.PI / 2;
    this.cloudLayer.position.y = 180;
    this.cloudLayer.material = this.cloudMaterial;
    this.cloudLayer.isPickable = false;
    this.cloudLayer.receiveShadows = false;
    // Built eagerly but not yet styled by apply() — stays hidden until gameplay
    // actually starts, otherwise it renders with default (unstyled) material over
    // the main menu, which shows up as a dark band across the top of the screen.
    this.cloudLayer.setEnabled(false);

    this.cloudScrollObserver = scene.onBeforeRenderObservable.add(() => {
      const tex = this.cloudMaterial.diffuseTexture as BABYLON.Texture;
      tex.uOffset += this.scene.getEngine().getDeltaTime() * 0.000008;
      tex.vOffset += this.scene.getEngine().getDeltaTime() * 0.000004;
    });

    this.planeWaitSec = 8 + Math.random() * 20;
    this.planeUpdateObserver = scene.onBeforeRenderObservable.add(() => this.updatePlane());
  }

  /** Keeps the snow emission box centered on the car — the box is small on purpose
   *  (the camera only ever sees ~15-20 units around the car), so it has to move. */
  followPosition(position: BABYLON.Vector3) {
    if (!this.snow) return;
    this.snow.emitter = new BABYLON.Vector3(position.x, position.y + 8, position.z);
  }

  apply(options: EnvironmentOptions) {
    this.cloudLayer.setEnabled(true);
    this.planeActive = true;
    const isNight = options.timeOfDay === "night";

    this.scene.clearColor = isNight ? NIGHT_SKY : DAY_SKY;
    this.hemi.intensity = this.baseHemiIntensity * (isNight ? 0.25 : 1);
    this.sun.intensity = this.baseSunIntensity * (isNight ? 0.35 : 1);
    this.sun.diffuse = isNight ? new BABYLON.Color3(0.55, 0.62, 0.85) : this.baseSunDiffuse;

    switch (options.weather) {
      case "clear":
        this.cloudMaterial.alpha = 0.22;
        this.gripMultiplier = 1;
        break;
      case "cloudy":
        this.cloudMaterial.alpha = 0.75;
        this.gripMultiplier = 0.95;
        break;
      case "snow":
        this.cloudMaterial.alpha = 0.85;
        this.gripMultiplier = 0.6;
        break;
    }
    this.cloudMaterial.emissiveColor = isNight
      ? new BABYLON.Color3(0.22, 0.25, 0.32)
      : new BABYLON.Color3(1, 1, 1);

    this.setStarsEnabled(isNight && options.weather === "clear");
    this.setSnowEnabled(options.weather === "snow");
  }

  private setStarsEnabled(enabled: boolean) {
    if (enabled && !this.stars) this.stars = this.buildStars();
    if (!enabled && this.stars) {
      this.stars.dispose();
      this.stars = null;
    } else if (enabled) {
      this.stars!.start();
    }
  }

  private setSnowEnabled(enabled: boolean) {
    if (enabled && !this.snow) this.snow = this.buildSnow();
    if (!enabled && this.snow) {
      this.snow.dispose();
      this.snow = null;
    } else if (enabled) {
      this.snow!.start();
    }
  }

  private buildCloudTexture(): BABYLON.DynamicTexture {
    const size = 256;
    const texture = new BABYLON.DynamicTexture("cloudTex", size, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, size, size);
    // A handful of soft overlapping blobs, each drawn again offset by the full
    // size so the edges wrap — cheap, good-enough tiling without a seam-aware tool.
    const blobCount = 18;
    for (let i = 0; i < blobCount; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 24 + Math.random() * 50;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          gradient.addColorStop(0, "rgba(255,255,255,0.8)");
          gradient.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gradient;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
      }
    }
    texture.update();
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  private buildStars(): BABYLON.ParticleSystem {
    const starTexture = new BABYLON.DynamicTexture("starTex", 16, this.scene, false);
    const ctx = starTexture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    starTexture.update();

    const stars = new BABYLON.ParticleSystem("stars", 300, this.scene);
    stars.particleTexture = starTexture;
    stars.emitter = new BABYLON.Vector3(0, 120, 0);
    stars.minEmitBox = new BABYLON.Vector3(-300, -40, -300);
    stars.maxEmitBox = new BABYLON.Vector3(300, 40, 300);
    stars.direction1 = BABYLON.Vector3.Zero();
    stars.direction2 = BABYLON.Vector3.Zero();
    stars.minEmitPower = 0;
    stars.maxEmitPower = 0;
    stars.minSize = 0.6;
    stars.maxSize = 1.8;
    stars.minLifeTime = 9999;
    stars.maxLifeTime = 9999;
    stars.emitRate = 1200; // fires once effectively — enough to fully populate fast, then holds
    stars.manualEmitCount = 300;
    stars.color1 = new BABYLON.Color4(1, 1, 1, 0.9);
    stars.color2 = new BABYLON.Color4(0.8, 0.85, 1, 0.6);
    stars.gravity = BABYLON.Vector3.Zero();
    stars.start();
    return stars;
  }

  private buildSnow(): BABYLON.ParticleSystem {
    const snowTexture = new BABYLON.DynamicTexture("gameSnowTex", 64, this.scene, false);
    const ctx = snowTexture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    snowTexture.update();

    const snow = new BABYLON.ParticleSystem("gameSnow", 500, this.scene);
    snow.particleTexture = snowTexture;
    snow.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    // Small box around the emitter (followPosition() recenters it on the car every
    // frame) rather than one spanning the whole track — the camera only ever sees
    // a small radius around the car, so a track-wide box mostly falls off-screen.
    snow.emitter = new BABYLON.Vector3(0, 8, 0);
    snow.minEmitBox = new BABYLON.Vector3(-18, 0, -18);
    snow.maxEmitBox = new BABYLON.Vector3(18, 2, 18);
    snow.direction1 = new BABYLON.Vector3(-0.4, -1, -0.2);
    snow.direction2 = new BABYLON.Vector3(0.4, -1, 0.2);
    snow.minEmitPower = 2.4;
    snow.maxEmitPower = 3.2;
    snow.minSize = 0.12;
    snow.maxSize = 0.3;
    // Fall speed x lifetime covers the full emit height (~8 units) well before
    // death, so flakes spend most of their life low near the car/ground — not
    // lingering high up where they're indistinguishable from the star layer.
    snow.minLifeTime = 2.5;
    snow.maxLifeTime = 3.5;
    snow.emitRate = 120;
    snow.color1 = new BABYLON.Color4(1, 1, 1, 0.85);
    snow.color2 = new BABYLON.Color4(1, 1, 1, 0.5);
    snow.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    snow.gravity = new BABYLON.Vector3(0, -0.1, 0);
    snow.start();
    return snow;
  }

  /** Called when leaving gameplay (back to menu) — restores base lighting, clears weather. */
  reset() {
    this.hemi.intensity = this.baseHemiIntensity;
    this.sun.intensity = this.baseSunIntensity;
    this.sun.diffuse = this.baseSunDiffuse;
    this.cloudLayer.setEnabled(false);
    this.setStarsEnabled(false);
    this.setSnowEnabled(false);
    this.planeActive = false;
    this.planeRoot?.dispose(false, true);
    this.planeRoot = null;
  }

  /** One plane in flight at a time, high above the cloud layer, dead straight, slow
   *  enough that it reads as "distant" rather than "buzzing the track". */
  private updatePlane() {
    if (!this.planeActive) return;
    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    if (!this.planeRoot) {
      if (this.planeSpawning) return; // template load already in flight
      this.planeWaitSec -= dt;
      if (this.planeWaitSec <= 0) {
        this.planeSpawning = true;
        void this.spawnPlane();
      }
      return;
    }

    this.planeProgress += dt / this.planeDurationSec;
    if (this.planeProgress >= 1) {
      this.planeRoot.dispose(false, true);
      this.planeRoot = null;
      this.planeWaitSec = 15 + Math.random() * 25;
      return;
    }
    this.planeRoot.position = BABYLON.Vector3.Lerp(this.planeStart, this.planeEnd, this.planeProgress);
  }

  /** Loads the plane model once and caches it, disabled, purely as a template to
   *  clone — repeated flights just clone + dispose, never re-import the glb. */
  private loadPlaneTemplate(): Promise<BABYLON.TransformNode> {
    if (this.planeTemplate) return Promise.resolve(this.planeTemplate);
    if (!this.planeTemplateLoadPromise) {
      this.planeTemplateLoadPromise = (async () => {
        const result = await ImportMeshAsync(PLANE_MODEL_URL, this.scene);
        const root = new BABYLON.TransformNode("planeTemplate", this.scene);
        for (const mesh of result.meshes) {
          if (mesh.parent === null) mesh.parent = root;
        }
        const bounds = root.getHierarchyBoundingVectors(true);
        const size = bounds.max.subtract(bounds.min);
        // ~16 units nose-to-tail — small enough to read as "distant" at the
        // altitude it flies, big enough to still be a recognizable silhouette.
        const scale = 16 / (Math.max(size.x, size.z) || 1);
        root.scaling.setAll(scale);
        root.setEnabled(false); // the template itself never renders directly
        for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
        this.planeTemplate = root;
        return root;
      })();
    }
    return this.planeTemplateLoadPromise;
  }

  private async spawnPlane() {
    const template = await this.loadPlaneTemplate();
    this.planeSpawning = false;
    if (!this.planeActive) return; // left gameplay while the model was loading

    const altitude = 230 + Math.random() * 50; // comfortably above the cloud layer (y=180)
    const span = 320;
    const z = (Math.random() * 2 - 1) * 180;
    const leftToRight = Math.random() < 0.5;
    this.planeStart = new BABYLON.Vector3(leftToRight ? -span : span, altitude, z);
    this.planeEnd = new BABYLON.Vector3(
      leftToRight ? span : -span,
      altitude,
      z + (Math.random() * 2 - 1) * 60
    );
    this.planeDurationSec = 40 + Math.random() * 20;
    this.planeProgress = 0;

    const root = template.clone("plane", null) as BABYLON.TransformNode;
    root.setEnabled(true);
    root.position.copyFrom(this.planeStart);
    const forward = this.planeEnd.subtract(this.planeStart).normalize();
    root.rotation.y = Math.atan2(forward.x, forward.z);
    this.planeRoot = root;
  }

  dispose() {
    if (this.cloudScrollObserver) this.scene.onBeforeRenderObservable.remove(this.cloudScrollObserver);
    if (this.planeUpdateObserver) this.scene.onBeforeRenderObservable.remove(this.planeUpdateObserver);
    this.planeRoot?.dispose(false, true);
    this.planeTemplate?.dispose(false, true);
    this.stars?.dispose();
    this.snow?.dispose();
    this.cloudLayer.dispose();
    this.cloudMaterial.dispose();
  }
}
