import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { SceneManager, logger } from '../engine'
import { World } from '../framework'
import { SnakeGameMode, SnakePawn, SnakePlayerController, SnakeScene3D } from '../games/snake'
import { AxisIndicator } from './AxisIndicator'
import { useEditorStore } from '../stores/editorStore'

type ViewportTab = 'scene' | 'game'

interface ViewportProps {
  /** 初始化完成后回调 */
  onReady?: () => void
}

export function Viewport({ onReady }: ViewportProps) {
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const gameContainerRef = useRef<HTMLDivElement>(null)

  const sceneRef = useRef<SceneManager | null>(null)
  const gameSceneRef = useRef<SceneManager | null>(null)
  const worldRef = useRef<World | null>(null)
  const controllerRef = useRef<SnakePlayerController | null>(null)
  const pawnRef = useRef<SnakePawn | null>(null)
  const removeUpdateRef = useRef<(() => void) | null>(null)
  const gameCamUpdateRef = useRef<(() => void) | null>(null)

  // 共享场景
  const sharedSceneRef = useRef<THREE.Scene | null>(null)
  // 竞技场资源
  const arenaRef = useRef<{ group: THREE.Group; dispose: () => void } | null>(null)

  const [activeTab, setActiveTab] = useState<ViewportTab>('scene')
  const [localScore, setLocalScore] = useState(0)
  const [localPhase, setLocalPhase] = useState<string>('waiting')
  const [camPos, setCamPos] = useState({ x: 0, y: 0, z: 0 })
  const [camAxisDirs, setCamAxisDirs] = useState<{ x: number; y: number }[]>([
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 },
  ])
  const [gameAspectRatio, setGameAspectRatio] = useState<string>('16/9')

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

    // World（绑定共享场景）
    const world = new World(shared)
    const gameMode = new SnakeGameMode()
    world.SetGameMode(gameMode)
    world.Stop()
    worldRef.current = world

    // 订阅 GameState
    const unsub = gameMode.gameState.subscribe(() => {
      const gs = gameMode.gameState
      setLocalScore(gs.score)
      setLocalPhase(gs.phase)
      setGameScore(gs.score)
      if (gs.phase === 'gameover') setGameOver(true)
    })

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

    // 初始应用画面比例（首次初始化时两边同步）
    if (gameAspectRatio) {
      const [aw, ah] = gameAspectRatio.split('/').map(Number)
      sceneMgr.setTargetAspect(aw / ah)
      gameMgr.setTargetAspect(aw / ah)
    }

    // Resize
    const obs1 = new ResizeObserver(() => sceneMgr.resize())
    obs1.observe(sceneContainerRef.current)
    const obs2 = new ResizeObserver(() => gameMgr.resize())
    obs2.observe(gameContainerRef.current)

    // 通知外部加载完成
    onReady?.()

    return () => {
      unsub()
      obs1.disconnect()
      obs2.disconnect()
      world.Destroy()
      sceneMgr.dispose()
      gameMgr.dispose()
      sceneRef.current = null
      gameSceneRef.current = null
      worldRef.current = null
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

  // ─── 画面比例同步到 Scene + Game SceneManager（两边同步）───
  useEffect(() => {
    const ratio = gameAspectRatio
      ? (() => { const [aw, ah] = gameAspectRatio.split('/').map(Number); return aw / ah })()
      : null
    sceneRef.current?.setTargetAspect(ratio)
    gameSceneRef.current?.setTargetAspect(ratio)
  }, [gameAspectRatio])

  // ─── 切换工程 → 竞技场 ───
  useEffect(() => {
    const shared = sharedSceneRef.current
    if (!shared) return

    // 清除旧的
    if (arenaRef.current) {
      logger.info(`卸载竞技场: ${arenaRef.current.group.name}`)
      shared.remove(arenaRef.current.group)
      arenaRef.current.dispose()
      arenaRef.current = null
    }
    shared.children.forEach((child) => {
      if (child instanceof THREE.GridHelper) child.visible = true
    })

    if (currentProject?.name === 'Snake') {
      logger.info('加载 Snake 工程竞技场...')
      const snakeScene = new SnakeScene3D()
      const group = snakeScene.build(20)
      shared.children.forEach((child) => {
        if (child instanceof THREE.GridHelper) child.visible = false
      })
      shared.add(group)
      arenaRef.current = { group, dispose: () => snakeScene.dispose() }
      logger.info('Snake 竞技场加载完成')
    }
  }, [currentProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 启动/停止游戏 ───
  useEffect(() => {
    const world = worldRef.current
    const gameMgr = gameSceneRef.current
    if (!world) return
    const gm = world.gameMode as SnakeGameMode
    if (!gm) return

    if (editorState.running) {
      logger.info('启动游戏...')
      // 启用 Game 渲染和交互
      if (gameMgr) {
        if (gameMgr.controls) gameMgr.controls.enabled = true
        gameMgr.start()
      }

      gm.InitGame()
      gm.StartPlay()

      const spawn = gm.SpawnPlayer()
      if (spawn) {
        const pawn = spawn.pawn as SnakePawn
        pawn.InitGame() // 初始化蛇
        world.SpawnActor(pawn)
        spawn.controller.Possess(pawn)
        controllerRef.current = spawn.controller as SnakePlayerController
        pawnRef.current = pawn

        // 通过 GameMode 的 SpawnComponent 创建食物 Pawn
        gm.SpawnInitialFood(pawn.getSnakePositions())

        logger.info(`玩家生成: ${pawn.name}`)
      }

      world.BeginPlay()

      // Tick 挂到 Scene View 的 rAF 上
      const sceneMgr = sceneRef.current
      if (sceneMgr) {
        const rm = sceneMgr.onUpdate((dt) => world.manualTick(dt))
        removeUpdateRef.current = rm
      }

      // Game 摄像机从 PlayerCameraManager 同步
      if (gameMgr) {
        const camRm = gameMgr.onUpdate(() => {
          gm.cameraManager.ApplyToRenderer(gameMgr.camera, gameMgr.camera.aspect)
        })
        gameCamUpdateRef.current = camRm
      }
      logger.info('游戏已启动')
    } else {
      // StrictMode 兼容：避免游戏从未启动时打印"停止游戏"
      if (!controllerRef.current && !pawnRef.current) return
      logger.info('停止游戏...')
      if (removeUpdateRef.current) {
        removeUpdateRef.current()
        removeUpdateRef.current = null
      }
      if (gameCamUpdateRef.current) {
        gameCamUpdateRef.current()
        gameCamUpdateRef.current = null
      }
      world.DestroyAllActors()
      world.Pause()
      gm.cameraManager.Clear()
      controllerRef.current = null
      pawnRef.current = null

      // 禁用 Game 渲染和交互
      if (gameMgr) {
        if (gameMgr.controls) gameMgr.controls.enabled = false
        gameMgr.stop()
        gameMgr.clearFrame()
        // 恢复 45 度俯视视角
        gameMgr.camera.position.set(17, 17, 17)
        const gc = gameMgr.controls
        if (gc) {
          gc.target.set(0, 0, 0)
          gc.update()
        }
      }
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

  // ─── 实时追踪 Scene 摄像机坐标 + 轴方向 ───
  useEffect(() => {
    const tmpV = new THREE.Vector3()
    let rafId: number
    const poll = () => {
      const mgr = sceneRef.current
      if (mgr) {
        const cam = mgr.camera
        setCamPos({
          x: cam.position.x,
          y: cam.position.y,
          z: cam.position.z,
        })
        // 将世界轴方向转换到相机空间，取 (x,y) 作为屏幕 2D 方向
        // 不归一化，保留长度（朝向/远离摄像机时轴变短，产生 3D 纵深感）
        const invQuat = cam.quaternion.clone().invert()
        const dirs: { x: number; y: number }[] = []
        const worldAxes = [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 },
        ]
        for (const a of worldAxes) {
          tmpV.set(a.x, a.y, a.z).applyQuaternion(invQuat)
          dirs.push({ x: tmpV.x, y: -tmpV.y }) // SVG y 轴向下
        }
        setCamAxisDirs(dirs)
      }
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // ─── 键盘 ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'q', 'Q', 'e', 'E'].includes(e.key)) {
        // Scene 激活 → WASD 控制 Scene 摄像机
        // Game 激活 → WASD 控制 Game 摄像机
        const mgr = activeTab === 'scene' ? sceneRef.current : gameSceneRef.current
        mgr?.onWASDKeyDown(e.key)
        return
      }
      // 游戏运行时方向键路由到 PlayerController → InputComponent
      if (editorState.running && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        controllerRef.current?.ProcessInput(e.key, 'pressed')
        e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const mgr = activeTab === 'scene' ? sceneRef.current : gameSceneRef.current
      mgr?.onWASDKeyUp(e.key)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [editorState.running, activeTab])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
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
        <div className="menu-spacer" />
        {activeTab === 'scene' && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            WASD 漫游 · 左键旋转 · 右键平移 · 滚轮缩放
          </span>
        )}
        {activeTab === 'game' && editorState.running && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            🐍 Score: {localScore}{localPhase === 'gameover' ? ' · Game Over' : ''}
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
        <AxisIndicator cameraPos={camPos} axisDirs={camAxisDirs} />
      </div>

      {/* Game 视图 */}
      <div
        ref={gameContainerRef}
        className="viewport-container viewport-container-game"
        style={{ flex: 1, display: activeTab === 'game' ? undefined : 'none' }}
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
        {activeTab === 'game' && editorState.running && (
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 16px',
            borderRadius: 6, fontSize: 14, fontFamily: 'monospace', fontWeight: 600,
            zIndex: 10, pointerEvents: 'none',
          }}>
            🐍 {localPhase === 'gameover' ? 'Game Over - ' : ''}Score: {localScore}
          </div>
        )}
      </div>
    </div>
  )
}
