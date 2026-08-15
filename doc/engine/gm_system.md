# GM 命令系统（Engine GM）

> 引擎级通用 GM 调试命令系统：项目开发者只需在项目专用文件夹下新增一个 `*.gm.ts` 脚本文件即可自动注册新命令；每个游戏项目拥有自己独立的命令集；提供游戏内 GM 控制台面板、AI 桥接两种触发渠道。
> 代码位置：`src/engine/gm/`（核心）+ `src/projects/<项目>/gameplay/gm/*.gm.ts`（项目命令）
> 相关文档：[系统总览](../system_overview.md) / [AI 事件系统](./ai_system.md) / [游戏流程](./gameflow_system.md) / [世界 UI](./ui_system.md)

## 1. 概述

GM（Game Master）命令系统是引擎层的调试基础设施，让项目开发者在**运行时**注入资源、修改状态、触发结算等，无需改代码、无需重启游戏。它把"命令定义"与"命令执行"完全解耦：

- **命令定义（数据驱动）**：每条命令是一个 `*.gm.ts` 文件，默认导出一个 `GMCommandDef` 对象。项目 `register.ts` 里一行 `import.meta.glob` 自动扫描注册，**新增命令零注册代码**。
- **命令执行（实例模块）**：`GMModule` 挂载在 `GameInstance` 基类上（`readonly gm`），解析"命令名 参数..."文本行 → 校验 → 类型转换 → 同步调 handler，结果统一为 `{ ok, message }`。
- **两种触发渠道**：游戏内控制台面板（`GMConsoleHUD`，G+M 打开）与 AI/MCP 桥接（`ai.gmCommand` 事件），两者最终都走 `GMModule.execute`。

| 角色 | 干什么 | 代码位置 |
|---|---|---|
| `GMCommand.ts` | 命令类型定义 + 参数类型转换 + 用法格式化 | `src/engine/gm/GMCommand.ts` |
| `GMRegistry` | 静态注册表（id → def 映射，glob 批量注册） | `src/engine/gm/GMRegistry.ts` |
| `GMModule` | 实例模块：execute / enabled 开关 / 控制台开关 / 全局键盘钩子 | `src/engine/gm/GMModule.ts` |
| `GMConsoleHUD` | 游戏内控制台面板（代码拼装 HUD） | `src/engine/gm/GMConsoleHUD.ts` |
| `UITextInputComponent` | 引擎文本输入组件（控制台输入框） | `src/engine/ui/UITextInputComponent.ts` |
| `registerBuiltinGMCommands` | 内置命令 help/list/clear/gm.enable/gm.disable | `src/engine/gm/builtin/` |
| `registerGMBridge` | `ai.gmCommand` AI 事件桥接 | `src/engine/gm/registerGMBridge.ts` |
| 项目 `*.gm.ts` | 各项目自己的命令集（fish 示例见 §3.4） | `src/projects/<项目>/gameplay/gm/` |

与相邻功能的边界：**命令怎么执行**归本文档；**AI 事件总线本身**归 [AI 事件系统](./ai_system.md)（`ai.gmCommand` 只是其上注册的一个事件）；**控制台面板怎么拼 UI** 用的是 [世界 UI](./ui_system.md) 的标准组件，本文档只描述面板结构。

## 2. 核心类 / 模块

| 类 / 模块 | 说明 |
|---|---|
| `GMCommandDef` | 一条命令的定义：`name`（调用名，唯一）、`description`、`gmOnly?`、`params?`、`handler`。`gmOnly: true` 的命令在 GM 开关关闭时被拒 |
| `GMCommandParam` | 命令参数声明：`name` / `type`（`'int' | 'float' | 'string' | 'bool'`）/ `required?`（默认 true）/ `desc?` / `default?` |
| `GMCommandContext` | 传给 handler 的上下文：`gameInstance`（实际为项目子类实例）、`output(text)`（输出通道）、`logger` |
| `GMRegistry` | 静态注册表：`register` / `get` / `getAll` / `findByName` / `clearAll` / `registerProjectGlob` |
| `GMModule` | 实例级执行模块：`execute(line, out?)`、`enabled` 开关、`openConsole/closeConsole/toggleConsole/clearConsoleOutput`、`consoleOpen`、静态 `handleGlobalKeyDown/Up`（全局键盘钩子）、`dispose()` |
| `GMConsoleHUD` | 控制台面板**基类**（继承 `HUD`，`isUIActor` 天然成立）：`buildUI()` 拼装控件树（可覆写），工具 `makeActor/makeText`，标题栏、命令列表、输出区（12 行滚动）、输入框，开建闭毁 |
| `UITextInputComponent` | 文本输入组件（继承 `UITextComponent`）：`value` / `focus()` / `blur()` / `clear()` / `handleKey(key)` / `onSubmit` 回调；聚焦时显示 `值|` 光标，失焦空值时显示灰色占位 |

## 3. 使用方法

### 3.1 写一条项目命令（唯一必要操作）

在项目专用文件夹 `src/projects/<项目>/gameplay/gm/` 下新建 `xxx.gm.ts`：

```ts
import type { GMCommandDef } from '@/engine'

export default {
  name: 'addCoins',                          // 调用名（控制台 / AI 都用它）
  description: '增加金币（走资源组件，基地 HUD 同步）',
  params: [
    { name: 'amount', type: 'int', required: true, desc: '金币数量' },
  ],
  handler: (ctx, amount) => {
    // ctx.gameInstance 是项目 GameInstance 子类实例（可安全 as 项目类型访问项目能力）
    const inst = ctx.gameInstance as unknown as {
      resources: { add: (r: string, n: number) => void }
    }
    inst.resources.add('coins', amount as number)
    ctx.output(`金币 +${amount}`)             // 输出到控制台 / 回传 AI
  },
} as GMCommandDef
```

### 3.2 项目注册（一行，fish 已做）

`src/projects/<项目>/register.ts` 中：

```ts
GMRegistry.registerProjectGlob(
  import.meta.glob('./gameplay/gm/*.gm.ts', { eager: true }),
)
```

之后新增 `*.gm.ts` 文件**无需再改任何注册代码**。命令 id 由文件路径推导：`./gameplay/gm/addCoins.gm.ts` → `gameplay/gm/addCoins`（不同项目 id 前缀不同，互不覆盖）。

### 3.3 触发命令

**渠道 A — 游戏内控制台**：游戏运行中按 `G+M` 打开面板 → 输入 `addCoins 100` → Enter。`Esc` 关闭；面板打开期间键盘事件被输入框消费，不穿透游戏。

**渠道 B — AI / MCP 桥接**：

```ts
AIModule.instance.emit('ai.gmCommand', { command: 'addCoins', args: ['100'] })
// → { ok: true, message: '金币 +100（当前 200）' }（message 为 handler ctx.output 收集）
```

**渠道 C — 直接调用**（代码内）：

```ts
const r = gameInstance.gm.execute('addCoins 100')
// → { ok: boolean, message: string }
```

### 3.4 fish 项目已提供命令

| 命令 | 参数 | 说明 |
|---|---|---|
| `addCoins` | `amount:int` | 增加金币（走资源组件，HUD 同步） |
| `addElixir` | `amount:int` | 增加药水 |
| `addTroop` | `troopId:string` `count:int` | 绕过训练队列直接注入军队 |
| `unlockBattle` | — | 战斗全解锁：每个兵种注入 999 军队（仅战斗关卡阶段，经 `world.gameMode` 校验 FishLevelGameMode） |
| `winLevel` | — | 当前战斗关卡直接判胜（仅战斗关卡阶段） |
| `clearEnemies` | — | 清除当前战斗全部敌方建筑（仅战斗关卡阶段） |
| `help` / `list` / `clear` | — | 内置：命令列表 / 清空控制台输出 |
| `gm.enable` / `gm.disable` | — | 内置：GM 开关（`gm.disable` 自身 `gmOnly: true`） |

### 3.5 使用前提

- 命令 handler 只在**游戏运行中**执行（AI 桥接用 `GameInstance.current` 守卫，未运行返回 `{ ok: false, message: 'GM 命令需要游戏运行中' }`）
- 内置命令与桥接在 `registerAllProjectModules`（`src/projects/registry.ts`）中全局注册一次，项目命令在项目 `register.ts` 中注册
- 项目命令 handler 访问项目能力用 **duck-typed / `as unknown as`** 方式（避免引擎层 import 项目类造成循环依赖）

### 3.6 项目自定义控制台面板（可选）

每个项目可继承 `GMConsoleHUD` 基类构建自己的面板风格，**推荐资产驱动**（面板定义为 widget 资产，改样式不动代码）：

```ts
// src/projects/<项目>/gameplay/gm/MyGMConsoleHUD.ts
import { GMConsoleHUD, type GMModule } from '@/engine'

export class MyGMConsoleHUD extends GMConsoleHUD {
  constructor(gm: GMModule) {
    super(gm)
  }

  // 覆写 getter（基类构造内多态生效；实例字段在 super() 返回后才初始化，不能用字段）
  protected override get panelAssetPath(): string | null {
    return 'asset/blueprints/ui/gm_panel.widget.json'
  }

  protected override get readyMessage(): string {
    return '⚔️ ClashMaster GM 控制台已就绪（输入 help 查看全部命令）'
  }
}
```

注册（项目 `register.ts`）：

```ts
GMModule.setConsoleFactory((gm) => new MyGMConsoleHUD(gm))
```

**资产驱动流程**：基类构造时 `loadPanelFromAsset()`：`spawnUIActor(panelAssetPath)` 生成通用节点树 → `attachTo` 本根（根 HUD 引用通用节点）→ 递归整树 zOrder 统一 + `GM_ZORDER_BASE`（资产只写相对层级 0~3；运行中 spawnUIActor 已 +FLOAT_LAYER_BIAS(100)，再加基数后 1100+ 仍保证最顶层）→ 按**组件定义顶层 name** 绑定输出区（`GM_OutputText`）与输入框（`GM_InputText`，挂 Enter 提交回调）与命令列表（`GM_HelpText`，运行时填 `buildHelpText()`）。

**资产要求**（`asset/blueprints/ui/gm_panel.widget.json`）：
- zOrder 写相对层级 0~3（遮罩 0 / 面板图片 1 / 文本 2~3），绝对基数由基类保证
- 绑定组件 **name 必须写在组件定义顶层**（与 `baseClass` 同级）：`{ "baseClass": "UITextComponent", "name": "GM_OutputText", ... }`——`spawnUIActor` 只读 `cdef.name`，`properties.name` 不生效
- 组件可用：`UITransformComponent / CanvasUIComponent / UIImageComponent / UITextComponent / UITextInputComponent / UIButtonComponent`（输入框组件已注册进 ComponentRegistry 并有 assetLint checker）

**命令按钮 + 发送按钮（运行时绑定）**：
- `GM_CmdList` 容器节点：挂 `UIScrollListComponent`（`itemWidget: asset/blueprints/ui/gm_cmd_item.blueprint.json`、`itemSize [2.7,0.24]`、`spacing 0.02`、`direction vertical`；**不配 `visibleCount`**——组件按容器尺寸自动推导可视数量，**只有命令超框才能滚动**），基类 `buildCommandButtons()` 遍历 `GMRegistry.getAll()` 设置 `list.totalCount = 命令数`，item 经对象池复用（`onItemSpawned` 填充命令名文本 + 绑定点击 → 命令名填入输入框并聚焦；赋值后补 `list.refresh()` 让初始 item 立即渲染文本）；命令多出可视区时滚轮滚动（向下滚看后面命令），超界 item 自动隐藏；新增 `*.gm.ts` 命令自动出现在按钮列表
- **item 蓝图**：`gm_cmd_item.blueprint.json`（`UITransform` anchor center offset `[0,1.2]` 2.7×0.24 + `CanvasUIComponent` marker zOrder 2 + `UIImageComponent` #1a1028 radius 6 540×48 zOrder 2 + `UITextComponent` CmdLabel font 13 #e8d8a8 500×40 zOrder 3 + `UIButtonComponent`）
- `GM_SendBtn` 按钮节点（`UIButtonComponent`）：点击 → `submitInput()`（执行输入框内容 → 回显 → 清空 → 重新聚焦）；Enter 提交与发送按钮共用 `submitInput()`
- 定位用 `findActorByName`（⚠️ 比较 `root.root.name`——`spawnUIActor` 只设置 Group 名，`Actor.name` 恒为类名）

**命令搜索（模糊过滤）**：面板可配置搜索框（资产节点 `GM_SearchInput`，挂 `UITextInputComponent`；程序化兜底面板为 `GM_SearchBox`），基类 `applySearchFilter(query)` 按**命令 name / 注册 id（路径式）/ description** 小写包含模糊匹配，实时刷新 `GM_CmdList` 的 `totalCount` 并回到顶部；空词恢复全量。**Tab 键**在搜索框/输入框间切换焦点（`handleInputKey` 内处理，焦点所在框接收全部可打印键），面板打开默认聚焦输入框。搜索框缺失时仅 warn 不失败（跳过搜索能力）。

**滚轮接线**：`Viewport` Game canvas wheel → `InputRouter.handleWheel` → `GameViewport.handleGameWheel` → `InputSys.handleScroll(delta)` → `GMModule.handleGlobalScroll`（面板打开 → 转发 `GMConsoleHUD.handleScroll`，返回 true 消费不穿透游戏）→ `_cmdList.scrollBy(delta > 0 ? 1 : -1)`。方向约定：滚轮向下（deltaY>0）= 看后面的命令（offset 增加）；越界由组件钳制（offset ≥ 0 且 ≤ totalCount - visibleCount）。

**兜底**：资产缺失/解析失败/缺少关键组件 → `loadPanelFromAsset()` 返回 false → 回退程序化 `buildUI()`（引擎默认样式，兼容旧子类覆写 buildUI 的方式）。

- 基类能力：`buildUI()`（程序化兜底入口）、`makeActor/makeText`（控件工具）、`gm/input/output`（protected 访问器）、`appendOutput/clearOutput/handleInputKey`（行为方法）、`GM_ZORDER_BASE/GM_TEXT_LAYER`（层级常量）、`panelAssetPath/readyMessage`（getter 覆写点）
- fish 已实现 `FishGMConsoleHUD`（`gameplay/gm/`，部落冲突主题资产：暗紫面板 + 部落金描边 + 亮金标题，就绪消息 `⚔️ ClashMaster GM 控制台已就绪`）

## 4. 工作流程

### 4.1 主流程

```mermaid
flowchart TD
    A[控制台输入框 Enter<br/>或 ai.gmCommand 事件] --> B[GMModule.execute line]
    B --> C[拆词: 命令名 + 原始参数]
    C --> D{GMRegistry.findByName}
    D -->|未找到| E[返回 未知命令 + 提示 help]
    D -->|找到| F{gmOnly 且 enabled=false?}
    F -->|是| G[返回 需 gm.enable]
    F -->|否| H[逐参数 convertGMArg 类型转换<br/>缺参用 default / 报参数不足]
    H -->|转换失败| I[返回 参数错误 + 用法]
    H -->|成功| J[handler ctx, ...args 同步执行]
    J -->|异常| K[catch → logger.error + 返回失败]
    J -->|正常| L[handler 内 ctx.output 输出<br/>返回 { ok: true, message }]
    L --> M[控制台回显 > line + message<br/>/ 结果回传 AI]
```

### 4.2 分阶段说明

| 阶段 | 触发点 | 关键调用 | 产物 |
|---|---|---|---|
| 注册 | 引擎初始化 `registerAllProjectModules` | `registerGMBridge()` + `registerBuiltinGMCommands()` | 内置命令 + ai.gmCommand 处理器 |
| 项目注册 | 项目 `register.ts` | `GMRegistry.registerProjectGlob(import.meta.glob(...))` | 项目命令进注册表（id 带路径前缀） |
| 键盘钩子 | 每帧 `InputSys.handleKeyDown` | `GMModule.handleGlobalKeyDown(key)` 最前拦截 | 控制台打开时按键被消费，不转发游戏 |
| 执行 | 输入框 `onSubmit` / `ai.gmCommand` | `GMModule.execute(line)` | `{ ok, message }` |
| 销毁 | `GameInstance.teardown()` | `this.gm.dispose()` | 关闭面板、清理键盘钩子状态 |

### 4.3 设计要点

- **数据流向**：`*.gm.ts` 默认导出 → `GMRegistry`（静态注册表）→ `GMModule.execute`（按 name 查表）→ 项目 `handler` → `ctx.output` / 返回值 → 控制台回显 / AI 回传。
- **双渠道归一**：控制台与 AI 桥接不各写一套执行逻辑，两者都拼成文本行交给 `GMModule.execute`；执行结果统一 `GMExecuteResult { ok, message }`。AI 桥接额外收集 handler 的 `ctx.output` 文本拼进 `message` 回传（AI 可读命令实际输出），控制台则直接回显。
- **面板挂当前 HUD 下**：`openConsole` 生成 `GMConsoleHUD` 后 `attachTo(world.ui.hud)`——UI 大纲层级归位（HUD → GMConsoleHUD），并随场景切换与 HUD 一同回收；无 HUD 时保持独立顶层（如纯菜单阶段）。面板被外部销毁时 `EndPlay` 回调 `notifyConsoleDestroyed` 清空 `GMModule._console` 引用，避免悬空。
- **始终最顶层 + 点击不穿透**：`GMConsoleHUD` 所有渲染组件 zOrder 加 `GM_ZORDER_BASE=1000` 基数（盖过任何浮动面板），根画布 `hitTest:'block'` 拦截点击（穿透到后面面板/世界）。引擎通用能力见 [CanvasUIComponent 组件文档](./ui_canvas_component.md)。
- **引擎层零依赖项目代码**：`src/engine/gm/` 不 import 任何 `src/projects/` 文件；命令 handler 里经 `ctx.gameInstance` duck-typed 访问项目子类能力。`GMModule` 对 `GameInstance` 用值导入（仅方法体运行时访问），避免循环依赖。
- **注册幂等**：`registerProjectGlob` 同 id 覆盖 + warn，HMR 重载不产生重复条目；`registerGMBridge` 每次先 `clearEvent('ai.gmCommand')` 再注册。
- **每项目独立命令集**：glob 从项目目录出发，id 天然带项目内路径前缀（`gameplay/gm/addCoins`），不同项目的同名文件互不覆盖。

## 5. 边界条件

| 条件 | 行为/后果 | 处理方式 |
|---|---|---|
| 空命令 / 空白行 | 返回 `空命令（输入 help 查看全部命令）`，不抛异常 | 引擎内置 |
| 未知命令名 | `logger.warn` + 返回提示（含 help 引导） | 检查命令文件是否在 glob 目录、`name` 是否拼错 |
| `gmOnly` 命令且 GM 开关关闭 | 被拒：`GM 模式未开启: X（输入 gm.enable 开启）` | 先执行 `gm.enable` |
| 必填参数缺失 | 报错并附 `formatGMUsage(def)` 完整用法 | 按用法补参数 |
| 参数类型非法（如 int 收到非数字） | `convertGMArg` 返回 null → 报错附用法 | 修正参数 |
| handler 抛异常 | `catch` → `logger.error` + `{ ok: false, message }`，不中断游戏循环 | 检查命令 handler 实现 |
| 命令模块无默认导出 / 缺 name/description | `registerProjectGlob` warn 并**跳过该文件** | 检查导出结构 |
| 调用名重名 | `findByName` 返回第一个，注册时已 warn | 避免同项目内 name 重复 |
| AI 桥接游戏未运行 | `{ ok: false, message: 'GM 命令需要游戏运行中' }` | 先 launch 游戏 |
| 命令 handler **必须同步** | 无 async 支持，Promise 返回值不会等待 | 已知限制：避免在 handler 里 await |
| 命令执行没有时间缩放 | 按正常游戏 tick 生效，无 timeScale 通道 | 已知限制 |
| 控制台输出上限 | `GMConsoleHUD` 最多保留 12 行，超出滚动丢弃最旧 | 引擎内置 |
| 面板打开期间 | 所有键盘事件被输入框消费（含 Esc 关闭），不穿透游戏 | 引擎内置 |

## 6. 依赖关系 / 注册机制

```
InputSys.handleKeyDown ──→ GMModule.handleGlobalKeyDown（最前拦截，消费则 return 不转发游戏）
GameInstance ── readonly gm: GMModule ──→ GMRegistry（查命令）──→ GMConsoleHUD（面板，开建闭毁）
GameInstance.teardown ──→ gm.dispose()
AIModule ── 'ai.gmCommand' ──→ registerGMBridge ──→ GameInstance.current.gm.execute
```

- 注册链路：`registry.ts` 的 `registerAllProjectModules` 全局注册内置命令与 AI 桥接；各项目 `register.ts` 用 `import.meta.glob` 注册自己的命令集（与 `ScriptRegistry` 同风格，参见 [输入/物理/脚本](./input_physics_script_system.md)）。
- 控制台面板复用 [世界 UI](./ui_system.md) 组件（`UITransform` / `CanvasUI` / `UIText` / `UITextInput`），继承 `HUD`，由 `GMModule` 开建闭毁。

## 7. 踩坑记录 / 历史决策

| 现象 | 原因 | 约束 |
|---|---|---|
| `GMConsoleHUD` 根 `UITransform` 传 `anchor: null` 类型报错 | `UITransformComponentOptions` 不接收 `null` | 不传 `anchor` 字段即默认锚点 |
| 想给 `UITextComponent` 传 `name` 选项报错 | `UITextComponentOptions` 无 `name` 选项 | 创建后 `comp.name = 'xxx'` 赋值 |
| `GMModule` ↔ `GameInstance` 模块顶层互相 import 形成循环 | ESM 顶层求值顺序 | `GMModule` 值导入 `GameInstance`，仅方法体运行时访问 |
| 命令 handler import 项目类（如 `FishGameInstance`）导致引擎层依赖项目 | 分层违规 | handler 一律 duck-typed 访问 `ctx.gameInstance` |
