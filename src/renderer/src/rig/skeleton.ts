import type { Bone, BoneRole, Vec3 } from './types'
import { add, dist, mirrorX, sub } from './vec'

/**
 * Pure skeleton operations. Every function returns a new array and never
 * mutates its input, so the store can keep old arrays for undo.
 */

let idCounter = 0
export function newBoneId(): string {
  idCounter += 1
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function makeBone(partial: Partial<Bone> & Pick<Bone, 'name' | 'head' | 'tail'>): Bone {
  return {
    id: newBoneId(),
    parent: null,
    connected: false,
    deform: true,
    role: 'other',
    ik: null,
    rollOffset: 0,
    zAxis: null,
    ...partial
  }
}

// --- sides and names -----------------------------------------------------------------

export type Side = 'L' | 'R'

const SIDE_PATTERNS: { re: RegExp; make: (base: string, side: Side) => string }[] = [
  // name.L / name_L / name-L / name L (Blender's own rules)
  {
    re: /^(.*?)([._\- ])([LR])$/,
    make: (base, side) => base + side
  },
  {
    re: /^(.*?)([._\- ])([lr])$/,
    make: (base, side) => base + side.toLowerCase()
  },
  { re: /^(.*?)(Left|Right)$/, make: (base, side) => base + (side === 'L' ? 'Left' : 'Right') },
  { re: /^(.*?)(left|right)$/, make: (base, side) => base + (side === 'L' ? 'left' : 'right') },
  { re: /^(Left|Right)(.*)$/, make: (rest, side) => (side === 'L' ? 'Left' : 'Right') + rest },
  { re: /^(left|right)(.*)$/, make: (rest, side) => (side === 'L' ? 'left' : 'right') + rest }
]

/** Which side a bone name says it's on, if any. */
export function sideOf(name: string): Side | null {
  for (const [i, p] of SIDE_PATTERNS.entries()) {
    const m = p.re.exec(name)
    if (!m) {
      continue
    }
    const token = i < 2 ? m[3] : i < 4 ? m[2] : m[1]
    return /^l/i.test(token) ? 'L' : 'R'
  }
  return null
}

/** The other side's name ("hand.L" -> "hand.R"), or null for a centre bone. */
export function mirrorName(name: string): string | null {
  for (const [i, p] of SIDE_PATTERNS.entries()) {
    const m = p.re.exec(name)
    if (!m) {
      continue
    }
    if (i < 2) {
      const other: Side = m[3].toUpperCase() === 'L' ? 'R' : 'L'
      return p.make(m[1] + m[2], other)
    }
    if (i < 4) {
      return p.make(m[1], /^l/i.test(m[2]) ? 'R' : 'L')
    }
    return p.make(m[2], /^l/i.test(m[1]) ? 'R' : 'L')
  }
  return null
}

/** "hand" + "L" -> "hand.L"; a name that already has a side gets it swapped. */
export function withSide(name: string, side: Side): string {
  const current = sideOf(name)
  if (current === side) {
    return name
  }
  if (current) {
    return mirrorName(name)!
  }
  return `${name}.${side}`
}

/** Blender's convention: +X is the character's left (it faces -Y). */
export function sideForX(x: number, cx: number, eps: number): Side | null {
  if (Math.abs(x - cx) <= eps) {
    return null
  }
  return x > cx ? 'L' : 'R'
}

/** `desired`, or `desired.001`, `.002`... so it doesn't clash with another bone. */
export function uniqueName(bones: Bone[], desired: string, exceptId?: string): string {
  const taken = new Set(bones.filter((b) => b.id !== exceptId).map((b) => b.name))
  const clean = desired.trim() || 'bone'
  if (!taken.has(clean)) {
    return clean
  }
  // Keep a side suffix at the end: hand.001.L reads worse than hand.L.001 in
  // Blender's own mirror tools, which only look at the end of the name.
  for (let i = 1; i < 10000; i++) {
    const candidate = `${clean}.${String(i).padStart(3, '0')}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
  return `${clean}.${Date.now()}`
}

export const ROLE_NAMES: Record<BoneRole, string> = {
  root: 'root',
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  neck: 'neck',
  head: 'head',
  jaw: 'jaw',
  shoulder: 'shoulder',
  arm: 'upper_arm',
  forearm: 'forearm',
  hand: 'hand',
  finger: 'finger',
  thigh: 'thigh',
  shin: 'shin',
  foot: 'foot',
  toe: 'toe',
  tail: 'tail',
  wing: 'wing',
  part: 'part',
  other: 'bone'
}

// --- lookups -----------------------------------------------------------------------------

export function byId(bones: Bone[]): Map<string, Bone> {
  return new Map(bones.map((b) => [b.id, b]))
}

export function childrenOf(bones: Bone[], id: string | null): Bone[] {
  return bones.filter((b) => b.parent === id)
}

/** The bone itself and everything below it. */
export function subtreeIds(bones: Bone[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const b of bones) {
      if (b.parent && out.has(b.parent) && !out.has(b.id)) {
        out.add(b.id)
        grew = true
      }
    }
  }
  return out
}

export function mirrorOf(bones: Bone[], bone: Bone): Bone | null {
  const name = mirrorName(bone.name)
  return name ? (bones.find((b) => b.name === name) ?? null) : null
}

/** Parents before children, so a single pass can build world matrices. */
export function sortedByDepth(bones: Bone[]): Bone[] {
  const map = byId(bones)
  const depth = (b: Bone): number => {
    let d = 0
    let p = b.parent ? map.get(b.parent) : undefined
    while (p && d < 1000) {
      d += 1
      p = p.parent ? map.get(p.parent) : undefined
    }
    return d
  }
  return [...bones].sort((a, b) => depth(a) - depth(b))
}

/** The bone's own parent chain, nearest first, at most `count` long (bone included). */
export function chainUp(bones: Bone[], id: string, count: number): Bone[] {
  const map = byId(bones)
  const out: Bone[] = []
  let b = map.get(id)
  while (b && out.length < count) {
    out.push(b)
    b = b.parent ? map.get(b.parent) : undefined
  }
  return out
}

// --- edits -------------------------------------------------------------------------------

export type JointEnd = 'head' | 'tail'

/**
 * Moves one end of a bone. Connected bones move with it: a tail drags the
 * heads of connected children, and a connected head drags the parent's tail
 * (and so the parent's other connected children). Returns the new bones and
 * the ids whose head or tail changed.
 */
export function moveJoint(
  bones: Bone[],
  id: string,
  end: JointEnd,
  p: Vec3
): { bones: Bone[]; changed: Set<string> } {
  const map = byId(bones)
  const bone = map.get(id)
  if (!bone) {
    return { bones, changed: new Set() }
  }
  // A connected head is really the parent's tail.
  if (end === 'head' && bone.connected && bone.parent && map.has(bone.parent)) {
    return moveJoint(bones, bone.parent, 'tail', p)
  }
  const changed = new Set<string>([id])
  const next = bones.map((b) => {
    if (b.id === id) {
      return { ...b, [end]: [...p] as Vec3 }
    }
    if (end === 'tail' && b.parent === id && b.connected) {
      changed.add(b.id)
      return { ...b, head: [...p] as Vec3 }
    }
    return b
  })
  return { bones: next, changed }
}

/** Moves a whole bone (both ends) by `delta`, dragging connected neighbours. */
export function translateBone(
  bones: Bone[],
  id: string,
  delta: Vec3
): { bones: Bone[]; changed: Set<string> } {
  const bone = byId(bones).get(id)
  if (!bone) {
    return { bones, changed: new Set() }
  }
  const a = moveJoint(bones, id, 'head', add(bone.head, delta))
  const moved = byId(a.bones).get(id)!
  const b = moveJoint(a.bones, id, 'tail', add(moved.tail, delta))
  return { bones: b.bones, changed: new Set([...a.changed, ...b.changed]) }
}

/**
 * Copies changed bones onto their mirror partners (across x = cx), so editing
 * one side edits both. Bones without a partner are left alone.
 */
export function mirrorChanges(bones: Bone[], changed: Set<string>, cx: number): Bone[] {
  const byName = new Map(bones.map((b) => [b.name, b]))
  const updates = new Map<string, { head: Vec3; tail: Vec3 }>()
  for (const b of bones) {
    if (!changed.has(b.id)) {
      continue
    }
    const otherName = mirrorName(b.name)
    const other = otherName ? byName.get(otherName) : undefined
    if (!other || changed.has(other.id)) {
      continue
    }
    updates.set(other.id, { head: mirrorX(b.head, cx), tail: mirrorX(b.tail, cx) })
  }
  if (updates.size === 0) {
    return bones
  }
  return bones.map((b) => (updates.has(b.id) ? { ...b, ...updates.get(b.id)! } : b))
}

/**
 * Deletes bones. Their children move up to the nearest surviving ancestor,
 * staying connected only when they still touch it.
 */
export function deleteBones(bones: Bone[], ids: Set<string>): Bone[] {
  const map = byId(bones)
  const survivor = (id: string | null): string | null => {
    let cur = id
    while (cur && ids.has(cur)) {
      cur = map.get(cur)?.parent ?? null
    }
    return cur
  }
  return bones
    .filter((b) => !ids.has(b.id))
    .map((b) => {
      if (!b.parent || !ids.has(b.parent)) {
        return b
      }
      const parent = survivor(b.parent)
      const pb = parent ? map.get(parent) : undefined
      const touching = !!pb && dist(pb.tail, b.head) < 1e-6
      return { ...b, parent, connected: b.connected && touching }
    })
}

/** Re-parents, refusing cycles. Connecting snaps the head onto the parent's tail. */
export function setParent(
  bones: Bone[],
  id: string,
  parent: string | null,
  connected: boolean
): Bone[] {
  if (parent && subtreeIds(bones, id).has(parent)) {
    return bones
  }
  const map = byId(bones)
  const pb = parent ? map.get(parent) : undefined
  return bones.map((b) => {
    if (b.id !== id) {
      return b
    }
    const conn = connected && !!pb
    return { ...b, parent, connected: conn, head: conn ? ([...pb!.tail] as Vec3) : b.head }
  })
}

/**
 * Makes the other side match `from`: every bone named for that side gets a
 * mirrored twin (created when missing), parented to the mirror of its parent.
 */
export function symmetrize(bones: Bone[], from: Side, cx: number): Bone[] {
  let out = [...bones]
  const byName = (): Map<string, Bone> => new Map(out.map((b) => [b.name, b]))
  const sources = bones.filter((b) => sideOf(b.name) === from)
  // Pass 1: create or move twins.
  for (const src of sources) {
    const name = mirrorName(src.name)!
    const existing = byName().get(name)
    const twin: Bone = {
      ...src,
      id: existing?.id ?? newBoneId(),
      name,
      head: mirrorX(src.head, cx),
      tail: mirrorX(src.tail, cx),
      zAxis: src.zAxis ? [-src.zAxis[0], src.zAxis[1], src.zAxis[2]] : null,
      rollOffset: -src.rollOffset
    }
    out = existing ? out.map((b) => (b.id === existing.id ? twin : b)) : [...out, twin]
  }
  // Pass 2: parents, now that every twin exists.
  const ids = new Map(out.map((b) => [b.id, b]))
  const names = byName()
  out = out.map((b) => {
    const src = sources.find((s) => mirrorName(s.name) === b.name)
    if (!src) {
      return b
    }
    const srcParent = src.parent ? ids.get(src.parent) : undefined
    if (!srcParent) {
      return { ...b, parent: null }
    }
    const twinParentName = mirrorName(srcParent.name)
    const parent = twinParentName ? (names.get(twinParentName) ?? srcParent) : srcParent
    return { ...b, parent: parent.id }
  })
  return out
}

/** Bones with the given ids flipped to the other side: positions and names. */
export function flipNames(bones: Bone[]): Bone[] {
  return bones.map((b) => {
    const other = mirrorName(b.name)
    return other ? { ...b, name: other } : b
  })
}

/** Shifts every bone so the whole skeleton moves by `delta`. */
export function translateAll(bones: Bone[], delta: Vec3): Bone[] {
  return bones.map((b) => ({ ...b, head: add(b.head, delta), tail: add(b.tail, delta) }))
}

/**
 * Where left and right mirror (x = cx). The skeleton knows best: the middle
 * of its .L/.R pairs. Without pairs, x = 0 when the model sits across it
 * (Blender's mirror plane; a prop in one hand mustn't move it), else the
 * middle of the model.
 */
export function symmetryPlane(bones: Bone[], minX: number, maxX: number): number {
  const byName = new Map(bones.map((b) => [b.name, b]))
  const mids: number[] = []
  for (const b of bones) {
    const twin = sideOf(b.name) === 'L' ? byName.get(mirrorName(b.name) ?? '') : undefined
    if (twin) {
      mids.push((b.head[0] + twin.head[0]) / 2, (b.tail[0] + twin.tail[0]) / 2)
    }
  }
  if (mids.length) {
    mids.sort((a, b) => a - b)
    return mids[Math.floor(mids.length / 2)]
  }
  const width = Math.max(maxX - minX, 1e-9)
  if (minX < -0.1 * width && maxX > 0.1 * width) {
    return 0
  }
  return (minX + maxX) / 2
}

/** A stable string for "has the deforming skeleton changed since X". */
export function skeletonSignature(bones: Bone[]): string {
  const r = (v: Vec3): string => v.map((x) => x.toFixed(5)).join(',')
  return bones
    .filter((b) => b.deform)
    .map((b) => `${b.id}:${r(b.head)}:${r(b.tail)}`)
    .sort()
    .join('|')
}

export function boneLength(b: Bone): number {
  return dist(b.head, b.tail)
}

export function boneDir(b: Bone): Vec3 {
  return sub(b.tail, b.head)
}
