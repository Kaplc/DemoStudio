/**
 * 回合末关键词预筛（零模型请求）：只测转录中的 `[用户] ` 行。
 * 宁滥勿缺——误报只是让主 agent 下一回合多判定一次，漏报则丢一条纠正；
 * "是否人工纠正/是否必要条件"的双条件判定由主 agent 结合上下文自行完成。
 *
 * @module preScreen
 */

/**
 * 纠正关键词预筛（只测 `[用户] ` 行）。
 * 预筛是唯一门槛，判读交给主 agent，所以模式保持宽泛。
 */
export const CORRECTION_HINT_PATTERN =
  /(别|不要|不用这样|不准|不对|不是这样|不是这个|不行|错了|搞错|弄错|搞反|弄反|反了|漏了|回滚|重来|重新|撤回|停下|停止|打住|记住|以后都|以后别|以后不|沉淀|wrong|mistake|don't|do not|stop doing|revert|undo)/i

/** 提示中单条原话摘录的字符上限。 */
export const MAX_HINT_EXCERPT_CHARS = 160

/** 提示中保留的摘录条数上限（保留最近的）。 */
export const MAX_HINT_EXCERPTS = 2

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/**
 * 从回合转录中提取命中纠正关键词的用户消息摘录（剥掉 `[用户] ` 前缀，
 * 超长截断；命中多于上限时保留最近的）。
 */
export function screenTranscript(transcript: string): string[] {
  const matched: string[] = []
  for (const line of transcript.split('\n')) {
    if (!line.startsWith('[用户] ') || !CORRECTION_HINT_PATTERN.test(line)) continue
    matched.push(clip(line.slice('[用户] '.length), MAX_HINT_EXCERPT_CHARS))
  }
  return matched.slice(-MAX_HINT_EXCERPTS)
}
