"use client"

import { BrainIcon, CheckIcon, EyeIcon, Loader2Icon, SearchIcon, WrenchIcon } from "lucide-react"
import * as React from "react"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@ui-sdk/react/command"

import type { ModelInfo } from "@/lib/agent/settings"
import { cn } from "@/lib/utils"

const fmtCtx = (n?: number) => (!n ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1e3)}K`)
const fmtPrice = (p?: ModelInfo["price"]) =>
  !p ? "" : p.input === 0 && p.output === 0 ? "free" : `$${p.input} / $${p.output} per M`

export function CapabilityBadges({ model }: { model?: ModelInfo }) {
  if (!model) return null
  const badge = (on: boolean | null, icon: React.ReactNode, label: string) =>
    on ? (
      <span
        title={label}
        className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground [&_svg]:size-3"
      >
        {icon}
        {label}
      </span>
    ) : null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badge(model.tools, <WrenchIcon />, "tools")}
      {badge(model.vision, <EyeIcon />, "vision")}
      {badge(model.reasoning, <BrainIcon />, "reasoning")}
    </span>
  )
}

/** Searchable model catalog (UI SDK Command) with capability badges, context size and price. */
export function ModelPicker({
  models,
  loading,
  error,
  value,
  onChange,
  require,
}: {
  models: ModelInfo[]
  loading?: boolean
  error?: string
  value: string
  onChange: (id: string) => void
  /** Hide models known to lack this capability. */
  require?: "tools" | "vision"
}) {
  const [onlyCapable, setOnlyCapable] = React.useState(true)
  const list = React.useMemo(() => {
    const filtered = require && onlyCapable ? models.filter((m) => m[require] !== false) : models
    // Selected first, then alphabetical by provider prefix.
    return [...filtered].sort((a, b) => (a.id === value ? -1 : b.id === value ? 1 : a.id.localeCompare(b.id)))
  }, [models, require, onlyCapable, value])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Loading models…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <Command onAction={(id) => onChange(id)} filter="contains">
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 text-muted-foreground" aria-hidden />
          <CommandInput
            aria-label="Search models"
            placeholder={`Search ${models.length} models…`}
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {require ? (
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyCapable} onChange={(e) => setOnlyCapable(e.target.checked)} />
              {require === "tools" ? "Tool-calling only" : "Vision only"}
            </label>
          ) : null}
        </div>
        <CommandEmpty className="hidden py-6 text-center text-sm text-muted-foreground data-empty:block">
          {error ? `Couldn't load models: ${error}` : "No matching models — you can still type an exact id below."}
        </CommandEmpty>
        <CommandList className="max-h-72 overflow-y-auto p-1">
          {list.map((m) => (
            <CommandItem
              key={m.id}
              value={m.id}
              label={`${m.name} ${m.id}`}
              className={cn(
                "flex cursor-default items-start gap-2 rounded-lg px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                m.id === value && "bg-secondary"
              )}
            >
              <CheckIcon className={cn("mt-0.5 size-4 shrink-0", m.id === value ? "text-primary" : "invisible")} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">{m.name}</span>
                  <CapabilityBadges model={m} />
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {m.id}
                  {m.context ? ` · ${fmtCtx(m.context)} ctx` : ""}
                  {m.price ? ` · ${fmtPrice(m.price)}` : ""}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}
