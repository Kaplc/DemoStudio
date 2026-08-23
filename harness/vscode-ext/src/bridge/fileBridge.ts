/**
 * 文件桥接：场景 / 蓝图 / widget JSON 文件通过 vscode.workspace.fs 直读直写。
 *
 * 改动时编辑器已有 fs.watch + IPC asset-changed 自动感知（无需重启监听）。
 * 关键安全：相对路径限制在 workspace 内。
 */
import * as vscode from 'vscode'
import * as path from 'node:path'
import type { FileBridgeLike } from '../../../dsh-plugin/src/engineContext'

export class VscodeFileBridge implements FileBridgeLike {
  constructor(private readonly outputChannel: { appendLine: (s: string) => void }) {}

  async readJsonFile(relPath: string): Promise<unknown | null> {
    const wf = vscode.workspace.workspaceFolders?.[0]
    if (!wf) return null
    const uri = this.toUri(wf.uri, relPath)
    if (!uri) return null
    try {
      const buf = await vscode.workspace.fs.readFile(uri)
      const text = new TextDecoder('utf-8').decode(buf)
      return JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (err) {
      this.outputChannel.appendLine(`[file-bridge] readJsonFile(${relPath}) 失败: ${err}`)
      return null
    }
  }

  async writeJsonFile(relPath: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
    const wf = vscode.workspace.workspaceFolders?.[0]
    if (!wf) return { ok: false, error: '无工作区' }
    const uri = this.toUri(wf.uri, relPath)
    if (!uri) return { ok: false, error: `非法路径: ${relPath}` }
    try {
      const text = JSON.stringify(data, null, 2) + '\n'
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  private toUri(root: vscode.Uri, relPath: string): vscode.Uri | null {
    const abs = path.resolve(root.fsPath, relPath)
    const rel = path.relative(root.fsPath, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null
    return vscode.Uri.file(abs)
  }
}
