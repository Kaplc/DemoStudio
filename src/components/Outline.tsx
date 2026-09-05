import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  actorTypeLabel,
  applyCollapse,
  buildNodeSubtreeText,
  buildTreeText,
  collectKeysWithChildren,
  computeEffectiveHidden,
  computeStableKeys,
  filterOutlineTree,
  useDefaultCollapsed,
} from './outlineCore'
import { logger } from '../engine'
import type { SceneTreeNode } from '../editor/SelectionManager'
import type { Actor } from '../engine'

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
export function TreeEye({
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
  hiddenKeys: Set<string>,
  onToggleHidden: (stableKey: string, actor: Actor, hidden: boolean) => void,
  onContextMenu?: (e: React.MouseEvent, node: SceneTreeNode) => void,
  filterQuery = '',
): React.ReactElement[] {
  // 每行稳定 key（kind + 父链路径 + 节点名）：跨预览重建保持折叠/展开/眼睛状态
  const stableKeys = computeStableKeys(tree, kind)
  // 搜索模式：过滤命中节点 + 祖先链，忽略折叠（全展开）
  const rows = filterQuery
    ? filterOutlineTree(tree, filterQuery).map((r) => ({
        node: r.node,
        key: stableKeys[r.index],
        hasChildren: r.hasChildren,
        collapsed: false,
      }))
    : applyCollapse(tree, collapsedKeys, kind)
  // 行置灰 = 有效隐藏（自身或任一祖先被眼睛隐藏，子树继承视口表现）
  const hiddenFlags = computeEffectiveHidden(rows, hiddenKeys)
  return rows.map((row, i) => {
    const { node, key: itemKey, hasChildren, collapsed } = row
    // 防止 null === null：selected 为 null（无选中）时，无 actor 节点（DirectionalLight/Group 等）不能高亮
    const isSelected = selected !== null && selected === node.actor
    // 眼睛图标/切换 = 自身 previewHidden；置灰 = 有效隐藏（含祖先链继承）
    const selfHidden = node.actor ? hiddenKeys.has(itemKey) : false
    const hidden = hiddenFlags[i]
    const typeLabel = actorTypeLabel(node.actor)
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
        {filterQuery ? (
          <span style={{ display: 'inline-block', width: 16, flexShrink: 0 }} />
        ) : (
          <TreeArrow hasChildren={hasChildren} collapsed={collapsed} itemKey={itemKey} onToggle={onToggle} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        {typeLabel && (
          <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
            [{typeLabel}]
          </span>
        )}
        {node.actor && (
          <TreeEye
            hidden={selfHidden}
            disabled={false}
            onToggle={() => onToggleHidden(itemKey, node.actor!, !selfHidden)}
          />
        )}
      </div>
    )
  })
}

export function Outline({ query = '' }: { query?: string }) {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  /** 模糊搜索词（空 = 不过滤；命中节点 + 祖先链显示，全展开） */
  const filterQuery = query.trim().toLowerCase()
  const selected = getSelectedActor()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)
  /** 游戏运行中禁用眼睛隐藏（运行时的场景归游戏 World 所有，隐藏会干扰运行表现） */
  const gameRunning = useEditorStore((s) => s.gameState.running)
  /** 大纲眼睛隐藏的节点（稳定 key：kind + 父链路径 + 节点名）。仅预览不渲染，资产与游戏运行不受影响 */
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
  const toggleHidden = useCallback((stableKey: string, actor: Actor, hidden: boolean) => {
    // 走 Actor 提供的临时隐藏入口：不动 active/资产，只改预览显隐；
    // 与 CanvasUIComponent.active / Actor.bActive 解耦，切换 active 时仍保持大纲预览意图。
    // 隐藏状态按稳定 key 记录，预览重建（新 Actor 实例）后按名重放，不再随 root.id 丢失。
    actor.setPreviewHidden(hidden)
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (hidden) next.add(stableKey)
      else next.delete(stableKey)
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
    /** 右键目标节点；右键面板空白处为 null（只提供复制大纲树） */
    node: SceneTreeNode | null
    kind: 'blueprint' | 'scenePreview' | 'scene'
  }
  const [menu, setMenu] = useState<OutlineMenuState | null>(null)
  const openMenu = useCallback((e: React.MouseEvent, node: SceneTreeNode | null, kind: 'blueprint' | 'scenePreview' | 'scene') => {
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

  // ─── 默认折叠：首次出现的有子节点 key 自动折叠（手动展开过的不重置） ───
  const allParentKeys = useMemo(
    () => [
      ...collectKeysWithChildren(visibleTree, 'scene'),
      ...collectKeysWithChildren(bpTree ?? [], 'blueprint'),
      ...collectKeysWithChildren(spTree ?? [], 'scenePreview'),
    ],
    [visibleTree, bpTree, spTree],
  )
  const [collapsedKeys, toggleCollapsed] = useDefaultCollapsed(allParentKeys)

  // ─── 缓存：蓝图树渲染元素 ───
  const bpTreeElements = useMemo(() => {
    if (!bpTree || bpTree.length === 0) return null
    const els = renderActorTreeNodes(bpTree, selected, bpAssetPath ?? null, 'blueprint', collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, (e, node) => openMenu(e, node, 'blueprint'), filterQuery)
    // 搜索无匹配 → 空数组置 null，让外层渲染"无匹配"文案
    return els.length > 0 ? els : null
  }, [bpTree, selected, bpAssetPath, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, openMenu, filterQuery])

  // ─── 缓存：场景预览树渲染元素 ───
  const spTreeElements = useMemo(() => {
    if (!spTree || spTree.length === 0) return null
    const els = renderActorTreeNodes(spTree, selected, spAssetPath ?? null, 'scenePreview', collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, (e, node) => openMenu(e, node, 'scenePreview'), filterQuery)
    return els.length > 0 ? els : null
  }, [spTree, selected, spAssetPath, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, openMenu, filterQuery])

  // ─── 缓存：Scene 树渲染元素 ───
  const sceneTreeElements = useMemo(() => {
    // 每行稳定 key（kind + 父链路径 + 节点名）：跨重建保持折叠/展开/眼睛状态
    const stableKeys = computeStableKeys(visibleTree, 'scene')
    // 搜索模式：过滤命中节点 + 祖先链，忽略折叠（全展开）
    const rows = filterQuery
      ? filterOutlineTree(visibleTree, filterQuery).map((r) => ({
          node: r.node,
          key: stableKeys[r.index],
          hasChildren: r.hasChildren,
          collapsed: false,
        }))
      : applyCollapse(visibleTree, collapsedKeys, 'scene')
    if (rows.length === 0) return null
    // 行置灰 = 有效隐藏（自身或任一祖先被眼睛隐藏，子树继承视口表现）
    const hiddenFlags = computeEffectiveHidden(rows, hiddenKeys)
    return rows.map((row, i) => {
      const { node, key: itemKey, hasChildren, collapsed } = row
      // 防止 null === null：selected 为 null（无选中）时，无 actor 节点不能高亮
      const isSelected = selected !== null && selected === node.actor
      // 眼睛图标/切换 = 自身 previewHidden；置灰 = 有效隐藏（含祖先链继承）
      const selfHidden = node.actor ? hiddenKeys.has(itemKey) : false
      const hidden = hiddenFlags[i]
      const isBlueprint = !!node.actor?.blueprintRef
      const typeLabel = actorTypeLabel(node.actor)
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
            openMenu(e, node, 'scene')
          }}
        >
          {filterQuery ? (
            <span style={{ display: 'inline-block', width: 16, flexShrink: 0 }} />
          ) : (
            <TreeArrow hasChildren={hasChildren} collapsed={collapsed} itemKey={itemKey} onToggle={toggleCollapsed} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
          {isBlueprint && (
            <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>[BP]</span>
          )}
          {typeLabel && (
            <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10, flexShrink: 0 }}>
              [{typeLabel}]
            </span>
          )}
          {node.actor && (
            <TreeEye
              hidden={selfHidden}
              disabled={gameRunning}
              onToggle={() => toggleHidden(itemKey, node.actor!, !selfHidden)}
            />
          )}
        </div>
      )
    })
  }, [visibleTree, selected, collapsedKeys, toggleCollapsed, hiddenKeys, toggleHidden, gameRunning, filterQuery])

  // ─── 右键菜单数据与操作 ───
  /** 当前菜单的模板组（按预览管理器类型判定：widget → UI 组；3D 蓝图/场景 → 3D 组） */
  const menuTemplates = useMemo<NodeTemplate[]>(() => {
    if (!menu || !menu.node) return []
    const assetPath = menu.kind === 'blueprint' ? bpAssetPath : spAssetPath
    if (!assetPath) return []
    const mgr = AssetPreviewManager.get<BlueprintPreviewManager | UIPreviewManager | ScenePreviewManager>(assetPath)
    if (mgr instanceof UIPreviewManager) return UI_TEMPLATES
    return NODE3D_TEMPLATES
  }, [menu, bpAssetPath, spAssetPath])

  /** 菜单目标是否根节点（根节点只允许创建；复制/重命名/删除禁用） */
  const menuIsRoot = menu && menu.node ? menu.node.actor?.parent == null : false
  /** 菜单目标是否对应资产 JSON 节点（代码生成的子节点无法做资产级结构编辑） */
  const menuTargetInJson = useMemo(() => {
    if (!menu || menu.node == null || menu.node.actor == null || menu.node.actor.parent == null) return false
    const assetPath = menu.kind === 'blueprint' ? bpAssetPath : spAssetPath
    if (!assetPath) return false
    const mgr = AssetPreviewManager.get<BlueprintPreviewManager | UIPreviewManager | ScenePreviewManager>(assetPath)
    return !!mgr && mgr.hasJsonNode(menu.node.actor)
  }, [menu, bpAssetPath, spAssetPath])
  /** 修改类操作（复制/重命名/删除）可用性 */
  const menuCanModify = menuIsRoot !== null && !menuIsRoot && menuTargetInJson
  /** widget 资产：人工只改属性值（重命名），创建/复制/删除等结构改动走 AI 改 HTML 源 */
  const menuIsWidget = menu?.kind === 'blueprint' && !!bpAssetPath && bpAssetPath.endsWith('.widget.json')

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
    if (bpAssetPath?.endsWith('.widget.json')) {
      logger.warn('[Outline] widget 资产不支持人工加节点：请让 AI 修改 .widget.html 源后重新编译')
      setMenu(null)
      return
    }
    if (!menu || !menu.node) return
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
    if (bpAssetPath?.endsWith('.widget.json')) {
      logger.warn('[Outline] widget 资产不支持人工复制节点：请让 AI 修改 .widget.html 源后重新编译')
      setMenu(null)
      return
    }
    if (!menu || !menu.node || !menu.node.actor) return
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
    if (!menu || !menu.node || !menu.node.actor) return
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
    if (bpAssetPath?.endsWith('.widget.json')) {
      logger.warn('[Outline] widget 资产不支持人工删除节点：请让 AI 修改 .widget.html 源后重新编译')
      setMenu(null)
      return
    }
    if (!menu || !menu.node || !menu.node.actor) return
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
    if (!menu || !menu.node) return
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
    if (!menu || !menu.node) return
    const mgr = getSpMgr()
    const newName = mgr?.duplicateSceneObject(menu.node.actor!)
    if (!newName) logger.warn(`[Outline] 复制场景对象失败: ${menu.node.name}`)
    setMenu(null)
  }

  const handleSpRename = (newName: string) => {
    if (!menu || !menu.node) return
    const mgr = getSpMgr()
    const ok = mgr?.renameSceneObject(menu.node.actor!, newName)
    if (!ok) logger.warn(`[Outline] 重命名场景对象失败: ${menu.node.name}`)
    setMenu(null)
  }

  const handleSpDelete = () => {
    if (!menu || !menu.node) return
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
    if (!menu || !menu.node) return
    const name = menu.node.name
    navigator.clipboard.writeText(name).catch(() => {
      logger.warn(`[Outline] 复制名称到剪贴板失败: ${name}`)
    })
  }

  /** 当前菜单对应的树数据源（与页签渲染用的树一致，保证复制内容与所见相同） */
  const menuTree = useMemo<import('../editor/SelectionManager').SceneTreeNode[] | null>(() => {
    if (!menu) return null
    if (menu.kind === 'blueprint') return bpTree
    if (menu.kind === 'scenePreview') return spTree
    return visibleTree
  }, [menu, bpTree, spTree, visibleTree])

  /** 复制大纲树（整树文本）到剪贴板 */
  const handleCopyTree = () => {
    if (!menu) return
    const text = buildTreeText(menuTree ?? [])
    if (!text) {
      logger.warn('[Outline] 复制大纲树失败: 当前树为空')
      setMenu(null)
      return
    }
    navigator.clipboard.writeText(text).catch(() => {
      logger.warn('[Outline] 复制大纲树到剪贴板失败')
    })
    setMenu(null)
  }

  /** 复制当前节点及其全部子节点（子树文本，目标重缩进为顶层）到剪贴板 */
  const handleCopySubtree = () => {
    if (!menu || !menu.node) return
    const name = menu.node.name
    const text = menuTree ? buildNodeSubtreeText(menuTree, name) : null
    if (text == null) {
      logger.warn(`[Outline] 复制节点子树失败: 未在当前树中找到节点 ${name}`)
      setMenu(null)
      return
    }
    navigator.clipboard.writeText(text).catch(() => {
      logger.warn(`[Outline] 复制节点子树到剪贴板失败: ${name}`)
    })
    setMenu(null)
  }

  /** 右键面板空白处：无目标节点，仅提供「复制大纲树」（整树文本） */
  const handlePanelContextMenu = useCallback((e: React.MouseEvent) => {
    const kind = isScenePreviewTab ? 'scenePreview' : isBlueprintTab ? 'blueprint' : 'scene'
    openMenu(e, null, kind)
  }, [isScenePreviewTab, isBlueprintTab, openMenu])

  return (
    <div className="panel-body" style={{ padding: 0 }} onContextMenu={handlePanelContextMenu}>
      {isScenePreviewTab ? (
        spTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>{filterQuery ? '无匹配节点' : '无预览数据'}</div>
        )
      ) : isBlueprintTab ? (
        bpTreeElements ?? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>{filterQuery ? '无匹配节点' : '无预览数据'}</div>
        )
      ) : !getEditorScene() ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景初始化中...
        </div>
      ) : sceneTreeElements ?? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          {filterQuery ? '无匹配节点' : '场景中暂无对象'}
        </div>
      )}
      {menuShouldShow && menu && (
        <OutlineContextMenu
          x={menu.x}
          y={menu.y}
          targetLabel={menu.node?.name || '大纲'}
          hasTarget={!!menu.node}
          canModify={menuCanModify}
          allowStructure={!menuIsWidget}
          templates={menuTemplates}
          onClose={() => setMenu(null)}
          onCreate={handleMenuCreate}
          onDuplicate={handleMenuDuplicate}
          onCopyName={handleMenuCopyName}
          onCopyTree={handleCopyTree}
          onCopySubtree={handleCopySubtree}
          onRename={handleMenuRename}
          onDelete={handleMenuDelete}
        />
      )}
    </div>
  )
}
