import { createEffect, createSignal, For, Show, type JSX } from 'solid-js'
import { rig } from '../../rig/store'
import type { Bone, BoneRole, PartKey, PoleMode } from '../../rig/types'
import { parseKey } from '../../rig/parts'
import { boneCss } from '../../rig/colors'
import { defaultIk } from '../../rig/controls'
import { mirrorName, subtreeIds } from '../../rig/skeleton'
import { Button, PanelSection, Select, Slider, ToggleSwitch } from '../ui'
import { CenterIcon, FocusIcon, IkIcon, TrashIcon, BoneIcon } from '../icons'
import { t } from '../../i18n'

const ROLES: BoneRole[] = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'jaw',
  'shoulder',
  'arm',
  'forearm',
  'hand',
  'finger',
  'thigh',
  'shin',
  'foot',
  'toe',
  'tail',
  'wing',
  'part',
  'other'
]
const POLES: PoleMode[] = ['auto', 'forward', 'back', 'up', 'down', 'left', 'right', 'none']

export default function BoneInspector(props: { bone: Bone }): JSX.Element {
  const [name, setName] = createSignal(props.bone.name)
  createEffect(() => setName(props.bone.name))
  const b = (): Bone => props.bone
  const commitName = (): void => {
    const n = name().trim()
    if (n && n !== b().name) {
      rig.renameBone(b().id, n)
    } else {
      setName(b().name)
    }
  }
  const parentOptions = (): { value: string; label: string }[] => {
    const blocked = subtreeIds(rig.bones(), b().id)
    return [
      { value: '', label: t('inspector.noParent') },
      ...rig
        .bones()
        .filter((x) => !blocked.has(x.id))
        .map((x) => ({ value: x.id, label: x.name }))
    ]
  }
  const row = 'flex items-center justify-between gap-2 text-[11px]'

  return (
    <PanelSection title={t('inspector.title')} icon={BoneIcon}>
      <div class="p-2 flex flex-col gap-2">
        <input
          class="h-7 px-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs focus:outline-none focus:border-[var(--accent-color)]"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              setName(b().name)
              e.currentTarget.blur()
            }
          }}
          title={t('inspector.nameHelp')}
        />
        <MirrorNote bone={b()} />
        <div class={row}>
          <span class="text-[var(--text-muted)]">{t('inspector.role')}</span>
          <Select
            size="xs"
            class="w-36"
            value={b().role}
            onChange={(v) => rig.updateBone(b().id, { role: v as BoneRole })}
            options={ROLES.map((r) => ({
              value: r,
              label: t(`roles.${r === 'other' ? 'generic' : r}`)
            }))}
          />
        </div>
        <div class={row}>
          <span class="text-[var(--text-muted)]">{t('inspector.parent')}</span>
          <Select
            size="xs"
            class="w-36"
            value={b().parent ?? ''}
            onChange={(v) => rig.reparent(b().id, (v as string) || null, false)}
            options={parentOptions()}
          />
        </div>
        <ToggleSwitch
          checked={b().connected}
          disabled={!b().parent}
          onChange={(v) => rig.reparent(b().id, b().parent, v)}
          label={t('inspector.connected')}
          description={t('inspector.connectedHelp')}
        />
        <ToggleSwitch
          checked={b().deform}
          onChange={(v) => rig.updateBone(b().id, { deform: v })}
          label={t('inspector.deform')}
          description={t('inspector.deformHelp')}
        />
        <ToggleSwitch
          checked={!!b().ik}
          disabled={!b().parent}
          icon={IkIcon}
          onChange={(v) => rig.updateBone(b().id, { ik: v ? defaultIk(b().role) : null })}
          label={t('inspector.ik')}
          description={t('inspector.ikHelp')}
        />
        <Show when={b().ik}>
          {(ik) => (
            <div class="flex flex-col gap-2 pl-2 border-l-2 border-amber-500/40">
              <div class={row}>
                <span class="text-[var(--text-muted)]">{t('inspector.chain')}</span>
                <Select
                  size="xs"
                  class="w-36"
                  value={ik().chain}
                  onChange={(v) => rig.updateBone(b().id, { ik: { ...ik(), chain: Number(v) } })}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({
                    value: n,
                    label: t('inspector.chainBones', { count: n })
                  }))}
                />
              </div>
              <div class={row}>
                <span class="text-[var(--text-muted)]">{t('inspector.pole')}</span>
                <Select
                  size="xs"
                  class="w-36"
                  value={ik().pole}
                  onChange={(v) => rig.updateBone(b().id, { ik: { ...ik(), pole: v as PoleMode } })}
                  options={POLES.map((p) => ({ value: p, label: t(`poles.${p}`) }))}
                />
              </div>
              <ToggleSwitch
                checked={ik().follow}
                onChange={(v) => rig.updateBone(b().id, { ik: { ...ik(), follow: v } })}
                label={t('inspector.follow')}
                description={t('inspector.followHelp')}
              />
            </div>
          )}
        </Show>
        <AttachedPieces bone={b()} />
        <PanelSection title={t('inspector.advanced')} defaultOpen={false} class="!m-0">
          <div class="p-2 flex flex-col gap-2">
            <Slider
              label={t('inspector.roll')}
              value={b().rollOffset}
              min={-180}
              max={180}
              step={5}
              unit="°"
              onChange={(v) => rig.updateBone(b().id, { rollOffset: v })}
              title={t('inspector.rollHelp')}
            />
            <Show when={b().zAxis}>
              <Button
                size="xs"
                variant="outline"
                onClick={() => rig.updateBone(b().id, { zAxis: null })}
                title={t('inspector.autoRollHelp')}
              >
                {t('inspector.autoRoll')}
              </Button>
            </Show>
          </div>
        </PanelSection>
        <div class="flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="outline"
            icon={<CenterIcon size={12} />}
            title={t('inspector.centerHelp')}
            onClick={() => rig.centerSelected()}
          >
            {t('inspector.center')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            icon={<FocusIcon size={12} />}
            onClick={() => rig.focus(b().id)}
          >
            {t('inspector.frame')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<TrashIcon size={12} />}
            onClick={() => rig.deleteSelected()}
          >
            {t('common.delete')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => rig.deleteBranch(b().id)}
            title={t('inspector.deleteBranchHelp')}
          >
            {t('inspector.deleteBranch')}
          </Button>
        </div>
      </div>
    </PanelSection>
  )
}

/** Readable name of a piece: the object, or "object · piece n" for a loose piece. */
export function pieceLabel(key: PartKey): string {
  const k = parseKey(key)
  return k.island === null ? k.object : t('parts.pieceOf', { object: k.object, n: k.island + 1 })
}

/** The pieces this bone carries rigidly, with ways to select or release them. */
function AttachedPieces(props: { bone: Bone }): JSX.Element {
  const keys = (): PartKey[] => rig.attachedTo(props.bone.id)
  return (
    <div class="flex flex-col gap-1 p-2 rounded-[var(--ui-radius)] border border-[var(--border-color)] bg-[var(--bg-input)]">
      <div class="flex items-center justify-between gap-2 text-[11px]">
        <span class="flex items-center gap-1.5 font-semibold">
          <span class="w-2.5 h-2.5 rounded-full" style={{ background: boneCss(props.bone.id) }} />
          {t('inspector.attached', { count: keys().length })}
        </span>
        <Show when={keys().length > 0}>
          <span class="flex gap-2">
            <button
              type="button"
              class="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              onClick={() => rig.setSelectedParts(keys())}
            >
              {t('inspector.selectAttached')}
            </button>
            <button
              type="button"
              class="text-[var(--text-muted)] hover:text-red-300 cursor-pointer"
              onClick={() => rig.detachAll(props.bone.id)}
            >
              {t('inspector.detachAll')}
            </button>
          </span>
        </Show>
      </div>
      <Show
        when={keys().length > 0}
        fallback={<p class="text-[10px] text-[var(--text-muted)]">{t('inspector.noneAttached')}</p>}
      >
        <div class="flex flex-col max-h-36 overflow-y-auto dcc-scroll">
          <For each={keys()}>
            {(k) => (
              <div
                class="flex items-center justify-between gap-2 h-6 px-1 rounded text-[11px] hover:bg-white/5"
                onMouseEnter={() => rig.setHoverPart(k)}
                onMouseLeave={() => rig.setHoverPart(null)}
              >
                <span class="truncate">{pieceLabel(k)}</span>
                <button
                  type="button"
                  class="text-[var(--text-muted)] hover:text-red-300 cursor-pointer"
                  title={t('inspector.detach')}
                  onClick={() => rig.bindPart(k, null)}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * Says when a bone has a mirror twin, and whether edits reach it: with
 * Symmetry on, editing one side edits both.
 */
function MirrorNote(props: { bone: Bone }): JSX.Element {
  const twin = (): Bone | undefined => {
    const name = mirrorName(props.bone.name)
    return name ? rig.bones().find((x) => x.name === name) : undefined
  }
  return (
    <Show when={twin()}>
      {(tw) => (
        <div
          class={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-[var(--ui-radius)] border text-[11px] ${
            rig.symmetry()
              ? 'border-[var(--accent-color)]/40 bg-[var(--accent-color)]/10'
              : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]'
          }`}
        >
          <span>
            {rig.symmetry()
              ? t('inspector.mirroredOn', { twin: tw().name })
              : t('inspector.mirroredOff', { twin: tw().name })}
          </span>
          <button
            type="button"
            class="shrink-0 underline cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-main)]"
            onClick={() => rig.setSymmetry(!rig.symmetry())}
          >
            {rig.symmetry() ? t('inspector.editOneSide') : t('inspector.editBothSides')}
          </button>
        </div>
      )}
    </Show>
  )
}
