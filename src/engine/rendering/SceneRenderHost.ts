/**
 * SceneRenderHost — Scene 视口渲染宿主接口
 *
 * 引擎侧只依赖此接口（不依赖具体实现类）：
 * 编辑器层实现（editor/SceneViewport.ts 的 PreviewSceneManager）提供 rAF 渲染循环，引擎通过
 * onUpdate / onAfterRender 挂接游戏 Tick 与叠加渲染。
 *
 * 让引擎 gameflow 可以持有"渲染宿主"而不反向依赖编辑器。
 */
import type * as THREE from 'three'

export interface SceneRenderHost {
  /** 渲染器（CameraOverlayRenderer 等需要直接操作） */
  readonly renderer: THREE.WebGLRenderer

  /** 注册每帧更新回调（游戏 Tick 挂载点），返回注销函数 */
  onUpdate(callback: (dt: number) => void): () => void

  /** 注册渲染后回调（主画面渲染完成后执行，如叠加层），返回注销函数 */
  onAfterRender(callback: () => void): () => void
}
