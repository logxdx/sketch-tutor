"use client"

import * as React from "react"

import { pauseSpeech, resumeSpeech } from "./engines"
import { dictate, listenStatus, type Dictation } from "./listen"

export type DictationState = "idle" | "starting" | "listening" | "finishing"

/**
 * Talk instead of type. `onText(text, final)` gets the transcript as it grows (the composer shows
 * it live). Narration pauses while the student speaks, so the mic doesn't hear the tutor.
 */
export function useDictation({ onText, onError }: { onText: (text: string, final: boolean) => void; onError?: (message: string) => void }) {
  const [state, setState] = React.useState<DictationState>("idle")
  const [level, setLevel] = React.useState(0)
  const session = React.useRef<Dictation | null>(null)
  const engine = React.useSyncExternalStore(listenStatus.subscribe, listenStatus.get, listenStatus.get)
  const onTextRef = React.useRef(onText)
  const onErrorRef = React.useRef(onError)
  React.useEffect(() => {
    onTextRef.current = onText
    onErrorRef.current = onError
  })

  const start = React.useCallback(async () => {
    if (session.current) return
    setState("starting")
    pauseSpeech()
    try {
      session.current = await dictate({ onText: (t, f) => onTextRef.current(t, f), onLevel: setLevel })
      setState("listening")
    } catch (e) {
      session.current = null
      setState("idle")
      resumeSpeech()
      const err = e as Error
      onErrorRef.current?.(
        err.name === "NotAllowedError" ? "Microphone access was blocked — allow it in the browser to talk to Sketch." : err.message
      )
    }
  }, [])

  /** Stop and wait for the final transcript. */
  const stop = React.useCallback(async () => {
    const s = session.current
    if (!s) return ""
    session.current = null
    setState("finishing")
    try {
      return await s.stop()
    } catch (e) {
      onErrorRef.current?.((e as Error).message)
      return ""
    } finally {
      setState("idle")
      resumeSpeech()
    }
  }, [])

  const cancel = React.useCallback(() => {
    session.current?.cancel()
    session.current = null
    setState("idle")
    resumeSpeech()
  }, [])

  React.useEffect(() => () => session.current?.cancel(), [])

  return { state, level, engine, start, stop, cancel }
}
