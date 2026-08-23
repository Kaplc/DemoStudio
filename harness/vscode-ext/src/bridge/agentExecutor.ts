/**
 * AgentExecutor：把 KernelAdapter 用户消息 → 工具调用循环 → 事件流输出回 KernelAdapter。
 *
 * 工作流（最简化版，无 LLM 推理）：
 * 1. 用户消息 → 启发式匹配工具名（如 "启动游戏" → start_game via run_scenario）
 *    注：真 LLM 推理由 DSH runtime 在子进程内完成（未来 M3.5）
 *    本 executor 在 DSH 0.1.x 上线前作为"工具模拟器"，验证 EngineBridge + Plugin + 工具调用闭环
 * 2. 经 EngineBridge 调工具，结果回流到 KernelAdapter 事件流
 * 3. 同时把结果消息发回 chatView
 *
 * 设计要点：
 * - 不依赖 DSH 内部 API（架构红线 FR-4.7）
 * - 工具实现只通过 EngineBridge 调编辑器 + 文件桥接
 * - 失败返回明确错误，不抛异常到上层（KernelAdapter 永远不 crashed）
 */
import type { KernelAdapter } from '../dsh/adapter'
import type { PluginTool } from './pluginBridge'

interface ExecutorDeps {
  kernel: KernelAdapter
  outputChannel: { appendLine: (s: string) => void }
  tools: PluginTool[]
  guardPolicy: Record<string, 'allow' | 'deny' | 'ask'>
  onEvent: (kind: string, payload: unknown) => void
}

/** 极简意图路由：关键词 → 工具。后续接入真 LLM。 */
function routeIntent(text: string, tools: PluginTool[]): { tool: PluginTool; args: unknown } | null {
  const t = text.trim().toLowerCase()
  for (const tool of tools) {
    if (t.includes(tool.name.toLowerCase()) || t.includes(tool.name.replace(/_/g, ' '))) {
      // 默认空参；args 解析 M3.5 由 LLM 完成
      return { tool, args: {} }
    }
  }
  // 简单 alias 映射
  const alias: Record<string, string> = {
    '启动游戏': 'run_scenario',
    '跑场景': 'run_scenario',
    '看下场景': 'inspect_scene',
    '检查场景': 'inspect_scene',
    '生成实体': 'spawn_entity',
    '当前状态': 'get_game_state',
    '暂停': 'set_game_speed',
    '加速': 'set_game_speed',
    '设置速度': 'set_game_speed',
  }
  for (const [k, v] of Object.entries(alias)) {
    if (t.includes(k)) {
      const tool = tools.find((x) => x.name === v)
      if (tool) {
        const args: Record<string, unknown> = v === 'set_game_speed'
          ? { speed: t.includes('暂停') ? 0 : t.includes('2') ? 2 : 1.5 }
          : {}
        return { tool, args }
      }
    }
  }
  return null
}

export class AgentExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  /** 处理一条用户消息；返回处理结果（不抛异常） */
  async handle(text: string): Promise<void> {
    this.deps.onEvent('message', { content: text, role: 'user' })

    const route = routeIntent(text, this.deps.tools)
    if (!route) {
      this.deps.onEvent('message', { content: '未识别指令；当前支持：启动游戏 / 看下场景 / 当前状态 / 暂停 / 加速' })
      return
    }

    const callId = `call-${Date.now()}`
    this.deps.onEvent('toolCall', { id: callId, name: route.tool.name, args: route.args, status: 'running' })

    let result: unknown
    try {
      result = await route.tool.execute(route.args, globalThis)
    } catch (err) {
      result = { ok: false, error: String(err) }
    }
    const status = (result as { ok?: boolean })?.ok === false ? 'failure' : 'success'
    this.deps.onEvent('toolResult', { id: callId, name: route.tool.name, result, status })

    // 序列化为助手消息
    let summary: string
    try {
      summary = JSON.stringify(result, null, 2)
    } catch {
      summary = String(result)
    }
    this.deps.onEvent('message', { content: `\`${route.tool.name}\` →\n\`\`\`json\n${summary}\n\`\`\`` })
  }
}
