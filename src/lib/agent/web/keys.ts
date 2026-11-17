import "server-only"

import { execFile } from "node:child_process"

/**
 * API keys for web tools, resolved the same way as the pi agent's web-search
 * extension: the system keyring first (libsecret, service "pi-web-search"),
 * then an environment variable of the same name. Keys stored for pi work
 * here with no extra setup.
 *
 *   secret-tool store --label="pi web_search: EXA_API_KEY" service pi-web-search key EXA_API_KEY
 */
const KEYRING_SERVICE = process.env.WEB_KEYRING_SERVICE || "pi-web-search"
const keyCache = new Map<string, string>()

function keyringLookup(name: string): Promise<string | undefined> {
  if (process.env.WEB_KEYRING === "false") return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(
      "secret-tool",
      ["lookup", "service", KEYRING_SERVICE, "key", name],
      { timeout: 5000 },
      // Exits non-zero when there's no such item (or no keyring / secret-tool).
      (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined)
    )
  })
}

export async function resolveKey(name: string): Promise<string | undefined> {
  const cached = keyCache.get(name)
  if (cached) return cached
  const key = (await keyringLookup(name)) ?? process.env[name]
  // Only cache hits, so a key added while the server runs is picked up next time.
  if (key) keyCache.set(name, key)
  return key
}
