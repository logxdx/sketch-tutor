"use client"

import * as React from "react"
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@ui-sdk/react/slider"
import type { z } from "zod"

import type { exploreInput } from "@/lib/agent/schemas"
import { loadMath, normalizeExpr } from "@/lib/math-client"

type ExploreSpec = z.infer<typeof exploreInput>

const W = 520
const H = 300
const PAD = { l: 40, r: 12, t: 12, b: 26 }

/** Live graph of y = f(x, params) with a slider per parameter. */
export function Explorer({ spec }: { spec: Partial<ExploreSpec> }) {
  const params = React.useMemo(() => (spec.params ?? []).filter((p) => p?.name), [spec.params])
  const [values, setValues] = React.useState<Record<string, number>>({})
  const [fn, setFn] = React.useState<((scope: Record<string, number>) => number) | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setValues(Object.fromEntries(params.map((p) => [p.name, p.value])))
  }, [params])

  React.useEffect(() => {
    if (!spec.expr) return
    let cancelled = false
    loadMath().then(({ compile }) => {
      try {
        const code = compile(normalizeExpr(spec.expr!))
        if (!cancelled) {
          setFn(() => (scope: Record<string, number>) => Number(code.evaluate(scope)))
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [spec.expr])

  const xMin = spec.xMin ?? -5
  const xMax = spec.xMax ?? 5
  const samples = React.useMemo(() => {
    if (!fn) return []
    const out: { x: number; y: number }[] = []
    for (let i = 0; i <= 300; i++) {
      const x = xMin + ((xMax - xMin) * i) / 300
      let y = NaN
      try {
        y = fn({ ...values, x })
      } catch {}
      out.push({ x, y })
    }
    return out
  }, [fn, values, xMin, xMax])

  // y-range: fixed if given (so changes are visible against a stable frame), else from the initial values.
  const initialRange = React.useRef<[number, number] | null>(null)
  const finite = samples.map((s) => s.y).filter(Number.isFinite)
  if (!initialRange.current && finite.length) {
    const lo = Math.min(...finite)
    const hi = Math.max(...finite)
    const span = hi - lo || 2
    initialRange.current = [lo - span * 0.25, hi + span * 0.25]
  }
  const yMin = spec.yMin ?? initialRange.current?.[0] ?? -5
  const yMax = spec.yMax ?? initialRange.current?.[1] ?? 5

  const sx = (x: number) => PAD.l + ((x - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => PAD.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b)

  let d = ""
  let pen = false
  for (const s of samples) {
    if (!Number.isFinite(s.y) || s.y < yMin - (yMax - yMin) || s.y > yMax + (yMax - yMin)) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${sx(s.x).toFixed(1)},${sy(Math.max(yMin, Math.min(yMax, s.y))).toFixed(1)}`
    pen = true
  }

  const ticks = (lo: number, hi: number) => {
    const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)))
    const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => (hi - lo) / s <= 6) ?? step * 10
    const out: number[] = []
    for (let v = Math.ceil(lo / nice) * nice; v <= hi; v += nice) out.push(Math.round(v * 1e6) / 1e6)
    return out
  }

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-(--chart-surface)" role="img" aria-label={`Graph of ${spec.expr}`}>
        {ticks(xMin, xMax).map((v) => (
          <g key={`x${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} className="stroke-border" strokeWidth={1} />
            <text x={sx(v)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {ticks(yMin, yMax).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {yMin <= 0 && yMax >= 0 ? (
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} className="stroke-muted-foreground" strokeWidth={1.2} />
        ) : null}
        {xMin <= 0 && xMax >= 0 ? (
          <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={H - PAD.b} className="stroke-muted-foreground" strokeWidth={1.2} />
        ) : null}
        <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      {error ? <p className="text-xs text-destructive">Could not read the expression: {error}</p> : null}
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {params.map((p) => (
          <Slider
            key={p.name}
            min={p.min}
            max={p.max}
            step={p.step ?? (p.max - p.min) / 100}
            value={values[p.name] ?? p.value}
            onValueChange={(v) => setValues((cur) => ({ ...cur, [p.name]: v as number }))}
            format={{ maximumFractionDigits: 3 }}
            className="space-y-1.5"
          >
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">
                <span className="font-mono">{p.name}</span>
                {p.label ? <span className="text-muted-foreground"> · {p.label}</span> : null}
              </span>
              <SliderValue className="font-mono text-muted-foreground tabular-nums" />
            </div>
            <SliderControl className="flex h-5 items-center">
              <SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
                <SliderIndicator className="absolute h-full rounded-full bg-primary" />
                <SliderThumb
                  aria-label={p.label ?? p.name}
                  className="size-4 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </SliderTrack>
            </SliderControl>
          </Slider>
        ))}
      </div>
    </div>
  )
}
