import { describe, expect, it } from 'vitest'
import { dominantAxis, isAxisView, snapAngle, snapToGrid } from './snapping'

describe('snapping', () => {
  it('rounds to the grid except along the view depth', () => {
    expect(snapToGrid([0.12, 0.337, 1.04], 0.1, 1)).toEqual([0.1, 0.337, 1])
  })

  it('snaps a bone to 15 degree steps in the view plane, keeping depth', () => {
    // Front view: right = +X, up = +Z, normal = +Y (looking along +Y).
    const r = snapAngle([1, 0.3, 0.2], [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 15)
    expect(r.degrees).toBe(15)
    expect(r.point[1]).toBeCloseTo(0.3)
    const len = Math.hypot(r.point[0], r.point[2])
    expect(len).toBeCloseTo(Math.hypot(1, 0.2))
    expect(Math.atan2(r.point[2], r.point[0]) * (180 / Math.PI)).toBeCloseTo(15)
  })

  it('snaps straight down', () => {
    const r = snapAngle([0.03, 0, -1], [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 15, 0.25)
    expect(r.degrees).toBe(270)
    expect(r.point[0]).toBeCloseTo(0)
    expect(r.point[2]).toBeCloseTo(-1)
  })

  it('knows axis views', () => {
    expect(dominantAxis([0, -1, 0])).toBe(1)
    expect(isAxisView([0, -1, 0])).toBe(true)
    expect(isAxisView([0.3, -0.95, 0])).toBe(false)
  })
})
