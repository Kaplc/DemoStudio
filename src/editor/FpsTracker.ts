/**
 * FpsTracker — FPS 计数与游戏状态上报
 *
 * 从 App.tsx 中剥离的非 UI 逻辑：
 * - 使用 requestAnimationFrame 统计实时 FPS
 * - 周期（1s）回调通知上层更新显示
 * - 同步游戏运行状态到 Electron main 进程
 */
import { useEditorStore } from '../stores/editorStore'

export type FpsCallback = (fps: number, projectName: string) => void

export class FpsTracker {
  private frame = 0
  private lastTime = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private rafId = 0
  private running = false
  private callback: FpsCallback | null = null

  /** 启动 FPS 跟踪 */
  start(callback: FpsCallback): void {
    if (this.running) return
    this.running = true
    this.callback = callback
    this.frame = 0
    this.lastTime = performance.now()

    // 每秒统计并回调
    this.intervalId = setInterval(() => {
      const now = performance.now()
      const fps = Math.round((this.frame * 1000) / (now - this.lastTime))
      this.frame = 0
      this.lastTime = now

      const state = useEditorStore.getState()
      const projectName = state.gameState.running
        ? (state.currentProject?.name ?? 'Game')
        : 'No project'
      this.callback?.(fps, projectName)
    }, 1000)

    // rAF 帧计数
    const countFrame = () => {
      if (!this.running) return
      this.frame++
      this.rafId = requestAnimationFrame(countFrame)
    }
    this.rafId = requestAnimationFrame(countFrame)
  }

  /** 停止 FPS 跟踪 */
  stop(): void {
    this.running = false
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
    this.callback = null
  }
}
