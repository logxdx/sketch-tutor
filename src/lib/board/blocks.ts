import type { COLORS } from "@/lib/agent/schemas"
import { blockWidth, textHeight, wrapToWidth } from "./text-metrics"
import type { Block, ComposeInput, DrawShape } from "./types"

/**
 * The board's component catalog. The tutor sends content (`compose` blocks); this lays it out as
 * the same primitive shapes `draw` uses — sized from measured text, so nothing overlaps — and
 * stacks the blocks into one panel. Structured visuals need no coordinates from the model.
 */

type Color = (typeof COLORS)[number]
const FS = { s: 16, m: 20, l: 28 } as const
const BLOCK_GAP = 30
const PALETTE: Color[] = ["blue", "orange", "green", "purple", "teal", "red"]

type Rendered = { shapes: DrawShape[]; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** Height of `text` wrapped to `width` at `size`. */
const tall = (text: string, width: number, size: number) => textHeight(wrapToWidth(text, width, size).split("\n").length, size)
/** Width of `text` wrapped to `width` (≤ width). */
const wide = (text: string, width: number, size: number) => Math.min(width, blockWidth(wrapToWidth(text, width, size), size))
/** A labelled box tall enough for its label. */
const boxHeight = (label: string, w: number, min = 64) => Math.max(min, tall(label, w - 28, FS.m) + 30)

function shift(s: DrawShape, dx: number, dy: number): DrawShape {
  return {
    ...s,
    x: s.x === undefined ? undefined : s.x + dx,
    y: s.y === undefined ? undefined : s.y + dy,
    points: s.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }
}

export function layoutBlocks(input: ComposeInput): DrawShape[] {
  const W = clamp(input.width ?? 640, 320, 1400)
  const out: DrawShape[] = []
  let y = 0
  input.blocks.forEach((b, i) => {
    const r = render(b, `b${i + 1}`, W)
    out.push(...r.shapes.map((s) => shift(s, 0, y)))
    y += r.h + BLOCK_GAP
  })
  return out
}

function render(b: Block, k: string, W: number): Rendered {
  switch (b.type) {
    case "heading":
      return { shapes: [{ kind: "text", id: k, x: 0, y: 0, text: b.text, size: "l", w: W }], w: W, h: tall(b.text, W, FS.l) }
    case "text":
      return { shapes: [{ kind: "text", id: k, x: 0, y: 0, text: b.text, size: "m", w: W, color: b.color }], w: W, h: tall(b.text, W, FS.m) }
    case "bullets":
      return bullets(b.items, k, 0, 0, W, "m", b.color)
    case "steps":
      return steps(b, k, W)
    case "flow":
      return flow(b, W)
    case "cycle":
      return cycle(b, k)
    case "compare":
      return compare(b, k, W)
    case "table":
      return table(b, k, W)
    case "timeline":
      return timeline(b, k, W)
    case "equation":
      return equation(b, k, W)
    case "callout":
      return callout(b, k, W)
    case "tree":
      return tree(b, k, W)
    case "number_line":
      return numberLine(b, k, W)
  }
}

function bullets(items: string[], k: string, x0: number, y0: number, w: number, size: "s" | "m", color?: Color): Rendered {
  const shapes: DrawShape[] = []
  const fs = FS[size]
  let y = y0
  items.forEach((item, i) => {
    shapes.push({ kind: "text", id: `${k}-dot-${i + 1}`, x: x0, y, text: "•", size, color })
    shapes.push({ kind: "text", id: `${k}-${i + 1}`, x: x0 + fs * 1.1, y, text: item, size, w: w - fs * 1.1, color })
    y += tall(item, w - fs * 1.1, fs) + 8
  })
  return { shapes, w, h: y - y0 - 8 }
}

function steps(b: Extract<Block, { type: "steps" }>, k: string, W: number): Rendered {
  const color = b.color ?? "blue"
  const items = b.items.map((t, i) => `${i + 1}. ${t}`)
  const shapes: DrawShape[] = []
  const id = (i: number) => `${k}-step-${i + 1}`
  if (b.direction === "down") {
    const bw = Math.min(W, 440)
    let y = 0
    items.forEach((t, i) => {
      const h = boxHeight(t, bw)
      shapes.push({ kind: "rect", id: id(i), x: 0, y, w: bw, h, text: t, color, fill: true })
      y += h + 44
    })
    for (let i = 1; i < items.length; i++) shapes.push({ kind: "arrow", from: id(i - 1), to: id(i), color: "gray" })
    return { shapes, w: bw, h: y - 44 }
  }
  const gap = 52
  const perRow = clamp(Math.floor((W + gap) / (150 + gap)), 1, items.length)
  const bw = Math.min(240, (W - (perRow - 1) * gap) / perRow)
  let y = 0
  for (let r = 0; r * perRow < items.length; r++) {
    const row = items.slice(r * perRow, r * perRow + perRow)
    const h = Math.max(...row.map((t) => boxHeight(t, bw)))
    row.forEach((t, j) => shapes.push({ kind: "rect", id: id(r * perRow + j), x: j * (bw + gap), y, w: bw, h, text: t, color, fill: true }))
    y += h + 56
  }
  for (let i = 1; i < items.length; i++) shapes.push({ kind: "arrow", from: id(i - 1), to: id(i), color: "gray" })
  return { shapes, w: Math.min(W, perRow * (bw + gap) - gap), h: y - 56 }
}

function flow(b: Extract<Block, { type: "flow" }>, W: number): Rendered {
  const nodes = b.nodes
  const ids = new Set(nodes.map((n) => n.id))
  const edges = b.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
  // Longest-path layers (capped, so cycles can't loop forever).
  const depth = new Map(nodes.map((n) => [n.id, 0]))
  for (let it = 0; it < nodes.length; it++) {
    for (const e of edges) {
      const d = depth.get(e.from)! + 1
      if (d > depth.get(e.to)! && d < nodes.length) depth.set(e.to, d)
    }
  }
  const layers: typeof nodes[] = []
  for (const n of nodes) (layers[depth.get(n.id)!] ??= []).push(n)
  const cols = layers.filter(Boolean)
  const shapes: DrawShape[] = []
  const nw = 180
  if (b.direction === "down") {
    const rowGap = 70
    let y = 0
    let maxW = 0
    const rowW = (row: typeof nodes) => row.length * nw + (row.length - 1) * 36
    for (const row of cols) maxW = Math.max(maxW, rowW(row))
    for (const row of cols) {
      const h = Math.max(...row.map((n) => boxHeight(n.label, nw)))
      const x0 = (maxW - rowW(row)) / 2
      row.forEach((n, j) => shapes.push({ kind: "rect", id: n.id, x: x0 + j * (nw + 36), y, w: nw, h, text: n.label, color: n.color ?? "blue", fill: true }))
      y += h + rowGap
    }
    for (const e of edges) shapes.push({ kind: "arrow", from: e.from, to: e.to, text: e.label, color: "gray" })
    return { shapes, w: Math.max(maxW, Math.min(W, maxW)), h: y - rowGap }
  }
  const colGap = 90
  const heights = cols.map((col) => col.map((n) => boxHeight(n.label, nw)))
  const colH = heights.map((hs) => hs.reduce((a, h) => a + h, 0) + (hs.length - 1) * 26)
  const maxH = Math.max(...colH)
  cols.forEach((col, ci) => {
    let y = (maxH - colH[ci]) / 2
    col.forEach((n, ri) => {
      shapes.push({ kind: "rect", id: n.id, x: ci * (nw + colGap), y, w: nw, h: heights[ci][ri], text: n.label, color: n.color ?? "blue", fill: true })
      y += heights[ci][ri] + 26
    })
  })
  for (const e of edges) shapes.push({ kind: "arrow", from: e.from, to: e.to, text: e.label, color: "gray" })
  return { shapes, w: cols.length * (nw + colGap) - colGap, h: maxH }
}

function cycle(b: Extract<Block, { type: "cycle" }>, k: string): Rendered {
  const n = b.items.length
  const nw = 160
  const hs = b.items.map((t) => boxHeight(t, nw, 70) + 10)
  const R = Math.max(175, n * 50)
  const maxH = Math.max(...hs)
  const cx = R + nw / 2
  const cy = R + maxH / 2
  const shapes: DrawShape[] = []
  const id = (i: number) => `${k}-stage-${i + 1}`
  b.items.forEach((t, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    shapes.push({ kind: "ellipse", id: id(i), x: cx + R * Math.cos(a) - nw / 2, y: cy + R * Math.sin(a) - hs[i] / 2, w: nw, h: hs[i], text: t, color: b.color ?? PALETTE[i % PALETTE.length], fill: true })
  })
  for (let i = 0; i < n; i++) shapes.push({ kind: "arrow", from: id(i), to: id((i + 1) % n), color: "gray" })
  if (b.center) {
    const cw = Math.min(160, R - 20)
    shapes.push({ kind: "text", id: `${k}-center`, x: cx - wide(b.center, cw, FS.m) / 2, y: cy - tall(b.center, cw, FS.m) / 2, text: b.center, size: "m", w: cw })
  }
  return { shapes, w: 2 * R + nw, h: 2 * R + maxH }
}

function compare(b: Extract<Block, { type: "compare" }>, k: string, W: number): Rendered {
  const n = b.columns.length
  const gap = 24
  const cw = (W - (n - 1) * gap) / n
  const shapes: DrawShape[] = []
  const heads = b.columns.map((c) => boxHeight(c.title, cw, 52))
  const headH = Math.max(...heads)
  const bodies = b.columns.map((c) => bullets(c.items, `${k}-col-${0}`, 0, 0, cw - 28, "s"))
  const bodyH = Math.max(40, ...bodies.map((r) => r.h)) + 28
  b.columns.forEach((c, i) => {
    const x = i * (cw + gap)
    const color = c.color ?? PALETTE[i % PALETTE.length]
    shapes.push({ kind: "rect", id: `${k}-col-${i + 1}`, x, y: 0, w: cw, h: headH, text: c.title, color, fill: true })
    shapes.push({ kind: "rect", id: `${k}-col-${i + 1}-body`, x, y: headH, w: cw, h: bodyH, color })
    const body = bullets(c.items, `${k}-col-${i + 1}`, x + 14, headH + 14, cw - 28, "s")
    shapes.push(...body.shapes)
  })
  return { shapes, w: W, h: headH + bodyH }
}

function table(b: Extract<Block, { type: "table" }>, k: string, W: number): Rendered {
  const cols = b.headers.length
  const rows = [b.headers, ...b.rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""))]
  const natural = Array.from({ length: cols }, (_, c) =>
    clamp(Math.max(...rows.map((r) => blockWidth(r[c], FS.s))) + 24, 70, 320)
  )
  const total = natural.reduce((a, w) => a + w, 0)
  const widths = total > W ? natural.map((w) => Math.max(70, (w * W) / total)) : natural
  const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? 0) + (i ? widths[i - 1] : 0)], [])
  const heights = rows.map((r) => Math.max(...r.map((cell, c) => tall(cell || " ", widths[c] - 16, FS.s))) + 16)
  const tw = widths.reduce((a, w) => a + w, 0)
  const th = heights.reduce((a, h) => a + h, 0)
  const shapes: DrawShape[] = [
    { kind: "rect", id: `${k}-head`, x: 0, y: 0, w: tw, h: heights[0], color: "gray", fill: true },
    { kind: "rect", id: `${k}`, x: 0, y: 0, w: tw, h: th, color: "gray" },
  ]
  let y = 0
  rows.forEach((r, ri) => {
    r.forEach((cell, c) => {
      if (cell) shapes.push({ kind: "text", id: `${k}-r${ri}c${c + 1}`, x: xs[c] + 8, y: y + 8, text: cell, size: "s", w: widths[c] - 16, color: ri === 0 ? "black" : undefined })
    })
    y += heights[ri]
    if (ri < rows.length - 1) shapes.push({ kind: "line", points: [{ x: 0, y }, { x: tw, y }], color: "gray" })
  })
  for (let c = 1; c < cols; c++) shapes.push({ kind: "line", points: [{ x: xs[c], y: 0 }, { x: xs[c], y: th }], color: "gray" })
  return { shapes, w: tw, h: th }
}

function timeline(b: Extract<Block, { type: "timeline" }>, k: string, W: number): Rendered {
  const n = b.events.length
  const slot = W / n
  const lineY = 50
  const shapes: DrawShape[] = [{ kind: "arrow", id: `${k}-axis`, points: [{ x: 0, y: lineY }, { x: W, y: lineY }], color: "gray" }]
  let maxBelow = 0
  b.events.forEach((e, i) => {
    const cx = slot * (i + 0.5)
    const tw = slot - 10
    shapes.push({ kind: "line", points: [{ x: cx, y: lineY - 9 }, { x: cx, y: lineY + 9 }], color: "gray" })
    shapes.push({ kind: "text", id: `${k}-when-${i + 1}`, x: cx - wide(e.when, tw, FS.m) / 2, y: lineY - 14 - tall(e.when, tw, FS.m), text: e.when, size: "m", w: tw, color: "blue" })
    shapes.push({ kind: "text", id: `${k}-event-${i + 1}`, x: cx - wide(e.label, tw, FS.s) / 2, y: lineY + 16, text: e.label, size: "s", w: tw })
    maxBelow = Math.max(maxBelow, tall(e.label, tw, FS.s))
  })
  return { shapes: shapes.map((s) => shift(s, 0, 10)), w: W, h: lineY + 26 + maxBelow }
}

function equation(b: Extract<Block, { type: "equation" }>, k: string, W: number): Rendered {
  const shapes: DrawShape[] = []
  let y = 0
  b.lines.forEach((l, i) => {
    const mw = wide(l.math, W, FS.l)
    const mh = tall(l.math, W, FS.l)
    shapes.push({ kind: "text", id: `${k}-line-${i + 1}`, x: 0, y, text: l.math, size: "l", w: W })
    let h = mh
    if (l.note) {
      const room = W - mw - 40
      if (room >= 160) {
        shapes.push({ kind: "text", id: `${k}-note-${i + 1}`, x: mw + 40, y: y + 6, text: l.note, size: "s", w: room, color: "gray" })
        h = Math.max(h, tall(l.note, room, FS.s) + 6)
      } else {
        shapes.push({ kind: "text", id: `${k}-note-${i + 1}`, x: 24, y: y + mh + 2, text: l.note, size: "s", w: W - 24, color: "gray" })
        h += tall(l.note, W - 24, FS.s) + 4
      }
    }
    y += h + 16
  })
  return { shapes, w: W, h: y - 16 }
}

function callout(b: Extract<Block, { type: "callout" }>, k: string, W: number): Rendered {
  const color: Color = b.tone === "warning" ? "red" : b.tone === "tip" ? "green" : "orange"
  const h = tall(b.text, W - 40, FS.m) + 34
  return {
    shapes: [
      { kind: "rect", id: `${k}-box`, x: 0, y: 0, w: W, h, color, fill: true },
      { kind: "text", id: k, x: 20, y: 17, text: b.text, size: "m", w: W - 40 },
    ],
    w: W,
    h,
  }
}

function tree(b: Extract<Block, { type: "tree" }>, k: string, W: number): Rendered {
  const n = b.children.length
  const gap = 24
  const cw = Math.min(220, (W - (n - 1) * gap) / n)
  const rowW = n * cw + (n - 1) * gap
  const rw = Math.min(260, W)
  const rh = boxHeight(b.root, rw)
  const shapes: DrawShape[] = [{ kind: "rect", id: `${k}-root`, x: (rowW - rw) / 2, y: 0, w: rw, h: rh, text: b.root, color: "purple", fill: true }]
  const cy = rh + 64
  const ch = Math.max(...b.children.map((c) => boxHeight(c.label, cw)))
  let deepest = 0
  b.children.forEach((c, i) => {
    const x = i * (cw + gap)
    const id = `${k}-${i + 1}`
    shapes.push({ kind: "rect", id, x, y: cy, w: cw, h: ch, text: c.label, color: PALETTE[i % PALETTE.length], fill: true })
    shapes.push({ kind: "line", from: `${k}-root`, to: id, color: "gray" })
    if (c.children?.length) {
      const list = bullets(c.children, `${id}`, x + 6, cy + ch + 12, cw - 6, "s")
      shapes.push(...list.shapes)
      deepest = Math.max(deepest, list.h + 12)
    }
  })
  return { shapes, w: Math.max(rowW, rw), h: cy + ch + deepest }
}

function niceStep(span: number) {
  const raw = span / 10
  const p = 10 ** Math.floor(Math.log10(raw || 1))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw
}

function numberLine(b: Extract<Block, { type: "number_line" }>, k: string, W: number): Rendered {
  const lo = Math.min(b.min, b.max)
  const hi = Math.max(b.min, b.max)
  const step = b.step && (hi - lo) / b.step <= 40 ? b.step : niceStep(hi - lo)
  const pad = 20
  const X = (v: number) => pad + ((v - lo) / (hi - lo || 1)) * (W - 2 * pad)
  const lineY = 44
  const shapes: DrawShape[] = [{ kind: "arrow", id: `${k}-axis`, points: [{ x: 0, y: lineY }, { x: W, y: lineY }], color: "black" }]
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000)
  for (let v = lo, i = 0; v <= hi + step / 1000 && i < 41; v += step, i++) {
    const x = X(v)
    shapes.push({ kind: "line", points: [{ x, y: lineY - 8 }, { x, y: lineY + 8 }], color: "black" })
    shapes.push({ kind: "text", x: x - wide(fmt(v), 80, FS.s) / 2, y: lineY + 14, text: fmt(v), size: "s", w: 80 })
  }
  ;(b.marks ?? []).forEach((m, i) => {
    const x = X(clamp(m.at, lo, hi))
    const color = m.color ?? "red"
    shapes.push({ kind: "ellipse", id: `${k}-mark-${i + 1}`, x: x - 8, y: lineY - 8, w: 16, h: 16, color, fill: true })
    if (m.label) shapes.push({ kind: "text", id: `${k}-mark-${i + 1}-label`, x: x - wide(m.label, 160, FS.m) / 2, y: 0, text: m.label, size: "m", w: 160, color })
  })
  return { shapes, w: W, h: lineY + 40 }
}
