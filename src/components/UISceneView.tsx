import React, { useEffect, useRef } from 'react'
import { useEditorStore } from '../stores/editorStore'
import {
  getRunningWorld, getSelectedActor, onSelectionChange,
} from '../editor/SelectionManager'
import { RuntimeUIEditor } from '../editor/asset/RuntimeUIEditor'

/**
 * UISceneView — UI 场景运行时编辑视图（永久常驻页签）
 *
 * 游戏运行时显示当前运行游戏的 UI 树，提供类似 UI 资产预览的可编辑场景：
 *  - 包围盒 + 8 把手拖拽调整大小
 *  - 节点拖动 / 锚点偏移编辑
 *  - 点击拾取任意 UI 节点（同步全局选中 + Inspector）
 *
 * 未运行游戏时显示空状态（启动游戏后自动加载 UI 树到此页签）。
 *
 * 注意：编辑直接作用于运行时 actor（热调试性质），停止游戏后丢弃。
 * 写盘请使用 UI 资产预览（在资产浏览器双击 widget.json 打开）。
 */
export function UISceneView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<RuntimeUIEditor | null>(null)
  const gameRunning = useEditorStore((s) => s.gameState.running)

  // 创建 RuntimeUIEditor 实例（一次）
  useEffect(() => {
    if (!containerRef.current) return
    const editor = new RuntimeUIEditor(containerRef.current)
    editorRef.current = editor
    // 调试辅助：暴露到 window（AI 验证/控制台排查用）
    ;(window as unknown as Record<string, unknown>).__runtimeUIEditor = editor

    // 容器尺寸变化 → 同步相机视锥 + 渲染器尺寸
    const ro = new ResizeObserver(() => editor.resize())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      editor.dispose()
      editorRef.current = null
      ;(window as unknown as Record<string, unknown>).__runtimeUIEditor = undefined
    }
  }, [])

  // 游戏启动/停止时挂接/解除 game world
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (gameRunning) {
      // Viewport 启动游戏 effect 中 setRunningWorld 同步赋值，UISceneView 的 effect 在下一周期触发，
      // 此时 runningWorld 通常已就绪；为防意外（取决于 React 渲染顺序），增加 fallback：首次未就绪时
      // 在下一帧重试
      let cancelled = false
      const tryAttach = (depth: number) => {
        if (cancelled) return
        const world = getRunningWorld()
        if (world) {
          editor.attachWorld(world)
        } else if (depth < 30) {
          // 重试 30 帧（约 0.5s）后放弃
          requestAnimationFrame(() => tryAttach(depth + 1))
        }
      }
      tryAttach(0)
      return () => { cancelled = true }
    } else {
      editor.detachWorld()
    }
  }, [gameRunning])

  // 切换到 UIScene 页签时刷新布局
  const activeTabId = useEditorStore((s) => s.activeTabId)
  useEffect(() => {
    if (activeTabId === 'uiScene') {
      // 切换瞬间容器可能还未布局完成，延后一帧 resize
      requestAnimationFrame(() => editorRef.current?.resize())
    }
  }, [activeTabId])

  // 全局选中变化（UI 大纲点击 / Inspector 操作）→ 同步到 UIScene 编辑器
  // （RuntimeUIEditor.syncSelection 内部防同目标跳过，且不调 select 防循环）
  useEffect(() => {
    const unsub = onSelectionChange(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.syncSelection(getSelectedActor())
    })
    return unsub
  }, [])

  return (
    <div className="panel-body" style={{ padding: 0, position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
      />
      {!gameRunning && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', lineHeight: 1.6,
            pointerEvents: 'none',
          }}
        >
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
            启动游戏后在此处编辑运行中 UI
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
              （与 UI 资产预览体验一致，改动实时反映到游戏）
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
