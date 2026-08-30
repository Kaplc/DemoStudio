/**
 * patcher.ts — cordis.patch.yml 读写管理
 *
 * 功能：
 * - 幂等追加/更新/删除 patch insert 行
 * - 解析已有 patch 条目
 *
 * 不依赖 js-yaml，用轻量字符串解析（patch 文件格式固定）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface PatchEntry {
  id: string
  name: string
  config?: Record<string, unknown>
}

export interface PatchResult {
  profile: string
  action: 'added' | 'updated' | 'removed' | 'skipped' | 'error'
  error?: string
}

/**
 * 读取 cordis.patch.yml 的 insert 条目（轻量解析，不依赖 yaml 库）
 */
export function readPatchEntries(dshHome: string, profile: string): PatchEntry[] {
  const patchPath = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) return []

  const content = fs.readFileSync(patchPath, 'utf-8')
  const entries: PatchEntry[] = []

  // 匹配 insert 块中的 id 和 name
  const insertBlockRegex = /- insert:\s*\n((?:\s{4,}.*\n)*)/g
  let match: RegExpExecArray | null
  while ((match = insertBlockRegex.exec(content)) !== null) {
    const block = match[1]
    const idMatch = block.match(/id:\s*(.+)/)
    const nameMatch = block.match(/name:\s*['"]?([^'"\n]+)['"]?/)
    if (idMatch && nameMatch) {
      entries.push({ id: idMatch[1].trim(), name: nameMatch[1].trim() })
    }
  }

  return entries
}

/**
 * 生成 insert 块的 YAML 文本
 */
function formatInsertBlock(entry: PatchEntry): string {
  let yaml = `- insert:\n`
  yaml += `    - id: ${entry.id}\n`
  yaml += `      name: '${entry.name}'\n`
  if (entry.config && Object.keys(entry.config).length > 0) {
    yaml += `      config:\n`
    for (const [key, value] of Object.entries(entry.config)) {
      yaml += `        ${key}: ${JSON.stringify(value)}\n`
    }
  }
  return yaml
}

/**
 * 幂等追加 patch 条目
 */
export function ensurePatchEntry(
  dshHome: string,
  profile: string,
  entry: PatchEntry,
): PatchResult {
  const patchPath = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml')

  // 确保目录存在
  fs.mkdirSync(path.dirname(patchPath), { recursive: true })

  // 读取现有内容
  if (fs.existsSync(patchPath)) {
    const content = fs.readFileSync(patchPath, 'utf-8')

    // 已存在 → 跳过
    if (content.includes(`id: ${entry.id}`)) {
      return { profile, action: 'skipped' }
    }

    // 追加
    const newBlock = formatInsertBlock(entry)
    fs.writeFileSync(patchPath, content.trimEnd() + '\n\n' + newBlock, 'utf-8')
    return { profile, action: 'added' }
  }

  // 文件不存在 → 创建
  const header = `# DSH 插件 patch 文件（由 ds-plugin-manager 自动生成）\n\n`
  fs.writeFileSync(patchPath, header + formatInsertBlock(entry), 'utf-8')
  return { profile, action: 'added' }
}

/**
 * 移除 patch 条目（逐行处理，删除匹配 id 的 insert 块）
 */
export function removePatchEntry(
  dshHome: string,
  profile: string,
  entryId: string,
): PatchResult {
  const patchPath = path.join(dshHome, 'profiles', profile, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) {
    return { profile, action: 'skipped' }
  }

  const content = fs.readFileSync(patchPath, 'utf-8')
  if (!content.includes(`id: ${entryId}`)) {
    return { profile, action: 'skipped' }
  }

  const lines = content.split('\n')
  const newLines: string[] = []
  let skip = false
  let inInsertBlock = false

  for (const line of lines) {
    if (line.trim().startsWith('- insert:')) {
      inInsertBlock = true
      skip = false
      continue
    }

    if (inInsertBlock) {
      if (line.includes(`id: ${entryId}`)) {
        skip = true
        continue
      }
      if (skip && (line.trim() === '' || !line.startsWith('    '))) {
        skip = false
        inInsertBlock = false
      } else if (!skip && line.trim() !== '' && !line.startsWith('    ')) {
        inInsertBlock = false
      }
    }

    if (!skip) {
      newLines.push(line)
    }
  }

  const cleaned = newLines.join('\n').replace(/\n{3,}/g, '\n\n')
  fs.writeFileSync(patchPath, cleaned, 'utf-8')
  return { profile, action: 'removed' }
}

/**
 * 检查 patch 条目是否存在
 */
export function hasPatchEntry(dshHome: string, profile: string, entryId: string): boolean {
  const entries = readPatchEntries(dshHome, profile)
  return entries.some((e) => e.id === entryId)
}
