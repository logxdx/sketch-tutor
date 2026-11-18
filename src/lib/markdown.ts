import { createMathPlugin } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"

/**
 * Streamdown plugins shared by every Markdown surface. The tutor is told to
 * write inline maths as $...$, which the math plugin only parses when
 * singleDollarTextMath is on.
 */
export const math = createMathPlugin({ singleDollarTextMath: true })
export const markdownPlugins = { math, mermaid }
