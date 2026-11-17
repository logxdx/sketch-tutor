import type { DrawShape } from "./types"
import { fmt, niceStep } from "./geometry"

export type PlotInput = {
  title?: string
  functions: { expr: string; label?: string; color?: DrawShape["color"] }[]
  xMin: number
  xMax: number
  yMin?: number
  yMax?: number
  xLabel?: string
  yLabel?: string
  points?: { x: number; y: number; label?: string }[]
}

const PALETTE: NonNullable<DrawShape["color"]>[] = ["blue", "red", "green", "purple"]

function normalizeExpr(expr: string) {
  return expr
    .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, "")
    .replace(/\*\*/g, "^")
    .replace(/[·×]/g, "*")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .trim()
}

/** Turn a plot request into ordinary draw shapes (axes, ticks, curves) in panel coordinates. */
export async function plotToShapes(input: PlotInput): Promise<{
  shapes: DrawShape[]
  warnings: string[]
}> {
  const { compile } = await import("mathjs")
  const warnings: string[] = []
  const W = 560
  const H = 340
  const left = 50
  // Leave room above the plot for the title and the y-axis label beneath it.
  const top = input.title ? 96 : 40
  const N = 240

  let { xMin, xMax } = input
  if (!(xMax > xMin)) [xMin, xMax] = [Math.min(xMin, xMax) || -5, Math.max(xMin, xMax) || 5]
  if (xMin === xMax) xMax = xMin + 1

  const series = input.functions.map((f, i) => {
    const color = f.color ?? PALETTE[i % PALETTE.length]
    let fn: ((x: number) => number) | null = null
    try {
      const code = compile(normalizeExpr(f.expr))
      fn = (x: number) => {
        const v = code.evaluate({ x })
        return typeof v === "number" ? v : Number(v)
      }
    } catch (e) {
      warnings.push(`Could not parse "${f.expr}": ${(e as Error).message}`)
    }
    const samples: { x: number; y: number }[] = []
    if (fn) {
      for (let i = 0; i <= N; i++) {
        const x = xMin + ((xMax - xMin) * i) / N
        let y = NaN
        try {
          y = fn(x)
        } catch {
          /* outside domain */
        }
        samples.push({ x, y })
      }
    }
    return { ...f, color, samples }
  })

  // y-range: given, or robust auto-range (ignore asymptote spikes).
  let { yMin, yMax } = input
  if (yMin === undefined || yMax === undefined) {
    const ys = series
      .flatMap((s) => s.samples.map((p) => p.y))
      .concat((input.points ?? []).map((p) => p.y))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
    if (ys.length) {
      const lo = ys[Math.floor(ys.length * 0.03)]
      const hi = ys[Math.ceil(ys.length * 0.97) - 1]
      const span = hi - lo || Math.abs(hi) || 1
      yMin ??= lo - span * 0.1
      yMax ??= hi + span * 0.1
    } else {
      yMin ??= -5
      yMax ??= 5
    }
  }
  if (!(yMax! > yMin!)) yMax = yMin! + 1
  const Y0 = yMin!
  const Y1 = yMax!

  const sx = (x: number) => left + ((x - xMin) / (xMax - xMin)) * W
  const sy = (y: number) => top + H - ((y - Y0) / (Y1 - Y0)) * H

  const shapes: DrawShape[] = []
  if (input.title) {
    shapes.push({ kind: "text", x: left, y: 0, text: input.title, size: "l" })
  }

  // Axes: through zero when visible, otherwise along the plot edges.
  const axisY = Y0 <= 0 && Y1 >= 0 ? sy(0) : top + H
  const axisX = xMin <= 0 && xMax >= 0 ? sx(0) : left
  shapes.push({
    kind: "arrow",
    id: "x-axis",
    points: [
      { x: left - 10, y: axisY },
      { x: left + W + 20, y: axisY },
    ],
    color: "gray",
  })
  shapes.push({
    kind: "arrow",
    id: "y-axis",
    points: [
      { x: axisX, y: top + H + 10 },
      { x: axisX, y: top - 20 },
    ],
    color: "gray",
  })
  shapes.push({
    kind: "text",
    x: left + W + 26,
    y: axisY - 12,
    text: input.xLabel ?? "x",
    size: "s",
    color: "gray",
  })
  shapes.push({
    kind: "text",
    x: axisX + 8,
    y: top - 34,
    text: input.yLabel ?? "y",
    size: "s",
    color: "gray",
  })

  // Tick labels.
  const xs = niceStep(xMax - xMin)
  for (let v = Math.ceil(xMin / xs) * xs; v <= xMax + 1e-9; v += xs) {
    if (Math.abs(v) < xs / 1e6 && axisX === sx(0)) continue
    shapes.push({ kind: "text", x: sx(v) - 8, y: axisY + 6, text: fmt(v), size: "s", color: "gray" })
  }
  const ysStep = niceStep(Y1 - Y0)
  for (let v = Math.ceil(Y0 / ysStep) * ysStep; v <= Y1 + 1e-9; v += ysStep) {
    if (Math.abs(v) < ysStep / 1e6 && axisY === sy(0)) continue
    shapes.push({
      kind: "text",
      x: axisX - 10 - fmt(v).length * 9,
      y: sy(v) - 10,
      text: fmt(v),
      size: "s",
      color: "gray",
    })
  }

  // Curves, split at gaps / jumps / leaving the plot area.
  const range = Y1 - Y0
  series.forEach((s, si) => {
    let seg: { x: number; y: number }[] = []
    const segments: (typeof seg)[] = []
    let prev: number | null = null
    for (const p of s.samples) {
      const ok = Number.isFinite(p.y) && p.y >= Y0 - range * 0.02 && p.y <= Y1 + range * 0.02
      const jump = prev !== null && Number.isFinite(p.y) && Math.abs(p.y - prev) > range * 0.9
      if (!ok || jump) {
        if (seg.length > 1) segments.push(seg)
        seg = []
      }
      if (ok) seg.push({ x: sx(p.x), y: sy(Math.min(Y1, Math.max(Y0, p.y))) })
      prev = Number.isFinite(p.y) ? p.y : null
    }
    if (seg.length > 1) segments.push(seg)
    if (!segments.length && s.samples.length) warnings.push(`"${s.expr}" has no visible values in this range.`)

    segments.forEach((pts, k) => {
      // Downsample long segments: ~80 points is smooth enough and animates nicely.
      const step = Math.max(1, Math.ceil(pts.length / 80))
      const thin = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
      shapes.push({ kind: "line", id: `curve-${si + 1}${k ? `-${k}` : ""}`, points: thin, color: s.color })
    })

    const last = segments.at(-1)?.at(-1)
    if (last && (s.label || input.functions.length > 1)) {
      shapes.push({
        kind: "text",
        x: Math.min(last.x + 8, left + W - 40),
        y: last.y - 26,
        text: s.label ?? s.expr,
        size: "s",
        color: s.color,
      })
    }
  })

  for (const [i, p] of (input.points ?? []).entries()) {
    if (p.y < Y0 || p.y > Y1 || p.x < xMin || p.x > xMax) continue
    shapes.push({
      kind: "ellipse",
      id: `point-${i + 1}`,
      x: sx(p.x) - 6,
      y: sy(p.y) - 6,
      w: 12,
      h: 12,
      color: "orange",
      fill: true,
    })
    if (p.label) {
      shapes.push({
        kind: "text",
        x: sx(p.x) + 10,
        y: sy(p.y) - 30,
        text: p.label,
        size: "s",
        color: "orange",
      })
    }
  }

  return { shapes, warnings }
}
