"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts"
import type { z } from "zod"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { chartInput } from "@/lib/agent/schemas"

type ChartSpec = z.infer<typeof chartInput>

/**
 * Model-specified data chart. Colors are the validated categorical slots
 * (--chart-1..6) assigned in fixed order; one y-axis; hover tooltip; legend
 * for 2+ series; a table view for accessibility.
 */
export function ChartView({ spec, height = 260 }: { spec: Partial<ChartSpec>; height?: number }) {
  const [table, setTable] = React.useState(false)
  const data = React.useMemo(() => spec.data ?? [], [spec.data])
  const xKey = spec.xKey ?? "x"
  const maxSeries = spec.kind === "scatter" ? 3 : 6
  const series = (spec.series ?? []).filter((s) => s?.key).slice(0, maxSeries)

  const config = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.map((s, i) => [s.key, { label: s.label ?? s.key, color: `var(--chart-${i + 1})` }])
      ),
    [series]
  )

  if (!data.length || !series.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Preparing chart…</div>
  }

  const legend = series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null
  const grid = <CartesianGrid vertical={false} strokeOpacity={0.5} />
  const xAxis = (
    <XAxis
      dataKey={xKey}
      type={spec.kind === "scatter" ? "number" : "category"}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={16}
      label={spec.xLabel ? { value: spec.xLabel, position: "insideBottom", offset: -4, fontSize: 11 } : undefined}
    />
  )
  const yAxis = (
    <YAxis
      tickLine={false}
      axisLine={false}
      width={48}
      label={spec.yLabel ? { value: spec.yLabel, angle: -90, position: "insideLeft", fontSize: 11 } : undefined}
    />
  )
  const tooltip = <ChartTooltip cursor={spec.kind !== "scatter"} content={<ChartTooltipContent />} />

  let chart: React.ReactElement
  switch (spec.kind) {
    case "line":
      chart = (
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: spec.xLabel ? 12 : 0 }}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={data.length <= 12 ? { r: 4 } : false}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      )
      break
    case "area":
      chart = (
        <AreaChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: spec.xLabel ? 12 : 0 }}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              fill={`var(--color-${s.key})`}
              fillOpacity={0.18}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      )
      break
    case "scatter":
      chart = (
        <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: spec.xLabel ? 12 : 0 }}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Scatter
              key={s.key}
              name={s.label ?? s.key}
              data={data.map((d) => ({ [xKey]: d[xKey], [s.key]: d[s.key] }))}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              stroke="var(--chart-surface)"
              strokeWidth={2}
            />
          ))}
        </ScatterChart>
      )
      break
    default: {
      const stacked = spec.kind === "stacked-bar"
      chart = (
        <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: spec.xLabel ? 12 : 0 }} barGap={2}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stacked ? "a" : undefined}
              fill={`var(--color-${s.key})`}
              stroke="var(--chart-surface)"
              strokeWidth={stacked ? 2 : 0}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      )
    }
  }

  return (
    <div className="space-y-2">
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">{spec.xLabel ?? xKey}</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 font-medium">
                    {s.label ?? s.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{String(row[xKey] ?? "")}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 tabular-nums">
                      {String(row[s.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ChartContainer config={config} className="w-full" style={{ height }}>
          {chart}
        </ChartContainer>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{spec.source ? `Source: ${spec.source}` : spec.caption}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="shrink-0 underline-offset-2 hover:underline">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
    </div>
  )
}
