import * as BABYLON from "@babylonjs/core";

export interface BuiltWorld {
  dispose(): void;
}

/**
 * Builds the free-roam test world: flat ground, two ramp-into-loop-into-runway
 * chains back to back, and a half-pipe stunt piece off to the side. Static
 * physics only. Repeated pieces (ramps, runway segments, the second loop) are
 * built from `createInstance()` off one base mesh each — cheap draw calls, and
 * the pattern the doc calls out for scaling the map up further later.
 */
export function buildWorld(scene: BABYLON.Scene): BuiltWorld {
  const root = new BABYLON.TransformNode("worldRoot", scene);
  const aggregates: BABYLON.PhysicsAggregate[] = [];

  const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.37);

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 500, height: 500 }, scene);
  ground.material = groundMat;
  ground.parent = root;
  ground.receiveShadows = true;
  aggregates.push(
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene)
  );

  const addBoxStatic = (mesh: BABYLON.AbstractMesh) => {
    aggregates.push(
      new BABYLON.PhysicsAggregate(
        mesh as BABYLON.Mesh,
        BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.8 },
        scene
      )
    );
  };

  // --- Reusable ramp: one base mesh, instanced everywhere a ramp is needed. ---
  const rampBase = BABYLON.MeshBuilder.CreateBox("ramp", { width: 8, height: 0.5, depth: 20 }, scene);
  rampBase.material = groundMat;
  rampBase.parent = root;
  rampBase.receiveShadows = true;

  const placeRamp = (name: string, position: BABYLON.Vector3, tiltX: number) => {
    const inst = name === "ramp" ? rampBase : rampBase.createInstance(name);
    inst.parent = root;
    inst.position = position;
    inst.rotation.x = tiltX;
    addBoxStatic(inst);
    return inst;
  };
  placeRamp("ramp", new BABYLON.Vector3(0, 2.5, 40), -Math.PI / 10);

  // --- Reusable runway segment: one base mesh, instanced for each straight. ---
  const runwayBase = BABYLON.MeshBuilder.CreateBox("runway", { width: 10, height: 0.5, depth: 60 }, scene);
  runwayBase.material = groundMat;
  runwayBase.parent = root;
  runwayBase.receiveShadows = true;

  const placeRunway = (name: string, position: BABYLON.Vector3) => {
    const inst = name === "runway" ? runwayBase : runwayBase.createInstance(name);
    inst.parent = root;
    inst.position = position;
    addBoxStatic(inst);
    return inst;
  };
  placeRunway("runway", new BABYLON.Vector3(0, 0.25, 110));

  // --- Loops: each torus keeps its own mesh-shaped collider (not instanced —
  // MESH-type physics shapes need their own geometry to collide correctly), but
  // share one material and are built from one helper so adding a third is a
  // one-liner. ---
  const placeLoop = (name: string, position: BABYLON.Vector3) => {
    const loop = BABYLON.MeshBuilder.CreateTorus(
      name,
      { diameter: 26, thickness: 2.6, tessellation: 48 },
      scene
    );
    loop.material = groundMat;
    loop.parent = root;
    loop.rotation.z = Math.PI / 2;
    loop.position = position;
    aggregates.push(
      new BABYLON.PhysicsAggregate(loop, BABYLON.PhysicsShapeType.MESH, { mass: 0, friction: 0.8 }, scene)
    );
    return loop;
  };
  placeLoop("loop", new BABYLON.Vector3(0, 13, 62));

  // --- Second chain, further down the same runway: ramp back up into a second
  // loop, then another runway straight to land on and keep driving. ---
  placeRamp("ramp2", new BABYLON.Vector3(0, 2.5, 160), -Math.PI / 10);
  placeLoop("loop2", new BABYLON.Vector3(0, 13, 182));
  placeRunway("runway2", new BABYLON.Vector3(0, 0.25, 230));

  // --- Half-pipe: two leaned-in walls facing each other over a flat trough,
  // off to the side of the main line so it's a deliberate detour, not forced. ---
  const halfPipeWallBase = BABYLON.MeshBuilder.CreateBox(
    "halfPipeWall",
    { width: 18, height: 10, depth: 40 },
    scene
  );
  halfPipeWallBase.material = groundMat;
  halfPipeWallBase.parent = root;
  halfPipeWallBase.receiveShadows = true;

  const halfPipeCenter = new BABYLON.Vector3(-55, 0, 30);
  const halfPipeLean = Math.PI / 3.4; // leaned steeply in, not a vertical wall

  const wallLeft = halfPipeWallBase;
  wallLeft.position = halfPipeCenter.add(new BABYLON.Vector3(-9.5, 1, 0));
  wallLeft.rotation.z = halfPipeLean;
  addBoxStatic(wallLeft);

  const wallRight = halfPipeWallBase.createInstance("halfPipeWallRight");
  wallRight.parent = root;
  wallRight.position = halfPipeCenter.add(new BABYLON.Vector3(9.5, 1, 0));
  wallRight.rotation.z = -halfPipeLean;
  addBoxStatic(wallRight);

  const halfPipeFloor = BABYLON.MeshBuilder.CreateBox(
    "halfPipeFloor",
    { width: 12, height: 0.5, depth: 40 },
    scene
  );
  halfPipeFloor.material = groundMat;
  halfPipeFloor.parent = root;
  halfPipeFloor.position = halfPipeCenter.clone();
  halfPipeFloor.receiveShadows = true;
  addBoxStatic(halfPipeFloor);

  return {
    dispose() {
      for (const aggregate of aggregates) aggregate.dispose();
      root.dispose(false, true);
      groundMat.dispose();
    },
  };
}
