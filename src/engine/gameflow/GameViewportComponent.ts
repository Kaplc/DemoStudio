/**
 * GameViewportComponent — 游戏视口组件
 *
 * 持有游戏渲染容器 DOM，供 SceneRendererComponent 获取用于挂载 WebGL canvas。
 * 由 GameInstance 在构造时创建并添加组件生命周期统一管理。
 */
import { AObjectComponent } from '../entity/AObjectComponent'
import type { GameInstance } from './GameInstance'

export class GameViewportComponent extends AObjectComponent<GameInstance> {
  /** 游戏渲染容器 DOM（SceneRendererComponent 从这里获取 canvas 挂载点） */
  private _container: HTMLElement | null = null

  get container(): HTMLElement | null {
    return this._container
  }

  /** 设置渲染容器（可在构造后调用） */
  setContainer(container: HTMLElement | null): void {
    this._container = container
  }
}
