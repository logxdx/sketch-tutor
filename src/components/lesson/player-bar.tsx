"use client"

import { ArrowRightIcon, Loader2Icon, PauseIcon, PlayIcon, RotateCcwIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import type { LessonPlayer } from "@/lib/lesson/use-lesson-player"
import { phononStatus } from "@/lib/voice/engines"
import { setVoicePrefs, type VoicePrefs } from "@/lib/voice/prefs"
import { cn } from "@/lib/utils"

const noop = () => () => {}

/** Phonon download progress, while it's the voice being fetched. */
function useVoiceLoading() {
  const s = React.useSyncExternalStore(phononStatus.subscribe, phononStatus.get, phononStatus.get)
  return s.state === "loading" ? Math.round(s.progress * 100) : null
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

/** Lesson transport: where you are, Continue, and the voice. Sits at the bottom of the board. */
export function PlayerBar({
  player,
  prefs,
  hasSelection,
}: {
  player: LessonPlayer
  prefs: VoicePrefs
  hasSelection: boolean
}) {
  const voiceLoading = useVoiceLoading()
  const hydrated = React.useSyncExternalStore(noop, () => true, () => false)
  const { next } = player
  const canNext = player.hasNext || player.streaming

  // → continues (not while typing, or while board elements are selected: arrows move them).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" || e.altKey || e.metaKey || e.ctrlKey) return
      if (isTyping(e.target) || hasSelection) return
      e.preventDefault()
      next()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, hasSelection])

  if (!hydrated || !player.active) return null
  const atFrontier = !player.hasNext

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Lesson player"
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border bg-background/95 p-1.5 shadow-lg backdrop-blur"
      >
        <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Step {player.index + 1}
          <span className="text-muted-foreground/60">of {player.count}</span>
          {player.streaming ? <Loader2Icon className="size-3 animate-spin text-tutor" aria-label="More steps coming" /> : null}
        </span>
        {player.step?.textPart !== null ? (
          <Button size="icon-sm" variant="ghost" aria-label="Replay this step" title="Replay this step" onClick={player.replay}>
            <RotateCcwIcon />
          </Button>
        ) : null}
        {player.narrating ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={player.paused ? "Resume narration" : "Pause narration"}
            title={player.paused ? "Resume" : "Pause"}
            onClick={player.togglePause}
          >
            {player.paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={prefs.narrate ? "Mute narration" : "Read aloud"}
          aria-pressed={prefs.narrate}
          title={prefs.narrate ? "Mute narration" : "Read aloud"}
          onClick={() => setVoicePrefs({ narrate: !prefs.narrate })}
        >
          {prefs.narrate ? <Volume2Icon /> : <VolumeXIcon />}
        </Button>
        <button
          type="button"
          aria-pressed={prefs.autoAdvance}
          title="Go to the next step by itself when this one is done"
          onClick={() => setVoicePrefs({ autoAdvance: !prefs.autoAdvance })}
          className={cn(
            "rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            prefs.autoAdvance && "bg-secondary font-medium text-secondary-foreground"
          )}
        >
          Auto
        </button>
        {voiceLoading !== null ? (
          <span className="px-1.5 text-[11px] text-muted-foreground tabular-nums" title="Downloading the on-device voice (once)">
            Voice {voiceLoading}%
          </span>
        ) : null}
        <Button
          size="sm"
          disabled={!canNext}
          onClick={next}
          className={cn("ml-1 rounded-xl", player.done && player.hasNext && "sk-nudge")}
          aria-keyshortcuts="ArrowRight"
        >
          {player.waitingForNext || (atFrontier && player.streaming && player.done) ? (
            <>
              <Loader2Icon className="animate-spin" /> Preparing…
            </>
          ) : (
            <>
              Continue <ArrowRightIcon />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
