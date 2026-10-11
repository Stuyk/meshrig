import { For, type JSX } from 'solid-js'
import { HelpCircleIcon } from './icons'
import { Kbd, Modal } from './ui'
import { t } from '../i18n'

const STEPS = ['open', 'skeleton', 'adjust', 'parts', 'skin', 'test', 'save'] as const

const HOTKEYS: { keys: string[]; id: string }[] = [
  { keys: ['Q'], id: 'select' },
  { keys: ['E'], id: 'add' },
  { keys: ['Shift', 'Click'], id: 'addFree' },
  { keys: ['D'], id: 'connect' },
  { keys: ['C'], id: 'chain' },
  { keys: ['B'], id: 'bind' },
  { keys: ['X'], id: 'symmetry' },
  { keys: ['S'], id: 'snap' },
  { keys: ['Ctrl', 'Drag'], id: 'snapFlip' },
  { keys: ['N'], id: 'names' },
  { keys: ['P'], id: 'attached' },
  { keys: ['Del'], id: 'delete' },
  { keys: ['Esc'], id: 'escape' },
  { keys: ['1', '2', '3', '4'], id: 'steps' },
  { keys: ['Num 1/3/7'], id: 'views' },
  { keys: ['Num 5'], id: 'ortho' },
  { keys: ['G'], id: 'grid' },
  { keys: ['A'], id: 'angle' },
  { keys: ['J'], id: 'jointSnap' },
  { keys: ['Shift', 'Drag'], id: 'noSnap' },
  { keys: ['F'], id: 'frame' },
  { keys: ['Shift', 'Click'], id: 'multi' },
  { keys: ['Ctrl', 'J'], id: 'join' },
  { keys: ['Ctrl', 'Z'], id: 'undo' },
  { keys: ['Ctrl', 'S'], id: 'save' },
  { keys: ['Ctrl', 'O'], id: 'open' },
  { keys: ['RMB'], id: 'orbit' },
  { keys: ['Shift', 'RMB'], id: 'pan' },
  { keys: ['Wheel'], id: 'zoom' }
]

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('help.title')}
      icon={HelpCircleIcon}
      size="lg"
    >
      <div class="grid grid-cols-2 gap-6 text-xs">
        <div class="flex flex-col gap-2">
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {t('help.workflow')}
          </div>
          <ol class="list-decimal pl-4 space-y-1.5 text-[var(--text-main)] leading-snug">
            <For each={STEPS}>{(s) => <li>{t(`help.steps.${s}`)}</li>}</For>
          </ol>
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {t('help.hotkeys')}
          </div>
          <div class="flex flex-col gap-1">
            <For each={HOTKEYS}>
              {(h) => (
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[var(--text-muted)]">
                    {t(`help.keys.${h.id}` as 'help.keys.select')}
                  </span>
                  <span class="flex gap-1 shrink-0">
                    <For each={h.keys}>{(k) => <Kbd size="xs">{k}</Kbd>}</For>
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Modal>
  )
}
