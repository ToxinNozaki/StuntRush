import * as BABYLON from "@babylonjs/core";

export interface BuiltWorld {
  dispose(): void;
}

/** Builds the Phase 0/1 test level: flat ground, one ramp, one loop. Static physics only. */
export function buildWorld(scene: BABYLON.Scene): BuiltWorld {
  const root = new BABYLON.TransformNode("worldRoot", scene);
  const aggregates: BABYLON.PhysicsAggregate[] = [];

  const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.37);

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 400, height: 400 }, scene);
  ground.material = groundMat;
  ground.parent = root;
  ground.receiveShadows = true;
  aggregates.push(
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene)
  );

  // Ramp: inclined box leading up to the loop.
  const ramp = BABYLON.MeshBuilder.CreateBox("ramp", { width: 8, height: 0.5, depth: 20 }, scene);
  ramp.material = groundMat;
  ramp.parent = root;
  ramp.position = new BABYLON.Vector3(0, 2.5, 40);
  ramp.rotation.x = -Math.PI / 10;
  ramp.receiveShadows = true;
  aggregates.push(
    new BABYLON.PhysicsAggregate(ramp, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene)
  );

  // Loop: a torus standing on edge, mesh-collided (static, so cheap).
  const loop = BABYLON.MeshBuilder.CreateTorus(
    "loop",
    { diameter: 26, thickness: 2.6, tessellation: 48 },
    scene
  );
  loop.material = groundMat;
  loop.parent = root;
  loop.rotation.z = Math.PI / 2;
  loop.position = new BABYLON.Vector3(0, 13, 62);
  aggregates.push(
    new BABYLON.PhysicsAggregate(loop, BABYLON.PhysicsShapeType.MESH, { mass: 0, friction: 0.8 }, scene)
  );

  // A second straight runway past the loop, just to have somewhere to land and keep driving.
  const runway = BABYLON.MeshBuilder.CreateBox("runway", { width: 10, height: 0.5, depth: 60 }, scene);
  runway.material = groundMat;
  runway.parent = root;
  runway.position = new BABYLON.Vector3(0, 0.25, 110);
  runway.receiveShadows = true;
  aggregates.push(
    new BABYLON.PhysicsAggregate(runway, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene)
  );

  return {
    dispose() {
      for (const aggregate of aggregates) aggregate.dispose();
      root.dispose(false, true);
      groundMat.dispose();
    },
  };
}
