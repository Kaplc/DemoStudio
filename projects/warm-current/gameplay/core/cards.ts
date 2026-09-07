/**
 * cards — 海克斯三选一卡库（模块 03 §4 · 固定得失组合 · 每局按线洗牌）
 *
 * 卡定义数据驱动：warm-current.cards 表（fallback 内置 DEFAULT_CARDS，见 balance.ts），
 * effects 字段由 sim.chooseCard 统一应用。
 * 规则：
 *  - 抽卡范围 = 触发节点所属线的卡池；不足 3 张从全局候选池补足
 *  - 解锁型（station_unlock/event_warning）一次性，拿到后不再进池
 *  - 升级型可重复抽到（tradeoff 每次叠乘）
 *  - 引力窗口随第二幕自动开启（模块 03 "若二幕前未自带"），故不设"引力窗口开启"卡
 */
import { B } from './balance'
import type { CardDef } from './balance'
import type { ResearchLineId } from './types'

/** 卡是否可进候选池（解锁型已拿除名） */
export function cardEligible(card: CardDef, taken: string[], stationUnlocked: boolean, flareWarning: boolean): boolean {
  if (card.id === 'station_unlock' && stationUnlocked) return false
  if (card.id === 'event_warning' && flareWarning) return false
  return !taken.includes(card.id)
}

/** 从指定线抽 3 张：线池优先，不足从全局补足 */
export function drawCards(
  line: ResearchLineId,
  taken: string[],
  stationUnlocked: boolean,
  flareWarning: boolean,
  rng: () => number,
): string[] {
  const pool = B.cards
  const ok = (c: CardDef) => cardEligible(c, taken, stationUnlocked, flareWarning)
  const linePool = pool.filter((c) => c.line === line && ok(c)).map((c) => c.id)
  shuffle(linePool, rng)
  const hand = linePool.slice(0, 3)
  if (hand.length < 3) {
    const globalPool = pool.filter((c) => c.line !== line && ok(c)).map((c) => c.id)
    shuffle(globalPool, rng)
    for (const id of globalPool) {
      if (hand.length >= 3) break
      if (!hand.includes(id)) hand.push(id)
    }
  }
  return hand
}

export function getCardDef(id: string): CardDef | undefined {
  return B.cards.find((c) => c.id === id)
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
