/**
 * Text on the board: wrap by measured width (Excalifont, on a canvas) instead of counting
 * characters, so a label is exactly as tall as it will render — the layout engine needs that
 * to keep things from overlapping. Falls back to a cautious estimate before the font loads.
 */

/** Excalifont's line height in Excalidraw. */
export const LINE_HEIGHT = 1.25

let ctx: CanvasRenderingContext2D | null | undefined

function context() {
  if (ctx === undefined) ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")
  return ctx
}

export function textWidth(text: string, fontSize: number) {
  const c = context()
  const ready = typeof document !== "undefined" && document.fonts?.check?.(`${fontSize}px Excalifont`)
  if (!c || !ready) return text.length * fontSize * 0.62
  c.font = `${fontSize}px Excalifont, Xiaolai, Segoe UI Emoji, sans-serif`
  return c.measureText(text).width
}

/** Greedy word wrap to `width` px; words longer than a line are split. Keeps explicit newlines. */
export function wrapToWidth(text: string, width: number, fontSize: number): string {
  const out: string[] = []
  for (const para of text.split("\n")) {
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word
      if (textWidth(tryLine, fontSize) <= width) {
        line = tryLine
        continue
      }
      if (line) out.push(line)
      // A single word wider than the line: cut it.
      let rest = word
      while (textWidth(rest, fontSize) > width && rest.length > 1) {
        let n = rest.length - 1
        while (n > 1 && textWidth(rest.slice(0, n), fontSize) > width) n--
        out.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    out.push(line)
  }
  return out.join("\n")
}

export const textHeight = (lines: number, fontSize: number) => lines * fontSize * LINE_HEIGHT

/** Width of the widest line. */
export const blockWidth = (text: string, fontSize: number) =>
  Math.max(0, ...text.split("\n").map((l) => textWidth(l, fontSize)))
