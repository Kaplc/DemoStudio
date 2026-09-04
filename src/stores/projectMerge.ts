/**
 * projectMerge — 内置/外部工程列表合并（外部根目录工程支持）
 *
 * 合并规则（doc/dev/external_project_roots.md §2 命名冲突策略）：
 *   - 外部工程与内置工程同名（folder 相同）→ 外部覆盖内置（保留内置列表中的位置），logger.warn 提示
 *     刻意支持"复制 fish 到 projects/ 魔改，不污染案例库"的工作流
 *   - 无冲突 → 外部工程追加在内置列表之后
 *
 * 告警走 console.warn 而非 engine/logger：本模块被 projectStore 引用，
 * 而 store 链路（含 agent 窗口）不应拉起整个引擎模块树。
 * 此文件为纯函数模块，tests/externalRoots.test.ts 直接引用锁定行为。
 */

export interface ProjectMergeItem {
  name: string
  folder: string
  source?: 'builtin' | 'external'
}

export function mergeProjects<T extends ProjectMergeItem>(builtin: readonly T[], external: readonly T[]): T[] {
  if (external.length === 0) return [...builtin]

  const result = [...builtin]
  for (const ext of external) {
    const idx = result.findIndex(p => p.folder === ext.folder)
    if (idx >= 0) {
      console.warn(
        `[ProjectMerge] 外部工程 "${ext.name}"(folder=${ext.folder}) 覆盖内置同名工程（外部优先，可魔改不污染案例库）`,
      )
      result[idx] = ext
    } else {
      result.push(ext)
    }
  }
  return result
}
