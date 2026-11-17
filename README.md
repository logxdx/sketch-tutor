# ✏️ Sketch — the tutor that thinks on a whiteboard

Ask anything — maths, science, history, code, languages. Sketch explains it **live on a shared
whiteboard**, drawing stroke by stroke with its own cursor while it talks, and backs it up with
**interactive 3D models, graphs, data charts, real images and cited web sources**. You draw on the
same board: select something and ask about it, solve a step yourself and have it marked, or let
it watch you draw and nudge you along.

## What it can do

| | |
|---|---|
| **Live whiteboard** | Embedded [Excalidraw](https://github.com/excalidraw/excalidraw). The tutor draws labelled diagrams, flows and timelines, graphs functions, circles/ticks/crosses your work, and laser-points with its cursor. Everything stays editable. |
| **Collaboration** | Select elements → *Ask Sketch about this*. *Your turn* frames hand you the pen; *Check my work* sends a snapshot and gets your work marked on the board. *Watch me draw* gives short feedback whenever you pause. |
| **3D** | Interactive three.js scenes (molecules, orbits, vectors, solids, surfaces `y=f(x,z)`, parametric curves) — orbit, zoom, expand. |
| **Graphs & data** | Hand-drawn function plots on the board; slider explorers for `y = f(x, params)`; bar/line/area/scatter charts with tooltips and a table view. |
| **Sources & images** | Web search, page/PDF reading and a research sub-agent with numbered citations; openly licensed Wikimedia images you can pin onto the board. |
| **Exact maths** | math.js engine for arithmetic, units, simplification, derivatives and roots. |
| **Teaching modes** | *Explain* (tutor leads), *Guide* (Socratic), *Quiz* (practice + marking), any subject. |

## How it works

```
Browser                                            Server (Next.js route /api/chat)
────────                                           ───────────────────────────────
Excalidraw board ◄── BoardController ◄──┐          Stage 1  perception
  (draw / plot / annotate / point_at /  │            vision model reads the board snapshot
   erase / ask_student, animated)       │          Stage 2  ToolLoopAgent (AI SDK v7)
                                        │            server tools run inline:
useChat ── board state + snapshot ──────┼──────►       web_search · web_fetch · research (sub-agent)
   ▲                                    │              find_images · calculate · look_closer
   │   tool calls for the board ────────┘              show_3d · chart · explore · suggest_replies
   └── streamed text, reasoning, rich cards ◄──      client tools pause the loop → browser runs them
```

- **Agent:** the Vercel AI SDK's own `ToolLoopAgent`, the most native fit for this Next.js +
  `useChat` stack. Server tools run inside the loop; board tools and quizzes have no `execute`, so
  the loop pauses, the browser animates them on the canvas and reports back (`addToolOutput`), and
  `useChat` continues automatically — except after *ask_student*, where it waits for you.
- **Web tools** are ported from the pi agent setup (`~/.pi/agent/extensions/web-search`, `web-fetch`,
  and the `researcher` agent): TinyFish → LangSearch → Exa → ddgs → Wikipedia search with
  automatic fallback, and TinyFish → Readability/Turndown (HTML, PDF, Next.js RSC) → Jina fetch.
  Keys come from the same keyring entries (`secret-tool … service pi-web-search`), then env.
  A server-side SSRF guard blocks fetches to local/private addresses.
- **UI:** [shadcn/ui](https://ui.shadcn.com) for the theme and styled primitives, and
  [UI SDK](https://github.com/vercel-labs/ui) (`@ui-sdk/react`) for behaviours — resizable panels,
  command palette (⌘K), select, segmented control, switch, tooltips, toasts, timeline (lesson
  outline), collapsibles, sliders, dialogs and keyboard shortcuts.

## Setup

```bash
npm install
cp .env.example .env.local     # add GROQ_API_KEY (or another OpenAI-compatible endpoint)
npm run dev                    # http://localhost:3000
```

Defaults on Groq: `openai/gpt-oss-120b` (tutor), `meta-llama/llama-4-scout-17b-16e-instruct`
(vision), `openai/gpt-oss-20b` (research) — override any of them in `.env.local`.

**Web search without keys:** the keyless `ddgs` metasearch needs a Python venv. If you already set
it up for pi it is reused automatically; otherwise:

```bash
uv venv .venv && uv pip install --python .venv/bin/python -r scripts/ddgs-requirements.txt
```

Wikipedia is always available as the last fallback.

**Try it without an API key:** `TUTOR_MOCK=1 npm run dev` swaps only the LLM for a scripted one —
the agent loop, web search, images, maths and the board are all real. Click the starter prompts.
⌘K → *Play a demo lesson* runs the board tools with no model at all.

## Keyboard

`⌘K` command palette · `/` focus the message box · `Esc` stop the tutor · `Enter` send ·
`Shift+Enter` new line. All Excalidraw shortcuts work on the board.

## Project layout

```
src/app/api/chat/route.ts      two-stage pipeline (perception → agent), streamed to useChat
src/app/api/image/route.ts     Wikimedia image proxy (for pinning images onto the canvas)
src/lib/agent/                 agent, prompts, models, tool schemas, server tools, mock model
src/lib/agent/web/             web search / fetch / research, ported from the pi setup
src/lib/board/                 BoardController: animated drawing, layout, plots, snapshots
src/components/                workspace, whiteboard, chat + tool cards, 3D/chart/explorer
src/components/ui-sdk/         UI SDK components styled with shadcn tokens
legacy/                        the original Streamlit math tutor (Python)
```

## License

MIT — see [LICENSE](LICENSE).
