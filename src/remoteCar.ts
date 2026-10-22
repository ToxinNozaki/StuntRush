import * as BABYLON from "@babylonjs/core";
import { attachCarVisual } from "./carModel";
import type { RemoteTransform } from "./multiplayer";

/**
 * A visual-only stand-in for another player's car — no physics body, just a
 * TransformNode smoothly lerping toward whatever transform last arrived over
 * the network. If updates stop coming (dropped connection, tab closed) it just
 * sits still rather than doing anything dramatic; Game disposes it on peer-left.
 */
export class RemoteCar {
  readonly root: BABYLON.TransformNode;
  private targetPosition: BABYLON.Vector3;
  private targetRotation: BABYLON.Quaternion;
  private visualReady = false;

  constructor(scene: BABYLON.Scene, initial: RemoteTransform) {
    this.root = new BABYLON.TransformNode("remoteCar", scene);
    this.targetPosition = BABYLON.Vector3.FromArray(initial.p);
    this.targetRotation = BABYLON.Quaternion.FromArray(initial.q);
    this.root.position.copyFrom(this.targetPosition);
    this.root.rotationQuaternion = this.targetRotation.clone();

    // Reuse the same visual-fitting logic as the local car, just with no physics
    // chassis underneath — attachCarVisual expects a Mesh to parent to and measure
    // against, so this proxy box fills that role, then goes invisible.
    const proxy = BABYLON.MeshBuilder.CreateBox("remoteCarProxy", { width: 1.9, height: 0.55, depth: 4.2 }, scene);
    proxy.isVisible = false;
    proxy.parent = this.root;
    void attachCarVisual(scene, proxy, 4.3, 0.32).then(() => {
      this.visualReady = true;
    });
  }

  applyTransform(transform: RemoteTransform) {
    this.targetPosition = BABYLON.Vector3.FromArray(transform.p);
    this.targetRotation = BABYLON.Quaternion.FromArray(transform.q);
  }

  /** Called every frame regardless of whether a new network update just arrived. */
  update() {
    if (!this.visualReady) return;
    this.root.position = BABYLON.Vector3.Lerp(this.root.position, this.targetPosition, 0.25);
    this.root.rotationQuaternion = BABYLON.Quaternion.Slerp(
      this.root.rotationQuaternion ?? BABYLON.Quaternion.Identity(),
      this.targetRotation,
      0.25
    );
  }

  dispose() {
    this.root.dispose(false, true);
  }
}
