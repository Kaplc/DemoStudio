import React, { useCallback, useMemo, useState } from 'react'
import {
  getSelectedActor, select, getSelectionKey, onSelectionChange, getRunningWorld,
} from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import { OutlineContextMenu } from './OutlineContextMenu'
import { TreeEye } from './Outline'
import {
  buildNodeSubtreeText,
  buildTreeText,
  collectKeysWithChildren,
  computeEffectiveHidden,
  computeStableKeys,
  filterOutlineTree,
  useDefaultCollapsed,
} from './outlineCore'
import type { SceneTreeNode } from '../editor/SelectionManager'
import type { Actor } from '../engine'
import { logger } from '../engine'

/**
 * UiOutline — 运行中游戏的 UI 大纲（独立页签）
 *
 * 显示当前运行中游戏 world.ui（UI 独立场景）的 HUD / UI 树：
 *  - 数据源：Viewport 启动游戏时经 setRunningWorld 记录的运行中 World
 *  - 上半部分：HUD 根节点（HUD Actor → uiActor 树）
 *  - 运行中可点击选中节点（Inspector 查看组件），不聚焦摄像机
 *  - 眼睛按钮：运行表现级临时隐藏（setPreviewHidden，不写资产），子树继承置灰
 */
export function UiOutline({ query = '' }: { query?: string }) {
  const [selectionKey, setSelectionKey] = React.useState(getSelectionKey())
  /** 模糊搜索词（空 = 不过滤；命中节点 + 祖先链显示，全展开） */
  const filterQuery = query.trim().toLowerCase()
  const selected = getSelectedActor()
  /** 游戏运行中（UI 树仅在运行时有数据） */
  const gameRunning = useEditorStore((s) => s.gameState.running)

  // 订阅选中变化（Actor 列表变化时 selectionKey 递增也会触发）
  React.useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // ─── 缓存：运行中游戏的 HUD / UI 树 ───
  const runningUiTree = useMemo(() => {
    if (!gameRunning) return null
    const world = getRunningWorld()
    if (!world) return null
    const rows: SceneTreeNode[] = []
    const walk = (a: Actor, depth: number) => {
      // 资产名应用在 root.name（SpawnActorFromBlueprint 只改 root.name），
      // Actor.name 是构造默认名（如 'Actor'）—— 优先 root.name
      rows.push({ depth, name: a.root.name || a.name, actor: a })
      for (const child of a.getChildren()) walk(child, depth + 1)
    }
    // 只遍历顶层 UI Actor（无 parent）：getAllUIActors 包含已 attach 到 HUD 的 UI 根
    // （spawnUIActor 先入 _uiActors 再 attachTo），跳过有 parent 的避免同一棵树重复出现
    for (const a of world.ui.getAllUIActors()) {
      if (a.parent) continue
      walk(a, 0)
    }
    return rows
  }, [gameRunning, selectionKey])

  // ─── 默认折叠：首次出现的有子节点 key 自动折叠（手动展开过的不重置） ───
  const allParentKeys = useMemo(() => collectKeysWithChildren(runningUiTree ?? [], 'ui'), [runningUiTree])
  const [collapsedKeys, toggleCollapsed] = useDefaultCollapsed(allParentKeys)

  // ─── 每行稳定 key（kind + 父链路径 + 节点名）：重开游戏（Actor 重建）后状态保持 ───
  const stableKeys = useMemo(
    () => computeStableKeys(runningUiTree ?? [], 'ui'),
    [runningUiTree],
  )

  // ─── 右键菜单（运行中 UI 树：复制大纲树 / 复制节点及子节点 / 复制名称） ───
  const [menu, setMenu] = useState<{ x: number; y: number; node: SceneTreeNode | null } | null>(null)
  const openMenu = useCallback((e: React.MouseEvent, node: SceneTreeNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleMenuCopyName = useCallback(() => {
    if (!menu || !menu.node) return
    const name = menu.node.name
    navigator.clipboard.writeText(name).catch(() => {
      logger.warn(`[UiOutline] 复制名称到剪贴板失败: ${name}`)
    })
  }, [menu])

  const handleCopyTree = useCallback(() => {
    const text = buildTreeText(runningUiTree ?? [])
    if (!text) {
      logger.warn('[UiOutline] 复制大纲树失败: 当前 UI 树为空')
      setMenu(null)
      return
    }
    navigator.clipboard.writeText(text).catch(() => {
      logger.warn('[UiOutline] 复制大纲树到剪贴板失败')
    })
    setMenu(null)
  }, [runningUiTree])

  const handleCopySubtree = useCallback(() => {
    if (!menu || !menu.node) return
    const name = menu.node.name
    const text = runningUiTree ? buildNodeSubtreeText(runningUiTree, name) : null
    if (text == null) {
      logger.warn(`[UiOutline] 复制节点子树失败: 未在当前树中找到节点 ${name}`)
      setMenu(null)
      return
    }
    navigator.clipboard.writeText(text).catch(() => {
      logger.warn('[UiOutline] 复制节点子树到剪贴板失败')
    })
    setMenu(null)
  }, [menu, runningUiTree])

  /** 右键面板空白处：无目标节点，仅提供「复制大纲树」（整树文本）。
   *  必须定义在下方两个条件 return 之前——hooks 不能出现在提前 return 之后，
   *  否则游戏启动（gameRunning false→true）时 hooks 数量变化会触发 React 崩溃。 */
  const handlePanelContextMenu = useCallback((e: React.MouseEvent) => {
    openMenu(e, null)
  }, [openMenu])

  // ─── 折叠过滤（复用大纲逻辑）；搜索模式：命中 + 祖先链，全展开 ───
  const rows = useMemo(() => {
    if (!runningUiTree || runningUiTree.length === 0) return []
    // 搜索模式：过滤命中节点 + 祖先链，忽略折叠（全展开）
    if (filterQuery) {
      return filterOutlineTree(runningUiTree, filterQuery).map((r) => ({
        node: r.node,
        key: stableKeys[r.index],
        hasChildren: r.hasChildren,
        collapsed: false,
      }))
    }
    const out: Array<{ node: SceneTreeNode; key: string; hasChildren: boolean; collapsed: boolean }> = []
    const foldStack: number[] = []
    for (let i = 0; i < runningUiTree.length; i++) {
      const node = runningUiTree[i]
      while (foldStack.length && foldStack[foldStack.length - 1] >= node.depth) foldStack.pop()
      if (foldStack.length) continue
      const key = stableKeys[i]
      const hasChildren = i + 1 < runningUiTree.length && runningUiTree[i + 1].depth > node.depth
      const collapsed = hasChildren && collapsedKeys.has(key)
      out.push({ node, key, hasChildren, collapsed })
      if (collapsed) foldStack.push(node.depth)
    }
    return out
  }, [runningUiTree, stableKeys, collapsedKeys, filterQuery])

  // ─── 眼睛隐藏：直接读写 Actor.previewHidden（运行时 Actor 实例即真值源，
  //     重开游戏后新实例从 false 起步，不残留上次运行的置灰） ───
  const [hiddenNonce, setHiddenNonce] = useState(0)
  const toggleHidden = useCallback((actor: Actor) => {
    actor.setPreviewHidden(!actor.previewHidden)
    setHiddenNonce((n) => n + 1)
  }, [])

  // 行置灰 = 有效隐藏（自身或任一祖先被眼睛隐藏，子树继承视口表现）
  const hiddenFlags = useMemo(() => {
    const selfKeys = new Set<string>()
    rows.forEach((r) => {
      if (r.node.actor?.previewHidden) selfKeys.add(r.key)
    })
    return computeEffectiveHidden(rows, selfKeys)
  }, [rows, hiddenNonce])

  if (!gameRunning) {
    return (
      <div className="panel-body" style={{ padding: 0 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          游戏运行中显示 HUD / UI 树
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="panel-body" style={{ padding: 0 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          {filterQuery ? '无匹配节点' : '暂无 UI 节点'}
        </div>
      </div>
    )
  }

  return (
    <div className="panel-body" style={{ padding: 0 }} onContextMenu={handlePanelContextMenu}>
      {rows.map((row, i) => {
        const { node, key: itemKey, hasChildren, collapsed } = row
        // 防止 null === null：无 actor 节点不参与高亮
        const isSelected = selected !== null && selected === node.actor
        // 眼睛图标/切换 = 自身 previewHidden；置灰 = 有效隐藏（含祖先链继承）
        const selfHidden = node.actor?.previewHidden ?? false
        const hidden = hiddenFlags[i]
        return (
          <div
            key={itemKey}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '2px 4px',
              paddingLeft: 8 + node.depth * 14,
              cursor: 'pointer',
              background: isSelected ? 'var(--accent)' : 'transparent',
              color: isSelected ? '#fff' : 'var(--text-primary)',
              whiteSpace: 'nowrap',
              opacity: hidden ? 0.55 : 1,
            }}
            onClick={() => {
              if (!node.actor) return
              // 运行中：仅选中（Inspector 查看组件），不聚焦摄像机
              select(isSelected ? null : node.actor)
            }}
            onMouseEnter={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
            onContextMenu={(e) => {
              if (!node.actor) return
              openMenu(e, node)
            }}
          >
            {filterQuery ? (
              <span style={{ display: 'inline-block', width: 16, flexShrink: 0 }} />
            ) : (
              <span
                onClick={(e) => { e.stopPropagation(); toggleCollapsed(itemKey) }}
                title={collapsed ? '展开' : '折叠'}
                style={{
                  display: 'inline-block', width: 16, flexShrink: 0, textAlign: 'center',
                  cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)', userSelect: 'none',
                }}
              >
                {hasChildren ? (collapsed ? '▶' : '▼') : ''}
              </span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
            {node.actor && (
              <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
                [{node.actor.constructor.name}]
              </span>
            )}
            {node.actor && (
              <TreeEye
                hidden={selfHidden}
                disabled={false}
                onToggle={() => toggleHidden(node.actor!)}
              />
            )}
          </div>
        )
      })}
      {menu && (
        <OutlineContextMenu
          x={menu.x}
          y={menu.y}
          targetLabel={menu.node?.name || 'UI 大纲'}
          hasTarget={!!menu.node}
          canModify={false}
          templates={[]}
          onClose={() => setMenu(null)}
          onCreate={() => {}}
          onDuplicate={() => {}}
          onCopyName={handleMenuCopyName}
          onCopyTree={handleCopyTree}
          onCopySubtree={handleCopySubtree}
          onRename={() => {}}
          onDelete={() => {}}
        />
      )}
    </div>
  )
}
