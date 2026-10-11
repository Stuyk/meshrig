import { describe, expect, it } from 'vitest'
import { computeWeights, type ComputeSettings, type SkinObject } from './compute'
import { MeshProbe } from '../probe'
import { DEFAULT_TEMPLATE_OPTIONS, fitTemplate } from '../templates'
import { computeIslands } from '../parts'
import * as THREE from 'three'
import { humanoid, partFrom } from '../__fixtures__/shapes'
import type { MeshPart } from '../types'

function skinObject(part: MeshPart): SkinObject {
  return {
    positions: part.positions,
    triangles: part.triangles,
    islands: computeIslands(part).of,
    bound: null,
    prior: null
  }
}

/** Index of the strongest bone of the vertex nearest `p`. */
function topBoneNear(
  part: MeshPart,
  res: { index: Uint16Array; weight: Float32Array },
  p: number[]
): number {
  let best = 0
  let bestD = Infinity
  const P = part.positions
  for (let v = 0; v < P.length / 3; v++) {
    const d = Math.hypot(P[v * 3] - p[0], P[v * 3 + 1] - p[1], P[v * 3 + 2] - p[2])
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return res.index[best * 4]
}

describe('automatic weights', () => {
  const part = humanoid()
  const probe = new MeshProbe([part])
  const bones = fitTemplate('humanoid', { probe, cx: 0 }, DEFAULT_TEMPLATE_OPTIONS).filter(
    (b) => b.deform
  )
  const names = bones.map((b) => b.name)
  const settings: ComputeSettings = {
    method: 'auto',
    resolution: 64,
    falloff: 4,
    smoothing: 3,
    maxInfluences: 4,
    rigidSmall: 0.05
  }

  it('gives every vertex weights that sum to one', () => {
    const t0 = performance.now()
    const res = computeWeights([skinObject(part)], bones, settings)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(10000)
    expect(res.unweighted).toBe(0)
    const w = res.objects[0].weight
    for (let v = 0; v < w.length / 4; v++) {
      const s = w[v * 4] + w[v * 4 + 1] + w[v * 4 + 2] + w[v * 4 + 3]
      expect(Math.abs(s - 1)).toBeLessThan(1e-4)
    }
  })

  it('weights each limb to its own bone, not the body beside it', () => {
    const res = computeWeights([skinObject(part)], bones, settings).objects[0]
    expect(names[topBoneNear(part, res, [0.94, 0, 1.42])]).toBe('hand.L')
    expect(names[topBoneNear(part, res, [-0.6, 0, 1.47])]).toBe('forearm.R')
    expect(names[topBoneNear(part, res, [0.18, 0, 0.8])]).toBe('thigh.L')
    expect(names[topBoneNear(part, res, [0.1, -0.06, 0.24])]).toBe('shin.L')
    expect(names[topBoneNear(part, res, [0, 0, 1.78])]).toBe('head')
  })

  it('binds whole pieces rigidly in rigid mode', () => {
    const res = computeWeights([skinObject(part)], bones, { ...settings, method: 'rigid' })
      .objects[0]
    const w = res.weight
    for (let v = 0; v < w.length / 4; v++) {
      expect(w[v * 4]).toBe(1)
    }
  })

  it('moves small loose pieces with one bone', () => {
    const eye = partFrom('Eye', [
      new THREE.SphereGeometry(0.025, 8, 6).translate(0.045, -0.11, 1.68)
    ])
    const res = computeWeights([skinObject(part), skinObject(eye)], bones, settings).objects[1]
    for (let v = 0; v < res.weight.length / 4; v++) {
      expect(res.weight[v * 4]).toBe(1)
      expect(names[res.index[v * 4]]).toBe('head')
    }
  })

  it('pins bound vertices', () => {
    const obj = skinObject(part)
    obj.bound = new Int32Array(part.positions.length / 3).fill(names.indexOf('chest'))
    const res = computeWeights([obj], bones, settings).objects[0]
    expect(names[res.index[0]]).toBe('chest')
    expect(res.weight[0]).toBe(1)
  })
})
