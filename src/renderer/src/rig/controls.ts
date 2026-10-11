import type { Bone, BoneRole, IkSettings, PoleMode, Vec3 } from './types'
import { byId, chainUp, childrenOf, mirrorName, sideOf } from './skeleton'
import { add, cross, dist, dot, length, normalize, reject, rotateAbout, scale, sub } from './vec'

/**
 * Bone roll and IK controls. Both are derived from the skeleton rather than
 * edited directly: a bone's roll follows from what it is (an IK limb bends
 * toward its pole), and IK target/pole bones are generated on save.
 */

const LEG_ROLES: BoneRole[] = ['thigh', 'shin', 'foot', 'toe']
const ARM_ROLES: BoneRole[] = ['shoulder', 'arm', 'forearm', 'hand', 'finger']

const POLE_VECTORS: Record<Exclude<PoleMode, 'auto' | 'none'>, Vec3> = {
  // A Blender character faces -Y.
  forward: [0, -1, 0],
  back: [0, 1, 0],
  up: [0, 0, 1],
  down: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0]
}

export function defaultIk(role: BoneRole): IkSettings {
  return { chain: 2, pole: 'auto', follow: role === 'shin' || role === 'forearm' }
}

/**
 * Which way an IK chain's middle joint should point, perpendicular to the
 * chain. 'auto' uses the chain's own bend when it has one, which keeps the
 * rest pose exactly as modelled; a straight chain falls back to forward for
 * legs and back for arms, the way knees and elbows bend.
 */
export function poleDirection(bones: Bone[], owner: Bone): Vec3 | null {
  if (!owner.ik || owner.ik.pole === 'none') {
    return null
  }
  const chain = chainUp(bones, owner.id, Math.max(2, owner.ik.chain))
  if (chain.length < 2) {
    return null
  }
  const start = chain[chain.length - 1].head
  const end = owner.tail
  const axis = normalize(sub(end, start), [0, 0, -1])
  const total = chain.reduce((s, b) => s + dist(b.head, b.tail), 0)

  let preferred: Vec3
  if (owner.ik.pole === 'auto') {
    let bend: Vec3 = [0, 0, 0]
    for (const b of chain.slice(0, -1)) {
      bend = add(bend, reject(sub(b.head, start), axis))
    }
    const roles = chain.map((b) => b.role)
    const arm = roles.some((r) => ARM_ROLES.includes(r))
    const leg = roles.some((r) => LEG_ROLES.includes(r))
    preferred = arm ? POLE_VECTORS.back : POLE_VECTORS.forward
    const bent = length(bend) > total * 0.02
    // Knees bend forward and elbows back. A limb's own bend only counts when
    // it roughly agrees: a slight sag left by fitting must not flip a knee.
    const agrees = dot(normalize(bend), normalize(reject(preferred, axis), preferred)) > 0.3
    if (bent && (!(arm || leg) || agrees)) {
      return normalize(bend)
    }
  } else {
    preferred = POLE_VECTORS[owner.ik.pole]
  }
  const perp = reject(preferred, axis)
  if (length(perp) > 1e-3) {
    return normalize(perp)
  }
  // Chain points straight along the preferred direction: any perpendicular will do.
  return normalize(reject([0, 0, 1], axis), [1, 0, 0])
}

/** For every bone in an IK chain, the IK owner whose pole it bends toward. */
export function ikMembership(bones: Bone[]): Map<string, Bone> {
  const out = new Map<string, Bone>()
  for (const b of bones) {
    if (!b.ik) {
      continue
    }
    for (const c of chainUp(bones, b.id, b.ik.chain)) {
      out.set(c.id, b)
    }
  }
  return out
}

/**
 * The world Z axis Blender should give a bone (its roll). IK limbs point Z at
 * their pole, so knees and elbows bend about the bone's X axis; upright bones
 * face forward; flat bones face up. Mirrored bones get mirrored axes, so
 * Blender's pose mirroring works on them.
 */
export function boneZ(bones: Bone[], bone: Bone, membership?: Map<string, Bone>): Vec3 {
  const d = normalize(sub(bone.tail, bone.head), [0, 1, 0])
  let z: Vec3 | null = null
  if (bone.zAxis) {
    z = reject(bone.zAxis, d)
  } else {
    const owner = (membership ?? ikMembership(bones)).get(bone.id)
    const pole = owner ? poleDirection(bones, owner) : null
    if (pole) {
      z = reject(pole, d)
    } else if (Math.abs(d[2]) > 0.7) {
      z = reject([0, -1, 0], d)
    } else {
      z = reject([0, 0, 1], d)
    }
  }
  if (length(z) < 1e-6) {
    z = reject([0, 1, 0], d)
  }
  z = normalize(z)
  if (bone.rollOffset) {
    z = rotateAbout(z, d, (bone.rollOffset * Math.PI) / 180)
  }
  return z
}

// --- generated controls --------------------------------------------------------------

/** One bone as written to Blender. */
export interface OutBone {
  name: string
  head: Vec3
  tail: Vec3
  z: Vec3
  parent: string | null
  connected: boolean
  deform: boolean
  /** An IK target or pole, made by MeshRig. */
  control: boolean
}

export interface OutIk {
  owner: string
  target: string
  pole: string | null
  chain: number
}

export interface Controls {
  bones: OutBone[]
  ik: OutIk[]
  copyRotation: { owner: string; target: string }[]
  /** Per IK owner id, where its target and pole sit (for the viewport). */
  handles: Map<string, { target: Vec3; pole: Vec3 | null; follow: Bone | null }>
}

/** "hand.L" + "_ik" -> "hand_ik.L": the suffix goes before the side. */
export function insertSuffix(name: string, suffix: string): string {
  const side = sideOf(name)
  const mirrored = mirrorName(name)
  if (side && mirrored) {
    // Find the shared stem by comparing with the mirrored name.
    let i = 0
    while (i < name.length && name[i] === mirrored[i]) {
      i++
    }
    if (i > 0 && /[._\- ]$/.test(name.slice(0, i))) {
      return `${name.slice(0, i - 1)}${suffix}${name.slice(i - 1)}`
    }
    if (i === 0) {
      // Prefix style: LeftHand -> LeftHand_ik
      return `${name}${suffix}`
    }
    return `${name.slice(0, i)}${suffix}${name.slice(i)}`
  }
  return `${name}${suffix}`
}

/** The bone an IK target's rotation drives: the owner's single (or hand/foot) child. */
export function followBone(bones: Bone[], owner: Bone): Bone | null {
  if (!owner.ik?.follow) {
    return null
  }
  const kids = childrenOf(bones, owner.id)
  const touching = kids.filter((k) => k.connected || dist(k.head, owner.tail) < 1e-4)
  const preferred = touching.find((k) => k.role === 'hand' || k.role === 'foot')
  return preferred ?? (touching.length === 1 ? touching[0] : null)
}

export function chainLength(bones: Bone[], owner: Bone): number {
  return chainUp(bones, owner.id, owner.ik?.chain ?? 1).reduce(
    (s, b) => s + dist(b.head, b.tail),
    0
  )
}

/** The rig as Blender will get it: skeleton bones plus generated IK controls. */
export function buildControls(bones: Bone[]): Controls {
  const membership = ikMembership(bones)
  const map = byId(bones)
  const out: OutBone[] = bones.map((b) => ({
    name: b.name,
    head: b.head,
    tail: b.tail,
    z: boneZ(bones, b, membership),
    parent: b.parent ? (map.get(b.parent)?.name ?? null) : null,
    connected: b.connected,
    deform: b.deform,
    control: false
  }))
  const taken = new Set(bones.map((b) => b.name))
  const claim = (desired: string): string => {
    let name = desired
    for (let i = 1; taken.has(name); i++) {
      name = `${desired}.${String(i).padStart(3, '0')}`
    }
    taken.add(name)
    return name
  }
  const root = bones.find((b) => b.role === 'root' && !b.parent) ?? null
  const ik: OutIk[] = []
  const copyRotation: { owner: string; target: string }[] = []
  const handles: Controls['handles'] = new Map()

  for (const owner of bones) {
    if (!owner.ik) {
      continue
    }
    const chain = chainUp(bones, owner.id, owner.ik.chain)
    const follow = followBone(bones, owner)
    const len = dist(owner.head, owner.tail)
    const targetName = claim(
      insertSuffix(follow ? follow.name : owner.name, follow ? '_ik' : '_target')
    )
    const dir = normalize(sub(owner.tail, owner.head))
    const target: OutBone = follow
      ? {
          name: targetName,
          head: follow.head,
          tail: follow.tail,
          z: boneZ(bones, follow, membership),
          parent: root?.name ?? null,
          connected: false,
          deform: false,
          control: true
        }
      : {
          name: targetName,
          head: owner.tail,
          tail: add(owner.tail, scale(dir, len * 0.3)),
          z: boneZ(bones, owner, membership),
          parent: root?.name ?? null,
          connected: false,
          deform: false,
          control: true
        }
    out.push(target)

    let poleName: string | null = null
    let polePos: Vec3 | null = null
    const pdir = chain.length >= 2 ? poleDirection(bones, owner) : null
    if (pdir) {
      const reach = chainLength(bones, owner)
      polePos = add(owner.head, scale(pdir, reach * 0.6))
      poleName = claim(insertSuffix(owner.name, '_pole'))
      out.push({
        name: poleName,
        head: polePos,
        tail: add(polePos, scale(pdir, reach * 0.1)),
        z: normalize(reject([0, 0, 1], pdir), [1, 0, 0]),
        parent: root?.name ?? null,
        connected: false,
        deform: false,
        control: true
      })
    }
    ik.push({ owner: owner.name, target: targetName, pole: poleName, chain: chain.length })
    if (follow) {
      copyRotation.push({ owner: follow.name, target: targetName })
    }
    handles.set(owner.id, { target: owner.tail, pole: polePos, follow })
  }
  return { bones: out, ik, copyRotation, handles }
}

// --- automatic IK ---------------------------------------------------------------------

/**
 * Guesses IK for a skeleton that doesn't say what its bones are: any limb
 * that reaches the ground gets leg IK on its lowest upright bone, and bones
 * whose roles say arm/leg get the usual setup. Returns the updated bones and
 * how many chains it added.
 */
export function autoIk(
  bones: Bone[],
  groundZ: number,
  height: number
): { bones: Bone[]; added: number } {
  const owners = new Set<string>()
  // Role-based first: forearms and shins.
  for (const b of bones) {
    if ((b.role === 'forearm' || b.role === 'shin') && b.parent) {
      owners.add(b.id)
    }
  }
  // Geometry-based: leaves near the ground.
  const map = byId(bones)
  for (const leaf of bones) {
    if (
      childrenOf(bones, leaf.id).length > 0 ||
      Math.min(leaf.tail[2], leaf.head[2]) > groundZ + height * 0.15
    ) {
      continue
    }
    let cur: Bone | undefined = leaf
    // Skip feet and toes (flat bones) up to the first upright one.
    while (cur && Math.abs(normalize(sub(cur.tail, cur.head))[2]) < 0.5) {
      cur = cur.parent ? map.get(cur.parent) : undefined
    }
    if (cur && cur.parent && !owners.has(cur.id)) {
      const already = [...owners].some((id) => chainUp(bones, id, 2).some((c) => c.id === cur!.id))
      if (!already) {
        owners.add(cur.id)
      }
    }
  }
  let added = 0
  const next = bones.map((b) => {
    if (!owners.has(b.id) || b.ik) {
      return b
    }
    added += 1
    const hasChild = childrenOf(bones, b.id).some((k) => k.connected || dist(k.head, b.tail) < 1e-4)
    const role: BoneRole = b.role === 'other' ? 'shin' : b.role
    return {
      ...b,
      ik: {
        chain: 2,
        pole: 'auto' as PoleMode,
        follow: hasChild && (LEG_ROLES.includes(role) || ARM_ROLES.includes(role))
      }
    }
  })
  return { bones: next, added }
}

/** Right-handed bone frame (x, y = along the bone, z = roll axis), as Blender builds it. */
export function boneFrame(
  bones: Bone[],
  bone: Bone,
  membership?: Map<string, Bone>
): { x: Vec3; y: Vec3; z: Vec3 } {
  const y = normalize(sub(bone.tail, bone.head), [0, 1, 0])
  const z0 = boneZ(bones, bone, membership)
  const x = normalize(cross(y, z0))
  const z = normalize(cross(x, y))
  return { x, y, z }
}
