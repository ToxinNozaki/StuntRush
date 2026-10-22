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

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 800, height: 800 }, scene);
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

  /** Sets a rotation via rotationQuaternion directly, never `.rotation.axis`.
   *  createInstance() inherits whatever rotationQuaternion the base mesh had at
   *  creation time — if the base already got one baked in from its own
   *  PhysicsAggregate (Euler rotation gets auto-converted to a quaternion the
   *  first time an aggregate is created for a mesh), every instance created
   *  afterward starts with that SAME quaternion, and touching `.rotation` on it
   *  does nothing visually or physically (rotationQuaternion wins once it's
   *  non-null). Always setting rotationQuaternion explicitly sidesteps that. */
  const setEulerRotation = (mesh: BABYLON.AbstractMesh, x: number, y: number, z: number) => {
    mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(x, y, z);
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
    setEulerRotation(inst, tiltX, 0, 0);
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

  // --- Kicker jump: a steep launch ramp over a gap onto a landing pad further
  // out — a distinct "jump" stunt, separate in character from the loop ramps
  // (those carry you up into a loop; this one's about airtime and distance). ---
  const kickerRamp = BABYLON.MeshBuilder.CreateBox("kickerRamp", { width: 9, height: 0.6, depth: 16 }, scene);
  kickerRamp.material = groundMat;
  kickerRamp.parent = root;
  kickerRamp.position = new BABYLON.Vector3(-30, 2.2, 230);
  kickerRamp.rotation.x = -Math.PI / 6; // steeper than the loop ramps — built for distance, not height
  kickerRamp.receiveShadows = true;
  addBoxStatic(kickerRamp);

  const landingPad = BABYLON.MeshBuilder.CreateBox("landingPad", { width: 14, height: 0.5, depth: 24 }, scene);
  landingPad.material = groundMat;
  landingPad.parent = root;
  landingPad.position = new BABYLON.Vector3(-30, 0.25, 290);
  landingPad.receiveShadows = true;
  addBoxStatic(landingPad);

  // --- Banked turn: closes the main line into an actual circuit instead of a
  // dead-end straight. Computed in code rather than hand-placed — a hand-derived
  // arc of rotated/banked segments is exactly the kind of arithmetic that's easy
  // to get subtly wrong, so the math lives in arcExit()/placeArcSegments() below
  // and gets verified by actually driving it, not by eyeballing the numbers. ---
  const turnSegBase = BABYLON.MeshBuilder.CreateBox(
    "turnSeg",
    { width: 11, height: 0.6, depth: 13 },
    scene
  );
  turnSegBase.material = groundMat;
  turnSegBase.parent = root;
  turnSegBase.receiveShadows = true;

  interface Pose {
    x: number;
    z: number;
    headingDeg: number;
  }

  /** Where a car ends up (position + heading) after sweeping `sweepDeg` around a
   *  turn of the given radius, starting from `entry`. turnRight toggles which way
   *  the arc curves. Pure math — no mesh placement — so it's trivial to check by
   *  hand for a couple of round numbers (e.g. 90° right turn from heading 0). */
  function arcExit(entry: Pose, radius: number, sweepDeg: number, turnRight: boolean): Pose {
    const h0 = (entry.headingDeg * Math.PI) / 180;
    const sign = turnRight ? 1 : -1;
    const rightX = Math.cos(h0);
    const rightZ = -Math.sin(h0);
    const cx = entry.x + sign * radius * rightX;
    const cz = entry.z + sign * radius * rightZ;
    const relX = entry.x - cx;
    const relZ = entry.z - cz;
    const sweepRad = (sweepDeg * Math.PI) / 180;
    const rotAngle = sign * sweepRad;
    const rotX = relX * Math.cos(rotAngle) + relZ * Math.sin(rotAngle);
    const rotZ = -relX * Math.sin(rotAngle) + relZ * Math.cos(rotAngle);
    return {
      x: cx + rotX,
      z: cz + rotZ,
      headingDeg: entry.headingDeg + sign * sweepDeg,
    };
  }

  /** Places `count` banked road segments tracing the same arc arcExit() computes,
   *  each instanced off turnSegBase, and returns the pose at the far end so the
   *  next piece (a straight, another turn, whatever) can continue from exactly
   *  where this one leaves off. */
  function placeArcSegments(
    namePrefix: string,
    entry: Pose,
    radius: number,
    sweepDeg: number,
    turnRight: boolean,
    count: number,
    bankDeg: number,
    elevation: number
  ): Pose {
    for (let i = 0; i < count; i++) {
      const t0 = (i / count) * sweepDeg;
      const t1 = ((i + 1) / count) * sweepDeg;
      const a = arcExit(entry, radius, t0, turnRight);
      const b = arcExit(entry, radius, t1, turnRight);
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const midHeadingDeg = (a.headingDeg + b.headingDeg) / 2;

      const inst = i === 0 ? turnSegBase : turnSegBase.createInstance(`${namePrefix}${i}`);
      inst.parent = root;
      inst.position = new BABYLON.Vector3(midX, elevation, midZ);
      // Yaw to face the tangent direction, then bank (roll) into the turn.
      inst.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
        (midHeadingDeg * Math.PI) / 180,
        0,
        turnRight ? (-bankDeg * Math.PI) / 180 : (bankDeg * Math.PI) / 180
      );
      addBoxStatic(inst);
    }
    return arcExit(entry, radius, sweepDeg, turnRight);
  }

  // Runway2 ends at (0, 260) heading +Z (0°). Bank right 90° into a new straight.
  const turnExit = placeArcSegments(
    "turn1seg",
    { x: 0, z: 260, headingDeg: 0 },
    50,
    90,
    true,
    7,
    18,
    0.5
  );
  const closingRunway = runwayBase.createInstance("closingRunway");
  closingRunway.parent = root;
  closingRunway.position = new BABYLON.Vector3(turnExit.x + 25, 0.25, turnExit.z);
  setEulerRotation(closingRunway, 0, Math.PI / 2, 0); // facing +X, matching the turn's exit heading
  addBoxStatic(closingRunway);

  // --- Boundary wall: a low barrier ring around the whole play area. The
  // kill-plane (see vehicle.ts) is the fallback for anyone who still gets over
  // it; this is what actually makes the map read as a defined island instead of
  // an endless gray plane. ---
  const wallBase = BABYLON.MeshBuilder.CreateBox("boundaryWall", { width: 40, height: 7, depth: 2 }, scene);
  wallBase.material = groundMat;
  wallBase.parent = root;
  wallBase.receiveShadows = true;

  const bounds = { xMin: -110, xMax: 190, zMin: -40, zMax: 340 };
  let wallIndex = 0;
  const placeWallRun = (from: BABYLON.Vector3, to: BABYLON.Vector3, rotY: number) => {
    const length = BABYLON.Vector3.Distance(from, to);
    const segCount = Math.max(1, Math.round(length / 40));
    for (let i = 0; i < segCount; i++) {
      const t = (i + 0.5) / segCount;
      const pos = BABYLON.Vector3.Lerp(from, to, t);
      wallIndex++;
      const inst = wallIndex === 1 ? wallBase : wallBase.createInstance(`wall${wallIndex}`);
      inst.parent = root;
      inst.position = pos;
      setEulerRotation(inst, 0, rotY, 0);
      addBoxStatic(inst);
    }
  };
  // wallBase defaults to its long (40) axis along local X, short (2) along local
  // Z — so an edge running along world X needs rotY=0 (no rotation), and an edge
  // running along world Z needs rotY=90° to swing that long axis to match.
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 3.5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMax, 3.5, bounds.zMin),
    0
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 3.5, bounds.zMax),
    new BABYLON.Vector3(bounds.xMax, 3.5, bounds.zMax),
    0
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 3.5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMin, 3.5, bounds.zMax),
    Math.PI / 2
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMax, 3.5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMax, 3.5, bounds.zMax),
    Math.PI / 2
  );

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
  setEulerRotation(wallLeft, 0, 0, halfPipeLean);
  addBoxStatic(wallLeft);

  const wallRight = halfPipeWallBase.createInstance("halfPipeWallRight");
  wallRight.parent = root;
  wallRight.position = halfPipeCenter.add(new BABYLON.Vector3(9.5, 1, 0));
  setEulerRotation(wallRight, 0, 0, -halfPipeLean);
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
