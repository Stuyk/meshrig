import { createEffect, on, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { RigEngine } from './rigEngine'
import { setEngine } from './engineRef'
import ViewControls from './ViewControls'
import { rig, type ViewMode } from '../rig/store'
import type { LightingMode } from './scene'
import { SegmentedControl } from '../components/ui'
import { BoneIcon, StressIcon, WeightsIcon } from '../components/icons'
import { t } from '../i18n'

export interface RigViewportProps {
  lightingMode: LightingMode
}

export default function RigViewport(props: RigViewportProps): JSX.Element {
  let canvas!: HTMLCanvasElement
  let overlay!: HTMLCanvasElement
  let navCanvas!: HTMLCanvasElement
  let eng: RigEngine | null = null

  onMount(() => {
    eng = new RigEngine(canvas, overlay, navCanvas, rig, () => window.api.reportGpuContextLost())
    setEngine(eng)
  })
  onCleanup(() => {
    setEngine(null)
    eng?.dispose()
  })

  createEffect(
    on(
      () => rig.doc(),
      // Joining (or undoing a join) swaps the meshes of the same file: keep the camera.
      (d, prev) => eng?.setParts(d?.parts ?? [], d?.blendPath !== prev?.blendPath)
    )
  )
  createEffect(() => eng?.setLightingMode(props.lightingMode))
  createEffect(() => {
    if (eng) {
      eng.showNames = rig.showNames()
    }
  })
  createEffect(
    on(
      () => rig.focusRequest(),
      (req) => {
        if (!req) {
          return
        }
        if (req.bone) {
          eng?.frameBone(req.bone)
        } else {
          eng?.frame()
        }
      }
    )
  )

  let navDown: { x: number; y: number; moved: boolean } | null = null
  const onNavDown = (e: PointerEvent): void => {
    e.stopPropagation()
    navDown = { x: e.clientX, y: e.clientY, moved: false }
    const move = (ev: PointerEvent): void => {
      if (!navDown) {
        return
      }
      const dx = ev.clientX - navDown.x
      const dy = ev.clientY - navDown.y
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        navDown.moved = true
      }
      eng?.navCubeOrbit(dx, dy)
      navDown.x = ev.clientX
      navDown.y = ev.clientY
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (navDown && !navDown.moved) {
        eng?.navCubeClick(ev.clientX, ev.clientY)
      }
      navDown = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const setView = (v: ViewMode): void => {
    rig.setPanel(v === 'pose' ? 'test' : v === 'weights' ? 'skin' : 'skeleton')
  }

  return (
    <div class="relative w-full h-full overflow-hidden bg-[var(--bg-main)]">
      <canvas ref={canvas} class="absolute inset-0 w-full h-full block outline-none" />
      <canvas ref={overlay} class="absolute inset-0 w-full h-full pointer-events-none" />
      <canvas
        ref={navCanvas}
        class="absolute top-3 right-3 w-24 h-24 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
        onPointerDown={onNavDown}
        title={t('viewport.navCube')}
      />
      <Show when={rig.doc()}>
        <div class="absolute top-3 left-3 flex items-center gap-2">
          <SegmentedControl<ViewMode>
            size="xs"
            value={rig.view()}
            onChange={setView}
            options={[
              {
                value: 'rig',
                label: t('viewport.modes.rig'),
                icon: BoneIcon,
                title: t('viewport.modes.rigHelp')
              },
              {
                value: 'weights',
                label: t('viewport.modes.weights'),
                icon: WeightsIcon,
                title: t('viewport.modes.weightsHelp')
              },
              {
                value: 'pose',
                label: t('viewport.modes.pose'),
                icon: StressIcon,
                title: t('viewport.modes.poseHelp')
              }
            ]}
          />
          <ViewControls />
          <Show when={rig.view() === 'rig'}>
            <label
              class="flex items-center gap-1.5 h-6 px-2 rounded-[var(--ui-radius)] bg-zinc-900/80 border border-[var(--border-color)] text-[10px] text-[var(--text-muted)]"
              title={t('viewport.xrayHelp')}
            >
              {t('viewport.xray')}
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={rig.meshOpacity()}
                onInput={(e) => rig.setMeshOpacity(Number(e.currentTarget.value))}
                class="w-20 accent-[var(--accent-color)]"
              />
            </label>
          </Show>
        </div>
        <Show when={(rig.view() === 'weights' || rig.view() === 'pose') && !rig.weights()}>
          <div class="absolute top-12 left-3 px-3 py-1.5 rounded-[var(--ui-radius)] bg-zinc-900/90 border border-amber-500/40 text-[11px] text-amber-200">
            {t('viewport.noWeights')}
          </div>
        </Show>
        <Show when={rig.skinning()}>
          {(s) => (
            <div class="absolute bottom-10 left-1/2 -translate-x-1/2 w-72 px-3 py-2 rounded-[var(--ui-radius)] bg-zinc-900/95 border border-[var(--border-color)] text-[11px] shadow-lg">
              <div class="flex justify-between mb-1">
                <span>{t(`skin.stages.${s().stage}` as 'skin.stages.start')}</span>
                <span class="text-[var(--text-muted)]">{Math.round(s().progress * 100)}%</span>
              </div>
              <div class="h-1.5 rounded bg-zinc-800 overflow-hidden">
                <div
                  class="h-full bg-[var(--accent-color)] transition-[width]"
                  style={{ width: `${s().progress * 100}%` }}
                />
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
