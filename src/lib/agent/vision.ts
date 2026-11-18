import "server-only"

import { generateText } from "ai"

import { getModel } from "./models"

export type VisionImage = { data: URL | Uint8Array; mediaType: string }

/** Data URL → image part (media type taken from the URL). */
export const fromDataUrl = (url: string): VisionImage => ({
  data: new URL(url),
  mediaType: url.slice(5, url.indexOf(";")) || "image/jpeg",
})

/**
 * Ask the vision model about one or more images. Reasoning models can spend
 * their whole output budget thinking, so the budget is generous and an empty
 * reply is retried once before giving up with an explicit note.
 */
export async function askVision(images: VisionImage[], prompt: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText({
      model: getModel("vision"),
      abortSignal: signal,
      maxOutputTokens: 6000,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({ type: "file" as const, data: img.data, mediaType: img.mediaType })),
            { type: "text" as const, text: attempt ? `${prompt}\n\nAnswer directly and concisely.` : prompt },
          ],
        },
      ],
    })
    if (text.trim()) return text.trim()
  }
  return "(The vision model returned no answer — try a narrower question.)"
}
