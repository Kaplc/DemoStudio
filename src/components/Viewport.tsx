import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { SceneManager, logger, Game, WorldRegistry, GameFactoryRegistry, NullGameInstance, gizmos } from '../engine'
import type { WorldAsset, SkyboxConfig } from '../engine'
import { useEditorStore } from '../stores/editorStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import type { ViewportTab } from '../stores/editorPrefsStore'
import { useSaveStore, setCurrentGameInstance } from '../stores/saveStore'

// 鼠标→世界坐标复用（clientToWorld 输出缓冲）
const _ptrWorld = new THREE.Vector3()

interface ViewportProps {
  /** 初始化完成后回调 */
  onReady?: () => void
}

export function Viewport({ onReady }: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const gameContainerRef = useRef<HTMLDivElement>(null)

  const sceneRef = useRef<SceneManager | null>(null)
  const gameSceneRef = useRef<SceneManager | null>(null)
  const gameRef = useRef<Game | null>(null)

  // 共享场景
  const sharedSceneRef = useRef<THREE.Scene | null>(null)
  // 竞技场资源
  const arenaRef = useRef<WorldAsset | null>(null)

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

  // ─── 一次初始化：共享场景 + World + 两个 SceneManager ───
  useEffect(() => {
    if (!sceneContainerRef.current || !gameContainerRef.current) return
    logger.info('初始化 Viewport 引擎系统...')

    // 共享场景
    const shared = new THREE.Scene()
    shared.background = new THREE.Color(0x1a1a2e)
    shared.fog = new THREE.Fog(0x1a1a2e, 30, 60)
    addDefaultContent(shared)
    sharedSceneRef.current = shared
    // 挂载全局 Gizmos 调试绘制层（共享场景，两个视口都会渲染）
    gizmos.attach(shared)

    // 游戏实例 — 初始创建一个空实例（后续切换工程时通过工厂重建）
    const gameInst = currentProject && GameFactoryRegistry.has(currentProject.name)
      ? GameFactoryRegistry.create(currentProject.name, shared)!
      : new NullGameInstance()
    if (gameInst.setCallbacks) {
      gameInst.setCallbacks({
        onScoreChange: (score) => { setLocalScore(score); setGameScore(score) },
        onPhaseChange: (phase) => setLocalPhase(phase),
        onGameOver: () => setGameOver(true),
      })
    }

    // Scene View — 飞越摄像机
    const sceneMgr = new SceneManager(sceneContainerRef.current, {
      controlMode: 'fly',
      sharedScene: shared,
      addDefaultContent: false,
    })
    sceneMgr.setWASDControl(true)
    sceneMgr.setCameraOrbit(45, 30, 20) // 45°水平, 30°俯视, 距离20 → (12,10,12)
    sceneMgr.start()
    sceneRef.current = sceneMgr
    logger.info('Scene 视图初始化完成 (Fly 摄像机)')

    // Game View — 轨道摄像机（2.5D 俯视）
    const gameMgr = new SceneManager(gameContainerRef.current, {
      controlMode: 'orbit',
      sharedScene: shared,
      addDefaultContent: false,
    })
    gameMgr.setWASDControl(true)
    gameMgr.camera.position.set(17, 17, 17)
    const gc = gameMgr.controls!
    gc.target.set(0, 0, 0)
    gc.update()
    gc.enabled = false   // 未启动游戏时禁用交互
    gameMgr.stop()       // 未启动游戏时不渲染
    gameSceneRef.current = gameMgr

    // 初始应用画面比例（首次初始化时两边同步；读 rehydrated 后的最新值）
    const ar = useEditorPrefsStore.getState().viewport.aspectRatio
    if (ar) {
      const [aw, ah] = ar.split('/').map(Number)
      sceneMgr.setTargetAspect(aw / ah)
      gameMgr.setTargetAspect(aw / ah)
    }

    // 游戏入口（管理 Tick/Camera 同步的注册/注销）— 必须在 sceneMgr/gameMgr 之后
    const game = new Game(gameInst, sceneMgr, gameMgr)
    gameRef.current = game

    // 每帧驱动 Gizmos 绘制（始终运行：停止/关闭时也会 flush 空内容以清空残影）
    const removeGizmoFlush = sceneMgr.onUpdate(() => {
      gameRef.current?.instance?.drawGizmos()
    })

    // Resize
    const obs1 = new ResizeObserver(() => sceneMgr.resize())
    obs1.observe(sceneContainerRef.current)
    const obs2 = new ResizeObserver(() => gameMgr.resize())
    obs2.observe(gameContainerRef.current)

    // 通知外部加载完成
    onReady?.()

    return () => {
      obs1.disconnect()
      obs2.disconnect()
      removeGizmoFlush()
      game.destroy()
      sceneMgr.dispose()
      gameMgr.dispose()
      gizmos.detach()
      sceneRef.current = null
      gameSceneRef.current = null
      gameRef.current = null
      sharedSceneRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function addDefaultContent(scene: THREE.Scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.4))
    const dl = new THREE.DirectionalLight(0xffffff, 1.2)
    dl.position.set(20, 30, 10)
    dl.castShadow = true
    dl.shadow.mapSize.width = 2048
    dl.shadow.mapSize.height = 2048
    scene.add(dl)
    const fl = new THREE.DirectionalLight(0x8888ff, 0.3)
    fl.position.set(-10, 15, -10)
    scene.add(fl)
    const grid = new THREE.GridHelper(40, 40, 0x444466, 0x333355)
    grid.position.y = -0.01
    scene.add(grid)
  }

  /** 根据 SkyboxConfig 更新场景背景/天空盒/雾效 */
  function applySkybox(scene: THREE.Scene, config: SkyboxConfig): void {
    // 天空盒立方体贴图（优先于纯色背景）
    if (config.skyboxPath) {
      const ext = config.skyboxExt ?? '.jpg'
      const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
      const urls = faces.map(s => `${config.skyboxPath}_${s}${ext}`)
      scene.background = new THREE.CubeTextureLoader().load(urls)
    } else if (config.backgroundColor) {
      scene.background = new THREE.Color(config.backgroundColor)
    }
    // 雾效
    if (config.fogColor && config.fogNear !== undefined && config.fogFar !== undefined) {
      scene.fog = new THREE.Fog(config.fogColor, config.fogNear, config.fogFar)
    }
  }

  // ─── 画面比例同步到 Scene + Game SceneManager（两边同步）───
  useEffect(() => {
    const ratio = gameAspectRatio
      ? (() => { const [aw, ah] = gameAspectRatio.split('/').map(Number); return aw / ah })()
      : null
    sceneRef.current?.setTargetAspect(ratio)
    gameSceneRef.current?.setTargetAspect(ratio)
  }, [gameAspectRatio])

  // ─── 切换工程 → 停止游戏 + 清理旧竞技场 + 加载新竞技场 ───
  useEffect(() => {
    const shared = sharedSceneRef.current
    if (!shared) return

    // 1. 先停止当前游戏（如果有）
    const game = gameRef.current
    const wasRunning = editorState.running
    if (wasRunning) {
      logger.info('切换工程: 停止当前游戏...')
      game?.shutdown()
      useEditorStore.getState().setGameRunning(false)
    }

    // 1.5 重置场景背景和雾效为默认值，防止前一个工程的背景残留
    shared.background = new THREE.Color(0x1a1a2e)
    shared.fog = new THREE.Fog(0x1a1a2e, 30, 60)

    // 2. 切换游戏实例 — 从工厂创建新实例 + 重置 UI 状态
    setLocalScore(0)
    setLocalPhase('waiting')
    setGameScore(0)
    setGameOver(false)
    if (currentProject && GameFactoryRegistry.has(currentProject.name)) {
      const newInst = GameFactoryRegistry.create(currentProject.name, shared)!
      newInst.setCallbacks({
        onScoreChange: (score) => { setLocalScore(score); setGameScore(score) },
        onPhaseChange: (phase) => setLocalPhase(phase),
        onGameOver: () => setGameOver(true),
      })
      game?.setInstance(newInst)
    } else if (game) {
      // 没有匹配的工厂 → 用空实例
      game.setInstance(new NullGameInstance())
    }

    // 3. 清理旧的竞技场
    if (arenaRef.current) {
      logger.info(`卸载竞技场: ${arenaRef.current.name}`)
      shared.remove(arenaRef.current.group)
      arenaRef.current.dispose()
      arenaRef.current = null
    }
    // 恢复默认元素（GridHelper）
    shared.children.forEach((child) => {
      if (child instanceof THREE.GridHelper) child.visible = true
    })

    // 强制清除 Gizmos 残影（当前帧 buffer → flush 隐藏）
    gizmos.beginFrame()
    gizmos.flush()

    // 3. 按项目渲染模式切换 Game 视口相机（2D→正交，3D→透视），再加载新竞技场
    if (currentProject) {
      gameSceneRef.current?.setCameraMode(currentProject.renderMode === '2d' ? 'orthographic' : 'perspective')
      const builder = WorldRegistry.get(currentProject.name)
      if (builder) {
        logger.info(`加载竞技场: ${currentProject.name}`)
        ;(async () => {
          const asset = await builder.build({})
          shared.children.forEach((child) => {
            if (child instanceof THREE.GridHelper) child.visible = false
          })
          shared.add(asset.group)
          arenaRef.current = asset
          // 应用场景氛围配置（天空盒/背景/雾效）
          if (asset.skybox) {
            applySkybox(shared, asset.skybox)
          }
          logger.info(`${currentProject.name} 竞技场加载完成`)
        })()
      }
    }
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

  // 失焦时清除 Scene 的 WASD 按键状态，防止卡键
  useEffect(() => {
    if (!viewportFocused) {
      sceneRef.current?.clearWASDKeys()
      gameSceneRef.current?.clearWASDKeys()
    }
  }, [viewportFocused])

  useEffect(() => {
    if (!viewportFocused) return

    const onDown = (e: KeyboardEvent) => {
      if (activeTab === 'scene') {
        if (['w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'q', 'Q', 'e', 'E'].includes(e.key)) {
          sceneRef.current?.onWASDKeyDown(e.key)
          e.preventDefault()
        }
      } else if (activeTab === 'game') {
        const ctrl = gameRef.current?.instance.controller
        if (ctrl) {
          ctrl.ProcessInput(e.key, 'pressed')
        }
        e.preventDefault()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (activeTab === 'scene') {
        if (!['w','W','a','A','s','S','d','D','q','Q','e','E'].includes(e.key)) return
        sceneRef.current?.onWASDKeyUp(e.key)
      } else if (activeTab === 'game') {
        const ctrl = gameRef.current?.instance.controller
        if (ctrl) {
          ctrl.ProcessInput(e.key, 'released')
        }
      }
    }
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
    const ctrl = () => gameRef.current?.instance.controller
    const toWorld = (e: MouseEvent) => {
      gameSceneRef.current?.clientToWorld(e.clientX, e.clientY, _ptrWorld)
      return _ptrWorld
    }
    const onMove = (e: MouseEvent) => ctrl()?.OnPointerMove(toWorld(e))
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      ctrl()?.OnPointerDown(toWorld(e))
    }
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return
      ctrl()?.OnPointerUp(toWorld(e))
    }
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 滚轮切换炮等级
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      ctrl()?.OnScroll(e.deltaY)
    }
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
