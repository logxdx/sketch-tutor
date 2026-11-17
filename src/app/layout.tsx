import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "katex/dist/katex.min.css"
import "streamdown/styles.css"
import "./globals.css"

import { Toaster } from "@/components/ui-sdk/toaster"

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Sketch — the tutor that thinks on a whiteboard",
  description:
    "Ask anything. Sketch explains on a live shared whiteboard, with 3D models, graphs, charts, real images and cited sources.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a18" },
  ],
}

/** Apply the saved / system theme before paint to avoid a flash. */
const themeScript = `(() => {
  try {
    const saved = localStorage.getItem("sketch-theme");
    const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* The app has its own dark theme; ask Dark Reader-style extensions not to recolor it. */}
        <meta name="darkreader-lock" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overflow-hidden">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
