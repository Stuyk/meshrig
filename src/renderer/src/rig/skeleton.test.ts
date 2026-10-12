import { describe, expect, it } from 'vitest'
import {
  deleteBones,
  makeBone,
  mirrorChanges,
  mirrorName,
  moveJoint,
  sideOf,
  symmetrize,
  symmetryPlane,
  uniqueName
} from './skeleton'

describe('side names', () => {
  it.each([
    ['hand.L', 'hand.R', 'L'],
    ['hand_r', 'hand_l', 'R'],
    ['LeftHand', 'RightHand', 'L'],
    ['arm-L', 'arm-R', 'L'],
    ['handRight', 'handLeft', 'R']
  ])('%s <-> %s', (a, b, side) => {
    expect(mirrorName(a)).toBe(b)
    expect(mirrorName(b)).toBe(a)
    expect(sideOf(a)).toBe(side)
  })

  it('leaves centre names alone', () => {
    expect(mirrorName('spine')).toBeNull()
    expect(mirrorName('BALL')).toBeNull()
  })

  it('makes names unique', () => {
    const bones = [makeBone({ name: 'arm', head: [0, 0, 0], tail: [0, 0, 1] })]
    expect(uniqueName(bones, 'arm')).toBe('arm.001')
    expect(uniqueName(bones, 'leg')).toBe('leg')
  })
})

describe('editing', () => {
  const a = makeBone({ name: 'upper.L', head: [0.2, 0, 1], tail: [0.5, 0, 1] })
  const b = makeBone({
    name: 'lower.L',
    head: [0.5, 0, 1],
    tail: [0.8, 0, 1],
    parent: a.id,
    connected: true
  })
  const bones = symmetrize([a, b], 'L', 0)

  it('drags connected children with a tail', () => {
    const r = moveJoint(bones, a.id, 'tail', [0.5, 0.1, 1])
    expect(r.bones.find((x) => x.id === b.id)!.head).toEqual([0.5, 0.1, 1])
    expect(r.changed.has(b.id)).toBe(true)
  })

  it('moves the parent tail when a connected head is dragged', () => {
    const r = moveJoint(bones, b.id, 'head', [0.6, 0, 1])
    expect(r.bones.find((x) => x.id === a.id)!.tail).toEqual([0.6, 0, 1])
  })

  it('mirrors edits to the other side', () => {
    const r = moveJoint(bones, a.id, 'tail', [0.5, 0.1, 1.2])
    const m = mirrorChanges(r.bones, r.changed, 0)
    const twin = m.find((x) => x.name === 'upper.R')!
    expect(twin.tail).toEqual([-0.5, 0.1, 1.2])
    expect(m.find((x) => x.name === 'lower.R')!.head).toEqual([-0.5, 0.1, 1.2])
  })

  it('symmetrize parents twins to twins', () => {
    const lowerR = bones.find((x) => x.name === 'lower.R')!
    expect(bones.find((x) => x.id === lowerR.parent)!.name).toBe('upper.R')
  })

  it('re-parents children of deleted bones', () => {
    const c = makeBone({
      name: 'hand.L',
      head: [0.8, 0, 1],
      tail: [0.9, 0, 1],
      parent: b.id,
      connected: true
    })
    const out = deleteBones([a, b, c], new Set([b.id]))
    expect(out.find((x) => x.id === c.id)!.parent).toBe(a.id)
    expect(out.find((x) => x.id === c.id)!.connected).toBe(false)
  })
})

describe('symmetry plane', () => {
  const l = makeBone({ name: 'thigh.l', head: [0.3, 0, 1], tail: [0.3, 0, 0.5] })
  const r = makeBone({ name: 'thigh.r', head: [-0.1, 0, 1], tail: [-0.1, 0, 0.5] })

  it('comes from the left/right pairs when there are any', () => {
    expect(symmetryPlane([l, r], -2, 5)).toBeCloseTo(0.1)
  })

  it('stays at x = 0 for a lopsided model that straddles it', () => {
    // A sword out to the right would put the box centre at 0.6.
    expect(symmetryPlane([], -0.4, 1.6)).toBe(0)
  })

  it('uses the middle of a model that sits off to one side', () => {
    expect(symmetryPlane([], 2, 4)).toBe(3)
  })
})
