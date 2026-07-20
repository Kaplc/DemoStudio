/**
 * HUD — UI 逻辑控制器基类
 *
 * 模仿 UE HUD，负责管理 UI 生命周期和逻辑，与 TSX 视图分离：
 * - TSX 文件只做纯展示（Props → View），不管理 UI 逻辑
 * - HUD 子类管理状态、生命周期、何时渲染/卸载
 * - GameMode 持有 HUD 引用，自动转发 BeginPlay/EndPlay/Tick
 *
 * 用法：
 *   class MyGameHUD extends HUD {
 *     BeginPlay() { this.renderReact(React.createElement(MyView, this.props)) }
 *     setScore(s: number) { this.props.score = s; this.renderReact() }
 *   }
 */
import type { ReactElement } from 'react'
import type { GameUI } from './GameUI'

export abstract class HUD {
  /** GameUI 引用（由 GameMode.InitGame 或外部注入） */
  ui: GameUI | null = null

  /** 初始化（GameMode.InitGame 时调用） */
  Init(): void {}

  /** 开始播放（GameMode.BeginPlay 时调用，通常在此首次渲染） */
  BeginPlay(): void {}

  /** 结束播放（GameMode.EndPlay 时调用，通常在此清理 UI） */
  EndPlay(): void {
    this.renderReact(null)
  }

  /** 每帧更新 */
  Tick(_dt: number): void {}

  /** 渲染 React 组件（由子类在适当时机调用） */
  protected renderReact(element: ReactElement | null): void {
    this.ui?.renderReact(element)
  }
}
