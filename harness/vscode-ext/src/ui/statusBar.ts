/**
 * 状态栏管理器：显示引擎状态 / 内核版本 / 工具数量 / 连接状态。
 *
 * 状态栏布局（从左到右）：
 * [引擎状态] [内核版本] [工具数量] [连接状态]
 */
import * as vscode from 'vscode'

export type EngineStatus = 'unknown' | 'stopped' | 'starting' | 'running' | 'gameRunning'
export type KernelStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class StatusBarManager implements vscode.Disposable {
  // ── 状态栏项目 ──
  private engineItem: vscode.StatusBarItem      // 引擎状态
  private versionItem: vscode.StatusBarItem     // 内核版本
  private toolsItem: vscode.StatusBarItem       // 工具数量
  private kernelItem: vscode.StatusBarItem      // 内核连接状态
  private chatItem: vscode.StatusBarItem        // 聊天快捷入口

  // ── 内部状态 ──
  private currentEngineStatus: EngineStatus = 'unknown'
  private currentKernelStatus: KernelStatus = 'disconnected'
  private toolCount = 0

  constructor() {
    // 1. 引擎状态（最左侧，优先级最高）
    this.engineItem = this.createItem(100, 'dsh.startEngine')
    this.engineItem.text = '$(circle-outline) DSH: 引擎未启动'
    this.engineItem.tooltip = '点击启动 DemoStudio 编辑器'

    // 2. 内核版本
    this.versionItem = this.createItem(99, 'dsh.checkUpdate')
    this.versionItem.text = '$(package) DSH 0.0.0'
    this.versionItem.tooltip = '点击检查 DSH 内核更新'

    // 3. 工具数量
    this.toolsItem = this.createItem(98, undefined)
    this.toolsItem.text = '$(tools) 0 工具'
    this.toolsItem.tooltip = '已加载的引擎特化工具数量'

    // 4. 内核连接状态
    this.kernelItem = this.createItem(96, 'dsh.restartKernel')
    this.kernelItem.text = '$(circle-slash) DSH 内核'
    this.kernelItem.tooltip = 'DSH 内核连接状态（点击重启）'

    // 5. 聊天快捷入口（最右侧）
    this.chatItem = this.createItem(95, 'dsh.openChat')
    this.chatItem.text = '$(comment-discussion) DSH 聊天'
    this.chatItem.tooltip = '打开 DSH 聊天面板'
  }

  // ── 工厂方法 ──

  private createItem(priority: number, command: string | undefined): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority)
    if (command) item.command = command
    item.show()
    return item
  }

  // ── 公开 API ──

  /** 更新引擎状态 */
  setEngineStatus(status: EngineStatus): void {
    this.currentEngineStatus = status
    const map: Record<EngineStatus, { icon: string; text: string; cmd: string; tip: string }> = {
      unknown:     { icon: '$(circle-outline)', text: 'DSH: 引擎未启动',     cmd: 'dsh.startEngine', tip: '点击启动 DemoStudio 编辑器' },
      stopped:     { icon: '$(circle-slash)',   text: 'DSH: 引擎已停止',     cmd: 'dsh.startEngine', tip: '点击启动 DemoStudio 编辑器' },
      starting:    { icon: '$(sync~spin)',      text: 'DSH: 引擎启动中...',  cmd: 'dsh.stopEngine',  tip: '启动中...' },
      running:     { icon: '$(check)',          text: 'DSH: 编辑器运行中',   cmd: 'dsh.stopEngine',  tip: '点击停止编辑器' },
      gameRunning: { icon: '$(play)',           text: 'DSH: 游戏运行中',     cmd: 'dsh.stopGame',    tip: '点击停止游戏' }
    }
    const m = map[status]
    this.engineItem.text = `${m.icon} ${m.text}`
    this.engineItem.command = m.cmd
    this.engineItem.tooltip = m.tip
  }

  /** 更新内核版本 */
  setKernelVersion(version: string, hasUpdate = false): void {
    const icon = hasUpdate ? '$(arrow-up-circle)' : '$(package)'
    this.versionItem.text = `${icon} DSH ${version}`
    this.versionItem.tooltip = hasUpdate ? `有新版本可用！当前: ${version}` : `DSH 内核版本: ${version}`
  }

  /** 更新工具数量 */
  setToolCount(count: number): void {
    this.toolCount = count
    this.toolsItem.text = `$(tools) ${count} 工具`
    this.toolsItem.tooltip = `已加载 ${count} 个引擎特化工具`
  }

  /** 更新内核连接状态 */
  setKernelStatus(status: KernelStatus, detail?: string): void {
    this.currentKernelStatus = status
    const map: Record<KernelStatus, { icon: string; text: string; tip: string }> = {
      disconnected: { icon: '$(circle-slash)',   text: 'DSH 内核',       tip: '内核未连接（点击重启）' },
      connecting:   { icon: '$(sync~spin)',      text: 'DSH 内核...',    tip: '内核连接中...' },
      connected:    { icon: '$(pass)',           text: 'DSH 内核',       tip: '内核已连接' + (detail ? ` (${detail})` : '') },
      error:        { icon: '$(error)',          text: 'DSH 内核',       tip: '内核错误' + (detail ? `: ${detail}` : '') + '（点击重启）' }
    }
    const m = map[status]
    this.kernelItem.text = `${m.icon} ${m.text}`
    this.kernelItem.tooltip = m.tip
  }

  /** 获取当前引擎状态 */
  getCurrentStatus(): EngineStatus {
    return this.currentEngineStatus
  }

  dispose(): void {
    this.engineItem.dispose()
    this.versionItem.dispose()
    this.toolsItem.dispose()
    this.kernelItem.dispose()
    this.chatItem.dispose()
  }
}
