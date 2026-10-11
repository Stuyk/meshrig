import * as THREE from 'three'
import { createScene, type LightingMode, type SceneHandle } from './scene'
import { createNavCube, type NavCubeHandle } from './navCube'
import type { RigStore } from '../rig/store'
import type { Bone, MeshPart, PartKey, Vec3 } from '../rig/types'
import { buildControls } from '../rig/controls'
import { boundBonePerVertex, islandKey, objectKey } from '../rig/parts'
import { mirrorName, moveJoint, translateBone, type JointEnd } from '../rig/skeleton'
import { add, sub } from '../rig/vec'
import { t } from '../i18n'
import { boneColor } from '../rig/colors'
import { dominantAxis, isAxisView, snapAngle, snapToGrid } from './snapping'
import {
  aimAt,
  applyStress,
  boneEnds,
  buildPoseRig,
  disposePoseRig,
  moveRoot,
  resetPose,
  solveIk,
  stressMoves,
  MOVE_SECONDS,
  type PoseRig
} from './posing'

/**
 * The 3D view. Meshes are drawn by three.js inside a group that turns
 * Blender's Z-up space into three's Y-up, so everything else (bones, picking,
 * the probe) stays in Blender coordinates. The skeleton is drawn on a 2D
 * canvas over the scene, always on top and picked in screen space, the way
 * Blender draws bones in front.
 */

interface Display {
  part: MeshPart
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  /** Blender vertex index of each triangle corner. */
  cornerVertex: Uint32Array
  /** Original triangle index of each display triangle (they're sorted by material). */
  triOrder: Uint32Array
  materials: THREE.MeshStandardMaterial[]
  colorMaterial: THREE.MeshLambertMaterial
}

type Hit = { boneId: string; end: JointEnd } | null

type Drag =
  | {
      kind: 'joint'
      boneId: string
      end: JointEnd
      normal: Vec3
      anchor: Vec3
      lockX: number | null
      moved: boolean
      /** The bone's other end, which angle snapping turns about. */
      pivot: Vec3
      /** Bones whose joints move with this one (never snapped to). */
      exclude: Set<string>
    }
  | {
      kind: 'bone'
      boneId: string
      normal: Vec3
      startHit: Vec3
      startHead: Vec3
      moved: boolean
    }
  | { kind: 'stroke'; points: { x: number; y: number }[] }
  | { kind: 'poseAim'; boneId: string; normal: Vec3; anchor: Vec3 }
  | { kind: 'poseIk'; ownerId: string; normal: Vec3; anchor: Vec3 }
  | { kind: 'poseRoot'; boneId: string; normal: Vec3; anchor: Vec3 }
  | { kind: 'paint' }

const JOINT_RADIUS = 5
const PICK_RADIUS = 10
const COLORS = {
  bone: 'rgba(214,216,224,0.55)',
  boneLine: 'rgba(20,20,24,0.9)',
  boneSelected: 'rgba(0,132,255,0.75)',
  boneTwin: 'rgba(110,180,255,0.45)',
  boneHover: 'rgba(255,255,255,0.75)',
  boneIk: 'rgba(255,169,64,0.6)',
  boneControl: 'rgba(255,169,64,0.25)',
  joint: '#e8e8ea',
  jointSelected: '#0084ff',
  ikTarget: '#ffa940',
  pole: '#b37feb',
  relation: 'rgba(232,232,234,0.6)',
  relationSelected: 'rgba(80,170,255,0.95)',
  pending: '#22d3ee',
  stroke: '#22d3ee',
  label: '#e8e8ea'
}

export { boneColor } from '../rig/colors'

/** Blender-like weight ramp: blue (0) through green and yellow to red (1). */
function ramp(w: number, out: THREE.Color): THREE.Color {
  const stops: [number, number, number][] = [
    [0.05, 0.05, 0.45],
    [0.0, 0.5, 1.0],
    [0.0, 0.85, 0.3],
    [1.0, 0.9, 0.0],
    [1.0, 0.15, 0.05]
  ]
  const x = Math.min(1, Math.max(0, w)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
}

/** How much bone `bone` (an index into the weights' bone list) moves vertex `v`. */
function boneWeight(
  w: { index: Uint16Array; weight: Float32Array },
  v: number,
  bone: number
): number {
  let x = 0
  for (let k = 0; k < 4; k++) {
    x += w.index[v * 4 + k] === bone ? w.weight[v * 4 + k] : 0
  }
  return x
}

/** Every bone's colour, mixed by its weight on vertex `v`. */
function blendBones(
  w: { index: Uint16Array; weight: Float32Array },
  v: number,
  palette: THREE.Color[],
  out: THREE.Color
): THREE.Color {
  out.setRGB(0, 0, 0)
  for (let k = 0; k < 4; k++) {
    const bi = w.index[v * 4 + k]
    const p = bi === 65535 ? null : palette[bi]
    const x = w.weight[v * 4 + k]
    out.r += p ? p.r * x : 0
    out.g += p ? p.g * x : 0
    out.b += p ? p.b * x : 0
  }
  if (out.r + out.g + out.b === 0) {
    out.setRGB(0.2, 0.2, 0.22)
  }
  return out
}

export class RigEngine {
  readonly sceneHandle: SceneHandle
  /** Blender space: Z up. */
  readonly root = new THREE.Group()
  private displays = new Map<string, Display>()
  private overlayCtx: CanvasRenderingContext2D
  private navCube: NavCubeHandle | null
  private raf = 0
  private disposed = false
  private drag: Drag | null = null
  private hover: Hit = null
  private hoverBone: string | null = null
  /** Where the weight brush is over the mesh, in Blender space. */
  private brush: Vec3 | null = null
  /** A number per weights object, so swapping weights (undo) refreshes what's drawn. */
  private objectIds = new WeakMap<object, number>()
  private nextObjectId = 1
  private pointer = { x: 0, y: 0, inside: false }
  private textureLoader = new THREE.TextureLoader()
  private textures = new Map<string, THREE.Texture>()
  private raycaster = new THREE.Raycaster()
  private colorKey = ''
  private visibilityKey = ''
  private pose: PoseRig | null = null
  private poseKey = ''
  private stress: { moves: ReturnType<typeof stressMoves>; start: number } | null = null
  /** Screen positions from the last overlay draw, for picking what's drawn. */
  private screen = new Map<
    string,
    { h: THREE.Vector2; t: THREE.Vector2; hv: boolean; tv: boolean }
  >()
  showNames = false
  /** Shift is down: the Add tool previews a disconnected start. */
  private shiftHeld = false
  /** What the last placement snapped to, drawn as feedback. */
  private lastSnap: {
    kind: 'joint' | 'grid' | 'angle'
    at: Vec3
    pivot?: Vec3
    degrees?: number
  } | null = null
  /** The flat view was switched on by a front/side/top view, so orbiting switches it off. */
  private orthoFromView = false
  /** Grid drawn in the view plane of flat front/side/top views. */
  private viewGrid = new THREE.Group()
  private viewGridKey = ''

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    navCanvas: HTMLCanvasElement | null,
    private s: RigStore,
    private onContextLost: () => void
  ) {
    this.sceneHandle = createScene(canvas)
    this.overlayCtx = overlay.getContext('2d')!
    this.navCube = navCanvas ? createNavCube(navCanvas, 96) : null
    this.root.rotation.x = -Math.PI / 2
    this.root.name = 'blender-space'
    this.sceneHandle.scene.add(this.root)
    this.root.updateMatrixWorld(true)
    this.viewGrid.name = 'view-grid'
    this.viewGrid.renderOrder = -2
    this.sceneHandle.scene.add(this.viewGrid)
    // Orbiting by hand leaves a flat view that a front/side/top view switched on.
    this.sceneHandle.controls.onUserOrbit = () => {
      if (this.orthoFromView && this.s.ortho()) {
        this.s.setOrtho(false)
      }
      this.orthoFromView = false
    }

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onHover = this.onHover.bind(this)
    this.onLeave = this.onLeave.bind(this)
    this.onLost = this.onLost.bind(this)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onHover)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('webglcontextlost', this.onLost)
    this.onShift = this.onShift.bind(this)
    window.addEventListener('keydown', this.onShift)
    window.addEventListener('keyup', this.onShift)

    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onHover)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    window.removeEventListener('keydown', this.onShift)
    window.removeEventListener('keyup', this.onShift)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.clearDisplays()
    this.navCube?.dispose()
    this.sceneHandle.dispose()
  }

  private onShift(e: KeyboardEvent): void {
    this.shiftHeld = e.shiftKey
  }

  private onLost(e: Event): void {
    e.preventDefault()
    this.onContextLost()
  }

  // --- meshes ------------------------------------------------------------------------------

  private clearDisplays(): void {
    this.exitPose()
    for (const d of this.displays.values()) {
      this.root.remove(d.mesh)
      d.geometry.dispose()
      d.materials.forEach((m) => m.dispose())
      d.colorMaterial.dispose()
    }
    this.displays.clear()
    for (const t of this.textures.values()) {
      t.dispose()
    }
    this.textures.clear()
  }

  /** Builds display meshes; `reframe` points the camera at them (a new file, not a join). */
  setParts(parts: MeshPart[], reframe = true): void {
    this.clearDisplays()
    for (const part of parts) {
      const d = this.buildDisplay(part)
      this.displays.set(part.name, d)
      this.root.add(d.mesh)
    }
    this.colorKey = ''
    this.visibilityKey = ''
    if (reframe) {
      this.frame()
    }
  }

  private texture(path: string): THREE.Texture {
    let t = this.textures.get(path)
    if (!t) {
      t = this.textureLoader.load(window.api.assetUrl(path))
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      this.textures.set(path, t)
    }
    return t
  }

  private buildDisplay(part: MeshPart): Display {
    const T = part.triangles.length / 3
    const P = part.positions
    // Sorted by material so each material is one draw group.
    const triOrder = new Uint32Array(T)
    for (let i = 0; i < T; i++) {
      triOrder[i] = i
    }
    triOrder.sort((a, b) => part.triMat[a] - part.triMat[b])
    const n = T * 3
    const pos = new Float32Array(n * 3)
    const nor = new Float32Array(n * 3)
    const uv = part.uvs ? new Float32Array(n * 2) : null
    const cornerVertex = new Uint32Array(n)

    let vertexNormals: Float32Array | null = null
    if (!part.normals) {
      vertexNormals = new Float32Array(P.length)
      const tr = part.triangles
      for (let t = 0; t < T; t++) {
        const a = tr[t * 3] * 3
        const b = tr[t * 3 + 1] * 3
        const c = tr[t * 3 + 2] * 3
        const e1x = P[b] - P[a],
          e1y = P[b + 1] - P[a + 1],
          e1z = P[b + 2] - P[a + 2]
        const e2x = P[c] - P[a],
          e2y = P[c + 1] - P[a + 1],
          e2z = P[c + 2] - P[a + 2]
        const nx = e1y * e2z - e1z * e2y
        const ny = e1z * e2x - e1x * e2z
        const nz = e1x * e2y - e1y * e2x
        for (const v of [a, b, c]) {
          vertexNormals[v] += nx
          vertexNormals[v + 1] += ny
          vertexNormals[v + 2] += nz
        }
      }
    }

    for (let k = 0; k < T; k++) {
      const t = triOrder[k]
      for (let c = 0; c < 3; c++) {
        const corner = k * 3 + c
        const src = t * 3 + c
        const v = part.triangles[src]
        cornerVertex[corner] = v
        pos[corner * 3] = P[v * 3]
        pos[corner * 3 + 1] = P[v * 3 + 1]
        pos[corner * 3 + 2] = P[v * 3 + 2]
        if (part.normals) {
          nor[corner * 3] = part.normals[src * 3]
          nor[corner * 3 + 1] = part.normals[src * 3 + 1]
          nor[corner * 3 + 2] = part.normals[src * 3 + 2]
        } else if (vertexNormals) {
          const x = vertexNormals[v * 3],
            y = vertexNormals[v * 3 + 1],
            z = vertexNormals[v * 3 + 2]
          const l = Math.hypot(x, y, z) || 1
          nor[corner * 3] = x / l
          nor[corner * 3 + 1] = y / l
          nor[corner * 3 + 2] = z / l
        }
        if (uv && part.uvs) {
          uv[corner * 2] = part.uvs[src * 2]
          uv[corner * 2 + 1] = part.uvs[src * 2 + 1]
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    if (uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
    let start = 0
    for (let k = 1; k <= T; k++) {
      if (k === T || part.triMat[triOrder[k]] !== part.triMat[triOrder[start]]) {
        const slot = Math.min(part.triMat[triOrder[start]], Math.max(0, part.materials.length - 1))
        g.addGroup(start * 3, (k - start) * 3, slot)
        start = k
      }
    }
    g.computeBoundingSphere()

    const materials = part.materials.map((m) => {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]),
        roughness: 0.75,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: true
      })
      if (m.texture && uv) {
        mat.map = this.texture(m.texture)
      }
      return mat
    })
    const colorMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(g, materials)
    mesh.name = part.name
    return { part, mesh, geometry: g, cornerVertex, triOrder, materials, colorMaterial }
  }

  /** Mesh look for the current view: x-ray in rig mode, solid otherwise, colours for weights/parts. */
  private syncMeshes(): void {
    const view = this.s.view()
    const excluded = this.s.excluded()
    const opacity = view === 'rig' ? this.s.meshOpacity() : 1
    const key = `${view}|${opacity}|${excluded.join('|')}|${this.pose ? 'p' : ''}|${this.colorMode()}`
    if (key !== this.visibilityKey) {
      this.visibilityKey = key
      for (const d of this.displays.values()) {
        const out = excluded.includes(d.part.name)
        for (const m of d.materials) {
          m.opacity = out ? Math.min(opacity, 0.12) : opacity
          m.transparent = m.opacity < 0.999
          m.depthWrite = m.opacity > 0.3
          m.needsUpdate = true
        }
        // Coloured views (pieces, weights) need the colours readable: mostly opaque.
        const colorOpacity = out ? 0.12 : Math.max(opacity, 0.88)
        d.colorMaterial.transparent = colorOpacity < 0.999
        d.colorMaterial.opacity = colorOpacity
        // In pose mode the skinned copies are shown instead.
        d.mesh.visible = !(this.pose && this.pose.meshes.some((sm) => sm.name === d.part.name))
      }
    }
    this.syncColors()
  }

  private colorMode(): 'none' | 'weights' | 'parts' {
    const view = this.s.view()
    if (view === 'weights') {
      return this.s.weights() ? 'weights' : 'parts'
    }
    if (
      view === 'rig' &&
      (this.s.tool() === 'bind' ||
        this.s.showAttached() ||
        this.s.hoverPart() ||
        this.s.selectedParts().length > 0)
    ) {
      return 'parts'
    }
    return 'none'
  }

  private syncColors(): void {
    const mode = this.colorMode()
    const w = this.s.weights()
    const sel = this.s.selectedBone()
    const key = [
      mode,
      sel,
      w?.signature,
      this.idOf(w),
      this.s.weightsRevision(),
      w ? w.boneIds.length : 0,
      w?.source,
      mode === 'parts' ? JSON.stringify(this.s.bindings()) : '',
      this.s.hoverPart(),
      this.s.selectedParts().join(','),
      this.focusBone(),
      this.s.splitObjects().join('|'),
      this.s.bones().length,
      this.pose ? 'p' : ''
    ].join('#')
    if (key === this.colorKey) {
      return
    }
    this.colorKey = key
    for (const d of this.displays.values()) {
      const target: THREE.Material | THREE.Material[] =
        mode === 'none' ? d.materials : d.colorMaterial
      d.mesh.material = target
      const skinned = this.skinnedFor(d.part.name)
      if (skinned) {
        skinned.material = target
      }
      if (mode === 'none') {
        continue
      }
      const attr = d.geometry.getAttribute('color') as THREE.BufferAttribute
      const col = attr.array as Float32Array
      const perVertex =
        mode === 'weights' ? this.weightColors(d.part, sel) : this.partColors(d.part)
      for (let c = 0; c < d.cornerVertex.length; c++) {
        const v = d.cornerVertex[c]
        col[c * 3] = perVertex[v * 3]
        col[c * 3 + 1] = perVertex[v * 3 + 1]
        col[c * 3 + 2] = perVertex[v * 3 + 2]
      }
      attr.needsUpdate = true
      if (skinned) {
        const a = skinned.geometry.getAttribute('color') as THREE.BufferAttribute
        ;(a.array as Float32Array).set(col)
        a.needsUpdate = true
      }
    }
  }

  /** The pose-mode copy of a part's mesh, if pose mode is on. */
  private skinnedFor(name: string): THREE.SkinnedMesh | undefined {
    return this.pose?.meshes.find((m) => m.name === name)
  }

  /** Per-vertex colours: the selected bone's weight as a heat ramp, or every bone's colour blended. */
  private weightColors(part: MeshPart, selected: string | null): Float32Array {
    const V = part.positions.length / 3
    const out = new Float32Array(V * 3)
    const w = this.s.weights()?.objects.get(part.name)
    const ids = this.s.weights()?.boneIds ?? []
    const c = new THREE.Color()
    const sel = selected ? ids.indexOf(selected) : -1
    const palette = ids.map((id) => boneColor(id))
    for (let v = 0; v < V; v++) {
      if (!w) {
        out.set([0.25, 0.25, 0.28], v * 3)
        continue
      }
      if (selected) {
        ramp(boneWeight(w, v, sel), c)
      } else {
        blendBones(w, v, palette, c)
      }
      out[v * 3] = c.r
      out[v * 3 + 1] = c.g
      out[v * 3 + 2] = c.b
    }
    return out
  }

  /** Per-vertex colours: bound pieces in their bone's colour, the hovered/selected piece lit up. */
  /** The bone whose pieces are shown up: the one under the cursor, else the selected one. */
  private focusBone(): string | null {
    return this.hoverBone ?? this.s.selectedBone()
  }

  private partColors(part: MeshPart): Float32Array {
    const V = part.positions.length / 3
    const out = new Float32Array(V * 3)
    const split = this.s.splitObjects().includes(part.name)
    const islands = split ? this.s.islandsOf(part) : null
    const boneIds = this.s.bones().map((b) => b.id)
    const index = new Map(boneIds.map((id, i) => [id, i]))
    const bound = boundBonePerVertex(
      part,
      islands ?? this.s.islandsOf(part),
      this.s.bindings(),
      index
    )
    const hover = this.s.hoverPart()
    const selected = new Set(this.s.selectedParts())
    const focus = this.focusBone()
    const c = new THREE.Color()
    const grey = new THREE.Color(0.55, 0.56, 0.6)
    const keyOf = (v: number): PartKey =>
      islands ? islandKey(part.name, islands.of[v]) : objectKey(part.name)
    for (let v = 0; v < V; v++) {
      const b = bound ? bound[v] : -1
      if (b >= 0) {
        boneColor(boneIds[b], c)
        // A focused bone's pieces stand out; the rest go dark grey (colours are
        // linear, so it takes a strong factor to look clearly darker).
        if (focus && boneIds[b] === focus) {
          c.offsetHSL(0, 0.2, 0.05)
        } else if (focus) {
          c.lerp(grey, 0.8).multiplyScalar(0.15)
        }
      } else {
        c.copy(grey)
        if (focus) {
          c.multiplyScalar(0.15)
        }
      }
      const key = keyOf(v)
      if (selected.has(key)) {
        c.lerp(new THREE.Color(0x0084ff), 0.55)
      } else if (key === hover) {
        c.offsetHSL(0, 0, 0.18)
      }
      out[v * 3] = c.r
      out[v * 3 + 1] = c.g
      out[v * 3 + 2] = c.b
    }
    return out
  }

  // --- camera --------------------------------------------------------------------------------

  frame(): void {
    const p = this.s.probe()
    const box = new THREE.Box3()
    if (p) {
      box.set(new THREE.Vector3(...p.bounds.min), new THREE.Vector3(...p.bounds.max))
    } else {
      for (const d of this.displays.values()) {
        d.geometry.computeBoundingBox()
        box.union(d.geometry.boundingBox!)
      }
    }
    if (box.isEmpty()) {
      return
    }
    box.applyMatrix4(this.root.matrixWorld)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    this.sceneHandle.controls.focus(sphere.center, sphere.radius)
    this.sceneHandle.fitShadows(sphere.center, sphere.radius, box.min.y)
  }

  frameBone(id: string): void {
    const b = this.s.boneMap().get(id)
    if (!b) {
      return
    }
    const toWorld = (p: Vec3): THREE.Vector3 => this.toWorld(p)
    const h = toWorld(b.head)
    const t = toWorld(b.tail)
    const center = h.clone().add(t).multiplyScalar(0.5)
    this.sceneHandle.controls.focus(
      center,
      Math.max(h.distanceTo(t), (this.s.probe()?.diagonal ?? 1) * 0.05)
    )
  }

  /** Blender's numpad views: front looks from -Y, right from +X, top from +Z. */
  viewAlong(view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'): void {
    const dirs: Record<string, Vec3> = {
      front: [0, -1, 0],
      back: [0, 1, 0],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 0, 1],
      bottom: [0, 0, -1]
    }
    const d = new THREE.Vector3(...dirs[view]).applyQuaternion(this.root.quaternion)
    this.sceneHandle.controls.snapToDirection(d)
    this.autoFlat()
  }

  /** Front, side and top views go flat when auto-perspective is on (like Blender). */
  private autoFlat(): void {
    if (this.s.autoOrtho() && !this.s.ortho()) {
      this.s.setOrtho(true)
      this.orthoFromView = true
    }
  }

  /** Flat/perspective switch by hand (Numpad 5, the button): stays until switched again. */
  toggleOrtho(): void {
    this.orthoFromView = false
    this.s.setOrtho(!this.s.ortho())
  }

  /** The camera that renders and picks: perspective, or its flat twin. */
  camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.sceneHandle.activeCamera()
  }

  setLightingMode(mode: LightingMode): void {
    this.sceneHandle.setLightingMode(mode)
  }

  navCubeClick(clientX: number, clientY: number): void {
    const dir = this.navCube?.pickFace(clientX, clientY)
    if (dir) {
      this.sceneHandle.controls.snapToDirection(dir)
      this.autoFlat()
    }
  }

  navCubeOrbit(dx: number, dy: number): void {
    this.sceneHandle.controls.orbitBy(dx, dy)
  }

  // --- space conversions -------------------------------------------------------------------

  private toWorld(p: Vec3): THREE.Vector3 {
    return new THREE.Vector3(...p).applyMatrix4(this.root.matrixWorld)
  }

  private project(p: Vec3 | THREE.Vector3, out: THREE.Vector2): boolean {
    const v = Array.isArray(p) ? this.toWorld(p) : p.clone()
    v.project(this.camera())
    const rect = this.canvas.getBoundingClientRect()
    out.set(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height)
    return v.z < 1 && v.z > -1
  }

  /** The pick ray under a screen point, in Blender space. */
  private rayAt(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 } {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera())
    const inv = this.root.matrixWorld.clone().invert()
    const o = this.raycaster.ray.origin.clone().applyMatrix4(inv)
    const d = this.raycaster.ray.direction.clone().transformDirection(inv)
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }
  }

  /** Camera viewing direction in Blender space. */
  private viewNormal(): Vec3 {
    const d = new THREE.Vector3()
    this.camera().getWorldDirection(d)
    d.transformDirection(this.root.matrixWorld.clone().invert())
    return [d.x, d.y, d.z]
  }

  private planeHit(ray: { origin: Vec3; dir: Vec3 }, normal: Vec3, through: Vec3): Vec3 | null {
    const denom = ray.dir[0] * normal[0] + ray.dir[1] * normal[1] + ray.dir[2] * normal[2]
    if (Math.abs(denom) < 1e-9) {
      return null
    }
    const t =
      ((through[0] - ray.origin[0]) * normal[0] +
        (through[1] - ray.origin[1]) * normal[1] +
        (through[2] - ray.origin[2]) * normal[2]) /
      denom
    return [
      ray.origin[0] + ray.dir[0] * t,
      ray.origin[1] + ray.dir[1] * t,
      ray.origin[2] + ray.dir[2] * t
    ]
  }

  /**
   * Where a click puts a joint: inside the mesh under the cursor (centred
   * between where the ray enters and leaves it) when snapping inside is on,
   * otherwise on the plane facing the camera through `ref`. Ctrl flips it.
   */
  private placePoint(
    e: { clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean },
    ref: Vec3
  ): Vec3 | null {
    const ray = this.rayAt(e.clientX, e.clientY)
    const inside = this.s.snapInside() !== (e.ctrlKey || e.metaKey)
    if (inside) {
      const p = this.s.probe()?.centerOnRay(ray.origin, ray.dir)
      if (p) {
        return p
      }
    }
    return this.planeHit(ray, this.viewNormal(), ref)
  }

  private modelCenter(): Vec3 {
    return this.s.probe()?.center ?? [0, 0, 0]
  }

  // --- snapping ------------------------------------------------------------------------------

  /** The view's right, up and looking directions, in Blender space. */
  private viewBasis(): { right: Vec3; up: Vec3; normal: Vec3 } {
    const inv = this.root.matrixWorld.clone().invert()
    const m = this.camera().matrixWorld
    const col = (i: number): Vec3 => {
      const v = new THREE.Vector3().setFromMatrixColumn(m, i).transformDirection(inv)
      return [v.x, v.y, v.z]
    }
    const back = col(2)
    return { right: col(0), up: col(1), normal: [-back[0], -back[1], -back[2]] }
  }

  /**
   * Snaps a joint position: onto another joint near the cursor, else to the
   * angle and/or grid. `pivot` is the bone's other end (for angle snapping);
   * `exclude` lists bones whose joints move along and mustn't be snapped to.
   * `free` (Shift held while dragging) turns these off for the moment.
   */
  private snapPoint(
    p: Vec3,
    opts: { pivot?: Vec3 | null; exclude?: Set<string>; free?: boolean }
  ): Vec3 {
    this.lastSnap = null
    const snap = this.s.snap()
    if (opts.free) {
      return p
    }
    if (snap.joints) {
      const hit = this.nearestJoint(p, opts.exclude)
      if (hit) {
        this.lastSnap = { kind: 'joint', at: hit }
        return [...hit] as Vec3
      }
    }
    const step = this.s.gridStep()
    const { right, up, normal } = this.viewBasis()
    if (snap.angle && opts.pivot) {
      const r = snapAngle(p, opts.pivot, right, up, normal, snap.angleStep, snap.grid ? step : 0)
      this.lastSnap = { kind: 'angle', at: r.point, pivot: opts.pivot, degrees: r.degrees }
      return r.point
    }
    if (snap.grid) {
      const q = snapToGrid(p, step, dominantAxis(normal))
      this.lastSnap = { kind: 'grid', at: q }
      return q
    }
    return p
  }

  /** The joint drawn within a few pixels of where `p` is drawn, skipping `exclude`d bones. */
  private nearestJoint(p: Vec3, exclude?: Set<string>): Vec3 | null {
    const here = new THREE.Vector2()
    if (!this.project(p, here)) {
      return null
    }
    let best: Vec3 | null = null
    let bestD = PICK_RADIUS
    const sp = new THREE.Vector2()
    for (const b of this.s.bones()) {
      for (const q of exclude?.has(b.id) ? [] : [b.head, b.tail]) {
        const d = this.project(q, sp) ? sp.distanceTo(here) : Infinity
        if (d < bestD) {
          bestD = d
          best = q
        }
      }
    }
    return best
  }

  /** Bones that move with a joint (connected neighbours and mirror twins): not snap targets. */
  private movingWith(boneId: string, end: JointEnd): Set<string> {
    const b = this.s.boneMap().get(boneId)
    if (!b) {
      return new Set()
    }
    const r = moveJoint(this.s.bones(), boneId, end, b[end])
    return this.s.withMirrors(r.changed)
  }

  // --- picking -------------------------------------------------------------------------------

  private localXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Grabbable joint nearest the cursor: tails, plus heads that aren't connected. */
  private pickJoint(x: number, y: number): Hit {
    let best: Hit = null
    let bestD = PICK_RADIUS
    const sel = this.s.selectedBone()
    const bones = this.pose ? [...this.pose.data.values()] : this.s.bones()
    for (const b of bones) {
      const sp = this.screen.get(b.id)
      if (!sp) {
        continue
      }
      const consider = (end: JointEnd, p: THREE.Vector2, visible: boolean): void => {
        if (!visible) {
          return
        }
        // The selected bone wins ties, so its own joint is easy to grab.
        const d = Math.hypot(p.x - x, p.y - y) - (b.id === sel ? 1.5 : 0)
        if (d < bestD) {
          bestD = d
          best = { boneId: b.id, end }
        }
      }
      consider('tail', sp.t, sp.tv)
      if (!b.connected || !b.parent) {
        consider('head', sp.h, sp.hv)
      }
    }
    return best
  }

  private pickBoneBody(x: number, y: number): string | null {
    let best: string | null = null
    let bestD = 7
    for (const [id, sp] of this.screen) {
      if (!sp.hv || !sp.tv) {
        continue
      }
      const ab = sp.t.clone().sub(sp.h)
      const l2 = ab.lengthSq()
      const t =
        l2 > 0 ? Math.min(1, Math.max(0, ((x - sp.h.x) * ab.x + (y - sp.h.y) * ab.y) / l2)) : 0
      const d = Math.hypot(sp.h.x + ab.x * t - x, sp.h.y + ab.y * t - y)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }

  /** The mesh piece under the cursor: an object, or one loose piece of a split object. */
  private pickPart(e: { clientX: number; clientY: number }): PartKey | null {
    const probe = this.s.probe()
    if (!probe) {
      return null
    }
    const ray = this.rayAt(e.clientX, e.clientY)
    const hit = probe.firstHit(ray.origin, ray.dir)
    if (!hit) {
      return null
    }
    const part = probe.parts[hit.part]
    if (!this.s.splitObjects().includes(part.name)) {
      return objectKey(part.name)
    }
    const v = part.triangles[hit.face * 3]
    return islandKey(part.name, this.s.islandsOf(part).of[v])
  }

  // --- pointer -------------------------------------------------------------------------------

  private startDrag(d: Drag): void {
    this.drag = d
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || e.altKey || !this.s.doc()) {
      return
    }
    const { x, y } = this.localXY(e)
    if (this.s.view() === 'pose') {
      this.posePointerDown(x, y)
      return
    }
    if (this.painting()) {
      this.paintPointerDown(e, x, y)
      return
    }
    const tool = this.s.tool()
    const joint = this.pickJoint(x, y)
    const body = joint ? null : this.pickBoneBody(x, y)

    if (
      tool === 'select' ||
      (tool === 'add' && joint && !e.shiftKey) ||
      (tool !== 'chain' && tool !== 'add' && (joint || body))
    ) {
      if (joint) {
        this.s.setSelectedBone(joint.boneId)
        this.s.setPendingHead(null)
        const b = this.s.boneMap().get(joint.boneId)!
        const p = b[joint.end]
        const cx = this.s.cx()
        const onPlane =
          this.s.symmetry() &&
          !mirrorName(b.name) &&
          Math.abs(p[0] - cx) < (this.s.probe()?.diagonal ?? 1) * 1e-3
        this.s.beginEdit()
        this.startDrag({
          kind: 'joint',
          boneId: b.id,
          end: joint.end,
          normal: this.viewNormal(),
          anchor: p,
          lockX: onPlane ? cx : null,
          moved: false,
          pivot: joint.end === 'tail' ? b.head : b.tail,
          exclude: this.movingWith(b.id, joint.end)
        })
        return
      }
      if (body) {
        this.s.setSelectedBone(body)
        const b = this.s.boneMap().get(body)!
        const mid: Vec3 = [
          (b.head[0] + b.tail[0]) / 2,
          (b.head[1] + b.tail[1]) / 2,
          (b.head[2] + b.tail[2]) / 2
        ]
        const start = this.planeHit(this.rayAt(e.clientX, e.clientY), this.viewNormal(), mid) ?? mid
        this.s.beginEdit()
        this.startDrag({
          kind: 'bone',
          boneId: body,
          normal: this.viewNormal(),
          startHit: start,
          startHead: [...b.head] as Vec3,
          moved: false
        })
        return
      }
      if (tool === 'select') {
        // Shift/Ctrl+click adds pieces to the selection (to join them).
        const add = e.shiftKey || e.ctrlKey || e.metaKey
        this.s.selectPart(this.pickPart(e), add)
        if (!add) {
          this.s.setSelectedBone(null)
        }
        return
      }
    }

    if (tool === 'add') {
      const sel = this.s.selectedBone() ? this.s.boneMap().get(this.s.selectedBone()!) : undefined
      const pending = this.s.pendingHead()
      const ref = pending?.pos ?? sel?.tail ?? this.modelCenter()
      const placed = this.placePoint(e, ref)
      if (!placed) {
        return
      }
      const p = this.snapPoint(placed, { pivot: e.shiftKey ? null : (pending?.pos ?? sel?.tail) })
      this.lastSnap = null
      if (e.shiftKey) {
        this.s.setPendingHead({ pos: p, parent: sel?.id ?? null })
      } else if (pending) {
        this.s.addBone(pending.pos, p, pending.parent, false)
        this.s.setPendingHead(null)
      } else if (sel) {
        this.s.addBone(sel.tail, p, sel.id, true)
      } else {
        this.s.setPendingHead({ pos: p, parent: null })
      }
      return
    }

    if (tool === 'chain') {
      if (joint) {
        this.s.setSelectedBone(joint.boneId)
        return
      }
      this.startDrag({ kind: 'stroke', points: [{ x: e.clientX, y: e.clientY }] })
      return
    }

    if (tool === 'bind') {
      const key = this.pickPart(e)
      // Shift/Ctrl+click gathers pieces (to join them) instead of binding.
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        this.s.selectPart(key, true)
        return
      }
      this.s.selectPart(key)
      const sel = this.s.selectedBone()
      if (key && sel) {
        this.s.bindPart(key, this.s.bindings()[key] === sel ? null : sel)
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag
    if (!d) {
      return
    }
    if (d.kind === 'paint') {
      this.brush = this.meshPoint(e)
      if (this.brush) {
        this.s.paintAt(this.brush)
      }
      return
    }
    if (d.kind === 'stroke') {
      const last = d.points[d.points.length - 1]
      if (Math.hypot(e.clientX - last.x, e.clientY - last.y) > 3) {
        d.points.push({ x: e.clientX, y: e.clientY })
      }
      return
    }
    if (d.kind === 'joint') {
      let p = this.placePoint(e, d.anchor)
      if (!p) {
        return
      }
      p = this.snapPoint(p, { pivot: d.pivot, exclude: d.exclude, free: e.shiftKey })
      if (d.lockX !== null) {
        p = [d.lockX, p[1], p[2]]
      }
      d.moved = true
      const r = moveJoint(this.s.bones(), d.boneId, d.end, p)
      this.s.liveBones(this.s.mirrored(r.bones, r.changed))
      return
    }
    if (d.kind === 'bone') {
      const p = this.planeHit(this.rayAt(e.clientX, e.clientY), d.normal, d.startHit)
      const bone = this.s.boneMap().get(d.boneId)
      if (!p || !bone) {
        return
      }
      // Where the head would be, snapped like a joint; the bone follows it.
      const wanted = this.snapPoint(add(d.startHead, sub(p, d.startHit)), {
        exclude: this.s.withMirrors([d.boneId]),
        free: e.shiftKey
      })
      const delta = sub(wanted, bone.head)
      d.moved = true
      const r = translateBone(this.s.bones(), d.boneId, delta)
      this.s.liveBones(this.s.mirrored(r.bones, r.changed))
      return
    }
    const pose = this.pose
    if (!pose) {
      return
    }
    const hit = this.planeHit(this.rayAt(e.clientX, e.clientY), d.normal, d.anchor)
    if (!hit) {
      return
    }
    const world = this.toWorld(hit)
    this.stress = null
    if (d.kind === 'poseAim') {
      aimAt(pose, d.boneId, world)
    } else if (d.kind === 'poseIk') {
      solveIk(pose, d.ownerId, world, this.root)
    } else if (d.kind === 'poseRoot') {
      moveRoot(pose, d.boneId, world)
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag
    this.drag = null
    this.lastSnap = null
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    if (!d) {
      return
    }
    if (d.kind === 'joint' || d.kind === 'bone') {
      this.s.endEdit()
      return
    }
    if (d.kind === 'paint') {
      this.s.endPaint()
      return
    }
    if (d.kind === 'stroke') {
      this.finishStroke(d.points, e)
    }
  }

  private idOf(o: object | null | undefined): number {
    if (!o) {
      return 0
    }
    let id = this.objectIds.get(o)
    if (!id) {
      id = this.nextObjectId++
      this.objectIds.set(o, id)
    }
    return id
  }

  // --- weight brush ----------------------------------------------------------------------

  /** The brush is on: Weights view with Paint switched on. */
  private painting(): boolean {
    return this.s.view() === 'weights' && this.s.paint().on
  }

  /** The surface point under the cursor, in Blender space. */
  private meshPoint(e: { clientX: number; clientY: number }): Vec3 | null {
    const probe = this.s.probe()
    if (!probe) {
      return null
    }
    const ray = this.rayAt(e.clientX, e.clientY)
    const hit = probe.firstHit(ray.origin, ray.dir)
    if (!hit) {
      return null
    }
    const n = Math.hypot(...ray.dir)
    return [0, 1, 2].map((k) => ray.origin[k] + (ray.dir[k] / n) * hit.distance) as Vec3
  }

  /**
   * Joints still select bones while painting; anywhere else on the mesh
   * paints. Bone bodies don't count: they cover the limbs being painted.
   */
  private paintPointerDown(e: PointerEvent, x: number, y: number): void {
    const joint = this.pickJoint(x, y)
    if (joint) {
      this.s.setSelectedBone(joint.boneId)
      return
    }
    const p = this.meshPoint(e)
    if (!p || !this.s.beginPaint()) {
      return
    }
    this.brush = p
    this.s.paintAt(p)
    this.startDrag({ kind: 'paint' })
  }

  /** The brush outline: a circle of the brush's world radius around where it touches. */
  private drawBrush(ctx: CanvasRenderingContext2D): void {
    const probe = this.s.probe()
    if (!this.painting() || !this.brush || !this.pointer.inside || !probe) {
      return
    }
    const centre = this.toWorld(this.brush)
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera().matrixWorld, 0)
    const edge = centre.clone().addScaledVector(right, this.s.paint().radius * probe.diagonal)
    const a = new THREE.Vector2()
    const b = new THREE.Vector2()
    if (!this.project(centre, a) || !this.project(edge, b)) {
      return
    }
    ctx.strokeStyle =
      this.s.paint().mode === 'subtract'
        ? '#60a5fa'
        : this.s.paint().mode === 'smooth'
          ? '#e8e8ea'
          : '#f87171'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(a.x, a.y, a.distanceTo(b), 0, Math.PI * 2)
    ctx.stroke()
  }

  /** Turns a stroke drawn over the model into a chain of evenly spaced bones. */
  private finishStroke(points: { x: number; y: number }[], e: PointerEvent): void {
    if (points.length < 2) {
      return
    }
    const lens = [0]
    for (let i = 1; i < points.length; i++) {
      lens.push(
        lens[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
      )
    }
    const total = lens[lens.length - 1]
    if (total < 12) {
      return
    }
    const n = Math.max(1, this.s.chainCount())
    const samples: { x: number; y: number }[] = []
    for (let k = 0; k <= n; k++) {
      const target = (total * k) / n
      let i = 1
      while (i < lens.length - 1 && lens[i] < target) {
        i++
      }
      const f = (target - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1])
      samples.push({
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * f
      })
    }
    let ref = this.modelCenter()
    const pts: Vec3[] = []
    for (const s of samples) {
      const p = this.placePoint(
        { clientX: s.x, clientY: s.y, ctrlKey: e.ctrlKey, metaKey: e.metaKey },
        ref
      )
      if (p) {
        const q = this.snapPoint(p, { free: e.shiftKey })
        pts.push(q)
        ref = q
      }
    }
    this.lastSnap = null
    if (pts.length >= 2) {
      this.s.addChain(pts, this.s.selectedBone())
    }
  }

  private onHover(e: PointerEvent): void {
    const { x, y } = this.localXY(e)
    this.pointer = { x, y, inside: true }
    this.shiftHeld = e.shiftKey
    if (this.drag) {
      return
    }
    this.hover = this.pickJoint(x, y)
    this.hoverBone = this.hover ? this.hover.boneId : this.pickBoneBody(x, y)
    if (this.painting()) {
      this.brush = this.hover ? null : this.meshPoint(e)
      this.canvas.style.cursor = this.hover ? 'pointer' : this.brush ? 'none' : 'default'
      return
    }
    const tool = this.s.tool()
    if (this.s.view() === 'rig' && (tool === 'bind' || tool === 'select') && !this.hoverBone) {
      const key = this.pickPart(e)
      if (key !== this.s.hoverPart()) {
        this.s.setHoverPart(tool === 'bind' ? key : null)
      }
    }
    this.canvas.style.cursor = this.hover
      ? 'grab'
      : this.hoverBone
        ? 'pointer'
        : tool === 'add' || tool === 'chain'
          ? 'crosshair'
          : 'default'
  }

  private onLeave(): void {
    this.pointer.inside = false
    this.hover = null
    this.hoverBone = null
    if (this.s.hoverPart()) {
      this.s.setHoverPart(null)
    }
  }

  // --- pose mode ------------------------------------------------------------------------------

  private posePointerDown(x: number, y: number): void {
    const pose = this.pose
    if (!pose) {
      return
    }
    const joint = this.pickJoint(x, y)
    if (!joint) {
      this.s.setSelectedBone(null)
      return
    }
    this.stress = null
    this.s.setSelectedBone(joint.boneId)
    const b = pose.data.get(joint.boneId)!
    const ends = boneEnds(pose, b.id)
    const inv = this.root.matrixWorld.clone().invert()
    const anchorWorld = joint.end === 'head' ? ends.head : ends.tail
    const a = anchorWorld.clone().applyMatrix4(inv)
    const anchor: Vec3 = [a.x, a.y, a.z]
    const normal = this.viewNormal()
    if (joint.end === 'head' && !b.parent) {
      this.startDrag({ kind: 'poseRoot', boneId: b.id, normal, anchor })
    } else if (joint.end === 'tail' && pose.ik.has(b.id)) {
      this.startDrag({ kind: 'poseIk', ownerId: b.id, normal, anchor })
    } else if (joint.end === 'tail') {
      this.startDrag({ kind: 'poseAim', boneId: b.id, normal, anchor })
    }
  }

  private exitPose(): void {
    if (this.pose) {
      disposePoseRig(this.pose, this.root)
      this.pose = null
      this.poseKey = ''
      this.visibilityKey = ''
      this.colorKey = ''
      for (const d of this.displays.values()) {
        d.mesh.visible = true
      }
    }
    this.stress = null
  }

  private syncPose(): void {
    const w = this.s.weights()
    if (this.s.view() !== 'pose' || !w) {
      this.exitPose()
      return
    }
    const key = `${this.s.signature()}|${w.signature}|${w.source}|${this.s.bones().length}|${this.s.weightsRevision()}|${this.idOf(w)}`
    if (this.pose && key === this.poseKey) {
      return
    }
    this.exitPose()
    const dispMap = new Map<
      string,
      {
        geometry: THREE.BufferGeometry
        cornerVertex: Uint32Array
        material: THREE.Material | THREE.Material[]
      }
    >()
    for (const d of this.displays.values()) {
      dispMap.set(d.part.name, {
        geometry: d.geometry,
        cornerVertex: d.cornerVertex,
        material: d.materials
      })
    }
    this.pose = buildPoseRig(this.root, this.s.bones(), this.s.includedParts(), w, dispMap)
    this.poseKey = key
    this.visibilityKey = ''
    this.colorKey = ''
  }

  resetPose(): void {
    this.stress = null
    if (this.pose) {
      resetPose(this.pose)
    }
  }

  startStressTest(): void {
    if (!this.pose) {
      return
    }
    this.stress = { moves: stressMoves([...this.pose.data.values()]), start: performance.now() }
  }

  stressRunning(): boolean {
    return !!this.stress
  }

  stressDuration(): number {
    return this.pose ? stressMoves([...this.pose.data.values()]).length * MOVE_SECONDS : 0
  }

  // --- drawing ---------------------------------------------------------------------------------

  private loop(): void {
    if (this.disposed) {
      return
    }
    this.syncPose()
    this.syncMeshes()
    if (this.stress && this.pose) {
      const t = (performance.now() - this.stress.start) / 1000
      if (!applyStress(this.pose, this.stress.moves, t)) {
        this.stress = null
        resetPose(this.pose)
      }
    }
    const { renderer, scene } = this.sceneHandle
    if (this.s.ortho() !== this.sceneHandle.isOrtho()) {
      this.sceneHandle.setOrtho(this.s.ortho())
    }
    this.sceneHandle.syncOrtho()
    this.syncViewGrid()
    renderer.render(scene, this.camera())
    this.drawOverlay()
    this.navCube?.render(this.camera())
    this.raf = requestAnimationFrame(this.loop)
  }

  /**
   * In a flat front/side/top view, a grid in the view plane behind the model,
   * on the snapping grid's steps (coarser when zoomed out, like Blender's).
   */
  private syncViewGrid(): void {
    const { normal } = this.viewBasis()
    const flat = this.s.ortho() && !!this.s.doc() && isAxisView(normal)
    if (!flat) {
      this.viewGrid.visible = false
      return
    }
    const ortho = this.sceneHandle.ortho
    const span = ortho.top - ortho.bottom
    let step = this.s.gridStep()
    while (span / step > 150) {
      step *= 10
    }
    while (span / step < 6) {
      step /= 10
    }
    const axis = dominantAxis(normal)
    // Centre on the camera target, on a multiple of the big step, so lines sit on world steps.
    const target = new THREE.Vector3()
      .copy(this.sceneHandle.controls.target)
      .applyMatrix4(this.root.matrixWorld.clone().invert())
    const big = step * 10
    const centre: Vec3 = [0, 1, 2].map((i) =>
      i === axis ? 0 : Math.round(target.getComponent(i) / big) * big
    ) as Vec3
    const key = `${step}|${axis}|${centre.join(',')}|${this.s.snap().grid}`
    this.viewGrid.visible = true
    // Behind the model, along the view.
    const diag = this.s.probe()?.diagonal ?? 2
    const behind: Vec3 = [...centre] as Vec3
    behind[axis] = (normal[axis] > 0 ? 1 : -1) * diag * 2
    this.viewGrid.position.copy(new THREE.Vector3(...behind).applyMatrix4(this.root.matrixWorld))
    if (key === this.viewGridKey) {
      return
    }
    this.viewGridKey = key
    for (const c of [...this.viewGrid.children]) {
      this.viewGrid.remove(c)
      ;(c as THREE.LineSegments).geometry.dispose()
      ;((c as THREE.LineSegments).material as THREE.Material).dispose()
    }
    const strong = this.s.snap().grid
    const count = 200
    // Lighter than the background (#323338); brighter still while snapping to it.
    const minor = new THREE.GridHelper(step * count, count, 0x5c5c6c, strong ? 0x464652 : 0x3d3d47)
    const major = new THREE.GridHelper(big * 20, 20, 0x5c5c6c, strong ? 0x5c5c6c : 0x4a4a56)
    for (const g of [minor, major]) {
      const m = g.material as THREE.Material
      m.depthWrite = false
      m.transparent = true
      m.opacity = 0.9
      g.renderOrder = -2
      this.viewGrid.add(g)
    }
    // GridHelper lies in three's XZ plane (normal +Y): turn it to face the view.
    const n = new THREE.Vector3(
      axis === 0 ? 1 : 0,
      axis === 1 ? 1 : 0,
      axis === 2 ? 1 : 0
    ).transformDirection(this.root.matrixWorld)
    this.viewGrid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
  }

  /** What the current drag snapped to: a ring on a joint, a guide for an angle, a cross on the grid. */
  private drawSnap(ctx: CanvasRenderingContext2D): void {
    const s = this.lastSnap
    if (!s) {
      return
    }
    const at = new THREE.Vector2()
    if (!this.project(s.at, at)) {
      return
    }
    ctx.strokeStyle = '#22d3ee'
    ctx.fillStyle = '#22d3ee'
    ctx.lineWidth = 1.5
    if (s.kind === 'joint') {
      ctx.beginPath()
      ctx.arc(at.x, at.y, JOINT_RADIUS + 5, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    if (s.kind === 'grid') {
      ctx.beginPath()
      ctx.moveTo(at.x - 7, at.y)
      ctx.lineTo(at.x + 7, at.y)
      ctx.moveTo(at.x, at.y - 7)
      ctx.lineTo(at.x, at.y + 7)
      ctx.stroke()
      return
    }
    const pv = new THREE.Vector2()
    if (s.pivot && this.project(s.pivot, pv)) {
      const dir = at.clone().sub(pv)
      const far = pv.clone().add(dir.clone().multiplyScalar(4))
      const back = pv.clone().sub(dir.clone().multiplyScalar(4))
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(back.x, back.y)
      ctx.lineTo(far.x, far.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '11px Inter, system-ui, sans-serif'
      ctx.fillText(`${s.degrees}°`, at.x + 10, at.y - 10)
    }
  }

  /** Blender's relationship line: short dashes from a child's head to its parent's tail. */
  private relationLine(
    ctx: CanvasRenderingContext2D,
    from: THREE.Vector2,
    to: THREE.Vector2,
    lit: boolean
  ): void {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.lineWidth = lit ? 1.75 : 1.25
    // A dark underlay keeps the dots readable over a light mesh.
    ctx.strokeStyle = 'rgba(10,10,12,0.55)'
    ctx.lineWidth += 1.5
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.lineWidth -= 1.5
    ctx.strokeStyle = lit ? COLORS.relationSelected : COLORS.relation
    ctx.stroke()
    ctx.restore()
  }

  /** A see-through bone from `h` to `t`, for previews. Dashed outline when `free` (disconnected). */
  private ghostBone(
    ctx: CanvasRenderingContext2D,
    h: THREE.Vector2,
    t: THREE.Vector2,
    free: boolean
  ): void {
    const ab = t.clone().sub(h)
    const len = ab.length()
    if (len < 2) {
      return
    }
    const dir = ab.clone().divideScalar(len)
    const perp = new THREE.Vector2(-dir.y, dir.x)
    const wid = Math.min(10, Math.max(3, len * 0.1))
    const waist = h.clone().addScaledVector(dir, Math.min(len * 0.12, 18))
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(h.x, h.y)
    ctx.lineTo(waist.x + perp.x * wid, waist.y + perp.y * wid)
    ctx.lineTo(t.x, t.y)
    ctx.lineTo(waist.x - perp.x * wid, waist.y - perp.y * wid)
    ctx.closePath()
    ctx.fillStyle = 'rgba(34,211,238,0.18)'
    ctx.fill()
    ctx.strokeStyle = COLORS.pending
    ctx.lineWidth = 1.5
    ctx.setLineDash(free ? [4, 3] : [])
    ctx.stroke()
    ctx.restore()
  }

  /** Start marker: a solid ring where a bone grows from a tail, a dashed one for a free start. */
  private startRing(ctx: CanvasRenderingContext2D, at: THREE.Vector2, free: boolean): void {
    ctx.save()
    ctx.strokeStyle = COLORS.pending
    ctx.lineWidth = 2
    ctx.setLineDash(free ? [3, 3] : [])
    ctx.beginPath()
    ctx.arc(at.x, at.y, 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * A badge by the cursor for a disconnected start: a broken link and the name
   * of the bone it will hang off.
   */
  private freeBadge(
    ctx: CanvasRenderingContext2D,
    at: THREE.Vector2,
    parentName: string | null
  ): void {
    const x = at.x + 14
    const y = at.y - 16
    ctx.save()
    ctx.strokeStyle = COLORS.pending
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    // Two chain links pulled apart, with a cut between them: "not connected".
    ctx.save()
    ctx.translate(x + 5, y)
    ctx.rotate(-Math.PI / 4)
    ctx.beginPath()
    ctx.roundRect(-11, -3.5, 8, 7, 3.5)
    ctx.roundRect(3, -3.5, 8, 7, 3.5)
    ctx.stroke()
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, -6)
    ctx.lineTo(0, 6)
    ctx.stroke()
    ctx.restore()
    ctx.font = '600 11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const label = parentName
      ? t('viewport.offParent', { bone: parentName })
      : t('viewport.newChain')
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(10,10,12,0.85)'
    ctx.strokeText(label, x + 18, y + 1)
    ctx.fillStyle = COLORS.pending
    ctx.fillText(label, x + 18, y + 1)
    ctx.restore()
  }

  /**
   * What the next Add-bone click does. From the selected bone's tail: a solid
   * ring and a ghost bone to the cursor (connected). With Shift held, or with
   * no bone selected: a dashed ring at the cursor, the dotted link to the bone
   * it will hang off, and a badge (a disconnected start). After that first
   * click: the dashed start, its link, and a dashed ghost bone to the cursor.
   */
  private drawAddPreview(ctx: CanvasRenderingContext2D, selBone: Bone | undefined): void {
    if (!this.pointer.inside) {
      return
    }
    const cursor = new THREE.Vector2(this.pointer.x, this.pointer.y)
    const pending = this.s.pendingHead()
    const link = (from: THREE.Vector2, parent: Bone | undefined): void => {
      const pt = new THREE.Vector2()
      if (parent && this.project(parent.tail, pt)) {
        this.relationLine(ctx, from, pt, true)
      }
    }
    if (pending) {
      const a = new THREE.Vector2()
      if (!this.project(pending.pos, a)) {
        return
      }
      const parent = pending.parent ? this.s.boneMap().get(pending.parent) : undefined
      link(a, parent)
      this.ghostBone(ctx, a, cursor, true)
      this.startRing(ctx, a, true)
      return
    }
    if (this.shiftHeld || !selBone) {
      link(cursor, selBone)
      this.startRing(ctx, cursor, true)
      this.freeBadge(ctx, cursor, selBone?.name ?? null)
      return
    }
    const a = new THREE.Vector2()
    if (this.project(selBone.tail, a)) {
      this.ghostBone(ctx, a, cursor, false)
      this.startRing(ctx, a, false)
    }
  }

  /** Where every bone is drawn: editor positions, or the posed skeleton in pose mode. */
  private drawnBones(): { bone: Bone; head: Vec3 | THREE.Vector3; tail: Vec3 | THREE.Vector3 }[] {
    if (this.pose) {
      return [...this.pose.data.values()].map((bone) => {
        const e = boneEnds(this.pose!, bone.id)
        return { bone, head: e.head, tail: e.tail }
      })
    }
    return this.s.bones().map((bone) => ({ bone, head: bone.head, tail: bone.tail }))
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w
      this.overlay.height = h
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    this.screen.clear()
    if (!this.s.doc()) {
      return
    }

    const view = this.s.view()
    const sel = this.s.selectedBone()
    const selBone = sel ? this.s.boneMap().get(sel) : undefined
    const twinName = selBone ? mirrorName(selBone.name) : null
    const ikBones = new Set<string>()
    for (const b of this.s.bones()) {
      if (!b.ik) {
        continue
      }
      let cur: Bone | undefined = b
      for (let i = 0; i < b.ik.chain && cur; i++) {
        ikBones.add(cur.id)
        cur = cur.parent ? this.s.boneMap().get(cur.parent) : undefined
      }
    }
    const drawn = this.drawnBones()
    for (const d of drawn) {
      const hs = new THREE.Vector2()
      const ts = new THREE.Vector2()
      const hv = this.project(d.head, hs)
      const tv = this.project(d.tail, ts)
      this.screen.set(d.bone.id, { h: hs, t: ts, hv, tv })
    }

    // Relationship lines, as Blender draws them: a dotted line from a
    // disconnected child's head to its parent's tail. Blue when either end is
    // the selected bone, so you can see what it hangs off.
    for (const d of drawn) {
      if (!d.bone.parent || d.bone.connected) {
        continue
      }
      const p = this.screen.get(d.bone.parent)
      const me = this.screen.get(d.bone.id)
      if (!p || !me || !p.tv || !me.hv) {
        continue
      }
      const lit = sel === d.bone.id || sel === d.bone.parent
      this.relationLine(ctx, me.h, p.t, lit)
    }

    // Bone bodies: Blender's octahedral bone, seen flat.
    for (const d of drawn) {
      const sp = this.screen.get(d.bone.id)!
      if (!sp.hv || !sp.tv) {
        continue
      }
      const ab = sp.t.clone().sub(sp.h)
      const len = ab.length()
      if (len < 0.5) {
        continue
      }
      const dir = ab.clone().divideScalar(len)
      const perp = new THREE.Vector2(-dir.y, dir.x)
      const wid = Math.min(10, Math.max(2.5, len * 0.1))
      const waist = sp.h.clone().addScaledVector(dir, Math.min(len * 0.12, 18))
      const isSel = d.bone.id === sel
      const isTwin = !!twinName && d.bone.name === twinName
      const isHover = d.bone.id === this.hoverBone
      ctx.beginPath()
      ctx.moveTo(sp.h.x, sp.h.y)
      ctx.lineTo(waist.x + perp.x * wid, waist.y + perp.y * wid)
      ctx.lineTo(sp.t.x, sp.t.y)
      ctx.lineTo(waist.x - perp.x * wid, waist.y - perp.y * wid)
      ctx.closePath()
      ctx.fillStyle = isSel
        ? COLORS.boneSelected
        : isTwin
          ? COLORS.boneTwin
          : isHover
            ? COLORS.boneHover
            : ikBones.has(d.bone.id)
              ? COLORS.boneIk
              : COLORS.bone
      ctx.fill()
      ctx.strokeStyle = COLORS.boneLine
      ctx.lineWidth = 1
      if (!d.bone.deform) {
        ctx.setLineDash([3, 2])
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // IK targets and poles, in rig view.
    if (view !== 'pose') {
      const controls = buildControls(this.s.bones())
      for (const [, h] of controls.handles) {
        const t = new THREE.Vector2()
        if (this.project(h.target, t)) {
          ctx.strokeStyle = COLORS.ikTarget
          ctx.lineWidth = 2
          ctx.strokeRect(t.x - 7, t.y - 7, 14, 14)
        }
        const p = new THREE.Vector2()
        if (h.pole && this.project(h.pole, p)) {
          ctx.fillStyle = COLORS.pole
          ctx.beginPath()
          ctx.moveTo(p.x, p.y - 6)
          ctx.lineTo(p.x + 6, p.y)
          ctx.lineTo(p.x, p.y + 6)
          ctx.lineTo(p.x - 6, p.y)
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    // Joints.
    for (const d of drawn) {
      const sp = this.screen.get(d.bone.id)!
      const isSel = d.bone.id === sel
      const hoverEnd = this.hover && this.hover.boneId === d.bone.id ? this.hover.end : null
      const joint = (p: THREE.Vector2, end: JointEnd): void => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, JOINT_RADIUS + (hoverEnd === end ? 1.5 : 0), 0, Math.PI * 2)
        ctx.fillStyle = isSel
          ? COLORS.jointSelected
          : view === 'pose' && end === 'tail' && this.pose?.ik.has(d.bone.id)
            ? COLORS.ikTarget
            : COLORS.joint
        ctx.fill()
        ctx.strokeStyle = COLORS.boneLine
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      if (sp.tv) {
        joint(sp.t, 'tail')
      }
      if (sp.hv && (!d.bone.connected || !d.bone.parent)) {
        joint(sp.h, 'head')
      }
    }

    // Names.
    ctx.font = '11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (const d of drawn) {
      const show = this.showNames || d.bone.id === sel || d.bone.id === this.hoverBone
      const sp = this.screen.get(d.bone.id)!
      if (!show || !sp.hv || !sp.tv) {
        continue
      }
      const mid = sp.h.clone().add(sp.t).multiplyScalar(0.5)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(10,10,12,0.85)'
      ctx.strokeText(d.bone.name, mid.x + 8, mid.y)
      ctx.fillStyle = COLORS.label
      ctx.fillText(d.bone.name, mid.x + 8, mid.y)
    }

    this.drawBrush(ctx)
    this.drawSnap(ctx)

    // Add tool: a ghost of the bone the next click makes.
    if (view === 'rig' && this.s.tool() === 'add' && !this.drag) {
      this.drawAddPreview(ctx, selBone)
    }
    // Chain tool: the stroke being drawn.
    if (this.drag?.kind === 'stroke') {
      const pts = this.drag.points
      ctx.strokeStyle = COLORS.stroke
      ctx.lineWidth = 2
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = p.x - rect.left
        const y = p.y - rect.top
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.stroke()
    }
  }

  /** Where in Blender space the camera looks (for placing things "in front"). */
  focusPoint(): Vec3 {
    const t = this.sceneHandle.controls.target
      .clone()
      .applyMatrix4(this.root.matrixWorld.clone().invert())
    return [t.x, t.y, t.z]
  }
}
