/**
 * DSH 内核更新检查器。
 *
 * 流程：
 * 1. 启动时 + 每日一次查 npm registry `https://registry.npmjs.org/@deepseek-ai/dsh-sdk-client/latest`
 * 2. 与本机版本比对（由 EmbeddedAdapter.version() 提供）
 * 3. 有新版时调用 updateVersionBar 触发状态栏提示
 * 4. 用户点击 → 执行 `npm i -g @deepseek-ai/dsh@latest`（VS Code 终端可见，可中断）
 *
 * 设计要点：
 * - npm registry 查询可能超时或失败，静默忽略（不打扰用户）
 * - 每日一次通过缓存文件持久化（避免每次激活都查）
 * - 本机通过外部安装命令更新（不可在扩展内做自更新，会锁死 vsix）
 */
import * as vscode from 'vscode'
import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const NPM_REGISTRY = 'https://registry.npmjs.org/@deepseek-ai/dsh-sdk-client/latest'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const QUERY_TIMEOUT_MS = 5000

interface VersionCache {
  latest: string
  checkedAt: number
}

export interface UpdaterOptions {
  outputChannel: { appendLine: (s: string) => void }
  getCurrentVersion: () => Promise<string>
  onUpdateAvailable: (current: string, latest: string) => void
  context: vscode.ExtensionContext
}

export class Updater {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: UpdaterOptions) {}

  start(): void {
    if (!vscode.workspace.getConfiguration('dsh').get<boolean>('checkUpdates', true)) {
      return
    }
    // 启动延迟 5s，避免阻塞 activate
    setTimeout(() => this.check().catch(() => { /* ignore */ }), 5000)
    this.timer = setInterval(() => this.check().catch(() => { /* ignore */ }), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async check(): Promise<{ current: string; latest: string | null }> {
    const current = await this.options.getCurrentVersion()
    const latest = await this.fetchLatest()
    this.options.outputChannel.appendLine(`[updater] current=${current}, latest=${latest ?? '?'}`)
    if (latest && this.compareVersion(latest, current) > 0) {
      this.options.onUpdateAvailable(current, latest)
    }
    return { current, latest }
  }

  /** 一键更新：用 VS Code 任务跑 npm i -g，输出到终端 */
  async runUpdate(targetVersion: string): Promise<void> {
    const task = new vscode.Task(
      { type: 'shell', task: `dsh-update-${targetVersion}` },
      vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Global,
      `DSH Update ${targetVersion}`,
      'DSH',
      new vscode.ShellExecution('npm.cmd', ['install', '-g', `@deepseek-ai/dsh@${targetVersion}`]),
    )
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.New }
    await vscode.tasks.executeTask(task)
  }

  private async fetchLatest(): Promise<string | null> {
    // 先查 cache
    const cached = this.readCache()
    if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS && cached.latest) return cached.latest

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)
      const resp = await fetch(NPM_REGISTRY, { signal: controller.signal })
      clearTimeout(timer)
      if (!resp.ok) return null
      const json = (await resp.json()) as { version?: string }
      const latest = json.version ?? null
      if (latest) this.writeCache({ latest, checkedAt: Date.now() })
      return latest
    } catch {
      return null
    }
  }

  private readCache(): VersionCache | null {
    try {
      const cache = this.options.context.globalState.get<VersionCache>('dsh.updateCache')
      return cache ?? null
    } catch {
      return null
    }
  }

  private writeCache(c: VersionCache): void {
    void this.options.context.globalState.update('dsh.updateCache', c)
  }

  private compareVersion(a: string, b: string): number {
    const pa = a.split('.').map((s) => Number(s.replace(/[^\d]/g, '')) || 0)
    const pb = b.split('.').map((s) => Number(s.replace(/[^\d]/g, '')) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] ?? 0
      const db = pb[i] ?? 0
      if (da !== db) return da > db ? 1 : -1
    }
    return 0
  }
}

// 备而不用：若需要外部更新命令（如 npm i）
void cp
void fs
void path
