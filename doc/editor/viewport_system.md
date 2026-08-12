# 视口与场景系统（Editor Viewport）

> 编辑视口与游戏视口的渲染、输入路由与场景初始化。
> 代码位置：`src/editor/SceneViewport.ts` `src/editor/GameViewport.ts` `src/editor/SceneSetup.ts` `src/editor/SceneDefaults.ts`
> 相关文档：[系统总览](../system_overview.md) / [渲染系统](../engine/rendering_system.md)

## 1. 概述

编辑器提供两类视口：

| 视口 | 用途 | 渲染器 |
|---|---|---|
| **Scene 视口** | 编辑场景（fly 飞越 / orbit 轨道 + WASD 漫游） | `PreviewSceneManager` |
| **Game 视口** | 运行游戏预览 | `SceneRendererComponent`（Game 启动时创建） |

## 2. 核心模块

### Scene 视口（SceneViewport.ts）

| 函数/模块 | 说明 |
|---|---|
| `createSceneViewport(containerEl, sharedScene?)` | 创建 Scene 视口 PreviewSceneManager：controlMode='fly'、WASD 控制、`setCameraOrbit(45, 30, 20)` |
| `handleSceneKeyDown` | WASD/QE 飞越漫游键处理（`SCENE_WASD_KEYS`），返回是否消费 |
| `PreviewSceneManager` | 视口渲染器（fly 飞越摄像机 / orbit 轨道控制 + WASD 漫游），来自 `src/editor/asset/ScenePreviewManager.ts` |

### Game 视口（GameViewport.ts）

| 函数 | 说明 |
|---|---|
| `handleGameKeyDown` | 键盘按下 → `inst.inputSys.handleKeyDown(e.key, inst.controller)` |
| `handleGameKeyUp` | 键盘释放 → `inst.inputSys.handleKeyUp` |
| 鼠标路由 | 坐标转换 + InputSys 转发（不再直接调用 PlayerController） |

> 注意：Game 视口渲染器（SceneRendererComponent）由 Game 启动时从 `GameInstance.current.renderContainer` 取 DOM 创建并交给 World 持有，GameViewport 不再负责创建。

### 场景初始化（SceneSetup / SceneDefaults）

| 模块 | 说明 |
|---|---|
| `SceneSetup` | 编辑器场景初始化（共享 Scene 创建、默认内容装配） |
| `SceneDefaults` | 默认场景数据（初始相机、灯光、网格辅助等） |

## 3. 输入路由链

```
Scene 视口：WASD 键 → handleSceneKeyDown → PreviewSceneManager（漫游）
Game 视口：DOM 事件 → handleGameKeyDown/Up → GameInstance.inputSys
           → PhySys.raycastClick / PlayerController.OnPointerDownScreen
```

## 4. 渲染结构

```
编辑器渲染编排（SceneRenderHost）：
├── 主场景（sharedScene：场景资产内容 + 编辑器辅助）
├── UI 场景（uiScene：CanvasUI 世界内 UI）
└── overlay 场景（gizmo / 选中包围盒 / 把手 / 标签，永远最顶层）
```

## 5. 依赖关系

```
SceneViewport → PreviewSceneManager / OrbitControls / Compositor2D / LightComponent
GameViewport → Game / SceneRendererComponent / InputSys
SceneSetup → SceneDefaults / GenericActor（默认内容）
视口输入 → InputRouter / KeyboardShortcuts（编辑器级按键拦截）
```
