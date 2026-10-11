import type { RigEngine } from './rigEngine'

/** The one viewport engine, for panels that drive it (stress test, framing). */
let current: RigEngine | null = null

export function setEngine(e: RigEngine | null): void {
  current = e
}

export function engine(): RigEngine | null {
  return current
}
