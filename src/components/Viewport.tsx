import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { PreviewSceneManager, GameSceneManager, logger, Game, GameFactoryRegistry, NullGameInstance, gizmos, loadScene } from '../engine'
import type { SceneGroup } from '../engine'
import { useEditorStore } from '../stores/editorStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import type { ViewportTab } from '../stores/editorPrefsStore'
import { useSaveStore, setCurrentGameInstance } from '../stores/saveStore'
import {
  setupScene,
  handleKeyDown,
  handleKeyUp,
  handleMouseMove,
  handleMouseDown,
  handleMouseUp,
  handleWheel,
  _ptrWorld,
  applySkybox,
} from '../editor'

interface ViewportProps {
  /** 初始化完成后回调 */
  onReady?: () => void
}

export function Viewport({ onReady }: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const gameContainerRef = useRef<HTMLDivElement>(null)

  const sceneRef = useRef<PreviewSceneManager | null>(null)
  const gameSceneRef = useRef<GameSceneManager | null>(null)
  const gameRef = useRef<Game | null>(null)

  // 共享场景
  const sharedSceneRef = useRef<THREE.Scene | null>(null)
  // 当前 defaultScene 读取的 mode
  const sceneModeRef = useRef<string | undefined>(undefined)
  // 当前预览场景组（选项目时加载的 defaultScene，启动后被游戏实例接管）
  const previewRef = useRef<SceneGroup | null>(null)
  // setupScene 返回的清理函数
  const cleanupRef = useRef<(() => void) | null>(null)

  const prefsViewport = useEditorPrefsStore((s) => s.viewport)
  const setViewportPref = useEditorPrefsStore((s) => s.setViewport)
  const activeTab = prefsViewport.activeTab
  const gameAspectRatio = prefsViewport.aspectRatio
  const gizmosOn = prefsViewport.gizmos
  const setActiveTab = (tab: ViewportTab) => setViewportPref({ activeTab: tab })
  const setGameAspectRatio = (ratio: string) => setViewportPref({ aspectRatio: ratio })
  const [viewportFocused, setViewportFocused] = useState(false)
  const [localScore, setLocalScore] = useState(0)
  const [localPhase, setLocalPhase] = useState<string>('waiting')

  const editorState = useEditorStore((s) => s.gameState)
  const currentProject = useEditorStore((s) => s.currentProject)
  const launchCount = useEditorStore((s) => s.launchCount)
  const setGameScore = useEditorStore((s) => s.setGameScore)
  const setGameOver = useEditorStore((s) => s.setGameOver)

  // ─── 一次初始化：使用 SceneSetup 创建共享场景 + 两个 SceneManager + Game ───
  useEffect(() => {
    if (!sceneContainerRef.current || !gameContainerRef.current) return

    const { sharedScene, sceneMgr, gameMgr, game, cleanup } = setupScene(
      sceneContainerRef.current,
      gameContainerRef.current,
      {
        onScoreChange: (score) => { setLocalScore(score); setGameScore(score) },
        onPhaseChange: (phase) => setLocalPhase(phase),
        onGameOver: () => setGameOver(true),
      },
      useEditorPrefsStore.getState().viewport.aspectRatio,
      onReady,
    )

    sharedSceneRef.current = sharedScene
    sceneRef.current = sceneMgr
    gameSceneRef.current = gameMgr
    gameRef.current = game
    cleanupRef.current = cleanup

    return () => {
      cleanup()
      cleanupRef.current = null
      sceneRef.current = null
      gameSceneRef.current = null
      gameRef.current = null
      sharedSceneRef.current = null
      previewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 画面比例同步到 Scene + Game SceneManager（两边同步）───
  useEffect(() => {
    const ratio = gameAspectRatio
      ? (() => { const [aw, ah] = gameAspectRatio.split('/').map(Number); return aw / ah })()
      : null
    sceneRef.current?.setTargetAspect(ratio)
    gameSceneRef.current?.setTargetAspect(ratio)
  }, [gameAspectRatio])

  // ─── 切换工程 → 停止游戏 + 读取 defaultScene 预览 ───
  useEffect(() => {
    const shared = sharedSceneRef.current
    const game = gameRef.current
    if (!shared || !game) return

    const switchProject = async () => {
      // 1. 无论游戏是否运行，先停止
      if (editorState.running) {
        logger.info('切换工程: 停止当前游戏...')
        game.shutdown()
        useEditorStore.getState().setGameRunning(false)
      } else {
        gameSceneRef.current?.stop()
        gameSceneRef.current?.clearFrame()
      }

      // 2. 清除旧的预览场景
      if (previewRef.current) {
        shared.remove(previewRef.current.group)
        previewRef.current.dispose()
        previewRef.current = null
      }

      // 3. 重置场景为默认状态
      shared.background = new THREE.Color(0x1a1a2e)
      shared.fog = new THREE.Fog(0x1a1a2e, 30, 60)
      gizmos.beginFrame()
      gizmos.flush()

      // 4. 重置 UI 状态 & 切换游戏实例
      setLocalScore(0)
      setLocalPhase('waiting')
      setGameScore(0)
      setGameOver(false)

      if (currentProject && GameFactoryRegistry.has(currentProject.name)) {
        const newInst = GameFactoryRegistry.create(currentProject.name, shared)!
        newInst.initialMode = sceneModeRef.current
        newInst.setCallbacks({
          onScoreChange: (score) => { setLocalScore(score); setGameScore(score) },
          onPhaseChange: (phase) => setLocalPhase(phase),
          onGameOver: () => setGameOver(true),
        })
        game.setInstance(newInst)
      } else {
        game.setInstance(new NullGameInstance())
      }

      // 5. 按项目渲染模式切换相机
      if (currentProject) {
        gameSceneRef.current?.setCameraMode(
          currentProject.renderMode === '2d' ? 'orthographic' : 'perspective',
        )

        // 6. 读取 defaultScene JSON 作为预览场景
        const { defaultScene, name } = currentProject
        const readJsonFile = window.electronAPI?.readJsonFile
        if (defaultScene && readJsonFile) {
          try {
            const result = await readJsonFile(defaultScene)
            if (result.success && result.data) {
              // 加载场景并记录 mode
              const sceneResult = loadScene(result.data)
              sceneModeRef.current = sceneResult.mode
              if (gameRef.current?.instance) {
                gameRef.current.instance.initialMode = sceneResult.mode
              }
              // 挂到共享场景预览
              shared.add(sceneResult.group)
              if (sceneResult.skybox) {
                applySkybox(shared, sceneResult.skybox)
              }
              previewRef.current = sceneResult
              logger.info(`[Viewport] 加载 ${name} 预览场景: ${sceneResult.name}`)
            }
          } catch (err) {
            logger.warn(`[Viewport] 读取 ${name} defaultScene 失败: ${err}`)
          }
        }
      }
    }

    switchProject()
  }, [currentProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 启动/停止游戏 ───
  useEffect(() => {
    const game = gameRef.current
    if (!game || !editorState.running) return

    // 如果是重新启动（launchCount > 1），先销毁旧实例，从工厂创建新的
    // 这样改 GameMode / GameInstance 代码后 Stop → Launch 就能生效
    if (launchCount > 1) {
      const shared = sharedSceneRef.current
      if (shared && currentProject && GameFactoryRegistry.has(currentProject.name)) {
        const newInst = GameFactoryRegistry.create(currentProject.name, shared)!
        newInst.initialMode = sceneModeRef.current
        newInst.setCallbacks({
          onScoreChange: (score) => { setLocalScore(score); setGameScore(score) },
          onPhaseChange: (phase) => setLocalPhase(phase),
          onGameOver: () => setGameOver(true),
        })
        game.setInstance(newInst)
      }
    }

    game.launch()

    // 同步当前实例给存档系统，并消费"未运行时读档"暂存的快照（此时 start 已完成）
    setCurrentGameInstance(game.instance)
    const pending = useSaveStore.getState().consumePendingRestore()
    if (pending) {
      game.instance.restoreSnapshot(pending.payload)
    }

    return () => {
      game.shutdown()
    }
  }, [editorState.running, launchCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 启动游戏自动切换到 Game 标签 ───
  useEffect(() => {
    if (editorState.running) {
      setActiveTab('game')
    }
  }, [editorState.running])

  // ─── 切换标签时刷新尺寸 ───
  useEffect(() => {
    if (activeTab === 'scene') {
      sceneRef.current?.resize()
    } else {
      gameSceneRef.current?.resize()
    }
  }, [activeTab])

  // ─── 键盘控制（仅 Viewport 获得焦点时生效）───
  useEffect(() => {
    // 自动聚焦 + mousedown 任意位置聚焦（capture 阶段，不被 canvas 拦截）
    const root = rootRef.current
    if (!root) return
    root.focus()
    const onMouseDown = (e: MouseEvent) => {
      // 点击交互元素（按钮/输入框/下拉框）时不抢焦点
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (root.contains(target) && document.activeElement !== root) {
        root.focus()
      }
    }
    root.addEventListener('mousedown', onMouseDown, true)
    return () => root.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  // 失焦时清除 WASD 按键状态，防止卡键
  useEffect(() => {
    if (!viewportFocused) {
      sceneRef.current?.clearWASDKeys()
    }
  }, [viewportFocused])

  useEffect(() => {
    if (!viewportFocused) return

    const ctx = { sceneMgr: sceneRef.current, gameMgr: gameSceneRef.current, game: gameRef.current, activeTab }
    const onDown = (e: KeyboardEvent) => handleKeyDown(e, ctx)
    const onUp = (e: KeyboardEvent) => handleKeyUp(e, ctx)

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [activeTab, viewportFocused])

  // ─── 鼠标输入路由（仅 Game 标签 + 游戏运行时）───
  useEffect(() => {
    if (activeTab !== 'game' || !editorState.running) return
    const canvas = gameSceneRef.current?.renderer.domElement
    if (!canvas) return

    const ctx = { sceneMgr: sceneRef.current, gameMgr: gameSceneRef.current, game: gameRef.current, activeTab }

    const onMove = (e: MouseEvent) => handleMouseMove(e, ctx, _ptrWorld)
    const onDown = (e: MouseEvent) => handleMouseDown(e, ctx, _ptrWorld)
    const onUp = (e: MouseEvent) => handleMouseUp(e, ctx, _ptrWorld)
    const onWheel = (e: WheelEvent) => handleWheel(e, ctx)

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [activeTab, editorState.running])

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onFocus={() => setViewportFocused(true)}
      onBlur={(e) => {
        // 焦点转移到容器内元素（如按钮）时不视为失焦
        if (!rootRef.current?.contains(e.relatedTarget as Node)) {
          setViewportFocused(false)
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, outline: 'none' }}
    >
      {/* 标签栏 */}
      <div className="viewport-tabs">
        <button
          className={`viewport-tab${activeTab === 'scene' ? ' active' : ''}`}
          onClick={() => setActiveTab('scene')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          Scene
        </button>
        <button
          className={`viewport-tab${activeTab === 'game' ? ' active' : ''}`}
          onClick={() => setActiveTab('game')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 12h4" /><path d="M8 10v4" />
          </svg>
          Game
          {editorState.running && (
            <span style={{ marginLeft: 6, color: '#4ade80', fontSize: 10 }}>●</span>
          )}
        </button>
        <select
          value={gameAspectRatio}
          onChange={(e) => setGameAspectRatio(e.target.value)}
          style={{
            marginLeft: 8,
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          <option value="">Free</option>
          <option value="16/9">16:9</option>
          <option value="16/10">16:10</option>
          <option value="4/3">4:3</option>
          <option value="21/9">21:9</option>
          <option value="1/1">1:1</option>
        </select>
        <button
          onClick={() => { const nv = !gizmosOn; gizmos.enabled = nv; setViewportPref({ gizmos: nv }) }}
          title="切换 Gizmos 调试绘制"
          style={{
            marginLeft: 6,
            background: gizmosOn ? 'rgba(74,222,128,0.15)' : 'var(--bg-tertiary)',
            color: gizmosOn ? '#4ade80' : 'var(--text-dim)',
            border: `1px solid ${gizmosOn ? 'rgba(74,222,128,0.4)' : 'var(--border)'}`,
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          ◇ Gizmos
        </button>
        <div className="menu-spacer" />
        {activeTab === 'scene' && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            WASD 漫游 · 左键旋转 · 右键平移 · 滚轮缩放
          </span>
        )}
        {activeTab === 'game' && editorState.running && currentProject && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {localPhase === 'gameover' ? 'Game Over' : `Score: ${localScore}`}
          </span>
        )}
      </div>

      {/* Scene 视图 */}
      <div
        ref={sceneContainerRef}
        className="viewport-container viewport-container-game"
        style={{ flex: 1, display: activeTab === 'scene' ? undefined : 'none' }}
      >
        {activeTab === 'scene' && (
          <div className="viewport-overlay">
            {editorState.running
              ? '🎮 游戏运行中 · 自由漫游查看'
              : currentProject
                ? `📐 ${currentProject.name} · 左键旋转摄像机 · WASD 漫游`
                : '📐 选择工程后在此显示场景资源'}
          </div>
        )}
      </div>

      {/* Game 视图 */}
      <div
        ref={gameContainerRef}
        className="viewport-container viewport-container-game"
        tabIndex={-1}
        style={{ flex: 1, display: activeTab === 'game' ? undefined : 'none', outline: 'none' }}
      >
        {activeTab === 'game' && !editorState.running && (
          <div className="viewport-overlay" style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: 'var(--text-dim)',
          }}>
            🎮 启动游戏后在此显示画面
          </div>
        )}
      </div>
    </div>
  )
}
