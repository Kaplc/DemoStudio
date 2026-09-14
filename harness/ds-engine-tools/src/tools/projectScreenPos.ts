/**
 * project_screen_pos — 世界→屏幕投影查询工具（观测类，只读）
 *
 * 把世界坐标点或 Actor 位置投到屏幕像素坐标，供 AI 精确点击世界空间目标
 * （星球/全息标记等不可 Clickable 的 3D 对象）。经编辑器 HTTP 通道调
 * ai.projectScreenPos 事件（2026-09-13 新增），与 mouse_click 组成
 * "投影 → 点击" 的纯玩家操作链。
 *
 * 典型用法：
 *   1. project_screen_pos({ actor: 'Sun' }) → 屏幕坐标
 *   2. mouse_click({ screenX, screenY })    → 点击该天体
 */
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { callAIEventRaw } from './mouseSimulation.js'

const projectScreenPosSchema = z.object({
  actor: z.string().optional().describe('Actor 名称（精确匹配，取其世界位置投影；提供时优先于 worldPos）'),
  worldPos: z.array(z.number()).length(3).optional().describe('世界坐标 [x, y, z]（actor 缺省时使用）'),
})

export const projectScreenPosTool = defineTool({
  name: 'project_screen_pos',
  description: `世界→屏幕投影查询（只读）：把世界坐标点或 Actor 的世界位置投到屏幕像素坐标。

适用场景：
- 精确点击世界空间的 3D 目标（星球/天体/全息标记等不在 UI 树、get_hud 看不到的对象）
- 先投影拿屏幕坐标，再用 mouse_click 点击（"投影 → 点击"纯玩家操作链）
- 断言某天体当前在屏幕上的位置（相机移动前后对比，验证平移/缩放生效）

注意：
- 返回 inFront=false 表示点在相机界外（背面/被裁剪），坐标不可信
- UI 元素不需要本工具：get_hud 直接返回 UI 树与坐标

用法示例：
- 投影太阳的屏幕位置：project_screen_pos({actor: "Sun"})
- 投影一个世界坐标点：project_screen_pos({worldPos: [0, 0, 0]})`,
  parameters: {
    actor: { type: 'string', description: 'Actor 名称（精确匹配；提供时优先于 worldPos）' },
    worldPos: { type: 'array', description: '世界坐标 [x, y, z]（actor 缺省时使用）' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: unknown, ctx?: unknown): Promise<JsonValue> => {
    const parsed = projectScreenPosSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    const { actor, worldPos } = parsed.data
    if (!actor && !worldPos) return { ok: false, error: '缺少 actor 或 worldPos' }
    try {
      const payload: Record<string, unknown> = {}
      if (actor) payload.actor = actor
      if (worldPos) payload.worldPos = worldPos
      const result = await callAIEventRaw(ctx, 'ai.projectScreenPos', payload)
      return result ?? { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
})
