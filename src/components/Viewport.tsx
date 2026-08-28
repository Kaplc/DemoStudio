import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import * as THREE from 'three'
  import { SceneRendererComponent, logger, Game, World, gizmos, EditorGameBridgeComponent } from '../engine'
import { UISceneView } from './UISceneView'
import type { PreviewSceneManager } from '../editor'
import type { SceneAsset } from '../engine'
import { useEditorStore, type ViewportTabDef } from '../stores/editorStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import { BlueprintEditor } from './BlueprintEditor'
import { ScenePreviewEditor } from './ScenePreviewEditor'
import { BlueprintEditorService } from '../editor/blueprintEdit/BlueprintEditorService'
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
  setEditorScene,
  setSceneMgr,
  getTransformGizmo,
  notifySelectionChange,
  watchWorldActorChanges,
  setRunningWorld,
  setRunningBridge,
  attachAnchorGizmoToScene,
  attachTransformGizmoToScene,
  updateAnchorGizmo,
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
  const gameSceneRef = useRef<SceneRendererComponent | null>(null)
  const gameRef = useRef<Game | null>(null)

  // 共享场景（Scene 视口和 Game 视口共用）
  const editorSceneRef = useRef<THREE.Scene | null>(null)
  // 当前 defaultScene 读取的 mode
  const sceneModeRef = useRef<string | undefined>(undefined)
  // 当前预览场景 World（actor 化加载：场景资产对象 → Actor，大纲可选中/编辑）
  const previewWorldRef = useRef<World | null>(null)
  // 最后加载的 defaultScene 路径（防止停止游戏恢复与切换工程重复加载）
  const lastPreviewPathRef = useRef<string | null>(null)
  // setupScene 返回的清理函数
  const cleanupRef = useRef<(() => void) | null>(null)

  const prefsViewport = useEditorPrefsStore((s) => s.viewport)
  const setViewportPref = useEditorPrefsStore((s) => s.setViewport)
  const gameAspectRatio = prefsViewport.aspectRatio
  const gizmosOn = prefsViewport.gizmos
  const setGameAspectRatio = (ratio: string) => setViewportPref({ aspectRatio: ratio })
  const [viewportFocused, setViewportFocused] = useState(false)

  const editorState = useEditorStore((s) => s.gameState)
  const currentProject = useEditorStore((s) => s.currentProject)
  const launchCount = useEditorStore((s) => s.launchCount)
  const setGameScore = useEditorStore((s) => s.setGameScore)
  const setGameOver = useEditorStore((s) => s.setGameOver)

  // 动态页签
  const dynamicTabs = useEditorStore((s) => s.dynamicTabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActiveTabId = useEditorStore((s) => s.setActiveTabId)
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab)
  const closeDynamicTab = useEditorStore((s) => s.closeDynamicTab)
  const dirtyBlueprints = useEditorStore((s) => s.dirtyBlueprints)

  // 合并所有页签：持久页签 + 动态页签
  const allTabs: ViewportTabDef[] = useMemo(() => [
    { id: 'scene', type: 'scene', label: 'Scene', permanent: true },
    { id: 'game', type: 'game', label: 'Game', permanent: true },
    { id: 'uiScene', type: 'uiScene', label: 'UI Scene', permanent: true },
    ...dynamicTabs,
  ], [dynamicTabs])

  // ─── 一次初始化：使用 SceneSetup 创建共享场景 + Scene 视口 ───
  useEffect(() => {
    if (!sceneContainerRef.current || !gameContainerRef.current) return

    const { editorScene, sceneMgr, gameMgr, cleanup } = setupScene(
      sceneContainerRef.current,
      onReady,
    )

    editorSceneRef.current = editorScene
    sceneRef.current = sceneMgr
    gameSceneRef.current = gameMgr
    cleanupRef.current = cleanup
    setEditorScene(editorScene)
    setSceneMgr(sceneMgr)

    return () => {
      setEditorScene(null)
      setSceneMgr(null)
      cleanup()
      cleanupRef.current = null
      sceneRef.current = null
      gameSceneRef.current = null
      gameRef.current = null
      editorSceneRef.current = null
      previewWorldRef.current?.DestroyAllActors()
      previewWorldRef.current = null
      lastPreviewPathRef.current = null
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

  // ─── 加载一个 scene.json 到共享场景预览（actor 化：对象 → GenericActor + MeshComponent）───
  const loadDefaultScenePreview = useCallback(async (path: string, label: string) => {
    const scene = editorSceneRef.current
    if (!scene) return
    const readJsonFile = window.electronAPI?.readJsonFile
    if (!readJsonFile) return
    try {
      const result = await readJsonFile(path)
      if (!result.success || !result.data) return
      // 防重复：同一路径且已有预览 world 时跳过（停止游戏恢复 vs 切换工程并发）
      if (lastPreviewPathRef.current === path && previewWorldRef.current) return
      const sceneData = result.data as SceneAsset
      // 清除旧预览 world
      if (previewWorldRef.current) {
        previewWorldRef.current.DestroyAllActors()
        previewWorldRef.current = null
      }
      // actor 化加载：与游戏运行时 World.loadSceneAsActors 同构，
      // 每个 mesh/ref/actor 节点 → Actor，大纲可选中、可编辑
      const world = new World()
      // 预览 world 挂到编辑器场景（编辑器内部操作，非游戏场景注入）：
      // 预览 actor 的 root 挂到 editorScene，Scene 视图可直接看到 defaultScene 内容，
      // 与 Default 灯光容器/网格/gizmo 同场景渲染；游戏运行时本 world 会被销毁清空
      world.attachExternalScene(scene)
      // setScene 会把 editorScene 的背景/雾/环境覆盖为预览 world 自建场景的默认值（null），
      // 恢复编辑器默认背景（skybox 由下方 applySkybox 再应用）
      scene.background = new THREE.Color(0x1a1a2e)
      world.loadSceneAsActors(sceneData)
      world.BeginPlay()
      world.manualTick(0)
      // 监听预览 World 的 Actor 变化 → 大纲自动刷新
      watchWorldActorChanges(world)
      previewWorldRef.current = world
      lastPreviewPathRef.current = path
      sceneModeRef.current = sceneData.mode
      if (sceneData.skybox) {
        applySkybox(scene, sceneData.skybox)
      }
      // 通知大纲刷新（getSceneTree 依赖 selectionKey 重建，加载 actors 后必须触发）
      notifySelectionChange()
      logger.info(`[Viewport] 加载默认场景 (${label}): ${sceneData.name}（actor 化预览，${world.actorCount} 个 Actor）`)
    } catch (err) {
      logger.warn(`[Viewport] 加载默认场景失败 (${label}): ${err}`)
    }
  }, [])

  // ─── 切换工程 → 停止游戏 + 读取 defaultScene 预览 ───
  useEffect(() => {
    if (!editorSceneRef.current) return

    const switchProject = async () => {
      // 0. 清空蓝图编辑缓存（工作副本/撤销栈），避免残留到下一个工程
      BlueprintEditorService.clearCache()

      // 1. 游戏运行时先停止（Game 仅在运行时存在）
      if (editorState.running) {
        logger.info('切换工程: 停止当前游戏...')
        gameRef.current?.destroy()
        gameRef.current = null
        gameSceneRef.current = null
        useEditorStore.getState().setGameRunning(false)
      } else {
        gameSceneRef.current?.stop()
        gameSceneRef.current?.clearFrame()
      }

      // 2. 清除旧的预览场景（actor 化 World）
      if (previewWorldRef.current) {
        previewWorldRef.current.DestroyAllActors()
        previewWorldRef.current = null
      }
      lastPreviewPathRef.current = null

      // 3. 重置场景为默认状态
      editorSceneRef.current!.background = new THREE.Color(0x1a1a2e)
      gizmos.beginFrame(editorSceneRef.current!)
      gizmos.flush()

      // 4. 重置 UI 状态
      setGameScore(0)
      setGameOver(false)

      // 5. 按项目渲染模式切换相机 + 读取 defaultScene 预览
      if (currentProject) {
        gameSceneRef.current?.setCameraMode(
          currentProject.renderMode === '2d' ? 'orthographic' : 'perspective',
        )

        const { defaultScene, name } = currentProject
        if (defaultScene) {
          await loadDefaultScenePreview(defaultScene, `${name}/defaultScene`)
        }
      }
    }

    switchProject()
  }, [currentProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 游戏运行时隐藏编辑器场景中的编辑器辅助网格（GridHelper 40x40 是草坪格子的来源）───
  const setEditorGridVisible = useCallback((visible: boolean) => {
    const scene = editorSceneRef.current
    if (!scene) return
    scene.traverse((obj) => {
      if (obj.type === 'GridHelper') obj.visible = visible
    })
  }, [])

  // ─── 启动/停止游戏（Game 在点击启动时创建；实例由 Game 读取项目工厂配置创建）───
  useEffect(() => {
    if (!editorState.running) return

    // 每次启动都创建新的 Game + 游戏实例（确保代码变更生效）
    // Game 视口渲染容器：createInstance 传入 → instance → World 创建 SceneRendererComponent
    const game = new Game(sceneRef.current)
    game.setCallbacks({
      onScoreChange: (score) => { setGameScore(score) },
      onGameOver: () => setGameOver(true),
    })
    gameRef.current = game

    // 游戏运行时隐藏编辑器辅助网格（挂 editorScene，不隐藏会泄漏到游戏画面）
    setEditorGridVisible(false)
    // gizmos 已是多场景后端（每场景一份缓冲）：游戏 world 的调试线画进自己场景，
    // 不会透到 Scene 视口的编辑器场景，无需再 detach

    // 启动游戏时清理 Scene 页签的 actor 化预览（游戏 world 接管 editorScene，
    // 避免与游戏 actors 叠加/大纲重名冲突）
    if (previewWorldRef.current) {
      previewWorldRef.current.DestroyAllActors()
      previewWorldRef.current = null
    }
    // TransformGizmo 分离（编辑坐标轴不显示在游戏画面）
    getTransformGizmo().detach()

    if (currentProject) {
      game.createInstance(currentProject.name, gameContainerRef.current)
    }
    if (!game.instance) return

    if (!game.launch()) {
      logger.error('[Viewport] 游戏启动失败（Game.launch 返回 false），不进入运行态接线')
      return
    }

    const inst = game.instance!

    // Game 视口渲染器由 World 创建（instance → world.gameRenderer），同步引用供输入路由/显隐控制
    const world = (inst as unknown as { world?: import('../engine').World }).world ?? null
    gameSceneRef.current = world?.gameRenderer ?? null

    // 游戏场景与编辑器解耦（编辑器只读、不注入）：游戏保持自建场景，编辑器只观察。
    // Scene 视图直接渲染游戏场景（同一 scene，不同相机），不再用叠加层。
    // 大纲经桥组件读取游戏 actor 树。
    const bridge = inst.getComponent(EditorGameBridgeComponent)
    setRunningBridge(bridge)
    sceneRef.current?.setViewScene(bridge?.scene ?? null)
    // TransformGizmo 跟随 Scene 视图渲染场景，这样游戏运行时在 Scene 页签点击大纲节点也能看到变换 Gizmo
    if (bridge?.scene) attachTransformGizmoToScene(bridge.scene)
    // 记录运行中游戏的 World（UI 选中辅助等仍以 World 为锚）
    setRunningWorld(world)
    // 监听游戏 World 的 Actor 变化（生成/销毁）→ 大纲自动刷新
    if (world) watchWorldActorChanges(world)
    // 选中 UI 节点时显示锚点框 + 范围框（编辑器独立 overlay 场景承载，不污染游戏 UI 场景）
    attachAnchorGizmoToScene(world?.ui.scene ?? null)

    // 新创建的渲染器需应用编辑器当前设置（比例 + 渲染模式），
    // 比例 effect 只在 gameAspectRatio 变化时触发，不会覆盖启动新建的渲染器
    const gameMgr = gameSceneRef.current
    if (gameMgr) {
      const ratio = gameAspectRatio
        ? (() => { const [aw, ah] = gameAspectRatio.split('/').map(Number); return aw / ah })()
        : null
      gameMgr.setTargetAspect(ratio)
      gameMgr.setCameraMode(currentProject?.renderMode === '2d' ? 'orthographic' : 'perspective')
    }
    // 每帧更新 AnchorGizmo 跟随（UICamera 视锥换算 worldPerPx → 三角形屏幕恒定尺寸）。
    // 在 SceneRendererComponent 更新阶段调用，确保渲染前矩阵已更新。
    const removeAnchorUpdate = gameMgr?.onUpdate(() => {
      const cam = gameMgr.uiCamera
      if (!cam) return
      // UICamera 正交：top-bottom = 视口高对应的世界单位；zoom 恒为 1
      const worldPerPx = (cam.top - cam.bottom) / gameMgr.renderer.domElement.clientHeight
      updateAnchorGizmo(worldPerPx)
    }) ?? (() => {})

    return () => {
      removeAnchorUpdate()
      game.destroy()
      gameRef.current = null
      gameSceneRef.current = null
      // 清空运行中游戏的引用：大纲树 / Scene 视图 / 桥组件恢复编辑器默认场景
      setRunningWorld(null)
      setRunningBridge(null)
      sceneRef.current?.setViewScene(null)
      // 游戏停止：TransformGizmo 恢复挂到编辑器场景
      if (editorSceneRef.current) attachTransformGizmoToScene(editorSceneRef.current)
      // 游戏停止：取消 UI 选中辅助目标
      attachAnchorGizmoToScene(null)
      // 停止游戏后恢复编辑器辅助网格显示
      setEditorGridVisible(true)
      // 调试线重新挂到共享场景（TransformGizmo 在 setupScene 中挂 editorScene）
      if (editorSceneRef.current) {
        gizmos.attach(editorSceneRef.current)
      }
    }
  }, [editorState.running, launchCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 启动游戏自动切换到 Game 标签 ───
  useEffect(() => {
    if (editorState.running) {
      setActiveTabId('game')
    }
  }, [editorState.running])

  // ─── 切换到 UIScene 页签时自动联动左侧面板到 UI 大纲（UIScene 页签的对象在 UI 树中） ───
  useEffect(() => {
    if (activeTabId === 'uiScene') {
      setLeftPanelTab('ui')
    }
  }, [activeTabId, setLeftPanelTab])

  // ─── 停止游戏后恢复 Scene 页签的 defaultScene actor 预览 ───
  useEffect(() => {
    if (editorState.running) return
    const proj = currentProject
    if (!proj?.defaultScene) return
    // 已有预览 world（切换工程已加载 / 从未启动过游戏）则跳过
    if (previewWorldRef.current) return
    loadDefaultScenePreview(proj.defaultScene, `${proj.name}/defaultScene`)
  }, [editorState.running, currentProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 停止游戏时隐藏 Game 视口的渲染器和 UI 层 ───
  useEffect(() => {
    const gameMgr = gameSceneRef.current
    if (!gameMgr) return
    const canvas = gameMgr.renderer.domElement
    const uiLayer = gameMgr.uiLayer
    if (editorState.running) {
      canvas.style.display = ''
      uiLayer.style.display = ''
    } else {
      canvas.style.display = 'none'
      uiLayer.style.display = 'none'
    }
  }, [editorState.running])

  // ─── 切换标签时刷新尺寸 ───
  useEffect(() => {
    if (activeTabId === 'scene') {
      sceneRef.current?.resize()
    } else if (activeTabId === 'game') {
      gameSceneRef.current?.resize()
    }
  }, [activeTabId])

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

    const ctx = { sceneMgr: sceneRef.current, gameMgr: gameSceneRef.current, game: gameRef.current, activeTabId }
    const onDown = (e: KeyboardEvent) => handleKeyDown(e, ctx)
    const onUp = (e: KeyboardEvent) => handleKeyUp(e, ctx)

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [activeTabId, viewportFocused])

  // ─── 鼠标输入路由（仅 Game 标签 + 游戏运行时）───
  useEffect(() => {
    if (activeTabId !== 'game' || !editorState.running) return
    const canvas = gameSceneRef.current?.renderer.domElement
    if (!canvas) return

    const ctx = { sceneMgr: sceneRef.current, gameMgr: gameSceneRef.current, game: gameRef.current, activeTabId }

    const onMove = (e: MouseEvent) => handleMouseMove(e, ctx, _ptrWorld)
    const onDown = (e: MouseEvent) => handleMouseDown(e, ctx, _ptrWorld)
    const onUp = (e: MouseEvent) => handleMouseUp(e, ctx, _ptrWorld)
    const onWheel = (e: WheelEvent) => handleWheel(e, ctx)
    // 阻止右键菜单，保证右键拖拽平移（摄像机）时不会弹出浏览器菜单
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)

    return () => {
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [activeTabId, editorState.running])

  // ─── TransformGizmo 交互（仅 Scene 标签 + 未运行时）───
  useEffect(() => {
    if (activeTabId !== 'scene' || editorState.running) return
    const canvas = sceneRef.current?.renderer.domElement
    if (!canvas) return

    const gizmo = getTransformGizmo()

    gizmo.onDragMove = notifySelectionChange

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // 仅左键
      if (!gizmo.visible) return

      const axis = gizmo.hitTest(e.clientX, e.clientY)
      if (axis) {
        gizmo.startDrag(axis, e.clientX, e.clientY)
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      gizmo.hoverTest(e.clientX, e.clientY)
      if (gizmo.isDragging) {
        gizmo.updateDrag(e.clientX, e.clientY)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (gizmo.isDragging) {
        gizmo.endDrag()
        try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)

    return () => {
      // 结束正在进行的拖拽
      if (gizmo.isDragging) gizmo.endDrag()
      gizmo.onDragMove = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [activeTabId, editorState.running])

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
      {/* 标签栏：页签可横向滚动（多页签时），右侧工具（比例/Gizmos/GM）固定 */}
      <div className="viewport-tabs">
        <div
          className="viewport-tabs-scroll"
          onWheel={(e) => {
            // 悬停页签栏时滚轮 → 横向滚动（鼠标无横滚键时也能滑动）
            const el = e.currentTarget
            el.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX)
          }}
        >
          {allTabs.map((tab) => (
          <button
            key={tab.id}
            className={`viewport-tab${activeTabId === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            title={tab.permanent ? undefined : tab.assetPath}
          >
            {tab.type === 'scene' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            )}
            {tab.type === 'game' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 12h4" /><path d="M8 10v4" />
              </svg>
            )}
            {tab.type === 'uiScene' && (
              <span style={{ fontSize: 14, lineHeight: 1 }}>🎨</span>
            )}
            {tab.type === 'blueprint' && (
              <span style={{ fontSize: 14, lineHeight: 1 }}>🧩</span>
            )}
            {tab.type === 'scenePreview' && (
              <span style={{ fontSize: 14, lineHeight: 1 }}>🎬</span>
            )}
            {tab.label}
            {tab.type === 'blueprint' && tab.assetPath && dirtyBlueprints[tab.assetPath] && (
              <span style={{ color: 'var(--warning)', marginLeft: 2 }}>*</span>
            )}
            {tab.type === 'game' && editorState.running && (
              <span style={{ marginLeft: 4, color: '#4ade80', fontSize: 10 }}>●</span>
            )}
            {tab.type === 'uiScene' && editorState.running && (
              <span style={{ marginLeft: 4, color: '#4ade80', fontSize: 10 }}>●</span>
            )}
            {/* 非持久标签的关闭按钮 */}
            {!tab.permanent && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  // 关闭蓝图页签：清理该资产的撤回缓存（工作副本/撤销栈），重新打开为干净磁盘状态
                  if (tab.type === 'blueprint' && tab.assetPath) {
                    BlueprintEditorService.closeAsset(tab.assetPath)
                  }
                  closeDynamicTab(tab.id)
                }}
                style={{
                  marginLeft: 6, padding: '0 3px', fontSize: 14, lineHeight: 1,
                  borderRadius: 2, opacity: 0.6, cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                title="关闭"
              >
                ×
              </span>
            )}
          </button>
          ))}
          <div className="menu-spacer" />
        </div>
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
          onClick={() => { const nv = !gizmosOn; gizmos.setEnabled(nv); setViewportPref({ gizmos: nv }) }}
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
        {activeTabId === 'game' && editorState.running && (
          <button
            onClick={() => gameRef.current?.instance?.gm?.toggleConsole()}
            title="打开/关闭当前项目的 GM 控制台（等效 G+M）"
            style={{
              marginLeft: 6,
              background: 'rgba(240,165,0,0.15)',
              color: '#f0a500',
              border: '1px solid rgba(240,165,0,0.4)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          >
            ⚙ GM
          </button>
        )}
      </div>

      {/* UI Scene 视图（永久常驻：游戏运行中提供可编辑 UI 场景；未运行时显示空状态） */}
      <div
        style={{
          flex: 1,
          display: activeTabId === 'uiScene' ? undefined : 'none',
          outline: 'none',
        }}
      >
        {activeTabId === 'uiScene' && <UISceneView />}
      </div>

      {/* Scene 视图 */}
      <div
        ref={sceneContainerRef}
        className="viewport-container viewport-container-game"
        style={{ flex: 1, display: activeTabId === 'scene' ? undefined : 'none' }}
      >

      </div>

      {/* Game 视图 */}
      <div
        ref={gameContainerRef}
        className="viewport-container viewport-container-game"
        tabIndex={-1}
        style={{ flex: 1, display: activeTabId === 'game' ? undefined : 'none', outline: 'none' }}
      >

      </div>

      {/* 动态页签视图 */}
      {dynamicTabs.map((tab) => (
        <div
          key={tab.id}
          style={{ flex: 1, display: activeTabId === tab.id ? undefined : 'none' }}
        >
          {tab.assetPath && tab.type === 'blueprint' && (
            <BlueprintEditor assetPath={tab.assetPath} />
          )}
          {tab.assetPath && tab.type === 'scenePreview' && (
            <ScenePreviewEditor assetPath={tab.assetPath} />
          )}
        </div>
      ))}
    </div>
  )
}
