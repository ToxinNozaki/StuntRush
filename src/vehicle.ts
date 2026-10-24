import * as BABYLON from "@babylonjs/core";
import { InputManager } from "./input";
import { attachCarVisual, type CarVisual } from "./carModel";
import type { CarSpec } from "./cars";

interface WheelSpec {
  /** Position relative to the chassis center, in local space. */
  local: BABYLON.Vector3;
}

/**
 * Arcade raycast-suspension vehicle. Four downward raycasts stand in for wheels;
 * tuned deliberately loose (soft suspension, generous grip, forgiving collisions)
 * to match MSC2's forgiving feel rather than a simulation-accurate car.
 */
export class VehicleController {
  readonly chassis: BABYLON.Mesh;
  readonly body: BABYLON.PhysicsBody;

  private readonly aggregate: BABYLON.PhysicsAggregate;
  private readonly scene: BABYLON.Scene;
  private readonly input: InputManager;
  private readonly wheels: WheelSpec[];

  // Suspension tuning.
  private readonly restLength = 0.55;
  private readonly wheelRadius = 0.35;
  private readonly springStiffness = 55000;
  private readonly springDamping = 4500;

  // Drive tuning. Nudged toward GTA V's arcade handling character (direct, punchy,
  // glued cornering grip) rather than a simulation feel. GTA V's own handling.meta
  // numbers live packed inside .rpf archives we can't read without OpenIV or similar,
  // so these are hand-tuned to the *behavior* GTA V is known for, not copied values.
  private readonly engineForce = 17500;
  private readonly reverseForce = 8000;
  private readonly maxSteerTorque = 11000;
  private readonly lateralGripFactor = 1100;

  /** Driving off the world's edge or through a gap resets the car instead of free-falling forever. */
  private readonly killPlaneY = -25;

  // Air control tuning — the GTA V-style fix for MSC2's "frozen in the air" problem.
  // Blended toward a target angular velocity each frame rather than raw torque,
  // so rotation feels controlled, never a wild spin.
  private readonly airRotationRate = 2.6; // rad/s at full input
  private readonly airBlend = 0.15;
  private readonly mouseYawSensitivity = 0.0025;

  /** Set by weather (snow, rain, etc.) — 1 = normal, lower = slicker surface. */
  private gripMultiplier = 1;

  /** Set by the selected car's stats (see cars.ts) — stacks with weather's gripMultiplier. */
  private enginePowerMultiplier = 1;
  private carGripMultiplier = 1;
  /** Set independently by the paint color slider — a performance pick never locks in a color. */
  private bodyColorHex: string | null = null;
  private plateText: string | null = null;
  private modelUrl: string | undefined = undefined;

  private groundedWheelCount = 0;
  private spawnPosition: BABYLON.Vector3;
  private spawnRotation: BABYLON.Quaternion;
  private readonly physicsObserver: BABYLON.Observer<BABYLON.Scene>;
  private visualRoot: BABYLON.TransformNode | null = null;
  private carVisual: CarVisual | null = null;
  private headlightsOn = true;

  constructor(scene: BABYLON.Scene, input: InputManager, spawn: BABYLON.Vector3) {
    this.scene = scene;
    this.input = input;
    this.spawnPosition = spawn.clone();
    this.spawnRotation = BABYLON.Quaternion.Identity();

    this.chassis = BABYLON.MeshBuilder.CreateBox(
      "chassis",
      { width: 1.9, height: 0.55, depth: 4.2 },
      scene
    );
    this.chassis.position = spawn.clone();
    this.chassis.rotationQuaternion = BABYLON.Quaternion.Identity();
    // Plain placeholder material/visibility until the real car model attaches;
    // attachVisual() hides this box permanently once the model is in place.
    const mat = new BABYLON.StandardMaterial("chassisMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.78, 0.1, 0.12);
    this.chassis.material = mat;

    // Friction is 0 deliberately: all ground interaction (grip, braking, drive force)
    // comes from the raycast "wheels" below. If the chassis box itself has friction,
    // it fights the suspension the instant it gets close to the ground, which saps
    // acceleration and makes the car feel like it's driving through mud.
    const aggregate = new BABYLON.PhysicsAggregate(
      this.chassis,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 1250, friction: 0, restitution: 0.05 },
      scene
    );
    this.aggregate = aggregate;
    this.body = aggregate.body;
    this.body.setLinearDamping(0.1);
    this.body.setAngularDamping(0.6);
    // A slightly lowered center of mass keeps the forgiving suspension/collision
    // response stable instead of tipping over on glancing hits.
    this.body.setMassProperties({
      centerOfMass: new BABYLON.Vector3(0, -0.35, 0),
    });

    const hx = 0.85;
    const hz = 1.7;
    this.wheels = [
      { local: new BABYLON.Vector3(-hx, -0.1, hz) }, // front-left
      { local: new BABYLON.Vector3(hx, -0.1, hz) }, // front-right
      { local: new BABYLON.Vector3(-hx, -0.1, -hz) }, // rear-left
      { local: new BABYLON.Vector3(hx, -0.1, -hz) }, // rear-right
    ];

    this.physicsObserver = scene.onBeforePhysicsObservable.add(() => this.update())!;
  }

  /** Swaps in the real car mesh over the placeholder box. Fire-and-forget from the caller. */
  async attachVisual(): Promise<void> {
    const visual = await attachCarVisual(
      this.scene,
      this.chassis,
      4.3,
      0.32,
      this.bodyColorHex ?? undefined,
      this.plateText ?? undefined,
      this.modelUrl
    );
    this.visualRoot = visual.root;
    this.carVisual = visual;
    for (const light of visual.headlightLights) light.setEnabled(this.headlightsOn);
    for (const lens of visual.headlightLensMeshes) lens.setEnabled(this.headlightsOn);
  }

  /** Call before attachVisual() so the performance stats (and the model, if this
   *  car overrides it) are active from the first frame. */
  setCarSpec(spec: CarSpec) {
    this.enginePowerMultiplier = spec.enginePowerMultiplier;
    this.carGripMultiplier = spec.gripMultiplier;
    this.modelUrl = spec.modelUrl;
  }

  /** Call before attachVisual() so the paint color is baked into the import. */
  setBodyColor(hex: string) {
    this.bodyColorHex = hex;
  }

  /** Call before attachVisual() so the plate text is baked into the import. */
  setPlateText(text: string) {
    this.plateText = text;
  }

  toggleHeadlights() {
    this.headlightsOn = !this.headlightsOn;
    this.carVisual?.headlightLights.forEach((l) => l.setEnabled(this.headlightsOn));
    this.carVisual?.headlightLensMeshes.forEach((m) => m.setEnabled(this.headlightsOn));
  }

  setGripMultiplier(multiplier: number) {
    this.gripMultiplier = multiplier;
  }

  setSpawn(position: BABYLON.Vector3, rotation: BABYLON.Quaternion) {
    this.spawnPosition = position.clone();
    this.spawnRotation = rotation.clone();
  }

  /** Tears down everything this controller created: body, meshes, imported model, observer. */
  dispose() {
    this.scene.onBeforePhysicsObservable.remove(this.physicsObserver);
    this.carVisual?.headlightLights.forEach((l) => l.dispose());
    this.carVisual?.headlightMaterial.dispose();
    this.carVisual?.taillightMaterial.dispose();
    this.visualRoot?.dispose(false, true);
    this.aggregate.dispose();
    this.chassis.dispose();
  }

  get speedKph(): number {
    return this.body.getLinearVelocity().length() * 3.6;
  }

  get isAirborne(): boolean {
    return this.groundedWheelCount === 0;
  }

  /** The imported car's meshes, once attachVisual() has resolved. Used as shadow casters. */
  get visualMeshes(): BABYLON.AbstractMesh[] {
    return this.carVisual?.allMeshes ?? [];
  }

  private resetToSpawn() {
    this.body.setLinearVelocity(BABYLON.Vector3.Zero());
    this.body.setAngularVelocity(BABYLON.Vector3.Zero());
    this.chassis.position = this.spawnPosition.clone();
    this.chassis.rotationQuaternion = this.spawnRotation.clone();
  }

  /** v = linearVelocity + angularVelocity x (point - centerOfMass), all in world space. */
  private velocityAtWorldPoint(point: BABYLON.Vector3): BABYLON.Vector3 {
    const linear = this.body.getLinearVelocity();
    const angular = this.body.getAngularVelocity();
    const centerOfMass = this.chassis.getAbsolutePosition();
    const r = point.subtract(centerOfMass);
    return linear.add(BABYLON.Vector3.Cross(angular, r));
  }

  private update() {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    if (dt <= 0) return;

    if (this.input.resetPressed || this.chassis.position.y < this.killPlaneY) {
      this.resetToSpawn();
      return;
    }

    if (this.input.headlightsPressed) {
      this.toggleHeadlights();
    }

    const worldMatrix = this.chassis.getWorldMatrix();
    const up = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), worldMatrix).normalize();
    const forward = BABYLON.Vector3.TransformNormal(
      BABYLON.Vector3.Forward(),
      worldMatrix
    ).normalize();
    const right = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Right(), worldMatrix).normalize();

    this.groundedWheelCount = 0;
    const physicsEngine = this.scene.getPhysicsEngine()!;
    const castLength = this.restLength + this.wheelRadius;

    for (const wheel of this.wheels) {
      const worldPos = BABYLON.Vector3.TransformCoordinates(wheel.local, worldMatrix);
      const from = worldPos.add(up.scale(0.05));
      const to = worldPos.subtract(up.scale(castLength));

      const rayResult = physicsEngine.raycast(from, to);

      if (rayResult.hasHit) {
        this.groundedWheelCount++;
        const hitDistance = BABYLON.Vector3.Distance(from, rayResult.hitPointWorld) - 0.05;
        const compression = BABYLON.Scalar.Clamp(castLength - hitDistance, 0, castLength);

        const velAlongUp = BABYLON.Vector3.Dot(this.velocityAtWorldPoint(worldPos), up);
        const springForce = compression * this.springStiffness;
        const damperForce = -velAlongUp * this.springDamping;
        const suspensionForce = up.scale(Math.max(0, springForce + damperForce));
        this.body.applyForce(suspensionForce, worldPos);
      }
    }

    const grounded = this.groundedWheelCount > 0;
    const throttle = this.input.throttle;
    const forwardSpeed = BABYLON.Vector3.Dot(this.body.getLinearVelocity(), forward);

    if (grounded) {
      this.applyGroundedDriving(forward, right, up);
    } else if (this.input.airControlHeld) {
      this.applyAirControl(forward, right, up);
    }

    this.updateLights(worldMatrix, throttle, forwardSpeed);
  }

  /** Headlights are real SpotLights (don't inherit the chassis transform, unlike
   *  meshes), so they're repositioned every frame; taillights just glow brighter
   *  under braking — pressing back while still rolling forward, not just reversing. */
  private updateLights(worldMatrix: BABYLON.Matrix, throttle: number, forwardSpeed: number) {
    const visual = this.carVisual;
    if (!visual) return;

    if (this.headlightsOn) {
      visual.headlightLights.forEach((light, i) => {
        const offset = visual.headlightLocalOffsets[i];
        light.position = BABYLON.Vector3.TransformCoordinates(offset, worldMatrix);
        light.direction = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Forward(), worldMatrix).normalize();
      });
    }

    const isBraking = throttle < 0 && forwardSpeed > 1;
    const brightness = isBraking ? 0.9 : 0.15;
    visual.taillightMaterial.emissiveColor.set(brightness, 0, 0);
  }

  private applyGroundedDriving(forward: BABYLON.Vector3, right: BABYLON.Vector3, up: BABYLON.Vector3) {
    const center = this.chassis.getAbsolutePosition();
    const velocity = this.body.getLinearVelocity();
    const forwardSpeed = BABYLON.Vector3.Dot(velocity, forward);

    const throttle = this.input.throttle;
    const powerFactor = this.enginePowerMultiplier * this.gripMultiplier;
    if (throttle > 0) {
      this.body.applyForce(forward.scale(this.engineForce * powerFactor * throttle), center);
    } else if (throttle < 0) {
      this.body.applyForce(forward.scale(this.reverseForce * powerFactor * throttle), center);
    }

    // Grip: kill lateral slide each frame so sliding is a deliberate choice, not an accident.
    // Weather (snow, rain) and the car's own stats both scale this — a "sport" car with
    // lower gripMultiplier holds back less of the slide, a "GT" car holds back more.
    const gripFactor = this.carGripMultiplier * this.gripMultiplier;
    const lateralSpeed = BABYLON.Vector3.Dot(velocity, right);
    this.body.applyForce(right.scale(-lateralSpeed * this.lateralGripFactor * gripFactor), center);

    // Speed-sensitive steering: tighter at low speed, smoothed out at high speed,
    // and reversed so steering still feels natural while backing up.
    const steer = this.input.steer;
    if (steer !== 0) {
      const speedFactor = 1 / (1 + Math.abs(forwardSpeed) * 0.08);
      const direction = forwardSpeed < 0 ? -1 : 1;
      const torque = up.scale(steer * this.maxSteerTorque * gripFactor * speedFactor * direction);
      this.applyTorqueImpulse(torque);
    }
  }

  private applyAirControl(forward: BABYLON.Vector3, right: BABYLON.Vector3, up: BABYLON.Vector3) {
    const { dx } = this.input.consumeMouseDelta();

    const pitchInput = this.input.airPitch;
    const rollInput = this.input.airRoll;
    const yawInput = BABYLON.Scalar.Clamp(dx * this.mouseYawSensitivity, -1, 1);

    const desiredAngularVelocity = right
      .scale(pitchInput * this.airRotationRate)
      .add(forward.scale(rollInput * this.airRotationRate))
      .add(up.scale(yawInput * this.airRotationRate));

    const current = this.body.getAngularVelocity();
    const blended = BABYLON.Vector3.Lerp(current, desiredAngularVelocity, this.airBlend);
    this.body.setAngularVelocity(blended);
  }

  /** Havok's PhysicsBody has no direct "applyTorque"; an angular impulse scaled
   *  by the timestep reads as a continuous torque. */
  private applyTorqueImpulse(torque: BABYLON.Vector3) {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    this.body.applyAngularImpulse(torque.scale(dt));
  }
}
