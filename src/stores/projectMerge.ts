/**
 * projectMerge — 工程列表合并去重（工程单根化后的退化形态）
 *
 * 合并规则：folder 相同视为同一工程，保留首个并 console.warn 提示（正常不会发生——
 * folder 唯一即工程唯一；发生时多为复制工程改漏了 folder/name，warn 足够定位）。
 * 历史行为：曾是"内置/外部双轨合并，外部覆盖内置"；双轨内置部分退役后
 * 退化为单参按 folder 去重（doc-dev/projects-root-unification）。
 *
 * 告警走 console.warn 而非 engine/logger：本模块被 projectStore 引用，
 * 而 store 链路（含 agent 窗口）不应拉起整个引擎模块树。
 * 此文件为纯函数模块，tests/mockProjectBridge.test.ts 直接引用锁定行为。
 */

export interface ProjectMergeItem {
  name: string
  folder: string
}

export function mergeProjects<T extends ProjectMergeItem>(projects: readonly T[]): T[] {
  const result: T[] = []
  for (const p of projects) {
    const idx = result.findIndex(r => r.folder === p.folder)
    if (idx >= 0) {
      console.warn(
        `[ProjectMerge] 工程 "${p.name}"(folder=${p.folder}) 与已有条目重名，保留首个（请检查 folder/name 是否改漏）`,
      )
      continue
    }
    result.push(p)
  }
  return result
}
