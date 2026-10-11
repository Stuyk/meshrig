import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { MeshPart, Vec3 } from './types'

/**
 * Geometry questions about the model, in Blender space: where a ray enters
 * and leaves it, where the middle of a limb is, what it looks like from the
 * front. Built once per set of included meshes.
 */

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface Silhouette {
  /** 1 where the model covers the cell. Row-major, row 0 at the bottom. */
  mask: Uint8Array
  cols: number
  rows: number
  /** Blender-space coordinate of column 0 / row 0 (cell centre) and cell size. */
  u0: number
  v0: number
  cell: number
  /** Which Blender axes map to columns and rows. */
  axes: [0 | 1 | 2, 0 | 1 | 2]
}

const _ray = new THREE.Ray()

export class MeshProbe {
  readonly parts: MeshPart[]
  readonly bounds: Bounds
  readonly diagonal: number
  private bvhs: MeshBVH[]

  constructor(parts: MeshPart[]) {
    this.parts = parts
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const p of parts) {
      const a = p.positions
      for (let i = 0; i < a.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], a[i + k])
          max[k] = Math.max(max[k], a[i + k])
        }
      }
    }
    if (!Number.isFinite(min[0])) {
      min.fill(-1)
      max.fill(1)
    }
    this.bounds = { min, max }
    this.diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
    this.bvhs = parts.map((p) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3))
      g.setIndex(new THREE.BufferAttribute(p.triangles, 1))
      // Indirect: a normal MeshBVH reorders the index buffer in place, which
      // would scramble the part's triangles against its per-triangle normals,
      // UVs and materials. Hit face indices then stay the part's own.
      return new MeshBVH(g, { indirect: true })
    })
  }

  get height(): number {
    return this.bounds.max[2] - this.bounds.min[2]
  }

  get center(): Vec3 {
    const { min, max } = this.bounds
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  }

  /** Distances along the ray where it crosses the surface, sorted, near-duplicates merged. */
  hits(origin: Vec3, dir: Vec3, onlyParts?: Set<number>): number[] {
    _ray.origin.set(...origin)
    _ray.direction.set(...dir).normalize()
    const out: number[] = []
    this.bvhs.forEach((bvh, i) => {
      if (onlyParts && !onlyParts.has(i)) {
        return
      }
      for (const h of bvh.raycast(_ray, THREE.DoubleSide)) {
        out.push(h.distance)
      }
    })
    out.sort((a, b) => a - b)
    const eps = this.diagonal * 1e-6
    return out.filter((t, i) => i === 0 || t - out[i - 1] > eps)
  }

  /** First hit along a ray: distance and which part, or null. */
  firstHit(origin: Vec3, dir: Vec3): { distance: number; part: number; face: number } | null {
    _ray.origin.set(...origin)
    _ray.direction.set(...dir).normalize()
    let best: { distance: number; part: number; face: number } | null = null
    this.bvhs.forEach((bvh, i) => {
      const h = bvh.raycastFirst(_ray, THREE.DoubleSide)
      if (h && (!best || h.distance < best.distance)) {
        best = { distance: h.distance, part: i, face: h.faceIndex ?? 0 }
      }
    })
    return best
  }

  /**
   * The middle of the model along a viewing ray: halfway between where the
   * ray enters the first piece of surface and leaves it again. That's what
   * puts a joint inside a limb when you click on it from the front.
   */
  centerOnRay(origin: Vec3, dir: Vec3): Vec3 | null {
    const t = this.hits(origin, dir)
    if (t.length === 0) {
      return null
    }
    const n = normalizeDir(dir)
    const d = t.length >= 2 ? (t[0] + t[1]) / 2 : t[0]
    return [origin[0] + n[0] * d, origin[1] + n[1] * d, origin[2] + n[2] * d]
  }

  /**
   * Moves `p` along `axis` to the middle of the solid span it's in (or the
   * nearest one within `maxShift`). Null when nothing is close enough.
   */
  centerAlong(p: Vec3, axis: Vec3, maxShift = this.diagonal * 0.08): Vec3 | null {
    const n = normalizeDir(axis)
    const far = this.diagonal * 2
    const origin: Vec3 = [p[0] - n[0] * far, p[1] - n[1] * far, p[2] - n[2] * far]
    const t = this.hits(origin, n)
    if (t.length < 2) {
      return null
    }
    let best: number | null = null
    let bestGap = Infinity
    for (let i = 0; i + 1 < t.length; i += 2) {
      const a = t[i]
      const b = t[i + 1]
      const gap = far < a ? a - far : far > b ? far - b : 0
      if (gap < bestGap) {
        bestGap = gap
        best = (a + b) / 2
      }
    }
    if (best === null || bestGap > maxShift) {
      return null
    }
    return [origin[0] + n[0] * best, origin[1] + n[1] * best, origin[2] + n[2] * best]
  }

  /**
   * Centres `p` in the limb around it, across the two world axes that are
   * most perpendicular to `along` (the bone direction). Two passes, since
   * centring on one axis can shift the span on the other. `maxMove` stops a
   * joint inside a big mass (a hip in the pelvis, a shoulder in the chest)
   * from being dragged to the middle of the whole body.
   */
  centerInVolume(p: Vec3, along: Vec3, maxMove = Infinity): Vec3 {
    const d = normalizeDir(along)
    const axes: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
    const ranked = axes
      .map((a, i) => ({ a, i, s: Math.abs(d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) }))
      .sort((x, y) => x.s - y.s)
      .slice(0, 2)
    let q = p
    for (let pass = 0; pass < 2; pass++) {
      for (const { a } of ranked) {
        const c = this.centerAlong(q, a)
        if (c && Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) <= maxMove) {
          q = c
        }
      }
    }
    return q
  }

  /**
   * The model's outline seen along one axis, rasterised from its triangles.
   * `view` 'front' looks along Y (columns X, rows Z); 'side' along X
   * (columns Y, rows Z); 'top' along Z (columns X, rows Y).
   */
  silhouette(view: 'front' | 'side' | 'top', rows = 160): Silhouette {
    const axes: [0 | 1 | 2, 0 | 1 | 2] =
      view === 'front' ? [0, 2] : view === 'side' ? [1, 2] : [0, 1]
    const [ua, va] = axes
    const { min, max } = this.bounds
    const span = Math.max(max[va] - min[va], 1e-6)
    const cell = span / rows
    const cols = Math.max(1, Math.ceil((max[ua] - min[ua]) / cell) + 1)
    const rowCount = rows + 1
    const mask = new Uint8Array(cols * rowCount)
    const u0 = min[ua]
    const v0 = min[va]
    const toU = (x: number): number => (x - u0) / cell
    const toV = (x: number): number => (x - v0) / cell
    for (const part of this.parts) {
      const P = part.positions
      const T = part.triangles
      for (let t = 0; t < T.length; t += 3) {
        const ax = toU(P[T[t] * 3 + ua])
        const ay = toV(P[T[t] * 3 + va])
        const bx = toU(P[T[t + 1] * 3 + ua])
        const by = toV(P[T[t + 1] * 3 + va])
        const cx = toU(P[T[t + 2] * 3 + ua])
        const cy = toV(P[T[t + 2] * 3 + va])
        fillTriangle(mask, cols, rowCount, ax, ay, bx, by, cx, cy)
      }
    }
    return { mask, cols, rows: rowCount, u0, v0, cell, axes }
  }

  /** Closest surface point to `p` within the given parts. */
  closestPoint(p: Vec3, part: number): { point: Vec3; distance: number } | null {
    const target = new THREE.Vector3(...p)
    const hit = this.bvhs[part]?.closestPointToPoint(target)
    if (!hit) {
      return null
    }
    return { point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance }
  }

  dispose(): void {
    for (const b of this.bvhs) {
      b.geometry.dispose()
    }
  }
}

function normalizeDir(d: Vec3): Vec3 {
  const l = Math.hypot(d[0], d[1], d[2]) || 1
  return [d[0] / l, d[1] / l, d[2] / l]
}

/** Marks every cell a 2D triangle touches (coordinates in cells). */
function fillTriangle(
  mask: Uint8Array,
  cols: number,
  rows: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): void {
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(rows - 1, Math.ceil(Math.max(ay, by, cy)))
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(cols - 1, Math.ceil(Math.max(ax, bx, cx)))
  // Tiny triangles: mark their corners' cells.
  if (maxX - minX <= 1 && maxY - minY <= 1) {
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
      [cx, cy]
    ]) {
      const xi = Math.min(cols - 1, Math.max(0, Math.round(x)))
      const yi = Math.min(rows - 1, Math.max(0, Math.round(y)))
      mask[yi * cols + xi] = 1
    }
    return
  }
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < 1e-12) {
    return
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Sample the cell centre, with a half-cell tolerance so thin slivers still show.
      const w0 = edge(bx, by, cx, cy, x, y) / area
      const w1 = edge(cx, cy, ax, ay, x, y) / area
      const w2 = 1 - w0 - w1
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) {
        mask[y * cols + x] = 1
      }
    }
  }
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}
