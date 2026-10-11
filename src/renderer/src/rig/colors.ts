import * as THREE from 'three'

/** A stable, distinct colour per bone id (golden-angle hues), shared by the viewport and panels. */
export function boneColor(id: string, out = new THREE.Color()): THREE.Color {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return out.setHSL((((h * 0.618033988749895) % 1) + 1) % 1, 0.65, 0.55)
}

/** The same colour as a CSS string. */
export function boneCss(id: string): string {
  return `#${boneColor(id).getHexString()}`
}
