/**
 * Narration text: the sentences of a rendered narration block, each with what to say and the
 * DOM range it covers (so the sentence being spoken can be highlighted in place). Reading the
 * rendered DOM rather than the Markdown source means formatting is already gone; maths is spoken
 * from its TeX source, citations and code are left out.
 */

export type SpokenSentence = { speech: string; range: Range }

type Token = {
  /** Text as it reads on the page (for sentence splitting). */
  shown: string
  /** What to say for it. */
  spoken: string
  /** Where it is: a text node + offsets, or a whole element (maths). */
  node: Node
  start?: number
  end?: number
  /** A block boundary: always ends a sentence. */
  breakAfter?: boolean
}

const BLOCK = /^(P|LI|H[1-6]|BLOCKQUOTE|TR|DIV|UL|OL|TABLE)$/
const SKIP_SELECTOR = "pre, code, svg, .katex-mathml, [data-no-speech], sup"

/** Read simple TeX aloud: enough for the formulas a tutor writes inline. */
export function speakTex(tex: string): string {
  let s = ` ${tex} `
  const rules: [RegExp, string][] = [
    [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, " $1 over $2 "],
    [/\\sqrt\s*\{([^{}]*)\}/g, " the square root of $1 "],
    [/\^\s*\{?2\}?/g, " squared "],
    [/\^\s*\{?3\}?/g, " cubed "],
    [/\^\s*\{([^{}]*)\}/g, " to the power $1 "],
    [/\^\s*(\w)/g, " to the power $1 "],
    [/_\s*\{([^{}]*)\}/g, " sub $1 "],
    [/_\s*(\w)/g, " sub $1 "],
    [/\\(cdot|times)/g, " times "],
    [/\\div/g, " divided by "],
    [/\\pm/g, " plus or minus "],
    [/\\(le|leq)\b/g, " is at most "],
    [/\\(ge|geq)\b/g, " is at least "],
    [/\\(ne|neq)\b/g, " is not equal to "],
    [/\\approx/g, " is about "],
    [/\\to|\\rightarrow/g, " goes to "],
    [/\\infty/g, " infinity "],
    [/\\(sin|cos|tan|log|ln|exp)\b/g, " $1 "],
    [/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|Delta|Sigma|Omega)\b/g, " $1 "],
    [/\\[a-zA-Z]+/g, " "],
    [/=/g, " equals "],
    [/</g, " is less than "],
    [/>/g, " is greater than "],
    [/\+/g, " plus "],
    [/(\s)-(\s|\d|\w)/g, "$1minus $2"],
    [/[{}$\\]/g, " "],
  ]
  for (const [re, to] of rules) s = s.replace(re, to)
  return s.replace(/\s+/g, " ").trim()
}

function texOf(el: Element) {
  return el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.textContent ?? ""
}

function collect(root: HTMLElement): Token[] {
  const tokens: Token[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (text) tokens.push({ shown: text, spoken: text, node, start: 0, end: text.length })
      return
    }
    if (!(node instanceof Element)) return
    if (node.matches(SKIP_SELECTOR)) return
    if (node.classList.contains("katex")) {
      const tex = texOf(node)
      tokens.push({ shown: "x", spoken: speakTex(tex), node })
      return
    }
    node.childNodes.forEach(walk)
    if (BLOCK.test(node.tagName) && tokens.length) tokens[tokens.length - 1].breakAfter = true
  }
  walk(root)
  return tokens
}

/** Clean what will be spoken: citation markers, stray symbols, emoji. */
function cleanSpeech(s: string) {
  return s
    .replace(/\[(L?\d+)\]/g, "")
    .replace(/[*_#`>|~]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** The sentences of a narration block, in reading order. */
export function sentencesOf(root: HTMLElement): SpokenSentence[] {
  const tokens = collect(root)
  const out: SpokenSentence[] = []
  let speech = ""
  let first: { node: Node; offset: number; whole: boolean } | null = null
  let last: { node: Node; offset: number; whole: boolean } | null = null

  const flush = () => {
    const said = cleanSpeech(speech)
    if (said && first && last && /[\p{L}\p{N}]/u.test(said)) {
      const range = document.createRange()
      if (first.whole) range.setStartBefore(first.node)
      else range.setStart(first.node, first.offset)
      if (last.whole) range.setEndAfter(last.node)
      else range.setEnd(last.node, last.offset)
      out.push({ speech: said, range })
    }
    speech = ""
    first = last = null
  }

  for (const t of tokens) {
    if (t.start === undefined) {
      // Maths (or another atomic element): one piece, never split inside.
      if (!first) first = { node: t.node, offset: 0, whole: true }
      last = { node: t.node, offset: 0, whole: true }
      speech += ` ${t.spoken} `
    } else {
      const text = t.shown
      // Sentence ends: . ! ? (with closing quotes/brackets) followed by space or the end of the node.
      const re = /[.!?]+["')\]]*(?=\s|$)/g
      let from = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const to = m.index + m[0].length
        const piece = text.slice(from, to)
        if (piece.trim()) {
          if (!first) first = { node: t.node, offset: from + (piece.length - piece.trimStart().length), whole: false }
          last = { node: t.node, offset: to, whole: false }
          speech += piece
        }
        flush()
        from = to
      }
      const rest = text.slice(from)
      if (rest.trim()) {
        if (!first) first = { node: t.node, offset: from + (rest.length - rest.trimStart().length), whole: false }
        last = { node: t.node, offset: from + rest.trimEnd().length, whole: false }
      }
      speech += rest
    }
    if (t.breakAfter) flush()
  }
  flush()
  return out
}
