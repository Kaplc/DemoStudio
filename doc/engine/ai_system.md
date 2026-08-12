# AI 事件系统（Engine AI）

> AI 经 MCP 控制游戏场景的事件总线：AI 发事件 → 处理器执行 → 返回值回传。
> 代码位置：`src/engine/ai/`
> 相关文档：[系统总览](../system_overview.md) / [游戏流程](./gameflow_system.md)

## 1. 概述

`AIModule` 是引擎内的事件总线单例，让外部 AI（经 MCP 服务器）以"事件"方式控制游戏场景：

```ts
AIModule.instance.emit('ai.spawnActor', { blueprint: '...', position: [...] })
```

**设计目标：**

- **事件模式**：AI 发事件 → 处理器执行 → 返回值回传
- **动态配置**：`register` / `unregister` 动态增删处理器；事件名 + payload 集中定义在 `AIEvents.ts`
- **场景上下文**：`World` / `GameInstance` / `UIManager` 由 Game 生命周期注入（`setWorld` / `setGameInstance`）
- **松耦合**：模块不感知 MCP/编辑器，只提供事件能力；桥接在编辑器层完成

## 2. 核心接口

### AIModule（单例）

| 方法 | 说明 |
|---|---|
| `instance` | 全局唯一单例（引擎内） |
| `emit(event, payload)` | 发事件，按注册顺序汇总各处理器返回值 |
| `register(event, handler)` | 注册处理器 |
| `unregister(event, handler)` | 卸载处理器 |
| `setWorld` / `setGameInstance` | 注入场景上下文（Game 生命周期调用） |
| `reset()` | 回收运行状态（Game.shutdown 调用，GameSingleton 接口） |

### 事件上下文与结果

```ts
interface AIEventContext {
  world: World | null          // 当前运行 World（未运行时为 null）
  gameInstance: GameInstance | null
  readonly running: boolean    // 是否处于游戏运行中
}

type AIEventHandler = (payload: unknown, ctx: AIEventContext) => unknown | void

interface AIEmitResult {
  event: string
  handled: boolean             // 是否有处理器执行
  results: unknown[]           // 各处理器返回值
}
```

## 3. 内置事件（AIEvents.ts）

| 事件常量 | 载荷类型 | 说明 |
|---|---|---|
| `AI_EVENT_NOTIFY` | `AINotifyPayload` | 通知消息 |
| `AI_EVENT_SPAWN_ACTOR` | `AISpawnActorPayload` | 生成 Actor（按蓝图路径） |
| `AI_EVENT_DESTROY_ACTOR` | `AIDestroyActorPayload` | 销毁 Actor |
| `AI_EVENT_TRANSFORM_ACTOR` | `AITransformActorPayload` | 变换 Actor |
| `AI_EVENT_SET_SCORE` | `AISetScorePayload` | 设置分数 |
| `AI_EVENT_ADD_SCORE` | `AIAddScorePayload` | 增加分数 |
| `AI_EVENT_GAME_OVER` | — | 游戏结束 |
| `AI_EVENT_SWITCH_SCENE` | `AISwitchScenePayload` | 切换场景 |
| `AI_EVENT_GET_STATE` | — | 取游戏状态快照（`AIGameStateSnapshot`） |
| `AI_EVENT_SHOW_MESSAGE` | `AIShowMessagePayload` | 显示消息 |

## 4. 处理器分层

```
引擎层 registerBuiltinAIHandlers —— 操作 World（生成/销毁/变换/切场景/分数…）
编辑器层 registerEditorAIHandlers —— 操作编辑器选中与 gizmo（ai.selectActor / ai.dragActor）
```

两者互补：引擎处理器在游戏运行时生效；编辑器处理器在编辑态生效（选中/拖动 gizmo）。

## 5. 桥接架构

```
AI / MCP 服务器 → HTTP /api/... → 渲染进程 → AIModule.instance.emit()
引擎层处理器（registerBuiltinAIHandlers）→ World / GameInstance
编辑器层处理器（registerEditorAIHandlers）→ SelectionManager / TransformGizmo
```

- 模块不感知 MCP/编辑器实现，桥接在编辑器层完成（松耦合）
- 自定义事件：游戏代码 `AIModule.instance.register('ai.myEvent', handler)`，卸载用 `unregister`

## 6. 依赖关系

```
AIModule → World / GameInstance（注入上下文）
registerBuiltinAIHandlers → World（spawn/destroy/transform/score/switchScene）
registerEditorAIHandlers → SelectionManager / Gizmo（编辑器层）
Game.launch / Game.shutdown → AIModule.reset()（生命周期回收）
```
