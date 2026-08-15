/**
 * AIEvents — AI 事件常量与 payload 类型定义
 *
 * AI（经 MCP）通过 AIModule.emit 触发这些事件来控制游戏场景。
 * 约定：
 *  - 事件名统一 `ai.` 前缀（小写点分）
 *  - 每个事件一个常量 + 一个 payload 接口，方便配置与添加
 *  - 添加新事件：① 在此定义常量/类型 ② 在 registerBuiltinAIHandlers 注册处理器
 */

// ═══════════════════════════════════════
//  事件名常量
// ═══════════════════════════════════════

/** 通用通知（日志/控制台），不需要游戏运行 */
export const AI_EVENT_NOTIFY = 'ai.notify'

/** 生成 Actor（按蓝图路径或 baseClass） */
export const AI_EVENT_SPAWN_ACTOR = 'ai.spawnActor'
/** 按名称销毁 Actor */
export const AI_EVENT_DESTROY_ACTOR = 'ai.destroyActor'
/** 移动/旋转/缩放指定 Actor */
export const AI_EVENT_TRANSFORM_ACTOR = 'ai.transformActor'
/** 设置分数 */
export const AI_EVENT_SET_SCORE = 'ai.setScore'
/** 累加分数 */
export const AI_EVENT_ADD_SCORE = 'ai.addScore'
/** 游戏结束 */
export const AI_EVENT_GAME_OVER = 'ai.gameOver'
/** 切换场景（mode 或场景文件） */
export const AI_EVENT_SWITCH_SCENE = 'ai.switchScene'
/** 查询运行状态（分数/阶段/Actor 列表等，处理器返回值回传 AI） */
export const AI_EVENT_GET_STATE = 'ai.getState'
/** 在 UI 上显示一条消息（无现成 toast 时回退为日志通知） */
export const AI_EVENT_SHOW_MESSAGE = 'ai.showMessage'

/** 点击指定 Actor 上的 UI 按钮（按名称，不依赖鼠标坐标） */
export const AI_EVENT_CLICK_ACTOR = 'ai.clickActor'

/** 查询单个 Actor 的详细信息（位置/缩放/激活/按钮状态等，按名称递归查找，含 HUD 子节点） */
export const AI_EVENT_GET_ACTOR = 'ai.getActor'

/** 模拟鼠标滚轮（缩放摄像机，delta 约定与 PlayerController.OnScroll 一致：正=拉远，负=拉近） */
export const AI_EVENT_SCROLL_CAMERA = 'ai.scrollCamera'

/** 执行 GM 命令（引擎级调试命令系统，等价游戏内控制台输入） */
export const AI_EVENT_GM_COMMAND = 'ai.gmCommand'

/** 泛型 RPC：查询 Actor 上指定类型组件的公开状态（序列化安全，跳过函数/私有字段） */
export const AI_EVENT_GET_COMPONENT = 'ai.getComponent'

/** 泛型 RPC：写 Actor 或组件的公开属性（测试断言/状态注入用） */
export const AI_EVENT_SET_PROPERTY = 'ai.setProperty'

/** 泛型 RPC：调用 Actor 或组件的白名单方法（setPosition/SetActive/applyPatch 等） */
export const AI_EVENT_CALL_ACTOR = 'ai.callActor'

// ═══════════════════════════════════════
//  Payload 类型
// ═══════════════════════════════════════

export interface AINotifyPayload {
  message: string
  /** 日志级别，默认 info */
  level?: 'info' | 'warn' | 'error'
}

export interface AISpawnActorPayload {
  /** 蓝图路径（优先）；提供时经 World.SpawnActorFromBlueprint 生成 */
  blueprint?: string
  /** baseClass（ActorRegistry 注册名），blueprint 缺失时使用 */
  baseClass?: string
  name?: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface AIDestroyActorPayload {
  /** Actor 名称（精确匹配，支持用 .name 或 root.name） */
  name: string
}

export interface AITransformActorPayload {
  /** Actor 名称 */
  name: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface AISetScorePayload {
  score: number
}

export interface AIAddScorePayload {
  amount: number
}

export interface AISwitchScenePayload {
  /** GameMode 名（WorldRegistry/GameModeRegistry）或场景文件路径 */
  scene: string
  mode?: string
}

export interface AIShowMessagePayload {
  text: string
  /** 展示时长秒（预留，当前实现为日志通知） */
  duration?: number
  level?: 'info' | 'warn' | 'error'
}

/** ai.clickActor payload：按 Actor 名称触发其上 UI 按钮的点击 */
export interface AIClickActorPayload {
  /** Actor 名称（精确匹配 .name 或 root.name） */
  name: string
}

/** ai.getActor payload：按名称查询单个 Actor 详细信息 */
export interface AIGetActorPayload {
  /** Actor 名称（精确匹配 .name 或 root.name，递归查找） */
  name: string
}

/** ai.scrollCamera payload：模拟鼠标滚轮控制摄像机缩放 */
export interface AIScrollCameraPayload {
  /** 滚轮 delta（约定与 PlayerController.OnScroll 一致：正=拉远，负=拉近，如 -100 拉近 / 100 拉远） */
  delta: number
  /** 摄像机名称（可选，默认当前游戏模式的主摄像机） */
  camera?: string
}

/** ai.gmCommand payload：执行 GM 命令（等价控制台输入 'command args...'） */
export interface AIGMCommandPayload {
  /** 命令调用名（如 'addCoins' / 'help' / 'gm.disable'） */
  command: string
  /** 参数字符串数组（可选，如 ['100']；执行时按空白拼回命令行） */
  args?: string[]
}

/** ai.getComponent payload：查询组件公开状态（补足 ai.getActor 的固定字段限制） */
export interface AIGetComponentPayload {
  /** Actor 名称（精确匹配 .name 或 root.name，递归查找） */
  actor: string
  /** 组件类型名（构造器名，如 'TransformComponent'）；缺省返回全部组件 */
  component?: string
}

/** ai.setProperty payload：写 Actor 或组件公开属性 */
export interface AISetPropertyPayload {
  /** Actor 名称（精确匹配 .name 或 root.name，递归查找） */
  actor: string
  /** 组件类型名；缺省作用于 Actor 自身 */
  component?: string
  /** 属性名（公开字段，非 _ 开头；getter 属性也可写） */
  property: string
  /** 新值（JSON 可序列化；Vector3/Euler 用 {x,y,z} 或数组） */
  value: unknown
}

/** ai.callActor payload：调用 Actor 或组件方法（白名单） */
export interface AICallActorPayload {
  /** Actor 名称（精确匹配 .name 或 root.name，递归查找） */
  actor: string
  /** 组件类型名；缺省调用 Actor 自身方法 */
  component?: string
  /** 方法名（白名单：setPosition/setRotation/setScale/SetActive/applyPatch/destroy 等） */
  method: string
  /** 参数数组（JSON 可序列化；允许设置 allowAll:true 放开白名单做深度调试） */
  args?: unknown[]
  /** 调试开关：true 时放开方法白名单（默认 false，保守） */
  allowAll?: boolean
}

/** 单个 Actor 的详细信息（ai.getActor 返回） */
export interface AIActorInfo {
  name: string
  type: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  /** 是否激活（UI 失活属性，false = 已创建但不渲染） */
  active: boolean
  /** 挂载的 UIButtonComponent 摘要（状态机 + 按下缩放配置） */
  buttons?: Array<{ state: string; pressScale: number }>
  /** 组件渲染状态（验证 active 是否真正控制渲染） */
  components?: Array<{
    type: string
    enabled: boolean
    componentActive?: boolean
    renderVisible?: boolean
  }>
  children: Array<{ name: string; type: string }>
}

/** getState 返回的运行状态摘要 */
export interface AIGameStateSnapshot {
  running: boolean
  phase: string
  score: number
  gameOver: boolean
  actorCount: number
  actors: Array<{
    name: string
    type: string
    /** 世界缩放 [x, y, z]（用于验证 transformActor / 按钮按下缩放动效等） */
    scale: [number, number, number]
    /** 是否激活（UI 失活属性，false = 已创建但不渲染） */
    active: boolean
  }>
}
