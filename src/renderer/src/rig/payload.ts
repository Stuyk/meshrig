import type { Bone, MeshPart, RigSpec, SkinResult, SkinSettings } from './types'
import { buildControls, type OutBone } from './controls'
import type { SavedSpec } from './doc'
import type { TemplateOptions } from './templates'

/** What the Blender scripts are sent (see meshrig_save.py / meshrig_heat.py). */

const NONE = 65535

function base64(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(out)
}

export interface SaveOptions {
  armatureName: string
  /** Join every rigged object into the named one after binding. */
  join: string | null
}

/**
 * The save payload. Weights are re-indexed from the skin result's bone list
 * to bone names, so bones added after skinning (controls) don't shift them.
 */
export function buildSavePayload(
  parts: MeshPart[],
  spec: RigSpec,
  weights: SkinResult,
  existingArmature: string | null,
  options: SaveOptions,
  skin: SkinSettings,
  template: Partial<TemplateOptions>
): object {
  const controls = buildControls(spec.bones)
  const nameOf = new Map(spec.bones.map((b) => [b.id, b.name]))
  const deform = new Set(spec.bones.filter((b) => b.deform).map((b) => b.id))
  const names = weights.boneIds.map((id) => (deform.has(id) ? (nameOf.get(id) ?? '') : ''))
  const objects = parts
    .filter((p) => !spec.excluded.includes(p.name) && weights.objects.has(p.name))
    .map((p) => {
      const w = weights.objects.get(p.name)!
      const index = w.index.slice()
      const weight = w.weight.slice()
      for (let i = 0; i < index.length; i++) {
        if (index[i] !== NONE && !names[index[i]]) {
          index[i] = NONE
          weight[i] = 0
        }
      }
      return {
        name: p.name,
        bones: names,
        index: base64(new Uint8Array(index.buffer)),
        weight: base64(new Uint8Array(weight.buffer))
      }
    })
  const saved: SavedSpec = {
    version: 1,
    bones: spec.bones,
    bindings: spec.bindings,
    excluded: spec.excluded,
    skin,
    template
  }
  return {
    armature: { name: options.armatureName, existing: existingArmature },
    bones: controls.bones,
    ik: controls.ik,
    copyRotation: controls.copyRotation,
    objects,
    replaceGroups: controls.bones.map((b) => b.name),
    join: options.join,
    spec: JSON.stringify(saved)
  }
}

/** Deform bones and objects for Blender's bone heat. */
export function buildHeatPayload(
  bones: Bone[],
  parts: MeshPart[]
): { bones: OutBone[]; objects: string[] } {
  const all = buildControls(bones).bones
  const deform = new Set(bones.filter((b) => b.deform).map((b) => b.name))
  return {
    bones: all
      .filter((b) => deform.has(b.name))
      .map((b) => ({ ...b, parent: b.parent && deform.has(b.parent) ? b.parent : null })),
    objects: parts.map((p) => p.name)
  }
}
