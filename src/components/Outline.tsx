import React, { useEffect, useMemo, useState } from 'react'
import {
  getSelectedActor, select, getSelectionKey, onSelectionChange,
  getSharedScene, getSceneTree, focusOn,
} from '../editor/SelectionManager'
import { useEditorStore } from '../stores/editorStore'
import { BlueprintPreviewManager } from '../editor/BlueprintPreviewManager'

/** 场景资产数据结构 */
interface SceneOutlineData {
  name: string
  mode?: string
  objects?: Array<Record<string, unknown>>
  skybox?: Record<string, unknown>
}

/** 场景对象树渲染组件（扁平列表风格） */
function SceneTreeView({ data }: { data: SceneOutlineData }) {
  const objects = (data.objects ?? []) as Array<Record<string, unknown>>

  /** 递归展开 objects 为带 depth 的扁平行 */
  function flatten(
    objs: Array<Record<string, unknown>>,
    startDepth: number,
  ): Array<{ obj: Record<string, unknown>; depth: number }> {
    const rows: Array<{ obj: Record<string, unknown>; depth: number }> = []
    for (const obj of objs) {
      rows.push({ obj, depth: startDepth })
      const children = obj.children as Array<Record<string, unknown>> | undefined
      if (children && children.length > 0) {
        rows.push(...flatten(children, startDepth + 1))
      }
    }
    return rows
  }

  const flatRows = flatten(objects, 0)

  return (
    <div style={{ fontSize: 11, fontFamily: 'monospace', padding: '8px 4px' }}>
      <div style={{ padding: '3px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>
        {data.name} <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 10 }}>[Scene]</span>
      </div>

      {flatRows.length === 0 ? (
        <div style={{ padding: '2px 4px 2px 16px', color: 'var(--text-dim)', fontSize: 10 }}>（空）</div>
      ) : (
        flatRows.map(({ obj, depth }, i) => {
          const type = (obj.type as string) ?? ''
          const name = (obj.name as string) ?? ''
          const label = name ? `${type} "${name}"` : (type || `Object #${i}`)
          return (
            <div
              key={i}
              style={{
                padding: '2px 4px',
                paddingLeft: 8 + depth * 14,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {label}
            </div>
          )
        })
      )}

      {data.skybox && (
        <div style={{ padding: '2px 4px 2px 8px', fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          🌄 Skybox
        </div>
      )}
    </div>
  )
}

export function Outline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelectedActor()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const [sceneData, setSceneData] = useState<SceneOutlineData | null>(null)
  const [sceneLoading, setSceneLoading] = useState(false)

  // 判断当前标签类型
  const isBlueprintTab = activeTabId.startsWith('bp:')
  const isScenePreviewTab = activeTabId.startsWith('sp:')
  const currentTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTabId),
    [dynamicTabs, activeTabId],
  )

  // 场景预览标签：读取场景 JSON 展示对象树
  useEffect(() => {
    if (!isScenePreviewTab || !currentTab?.assetPath) {
      setSceneData(null)
      setSceneLoading(false)
      return
    }
    const read = window.electronAPI?.readJsonFile
    if (!read) return
    let cancelled = false
    setSceneLoading(true)
    read(currentTab.assetPath).then((r) => {
      if (cancelled) return
      if (r.success && r.data) {
        setSceneData(r.data as SceneOutlineData)
      }
      setSceneLoading(false)
    })
    return () => { cancelled = true }
  }, [isScenePreviewTab, currentTab?.assetPath])

  // 订阅选中/场景变化
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // 从共享场景获取完整对象树（不管游戏是否启动）
  const tree = getSceneTree()

  // 蓝图树选中名称（优先 blueprintRef.id，其次 Actor.name）
  const selName = selected?.blueprintRef?.id ?? selected?.name ?? null

  // 过滤掉无意义的内置对象
  const visibleTree = tree.filter(n =>
    n.name !== '' && !n.name.startsWith('__')
  )

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {isScenePreviewTab ? (
        /* 场景预览标签：显示场景资产对象树 */
        sceneLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            场景加载中...
          </div>
        ) : sceneData ? (
          <SceneTreeView data={sceneData} />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            无场景数据
          </div>
        )
      ) : isBlueprintTab ? (
        (() => {
          const bpMgr = BlueprintPreviewManager.getActiveInstance()
          const hasLivePreview = bpMgr && bpMgr.currentBlueprintId != null
          const bpTree = hasLivePreview ? bpMgr!.getActorTree() : null

          if (bpTree && bpTree.length > 0) {
            return (
              <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                {bpTree.map((node, i) => {
                  const isSelected = selected === node.actor
                  return (
                    <div
                      key={node.actor ? node.actor.root.id : 'bp-node-' + i}
                      style={{
                        padding: '2px 4px',
                        paddingLeft: 8 + node.depth * 14,
                        cursor: 'pointer',
                        background: isSelected ? 'var(--accent)' : 'transparent',
                        color: isSelected ? '#fff' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      onClick={() => {
                        if (node.actor) {
                          if (isSelected) bpMgr!.selectActor(null)
                          else bpMgr!.focusActor(node.actor)
                        }
                      }}
                      onDoubleClick={() => node.actor && bpMgr!.focusActor(node.actor)}
                      onMouseEnter={(e) => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      {node.name}
                      {node.actor && (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
                          [{node.actor.constructor.name}]
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          }

          return (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>无预览数据</div>
          )
        })()
      ) : !getSharedScene() ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景初始化中...
        </div>
      ) : visibleTree.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
          场景中暂无对象
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {visibleTree.map((node, i) => {
            const isSelected = selected === node.actor
            const isBlueprint = !!node.actor?.blueprintRef
            return (
              <div
                key={node.actor ? node.actor.root.id : 'node-' + i}
                style={{
                  padding: '2px 4px',
                  paddingLeft: 8 + node.depth * 14,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onClick={() => select(isSelected ? null : node.actor)}
                onDoubleClick={() => node.actor && focusOn(node.actor.root)}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                {node.name}
                {isBlueprint && (
                  <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 10 }}>[BP]</span>
                )}
                {node.actor && (
                  <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
                    [{node.actor.constructor.name}]
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
