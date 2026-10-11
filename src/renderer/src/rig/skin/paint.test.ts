import { describe, expect, it } from 'vitest'
import { applyDab } from './paint'

const NONE = 65535
/** Three vertices in a row, all fully on bone 0. */
function strip(): { pos: Float32Array; index: Uint16Array; weight: Float32Array } {
  const index = new Uint16Array(12).fill(NONE)
  const weight = new Float32Array(12)
  for (let v = 0; v < 3; v++) {
    index[v * 4] = 0
    weight[v * 4] = 1
  }
  return { pos: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), index, weight }
}
const sum = (w: Float32Array, v: number): number =>
  w[v * 4] + w[v * 4 + 1] + w[v * 4 + 2] + w[v * 4 + 3]
const weightOf = (s: ReturnType<typeof strip>, v: number, bone: number): number => {
  let x = 0
  for (let k = 0; k < 4; k++) {
    if (s.index[v * 4 + k] === bone) {
      x += s.weight[v * 4 + k]
    }
  }
  return x
}

describe('weight brush', () => {
  it('adds a bone under the brush and keeps weights normalised', () => {
    const s = strip()
    const n = applyDab(s.pos, s.index, s.weight, {
      center: [0, 0, 0],
      radius: 1.5,
      strength: 0.5,
      mode: 'add',
      bone: 1,
      fallback: 0
    })
    expect(n).toBe(2)
    expect(weightOf(s, 0, 1)).toBeCloseTo(0.5)
    expect(weightOf(s, 1, 1)).toBeGreaterThan(0)
    expect(weightOf(s, 1, 1)).toBeLessThan(0.5)
    expect(weightOf(s, 2, 1)).toBe(0)
    for (let v = 0; v < 3; v++) {
      expect(sum(s.weight, v)).toBeCloseTo(1)
    }
  })

  it('subtracting the only bone hands the weight to the fallback', () => {
    const s = strip()
    applyDab(s.pos, s.index, s.weight, {
      center: [2, 0, 0],
      radius: 0.5,
      strength: 1,
      mode: 'subtract',
      bone: 0,
      fallback: 3
    })
    expect(weightOf(s, 2, 3)).toBeCloseTo(1)
  })

  it('makes room for the painted bone on a full vertex', () => {
    const s = strip()
    s.index.set([0, 4, 5, 6], 0)
    s.weight.set([0.4, 0.3, 0.2, 0.1], 0)
    applyDab(s.pos, s.index, s.weight, {
      center: [0, 0, 0],
      radius: 0.5,
      strength: 0.1,
      mode: 'add',
      bone: 9,
      fallback: 0
    })
    expect(weightOf(s, 0, 9)).toBeGreaterThan(0)
  })

  it('smooths toward the neighbours', () => {
    const s = strip()
    s.index[4] = 1 // middle vertex fully on bone 1
    const neighbours = { start: new Int32Array([0, 1, 3, 4]), list: new Int32Array([1, 0, 2, 1]) }
    applyDab(
      s.pos,
      s.index,
      s.weight,
      { center: [1, 0, 0], radius: 0.5, strength: 1, mode: 'smooth', bone: 0, fallback: 0 },
      neighbours
    )
    expect(weightOf(s, 1, 0)).toBeGreaterThan(0.9)
  })
})
