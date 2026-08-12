# 渲染系统（Engine Rendering）

> Three.js 渲染体系：相机族、渲染组件、2D 合成器、纹理加载。
> 代码位置：`src/engine/rendering/`
> 相关文档：[系统总览](../system_overview.md)

## 1. 概述

渲染系统基于 Three.js 构建，提供：

- **相机族**：透视/正交相机、摄像机管理（跟随/缩放/绑定）
- **渲染组件**：Sprite / Mesh / Line / Light / 文本 / Canvas UI
- **2D 合成**：`Compositor2D` 在 3D 场景之上叠加 2D 面板层
- **渲染宿主**：`SceneRenderHost` 承载整个渲染树
- **资源管理**：`TextureLoader` 纹理加载与缓存

## 2. 核心类

### 相机

| 类 | 说明 |
|---|---|
| `CameraComponent` | 相机组件（含 `CameraMode`：透视/正交等） |
| `CameraActor` | 相机 Actor（继承 Actor，可置于场景） |
| `CameraRigComponent` | 摄像机绑定/跟随组件 |
| `CameraZoomComponent` | 摄像机缩放组件 |
| `PlayerCameraManager` | 玩家相机管理器（Game 视口主相机） |
| `UICamera` | UI 独立正交相机（屏幕空间，供 CanvasUI 层渲染） |

### 渲染组件

| 类 | 说明 |
|---|---|
| `SpriteComponent` | 2D 精灵渲染 |
| `MeshComponent` | 3D 网格渲染 |
| `LineComponent` | 线条渲染 |
| `LightComponent` | 灯光组件 |
| `TroikaTextComponent` | 文本渲染（troika-three-text） |
| `CanvasUIComponent` | Canvas 2D UI 渲染（世界内 UI 面板） |
| `CameraOverlayRenderer` | 相机叠加渲染层 |
| `ThreeObject` / `ThreeObjectComponent` | Three.js 对象封装基类 |

### 合成与宿主

| 类 | 说明 |
|---|---|
| `Compositor2D` | 2D 叠加合成层：同一 renderer 上第二个正交相机渲染，清 depth 不清 color，永远盖在 3D 之上 |
| `SceneRenderHost` | 渲染宿主（承载主场景/UI 场景/overlay 场景的渲染编排） |
| `TextureLoader` | 纹理加载与缓存（`loadTexture` / `clearTextureCache`） |

## 3. 设计要点

### 3.1 Compositor2D 原理

```
1. 主场景正常渲染（透视/正交相机）
2. 切换到 2D 覆盖层相机（正交，屏幕空间 NDC -1..1，z=0 叠加平面）
3. 清空 depth buffer，不清空 color buffer
4. 渲染 2D 叠加层（永远在 3D 场景之上）
```

用途：小地图、任务指引、HUD 面板等 2D UI 叠加。

### 3.2 双摄像机点击分流

- 世界层：主相机射线检测（3D 物体/建筑）
- UI 层：UI 相机平行射线检测（屏幕空间 UI 面板）
- 由 `PhySys` 按 `ClickableComponent.layer` 分流（见 [输入/物理/脚本系统](./input_physics_script_system.md)）

### 3.3 渲染器生命周期

- 游戏视口渲染器（`SceneRendererComponent`）由 Game 启动时从 `GameInstance.current.renderContainer` 取 DOM 创建，交给 World 持有
- 编辑器预览使用独立的 `PreviewSceneManager`（见 [编辑器视口系统](../editor/viewport_system.md)）

## 4. 依赖关系

```
SpriteComponent / MeshComponent → TextureLoader → 纹理资源
CanvasUIComponent → UICamera / UITransformComponent
Compositor2D → WebGLRenderer（主场景渲染后调用 render()）
SceneRendererComponent → SceneRenderHost
```

## 5. 资源释放

- `SceneGroup.dispose()` 释放几何体与材质（SceneLoader 收集）
- `clearTextureCache()` 清理纹理缓存
- 预览管理器均实现 `dispose()` 自动清理（渲染器/场景/材质）
