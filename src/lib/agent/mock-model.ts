import "server-only"

import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"

/**
 * Scripted stand-in for the LLM, enabled with TUTOR_MOCK=1. Everything else in
 * the pipeline is real — the route, the ToolLoopAgent, server tools (live web
 * search, Wikimedia, math.js), the browser tools on the canvas — only the
 * choice of words and tool calls is scripted. Used to test features without
 * an API key; never enabled by default.
 */

type ToolCall = { name: string; input: unknown }
type Step = { text?: string; reasoning?: string; tools?: ToolCall[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prompt = any[]

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { text: string }) => p.text)
          .join("\n")
      : ""

function scenario(prompt: Prompt) {
  const system = textOf(prompt.find((m) => m.role === "system")?.content ?? "")
  const userIdx = prompt.findLastIndex((m) => m.role === "user")
  const user = textOf(prompt[userIdx]?.content ?? "")
  const stepsSoFar = prompt.slice(userIdx + 1).filter((m) => m.role === "assistant").length
  const toolResults = prompt
    .slice(userIdx + 1)
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content)
  return { system, user: user.toLowerCase(), raw: user, step: stepsSoFar, toolResults }
}

/** First student-made element id listed in BOARD STATE, if any. */
function studentElement(system: string) {
  return system.match(/^S \| ([\w-]+)/m)?.[1]
}

function tutorScript(prompt: Prompt): Step[] {
  const { system, user } = scenario(prompt)

  if (system.includes("research specialist")) {
    return [
      { tools: [{ name: "web_search", input: { query: "fall of the Western Roman Empire causes", count: 4 } }] },
      { tools: [{ name: "web_fetch", input: { url: "https://en.wikipedia.org/wiki/Fall_of_the_Western_Roman_Empire" } }] },
      {
        text: `## Summary\n- The Western Roman Empire ended in 476 CE when Odoacer deposed Romulus Augustulus [1].\n- Long-run causes: political instability, fiscal strain, and pressure from migrating peoples [1][2].\n## Sources\n1. Fall of the Western Roman Empire — https://en.wikipedia.org/wiki/Fall_of_the_Western_Roman_Empire`,
      },
    ]
  }

  if (user.startsWith("[watching]")) {
    return [{ text: "Nice — keep going, you're on the right track! ✏️" }]
  }

  if (user.startsWith("[check]")) {
    const id = studentElement(system)
    return [
      {
        text: "Let me look at what you drew…",
        tools: id
          ? [{ name: "annotate", input: { targets: [id], style: "check", note: "Yes! Groundwater feeds rivers" } }]
          : [{ name: "look_closer", input: { question: "What did the student draw?" } }],
      },
      {
        text: "Great work — that's exactly where groundwater fits: rain soaks in and slowly flows back to rivers and the sea.",
        tools: [{ name: "suggest_replies", input: { options: ["What's an aquifer?", "Quiz me", "Next topic"] } }],
      },
    ]
  }

  if (user.includes("photosynthesis")) {
    return [
      {
        reasoning: "Draw inputs → leaf → outputs, then ground the numbers with a search.",
        text: "Photosynthesis turns light into chemical energy. Let me sketch the inputs and outputs:",
        tools: [
          {
            name: "draw",
            input: {
              title: "Photosynthesis at a glance",
              shapes: [
                { kind: "text", x: 0, y: 0, text: "Photosynthesis", size: "xl", color: "green" },
                { id: "sun", kind: "ellipse", x: 0, y: 80, w: 150, h: 70, text: "Light", color: "orange", fill: true },
                { id: "co2", kind: "rect", x: 0, y: 200, w: 150, h: 60, text: "CO₂ + H₂O", color: "blue" },
                { id: "leaf", kind: "diamond", x: 260, y: 120, w: 190, h: 130, text: "Chloroplast", color: "green", fill: true },
                { id: "out", kind: "rect", x: 540, y: 150, w: 190, h: 70, text: "Glucose + O₂", color: "green" },
                { kind: "arrow", from: "sun", to: "leaf", color: "orange" },
                { kind: "arrow", from: "co2", to: "leaf", color: "blue" },
                { kind: "arrow", from: "leaf", to: "out", text: "makes", color: "green" },
                { kind: "text", x: 0, y: 320, text: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", size: "l" },
              ],
            },
          },
        ],
      },
      {
        text: "The key part is the chloroplast — that's where light is captured:",
        tools: [{ name: "point_at", input: { targets: ["leaf"], caption: "light → chemical energy" } }],
      },
      {
        text: "Let me check a reliable source for the details.",
        tools: [{ name: "web_search", input: { query: "photosynthesis light dependent reactions chloroplast", count: 4 } }],
      },
      {
        text: "The light reactions happen in the thylakoid membranes and split water, releasing O₂ [1]. The energy is then used by the Calvin cycle to build glucose [2].\n\n$$6CO_2 + 6H_2O \\xrightarrow{light} C_6H_{12}O_6 + 6O_2$$",
        tools: [{ name: "suggest_replies", input: { options: ["What is the Calvin cycle?", "Quiz me", "Show me a chloroplast"] } }],
      },
    ]
  }

  if (user.includes("3d") || user.includes("molecule")) {
    const H = 0.9
    const a = (104.5 / 2) * (Math.PI / 180)
    return [
      {
        text: "Here's water in 3D — drag to orbit. Oxygen pulls the shared electrons toward itself, and the bent shape means the charges don't cancel:",
        tools: [
          {
            name: "show_3d",
            input: {
              title: "Water molecule (H₂O)",
              caption: "Bent shape, 104.5° bond angle → a polar molecule",
              showGrid: true,
              objects: [
                { kind: "sphere", position: [0, 1, 0], size: 0.5, color: "#e03131", label: "O (δ−)" },
                { kind: "sphere", position: [Math.sin(a) * H * 1.4, 1 - Math.cos(a) * H * 1.4, 0], size: 0.3, color: "#f1f3f5", label: "H (δ+)" },
                { kind: "sphere", position: [-Math.sin(a) * H * 1.4, 1 - Math.cos(a) * H * 1.4, 0], size: 0.3, color: "#f1f3f5", label: "H (δ+)" },
                { kind: "line", from: [0, 1, 0], to: [Math.sin(a) * H * 1.4, 1 - Math.cos(a) * H * 1.4, 0], color: "#868e96" },
                { kind: "line", from: [0, 1, 0], to: [-Math.sin(a) * H * 1.4, 1 - Math.cos(a) * H * 1.4, 0], color: "#868e96" },
                { kind: "vector", from: [0, 0.2, 0], to: [0, 1.6, 0], color: "#7c3aed", label: "dipole" },
              ],
              autoRotate: true,
            },
          },
          { name: "find_images", input: { query: "water molecule diagram", count: 4 } },
        ],
      },
      {
        text: "That net dipole is why water dissolves salts and has such a high boiling point.",
        tools: [{ name: "suggest_replies", input: { options: ["Why is the angle 104.5°?", "Show hydrogen bonding", "Quiz me"] } }],
      },
    ]
  }

  if (user.includes("compound interest")) {
    return [
      {
        text: "Compound interest grows on itself: each year you earn interest on last year's interest. Play with the rate and time:",
        tools: [
          {
            name: "explore",
            input: {
              title: "Growth of $1,000",
              expr: "P * (1 + r)^x",
              params: [
                { name: "P", min: 100, max: 5000, step: 100, value: 1000, label: "principal" },
                { name: "r", min: 0, max: 0.2, step: 0.005, value: 0.07, label: "yearly rate" },
              ],
              xMin: 0,
              xMax: 40,
              yMin: 0,
              yMax: 20000,
              caption: "Drag r from 3% to 10% and watch year 40 explode",
            },
          },
          { name: "calculate", input: { operation: "evaluate", expression: "1000 * (1 + 0.07)^30" } },
        ],
      },
      {
        text: "Compare simple vs compound interest over time:",
        tools: [
          {
            name: "chart",
            input: {
              title: "$1,000 at 7%: simple vs compound",
              kind: "line",
              xKey: "year",
              series: [
                { key: "simple", label: "Simple" },
                { key: "compound", label: "Compound" },
              ],
              data: [0, 5, 10, 15, 20, 25, 30].map((y) => ({
                year: y,
                simple: Math.round(1000 * (1 + 0.07 * y)),
                compound: Math.round(1000 * Math.pow(1.07, y)),
              })),
              xLabel: "Years",
              yLabel: "Balance ($)",
              source: "Computed with A = P(1+r)^t",
            },
          },
          { name: "plot", input: { title: "y = 1.07^x", functions: [{ expr: "1.07^x", label: "1.07^x" }], xMin: 0, xMax: 30 } },
        ],
      },
      {
        text: "Quick check:",
        tools: [
          {
            name: "quiz",
            input: {
              question: "Roughly how long does money take to double at 7% compound interest?",
              options: ["About 5 years", "About 10 years", "About 20 years", "About 14 years"],
              correctIndex: 1,
              explanation: "Rule of 72: 72 ÷ 7 ≈ 10.3 years.",
            },
          },
        ],
      },
      {
        text: "That's the Rule of 72 in action — divide 72 by the rate to estimate the doubling time.",
        tools: [{ name: "suggest_replies", input: { options: ["Why does the rule of 72 work?", "What about inflation?"] } }],
      },
    ]
  }

  if (user.includes("roman")) {
    return [
      { text: "Big question — let me research it properly first.", tools: [{ name: "research", input: { question: "What caused the fall of the Western Roman Empire?" } }] },
      {
        text: "Historians point to a mix of causes rather than one [1]. Here's the timeline:",
        tools: [
          {
            name: "draw",
            input: {
              title: "Fall of Rome — timeline",
              shapes: [
                { id: "l", kind: "line", points: [{ x: 0, y: 60 }, { x: 760, y: 60 }], color: "gray" },
                { id: "a", kind: "ellipse", x: 40, y: 45, w: 30, h: 30, color: "blue", fill: true },
                { kind: "text", x: 10, y: 90, text: "235–284\nCrisis of the\n3rd century", size: "s" },
                { id: "b", kind: "ellipse", x: 330, y: 45, w: 30, h: 30, color: "orange", fill: true },
                { kind: "text", x: 300, y: 90, text: "410\nVisigoths\nsack Rome", size: "s" },
                { id: "c", kind: "ellipse", x: 680, y: 45, w: 30, h: 30, color: "red", fill: true },
                { kind: "text", x: 640, y: 90, text: "476\nRomulus Augustulus\ndeposed", size: "s" },
              ],
            },
          },
        ],
      },
      { text: "Which cause do you think mattered most?", tools: [{ name: "suggest_replies", input: { options: ["Money problems", "Invasions", "Politics"] } }] },
    ]
  }

  if (user.includes("quiz") || user.includes("quadratic")) {
    return [
      {
        text: "Let's practise. Solve this one on the board — show your steps:",
        tools: [{ name: "ask_student", input: { task: "Solve x² − 5x + 6 = 0 and circle your answers." } }],
      },
      { text: "" },
    ]
  }

  if (user.includes("selected")) {
    const id = system.match(/STUDENT SELECTED: ([\w-]+)/)?.[1]
    return [
      {
        text: "You selected this — here's what it is:",
        tools: id ? [{ name: "point_at", input: { targets: [id], caption: "this one" } }] : [],
      },
      { text: "That's the part I was describing. Want me to go deeper?" },
    ]
  }

  return [{ text: `(mock) You said: “${user.slice(0, 80)}”. Try one of the starter prompts to see a full scripted lesson.` }]
}

let counter = 0

function toChunks(step: Step) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks: any[] = [{ type: "stream-start", warnings: [] }]
  if (step.reasoning) {
    chunks.push({ type: "reasoning-start", id: "r" })
    chunks.push({ type: "reasoning-delta", id: "r", delta: step.reasoning })
    chunks.push({ type: "reasoning-end", id: "r" })
  }
  if (step.text) {
    chunks.push({ type: "text-start", id: "t" })
    for (const word of step.text.split(/(?<= )/)) chunks.push({ type: "text-delta", id: "t", delta: word })
    chunks.push({ type: "text-end", id: "t" })
  }
  for (const call of step.tools ?? []) {
    chunks.push({ type: "tool-call", toolCallId: `mock_${++counter}`, toolName: call.name, input: JSON.stringify(call.input) })
  }
  chunks.push({
    type: "finish",
    finishReason: { unified: step.tools?.length ? "tool-calls" : "stop", raw: undefined },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
  })
  return chunks
}

export function mockModel(role: string) {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `mock-${role}`,
    doStream: async ({ prompt }) => {
      const { step } = scenario(prompt as Prompt)
      const script = tutorScript(prompt as Prompt)
      const current: Step = script[step] ?? { text: "" }
      return { stream: simulateReadableStream({ chunks: toChunks(current), chunkDelayInMs: 18 }) }
    },
    doGenerate: async ({ prompt }) => {
      const { step } = scenario(prompt as Prompt)
      const script = tutorScript(prompt as Prompt)
      const current: Step = script[step] ?? { text: "" }
      const isVision = !script.length || (prompt as Prompt).some((m) => Array.isArray(m.content) && m.content.some((p: { type: string }) => p.type === "file"))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = []
      if (isVision && !(prompt as Prompt).some((m) => textOf(m.content).includes("research specialist"))) {
        content.push({ type: "text", text: "- The student drew a freehand stroke inside the your-turn frame (mock vision reading)." })
      } else {
        if (current.text) content.push({ type: "text", text: current.text })
        for (const call of current.tools ?? []) {
          content.push({ type: "tool-call", toolCallId: `mock_${++counter}`, toolName: call.name, input: JSON.stringify(call.input) })
        }
      }
      return {
        content,
        finishReason: { unified: current.tools?.length && !isVision ? "tool-calls" : "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
}
