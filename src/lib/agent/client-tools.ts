import { tool } from "ai"

import {
  annotateInput,
  askStudentInput,
  composeInput,
  drawInput,
  eraseInput,
  plotInput,
  pointAtInput,
  quizInput,
} from "./schemas"

/**
 * Tools that run in the student's browser. They have no `execute`, so the
 * agent loop pauses on them, the browser animates them on the shared
 * whiteboard (or waits for the student), and the result comes back with
 * `addToolOutput`.
 */
export const clientTools = {
  draw: tool({
    description:
      "Draw a small visual panel on the shared whiteboard — labelled diagrams, flows, cycles, timelines, tables made of boxes, worked equations. It is animated live, stroke by stroke, with your cursor while the student watches. Coordinates are LOCAL to the panel (0,0 = top-left); the board places the panel in free space. One idea per panel; prefer several small panels over one huge one.",
    inputSchema: drawInput,
  }),
  compose: tool({
    description:
      "Put a ready-made visual on the whiteboard from CONTENT alone — the board lays it out, measures the text and keeps everything apart, so you never compute coordinates. Blocks (stacked in one panel): heading, text, bullets, steps (a process as boxes with arrows), flow (a flowchart / concept map from nodes + edges), cycle (stages that loop), compare (side-by-side columns), table, timeline, equation (worked lines with notes), callout (key idea / tip / warning), tree (a two-level hierarchy), number_line. Animated live like draw; returns the element ids (flow nodes keep your ids) for annotate / point_at.",
    inputSchema: composeInput,
  }),
  plot: tool({
    description:
      "Graph functions of x on labelled axes ON THE WHITEBOARD (hand-drawn, student can annotate it). math.js syntax: x^2, sin(x), exp(-x), sqrt(x), log(x). Optional marked points.",
    inputSchema: plotInput,
  }),
  annotate: tool({
    description:
      "Mark up something already on the board — usually the student's own work: circle, underline, tick, cross, highlight, or arrow with a short note. Use for feedback right where they wrote it.",
    inputSchema: annotateInput,
  }),
  point_at: tool({
    description:
      "Move your cursor to board elements and circle them with a laser pointer, optionally with a short caption. Nothing permanent is drawn. Use it to direct attention (\"look here\").",
    inputSchema: pointAtInput,
  }),
  erase: tool({
    description:
      "Remove elements YOU drew (by id), or all of your drawings with all=true. Never erase the student's work unless asked.",
    inputSchema: eraseInput,
  }),
  ask_student: tool({
    description:
      "Hand the pen to the student: draws a dashed \"Your turn\" frame with a task on the board and waits for them. Use it so they predict, sketch, label or solve a step themselves. Stop after calling it.",
    inputSchema: askStudentInput,
  }),
  quiz: tool({
    description:
      "Ask a question card in the chat: multiple choice (options shown shuffled) or recall (they write the answer; commit your model answer first). The student also rates their confidence and can think out loud, or say they don't know yet — all of that comes back to you. Several quiz calls in one step appear together and you continue when all are answered. Use purpose=probe to measure what they know before teaching, check to test what you just taught.",
    inputSchema: quizInput,
  }),
}

export type ClientToolName = keyof typeof clientTools

/** After these, the tutor waits for the student instead of continuing on its own. */
export const WAITING_TOOLS: ClientToolName[] = ["ask_student"]
