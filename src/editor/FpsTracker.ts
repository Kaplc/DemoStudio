/**
 * FpsTracker — FPS 计数与游戏状态上报
 *
 * 从 App.tsx 中剥离的非 UI 逻辑：
 * - 周期（1s）从 GameInstance 读取渲染帧率 + 逻辑帧率
 * - 同时统计编辑器 rAF 帧率（独立于游戏）
 * - 同步游戏运行状态到 Electron main 进程
 */
import { useEditorStore } from '../stores/editorStore'
import { GameInstance } from '../engine/gameflow/GameInstance'

export type FrameInfo = { renderFps: number; logicFps: number; projectName: string }
export type FrameCallback = (info: FrameInfo) => void

export class FpsTracker {
  /** 编辑器 rAF 帧计数（仅用于记录，不显示） */
  private editorFrame = 0
  private editorRafId = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private running = false
  private callback: FrameCallback | null = null

  /** 启动 FPS 跟踪 */
  start(callback: FrameCallback): void {
    if (this.running) return
    this.running = true
    this.callback = callback

    // 编辑器 rAF 帧计数（只记录，不参与游戏 FPS 计算）
    const countEditorFrame = () => {
      if (!this.running) return
      this.editorFrame++
      this.editorRafId = requestAnimationFrame(countEditorFrame)
    }
    this.editorRafId = requestAnimationFrame(countEditorFrame)

    // 每秒从游戏实例读取渲染帧率 + 逻辑帧率
    this.intervalId = setInterval(() => {
      const state = useEditorStore.getState()
      const projectName = state.gameState.running
        ? (state.currentProject?.name ?? 'Game')
        : 'No project'

      let renderFps = 0
      let logicFps = 0
      const inst = GameInstance.current
      if (inst) {
        renderFps = inst.world.gameRenderer?.renderFps ?? 0
        logicFps = inst.world.logicFps
      }

      this.callback?.({ renderFps, logicFps, projectName })
    }, 1000)
  }

  /** 停止 FPS 跟踪 */
  stop(): void {
    this.running = false
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.editorRafId) {
      cancelAnimationFrame(this.editorRafId)
      this.editorRafId = 0
    }
    this.callback = null
  }
}
