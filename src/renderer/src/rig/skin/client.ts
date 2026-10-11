import type { ComputeResult, ComputeSettings, SkinBone, SkinObject } from './compute'
import type { SkinRequest } from './worker'

/** Main-thread side of the skinning worker: one job at a time, newest wins. */

let worker: Worker | null = null
let nextId = 1
let pending: { id: number; reject: (e: Error) => void } | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export function computeInWorker(
  objects: SkinObject[],
  bones: SkinBone[],
  settings: ComputeSettings,
  onProgress: (fraction: number, stage: string) => void
): Promise<ComputeResult> {
  // A newer request replaces an unfinished one: restart the worker.
  if (pending) {
    pending.reject(new Error('cancelled'))
    worker?.terminate()
    worker = null
    pending = null
  }
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending = { id, reject }
    w.onmessage = (e: MessageEvent): void => {
      const msg = e.data
      if (msg.id !== id) {
        return
      }
      if ('progress' in msg) {
        onProgress(msg.progress, msg.stage)
        return
      }
      pending = null
      if ('error' in msg) {
        reject(new Error(msg.error))
      } else {
        resolve(msg.result as ComputeResult)
      }
    }
    w.onerror = (e): void => {
      pending = null
      worker = null
      reject(new Error(e.message || 'skinning worker failed'))
    }
    const req: SkinRequest = { id, objects, bones, settings }
    w.postMessage(req)
  })
}
