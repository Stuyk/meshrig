import type { Vec3 } from '../rig/types'

/**
 * Snapping for placing joints. All in Blender space. The view supplies its
 * own right/up/normal directions, so the same rules work in any view; in
 * front, side and top views they line up with the world axes.
 */

/** The world axis most aligned with `n` (the one a view looks along). */
export function dominantAxis(n: Vec3): 0 | 1 | 2 {
  const a = n.map(Math.abs)
  return a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2
}

/** Rounds `p` to the grid on every axis but `skip` (the depth, which the view can't show). */
export function snapToGrid(p: Vec3, step: number, skip: 0 | 1 | 2 | null): Vec3 {
  if (step <= 0) {
    return p
  }
  return p.map((v, i) => (i === skip ? v : Math.round(v / step) * step)) as Vec3
}

/**
 * Turns `p` about `pivot` so the bone between them points at a whole number
 * of `stepDeg` steps in the view plane (right/up), keeping its depth along
 * `normal`. With `lengthStep`, the length in the plane snaps too.
 */
export function snapAngle(
  p: Vec3,
  pivot: Vec3,
  right: Vec3,
  up: Vec3,
  normal: Vec3,
  stepDeg: number,
  lengthStep = 0
): { point: Vec3; degrees: number } {
  const d: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const u = dot(d, right)
  const v = dot(d, up)
  const w = dot(d, normal)
  let len = Math.hypot(u, v)
  if (len < 1e-9) {
    return { point: p, degrees: 0 }
  }
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(v, u) / step) * step
  if (lengthStep > 0) {
    len = Math.max(lengthStep, Math.round(len / lengthStep) * lengthStep)
  }
  const cu = Math.cos(angle) * len
  const cv = Math.sin(angle) * len
  const point: Vec3 = [0, 1, 2].map(
    (i) => pivot[i] + right[i] * cu + up[i] * cv + normal[i] * w
  ) as Vec3
  const degrees = Math.round((((angle * 180) / Math.PI) % 360) + 360) % 360
  return { point, degrees }
}

/** Whether a view direction is straight along a world axis (a front, side or top view). */
export function isAxisView(n: Vec3, tolerance = 1e-3): boolean {
  return Math.max(...n.map(Math.abs)) > 1 - tolerance
}
