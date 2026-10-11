/**
 * Weight painting: one brush dab on top-4 skin weights. Pure, so it can be
 * tested; the store decides what to paint and keeps the undo history.
 */

export type PaintMode = 'add' | 'subtract' | 'smooth'

export interface Dab {
  center: [number, number, number]
  radius: number
  /** 0..1, how much one dab changes a vertex at the centre of the brush. */
  strength: number
  mode: PaintMode
  /** Index (into the weights' bone list) of the bone being painted. */
  bone: number
  /** Where weight taken away by Subtract goes when nothing else holds the vertex. */
  fallback: number
}

const NONE = 65535

/** Bone weights of vertex `v` as a small map. */
function read(index: Uint16Array, weight: Float32Array, v: number): Map<number, number> {
  const m = new Map<number, number>()
  for (let k = 0; k < 4; k++) {
    const b = index[v * 4 + k]
    const w = weight[v * 4 + k]
    if (b !== NONE && w > 0) {
      m.set(b, (m.get(b) ?? 0) + w)
    }
  }
  return m
}

/**
 * Writes the strongest four back, normalised. `keep` (the bone being painted)
 * always gets a slot, or a fully-used vertex could never take a new bone.
 */
function write(
  index: Uint16Array,
  weight: Float32Array,
  v: number,
  m: Map<number, number>,
  keep = -1
): void {
  const sorted = [...m.entries()].filter(([, w]) => w > 1e-5).sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, 4)
  const kept = sorted.find(([b]) => b === keep)
  if (kept && !top.includes(kept)) {
    top[3] = kept
  }
  const sum = top.reduce((s, [, w]) => s + w, 0)
  for (let k = 0; k < 4; k++) {
    const e = top[k]
    index[v * 4 + k] = e && sum > 0 ? e[0] : NONE
    weight[v * 4 + k] = e && sum > 0 ? e[1] / sum : 0
  }
}

/**
 * Applies one dab to the vertices of one object. `neighbours` (CSR) is only
 * needed for Smooth. Returns how many vertices changed.
 */
export function applyDab(
  positions: Float32Array,
  index: Uint16Array,
  weight: Float32Array,
  dab: Dab,
  neighbours?: { start: Int32Array; list: Int32Array }
): number {
  const V = positions.length / 3
  const [cx, cy, cz] = dab.center
  const r2 = dab.radius * dab.radius
  const touched: { v: number; f: number }[] = []
  for (let v = 0; v < V; v++) {
    const dx = positions[v * 3] - cx
    const dy = positions[v * 3 + 1] - cy
    const dz = positions[v * 3 + 2] - cz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < r2) {
      const t = 1 - Math.sqrt(d2) / dab.radius
      touched.push({ v, f: t * t * (3 - 2 * t) * dab.strength })
    }
  }
  if (dab.mode === 'smooth') {
    if (!neighbours) {
      return 0
    }
    // Read everything first, so the dab doesn't smear in vertex order.
    const before = touched.map(({ v }) => {
      const avg = new Map<number, number>()
      const n = neighbours.start[v + 1] - neighbours.start[v]
      for (let e = neighbours.start[v]; e < neighbours.start[v + 1]; e++) {
        for (const [b, w] of read(index, weight, neighbours.list[e])) {
          avg.set(b, (avg.get(b) ?? 0) + w / Math.max(1, n))
        }
      }
      return avg
    })
    touched.forEach(({ v, f }, i) => {
      if (before[i].size === 0) {
        return
      }
      const own = read(index, weight, v)
      const mixed = new Map<number, number>()
      for (const b of new Set([...own.keys(), ...before[i].keys()])) {
        mixed.set(b, (own.get(b) ?? 0) * (1 - f) + (before[i].get(b) ?? 0) * f)
      }
      write(index, weight, v, mixed)
    })
    return touched.length
  }
  for (const { v, f } of touched) {
    const m = read(index, weight, v)
    const cur = m.get(dab.bone) ?? 0
    const next = dab.mode === 'add' ? cur + (1 - cur) * f : cur * (1 - f)
    const othersBefore = [...m.entries()]
      .filter(([b]) => b !== dab.bone)
      .reduce((s, [, w]) => s + w, 0)
    const othersAfter = 1 - next
    if (othersBefore > 1e-6) {
      // The other bones share what's left, in the proportions they had.
      for (const [b, w] of m) {
        m.set(b, b === dab.bone ? w : (w / othersBefore) * othersAfter)
      }
    } else if (othersAfter > 1e-6) {
      m.set(dab.fallback, othersAfter)
    }
    m.set(dab.bone, next)
    write(index, weight, v, m, dab.bone)
  }
  return touched.length
}
