"use client"

/**
 * Speech engines for narration.
 *
 * - phonon: Phonon 31m, run on the device's CPU in a Web Worker (WebAssembly), via the
 *   `phonon-tts` package — the same model and Rust runtime (gradium-ai/xn-ptts) HaloAI uses
 *   on Android. ~65 MB downloaded once from Hugging Face and kept in the Cache API.
 * - browser: the Web Speech API's built-in voices. Always there, used until Phonon is ready
 *   and whenever it can't load.
 */

export type EngineId = "phonon" | "browser"

export type SpeakOptions = {
  signal: AbortSignal
  /** Playback speed, 0.75–1.5. */
  rate: number
  voice?: string
  /** Called as sentence `i` starts to be heard. */
  onSentence?: (i: number) => void
}

export interface SpeechEngine {
  id: EngineId
  speak(sentences: string[], opts: SpeakOptions): Promise<void>
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(resolve, Math.max(0, ms))
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true })
  })

// ---------------------------------------------------------- silent reading

/** About how long a sentence takes to read, at `rate`. */
const readingMs = (s: string, rate: number) => Math.max(1200, (s.split(/\s+/).length / 3.2) * 1000) / rate

/** No voice at all: walk the highlight through the sentences at reading pace. */
const silentReader: SpeechEngine = {
  id: "browser",
  async speak(sentences, { signal, rate, onSentence }) {
    for (let i = 0; i < sentences.length && !signal.aborted; i++) {
      onSentence?.(i)
      await sleep(readingMs(sentences[i], rate), signal)
    }
  },
}

/** System voices load asynchronously; give them a moment the first time. */
async function systemVoices(synth: SpeechSynthesis) {
  if (synth.getVoices().length) return synth.getVoices()
  await new Promise<void>((r) => {
    const t = setTimeout(r, 600)
    synth.addEventListener("voiceschanged", () => (clearTimeout(t), r()), { once: true })
  })
  return synth.getVoices()
}

// -------------------------------------------------------------- browser voice

export const browserEngine: SpeechEngine = {
  id: "browser",
  async speak(sentences, opts) {
    const { signal, rate, onSentence } = opts
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined
    // Many Linux browsers ship without system voices: read along silently instead.
    if (!synth || !(await systemVoices(synth)).length) return silentReader.speak(sentences, opts)
    return new Promise<void>((resolve) => {
      let i = 0
      let guard: ReturnType<typeof setTimeout> | undefined
      const finish = () => {
        clearTimeout(guard)
        resolve()
      }
      const next = () => {
        clearTimeout(guard)
        if (signal.aborted || i >= sentences.length) return finish()
        const idx = i++
        const u = new SpeechSynthesisUtterance(sentences[idx])
        u.rate = rate
        u.lang = "en-US"
        u.onstart = () => onSentence?.(idx)
        u.onend = next
        // A sentence that can't be spoken still gets its reading time.
        u.onerror = () => {
          clearTimeout(guard)
          guard = setTimeout(next, readingMs(sentences[idx], rate))
        }
        onSentence?.(idx)
        // Some platforms never fire `end`: don't hang the lesson on it.
        guard = setTimeout(next, readingMs(sentences[idx], rate) * 2 + 1500)
        synth.speak(u)
      }
      signal.addEventListener("abort", () => (synth.cancel(), finish()), { once: true })
      synth.cancel()
      next()
    })
  },
}

// --------------------------------------------------------------- Phonon (CPU)

/** The parts of the phonon-tts API used here (its own .d.ts ships with the package). */
type PhononStream = AsyncIterable<Float32Array> & { cancel(): void; done: Promise<unknown> }
type PhononTTS = {
  sampleRate: number
  voices: string[]
  threads: number
  device: string
  stream(text: string, opts?: { voice?: string; signal?: AbortSignal }): PhononStream
  dispose(): void
}
type PhononModule = {
  PhononTTS: {
    load(opts: {
      lang: string
      quant?: "q8" | "f32"
      device?: "cpu" | "webgpu" | "auto"
      threads?: number | "auto"
      onProgress?: (p: { file: string; loaded: number; total: number; cached?: boolean }) => void
    }): Promise<PhononTTS>
  }
}

export type PhononStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number }
  | { state: "ready"; threads: number; device: string; voices: string[] }
  | { state: "unavailable"; reason: string }

let status: PhononStatus = { state: "idle" }
const listeners = new Set<() => void>()
const setStatus = (s: PhononStatus) => {
  status = s
  listeners.forEach((l) => l())
}
export const phononStatus = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

let loading: Promise<PhononTTS | null> | null = null

/** Load Phonon once (downloads the model on first use). Null if this browser/app can't run it. */
export function loadPhonon(): Promise<PhononTTS | null> {
  if (loading) return loading
  loading = (async () => {
    if (typeof window === "undefined") return null
    if (!("WebAssembly" in window)) {
      setStatus({ state: "unavailable", reason: "This browser has no WebAssembly." })
      return null
    }
    let mod: PhononModule
    try {
      // Served from the app's own origin (scripts/vendor-phonon.mjs), not bundled.
      mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/vendor/phonon-tts/index.js" as string)) as PhononModule
    } catch {
      setStatus({ state: "unavailable", reason: "phonon-tts isn't installed (npm install phonon-tts), so the browser voice is used." })
      return null
    }
    const files = new Map<string, { loaded: number; total: number }>()
    setStatus({ state: "loading", progress: 0 })
    try {
      // Minimal runtime: the q8 model on one CPU thread — the single-threaded wasm build, no
      // shared-memory workers, no cross-origin isolation, no GPU.
      const tts = await mod.PhononTTS.load({
        lang: "en",
        quant: "q8",
        device: "cpu",
        threads: 1,
        onProgress: ({ file, loaded, total }) => {
          files.set(file, { loaded, total })
          let l = 0
          let t = 0
          for (const f of files.values()) {
            l += f.loaded
            t += f.total || f.loaded
          }
          setStatus({ state: "loading", progress: t ? l / t : 0 })
        },
      })
      setStatus({ state: "ready", threads: tts.threads, device: tts.device, voices: tts.voices })
      return tts
    } catch (e) {
      setStatus({ state: "unavailable", reason: (e as Error).message })
      loading = null
      return null
    }
  })()
  return loading
}

let ctx: AudioContext | null = null

export const phononEngine: SpeechEngine = {
  id: "phonon",
  async speak(sentences, { signal, rate, voice, onSentence }) {
    const tts = await loadPhonon()
    if (!tts) return browserEngine.speak(sentences, { signal, rate, onSentence })
    if (!ctx || ctx.state === "closed") ctx = new AudioContext({ sampleRate: tts.sampleRate })
    if (ctx.state === "suspended") await ctx.resume().catch(() => {})
    const audio = ctx
    const sources: AudioBufferSourceNode[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    // Ask for every sentence up front: the worker generates them in order, ahead of playback.
    const streams = sentences.map((s) => tts.stream(s, { voice, signal }))
    const stop = () => {
      streams.forEach((s) => s.cancel())
      sources.forEach((s) => {
        try {
          s.stop()
        } catch {}
      })
      timers.forEach(clearTimeout)
    }
    signal.addEventListener("abort", stop, { once: true })
    let t = audio.currentTime + 0.05
    try {
      for (let i = 0; i < streams.length && !signal.aborted; i++) {
        let first = true
        for await (const pcm of streams[i]) {
          if (signal.aborted) break
          const buffer = audio.createBuffer(1, pcm.length, tts.sampleRate)
          buffer.getChannelData(0).set(pcm)
          const src = audio.createBufferSource()
          src.buffer = buffer
          src.playbackRate.value = rate
          src.connect(audio.destination)
          t = Math.max(t, audio.currentTime + 0.02)
          if (first) {
            const at = t
            timers.push(setTimeout(() => onSentence?.(i), (at - audio.currentTime) * 1000))
            first = false
          }
          src.start(t)
          sources.push(src)
          t += buffer.duration / rate
        }
        t += 0.14 // a breath between sentences
      }
      await sleep((t - audio.currentTime) * 1000, signal)
    } catch (e) {
      if (!signal.aborted) console.warn("[phonon] speech failed:", (e as Error).message)
    } finally {
      signal.removeEventListener("abort", stop)
      if (signal.aborted) stop()
    }
  },
}

export const engines: Record<EngineId, SpeechEngine> = { phonon: phononEngine, browser: browserEngine }

/** Pause / resume whatever is being said (both engines). */
export function pauseSpeech() {
  void ctx?.suspend().catch(() => {})
  if (typeof window !== "undefined") window.speechSynthesis?.pause()
}
export function resumeSpeech() {
  void ctx?.resume().catch(() => {})
  if (typeof window !== "undefined") window.speechSynthesis?.resume()
}

/**
 * The engine to speak with now. Phonon once it's loaded (waiting briefly when it's coming from
 * the cache); the browser voice while it downloads, or when it can't run.
 */
export async function pickEngine(wanted: EngineId): Promise<SpeechEngine> {
  if (wanted !== "phonon") return browserEngine
  const s = phononStatus.get()
  if (s.state === "ready") return phononEngine
  if (s.state === "unavailable") return browserEngine
  const load = loadPhonon()
  const quick = await Promise.race([load, new Promise<null>((r) => setTimeout(() => r(null), 2500))])
  return quick ? phononEngine : browserEngine
}
