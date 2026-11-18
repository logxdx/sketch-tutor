import { envProvider, providerStatuses } from "@/lib/agent/models"
import type { SettingsInfo } from "@/lib/agent/settings"

/** Which providers this server can use (never the keys themselves) and their default models. */
export async function GET() {
  const info: SettingsInfo = { active: envProvider(), providers: providerStatuses() }
  return Response.json(info)
}
