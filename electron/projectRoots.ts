/**
 * projectRoots — 工程根解析（工程单根：projects/）
 *
 * DemoStudio 全部工程位于仓库根 projects/（doc-dev/projects-root-unification 单根化，
 * 原内置+外部双轨已退役）。
 *
 * 所有工程相关 IPC（discover/list/asset-file-ops/watch/read/write-json）统一从
 * 本模块取根。根以数组形式维护（历史上曾是"内置案例根 + 外部用户根"双轨），
 * 纯函数全部按数组遍历实现——未来若再引入新根零改动。
 *
 * 契约：所有函数第一个参数是 appRoot（应用根 = 仓库根绝对路径）。
 * main.ts 调用侧传 path.join(__dirname, '..')（__dirname 为 dist-electron，上一级即仓库根），
 * 与原各 handler 的 path.join(__dirname, '..') 完全同构；逻辑抽为纯函数供测试锁定行为。
 */
import path from 'path'
import fs from 'fs'

/** 工程根常量：相对应用根（单根） */
export const PROJECT_ROOTS = ['projects'] as const

export type ProjectRootRel = (typeof PROJECT_ROOTS)[number]

/** main.ts 便捷入口：由主进程模块目录（dist-electron）推导应用根 */
export function appRootFromMainDir(mainDir: string): string {
  return path.join(mainDir, '..')
}

/** 某一工程根的绝对路径；不存在时返回 null（目录懒创建：根可能尚未生成） */
export function resolveProjectRoot(appRoot: string, root: ProjectRootRel): string | null {
  const abs = path.join(appRoot, root)
  return fs.existsSync(abs) ? abs : null
}

/** 全部真实存在的工程根（按 PROJECT_ROOTS 顺序） */
export function resolveProjectRoots(appRoot: string): string[] {
  return PROJECT_ROOTS
    .map(r => resolveProjectRoot(appRoot, r))
    .filter((r): r is string => r !== null)
}

/**
 * 按 folder 名查它位于哪个根（返回根的相对形式）。
 * 多根时按 PROJECT_ROOTS 顺序先命中先返回。
 */
export function projectRootFor(appRoot: string, folder: string): ProjectRootRel | null {
  for (const root of PROJECT_ROOTS) {
    if (fs.existsSync(path.join(appRoot, root, folder))) return root
  }
  return null
}

/**
 * 绝对路径 → 应用根相对路径（正斜杠）。越界（不在应用根内）返回 null。
 * 各 IPC 的路径逃逸防护统一走这里。
 */
export function relativeRootFor(appRoot: string, absPath: string): string | null {
  const rel = path.relative(appRoot, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.replace(/\\/g, '/')
}

/**
 * 资产路径校验：相对路径必须位于任一工程根的 <folder>/asset/ 目录内
 */
export function isProjectAssetRel(relPath: string): boolean {
  return PROJECT_ROOTS.some(root => {
    const prefix = `${root}/`
    if (!relPath.startsWith(prefix)) return false
    const rest = relPath.slice(prefix.length)
    // 至少 folder/asset/file 三段；第二段必须是 asset
    const segs = rest.split('/')
    return segs.length >= 3 && segs[1] === 'asset'
  })
}
