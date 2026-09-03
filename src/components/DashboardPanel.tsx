/**
 * DashboardPanel — 持续页面状态面板
 *
 * 固定定位的浮动面板（与 CodeLintPanel / ErrorStatusPanel 同级，fixed 定位不占布局）：
 * - 数据源：编辑器页面自身 + 运行中游戏 World（getRunningWorld()），每 2s 轮询一次（仅面板展开时）
 * - 四个信息区：Page（页面信息）/ Console（__ai_console 收集器日志）/ HUD（运行中游戏 UI 树）/ Scene（运行中游戏 Actor 树）
 * - HUD/Scene 与 MCP get_ui_outline / get_scene_outline 同源，AI 操作前先看这里确认目标存在、状态正确
 * - 样式：全部走 editor.css（dashboard-* 类），与 errpanel / codelint-panel 风格一致
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { getRunningWorld } from '../editor/SelectionManager'

/** 单条控制台日志 */
interface ConsoleLogEntry {
  level: string
  text: string
  timestamp: number
}

/** HUD/Scene 树节点（与 MCP get_ui_outline / get_scene_outline 同构） */
interface TreeNode {
  name: string
  type: string
  active: boolean
  /** UITextComponent 的文字内容（仅文本节点有） */
  text?: string
  children: TreeNode[]
}

/** 仪表盘状态快照 */
interface DashboardState {
  page: {
    url: string
    title: string
    visibility: string
    readyState: string
    viewport: { w: number; h: number }
  }
  console: {
    errors: number
    warnings: number
    infos: number
    recent: ConsoleLogEntry[]
  }
  /** 游戏是否运行中（决定 HUD/Scene 区是否有数据） */
  gameRunning: boolean
  /** 运行中游戏 UI 树（HUD/面板/按钮层级） */
  hud: TreeNode[]
  /** 运行中游戏 Actor 树（场景对象） */
  scene: TreeNode[]
  timestamp: number
}

const POLL_INTERVAL_MS = 2000
/** 每棵树最多渲染的行数（兵潮场景 Actor 可能上百，防止渲染拖垮面板） */
const MAX_TREE_LINES = 300

/** 从 Actor 抽取文本组件的文字（鸭子类型读取，避免引入具体组件类依赖） */
function readActorText(actor: any): string | undefined {
  for (const comp of actor.getAllComponents() as any[]) {
    const t = (comp as any).text
    if (typeof t === 'string') return t
  }
  return undefined
}

/** Actor → TreeNode（HUD/Scene 树通用） */
function buildTreeNode(actor: any): TreeNode {
  const children = (actor.getChildren() ?? []) as any[]
  return {
    name: actor.root?.name || actor.name || '(unnamed)',
    type: actor.constructor.name,
    active: actor.bActive !== false,
    text: readActorText(actor),
    children: children.map(buildTreeNode),
  }
}

/** 递归统计树节点总数 */
function countNodes(nodes: TreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    n += 1 + countNodes(node.children)
  }
  return n
}

export function DashboardPanel() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<DashboardState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 树折叠状态：默认全展开，点击节点前箭头折叠/展开（key 含名字，跨轮询稳定）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleNode = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** 采集一次当前状态（页面信息 + 运行中游戏 HUD/Scene 树） */
  const collectStatus = useCallback(async () => {
    try {
      const consoleArr = ((window as any).__ai_console || []) as ConsoleLogEntry[]
      let gameRunning = false
      const hud: TreeNode[] = []
      const scene: TreeNode[] = []
      const world = getRunningWorld()
      if (world) {
        gameRunning = true
        // HUD 树：只取无 parent 的顶层 UI Actor（与 MCP get_ui_outline 一致）
        const uiActors = world.ui.getAllUIActors() as any[]
        uiActors.filter((a) => !a.parent).forEach((a) => hud.push(buildTreeNode(a)))
        // Scene 树：全部根 Actor（与 MCP get_scene_outline 一致）
        ;(world.actorMgr.GetAllActors() as any[]).forEach((a) => scene.push(buildTreeNode(a)))
      }
      setState({
        page: {
          url: location.href,
          title: document.title,
          visibility: document.visibilityState,
          readyState: document.readyState,
          viewport: { w: window.innerWidth, h: window.innerHeight },
        },
        console: {
          errors: consoleArr.filter((l) => l.level === 'error').length,
          warnings: consoleArr.filter((l) => l.level === 'warn').length,
          infos: consoleArr.filter((l) => l.level === 'info').length,
          recent: consoleArr.slice(-10).reverse(),
        },
        gameRunning,
        hud,
        scene,
        timestamp: Date.now(),
      })
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }, [])

  // 轮询循环：仅面板展开时轮询，收起即停
  useEffect(() => {
    if (!open) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    void collectStatus() // 展开时立即采集一次
    intervalRef.current = setInterval(() => void collectStatus(), POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [open, collectStatus])

  return (
    <>
      {/* 状态栏入口（风格同 status-err / status-codelint） */}
      <span
        className={`status-dashboard ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        title={open ? '收起状态面板' : '展开状态面板（实时页面状态）'}
      >
        <span className="status-label">Dashboard</span>
      </span>

      {/* 浮动面板（fixed 定位，状态栏上方，不占布局） */}
      {open && (
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <span className="dashboard-panel-title">页面状态 Live Dashboard</span>
            <div className="dashboard-panel-actions">
              <span className="dashboard-panel-time">
                {state ? new Date(state.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}
              </span>
              <button className="dashboard-btn dashboard-close" onClick={() => setOpen(false)} title="收起">
                ✕
              </button>
            </div>
          </div>

          <div className="dashboard-panel-body">
            {error && <div className="dashboard-error-line">⚠ {error}</div>}
            {!state && !error && <div className="dashboard-empty">正在获取页面状态...</div>}

            {state && (
              <>
                {/* ── Page ── */}
                <Section title="Page">
                  <Row label="URL" value={state.page.url} />
                  <Row label="Title" value={state.page.title} />
                  <Row
                    label="Visibility"
                    value={state.page.visibility}
                    color={state.page.visibility === 'visible' ? 'var(--success)' : '#f0a500'}
                  />
                  <Row label="ReadyState" value={state.page.readyState} />
                  <Row label="Viewport" value={`${state.page.viewport.w}×${state.page.viewport.h}`} />
                </Section>

                {/* ── Console ── */}
                <Section title={`Console (❌${state.console.errors} ⚠${state.console.warnings})`}>
                  {state.console.recent.length === 0 ? (
                    <div className="dashboard-empty-line">（无日志）</div>
                  ) : (
                    state.console.recent.map((log, i) => (
                      <div
                        key={`${log.timestamp}-${i}`}
                        className={`dashboard-log-line dashboard-log-${log.level}`}
                        title={log.text}
                      >
                        <span className="dashboard-log-time">
                          {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        <span className="dashboard-log-text">{log.text}</span>
                      </div>
                    ))
                  )}
                </Section>

                {/* ── HUD（运行中游戏 UI 树） ── */}
                <Section title={`HUD (${state.hud.length} 根节点)`}>
                  {!state.gameRunning ? (
                    <div className="dashboard-empty-line">（游戏未运行）</div>
                  ) : state.hud.length === 0 ? (
                    <div className="dashboard-empty-line">（无 UI Actor）</div>
                  ) : (
                    <TreeView nodes={state.hud} collapsed={collapsed} toggle={toggleNode} />
                  )}
                </Section>

                {/* ── Scene（运行中游戏 Actor 树） ── */}
                <Section title={`Scene (${state.scene.length} 根 Actor / ${countNodes(state.scene)} 总数)`}>
                  {!state.gameRunning ? (
                    <div className="dashboard-empty-line">（游戏未运行）</div>
                  ) : state.scene.length === 0 ? (
                    <div className="dashboard-empty-line">（无 Actor）</div>
                  ) : (
                    <TreeView nodes={state.scene} collapsed={collapsed} toggle={toggleNode} />
                  )}
                </Section>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** 信息区标题 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dashboard-section">
      <div className="dashboard-section-title">{title}</div>
      {children}
    </div>
  )
}

/** 键值行 */
function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="dashboard-row">
      <span className="dashboard-key">{label}</span>
      <span className="dashboard-value" style={color ? { color } : undefined} title={value}>
        {value}
      </span>
    </div>
  )
}

/** HUD/Scene 通用树视图（默认全展开，点箭头折叠；超上限截断） */
function TreeView({
  nodes,
  collapsed,
  toggle,
}: {
  nodes: TreeNode[]
  collapsed: Set<string>
  toggle: (key: string) => void
}) {
  let lines = 0
  let truncated = false
  const render = (node: TreeNode, key: string, depth: number): React.ReactNode[] => {
    if (lines >= MAX_TREE_LINES) {
      truncated = true
      return []
    }
    lines++
    const hasChildren = node.children.length > 0
    const isOpen = hasChildren && !collapsed.has(key)
    const rows: React.ReactNode[] = [
      <div key={key} className="dashboard-tree-line" style={{ paddingLeft: 8 + depth * 12 }}>
        <button
          className="dashboard-tree-toggle"
          onClick={() => hasChildren && toggle(key)}
          title={hasChildren ? (isOpen ? '折叠' : '展开') : undefined}
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
        </button>
        <span className={`dashboard-tree-name ${node.active ? '' : 'dashboard-tree-inactive'}`}>{node.name}</span>
        <span className="dashboard-tree-type">{node.type}</span>
        {node.text && (
          <span className="dashboard-tree-text" title={node.text}>
            {node.text}
          </span>
        )}
      </div>,
    ]
    if (isOpen) {
      node.children.forEach((c, i) => rows.push(...render(c, `${key}/${i}:${c.name}`, depth + 1)))
    }
    return rows
  }

  const rows: React.ReactNode[] = []
  nodes.forEach((n, i) => rows.push(...render(n, `${i}:${n.name}`, 0)))
  return (
    <div className="dashboard-tree">
      {rows}
      {truncated && <div className="dashboard-empty-line">（已截断，超过 {MAX_TREE_LINES} 行）</div>}
    </div>
  )
}
