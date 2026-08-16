/// <reference types="vite/client" />

/**
 * codeLint/CodeSource — 源码文件来源（环境抽象）
 *
 * ElectronCodeSource（默认）：调用 listProjectSrc（列出 src/projects/<folder> 下所有
 *   .ts/.tsx，排除 .d.ts）+ readTextFile（{success, data?, error?} 信封）读文本。
 *   - Electron：主进程真磁盘扫描（IPC list-project-src / read-text-file）
 *   - 浏览器 dev：MockElectronAPI 提供同签名实现（枚举复用其既有 allFileKeys 按 folder
 *     前缀过滤 + readTextFile 用 fetch ?raw 读 Vite dev 文本）——不在 codeLint 里注册
 *     全工程 glob，避免把其它工程的源码卷进 Vite 模块图
 * NullCodeSource（兜底）：electronAPI 完全不存在（如打包环境未注入 Mock）→ 返回空列表，
 *   静默禁用（不报错不阻塞编辑器）。
 *
 * 扫描范围严格限定当前工程：枚举与读取都按 projectFolder 过滤，不触碰其它工程源码。
 */
import type { CodeFileEntry } from './types'

export interface CodeSource {
  /** 列出工程 src 目录下所有源码文件（读成功含 text，失败含 error）。 */
  list(projectFolder: string): Promise<CodeFileEntry[]>
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Electron / Mock 同通道：listProjectSrc 枚举（按 folder 过滤）+ readTextFile 读文本。 */
class ElectronCodeSource implements CodeSource {
  async list(projectFolder: string): Promise<CodeFileEntry[]> {
    const api = window.electronAPI
    if (!api) return [] // 类型保证 listProjectSrc/readTextFile 存在（Electron 与 Mock 都实现）

    let paths: string[] = []
    try {
      paths = await api.listProjectSrc(projectFolder)
    } catch {
      return []
    }

    const files: CodeFileEntry[] = []
    for (const p of paths) {
      try {
        const result = await api.readTextFile(p) // { success, data?, error? }
        if (result.success) {
          files.push({ path: p, text: result.data ?? '' })
        } else {
          files.push({ path: p, error: result.error ?? '读取失败' })
        }
      } catch (err) {
        files.push({ path: p, error: errMsg(err) })
      }
    }
    return files
  }
}

/** 兜底：无 electronAPI（打包环境等）→ 返回空列表，静默禁用。 */
class NullCodeSource implements CodeSource {
  async list(_projectFolder: string): Promise<CodeFileEntry[]> {
    return []
  }
}

/** 按环境选择 Source：electronAPI 存在走同一通道（Electron/Mock），否则静默禁用。 */
export function createCodeSource(): CodeSource {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return new ElectronCodeSource()
  }
  return new NullCodeSource()
}
