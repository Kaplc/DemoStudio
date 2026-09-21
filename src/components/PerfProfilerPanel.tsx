/**
 * PerfProfilerPanel — 性能分析器独立窗口面板（只读）
 *
 * 数据源：electronAPI.perfGetSnapshot IPC 往返（1s 轮询，关窗/卸载即停，零常驻开销）。
 * 只读不写：面板对引擎/采集器零写入；未来诊断开关（场景二分等）须独立分区并显式标注。
 *
 * 扩展契约：快照 modules 键 = 采集模块名。内置键（PERF_MODULE）精排渲染；
 * 未知键自动走通用键值表——新增采集模块无需改本组件即自动出现。
 */
import React, { useEffect, useRef, useState } from 'react'
import { PERF_MODULE } from '../types/perf'
import type {
  FpsModuleData,
  JsModuleData,
  PerfSnapshot,
  PerfSnapshotResult,
  RenderModuleData,
  SceneModuleData,
} from '../types/perf'

/** 本地趋势缓冲上限（与服务端环形缓冲一致） */
const TREND_LIMIT = 120
/** 轮询间隔毫秒 */
const POLL_INTERVAL_MS = 1000

/** 取模块数据的类型安全助手（键不存在返回 null） */
function getModule<T>(snapshot: PerfSnapshot | null, name: string): T | null {
  if (!snapshot) return null
  const data = snapshot.modules[name]
  return data ? (data as unknown as T) : null
}

/** 数值格式化：三角形数等大数缩写 */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 迷你趋势图（canvas 直绘，避免高频 React 重渲染） */
function Sparkline({ values, color, height }: { values: number[]; color: string; height: number }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const dpr = window.devicePixelRatio || 1
    const width = parent?.clientWidth ?? 200
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (values.length < 2) return

    const max = Math.max(...values)
    const min = Math.min(...values)
    const span = max - min || 1
    const stepX = width / (values.length - 1)
    const y = (v: number): number => height - 3 - ((v - min) / span) * (height - 6)

    // 折线
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    values.forEach((v, i) => {
      const px = i * stepX
      if (i === 0) ctx.moveTo(px, y(v))
      else ctx.lineTo(px, y(v))
    })
    ctx.stroke()
    // 峰值标注
    ctx.fillStyle = color
    ctx.font = '10px monospace'
    ctx.fillText(`${max >= 1000 ? formatCount(max) : max.toFixed(1)}`, 4, 11)
    ctx.fillText(`${min >= 1000 ? formatCount(min) : min.toFixed(1)}`, 4, height - 3)
  }, [values, color, height])

  return <canvas ref={canvasRef} className="perf-sparkline" />
}

/** 通用键值段（未知模块的自动渲染路径） */
function GenericSection({ name, data }: { name: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null
  return (
    <div className="perf-section">
      <div className="perf-section__title">{name}</div>
      <div className="perf-kv">
        {entries.map(([k, v]) => (
          <div key={k} className="perf-kv__row">
            <span className="perf-kv__key">{k}</span>
            <span className="perf-kv__val">{typeof v === 'number' ? Math.round(v * 100) / 100 : String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PerfProfilerPanel(): React.ReactElement {
  const [result, setResult] = useState<PerfSnapshotResult | null>(null)
  const [trend, setTrend] = useState<PerfSnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const seededRef = useRef(false)
  const hasApi = typeof window !== 'undefined' && typeof window.electronAPI?.perfGetSnapshot === 'function'

  useEffect(() => {
    if (!hasApi) return
    let stopped = false
    const poll = async (): Promise<void> => {
      try {
        // 首帧带历史（趋势图立即铺满），后续只拉增量当前值（带宽/序列化减负）
        const res = (await window.electronAPI!.perfGetSnapshot(seededRef.current ? 0 : TREND_LIMIT)) as PerfSnapshotResult
        if (stopped) return
        seededRef.current = true
        setError(null)
        setResult(res)
        setTrend((prev) => {
          if (res.history && res.history.length > 0) return res.history.slice(-TREND_LIMIT)
          const cur = res.current ? [...prev, res.current] : prev
          return cur.slice(-TREND_LIMIT)
        })
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [hasApi])

  const current = result?.current ?? null
  const running = result?.running ?? false
  const fps = getModule<FpsModuleData>(current, PERF_MODULE.Fps)
  const render = getModule<RenderModuleData>(current, PERF_MODULE.Render)
  const scene = getModule<SceneModuleData>(current, PERF_MODULE.Scene)
  const js = getModule<JsModuleData>(current, PERF_MODULE.Js)
  const trendFps = trend.map((s) => (getModule<FpsModuleData>(s, PERF_MODULE.Fps)?.fps ?? 0))
  const trendCalls = trend.map((s) => (getModule<RenderModuleData>(s, PERF_MODULE.Render)?.calls ?? 0))

  // 未知模块（未来扩展）：内置键之外的自动通用渲染
  const unknownModules = current
    ? Object.entries(current.modules).filter(([k]) => !Object.values(PERF_MODULE).includes(k as never))
    : []

  return (
    <div className="perf-panel">
      <div className="perf-header">
        <span className="perf-header__title">性能分析器</span>
        <span className={`perf-header__badge ${running ? 'is-running' : 'is-stopped'}`}>
          {running ? '采样中' : current ? '已停止（快照冻结）' : '未运行'}
        </span>
      </div>

      {!hasApi && <div className="perf-empty">需要 Electron 环境（浏览器模式下无采集通道）</div>}
      {hasApi && error && <div className="perf-empty">拉取失败: {error}</div>}
      {hasApi && !error && !current && <div className="perf-empty">暂无快照 —— 启动游戏后开始采样</div>}

      {hasApi && current && (
        <>
          <div className="perf-bigstats">
            <div className="perf-bigstat">
              <div className="perf-bigstat__num">{fps ? fps.fps.toFixed(0) : '--'}</div>
              <div className="perf-bigstat__label">FPS</div>
            </div>
            <div className="perf-bigstat">
              <div className="perf-bigstat__num">{fps ? fps.frameMs.toFixed(1) : '--'}</div>
              <div className="perf-bigstat__label">帧耗时 ms</div>
            </div>
            <div className="perf-bigstat">
              <div className="perf-bigstat__num">{render ? formatCount(render.calls) : '--'}</div>
              <div className="perf-bigstat__label">Draw Calls</div>
            </div>
            <div className="perf-bigstat">
              <div className="perf-bigstat__num">{render ? formatCount(render.triangles) : '--'}</div>
              <div className="perf-bigstat__label">Triangles</div>
            </div>
          </div>

          <div className="perf-section">
            <div className="perf-section__title">帧率趋势</div>
            <Sparkline values={trendFps} color="#4fc08d" height={48} />
          </div>
          <div className="perf-section">
            <div className="perf-section__title">Draw Calls 趋势（世界 + UI 两趟之和）</div>
            <Sparkline values={trendCalls} color="#64b5f6" height={48} />
          </div>

          {render && (
            <div className="perf-section">
              <div className="perf-section__title">渲染资源</div>
              <div className="perf-kv">
                <div className="perf-kv__row"><span className="perf-kv__key">geometries</span><span className="perf-kv__val">{render.geometries}</span></div>
                <div className="perf-kv__row"><span className="perf-kv__key">textures</span><span className="perf-kv__val">{render.textures}</span></div>
              </div>
            </div>
          )}

          {scene && (
            <div className="perf-section">
              <div className="perf-section__title">场景对象（可见 / 总数）</div>
              <div className="perf-kv">
                <div className="perf-kv__row"><span className="perf-kv__key">世界 mesh</span><span className="perf-kv__val">{scene.worldVisible} / {scene.worldTotal}</span></div>
                <div className="perf-kv__row"><span className="perf-kv__key">UI mesh</span><span className="perf-kv__val">{scene.uiVisible} / {scene.uiTotal}</span></div>
              </div>
            </div>
          )}

          {js && (
            <div className="perf-section">
              <div className="perf-section__title">JS 内存</div>
              <div className="perf-kv">
                <div className="perf-kv__row"><span className="perf-kv__key">heap used</span><span className="perf-kv__val">{js.heapUsedMB === null ? '不可用' : `${js.heapUsedMB} MB`}</span></div>
                <div className="perf-kv__row"><span className="perf-kv__key">heap total</span><span className="perf-kv__val">{js.heapTotalMB === null ? '不可用' : `${js.heapTotalMB} MB`}</span></div>
                <div className="perf-kv__row"><span className="perf-kv__key">长任务（累计）</span><span className="perf-kv__val">{js.longTasks}</span></div>
              </div>
            </div>
          )}

          {unknownModules.map(([name, data]) => (
            <GenericSection key={name} name={name} data={data} />
          ))}

          <div className="perf-footer">
            AI 读数：ai.getPerfStats（payload {'{samples?: number}'} 附带历史）· 快照 ts {Math.round(current.ts)}
          </div>
        </>
      )}
    </div>
  )
}
