import React, { useEffect, useState } from 'react'
import {
  getSelectedActor, selectActor, select, getSelectionKey, onSelectionChange,
  setSharedScene, getSharedScene, getSceneTree, focusOn,
} from '../editor/SelectionManager'
import type { SceneTreeNode } from '../editor/SelectionManager'

export function Outline() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const selected = getSelectedActor()

  // 订阅选中/场景变化
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
    })
    return unsub
  }, [])

  // 从共享场景获取完整对象树（不管游戏是否启动）
  const tree = getSceneTree()

  // 过滤掉无意义的内置对象
  const visibleTree = tree.filter(n =>
    n.name !== '' && !n.name.startsWith('__')
  )

  return (
    <div className="panel-body" style={{ padding: 0 }}>
      {!getSharedScene() ? (
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
            const isSelected = selected === (node.actor || node.object)
            const icon = node.isActor ? '◆ ' : '◈ '
            return (
              <div
                key={node.object.id + '-' + i}
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
                onClick={() => select(isSelected ? null : (node.actor || node.object))}
                onDoubleClick={() => node.object && focusOn(node.object)}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                {icon}{node.name}
                {node.isActor && (
                  <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: 10 }}>
                    [{node.actor!.constructor.name}]
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
