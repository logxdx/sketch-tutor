"use client"

import {
  AudioLinesIcon,
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CpuIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/react/slider"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"

import { PickList, Segmented, Toggle } from "@/components/ui-sdk/controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { REASONING_LEVELS, type ProviderId, type TutorSettings } from "@/lib/agent/settings"
import type { DrawSpeed } from "@/lib/board/types"
import type { SettingsApi } from "@/lib/settings/use-settings"
import { cn } from "@/lib/utils"
import { CapabilityBadges, ModelPicker } from "./model-picker"
import { VoicePanel } from "./voice-panel"

type Role = "tutor" | "vision" | "research"

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="text-xs text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Note({ tone = "muted", children }: { tone?: "muted" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
        tone === "warn" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// ------------------------------------------------------------------ sampling

type SamplingKey = keyof TutorSettings["sampling"]

const SAMPLING: {
  key: SamplingKey
  label: string
  hint: string
  /** Name in OpenRouter's supported_parameters. */
  param: string
  min: number
  max: number
  step: number
  fallback: number
  input?: boolean
}[] = [
  { key: "temperature", label: "Temperature", hint: "Higher = more varied wording, lower = more focused.", param: "temperature", min: 0, max: 2, step: 0.05, fallback: 0.7 },
  { key: "topP", label: "Top-p", hint: "Only sample from the most likely tokens covering this probability mass.", param: "top_p", min: 0, max: 1, step: 0.01, fallback: 1 },
  { key: "topK", label: "Top-k", hint: "Only sample from the k most likely tokens.", param: "top_k", min: 1, max: 200, step: 1, fallback: 40 },
  { key: "minP", label: "Min-p", hint: "Drop tokens below this fraction of the top token's probability.", param: "min_p", min: 0, max: 0.5, step: 0.01, fallback: 0.05 },
  { key: "presencePenalty", label: "Presence penalty", hint: "Encourage new topics.", param: "presence_penalty", min: -2, max: 2, step: 0.05, fallback: 0 },
  { key: "frequencyPenalty", label: "Frequency penalty", hint: "Discourage repeating the same words.", param: "frequency_penalty", min: -2, max: 2, step: 0.05, fallback: 0 },
  { key: "repetitionPenalty", label: "Repetition penalty", hint: "Penalise repeated tokens (1 = off).", param: "repetition_penalty", min: 0.5, max: 2, step: 0.01, fallback: 1 },
  { key: "maxOutputTokens", label: "Max output tokens", hint: "Upper limit per reply step (reasoning models need room to think).", param: "max_tokens", min: 1024, max: 64000, step: 512, fallback: 16000, input: true },
  { key: "seed", label: "Seed", hint: "Same seed + same input ≈ same output, where supported.", param: "seed", min: 0, max: 2 ** 31 - 1, step: 1, fallback: 42, input: true },
]

function SamplingRow({
  spec,
  value,
  supported,
  onChange,
}: {
  spec: (typeof SAMPLING)[number]
  value: number | null | undefined
  supported: boolean | null
  onChange: (v: number | null) => void
}) {
  const custom = value !== null && value !== undefined
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", supported === false && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {spec.label}
            {supported === false ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                not supported by this model
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{spec.hint}</p>
        </div>
        <Toggle checked={custom} onCheckedChange={(on) => onChange(on ? spec.fallback : null)} className="shrink-0 text-xs text-muted-foreground">
          {custom ? "Custom" : "Model default"}
        </Toggle>
      </div>
      {custom ? (
        spec.input ? (
          <Input
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(Math.min(spec.max, Math.max(spec.min, Math.round(n))))
            }}
            className="h-8 w-40 font-mono"
          />
        ) : (
          <Slider
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            onValueChange={(v) => onChange(v as number)}
            className="flex items-center gap-3"
          >
            <SliderControl className="flex h-5 flex-1 items-center">
              <SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
                <SliderIndicator className="absolute h-full rounded-full bg-primary" />
                <SliderThumb
                  aria-label={spec.label}
                  className="size-4 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </SliderTrack>
            </SliderControl>
            <span className="w-12 text-right font-mono text-xs tabular-nums">{value}</span>
          </Slider>
        )
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ dialog

export function SettingsDialog({
  open,
  onOpenChange,
  api,
  speed,
  onSpeedChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: SettingsApi
  speed: DrawSpeed
  onSpeedChange: (s: DrawSpeed) => void
}) {
  const { settings, update, info, provider, defaults, catalog, loadCatalog, modelInfo } = api
  const [role, setRole] = React.useState<Role>("tutor")
  const [customId, setCustomId] = React.useState("")

  React.useEffect(() => {
    if (open) loadCatalog(provider)
  }, [open, provider, loadCatalog])

  const providers = info?.providers ?? []
  const chosen = settings.models[role]
  const effective = chosen || (role === "tutor" ? defaults.tutor : settings.models.tutor || defaults[role])
  const tutor = modelInfo(settings.models.tutor || defaults.tutor)
  const roleModel = modelInfo(effective)
  const supports = (param: string) =>
    tutor?.params?.length
      ? tutor.params.includes(param) || (param === "max_tokens" && tutor.params.includes("max_completion_tokens"))
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className="fixed inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogContent className="fixed top-1/2 left-1/2 flex h-[min(86vh,760px)] w-[min(94vw,960px)] -translate-1/2 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl transition-[opacity,scale] duration-200 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-3">
          <div>
            <DialogTitle className="font-medium">Settings</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Saved in this browser and applied to every request. API keys stay on the server.
            </DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <XIcon className="size-4" aria-hidden />
          </DialogClose>
        </div>

        <Tabs defaultValue="model" orientation="vertical" className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <TabsList
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:border-r sm:border-b-0"
          >
            {[
              { value: "model", label: "Model", icon: <CpuIcon /> },
              { value: "thinking", label: "Thinking", icon: <BrainIcon /> },
              { value: "sampling", label: "Sampling", icon: <SlidersHorizontalIcon /> },
              { value: "agent", label: "Agent", icon: <BotIcon /> },
              { value: "voice", label: "Voice", icon: <AudioLinesIcon /> },
              { value: "providers", label: "Providers", icon: <CircleCheckIcon /> },
            ].map((t) => (
              <TabsTab
                key={t.value}
                value={t.value}
                className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-selected:bg-accent data-selected:font-medium data-selected:text-accent-foreground [&_svg]:size-4"
              >
                {t.icon}
                {t.label}
              </TabsTab>
            ))}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {/* ------------------------------------------------ Model */}
            <TabsPanel value="model" className="space-y-6 outline-none">
              <Section title="Provider" description="Which API the tutor talks to. Unconfigured providers need their key in the server's environment.">
                <Segmented<ProviderId>
                  label="Provider"
                  value={provider}
                  onValueChange={(p) => {
                    if (providers.find((x) => x.id === p)?.configured) update({ provider: p, models: { tutor: "", vision: "", research: "" } })
                  }}
                  items={providers.map((p) => ({
                    value: p.id,
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        {p.configured ? <CircleCheckIcon className="size-3.5 text-emerald-600" /> : <CircleDashedIcon className="size-3.5" />}
                        {p.label}
                      </span>
                    ),
                    hint: p.configured ? undefined : `Set ${p.keyEnv} on the server`,
                  }))}
                />
              </Section>

              <Section
                title="Models"
                description="The tutor drives the lesson and must call tools. Vision reads the board, photos and PDF pages. Research powers the web research sub-agent."
              >
                <Segmented<Role>
                  label="Model role"
                  size="sm"
                  value={role}
                  onValueChange={(r) => {
                    setRole(r)
                    setCustomId("")
                  }}
                  items={[
                    { value: "tutor", label: "Tutor" },
                    { value: "vision", label: "Vision" },
                    { value: "research", label: "Research" },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Using</span>
                  <span className="font-mono text-xs">{effective || "—"}</span>
                  <CapabilityBadges model={roleModel} />
                  {chosen ? (
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={() => update({ models: { [role]: "" } })}>
                      <RotateCcwIcon /> {role === "tutor" ? "Server default" : "Same as tutor"}
                    </Button>
                  ) : (
                    <span className="ml-auto text-xs text-muted-foreground">{role === "tutor" ? "server default" : "follows the tutor"}</span>
                  )}
                </div>
                {role === "tutor" && roleModel?.tools === false ? (
                  <Note tone="warn">This model can’t call tools — it won’t be able to draw, search or show 3D.</Note>
                ) : null}
                {role !== "research" && roleModel?.vision === false ? (
                  <Note tone="warn">
                    This model can’t see images. {role === "tutor" ? "Pick a vision model below so the tutor can still read the board." : "Pick a model with vision."}
                  </Note>
                ) : null}
                <ModelPicker
                  models={catalog?.models ?? []}
                  loading={catalog?.loading}
                  error={catalog?.error}
                  value={effective}
                  require={role === "tutor" ? "tools" : role === "vision" ? "vision" : undefined}
                  onChange={(id) => (role === "tutor" ? api.chooseModel(id) : update({ models: { [role]: id } }))}
                />
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!customId.trim()) return
                    if (role === "tutor") api.chooseModel(customId.trim())
                    else update({ models: { [role]: customId.trim() } })
                    setCustomId("")
                  }}
                >
                  <Input
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    placeholder="…or type an exact model id"
                    className="h-8 font-mono text-xs"
                    aria-label="Custom model id"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={!customId.trim()}>
                    Use
                  </Button>
                </form>
              </Section>
            </TabsPanel>

            {/* ------------------------------------------------ Thinking */}
            <TabsPanel value="thinking" className="space-y-6 outline-none">
              <Section
                title="Thinking effort"
                description="How long the model reasons before answering. Higher is more careful but slower and costs more. Providers map these levels to their own settings."
              >
                {tutor && tutor.reasoning === false ? <Note>The current tutor model doesn’t support adjustable reasoning; this has no effect.</Note> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {REASONING_LEVELS.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() => update({ reasoning: l.value })}
                      className={cn(
                        "flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors hover:border-primary/40",
                        settings.reasoning === l.value && "border-primary bg-accent"
                      )}
                    >
                      <span className="text-sm font-medium">{l.label}</span>
                      {l.hint ? <span className="text-xs text-muted-foreground">{l.hint}</span> : null}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Show the tutor’s reasoning" description="Display the “Thought it through” steps in the lesson. Hiding them also asks OpenRouter to leave reasoning out of responses.">
                <Toggle checked={settings.showReasoning} onCheckedChange={(v) => update({ showReasoning: v })}>
                  Show reasoning
                </Toggle>
              </Section>
            </TabsPanel>

            {/* ------------------------------------------------ Sampling */}
            <TabsPanel value="sampling" className="space-y-4 outline-none">
              <div className="flex items-start justify-between gap-4">
                <Section
                  title="Sampling"
                  description={`Applies to the tutor model. ${tutor?.params?.length ? "Greyed-out options aren’t accepted by the current model." : "The provider doesn’t report which options this model accepts."}`}
                >
                  {null}
                </Section>
                <Button size="sm" variant="ghost" onClick={() => update({ sampling: Object.fromEntries(SAMPLING.map((s) => [s.key, null])) })}>
                  <RotateCcwIcon /> Reset
                </Button>
              </div>
              {provider === "groq" ? <Note>Groq ignores top-k, min-p and repetition penalty.</Note> : null}
              {SAMPLING.map((spec) => (
                <SamplingRow
                  key={spec.key}
                  spec={spec}
                  value={settings.sampling[spec.key]}
                  supported={
                    provider === "groq" && ["topK", "minP", "repetitionPenalty"].includes(spec.key)
                      ? false
                      : spec.key === "maxOutputTokens"
                        ? null
                        : supports(spec.param)
                  }
                  onChange={(v) => update({ sampling: { [spec.key]: v } })}
                />
              ))}
            </TabsPanel>

            {/* ------------------------------------------------ Agent */}
            <TabsPanel value="agent" className="space-y-6 outline-none">
              <Section title="Max steps per turn" description="How many model→tool round-trips the agent may take before it has to answer.">
                <Slider
                  min={2}
                  max={40}
                  step={1}
                  value={settings.agent.maxSteps}
                  onValueChange={(v) => update({ agent: { maxSteps: v as number } })}
                  className="flex items-center gap-3"
                >
                  <SliderControl className="flex h-5 flex-1 items-center">
                    <SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
                      <SliderIndicator className="absolute h-full rounded-full bg-primary" />
                      <SliderThumb aria-label="Max steps" className="size-4 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </SliderTrack>
                  </SliderControl>
                  <span className="w-10 text-right font-mono text-xs tabular-nums">{settings.agent.maxSteps}</span>
                </Slider>
              </Section>
              <Section title="Auto-continue after drawing" description="How many times the lesson continues on its own after the tutor draws on the board, before waiting for you.">
                <Slider
                  min={0}
                  max={30}
                  step={1}
                  value={settings.agent.autoContinue}
                  onValueChange={(v) => update({ agent: { autoContinue: v as number } })}
                  className="flex items-center gap-3"
                >
                  <SliderControl className="flex h-5 flex-1 items-center">
                    <SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
                      <SliderIndicator className="absolute h-full rounded-full bg-primary" />
                      <SliderThumb aria-label="Auto-continue" className="size-4 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </SliderTrack>
                  </SliderControl>
                  <span className="w-10 text-right font-mono text-xs tabular-nums">{settings.agent.autoContinue}</span>
                </Slider>
              </Section>
              <Section title="Web access" description="Web search, reading pages, the research sub-agent and image search. Off = the tutor only uses its own knowledge and your library.">
                <Toggle checked={settings.agent.webAccess} onCheckedChange={(v) => update({ agent: { webAccess: v } })}>
                  Allow web access
                </Toggle>
              </Section>
              <Section title="Drawing speed" description="How fast the tutor draws on the whiteboard.">
                <Segmented<DrawSpeed>
                  label="Drawing speed"
                  size="sm"
                  value={speed}
                  onValueChange={onSpeedChange}
                  items={[
                    { value: "relaxed", label: "Relaxed" },
                    { value: "normal", label: "Normal" },
                    { value: "fast", label: "Fast" },
                    { value: "instant", label: "Instant" },
                  ]}
                />
              </Section>
            </TabsPanel>

            {/* ------------------------------------------------ Voice */}
            <TabsPanel value="voice" className="outline-none">
              <VoicePanel />
            </TabsPanel>

            {/* ------------------------------------------------ Providers */}
            <TabsPanel value="providers" className="space-y-6 outline-none">
              <Section title="Configured providers" description="Keys are read from the server’s environment (.env.local) — they’re never sent to or stored in the browser.">
                <div className="divide-y rounded-xl border">
                  {providers.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      {p.configured ? <CircleCheckIcon className="size-4 text-emerald-600" /> : <CircleDashedIcon className="size-4 text-muted-foreground" />}
                      <span className="font-medium">{p.label}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{p.configured ? `default: ${p.defaults.tutor || "—"}` : `set ${p.keyEnv}`}</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="OpenRouter routing" description="How OpenRouter picks among the hosts serving a model.">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Prefer</span>
                  <PickList
                    label="OpenRouter provider sort"
                    value={settings.openrouter.sort}
                    onValueChange={(v) => update({ openrouter: { sort: v } })}
                    items={[
                      { value: "default", label: "OpenRouter default" },
                      { value: "price", label: "Lowest price" },
                      { value: "throughput", label: "Highest throughput" },
                      { value: "latency", label: "Lowest latency" },
                    ]}
                  />
                </div>
                <Toggle checked={settings.openrouter.allowFallbacks} onCheckedChange={(v) => update({ openrouter: { allowFallbacks: v } })}>
                  Allow fallback hosts if the first one fails
                </Toggle>
                <Toggle
                  checked={settings.openrouter.dataCollection === "deny"}
                  onCheckedChange={(v) => update({ openrouter: { dataCollection: v ? "deny" : "allow" } })}
                >
                  Only use hosts that don’t store or train on prompts
                </Toggle>
              </Section>
              <Section title="Groq" description="Service tier for Groq requests.">
                <PickList
                  label="Groq service tier"
                  value={settings.groq.serviceTier}
                  onValueChange={(v) => update({ groq: { serviceTier: v } })}
                  items={[
                    { value: "default", label: "Default" },
                    { value: "on_demand", label: "On demand" },
                    { value: "flex", label: "Flex" },
                    { value: "auto", label: "Auto" },
                  ]}
                />
              </Section>
            </TabsPanel>
          </div>
        </Tabs>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <Button size="sm" variant="ghost" onClick={api.reset}>
            <RotateCcwIcon /> Reset all settings
          </Button>
          <DialogClose render={<Button size="sm" />}>Done</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
