"use client"

import "@excalidraw/excalidraw/index.css"

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw"
import * as React from "react"

import { BoardController } from "@/lib/board/controller"

/**
 * The shared canvas. Loaded client-only (Excalidraw touches `window`); hands
 * a BoardController to the workspace once the imperative API is ready.
 */
export default function Whiteboard({
  onReady,
  theme,
}: {
  onReady: (controller: BoardController) => void
  theme: "light" | "dark"
}) {
  const controllerRef = React.useRef<BoardController | null>(null)

  return (
    <div className="board-host absolute inset-0">
      <Excalidraw
        theme={theme}
        excalidrawAPI={(api) => {
          // Excalidraw can mount twice (Strict Mode); always drive the live instance.
          if (controllerRef.current) {
            controllerRef.current.attach(api)
            return
          }
          const controller = new BoardController(api)
          controllerRef.current = controller
          onReady(controller)
        }}
        onChange={(elements, appState) => controllerRef.current?.handleChange(elements, appState)}
        onPointerUpdate={({ button }) => controllerRef.current?.handlePointer(button)}
        initialData={{
          appState: {
            currentItemFontFamily: 5,
            currentItemRoughness: 1,
            currentItemStrokeWidth: 2,
          },
        }}
        UIOptions={{
          canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true } },
          tools: { image: true },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
