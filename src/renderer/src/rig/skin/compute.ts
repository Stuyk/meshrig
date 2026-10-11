/* eslint-disable max-depth -- voxel and Dijkstra kernels: the nesting is the
   grid's three axes and a neighbour loop, and helper calls there cost real time. */
/**
 * Automatic skin weights, without Blender.
 *
 * 'auto' is a geodesic voxel bind: the model is voxelised (surface plus the
 * solid inside, when it's closed), and each bone's distance is measured
 * through that volume rather than straight through the air. An arm resting
 * against the hip is far from the hip's bone *through the body*, so the arm
 * doesn't drag the hip along. It works on meshes Blender's bone heat fails on:
 * open meshes, overlapping clothes, many loose pieces.
 *
 * Weights then fall off with distance, get smoothed over the mesh, pieces
 * that are bound to a bone are pinned to it, and each vertex keeps its
 * strongest few bones.
 */

export interface SkinObject {
  positions: Float32Array
  triangles: Uint32Array
  /** Island index per vertex (for rigid binding). */
  islands: Int32Array
  /** Bone pinned per vertex, -1 for none. */
  bound: Int32Array | null
  /** Weights to start from (Blender's bone heat); vertices without any get computed. */
  prior: { index: Uint16Array; weight: Float32Array } | null
}

export interface SkinBone {
  head: [number, number, number]
  tail: [number, number, number]
}

export interface ComputeSettings {
  method: 'auto' | 'nearest' | 'rigid' | 'heat'
  resolution: number
  falloff: number
  smoothing: number
  maxInfluences: number
  /** Loose pieces smaller than this share of the model follow one bone rigidly (0 = off). */
  rigidSmall: number
}

export interface ComputeResult {
  objects: { index: Uint16Array; weight: Float32Array }[]
  unweighted: number
}

export type Progress = (fraction: number, stage: string) => void

const NONE = 65535
/** Influences carried while smoothing, before the final cut to maxInfluences. */
const WORK = 8

export function computeWeights(
  objects: SkinObject[],
  bones: SkinBone[],
  settings: ComputeSettings,
  progress: Progress = () => {}
): ComputeResult {
  const B = bones.length
  if (B === 0) {
    return {
      objects: objects.map((o) => ({
        index: new Uint16Array((o.positions.length / 3) * 4).fill(NONE),
        weight: new Float32Array((o.positions.length / 3) * 4)
      })),
      unweighted: objects.reduce((s, o) => s + o.positions.length / 3, 0)
    }
  }

  // Which vertices still need computed weights.
  const needs = objects.map((o) => {
    const V = o.positions.length / 3
    const need = new Uint8Array(V)
    for (let v = 0; v < V; v++) {
      const pinned = o.bound && o.bound[v] >= 0
      const fromPrior = o.prior && hasWeight(o.prior.weight, v)
      need[v] = pinned || (settings.method === 'heat' && fromPrior) ? 0 : 1
    }
    return need
  })
  const anyNeed = needs.some((n) => n.some((x) => x === 1))

  // Distances from every needed vertex to every bone.
  let dists: Float32Array[] = objects.map(() => new Float32Array(0))
  let eps = 1e-3
  if (anyNeed) {
    if (settings.method === 'nearest') {
      const r = euclideanDistances(objects, bones, needs)
      dists = r.dists
      eps = r.eps
    } else {
      const r = geodesicDistances(objects, bones, needs, settings.resolution, progress)
      dists = r.dists
      eps = r.eps
    }
  }

  progress(0.85, 'weights')
  const work = objects.map((o, oi) => {
    const V = o.positions.length / 3
    const idx = new Int32Array(V * WORK).fill(-1)
    const w = new Float32Array(V * WORK)
    const d = dists[oi]
    const scratch = new Float32Array(B)
    for (let v = 0; v < V; v++) {
      if (o.prior && settings.method === 'heat' && hasWeight(o.prior.weight, v)) {
        for (let k = 0; k < 4; k++) {
          const b = o.prior.index[v * 4 + k]
          if (b !== NONE) {
            idx[v * WORK + k] = b
            w[v * WORK + k] = o.prior.weight[v * 4 + k]
          }
        }
        continue
      }
      if (!needs[oi][v]) {
        continue
      }
      for (let b = 0; b < B; b++) {
        const dv = d[v * B + b]
        scratch[b] = Number.isFinite(dv) ? 1 / Math.pow(dv + eps, settings.falloff) : 0
      }
      keepTop(scratch, idx, w, v * WORK, WORK)
    }
    return { idx, w }
  })

  // Rigid: every loose piece follows its single strongest bone.
  if (settings.method === 'rigid') {
    objects.forEach((o, oi) => rigidify(o, work[oi], B, null))
  } else {
    if (settings.smoothing > 0) {
      progress(0.9, 'smoothing')
      objects.forEach((o, oi) => smooth(o, work[oi], settings.smoothing, needs[oi]))
    }
    // Small loose pieces (eyes, buttons, teeth) would squash if several bones
    // pulled on them; they follow their strongest bone instead.
    if (settings.rigidSmall > 0) {
      const limit = modelSize(objects, bones).diag * settings.rigidSmall
      objects.forEach((o, oi) => rigidify(o, work[oi], B, smallIslands(o, limit)))
    }
  }

  // Pinned pieces.
  objects.forEach((o, oi) => {
    if (!o.bound) {
      return
    }
    const { idx, w } = work[oi]
    for (let v = 0; v < o.bound.length; v++) {
      if (o.bound[v] < 0) {
        continue
      }
      idx.fill(-1, v * WORK, v * WORK + WORK)
      w.fill(0, v * WORK, v * WORK + WORK)
      idx[v * WORK] = o.bound[v]
      w[v * WORK] = 1
    }
  })

  // Final cut and normalisation.
  let unweighted = 0
  const out = objects.map((o, oi) => {
    const V = o.positions.length / 3
    const K = Math.max(1, Math.min(4, settings.maxInfluences))
    const index = new Uint16Array(V * 4).fill(NONE)
    const weight = new Float32Array(V * 4)
    const { idx, w } = work[oi]
    const order = new Int32Array(WORK)
    for (let v = 0; v < V; v++) {
      const base = v * WORK
      for (let k = 0; k < WORK; k++) {
        order[k] = k
      }
      order.sort((a, b) => w[base + b] - w[base + a])
      let total = 0
      for (let k = 0; k < K; k++) {
        if (idx[base + order[k]] >= 0) {
          total += w[base + order[k]]
        }
      }
      // Tiny leftovers aren't worth an influence slot.
      const floor = total * 0.01
      let kept = 0
      let sum = 0
      for (let k = 0; k < K; k++) {
        const s = base + order[k]
        if (idx[s] >= 0 && w[s] > floor) {
          index[v * 4 + kept] = idx[s]
          weight[v * 4 + kept] = w[s]
          sum += w[s]
          kept++
        }
      }
      if (sum <= 0) {
        unweighted++
        continue
      }
      for (let k = 0; k < kept; k++) {
        weight[v * 4 + k] /= sum
      }
    }
    return { index, weight }
  })
  progress(1, 'done')
  return { objects: out, unweighted }
}

function hasWeight(w: Float32Array, v: number): boolean {
  return w[v * 4] + w[v * 4 + 1] + w[v * 4 + 2] + w[v * 4 + 3] > 1e-4
}

/** Writes the `n` largest entries of `scores` (bone -> score) into idx/w at `at`. */
function keepTop(
  scores: Float32Array,
  idx: Int32Array,
  w: Float32Array,
  at: number,
  n: number
): void {
  for (let b = 0; b < scores.length; b++) {
    const s = scores[b]
    if (s <= 0) {
      continue
    }
    // Find the weakest slot.
    let weakest = at
    for (let k = at + 1; k < at + n; k++) {
      if (w[k] < w[weakest]) {
        weakest = k
      }
    }
    if (s > w[weakest]) {
      w[weakest] = s
      idx[weakest] = b
    }
  }
  let sum = 0
  for (let k = at; k < at + n; k++) {
    sum += w[k]
  }
  if (sum > 0) {
    for (let k = at; k < at + n; k++) {
      w[k] /= sum
    }
  }
}

// --- distances -------------------------------------------------------------------------

function segmentDistance(
  px: number,
  py: number,
  pz: number,
  a: [number, number, number],
  b: [number, number, number]
): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const ll = abx * abx + aby * aby + abz * abz
  let t = ll > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / ll : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + abx * t), py - (a[1] + aby * t), pz - (a[2] + abz * t))
}

function modelSize(
  objects: SkinObject[],
  bones: SkinBone[]
): { min: number[]; max: number[]; diag: number } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const take = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
  }
  for (const o of objects) {
    const P = o.positions
    for (let i = 0; i < P.length; i += 3) {
      take(P[i], P[i + 1], P[i + 2])
    }
  }
  for (const b of bones) {
    take(...b.head)
    take(...b.tail)
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
  return { min, max, diag }
}

function euclideanDistances(
  objects: SkinObject[],
  bones: SkinBone[],
  needs: Uint8Array[]
): { dists: Float32Array[]; eps: number } {
  const B = bones.length
  const { diag } = modelSize(objects, bones)
  const dists = objects.map((o, oi) => {
    const V = o.positions.length / 3
    const d = new Float32Array(V * B)
    const P = o.positions
    for (let v = 0; v < V; v++) {
      if (!needs[oi][v]) {
        continue
      }
      for (let b = 0; b < B; b++) {
        d[v * B + b] = segmentDistance(
          P[v * 3],
          P[v * 3 + 1],
          P[v * 3 + 2],
          bones[b].head,
          bones[b].tail
        )
      }
    }
    return d
  })
  return { dists, eps: diag * 0.005 }
}

/**
 * Distance from each needed vertex to each bone, measured through the
 * voxelised model. Vertices no bone can reach (a loose piece with no bone
 * inside it) fall back to straight-line distance.
 */
function geodesicDistances(
  objects: SkinObject[],
  bones: SkinBone[],
  needs: Uint8Array[],
  resolution: number,
  progress: Progress
): { dists: Float32Array[]; eps: number } {
  const B = bones.length
  const { min, max } = modelSize(objects, bones)
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6)
  const h = longest / Math.max(8, resolution)
  const pad = 2
  const ox = min[0] - pad * h
  const oy = min[1] - pad * h
  const oz = min[2] - pad * h
  const nx = Math.ceil((max[0] - min[0]) / h) + 2 * pad + 1
  const ny = Math.ceil((max[1] - min[1]) / h) + 2 * pad + 1
  const nz = Math.ceil((max[2] - min[2]) / h) + 2 * pad + 1
  const N = nx * ny * nz
  const cellOf = (x: number, y: number, z: number): number => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - ox) / h)))
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - oy) / h)))
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - oz) / h)))
    return i + nx * (j + ny * k)
  }

  progress(0.02, 'voxelising')
  // 1. Surface: sample every triangle densely enough to touch each cell it crosses.
  const solid = new Uint8Array(N)
  for (const o of objects) {
    const P = o.positions
    const T = o.triangles
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3
      const b = T[t + 1] * 3
      const c = T[t + 2] * 3
      const e1 = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2])
      const e2 = Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2])
      const e3 = Math.hypot(P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2])
      const n = Math.max(1, Math.ceil(Math.max(e1, e2, e3) / (h * 0.5)))
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n
          const w = j / n
          const x = P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * w
          const y = P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * w
          const z = P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * w
          solid[cellOf(x, y, z)] = 1
        }
      }
    }
  }

  // 2. Inside: everything the outside can't reach. Open meshes leak and stay a shell,
  // which still works: distances then run along the surface.
  progress(0.08, 'filling')
  const outside = new Uint8Array(N)
  const queue = new Int32Array(N)
  let qh = 0
  let qt = 0
  const pushOut = (c: number): void => {
    if (!solid[c] && !outside[c]) {
      outside[c] = 1
      queue[qt++] = c
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      pushOut(0 + nx * (j + ny * k))
      pushOut(nx - 1 + nx * (j + ny * k))
    }
    for (let i = 0; i < nx; i++) {
      pushOut(i + nx * (0 + ny * k))
      pushOut(i + nx * (ny - 1 + ny * k))
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      pushOut(i + nx * j)
      pushOut(i + nx * (j + ny * (nz - 1)))
    }
  }
  const sx = 1
  const sy = nx
  const sz = nx * ny
  while (qh < qt) {
    const c = queue[qh++]
    const i = c % nx
    const j = Math.floor(c / nx) % ny
    const k = Math.floor(c / sz)
    if (i > 0) {
      pushOut(c - sx)
    }
    if (i < nx - 1) {
      pushOut(c + sx)
    }
    if (j > 0) {
      pushOut(c - sy)
    }
    if (j < ny - 1) {
      pushOut(c + sy)
    }
    if (k > 0) {
      pushOut(c - sz)
    }
    if (k < nz - 1) {
      pushOut(c + sz)
    }
  }
  for (let c = 0; c < N; c++) {
    if (!outside[c]) {
      solid[c] = 1
    }
  }

  // Neighbour offsets (26-connected) and their lengths.
  const offs: number[] = []
  const lens: number[] = []
  const dI: number[] = []
  const dJ: number[] = []
  const dK: number[] = []
  for (let dk = -1; dk <= 1; dk++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0 && dk === 0) {
          continue
        }
        offs.push(di * sx + dj * sy + dk * sz)
        lens.push(Math.hypot(di, dj, dk) * h)
        dI.push(di)
        dJ.push(dj)
        dK.push(dk)
      }
    }
  }

  // Cells the needed vertices sit in, so each bone's field is only read where it matters.
  const vertexCells = objects.map((o, oi) => {
    const V = o.positions.length / 3
    const cells = new Int32Array(V).fill(-1)
    const P = o.positions
    for (let v = 0; v < V; v++) {
      if (needs[oi][v]) {
        cells[v] = cellOf(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])
      }
    }
    return cells
  })
  const dists = objects.map((o) => new Float32Array((o.positions.length / 3) * B).fill(Infinity))

  // 3. One Dijkstra per bone through the solid cells. Float64 on purpose:
  // float32 can round a stored distance up, and then re-relaxing a cell
  // "improves" it again and floods the heap with duplicates.
  const dist = new Float64Array(N)
  const heap = new MinHeap(1 << 16)
  for (let b = 0; b < B; b++) {
    progress(0.1 + (0.75 * b) / B, 'distances')
    dist.fill(Infinity)
    heap.clear()
    const { head, tail } = bones[b]
    const len = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2])
    const steps = Math.max(1, Math.ceil(len / (h * 0.5)))
    for (let s = 0; s <= steps; s++) {
      const f = s / steps
      const x = head[0] + (tail[0] - head[0]) * f
      const y = head[1] + (tail[1] - head[1]) * f
      const z = head[2] + (tail[2] - head[2]) * f
      const c = cellOf(x, y, z)
      if (solid[c]) {
        if (dist[c] > 0) {
          dist[c] = 0
          heap.push(c, 0)
        }
        continue
      }
      // Bone outside the mesh here: start from the nearest solid cell close by.
      const near = nearestSolid(solid, c, nx, ny, nz, 3)
      if (near >= 0) {
        const d = Math.hypot(
          ...cellCentre(near, nx, ny, ox, oy, oz, h).map((v, i) => v - [x, y, z][i])
        )
        if (d < dist[near]) {
          dist[near] = d
          heap.push(near, d)
        }
      }
    }
    while (heap.size > 0) {
      const c = heap.popIndex()
      const dc = heap.lastKey
      if (dc > dist[c]) {
        continue
      }
      const i = c % nx
      const j = Math.floor(c / nx) % ny
      const k = Math.floor(c / sz)
      for (let n = 0; n < 26; n++) {
        const ii = i + dI[n]
        const jj = j + dJ[n]
        const kk = k + dK[n]
        if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) {
          continue
        }
        const nc = c + offs[n]
        if (!solid[nc]) {
          continue
        }
        const nd = dc + lens[n]
        if (nd < dist[nc]) {
          dist[nc] = nd
          heap.push(nc, nd)
        }
      }
    }
    objects.forEach((_, oi) => {
      const cells = vertexCells[oi]
      const out = dists[oi]
      for (let v = 0; v < cells.length; v++) {
        if (cells[v] >= 0) {
          out[v * B + b] = dist[cells[v]]
        }
      }
    })
  }

  // Unreachable vertices: straight-line distance instead.
  objects.forEach((o, oi) => {
    const P = o.positions
    const out = dists[oi]
    const cells = vertexCells[oi]
    for (let v = 0; v < cells.length; v++) {
      if (cells[v] < 0) {
        continue
      }
      let reached = false
      for (let b = 0; b < B; b++) {
        if (Number.isFinite(out[v * B + b])) {
          reached = true
          break
        }
      }
      if (!reached) {
        for (let b = 0; b < B; b++) {
          out[v * B + b] = segmentDistance(
            P[v * 3],
            P[v * 3 + 1],
            P[v * 3 + 2],
            bones[b].head,
            bones[b].tail
          )
        }
      }
    }
  })
  return { dists, eps: h * 0.75 }
}

function cellCentre(
  c: number,
  nx: number,
  ny: number,
  ox: number,
  oy: number,
  oz: number,
  h: number
): [number, number, number] {
  const i = c % nx
  const j = Math.floor(c / nx) % ny
  const k = Math.floor(c / (nx * ny))
  return [ox + (i + 0.5) * h, oy + (j + 0.5) * h, oz + (k + 0.5) * h]
}

function nearestSolid(
  solid: Uint8Array,
  c: number,
  nx: number,
  ny: number,
  nz: number,
  radius: number
): number {
  const i0 = c % nx
  const j0 = Math.floor(c / nx) % ny
  const k0 = Math.floor(c / (nx * ny))
  let best = -1
  let bestD = Infinity
  for (let dk = -radius; dk <= radius; dk++) {
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const i = i0 + di
        const j = j0 + dj
        const k = k0 + dk
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
          continue
        }
        const nc = i + nx * (j + ny * k)
        const d = di * di + dj * dj + dk * dk
        if (solid[nc] && d < bestD) {
          bestD = d
          best = nc
        }
      }
    }
  }
  return best
}

/** Binary min-heap of (cell, key) with lazy deletion. */
class MinHeap {
  private idx: Int32Array
  private key: Float64Array
  size = 0
  lastKey = 0

  constructor(capacity: number) {
    this.idx = new Int32Array(capacity)
    this.key = new Float64Array(capacity)
  }

  clear(): void {
    this.size = 0
  }

  push(i: number, k: number): void {
    if (this.size === this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2)
      const nk = new Float64Array(this.key.length * 2)
      ni.set(this.idx)
      nk.set(this.key)
      this.idx = ni
      this.key = nk
    }
    let n = this.size++
    while (n > 0) {
      const p = (n - 1) >> 1
      if (this.key[p] <= k) {
        break
      }
      this.idx[n] = this.idx[p]
      this.key[n] = this.key[p]
      n = p
    }
    this.idx[n] = i
    this.key[n] = k
  }

  popIndex(): number {
    const top = this.idx[0]
    this.lastKey = this.key[0]
    const last = --this.size
    if (last > 0) {
      const li = this.idx[last]
      const lk = this.key[last]
      let n = 0
      for (;;) {
        const l = 2 * n + 1
        if (l >= last) {
          break
        }
        const r = l + 1
        const c = r < last && this.key[r] < this.key[l] ? r : l
        if (this.key[c] >= lk) {
          break
        }
        this.idx[n] = this.idx[c]
        this.key[n] = this.key[c]
        n = c
      }
      this.idx[n] = li
      this.key[n] = lk
    }
    return top
  }
}

// --- smoothing and rigid -----------------------------------------------------------------

/** Vertex neighbours (CSR), with vertices at the same position joined. */
export function adjacency(o: SkinObject): { start: Int32Array; list: Int32Array; rep: Int32Array } {
  const V = o.positions.length / 3
  const P = o.positions
  // Weld: one representative per position.
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < P.length; i++) {
    lo = Math.min(lo, P[i])
    hi = Math.max(hi, P[i])
  }
  const q = Math.max(hi - lo, 1e-6) * 1e-6
  const repOf = new Map<string, number>()
  const rep = new Int32Array(V)
  for (let v = 0; v < V; v++) {
    const key = `${Math.round(P[v * 3] / q)},${Math.round(P[v * 3 + 1] / q)},${Math.round(P[v * 3 + 2] / q)}`
    const r = repOf.get(key)
    if (r === undefined) {
      repOf.set(key, v)
      rep[v] = v
    } else {
      rep[v] = r
    }
  }
  const sets: Set<number>[] = Array.from({ length: V }, () => new Set<number>())
  const T = o.triangles
  for (let t = 0; t < T.length; t += 3) {
    const a = rep[T[t]]
    const b = rep[T[t + 1]]
    const c = rep[T[t + 2]]
    if (a !== b) {
      sets[a].add(b)
      sets[b].add(a)
    }
    if (b !== c) {
      sets[b].add(c)
      sets[c].add(b)
    }
    if (a !== c) {
      sets[a].add(c)
      sets[c].add(a)
    }
  }
  const start = new Int32Array(V + 1)
  for (let v = 0; v < V; v++) {
    start[v + 1] = start[v] + sets[v].size
  }
  const list = new Int32Array(start[V])
  for (let v = 0; v < V; v++) {
    let k = start[v]
    for (const n of sets[v]) {
      list[k++] = n
    }
  }
  return { start, list, rep }
}

/**
 * Laplacian smoothing of sparse weights over the mesh. Only vertices that were
 * computed here move; Blender's or pinned weights are left alone but still
 * feed their neighbours.
 */
function smooth(
  o: SkinObject,
  work: { idx: Int32Array; w: Float32Array },
  passes: number,
  movable: Uint8Array
): void {
  const { start, list, rep } = adjacency(o)
  const V = o.positions.length / 3
  let { idx, w } = work
  const accIdx = new Int32Array(WORK * 32)
  const accW = new Float32Array(WORK * 32)
  for (let pass = 0; pass < passes; pass++) {
    const nIdx = idx.slice()
    const nW = w.slice()
    for (let v = 0; v < V; v++) {
      if (rep[v] !== v || !movable[v]) {
        continue
      }
      const deg = start[v + 1] - start[v]
      if (deg === 0) {
        continue
      }
      let used = 0
      const add = (b: number, x: number): void => {
        for (let k = 0; k < used; k++) {
          if (accIdx[k] === b) {
            accW[k] += x
            return
          }
        }
        if (used < accIdx.length) {
          accIdx[used] = b
          accW[used] = x
          used++
        }
      }
      for (let k = 0; k < WORK; k++) {
        const b = idx[v * WORK + k]
        if (b >= 0) {
          add(b, w[v * WORK + k] * 0.5)
        }
      }
      const share = 0.5 / deg
      for (let e = start[v]; e < start[v + 1]; e++) {
        const n = list[e]
        for (let k = 0; k < WORK; k++) {
          const b = idx[n * WORK + k]
          if (b >= 0) {
            add(b, w[n * WORK + k] * share)
          }
        }
      }
      // Keep the strongest WORK.
      nIdx.fill(-1, v * WORK, v * WORK + WORK)
      nW.fill(0, v * WORK, v * WORK + WORK)
      for (let k = 0; k < used; k++) {
        let weakest = v * WORK
        for (let s = v * WORK + 1; s < v * WORK + WORK; s++) {
          if (nW[s] < nW[weakest]) {
            weakest = s
          }
        }
        if (accW[k] > nW[weakest]) {
          nW[weakest] = accW[k]
          nIdx[weakest] = accIdx[k]
        }
      }
    }
    idx = nIdx
    w = nW
  }
  // Duplicates take their representative's weights.
  for (let v = 0; v < V; v++) {
    const r = rep[v]
    if (r !== v) {
      for (let k = 0; k < WORK; k++) {
        idx[v * WORK + k] = idx[r * WORK + k]
        w[v * WORK + k] = w[r * WORK + k]
      }
    }
  }
  work.idx.set(idx)
  work.w.set(w)
}

/** Islands whose bounding box diagonal is under `limit`. */
function smallIslands(o: SkinObject, limit: number): Set<number> {
  const V = o.positions.length / 3
  const P = o.positions
  const box = new Map<number, number[]>()
  for (let v = 0; v < V; v++) {
    const i = o.islands[v]
    let b = box.get(i)
    if (!b) {
      b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
      box.set(i, b)
    }
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], P[v * 3 + k])
      b[k + 3] = Math.max(b[k + 3], P[v * 3 + k])
    }
  }
  const out = new Set<number>()
  for (const [i, b] of box) {
    if (Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) < limit) {
      out.add(i)
    }
  }
  return out
}

/** Each island (or each in `only`) goes 100% to the bone with the most total weight in it. */
function rigidify(
  o: SkinObject,
  work: { idx: Int32Array; w: Float32Array },
  B: number,
  only: Set<number> | null
): void {
  if (only && only.size === 0) {
    return
  }
  const V = o.positions.length / 3
  let count = 0
  for (let v = 0; v < V; v++) {
    count = Math.max(count, o.islands[v] + 1)
  }
  const score = new Float32Array(count * B)
  for (let v = 0; v < V; v++) {
    for (let k = 0; k < WORK; k++) {
      const b = work.idx[v * WORK + k]
      if (b >= 0) {
        score[o.islands[v] * B + b] += work.w[v * WORK + k]
      }
    }
  }
  const best = new Int32Array(count).fill(-1)
  for (let i = 0; i < count; i++) {
    let top = 0
    for (let b = 0; b < B; b++) {
      if (score[i * B + b] > top) {
        top = score[i * B + b]
        best[i] = b
      }
    }
  }
  for (let v = 0; v < V; v++) {
    if (only && !only.has(o.islands[v])) {
      continue
    }
    work.idx.fill(-1, v * WORK, v * WORK + WORK)
    work.w.fill(0, v * WORK, v * WORK + WORK)
    const b = best[o.islands[v]]
    if (b >= 0) {
      work.idx[v * WORK] = b
      work.w[v * WORK] = 1
    }
  }
}
