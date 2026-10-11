import { createSignal, For, Show, type JSX } from 'solid-js'
import { rig } from '../rig/store'
import { engine } from './engineRef'
import { BindIcon, MagnetIcon, ChevronDownIcon, CameraIcon } from '../components/icons'
import { Kbd } from '../components/ui'
import { t } from '../i18n'

const ANGLES = [5, 10, 15, 22.5, 30, 45, 90]
const GRID_SIZES = [0, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]

/** Lengths as people read them: mm and cm under a metre. */
export function formatLength(m: number): string {
  if (m < 0.01) {
    return `${+(m * 1000).toFixed(2)} mm`
  }
  if (m < 1) {
    return `${+(m * 100).toFixed(2)} cm`
  }
  return `${+m.toFixed(2)} m`
}

const chip =
  'flex items-center gap-1.5 h-6 px-2 rounded-[var(--ui-radius)] border text-[10px] font-semibold cursor-pointer select-none transition-colors'
const on = 'bg-[var(--accent-color)]/15 border-[var(--accent-color)]/60 text-[var(--text-main)]'
const off =
  'bg-zinc-900/80 border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'

function Check(props: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  keyHint?: string
  children?: JSX.Element
}): JSX.Element {
  return (
    <div class="flex flex-col gap-1">
      <label class="flex items-center justify-between gap-3 cursor-pointer">
        <span class="flex items-center gap-2">
          <input
            type="checkbox"
            class="accent-[var(--accent-color)]"
            checked={props.checked}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
          {props.label}
        </span>
        <Show when={props.keyHint}>
          <Kbd size="xs">{props.keyHint}</Kbd>
        </Show>
      </label>
      <Show when={props.checked && props.children}>
        <div class="pl-6">{props.children}</div>
      </Show>
    </div>
  )
}

/** Perspective/flat switch and the snapping menu, top of the viewport. */
export default function ViewControls(): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const snap = rig.snap
  const anyOn = (): boolean => rig.snapInside() || snap().joints || snap().grid || snap().angle
  const select =
    'h-6 px-1.5 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px]'
  return (
    <>
      <button
        type="button"
        class={`${chip} ${rig.ortho() ? on : off}`}
        title={t('viewport.orthoHelp')}
        onClick={() => engine()?.toggleOrtho()}
      >
        <CameraIcon size={12} />
        {rig.ortho() ? t('viewport.ortho') : t('viewport.persp')}
      </button>
      <button
        type="button"
        class={`${chip} ${rig.showAttached() ? on : off}`}
        title={t('viewport.attachedHelp')}
        onClick={() => rig.setShowAttached(!rig.showAttached())}
      >
        <BindIcon size={12} />
        {t('viewport.attached')}
      </button>
      <div class="relative">
        <button
          type="button"
          class={`${chip} ${anyOn() ? on : off}`}
          title={t('snapping.title')}
          onClick={() => setOpen(!open())}
        >
          <MagnetIcon size={12} class={anyOn() ? 'text-[var(--accent-color)]' : ''} />
          {t('snapping.label')}
          <ChevronDownIcon size={11} />
        </button>
        <Show when={open()}>
          <div class="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div class="absolute left-0 top-full mt-1.5 z-50 w-72 p-3 flex flex-col gap-2.5 bg-zinc-900/98 border border-zinc-750/90 rounded-lg shadow-2xl text-[11px]">
            <Check
              checked={rig.snapInside()}
              onChange={rig.setSnapInside}
              label={t('snapping.inside')}
              keyHint="S"
            />
            <Check
              checked={snap().joints}
              onChange={(v) => rig.setSnap({ joints: v })}
              label={t('snapping.joints')}
              keyHint="J"
            />
            <Check
              checked={snap().grid}
              onChange={(v) => rig.setSnap({ grid: v })}
              label={t('snapping.grid')}
              keyHint="G"
            >
              <select
                class={select}
                value={snap().gridSize}
                onChange={(e) => rig.setSnap({ gridSize: Number(e.currentTarget.value) })}
              >
                <For each={GRID_SIZES}>
                  {(g) => (
                    <option value={g}>
                      {g === 0
                        ? t('snapping.auto', { size: formatLength(rig.gridStep()) })
                        : formatLength(g)}
                    </option>
                  )}
                </For>
              </select>
            </Check>
            <Check
              checked={snap().angle}
              onChange={(v) => rig.setSnap({ angle: v })}
              label={t('snapping.angle')}
              keyHint="A"
            >
              <select
                class={select}
                value={snap().angleStep}
                onChange={(e) => rig.setSnap({ angleStep: Number(e.currentTarget.value) })}
              >
                <For each={ANGLES}>{(a) => <option value={a}>{a}°</option>}</For>
              </select>
            </Check>
            <div class="h-px bg-zinc-800" />
            <Check
              checked={rig.autoOrtho()}
              onChange={rig.setAutoOrtho}
              label={t('snapping.autoOrtho')}
            />
            <p class="text-[10px] text-[var(--text-muted)] leading-snug">{t('snapping.help')}</p>
          </div>
        </Show>
      </div>
    </>
  )
}
