"use client"

import { Loader2Icon, PlayIcon } from "lucide-react"
import * as React from "react"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/react/slider"

import { Segmented, Toggle } from "@/components/ui-sdk/controls"
import { Button } from "@/components/ui/button"
import { loadPhonon, phononStatus, pickEngine, type EngineId } from "@/lib/voice/engines"
import { setVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs"

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="text-xs text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function PhononState() {
  const s = React.useSyncExternalStore(phononStatus.subscribe, phononStatus.get, phononStatus.get)
  switch (s.state) {
    case "ready":
      return (
        <p className="text-xs text-muted-foreground">
          Ready on this device · {s.device === "webgpu" ? "GPU" : `CPU, ${s.threads} thread${s.threads === 1 ? "" : "s"}`}
        </p>
      )
    case "loading":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Downloading the voice… {Math.round(s.progress * 100)}% (once; kept in this browser)
        </p>
      )
    case "unavailable":
      return <p className="text-xs text-pretty text-amber-700 dark:text-amber-400">{s.reason}</p>
    default:
      return (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Downloads ~65 MB the first time a lesson is read aloud.</p>
          <Button size="xs" variant="outline" onClick={() => void loadPhonon()}>
            Download now
          </Button>
        </div>
      )
  }
}

/** Settings → Voice: how lessons play and how they're read aloud. Saved in this browser. */
export function VoicePanel() {
  const prefs = useVoicePrefs()
  const [testing, setTesting] = React.useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const engine = await pickEngine(prefs.engine)
      await engine.speak(["Hi! I'll read each step of the lesson aloud while I draw it on the board."], {
        signal: new AbortController().signal,
        rate: prefs.rate,
        voice: prefs.voice || undefined,
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Step by step"
        description="Lessons play one step at a time: each step's drawing appears while its narration is read, and you move on with Continue (or →). Off: everything appears as the tutor writes it."
      >
        <div className="flex flex-col gap-2">
          <Toggle checked={prefs.stepByStep} onCheckedChange={(v) => setVoicePrefs({ stepByStep: v })}>
            Play lessons step by step
          </Toggle>
          <Toggle checked={prefs.autoAdvance} onCheckedChange={(v) => setVoicePrefs({ autoAdvance: v })}>
            Go to the next step by itself
          </Toggle>
        </div>
      </Section>

      <Section title="Read aloud" description="The narration of each step is spoken, with the sentence being read highlighted.">
        <Toggle checked={prefs.narrate} onCheckedChange={(v) => setVoicePrefs({ narrate: v })}>
          Read lessons aloud
        </Toggle>
      </Section>

      <Section
        title="Voice"
        description="Phonon runs on your device's CPU in the browser — Gradium's Phonon 31m, the model HaloAI uses — with no server and no API key. The browser voice is your system's built-in one, used until Phonon is ready."
      >
        <Segmented<EngineId>
          label="Voice engine"
          size="sm"
          value={prefs.engine}
          onValueChange={(v) => setVoicePrefs({ engine: v })}
          items={[
            { value: "phonon", label: "Phonon (on-device)" },
            { value: "browser", label: "Browser voice" },
          ]}
        />
        {prefs.engine === "phonon" ? <PhononState /> : null}
      </Section>

      <Section title="Speed">
        <Slider
          min={0.75}
          max={1.5}
          step={0.05}
          value={prefs.rate}
          onValueChange={(v) => setVoicePrefs({ rate: v as number })}
          className="flex items-center gap-3"
        >
          <SliderControl className="flex h-5 flex-1 items-center">
            <SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
              <SliderIndicator className="absolute h-full rounded-full bg-primary" />
              <SliderThumb aria-label="Speaking speed" className="size-4 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </SliderTrack>
          </SliderControl>
          <span className="w-10 text-right font-mono text-xs tabular-nums">{prefs.rate.toFixed(2)}×</span>
        </Slider>
        <Button size="sm" variant="outline" onClick={test} disabled={testing}>
          {testing ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Test the voice
        </Button>
      </Section>
    </div>
  )
}
