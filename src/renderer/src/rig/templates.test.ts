import { describe, expect, it } from 'vitest'
import { MeshProbe } from './probe'
import { DEFAULT_TEMPLATE_OPTIONS, fitTemplate } from './templates'
import { humanoid, quadruped } from './__fixtures__/shapes'
import type { Bone, Vec3 } from './types'

const near = (a: Vec3, b: Vec3, tol: number): void => {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(a[i] - b[i]), `axis ${i}: ${a} vs ${b}`).toBeLessThan(tol)
  }
}

const find = (bones: Bone[], name: string): Bone => {
  const b = bones.find((x) => x.name === name)
  expect(b, name).toBeTruthy()
  return b!
}

describe('humanoid fit', () => {
  const probe = new MeshProbe([humanoid()])
  const bones = fitTemplate('humanoid', { probe, cx: 0 }, DEFAULT_TEMPLATE_OPTIONS)

  it('finds the landmarks of a T-posed figure', () => {
    // Hips just above the crotch (legs end at 0.83).
    expect(find(bones, 'hips').head[2]).toBeGreaterThan(0.78)
    expect(find(bones, 'hips').head[2]).toBeLessThan(0.95)
    // Head runs up to the top of the head sphere (1.78).
    expect(find(bones, 'head').tail[2]).toBeGreaterThan(1.72)
    // Wrist out along the arm, at arm height and inside it.
    near(find(bones, 'hand.L').head, [0.77, 0, 1.42], 0.1)
    // Knee and ankle under the hip, inside the leg.
    near(find(bones, 'shin.L').head, [0.1, 0, 0.45], 0.08)
    near(find(bones, 'shin.L').tail, [0.1, 0, 0.09], 0.06)
  })

  it('mirrors the left side to the right', () => {
    const l = find(bones, 'forearm.L')
    const r = find(bones, 'forearm.R')
    near(r.head, [-l.head[0], l.head[1], l.head[2]], 1e-9)
    expect(bones.find((b) => b.id === r.parent)?.name).toBe('upper_arm.R')
  })

  it('keeps centre bones on the symmetry plane', () => {
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head']) {
      expect(find(bones, n).head[0]).toBe(0)
    }
  })

  it('puts IK on forearms and shins', () => {
    expect(find(bones, 'forearm.R').ik?.chain).toBe(2)
    expect(find(bones, 'shin.L').ik?.follow).toBe(true)
  })

  it('adds fingers on request', () => {
    const full = fitTemplate(
      'humanoid',
      { probe, cx: 0 },
      { ...DEFAULT_TEMPLATE_OPTIONS, fingers: 'full' }
    )
    expect(full.filter((b) => b.role === 'finger')).toHaveLength(30)
  })
})

describe('quadruped fit', () => {
  const probe = new MeshProbe([quadruped()])
  const bones = fitTemplate('quadruped', { probe, cx: 0 }, DEFAULT_TEMPLATE_OPTIONS)

  it('finds four legs and a tail', () => {
    // Front leg at y = -0.3, back at +0.3.
    expect(Math.abs(find(bones, 'forearm.L').head[1] + 0.3)).toBeLessThan(0.08)
    expect(Math.abs(find(bones, 'shin.R').head[1] - 0.3)).toBeLessThan(0.08)
    expect(find(bones, 'shin.R').head[0]).toBeLessThan(-0.05)
    expect(bones.filter((b) => b.role === 'tail').length).toBe(4)
    // Head forward (-Y).
    expect(find(bones, 'head').tail[1]).toBeLessThan(-0.55)
  })
})

describe('chain fit', () => {
  it('runs along the longest axis through the middle', () => {
    const probe = new MeshProbe([quadruped()])
    const bones = fitTemplate('chain', { probe, cx: 0 }, { ...DEFAULT_TEMPLATE_OPTIONS, chain: 5 })
    expect(bones).toHaveLength(5)
    expect(bones[4].tail[1] - bones[0].head[1]).toBeGreaterThan(1)
  })
})

describe('probe', () => {
  it('leaves the part triangles in their own order', () => {
    const part = humanoid()
    const before = part.triangles.slice()
    const probe = new MeshProbe([part])
    expect(part.triangles).toEqual(before)
    const hit = probe.firstHit([0, -2, 1.2], [0, 1, 0])
    // The torso's front: the hit triangle's corners are on the torso.
    const v = part.triangles[hit!.face * 3]
    expect(Math.abs(part.positions[v * 3 + 2] - 1.2)).toBeLessThan(0.35)
  })
})
