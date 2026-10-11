import { For, Match, Switch, type JSX } from 'solid-js'
import { rig, type Panel } from '../rig/store'
import SkeletonPanel from './panels/SkeletonPanel'
import PartsPanel from './panels/PartsPanel'
import SkinPanel from './panels/SkinPanel'
import TestPanel from './panels/TestPanel'
import { Button, ToggleSwitch } from './ui'
import { SaveIcon } from './icons'
import { t } from '../i18n'

const STEPS: Panel[] = ['skeleton', 'parts', 'skin', 'test']

export interface SidebarProps {
  notify: (text: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
  armatureName: string
  setArmatureName: (name: string) => void
  join: boolean
  setJoin: (on: boolean) => void
  onSave: () => void
  saving: boolean
}

export default function Sidebar(props: SidebarProps): JSX.Element {
  const done = (p: Panel): boolean => {
    if (p === 'skeleton') {
      return rig.bones().some((b) => b.deform)
    }
    if (p === 'parts') {
      return Object.keys(rig.bindings()).length > 0
    }
    if (p === 'skin') {
      return !!rig.weights() && !rig.weightsStale()
    }
    return false
  }
  return (
    <aside class="w-[330px] min-w-[330px] flex flex-col bg-[var(--bg-main)] border-l border-[var(--border-color)]">
      <nav class="grid grid-cols-4 gap-px bg-[var(--border-color)] border-b border-[var(--border-color)] shrink-0">
        <For each={STEPS}>
          {(step, i) => (
            <button
              type="button"
              onClick={() => rig.setPanel(step)}
              title={t(`steps.${step}.help`)}
              class={`flex flex-col items-center justify-center h-12 gap-0.5 cursor-pointer transition-colors ${
                rig.panel() === step
                  ? 'bg-[var(--bg-panel)] text-[var(--text-main)]'
                  : 'bg-[var(--bg-panel-header)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <span
                class={`w-4.5 h-4.5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  done(step)
                    ? 'bg-emerald-500 text-black'
                    : rig.panel() === step
                      ? 'bg-[var(--accent-color)] text-white'
                      : 'bg-zinc-700 text-zinc-300'
                }`}
              >
                {done(step) ? '✓' : i() + 1}
              </span>
              <span class="text-[11px] font-semibold">{t(`steps.${step}.label`)}</span>
            </button>
          )}
        </For>
      </nav>

      <div class="flex-1 min-h-0 overflow-y-auto dcc-scroll">
        <Switch>
          <Match when={rig.panel() === 'skeleton'}>
            <SkeletonPanel notify={props.notify} />
          </Match>
          <Match when={rig.panel() === 'parts'}>
            <PartsPanel notify={props.notify} />
          </Match>
          <Match when={rig.panel() === 'skin'}>
            <SkinPanel notify={props.notify} />
          </Match>
          <Match when={rig.panel() === 'test'}>
            <TestPanel notify={props.notify} />
          </Match>
        </Switch>
      </div>

      <div class="shrink-0 p-2 flex flex-col gap-2 border-t border-[var(--border-color)] bg-[var(--bg-panel-header)]">
        <div class="flex items-center gap-2 text-[11px]">
          <span class="text-[var(--text-muted)] shrink-0">{t('save.armature')}</span>
          <input
            class="flex-1 min-w-0 h-6.5 px-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs focus:outline-none focus:border-[var(--accent-color)]"
            value={props.armatureName}
            onChange={(e) => props.setArmatureName(e.currentTarget.value.trim() || 'Armature')}
          />
        </div>
        <ToggleSwitch
          checked={props.join}
          onChange={props.setJoin}
          label={t('save.join')}
          description={t('save.joinHelp')}
          disabled={rig.includedParts().length < 2}
        />
        <Button
          variant="primary"
          size="md"
          icon={<SaveIcon size={14} />}
          disabled={props.saving || !rig.bones().some((b) => b.deform)}
          onClick={props.onSave}
          shortcut="Ctrl+S"
        >
          {t('save.button')}
        </Button>
      </div>
    </aside>
  )
}
