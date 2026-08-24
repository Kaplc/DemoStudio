/**
 * 扩展入口（activate / deactivate）。
 */
import * as vscode from 'vscode'
import * as path from 'node:path'
import { KernelManager } from './dsh/kernel'
import { ChatViewProvider } from './ui/chatView'
import { StatusBarManager } from './ui/statusBar'
import { registerCommands } from './commands'
import { EngineBridge } from './bridge/engineBridge'
import { loadPluginTools } from './bridge/pluginBridge'
import { VscodeFileBridge } from './bridge/fileBridge'
import { EngineEventLinker } from './bridge/eventLinker'
import { Updater } from './dsh/updater'

let outputChannel: vscode.OutputChannel
let kernelManager: KernelManager
let statusBar: StatusBarManager
let chatView: ChatViewProvider
let bridge: EngineBridge
let updater: Updater
let eventLinker: EngineEventLinker
const disposables: vscode.Disposable[] = []

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('DSH')
  outputChannel.appendLine('[extension] activate start')
  outputChannel.show(true)

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  outputChannel.appendLine(`[extension] workspaceRoot=${workspaceRoot}`)

  // ── 1. EngineBridge（始终创建，不依赖内核）──
  try {
    bridge = new EngineBridge(outputChannel)
    outputChannel.appendLine('[extension] EngineBridge created')
  } catch (err) {
    outputChannel.appendLine(`[extension] EngineBridge 创建失败: ${err}`)
    bridge = null as any
  }

  // ── 2. KernelManager（失败不阻塞）──
  try {
    kernelManager = new KernelManager(outputChannel)
    await kernelManager.start(workspaceRoot)
    outputChannel.appendLine(`[extension] kernel started, mode=${kernelManager.getState().mode}`)
  } catch (err) {
    outputChannel.appendLine(`[extension] kernel 启动失败（不阻塞）: ${err}`)
    // 创建一个空的 KernelManager 以避免后续空引用
    if (!kernelManager) {
      kernelManager = new KernelManager(outputChannel)
    }
  }

  // ── 3. Plugin 工具加载（失败返回空数组）──
  let tools: ReturnType<typeof loadPluginTools> = []
  try {
    const pluginDist = path.resolve(context.extensionPath, '..', '..', 'dsh-plugin', 'dist', 'index.js')
    outputChannel.appendLine(`[extension] pluginDist=${pluginDist}`)
    const fileBridge = new VscodeFileBridge(outputChannel)
    const guardCfg = vscode.workspace.getConfiguration('dsh').get<Record<string, 'allow' | 'deny' | 'ask'>>('guardPolicy', {}) ?? {}
    tools = loadPluginTools(pluginDist, { outputChannel, bridge, fileBridge, guardPolicy: guardCfg })
    outputChannel.appendLine(`[extension] loaded ${tools.length} tools`)
  } catch (err) {
    outputChannel.appendLine(`[extension] plugin 加载失败（不阻塞）: ${err}`)
  }

  // ── 4. StatusBar ──
  try {
    statusBar = new StatusBarManager()
    statusBar.setEngineStatus('unknown')
    statusBar.setKernelVersion(await kernelManager.getAdapter()?.version() ?? '0.0.0')
    disposables.push(statusBar)
    outputChannel.appendLine('[extension] StatusBar initialized')
  } catch (err) {
    outputChannel.appendLine(`[extension] StatusBar 初始化失败: ${err}`)
  }

  // ── 5. ChatView（必须成功，否则无法对话）──
  try {
    chatView = new ChatViewProvider(context, outputChannel)
    disposables.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatView))
    outputChannel.appendLine('[extension] ChatView registered')
  } catch (err) {
    outputChannel.appendLine(`[extension] ChatView 注册失败: ${err}`)
  }

  // ── 6. Commands（必须成功）──
  try {
    const commandSubs = registerCommands({
      context,
      kernel: kernelManager,
      statusBar: statusBar!,
      chatView: chatView!,
      bridge,
      executor: null as any,
      tools,
    })
    commandSubs.forEach((s) => disposables.push(s))
    outputChannel.appendLine(`[extension] ${commandSubs.length} commands registered`)
  } catch (err) {
    outputChannel.appendLine(`[extension] commands 注册失败: ${err}`)
  }

  // ── 6.1 向聊天面板推送初始状态 ──
  if (chatView) {
    const sendStatus = () => {
      chatView.postMessage({
        type: 'status',
        payload: {
          kernelStatus: kernelManager.getState().running ? 'connected' : 'disconnected',
          kernelDetail: kernelManager.getState().mode,
          toolCount: tools.length,
          gameRunning: false,
          gameScore: 0,
        }
      })
    }
    // 延迟发送，等 webview 加载完成
    setTimeout(sendStatus, 1000)
    outputChannel.appendLine(`[extension] 初始状态已推送: ${tools.length} 个工具`)
  }

  // ── 7. Bind kernel to chat ──
  if (chatView && kernelManager) {
    try {
      bindKernelToChatOnReady(chatView, kernelManager)
    } catch (err) {
      outputChannel.appendLine(`[extension] bindKernelToChat 失败: ${err}`)
    }
  }

  // ── 8. 引擎事件联动（可选，M4.3）──
  if (bridge) {
    try {
      eventLinker = new EngineEventLinker({
        outputChannel,
        bridgeEventSource: bridge,
        injectPrompt: async (prompt) => {
          chatView?.postMessage({ type: 'system', payload: { content: prompt } })
          outputChannel.appendLine(`[event-linker] injected prompt: ${prompt.slice(0, 80)}`)
        },
      })
      eventLinker.start()
      disposables.push(eventLinker)
      outputChannel.appendLine('[extension] EngineEventLinker started')
    } catch (err) {
      outputChannel.appendLine(`[extension] EngineEventLinker 启动失败（不阻塞）: ${err}`)
    }
  }

  // ── 9. Updater（可选，M4.2）──
  try {
    updater = new Updater({
      outputChannel,
      context,
      getCurrentVersion: async () => (await kernelManager?.getAdapter()?.version() ?? '0.0.0'),
      onUpdateAvailable: (current, latest) => {
        statusBar?.setKernelVersion(current, true)
        const action = '更新'
        vscode.window.showInformationMessage(
          `DSH 内核有新版本 ${latest}（当前 ${current}）`,
          action,
        ).then((picked) => {
          if (picked === action) {
            updater.runUpdate(latest).catch((e) => vscode.window.showErrorMessage(`更新失败: ${e}`))
          }
        })
      },
    })
    updater.start()
    disposables.push({ dispose: () => updater.stop() })
    outputChannel.appendLine('[extension] Updater started')
  } catch (err) {
    outputChannel.appendLine(`[extension] Updater 启动失败（不阻塞）: ${err}`)
  }

  // ── 10. dsh.checkUpdate 命令 ──
  disposables.push(
    vscode.commands.registerCommand('dsh.checkUpdate', async () => {
      try { await updater?.check() } catch (e) { outputChannel.appendLine(`[extension] checkUpdate 失败: ${e}`) }
    }),
  )

  disposables.forEach((d) => context.subscriptions.push(d))
  outputChannel.appendLine(`[extension] activated; workspace=${workspaceRoot}; tools=${tools.length}`)
}

export async function deactivate(): Promise<void> {
  outputChannel?.appendLine('[extension] deactivate')
  eventLinker?.dispose()
  await kernelManager?.stop()
  await bridge?.stop()
  statusBar?.dispose()
  disposables.forEach((d) => { try { d.dispose() } catch { /* ignore */ } })
}

function bindKernelToChatOnReady(chatView: ChatViewProvider, kernel: KernelManager): void {
  const tryBind = () => {
    const adapter = kernel.getAdapter()
    if (!adapter) return false
    const events = ['ready', 'message', 'message.delta', 'toolCall', 'toolResult', 'error', 'cancelled', 'closed'] as const
    for (const evt of events) {
      adapter.on(evt, ((payload: unknown) => chatView.postMessage({ type: evt, payload })) as any)
    }
    return true
  }
  tryBind()
}
