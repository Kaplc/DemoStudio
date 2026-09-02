import { join } from "node:path"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { ContextTracker } from "./contextTracker.js"

export const name = "@demostudio/ds-context-warning"
export const inject: string[] = []

const THRESHOLDS_K = [100, 200, 250, 300]

export interface Config {
  enabled?: boolean
  projectRoot?: string
  memoryIndexPath?: string
  experienceIndexPath?: string
  rulesIndexPath?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  projectRoot: z.string(),
  memoryIndexPath: z.string(),
  experienceIndexPath: z.string(),
  rulesIndexPath: z.string(),
})

function resolveIndexPath(explicit: string | undefined, dshDir: string, filename: string): string {
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim()
  return join(dshDir, filename)
}

export function apply(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  const root = config?.projectRoot?.trim() || process.cwd()
  const dshDir = join(root, ".dsh")
  const tracker = new ContextTracker({
    thresholdsK: THRESHOLDS_K,
    indexes: {
      memoryIndex: resolveIndexPath(config?.memoryIndexPath, dshDir, "memory/MEMORY.md"),
      experienceIndex: resolveIndexPath(config?.experienceIndexPath, dshDir, "experience/INDEX.md"),
      rulesIndex: resolveIndexPath(config?.rulesIndexPath, dshDir, "rules/RULES.md"),
    },
  })
  tracker.install(ctx)
}
