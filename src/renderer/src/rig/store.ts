import { batch, createMemo, createRoot, createSignal } from 'solid-js'
import type {
  Bone,
  BoneRole,
  MeshPart,
  PartKey,
  RigSpec,
  SkinResult,
  SkinSettings,
  Vec3
} from './types'
import { DEFAULT_SKIN } from './types'
import type { RigDocument } from './doc'
import { openRigDocument, readHeatWeights } from './doc'
import { MeshProbe } from './probe'
import {
  byId,
  deleteBones,
  makeBone,
  mirrorChanges,
  mirrorName,
  ROLE_NAMES,
  sideOf,
  setParent,
  sideForX,
  skeletonSignature,
  subtreeIds,
  symmetryPlane,
  symmetrize,
  uniqueName,
  withSide,
  type Side
} from './skeleton'
import {
  DEFAULT_TEMPLATE_OPTIONS,
  fitTemplate,
  type TemplateId,
  type TemplateOptions
} from './templates'
import { autoIk, defaultIk } from './controls'
import {
  boundBonePerVertex,
  bonesFromPieces,
  computeIslands,
  objectKey,
  parseKey,
  piecesOf,
  type Islands
} from './parts'
import { computeInWorker } from './skin/client'
import { adjacency, type SkinObject } from './skin/compute'
import { applyDab, type PaintMode } from './skin/paint'
import { buildHeatPayload } from './payload'
import { dist, mirrorX } from './vec'

/**
 * The app's state: the open document, the skeleton being edited (with
 * undo), what's selected, the tool, and the skin weights. Plain signals and
 * functions, so components and the viewport engine can both use it.
 */

export type Tool = 'select' | 'add' | 'chain' | 'bind'
export type ViewMode = 'rig' | 'weights' | 'pose'
/** The sidebar's steps, in the order you'd use them. */
export type Panel = 'skeleton' | 'parts' | 'skin' | 'test'

export interface PaintSettings {
  on: boolean
  mode: PaintMode
  /** Brush radius as a share of the model's size. */
  radius: number
  strength: number
}

export interface SnapSettings {
  /** Snap to other joints within a few pixels. */
  joints: boolean
  grid: boolean
  /** Grid step in Blender units; 0 = automatic from the model's size. */
  gridSize: number
  /** Bones turn in fixed steps in the view plane. */
  angle: boolean
  angleStep: number
}

const SNAP_KEY = 'meshrig:snap'
const DEFAULT_SNAP: SnapSettings = {
  joints: true,
  grid: false,
  gridSize: 0,
  angle: false,
  angleStep: 15
}

function loadPref<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Preference only.
  }
}

/** A round step near `x`: 1, 2 or 5 times a power of ten. */
export function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))))
  const m = x / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/**
 * An undo step: the rig, the weights as they were (painting is undoable), and
 * the document (joining objects swaps it for a working copy).
 */
type HistoryEntry = RigSpec & { weights: SkinResult | null; doc: RigDocument | null }

const HISTORY_LIMIT = 200
/** Loose pieces under this share of the model's size count as small (eyes, buttons). */
const SMALL_PIECE = 0.05

// The store's type is whatever it returns (RigStore below); spelling it out twice adds nothing.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createRigStore() {
  const [doc, setDoc] = createSignal<RigDocument | null>(null)
  const [bones, setBones] = createSignal<Bone[]>([])
  const [bindings, setBindings] = createSignal<Record<PartKey, string>>({})
  const [excluded, setExcluded] = createSignal<string[]>([])
  const [past, setPast] = createSignal<HistoryEntry[]>([])
  const [future, setFuture] = createSignal<HistoryEntry[]>([])
  const [dirty, setDirty] = createSignal(false)

  const [selectedBone, setSelectedBone] = createSignal<string | null>(null)
  /** Pieces picked in the Parts list or the viewport (Shift/Ctrl+click adds). */
  const [selectedParts, setSelectedParts] = createSignal<PartKey[]>([])
  const [joining, setJoining] = createSignal(false)
  const [hoverPart, setHoverPart] = createSignal<PartKey | null>(null)
  const [tool, setTool] = createSignal<Tool>('select')
  const [view, setView] = createSignal<ViewMode>('rig')
  const [panel, setPanelSignal] = createSignal<Panel>('skeleton')
  const [showNames, setShowNames] = createSignal(false)
  const [symmetry, setSymmetry] = createSignal(true)
  const [snapInside, setSnapInside] = createSignal(true)
  /** Colour the mesh by which bone each piece is attached to, in any tool. */
  const [showAttached, setShowAttached] = createSignal(false)
  const [snap, setSnapSignal] = createSignal<SnapSettings>(loadPref(SNAP_KEY, DEFAULT_SNAP))
  const setSnap = (patch: Partial<SnapSettings>): void => {
    setSnapSignal((s) => ({ ...s, ...patch }))
    savePref(SNAP_KEY, snap())
  }
  /** Orthographic (flat) view. */
  const [ortho, setOrtho] = createSignal(false)
  /** Front/side/top views turn orthographic, and orbiting turns perspective again (as in Blender). */
  const [autoOrtho, setAutoOrthoSignal] = createSignal(
    loadPref('meshrig:view', { autoOrtho: true }).autoOrtho
  )
  const setAutoOrtho = (on: boolean): void => {
    setAutoOrthoSignal(on)
    savePref('meshrig:view', { autoOrtho: on })
  }
  const [meshOpacity, setMeshOpacity] = createSignal(0.55)
  const [chainCount, setChainCount] = createSignal(4)
  /** Where an Add-tool bone will start, after a Shift+click (or the first click with nothing selected). */
  const [pendingHead, setPendingHead] = createSignal<{ pos: Vec3; parent: string | null } | null>(
    null
  )

  const [skin, setSkin] = createSignal<SkinSettings>(DEFAULT_SKIN)
  const [weights, setWeights] = createSignal<SkinResult | null>(null)
  /** Bumped by every brush dab, which edits the weight arrays in place. */
  const [weightsRevision, setWeightsRevision] = createSignal(0)
  const [paint, setPaint] = createSignal<PaintSettings>({
    on: false,
    mode: 'add',
    radius: 0.04,
    strength: 0.35
  })
  const [skinning, setSkinning] = createSignal<{ progress: number; stage: string } | null>(null)
  const [templateOptions, setTemplateOptions] =
    createSignal<TemplateOptions>(DEFAULT_TEMPLATE_OPTIONS)
  /** Objects whose loose pieces are listed (and bindable) one by one. */
  const [splitObjects, setSplitObjects] = createSignal<string[]>([])
  /** Bumped to make the viewport frame something. */
  const [focusRequest, setFocusRequest] = createSignal<{ bone: string | null; n: number } | null>(
    null
  )

  const islandCache = new Map<string, Islands>()
  const neighbourCache = new Map<string, { start: Int32Array; list: Int32Array }>()

  // --- derived -----------------------------------------------------------------------

  const parts = (): MeshPart[] => doc()?.parts ?? []
  const includedParts = createMemo(() => parts().filter((p) => !excluded().includes(p.name)))
  const probe = createMemo<MeshProbe | null>((prev) => {
    prev?.dispose()
    const list = includedParts()
    return list.length ? new MeshProbe(list) : null
  })
  /** The symmetry plane x = cx; see symmetryPlane(). */
  const cx = createMemo(() => {
    const p = probe()
    return symmetryPlane(bones(), p?.bounds.min[0] ?? -1, p?.bounds.max[0] ?? 1)
  })
  const boneMap = createMemo(() => byId(bones()))
  /** The grid step in use: the set size, or a round number near 1/40 of the model. */
  const gridStep = createMemo(() => snap().gridSize || niceStep((probe()?.diagonal ?? 2) / 40))
  const spec = (): RigSpec => ({ bones: bones(), bindings: bindings(), excluded: excluded() })
  const signature = createMemo(
    () =>
      `${skeletonSignature(bones())}#${JSON.stringify(bindings())}#${excluded().join('|')}#${JSON.stringify(skin())}`
  )
  const weightsStale = createMemo(() => {
    const w = weights()
    return !w || w.signature !== signature()
  })

  /** Per-part caches are keyed by name, which a join reuses: drop them when the meshes change. */
  function clearCaches(): void {
    islandCache.clear()
    neighbourCache.clear()
  }

  function islandsOf(part: MeshPart): Islands {
    let isl = islandCache.get(part.name)
    if (!isl) {
      isl = computeIslands(part)
      islandCache.set(part.name, isl)
    }
    return isl
  }

  // --- history -----------------------------------------------------------------------

  function snapshot(): HistoryEntry {
    return {
      bones: bones(),
      bindings: bindings(),
      excluded: excluded(),
      weights: weights(),
      doc: doc()
    }
  }

  function restore(s: HistoryEntry): void {
    batch(() => {
      if (s.doc !== doc()) {
        clearCaches()
        setDoc(s.doc)
        setSelectedParts([])
      }
      setBones(s.bones)
      setBindings(s.bindings)
      setExcluded(s.excluded)
      setWeights(s.weights)
      if (selectedBone() && !s.bones.some((b) => b.id === selectedBone())) {
        setSelectedBone(null)
      }
    })
  }

  /** Records the current state for undo, then applies `next`. */
  function commit(next: Partial<RigSpec>): void {
    const before = snapshot()
    batch(() => {
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), before])
      setFuture([])
      if (next.bones) {
        setBones(next.bones)
      }
      if (next.bindings) {
        setBindings(next.bindings)
      }
      if (next.excluded) {
        setExcluded(next.excluded)
      }
      setDirty(true)
    })
  }

  let dragStart: HistoryEntry | null = null
  /** A drag begins: live updates follow without filling the undo history. */
  function beginEdit(): void {
    dragStart = snapshot()
  }
  function liveBones(next: Bone[]): void {
    setBones(next)
  }
  function endEdit(): void {
    if (!dragStart) {
      return
    }
    const start = dragStart
    dragStart = null
    if (start.bones === bones()) {
      return
    }
    batch(() => {
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), start])
      setFuture([])
      setDirty(true)
    })
  }
  function cancelEdit(): void {
    if (dragStart) {
      setBones(dragStart.bones)
      dragStart = null
    }
  }

  function undo(): void {
    const p = past()
    if (!p.length) {
      return
    }
    const prev = p[p.length - 1]
    batch(() => {
      setFuture((f) => [snapshot(), ...f])
      setPast(p.slice(0, -1))
      restore(prev)
      setDirty(true)
    })
  }
  function redo(): void {
    const f = future()
    if (!f.length) {
      return
    }
    batch(() => {
      setPast((p) => [...p, snapshot()])
      setFuture(f.slice(1))
      restore(f[0])
      setDirty(true)
    })
  }

  /**
   * Switching steps sets up the view for it: the Parts step binds pieces by
   * clicking them, Skin shows the weights, Test poses the skinned rig.
   */
  function setPanel(next: Panel): void {
    batch(() => {
      setPanelSignal(next)
      setPendingHead(null)
      if (next === 'parts') {
        setTool('bind')
      } else if (tool() === 'bind') {
        setTool('select')
      }
      setView(next === 'skin' ? 'weights' : next === 'test' ? 'pose' : 'rig')
    })
  }

  // --- document ----------------------------------------------------------------------

  function loadDocument(d: RigDocument, restoreSpec?: RigSpec): void {
    clearCaches()
    batch(() => {
      setDoc(d)
      const s = restoreSpec ?? d.spec
      setBones(s.bones)
      setBindings(s.bindings)
      setExcluded(s.excluded)
      setPast([])
      setFuture([])
      setSkin(d.skin)
      setTemplateOptions({ ...DEFAULT_TEMPLATE_OPTIONS, ...d.template })
      setSelectedBone(null)
      setSelectedParts([])
      setPendingHead(null)
      setSplitObjects([])
      setView('rig')
      setTool('select')
      setPanelSignal('skeleton')
      setDirty(!!restoreSpec)
    })
    // Weights read from the file match the skeleton they were read with.
    setWeights(d.weights && !restoreSpec ? { ...d.weights, signature: signature() } : null)
  }

  function closeDocument(): void {
    batch(() => {
      setDoc(null)
      setBones([])
      setBindings({})
      setExcluded([])
      setWeights(null)
      setDirty(false)
    })
  }

  // --- skeleton edits ------------------------------------------------------------------

  function applyTemplate(id: TemplateId, opts = templateOptions()): number {
    const p = probe()
    if (!p) {
      return 0
    }
    setTemplateOptions(opts)
    const fitted = fitTemplate(id, { probe: p, cx: cx() }, opts)
    commit({ bones: fitted, bindings: {} })
    setSelectedBone(null)
    setPendingHead(null)
    return fitted.length
  }

  /** Bones that would be mirrored along with `ids` when symmetry is on. */
  function withMirrors(ids: Iterable<string>): Set<string> {
    const out = new Set(ids)
    if (!symmetry()) {
      return out
    }
    const list = bones()
    for (const id of [...out]) {
      const b = boneMap().get(id)
      const other = b ? mirrorName(b.name) : null
      const twin = other ? list.find((x) => x.name === other) : undefined
      if (twin) {
        out.add(twin.id)
      }
    }
    return out
  }

  /** Copies changed bones to their mirror twins when symmetry is on. */
  function mirrored(next: Bone[], changed: Set<string>): Bone[] {
    return symmetry() ? mirrorChanges(next, changed, cx()) : next
  }

  function eps(): number {
    return (probe()?.diagonal ?? 1) * 0.01
  }

  /**
   * Adds a bone from `head` to `tail`. With symmetry on, a bone off the
   * centre line gets a side name and a mirrored twin.
   */
  function addBone(
    head: Vec3,
    tail: Vec3,
    parent: string | null,
    connected: boolean,
    role: BoneRole = 'other'
  ): string {
    const list = bones()
    const parentBone = parent ? boneMap().get(parent) : undefined
    // Off the centre line (with symmetry on), or under a side bone: a side name.
    const side: Side | null =
      (symmetry() ? sideForX((head[0] + tail[0]) / 2, cx(), eps()) : null) ??
      (parentBone ? sideOf(parentBone.name) : null)
    const base = ROLE_NAMES[role]
    const name = uniqueName(list, side ? withSide(base, side) : base)
    const bone = makeBone({ name, head, tail, parent, connected, role })
    let next = [...list, bone]
    if (symmetry() && side) {
      // The twin hangs off the parent's twin, or the same centre parent.
      const twinParentName = parentBone ? mirrorName(parentBone.name) : null
      const twinParent = twinParentName ? next.find((b) => b.name === twinParentName) : parentBone
      next = [
        ...next,
        makeBone({
          name: uniqueName(next, mirrorName(name)!),
          head: mirrorX(head, cx()),
          tail: mirrorX(tail, cx()),
          parent: twinParent?.id ?? null,
          connected: connected && !!twinParent,
          role
        })
      ]
    }
    commit({ bones: next })
    setSelectedBone(bone.id)
    return bone.id
  }

  /** A chain of `points.length - 1` connected bones, parented to `parent`. */
  function addChain(points: Vec3[], parent: string | null): void {
    if (points.length < 2) {
      return
    }
    const parentBone = parent ? boneMap().get(parent) : undefined
    const connectFirst = !!parentBone && dist(parentBone.tail, points[0]) < eps()
    const start = connectFirst ? ([...parentBone!.tail] as Vec3) : points[0]
    const pts = [start, ...points.slice(1)]
    const side: Side | null = symmetry() ? sideForX(pts[pts.length - 1][0], cx(), eps()) : null
    let list = bones()
    const made: Bone[] = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const base = `chain_${String(i + 1).padStart(2, '0')}`
      const name = uniqueName([...list, ...made], side ? withSide(base, side) : base)
      made.push(
        makeBone({
          name,
          head: pts[i],
          tail: pts[i + 1],
          parent: i === 0 ? (parent ?? null) : made[i - 1].id,
          connected: i === 0 ? connectFirst : true,
          role: 'tail'
        })
      )
    }
    list = [...list, ...made]
    if (side && symmetry()) {
      // Twins for the whole chain (and refreshes every other side bone's twin).
      list = symmetrize(list, side, cx())
    }
    commit({ bones: list })
    setSelectedBone(made[made.length - 1].id)
  }

  function deleteSelected(): void {
    const id = selectedBone()
    if (!id) {
      return
    }
    const ids = withMirrors([id])
    const next = deleteBones(bones(), ids)
    const nextBindings = Object.fromEntries(
      Object.entries(bindings()).filter(([, b]) => !ids.has(b))
    )
    commit({ bones: next, bindings: nextBindings })
    setSelectedBone(null)
  }

  /** Deletes a bone and everything under it. */
  function deleteBranch(id: string): void {
    const ids = new Set<string>()
    for (const m of withMirrors([id])) {
      for (const x of subtreeIds(bones(), m)) {
        ids.add(x)
      }
    }
    commit({
      bones: deleteBones(bones(), ids),
      bindings: Object.fromEntries(Object.entries(bindings()).filter(([, b]) => !ids.has(b)))
    })
    setSelectedBone(null)
  }

  function clearSkeleton(): void {
    commit({ bones: [], bindings: {} })
    setSelectedBone(null)
  }

  /** Changes bone fields; the twin gets the same change (names and positions excepted). */
  function updateBone(id: string, patch: Partial<Bone>): void {
    const b = boneMap().get(id)
    if (!b) {
      return
    }
    let next = bones().map((x) => (x.id === id ? { ...x, ...patch } : x))
    if (symmetry()) {
      const twinName = mirrorName(b.name)
      const twin = twinName ? next.find((x) => x.name === twinName) : undefined
      if (twin) {
        const shared: Partial<Bone> = Object.fromEntries(
          (['deform', 'role', 'ik', 'connected'] as const)
            .filter((k) => k in patch)
            .map((k) => [k, patch[k]])
        )
        if ('rollOffset' in patch) {
          shared.rollOffset = -(patch.rollOffset ?? 0)
        }
        next = next.map((x) => (x.id === twin.id ? { ...x, ...shared } : x))
      }
    }
    commit({ bones: next })
  }

  function renameBone(id: string, name: string): void {
    const clean = uniqueName(bones(), name, id)
    commit({ bones: bones().map((b) => (b.id === id ? { ...b, name: clean } : b)) })
  }

  function reparent(id: string, parent: string | null, connected: boolean): void {
    let next = setParent(bones(), id, parent, connected)
    if (symmetry()) {
      const b = boneMap().get(id)
      const twinName = b ? mirrorName(b.name) : null
      const twin = twinName ? next.find((x) => x.name === twinName) : undefined
      const p = parent ? boneMap().get(parent) : undefined
      const pTwinName = p ? mirrorName(p.name) : null
      const pTwin = pTwinName ? next.find((x) => x.name === pTwinName) : p
      if (twin) {
        next = setParent(next, twin.id, pTwin?.id ?? null, connected)
      }
    }
    commit({ bones: next })
  }

  function symmetrizeFrom(side: Side): void {
    commit({ bones: symmetrize(bones(), side, cx()) })
  }

  function runAutoIk(): number {
    const p = probe()
    if (!p) {
      return 0
    }
    const r = autoIk(bones(), p.bounds.min[2], p.height)
    if (r.added) {
      commit({ bones: r.bones })
    }
    return r.added
  }

  /**
   * Connects or disconnects a bone from its parent (Blender's Ctrl+P / Alt+P).
   * Disconnected, it keeps the parent but its head moves freely (the dotted
   * line); connecting snaps the head onto the parent's tail.
   */
  function toggleConnected(id: string): 'connected' | 'disconnected' | null {
    const b = boneMap().get(id)
    if (!b?.parent) {
      return null
    }
    reparent(id, b.parent, !b.connected)
    return b.connected ? 'disconnected' : 'connected'
  }

  function toggleIk(id: string): void {
    const b = boneMap().get(id)
    if (!b) {
      return
    }
    updateBone(id, { ik: b.ik ? null : defaultIk(b.role) })
  }

  /** Moves a bone's joints into the middle of the mesh around them. */
  function centerSelected(): void {
    const p = probe()
    const id = selectedBone()
    if (!p || !id) {
      return
    }
    const b = boneMap().get(id)!
    const dir: Vec3 = [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]]
    const tail = p.centerInVolume(b.tail, dir)
    const head = b.connected ? b.head : p.centerInVolume(b.head, dir)
    let next = bones().map((x) => {
      if (x.id === id) {
        return { ...x, head, tail }
      }
      if (x.parent === id && x.connected) {
        return { ...x, head: tail }
      }
      return x
    })
    const changed = new Set([
      id,
      ...next.filter((x) => x.parent === id && x.connected).map((x) => x.id)
    ])
    next = mirrored(next, changed)
    commit({ bones: next })
  }

  // --- parts -------------------------------------------------------------------------

  /**
   * Attaches a piece to a bone (null: back to skinned). A bone that carries a
   * piece has to deform, or the piece would get no weights at all; a helper
   * bone is switched to deforming.
   */
  function bindPart(key: PartKey, bone: string | null): void {
    const next = { ...bindings() }
    if (bone) {
      next[key] = bone
    } else {
      delete next[key]
    }
    const target = bone ? boneMap().get(bone) : undefined
    commit({
      bindings: next,
      ...(target && !target.deform
        ? { bones: bones().map((b) => (b.id === bone ? { ...b, deform: true } : b)) }
        : {})
    })
  }

  function setPartExcluded(name: string, out: boolean): void {
    const list = excluded().filter((n) => n !== name)
    commit({ excluded: out ? [...list, name] : list })
  }

  function toggleSplit(name: string): void {
    setSplitObjects((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]))
  }

  /** The pieces bound to a bone (part keys). */
  function attachedTo(boneId: string): PartKey[] {
    return Object.entries(bindings())
      .filter(([, b]) => b === boneId)
      .map(([k]) => k)
  }

  /** Releases every piece bound to a bone (they go back to being skinned). */
  function detachAll(boneId: string): void {
    commit({
      bindings: Object.fromEntries(Object.entries(bindings()).filter(([, b]) => b !== boneId))
    })
  }

  /** Click selects one piece; with `add` (Shift/Ctrl) it toggles the piece in the selection. */
  function selectPart(key: PartKey | null, add = false): void {
    if (!key) {
      if (!add) {
        setSelectedParts([])
      }
      return
    }
    setSelectedParts((list) =>
      add ? (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]) : [key]
    )
  }

  /** The objects the selected pieces belong to, in the rig. */
  function selectedObjects(): string[] {
    const names = new Set(selectedParts().map((k) => parseKey(k).object))
    return parts()
      .filter((p) => names.has(p.name) && !excluded().includes(p.name))
      .map((p) => p.name)
  }

  /**
   * Joins the selected objects into one (the biggest keeps its name), in a
   * working copy of the .blend; the file is only written when you save.
   * `weld` also merges vertices that touch, so the joined pieces skin as one
   * surface. Undoable. Bindings of the joined objects carry over when they
   * all followed the same bone; weights need computing again.
   */
  async function joinSelected(
    weld: boolean
  ): Promise<{ ok: boolean; error?: string; target?: string; count?: number; welded?: number }> {
    const d = doc()
    const names = selectedObjects()
    if (!d || names.length === 0 || (names.length < 2 && !weld)) {
      return { ok: false, error: 'pickTwo' }
    }
    const joined = parts().filter((p) => names.includes(p.name))
    const target = joined.reduce((a, b) => (b.positions.length > a.positions.length ? b : a))
    const weldDistance = weld ? (probe()?.diagonal ?? 1) * 0.0005 : 0
    setJoining(true)
    try {
      const res = await window.api.joinObjects(
        d.sourcePath,
        JSON.stringify({ objects: names, target: target.name, weld: weldDistance })
      )
      if (!res.ok || !res.path) {
        return { ok: false, error: res.error ?? 'join failed' }
      }
      const next = await openRigDocument(res.path, d.blendPath)
      const before = snapshot()
      const gone = new Set(names)
      const objectBones = new Set(names.map((n) => bindings()[n]))
      const kept = Object.fromEntries(
        Object.entries(bindings()).filter(([k]) => !gone.has(parseKey(k).object))
      )
      const shared = objectBones.size === 1 ? [...objectBones][0] : undefined
      if (shared) {
        kept[target.name] = shared
      }
      const w = weights()
      batch(() => {
        setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), before])
        setFuture([])
        clearCaches()
        setDoc({ ...next, armatureName: d.armatureName, fromMeshRig: d.fromMeshRig })
        setBindings(kept)
        setExcluded(excluded().filter((n) => !gone.has(n)))
        setSplitObjects((list) => list.filter((n) => !gone.has(n)))
        // Untouched objects keep their weights; the joined one has none yet.
        setWeights(
          w
            ? {
                ...w,
                objects: new Map([...w.objects].filter(([n]) => !gone.has(n))),
                signature: 'joined'
              }
            : null
        )
        setSelectedParts([objectKey(target.name)])
        setDirty(true)
      })
      return { ok: true, target: target.name, count: names.length, welded: res.welded ?? 0 }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      setJoining(false)
    }
  }

  /** One bone per piece (objects, or loose pieces of split objects), added to the skeleton. */
  function bonesPerPart(useIslands: boolean): number {
    const p = probe()
    if (!p) {
      return 0
    }
    const pieces = includedParts().flatMap((part) =>
      piecesOf(part, useIslands ? islandsOf(part) : null)
    )
    const before = bones().length
    const r = bonesFromPieces(pieces, bones(), p.diagonal)
    commit({ bones: r.bones, bindings: { ...bindings(), ...r.bindings } })
    if (useIslands) {
      setSplitObjects(
        includedParts()
          .filter((x) => islandsOf(x).count > 1)
          .map((x) => x.name)
      )
    }
    return r.bones.length - before
  }

  // --- weight painting --------------------------------------------------------------------

  function neighboursOf(part: MeshPart): { start: Int32Array; list: Int32Array } {
    let n = neighbourCache.get(part.name)
    if (!n) {
      const a = adjacency({
        positions: part.positions,
        triangles: part.triangles,
        islands: new Int32Array(0),
        bound: null,
        prior: null
      })
      // The adjacency lists welded vertices once; give every duplicate its
      // representative's neighbours so seams smooth like the rest.
      const V = a.rep.length
      const start = new Int32Array(V + 1)
      for (let v = 0; v < V; v++) {
        start[v + 1] = start[v] + (a.start[a.rep[v] + 1] - a.start[a.rep[v]])
      }
      const list = new Int32Array(start[V])
      for (let v = 0; v < V; v++) {
        list.set(a.list.subarray(a.start[a.rep[v]], a.start[a.rep[v] + 1]), start[v])
      }
      n = { start, list }
      neighbourCache.set(part.name, n)
    }
    return n
  }

  let paintStart: HistoryEntry | null = null
  /** Starts a brush stroke; false when there is nothing to paint (no fresh weights, no bone). */
  function beginPaint(): boolean {
    const w = weights()
    const sel = selectedBone()
    if (!w || weightsStale() || !sel || !w.boneIds.includes(sel)) {
      return false
    }
    paintStart = snapshot()
    // The stroke edits copies, so undo can bring the old arrays back.
    const objects = new Map(
      [...w.objects].map(([k, o]) => [k, { index: o.index.slice(), weight: o.weight.slice() }])
    )
    setWeights({ ...w, objects })
    return true
  }

  /** One dab at `p` (Blender space) on the selected bone, and its twin across the mirror. */
  function paintAt(p: Vec3): void {
    const w = weights()
    const sel = selectedBone()
    const pr = probe()
    if (!paintStart || !w || !sel || !pr) {
      return
    }
    const settings = paint()
    const dab = (center: Vec3, boneId: string): void => {
      const bone = w.boneIds.indexOf(boneId)
      if (bone < 0) {
        return
      }
      const b = boneMap().get(boneId)
      const parentIdx = b?.parent ? w.boneIds.indexOf(b.parent) : -1
      const fallback =
        parentIdx >= 0 ? parentIdx : bone === 0 ? Math.min(1, w.boneIds.length - 1) : 0
      for (const part of includedParts()) {
        const o = w.objects.get(part.name)
        if (!o) {
          continue
        }
        applyDab(
          part.positions,
          o.index,
          o.weight,
          {
            center,
            radius: settings.radius * pr.diagonal,
            strength: settings.strength,
            mode: settings.mode,
            bone,
            fallback
          },
          settings.mode === 'smooth' ? neighboursOf(part) : undefined
        )
      }
    }
    dab(p, sel)
    const b = boneMap().get(sel)
    const twinName = symmetry() && b ? mirrorName(b.name) : null
    const twin = twinName ? bones().find((x) => x.name === twinName) : undefined
    if (twin) {
      dab(mirrorX(p, cx()), twin.id)
    }
    setWeightsRevision((r) => r + 1)
  }

  function endPaint(): void {
    if (!paintStart) {
      return
    }
    const start = paintStart
    paintStart = null
    batch(() => {
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), start])
      setFuture([])
      setDirty(true)
    })
  }

  // --- skinning ------------------------------------------------------------------------

  let skinRun = 0
  async function computeSkin(): Promise<{ ok: boolean; error?: string; heatFailed?: boolean }> {
    const d = doc()
    const list = includedParts()
    const deform = bones().filter((b) => b.deform)
    if (!d || !deform.length || !list.length) {
      return { ok: false, error: 'noBones' }
    }
    const run = ++skinRun
    const settings = skin()
    const sig = signature()
    const boneIds = deform.map((b) => b.id)
    const boneIndex = new Map(boneIds.map((id, i) => [id, i]))
    let heatFailed = false
    setSkinning({ progress: 0, stage: 'start' })
    try {
      let priors: SkinObject['prior'][] = list.map(() => null)
      if (settings.method === 'heat') {
        setSkinning({ progress: 0.05, stage: 'heat' })
        const res = await window.api.heatWeights(
          d.sourcePath,
          JSON.stringify(buildHeatPayload(bones(), list))
        )
        if (!res.ok || !res.dir) {
          throw new Error(res.error ?? 'Blender bone heat failed')
        }
        heatFailed = !!res.failed
        const heat = await readHeatWeights(res.dir, list)
        const nameToIdx = new Map(deform.map((b, i) => [b.name, i]))
        priors = heat.objects.map((o) => {
          if (!o) {
            return null
          }
          const index = o.index.slice()
          for (let i = 0; i < index.length; i++) {
            if (index[i] !== 65535) {
              const name = heat.names[index[i]]
              index[i] = nameToIdx.get(name) ?? 65535
            }
          }
          return { index, weight: o.weight }
        })
      }
      if (run !== skinRun) {
        return { ok: false, error: 'cancelled' }
      }
      const objects: SkinObject[] = list.map((part, i) => {
        const isl = islandsOf(part)
        return {
          positions: part.positions,
          triangles: part.triangles,
          islands: isl.of,
          bound: boundBonePerVertex(part, isl, bindings(), boneIndex),
          prior: priors[i]
        }
      })
      const result = await computeInWorker(
        objects,
        deform.map((b) => ({ head: b.head, tail: b.tail })),
        { ...settings, rigidSmall: settings.rigidSmall ? SMALL_PIECE : 0 },
        (progress, stage) => {
          if (run === skinRun) {
            setSkinning({
              progress: settings.method === 'heat' ? 0.5 + progress / 2 : progress,
              stage
            })
          }
        }
      )
      if (run !== skinRun) {
        return { ok: false, error: 'cancelled' }
      }
      // An undo step of its own, so Ctrl+Z brings the previous weights back.
      const before = snapshot()
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), before])
      setFuture([])
      setWeights({
        boneIds,
        objects: new Map(list.map((p, i) => [p.name, result.objects[i]])),
        signature: sig,
        source: settings.method,
        unweighted: result.unweighted
      })
      setDirty(true)
      return { ok: true, heatFailed }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      if (run === skinRun) {
        setSkinning(null)
      }
    }
  }

  return {
    // document
    doc,
    parts,
    includedParts,
    probe,
    cx,
    loadDocument,
    closeDocument,
    setDoc,
    dirty,
    setDirty,
    // skeleton
    bones,
    boneMap,
    bindings,
    excluded,
    spec,
    commit,
    beginEdit,
    liveBones,
    endEdit,
    cancelEdit,
    undo,
    redo,
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    applyTemplate,
    addBone,
    addChain,
    deleteSelected,
    deleteBranch,
    clearSkeleton,
    updateBone,
    renameBone,
    reparent,
    symmetrizeFrom,
    runAutoIk,
    toggleIk,
    toggleConnected,
    centerSelected,
    withMirrors,
    mirrored,
    // parts
    bindPart,
    setPartExcluded,
    toggleSplit,
    splitObjects,
    islandsOf,
    bonesPerPart,
    // ui state
    selectedBone,
    setSelectedBone,
    selectedParts,
    setSelectedParts,
    selectPart,
    selectedObjects,
    joinSelected,
    joining,
    hoverPart,
    setHoverPart,
    tool,
    setTool,
    view,
    setView,
    panel,
    setPanel,
    showNames,
    setShowNames,
    symmetry,
    setSymmetry,
    snapInside,
    setSnapInside,
    showAttached,
    setShowAttached,
    attachedTo,
    detachAll,
    snap,
    setSnap,
    gridStep,
    ortho,
    setOrtho,
    autoOrtho,
    setAutoOrtho,
    meshOpacity,
    setMeshOpacity,
    chainCount,
    setChainCount,
    pendingHead,
    setPendingHead,
    templateOptions,
    setTemplateOptions,
    focusRequest,
    focus: (bone: string | null) => setFocusRequest((r) => ({ bone, n: (r?.n ?? 0) + 1 })),
    // skin
    skin,
    setSkin,
    weights,
    setWeights,
    weightsStale,
    skinning,
    computeSkin,
    weightsRevision,
    paint,
    setPaint,
    beginPaint,
    paintAt,
    endPaint,
    signature
  }
}

export type RigStore = ReturnType<typeof createRigStore>

export const rig: RigStore = createRoot(createRigStore)
