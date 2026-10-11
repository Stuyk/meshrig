import { createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { rig } from '../../rig/store'
import { engine } from '../../viewport/engineRef'
import { Button, PanelSection } from '../ui'
import { AutoIcon, ResetIcon, StressIcon } from '../icons'
import { skinNow } from './SkinPanel'
import { t } from '../../i18n'

export default function TestPanel(props: {
  notify: (text: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
}): JSX.Element {
  const [running, setRunning] = createSignal(false)
  const timer = setInterval(() => setRunning(!!engine()?.stressRunning()), 200)
  onCleanup(() => clearInterval(timer))

  return (
    <PanelSection title={t('test.title')} icon={StressIcon}>
      <div class="p-2 flex flex-col gap-2">
        <p class="text-[11px] text-[var(--text-muted)] leading-snug">{t('test.help')}</p>
        <Show
          when={rig.weights()}
          fallback={
            <Button
              variant="primary"
              icon={<AutoIcon size={14} />}
              disabled={!!rig.skinning()}
              onClick={() => void skinNow(props.notify)}
            >
              {t('test.skinFirst')}
            </Button>
          }
        >
          <Show when={rig.weightsStale()}>
            <div class="px-2 py-1.5 rounded-[var(--ui-radius)] border text-[11px] text-amber-200 border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-2">
              <span>{t('test.stale')}</span>
              <Button
                size="xs"
                variant="outline"
                disabled={!!rig.skinning()}
                onClick={() => void skinNow(props.notify)}
              >
                {t('skin.recompute')}
              </Button>
            </div>
          </Show>
          <div class="flex gap-1">
            <Button
              variant="primary"
              class="flex-1"
              icon={<StressIcon size={14} />}
              onClick={() => engine()?.startStressTest()}
            >
              {running() ? t('test.restart') : t('test.stress')}
            </Button>
            <Button
              variant="outline"
              icon={<ResetIcon size={14} />}
              onClick={() => engine()?.resetPose()}
            >
              {t('test.reset')}
            </Button>
          </div>
          <ul class="text-[10px] text-[var(--text-muted)] list-disc pl-4 space-y-0.5">
            <li>{t('test.tipDrag')}</li>
            <li>{t('test.tipIk')}</li>
            <li>{t('test.tipRoot')}</li>
            <li>{t('test.tipFix')}</li>
          </ul>
        </Show>
      </div>
    </PanelSection>
  )
}
