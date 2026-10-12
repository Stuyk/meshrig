import type {
  Bone,
  MeshPart,
  ObjectWeights,
  RigSpec,
  SkinResult,
  SkinSettings,
  Vec3
} from './types'
import { DEFAULT_SKIN } from './types'
import { makeBone } from './skeleton'
import { dist } from './vec'
import type { TemplateOptions } from './templates'

/**
 * Opening a .blend: Blender (meshrig_load.py) writes meta.json and raw
 * binaries into a temp folder; this turns them into MeshParts, and any
 * armature already in the file into an editable skeleton.
 */

interface MetaObject {
  name: string
  file: string
  vertexCount: number
  triangleCount: number
  offsets: { positions: number; triangles: number; triMat: number; uvs?: number; normals?: number }
  materials: { name: string; color: [number, number, number, number]; texture: string | null }[]
  modifiers: string[]
  visible: boolean
  parent: string | null
  parentBone: string | null
  weights: string | null
  shapeKeys: boolean
}

interface MetaBone {
  name: string
  head: Vec3
  tail: Vec3
  z: Vec3
  parent: string | null
  connected: boolean
  deform: boolean
}

interface Meta {
  error?: string
  blender: string
  objects: MetaObject[]
  armature: {
    name: string
    bones: MetaBone[]
    ik: { owner: string; target: string; pole: string | null; chain: number }[]
    spec: string | null
  } | null
  warnings: string[]
}

/** What MeshRig stores on the armature, so a rig reopens exactly as edited. */
export interface SavedSpec extends RigSpec {
  version: 1
  skin?: SkinSettings
  template?: Partial<TemplateOptions>
}

export interface RigDocument {
  /** The file you opened, which a save writes into. */
  blendPath: string
  /**
   * The file Blender reads meshes from: the same as blendPath, or a working
   * copy after joining objects. Vertex order here is what the weights follow.
   */
  sourcePath: string
  parts: MeshPart[]
  /** Name of the armature in the file, which a save rebuilds. */
  armatureName: string | null
  /** The file's armature was made by MeshRig (its spec restored). */
  fromMeshRig: boolean
  spec: RigSpec
  skin: SkinSettings
  template: Partial<TemplateOptions> | null
  /** Weights already in the file, mapped to the skeleton above. */
  weights: SkinResult | null
  /** Objects with a Mirror modifier (their weights mirror by .L/.R names). */
  mirrorModifiers: string[]
  blenderVersion: string
}

const NONE = 65535

async function fetchBuffer(path: string): Promise<ArrayBuffer> {
  const res = await fetch(window.api.assetUrl(path))
  if (!res.ok) {
    throw new Error(`Could not read ${path}`)
  }
  return res.arrayBuffer()
}

function join(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir}${sep}${name}`
}

function partFrom(o: MetaObject, buf: ArrayBuffer, dir: string): MeshPart {
  const V = o.vertexCount
  const T = o.triangleCount
  return {
    name: o.name,
    positions: new Float32Array(buf, o.offsets.positions, V * 3),
    triangles: new Uint32Array(buf, o.offsets.triangles, T * 3),
    triMat: new Uint32Array(buf, o.offsets.triMat, T),
    uvs: o.offsets.uvs !== undefined ? new Float32Array(buf, o.offsets.uvs, T * 6) : null,
    normals:
      o.offsets.normals !== undefined ? new Float32Array(buf, o.offsets.normals, T * 9) : null,
    materials: o.materials.map((m) => ({ ...m, texture: m.texture ? join(dir, m.texture) : null })),
    visibleInBlender: o.visible,
    modifiers: o.modifiers,
    hasShapeKeys: o.shapeKeys
  }
}

/**
 * A skeleton from an armature MeshRig didn't make. Its IK becomes IK
 * settings, and the target/pole bones that only served that IK are dropped,
 * since a save generates them again.
 */
function importArmature(arm: NonNullable<Meta['armature']>): {
  bones: Bone[]
  idByName: Map<string, string>
} {
  const controlNames = new Set<string>()
  const ikByOwner = new Map(arm.ik.map((k) => [k.owner, k]))
  const metaByName = new Map(arm.bones.map((b) => [b.name, b]))
  for (const k of arm.ik) {
    for (const n of [k.target, k.pole]) {
      const b = n ? metaByName.get(n) : undefined
      // Only drop it when nothing deforming hangs off it.
      if (b && !b.deform && !arm.bones.some((x) => x.parent === b.name && x.deform)) {
        controlNames.add(b.name)
      }
    }
  }
  const idByName = new Map<string, string>()
  const bones: Bone[] = []
  for (const m of arm.bones) {
    if (controlNames.has(m.name)) {
      continue
    }
    const b = makeBone({
      name: m.name,
      head: m.head,
      tail: m.tail,
      deform: m.deform,
      connected: m.connected,
      zAxis: m.z
    })
    idByName.set(m.name, b.id)
    bones.push(b)
  }
  for (const b of bones) {
    const m = metaByName.get(b.name)!
    b.parent = m.parent && idByName.has(m.parent) ? idByName.get(m.parent)! : null
    if (!b.parent) {
      b.connected = false
    }
    const ik = ikByOwner.get(b.name)
    if (ik) {
      const target = metaByName.get(ik.target)
      const child = bones.find((c) => c.parent === b.id && dist(c.head, b.tail) < 1e-4)
      b.ik = {
        chain: Math.max(1, ik.chain || 2),
        pole: ik.pole ? 'auto' : 'none',
        follow: !!child && !!target && dist(target.head, child.head) < 1e-3
      }
    }
  }
  return { bones, idByName }
}

/**
 * Opens `sourcePath` with Blender. `blendPath` is the file it stands for, when
 * `sourcePath` is a working copy (after a join).
 */
export async function openRigDocument(
  sourcePath: string,
  blendPath = sourcePath
): Promise<RigDocument> {
  const res = await window.api.openBlend(sourcePath)
  if (!res.ok || !res.dir || !res.metaJson) {
    throw new Error(res.error ?? 'Blender could not read the file')
  }
  const meta = JSON.parse(res.metaJson) as Meta
  if (meta.error === 'noMesh') {
    throw new Error('noMesh')
  }
  const dir = res.dir
  const buffers = await Promise.all(meta.objects.map((o) => fetchBuffer(join(dir, o.file))))
  const parts = meta.objects.map((o, i) => partFrom(o, buffers[i], dir))

  let spec: RigSpec = { bones: [], bindings: {}, excluded: [] }
  let skin = DEFAULT_SKIN
  let template: Partial<TemplateOptions> | null = null
  let fromMeshRig = false
  let idByName = new Map<string, string>()
  const arm = meta.armature
  if (arm?.spec) {
    try {
      const saved = JSON.parse(arm.spec) as SavedSpec
      if (saved.version === 1 && Array.isArray(saved.bones)) {
        spec = {
          bones: saved.bones,
          bindings: saved.bindings ?? {},
          excluded: saved.excluded ?? []
        }
        skin = { ...DEFAULT_SKIN, ...saved.skin }
        template = saved.template ?? null
        fromMeshRig = true
        idByName = new Map(spec.bones.map((b) => [b.name, b.id]))
      }
    } catch {
      // A damaged spec: fall back to reading the armature itself.
    }
  }
  if (arm && !fromMeshRig) {
    const imported = importArmature(arm)
    spec = { bones: imported.bones, bindings: {}, excluded: [] }
    idByName = imported.idByName
  }
  // Objects hidden in Blender start out of the rig; usually helpers or references.
  if (!fromMeshRig) {
    spec.excluded = meta.objects.filter((o) => !o.visible).map((o) => o.name)
    // Objects parented to a bone in Blender (Ctrl+P > Bone) follow it rigidly:
    // that's an attachment here, shown and editable like one.
    for (const o of meta.objects) {
      const bone = o.parentBone && o.parent === arm?.name ? idByName.get(o.parentBone) : undefined
      if (bone) {
        spec.bindings[o.name] = bone
      }
    }
    // Bone parenting works with any bone; MeshRig's vertex groups need deforming ones.
    const carrying = new Set(Object.values(spec.bindings))
    spec.bones = spec.bones.map((b) =>
      carrying.has(b.id) && !b.deform ? { ...b, deform: true } : b
    )
  }

  // Weights already in the file.
  let weights: SkinResult | null = null
  if (arm) {
    const boneIds = arm.bones.map((b) => idByName.get(b.name) ?? '')
    const objects = new Map<string, ObjectWeights>()
    await Promise.all(
      meta.objects.map(async (o) => {
        if (!o.weights) {
          return
        }
        const buf = await fetchBuffer(join(dir, o.weights))
        const V = o.vertexCount
        const index = new Uint16Array(buf, 0, V * 4).slice()
        const weight = new Float32Array(buf, V * 8, V * 4).slice()
        // Influences on bones the editor doesn't know (dropped controls) go.
        for (let i = 0; i < index.length; i++) {
          if (index[i] !== NONE && !boneIds[index[i]]) {
            index[i] = NONE
            weight[i] = 0
          }
        }
        objects.set(o.name, { index, weight })
      })
    )
    if (objects.size > 0) {
      weights = { boneIds, objects, signature: '', source: 'file', unweighted: 0 }
    }
  }

  return {
    blendPath,
    sourcePath,
    parts,
    armatureName: arm?.name ?? null,
    fromMeshRig,
    spec,
    skin,
    template,
    weights,
    mirrorModifiers: meta.warnings.filter((w) => w.startsWith('mirror:')).map((w) => w.slice(7)),
    blenderVersion: meta.blender
  }
}

/** Reads Blender's bone-heat result (weights_<i>.bin per object, bones.json). */
export async function readHeatWeights(
  dir: string,
  parts: MeshPart[]
): Promise<{ names: string[]; objects: (ObjectWeights | null)[] }> {
  const names = JSON.parse(
    await (await fetch(window.api.assetUrl(join(dir, 'bones.json')))).text()
  ) as string[]
  const objects = await Promise.all(
    parts.map(async (p, i) => {
      try {
        const buf = await fetchBuffer(join(dir, `weights_${i}.bin`))
        const V = p.positions.length / 3
        return {
          index: new Uint16Array(buf, 0, V * 4).slice(),
          weight: new Float32Array(buf, V * 8, V * 4).slice()
        }
      } catch {
        return null
      }
    })
  )
  return { names, objects }
}
