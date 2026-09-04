/**
 * mockProjectScan — Mock 模式工程发现（外部根目录工程支持）
 *
 * 从 import.meta.glob 的 project.json 条目中提取工程元数据。
 * 内置（../projects/<folder>/project.json）与外部（../../projects/<folder>/project.json）
 * 双前缀 key 都能被发现，返回值带 source 字段与 Electron discover-projects IPC 对齐。
 *
 * 单个条目解析失败跳过（与主进程 discover-projects 的容错语义一致），
 * 不让一个坏 project.json 影响其他工程被发现。
 * 此文件为纯函数模块，tests/externalRoots.test.ts 直接引用锁定行为。
 */

/** 与 Electron discover-projects 返回结构对齐（另加 source 字段） */
export interface DiscoveredProject {
  name: string
  description: string
  version: string
  tags: string[]
  folder: string
  renderMode?: '2d' | '3d'
  defaultScene?: string
  source: 'builtin' | 'external'
}

type ProjectJsonEntry = readonly [string, unknown]

export function scanProjectsFrom(entries: readonly ProjectJsonEntry[]): DiscoveredProject[] {
  const projects: DiscoveredProject[] = []
  for (const [key, data] of entries) {
    if (typeof data !== 'object' || data === null) continue
    const d = data as Record<string, unknown>
    // key 形如 "../projects/fish/project.json"（内置）或 "../../projects/foo/project.json"（外部）
    const match = key.match(/^(?:\.\.\/)+(?:[^/]+\/)*projects\/([^/]+)\/project\.json$/)
    const folder = match?.[1] ?? ''
    if (!folder) continue
    projects.push({
      name: (d.name as string) ?? folder,
      description: (d.description as string) ?? '',
      version: (d.version as string) ?? '1.0.0',
      tags: Array.isArray(d.tags) ? d.tags as string[] : [],
      folder,
      renderMode: (d.renderMode as '2d' | '3d') ?? undefined,
      defaultScene: (d.defaultScene as string) ?? undefined,
      source: key.startsWith('../../') ? 'external' : 'builtin',
    })
  }
  return projects
}
