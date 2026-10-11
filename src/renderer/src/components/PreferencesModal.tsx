import { Show, type JSX } from 'solid-js'
import { SettingsIcon } from './icons'
import { Button, Modal, ToggleSwitch } from './ui'
import { rig } from '../rig/store'
import { t } from '../i18n'

export interface PreferencesModalProps {
  isOpen: boolean
  onClose: () => void
  blender: { path: string | null; version?: string } | null
  onLocateBlender: () => void
  onAutoDetectBlender: () => void
}

export default function PreferencesModal(props: PreferencesModalProps): JSX.Element {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('prefs.title')}
      icon={SettingsIcon}
      size="md"
      footer={
        <Button variant="primary" onClick={props.onClose}>
          {t('common.done')}
        </Button>
      }
    >
      <div class="flex flex-col gap-4 text-xs">
        <section class="flex flex-col gap-2">
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {t('prefs.blender')}
          </div>
          <div class="px-3 py-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] break-all">
            <Show
              when={props.blender?.path}
              fallback={<span class="text-amber-200">{t('start.blenderMissing')}</span>}
            >
              <div class="font-semibold">{props.blender?.version}</div>
              <div class="text-[10px] text-[var(--text-muted)]">{props.blender?.path}</div>
            </Show>
          </div>
          <div class="flex gap-2">
            <Button size="xs" variant="outline" onClick={props.onLocateBlender}>
              {t('prefs.locate')}
            </Button>
            <Button size="xs" variant="ghost" onClick={props.onAutoDetectBlender}>
              {t('prefs.autoDetect')}
            </Button>
          </div>
          <p class="text-[10px] text-[var(--text-muted)]">{t('prefs.blenderHelp')}</p>
        </section>
        <section class="flex flex-col gap-2">
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {t('prefs.display')}
          </div>
          <ToggleSwitch
            checked={rig.showNames()}
            onChange={rig.setShowNames}
            label={t('prefs.names')}
          />
        </section>
      </div>
    </Modal>
  )
}
