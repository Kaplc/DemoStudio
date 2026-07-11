"""
core.assets — 资产模块 (类似 Unity 的 Asset System)
====================================================
提供基于 JSON 的 UI 布局描述、资产加载与资源管理功能。

核心组件:
    AssetManager     — 中央资产注册表，管理资产生命周期 (asset_manager.py)
    UILayoutLoader   — JSON→UI 控件树反序列化引擎 (ui_layout.py)
    UIBinder         — 事件绑定与数据绑定系统 (ui_binder.py)
    UIVariableResolver — 变量/主题引用解析器 (ui_layout.py)
    SchemaValidator  — JSON Schema 校验工具 (schema.py)

快速开始:
    from core.assets import AssetManager, UILayoutLoader

    mgr = AssetManager()
    loader = UILayoutLoader(mgr)

    # 从 JSON 文件加载 UI 布局
    root = loader.load_from_file('assets/layouts/main_menu.json')

    # 注册事件处理
    loader.bind_events({
        'start_btn': lambda: print('Start!'),
        'quit_btn': lambda: print('Quit!'),
    })

JSON 布局格式:
    {
        "$schema": "1.0",
        "metadata": { "name": "...", "version": "1.0" },
        "variables": { "my_color": "#ff0000" },
        "ui": {
            "type": "UIWindow",
            "id": "main_win",
            "title": "My Window",
            "anchor": "CENTER",
            "size": [0.4, 0.5],
            "children": [
                { "type": "UIButton", "id": "btn1", "text": "Click Me" }
            ]
        },
        "bindings": {
            "btn1": { "on_click": "handler_name" }
        }
    }
"""

from core.assets.asset_manager import AssetManager, AssetType, AssetInfo
from core.assets.ui_layout import UILayoutLoader, LayoutNode, UIVariableResolver
from core.assets.ui_binder import UIBinder
from core.assets.converters import (
    parse_color,
    parse_anchor,
    parse_vec2,
    resolve_theme_color,
    AnchorMap,
)
from core.assets.schema import (
    LAYOUT_SCHEMA,
    validate_layout,
    ValidationResult,
)

__all__ = [
    'AssetManager',
    'AssetType',
    'AssetInfo',
    'UILayoutLoader',
    'LayoutNode',
    'UIVariableResolver',
    'UIBinder',
    'parse_color',
    'parse_anchor',
    'parse_vec2',
    'resolve_theme_color',
    'AnchorMap',
    'LAYOUT_SCHEMA',
    'validate_layout',
    'ValidationResult',
]
