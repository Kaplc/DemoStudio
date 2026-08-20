import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getSelectedActor, select, getSelectionKey, onSelectionChange,
  getEditorScene, getSceneTree, focusOn,
} from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import { AssetPreviewManager } from '../editor/asset/AssetPreviewManager'
import { BlueprintPreviewManager } from '../editor/asset/BlueprintPreviewManager'
import { UIPreviewManager } from '../editor/asset/UIPreviewManager'
import { ScenePreviewManager } from '../editor/asset/ScenePreviewManager'
import { NODE3D_TEMPLATES, UI_TEMPLATES, cloneTemplateComponents } from '../editor/blueprintEdit/nodeTemplates'
import type { NodeTemplate } from '../editor/blueprintEdit/nodeTemplates'
import { OutlineContextMenu } from './OutlineContextMenu'
import { logger } from '../engine'
import type { SceneTreeNode } from '../editor/SelectionManager'
import type { Actor } from '../engine'

/** 折叠过滤后的行：节点 + 折叠 key + 是否有子节点 + 是否折叠 */
interface OutlineRow {
  node: SceneTreeNode
  /** 折叠 key（kind 前缀 + actor root id），避免不同树/页签互相干扰 */
  key: string
  hasChildren: boolean
  collapsed: boolean
}

/**
 * 应用折叠过滤：跳过被折叠节点的所有后辈，并标注每行的箭头状态。
 * collapsedKeys 为空 → 全部展开（默认）。
 */
function applyCollapse(tree: SceneTreeNode[], collapsedKeys: Set<string>, kind: string): OutlineRow[] {
  const rows: OutlineRow[] = []
  // 折叠祖先的 depth 栈（用于跳过其子树）
  const foldStack: number[] = []
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    // 离开折叠祖先的子树时弹出（当前 depth <= 祖先 depth）
    while (foldStack.length && foldStack[foldStack.length - 1] >= node.depth) foldStack.pop()
    if (foldStack.length) continue
    const key = node.actor ? `${kind}:${node.actor.root.id}` : `${kind}-node-${i}`
    const hasChildren = i + 1 < tree.length && tree[i + 1].depth > node.depth
    const collapsed = hasChildren && collapsedKeys.has(key)
    rows.push({ node, key, hasChildren, collapsed })
    if (collapsed) foldStack.push(node.depth)
  }
  return rows
}

/** 折叠箭头：有子节点显示可点击箭头（▼ 展开态点击折叠 / ▶ 折叠态点击展开），无子节点显示占位对齐 */
function TreeArrow({
  hasChildren, collapsed, itemKey, onToggle,
}: {
  hasChildren: boolean
  collapsed: boolean
  itemKey: string
  onToggle: (key: string) => void
}) {
  if (!hasChildren) {
    return <span style={{ display: 'inline-block', width: 16, flexShrink: 0 }} />
  }
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onToggle(itemKey) }}
      // 快速连点箭头不触发行的双击聚焦
      onDoubleClick={(e) => e.stopPropagation()}
      title={collapsed ? '展开' : '折叠'}
      style={{
        display: 'inline-block', width: 16, flexShrink: 0, textAlign: 'center',
        cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)', userSelect: 'none',
      }}
    >
      {collapsed ? '▶' : '▼'}
    </span>
  )
}

/**
 * 眼睛按钮：仅预览表现——点击后节点及其子节点不再渲染（root.visible=false），
 * 但资产/场景本身不变，游戏运行时仍会正常渲染生成。
 */
function TreeEye({
  hidden, disabled, onToggle,
}: {
  hidden: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <span
      onClick={(e) => { e.stopPropagation(); if (!disabled) onToggle() }}
      // 快速连点眼睛不触发行的双击聚焦
      onDoubleClick={(e) => e.stopPropagation()}
      title={disabled ? '游戏运行中不可隐藏' : hidden ? '显示节点（预览）' : '隐藏节点（仅预览）'}
      style={{
        display: 'inline-block', flexShrink: 0, marginLeft: 'auto',
        padding: '0 2px', fontSize: 11, lineHeight: 1, userSelect: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.25 : hidden ? 0.5 : 0.7,
      }}
    >
      {hidden ? '🙈' : '👁'}
    </span>
  )
}

/** Actor 树节点渲染项（蓝图 / 场景预览共用） */
function renderActorTreeNodes(
  tree: SceneTreeNode[],
  selected: Actor | null,
  assetPath: string | null,
  kind: 'blueprint' | 'scenePreview',
  collapsedKeys: Set<string>,
  onToggle: (key: string) => void,
  hiddenKeys: Set<number>,
  onToggleHidden: (actor: Actor, hidden: boolean) => void,
  onContextMenu?: (e: React.MouseEvent, node: SceneTreeNode) => void,
): React.ReactElement[] {
  return applyCollapse(tree, collapsedKeys, kind).map((row, i) => {
    const { node, key: itemKey, hasChildren, collapsed } = row
    // 防止 null === null：selected 为 null（无选中）时，无 actor 节点（DirectionalLight/Group 等）不能高亮
    const isSelected = selected !== null && selected === node.actor
    const hidden = node.actor ? hiddenKeys.has(node.actor.root.id) : false
    const key = node.actor ? node.actor.root.id : `${kind}-node-${i}`
    return (
      <div
        key={key}
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
          if (!node.actor || !assetPath) return
          if (kind === 'blueprint') {
            const mgr = AssetPreviewManager.get<import('../editor/asset/BlueprintPreviewManager').BlueprintPreviewManager | import('../editor/asset/UIPreviewManager').UIPreviewManager>(assetPath)
            // 单击：仅选中（显示 gizmos + 包围盒），不聚焦摄像机
            if (isSelected) mgr?.selectActor(null)
            else mgr?.selectActor(node.actor)
          } else {
            const mgr = AssetPreviewManager.get<import('../editor/asset/ScenePreviewManager').ScenePreviewManager>(assetPath)
            // 单击：仅选中，不聚焦摄像机
            if (isSelected) mgr?.selectActor(null)
            else mgr?.selectActor(node.actor)
          }
        }}
        onDoubleClick={() => {
          if (!node.actor || !assetPath) return
          // 双击：聚焦摄像机到节点
          if (kind === 'blueprint') {
            AssetPreviewManager.get<import('../editor/asset/BlueprintPreviewManager').BlueprintPreviewManager | import('../editor/asset/UIPreviewManager').UIPreviewManager>(assetPath)?.focusActor(node.actor)
          } else {
            AssetPreviewManager.get<import('../editor/asset/ScenePreviewManager').ScenePreviewManager>(assetPath)?.focusActor(node.actor)
          }
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
        onContextMenu={(e) => {
          if (!node.actor || !assetPath) return
          e.preventDefault()
          e.stopPropagation()
          onContextMenu?.(e, node)
        }}
      >
        <TreeArrow hasChildren={hasChildren} collapsed={collapsed} itemKey={itemKey} onToggle={onToggle} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        {node.actor && (
          <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
            [{node.actor.constructor.name}]
          </span>
        )}
        {node.actor && (
          <TreeEye
            hidden={hidden}
            disabled={false}
            onToggle={() => onToggleHidden(node.actor!, !hidden)}
          />
        )}
      </div>
    )
  })
}

export function Outline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  /** 折叠的节点 key 集合（空 = 全部展开，默认） */
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())
  /** 切换节点折叠状态 */
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const selected = getSelectedActor()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)
  /** 游戏运行中禁用眼睛隐藏（运行时的场景归游戏 World 所有，隐藏会干扰运行表现） */
  const gameRunning = useEditorStore((s) => s.gameState.running)
  /** 大纲眼睛隐藏的节点（actor root id）。仅预览不渲染，资产与游戏运行不受影响 */
  const [hiddenKeys, setHiddenKeys] = useState<Set<number>>(new Set())
  const toggleHidden = useCallback((actor: Actor, hidden: boolean) => {
    const id = actor.root.id
    // 走 Actor 提供的临时隐藏入口：不动 active/资产，只改预览显隐；
    // 与 CanvasUIComponent.active / Actor.bActive 解耦，切换 active 时仍保持大纲预览意图
    actor.setPreviewHidden(hidden)
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (hidden) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const isBlueprintTab = activeTabId.startsWith('bp:')
  const isScenePreviewTab = activeTabId.startsWith('sp:')
  const currentTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTabId),
    [dynamicTabs, activeTabId],
  )

  // ─── 右键菜单（bp: 蓝图/widget 预览、sp: 场景预览、scene: 游戏场景大纲） ───
  interface OutlineMenuState {
    x: number
    y: number
    node: SceneTreeNode
    kind: 'blueprint' | 'scenePreview' | 'scene'
  }
  const [menu, setMenu] = useState<OutlineMenuState | null>(null)
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: SceneTreeNode, kind: 'blueprint' | 'scenePreview' | 'scene') => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node, kind })
  }, [])

  // 订阅选中/场景变化
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // ─── 缓存：场景树数据（Scene/Game 页签） ───
  const tree = useMemo(() => {
    if (isBlueprintTab || isScenePreviewTab) return []
    return getSceneTree()
  }, [selectionKey, isBlueprintTab, isScenePreviewTab])

  const visibleTree = useMemo(
    () => tree.filter(n => n.name !== '' && !n.name.startsWith('__')),
    [tree],
  )

  // ─── 缓存：蓝图树数据 ───
  const bpAssetPath = isBlueprintTab ? currentTab?.assetPath : null
  const bpTree = useMemo(() => {
    if (!bpAssetPath) return null
    const bpMgr = AssetPreviewManager.get<import('../editor/asset/BlueprintPreviewManager').BlueprintPreviewManager | import('../editor/asset/UIPreviewManager').UIPreviewManager>(bpAssetPath)
    if (!bpMgr || bpMgr.currentBlueprintId == null) return null
    return bpMgr.getActorTree()
  }, [bpAssetPath, selectionKey, blueprintEditNonce])

  // ─── 缓存：场景预览树数据 ───
  const spAssetPath = isScenePreviewTab ? currentTab?.assetPath : null
  const spTree = useMemo(() => {
    // if (!spAssetPath) { logger.debug(`[OutlinerTrace] spTree: spAssetPath=null`); return null }
    if (!spAssetPath) return null
    const spMgr = AssetPreviewManager.get<import('../editor/asset/ScenePreviewManager').ScenePreviewManager>(spAssetPath)
    // if (!spMgr) { logger.debug(`[OutlinerTrace] spTree: spMgr=null for ${spAssetPath}`); return null }
    if (!spMgr) return null
    // if (spMgr.currentScenePath == null) { logger.debug(`[OutlinerTrace] spTree: currentScenePath=null, actorCount=${spMgr.world.actorCount}`); return null }
    if (spMgr.currentScenePath == null) return null
    const tree = spMgr.getActorTree()
    // logger.debug(`[OutlinerTrace] spTree: ${tree.length} 个节点, currentScenePath=${spMgr.currentScenePath}`)
    return tree
  }, [spAssetPath, selectionKey, blueprintEditNonce])

  // ─── 缓存：蓝图树渲染元素 ───
  const bpTreeElements = useMemo(() => {
    if (!bpTree || bpTree.length === 0) return null
    return renderActorTreeNodes(bpTree, selected, bpAssetPath ?? null, 'blueprint', collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, (e, node) => handleNodeContextMenu(e, node, 'blueprint'))
  }, [bpTree, selected, bpAssetPath, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, handleNodeContextMenu])

  // ─── 缓存：场景预览树渲染元素 ───
  const spTreeElements = useMemo(() => {
    if (!spTree || spTree.length === 0) return null
    return renderActorTreeNodes(spTree, selected, spAssetPath ?? null, 'scenePreview', collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, (e, node) => handleNodeContextMenu(e, node, 'scenePreview'))
  }, [spTree, selected, spAssetPath, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, handleNodeContextMenu])

  // ─── 缓存：Scene 树渲染元素 ───
  const sceneTreeElements = useMemo(() => {
    if (visibleTree.length === 0) return null
    return applyCollapse(visibleTree, collapsedKeys, 'scene').map((row, i) => {      const { node, key: itemKey, hasChildren, collapsed } = row
      // 防止 null === null：selected 为 null（无选中）时，无 actor 节点不能高亮
      const isSelected = selected !== null && selected === node.actor
      const hidden = node.actor ? hiddenKeys.has(node.actor.root.id) : false
      const isBlueprint = !!node.actor?.blueprintRef
      return (
        <div
          key={node.actor ? node.actor.root.id : 'node-' + i}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '2px 4px',
            paddingLeft: 8 + node.depth * 14,
            cursor: 'pointer',
            background: isSelected ? 'var(--accent)' : 'transparent',
            color: isSelected ? '#fff' : 'var(--text-primary)',
            whiteSpace: 'nowrap',            opacity: hidden ? 0.55 : 1,          }}
          onClick={() => select(isSelected ? null : node.actor)}
          onDoubleClick={() => {
            if (!node.actor) return
            // 双击：先保持选中再聚焦。双击会先触发两次 click（第二次把选中取消掉），
            // 因此这里必须重新 select，否则聚焦完成后节点处于未选中状态
            select(node.actor)
            focusOn(node.actor.root)
          }}
          onMouseEnter={(e) => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
          onContextMenu={(e) => {
            if (!node.actor) return
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, node, kind: 'scene' })
          }}
        >
          <TreeArrow hasChildren={hasChildren} collapsed={collapsed} itemKey={itemKey} onToggle={toggleCollapsed} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
          {isBlueprint && (
            <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>[BP]</span>
          )}
          {node.actor && (
            <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
              [{node.actor.constructor.name}]
            </span>
          )}
          {node.actor && (
            <TreeEye
              hidden={hidden}
              disabled={gameRunning}
              onToggle={() => toggleHidden(node.actor!, !hidden)}
            />
          )}
        </div>
      )
    })
  }, [visibleTree, selected, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, gameRunning])

  // ─── 右键菜单数据与操作 ───
  /** 当前菜单的模板组（按预览管理器类型判定：widget → UI 组；3D 蓝图/场景 → 3D 组） */
  const menuTemplates = useMemo<NodeTemplate[]>(() => {
    if (!menu) return []
    const assetPath = menu.kind === 'blueprint' ? bpAssetPath : spAssetPath
    if (!assetPath) return []
    const mgr = AssetPreviewManager.get<BlueprintPreviewManager | UIPreviewManager | ScenePreviewManager>(assetPath)
    if (mgr instanceof UIPreviewManager) return UI_TEMPLATES
    return NODE3D_TEMPLATES
  }, [menu, bpAssetPath, spAssetPath])

  /** 菜单目标是否根节点（根节点只允许创建；复制/重命名/删除禁用） */
  const menuIsRoot = menu ? menu.node.actor?.parent == null : false
  /** 菜单目标是否对应资产 JSON 节点（代码生成的子节点无法做资产级结构编辑） */
  const menuTargetInJson = useMemo(() => {
    if (!menu || menu.node.actor == null || menu.node.actor.parent == null) return false
    const assetPath = menu.kind === 'blueprint' ? bpAssetPath : spAssetPath
    if (!assetPath) return false
    const mgr = AssetPreviewManager.get<BlueprintPreviewManager | UIPreviewManager | ScenePreviewManager>(assetPath)
    return !!mgr && mgr.hasJsonNode(menu.node.actor)
  }, [menu, bpAssetPath, spAssetPath])
  /** 修改类操作（复制/重命名/删除）可用性 */
  const menuCanModify = !menuIsRoot && menuTargetInJson

  /** 菜单目标资产路径（当前激活页签，scene 类型无资产路径） */
  const menuAssetPath = menu ? (menu.kind === 'blueprint' ? bpAssetPath : spAssetPath) : null

  /** 菜单是否需要显示（bp/sp 类型需要资产路径，scene 类型不需要） */
  const menuShouldShow = menu && (menu.kind === 'scene' || !!menuAssetPath)

  // ─── bp: / widget 操作（走预览管理器 Actor 引用方法：直接按选中节点引用定位 JSON 节点，
  //          同名不拦截；复用快照撤销 + bump 重建预览） ───
  const getBpMgr = useCallback(() => {
    if (!bpAssetPath) return null
    return AssetPreviewManager.get<BlueprintPreviewManager | UIPreviewManager>(bpAssetPath)
  }, [bpAssetPath])

  const handleBpCreate = async (tpl: NodeTemplate) => {
    if (!menu) return
    const mgr = getBpMgr()
    if (!mgr) {
      logger.warn(`[Outline] 创建节点失败: 蓝图预览管理器不可用（${bpAssetPath}）`)
      setMenu(null)
      return
    }
    // 父节点 = 被右键节点的 Actor 引用（根/代码生成节点由 mgr 内部退化为根追加）
    const parentActor = menu.node.actor?.parent ? menu.node.actor : null
    const newName = await mgr.addChildNode(parentActor, {
      baseName: tpl.baseName,
      baseClass: tpl.baseClass,
      components: cloneTemplateComponents(tpl),
      // 模板子节点（如按钮的 Frame 视觉背景）随创建一并写入
      children: tpl.children ? JSON.parse(JSON.stringify(tpl.children)) : undefined,
    })
    if (newName) logger.info(`[Outline] 创建节点: ${bpAssetPath} → ${parentActor ? menu.node.name : '(根)'}/${newName}（${tpl.label}）`)
    else logger.warn(`[Outline] 创建节点失败: ${bpAssetPath}（${tpl.label}）`)
    setMenu(null)
  }

  const handleBpDuplicate = async () => {
    if (!menu || !menu.node.actor) return
    const mgr = getBpMgr()
    if (!mgr) {
      logger.warn(`[Outline] 复制节点失败: 蓝图预览管理器不可用（${bpAssetPath}）`)
      setMenu(null)
      return
    }
    const newName = await mgr.duplicateChildNode(menu.node.actor)
    if (!newName) logger.warn(`[Outline] 复制节点失败: ${menu.node.name}（无 JSON 映射或父数组缺失）`)
    setMenu(null)
  }

  const handleBpRename = async (newName: string) => {
    if (!menu || !menu.node.actor) return
    const mgr = getBpMgr()
    if (!mgr) {
      logger.warn(`[Outline] 重命名失败: 蓝图预览管理器不可用（${bpAssetPath}）`)
      setMenu(null)
      return
    }
    const ok = await mgr.renameChildNode(menu.node.actor, newName)
    if (!ok) logger.warn(`[Outline] 重命名失败: ${menu.node.name}`)
    setMenu(null)
  }

  const handleBpDelete = async () => {
    if (!menu || !menu.node.actor) return
    const mgr = getBpMgr()
    if (!mgr) {
      logger.warn(`[Outline] 删除节点失败: 蓝图预览管理器不可用（${bpAssetPath}）`)
      setMenu(null)
      return
    }
    const ok = await mgr.removeChildNode(menu.node.actor)
    if (!ok) logger.warn(`[Outline] 删除节点失败: ${menu.node.name}`)
    setMenu(null)
  }

  // ─── sp: 操作（ScenePreviewManager 结构编辑方法，自带撤销 + 预览重建） ───
  const getSpMgr = () => (menu ? AssetPreviewManager.get<ScenePreviewManager>(spAssetPath ?? '') : null)

  const handleSpCreate = (tpl: NodeTemplate) => {
    if (!menu) return
    const mgr = getSpMgr()
    if (!mgr) {
      logger.warn(`[Outline] 创建节点失败: 场景预览管理器不可用（${spAssetPath}）`)
      setMenu(null)
      return
    }
    const newName = mgr.addSceneObject(menu.node.actor, tpl)
    if (newName) logger.info(`[Outline] 创建场景对象: ${spAssetPath} → ${newName}（${tpl.label}）`)
    else logger.warn(`[Outline] 创建场景对象失败: ${spAssetPath}（${tpl.label}）`)
    setMenu(null)
  }

  const handleSpDuplicate = () => {
    if (!menu) return
    const mgr = getSpMgr()
    const newName = mgr?.duplicateSceneObject(menu.node.actor!)
    if (!newName) logger.warn(`[Outline] 复制场景对象失败: ${menu.node.name}`)
    setMenu(null)
  }

  const handleSpRename = (newName: string) => {
    if (!menu) return
    const mgr = getSpMgr()
    const ok = mgr?.renameSceneObject(menu.node.actor!, newName)
    if (!ok) logger.warn(`[Outline] 重命名场景对象失败: ${menu.node.name}`)
    setMenu(null)
  }

  const handleSpDelete = () => {
    if (!menu) return
    const mgr = getSpMgr()
    const ok = mgr?.removeSceneObject(menu.node.actor!)
    if (!ok) logger.warn(`[Outline] 删除场景对象失败: ${menu.node.name}`)
    setMenu(null)
  }

  // ─── 菜单操作分发（按当前页签类型） ───
  const handleMenuCreate = (tpl: NodeTemplate) => {
    if (menu?.kind === 'scenePreview') handleSpCreate(tpl)
    else void handleBpCreate(tpl)
  }
  const handleMenuDuplicate = () => {
    if (menu?.kind === 'scenePreview') handleSpDuplicate()
    else void handleBpDuplicate()
  }
  const handleMenuRename = (newName: string) => {
    if (menu?.kind === 'scenePreview') handleSpRename(newName)
    else void handleBpRename(newName)
  }
  const handleMenuDelete = () => {
    if (menu?.kind === 'scenePreview') handleSpDelete()
    else void handleBpDelete()
  }
  const handleMenuCopyName = () => {
    if (!menu) return
    const name = menu.node.name
    navigator.clipboard.writeText(name).catch(() => {
      logger.warn(`[Outline] 复制名称到剪贴板失败: ${name}`)
    })
  }

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {isScenePreviewTab ? (
        spTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>无预览数据</div>
        )
      ) : isBlueprintTab ? (
        bpTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>无预览数据</div>
        )
      ) : !getEditorScene() ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景初始化中...
        </div>
      ) : sceneTreeElements ?? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景中暂无对象
        </div>
      )}
      {menuShouldShow && (
        <OutlineContextMenu
          x={menu.x}
          y={menu.y}
          targetLabel={menu.node.name}
          canModify={menuCanModify}
          templates={menuTemplates}
          onClose={() => setMenu(null)}
          onCreate={handleMenuCreate}
          onDuplicate={handleMenuDuplicate}
          onCopyName={handleMenuCopyName}
          onRename={handleMenuRename}
          onDelete={handleMenuDelete}
        />
      )}
    </div>
  )
}
