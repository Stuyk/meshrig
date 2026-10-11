/**
 * MeshRig's document model. Everything is in Blender world space (Z up, a
 * character faces -Y), so positions go to and from Blender unchanged.
 */

export type Vec3 = [number, number, number]

/** What a bone is for. Drives roll, IK defaults, the stress test and naming. */
export type BoneRole =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'jaw'
  | 'shoulder'
  | 'arm'
  | 'forearm'
  | 'hand'
  | 'finger'
  | 'thigh'
  | 'shin'
  | 'foot'
  | 'toe'
  | 'tail'
  | 'wing'
  | 'part'
  | 'other'

/** Which way the knee/elbow of an IK chain points. */
export type PoleMode = 'auto' | 'none' | 'forward' | 'back' | 'up' | 'down' | 'left' | 'right'

/**
 * IK on a bone: the bone's tail is the end of the chain (a forearm, a shin).
 * Targets and poles are generated on save, so the skeleton only says what it
 * wants, never how Blender spells it.
 */
export interface IkSettings {
  /** Bones the IK moves, this one included. */
  chain: number
  pole: PoleMode
  /** The child bone (hand, foot) takes its rotation from the IK target. */
  follow: boolean
}

export interface Bone {
  id: string
  name: string
  head: Vec3
  tail: Vec3
  parent: string | null
  /** Head sits on the parent's tail and moves with it. */
  connected: boolean
  /** Skins the mesh. Off for helpers like a root on the ground. */
  deform: boolean
  role: BoneRole
  ik: IkSettings | null
  /** Extra twist about the bone, degrees, on top of the automatic roll. */
  rollOffset: number
  /** World Z axis read from an existing rig; keeps its roll until reset. */
  zAxis: Vec3 | null
}

/** One mesh object as read from the .blend. */
export interface MeshPart {
  name: string
  /** World-space vertex positions, Blender's vertex order. */
  positions: Float32Array
  /** Vertex indices, three per triangle. */
  triangles: Uint32Array
  /** Material slot per triangle. */
  triMat: Uint32Array
  /** Per triangle corner, when the mesh has UVs. */
  uvs: Float32Array | null
  /** Per triangle corner, world space, when Blender gave them. */
  normals: Float32Array | null
  materials: MaterialInfo[]
  visibleInBlender: boolean
  modifiers: string[]
  hasShapeKeys: boolean
}

export interface MaterialInfo {
  name: string
  color: [number, number, number, number]
  /** Absolute path of the exported PNG, if the material has a base colour texture. */
  texture: string | null
}

/** Skin weights for one object: up to four influences per vertex. */
export interface ObjectWeights {
  /** Index into SkinResult.boneIds, 65535 for none. */
  index: Uint16Array
  weight: Float32Array
}

export interface SkinResult {
  boneIds: string[]
  objects: Map<string, ObjectWeights>
  /** The skeleton/settings signature these weights were made for. */
  signature: string
  /** How the weights were made, for the panel. */
  source: SkinMethod | 'file'
  /** Vertices that ended up with no bone (shouldn't happen; shown as a warning). */
  unweighted: number
}

export type SkinMethod = 'auto' | 'heat' | 'rigid' | 'nearest'

export interface SkinSettings {
  method: SkinMethod
  /** Voxel grid cells along the model's longest side. */
  resolution: number
  /** How quickly a bone's influence fades with distance. Higher = sharper joints. */
  falloff: number
  /** Laplacian smoothing passes over the mesh after the weights are made. */
  smoothing: number
  maxInfluences: number
  /** Small loose pieces (eyes, buttons) follow one bone rigidly. */
  rigidSmall: boolean
}

export const DEFAULT_SKIN: SkinSettings = {
  method: 'auto',
  resolution: 80,
  falloff: 4,
  smoothing: 3,
  maxInfluences: 4,
  rigidSmall: true
}

/**
 * Part key: an object name, or `name#island` for one loose piece of it.
 * Bound parts follow one bone rigidly instead of being skinned smoothly.
 */
export type PartKey = string

/** Everything that defines a rig and is worth undoing or saving. */
export interface RigSpec {
  bones: Bone[]
  /** Part key -> bone id. */
  bindings: Record<PartKey, string>
  /** Objects left out of the rig (not skinned, not parented). */
  excluded: string[]
}
