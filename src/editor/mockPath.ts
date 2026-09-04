/**
 * mockPath — Mock 模式 glob key 路径翻译（外部根目录工程支持）
 *
 * 浏览器调试模式下 import.meta.glob 返回的 key 与 Electron IPC 期望的路径形式不同：
 *   - 内置工程 key："../projects/fish/project.json"      → IPC 期望 "src/projects/fish/project.json"
 *   - 外部工程 key："../../projects/foo/project.json"    → IPC 期望 "projects/foo/project.json"
 *
 * 翻译规则：先统一反斜杠为正斜杠（Windows glob key 可能含 \），再按前缀分流——
 *   "../../projects/" → "projects/"（外部根：仓库根下 projects/ 目录的 key 是从 src/editor/ 出发
 *      上跳两层，剥掉前缀即得仓库根相对路径）
 *   "../"             → "src/"（内置根：原有规则，剥一层上跳换 src/ 前缀）
 *
 * 注意顺序：必须先匹配 "../../projects/" 再匹配 "../"，否则会被内置规则错误截断。
 * 此文件为纯函数模块（无 vite 依赖），tests/externalRoots.test.ts 直接引用锁定行为。
 */
export function normalizeGlobPath(globPath: string): string {
  const normalized = globPath.replace(/\\/g, '/')
  if (normalized.startsWith('../../projects/')) {
    return normalized.replace(/^(\.\.\/){2}/, '')
  }
  return normalized.replace(/^\.\.\//, 'src/')
}
