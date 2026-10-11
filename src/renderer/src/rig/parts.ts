import type { Bone, MeshPart, PartKey, Vec3 } from './types'
import { makeBone, uniqueName } from './skeleton'
import { add, dot, normalize, scale, sub } from './vec'

/**
 * Pieces of a model: whole objects, or the loose parts inside one object
 * (an armour plate, an eyeball, a robot joint that was modelled separately).
 * Pieces can be bound to one bone so they move rigidly, or each be given a
 * bone of its own, which rigs a mechanical model in one click.
 */

export interface Islands {
  /** Island index per vertex. */
  of: Int32Array
  count: number
  /** Vertex count per island. */
  sizes: number[]
}

/**
 * Connected pieces of a mesh. Vertices at the same position count as joined,
 * since many game meshes are split along UV seams and hard edges.
 */
export function computeIslands(part: MeshPart): Islands {
  const V = part.positions.length / 3
  const parent = new Int32Array(V)
  for (let i = 0; i < V; i++) {
    parent[i] = i
  }
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) {
      parent[ra] = rb
    }
  }
  const T = part.triangles
  for (let t = 0; t < T.length; t += 3) {
    union(T[t], T[t + 1])
    union(T[t + 1], T[t + 2])
  }
  for (const group of weldGroups(part.positions)) {
    for (let i = 1; i < group.length; i++) {
      union(group[0], group[i])
    }
  }
  const ids = new Map<number, number>()
  const of = new Int32Array(V)
  const sizes: number[] = []
  for (let i = 0; i < V; i++) {
    const r = find(i)
    let id = ids.get(r)
    if (id === undefined) {
      id = ids.size
      ids.set(r, id)
      sizes.push(0)
    }
    of[i] = id
    sizes[id] += 1
  }
  return { of, count: ids.size, sizes }
}

/** Groups of vertex indices that sit at the same position (only groups of 2+). */
export function weldGroups(positions: Float32Array): number[][] {
  const V = positions.length / 3
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < positions.length; i++) {
    min = Math.min(min, positions[i])
    max = Math.max(max, positions[i])
  }
  const q = Math.max(max - min, 1e-6) * 1e-6
  const seen = new Map<string, number[]>()
  for (let i = 0; i < V; i++) {
    const key = `${Math.round(positions[i * 3] / q)},${Math.round(positions[i * 3 + 1] / q)},${Math.round(positions[i * 3 + 2] / q)}`
    const list = seen.get(key)
    if (list) {
      list.push(i)
    } else {
      seen.set(key, [i])
    }
  }
  return [...seen.values()].filter((g) => g.length > 1)
}

export const objectKey = (name: string): PartKey => name
export const islandKey = (name: string, island: number): PartKey => `${name}#${island}`

export function parseKey(key: PartKey): { object: string; island: number | null } {
  const m = /^(.*)#(\d+)$/.exec(key)
  return m ? { object: m[1], island: Number(m[2]) } : { object: key, island: null }
}

/**
 * Per vertex, the bone a binding pins it to (-1 when it's skinned normally).
 * An island binding beats the binding of its whole object.
 */
export function boundBonePerVertex(
  part: MeshPart,
  islands: Islands | null,
  bindings: Record<PartKey, string>,
  boneIndex: Map<string, number>
): Int32Array | null {
  const V = part.positions.length / 3
  const whole = bindings[objectKey(part.name)]
  const wholeIdx = whole !== undefined ? (boneIndex.get(whole) ?? -1) : -1
  const perIsland = new Map<number, number>()
  for (const [key, bone] of Object.entries(bindings)) {
    const k = parseKey(key)
    if (k.object === part.name && k.island !== null) {
      const idx = boneIndex.get(bone)
      if (idx !== undefined) {
        perIsland.set(k.island, idx)
      }
    }
  }
  if (wholeIdx < 0 && perIsland.size === 0) {
    return null
  }
  const out = new Int32Array(V).fill(wholeIdx)
  if (islands && perIsland.size) {
    for (let v = 0; v < V; v++) {
      const b = perIsland.get(islands.of[v])
      if (b !== undefined) {
        out[v] = b
      }
    }
  }
  return out
}

// --- one bone per piece ------------------------------------------------------------------

export interface Piece {
  key: PartKey
  label: string
  part: MeshPart
  /** Vertex indices in `part` (null = all of them). */
  vertices: Uint32Array | null
  min: Vec3
  max: Vec3
  centroid: Vec3
}

export function piecesOf(part: MeshPart, islands: Islands | null): Piece[] {
  const V = part.positions.length / 3
  if (!islands || islands.count <= 1) {
    return [makePiece(objectKey(part.name), part.name, part, null)]
  }
  const lists: number[][] = Array.from({ length: islands.count }, () => [])
  for (let v = 0; v < V; v++) {
    lists[islands.of[v]].push(v)
  }
  return lists.map((list, i) =>
    makePiece(
      islandKey(part.name, i),
      `${part.name}_${String(i + 1).padStart(2, '0')}`,
      part,
      new Uint32Array(list)
    )
  )
}

function makePiece(
  key: PartKey,
  label: string,
  part: MeshPart,
  vertices: Uint32Array | null
): Piece {
  const P = part.positions
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let sum: Vec3 = [0, 0, 0]
  const count = vertices ? vertices.length : P.length / 3
  for (let k = 0; k < count; k++) {
    const v = vertices ? vertices[k] : k
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a])
      max[a] = Math.max(max[a], p[a])
    }
    sum = add(sum, p)
  }
  return { key, label, part, vertices, min, max, centroid: scale(sum, 1 / Math.max(1, count)) }
}

const volume = (p: Piece): number =>
  Math.max(p.max[0] - p.min[0], 1e-6) *
  Math.max(p.max[1] - p.min[1], 1e-6) *
  Math.max(p.max[2] - p.min[2], 1e-6)

/** Gap between two boxes (0 when they touch or overlap). */
function boxGap(a: Piece, b: Piece): number {
  let s = 0
  for (let i = 0; i < 3; i++) {
    const d = Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i])
    s += d * d
  }
  return Math.sqrt(s)
}

/** Middle of where two boxes touch (their overlap, grown by `tol`). */
function contactPoint(a: Piece, b: Piece, tol: number): Vec3 {
  const out: Vec3 = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.min[i] - tol, b.min[i] - tol)
    const hi = Math.min(a.max[i] + tol, b.max[i] + tol)
    out[i] = lo <= hi ? (lo + hi) / 2 : (a.centroid[i] + b.centroid[i]) / 2
  }
  return out
}

function sanitize(label: string): string {
  return label.replace(/[^\w.\- ]+/g, '_').trim() || 'part'
}

/**
 * A bone for every piece. The biggest piece is the root; every other piece
 * hangs off the piece it touches (or the nearest one), with its bone starting
 * where they meet and running out through the piece. Each piece is bound to
 * its bone, so it moves rigidly. Existing bones are kept.
 */
export function bonesFromPieces(
  pieces: Piece[],
  existing: Bone[],
  diagonal: number
): { bones: Bone[]; bindings: Record<PartKey, string> } {
  if (pieces.length === 0) {
    return { bones: existing, bindings: {} }
  }
  const tol = diagonal * 0.01
  const n = pieces.length
  const rootIdx = pieces.reduce((best, p, i) => (volume(p) > volume(pieces[best]) ? i : best), 0)
  const parentOf = new Int32Array(n).fill(-1)
  const placed = new Set([rootIdx])
  const order = [rootIdx]
  // Grow the tree through touching pieces first, then the nearest leftovers.
  while (placed.size < n) {
    let best: { child: number; parent: number; gap: number } | null = null
    for (let c = 0; c < n; c++) {
      if (placed.has(c)) {
        continue
      }
      for (const p of placed) {
        const gap = boxGap(pieces[c], pieces[p])
        // Among equal contacts the parent placed first (higher up the tree)
        // wins, so a chain of touching parts becomes a chain of bones.
        best = !best || gap < best.gap - tol * 0.01 ? { child: c, parent: p, gap } : best
      }
    }
    if (!best) {
      break
    }
    parentOf[best.child] = best.parent
    placed.add(best.child)
    order.push(best.child)
  }

  const bones = [...existing]
  const bindings: Record<PartKey, string> = {}
  const boneOf = new Map<number, Bone>()
  for (const i of order) {
    const piece = pieces[i]
    const name = uniqueName(bones, sanitize(piece.label))
    let head: Vec3
    let tail: Vec3
    if (parentOf[i] < 0) {
      const c = piece.centroid
      head = [c[0], c[1], piece.min[2]]
      tail = [c[0], c[1], Math.max(piece.max[2], piece.min[2] + diagonal * 0.05)]
    } else {
      head = contactPoint(piece, pieces[parentOf[i]], tol)
      let dir = sub(piece.centroid, head)
      if (Math.hypot(...dir) < diagonal * 0.005) {
        const ext = sub(piece.max, piece.min)
        const axis = ext.indexOf(Math.max(...ext))
        dir = [0, 0, 0]
        dir[axis] = 1
      }
      dir = normalize(dir)
      // Out to the far end of the piece along that direction.
      let reach = 0
      const P = piece.part.positions
      const count = piece.vertices ? piece.vertices.length : P.length / 3
      for (let k = 0; k < count; k++) {
        const v = piece.vertices ? piece.vertices[k] : k
        reach = Math.max(reach, dot(sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], head), dir))
      }
      tail = add(head, scale(dir, Math.max(reach, diagonal * 0.02)))
    }
    const bone = makeBone({
      name,
      head,
      tail,
      parent: parentOf[i] >= 0 ? boneOf.get(parentOf[i])!.id : null,
      role: 'part'
    })
    bones.push(bone)
    boneOf.set(i, bone)
    bindings[piece.key] = bone.id
  }
  return { bones, bindings }
}
