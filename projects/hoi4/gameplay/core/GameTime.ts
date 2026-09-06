/**
 * GameTime — 暂停 + 5 速的小时步进器（plan §D3）
 *
 * speedLevels: 每现实秒推进的游戏小时数 = [1, 2, 4, 8, 16]，暂停 = 0。
 * 禁止墙钟（Date.now/performance.now）——realDt 一律来自引擎 tick 的 dt。
 */
export const SPEEDS = [1, 2, 4, 8, 16]

/** 1936-1-1 为纪元；月份天数表（非闰年 2 月按 28 天，demo 精度足够） */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function formatGameDate(hour: number): string {
  let h = Math.max(0, Math.floor(hour))
  const year = 1936 + Math.floor(h / 8760)
  h %= 8760
  let day = Math.floor(h / 24)
  const hourOfDay = h % 24
  let month = 0
  for (; month < 12; month++) {
    if (day < DAYS_IN_MONTH[month]) break
    day -= DAYS_IN_MONTH[month]
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month + 1)}-${pad(day + 1)} ${pad(hourOfDay)}:00`
}

/** 每现实秒推进的游戏小时数（speed 1-5） */
export function speedHoursPerSecond(speed: number): number {
  return SPEEDS[Math.min(SPEEDS.length, Math.max(1, speed)) - 1]
}

export class GameTime {
  /** 距 1936-1-1 00:00 的整小时数 */
  hour = 0
  /** 1-5 档变速 */
  speed = 2
  paused = true

  private acc = 0

  reset(hour = 0, speed = 2, paused = true): void {
    this.hour = hour
    this.speed = speed
    this.paused = paused
    this.acc = 0
  }

  /**
   * 推进一步。realDt 秒；onHour 每整点回调；onDay 每日 00:00 回调（在当日第一小时的 onHour 之后）。
   * @returns 本步推进的游戏小时数（GM 单步对拍用）
   */
  advance(realDt: number, onHour: () => void, onDay: () => void): number {
    if (this.paused) return 0
    this.acc += realDt * speedHoursPerSecond(this.speed)
    let stepped = 0
    while (this.acc >= 1) {
      this.acc -= 1
      this.hour++
      stepped++
      onHour()
      if (this.hour % 24 === 0) onDay()
      // 防御：单帧极端大 dt（断点恢复）时避免无限循环卡死，一帧至多推 24h
      if (stepped >= 24) { this.acc = 0; break }
    }
    return stepped
  }

  serialize(): { hour: number; speed: number; paused: boolean } {
    return { hour: this.hour, speed: this.speed, paused: this.paused }
  }

  restore(s: { hour: number; speed: number; paused: boolean }): void {
    this.reset(s.hour, s.speed, s.paused)
  }
}
