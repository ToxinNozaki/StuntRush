import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

const MODEL_URL = `${import.meta.env.BASE_URL}models/nissan-300zx.glb`;

export interface CarVisual {
  root: BABYLON.TransformNode;
  allMeshes: BABYLON.AbstractMesh[];
  headlightLights: BABYLON.SpotLight[];
  /** Local offsets (chassis space, identity-rotation reference) for the two headlights. */
  headlightLocalOffsets: [BABYLON.Vector3, BABYLON.Vector3];
  taillightMaterial: BABYLON.StandardMaterial;
  headlightMaterial: BABYLON.StandardMaterial;
}

/**
 * Imports the car's visual mesh and parents it to the (invisible) physics chassis,
 * then adds working head/tail lights: small emissive lenses (parented, so they track
 * the chassis for free) plus real SpotLights for the headlights (lights don't inherit
 * parent transforms in Babylon, so those get repositioned every frame by the caller).
 */
export async function attachCarVisual(
  scene: BABYLON.Scene,
  chassis: BABYLON.Mesh,
  targetLength: number,
  groundClearance: number
): Promise<CarVisual> {
  const result = await ImportMeshAsync(MODEL_URL, scene);
  const root = new BABYLON.TransformNode("carVisualRoot", scene);

  for (const mesh of result.meshes) {
    if (mesh.parent === null) {
      mesh.parent = root;
    }
  }

  root.parent = chassis;
  root.position.setAll(0);
  root.scaling.setAll(1);

  const bounds = root.getHierarchyBoundingVectors(true);
  const size = bounds.max.subtract(bounds.min);
  const modelLength = Math.max(size.x, size.z) || 1;
  const scale = targetLength / modelLength;
  root.scaling.setAll(scale);

  const scaledBounds = root.getHierarchyBoundingVectors(true);
  const scaledCenter = scaledBounds.min.add(scaledBounds.max).scale(0.5);
  const chassisWorldPos = chassis.getAbsolutePosition();

  // Center the model horizontally on the chassis, and drop it so its lowest point
  // sits `groundClearance` below the chassis center (roughly where the wheels are).
  root.position.x = chassisWorldPos.x - scaledCenter.x;
  root.position.z = chassisWorldPos.z - scaledCenter.z;
  root.position.y = chassisWorldPos.y - scaledBounds.min.y - groundClearance;

  chassis.isVisible = false;

  // Final world bounds, now that the model is actually in place, converted to
  // chassis-local offsets (chassis has identity rotation right now, at attach time).
  const finalBounds = root.getHierarchyBoundingVectors(true);
  const finalSize = finalBounds.max.subtract(finalBounds.min);
  const local = (world: BABYLON.Vector3) => world.subtract(chassisWorldPos);

  // Front = +Z, rear = -Z, matching the forward convention used everywhere else
  // (VehicleController steers/drives along BABYLON.Vector3.Forward()). Length is
  // read off the model's own bounding box (reliable); lateral placement is NOT —
  // a single-sided mirror or antenna skews the raw bounding box off-center, so X
  // comes from the chassis's own known half-width instead, which is symmetric by
  // construction.
  const frontZ = local(new BABYLON.Vector3(0, 0, finalBounds.max.z)).z;
  const rearZ = local(new BABYLON.Vector3(0, 0, finalBounds.min.z)).z;
  const halfTrackWidth = 0.6;
  const lampY = local(new BABYLON.Vector3(0, finalBounds.min.y + finalSize.y * 0.33, 0)).y;

  const headlightMaterial = new BABYLON.StandardMaterial("headlightLensMat", scene);
  headlightMaterial.disableLighting = true;
  headlightMaterial.emissiveColor = new BABYLON.Color3(1, 0.96, 0.85);

  const taillightMaterial = new BABYLON.StandardMaterial("taillightLensMat", scene);
  taillightMaterial.disableLighting = true;
  taillightMaterial.emissiveColor = new BABYLON.Color3(0.15, 0, 0);

  const lampSize = { width: finalSize.x * 0.12, height: finalSize.y * 0.07, depth: 0.04 };
  const headlightLocalOffsets: [BABYLON.Vector3, BABYLON.Vector3] = [
    new BABYLON.Vector3(-halfTrackWidth, lampY, frontZ - 0.02),
    new BABYLON.Vector3(halfTrackWidth, lampY, frontZ - 0.02),
  ];
  const taillightLocalOffsets: [BABYLON.Vector3, BABYLON.Vector3] = [
    new BABYLON.Vector3(-halfTrackWidth, lampY, rearZ + 0.02),
    new BABYLON.Vector3(halfTrackWidth, lampY, rearZ + 0.02),
  ];

  const makeLamp = (name: string, offset: BABYLON.Vector3, material: BABYLON.StandardMaterial) => {
    const lamp = BABYLON.MeshBuilder.CreateBox(
      name,
      { width: lampSize.width, height: lampSize.height, depth: lampSize.depth },
      scene
    );
    lamp.material = material;
    lamp.parent = chassis;
    lamp.position.copyFrom(offset);
    lamp.isPickable = false;
    return lamp;
  };

  const headlightMeshes = headlightLocalOffsets.map((offset, i) =>
    makeLamp(`headlightLens${i}`, offset, headlightMaterial)
  );
  const taillightMeshes = taillightLocalOffsets.map((offset, i) =>
    makeLamp(`taillightLens${i}`, offset, taillightMaterial)
  );

  const headlightLights = headlightLocalOffsets.map((_, i) => {
    const light = new BABYLON.SpotLight(
      `headlight${i}`,
      BABYLON.Vector3.Zero(),
      BABYLON.Vector3.Forward(),
      Math.PI / 4,
      6,
      scene
    );
    light.diffuse = new BABYLON.Color3(1, 0.96, 0.88);
    light.specular = new BABYLON.Color3(1, 1, 1);
    light.intensity = 25;
    light.range = 35;
    return light;
  });

  return {
    root,
    allMeshes: [...result.meshes, ...headlightMeshes, ...taillightMeshes],
    headlightLights,
    headlightLocalOffsets,
    taillightMaterial,
    headlightMaterial,
  };
}
