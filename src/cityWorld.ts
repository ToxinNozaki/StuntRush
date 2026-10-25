import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { loadPBRMaterial, type BuiltWorld } from "./world";

/**
 * "Downtown" — the second map, a sprawling-ish 3x3 street grid to cruise around
 * rather than a stunt track (see DESIGN_DOC.md: the user explicitly chose "open
 * city to cruise/explore" over a stunt-track-reskinned-as-a-city). Shares
 * `world.ts`'s BuiltWorld shape and `loadPBRMaterial()` helper, but is a
 * deliberately separate function/file rather than a branch inside `buildWorld()`
 * — the two maps have almost nothing in common geometry-wise (no ramps/loops/
 * half-pipe here at all), so forking cleanly avoids a single function trying to
 * do two very different jobs.
 */
const CITY_SKYLINE_URL = `${import.meta.env.BASE_URL}models/city-skyline.glb`;

/** Road centerlines, both axes — 4 lines -> 3x3 = 9 blocks between them. */
const GRID_LINES = [0, 70, 140, 210];
const ROAD_WIDTH = 14;
/** Midpoints between consecutive grid lines — where each block's buildings sit. */
const BLOCK_CENTERS = [35, 105, 175];
/** How big (in world units, along a building cluster's widest horizontal axis)
 *  each placed skyline cluster gets scaled to — leaves clearance inside a 56-unit-
 *  wide block (70 spacing - 14 road width) so buildings don't crowd the road. */
const BUILDING_TARGET_SIZE = 42;

export function buildCityWorld(scene: BABYLON.Scene): BuiltWorld {
  const root = new BABYLON.TransformNode("cityRoot", scene);
  const aggregates: BABYLON.PhysicsAggregate[] = [];
  let isDisposed = false;

  const roadMat = loadPBRMaterial(scene, "cityRoadMat", "asphalt", 40, 40);
  const boundaryMat = loadPBRMaterial(scene, "cityBoundaryMat", "factory-wall", 6, 2);

  // v1 simplification, noted rather than hidden: the whole footprint (roads AND
  // the lots between them) is one flat asphalt plane — no distinct sidewalk/lot
  // material yet. Reads as "paved plaza city" rather than having true sidewalks;
  // a reasonable follow-up, not attempted here to keep this map's first pass
  // scoped to "a real drivable city grid exists" rather than block indefinitely
  // on visual polish.
  const bounds = { xMin: -30, xMax: 240, zMin: -30, zMax: 240 };

  const ground = BABYLON.MeshBuilder.CreateGround(
    "cityGround",
    { width: bounds.xMax - bounds.xMin, height: bounds.zMax - bounds.zMin },
    scene
  );
  ground.position.set((bounds.xMin + bounds.xMax) / 2, 0, (bounds.zMin + bounds.zMax) / 2);
  ground.material = roadMat;
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
  const setEulerRotation = (mesh: BABYLON.AbstractMesh, x: number, y: number, z: number) => {
    mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(x, y, z);
  };

  // --- Boundary wall around the whole grid, same segmented-instance pattern as
  // the test track's wall in world.ts. ---
  const wallBase = BABYLON.MeshBuilder.CreateBox("cityWall", { width: 40, height: 10, depth: 2 }, scene);
  wallBase.material = boundaryMat;
  wallBase.parent = root;
  wallBase.receiveShadows = true;
  let wallIndex = 0;
  const placeWallRun = (from: BABYLON.Vector3, to: BABYLON.Vector3, rotY: number) => {
    const length = BABYLON.Vector3.Distance(from, to);
    const segCount = Math.max(1, Math.round(length / 40));
    for (let i = 0; i < segCount; i++) {
      const t = (i + 0.5) / segCount;
      const pos = BABYLON.Vector3.Lerp(from, to, t);
      wallIndex++;
      const inst = wallIndex === 1 ? wallBase : wallBase.createInstance(`cityWall${wallIndex}`);
      inst.parent = root;
      inst.position = pos;
      setEulerRotation(inst, 0, rotY, 0);
      addBoxStatic(inst);
    }
  };
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMax, 5, bounds.zMin),
    0
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 5, bounds.zMax),
    new BABYLON.Vector3(bounds.xMax, 5, bounds.zMax),
    0
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMin, 5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMin, 5, bounds.zMax),
    Math.PI / 2
  );
  placeWallRun(
    new BABYLON.Vector3(bounds.xMax, 5, bounds.zMin),
    new BABYLON.Vector3(bounds.xMax, 5, bounds.zMax),
    Math.PI / 2
  );

  // --- Buildings: one skyline cluster (several low-poly skyscrapers already
  // composed together in the source file) loaded once as a hidden template, then
  // clone()d into each of the 9 blocks. Unlike the pedestrian pack, this is a
  // plain static mesh hierarchy with no skeleton — clone() is safe here (the
  // skinned-mesh clone bug documented elsewhere in this file's history doesn't
  // apply to non-rigged meshes). Also unlike the traffic-car/pedestrian packs,
  // nothing is picked OUT of the hierarchy here — the whole "__root__" wrapper is
  // cloned as one unit, so any axis-correction transform nested inside it (this
  // pack is Sketchfab-sourced too, same RigBake lineage as the bridge/pedestrians)
  // stays intact automatically; there's no reparenting-out step that could lose it. */
  const loadBuildings = async () => {
    const result = await ImportMeshAsync(CITY_SKYLINE_URL, scene);
    if (isDisposed) {
      for (const mesh of result.meshes) mesh.dispose();
      return;
    }
    const template = result.meshes.find((m) => m.name === "__root__") ?? result.meshes[0];
    if (!template) return;
    template.setEnabled(false);
    template.parent = root;

    let instanceIndex = 0;
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        instanceIndex++;
        const clone = template.clone(`cityBuilding${instanceIndex}`, root, false);
        if (!clone) continue;
        clone.setEnabled(true);
        // This Sketchfab-sourced scene bundles two non-building leftovers from the
        // original viewer export, found by comparing each sub-mesh's bounding size
        // (the genuine skyscraper "Cube*" meshes are all 1.5-2.6 units wide/deep,
        // consistent with a real low-poly tower): a 42x42 "Plane" (the scene's own
        // ground plate) and a 37-wide, 17-tall "Sphere" (an environment/background
        // dome) — without excluding these, the dome swallows the whole cluster
        // once uniformly scaled, and the actual buildings read as background noise
        // next to a giant reflective sphere. Disposed before measuring bounds so
        // neither skews the scale-to-fit-block math below.
        for (const child of clone.getChildMeshes()) {
          if (/\.(Plane|Sphere)_/.test(child.name)) child.dispose();
          else child.isPickable = false;
        }

        clone.computeWorldMatrix(true);
        const rawBounds = clone.getHierarchyBoundingVectors(true);
        const rawSize = rawBounds.max.subtract(rawBounds.min);
        clone.scaling.scaleInPlace(BUILDING_TARGET_SIZE / (Math.max(rawSize.x, rawSize.z) || 1));

        const yaw = (instanceIndex % 4) * (Math.PI / 2);
        if (clone.rotationQuaternion) {
          clone.rotationQuaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), yaw).multiply(
            clone.rotationQuaternion
          );
        } else {
          clone.rotation.y = yaw;
        }

        clone.computeWorldMatrix(true);
        const placedBounds = clone.getHierarchyBoundingVectors(true);
        const center = placedBounds.min.add(placedBounds.max).scale(0.5);
        clone.position.x += bx - center.x;
        clone.position.z += bz - center.z;
        clone.position.y -= placedBounds.min.y;

        // A single box collider approximating the placed cluster's footprint —
        // cheap, and doesn't need to hug the jagged visual mesh exactly (same
        // spirit as world.ts's addBoxStatic on simple track pieces).
        clone.computeWorldMatrix(true);
        const finalBounds = clone.getHierarchyBoundingVectors(true);
        const colliderSize = finalBounds.max.subtract(finalBounds.min);
        const collider = BABYLON.MeshBuilder.CreateBox(
          `cityBuildingCollider${instanceIndex}`,
          { width: colliderSize.x * 0.85, height: colliderSize.y, depth: colliderSize.z * 0.85 },
          scene
        );
        collider.position = finalBounds.min.add(finalBounds.max).scale(0.5);
        collider.isVisible = false;
        collider.isPickable = false;
        collider.parent = root;
        addBoxStatic(collider);
      }
    }
  };
  void loadBuildings();

  return {
    dispose() {
      isDisposed = true;
      for (const aggregate of aggregates) aggregate.dispose();
      root.dispose(false, true);
      roadMat.dispose();
      boundaryMat.dispose();
    },
  };
}

/** Where the player spawns for this map — on the x=0 road, just south of the
 *  grid, facing north into it (the car's default forward is +z, same as the
 *  test track's own spawn). GRID_LINES/ROAD_WIDTH stay exported in case a later
 *  pass (traffic AI, street props) needs the same grid math `game.ts` doesn't. */
export const CITY_SPAWN = new BABYLON.Vector3(GRID_LINES[0], 2, -15);
export { GRID_LINES, ROAD_WIDTH };
