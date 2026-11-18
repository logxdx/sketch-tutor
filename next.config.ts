import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Node-only libraries (web_fetch, and LiteParse's native PDF bindings); load them from node_modules at runtime.
  serverExternalPackages: ["linkedom", "unpdf", "@mozilla/readability", "turndown", "@llamaindex/liteparse"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
