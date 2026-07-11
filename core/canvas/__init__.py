"""
core.canvas — UI 渲染画布框架
==============================
将 UI 资产 (JSON 布局) 自动渲染到摄像机上的完整框架。
参考 Unity 的 Canvas + Canvas Scaler 设计。

核心组件:
    UICanvas         — 单个画布: 加载资产 → 构建控件树 → 渲染到摄像机
    CanvasRoot       — 顶级画布根容器，始终填满屏幕
    CanvasManager    — 画布管理器: 多层画布切换/叠加/转场
    CanvasLayer      — 画布层级枚举
    CanvasSettings   — 画布配置

快速开始:
    from core.canvas import UICanvas

    # 一行代码渲染 UI
    canvas = UICanvas('assets/layouts/main_menu.json')
    canvas.show()

    # 绑定事件
    canvas.on('start_btn', 'click', lambda: print('start'))

    # 隐藏/切换
    canvas.hide()

    # 使用画布管理器
    from core.canvas import CanvasManager
    mgr = CanvasManager()
    mgr.open('menu')           # 打开菜单画布
    mgr.open('settings')       # 切换到设置画布 (自动隐藏 menu)
    mgr.pop()                  # 返回上一个画布

架构:
    ┌──────────────────────────────────────┐
    │            camera.ui                 │
    │  ┌────────┐  ┌────────┐  ┌────────┐ │
    │  │Canvas 1│  │Canvas 2│  │Canvas 3│ │  ← 渲染层 (Entity root)
    │  │ (main) │  │(dialog)│  │(toast) │ │
    │  └────────┘  └────────┘  └────────┘ │
    └──────────────────────────────────────┘
"""

from core.canvas.canvas import UICanvas, CanvasSettings, CanvasLayer, CanvasState
from core.canvas.canvas_root import CanvasRoot
from core.canvas.canvas_manager import CanvasManager

__all__ = [
    'UICanvas',
    'CanvasRoot',
    'CanvasManager',
    'CanvasSettings',
    'CanvasLayer',
    'CanvasState',
]
