import { createSignal, For, Show, type JSX } from 'solid-js'
import { rig } from '../../rig/store'
import type { TemplateId, TemplateOptions } from '../../rig/templates'
import type { Bone } from '../../rig/types'
import { sortedByDepth } from '../../rig/skeleton'
import { boneCss } from '../../rig/colors'
import { Button, PanelSection, SegmentedControl, ToggleSwitch } from '../ui'
import {
  AutoIcon,
  BindIcon,
  BoneIcon,
  EmptyIcon,
  FigureIcon,
  IkIcon,
  MirrorIcon,
  QuadrupedIcon,
  SingleIcon,
  TailIcon,
  TrashIcon
} from '../icons'
import BoneInspector from './BoneInspector'
import { t } from '../../i18n'

const TEMPLATES: { id: TemplateId; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'humanoid', Icon: FigureIcon },
  { id: 'quadruped', Icon: QuadrupedIcon },
  { id: 'chain', Icon: TailIcon },
  { id: 'single', Icon: SingleIcon },
  { id: 'empty', Icon: EmptyIcon }
]

function Stepper(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}): JSX.Element {
  const btn =
    'w-6 h-6 rounded-[var(--ui-radius)] border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer disabled:opacity-30'
  return (
    <div class="flex items-center justify-between gap-2 text-[11px]">
      <span class="text-[var(--text-muted)]">{props.label}</span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class={btn}
          disabled={props.value <= props.min}
          onClick={() => props.onChange(props.value - 1)}
        >
          −
        </button>
        <span class="w-6 text-center font-mono">{props.value}</span>
        <button
          type="button"
          class={btn}
          disabled={props.value >= props.max}
          onClick={() => props.onChange(props.value + 1)}
        >
          +
        </button>
      </div>
    </div>
  )
}

export default function SkeletonPanel(props: {
  notify: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}): JSX.Element {
  const [last, setLast] = createSignal<TemplateId | null>(null)
  const opts = rig.templateOptions
  const setOpt = <K extends keyof TemplateOptions>(k: K, v: TemplateOptions[K]): void => {
    rig.setTemplateOptions({ ...opts(), [k]: v })
  }

  const apply = (id: TemplateId): void => {
    const n = rig.applyTemplate(id)
    setLast(id)
    rig.focus(null)
    props.notify(
      id === 'empty'
        ? t('skeleton.cleared')
        : t('skeleton.fitted', { template: t(`templates.${id}.label`), count: n }),
      'success'
    )
  }

  return (
    <>
      <PanelSection title={t('skeleton.start')} icon={AutoIcon}>
        <div class="p-2 flex flex-col gap-2">
          <p class="text-[11px] text-[var(--text-muted)] leading-snug">{t('skeleton.startHelp')}</p>
          <div class="grid grid-cols-2 gap-1.5">
            <For each={TEMPLATES}>
              {(tpl) => (
                <button
                  type="button"
                  onClick={() => apply(tpl.id)}
                  title={t(`templates.${tpl.id}.help`)}
                  class={`flex items-center gap-2 p-2 rounded-[var(--ui-radius)] border text-left cursor-pointer transition-colors ${
                    last() === tpl.id
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10'
                      : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-white/25'
                  }`}
                >
                  <span class="text-[var(--accent-color)]">
                    <tpl.Icon size={18} />
                  </span>
                  <span class="text-[11px] font-semibold">{t(`templates.${tpl.id}.label`)}</span>
                </button>
              )}
            </For>
          </div>
          <PanelSection title={t('skeleton.options')} defaultOpen={false} class="!m-0">
            <div class="p-2 flex flex-col gap-2">
              <Stepper
                label={t('skeleton.spine')}
                value={opts().spine}
                min={1}
                max={6}
                onChange={(v) => setOpt('spine', v)}
              />
              <Stepper
                label={t('skeleton.neck')}
                value={opts().neck}
                min={1}
                max={4}
                onChange={(v) => setOpt('neck', v)}
              />
              <Stepper
                label={t('skeleton.tail')}
                value={opts().tail}
                min={0}
                max={12}
                onChange={(v) => setOpt('tail', v)}
              />
              <Stepper
                label={t('skeleton.chain')}
                value={opts().chain}
                min={1}
                max={32}
                onChange={(v) => setOpt('chain', v)}
              />
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <span class="text-[var(--text-muted)]">{t('skeleton.fingers')}</span>
                <SegmentedControl
                  size="xs"
                  value={opts().fingers}
                  onChange={(v) => setOpt('fingers', v)}
                  options={[
                    { value: 'none', label: t('skeleton.fingerModes.none') },
                    { value: 'simple', label: t('skeleton.fingerModes.simple') },
                    { value: 'full', label: t('skeleton.fingerModes.full') }
                  ]}
                />
              </div>
              <ToggleSwitch
                checked={opts().root}
                onChange={(v) => setOpt('root', v)}
                label={t('skeleton.root')}
                description={t('skeleton.rootHelp')}
              />
              <ToggleSwitch
                checked={opts().ik}
                onChange={(v) => setOpt('ik', v)}
                label={t('skeleton.ik')}
                description={t('skeleton.ikHelp')}
              />
              <Show when={last()}>
                <Button size="xs" variant="outline" onClick={() => apply(last()!)}>
                  {t('skeleton.refit', { template: t(`templates.${last()!}.label`) })}
                </Button>
              </Show>
            </div>
          </PanelSection>
        </div>
      </PanelSection>

      <PanelSection title={t('skeleton.bones')} icon={BoneIcon} badge={rig.bones().length}>
        <div class="p-2 flex flex-col gap-2">
          <div class="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant="outline"
              icon={<IkIcon size={12} />}
              title={t('skeleton.autoIkHelp')}
              disabled={!rig.bones().length}
              onClick={() => {
                const n = rig.runAutoIk()
                props.notify(
                  n ? t('skeleton.autoIkDone', { count: n }) : t('skeleton.autoIkNone'),
                  n ? 'success' : 'info'
                )
              }}
            >
              {t('skeleton.autoIk')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              icon={<MirrorIcon size={12} />}
              title={t('skeleton.symmetrizeHelp')}
              disabled={!rig.bones().length}
              onClick={() => rig.symmetrizeFrom('L')}
            >
              {t('skeleton.symmetrize')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={<TrashIcon size={12} />}
              disabled={!rig.bones().length}
              onClick={() => rig.clearSkeleton()}
            >
              {t('skeleton.clear')}
            </Button>
          </div>
          <Show
            when={rig.bones().length > 0}
            fallback={<p class="text-[11px] text-[var(--text-muted)]">{t('skeleton.empty')}</p>}
          >
            <BoneTree />
          </Show>
        </div>
      </PanelSection>

      <Show when={rig.selectedBone() ? rig.boneMap().get(rig.selectedBone()!) : undefined}>
        {(b) => <BoneInspector bone={b()} />}
      </Show>
    </>
  )
}

/** The hierarchy, indented, in parent-first order. */
function BoneTree(): JSX.Element {
  const rows = (): { bone: Bone; depth: number }[] => {
    const map = rig.boneMap()
    const depthOf = (b: Bone): number => {
      let d = 0
      let p = b.parent ? map.get(b.parent) : undefined
      while (p && d < 64) {
        d++
        p = p.parent ? map.get(p.parent) : undefined
      }
      return d
    }
    // Depth-first so children sit under their parent.
    const sorted = sortedByDepth(rig.bones())
    const out: { bone: Bone; depth: number }[] = []
    const visit = (parent: string | null): void => {
      for (const b of sorted.filter((x) => x.parent === parent)) {
        out.push({ bone: b, depth: depthOf(b) })
        visit(b.id)
      }
    }
    visit(null)
    return out
  }
  return (
    <div class="max-h-72 overflow-y-auto dcc-scroll rounded-[var(--ui-radius)] border border-[var(--border-color)] bg-[var(--bg-input)] py-1">
      <For each={rows()}>
        {(row) => (
          <button
            type="button"
            onClick={() => rig.setSelectedBone(row.bone.id)}
            onDblClick={() => rig.focus(row.bone.id)}
            class={`flex items-center gap-1.5 w-full h-6 pr-2 text-left text-[11px] cursor-pointer ${
              rig.selectedBone() === row.bone.id
                ? 'bg-[var(--accent-color)]/25 text-white'
                : 'hover:bg-white/5 text-[var(--text-main)]'
            }`}
            style={{ 'padding-left': `${8 + row.depth * 10}px` }}
          >
            <span
              class="flex shrink-0"
              title={row.bone.deform ? t('skeleton.deforms') : t('skeleton.noDeform')}
            >
              <BoneIcon
                size={11}
                class={row.bone.deform ? 'text-[var(--text-muted)]' : 'text-amber-400/70'}
              />
            </span>
            <span class="truncate">{row.bone.name}</span>
            <span class="ml-auto flex items-center gap-1.5 shrink-0">
              <Show when={rig.attachedTo(row.bone.id).length > 0}>
                <span
                  class="flex items-center gap-0.5 text-[9px] font-bold"
                  style={{ color: boneCss(row.bone.id) }}
                  title={t('skeleton.attachedCount', { count: rig.attachedTo(row.bone.id).length })}
                >
                  <BindIcon size={10} />
                  {rig.attachedTo(row.bone.id).length}
                </span>
              </Show>
              <Show when={row.bone.ik}>
                <span class="text-[9px] font-bold text-amber-400">IK</span>
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  )
}
