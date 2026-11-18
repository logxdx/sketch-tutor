"use client"

import { BrainIcon, ChevronDownIcon, Settings2Icon } from "lucide-react"
import * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { PROVIDERS, REASONING_LEVELS, type ProviderId } from "@/lib/agent/settings"
import type { SettingsApi } from "@/lib/settings/use-settings"

/** Short display name for a model id ("deepseek/deepseek-v4.1-flash" → "deepseek-v4.1-flash"). */
const shortName = (id: string) => id.split("/").at(-1) || id

/** shadcn Model Selector pattern: model and effort dropdowns in the composer. */
export function ModelControls({ api, onOpenSettings }: { api: SettingsApi; onOpenSettings: () => void }) {
  const { provider, tutorModel, settings, info } = api
  const configured = new Set(info?.providers.filter((p) => p.configured).map((p) => p.id) ?? [])

  // Current model, then recents on configured providers, grouped by provider.
  const entries = [{ provider, id: tutorModel }, ...api.recent].filter(
    (e, i, all) => e.id && configured.has(e.provider) && all.findIndex((x) => x.provider === e.provider && x.id === e.id) === i
  )
  const groups = PROVIDERS.map((p) => ({ ...p, models: entries.filter((e) => e.provider === p.id) })).filter((g) => g.models.length)
  const level = REASONING_LEVELS.find((l) => l.value === settings.reasoning) ?? REASONING_LEVELS[0]
  const name = api.modelInfo(tutorModel)?.name ?? shortName(tutorModel)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <InputGroupButton size="sm" variant="ghost" aria-label={`Model: ${name}`} className="max-w-44 min-w-0 text-muted-foreground" />
          }
        >
          <span className="truncate">{name || "Model"}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={`${provider}:${tutorModel}`}
            onValueChange={(v: string) => {
              const i = v.indexOf(":")
              api.chooseModel(v.slice(i + 1), v.slice(0, i) as ProviderId)
            }}
          >
            {groups.map((g, i) => (
              <React.Fragment key={g.id}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                  {g.models.map((m) => (
                    <DropdownMenuRadioItem key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`} closeOnClick>
                      <span className="truncate">{api.modelInfo(m.id, m.provider)?.name ?? shortName(m.id)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              </React.Fragment>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings2Icon /> All models & settings…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<InputGroupButton size="sm" variant="ghost" aria-label={`Thinking effort: ${level.label}`} className="text-muted-foreground" />}
        >
          <BrainIcon />
          <span className="hidden sm:inline">{level.value === "provider-default" ? "Effort" : level.label}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Thinking effort</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={settings.reasoning} onValueChange={(v: string) => api.update({ reasoning: v as typeof settings.reasoning })}>
              {REASONING_LEVELS.map((l) => (
                <DropdownMenuRadioItem key={l.value} value={l.value} closeOnClick>
                  {l.label}
                  {l.hint ? <span className="ml-auto pl-3 text-xs text-muted-foreground">{l.hint}</span> : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
