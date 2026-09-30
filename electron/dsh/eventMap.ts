/**
 * DSH 会话事件加法归一化（wire 形状 → 方言字段）
 *
 * 原则：只增不改。内核 wire 字段原样保留（渲染层既有防御式收窄继续成立），
 * 同时把渲染层关心的语义提升为方言字段——内核将来改名时只改这里（或对应适配器）。
 *
 * 现有归一化项：
 *   tool/result: data.meta.diffs（内核 dsh-tool-fs computeHunkDiffs 产物）
 *                → data.diffs（方言字段；渲染层 extractDiffs 方言字段优先）
 */

/** 判断值是否为普通对象（非数组非 null） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 默认归一化实现（0.1.1/0.1.7 通用的部分）。适配器可提供 normalizeSessionEvent 覆写/扩展。
 * 返回原事件（无归一化项时零开销，不克隆）或浅克隆增强版（绝不原地改写输入）。
 */
export function normalizeSessionEvent<T extends Record<string, unknown>>(event: T): T {
  if (!isPlainObject(event)) return event
  if (event.type !== 'tool/result' || !isPlainObject(event.data)) return event
  const data = event.data
  if (data.diffs !== undefined || !isPlainObject(data.meta)) return event
  const diffs = (data.meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return event
  return { ...event, data: { ...data, diffs } } as T
}
