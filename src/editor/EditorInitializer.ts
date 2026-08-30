/**
 * EditorInitializer — 编辑器初始化逻辑
 *
 * 委托 projects/registry.ts 自动扫描注册所有项目。
 * 不再直接感知具体项目类，新增项目只需在 projects/registry.ts 注册即可。
 */
import { registerAllProjectModules } from '../projects/registry'
import { installBlueprintWindowApi } from './blueprintEdit/windowApi'
import { BlueprintEditorService } from './blueprintEdit/BlueprintEditorService'
import { editorBus } from './EditorEvents'
import { EditorEvent } from './EditorEventNames'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { AIModule } from '../engine/ai'
import { Actor } from '../engine/entity/Actor'
import { AssetPreviewManager } from './asset/AssetPreviewManager'
import { getSceneTree, select, notifySelectionChange } from './SelectionManager'
import { logger } from '../engine/Logger'

export type InitLogger = (message: string) => void

/**
 * 本地 AI 响应生成（后续可接入 DSH 内核）
 */
function generateLocalAIResponse(message: string, history?: Array<{ role: string; content: string }>): string {
  const lowerMessage = message.toLowerCase()
  
  // 简单的关键词匹配响应
  if (lowerMessage.includes('你好') || lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    return '你好！我是 DemoStudio AI 助手。我可以帮你：\n- 启动/停止游戏\n- 查看编辑器状态\n- 执行控制台命令\n- 回答关于编辑器的问题\n\n请问有什么可以帮助你的？'
  }
  
  if (lowerMessage.includes('帮助') || lowerMessage.includes('help') || lowerMessage.includes('能做什么')) {
    return '我可以帮你完成以下任务：\n\n1. **游戏控制**\n   - "启动游戏" - 启动当前项目\n   - "停止游戏" - 停止运行中的游戏\n\n2. **状态查询**\n   - "当前状态" - 查看编辑器和游戏状态\n   - "控制台日志" - 获取最近的控制台输出\n\n3. **编辑器操作**\n   - "选中 [Actor名]" - 选中场景中的 Actor\n   - "生成 [蓝图名]" - 生成新的 Actor 实例\n\n4. **其他问题**\n   - 任何关于编辑器使用的问题\n\n请告诉我你需要什么帮助！'
  }
  
  if (lowerMessage.includes('启动游戏') || lowerMessage.includes('start game')) {
    return '正在启动游戏...\n\n请稍候，游戏启动后我会通知你。'
  }
  
  if (lowerMessage.includes('停止游戏') || lowerMessage.includes('stop game')) {
    return '正在停止游戏...\n\n游戏已停止。'
  }
  
  if (lowerMessage.includes('状态') || lowerMessage.includes('status')) {
    return '让我查看当前编辑器状态...\n\n状态信息将在控制台中显示。'
  }
  
  if (lowerMessage.includes('日志') || lowerMessage.includes('log')) {
    return '正在获取控制台日志...\n\n最近的日志将在控制台中显示。'
  }
  
  // 默认响应
  return `收到你的消息："${message}"\n\n我已记录你的请求。如需更详细的帮助，请输入"帮助"或"help"。`
}

/**
 * 注册编辑器事件到 Zustand store 的桥接。
 * 底层模块（SelectionManager、BlueprintEditor 等）只负责 emit 事件，
 * 此函数将事件翻译为 store 状态更新，供 React 组件订阅。
 *
 * 调用一次即可，返回清理函数。
 */
export function installEventBridge(): () => void {
  const unsubs: Array<() => void> = []

  unsubs.push(
    editorBus.on(EditorEvent.SELECTION_CHANGED, () => {
      useEditorStore.getState().bumpSelectionNonce()
    }),
  )

  unsubs.push(
    editorBus.on(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, (path: string) => {
      useEditorStore.getState().markBlueprintDirty(path)
    }),
  )

  unsubs.push(
    editorBus.on(EditorEvent.BLUEPRINT_SAVED, (path: string) => {
      useEditorStore.getState().markBlueprintClean(path)
    }),
  )

  return () => unsubs.forEach((u) => u())
}

/**
 * 注册编辑器层的 AI 事件处理器（gizmos 选中/拖动等编辑器能力）。
 * 与引擎层内置处理器（registerBuiltinAIHandlers，操作 World）互补：
 *  - ai.selectActor / ai.dragActor 操作编辑器选中与 gizmo
 * 调用一次即可，返回清理函数。
 */
function registerEditorAIHandlers(): () => void {
  const ai = AIModule.instance
  const unsubs: Array<() => void> = []

  // HMR 场景：模块重载后 _editorAIHandlersInstalled 重置，但 AIModule 单例仍保留旧处理器，
  // 先清除编辑器层事件旧处理器，避免重复注册（ai.selectActor 曾累积到 10 个）
  ai.clearEvent('ai.selectActor')
  ai.clearEvent('ai.dragActor')

  // ─── ai.selectActor — 在编辑器场景/预览中选中 Actor（gizmo 显示） ───
  unsubs.push(
    ai.register('ai.selectActor', (payload: unknown) => {
      const p = (payload ?? {}) as { name?: string }
      const name = p.name ?? ''
      if (!name) return { ok: false, error: '缺少 name' }

      // 1. 优先查活动预览管理器（widget/场景预览）
      const activePath = AssetPreviewManager.getActivePath()
      if (activePath) {
        const mgr = AssetPreviewManager.getActive()
        // 用 getActorTree() 遍历所有嵌套 Actor（GetAllActors 只返回顶层）
        const tree = mgr ? (mgr as any).getActorTree?.() : null
        const node = Array.isArray(tree)
          ? tree.find((n: { name?: string; actor?: Actor | null }) => n.actor && (n.name === name || n.actor!.name === name))
          : null
        if (node?.actor) {
          // 预览管理器统一走 selectActor（同步 gizmo + 包围盒）
          ;(mgr as any).selectActor?.(node.actor)
          logger.info(`[AI][Editor] selectActor(预览): ${name}`)
          return { ok: true, name, source: 'preview' }
        }
      }

      // 2. 回退到编辑器场景树（Scene 视口）
      const tree = getSceneTree()
      const node = tree.find((n) => n.actor && (n.name === name || n.actor!.name === name))
      if (!node?.actor) return { ok: false, error: `未找到 Actor: ${name}` }
      select(node.actor)
      logger.info(`[AI][Editor] selectActor(场景): ${name}`)
      return { ok: true, name, source: 'scene' }
    }),
  )

  // ─── ai.dragActor — 拖动 Actor（沿轴增量移动，等价 gizmo 拖拽结果） ───
  unsubs.push(
    ai.register('ai.dragActor', (payload: unknown) => {
      const p = (payload ?? {}) as { name?: string; axis?: 'x' | 'y' | 'z'; delta?: number; position?: [number, number, number] }
      const name = p.name ?? ''
      if (!name) return { ok: false, error: '缺少 name' }

      // 查找目标：活动预览管理器优先，回退场景树
      let target: Actor | null = null
      const activePath = AssetPreviewManager.getActivePath()
      if (activePath) {
        const mgr = AssetPreviewManager.getActive()
        // 用 getActorTree() 遍历所有嵌套 Actor
        const tree = mgr ? (mgr as any).getActorTree?.() : null
        const node = Array.isArray(tree)
          ? tree.find((n: { name?: string; actor?: Actor | null }) => n.actor && (n.name === name || n.actor!.name === name))
          : null
        target = node?.actor ?? null
        if (target) {
          // 确保选中（显示 gizmo），预览管理器会 attach
          ;(mgr as any).selectActor?.(target)
        }
      }
      if (!target) {
        const tree = getSceneTree()
        const node = tree.find((n) => n.actor && (n.name === name || n.actor!.name === name))
        if (!node?.actor) return { ok: false, error: `未找到 Actor: ${name}` }
        target = node.actor
        select(target)
      }

      // 应用移动：position 覆盖 或 axis+delta 增量
      const pos = target.position
      if (Array.isArray(p.position)) {
        target.setPosition(p.position[0], p.position[1], p.position[2])
      } else if (p.axis && typeof p.delta === 'number') {
        const d = p.delta
        if (p.axis === 'x') target.setPosition(pos.x + d, pos.y, pos.z)
        else if (p.axis === 'y') target.setPosition(pos.x, pos.y + d, pos.z)
        else if (p.axis === 'z') target.setPosition(pos.x, pos.y, pos.z + d)
        else return { ok: false, error: `未知轴: ${p.axis}` }
      } else {
        return { ok: false, error: '缺少 position 或 axis+delta' }
      }

      // 通知选中变化（gizmo 同步 + React 刷新）
      notifySelectionChange()
      logger.info(`[AI][Editor] dragActor: ${name} → (${target.position.x.toFixed(2)}, ${target.position.y.toFixed(2)}, ${target.position.z.toFixed(2)})`)
      return { ok: true, name, position: [target.position.x, target.position.y, target.position.z] }
    }),
  )

  // ─── 文件读写 AI 事件（经 ai_event 往返通道，供 DSH FileBridge 调用） ───
  // 注意：IPC 结构化克隆不允许 undefined 属性，必须清理返回值
  ai.register('ai.readJsonFile', async (payload: unknown) => {
    const { relativePath } = (payload ?? {}) as { relativePath?: string }
    if (!relativePath) return { success: false, error: '缺少 relativePath' }
    const api = window.electronAPI?.readJsonFile
    if (!api) return { success: false, error: 'readJsonFile 不可用' }
    const result = await api(relativePath)
    // 清理 undefined 属性，避免 IPC 克隆失败
    const clean: Record<string, unknown> = { success: !!result.success }
    if (result.data !== undefined) clean.data = result.data
    if (result.error !== undefined) clean.error = result.error
    return clean
  })

  ai.register('ai.writeFile', async (payload: unknown) => {
    const { relativePath, data } = (payload ?? {}) as { relativePath?: string; data?: unknown }
    if (!relativePath) return { ok: false, error: '缺少 relativePath' }
    const api = window.electronAPI?.writeJsonFile
    if (!api) return { ok: false, error: 'writeJsonFile 不可用' }
    const result = await api(relativePath, data)
    const clean: Record<string, unknown> = { ok: !!result.success }
    if (result.error !== undefined) clean.error = result.error
    return clean
  })

  logger.info(`[AIModule] 编辑器层 AI 事件已注册: ai.selectActor, ai.dragActor, ai.readJsonFile, ai.writeFile`)

  // 浏览器调试入口（Playwright / 控制台验证用）：window.__ai.emit('ai.selectActor', { name })
  ;(window as any).__ai = {
    emit: (event: string, payload?: unknown) => ai.emit(event, payload),
    listEvents: () => ai.listEvents(),
  }

  return () => {
    delete (window as any).__ai
    unsubs.forEach((u) => u())
  }
}

/** 编辑器层 AI 事件处理器注册标记（避免重复注册） */
let _editorAIHandlersInstalled = false

/**
 * 注册所有内置项目到编辑器的各个注册表中
 * 委托 registerAllProjectModules 自动完成 GameFactoryRegistry / ConfigRegistry 注册
 * @param log 日志输出回调
 */
export function registerAllProjects(log: InitLogger = console.log): void {
  registerAllProjectModules(log)
  // 编辑器层 AI 事件（gizmos 选中/拖动），幂等
  if (!_editorAIHandlersInstalled) {
    _editorAIHandlersInstalled = true
    registerEditorAIHandlers()
  }
}

/**
 * 注册快捷键与 Electron 菜单的全局事件监听
 * @param callbacks 事件回调
 * @returns 清理函数
 */
export function registerGlobalEventListeners(callbacks: {
  toggleConsole: () => void
  setShowProjectSelector: (show: boolean) => void
  addConsoleOutput: (text: string) => void
  launchGame: () => void
  stopGame: () => void
  setCurrentProject: (project: any) => void
}): () => void {
  const {
    toggleConsole,
    setShowProjectSelector,
    addConsoleOutput,
    launchGame,
    stopGame,
    setCurrentProject,
  } = callbacks

  const onToggleConsole = () => toggleConsole()
  const onOpenProject = () => setShowProjectSelector(true)
  const onNewProject = () => addConsoleOutput('[菜单] New Project')
  const onLaunchGame = () => {
    // 逻辑由调用方useEditorStore的状态决定，这里简单委托
    launchGame()
  }
  const onStopGame = () => stopGame()

  window.addEventListener('shortcut-toggle-console', onToggleConsole)
  window.addEventListener('shortcut-open-project', onOpenProject)
  window.addEventListener('shortcut-new-project', onNewProject)
  window.addEventListener('shortcut-launch-game', onLaunchGame)
  window.addEventListener('shortcut-stop-game', onStopGame)

  // Agent 独立窗口快捷键
  const onToggleAgent = () => {
    window.electronAPI?.dshOpenAgentWindow?.().catch(() => {})
  }
  window.addEventListener('shortcut-toggle-agent', onToggleAgent)

  // Electron 菜单事件
  let electronCleanup: (() => void) | undefined
  let mcpCleanup: (() => void) | undefined
  let blueprintMcpCleanup: (() => void) | undefined
  let aiChatCleanup: (() => void) | undefined

  // 暴露 window.blueprintEditor（页面内 / 控制台调用）
  installBlueprintWindowApi()

  if (window.electronAPI) {
    electronCleanup = window.electronAPI.onMenuAction((action) => {
      switch (action) {
        case 'launch-game':
          onLaunchGame()
          break
        case 'stop-game':
          onStopGame()
          break
        default:
          addConsoleOutput(`[菜单] ${action}`)
      }
    })

    if (window.electronAPI.onMCPCommand) {
      mcpCleanup = window.electronAPI.onMCPCommand(async (command, params, requestId) => {
        addConsoleOutput(`[MCP] 收到命令: ${command}`)
        switch (command) {
          case 'launchGame':
          case 'start_game': {
            // 支持指定项目启动：params.project = 项目名（AI 测试指定场景用）
            // 否则无项目时自动选中第一个可用项目（页面重载后项目状态会丢失）。
            // 切换项目会触发 Viewport 的停止流程（异步 effect），等待其完成再启动，避免竞争
            let needWait = false
            const targetName = (params?.project as string | undefined)?.trim()
            const cur = useEditorStore.getState().currentProject
            if (targetName && cur?.name !== targetName) {
              const target = useProjectStore.getState().projects.find((p) => p.name === targetName)
              if (target) {
                useEditorStore.getState().setCurrentProject(target)
                addConsoleOutput(`[MCP] 切换项目: ${target.name}`)
                needWait = true
              } else {
                addConsoleOutput(`[MCP] start_game: 未找到项目 "${targetName}"`)
                break
              }
            } else if (!cur) {
              const first = useProjectStore.getState().projects[0]
              if (first) {
                useEditorStore.getState().setCurrentProject(first)
                addConsoleOutput(`[MCP] 自动选中项目: ${first.name}`)
                needWait = true
              } else {
                addConsoleOutput('[MCP] start_game: 无可用项目')
                break
              }
            }
            if (needWait) await new Promise((r) => setTimeout(r, 600))
            onLaunchGame()
            break
          }
          case 'stopGame':
          case 'stop_game':
            onStopGame()
            break
          case 'toggle_game':
            onLaunchGame()
            break
          case 'addConsoleOutput':
            if (params?.text) addConsoleOutput(params.text)
            break
          case 'ai_event': {
            // AI 事件模式：MCP 发送 { event, payload } → AIModule 分发到引擎处理器
            const event = params?.event as string | undefined
            if (!event) {
              const msg = { status: 'error', message: '缺少 event 参数' }
              addConsoleOutput('[MCP] ai_event: 缺少 event 参数')
              if (requestId) window.electronAPI?.sendMCPResponse?.(requestId, msg)
              break
            }
            const result = AIModule.instance.emit(event, params?.payload)
            addConsoleOutput(
              `[MCP][AI] 事件 ${event} → ${result.handled ? `已处理 (${result.results.length} 处理器)` : '无处理器（未注册）'}`,
            )
            // 汇总返回值：取最后一个非 undefined 结果（getState 等查询事件）
            // 处理器可能是 async（返回 Promise），需要 await
            let ret: unknown = undefined
            if (result.handled) {
              for (let i = result.results.length - 1; i >= 0; i--) {
                const r = result.results[i]
                if (r !== undefined && r !== null) {
                  ret = typeof r === 'object' && r !== null && typeof (r as any).then === 'function'
                    ? await (r as Promise<unknown>)
                    : r
                  break
                }
              }
            }
            const response = { status: 'ok', event, handled: result.handled, result: ret ?? null }
            if (ret !== undefined && ret !== null) {
              try { addConsoleOutput(`[MCP][AI] 返回: ${JSON.stringify(ret).slice(0, 500)}`) } catch { /* 非序列化值 */ }
            }
            if (requestId) window.electronAPI?.sendMCPResponse?.(requestId, response)
            break
          }
          case 'ai_list_events': {
            // 往返模式：主进程已挂 requestId，需回传事件名列表（否则 AI 只拿到 ack）
            const events = AIModule.instance.listEvents()
            addConsoleOutput(`[MCP][AI] 已注册事件: ${events.join(', ') || '（无）'}`)
            if (requestId) {
              window.electronAPI?.sendMCPResponse?.(requestId, {
                status: 'ok',
                command: 'ai_list_events',
                events,
                count: events.length,
              })
            }
            break
          }
          case 'send_input':
            if (params?.key) {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: params.key, bubbles: true }))
              addConsoleOutput(`[MCP] 发送按键: ${params.key}`)
            }
            break
          default:
            addConsoleOutput(`[MCP] 未知命令: ${command}`)
        }
      })
    }

    // 蓝图编辑 MCP 往返：外部 AI（经 MCP 服务器 + HTTP /api/blueprint）→ 主进程 → 此处处理
    if (window.electronAPI.onBlueprintRequest) {
      blueprintMcpCleanup = window.electronAPI.onBlueprintRequest(async (requestId, op, params) => {
        let result
        try {
          result = await BlueprintEditorService.dispatch(op, params ?? {})
        } catch (err) {
          result = { ok: false, error: String(err) }
        }
        window.electronAPI?.sendBlueprintResponse(requestId, result)
      })
    }

    // AI 聊天处理
    if (window.electronAPI.onAIChat) {
      aiChatCleanup = window.electronAPI.onAIChat(async (requestId, message, history) => {
        addConsoleOutput(`[AI Chat] 收到消息: ${message}`)
        
        // 本地 AI 响应（后续可接入 DSH 内核）
        const response = generateLocalAIResponse(message, history)
        
        window.electronAPI?.sendAIChatResponse?.(requestId, {
          status: 'ok',
          response: response
        })
      })
    }
  }

  return () => {
    window.removeEventListener('shortcut-toggle-console', onToggleConsole)
    window.removeEventListener('shortcut-open-project', onOpenProject)
    window.removeEventListener('shortcut-new-project', onNewProject)
    window.removeEventListener('shortcut-launch-game', onLaunchGame)
    window.removeEventListener('shortcut-stop-game', onStopGame)
    window.removeEventListener('shortcut-toggle-agent', onToggleAgent)
    electronCleanup?.()
    mcpCleanup?.()
    blueprintMcpCleanup?.()
    aiChatCleanup?.()
  }
}
