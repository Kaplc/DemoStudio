# Ursina API 兼容性参考（Ursina Reference）

> **一句话定位**：这是一份 **Ursina（Python 引擎）API 的对照参考**——DemoStudio 早期编辑器由 Ursina 编写，本文件保留其 API 全貌，供设计新 API 时对齐命名与语义。
>
> **什么时候会用到你**：设计/评审引擎新 API 想参照成熟引擎的命名时、读历史 Ursina 代码（如遗留编辑器脚本）要查 API 时、判断"某个 Ursina 能力在 DemoStudio 里对应什么"时、排查坐标系/旋转方向差异导致的对不齐问题时。
>
> 代码位置：**本文档不描述源码系统**，它是外部 API 的参考资料。历史 Ursina 代码见 `editor/editor_app.py.backup`；对照的引擎侧实现见 `src/engine/`。

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [editor_app.py.backup](../editor/editor_app.py.backup) | DemoStudio 早期 Ursina 编辑器实现（唯一留存的 Ursina 代码） | 查某个 Ursina API 在本项目里被怎么用过 |
| [SpriteComponent.ts](../../src/engine/rendering/SpriteComponent.ts) | 引擎侧 `Sprite` 对应物：2D 面片 | 对照 Ursina `Sprite` 的语义差异 |
| [TroikaTextComponent.ts](../../src/engine/rendering/TroikaTextComponent.ts) | 引擎侧 `Text` 对应物：文本渲染 | 对照 Ursina `Text` 的语义差异 |
| [UIButtonComponent.ts](../../src/engine/ui/UIButtonComponent.ts) | 引擎侧 `Button` 对应物：按钮状态机 | 对照 Ursina `Button` 的状态差异 |
| [ActorUtils.ts](../../src/engine/gameflow/ActorUtils.ts) | 引擎侧 `destroy()`/`scene` 对应物 | 对照 Ursina 实体增删 |

**关键心智模型**：本文档是**参考资料，不是系统文档**。`src/` 下**没有任何 Ursina 兼容层**——全仓 grep `ursina` 在 `src/` 与 `scripts/` 里零命中，唯一命中是 `editor/editor_app.py.backup`（遗留备份）。所以 Ursina API **不能直接调用**，它的价值是：设计新 API 时提供一个"成熟引擎是怎么命名和拆分职责"的参照系。

**第二个心智模型**：Ursina 用 `def update()` / `def input(key)` 这类**模块级函数 + 全局单例**组织；DemoStudio 用 **Actor + Component 组合 + 显式 Tick 派发**。这是两套世界观，对照时不要指望一一映射，要抓"职责"而不是"名字"。

---

## 2. 为什么会有这份文档：Ursina 与 DemoStudio 的关系

### 2.1 历史事实

DemoStudio 早期编辑器是用 Ursina 写的 Python 程序，`editor/editor_app.py.backup` 是它留下的唯一痕迹：

```python
from ursina import *

app = Ursina(
    title='DemoStudio Editor',
    borderless=False,
    vsync=True,
    editor_ui_enabled=False,
    development_mode=False,
)
window.size = window.windowed_size
window.center_on_screen()
```

它用 Ursina 的 `camera.ui` 归一化坐标系挂 UI，用 `window.size` 做像素换算，主循环是模块级 `update()` / `input(key)`：

```python
def update():
    """每帧检测：画布动画 + 游戏进程 + MCP + 控制台"""
    canvas_manager.update()
    check_game()
    check_mcp()
    if console:
        console.check_ipc()
        console.update(time.dt)


def input(key):
    """处理键盘输入，优先路由到控制台"""
    global console
    if key == '`':
        if console:
            console.toggle()
        return
    if console and console.enabled:
        console.handle_key(key)
        return
```

**为什么这段代码值得看**：它解释了 DemoStudio 现在若干设计的由来——编辑器控制台用反引号切换（`shortcut-toggle-console`）、控制台优先吃键盘事件、UI 走归一化坐标系（今天的 `canvas` + 锚点体系前身）。读它能避免"重新发明一遍还发明歪了"。

### 2.2 现状：Ursina 已被 Three.js + Electron 完全取代

`app.run()` 启动的 Ursina 主循环，今天对应的是 `World` 的每帧 Tick；`camera.ui` 对应 `CanvasUIComponent` + `UITransformComponent`。**迁移已经完成，没有回退路径**，也不再有 Python 运行时依赖（除 `editor/` 下的 MCP 服务）。

---

## 3. 对照表：Ursina API → DemoStudio 引擎

这是本文档的主体。左列 Ursina，右列 DemoStudio 对应物与语义差异。

### 3.1 实体与生命周期

| Ursina | DemoStudio | 差异 |
|---|---|---|
| `Entity(**kwargs)` | `Actor` 子类（`src/engine/entity/Actor.ts`） | Ursina 一个 `Entity` 类吃所有 kwarg；DemoStudio 用**组合**：Actor 挂 Component |
| `e.enabled` | `Actor.bActive` / `Component.bEnabled` | Ursina 单开关；DemoStudio Actor 与组件各有开关，`ThreeObjectComponent.setVisible` 取两者合取 |
| `destroy(entity, delay=0)` | `destroyActor(actor)`（`ActorUtils.ts:73`） | Ursina 支持延迟销毁；DemoStudio 无 delay 参数 |
| `scene.entities` | `getAllActors()`（`ActorUtils.ts`） | Ursina 是属性列表；DemoStudio 是查询函数 |
| `e.update = fn` / `def update()` | `override Tick(dt)` | Ursina 三种写法（赋值/继承/模块级）；DemoStudio **只有重写 `Tick` 一种**，且靠 `BObject.Tick` 遍历派发 |
| `duplicate(entity)` | 无对应 | 需自行实现克隆 |

**最大的世界观差异**：Ursina 的 `update` 可以挂在实体上、也可以写成模块级函数（全局每帧跑一次）；DemoStudio 没有"全局 update 函数"这种东西，一切每帧逻辑都必须是某个 Actor/Component 的 `Tick`，且**只有被 World 每帧调用到的对象才会 Tick**。

### 3.2 变换与坐标系

| Ursina | DemoStudio | 差异 |
|---|---|---|
| `e.position` / `.x/.y/.z` | `Actor.setPosition(x,y,z)`（`Actor.ts:237`）、`.position` 属性 | Ursina 直接改分量即生效；DemoStudio 有 setter 方法 |
| `e.rotation` / `.rotation_x/y/z` | `Actor.setRotation(x,y,z)`（`Actor.ts:241`） | 同上 |
| `e.scale` / `.scale_x/y/z` | `SpriteComponent.mesh.scale` / `setSize()` | DemoStudio 的缩放是**渲染组件**的事，不是 Actor 的 |
| `e.look_at(target)` | 无内置对应 | 需自行实现 |
| `e.world_position` | `Actor` 世界变换经 root 矩阵推导 | 概念一致 |
| `e.parent` | `Actor.children` / `attachTo` | Ursina 默认 `parent=scene`；DemoStudio 需显式挂 |

**坐标系差异（最容易踩）**：Ursina 右手系，`x` 右、`y` 上、`z` 前。它还有一条反直觉的旋转约定：

```
从轴外部向内看：x/y 轴顺时针为正，z 轴逆时针为正
可修改：Entity.rotation_directions = (-1, -1, 1)
```

`z` 轴与 `x`/`y` 反向，是**故意的**——为了让 2D 场景里的 `rotation_z` 表现为顺时针。DemoStudio 走 Three.js 标准右手系，没有这个反转。**从 Ursina 移植旋转代码时，`z` 分量必须取反**，否则炮台转向、飞船倾斜全都是反的。

UI 坐标系也不同：Ursina 的 `camera.ui` 是归一化 `-0.5 ~ 0.5`（`window.right = Vec2(0.5*aspect, 0)`）；DemoStudio 用 `canvas="宽x高"` 声明**像素画布**，编译期换算成米制（见 [UI 源格式](../editor/ui/ui_source_format_system.md)）。

### 3.3 渲染与控件

| Ursina | DemoStudio | 差异 |
|---|---|---|
| `Sprite(texture)` | `SpriteComponent`（`rendering/SpriteComponent.ts`） | Ursina 自动适配纹理尺寸；DemoStudio 共享单位几何 + `scale`，需显式尺寸 |
| `Text(text)` | `TroikaTextComponent`（`rendering/TroikaTextComponent.ts:66`） | Ursina 父级默认 `camera.ui`；DemoStudio 挂 Actor |
| `Button(text, ...)` | `UIButtonComponent`（`ui/UIButtonComponent.ts:41`） | 两者都有 hover/pressed 状态机 |
| `e.color = color.red` | `SpriteComponent.setColor()` / 材质 `color` | Ursina 有 `hsv()`/`rgb32()`/`hex()` 全家桶 |
| `e.texture` | `SpriteComponent.setTexture()` | DemoStudio 传路径走 `loadTexture` 缓存 |
| `e.animate('x', v, duration)` | 无内置补间 | 需用 Tween/脚本自行实现 |
| `e.shader = ...` | 无对应（材质由组件管理） | — |

**按钮状态机的关键差异**：Ursina 的 `Button` 有 `highlight_color`/`pressed_color`/`highlight_scale`/`pressed_scale`/声音等一整套状态配置。DemoStudio 的 `UIButtonComponent` 有状态机，但**状态色是通过编译期 CSS `:hover/:active/:disabled` 写进 `UIScript.args` 透传的**（见 [UI 源格式](../editor/ui/ui_source_format_system.md)），没有运行时 API 去设 `highlight_color`。

### 3.4 输入

| Ursina | DemoStudio | 差异 |
|---|---|---|
| `held_keys['d']` | 输入系统状态查询（见 [输入系统](./input_system.md)） | Ursina 是全局 dict；DemoStudio 走 InputComponent/InputSys |
| `def input(key)` | 输入事件回调 | Ursina 模块级函数；DemoStudio 由 PlayerController/组件接收 |
| `mouse.hovered_entity` | `CanvasUIComponent` 的 hitTest | 概念对应，实现不同 |
| `input_handler.bind('z','w')` | 输入映射配置 | 概念对应 |

Ursina 的 `held_keys` 是**全局字典**，任何地方都能读；DemoStudio 的输入状态不通过全局单例暴露，这是为了避免"任何代码都能改输入状态"的耦合。

---

## 4. 关键方法速查

Ursina 侧是外部 API（无行号）；DemoStudio 侧给真实位置，便于对照查阅。

| DemoStudio 方法 | 位置 | 对应 Ursina | 注意 |
|---|---|---|---|
| `Actor.setPosition(x,y,z)` | `Actor.ts:237` | `e.position` / `e.x/.y/.z` | 有独立 setter，非纯属性写 |
| `Actor.setRotation(x,y,z)` | `Actor.ts:241` | `e.rotation` / `e.rotation_z` | **旋转 z 方向与 Ursina 相反** |
| `Actor.Tick(dt)` | `Actor.ts:97` | `def update()` / `e.update` | 递归子 Actor |
| `BObject.Tick(dt)` | `BObject.ts:49` | `def update()`（模块级） | 遍历所有 `bEnabled` 组件派发 |
| `SpriteComponent.setOpacity(o)` | `SpriteComponent.ts:71` | `e.color` 的 alpha | `<1` 自动开 `transparent` |
| `SpriteComponent.setTexture(t)` | `SpriteComponent.ts:77` | `e.texture` | 传 string 才走缓存 |
| `SpriteComponent.mesh` | `SpriteComponent.ts:47` | `e`（Entity 自身即渲染物） | DemoStudio 渲染物在组件里 |
| `destroyActor(actor)` | `ActorUtils.ts:73` | `destroy(entity)` | 无 delay 参数 |
| `findActor(type)` | `ActorUtils.ts:96` | `scene.entities` 过滤 | 按类型查 |
| `UIButtonComponent` | `UIButtonComponent.ts:41` | `Button(...)` | 状态色走编译期 CSS 透传 |
| `TroikaTextComponent` | `TroikaTextComponent.ts:66` | `Text(...)` | — |
| `UITransformComponent` | `UITransformComponent.ts:56` | `e.origin` / UI 锚点 | 九宫格锚点体系 |
| `CanvasUIComponent` | `CanvasUIComponent.ts:69` | `camera.ui` | UI 层承载与 hitTest |

---

## 5. 流程影响：牵动哪些功能

Ursina 已不参与运行时，它的影响是**设计参考层面**的：影响"新 API 怎么命名/拆分"，不影响任何运行时链路。

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| 引擎 API 设计评审 | 新 API 命名/职责拆分时参照本文档的成熟引擎做法 | [系统总览](../system_overview.md) |
| 历史代码阅读 | 读 `editor_app.py.backup` 时查 API 语义 | [编辑器核心](../editor/core/core_system.md) |
| 坐标系/旋转约定讨论 | 判断与 Ursina 差异，避免移植出错 | [实体体系](./entity_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| 实体/组件体系 | Actor + Component 组合 vs Ursina 单 Entity；Tick 派发机制 | [实体体系](./entity_system.md) |
| 渲染系统 | `Sprite`/`Text` 的引擎对应物与"渲染物挂在组件里"的约定 | [渲染系统](./rendering_system.md) |
| 引擎 UI 系统 | `camera.ui` → `CanvasUIComponent` + 锚点体系；按钮状态机 | [引擎 UI 系统](./ui_system.md) |
| 输入系统 | `held_keys` 全局 dict → 受控输入状态，不暴露全局单例 | [输入系统](./input_system.md) |
| UI 源格式 | Ursina 归一化坐标 → `canvas` 像素画布 + 编译期米制换算 | [UI 源格式](../editor/ui/ui_source_format_system.md) |
| 游戏流 | Ursina `app.run()` 主循环 → `World` 每帧 Tick | [游戏流系统](./gameflow_system.md) |

---

## 6. 踩坑清单（都是真踩过的）

**1. 以为 Ursina API 能在 DemoStudio 里直接调用**

现象：照着本文档写 `Entity(model='cube')` 或 `destroy(e)`，编译/运行报错。原因：`src/` 与 `scripts/` 下全仓 grep `ursina` **零命中**，不存在任何兼容层；本文档是外部 API 参考。规则：Ursina API 只能作为**设计参照**，不能当调用清单；要能力先查右列的引擎对应物。

**2. 照抄 Ursina 的 `rotation_z`，转向全反了**

现象：从 Ursina 移植旋转逻辑后，物体绕 z 轴转向相反。原因：Ursina 刻意让 z 轴逆时针为正（为让 2D 的 `rotation_z` 呈顺时针），`Entity.rotation_directions = (-1,-1,1)`；DemoStudio 走 Three.js 标准约定无此反转。规则：移植旋转代码时 **z 分量取反**，`x`/`y` 保持不变。

**3. 以为"全局 update 函数"在 DemoStudio 里也存在**

现象：想写一个模块级 `update()` 做全局每帧逻辑，发现永不执行。原因：Ursina 支持模块级 `def update()` 自动每帧调用；DemoStudio 没有这回事，一切每帧逻辑必须是 Actor/Component 的 `Tick`，且由 `BObject.Tick` 遍历派发。规则：需要全局每帧逻辑就挂在 GameMode/GameInstance 上重写入 `Tick`。

**4. 以为 UI 坐标可以直接套用 Ursina 的 `-0.5 ~ 0.5`**

现象：按 Ursina 归一化坐标写 UI，元素位置全错。原因：Ursina 的 `camera.ui` 是归一化 `-0.5~0.5`；DemoStudio 用 `<widget canvas="宽x高">` 声明**像素画布**，编译期按根画布比例换算成米制。规则：UI 一律按 `canvas` 声明的像素尺寸写（见 [UI 源格式](../editor/ui/ui_source_format_system.md)），不要用归一化数值。

**5. 以为 `destroy()` 支持延迟销毁**

现象：移植 `destroy(entity, delay=0.5)` 后参数被忽略。原因：`destroyActor(actor)` 没有 delay 参数。规则：需要延迟销毁用定时器或延迟到下一帧的显式逻辑。

**6. 把 Ursina 的 `e.scale` 直接映射到 Actor**

现象：找 Actor 的 `scale` 属性找不到，或设了没效果。原因：Ursina 的 Entity 自身即渲染物，`scale` 在实体上；DemoStudio 的缩放属于**渲染组件**（`SpriteComponent.mesh.scale` / `setSize()`），Actor 只管位置旋转。规则：改视觉缩放找渲染组件，不要找 Actor。

---

## 7. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 想直接调用 Ursina API | 不存在兼容层，全仓 `src/` grep 无命中 | 查 §3 对照表找引擎对应物 |
| 移植 Ursina 旋转代码 | `z` 轴方向与 Ursina 相反，不取反则转向错误 | `z` 分量取反，`x`/`y` 不变 |
| 需要"全局每帧函数" | 无此机制 | 挂 GameMode/GameInstance 重写 `Tick` |
| 需要延迟销毁 | `destroyActor` 无 delay 参数 | 自行用定时器实现 |
| 需要属性补间动画 | 引擎无 `animate()` 对应物 | 用 Tween/脚本在 `Tick` 里插值 |
| 需要 Ursina 的 `highlight_color` 等按钮状态配置 | 无运行时 API | 用 CSS `:hover/:active/:disabled` 在编译期声明 |
| 需要 `e.combine()` 合并网格 | 无对应 | 需自行实现 |
| UI 坐标想用归一化值 | DemoStudio 用像素 canvas，不认归一化 | 按 `canvas` 声明的像素尺寸写 |
| 需要 `look_at` | 无内置对应 | 自行实现朝向计算 |
| 查某个 Ursina API 本项目是否用过 | 只有 `editor_app.py.backup` 一个文件 | 在该文件里 grep |
