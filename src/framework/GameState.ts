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
}
