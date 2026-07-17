/**
 * GameState — 可观察的游戏全局状态
 * 模仿 UE GameState（Actor），React 可通过 subscribe 监听变化
 */
import { Actor } from './Actor'

export type GamePhase = 'waiting' | 'playing' | 'paused' | 'gameover'

export class GameState extends Actor {
  public score = 0
  public phase: GamePhase = 'waiting'
  public timeElapsed = 0
  public gameOver = false

  private listeners = new Set<() => void>()

  constructor() {
    super('GameState')
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  protected notify() {
    this.listeners.forEach((cb) => cb())
  }

  reset() {
    this.score = 0
    this.phase = 'waiting'
    this.timeElapsed = 0
    this.gameOver = false
    this.notify()
  }

  addScore(amount: number) {
    this.score += amount
    this.notify()
  }

  setPhase(phase: GamePhase) {
    this.phase = phase
    if (phase === 'gameover') this.gameOver = true
    this.notify()
  }

  /** 序列化为可存档结构 */
  serialize(): Record<string, unknown> {
    return {
      score: this.score,
      phase: this.phase,
      timeElapsed: this.timeElapsed,
      gameOver: this.gameOver,
    }
  }

  /** 从结构恢复，并触发 notify 同步订阅者（HUD 等） */
  restoreFrom(data: Record<string, unknown>): void {
    this.score = (data.score as number) ?? 0
    this.phase = (data.phase as GamePhase) ?? 'waiting'
    this.timeElapsed = (data.timeElapsed as number) ?? 0
    this.gameOver = (data.gameOver as boolean) ?? false
    this.notify()
  }
}
