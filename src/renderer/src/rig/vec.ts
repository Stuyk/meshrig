import type { Vec3 } from './types'

/** Small helpers for plain [x, y, z] tuples, which stay JSON- and undo-friendly. */

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b))
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

export function normalize(a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const l = length(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback
}

/** Mirror across the plane x = cx. */
export const mirrorX = (a: Vec3, cx = 0): Vec3 => [2 * cx - a[0], a[1], a[2]]

/** The part of `v` perpendicular to unit vector `axis`. */
export const reject = (v: Vec3, axis: Vec3): Vec3 => sub(v, scale(axis, dot(v, axis)))

/** Closest point to `p` on segment a-b, as a parameter 0..1. */
export function segmentParam(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a)
  const ll = dot(ab, ab)
  if (ll < 1e-20) {
    return 0
  }
  return Math.min(1, Math.max(0, dot(sub(p, a), ab) / ll))
}

export function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  return dist(p, lerp(a, b, segmentParam(p, a, b)))
}

/** Rotates `v` about unit `axis` by `angle` radians (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = cross(axis, v)
  const d = dot(axis, v) * (1 - c)
  return [
    v[0] * c + k[0] * s + axis[0] * d,
    v[1] * c + k[1] * s + axis[1] * d,
    v[2] * c + k[2] * s + axis[2] * d
  ]
}

export const round = (a: Vec3, digits = 6): Vec3 => {
  const f = 10 ** digits
  return [Math.round(a[0] * f) / f, Math.round(a[1] * f) / f, Math.round(a[2] * f) / f]
}
