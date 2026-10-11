import { For, Show, type JSX } from 'solid-js'
import { rig, type PaintSettings } from '../../rig/store'
import type { PaintMode } from '../../rig/skin/paint'
import type { SkinMethod, SkinSettings } from '../../rig/types'
import { Button, PanelSection, SegmentedControl, Slider, ToggleSwitch } from '../ui'
import { AutoIcon, BrushIcon, RefreshCwIcon, WeightsIcon } from '../icons'
import { t } from '../../i18n'

const METHODS: SkinMethod[] = ['auto', 'heat', 'rigid', 'nearest']
const QUALITY: { value: number; key: 'fast' | 'good' | 'best' }[] = [
  { value: 48, key: 'fast' },
  { value: 80, key: 'good' },
  { value: 128, key: 'best' }
]

export function skinNow(
  notify: (text: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
): Promise<boolean> {
  return rig.computeSkin().then((r) => {
    if (r.ok) {
      const w = rig.weights()
      notify(
        [
          t('skin.done', { method: t(`skin.methods.${rig.skin().method}.label`) }),
          r.heatFailed ? t('skin.heatFailed') : '',
          w && w.unweighted ? t('skin.unweighted', { count: w.unweighted }) : ''
        ]
          .filter(Boolean)
          .join(' '),
        r.heatFailed || (w && w.unweighted) ? 'warning' : 'success',
        r.heatFailed ? 8000 : 3600
      )
      return true
    }
    if (r.error !== 'cancelled') {
      notify(
        r.error === 'noBones' ? t('skin.noBones') : t('skin.failed', { error: r.error ?? '' }),
        'error',
        8000
      )
    }
    return false
  })
}

export default function SkinPanel(props: {
  notify: (text: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
}): JSX.Element {
  const s = rig.skin
  const set = (patch: Partial<SkinSettings>): void => {
    rig.setSkin({ ...s(), ...patch })
  }
  const status = (): { text: string; tone: string } => {
    const w = rig.weights()
    if (!w) {
      return {
        text: t('skin.statusNone'),
        tone: 'text-amber-200 border-amber-500/40 bg-amber-500/10'
      }
    }
    if (rig.weightsStale()) {
      return {
        text: t('skin.statusStale'),
        tone: 'text-amber-200 border-amber-500/40 bg-amber-500/10'
      }
    }
    return {
      text:
        w.source === 'file'
          ? t('skin.statusFile')
          : t('skin.statusFresh', { method: t(`skin.methods.${w.source}.label`) }),
      tone: 'text-emerald-200 border-emerald-500/30 bg-emerald-500/5'
    }
  }

  return (
    <>
      <PanelSection title={t('skin.title')} icon={WeightsIcon}>
        <div class="p-2 flex flex-col gap-2">
          <div class="flex flex-col gap-1">
            <For each={METHODS}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => set({ method: m })}
                  class={`flex flex-col items-start p-2 rounded-[var(--ui-radius)] border text-left cursor-pointer ${
                    s().method === m
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10'
                      : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-white/25'
                  }`}
                >
                  <span class="text-[11px] font-semibold">{t(`skin.methods.${m}.label`)}</span>
                  <span class="text-[10px] text-[var(--text-muted)] leading-snug">
                    {t(`skin.methods.${m}.help`)}
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show when={s().method === 'auto' || s().method === 'rigid'}>
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="text-[var(--text-muted)]">{t('skin.quality')}</span>
              <SegmentedControl
                size="xs"
                value={
                  QUALITY.reduce((best, q) =>
                    Math.abs(q.value - s().resolution) < Math.abs(best.value - s().resolution)
                      ? q
                      : best
                  ).value
                }
                onChange={(v) => set({ resolution: v })}
                options={QUALITY.map((q) => ({
                  value: q.value,
                  label: t(`skin.qualities.${q.key}`)
                }))}
              />
            </div>
          </Show>
          <PanelSection title={t('skin.advanced')} defaultOpen={false} class="!m-0">
            <div class="p-2 flex flex-col gap-3">
              <Show when={s().method !== 'heat'}>
                <Slider
                  label={t('skin.falloff')}
                  title={t('skin.falloffHelp')}
                  value={s().falloff}
                  min={1}
                  max={10}
                  step={0.5}
                  onChange={(v) => set({ falloff: v })}
                />
              </Show>
              <ToggleSwitch
                checked={s().rigidSmall}
                onChange={(v) => set({ rigidSmall: v })}
                label={t('skin.rigidSmall')}
                description={t('skin.rigidSmallHelp')}
              />
              <Slider
                label={t('skin.smoothing')}
                title={t('skin.smoothingHelp')}
                value={s().smoothing}
                min={0}
                max={20}
                step={1}
                onChange={(v) => set({ smoothing: v })}
              />
              <Slider
                label={t('skin.influences')}
                title={t('skin.influencesHelp')}
                value={s().maxInfluences}
                min={1}
                max={4}
                step={1}
                onChange={(v) => set({ maxInfluences: v })}
              />
              <Show when={s().method === 'auto' || s().method === 'rigid'}>
                <Slider
                  label={t('skin.resolution')}
                  title={t('skin.resolutionHelp')}
                  value={s().resolution}
                  min={24}
                  max={192}
                  step={8}
                  onChange={(v) => set({ resolution: v })}
                />
              </Show>
            </div>
          </PanelSection>
          <div class={`px-2 py-1.5 rounded-[var(--ui-radius)] border text-[11px] ${status().tone}`}>
            {status().text}
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={!!rig.skinning() || !rig.bones().some((b) => b.deform)}
            icon={
              rig.skinning() ? (
                <RefreshCwIcon size={14} class="animate-spin" />
              ) : (
                <AutoIcon size={14} />
              )
            }
            onClick={() => void skinNow(props.notify)}
          >
            {rig.weights() ? t('skin.recompute') : t('skin.compute')}
          </Button>
          <p class="text-[10px] text-[var(--text-muted)] leading-snug">{t('skin.viewHelp')}</p>
        </div>
      </PanelSection>
      <Show when={rig.weights()}>
        <PaintSection />
      </Show>
    </>
  )
}

/** The weight brush: fix what the automatic weights got wrong by hand. */
function PaintSection(): JSX.Element {
  const p = rig.paint
  const set = (patch: Partial<PaintSettings>): void => {
    rig.setPaint({ ...p(), ...patch })
  }
  const blocked = (): string | null =>
    rig.weightsStale() ? t('paint.stale') : !rig.selectedBone() ? t('paint.pickBone') : null
  return (
    <PanelSection title={t('paint.title')} icon={BrushIcon}>
      <div class="p-2 flex flex-col gap-2">
        <ToggleSwitch
          checked={p().on}
          onChange={(on) => set({ on })}
          label={t('paint.on')}
          description={t('paint.onHelp')}
          icon={BrushIcon}
        />
        <Show when={p().on}>
          <SegmentedControl<PaintMode>
            size="xs"
            value={p().mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'add', label: t('paint.modes.add') },
              { value: 'subtract', label: t('paint.modes.subtract') },
              { value: 'smooth', label: t('paint.modes.smooth') }
            ]}
          />
          <Slider
            label={t('paint.radius')}
            value={Math.round(p().radius * 1000) / 10}
            min={0.5}
            max={20}
            step={0.5}
            unit="%"
            onChange={(v) => set({ radius: v / 100 })}
          />
          <Slider
            label={t('paint.strength')}
            value={Math.round(p().strength * 100)}
            min={5}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => set({ strength: v / 100 })}
          />
          <Show when={blocked()}>
            <p class="text-[11px] px-2 py-1.5 rounded-[var(--ui-radius)] bg-amber-500/10 border border-amber-500/30 text-amber-200">
              {blocked()}
            </p>
          </Show>
          <p class="text-[10px] text-[var(--text-muted)] leading-snug">{t('paint.help')}</p>
        </Show>
      </div>
    </PanelSection>
  )
}
