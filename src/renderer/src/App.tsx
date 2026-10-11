import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import * as THREE from 'three'
import RigViewport from './viewport/RigViewport'
import { engine } from './viewport/engineRef'
import type { LightingMode } from './viewport/scene'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import ToolRail, { chooseTool } from './components/ToolRail'
import HelpModal from './components/HelpModal'
import PreferencesModal from './components/PreferencesModal'
import { skinNow } from './components/panels/SkinPanel'
import { joinNow } from './components/panels/PartsPanel'
import { Button, Kbd, Modal, Toast, type MenuItem, type ToastData } from './components/ui'
import {
  AppIcon,
  FigureIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  SaveIcon,
  ClockIcon
} from './components/icons'
import { rig, type Panel } from './rig/store'
import { openRigDocument } from './rig/doc'
import { buildSavePayload } from './rig/payload'
import type { RigSpec } from './rig/types'
import { fileName } from './utils/paths'
import { t, tr } from './i18n'

const LIGHTING_KEY = 'meshrig:lighting'

type View = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'
/** Numpad key -> [view, Ctrl+key view], as in Blender. */
const NUMPAD_VIEWS: Record<string, [View, View]> = {
  Numpad1: ['front', 'back'],
  Numpad3: ['right', 'left'],
  Numpad7: ['top', 'bottom']
}
const STEP_KEYS: Record<string, Panel> = { '1': 'skeleton', '2': 'parts', '3': 'skin', '4': 'test' }

interface Autosave {
  blendPath: string
  /** The working copy, when objects were joined. */
  sourcePath?: string
  spec: RigSpec
}

export default function App(): JSX.Element {
  const [lighting, setLightingSignal] = createSignal<LightingMode>(
    (localStorage.getItem(LIGHTING_KEY) as LightingMode | null) ?? 'neutral'
  )
  const setLighting = (m: LightingMode): void => {
    setLightingSignal(m)
    try {
      localStorage.setItem(LIGHTING_KEY, m)
    } catch {
      // Preference only.
    }
  }
  const [showHelp, setShowHelp] = createSignal(false)
  const [showPrefs, setShowPrefs] = createSignal(false)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal<ToastData | null>(null)
  const [confirmDiscard, setConfirmDiscard] = createSignal<null | (() => void)>(null)
  const [recovery, setRecovery] = createSignal<Autosave | null>(null)
  const [blender, setBlender] = createSignal<{ path: string | null; version?: string } | null>(null)
  const [recent, setRecent] = createSignal<string[]>([])
  const [armatureName, setArmatureName] = createSignal('Armature')
  const [join, setJoin] = createSignal(false)
  const [diskChanged, setDiskChanged] = createSignal(false)

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const notify = (text: string, type: ToastData['type'] = 'info', ms = 3600): void => {
    clearTimeout(toastTimer)
    setToast({ id: Date.now(), text, type })
    toastTimer = setTimeout(() => setToast(null), ms)
  }

  const blendPath = (): string | null => rig.doc()?.blendPath ?? null
  /** What the status line explains: the pose view, the brush, the weights view, or the tool. */
  const hintKey = (): 'pose' | 'paint' | 'weights' | 'select' | 'add' | 'chain' | 'bind' => {
    const view = rig.view()
    if (view === 'pose') {
      return 'pose'
    }
    if (view === 'weights') {
      return rig.paint().on ? 'paint' : 'weights'
    }
    return rig.tool()
  }
  const docName = (): string => (blendPath() ? fileName(blendPath()) : t('common.noFileOpen'))

  async function refreshRecent(): Promise<void> {
    const list = await window.api.getRecentProjects()
    setRecent(list.map((r) => r.projectPath).filter((p) => p.toLowerCase().endsWith('.blend')))
  }

  async function refreshBlender(): Promise<void> {
    setBlender(await window.api.detectBlender())
  }

  async function locateBlender(): Promise<void> {
    const res = await window.api.browseBlenderExecutable()
    if (!res) {
      return
    }
    if (!res.success) {
      notify(res.error ?? t('toast.notBlender'), 'error', 6000)
      return
    }
    setBlender({ path: res.path ?? null, version: res.version })
    notify(t('toast.usingBlender', { version: res.version ?? t('common.blender') }), 'success')
  }

  // --- the file on disk -------------------------------------------------------------

  let knownMtime: number | null = null
  async function rememberDiskState(path: string): Promise<void> {
    knownMtime = await window.api.statBlend(path)
  }
  async function changedOnDisk(): Promise<boolean> {
    const path = blendPath()
    if (!path || knownMtime === null) {
      return false
    }
    const now = await window.api.statBlend(path)
    return now !== null && now > knownMtime + 1
  }

  // --- opening ------------------------------------------------------------------------

  async function openBlend(path: string, restore?: Autosave): Promise<void> {
    setBusy(t('busy.reading', { file: fileName(path) }))
    try {
      // A restored rig may follow joined objects that only its working copy has.
      const source =
        restore?.sourcePath && (await window.api.statBlend(restore.sourcePath)) !== null
          ? restore.sourcePath
          : path
      const doc = await openRigDocument(source, path)
      await rememberDiskState(path)
      setDiskChanged(false)
      rig.loadDocument(doc, restore?.spec)
      setArmatureName(doc.armatureName ?? 'Armature')
      setJoin(false)
      void window.api.addRecentProject(path, fileName(path), 'project').then(refreshRecent)
      const n = doc.spec.bones.length
      notify(
        [
          n
            ? t(doc.fromMeshRig ? 'toast.openedRig' : 'toast.openedArmature', {
                file: fileName(path),
                bones: t('toast.bones', { count: n })
              })
            : t('toast.opened', {
                file: fileName(path),
                objects: t('toast.objects', { count: doc.parts.length })
              }),
          doc.mirrorModifiers.length
            ? t('toast.mirrorModifier', { objects: doc.mirrorModifiers.join(', ') })
            : ''
        ]
          .filter(Boolean)
          .join(' '),
        'success',
        doc.mirrorModifiers.length ? 8000 : 4000
      )
      if (!n) {
        rig.setPanel('skeleton')
      }
    } catch (err) {
      console.error(err)
      const msg = (err as Error).message
      notify(
        msg === 'noMesh'
          ? t('toast.noMesh', { file: fileName(path) })
          : t('toast.openFailed', { file: fileName(path), error: msg }),
        'error',
        9000
      )
    } finally {
      setBusy(null)
    }
  }

  async function promptOpen(): Promise<void> {
    const paths = await window.api.openFileDialog({
      key: 'blend',
      filters: [{ name: t('files.blend'), extensions: ['blend'] }]
    })
    const path = paths?.[0]
    if (path) {
      await guardUnsaved(() => openBlend(path))
    }
  }

  async function reload(): Promise<void> {
    const path = blendPath()
    if (path) {
      await guardUnsaved(() => openBlend(path))
    }
  }

  // --- saving -------------------------------------------------------------------------

  /** Skins first when the weights are missing or out of date, then writes the rig. */
  async function save(saveAs = false): Promise<boolean> {
    const doc = rig.doc()
    if (!doc || busy()) {
      return false
    }
    if (!rig.bones().some((b) => b.deform)) {
      notify(t('skin.noBones'), 'warning')
      return false
    }
    let outPath = doc.blendPath
    if (saveAs) {
      const chosen = await window.api.saveFileDialog({
        key: 'blend',
        defaultPath: fileName(doc.blendPath),
        filters: [{ name: t('files.blend'), extensions: ['blend'] }]
      })
      if (!chosen) {
        return false
      }
      outPath = chosen.toLowerCase().endsWith('.blend') ? chosen : `${chosen}.blend`
    }
    if (outPath === doc.blendPath && (await changedOnDisk())) {
      setDiskChanged(true)
      return false
    }
    if (rig.weightsStale()) {
      if (!(await skinNow(notify))) {
        return false
      }
    }
    const weights = rig.weights()!
    setBusy(t('busy.saving', { file: fileName(outPath) }))
    try {
      const included = rig.includedParts()
      const joinTarget =
        join() && included.length > 1
          ? included.reduce((a, b) => (b.positions.length > a.positions.length ? b : a)).name
          : null
      const payload = buildSavePayload(
        rig.parts(),
        rig.spec(),
        weights,
        doc.armatureName,
        { armatureName: armatureName(), join: joinTarget },
        rig.skin(),
        rig.templateOptions()
      )
      const res = await window.api.saveBlend(doc.sourcePath, outPath, JSON.stringify(payload))
      if (!res.ok) {
        notify(t('toast.saveFailed', { error: res.error ?? '' }), 'error', 10000)
        return false
      }
      await rememberDiskState(outPath)
      void window.api.clearRecovery()
      void window.api.addRecentProject(outPath, fileName(outPath), 'project').then(refreshRecent)
      notify(
        [
          t('toast.saved', { file: fileName(outPath) }),
          res.backupPath ? t('toast.backupMade') : '',
          joinTarget ? t('toast.joined', { object: joinTarget }) : ''
        ]
          .filter(Boolean)
          .join(' '),
        'success',
        5000
      )
      if (joinTarget || outPath !== doc.blendPath) {
        // Objects were merged (or this is a new file): read it back so the
        // meshes here match the ones in the file.
        await openBlend(outPath)
      } else {
        // The saved file has the same meshes (and vertex order) as the working copy.
        rig.setDoc({ ...doc, sourcePath: outPath, armatureName: armatureName(), fromMeshRig: true })
        rig.setDirty(false)
      }
      return true
    } finally {
      setBusy(null)
    }
  }

  // --- unsaved-change guard --------------------------------------------------------------

  async function guardUnsaved(then: () => void | Promise<void>): Promise<void> {
    if (!rig.dirty()) {
      await then()
      return
    }
    setConfirmDiscard(() => () => void then())
  }

  // --- menus ------------------------------------------------------------------------------

  const fileMenu = (): MenuItem[] => [
    {
      label: t('menu.open'),
      icon: FolderOpenIcon,
      shortcut: 'Ctrl+O',
      onClick: () => void promptOpen()
    },
    {
      label: t('menu.reload'),
      icon: RefreshCwIcon,
      disabled: !blendPath(),
      onClick: () => void reload()
    },
    { type: 'divider' },
    {
      label: blendPath() ? t('menu.saveTo', { file: fileName(blendPath()) }) : t('menu.save'),
      icon: SaveIcon,
      shortcut: 'Ctrl+S',
      disabled: !blendPath(),
      onClick: () => void save()
    },
    {
      label: t('menu.saveAs'),
      icon: SaveIcon,
      shortcut: 'Ctrl+Shift+S',
      disabled: !blendPath(),
      onClick: () => void save(true)
    },
    {
      label: t('menu.showInFolder'),
      icon: ClockIcon,
      disabled: !blendPath(),
      onClick: () => {
        const p = blendPath()
        if (p) {
          window.api.revealInFolder(p)
        }
      }
    }
  ]

  const editMenu = (): MenuItem[] => [
    {
      label: t('menu.undo'),
      shortcut: 'Ctrl+Z',
      disabled: !rig.canUndo(),
      onClick: () => rig.undo()
    },
    {
      label: t('menu.redo'),
      shortcut: 'Ctrl+Shift+Z',
      disabled: !rig.canRedo(),
      onClick: () => rig.redo()
    },
    { type: 'divider' },
    {
      label: t('menu.deleteBone'),
      shortcut: 'Del',
      danger: true,
      disabled: !rig.selectedBone(),
      onClick: () => rig.deleteSelected()
    },
    {
      label: t('menu.join'),
      shortcut: 'Ctrl+J',
      disabled: rig.selectedObjects().length < 2 || rig.joining(),
      onClick: () => void joinNow(notify)
    },
    {
      label: t('menu.symmetrize'),
      disabled: !rig.bones().length,
      onClick: () => rig.symmetrizeFrom('L')
    },
    { label: t('menu.autoIk'), disabled: !rig.bones().length, onClick: () => rig.runAutoIk() },
    { type: 'divider' },
    {
      label: t('menu.computeWeights'),
      disabled: !rig.bones().length,
      onClick: () => void skinNow(notify)
    }
  ]

  const viewMenu = (): MenuItem[] => {
    const go = (v: View) => (): void => engine()?.viewAlong(v)
    return [
      { label: t('menu.front'), shortcut: 'Num 1', onClick: go('front') },
      { label: t('menu.back'), shortcut: 'Ctrl+Num 1', onClick: go('back') },
      { label: t('menu.rightSide'), shortcut: 'Num 3', onClick: go('right') },
      { label: t('menu.leftSide'), shortcut: 'Ctrl+Num 3', onClick: go('left') },
      { label: t('menu.top'), shortcut: 'Num 7', onClick: go('top') },
      { label: t('menu.bottom'), shortcut: 'Ctrl+Num 7', onClick: go('bottom') },
      { type: 'divider' },
      { label: t('menu.frameModel'), shortcut: 'F', onClick: () => engine()?.frame() },
      {
        label: rig.ortho() ? t('menu.perspective') : t('menu.orthographic'),
        shortcut: 'Num 5',
        onClick: () => engine()?.toggleOrtho()
      },
      {
        label: rig.showNames() ? t('menu.hideNames') : t('menu.showNames'),
        shortcut: 'N',
        onClick: () => rig.setShowNames(!rig.showNames())
      }
    ]
  }

  // --- keyboard -----------------------------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement
    const typing =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    if (typing || busy()) {
      return
    }
    if (target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
      target.blur()
    }
    const ctrl = e.ctrlKey || e.metaKey
    const view = NUMPAD_VIEWS[e.code]
    if (view && rig.doc()) {
      engine()?.viewAlong(ctrl ? view[1] : view[0])
      e.preventDefault()
      return
    }
    const handled = ctrl ? onCtrlKey(e.key.toLowerCase(), e.shiftKey) : onPlainKey(e)
    if (handled) {
      e.preventDefault()
    }
  }

  function onCtrlKey(key: string, shift: boolean): boolean {
    const actions: Record<string, () => void> = {
      z: () => (shift ? rig.redo() : rig.undo()),
      y: () => rig.redo(),
      s: () => void save(shift),
      o: () => void promptOpen(),
      j: () => void joinNow(notify)
    }
    const action = actions[key]
    action?.()
    return !!action
  }

  function onPlainKey(e: KeyboardEvent): boolean {
    if (e.key === '?') {
      setShowHelp(true)
      return true
    }
    if (!rig.doc()) {
      return false
    }
    if (e.code === 'Numpad5') {
      engine()?.toggleOrtho()
      return true
    }
    const step = STEP_KEYS[e.key]
    if (step && !e.code.startsWith('Numpad')) {
      rig.setPanel(step)
      return true
    }
    const actions: Record<string, () => void> = {
      q: () => chooseTool('select'),
      e: () => chooseTool('add'),
      c: () => chooseTool('chain'),
      b: () => chooseTool('bind'),
      x: () => rig.setSymmetry(!rig.symmetry()),
      p: () => rig.setShowAttached(!rig.showAttached()),
      d: () => {
        const id = rig.selectedBone()
        const r = id ? rig.toggleConnected(id) : null
        if (r) {
          notify(t(r === 'connected' ? 'toast.connected' : 'toast.disconnected'), 'info', 2500)
        }
      },
      '5': () => engine()?.toggleOrtho(),
      g: () => rig.setSnap({ grid: !rig.snap().grid }),
      a: () => rig.setSnap({ angle: !rig.snap().angle }),
      j: () => rig.setSnap({ joints: !rig.snap().joints }),
      s: () => rig.setSnapInside(!rig.snapInside()),
      n: () => rig.setShowNames(!rig.showNames()),
      f: () => {
        const sel = rig.selectedBone()
        if (sel) {
          engine()?.frameBone(sel)
        } else {
          engine()?.frame()
        }
      },
      delete: () => rig.deleteSelected(),
      backspace: () => rig.deleteSelected(),
      escape: () => {
        if (rig.pendingHead()) {
          rig.setPendingHead(null)
        } else if (rig.selectedParts().length) {
          rig.setSelectedParts([])
        } else {
          rig.setSelectedBone(null)
        }
      }
    }
    const action = actions[e.key.toLowerCase()]
    action?.()
    return !!action
  }

  // --- lifecycle ------------------------------------------------------------------------------

  onMount(async () => {
    window.addEventListener('keydown', onKeyDown)
    const offClose = window.api.onBeforeClose(() => {
      if (!rig.dirty()) {
        window.api.confirmClose()
        return
      }
      setConfirmDiscard(() => () => window.api.confirmClose())
    })
    const timer = setInterval(() => {
      const path = blendPath()
      if (rig.dirty() && path) {
        void window.api.saveRecovery(
          JSON.stringify({
            blendPath: path,
            sourcePath: rig.doc()?.sourcePath,
            spec: rig.spec()
          } satisfies Autosave)
        )
      }
    }, 60_000)
    onCleanup(() => {
      offClose()
      clearInterval(timer)
      window.removeEventListener('keydown', onKeyDown)
    })

    // Handy from the dev console, and how automated smoke tests drive the app.
    Object.assign(window, { __meshrig: { rig, openBlend, save, THREE, engine } })

    void refreshBlender()
    void refreshRecent()
    const saved = await window.api.loadRecovery()
    if (saved?.data) {
      try {
        const data = JSON.parse(saved.data) as Autosave
        if (data.blendPath && data.spec && Array.isArray(data.spec.bones)) {
          setRecovery(data)
        }
      } catch {
        void window.api.clearRecovery()
      }
    }
  })

  return (
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
      <AppHeader
        docName={docName()}
        busy={!!busy() || !!rig.skinning()}
        menus={[
          { label: t('menu.file.label'), title: t('menu.file.title'), items: fileMenu() },
          { label: t('menu.edit.label'), title: t('menu.edit.title'), items: editMenu() },
          { label: t('menu.view.label'), title: t('menu.view.title'), items: viewMenu() }
        ]}
        lightingMode={lighting()}
        onSelectLightingMode={setLighting}
        onFrameCamera={() => engine()?.frame()}
        onOpenHelp={() => setShowHelp(true)}
        onOpenSettings={() => setShowPrefs(true)}
      />

      <div class="flex flex-1 min-h-0">
        <Show when={rig.doc()}>
          <ToolRail />
        </Show>
        <main class="relative flex-1 min-w-0">
          <RigViewport lightingMode={lighting()} />
          <Show when={!rig.doc()}>
            <StartScreen
              blender={blender()}
              recent={recent()}
              busy={!!busy()}
              onOpen={() => void promptOpen()}
              onOpenRecent={(p) => void openBlend(p)}
              onLocateBlender={() => void locateBlender()}
            />
          </Show>
          <Show when={rig.doc()}>
            <div class="absolute bottom-2 left-3 right-3 text-[10px] text-[var(--text-muted)]/80 pointer-events-none select-none flex flex-wrap gap-x-3">
              <span class="text-[var(--text-main)]/80">{t(`hints.${hintKey()}`)}</span>
              <span>{tr('hints.snap', { key: <Kbd size="xs">Ctrl</Kbd> })}</span>
              <span>{t('hints.orbit')}</span>
              <span>{t('hints.pan')}</span>
              <span>{t('hints.zoom')}</span>
            </div>
          </Show>
        </main>
        <Show when={rig.doc()}>
          <Sidebar
            notify={notify}
            armatureName={armatureName()}
            setArmatureName={setArmatureName}
            join={join()}
            setJoin={setJoin}
            onSave={() => void save()}
            saving={!!busy()}
          />
        </Show>
      </div>

      <HelpModal isOpen={showHelp()} onClose={() => setShowHelp(false)} />
      <PreferencesModal
        isOpen={showPrefs()}
        onClose={() => setShowPrefs(false)}
        blender={blender()}
        onLocateBlender={() => void locateBlender()}
        onAutoDetectBlender={async () => {
          await window.api.setBlenderPath(null)
          await refreshBlender()
          notify(
            blender()?.path
              ? t('toast.foundBlender', { version: blender()?.version ?? t('common.blender') })
              : t('toast.noBlender'),
            blender()?.path ? 'success' : 'warning'
          )
        }}
      />

      <Show when={busy()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
          <div class="flex items-center gap-3 px-5 py-3.5 rounded-[var(--ui-radius)] bg-[var(--bg-panel)] border border-[var(--border-color)] shadow-2xl text-xs">
            <RefreshCwIcon size={15} class="animate-spin text-[var(--accent-color)]" />
            {busy()}
          </div>
        </div>
      </Show>

      <Modal
        isOpen={!!confirmDiscard()}
        onClose={() => setConfirmDiscard(null)}
        title={t('dialogs.unsaved.title')}
        icon={FigureIcon}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = confirmDiscard()
                setConfirmDiscard(null)
                rig.setDirty(false)
                void window.api.clearRecovery()
                next?.()
              }}
            >
              {t('common.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const next = confirmDiscard()
                setConfirmDiscard(null)
                if (await save()) {
                  next?.()
                }
              }}
            >
              {t('dialogs.unsaved.save')}
            </Button>
          </>
        }
      >
        <p>{t('dialogs.unsaved.body', { file: docName() })}</p>
      </Modal>

      <Modal
        isOpen={diskChanged()}
        onClose={() => setDiskChanged(false)}
        title={t('dialogs.diskChanged.title', { file: docName() })}
        icon={RefreshCwIcon}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiskChanged(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setDiskChanged(false)
                const path = blendPath()
                if (path) {
                  await rememberDiskState(path)
                  void save()
                }
              }}
            >
              {t('dialogs.diskChanged.overwrite')}
            </Button>
          </>
        }
      >
        <p>{t('dialogs.diskChanged.body')}</p>
      </Modal>

      <Modal
        isOpen={!!recovery()}
        onClose={() => {
          setRecovery(null)
          void window.api.clearRecovery()
        }}
        title={t('dialogs.recovery.title')}
        icon={FigureIcon}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRecovery(null)
                void window.api.clearRecovery()
              }}
            >
              {t('common.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const data = recovery()
                setRecovery(null)
                if (data) {
                  void openBlend(data.blendPath, data)
                }
              }}
            >
              {t('dialogs.recovery.restore')}
            </Button>
          </>
        }
      >
        <p>
          {tr('dialogs.recovery.body', {
            file: <span class="font-semibold">{fileName(recovery()?.blendPath ?? '')}</span>
          })}
        </p>
      </Modal>

      <Toast toast={toast()} onClose={() => setToast(null)} />
    </div>
  )
}

function StartScreen(props: {
  blender: { path: string | null; version?: string } | null
  recent: string[]
  busy: boolean
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onLocateBlender: () => void
}): JSX.Element {
  const found = (): boolean => !!props.blender?.path
  return (
    <div class="absolute inset-0 flex items-center justify-center bg-[var(--bg-main)]/85 backdrop-blur-[2px]">
      <div class="w-[460px] p-6 rounded-[var(--ui-radius)] bg-[var(--bg-panel)] border border-[var(--border-color)] shadow-2xl flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <AppIcon size={40} />
          <div>
            <div class="text-base font-bold">{t('common.appName')}</div>
            <div class="text-[11px] text-[var(--text-muted)]">{t('start.tagline')}</div>
          </div>
        </div>

        <ol class="grid grid-cols-4 gap-1.5 text-[10px] text-[var(--text-muted)]">
          <For each={['skeleton', 'parts', 'skin', 'test'] as const}>
            {(s, i) => (
              <li class="flex flex-col items-center gap-1 p-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)] text-center">
                <span class="w-4.5 h-4.5 rounded-full bg-zinc-700 text-zinc-200 text-[10px] font-bold flex items-center justify-center">
                  {i() + 1}
                </span>
                <span class="font-semibold text-[var(--text-main)]">{t(`steps.${s}.label`)}</span>
              </li>
            )}
          </For>
        </ol>

        <Button
          variant="primary"
          size="md"
          disabled={!found() || props.busy}
          onClick={props.onOpen}
          icon={<FolderOpenIcon size={15} />}
        >
          {t('start.open')}
        </Button>

        <Show when={props.recent.length > 0}>
          <div class="flex flex-col gap-0.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pb-1">
              {t('start.recent')}
            </div>
            <For each={props.recent.slice(0, 6)}>
              {(p) => (
                <button
                  type="button"
                  disabled={!found() || props.busy}
                  onClick={() => props.onOpenRecent(p)}
                  title={p}
                  class="flex items-center justify-between gap-3 h-7 px-2 rounded-[var(--ui-radius)] text-left text-xs text-[var(--text-main)] hover:bg-white/5 cursor-pointer disabled:opacity-40"
                >
                  <span class="font-medium truncate">{fileName(p)}</span>
                  <span class="text-[10px] text-[var(--text-muted)] truncate max-w-[240px]">
                    {p}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div
          class={`flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--ui-radius)] border text-[11px] ${
            found()
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <span class="truncate" title={props.blender?.path ?? ''}>
            {props.blender === null
              ? t('start.lookingForBlender')
              : found()
                ? t('start.blenderFound', {
                    version: props.blender?.version ?? t('common.blender')
                  })
                : t('start.blenderMissing')}
          </span>
          <Button size="xs" variant="outline" onClick={props.onLocateBlender}>
            {found() ? t('start.change') : t('start.locate')}
          </Button>
        </div>
      </div>
    </div>
  )
}
