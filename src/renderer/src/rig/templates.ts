import type { Bone, BoneRole, Vec3 } from './types'
import type { MeshProbe, Silhouette } from './probe'
import { makeBone, symmetrize, byId, sortedByDepth, sideOf } from './skeleton'
import { defaultIk } from './controls'
import { add, dist, lerp, normalize, reject, scale, sub } from './vec'

/**
 * Starting skeletons, fitted to the model. Each fit reads the model's
 * outline to find landmarks (crotch, neck, hands, legs), builds the left
 * side and the centre, centres every joint inside the volume around it, and
 * mirrors the left side to the right. The result is a starting point: drag
 * whatever it got wrong.
 */

export type TemplateId = 'humanoid' | 'quadruped' | 'chain' | 'single' | 'empty'

export type FingerMode = 'none' | 'simple' | 'full'

export interface TemplateOptions {
  /** Spine bones between the hips and the neck. */
  spine: number
  neck: number
  fingers: FingerMode
  /** Tail bones (quadruped). */
  tail: number
  /** Bones in a chain. */
  chain: number
  /** A non-deforming root bone on the ground, to move the whole rig. */
  root: boolean
  /** IK on arms and legs. */
  ik: boolean
}

export const DEFAULT_TEMPLATE_OPTIONS: TemplateOptions = {
  spine: 2,
  neck: 1,
  fingers: 'none',
  tail: 4,
  chain: 6,
  root: true,
  ik: true
}

export interface FitContext {
  probe: MeshProbe
  /** The symmetry plane x = cx. */
  cx: number
}

// --- silhouette reading -------------------------------------------------------------------

class Outline {
  constructor(readonly s: Silhouette) {}

  col(u: number): number {
    return Math.round((u - this.s.u0) / this.s.cell)
  }
  row(v: number): number {
    return Math.round((v - this.s.v0) / this.s.cell)
  }
  u(col: number): number {
    return this.s.u0 + col * this.s.cell
  }
  v(row: number): number {
    return this.s.v0 + row * this.s.cell
  }
  at(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.s.cols || row >= this.s.rows) {
      return false
    }
    return this.s.mask[row * this.s.cols + col] === 1
  }
  /** Filled runs [first, last] across a row. */
  runs(row: number): [number, number][] {
    const out: [number, number][] = []
    let start = -1
    for (let c = 0; c <= this.s.cols; c++) {
      const on = c < this.s.cols && this.at(c, row)
      if (on && start < 0) {
        start = c
      } else if (!on && start >= 0) {
        out.push([start, c - 1])
        start = -1
      }
    }
    return out
  }
  /** The run covering `col`, or the nearest one. */
  runNear(row: number, col: number): [number, number] | null {
    let best: [number, number] | null = null
    let bestGap = Infinity
    for (const r of this.runs(row)) {
      const gap = col < r[0] ? r[0] - col : col > r[1] ? col - r[1] : 0
      if (gap < bestGap) {
        bestGap = gap
        best = r
      }
    }
    return best
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

// --- shared finishing ----------------------------------------------------------------------

/**
 * Centres every bone's tail in the volume around it (connected heads follow),
 * keeps centre bones on the symmetry plane, and
 * mirrors the left side to the right.
 */
function finish(bones: Bone[], ctx: FitContext, keep: Set<string>): Bone[] {
  const { probe, cx } = ctx
  // Landmarks are already close; centring only fixes the depth and small errors.
  const maxMove = probe.height * 0.06
  let out = sortedByDepth(bones)
  const map = (): Map<string, Bone> => byId(out)
  for (const b of [...out]) {
    if (keep.has(b.id)) {
      continue
    }
    const cur = map().get(b.id)!
    const dir = sub(cur.tail, cur.head)
    // Free heads (a hip, a shoulder) were placed on purpose inside a bigger
    // mass; centring would pull them to the middle of the body.
    const t = probe.centerInVolume(cur.tail, dir, maxMove)
    out = out.map((x) => {
      if (x.id === cur.id) {
        return { ...x, tail: t }
      }
      if (x.parent === cur.id && x.connected) {
        return { ...x, head: t }
      }
      return x
    })
  }
  // Centre bones stay on the plane.
  out = out.map((b) =>
    sideOf(b.name)
      ? b
      : {
          ...b,
          head: [cx, b.head[1], b.head[2]] as Vec3,
          tail: [cx, b.tail[1], b.tail[2]] as Vec3
        }
  )
  return symmetrize(out, 'L', cx)
}

/** Builds a chain of connected bones through `points`, named name_01, name_02... */
function chain(
  points: Vec3[],
  base: string,
  role: BoneRole,
  parent: Bone | null,
  side = '',
  connectFirst = false
): Bone[] {
  const out: Bone[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const prev = out[i - 1] ?? parent
    const name =
      points.length > 2 ? `${base}_${String(i + 1).padStart(2, '0')}${side}` : `${base}${side}`
    out.push(
      makeBone({
        name,
        head: points[i],
        tail: points[i + 1],
        parent: prev?.id ?? null,
        connected: i > 0 || connectFirst,
        role
      })
    )
  }
  return out
}

function rootBone(ctx: FitContext): Bone {
  const { probe, cx } = ctx
  const c = probe.center
  const z = probe.bounds.min[2]
  return makeBone({
    name: 'root',
    head: [cx, c[1], z],
    tail: [cx, c[1] + probe.height * 0.15, z],
    deform: false,
    role: 'root'
  })
}

// --- humanoid --------------------------------------------------------------------------------

interface HumanLandmarks {
  crotchZ: number
  shoulderZ: number
  neckZ: number
  topZ: number
  chestHalf: number
  handTip: Vec3
  legX: number
  kneeX: number
  ankleX: number
}

function humanLandmarks(ctx: FitContext): HumanLandmarks {
  const { probe, cx } = ctx
  const { min, max } = probe.bounds
  const H = probe.height || 1
  const zAt = (f: number): number => min[2] + f * H
  const o = new Outline(probe.silhouette('front', 200))
  const c0 = o.col(cx)

  // Crotch: the first row above the feet where the centre column fills in.
  let crotchZ = zAt(0.47)
  {
    const r0 = o.row(zAt(0.04))
    const r1 = o.row(zAt(0.7))
    if (!o.at(c0, r0)) {
      for (let r = r0; r <= r1; r++) {
        if (o.at(c0, r) || o.at(c0 - 1, r) || o.at(c0 + 1, r)) {
          crotchZ = clamp(o.v(r), zAt(0.25), zAt(0.65))
          break
        }
      }
    }
  }

  // Neck: the narrowest the torso gets between the chest and the top of the head.
  const torsoWidth = (r: number): number => {
    const run = o.runNear(r, c0)
    return run ? (run[1] - run[0] + 1) * o.s.cell : 0
  }
  let neckRow = o.row(zAt(0.86))
  {
    let best = Infinity
    const lo = o.row(Math.max(zAt(0.6), crotchZ + H * 0.15))
    const hi = o.row(zAt(0.95))
    for (let r = lo; r <= hi; r++) {
      const w = torsoWidth(r)
      if (w > 0 && w < best) {
        best = w
        neckRow = r
      }
    }
  }
  const neckZ = o.v(neckRow)
  const neckW = Math.max(torsoWidth(neckRow), H * 0.02)

  // Shoulders: going down from the neck, where the torso suddenly gets wide.
  let shoulderZ = neckZ - H * 0.05
  for (let r = neckRow; r > o.row(crotchZ + H * 0.1); r--) {
    if (torsoWidth(r) > neckW * 2.2) {
      shoulderZ = o.v(r) - H * 0.02
      break
    }
  }
  shoulderZ = clamp(shoulderZ, crotchZ + H * 0.15, neckZ - H * 0.01)

  // Chest half-width, just below the shoulders (under T-pose arms).
  let chestHalf = H * 0.12
  {
    const r = o.row(shoulderZ - H * 0.1)
    const run = o.runNear(r, c0)
    if (run) {
      chestHalf = Math.max(o.u(run[1]) - cx, cx - o.u(run[0]))
    }
    chestHalf = clamp(chestHalf, H * 0.05, H * 0.2)
  }

  // Hand tips: the furthest-out the model reaches on the left (+X) side,
  // between the hips and just above the shoulders.
  let tipCol = -1
  const tipRows: number[] = []
  for (let r = o.row(crotchZ - H * 0.2); r <= o.row(shoulderZ + H * 0.08); r++) {
    const runs = o.runs(r)
    if (!runs.length) {
      continue
    }
    const right = runs[runs.length - 1][1]
    if (right > tipCol + 1) {
      tipCol = right
      tipRows.length = 0
    }
    if (right >= tipCol - 1) {
      tipRows.push(r)
    }
  }
  const tipX = o.u(Math.max(tipCol, c0))
  const tipZ = tipRows.length ? o.v(tipRows[Math.floor(tipRows.length / 2)]) : shoulderZ
  const armsOut = tipX - cx > chestHalf + H * 0.12
  const handTip: Vec3 = armsOut
    ? [tipX - H * 0.01, probe.center[1], tipZ]
    : [cx + chestHalf + H * 0.04, probe.center[1], crotchZ - H * 0.02]

  // Legs: the centre of the run right of the gap, at thigh, knee and ankle height.
  const legCenter = (z: number, fallback: number): number => {
    const runs = o.runs(o.row(z)).filter((r) => r[1] > c0 + 1)
    const run = runs.find((r) => r[0] > c0) ?? runs[0]
    if (!run) {
      return fallback
    }
    const start = Math.max(run[0], c0)
    const centre = o.u((start + run[1]) / 2)
    return centre - cx > H * 0.01 ? centre : fallback
  }
  const legX = legCenter(crotchZ - H * 0.08, cx + H * 0.09)
  const kneeX = legCenter(min[2] + (crotchZ - min[2]) * 0.5, legX)
  const ankleX = legCenter(zAt(0.06), kneeX)

  return { crotchZ, shoulderZ, neckZ, topZ: max[2], chestHalf, handTip, legX, kneeX, ankleX }
}

function fitHumanoid(ctx: FitContext, opts: TemplateOptions): Bone[] {
  const { probe, cx } = ctx
  const H = probe.height || 1
  const minZ = probe.bounds.min[2]
  const y = probe.center[1]
  const L = humanLandmarks(ctx)
  const bones: Bone[] = []
  const keep = new Set<string>()

  const root = opts.root ? rootBone(ctx) : null
  if (root) {
    bones.push(root)
    keep.add(root.id)
  }

  // Spine: hips, then `spine` bones up to the base of the neck.
  const hipsHead: Vec3 = [cx, y, L.crotchZ + H * 0.03]
  const hipsTail: Vec3 = [cx, y, L.crotchZ + H * 0.13]
  const hips = makeBone({
    name: 'hips',
    head: hipsHead,
    tail: hipsTail,
    parent: root?.id ?? null,
    role: 'hips'
  })
  bones.push(hips)
  const neckBase: Vec3 = [cx, y, Math.min(L.shoulderZ + H * 0.03, L.neckZ - H * 0.01)]
  const spinePts: Vec3[] = [hipsTail]
  const nSpine = Math.max(1, opts.spine)
  for (let i = 1; i <= nSpine; i++) {
    spinePts.push(lerp(hipsTail, neckBase, i / nSpine))
  }
  const spine = spinePts.slice(0, -1).map((p, i) => {
    const last = i === nSpine - 1
    return makeBone({
      name: last ? 'chest' : nSpine > 2 ? `spine_${String(i + 1).padStart(2, '0')}` : 'spine',
      head: p,
      tail: spinePts[i + 1],
      role: last ? 'chest' : 'spine'
    })
  })
  spine.forEach((b, i) => {
    b.parent = i === 0 ? hips.id : spine[i - 1].id
    b.connected = true
  })
  bones.push(...spine)
  const chest = spine[spine.length - 1]

  // Neck and head.
  const headBase: Vec3 = [cx, y, Math.max(L.neckZ, neckBase[2] + H * 0.02)]
  const neckPts: Vec3[] = []
  const nNeck = Math.max(1, opts.neck)
  for (let i = 0; i <= nNeck; i++) {
    neckPts.push(lerp(neckBase, headBase, i / nNeck))
  }
  const neck = chain(neckPts, 'neck', 'neck', chest, '', true)
  bones.push(...neck)
  const head = makeBone({
    name: 'head',
    head: headBase,
    tail: [cx, y, L.topZ - H * 0.005],
    parent: neck[neck.length - 1].id,
    connected: true,
    role: 'head'
  })
  bones.push(head)
  keep.add(head.id)

  // Left arm (+X); the right one is mirrored at the end.
  const shoulderJoint: Vec3 = [cx + L.chestHalf * 0.8, y, L.shoulderZ]
  const shoulder = makeBone({
    name: 'shoulder.L',
    head: [cx + H * 0.025, y, L.shoulderZ - H * 0.005],
    tail: shoulderJoint,
    parent: chest.id,
    role: 'shoulder'
  })
  const tip = L.handTip
  const elbow = lerp(shoulderJoint, tip, 0.42)
  const wrist = lerp(shoulderJoint, tip, 0.77)
  // A slight bend, so the IK knows which way the elbow goes from the start.
  const armDir = normalize(sub(tip, shoulderJoint))
  const backward = normalize(reject([0, 1, 0], armDir))
  const elbowBent = add(elbow, scale(backward, dist(shoulderJoint, tip) * 0.012))
  const upper = makeBone({
    name: 'upper_arm.L',
    head: shoulderJoint,
    tail: elbowBent,
    parent: shoulder.id,
    connected: true,
    role: 'arm'
  })
  const fore = makeBone({
    name: 'forearm.L',
    head: elbowBent,
    tail: wrist,
    parent: upper.id,
    connected: true,
    role: 'forearm'
  })
  const handLen = dist(wrist, tip)
  const handEnd =
    opts.fingers === 'none' ? lerp(wrist, tip, 0.85) : add(wrist, scale(armDir, handLen * 0.42))
  const hand = makeBone({
    name: 'hand.L',
    head: wrist,
    tail: handEnd,
    parent: fore.id,
    connected: true,
    role: 'hand'
  })
  if (opts.ik) {
    fore.ik = defaultIk('forearm')
  }
  bones.push(shoulder, upper, fore, hand)
  if (opts.fingers === 'none') {
    keep.add(hand.id)
  } else {
    bones.push(...fingers(hand, armDir, handLen, tip, opts.fingers, keep))
  }

  // Left leg.
  const hip: Vec3 = [L.legX, y, L.crotchZ + H * 0.02]
  const ankleZ = minZ + H * 0.05
  const knee: Vec3 = [L.kneeX, y, lerp(hip, [0, 0, ankleZ], 0.5)[2]]
  const ankle: Vec3 = [L.ankleX, y, ankleZ]
  // Knees bend forward a touch, so IK has a direction from the start.
  const kneeBent = add(knee, [0, -H * 0.006, 0])
  const thigh = makeBone({
    name: 'thigh.L',
    head: hip,
    tail: kneeBent,
    parent: hips.id,
    role: 'thigh'
  })
  const shin = makeBone({
    name: 'shin.L',
    head: kneeBent,
    tail: ankle,
    parent: thigh.id,
    connected: true,
    role: 'shin'
  })
  if (opts.ik) {
    shin.ik = defaultIk('shin')
  }
  const toeTip = footFront(probe, L.ankleX, H)
  const ball: Vec3 = [L.ankleX, lerp(ankle, toeTip, 0.68)[1], minZ + H * 0.02]
  const foot = makeBone({
    name: 'foot.L',
    head: ankle,
    tail: ball,
    parent: shin.id,
    connected: true,
    role: 'foot'
  })
  const toe = makeBone({
    name: 'toe.L',
    head: ball,
    tail: [L.ankleX, toeTip[1], minZ + H * 0.015],
    parent: foot.id,
    connected: true,
    role: 'toe'
  })
  bones.push(thigh, shin, foot, toe)
  // Feet are flat on the ground: centring would lift them off it.
  keep.add(foot.id)
  keep.add(toe.id)
  return finish(bones, ctx, keep)
}

/** The front tip of the left foot: the most -Y point near the ground under the leg. */
function footFront(probe: MeshProbe, legX: number, H: number): Vec3 {
  const minZ = probe.bounds.min[2]
  let best = Infinity
  for (const p of probe.parts) {
    const a = p.positions
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 2] < minZ + H * 0.06 && Math.abs(a[i] - legX) < H * 0.08 && a[i + 1] < best) {
        best = a[i + 1]
      }
    }
  }
  if (!Number.isFinite(best)) {
    best = probe.center[1] - H * 0.12
  }
  return [legX, best + H * 0.005, minZ]
}

function fingers(
  hand: Bone,
  armDir: Vec3,
  handLen: number,
  tip: Vec3,
  mode: FingerMode,
  keep: Set<string>
): Bone[] {
  const out: Bone[] = []
  // Fingers spread toward the front and back of a flat T-pose hand.
  const spread = normalize(reject([0, -1, 0], armDir), [0, -1, 0])
  const base = hand.tail
  const width = handLen * 0.42
  const thumbBase = add(lerp(hand.head, base, 0.35), scale(spread, width * 0.45))
  const thumbDir = normalize(add(scale(armDir, 0.55), scale(spread, 0.8)))
  const thumbLen = handLen * 0.45
  if (mode === 'simple') {
    const f = makeBone({
      name: 'fingers.L',
      head: base,
      tail: lerp(base, tip, 0.95),
      parent: hand.id,
      connected: true,
      role: 'finger'
    })
    const t = makeBone({
      name: 'thumb.L',
      head: thumbBase,
      tail: add(thumbBase, scale(thumbDir, thumbLen)),
      parent: hand.id,
      role: 'finger'
    })
    keep.add(f.id)
    keep.add(t.id)
    return [f, t]
  }
  const thumbPts = [0, 0.4, 0.72, 1].map((f) => add(thumbBase, scale(thumbDir, thumbLen * f)))
  out.push(...chain(thumbPts, 'thumb', 'finger', hand, '.L'))
  const names = ['index', 'middle', 'ring', 'pinky']
  const offsets = [0.36, 0.12, -0.12, -0.34]
  const lengths = [0.5, 0.55, 0.5, 0.4]
  names.forEach((n, i) => {
    const start = add(base, scale(spread, width * offsets[i]))
    const len = handLen * lengths[i]
    const pts = [0, 0.42, 0.74, 1].map((f) => add(start, scale(armDir, len * f)))
    out.push(...chain(pts, n, 'finger', hand, '.L'))
  })
  for (const b of out) {
    keep.add(b.id)
  }
  return out
}

// --- quadruped ------------------------------------------------------------------------------

function fitQuadruped(ctx: FitContext, opts: TemplateOptions): Bone[] {
  const { probe, cx } = ctx
  const { min, max } = probe.bounds
  const H = probe.height || 1
  const Ln = max[1] - min[1] || 1
  const side = new Outline(probe.silhouette('side', 160))
  const front = new Outline(probe.silhouette('front', 160))
  const keep = new Set<string>()

  // Legs: the runs that touch the ground in the side view, front and back.
  const groundRow = side.row(min[2] + H * 0.06)
  const legRuns = side.runs(groundRow)
  let frontLegY = min[1] + Ln * 0.25
  let backLegY = max[1] - Ln * 0.22
  if (legRuns.length >= 2) {
    frontLegY = side.u((legRuns[0][0] + legRuns[0][1]) / 2)
    const last = legRuns[legRuns.length - 1]
    backLegY = side.u((last[0] + last[1]) / 2)
  }
  // The body's middle height at a given Y: centre of the topmost run.
  const bodyZ = (yv: number): number => {
    const c = side.col(yv)
    let top = -1
    for (let r = side.s.rows - 1; r >= 0; r--) {
      if (side.at(c, r)) {
        top = r
        break
      }
    }
    if (top < 0) {
      return min[2] + H * 0.6
    }
    let bottom = top
    while (bottom > 0 && side.at(c, bottom - 1)) {
      bottom--
    }
    // The body, not the whole column down through a leg.
    const span = Math.min(top - bottom, side.row(min[2] + H * 0.35))
    return side.v(top - span / 2)
  }
  // Where a leg is at height z, seen from the side. Inside the body the run
  // is the whole torso, which says nothing about the leg: keep `near`.
  const legYAt = (z: number, near: number): number => {
    const run = side.runNear(side.row(z), side.col(near))
    if (!run || (run[1] - run[0]) * side.s.cell > Ln * 0.25) {
      return near
    }
    return side.u((run[0] + run[1]) / 2)
  }
  const c0 = front.col(cx)
  const groundRuns = front.runs(front.row(min[2] + H * 0.06)).filter((r) => r[1] > c0)
  const legX = groundRuns.length
    ? Math.max(front.u((Math.max(groundRuns[0][0], c0) + groundRuns[0][1]) / 2), cx + H * 0.04)
    : cx + (max[0] - min[0]) * 0.3

  const root = opts.root ? rootBone(ctx) : null
  const bones: Bone[] = []
  if (root) {
    bones.push(root)
    keep.add(root.id)
  }
  const hipsPt: Vec3 = [cx, backLegY, bodyZ(backLegY)]
  const chestPt: Vec3 = [cx, frontLegY, bodyZ(frontLegY)]
  // Hips point backward from the spine start toward the tail.
  const hips = makeBone({
    name: 'hips',
    head: lerp(hipsPt, chestPt, 0.18),
    tail: hipsPt,
    parent: root?.id ?? null,
    role: 'hips'
  })
  bones.push(hips)
  const nSpine = Math.max(1, opts.spine + 1)
  const spinePts: Vec3[] = []
  for (let i = 0; i <= nSpine; i++) {
    const p = lerp(hips.head, chestPt, i / nSpine)
    spinePts.push([cx, p[1], bodyZ(p[1])])
  }
  const spine = chain(spinePts, 'spine', 'spine', hips)
  spine[spine.length - 1].name = 'chest'
  spine[spine.length - 1].role = 'chest'
  bones.push(...spine)
  const chest = spine[spine.length - 1]

  // Neck up to the head, which is the front-most mass.
  const headY = min[1] + Ln * 0.1
  const headBaseY = min[1] + Ln * 0.2
  const headBase: Vec3 = [cx, headBaseY, Math.max(bodyZ(headBaseY), chest.tail[2])]
  const neckPts: Vec3[] = []
  for (let i = 0; i <= opts.neck; i++) {
    neckPts.push(lerp(chest.tail, headBase, i / Math.max(1, opts.neck)))
  }
  const neck = chain(neckPts, 'neck', 'neck', chest, '', true)
  bones.push(...neck)
  const head = makeBone({
    name: 'head',
    head: headBase,
    tail: [cx, min[1] + Ln * 0.015, bodyZ(headY)],
    parent: neck[neck.length - 1].id,
    connected: true,
    role: 'head'
  })
  bones.push(head)
  keep.add(head.id)

  // Tail, when the model goes on past the hips.
  if (opts.tail > 0 && max[1] - hipsPt[1] > Ln * 0.08) {
    const pts: Vec3[] = []
    for (let i = 0; i <= opts.tail; i++) {
      const yv = lerp(hipsPt, [0, max[1] - Ln * 0.01, 0], i / opts.tail)[1]
      pts.push([cx, yv, i === 0 ? hipsPt[2] : bodyZ(yv)])
    }
    const tail = chain(pts, 'tail', 'tail', hips, '', true)
    bones.push(...tail)
  }

  // Front leg (left).
  const fz = (f: number): number => min[2] + f * (chestPt[2] - min[2])
  const shoulderPt: Vec3 = [legX * 0.7 + cx * 0.3, legYAt(fz(0.95), frontLegY), fz(0.95)]
  const elbowPt: Vec3 = [legX, legYAt(fz(0.55), frontLegY) + Ln * 0.01, fz(0.55)]
  const wristPt: Vec3 = [legX, legYAt(fz(0.15), frontLegY), fz(0.15)]
  const pawPt: Vec3 = [legX, legYAt(min[2] + H * 0.02, frontLegY) - Ln * 0.03, min[2] + H * 0.01]
  const fShoulder = makeBone({
    name: 'shoulder.L',
    head: [cx + (legX - cx) * 0.25, chestPt[1], chestPt[2]],
    tail: shoulderPt,
    parent: chest.id,
    role: 'shoulder'
  })
  const fUpper = makeBone({
    name: 'upper_arm.L',
    head: shoulderPt,
    tail: elbowPt,
    parent: fShoulder.id,
    connected: true,
    role: 'arm'
  })
  const fFore = makeBone({
    name: 'forearm.L',
    head: elbowPt,
    tail: wristPt,
    parent: fUpper.id,
    connected: true,
    role: 'forearm'
  })
  const fPaw = makeBone({
    name: 'hand.L',
    head: wristPt,
    tail: pawPt,
    parent: fFore.id,
    connected: true,
    role: 'hand'
  })
  if (opts.ik) {
    fFore.ik = { chain: 2, pole: 'back', follow: true }
  }
  bones.push(fShoulder, fUpper, fFore, fPaw)
  keep.add(fPaw.id)

  // Back leg (left).
  const bz = (f: number): number => min[2] + f * (hipsPt[2] - min[2])
  const hipPt: Vec3 = [legX * 0.8 + cx * 0.2, legYAt(bz(0.9), backLegY), bz(0.9)]
  const kneePt: Vec3 = [legX, legYAt(bz(0.55), backLegY) - Ln * 0.02, bz(0.55)]
  const hockPt: Vec3 = [legX, legYAt(bz(0.22), backLegY) + Ln * 0.02, bz(0.22)]
  const footPt: Vec3 = [legX, legYAt(min[2] + H * 0.02, backLegY) - Ln * 0.03, min[2] + H * 0.01]
  const thigh = makeBone({
    name: 'thigh.L',
    head: hipPt,
    tail: kneePt,
    parent: hips.id,
    role: 'thigh'
  })
  const shin = makeBone({
    name: 'shin.L',
    head: kneePt,
    tail: hockPt,
    parent: thigh.id,
    connected: true,
    role: 'shin'
  })
  const foot = makeBone({
    name: 'foot.L',
    head: hockPt,
    tail: footPt,
    parent: shin.id,
    connected: true,
    role: 'foot'
  })
  if (opts.ik) {
    shin.ik = { chain: 2, pole: 'auto', follow: true }
  }
  bones.push(thigh, shin, foot)
  keep.add(foot.id)
  return finish(bones, ctx, keep)
}

// --- chain and single bone -------------------------------------------------------------------

function fitChain(ctx: FitContext, opts: TemplateOptions): Bone[] {
  const { probe } = ctx
  const { min, max } = probe.bounds
  const ext: Vec3 = sub(max, min)
  const axis = ext[2] >= ext[0] * 0.8 && ext[2] >= ext[1] * 0.8 ? 2 : ext[0] > ext[1] ? 0 : 1
  const n = Math.max(1, opts.chain)
  const len = ext[axis]
  const slab = len / (2 * n)
  const pts: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const s = min[axis] + len * (0.02 + 0.96 * (i / n))
    const { sum, count } = slabSum(probe, axis, s, slab)
    const c: Vec3 = count ? scale(sum, 1 / count) : probe.center
    c[axis] = s
    pts.push(c)
  }
  const bones = chain(pts, 'chain', 'tail', null)
  const keep = new Set<string>()
  return finishChain(bones, ctx, keep)
}

/** Sum and count of the vertices within `slab` of `s` along `axis`. */
function slabSum(
  probe: MeshProbe,
  axis: number,
  s: number,
  slab: number
): { sum: Vec3; count: number } {
  const sum: Vec3 = [0, 0, 0]
  let count = 0
  for (const p of probe.parts) {
    const a = p.positions
    for (let k = 0; k < a.length; k += 3) {
      const inside = Math.abs(a[k + axis] - s) <= slab ? 1 : 0
      sum[0] += a[k] * inside
      sum[1] += a[k + 1] * inside
      sum[2] += a[k + 2] * inside
      count += inside
    }
  }
  return { sum, count }
}

/** Like finish(), without forcing bones onto the symmetry plane. */
function finishChain(bones: Bone[], ctx: FitContext, keep: Set<string>): Bone[] {
  let out = bones
  for (const b of bones) {
    if (keep.has(b.id)) {
      continue
    }
    const cur = out.find((x) => x.id === b.id)!
    const t = ctx.probe.centerInVolume(cur.tail, sub(cur.tail, cur.head))
    out = out.map((x) =>
      x.id === cur.id
        ? { ...x, tail: t }
        : x.parent === cur.id && x.connected
          ? { ...x, head: t }
          : x
    )
  }
  return out
}

function fitSingle(ctx: FitContext): Bone[] {
  const { probe, cx } = ctx
  const c = probe.center
  return [
    makeBone({
      name: 'main',
      head: [cx, c[1], probe.bounds.min[2]],
      tail: [cx, c[1], probe.bounds.max[2]],
      role: 'part'
    })
  ]
}

export function fitTemplate(id: TemplateId, ctx: FitContext, opts: TemplateOptions): Bone[] {
  switch (id) {
    case 'humanoid':
      return fitHumanoid(ctx, opts)
    case 'quadruped':
      return fitQuadruped(ctx, opts)
    case 'chain':
      return fitChain(ctx, opts)
    case 'single':
      return fitSingle(ctx)
    case 'empty':
      return []
  }
}
