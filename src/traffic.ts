import * as BABYLON from "@babylonjs/core";
import { attachCarVisual } from "./carModel";

/**
 * Lightweight background traffic: a couple of AI cars patrolling a simple
 * rectangular loop on open flat ground, well clear of the stunt track (ramps,
 * loops, half-pipe) — these are ambient scenery, not something meant to be
 * driven *through* like a stunt piece. Deliberately dumb: no lane logic, no
 * avoidance between traffic cars, no path smoothing. Velocity is commanded
 * directly toward the next waypoint every frame rather than driven through
 * the player car's raycast-suspension model — real wheel physics would be
 * wasted complexity for cars that only ever need to loop a fixed rectangle.
 * They still carry a real physics body, so the player can bump them; Havok's
 * own solver handles that, not any code here.
 */
export class TrafficController {
  private readonly scene: BABYLON.Scene;
  private readonly cars: {
    chassis: BABYLON.Mesh;
    aggregate: BABYLON.PhysicsAggregate;
    waypoints: BABYLON.Vector3[];
    targetIndex: number;
  }[] = [];
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

    await Promise.all([this.spawnCar(loop, 0, "#b9bcc2"), this.spawnCar(loop, 2, "#8a8d94")]);
    this.updateObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  private async spawnCar(waypoints: BABYLON.Vector3[], startIndex: number, bodyColorHex: string) {
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

    this.cars.push({
      chassis,
      aggregate,
      waypoints,
      targetIndex: (startIndex + 1) % waypoints.length,
    });

    const visual = await attachCarVisual(this.scene, chassis, 4.3, 0.32, bodyColorHex);
    // Real-time SpotLights per traffic car would add up fast; the emissive lamp
    // lenses still read fine as plain static lights without the dynamic light itself.
    for (const light of visual.headlightLights) light.setEnabled(false);
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
  }
}
