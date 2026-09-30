/** Type declarations for scripts/dsh-patch-merge.mjs (cordis.patch.yml merge helpers). */
export function splitTopLevelBlocks(text: string): string[]
export function isManagedBlock(block: string): boolean
export function mergeProfilePatch(generated: string, existing?: string | null): string
