/**
 * mockPath — Mock 模式 glob key 路径翻译（工程单根）
 *
 * 浏览器调试模式下 import.meta.glob 返回的 key 与 Electron IPC 期望的路径形式不同：
 *   工程根 key："../../projects/foo/project.json" → IPC 期望 "projects/foo/project.json"
 *
 * 翻译规则：先统一反斜杠为正斜杠（Windows glob key 可能含 \），再剥两层上跳前缀——
 *   "../../projects/" → "projects/"（工程根：仓库根下 projects/ 目录的 key 是从 src/editor/
 *      出发上跳两层，剥掉前缀即得仓库根相对路径）
 *
 * 历史行为：曾有 "../" → "src/" 的内置轨分支；内置轨退役后收窄为单前缀
 * （doc-dev/projects-root-unification）。
 * 此文件为纯函数模块（无 vite 依赖），tests/mockProjectBridge.test.ts 直接引用锁定行为。
 */
export function normalizeGlobPath(globPath: string): string {
  const normalized = globPath.replace(/\\/g, '/')
  return normalized.replace(/^(\.\.\/){2}/, '')
}
