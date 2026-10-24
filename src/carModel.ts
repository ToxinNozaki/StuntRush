import * as BABYLON from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

export const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}models/nissan-300zx.glb`;
/** The body shell's paint material in the source glTF — confirmed by raycasting the
 *  live rendered scene (scene.pick) against the actual hood/door/fender pixels and
 *  reading back the hit mesh's material name. Guessing this from the raw glTF JSON's
 *  baseColor values or by eye (Material.004 turned out to be the wheels, not the body)
 *  isn't reliable for this file — the materials carry no semantic names.
 *
 *  The low-poly "novelty" car (src/cars.ts's `lowpoly` entry) happens to use this same
 *  literal name for its own body shell too — confirmed independently the same way
 *  (emissive-highlight + screenshot), NOT assumed from the name matching. If a future
 *  car uses a different name for its body material, it needs its own constant and a
 *  per-model lookup here — don't assume every model's body paint is "Material.001". */
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

/** Some source models (the Nissan, the Hellcat) bake their glass/light-cover materials
 *  at a very low alpha (0.25-0.4) — fine in the original renderer's lighting setup, but
 *  under ours it reads as "the car has holes in it" rather than tinted glass, since the
 *  same low-alpha material often covers both windows AND exterior light housings. Floors
 *  any already-transparent material up to a minimum opacity rather than forcing all glass
 *  opaque, so real tinted windows still read as glass — just not ghost-glass. */
const MIN_GLASS_ALPHA = 0.55;

export function fixupLowAlphaMaterials(meshes: BABYLON.AbstractMesh[]) {
  const seen = new Set<BABYLON.Material>();
  for (const mesh of meshes) {
    const material = mesh.material as BABYLON.PBRMaterial | null;
    if (!material || seen.has(material)) continue;
    seen.add(material);
    if (material.alpha > 0 && material.alpha < MIN_GLASS_ALPHA) {
      material.alpha = MIN_GLASS_ALPHA;
    }
  }
}

/** The license plate's material — confirmed per-model the same way as the body paint,
 *  by giving a candidate material a bright emissive color and screenshotting the
 *  rendered car rather than trusting the glTF's material name alone. Two real names
 *  confirmed so far: "numberplate.001" (Nissan, Lowpoly — Lowpoly actually has neither,
 *  this just never matches for it, which is fine) and "plate" (the Porsche — it also
 *  has plate_logo1/plate_logo2/plate_red_lamp but those are separate decorative meshes,
 *  not the swappable plate face itself). The Hellcat has no plate geometry or material
 *  at all (checked by inspecting the rear bumper live — just a "DODGE" badge, no plate
 *  recess) — for cars like that, attachCarVisual() adds a synthetic plate quad instead
 *  (see QUAD_PLATE_MATERIAL_NAME below) rather than trying to find something that isn't
 *  there. Only one mesh matches by name on the Nissan (`Object_18`), but the front and
 *  rear plates both render the swapped-in texture — they share one material instance in
 *  the source model — so one swap covers both without any extra plumbing. */
const PLATE_MATERIAL_NAMES = ["numberplate.001", "plate"];
const PLATE_TEXTURE_NAME = "plateTex";
/** The material name given to a synthetic plate quad (see attachPlateQuad) — deliberately
 *  the same as the Nissan's real material, so findPlateMaterial() picks it up for free on
 *  every later applyPlateText() call (live typing, menu preview swap) without needing to
 *  know whether a given car's plate is real model geometry or an added quad. */
const QUAD_PLATE_MATERIAL_NAME = PLATE_MATERIAL_NAMES[0];

export function findPlateMaterial(meshes: BABYLON.AbstractMesh[]): BABYLON.PBRMaterial | null {
  for (const mesh of meshes) {
    if (mesh.material && PLATE_MATERIAL_NAMES.includes(mesh.material.name)) {
      return mesh.material as BABYLON.PBRMaterial;
    }
  }
  return null;
}

/** Adds a small plate-shaped quad to a car that has no plate geometry/material of its
 *  own (confirmed live, not guessed — see the comment above). Named with
 *  QUAD_PLATE_MATERIAL_NAME so every later plate-text update finds it exactly like a
 *  real model material. Position is per-car (see cars.ts's `plateQuad` field) since it's
 *  inherently model-specific — there's no bounding-box trick that reliably finds "where
 *  a plate would go" the way body length/width can be inferred. */
export interface PlateQuadSpec {
  /** Position in the car root's local space (post-scale-to-fit), roughly chassis-relative. */
  offset: [number, number, number];
  rotationY: number;
  width: number;
  height: number;
}

export function attachPlateQuad(scene: BABYLON.Scene, parent: BABYLON.TransformNode, spec: PlateQuadSpec): BABYLON.Mesh {
  const quad = BABYLON.MeshBuilder.CreatePlane(
    "plateQuad",
    { width: spec.width, height: spec.height, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    scene
  );
  const material = new BABYLON.PBRMaterial(QUAD_PLATE_MATERIAL_NAME, scene);
  material.metallic = 0;
  material.roughness = 0.6;
  quad.material = material;
  quad.parent = parent;
  quad.position.set(...spec.offset);
  quad.rotation.y = spec.rotationY;
  // A plane's UVs read left-to-right as seen from its own +Z face; rotating it to
  // face backward (rotationY = PI) swings that face toward the viewer but mirrors
  // the text in the process — flip X to undo that, same way a mirror-image sticker
  // would need to be cut backwards to read correctly once applied to glass from
  // outside. Confirmed by screenshotting the actual rendered plate, not assumed.
  if (Math.abs(spec.rotationY - Math.PI) < 0.01) quad.scaling.x = -1;
  quad.isPickable = false;
  return quad;
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
  /** The lens discs themselves (not their bezels) — hidden/shown by the headlight
   *  toggle so the lamp actually looks off, not just stops casting light. */
  headlightLensMeshes: BABYLON.Mesh[];
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
  plateText?: string,
  modelUrl: string = DEFAULT_MODEL_URL,
  plateQuadSpec?: PlateQuadSpec
): Promise<CarVisual> {
  const result = await ImportMeshAsync(modelUrl, scene);
  const root = new BABYLON.TransformNode("carVisualRoot", scene);

  for (const mesh of result.meshes) {
    if (mesh.parent === null) {
      mesh.parent = root;
    }
  }

  if (bodyColorHex) applyBodyColor(result.meshes, bodyColorHex);
  fixupLowAlphaMaterials(result.meshes);
  const needsPlateQuad = !!plateQuadSpec && !findPlateMaterial(result.meshes);

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

  // Built here (not up by the body-color/alpha fixups above) because its offset is
  // specified in chassis-local units, same coordinate space as the headlight/taillight
  // offsets just below — needs frontZ/rearZ/lampY to already exist.
  let plateQuad: BABYLON.Mesh | null = null;
  if (needsPlateQuad && plateQuadSpec) {
    plateQuad = attachPlateQuad(scene, chassis, plateQuadSpec);
  }
  if (plateText) applyPlateText(scene, [...result.meshes, ...(plateQuad ? [plateQuad] : [])], plateText);

  // Round lenses read as actual lamps; the old flat emissive boxes just looked like
  // glowing squares taped to the bumper. A soft Fresnel rim (bright face-on, fading
  // at the disc's edge) stands in for a real lens's curved-glass highlight instead of
  // the old flat, uniformly-lit square.
  const headlightMaterial = new BABYLON.StandardMaterial("headlightLensMat", scene);
  headlightMaterial.disableLighting = true;
  headlightMaterial.emissiveColor = new BABYLON.Color3(1, 0.95, 0.82);

  const taillightMaterial = new BABYLON.StandardMaterial("taillightLensMat", scene);
  taillightMaterial.disableLighting = true;
  taillightMaterial.emissiveColor = new BABYLON.Color3(0.15, 0, 0);

  const lampRadius = Math.max(finalSize.x * 0.05, finalSize.y * 0.08);
  const headlightLocalOffsets: [BABYLON.Vector3, BABYLON.Vector3] = [
    new BABYLON.Vector3(-halfTrackWidth, lampY, frontZ - 0.02),
    new BABYLON.Vector3(halfTrackWidth, lampY, frontZ - 0.02),
  ];
  const taillightLocalOffsets: [BABYLON.Vector3, BABYLON.Vector3] = [
    new BABYLON.Vector3(-halfTrackWidth, lampY, rearZ + 0.02),
    new BABYLON.Vector3(halfTrackWidth, lampY, rearZ + 0.02),
  ];

  const makeLamp = (
    name: string,
    offset: BABYLON.Vector3,
    material: BABYLON.StandardMaterial,
    facingForward: boolean
  ) => {
    const lens = BABYLON.MeshBuilder.CreateDisc(name, { radius: lampRadius, tessellation: 20 }, scene);
    lens.material = material;
    lens.parent = chassis;
    lens.position.copyFrom(offset);
    lens.rotation.y = facingForward ? 0 : Math.PI;
    lens.isPickable = false;
    return lens;
  };

  const headlightMeshes = headlightLocalOffsets.map((offset, i) =>
    makeLamp(`headlightLens${i}`, offset, headlightMaterial, true)
  );
  const taillightMeshes = taillightLocalOffsets.map((offset, i) =>
    makeLamp(`taillightLens${i}`, offset, taillightMaterial, false)
  );
  const headlightLensMeshes = headlightMeshes;

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
    allMeshes: [...result.meshes, ...headlightMeshes, ...taillightMeshes, ...(plateQuad ? [plateQuad] : [])],
    headlightLights,
    headlightLensMeshes,
    headlightLocalOffsets,
    taillightMaterial,
    headlightMaterial,
  };
}
