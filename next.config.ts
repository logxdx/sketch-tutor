import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Node-only libraries used by the web_fetch tool; load them from node_modules at runtime.
  serverExternalPackages: ["linkedom", "unpdf", "@mozilla/readability", "turndown"],
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
