/**
 * 内置性能采集模块（fps / render / scene / js）
 *
 * 扩展新模块时参照本文件：实现 IPerfModule → 在 createBuiltinPerfModules()
 * 追加（或运行时 PerfStatsCollector.instance().register()）。
 * 数据形状同步进 src/types/perf.ts（面板精排渲染 + AI 文档口径）。
 */
import type { World } from '../../gameflow/World'
import { PERF_MODULE } from '../../../types/perf'
import type { FpsModuleData, JsModuleData, RenderModuleData, SceneModuleData } from '../../../types/perf'
import type { IPerfModule, PerfSampleContext } from './PerfTypes'

/** 场景节点最小结构（THREE.Object3D 结构化子集，便于测试用假对象） */
interface SceneNodeLike {
  visible: boolean
  children: SceneNodeLike[]
  isMesh?: boolean
}

/**
 * 统计场景可见/总 mesh 数。不可见子树整体跳过（渲染器同样不绘制），
 * 计数口径与 warm 2026-09-16 诊断（可见 mesh 352→117）一致。
 */
function countMeshes(root: SceneNodeLike | null | undefined): { visible: number; total: number } {
  if (!root) return { visible: 0, total: 0 }
  let visible = 0
  let total = 0
  const stack: SceneNodeLike[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.isMesh) {
      total += 1
      if (node.visible) visible += 1
    }
    // 不可见节点整棵子树不入栈（渲染器也不会绘制）
    if (node.visible) {
      for (const child of node.children) stack.push(child)
    }
  }
  return { visible, total }
}

/** 帧率模块：每帧采样，EMA 平滑（α=0.1，约 10 帧收敛） */
class FpsPerfModule implements IPerfModule {
  readonly name = PERF_MODULE.Fps
  readonly label = '帧率'
  readonly intervalMs = 0
  private _ema = 0

  sample(ctx: PerfSampleContext): Record<string, unknown> | null {
    if (ctx.dtMs > 0) {
      const instant = 1000 / ctx.dtMs
      this._ema = this._ema > 0 ? this._ema + (instant - this._ema) * 0.1 : instant
    }
    const data: FpsModuleData = {
      fps: Math.round(this._ema * 10) / 10,
      frameMs: Math.round(ctx.dtMs * 100) / 100,
    }
    return data as unknown as Record<string, unknown>
  }
}

/**
 * 渲染调用模块：读 renderer.info（O(1)）。
 * autoReset 语义由采集器统一接管（false + 每帧手动 reset），
 * 保证 calls 为世界 + UI 两趟 render() 之和——three 默认 autoReset=true
 * 会在每次 render() 后重置，直读只会拿到 UI 最后一趟的数字。
 */
class RenderInfoPerfModule implements IPerfModule {
  readonly name = PERF_MODULE.Render
  readonly label = '渲染调用'
  readonly intervalMs = 0

  sample(ctx: PerfSampleContext): Record<string, unknown> | null {
    const renderer = ctx.world?.gameRenderer?.renderer
    if (!renderer) return null
    const info = renderer.info as unknown as {
      render: { calls: number; triangles: number }
      memory: { geometries: number; textures: number }
    }
    const data: RenderModuleData = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    }
    return data as unknown as Record<string, unknown>
  }
}

/** 场景计数模块：遍历世界 + UI 场景树（O(n)，500ms 降频） */
class SceneStatsPerfModule implements IPerfModule {
  readonly name = PERF_MODULE.Scene
  readonly label = '场景对象'
  readonly intervalMs = 500

  sample(ctx: PerfSampleContext): Record<string, unknown> | null {
    const world: World | null = ctx.world
    if (!world) return null
    const worldStats = countMeshes(world.sceneComp?.scene as unknown as SceneNodeLike)
    const uiStats = countMeshes(world.ui?.scene as unknown as SceneNodeLike)
    const data: SceneModuleData = {
      worldVisible: worldStats.visible,
      worldTotal: worldStats.total,
      uiVisible: uiStats.visible,
      uiTotal: uiStats.total,
    }
    return data as unknown as Record<string, unknown>
  }
}

/** JS 堆 + 长任务模块：1s 降频；非 Chromium 环境 heap 为 null */
class JsHeapPerfModule implements IPerfModule {
  readonly name = PERF_MODULE.Js
  readonly label = 'JS 内存'
  readonly intervalMs = 1000
  private _longTasks = 0
  private _observer: PerformanceObserver | null = null

  setup(): void {
    // 长任务（>50ms 主线程占用）累计计数；observe 不支持的环境静默降级
    try {
      this._observer = new PerformanceObserver((list) => {
        this._longTasks += list.getEntries().length
      })
      this._observer.observe({ entryTypes: ['longtask'] })
    } catch {
      this._observer = null
    }
  }

  sample(): Record<string, unknown> | null {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
    const toMB = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10
    const data: JsModuleData = {
      heapUsedMB: memory ? toMB(memory.usedJSHeapSize) : null,
      heapTotalMB: memory ? toMB(memory.totalJSHeapSize) : null,
      longTasks: this._longTasks,
    }
    return data as unknown as Record<string, unknown>
  }

  dispose(): void {
    this._observer?.disconnect()
    this._observer = null
  }
}

/** 内置模块清单（采集器构造时注册） */
export function createBuiltinPerfModules(): IPerfModule[] {
  return [new FpsPerfModule(), new RenderInfoPerfModule(), new SceneStatsPerfModule(), new JsHeapPerfModule()]
}
