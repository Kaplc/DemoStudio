/**
 * 命令面板命令注册。
 *
 * M1+ 接入：
 * - 5 个引擎命令接入 EngineBridge（startEngine/stopEngine/startGame/stopGame/checkUpdate）
 * - 内核重启接 KernelManager
 * - 用户消息上行接 AgentExecutor（M3 简化路径）或 KernelAdapter.send（M2 路径）
 */
import * as vscode from 'vscode'
import { KernelManager } from './dsh/kernel'
import { StatusBarManager } from './ui/statusBar'
import { ChatViewProvider } from './ui/chatView'
import { EngineBridge, BridgeState } from './bridge/engineBridge'
import { AgentExecutor } from './bridge/agentExecutor'
import type { PluginTool } from './bridge/pluginBridge'

export interface CommandDeps {
  context: vscode.ExtensionContext
  kernel: KernelManager
  statusBar: StatusBarManager
  chatView: ChatViewProvider
  bridge: EngineBridge
  executor: AgentExecutor
  tools: PluginTool[]
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { kernel, statusBar, chatView, bridge, executor, tools } = deps
  const subs: vscode.Disposable[] = []

  subs.push(vscode.commands.registerCommand('dsh.openChat', () => {
    vscode.commands.executeCommand('dsh.chat.focus')
  }))

  /** Webview 把用户输入上行到这个命令；转发到 AgentExecutor（M3 简化版） */
  subs.push(vscode.commands.registerCommand('dsh.sendUserMessage', async (text: string) => {
    // 任何路径都把助手消息流回 chatView
    const emit = (kind: string, payload: unknown) => {
      chatView.postMessage({ type: kind, payload })
    }
    const wrapped = new AgentExecutor({
      kernel: kernel.getAdapter() as any,
      outputChannel: kernel.getState() ? { appendLine: (s: string) => process.stdout.write(`[kernel] ${s}\n`) } : { appendLine: () => {} },
      tools,
      guardPolicy: getGuardPolicy(),
      onEvent: emit,
    })
    await wrapped.handle(text)
  }))

  /** 用户点击停止按钮 → 取消当前正在进行的 AI 生成 */
  subs.push(vscode.commands.registerCommand('dsh.cancelGeneration', async () => {
    const adapter = kernel.getAdapter()
    if (!adapter) {
      outputChannel.appendLine('[commands] cancelGeneration: 内核未连接')
      return
    }
    try {
      await adapter.cancel()
      outputChannel.appendLine('[commands] cancelGeneration: 已发送取消请求')
      // 向聊天面板推送取消事件，UI 将当前流式消息标记为已中断
      chatView.postMessage({ type: 'cancelled' })
    } catch (err) {
      outputChannel.appendLine(`[commands] cancelGeneration 失败: ${err}`)
      chatView.postMessage({ type: 'error', payload: { message: `取消失败: ${err}` } })
    }
  }))

  subs.push(vscode.commands.registerCommand('dsh.startEngine', async () => {
    statusBar.setEngineStatus('starting')
    // 推送状态到聊天面板
    chatView.postMessage({ type: 'status', payload: { kernelStatus: 'connecting' } })
    try {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
      await bridge.start(root)
      const status = await bridge.getStatus()
      statusBar.setEngineStatus(status?.gameRunning ? 'gameRunning' : 'running')
      // 推送连接成功状态
      chatView.postMessage({ type: 'status', payload: { kernelStatus: 'connected', gameRunning: status?.gameRunning ?? false } })
      vscode.window.showInformationMessage('DemoStudio 编辑器已连接')
    } catch (err) {
      statusBar.setEngineStatus('stopped')
      chatView.postMessage({ type: 'status', payload: { kernelStatus: 'error', kernelDetail: String(err) } })
      vscode.window.showErrorMessage(`启动失败: ${err}`)
    }
  }))

  subs.push(vscode.commands.registerCommand('dsh.stopEngine', async () => {
    await bridge.stop()
    statusBar.setEngineStatus('stopped')
    chatView.postMessage({ type: 'status', payload: { kernelStatus: 'disconnected', gameRunning: false } })
    vscode.window.showInformationMessage('DemoStudio 编辑器已断开')
  }))

  subs.push(vscode.commands.registerCommand('dsh.startGame', async () => {
    const result = await bridge.callTool('start_game')
    vscode.window.showInformationMessage(`启动游戏: ${JSON.stringify(result)}`)
    statusBar.setEngineStatus('gameRunning')
    chatView.postMessage({ type: 'status', payload: { gameRunning: true } })
  }))

  subs.push(vscode.commands.registerCommand('dsh.stopGame', async () => {
    const result = await bridge.callTool('stop_game')
    vscode.window.showInformationMessage(`停止游戏: ${JSON.stringify(result)}`)
    statusBar.setEngineStatus('running')
    chatView.postMessage({ type: 'status', payload: { gameRunning: false, gameScore: 0 } })
  }))

  subs.push(vscode.commands.registerCommand('dsh.restartKernel', async () => {
    await kernel.stop()
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    await kernel.start(root)
    vscode.window.showInformationMessage('DSH 内核已重启')
  }))

  subs.push(vscode.commands.registerCommand('dsh.checkUpdate', async () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'dsh.checkUpdates')
  }))

  bridge.onState((s: BridgeState) => {
    const map: Record<BridgeState, ReturnType<typeof statusBar.setEngineStatus>> = {
      idle: 'stopped',
      probing: 'starting',
      starting: 'starting',
      connected: 'running',
      disconnected: 'stopped',
      'fallback-polling': 'running',
    }
    statusBar.setEngineStatus(map[s] ?? 'unknown')
  })

  return subs
}

function getGuardPolicy(): Record<string, 'allow' | 'deny' | 'ask'> {
  const cfg = vscode.workspace.getConfiguration('dsh')
  return (cfg.get<Record<string, 'allow' | 'deny' | 'ask'>>('guardPolicy', {}) ?? {})
}
