import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

export interface BuiltWorld {
  dispose(): void;
}

const WATER_TOWER_URL = `${import.meta.env.BASE_URL}models/water-tower.glb`;
const ELECTRICAL_BOXES_URL = `${import.meta.env.BASE_URL}models/electrical-boxes.glb`;
const PEDESTRIANS_URL = `${import.meta.env.BASE_URL}models/pedestrians.glb`;
const BRIDGE_URL = `${import.meta.env.BASE_URL}models/bridge.glb`;

/** Real Poly Haven PBR sets (asphalt/concrete/factory-wall), downscaled to 1024px and
 *  with their normal maps converted from the source EXRs to JPEG offline — the raw
 *  4K/EXR originals stay in the local asset dump only, per the project's asset policy.
 *  Replaces the single flat StandardMaterial every world.ts piece used to share, which
 *  is why a real PBR car used to look pasted onto a flat gray plane: nothing in the
 *  world itself had any texture or roughness response to the scene's IBL. */
const TEXTURES_BASE = `${import.meta.env.BASE_URL}textures`;

export function loadPBRMaterial(
  scene: BABYLON.Scene,
  name: string,
  folder: string,
  uScale: number,
  vScale: number
): BABYLON.PBRMaterial {
  const material = new BABYLON.PBRMaterial(name, scene);
  const diffuse = new BABYLON.Texture(`${TEXTURES_BASE}/${folder}/diffuse.jpg`, scene);
  const roughness = new BABYLON.Texture(`${TEXTURES_BASE}/${folder}/roughness.jpg`, scene);
  const normal = new BABYLON.Texture(`${TEXTURES_BASE}/${folder}/normal.jpg`, scene);
  for (const tex of [diffuse, roughness, normal]) {
    tex.uScale = uScale;
    tex.vScale = vScale;
  }
  material.albedoTexture = diffuse;
  // Separate grayscale roughness map (not a packed glTF metallic-roughness texture) —
  // Babylon's metallic/roughness workflow still wants it on `metallicTexture` with the
  // green-channel flag on; since the map is genuinely grayscale (R=G=B), that channel
  // pick doesn't matter. Metal is forced to 0 regardless of the texture's blue channel —
  // none of these three surfaces (asphalt/concrete/painted wall) should read as metal.
  material.metallicTexture = roughness;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = false;
  material.metallic = 0;
  material.roughness = 1;
  material.bumpTexture = normal;
  return material;
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

  // One tiling scale for the huge open ground plane, a tighter one for the much
  // smaller ramp/runway/loop/turn pieces so neither looks blurry-stretched nor
  // over-busy relative to its own size — see DESIGN_DOC.md for how these were picked.
  const trackMatGround = loadPBRMaterial(scene, "trackMatGround", "asphalt", 50, 50);
  const trackMat = loadPBRMaterial(scene, "trackMat", "asphalt", 4, 6);
  const structureMat = loadPBRMaterial(scene, "structureMat", "concrete", 5, 3);
  const boundaryMat = loadPBRMaterial(scene, "boundaryMat", "factory-wall", 6, 2);

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 800, height: 800 }, scene);
  ground.material = trackMatGround;
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
  rampBase.material = trackMat;
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
  runwayBase.material = trackMat;
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
    loop.material = trackMat;
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
  kickerRamp.material = trackMat;
  kickerRamp.parent = root;
  kickerRamp.position = new BABYLON.Vector3(-30, 2.2, 230);
  kickerRamp.rotation.x = -Math.PI / 6; // steeper than the loop ramps — built for distance, not height
  kickerRamp.receiveShadows = true;
  addBoxStatic(kickerRamp);

  const landingPad = BABYLON.MeshBuilder.CreateBox("landingPad", { width: 14, height: 0.5, depth: 24 }, scene);
  landingPad.material = trackMat;
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
  turnSegBase.material = trackMat;
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
  wallBase.material = boundaryMat;
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
  halfPipeWallBase.material = structureMat;
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
  halfPipeFloor.material = structureMat;
  halfPipeFloor.parent = root;
  halfPipeFloor.position = halfPipeCenter.clone();
  halfPipeFloor.receiveShadows = true;
  addBoxStatic(halfPipeFloor);

  // --- World dressing: purely decorative background scenery just outside the
  // boundary wall — makes the map read as part of somewhere, not an island
  // floating in gray void. No collision (they sit past the wall the player
  // can't reach anyway), loaded async and fire-and-forget like the player's
  // own car model; `isDisposed` guards against a load finishing after the
  // player's already left the map. ---
  let isDisposed = false;
  const loadDecoration = async (url: string, position: BABYLON.Vector3, targetSize: number, rotationY = 0) => {
    const result = await ImportMeshAsync(url, scene);
    if (isDisposed) {
      for (const mesh of result.meshes) mesh.dispose();
      return;
    }
    const decoRoot = new BABYLON.TransformNode("decoration", scene);
    for (const mesh of result.meshes) {
      if (mesh.parent === null) mesh.parent = decoRoot;
      mesh.isPickable = false;
    }
    const modelBounds = decoRoot.getHierarchyBoundingVectors(true);
    const size = modelBounds.max.subtract(modelBounds.min);
    const scale = targetSize / (Math.max(size.x, size.z, size.y) || 1);
    decoRoot.scaling.setAll(scale);
    const scaledBounds = decoRoot.getHierarchyBoundingVectors(true);
    decoRoot.position = position.subtract(new BABYLON.Vector3(0, scaledBounds.min.y, 0));
    decoRoot.rotation.y = rotationY;
    decoRoot.parent = root;
  };

  void loadDecoration(WATER_TOWER_URL, new BABYLON.Vector3(bounds.xMax + 35, 0, 60), 22, Math.PI / 5);
  void loadDecoration(ELECTRICAL_BOXES_URL, new BABYLON.Vector3(bounds.xMin - 15, 0, 100), 4, Math.PI / 3);
  void loadDecoration(ELECTRICAL_BOXES_URL, new BABYLON.Vector3(bounds.xMax + 15, 0, 260), 4, -Math.PI / 4);
  // From the asset dump's "Bridge or Highway pack" — a single cohesive, already
  // well-textured (real baseColor+normal maps, not untextured like the pedestrian
  // pack) highway overpass model, no multi-object disambiguation needed unlike the
  // traffic car pack. Placed beyond the far boundary wall as a distant landmark,
  // same purely-decorative treatment as the water tower. First piece pulled from
  // the larger, unsurveyed world-building asset packs (roads/buildings/bridges) —
  // see the Open Questions backlog note on the rest.
  //
  // Scale note: the source model is a genuinely flat structure (its bounding box
  // is ~46 wide x only ~2.9 tall x ~37 deep) — `loadDecoration()`'s targetSize
  // normalizes against the LARGEST dimension (width here, not height), so a
  // first attempt at targetSize 70 produced an overpass only ~4.3 world units
  // tall: convincing up close (verified in-browser — looks like a real elevated
  // highway with pillars), but visually disappears at normal driving distance,
  // since uniform scaling can't make it proportionally taller without also
  // making it proportionally wider. targetSize 170 (and pulling it ~30 units
  // closer to the boundary) is the tradeoff that keeps it readable as a distant
  // landmark without making its footprint absurd.
  void loadDecoration(BRIDGE_URL, new BABYLON.Vector3(60, 0, bounds.zMax + 40), 170, Math.PI / 2);

  // Pedestrians, from the "24-lowpoly-characters" asset-dump pack (converted offline
  // FBX -> glb with FBX2glTF, see DESIGN_DOC.md's asset-dump notes — despite the folder's
  // name the FBX only contains two rigged base meshes, "FM-lowpoly" and "M-lowpoly", no
  // textures/materials and no animation, so they render in whatever static bind pose the
  // rig exported with). Each spot does its own fresh ImportMeshAsync rather than
  // clone()-ing a shared template (the pattern used for the sky plane): a skinned/rigged
  // mesh's clone() doesn't rebind its skeleton correctly here — tried it first, and every
  // clone rendered as a giant melted blob instead of a standing figure. Re-importing per
  // spot is a little more wasteful (79KB x5 instead of x1) but avoids the skeleton-sharing
  // bug entirely, and the file is tiny either way. Each figure gets its own flat muted
  // PBRMaterial (a few clothing-ish tones) since the source mesh has no material at all —
  // left genuinely low-poly/flat-shaded on purpose rather than faked up with a texture
  // that doesn't exist in the source.
  const spots: { mesh: "FM-lowpoly" | "M-lowpoly"; position: BABYLON.Vector3; rotationY: number; tint: string }[] = [
    { mesh: "M-lowpoly", position: new BABYLON.Vector3(bounds.xMin - 10, 0, 40), rotationY: Math.PI / 2, tint: "#2d4a6b" },
    { mesh: "FM-lowpoly", position: new BABYLON.Vector3(bounds.xMin - 10, 0, 44), rotationY: Math.PI / 2.3, tint: "#8a4b4b" },
    { mesh: "M-lowpoly", position: new BABYLON.Vector3(bounds.xMax + 10, 0, 160), rotationY: -Math.PI / 2, tint: "#4b6b4f" },
    { mesh: "FM-lowpoly", position: new BABYLON.Vector3(bounds.xMax + 12, 0, 165), rotationY: -Math.PI / 2.5, tint: "#6b5a8a" },
    { mesh: "M-lowpoly", position: new BABYLON.Vector3(bounds.xMin - 12, 0, 280), rotationY: Math.PI / 1.8, tint: "#8a7a3d" },
  ];

  const loadPedestrian = async (spot: (typeof spots)[number]) => {
    const result = await ImportMeshAsync(PEDESTRIANS_URL, scene);
    if (isDisposed) {
      for (const mesh of result.meshes) mesh.dispose();
      return;
    }
    const keep = result.meshes.find((m) => m.name === spot.mesh);
    if (!keep) {
      for (const mesh of result.meshes) mesh.dispose();
      return;
    }
    // Detach `keep` from the imported hierarchy (preserving its world transform,
    // in case an ancestor like the FBX's RootNode carries an axis-correction
    // rotation/scale — same gotcha documented for the traffic car pack in
    // traffic.ts) BEFORE disposing its former siblings/parents. Disposing a
    // mesh cascades to its children by default; disposing first and
    // reparenting after (the original bug here) silently destroyed `keep` too,
    // since it was still parented under the node being disposed.
    keep.setParent(root);
    for (const mesh of result.meshes) {
      if (mesh !== keep && !mesh.isDisposed()) mesh.dispose();
    }
    keep.isPickable = false;
    // `setParent()` preserved world rotation/scale into keep's own local
    // transform — this pack's RootNode carries a ~100x correction scale with
    // a negative Y component (a unit-conversion + handedness-flip combo
    // baked in by the FBX source) *and* a -90° X / 180° Y Euler correction
    // (the actual Z-up -> Y-up axis fix), the same class of gotcha as the
    // traffic car pack's axis correction. setParent() leaves that correction
    // on `.rotation` (Euler), not `.rotationQuaternion` (which stays null) —
    // overwriting rotationQuaternion outright (as a first attempt here did)
    // silently threw the Euler correction away and left every figure lying
    // flat on the ground. Converting the existing Euler into a quaternion
    // before composing the desired yaw on top preserves it. Scale/position
    // are then measured and applied entirely in WORLD space via
    // `getHierarchyBoundingVectors()` — the same technique `loadDecoration()`
    // above already uses successfully, and correct regardless of any mirror
    // transform in the ancestry.
    keep.computeWorldMatrix(true);
    let worldBounds = keep.getHierarchyBoundingVectors(true);
    const rawHeight = worldBounds.max.y - worldBounds.min.y || 1;
    keep.scaling.scaleInPlace(1.75 / rawHeight);
    const yaw = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), spot.rotationY);
    const baseRotation = keep.rotationQuaternion ?? BABYLON.Quaternion.FromEulerVector(keep.rotation);
    keep.rotationQuaternion = yaw.multiply(baseRotation);
    keep.computeWorldMatrix(true);
    worldBounds = keep.getHierarchyBoundingVectors(true);
    const center = worldBounds.min.add(worldBounds.max).scale(0.5);
    keep.position.x += spot.position.x - center.x;
    keep.position.z += spot.position.z - center.z;
    keep.position.y += spot.position.y - worldBounds.min.y;
    const material = new BABYLON.PBRMaterial(`pedestrianMat-${spot.tint}`, scene);
    material.albedoColor = BABYLON.Color3.FromHexString(spot.tint);
    material.metallic = 0;
    material.roughness = 0.85;
    // The mirror component in that correction scale flips triangle winding
    // (negative world-matrix determinant), which would otherwise render as
    // inside-out/invisible from the outside under default backface culling.
    material.backFaceCulling = false;
    keep.material = material;
  };
  for (const spot of spots) void loadPedestrian(spot);

  return {
    dispose() {
      isDisposed = true;
      for (const aggregate of aggregates) aggregate.dispose();
      root.dispose(false, true);
      trackMatGround.dispose();
      trackMat.dispose();
      structureMat.dispose();
      boundaryMat.dispose();
    },
  };
}
