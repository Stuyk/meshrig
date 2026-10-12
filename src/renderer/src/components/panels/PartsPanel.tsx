import { createSignal, For, Show, type JSX } from 'solid-js'
import { rig } from '../../rig/store'
import { islandKey, objectKey } from '../../rig/parts'
import { boneCss } from '../../rig/colors'
import type { MeshPart, PartKey } from '../../rig/types'
import { Button, PanelSection, Select, ToggleSwitch } from '../ui'
import {
  EyeIcon,
  EyeOffIcon,
  JoinIcon,
  PartsIcon,
  PiecesIcon,
  RefreshCwIcon,
  SplitIcon
} from '../icons'
import { t } from '../../i18n'

/** Pieces listed per split object; more than this and the viewport is the better picker. */
const MAX_LISTED = 150

type Notify = (text: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void

/** Weld touching vertices when joining. Off by default: it also merges split seams. */
const [weld, setWeld] = createSignal(false)

/** Joins the selected pieces' objects (Ctrl+J, the Join button). */
export async function joinNow(notify: Notify): Promise<void> {
  const names = rig.selectedObjects()
  if (rig.joining()) {
    return
  }
  if (names.length < 2 && !weld()) {
    notify(t('parts.pickTwo'), 'info')
    return
  }
  const r = await rig.joinSelected(weld())
  if (r.ok) {
    notify(
      [
        t('parts.joined', { count: r.count ?? names.length, target: r.target ?? '' }),
        r.welded ? t('parts.welded', { count: r.welded }) : ''
      ]
        .filter(Boolean)
        .join(' '),
      'success',
      5000
    )
  } else if (r.error !== 'pickTwo') {
    notify(t('parts.joinFailed', { error: r.error ?? '' }), 'error', 8000)
  }
}

/** Shift, Ctrl or Cmd adds to the selection instead of replacing it. */
const adds = (e: MouseEvent): boolean => e.shiftKey || e.ctrlKey || e.metaKey

/** The selection and what can be done with it: join, weld, clear. */
function JoinBar(props: { notify: Notify }): JSX.Element {
  const objects = (): string[] => rig.selectedObjects()
  const canRun = (): boolean => objects().length >= 2 || (objects().length === 1 && weld())
  return (
    <div class="mx-2 mb-1 p-2 flex flex-col gap-2 rounded-[var(--ui-radius)] border border-[var(--accent-color)]/40 bg-[var(--accent-color)]/5">
      <div class="flex items-center justify-between gap-2 text-[11px]">
        <span>{t('parts.selected', { count: rig.selectedParts().length })}</span>
        <button
          type="button"
          class="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
          onClick={() => rig.setSelectedParts([])}
        >
          {t('parts.clearSelection')}
        </button>
      </div>
      <ToggleSwitch
        checked={weld()}
        onChange={setWeld}
        label={t('parts.weld')}
        description={t('parts.weldHelp')}
      />
      <Button
        variant="primary"
        disabled={!canRun() || rig.joining()}
        icon={
          rig.joining() ? <RefreshCwIcon size={13} class="animate-spin" /> : <JoinIcon size={13} />
        }
        shortcut="Ctrl+J"
        onClick={() => void joinNow(props.notify)}
      >
        {objects().length >= 2
          ? t('parts.join', { count: objects().length })
          : objects().length === 1
            ? t('parts.weldOnly', { object: objects()[0] })
            : t('parts.pickTwo')}
      </Button>
      <p class="text-[10px] text-[var(--text-muted)] leading-snug">{t('parts.joinHelp')}</p>
    </div>
  )
}

/** A dot in the colour of the bone a piece is attached to (empty when it's skinned). */
function BoundDot(props: { partKey: PartKey }): JSX.Element {
  const bone = (): string | undefined => rig.bindings()[props.partKey]
  return (
    <span
      class="w-2 h-2 rounded-full shrink-0 border border-white/20"
      style={{ background: bone() ? boneCss(bone()!) : 'transparent' }}
      title={bone() ? rig.boneMap().get(bone()!)?.name : t('parts.auto')}
    />
  )
}

/** ✕ that releases an attached piece (back to skinned); keeps its space when there's nothing to release. */
function DetachButton(props: { partKey: PartKey }): JSX.Element {
  const bound = (): boolean => !!rig.bindings()[props.partKey]
  return (
    <button
      type="button"
      class={`w-4 shrink-0 text-center cursor-pointer ${
        bound() ? 'text-[var(--text-muted)] hover:text-red-300' : 'invisible'
      }`}
      title={t('inspector.detach')}
      disabled={!bound()}
      onClick={() => rig.bindPart(props.partKey, null)}
    >
      ✕
    </button>
  )
}

function BindSelect(props: { partKey: PartKey; disabled?: boolean }): JSX.Element {
  const options = (): { value: string; label: string }[] => [
    { value: '', label: t('parts.auto') },
    // Every bone: picking one that doesn't deform (a helper) switches it to deforming.
    ...rig.bones().map((b) => ({
      value: b.id,
      label: b.deform ? b.name : t('parts.helperBone', { bone: b.name })
    }))
  ]
  return (
    <Select
      size="xs"
      class="w-28 shrink-0"
      disabled={props.disabled}
      value={rig.bindings()[props.partKey] ?? ''}
      onChange={(v) => rig.bindPart(props.partKey, (v as string) || null)}
      options={options()}
    />
  )
}

export default function PartsPanel(props: { notify: Notify }): JSX.Element {
  const pieceCount = (p: MeshPart): number => rig.islandsOf(p).count

  return (
    <>
      <PanelSection title={t('parts.title')} icon={PartsIcon} badge={rig.parts().length}>
        <div class="p-2 flex flex-col gap-2">
          <p class="text-[11px] text-[var(--text-muted)] leading-snug">{t('parts.help')}</p>
          <div class="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant="outline"
              icon={<PartsIcon size={12} />}
              title={t('parts.bonePerObjectHelp')}
              onClick={() => {
                const n = rig.bonesPerPart(false)
                props.notify(t('parts.bonesMade', { count: n }), 'success')
                rig.focus(null)
              }}
            >
              {t('parts.bonePerObject')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              icon={<PiecesIcon size={12} />}
              title={t('parts.bonePerPieceHelp')}
              onClick={() => {
                const n = rig.bonesPerPart(true)
                props.notify(t('parts.bonesMade', { count: n }), 'success')
              }}
            >
              {t('parts.bonePerPiece')}
            </Button>
          </div>
          <Show when={!rig.selectedBone()}>
            <p class="text-[11px] px-2 py-1.5 rounded-[var(--ui-radius)] bg-amber-500/10 border border-amber-500/30 text-amber-200">
              {t('parts.pickBone')}
            </p>
          </Show>
          <Show when={rig.selectedBone()}>
            <div class="flex flex-col gap-1.5 text-[11px] px-2 py-1.5 rounded-[var(--ui-radius)] bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/40">
              <span>
                {t('parts.clickToBind', {
                  bone: rig.boneMap().get(rig.selectedBone()!)?.name ?? ''
                })}
              </span>
              <Show when={rig.attachedTo(rig.selectedBone()!).length > 0}>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[var(--text-muted)]">
                    {t('inspector.attached', { count: rig.attachedTo(rig.selectedBone()!).length })}
                  </span>
                  <button
                    type="button"
                    class="text-[var(--text-muted)] hover:text-red-300 underline cursor-pointer"
                    onClick={() => rig.detachAll(rig.selectedBone()!)}
                  >
                    {t('inspector.detachAll')}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </PanelSection>

      <PanelSection title={t('parts.objects')} icon={PiecesIcon}>
        <div class="py-1">
          <Show
            when={rig.selectedParts().length > 0}
            fallback={
              <p class="px-2 pb-1 text-[10px] text-[var(--text-muted)]">{t('parts.multiHint')}</p>
            }
          >
            <JoinBar notify={props.notify} />
          </Show>
          <For each={rig.parts()}>
            {(part) => {
              const out = (): boolean => rig.excluded().includes(part.name)
              const split = (): boolean => rig.splitObjects().includes(part.name)
              const key = objectKey(part.name)
              return (
                <div class="flex flex-col">
                  <div
                    class={`flex items-center gap-1.5 px-2 h-8 text-[11px] ${rig.selectedParts().includes(key) ? 'bg-[var(--accent-color)]/15' : 'hover:bg-white/5'}`}
                    onMouseEnter={() => rig.setHoverPart(key)}
                    onMouseLeave={() => rig.setHoverPart(null)}
                  >
                    <button
                      type="button"
                      class="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                      title={out() ? t('parts.include') : t('parts.exclude')}
                      onClick={() => rig.setPartExcluded(part.name, !out())}
                    >
                      <Show when={out()} fallback={<EyeIcon size={13} />}>
                        <EyeOffIcon size={13} />
                      </Show>
                    </button>
                    <button
                      type="button"
                      class={`flex-1 min-w-0 text-left truncate cursor-pointer ${out() ? 'line-through text-[var(--text-muted)]' : ''}`}
                      onClick={(e) => rig.selectPart(key, adds(e))}
                      title={`${part.name}: ${t('parts.stats', {
                        verts: part.positions.length / 3,
                        pieces: pieceCount(part)
                      })}`}
                    >
                      {part.name}
                    </button>
                    <Show when={pieceCount(part) > 1}>
                      <button
                        type="button"
                        class={`flex items-center gap-0.5 px-1 h-5 rounded text-[10px] cursor-pointer border ${
                          split()
                            ? 'border-[var(--accent-color)] text-[var(--text-main)]'
                            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                        title={t('parts.splitHelp')}
                        onClick={() => rig.toggleSplit(part.name)}
                      >
                        <SplitIcon size={11} />
                        {pieceCount(part)}
                      </button>
                    </Show>
                    <BoundDot partKey={key} />
                    <BindSelect partKey={key} disabled={out()} />
                    <DetachButton partKey={key} />
                  </div>
                  <Show when={split() && !out()}>
                    <div class="ml-6 border-l border-[var(--border-color)]">
                      <For
                        each={Array.from(
                          { length: Math.min(pieceCount(part), MAX_LISTED) },
                          (_, i) => i
                        )}
                      >
                        {(i) => {
                          const k = islandKey(part.name, i)
                          return (
                            <div
                              class={`flex items-center gap-1.5 pl-2 pr-2 h-7 text-[11px] ${rig.selectedParts().includes(k) ? 'bg-[var(--accent-color)]/15' : 'hover:bg-white/5'}`}
                              onMouseEnter={() => rig.setHoverPart(k)}
                              onMouseLeave={() => rig.setHoverPart(null)}
                            >
                              <button
                                type="button"
                                class="flex-1 text-left truncate text-[var(--text-muted)] cursor-pointer"
                                onClick={(e) => rig.selectPart(k, adds(e))}
                              >
                                {t('parts.piece', {
                                  n: i + 1,
                                  verts: rig.islandsOf(part).sizes[i]
                                })}
                              </button>
                              <BoundDot partKey={k} />
                              <BindSelect partKey={k} />
                              <DetachButton partKey={k} />
                            </div>
                          )
                        }}
                      </For>
                      <Show when={pieceCount(part) > MAX_LISTED}>
                        <p class="px-2 py-1 text-[10px] text-[var(--text-muted)]">
                          {t('parts.more', { count: pieceCount(part) - MAX_LISTED })}
                        </p>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </PanelSection>
    </>
  )
}
