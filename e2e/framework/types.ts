/**
 * e2e/framework/types — 框架自身的最小类型定义
 *
 * 为什么不 import src/engine 的类型：Playwright 用自己的 esbuild 编译 spec，
 * 不走 vite 的 '@/engine' 别名；而且把引擎代码拉进 Node 进程会拖入 three.js 等运行时。
 * 这里只镜像 e2e 断言真正用到的字段（与 src/engine/ai/AIEvents.ts 保持同步，字段少而准）。
 */

/** AIModule.emit 的聚合返回（首个处理器的返回值在 results[0]） */
export interface AIEventEnvelope<T = unknown> {
  results?: T[]
}

/** ai.getState 返回的运行状态快照（镜像 AIGameStateSnapshot，子集） */
export interface GameStateSnapshot {
  running: boolean
  phase: string
  score: number
  gameOver: boolean
  actorCount: number
  actors: Array<{
    name: string
    type: string
    active: boolean
    hp?: number
    maxHp?: number
    state?: string
  }>
}

/** ai.getHUD 返回的 HUD 树节点（镜像 AIHUDNode，子集） */
export interface HUDNode {
  name: string
  /** 从 HUD 根到本节点的路径（如 "HUD/底栏/商店"），可传给 clickActor({ path }) 精确点击 */
  path: string
  type: string
  active: boolean
  text?: string
  /** UIButtonComponent 状态机当前态（normal/hover/pressed/disabled） */
  buttonState?: string
  /** UI 画布世界坐标 [x, y, z]（画布 1920×1080 px 语义） */
  position?: [number, number, number]
  /** UI 画布世界尺寸 [w, h] */
  worldSize?: [number, number]
  children: HUDNode[]
}

/** ai.getSceneOutline 返回的单个大纲节点（镜像 AISceneOutlineNode，子集） */
export interface SceneOutlineNode {
  name: string
  type: string
  active: boolean
  components: string[]
  children: SceneOutlineNode[]
}

/** ai.getHUD / ai.getSceneOutline 的真实回执：ok + 命名字段包一层，字段值是"根节点数组"（注意多根可能） */
export interface HUDQueryResult {
  ok: boolean
  error?: string
  hud: HUDNode[]
}

export interface OutlineQueryResult {
  ok: boolean
  error?: string
  outline: SceneOutlineNode[]
}

/** 平铺后的 HUD 条目（断言/调试输出用） */
export interface HUDFlatEntry {
  name: string
  path: string
  text?: string
  active: boolean
}

/** ai.gmCommand 返回结构（镜像 AIGMCommandResult） */
export interface GMResult {
  ok: boolean
  message: string
}

/** ai.clickActor 回执 */
export interface ClickActorResult {
  ok?: boolean
  error?: string
}

/** ai.mouseClick 回执（完整按下+释放序列；consumed = 是否有 ClickableComponent 消费按下） */
export interface MouseClickResult {
  ok?: boolean
  error?: string
  screenX?: number
  screenY?: number
  button?: number
  consumed?: boolean
}

/** ai.mouseDrag 回执（校验同步返回，多步移动后台推进 async=true；非左键不触发 ClickableComponent） */
export interface MouseDragResult {
  ok?: boolean
  error?: string
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  steps?: number
  button?: number
  /** true = 多步移动在后台推进（回执即时返回，位移效果需自行轮询） */
  async?: boolean
}

/** ai.projectScreenPos 回执（世界→屏幕投影查询；inFront=false 时坐标不可信） */
export interface ProjectScreenPosResult {
  ok?: boolean
  error?: string
  actor?: string
  world?: [number, number, number]
  screenX?: number
  screenY?: number
  inFront?: boolean
}

/** 项目描述符：一个新项目接入框架 = 在 projects.ts 登记一条 */
export interface ProjectDescriptor {
  /** 框架内项目 id（spec 里 test.use({ project: 'fish' }) 用的键） */
  id: string
  /** 编辑器首页工程卡的显示名前缀（点击选卡用，与 projects/*/register.ts 的 name 一致） */
  cardName: string
  /** 一句话说明（报告/文档用） */
  description?: string
}
