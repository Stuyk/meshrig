import { computeWeights, type ComputeSettings, type SkinBone, type SkinObject } from './compute'

/** Runs computeWeights off the main thread, reporting progress as it goes. */

export interface SkinRequest {
  id: number
  objects: SkinObject[]
  bones: SkinBone[]
  settings: ComputeSettings
}

self.onmessage = (e: MessageEvent<SkinRequest>): void => {
  const { id, objects, bones, settings } = e.data
  try {
    const result = computeWeights(objects, bones, settings, (fraction, stage) =>
      self.postMessage({ id, progress: fraction, stage })
    )
    const transfer = result.objects.flatMap((o) => [o.index.buffer, o.weight.buffer])
    self.postMessage({ id, result }, { transfer })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
