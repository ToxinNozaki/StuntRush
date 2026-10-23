import * as BABYLON from "@babylonjs/core";
import { InputManager } from "./input";
import { VehicleController } from "./vehicle";
import { buildWorld, type BuiltWorld } from "./world";
import { MultiplayerClient } from "./multiplayer";
import { RemoteCar } from "./remoteCar";
import { getCarSpec } from "./cars";

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

  private multiplayer: MultiplayerClient | null = null;
  private readonly remoteCars = new Map<string, RemoteCar>();

  /** Fired once the car's visual model (and thus its real meshes) is ready to shadow-cast. */
  onCarVisualReady: ((meshes: BABYLON.AbstractMesh[]) => void) | null = null;
  /** Fired on any multiplayer connection-count change, for a HUD readout. */
  onPeerCountChanged: ((count: number) => void) | null = null;

  private readonly fallbackCamera: BABYLON.Camera;

  constructor(scene: BABYLON.Scene, input: InputManager, fallbackCamera: BABYLON.Camera) {
    this.scene = scene;
    this.input = input;
    this.fallbackCamera = fallbackCamera;
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

  async load(
    _mapId: string,
    gripMultiplier = 1,
    signalingUrl: string | null = null,
    carId?: string,
    bodyColorHex?: string,
    plateText?: string
  ): Promise<void> {
    if (this.isLoaded) this.dispose();

    this.world = buildWorld(this.scene);

    const spawn = new BABYLON.Vector3(0, 2, 0);
    const vehicle = new VehicleController(this.scene, this.input, spawn);
    vehicle.setGripMultiplier(gripMultiplier);
    if (carId) vehicle.setCarSpec(getCarSpec(carId));
    if (bodyColorHex) vehicle.setBodyColor(bodyColorHex);
    if (plateText) vehicle.setPlateText(plateText);
    this.vehicle = vehicle;
    void vehicle.attachVisual().then(() => this.onCarVisualReady?.(vehicle.visualMeshes));

    if (signalingUrl) this.startMultiplayer(signalingUrl);

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

      for (const remote of this.remoteCars.values()) remote.update();

      if (this.multiplayer) {
        const rotation = vehicle.chassis.rotationQuaternion ?? BABYLON.Quaternion.Identity();
        this.multiplayer.broadcastTransform({
          p: carPos.asArray() as [number, number, number],
          q: [rotation.x, rotation.y, rotation.z, rotation.w],
          speedKph: vehicle.speedKph,
          airborne: vehicle.isAirborne,
        });
      }
    });
  }

  private startMultiplayer(signalingUrl: string) {
    const client = new MultiplayerClient();
    this.multiplayer = client;

    client.onPeerTransform = (id, transform) => {
      let remote = this.remoteCars.get(id);
      if (!remote) {
        remote = new RemoteCar(this.scene, transform);
        this.remoteCars.set(id, remote);
        this.onPeerCountChanged?.(this.remoteCars.size);
      }
      remote.applyTransform(transform);
    };
    client.onPeerLeft = (id) => {
      this.remoteCars.get(id)?.dispose();
      this.remoteCars.delete(id);
      this.onPeerCountChanged?.(this.remoteCars.size);
    };

    client.connect(signalingUrl);
  }

  /** Unloads the current map: disposes world geometry, vehicle, camera, and observers. */
  dispose() {
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.vehicle?.dispose();
    this.vehicle = null;
    this.multiplayer?.dispose();
    this.multiplayer = null;
    for (const remote of this.remoteCars.values()) remote.dispose();
    this.remoteCars.clear();
    this.camera?.dispose();
    this.camera = null;
    this.scene.activeCamera = this.fallbackCamera;
    this.world?.dispose();
    this.world = null;
  }
}
