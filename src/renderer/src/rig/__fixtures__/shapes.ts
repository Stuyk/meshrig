import * as THREE from 'three'
import type { MeshPart } from '../types'

/**
 * Test models built from primitives, in Blender space (Z up, facing -Y).
 * Same proportions as the humanoid .blend used to check the Blender scripts.
 */

type Shape = THREE.BufferGeometry

function cyl(
  r: number,
  depth: number,
  at: [number, number, number],
  along: 'x' | 'y' | 'z' = 'z'
): Shape {
  const g = new THREE.CylinderGeometry(r, r, depth, 16, 1)
  // Three's cylinder runs along Y.
  if (along === 'z') {
    g.rotateX(Math.PI / 2)
  }
  if (along === 'x') {
    g.rotateZ(Math.PI / 2)
  }
  g.translate(...at)
  return g
}

function sphere(r: number, at: [number, number, number]): Shape {
  const g = new THREE.SphereGeometry(r, 16, 10)
  g.translate(...at)
  return g
}

function box(size: [number, number, number], at: [number, number, number]): Shape {
  const g = new THREE.BoxGeometry(...size)
  g.translate(...at)
  return g
}

/** Concatenates shapes into one part, keeping each shape a separate loose piece. */
export function partFrom(name: string, shapes: Shape[]): MeshPart {
  const pos: number[] = []
  const tri: number[] = []
  for (const g of shapes) {
    const base = pos.length / 3
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
    }
    const idx = g.getIndex()
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        tri.push(base + idx.getX(i))
      }
    } else {
      for (let i = 0; i < p.count; i++) {
        tri.push(base + i)
      }
    }
  }
  return {
    name,
    positions: new Float32Array(pos),
    triangles: new Uint32Array(tri),
    triMat: new Uint32Array(tri.length / 3),
    uvs: null,
    normals: null,
    materials: [{ name: '', color: [0.8, 0.8, 0.8, 1], texture: null }],
    visibleInBlender: true,
    modifiers: [],
    hasShapeKeys: false
  }
}

/** A 1.8 tall T-posed figure. */
export function humanoid(): MeshPart {
  const shapes: Shape[] = [
    cyl(0.18, 0.6, [0, 0, 1.2]),
    sphere(0.13, [0, 0, 1.65]),
    cyl(0.06, 0.12, [0, 0, 1.5]),
    cyl(0.17, 0.15, [0, 0, 0.9])
  ]
  for (const s of [1, -1]) {
    shapes.push(
      cyl(0.05, 0.3, [s * 0.37, 0, 1.42], 'x'),
      cyl(0.045, 0.3, [s * 0.67, 0, 1.42], 'x'),
      sphere(0.06, [s * 0.88, 0, 1.42]),
      cyl(0.08, 0.42, [s * 0.1, 0, 0.62]),
      cyl(0.065, 0.4, [s * 0.1, 0, 0.22]),
      box([0.1, 0.22, 0.06], [s * 0.1, -0.06, 0.03])
    )
  }
  return partFrom('Body', shapes)
}

/** A dog-ish box animal, 1.2 long, facing -Y. */
export function quadruped(): MeshPart {
  const shapes: Shape[] = [
    box([0.3, 0.8, 0.3], [0, 0, 0.6]),
    box([0.22, 0.25, 0.22], [0, -0.55, 0.85]),
    cyl(0.03, 0.4, [0, 0.6, 0.65], 'y')
  ]
  for (const s of [1, -1]) {
    for (const y of [-0.3, 0.3]) {
      shapes.push(cyl(0.05, 0.45, [s * 0.1, y, 0.225]))
    }
  }
  return partFrom('Dog', shapes)
}

/** A robot arm made of separate objects. */
export function robot(): MeshPart[] {
  return [
    partFrom('Base', [box([0.6, 0.6, 0.2], [0, 0, 0.1])]),
    partFrom('Turret', [cyl(0.2, 0.2, [0, 0, 0.3])]),
    partFrom('Arm1', [box([0.12, 0.12, 0.6], [0, 0, 0.7])]),
    partFrom('Arm2', [box([0.1, 0.6, 0.1], [0, -0.3, 1.05])]),
    partFrom('Claw', [box([0.16, 0.1, 0.16], [0, -0.65, 1.05])])
  ]
}
