"""
core.assets.tools — UI 资产编辑工具集
======================================
提供 Python API 来程序化地创建、修改和管理 UI 布局资产，
无需直接编辑 JSON 文件。类似 Unity 的 Editor Scripting。

工具概览:
    LayoutBuilder      — 链式 API 构建 UI 节点树 (比手写 JSON 更友好)
    LayoutPatcher      — 对已有 JSON 布局进行增/删/改节点
    LayoutMerger       — 合并/覆盖多个布局
    UIPresetLibrary    — 预制控件模板库
    dump_layout()      — 将布局打印/导出为可读格式
    batch_patch()      — 批量修改多个布局文件

快速开始:
    # ── 1. 用 Builder 从零构建 ──
    from core.assets.tools import LayoutBuilder

    builder = LayoutBuilder('my_menu', 'UIWindow')
    builder.set_title('Options').set_anchor('CENTER').set_size(0.3, 0.4)
    builder.add_child('start_btn', 'UIButton').set_text('Start')
    builder.add_child('quit_btn', 'UIButton').set_text('Quit')
    builder.save('assets/layouts/my_menu.json')

    # ── 2. 用 Patcher 修改已有布局 ──
    from core.assets.tools import LayoutPatcher

    patcher = LayoutPatcher('assets/layouts/main_menu.json')
    patcher.set_prop('start_btn', 'text', '▶ Launch')
    patcher.set_prop('start_btn', 'color', '#4a9f6a')
    patcher.add_binding('start_btn', 'on_click', 'launch_game')
    patcher.save()

    # ── 3. 使用预制模板 ──
    from core.assets.tools import UIPresetLibrary

    btn = UIPresetLibrary.accent_button('Confirm', 'confirm_btn')
    patcher.add_widget_node(btn, parent_id='main_win')

    # ── 4. 合并布局 ──
    from core.assets.tools import LayoutMerger

    merger = LayoutMerger()
    merger.merge_file('base.json', 'overlay.json', 'merged.json')
"""

from core.assets.tools.layout_builder import LayoutBuilder, build_from_dict
from core.assets.tools.layout_patcher import LayoutPatcher
from core.assets.tools.layout_merger import LayoutMerger
from core.assets.tools.layout_presets import UIPresetLibrary
from core.assets.tools.ui_cli import (
    dump_layout,
    list_widgets,
    batch_patch,
    print_hierarchy,
)

__all__ = [
    'LayoutBuilder',
    'build_from_dict',
    'LayoutPatcher',
    'LayoutMerger',
    'UIPresetLibrary',
    'dump_layout',
    'list_widgets',
    'batch_patch',
    'print_hierarchy',
]
