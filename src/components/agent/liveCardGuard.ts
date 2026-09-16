/**
 * live 推理/正文卡片的创建裁决（纯函数，2026-09-16）。
 *
 * 背景（双思考卡竞态）：切换/恢复会把「历史窗口（尾为 pendingPartial 半截段）」
 * 通过 setMessages 整表装进消息列表，而 messagesRef 要到 useEffect 提交后才同步。
 * 在「历史已排队、ref 尚未同步」的窗口内到达的 reasoning.delta / content.delta
 * 会穿过面板侧基于 messagesRef 的旧守卫——若此时按旧列表判定直接追加 live 卡，
 * React 的函数式更新会把它排在历史窗口之后，同一段推理文本上屏两张卡。
 *
 * 规则：创建判定必须基于真实的新鲜列表（setMessages updater 的 cur）：
 * 列表尾是半截段 → 放弃创建（增量留在服务端缓冲，flush 完整段会原地替换半截段）；
 * 否则正常追加。本函数返回原数组引用表示"被拦截"，调用方可据此作废 live ref。
 */

/** 可被 live 卡片创建检查的消息形状（只依赖半截段标记） */
export interface LiveGuardMessage {
  pendingPartial?: boolean
}

/**
 * 裁决是否可以追加 live 卡片。
 * @returns 允许创建时返回新数组（cur + card）；被半截段拦截时返回 cur 原引用。
 */
export function appendLiveCard<T extends LiveGuardMessage>(cur: T[], card: T): T[] {
  const tail = cur[cur.length - 1]
  if (cur.length > 0 && tail.pendingPartial) return cur
  return [...cur, card]
}
