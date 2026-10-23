import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

const MODEL_URL = `${import.meta.env.BASE_URL}models/nissan-300zx.glb`;
/** The body shell's paint material in the source glTF — confirmed by raycasting the
 *  live rendered scene (scene.pick) against the actual hood/door/fender pixels and
 *  reading back the hit mesh's material name. Guessing this from the raw glTF JSON's
 *  baseColor values or by eye (Material.004 turned out to be the wheels, not the body)
 *  isn't reliable for this file — the materials carry no semantic names. */
const BODY_PAINT_MATERIAL_NAME = "Material.001";

/** Finds the body paint material among a freshly-imported car's meshes, if present. */
export function findBodyPaintMaterial(meshes: BABYLON.AbstractMesh[]): BABYLON.PBRMaterial | null {
  for (const mesh of meshes) {
    if (mesh.material?.name === BODY_PAINT_MATERIAL_NAME) {
      return mesh.material as BABYLON.PBRMaterial;
    }
  }
  return null;
}

export function applyBodyColor(meshes: BABYLON.AbstractMesh[], hexColor: string) {
  const paint = findBodyPaintMaterial(meshes);
  if (paint) paint.albedoColor = BABYLON.Color3.FromHexString(hexColor);
}

/** The license plate's material — confirmed the same way as the body paint, by giving
 *  it a bright emissive color and screenshotting the rendered car rather than trusting
 *  the glTF's material name alone (it happens to match here, but that's luck, not a
 *  rule this file's other material names follow). Only one mesh (`Object_18`) matches
 *  this material by name, but the front and rear plates both render the swapped-in
 *  texture — they apparently share one material instance in the source model — so one
 *  swap covers both without any extra plumbing. */
const PLATE_MATERIAL_NAME = "numberplate.001";
const PLATE_TEXTURE_NAME = "plateTex";

function findPlateMaterial(meshes: BABYLON.AbstractMesh[]): BABYLON.PBRMaterial | null {
  for (const mesh of meshes) {
    if (mesh.material?.name === PLATE_MATERIAL_NAME) {
      return mesh.material as BABYLON.PBRMaterial;
    }
  }
  return null;
}

function sanitizePlateText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 8);
}

function buildPlateTexture(scene: BABYLON.Scene, text: string): BABYLON.DynamicTexture {
  const width = 512;
  const height = 256;
  const texture = new BABYLON.DynamicTexture(PLATE_TEXTURE_NAME, { width, height }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;

  ctx.fillStyle = "#e9e5d6";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#17171a";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = "#17171a";
  ctx.font = "bold 108px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sanitizePlateText(text) || "STUNT", width / 2, height / 2 + 10);

  texture.update();
  return texture;
}

/** Swaps in a freshly-drawn plate texture. Safe to call repeatedly (e.g. live, per
 *  keystroke, on the menu preview car) — only disposes a texture this function itself
 *  created, never the model's original baked-in plate art. */
export function applyPlateText(scene: BABYLON.Scene, meshes: BABYLON.AbstractMesh[], text: string) {
  const plate = findPlateMaterial(meshes);
  if (!plate) return;
  const previous = plate.albedoTexture;
  plate.albedoTexture = buildPlateTexture(scene, text);
  if (previous && previous.name === PLATE_TEXTURE_NAME) previous.dispose();
}

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
  groundClearance: number,
  bodyColorHex?: string,
  plateText?: string
): Promise<CarVisual> {
  const result = await ImportMeshAsync(MODEL_URL, scene);
  const root = new BABYLON.TransformNode("carVisualRoot", scene);

  for (const mesh of result.meshes) {
    if (mesh.parent === null) {
      mesh.parent = root;
    }
  }

  if (bodyColorHex) applyBodyColor(result.meshes, bodyColorHex);
  if (plateText) applyPlateText(scene, result.meshes, plateText);

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
