import { describe, expect, it } from 'vitest'
import { bonesFromPieces, computeIslands, piecesOf } from './parts'
import { humanoid, robot } from './__fixtures__/shapes'

describe('pieces', () => {
  it('finds the loose parts of one object', () => {
    // Torso, head, neck, hips + 6 parts per side, except that each arm's
    // upper arm, forearm and hand share vertices where they meet, which
    // counts as joined: 4 + 2 * 4.
    expect(computeIslands(humanoid()).count).toBe(12)
  })

  it('rigs a multi-object robot as a chain of parts', () => {
    const pieces = robot().flatMap((p) => piecesOf(p, null))
    const { bones, bindings } = bonesFromPieces(pieces, [], 2)
    const byName = new Map(bones.map((b) => [b.name, b]))
    const parentName = (n: string): string | undefined =>
      bones.find((b) => b.id === byName.get(n)!.parent)?.name
    expect(byName.get('Base')!.parent).toBeNull()
    expect(parentName('Turret')).toBe('Base')
    expect(parentName('Arm1')).toBe('Turret')
    expect(parentName('Arm2')).toBe('Arm1')
    expect(parentName('Claw')).toBe('Arm2')
    expect(bindings['Claw']).toBe(byName.get('Claw')!.id)
    // Arm2's bone starts where it meets Arm1 and runs out along -Y.
    const arm2 = byName.get('Arm2')!
    expect(arm2.head[2]).toBeCloseTo(1.0, 1)
    expect(arm2.tail[1]).toBeLessThan(-0.5)
  })
})
