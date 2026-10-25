import * as BABYLON from "@babylonjs/core";
import { InputManager } from "./input";
import { VehicleController } from "./vehicle";
import { buildWorld, type BuiltWorld } from "./world";
import { buildCityWorld, CITY_SPAWN } from "./cityWorld";
import { MultiplayerClient } from "./multiplayer";
import { RemoteCar } from "./remoteCar";
import { getCarSpec } from "./cars";
import { sanitizeChatText, sanitizeNickname } from "./chat";
import { TrafficController } from "./traffic";

export type CameraMode = "chase" | "cockpit" | "cinematic";
const CAMERA_MODE_ORDER: CameraMode[] = ["chase", "cockpit", "cinematic"];
const DEFAULT_NICKNAME_FALLBACK = "Player";

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
  private traffic: TrafficController | null = null;
  private camera: BABYLON.UniversalCamera | null = null;
  private renderObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

  private multiplayer: MultiplayerClient | null = null;
  private readonly remoteCars = new Map<string, RemoteCar>();
  private readonly peerNicknames = new Map<string, string>();
  private localNickname = DEFAULT_NICKNAME_FALLBACK;

  /** Fired once the car's visual model (and thus its real meshes) is ready to shadow-cast. */
  onCarVisualReady: ((meshes: BABYLON.AbstractMesh[]) => void) | null = null;
  /** Fired on any multiplayer connection-count change, for a HUD readout. */
  onPeerCountChanged: ((count: number) => void) | null = null;
  /** Fired whenever the camera mode changes (cycleCamera or a fresh load), for a HUD readout. */
  onCameraModeChanged: ((mode: CameraMode) => void) | null = null;
  /** Fired on every incoming chat message, already sanitized and labeled with the
   *  sender's current nickname (or the "Player" fallback if they haven't sent one). */
  onChatMessage: ((label: string, text: string) => void) | null = null;

  private cameraMode: CameraMode = "chase";

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
    mapId: string,
    gripMultiplier = 1,
    signalingUrl: string | null = null,
    carId?: string,
    bodyColorHex?: string,
    plateText?: string,
    nickname?: string,
    onProgress?: (pct: number, label: string) => void
  ): Promise<void> {
    if (this.isLoaded) this.dispose();
    const report = (pct: number, label: string) => onProgress?.(pct, label);

    this.cameraMode = "chase";
    this.localNickname = sanitizeNickname(nickname ?? "") || DEFAULT_NICKNAME_FALLBACK;
    this.peerNicknames.clear();
    report(5, "Preparing track");
    const isCity = mapId === "city";
    this.world = isCity ? buildCityWorld(this.scene) : buildWorld(this.scene);

    // The city's traffic-free grid and the test track's hardcoded loop waypoints
    // don't share coordinates — TrafficController's patrol route is tuned
    // specifically for the test track (see traffic.ts), so it only spawns there
    // for now. A city-aware patrol route (following the road grid) is a
    // reasonable follow-up, not attempted in this map's first pass.
    const spawn = isCity ? CITY_SPAWN : new BABYLON.Vector3(0, 2, 0);
    const vehicle = new VehicleController(this.scene, this.input, spawn);
    vehicle.setGripMultiplier(gripMultiplier);
    if (carId) vehicle.setCarSpec(getCarSpec(carId));
    if (bodyColorHex) vehicle.setBodyColor(bodyColorHex);
    if (plateText) vehicle.setPlateText(plateText);
    this.vehicle = vehicle;
    report(30, "Loading vehicle");
    await vehicle.attachVisual();
    this.onCarVisualReady?.(vehicle.visualMeshes);

    if (!isCity) {
      report(70, "Spawning traffic");
      this.traffic = new TrafficController(this.scene);
      await this.traffic.spawn();
    }

    report(90, "Finalizing");
    if (signalingUrl) this.startMultiplayer(signalingUrl);

    const camera = new BABYLON.UniversalCamera("chaseCam", new BABYLON.Vector3(0, 4, -8), this.scene);
    camera.minZ = 0.05;
    camera.upVector = BABYLON.Vector3.Up();
    this.scene.activeCamera = camera;
    this.camera = camera;
    this.onCameraModeChanged?.(this.cameraMode);

    // Per-mode framing. "chase" tracks heading only (never pitch/roll — rigidly
    // following the full chassis orientation would spin the whole screen on every
    // air-control flip). "cinematic" is the same idea, wider and slower, for a
    // dramatic trailing shot. "cockpit" is handled separately below: it tracks the
    // chassis's full orientation directly, since that's the point of a cockpit view.
    const framing: Record<"chase" | "cinematic", { fov: number; height: number; distance: number; lerp: number }> = {
      chase: { fov: 0.8, height: 2.4, distance: 9, lerp: 0.08 },
      cinematic: { fov: 0.95, height: 1.2, distance: 14, lerp: 0.035 },
    };
    let smoothedCamPos = camera.position.clone();

    const speedEl = document.getElementById("speed");

    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      const carPos = vehicle.chassis.getAbsolutePosition();

      if (this.cameraMode === "cockpit") {
        // Full chassis rotation on purpose — a cockpit view is supposed to roll and
        // pitch with the car, flips included. No smoothing: it's rigidly mounted.
        const worldMatrix = vehicle.chassis.getWorldMatrix();
        const eyeLocal = new BABYLON.Vector3(-0.35, 0.45, -0.25);
        camera.position = BABYLON.Vector3.TransformCoordinates(eyeLocal, worldMatrix);
        camera.rotationQuaternion = (
          vehicle.chassis.rotationQuaternion ?? BABYLON.Quaternion.Identity()
        ).clone();
        camera.fov = 0.9;
      } else {
        const { fov, height, distance, lerp } = framing[this.cameraMode];
        const rawForward = BABYLON.Vector3.TransformNormal(
          BABYLON.Vector3.Forward(),
          vehicle.chassis.getWorldMatrix()
        );
        const flatForward = new BABYLON.Vector3(rawForward.x, 0, rawForward.z);
        if (flatForward.lengthSquared() < 1e-6) flatForward.copyFrom(BABYLON.Vector3.Forward());
        flatForward.normalize();

        const desiredPos = carPos
          .subtract(flatForward.scale(distance))
          .add(new BABYLON.Vector3(0, height, 0));
        smoothedCamPos = BABYLON.Vector3.Lerp(smoothedCamPos, desiredPos, lerp);
        camera.position.copyFrom(smoothedCamPos);
        camera.rotationQuaternion = null;
        camera.setTarget(carPos.add(new BABYLON.Vector3(0, 0.8, 0)));

        const speedFrac = BABYLON.Scalar.Clamp(vehicle.speedKph / 160, 0, 1);
        camera.fov = fov + speedFrac * 0.25;
      }

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
          nickname: this.localNickname,
        });
      }
    });
    report(100, "Ready");
  }

  get cameraModeValue(): CameraMode {
    return this.cameraMode;
  }

  /** Cycles chase → cockpit → cinematic → chase. No-op until a map is loaded. */
  cycleCamera() {
    if (!this.isLoaded) return;
    const next = CAMERA_MODE_ORDER[(CAMERA_MODE_ORDER.indexOf(this.cameraMode) + 1) % CAMERA_MODE_ORDER.length];
    this.cameraMode = next;
    this.onCameraModeChanged?.(next);
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
      if (transform.nickname) this.peerNicknames.set(id, sanitizeNickname(transform.nickname));
    };
    client.onPeerLeft = (id) => {
      this.remoteCars.get(id)?.dispose();
      this.remoteCars.delete(id);
      this.peerNicknames.delete(id);
      this.onPeerCountChanged?.(this.remoteCars.size);
    };
    client.onChatMessage = (id, rawText) => {
      const label = this.peerNicknames.get(id) || DEFAULT_NICKNAME_FALLBACK;
      const safeText = sanitizeChatText(rawText);
      if (safeText) this.onChatMessage?.(label, safeText);
    };

    client.connect(signalingUrl);
  }

  /** Sanitizes, broadcasts to every connected peer, and returns the sanitized text
   *  so the caller can echo exactly what was actually sent (masking included). */
  sendChat(text: string): string {
    const safeText = sanitizeChatText(text);
    if (safeText) this.multiplayer?.sendChat(safeText);
    return safeText;
  }

  /** Unloads the current map: disposes world geometry, vehicle, camera, and observers. */
  dispose() {
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.vehicle?.dispose();
    this.vehicle = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.multiplayer?.dispose();
    this.multiplayer = null;
    for (const remote of this.remoteCars.values()) remote.dispose();
    this.remoteCars.clear();
    this.peerNicknames.clear();
    this.camera?.dispose();
    this.camera = null;
    this.scene.activeCamera = this.fallbackCamera;
    this.world?.dispose();
    this.world = null;
  }
}
