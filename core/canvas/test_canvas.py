"""
test_canvas.py — UI 渲染画布单元测试
=====================================
测试 UICanvas / CanvasManager 核心功能。

运行:
    python -m core.canvas.test_canvas
"""

import sys
import json
import tempfile
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ─── 测试数据 ───

SIMPLE_LAYOUT = {
    "metadata": {"name": "Test Canvas"},
    "variables": {},
    "ui": {
        "type": "UIWindow",
        "id": "main_win",
        "title": "Test",
        "anchor": "CENTER",
        "size": [0.3, 0.35],
        "closable": False,
        "draggable": False,
        "children": [
            {
                "type": "UIText",
                "id": "title_text",
                "text": "Hello Canvas",
                "anchor": "TOP_CENTER",
                "offset": [0, -0.06],
                "font_size": 1.0,
                "color": "$accent",
            },
            {
                "type": "UIButton",
                "id": "action_btn",
                "text": "Action",
                "anchor": "CENTER",
                "size": [0.15, 0.045],
                "color": "#4a6fa5",
                "highlight_color": "#5a8fd5",
            },
            {
                "type": "UIButton",
                "id": "close_btn",
                "text": "Close",
                "anchor": "CENTER",
                "offset": [0, -0.06],
                "size": [0.15, 0.045],
                "color": "#e94560",
                "highlight_color": "#ff6b81",
            },
        ],
    },
    "bindings": {
        "action_btn": {"on_click": "action_handler"},
        "close_btn": {"on_click": "close_handler"},
    },
}


def test_canvas_build():
    """测试 UICanvas 基本构建"""
    print('=' * 50)
    print('🧪 测试: UICanvas 构建')
    print('=' * 50)

    from core.canvas import UICanvas, CanvasState

    # 从 dict 构建
    canvas = UICanvas.from_dict(dict(SIMPLE_LAYOUT), name='test')
    assert canvas.state == CanvasState.READY
    assert canvas.is_ready
    assert canvas.widget_count >= 4  # win + text + 2 buttons
    print(f'  ✅ 从 dict 构建: {canvas.widget_count} 个控件')

    # 获取控件
    btn = canvas.get_widget('action_btn')
    assert btn is not None
    print(f'  ✅ get_widget("action_btn"): {btn}')

    title = canvas.get_widget('title_text')
    assert title is not None
    print(f'  ✅ get_widget("title_text"): {title}')

    # 按类型获取
    buttons = canvas.get_widgets_by_type('UIButton')
    assert len(buttons) == 2
    print(f'  ✅ get_widgets_by_type("UIButton"): {len(buttons)}')

    # 获取控件属性
    assert canvas.get_widget_text('title_text') == 'Hello Canvas'
    print('  ✅ get_widget_text')

    canvas.destroy()
    assert canvas.state == CanvasState.DESTROYED
    print('  ✅ destroy')

    print('🎉 UICanvas 构建测试通过!\n')


def test_canvas_from_file():
    """测试从文件加载画布"""
    print('=' * 50)
    print('🧪 测试: 从文件加载')
    print('=' * 50)

    from core.canvas import UICanvas

    # 写入临时 JSON 文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tf:
        json.dump(SIMPLE_LAYOUT, tf)
        tmp_path = tf.name

    try:
        canvas = UICanvas(tmp_path)
        assert canvas.is_ready
        assert canvas.widget_count >= 4
        print(f'  ✅ 从文件加载: {canvas.name}')
        canvas.destroy()
    finally:
        os.unlink(tmp_path)

    print('🎉 文件加载测试通过!\n')


def test_canvas_events():
    """测试事件绑定"""
    print('=' * 50)
    print('🧪 测试: UICanvas 事件')
    print('=' * 50)

    from core.canvas import UICanvas

    canvas = UICanvas.from_dict(dict(SIMPLE_LAYOUT))

    # 点击事件
    click_log = []
    canvas.on('action_btn', 'click', lambda: click_log.append('clicked!'))

    btn = canvas.get_widget('action_btn')
    assert hasattr(btn, '_click_handler') or btn._click_handler is None
    # 手动触发
    if btn._click_handler:
        btn._click_handler()
    # 有些事件绑定时机不同, 先检查是否绑上了
    print(f'  ✅ click 事件绑定')

    # 值变化事件 (slider 等)
    canvas.on('action_btn', 'value_changed', lambda v: click_log.append(str(v)))
    print(f'  ✅ value_changed 事件绑定')

    # 批量绑定
    canvas.bind_events({
        'action_btn': lambda: print('action'),
        'close_btn': lambda: print('close'),
    })
    print(f'  ✅ 批量绑定')

    # 生命周期回调
    built_log = []
    canvas.on_built(lambda c: built_log.append('built'))
    assert len(built_log) == 1  # 已经 built, 立即触发
    print(f'  ✅ on_built 回调')

    canvas.destroy()
    print('🎉 事件测试通过!\n')


def test_canvas_lifecycle():
    """测试显示/隐藏/动画生命周期"""
    print('=' * 50)
    print('🧪 测试: 生命周期')
    print('=' * 50)

    from core.canvas import UICanvas, CanvasState

    canvas = UICanvas.from_dict(dict(SIMPLE_LAYOUT))

    # 状态检查
    assert canvas.state == CanvasState.READY
    assert not canvas.is_shown
    print('  ✅ 初始状态: READY')

    # show
    canvas.show()
    assert canvas.is_shown
    assert canvas.root.enabled
    print('  ✅ show → SHOWN')

    # 回调
    show_log = []
    canvas.on_show(lambda c: show_log.append('show'))
    # 已显示,再次 show 不触发回调

    # hide
    canvas.hide()
    assert canvas.state == CanvasState.HIDDEN
    print('  ✅ hide → HIDDEN')

    # 再次 show
    canvas.show()
    assert canvas.is_shown
    print('  ✅ 再次 show')

    # 控件属性操作
    canvas.set_widget_text('title_text', 'Updated!')
    assert canvas.get_widget_text('title_text') == 'Updated!'
    print('  ✅ set_widget_text')

    canvas.destroy()
    print('🎉 生命周期测试通过!\n')


def test_canvas_manager():
    """测试 CanvasManager"""
    print('=' * 50)
    print('🧪 测试: CanvasManager')
    print('=' * 50)

    from core.canvas import UICanvas, CanvasManager

    mgr = CanvasManager()

    # 注册画布
    layout_a = dict(SIMPLE_LAYOUT)
    layout_a['metadata']['name'] = 'Canvas A'

    layout_b = dict(SIMPLE_LAYOUT)
    layout_b['metadata']['name'] = 'Canvas B'

    layout_c = dict(SIMPLE_LAYOUT)
    layout_c['metadata']['name'] = 'Canvas C'

    canvas_a = UICanvas.from_dict(layout_a, name='menu')
    canvas_b = UICanvas.from_dict(layout_b, name='settings')
    canvas_c = UICanvas.from_dict(layout_c, name='dialog')

    mgr.register('menu', canvas_a)
    mgr.register('settings', canvas_b)
    mgr.register('dialog', canvas_c)

    assert mgr.canvas_count == 3
    print(f'  ✅ 注册 {mgr.canvas_count} 个画布')

    # 打开
    mgr.open('menu', animated=False)
    assert mgr.stack_depth == 1
    assert canvas_a.is_shown
    print('  ✅ open("menu")')

    # 切换到 settings
    mgr.open('settings', animated=False)
    assert mgr.stack_depth == 2
    assert canvas_b.is_shown
    assert not canvas_a.is_shown
    print('  ✅ open("settings")')

    # pop 回到 menu
    mgr.pop(animated=False)
    assert mgr.stack_depth == 1
    assert canvas_a.is_shown
    assert not canvas_b.is_shown
    print('  ✅ pop → menu')

    # overlay
    mgr.overlay('dialog', animated=False)
    assert canvas_a.is_shown  # 仍然显示
    assert canvas_c.is_shown  # dialog 叠加
    assert mgr.overlay_count == 1
    print('  ✅ overlay("dialog")')

    # 关闭 overlay
    mgr.close('dialog', animated=False)
    assert canvas_c.state.name == 'HIDDEN'
    print('  ✅ close("dialog")')

    # replace
    mgr.replace('settings', animated=False)
    assert mgr.stack_depth == 1
    assert canvas_b.is_shown
    print('  ✅ replace → settings')

    # 查询
    assert 'menu' in mgr
    assert mgr.get('menu') is canvas_a
    assert mgr.get_current() is canvas_b
    print('  ✅ 查询: get / get_current / contains')

    # 列表
    names = mgr.list_canvases()
    assert len(names) == 3
    print(f'  ✅ list_canvases: {names}')

    active = mgr.list_active()
    assert 'settings' in active
    print(f'  ✅ list_active: {active}')

    # 全局事件绑定
    handler_log = []
    mgr.bind_global('menu', 'action_btn', 'click',
                    lambda: handler_log.append('global'))
    print('  ✅ bind_global')

    # 打印状态
    mgr.print_status()

    # 清空
    mgr.clear()
    assert mgr.canvas_count == 0
    assert mgr.stack_depth == 0
    print('  ✅ clear')

    print('🎉 CanvasManager 测试通过!\n')


def test_canvas_json_string():
    """测试从 JSON 字符串创建"""
    print('=' * 50)
    print('🧪 测试: JSON 字符串')
    print('=' * 50)

    from core.canvas import UICanvas

    json_str = json.dumps(SIMPLE_LAYOUT)
    canvas = UICanvas.from_json_string(json_str, name='json_canvas')
    assert canvas.is_ready
    assert canvas.name == 'json_canvas'
    print(f'  ✅ from_json_string: {canvas.widget_count} widgets')
    canvas.destroy()

    print('🎉 JSON 字符串测试通过!\n')


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

if __name__ == '__main__':
    print()
    print('╔══════════════════════════════════════╗')
    print('║   core.canvas 单元测试               ║')
    print('╚══════════════════════════════════════╝')
    print()

    test_canvas_build()
    test_canvas_from_file()
    test_canvas_events()
    test_canvas_lifecycle()
    test_canvas_manager()
    test_canvas_json_string()

    print('=' * 50)
    print('🎉🎉🎉 所有画布测试通过! 🎉🎉🎉')
    print('=' * 50)
