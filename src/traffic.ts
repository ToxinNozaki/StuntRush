import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

const TRAFFIC_PACK_URL = `${import.meta.env.BASE_URL}models/traffic-cars.glb`;

/** Two of the ten distinct cars baked into the pack — each is a top-level
 *  TransformNode (body + wheels + glass + lights) parented directly under the
 *  file's RootNode, confirmed by inspecting the loaded scene rather than guessed
 *  from naming. Picked for visual variety (a yellow muscle car and a red SUV-ish
 *  car) after screenshotting each one isolated. The user asked specifically that
 *  traffic only pull from this pack — not the player's Nissan — so this file loads
 *  it on its own rather than reusing carModel.ts's attachCarVisual(). */
const TRAFFIC_CAR_NAMES = ["Cube", "Cube015"];

/**
 * Lightweight background traffic: two AI cars patrolling a simple rectangular loop
 * on open flat ground, well clear of the stunt track (ramps, loops, half-pipe) —
 * these are ambient scenery, not something meant to be driven *through* like a
 * stunt piece. Deliberately dumb: no lane logic, no avoidance between traffic
 * cars, no path smoothing. Velocity is commanded directly toward the next
 * waypoint every frame rather than driven through the player car's
 * raycast-suspension model — real wheel physics would be wasted complexity for
 * cars that only ever need to loop a fixed rectangle. They still carry a real
 * physics body, so the player can bump them; Havok's own solver handles that,
 * not any code here.
 */
export class TrafficController {
  private readonly scene: BABYLON.Scene;
  private readonly cars: {
    chassis: BABYLON.Mesh;
    aggregate: BABYLON.PhysicsAggregate;
    waypoints: BABYLON.Vector3[];
    targetIndex: number;
  }[] = [];
  private readonly carRoots: BABYLON.TransformNode[] = [];
  private updateObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  private readonly cruiseSpeed = 9; // m/s — calm background traffic, not a race

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  /** Builds and starts patrolling. Fire-and-forget from the caller, same as the
   *  player car's own attachVisual(). */
  async spawn(): Promise<void> {
    // A simple rectangle on open ground east of the main track/half-pipe —
    // nowhere near the ramps (centerline ~x=0), the half-pipe (~x=-36 to -73),
    // or the boundary wall (xMax=190) — see world.ts for those bounds.
    const loop: BABYLON.Vector3[] = [
      new BABYLON.Vector3(70, 0.4, -20),
      new BABYLON.Vector3(170, 0.4, -20),
      new BABYLON.Vector3(170, 0.4, 220),
      new BABYLON.Vector3(70, 0.4, 220),
    ];

    const result = await ImportMeshAsync(TRAFFIC_PACK_URL, this.scene);
    const packRoots = new Map(
      TRAFFIC_CAR_NAMES.map((name) => [name, result.transformNodes.find((n) => n.name === name)] as const)
    );

    // Every other car baked into the pack would otherwise sit stacked at the
    // file's own origin, right near where the player spawns — dispose them.
    // TransformNode.dispose() recurses by default, so this takes each unused
    // car's whole mesh subtree with it.
    for (const node of result.transformNodes) {
      if (node.parent?.name !== "RootNode" || packRoots.has(node.name)) continue;
      node.dispose();
    }

    this.spawnCar(packRoots.get("Cube"), loop, 0);
    this.spawnCar(packRoots.get("Cube015"), loop, 2);

    // The two chosen cars are reparented onto their own chassis above; everything
    // left in the import (the pack's empty wrapper hierarchy, Babylon's own
    // placeholder root mesh) is dead weight now — clear it out. This must only
    // touch the empty wrapper nodes, never result.meshes wholesale — the chosen
    // cars' actual meshes are still in that same array, just reparented already.
    result.transformNodes.find((n) => n.name === "Sketchfab_Scene")?.dispose();
    result.meshes.find((m) => m.name === "__root__")?.dispose();

    this.updateObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  private spawnCar(carRoot: BABYLON.TransformNode | undefined, waypoints: BABYLON.Vector3[], startIndex: number) {
    if (!carRoot) return; // a name from the pack didn't resolve — skip rather than crash

    const chassis = BABYLON.MeshBuilder.CreateBox(
      "trafficChassis",
      { width: 1.9, height: 0.55, depth: 4.2 },
      this.scene
    );
    chassis.isVisible = false;
    chassis.position = waypoints[startIndex].clone();
    chassis.rotationQuaternion = BABYLON.Quaternion.Identity();

    const aggregate = new BABYLON.PhysicsAggregate(
      chassis,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 1100, friction: 0.3, restitution: 0.1 },
      this.scene
    );
    aggregate.body.setLinearDamping(0.2);
    aggregate.body.setAngularDamping(0.9);

    this.fitCarRootToChassis(carRoot, chassis);
    this.carRoots.push(carRoot);

    this.cars.push({
      chassis,
      aggregate,
      waypoints,
      targetIndex: (startIndex + 1) % waypoints.length,
    });
  }

  /** Normalizes an arbitrary pack car (unknown scale/origin) onto a physics
   *  chassis the same way carModel.ts's attachCarVisual() does for the player
   *  car: measure, scale to a sensible car length, then re-center so its lowest
   *  point sits just above the chassis.
   *
   *  Unlike attachCarVisual()'s freshly-imported root, this node is cut out of a
   *  deeper Sketchfab/FBX hierarchy (RootNode → fbx-node → Sketchfab_model →
   *  Sketchfab_Scene) that bakes a corrective rotation/scale into one of those
   *  ancestor nodes — almost certainly the FBX source's Z-up fixed to glTF's
   *  Y-up. Resetting this node's own local transform to identity after
   *  reparenting it (what attachCarVisual()'s pattern does) throws that
   *  correction away, which is exactly what made the traffic cars render
   *  standing on end instead of lying flat. Capturing the node's *world*
   *  rotation/scale before reparenting, then reapplying that as its new local
   *  transform (chassis itself has no rotation, so local = world here),
   *  preserves the correction instead of discarding it. */
  private fitCarRootToChassis(carRoot: BABYLON.TransformNode, chassis: BABYLON.Mesh) {
    const targetLength = 4.3;
    const groundClearance = 0.3;

    carRoot.computeWorldMatrix(true);
    const worldScale = new BABYLON.Vector3();
    const worldRotation = new BABYLON.Quaternion();
    const worldPosition = new BABYLON.Vector3();
    carRoot.getWorldMatrix().decompose(worldScale, worldRotation, worldPosition);

    carRoot.parent = chassis;
    carRoot.position.setAll(0);
    carRoot.rotationQuaternion = worldRotation;
    carRoot.scaling.copyFrom(worldScale);

    const bounds = carRoot.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min);
    const scale = targetLength / (Math.max(size.x, size.z) || 1);
    carRoot.scaling.scaleInPlace(scale);

    const scaledBounds = carRoot.getHierarchyBoundingVectors(true);
    const scaledCenter = scaledBounds.min.add(scaledBounds.max).scale(0.5);
    const chassisWorldPos = chassis.getAbsolutePosition();

    carRoot.position.x = chassisWorldPos.x - scaledCenter.x;
    carRoot.position.z = chassisWorldPos.z - scaledCenter.z;
    carRoot.position.y = chassisWorldPos.y - scaledBounds.min.y - groundClearance;

    for (const mesh of carRoot.getChildMeshes()) mesh.isPickable = false;
  }

  private update() {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    if (dt <= 0) return;

    for (const car of this.cars) {
      const target = car.waypoints[car.targetIndex];
      const toTarget = target.subtract(car.chassis.position);
      toTarget.y = 0;
      const distance = toTarget.length();

      if (distance < 4) {
        car.targetIndex = (car.targetIndex + 1) % car.waypoints.length;
        continue;
      }

      const direction = toTarget.normalize();
      const currentY = car.aggregate.body.getLinearVelocity().y; // leave gravity alone
      car.aggregate.body.setLinearVelocity(
        new BABYLON.Vector3(direction.x * this.cruiseSpeed, currentY, direction.z * this.cruiseSpeed)
      );

      const heading = Math.atan2(direction.x, direction.z);
      const targetRotation = BABYLON.Quaternion.FromEulerAngles(0, heading, 0);
      car.chassis.rotationQuaternion = BABYLON.Quaternion.Slerp(
        car.chassis.rotationQuaternion ?? BABYLON.Quaternion.Identity(),
        targetRotation,
        Math.min(1, dt * 3)
      );
    }
  }

  dispose() {
    if (this.updateObserver) this.scene.onBeforeRenderObservable.remove(this.updateObserver);
    for (const car of this.cars) {
      car.aggregate.dispose();
      car.chassis.dispose(false, true);
    }
    this.cars.length = 0;
    this.carRoots.length = 0;
  }
}
