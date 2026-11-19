"use client"

import type { SpokenSentence } from "./sentences"

/** CSS Custom Highlights: mark the spoken sentence in place, without touching the DOM. */
const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

export function highlightSentence(sentences: SpokenSentence[], i: number) {
  if (!supported() || !sentences[i]) return
  CSS.highlights.set("narration-now", new Highlight(sentences[i].range))
  const later = sentences.slice(i + 1).map((s) => s.range)
  if (later.length) CSS.highlights.set("narration-later", new Highlight(...later))
  else CSS.highlights.delete("narration-later")
}

export function clearHighlight() {
  if (!supported()) return
  CSS.highlights.delete("narration-now")
  CSS.highlights.delete("narration-later")
}

/** Plain sentences from Markdown, when the narration isn't on screen to read from. */
export function sentencesFromMarkdown(md: string): string[] {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\[(L?\d+)\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#`>|~$\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return plain.split(/(?<=[.!?])\s+/).filter((s) => /[\p{L}\p{N}]/u.test(s))
}
