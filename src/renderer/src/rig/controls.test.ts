import { describe, expect, it } from 'vitest'
import { autoIk, boneZ, buildControls, insertSuffix, poleDirection } from './controls'
import { makeBone } from './skeleton'

describe('IK controls', () => {
  const thigh = makeBone({
    name: 'thigh.L',
    head: [0.1, 0, 0.9],
    tail: [0.1, -0.02, 0.5],
    role: 'thigh'
  })
  const shin = makeBone({
    name: 'shin.L',
    head: [0.1, -0.02, 0.5],
    tail: [0.1, 0, 0.1],
    parent: thigh.id,
    connected: true,
    role: 'shin',
    ik: { chain: 2, pole: 'auto', follow: true }
  })
  const foot = makeBone({
    name: 'foot.L',
    head: [0.1, 0, 0.1],
    tail: [0.1, -0.15, 0.02],
    parent: shin.id,
    connected: true,
    role: 'foot'
  })
  const bones = [thigh, shin, foot]

  it('names controls before the side suffix', () => {
    expect(insertSuffix('foot.L', '_ik')).toBe('foot_ik.L')
    expect(insertSuffix('spine', '_ik')).toBe('spine_ik')
  })

  it('points the pole where the knee bends', () => {
    const p = poleDirection(bones, shin)!
    expect(p[1]).toBeLessThan(-0.99)
  })

  it('rolls the chain toward the pole', () => {
    expect(boneZ(bones, thigh)[1]).toBeLessThan(-0.9)
  })

  it('builds target, pole and copy-rotation', () => {
    const c = buildControls(bones)
    expect(c.ik).toEqual([{ owner: 'shin.L', target: 'foot_ik.L', pole: 'shin_pole.L', chain: 2 }])
    expect(c.copyRotation).toEqual([{ owner: 'foot.L', target: 'foot_ik.L' }])
    const pole = c.bones.find((b) => b.name === 'shin_pole.L')!
    expect(pole.head[1]).toBeLessThan(-0.3)
    expect(pole.deform).toBe(false)
  })

  it('finds legs on its own', () => {
    const plain = bones.map((b) => ({ ...b, role: 'other' as const, ik: null }))
    const r = autoIk(plain, 0, 1)
    expect(r.added).toBe(1)
    expect(r.bones.find((b) => b.name === 'shin.L')!.ik?.chain).toBe(2)
  })
})

describe('pole direction', () => {
  const up = makeBone({
    name: 'upper_arm.L',
    head: [0.2, 0, 1.47],
    tail: [0.46, 0, 1.42],
    role: 'arm'
  })
  const fore = makeBone({
    name: 'forearm.L',
    head: [0.46, 0, 1.42],
    tail: [0.73, 0, 1.42],
    parent: up.id,
    connected: true,
    role: 'forearm',
    ik: { chain: 2, pole: 'auto', follow: true }
  })

  it('ignores a sag that disagrees with how elbows bend', () => {
    // The elbow sits a little below the shoulder-wrist line: still points back.
    expect(poleDirection([up, fore], fore)![1]).toBeGreaterThan(0.9)
  })

  it('follows a real bend that agrees', () => {
    const bentUp = { ...up, tail: [0.46, 0.06, 1.44] as [number, number, number] }
    const bentFore = { ...fore, head: [0.46, 0.06, 1.44] as [number, number, number] }
    const p = poleDirection([bentUp, bentFore], bentFore)!
    expect(p[1]).toBeGreaterThan(0.8)
  })
})
