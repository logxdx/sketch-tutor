import {
  CaptureUpdateAction,
  FONT_FAMILY,
  convertToExcalidrawElements,
  exportToBlob,
  newElementWith,
} from "@excalidraw/excalidraw"
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform"
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types"
import type {
  AppState,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types"

import type { COLORS } from "@/lib/agent/schemas"
import {
  type Box,
  type Pt,
  center,
  contains,
  easeOut,
  edgePoint,
  pad,
  polylinePrefix,
  union,
  wrapText,
} from "./geometry"
import { plotToShapes } from "./plot"
import type {
  AnnotateInput,
  AskStudentInput,
  BoardStatus,
  DrawInput,
  DrawShape,
  DrawSpeed,
  EraseInput,
  LessonStep,
  PlotToolInput,
  PointAtInput,
} from "./types"

type Color = (typeof COLORS)[number]
type Capture = (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction]
type El = ExcalidrawElement

const INK: Record<Color, string> = {
  black: "#1e1e1e",
  blue: "#1971c2",
  red: "#e03131",
  green: "#2f9e44",
  orange: "#f08c00",
  purple: "#6741d9",
  teal: "#0c8599",
  gray: "#868e96",
}
const FILL: Record<Color, string> = {
  black: "#e9ecef",
  blue: "#d0ebff",
  red: "#ffe3e3",
  green: "#d3f9d8",
  orange: "#fff3bf",
  purple: "#e5dbff",
  teal: "#c3fae8",
  gray: "#f1f3f5",
}
const FONT_SIZE = { s: 16, m: 20, l: 28, xl: 36 } as const

const TUTOR_ID = "sketch-tutor" as SocketId
const TUTOR_COLOR = { background: "#ede9fe", stroke: "#7c3aed" }

/** Frame-count multipliers per speed. */
const SPEED: Record<DrawSpeed, number> = { relaxed: 1.6, normal: 1, fast: 0.45, instant: 0 }

const isTutor = (el: El) => el.customData?.author === "tutor"
/**
 * One animation frame. Browsers pause rAF in background tabs, so race it with a
 * timer — a hidden tab must never stall the agent loop waiting for a drawing.
 */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    requestAnimationFrame(finish)
    setTimeout(finish, 40)
  })
const pageHidden = () => typeof document !== "undefined" && document.hidden

/** Outline used to aim arrows at a shape's real edge. */
const outline = (el: El) => (el.type === "ellipse" ? "ellipse" : el.type === "diamond" ? "diamond" : "rect")

/**
 * Make a label's longest word fit its shape (ellipses and diamonds have less
 * usable width): first shrink the font a little, then widen the shape —
 * symmetrically, so neighbours laid out by the tutor aren't overlapped.
 */
function fitLabel(s: DrawShape, width: number) {
  const fontSize = FONT_SIZE[s.size ?? "m"]
  if (!s.text) return { width, fontSize, dx: 0 }
  const longest = Math.max(...s.text.split(/\s+/).map((w) => w.length))
  const factor = s.kind === "diamond" ? 1.9 : s.kind === "ellipse" ? 1.45 : 1
  const usable = width / factor - 24
  const fitted = Math.max(16, Math.min(fontSize, Math.floor(usable / (longest * 0.62))))
  const needed = Math.ceil((longest * fitted * 0.62 + 24) * factor)
  const newWidth = Math.max(width, needed)
  return { width: newWidth, fontSize: fitted, dx: -(newWidth - width) / 2 }
}

export type ToolResult = Record<string, unknown>

/**
 * Wraps the Excalidraw imperative API and turns the tutor's tool calls into
 * live, animated drawing. Also produces the text + image views of the board
 * the model gets each turn, and tracks what the student is doing.
 */
export class BoardController {
  private api: ExcalidrawImperativeAPI
  private listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private aliases = new Map<string, string>()
  private cursorTimer: ReturnType<typeof setTimeout> | null = null
  private studentSignature = ""
  private pointerDown = false
  /** Bumped by cancel(); operations remember the epoch they were queued in. */
  private epoch = 0
  private runEpoch = 0
  private get cancelled() {
    return this.runEpoch !== this.epoch
  }

  /** Lets scripted sequences (the demo) notice a Stop. */
  currentEpoch() {
    return this.epoch
  }

  private status: BoardStatus = {
    ready: true,
    activity: null,
    selection: [],
    steps: [],
    yourTurn: null,
    studentDirty: false,
    lastStudentActivity: 0,
    isEmpty: true,
    speed: "normal",
  }

  constructor(api: ExcalidrawImperativeAPI) {
    this.api = api
  }

  /** Point at a new Excalidraw instance (remounts, e.g. React Strict Mode in dev) keeping lesson state. */
  attach(api: ExcalidrawImperativeAPI) {
    this.api = api
  }

  // ---------------------------------------------------------------- store

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus = () => this.status

  private patch(update: Partial<BoardStatus>) {
    this.status = { ...this.status, ...update }
    this.listeners.forEach((l) => l())
  }

  setSpeed(speed: DrawSpeed) {
    this.patch({ speed })
  }

  /** Called from Excalidraw's onChange. Tracks selection and student edits. */
  handleChange(elements: readonly El[], appState: AppState) {
    const selection = Object.keys(appState.selectedElementIds).filter(
      (id) => appState.selectedElementIds[id]
    )
    const live = elements.filter((e) => !e.isDeleted)
    let sig = ""
    for (const e of elements) if (!isTutor(e)) sig += `${e.id}:${e.version};`

    const updates: Partial<BoardStatus> = {}
    if (selection.join() !== this.status.selection.join()) updates.selection = selection
    if (live.length === 0 !== this.status.isEmpty) updates.isEmpty = live.length === 0
    if (sig !== this.studentSignature) {
      const first = this.studentSignature === ""
      this.studentSignature = sig
      if (!first) {
        updates.studentDirty = true
        updates.lastStudentActivity = Date.now()
      }
    }
    if (Object.keys(updates).length) this.patch(updates)
  }

  handlePointer(button: "up" | "down") {
    this.pointerDown = button === "down"
  }

  /** The tutor has now "seen" the board (a message with the board state went out). */
  markSeen({ closeTask = false }: { closeTask?: boolean } = {}) {
    const updates: Partial<BoardStatus> = {}
    if (this.status.studentDirty) updates.studentDirty = false
    if (closeTask && this.status.yourTurn) updates.yourTurn = null
    if (Object.keys(updates).length) this.patch(updates)
  }

  /** The student is mid-stroke (don't interrupt with nudges or camera moves). */
  isDrawing() {
    return this.pointerDown
  }

  /** Stop: the running operation finishes instantly, everything queued before now is skipped. */
  cancel() {
    this.epoch++
    this.patch({ activity: null })
    this.hideCursor(0)
  }

  // --------------------------------------------------------- scene utils

  private live() {
    return this.api.getSceneElements() as readonly El[]
  }

  private byId(id: string): El | undefined {
    const real = this.aliases.get(id) ?? id
    return this.live().find((e) => e.id === real)
  }

  private box(el: El): Box {
    if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
      const pts = (el as ExcalidrawLinearElement).points
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      return {
        x: el.x + minX,
        y: el.y + minY,
        w: Math.max(...xs) - minX,
        h: Math.max(...ys) - minY,
      }
    }
    return { x: el.x, y: el.y, w: el.width, h: el.height }
  }

  private viewport(): Box {
    const s = this.api.getAppState()
    const z = s.zoom.value
    return { x: -s.scrollX, y: -s.scrollY, w: s.width / z, h: s.height / z }
  }

  /** Ids handed out so far — elements of a batch aren't in the scene yet, so track them here. */
  private usedIds = new Set<string>()

  private uniqueId(wanted?: string) {
    const base = (wanted ?? "t").replace(/[^\w-]/g, "").slice(0, 32) || "t"
    let id = base
    let n = 1
    const scene = new Set(this.api.getSceneElementsIncludingDeleted().map((e) => e.id))
    while (scene.has(id) || this.usedIds.has(id) || (this.aliases.has(id) && this.aliases.get(id) !== id)) {
      id = `${base}-${++n}`
    }
    this.usedIds.add(id)
    if (wanted) this.aliases.set(wanted, id)
    return id
  }

  private upsert(els: readonly El[], captureUpdate: Capture = CaptureUpdateAction.EVENTUALLY) {
    const scene = this.api.getSceneElementsIncludingDeleted()
    const incoming = new Map(els.map((e) => [e.id, e]))
    const next: El[] = scene.map((e) => incoming.get(e.id) ?? e)
    const existing = new Set(scene.map((e) => e.id))
    for (const e of els) if (!existing.has(e.id)) next.push(e)
    this.api.updateScene({ elements: next, captureUpdate })
  }

  // -------------------------------------------------------------- cursor

  private setCursor(p: Pt, opts: { laser?: boolean; caption?: string } = {}) {
    const collaborator: Collaborator = {
      id: "tutor",
      username: opts.caption ? `Sketch · ${opts.caption}` : "Sketch",
      pointer: { x: p.x, y: p.y, tool: opts.laser ? "laser" : "pointer" },
      button: opts.laser ? "down" : "up",
      color: TUTOR_COLOR,
    }
    this.api.updateScene({ collaborators: new Map([[TUTOR_ID, collaborator]]) })
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
  }

  private hideCursor(delay = 2500) {
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.cursorTimer = setTimeout(
      () => this.api.updateScene({ collaborators: new Map() }),
      delay
    )
  }

  private cursorPos: Pt | null = null

  private async moveCursor(to: Pt, opts: { laser?: boolean; caption?: string } = {}) {
    const from = this.cursorPos ?? { x: to.x - 60, y: to.y - 60 }
    const frames = pageHidden() ? 0 : Math.round(8 * SPEED[this.status.speed])
    for (let i = 1; i <= frames && !this.cancelled; i++) {
      const t = easeOut(i / frames)
      this.setCursor({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, opts)
      await nextFrame()
    }
    this.cursorPos = to
    this.setCursor(to, opts)
  }

  private scrollTo(els: readonly El[]) {
    if (this.pointerDown || !els.length) return
    const target = union(els.map((e) => this.box(e)))
    if (!target) return
    if (contains(this.viewport(), pad(target, 20))) return
    this.api.scrollToContent(els as El[], { animate: true, duration: 450 })
  }

  // ---------------------------------------------------------- serialize

  /** Run board operations one at a time (several tool calls can arrive together). */
  private enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const epoch = this.epoch
    const run = async () => {
      // Queued before a Stop: skip entirely.
      if (epoch !== this.epoch) throw new Error("Stopped by the student")
      this.runEpoch = epoch
      this.patch({ activity: label })
      try {
        return await fn()
      } finally {
        this.patch({ activity: null })
        this.hideCursor()
      }
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  // ---------------------------------------------------------- placement

  private placeOrigin(size: { w: number; h: number }, opts: { near?: string; placement?: "below" | "right" }): Pt {
    const anchor = opts.near ? this.byId(opts.near) : undefined
    if (anchor) {
      const b = this.box(anchor)
      return { x: b.x + b.w + 80, y: b.y }
    }
    const all = union(this.live().map((e) => this.box(e)))
    if (!all) {
      const v = this.viewport()
      return {
        x: v.x + Math.max(40, (v.w - size.w) / 2),
        y: v.y + Math.max(40, Math.min(120, (v.h - size.h) / 2)),
      }
    }
    if (opts.placement === "right") return { x: all.x + all.w + 120, y: all.y }
    return { x: all.x, y: all.y + all.h + 100 }
  }

  // --------------------------------------------------------------- draw

  private ink(c?: Color) {
    return INK[c ?? "black"]
  }

  /** Convert draw shapes (panel coords) to Excalidraw elements, placed and connected. */
  private build(
    shapes: DrawShape[],
    opts: { near?: string; placement?: "below" | "right"; step: string },
    warnings: string[]
  ) {
    // Normalise local coordinates so the panel's top-left is (0,0).
    const xs: number[] = []
    const ys: number[] = []
    let maxX = 0
    let maxY = 0
    for (const s of shapes) {
      if (s.points?.length && !(s.from && s.to)) {
        for (const p of s.points) {
          xs.push(p.x)
          ys.push(p.y)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
        }
      } else if (s.x !== undefined || s.y !== undefined) {
        xs.push(s.x ?? 0)
        ys.push(s.y ?? 0)
        maxX = Math.max(maxX, (s.x ?? 0) + (s.w ?? 160))
        maxY = Math.max(maxY, (s.y ?? 0) + (s.h ?? 60))
      }
    }
    const minX = xs.length ? Math.min(...xs) : 0
    const minY = ys.length ? Math.min(...ys) : 0
    const origin = this.placeOrigin({ w: maxX - minX, h: maxY - minY }, opts)
    const ox = origin.x - minX
    const oy = origin.y - minY

    const custom = { author: "tutor", step: opts.step }
    const common = (s: DrawShape) => ({
      strokeColor: this.ink(s.color),
      strokeWidth: 2,
      roughness: 1,
      strokeStyle: s.dashed ? ("dashed" as const) : ("solid" as const),
      customData: custom,
    })

    // Pass 1: shapes and text (so arrows can measure what they connect).
    const order: { shape: DrawShape; id: string }[] = []
    const solid: ExcalidrawElementSkeleton[] = []
    let autoY = 0
    for (const s of shapes) {
      const id = this.uniqueId(s.id)
      order.push({ shape: s, id })
      if (s.kind === "arrow" || s.kind === "line") continue
      const x = ox + (s.x ?? 0)
      const y = oy + (s.y ?? autoY)
      if (s.kind === "text") {
        const fontSize = FONT_SIZE[s.size ?? "m"]
        const maxChars = Math.max(12, Math.floor((s.w ?? 520) / (fontSize * 0.55)))
        const text = wrapText(s.text ?? "", maxChars)
        solid.push({
          type: "text",
          id,
          x,
          y,
          text,
          fontSize,
          fontFamily: FONT_FAMILY.Excalifont,
          ...common(s),
        } as ExcalidrawElementSkeleton)
        autoY = (s.y ?? autoY) + fontSize * 1.4 * text.split("\n").length + 16
      } else {
        const type = s.kind === "rect" ? "rectangle" : s.kind
        const fit = fitLabel(s, s.w ?? 160)
        solid.push({
          type,
          id,
          x: x + fit.dx,
          y,
          width: fit.width,
          height: s.h ?? 70,
          backgroundColor: s.fill ? FILL[s.color ?? "blue"] : "transparent",
          fillStyle: "solid",
          roundness: type === "rectangle" ? { type: 3 } : null,
          ...common(s),
          label: s.text
            ? {
                text: s.text,
                fontSize: fit.fontSize,
                fontFamily: FONT_FAMILY.Excalifont,
                strokeColor: this.ink(s.color),
              }
            : undefined,
        } as ExcalidrawElementSkeleton)
        autoY = (s.y ?? autoY) + (s.h ?? 70) + 24
      }
    }
    const solidEls: El[] = solid.length ? convertToExcalidrawElements(solid, { regenerateIds: false }) : []
    const newById = new Map<string, El>(solidEls.map((e) => [e.id, e]))

    const resolve = (ref?: string): El | undefined => {
      if (!ref) return undefined
      const real = this.aliases.get(ref) ?? ref
      return newById.get(real) ?? this.byId(ref)
    }

    // Pass 2: arrows and lines.
    const linear: ExcalidrawElementSkeleton[] = []
    const bindings: { arrowId: string; start?: El; end?: El }[] = []
    for (const { shape: s, id } of order) {
      if (s.kind !== "arrow" && s.kind !== "line") continue
      const a = resolve(s.from)
      const b = resolve(s.to)
      let pts: Pt[] = []
      if (a && b) {
        const ba = this.box(a)
        const bb = this.box(b)
        pts = [edgePoint(ba, center(bb), 6, outline(a)), edgePoint(bb, center(ba), 6, outline(b))]
      } else if (s.points && s.points.length >= 2) {
        pts = s.points.map((p) => ({ x: ox + p.x, y: oy + p.y }))
        if (a) pts[0] = edgePoint(this.box(a), pts[1], 6, outline(a))
        if (b) pts[pts.length - 1] = edgePoint(this.box(b), pts[pts.length - 2], 6, outline(b))
      } else {
        if (s.from || s.to) warnings.push(`Arrow "${s.id ?? id}": unknown from/to id (${s.from ?? ""} → ${s.to ?? ""}).`)
        else warnings.push(`Arrow/line "${s.id ?? id}" needs from+to ids or 2+ points.`)
        continue
      }
      const [p0] = pts
      linear.push({
        type: s.kind,
        id,
        x: p0.x,
        y: p0.y,
        points: pts.map((p) => [p.x - p0.x, p.y - p0.y]),
        endArrowhead: s.kind === "arrow" ? "arrow" : null,
        ...common(s),
        label: s.text
          ? { text: s.text, fontSize: FONT_SIZE.s, fontFamily: FONT_FAMILY.Excalifont, strokeColor: this.ink(s.color) }
          : undefined,
      } as ExcalidrawElementSkeleton)
      if (s.kind === "arrow" && (a || b)) bindings.push({ arrowId: id, start: a, end: b })
    }
    let linearEls: El[] = linear.length ? convertToExcalidrawElements(linear, { regenerateIds: false }) : []

    // Bind arrows so they follow the shapes when the student moves them.
    const touched = new Map<string, El>()
    const boundTo = (el: El, arrowId: string) => {
      const cur = touched.get(el.id) ?? newById.get(el.id) ?? el
      const updated = newElementWith(cur, {
        boundElements: [...(cur.boundElements ?? []), { id: arrowId, type: "arrow" }],
      })
      touched.set(el.id, updated)
      if (newById.has(el.id)) newById.set(el.id, updated)
    }
    linearEls = linearEls.map((el) => {
      const bind = bindings.find((b) => b.arrowId === el.id)
      if (!bind || el.type !== "arrow") return el
      if (bind.start) boundTo(bind.start, el.id)
      if (bind.end) boundTo(bind.end, el.id)
      return newElementWith(el as ExcalidrawLinearElement, {
        startBinding: bind.start ? { elementId: bind.start.id, focus: 0, gap: 6 } : null,
        endBinding: bind.end ? { elementId: bind.end.id, focus: 0, gap: 6 } : null,
      } as Partial<ExcalidrawLinearElement>)
    })
    const existingPatches = [...touched.values()].filter((e) => !newById.has(e.id) || !solidEls.some((s) => s.id === e.id))

    // Reveal groups in the order the tutor listed them: [element, ...its bound text].
    const all = [...solidEls.map((e) => newById.get(e.id) ?? e), ...linearEls]
    const groups: El[][] = []
    for (const { id } of order) {
      const main = all.find((e) => e.id === id)
      if (!main) continue
      groups.push([main, ...all.filter((e) => (e as ExcalidrawTextElement).containerId === id)])
    }
    return { groups, all, existingPatches: existingPatches.filter((e) => !all.some((a) => a.id === e.id)) }
  }

  /** Animate one element into the scene, frame by frame, with the tutor cursor. */
  private async reveal(el: El) {
    // Nobody is watching a hidden tab: place the element instantly.
    const k = pageHidden() ? 0 : SPEED[this.status.speed]
    if (k === 0 || this.cancelled) {
      this.upsert([el])
      return
    }
    if (el.type === "text") {
      const t = el as ExcalidrawTextElement
      if (t.containerId) {
        this.upsert([el])
        return
      }
      await this.moveCursor({ x: t.x, y: t.y + t.height / 2 })
      const per = Math.max(1, Math.round(2 / k))
      let cur: El = newElementWith(t, { text: "", originalText: "" })
      for (let i = per; i < t.text.length && !this.cancelled; i += per) {
        const partial = t.text.slice(0, i)
        cur = newElementWith(cur as ExcalidrawTextElement, { text: partial, originalText: partial })
        this.upsert([cur])
        const line = partial.split("\n")
        this.setCursor({
          x: t.x + Math.min(t.width, (line.at(-1)!.length / Math.max(1, ...t.text.split("\n").map((l) => l.length))) * t.width),
          y: t.y + (line.length - 0.5) * t.fontSize * t.lineHeight,
        })
        await nextFrame()
      }
      this.upsert([newElementWith(cur as ExcalidrawTextElement, { text: t.text, originalText: t.originalText })])
      return
    }

    if (el.type === "arrow" || el.type === "line") {
      const l = el as ExcalidrawLinearElement
      const full = l.points.map(([x, y]) => ({ x, y }))
      await this.moveCursor({ x: l.x + full[0].x, y: l.y + full[0].y })
      const frames = Math.max(4, Math.round(Math.min(40, full.length * 0.6 + 10) * k))
      let cur: El = l
      for (let i = 1; i < frames && !this.cancelled; i++) {
        const prefix = polylinePrefix(full, easeOut(i / frames))
        if (prefix.length < 2) continue
        cur = newElementWith(cur as ExcalidrawLinearElement, {
          points: prefix.map((p) => [p.x, p.y]),
        } as Partial<ExcalidrawLinearElement>)
        this.upsert([cur])
        const tip = prefix.at(-1)!
        this.setCursor({ x: l.x + tip.x, y: l.y + tip.y })
        await nextFrame()
      }
      this.upsert([newElementWith(cur as ExcalidrawLinearElement, { points: l.points } as Partial<ExcalidrawLinearElement>)])
      return
    }

    // Shapes: sweep out from the top-left corner.
    await this.moveCursor({ x: el.x, y: el.y })
    const frames = Math.max(3, Math.round(10 * k))
    let cur: El = el
    for (let i = 1; i < frames && !this.cancelled; i++) {
      const t = easeOut(i / frames)
      cur = newElementWith(cur, { width: Math.max(1, el.width * t), height: Math.max(1, el.height * t) })
      this.upsert([cur])
      this.setCursor({ x: el.x + el.width * t, y: el.y + el.height * t })
      await nextFrame()
    }
    this.upsert([newElementWith(cur, { width: el.width, height: el.height })])
  }

  private async animate(groups: El[][], patches: El[]) {
    const first = groups.flat()
    this.scrollTo(first)
    if (patches.length) this.upsert(patches)
    for (const group of groups) {
      for (const el of group) await this.reveal(el)
    }
    // Commit the whole step as a single undoable change.
    const latest = new Map(this.api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]))
    this.upsert(
      first.map((e) => latest.get(e.id) ?? e),
      CaptureUpdateAction.IMMEDIATELY
    )
  }

  private addStep(step: Omit<LessonStep, "at">) {
    this.patch({
      steps: [...this.status.steps.filter((s) => s.id !== step.id), { ...step, at: Date.now() }],
    })
  }

  private summary(els: El[]) {
    const ids: Record<string, string> = {}
    for (const [alias, real] of this.aliases) if (els.some((e) => e.id === real)) ids[alias] = real
    const b = union(els.map((e) => this.box(e)))
    return {
      bounds: b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
      ids,
    }
  }

  // --------------------------------------------------------- tool calls

  draw(input: DrawInput, stepId: string): Promise<ToolResult> {
    return this.enqueue(`Drawing: ${input.title}`, async () => {
      const warnings: string[] = []
      const { groups, all, existingPatches } = this.build(input.shapes, { ...input, step: stepId }, warnings)
      if (!all.length) return { ok: false, error: "Nothing could be drawn.", warnings }
      await this.animate(groups, existingPatches)
      this.addStep({ id: stepId, title: input.title, kind: "draw", elementIds: all.map((e) => e.id) })
      return { ok: true, ...this.summary(all), ...(warnings.length ? { warnings } : {}) }
    })
  }

  plot(input: PlotToolInput, stepId: string): Promise<ToolResult> {
    const title = input.title ?? input.functions.map((f) => f.label ?? f.expr).join(", ")
    return this.enqueue(`Plotting: ${title}`, async () => {
      const { shapes, warnings } = await plotToShapes(input)
      const { groups, all } = this.build(shapes, { near: input.near, step: stepId }, warnings)
      await this.animate(groups, [])
      this.addStep({ id: stepId, title: `Graph: ${title}`, kind: "plot", elementIds: all.map((e) => e.id) })
      return { ok: true, ...this.summary(all), ...(warnings.length ? { warnings } : {}) }
    })
  }

  annotate(input: AnnotateInput, stepId: string): Promise<ToolResult> {
    return this.enqueue("Marking up the board", async () => {
      const targets = input.targets.map((t) => this.byId(t)).filter((e): e is El => !!e)
      const missing = input.targets.filter((t) => !this.byId(t))
      if (!targets.length) return { ok: false, error: `Unknown ids: ${missing.join(", ")}` }
      const b = union(targets.map((e) => this.box(e)))!
      const color: Color = input.color ?? (input.style === "check" ? "green" : input.style === "highlight" ? "orange" : "red")
      const shapes: DrawShape[] = []
      const p = 14
      switch (input.style) {
        case "circle":
          shapes.push({ kind: "ellipse", id: "mark", x: b.x - p * 1.6, y: b.y - p, w: b.w + p * 3.2, h: b.h + p * 2, color })
          break
        case "highlight":
          shapes.push({ kind: "rect", id: "mark", x: b.x - 8, y: b.y - 6, w: b.w + 16, h: b.h + 12, color, fill: true })
          break
        case "underline":
          shapes.push({ kind: "line", id: "mark", points: [{ x: b.x - 4, y: b.y + b.h + 8 }, { x: b.x + b.w + 4, y: b.y + b.h + 6 }], color })
          break
        case "check": {
          const x = b.x + b.w + 18
          const y = b.y + b.h / 2
          shapes.push({ kind: "line", id: "mark", points: [{ x, y }, { x: x + 10, y: y + 14 }, { x: x + 30, y: y - 18 }], color })
          break
        }
        case "cross": {
          const x = b.x + b.w + 18
          const y = b.y + b.h / 2 - 12
          shapes.push({ kind: "line", id: "mark", points: [{ x, y }, { x: x + 24, y: y + 24 }], color })
          shapes.push({ kind: "line", id: "mark2", points: [{ x: x + 24, y }, { x, y: y + 24 }], color })
          break
        }
        case "arrow":
          break
      }
      if (input.note) {
        const nx = b.x + b.w + (input.style === "check" || input.style === "cross" ? 70 : 60)
        shapes.push({ kind: "text", id: "note", x: nx, y: b.y - 6, text: input.note, color, size: "s", w: 300 })
        if (input.style === "arrow" || input.style === "circle") {
          shapes.push({ kind: "arrow", points: [{ x: nx - 6, y: b.y + 6 }, { x: b.x + b.w + 6, y: b.y + b.h / 2 }], color })
        }
      } else if (input.style === "arrow") {
        shapes.push({ kind: "arrow", points: [{ x: b.x + b.w + 80, y: b.y - 40 }, { x: b.x + b.w + 6, y: b.y + b.h / 2 }], color })
      }

      // Annotations use absolute scene coordinates: build at the origin and skip auto placement.
      const warnings: string[] = []
      const { groups, all } = this.buildAbsolute(shapes, stepId, warnings)
      await this.animate(groups, [])
      // Put highlights behind what they mark.
      if (input.style === "highlight") this.sendToBack(all.map((e) => e.id))
      this.addStep({ id: stepId, title: input.note ? `Note: ${input.note}` : `Marked ${input.style}`, kind: "annotate", elementIds: all.map((e) => e.id) })
      return { ok: true, ...this.summary(all), ...(missing.length ? { warnings: [`Unknown ids: ${missing.join(", ")}`] } : {}) }
    })
  }

  private buildAbsolute(shapes: DrawShape[], step: string, warnings: string[]) {
    // build() normalises to the panel's top-left; pin that top-left to where it already is.
    const pts = shapes.flatMap((s) => (s.points?.length ? s.points : [{ x: s.x ?? 0, y: s.y ?? 0 }]))
    const minX = Math.min(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const saved = this.placeOrigin
    this.placeOrigin = () => ({ x: minX, y: minY })
    try {
      return this.build(shapes, { step }, warnings)
    } finally {
      this.placeOrigin = saved
    }
  }

  private sendToBack(ids: string[]) {
    const scene = this.api.getSceneElementsIncludingDeleted()
    const set = new Set(ids)
    const back = scene.filter((e) => set.has(e.id))
    const rest = scene.filter((e) => !set.has(e.id))
    this.api.updateScene({
      elements: [...back, ...rest].map((e) => (set.has(e.id) ? newElementWith(e, {}) : e)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }

  pointAt(input: PointAtInput): Promise<ToolResult> {
    return this.enqueue("Pointing", async () => {
      const targets = input.targets.map((t) => this.byId(t)).filter((e): e is El => !!e)
      if (!targets.length) return { ok: false, error: `Unknown ids: ${input.targets.join(", ")}` }
      this.scrollTo(targets)
      const b = pad(union(targets.map((e) => this.box(e)))!, 18)
      const c = center(b)
      const start = { x: c.x + b.w / 2, y: c.y }
      await this.moveCursor(start, { caption: input.caption })
      const loops = this.status.speed === "instant" || pageHidden() ? 0 : 2
      const steps = Math.round(36 * Math.max(0.5, SPEED[this.status.speed]))
      for (let i = 0; i <= steps * loops && !this.cancelled; i++) {
        const a = (i / steps) * Math.PI * 2
        this.setCursor({ x: c.x + Math.cos(a) * (b.w / 2), y: c.y + Math.sin(a) * (b.h / 2) }, { laser: true, caption: input.caption })
        await nextFrame()
      }
      this.setCursor(start, { caption: input.caption })
      this.cursorPos = start
      await new Promise((r) => setTimeout(r, input.caption ? 1400 : 500))
      return { ok: true }
    })
  }

  erase(input: EraseInput): Promise<ToolResult> {
    return this.enqueue("Erasing", async () => {
      const scene = this.live()
      const ids = new Set((input.ids ?? []).map((i) => this.aliases.get(i) ?? i))
      const targets = scene.filter((e) => {
        if (!isTutor(e)) return false
        if (input.all) return true
        return ids.has(e.id) || ((e as ExcalidrawTextElement).containerId && ids.has((e as ExcalidrawTextElement).containerId!))
      })
      if (!targets.length) return { ok: false, error: "Nothing of yours matched those ids." }
      this.upsert(targets.map((e) => newElementWith(e, { isDeleted: true })), CaptureUpdateAction.IMMEDIATELY)
      const gone = new Set(targets.map((e) => e.id))
      this.patch({
        steps: this.status.steps
          .map((s) => ({ ...s, elementIds: s.elementIds.filter((id) => !gone.has(id)) }))
          .filter((s) => s.elementIds.length),
      })
      return { ok: true, erased: targets.length }
    })
  }

  askStudent(input: AskStudentInput, stepId: string): Promise<ToolResult> {
    return this.enqueue("Handing you the pen", async () => {
      const w = input.width ?? 480
      const h = input.height ?? 300
      const warnings: string[] = []
      const label = `Your turn: ${input.task}`
      // Same wrapping as build() so the frame starts below every label line.
      const labelLines = wrapText(label, Math.max(12, Math.floor(w / (FONT_SIZE.m * 0.55)))).split("\n").length
      const { groups, all } = this.build(
        [
          { kind: "text", id: "your-turn-label", x: 0, y: 0, text: label, color: "purple", size: "m", w },
          { kind: "rect", id: "your-turn", x: 0, y: labelLines * FONT_SIZE.m * 1.35 + 18, w, h, color: "purple", dashed: true },
        ],
        { near: input.near, step: stepId },
        warnings
      )
      await this.animate(groups, [])
      const frame = all.find((e) => e.type === "rectangle")!
      this.addStep({ id: stepId, title: `Your turn: ${input.task}`, kind: "task", elementIds: all.map((e) => e.id) })
      this.patch({ yourTurn: { frameId: frame.id, task: input.task }, studentDirty: false })
      return {
        ok: true,
        frame: this.summary([frame]).bounds,
        frameId: frame.id,
        note: "The student is now working. Stop and wait for their reply.",
      }
    })
  }

  /** Pin an image (Wikimedia result, PDF page, attachment) onto the board, with a caption. */
  addImage(src: { url: string; title: string; width?: number; height?: number; credit?: string }) {
    return this.enqueue("Pinning image", async () => {
      // Same-origin (PDF page renders) and data URLs load directly; remote images go through the proxy.
      const direct = src.url.startsWith("/") || src.url.startsWith("data:")
      const res = await fetch(direct ? src.url : `/api/image?url=${encodeURIComponent(src.url)}`)
      if (!res.ok) throw new Error(`Could not load image (${res.status})`)
      const blob = await res.blob()
      if (!src.width || !src.height) {
        const bitmap = await createImageBitmap(blob).catch(() => null)
        if (bitmap) src = { ...src, width: bitmap.width, height: bitmap.height }
      }
      const dataURL = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      const fileId = `img-${Date.now().toString(36)}` as never
      this.api.addFiles([
        { id: fileId, dataURL: dataURL as never, mimeType: blob.type as never, created: Date.now() },
      ])
      const w = 380
      const h = Math.round(w * (src.height && src.width ? src.height / src.width : 0.7))
      const origin = this.placeOrigin({ w, h: h + 40 }, { placement: "right" })
      const stepId = `image-${fileId}`
      const els = convertToExcalidrawElements(
        [
          {
            type: "image",
            id: this.uniqueId("image"),
            x: origin.x,
            y: origin.y,
            width: w,
            height: h,
            fileId,
            status: "saved",
            customData: { author: "tutor", step: stepId },
          } as ExcalidrawElementSkeleton,
          {
            type: "text",
            id: this.uniqueId("image-caption"),
            x: origin.x,
            y: origin.y + h + 8,
            text: wrapText(`${src.title}${src.credit ? ` — ${src.credit}` : ""}`, 46),
            fontSize: 14,
            fontFamily: FONT_FAMILY.Excalifont,
            strokeColor: INK.gray,
            customData: { author: "tutor", step: stepId },
          } as ExcalidrawElementSkeleton,
        ],
        { regenerateIds: false }
      )
      this.scrollTo(els)
      await this.moveCursor({ x: origin.x, y: origin.y })
      this.upsert(els, CaptureUpdateAction.IMMEDIATELY)
      this.addStep({ id: stepId, title: `Image: ${src.title}`, kind: "image", elementIds: els.map((e) => e.id) })
    })
  }

  focusStep(stepId: string) {
    const step = this.status.steps.find((s) => s.id === stepId)
    if (!step) return
    const els = this.live().filter((e) => step.elementIds.includes(e.id))
    if (els.length)
      this.api.scrollToContent(els as El[], { fitToViewport: true, viewportZoomFactor: 0.55, animate: true, duration: 450 })
  }

  focusAll() {
    this.api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true })
  }

  clearBoard() {
    this.cancel()
    this.upsert(this.live().map((e) => newElementWith(e, { isDeleted: true })), CaptureUpdateAction.IMMEDIATELY)
    this.aliases.clear()
    this.patch({ steps: [], yourTurn: null, studentDirty: false })
  }

  // ----------------------------------------------------- model's view

  /** Compact text description of the board for the model. */
  describe(): string {
    const scene = this.live()
    if (!scene.length) return ""
    const v = this.viewport()
    const r = Math.round
    const reverse = new Map([...this.aliases].map(([a, real]) => [real, a]))
    const labels = new Map<string, string>()
    for (const e of scene) {
      const t = e as ExcalidrawTextElement
      if (e.type === "text" && t.containerId) labels.set(t.containerId, t.text)
    }
    const shown = scene.filter((e) => !(e.type === "text" && (e as ExcalidrawTextElement).containerId))
    const recent = shown.slice(-140)
    const lines = recent.map((e) => {
      const b = this.box(e)
      const who = isTutor(e) ? "T" : "S"
      const text = e.type === "text" ? (e as ExcalidrawTextElement).text : labels.get(e.id)
      let extra = ""
      if (e.type === "arrow") {
        const l = e as ExcalidrawLinearElement
        const from = l.startBinding?.elementId
        const to = l.endBinding?.elementId
        if (from || to) extra = ` ${from ?? "?"}→${to ?? "?"}`
      }
      const alias = reverse.get(e.id)
      return `${who} | ${e.id}${alias && alias !== e.id ? ` (${alias})` : ""} | ${e.type}${extra} | ${r(b.x)},${r(b.y)},${r(b.w)}x${r(b.h)}${text ? ` | "${text.replace(/\n/g, " / ").slice(0, 120)}"` : ""}`
    })

    const out = [
      `Viewport (what the student sees): x ${r(v.x)}..${r(v.x + v.w)}, y ${r(v.y)}..${r(v.y + v.h)}`,
      `Elements (${shown.length}${shown.length > recent.length ? `, newest ${recent.length} shown` : ""}) — author | id | type | x,y,wxh | text:`,
      ...lines,
    ]
    if (this.status.selection.length) {
      out.push(`STUDENT SELECTED: ${this.status.selection.join(", ")} — their message is about these.`)
    }
    const turn = this.status.yourTurn
    if (turn) {
      const frame = this.byId(turn.frameId)
      if (frame) {
        const fb = this.box(frame)
        const inside = shown.filter((e) => !isTutor(e) && contains(pad(fb, 30), this.box(e))).map((e) => e.id)
        out.push(
          `OPEN TASK "${turn.task}" in frame ${turn.frameId}. Student elements inside it (their answer): ${inside.join(", ") || "none yet"}.`
        )
      }
    }
    return out.join("\n")
  }

  /** JPEG snapshot of the whole board as a data URL (null when empty). */
  async snapshot(): Promise<string | null> {
    const elements = this.live()
    if (!elements.length) return null
    const blob = await exportToBlob({
      elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
      files: this.api.getFiles(),
      mimeType: "image/jpeg",
      quality: 0.82,
      maxWidthOrHeight: 1280,
      exportPadding: 24,
    })
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }
}
