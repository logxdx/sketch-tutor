"use client"

/** Lazily loaded math.js for client-side graphs (explorer, 3D surfaces). */
let mathPromise: Promise<typeof import("mathjs")> | null = null

export function loadMath() {
  mathPromise ??= import("mathjs")
  return mathPromise
}

export function normalizeExpr(expr: string) {
  return expr
    .replace(/^\s*(y|z|f\s*\([^)]*\))\s*=/i, "")
    .replace(/\*\*/g, "^")
    .replace(/[·×]/g, "*")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .trim()
}
