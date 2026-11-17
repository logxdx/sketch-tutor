export type Box = { x: number; y: number; w: number; h: number }
export type Pt = { x: number; y: number }

export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const pad = (b: Box, p: number): Box => ({
  x: b.x - p,
  y: b.y - p,
  w: b.w + p * 2,
  h: b.h + p * 2,
})

export const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Point where the ray from the shape's centre towards `toward` leaves its
 * outline (rectangle, ellipse or diamond), pushed out by `gap`.
 */
export function edgePoint(
  b: Box,
  toward: Pt,
  gap = 6,
  shape: "rect" | "ellipse" | "diamond" = "rect"
): Pt {
  const c = center(b)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const a = b.w / 2
  const h = b.h / 2
  let scale: number
  if (shape === "ellipse") {
    scale = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (h * h))
  } else if (shape === "diamond") {
    scale = 1 / (Math.abs(dx) / a + Math.abs(dy) / h)
  } else {
    scale = Math.min(dx !== 0 ? a / Math.abs(dx) : Infinity, dy !== 0 ? h / Math.abs(dy) : Infinity)
  }
  const len = Math.hypot(dx, dy)
  const k = scale + gap / len
  return { x: c.x + dx * k, y: c.y + dy * k }
}

export function polylineLength(points: Pt[]) {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

/** The first `t` (0..1) of a polyline, by length. */
export function polylinePrefix(points: Pt[], t: number): Pt[] {
  if (t >= 1 || points.length < 2) return points
  const total = polylineLength(points)
  let remaining = total * Math.max(0, t)
  const out: Pt[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg >= remaining) {
      const k = seg === 0 ? 0 : remaining / seg
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
      return out
    }
    out.push(b)
    remaining -= seg
  }
  return out
}

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function wrapText(text: string, maxChars: number) {
  return text
    .split("\n")
    .map((line) => {
      const words = line.split(/\s+/)
      const lines: string[] = []
      let cur = ""
      for (const w of words) {
        if (!cur) cur = w
        else if ((cur + " " + w).length <= maxChars) cur += " " + w
        else {
          lines.push(cur)
          cur = w
        }
      }
      if (cur) lines.push(cur)
      return lines.join("\n")
    })
    .join("\n")
}

/** Round "nice" tick step for an axis range. */
export function niceStep(range: number, targetTicks = 5) {
  const raw = range / targetTicks
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return nice * mag
}

export const fmt = (n: number) =>
  Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)
    ? n.toExponential(1)
    : String(Math.round(n * 100) / 100)
