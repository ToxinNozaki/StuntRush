import * as BABYLON from "@babylonjs/core";
import { InputManager } from "./input";
import { VehicleController } from "./vehicle";
import { buildWorld, type BuiltWorld } from "./world";

/**
 * Owns everything that exists only while a map is being played: the world
 * geometry, the vehicle, the chase camera, and the HUD updates. load()/dispose()
 * are the only entry points — nothing here should outlive a single play session.
 */
export class Game {
  private readonly scene: BABYLON.Scene;
  private readonly input: InputManager;

  private world: BuiltWorld | null = null;
  private vehicle: VehicleController | null = null;
  private camera: BABYLON.UniversalCamera | null = null;
  private renderObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

  /** Fired once the car's visual model (and thus its real meshes) is ready to shadow-cast. */
  onCarVisualReady: ((meshes: BABYLON.AbstractMesh[]) => void) | null = null;

  constructor(
    scene: BABYLON.Scene,
    input: InputManager,
    private readonly fallbackCamera: BABYLON.Camera
  ) {
    this.scene = scene;
    this.input = input;
  }

  get isLoaded(): boolean {
    return this.vehicle !== null;
  }

  get vehicleSpeedKph(): number {
    return this.vehicle?.speedKph ?? 0;
  }

  get vehicleThrottle(): number {
    return this.vehicle ? this.input.throttle : 0;
  }

  get vehicleTelemetry(): { speedKph: number; isAirborne: boolean; position: BABYLON.Vector3 } | null {
    if (!this.vehicle) return null;
    return {
      speedKph: this.vehicle.speedKph,
      isAirborne: this.vehicle.isAirborne,
      position: this.vehicle.chassis.getAbsolutePosition(),
    };
  }

  async load(_mapId: string, gripMultiplier = 1): Promise<void> {
    if (this.isLoaded) this.dispose();

    this.world = buildWorld(this.scene);

    const spawn = new BABYLON.Vector3(0, 2, 0);
    const vehicle = new VehicleController(this.scene, this.input, spawn);
    vehicle.setGripMultiplier(gripMultiplier);
    this.vehicle = vehicle;
    void vehicle.attachVisual().then(() => this.onCarVisualReady?.(vehicle.visualMeshes));

    const camera = new BABYLON.UniversalCamera("chaseCam", new BABYLON.Vector3(0, 4, -8), this.scene);
    camera.minZ = 0.1;
    camera.upVector = BABYLON.Vector3.Up();
    this.scene.activeCamera = camera;
    this.camera = camera;

    const baseFov = 0.8;
    const chaseHeight = 2.4;
    const chaseDistance = 9;
    let smoothedCamPos = camera.position.clone();

    const speedEl = document.getElementById("speed");

    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      // Chase camera tracks the car's heading (yaw) only — never its pitch/roll.
      // Rigidly following the full chassis orientation would spin the whole screen
      // with every air-control flip, which is unplayable, not cinematic.
      const carPos = vehicle.chassis.getAbsolutePosition();
      const rawForward = BABYLON.Vector3.TransformNormal(
        BABYLON.Vector3.Forward(),
        vehicle.chassis.getWorldMatrix()
      );
      const flatForward = new BABYLON.Vector3(rawForward.x, 0, rawForward.z);
      if (flatForward.lengthSquared() < 1e-6) flatForward.copyFrom(BABYLON.Vector3.Forward());
      flatForward.normalize();

      const desiredPos = carPos
        .subtract(flatForward.scale(chaseDistance))
        .add(new BABYLON.Vector3(0, chaseHeight, 0));
      smoothedCamPos = BABYLON.Vector3.Lerp(smoothedCamPos, desiredPos, 0.08);
      camera.position.copyFrom(smoothedCamPos);
      camera.setTarget(carPos.add(new BABYLON.Vector3(0, 0.8, 0)));

      const speedFrac = BABYLON.Scalar.Clamp(vehicle.speedKph / 160, 0, 1);
      camera.fov = baseFov + speedFrac * 0.25;

      if (speedEl) {
        speedEl.textContent = `${Math.round(vehicle.speedKph * 0.621)} mph${
          vehicle.isAirborne ? "  •  airborne" : ""
        }`;
      }
    });
  }

  /** Unloads the current map: disposes world geometry, vehicle, camera, and observers. */
  dispose() {
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.vehicle?.dispose();
    this.vehicle = null;
    this.camera?.dispose();
    this.camera = null;
    this.scene.activeCamera = this.fallbackCamera;
    this.world?.dispose();
    this.world = null;
  }
}
