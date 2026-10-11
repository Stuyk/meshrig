import * as THREE from 'three'
import type { Bone, BoneRole, MeshPart, SkinResult } from '../rig/types'
import { boneFrame, buildControls, chainLength, followBone, ikMembership } from '../rig/controls'
import { chainUp, mirrorName, sideOf, sortedByDepth } from '../rig/skeleton'

/**
 * Test posing: the rig as Blender will deform it, built from three.js bones
 * and skinned meshes, for dragging limbs around and running a stress test.
 * Nothing here is saved; it's for checking the weights and the skeleton.
 *
 * Bones use Blender's frame (Y along the bone, Z the roll axis) in Blender
 * space, inside the engine's Z-up root group.
 */

export interface PoseRig {
  bones: Map<string, THREE.Bone>
  /** Editor bone data by id, as it was when this was built. */
  data: Map<string, Bone>
  skeleton: THREE.Skeleton
  meshes: THREE.SkinnedMesh[]
  rest: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>
  /** IK chains by owner id: chain (top first), follow bone, pole point in Blender space. */
  ik: Map<string, { chain: Bone[]; follow: Bone | null; pole: THREE.Vector3 | null; reach: number }>
  /** Bone id -> the IK owner that drives it. */
  driven: Map<string, string>
}

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()

function restMatrix(bones: Bone[], b: Bone, membership: Map<string, Bone>): THREE.Matrix4 {
  const f = boneFrame(bones, b, membership)
  return new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z))
    .setPosition(...b.head)
}

/**
 * Builds the posable rig under `root` (the engine's Blender-space group).
 * `geometries` are the display geometries by part name, with `cornerVertex`
 * mapping each corner back to its Blender vertex.
 */
export function buildPoseRig(
  root: THREE.Object3D,
  bones: Bone[],
  parts: MeshPart[],
  weights: SkinResult,
  displays: Map<
    string,
    {
      geometry: THREE.BufferGeometry
      cornerVertex: Uint32Array
      material: THREE.Material | THREE.Material[]
    }
  >
): PoseRig {
  const membership = ikMembership(bones)
  const three = new Map<string, THREE.Bone>()
  const restWorld = new Map<string, THREE.Matrix4>()
  const rest = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>()
  for (const b of sortedByDepth(bones)) {
    const tb = new THREE.Bone()
    tb.name = b.name
    const world = restMatrix(bones, b, membership)
    restWorld.set(b.id, world)
    const parentWorld = b.parent ? restWorld.get(b.parent) : undefined
    const local = parentWorld ? parentWorld.clone().invert().multiply(world) : world.clone()
    local.decompose(tb.position, tb.quaternion, tb.scale)
    const parent = b.parent ? three.get(b.parent) : undefined
    ;(parent ?? root).add(tb)
    three.set(b.id, tb)
    rest.set(b.id, { position: tb.position.clone(), quaternion: tb.quaternion.clone() })
  }
  root.updateMatrixWorld(true)
  const order = bones.map((b) => three.get(b.id)!)
  const skeleton = new THREE.Skeleton(order)
  const indexOfId = new Map(bones.map((b, i) => [b.id, i]))
  const remap = weights.boneIds.map((id) => indexOfId.get(id) ?? 0)

  const meshes: THREE.SkinnedMesh[] = []
  for (const part of parts) {
    const w = weights.objects.get(part.name)
    const disp = displays.get(part.name)
    if (!w || !disp) {
      continue
    }
    const g = disp.geometry.clone()
    const { si, sw } = skinAttributes(disp.cornerVertex, w, remap)
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
    const mesh = new THREE.SkinnedMesh(g, disp.material)
    // Named after its part, so the engine can swap its material like the original's.
    mesh.name = part.name
    mesh.frustumCulled = false
    root.add(mesh)
    mesh.updateMatrixWorld(true)
    mesh.bind(skeleton, mesh.matrixWorld)
    meshes.push(mesh)
  }

  const controls = buildControls(bones)
  const ik = new Map<
    string,
    { chain: Bone[]; follow: Bone | null; pole: THREE.Vector3 | null; reach: number }
  >()
  const driven = new Map<string, string>()
  for (const b of bones) {
    if (!b.ik) {
      continue
    }
    const chain = chainUp(bones, b.id, b.ik.chain).reverse()
    const handle = controls.handles.get(b.id)
    ik.set(b.id, {
      chain,
      follow: followBone(bones, b),
      pole: handle?.pole ? new THREE.Vector3(...handle.pole) : null,
      reach: chainLength(bones, b)
    })
    for (const c of chain) {
      driven.set(c.id, b.id)
    }
  }
  return {
    bones: three,
    data: new Map(bones.map((b) => [b.id, b])),
    skeleton,
    meshes,
    rest,
    ik,
    driven
  }
}

/** Per-corner skin index/weight attributes from per-vertex weights. */
function skinAttributes(
  cornerVertex: Uint32Array,
  w: { index: Uint16Array; weight: Float32Array },
  remap: number[]
): { si: Uint16Array; sw: Float32Array } {
  const n = cornerVertex.length
  const si = new Uint16Array(n * 4)
  const sw = new Float32Array(n * 4)
  for (let c = 0; c < n; c++) {
    const v = cornerVertex[c]
    for (let k = 0; k < 4; k++) {
      const b = w.index[v * 4 + k]
      const live = b !== 65535
      si[c * 4 + k] = live ? remap[b] : 0
      sw[c * 4 + k] = live ? w.weight[v * 4 + k] : 0
    }
  }
  return { si, sw }
}

export function disposePoseRig(r: PoseRig, root: THREE.Object3D): void {
  for (const m of r.meshes) {
    root.remove(m)
    m.geometry.dispose()
    m.skeleton.dispose()
  }
  for (const b of r.bones.values()) {
    b.parent?.remove(b)
  }
}

export function resetPose(r: PoseRig): void {
  for (const [id, s] of r.rest) {
    const b = r.bones.get(id)!
    b.position.copy(s.position)
    b.quaternion.copy(s.quaternion)
  }
}

/** World-space head and tail of a posed bone. */
export function boneEnds(r: PoseRig, id: string): { head: THREE.Vector3; tail: THREE.Vector3 } {
  const b = r.bones.get(id)!
  const d = r.data.get(id)!
  const len = Math.hypot(d.tail[0] - d.head[0], d.tail[1] - d.head[1], d.tail[2] - d.head[2])
  b.updateWorldMatrix(true, false)
  const head = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)
  const tail = new THREE.Vector3(0, len, 0).applyMatrix4(b.matrixWorld)
  return { head, tail }
}

/** Turns a bone (about its head) so its tail points at a world point. */
export function aimAt(r: PoseRig, id: string, target: THREE.Vector3): void {
  const b = r.bones.get(id)!
  const { head, tail } = boneEnds(r, id)
  const from = _v.copy(tail).sub(head).normalize()
  const to = _v2.copy(target).sub(head)
  if (to.lengthSq() < 1e-12) {
    return
  }
  to.normalize()
  _q.setFromUnitVectors(from, to)
  b.getWorldQuaternion(_q2)
  const world = _q.multiply(_q2)
  const parentWorld = new THREE.Quaternion()
  b.parent?.getWorldQuaternion(parentWorld)
  b.quaternion.copy(parentWorld.invert().multiply(world))
  b.updateMatrixWorld(true)
}

/** Moves a parentless bone so its head lands on a world point. */
export function moveRoot(r: PoseRig, id: string, target: THREE.Vector3): void {
  const b = r.bones.get(id)!
  const local = b.parent ? b.parent.worldToLocal(target.clone()) : target.clone()
  b.position.copy(local)
  b.updateMatrixWorld(true)
}

/**
 * Solves an IK chain so the owner's tail reaches `target` (world), bending
 * toward the pole. Two-bone chains are solved exactly; longer ones with
 * FABRIK. The follow bone (hand, foot) keeps its world rotation.
 */
export function solveIk(
  r: PoseRig,
  ownerId: string,
  target: THREE.Vector3,
  root: THREE.Object3D
): void {
  const spec = r.ik.get(ownerId)
  if (!spec) {
    return
  }
  const followQuat = spec.follow
    ? r.bones.get(spec.follow.id)!.getWorldQuaternion(new THREE.Quaternion())
    : null
  const chain = spec.chain
  const pts = chain.map((c) => boneEnds(r, c.id).head)
  pts.push(boneEnds(r, ownerId).tail)
  const lens = chain.map((_, i) => pts[i].distanceTo(pts[i + 1]))
  const total = lens.reduce((a, b) => a + b, 0)
  const base = pts[0].clone()
  const goal = target.clone()
  const toGoal = goal.clone().sub(base)
  if (toGoal.length() > total * 0.9999) {
    toGoal.setLength(total * 0.9999)
    goal.copy(base).add(toGoal)
  }
  const pole = spec.pole ? spec.pole.clone().applyMatrix4(root.matrixWorld) : null

  if (chain.length === 2) {
    const a = lens[0]
    const b = lens[1]
    const d = Math.max(1e-6, goal.distanceTo(base))
    const dir = goal.clone().sub(base).normalize()
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)
    let bend = (pole ?? pts[1]).clone().sub(base)
    bend.addScaledVector(dir, -bend.dot(dir))
    if (bend.lengthSq() < 1e-12) {
      bend = new THREE.Vector3(0, 0, 1).cross(dir)
    }
    bend.normalize()
    pts[1] = base
      .clone()
      .addScaledVector(dir, a * cosA)
      .addScaledVector(bend, a * Math.sqrt(1 - cosA * cosA))
    pts[2] = goal
  } else {
    // FABRIK, starting from a chain nudged toward the pole.
    if (pole) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i].lerp(pole, 0.05)
      }
    }
    for (let it = 0; it < 16; it++) {
      pts[pts.length - 1].copy(goal)
      for (let i = pts.length - 2; i >= 0; i--) {
        const dir = pts[i]
          .clone()
          .sub(pts[i + 1])
          .normalize()
        pts[i].copy(pts[i + 1]).addScaledVector(dir, lens[i])
      }
      pts[0].copy(base)
      for (let i = 1; i < pts.length; i++) {
        const dir = pts[i]
          .clone()
          .sub(pts[i - 1])
          .normalize()
        pts[i].copy(pts[i - 1]).addScaledVector(dir, lens[i - 1])
      }
      if (pts[pts.length - 1].distanceTo(goal) < total * 1e-4) {
        break
      }
    }
  }
  for (let i = 0; i < chain.length; i++) {
    aimAt(r, chain[i].id, pts[i + 1])
  }
  if (spec.follow && followQuat) {
    const fb = r.bones.get(spec.follow.id)!
    const parentWorld = new THREE.Quaternion()
    fb.parent?.getWorldQuaternion(parentWorld)
    fb.quaternion.copy(parentWorld.invert().multiply(followQuat))
    fb.updateMatrixWorld(true)
  }
}

// --- stress test --------------------------------------------------------------------------

interface Move {
  /** Bone ids moved together (a bone and its twin). */
  ids: string[]
  axis: 'x' | 'y' | 'z'
  degrees: number
  /** Bend one way only (0 -> amount -> 0) instead of both ways. */
  oneWay: boolean
}

const MOVES: Partial<
  Record<BoneRole, { axis: 'x' | 'y' | 'z'; degrees: number; oneWay?: boolean }[]>
> = {
  hips: [{ axis: 'y', degrees: 25 }],
  spine: [
    { axis: 'x', degrees: 25 },
    { axis: 'z', degrees: 20 }
  ],
  chest: [
    { axis: 'x', degrees: 25 },
    { axis: 'y', degrees: 30 }
  ],
  neck: [{ axis: 'x', degrees: 25 }],
  head: [
    { axis: 'x', degrees: 30 },
    { axis: 'y', degrees: 45 }
  ],
  jaw: [{ axis: 'x', degrees: 25, oneWay: true }],
  shoulder: [{ axis: 'z', degrees: 20 }],
  arm: [
    { axis: 'z', degrees: 70 },
    { axis: 'x', degrees: 60 }
  ],
  forearm: [{ axis: 'x', degrees: -110, oneWay: true }],
  hand: [{ axis: 'x', degrees: 50 }],
  finger: [{ axis: 'x', degrees: -70, oneWay: true }],
  thigh: [
    { axis: 'x', degrees: 60 },
    { axis: 'z', degrees: 35 }
  ],
  shin: [{ axis: 'x', degrees: -110, oneWay: true }],
  foot: [{ axis: 'x', degrees: 35 }],
  toe: [{ axis: 'x', degrees: 30 }],
  tail: [
    { axis: 'x', degrees: 35 },
    { axis: 'z', degrees: 35 }
  ],
  wing: [{ axis: 'z', degrees: 50 }],
  part: [
    { axis: 'x', degrees: 40 },
    { axis: 'z', degrees: 40 }
  ],
  other: [
    { axis: 'x', degrees: 35 },
    { axis: 'z', degrees: 35 }
  ]
}

/** A range-of-motion sequence: every bone bends in turn, twins together. */
export function stressMoves(bones: Bone[]): Move[] {
  const moves: Move[] = []
  const done = new Set<string>()
  const byName = new Map(bones.map((b) => [b.name, b]))
  // Spine first, then outward, the way you'd check a rig by hand.
  for (const b of sortedByDepth(bones)) {
    if (done.has(b.id) || !b.deform || b.role === 'root') {
      continue
    }
    const side = sideOf(b.name)
    const otherName = side ? mirrorName(b.name) : null
    const twin = otherName ? byName.get(otherName) : undefined
    done.add(b.id)
    if (twin) {
      done.add(twin.id)
    }
    // Only the left of a pair is listed; the right mirrors it at play time.
    const left = side === 'R' && twin ? twin : b
    const right = side === 'R' && twin ? b : twin
    for (const m of MOVES[b.role] ?? MOVES.other!) {
      moves.push({
        ids: right ? [left.id, right.id] : [left.id],
        axis: m.axis,
        degrees: m.degrees,
        oneWay: !!m.oneWay
      })
    }
  }
  return moves
}

export const MOVE_SECONDS = 1.1

/** Applies the stress test at time `t` (seconds). Returns false once it's over. */
export function applyStress(r: PoseRig, moves: Move[], t: number): boolean {
  resetPose(r)
  const i = Math.floor(t / MOVE_SECONDS)
  if (i >= moves.length) {
    return false
  }
  const m = moves[i]
  const phase = (t % MOVE_SECONDS) / MOVE_SECONDS
  const s = m.oneWay ? Math.sin(phase * Math.PI) : Math.sin(phase * Math.PI * 2)
  const angle = THREE.MathUtils.degToRad(m.degrees * s)
  m.ids.forEach((id, k) => {
    const b = r.bones.get(id)
    if (!b) {
      return
    }
    // Mirrored frames: X turns the same way on both sides, Y and Z flip.
    const sign = k === 1 && m.axis !== 'x' ? -1 : 1
    const axis = new THREE.Vector3(
      m.axis === 'x' ? 1 : 0,
      m.axis === 'y' ? 1 : 0,
      m.axis === 'z' ? 1 : 0
    )
    b.quaternion.multiply(_q.setFromAxisAngle(axis, angle * sign))
  })
  return true
}
