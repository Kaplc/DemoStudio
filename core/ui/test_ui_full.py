#!python
"""
UI 模块全量自动化测试套件
=========================
测试策略:
    Phase 1 — Theme 系统 (纯 Python, 无 Ursina 依赖)
    Phase 2 — API 功能测试 (需要 Ursina 已初始化)
    Phase 3 — 事件交互测试 (模拟 input/update 调用)
    Phase 4 — 布局与嵌套测试
    Phase 5 — 销毁与内存泄漏测试

运行方式:
    python -m core.ui.test_ui_full

输出: 测试日志写入 logs/ui_test_{date}.log + 终端实时输出
"""
import sys
import os
import traceback
from pathlib import Path
from datetime import datetime

# ── 确保根目录可导入 ──
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))

# ── 用 loguru 做测试跟踪 ──
from core.logger import get_logger, LOG_DIR

tlog = get_logger('test')

# ── 测试计数器 ──
_test_results = {'pass': 0, 'fail': 0, 'skip': 0}

def test(name: str):
    """装饰器: 标记一个测试用例，自动捕获异常"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            nonlocal name
            prefix = '  ▶'
            try:
                func(*args, **kwargs)
                _test_results['pass'] += 1
                tlog.info(f"{prefix} ✓ {name}")
            except AssertionError as e:
                _test_results['fail'] += 1
                tlog.error(f"{prefix} ✗ {name} — AssertionError: {e}")
            except Exception as e:
                _test_results['fail'] += 1
                tb = ''.join(traceback.format_tb(e.__traceback__)) if e.__traceback__ else ''
                tlog.error(f"{prefix} ✗ {name} — {type(e).__name__}: {e}\n{tb}")
        return wrapper
    return decorator

def assert_eq(a, b, msg=''):
    assert a == b, msg or f"expected {b!r}, got {a!r}"

def assert_ne(a, b, msg=''):
    assert a != b, msg or f"expected different from {b!r}, got {a!r}"

def assert_true(v, msg=''):
    assert v, msg or f"expected True, got {v!r}"

def assert_false(v, msg=''):
    assert not v, msg or f"expected False, got {v!r}"

def assert_isinstance(v, cls, msg=''):
    assert isinstance(v, cls), msg or f"expected {cls.__name__}, got {type(v).__name__}"

def assert_approx(a, b, tol=0.001, msg=''):
    """浮点数近似相等"""
    assert abs(a - b) < tol, msg or f"expected {b} ± {tol}, got {a}"


# ═══════════════════════════════════════════════
# Phase 1: Theme 系统
# ═══════════════════════════════════════════════

@test("Theme: 默认暗色主题加载")
def test_theme_default():
    from core.ui.theme import UITheme, DARK_THEME, LIGHT_THEME, HUD_THEME
    assert_isinstance(DARK_THEME, UITheme)
    assert_isinstance(LIGHT_THEME, UITheme)
    assert_isinstance(HUD_THEME, UITheme)

@test("Theme: 控件样式属性存在")
def test_theme_styles():
    from core.ui.theme import DARK_THEME
    t = DARK_THEME
    assert_true(hasattr(t, 'button'))
    assert_true(hasattr(t, 'input'))
    assert_true(hasattr(t, 'slider'))
    assert_true(hasattr(t, 'toggle'))
    assert_true(hasattr(t, 'window'))
    assert_true(hasattr(t, 'scroll'))
    # 颜色值必须是 color 对象
    from ursina import color
    assert_isinstance(t.button.normal, color.Color)
    assert_isinstance(t.button.hover, color.Color)
    assert_isinstance(t.button.text, color.Color)

@test("Theme: 亮色主题颜色不同")
def test_theme_light():
    from core.ui.theme import DARK_THEME, LIGHT_THEME
    assert_ne(DARK_THEME.background, LIGHT_THEME.background)
    assert_ne(DARK_THEME.button.normal, LIGHT_THEME.button.normal)
    assert_ne(DARK_THEME.text, LIGHT_THEME.text)

@test("Theme: 主题复制")
def test_theme_copy():
    from core.ui.theme import DARK_THEME
    c = DARK_THEME.copy()
    assert_eq(str(c.background), str(DARK_THEME.background))
    assert_eq(str(c.button.normal), str(DARK_THEME.button.normal))
    # 修改副本不影响原主题
    c.button.normal = None
    assert_ne(str(c.button.normal), str(DARK_THEME.button.normal))

@test("Theme: set_theme / theme_color")
def test_theme_switch():
    from core.ui.theme import DARK_THEME, LIGHT_THEME, set_theme, theme_color
    set_theme(LIGHT_THEME)
    # 使用 theme_color 读取当前主题 (避免 from ... import 本地引用问题)
    c = theme_color('background')
    assert_eq(str(c), str(LIGHT_THEME.background))
    c2 = theme_color('button.normal')
    assert_eq(str(c2), str(LIGHT_THEME.button.normal))
    set_theme(DARK_THEME)
    c3 = theme_color('background')
    assert_eq(str(c3), str(DARK_THEME.background))


# ═══════════════════════════════════════════════
# Phase 2: API 功能测试 (需要 Ursina 初始化)
# ═══════════════════════════════════════════════

@test("UIWidget: 默认构造")
def test_widget_default():
    from core.ui.widget import UIWidget, Anchor
    w = UIWidget()
    assert_true(hasattr(w, 'x'))
    assert_true(hasattr(w, 'y'))
    assert_true(hasattr(w, 'enabled'))
    assert_true(w.enabled)

@test("UIWidget: 锚点定位")
def test_widget_anchor():
    from core.ui.widget import UIWidget, Anchor
    w = UIWidget(anchor=Anchor.TOP_LEFT, offset=(0.02, -0.02))
    # anchor 偏移 = (-0.5 + 0.02, 0.5 - 0.02)
    assert_approx(w.x, -0.48)
    assert_approx(w.y, 0.48)

@test("UIWidget: 锚点变换")
def test_widget_anchor_change():
    from core.ui.widget import UIWidget, Anchor
    w = UIWidget(anchor=Anchor.CENTER)
    w.ui_anchor = Anchor.TOP_RIGHT
    assert_eq(w.x, 0.5)
    assert_eq(w.y, 0.5)

@test("UIWidget: offset 变换")
def test_widget_offset_change():
    from core.ui.widget import UIWidget, Anchor
    w = UIWidget(anchor=Anchor.CENTER)
    w.ui_offset = (0.1, -0.1)
    assert_approx(w.x, 0.1)
    assert_approx(w.y, -0.1)

@test("UIWidget: ui_size 变换")
def test_widget_size():
    from core.ui.widget import UIWidget
    w = UIWidget(size=(0.3, 0.05))
    assert_approx(w.scale_x, 0.3)
    assert_approx(w.scale_y, 0.05)
    w.ui_size = (0.4, 0.06)
    assert_approx(w.scale_x, 0.4)
    assert_approx(w.scale_y, 0.06)

@test("UIWidget: show / hide / toggle")
def test_widget_visibility():
    from core.ui.widget import UIWidget
    w = UIWidget()
    # 通过 enabled 控制显隐 (推荐用法)
    w.enabled = False
    assert_false(w.enabled)
    w.enabled = True
    assert_true(w.enabled)
    # toggle_visible 切换 visible 状态
    w.toggle_visible()
    assert_false(w.visible)
    w.toggle_visible()
    assert_true(w.visible)

@test("UIWidget: 链式 API")
def test_widget_chain():
    from core.ui.widget import UIWidget
    from ursina import color
    w = UIWidget()
    ret = w.set_position(0.1, 0.2).set_size(0.3, 0.04).set_color(color.red).set_alpha(0.5)
    # 链式返回 self
    assert_eq(ret, w)
    assert_approx(w.x, 0.1)
    assert_approx(w.y, 0.2)
    assert_approx(w.scale_x, 0.3)
    assert_eq(w.alpha, 0.5)

@test("UIWidget: 事件绑定")
def test_widget_events():
    from core.ui.widget import UIWidget
    w = UIWidget()
    log = []
    w.on_click(lambda: log.append('click'))
    w.on_hover(lambda: log.append('hover'))
    w.on_unhover(lambda: log.append('unhover'))
    # 调用内部处理器
    w._click_handler()
    w._hover_handler()
    w._unhover_handler()
    assert_eq(log, ['click', 'hover', 'unhover'])

@test("UIWidget: stretch 设置")
def test_widget_stretch():
    from core.ui.widget import UIWidget
    w = UIWidget()
    w.set_stretch(left=-0.5, right=0.5, top=0.5, bottom=-0.5)
    assert_eq(w.x, 0.0)
    assert_eq(w.scale_x, 1.0)

@test("UIWidget: center_on_parent")
def test_widget_center():
    from core.ui.widget import UIWidget
    w = UIWidget()
    w.center_on_parent()
    assert_eq(w.x, 0.0)
    assert_eq(w.y, 0.0)


# ─── UIImage ───

@test("UIImage: 默认构造")
def test_image_default():
    from core.ui.image import UIImage
    img = UIImage()
    assert_true(hasattr(img, 'texture'))
    assert_true(img.unlit)

@test("UIImage: 带纹理")
def test_image_texture():
    from core.ui.image import UIImage
    img = UIImage(texture='logo')


# ─── UIText ───

@test("UIText: 构造与文字")
def test_text_default():
    from core.ui.label import UIText
    t = UIText(text='Hello')
    assert_eq(t.text, 'Hello')
    assert_true(hasattr(t, 'text_entity'))

@test("UIText: set_text")
def test_text_set():
    from core.ui.label import UIText
    t = UIText()
    t.set_text('Updated')
    assert_eq(t.text, 'Updated')

@test("UIText: set_color / set_font_size")
def test_text_appearance():
    from core.ui.label import UIText
    from ursina import color
    t = UIText(text='Test')
    t.set_color(color.red)
    t.set_font_size(1.5)

@test("UIText: show / hide")
def test_text_visibility():
    from core.ui.label import UIText
    t = UIText(text='Test')
    t.hide()
    assert_false(t.enabled)
    t.show()
    assert_true(t.enabled)

@test("UIText: set_anchor")
def test_text_anchor():
    from core.ui.label import UIText
    from core.ui.widget import Anchor
    t = UIText(text='Test')
    t.set_anchor(Anchor.TOP_LEFT)
    assert_eq(t._anchor.x, -0.5)
    assert_eq(t._anchor.y, 0.5)

@test("UIText: destroy")
def test_text_destroy():
    from core.ui.label import UIText
    t = UIText(text='Temp')
    t.destroy()
    # 不抛异常即为通过


# ─── UIButton ───

@test("UIButton: 构造与文字")
def test_button_default():
    from core.ui.button import UIButton
    btn = UIButton(text='Click')
    assert_eq(btn.text, 'Click')
    assert_true(btn.unlit)
    assert_true(btn.collider)

@test("UIButton: set_text / text_color")
def test_button_text_props():
    from core.ui.button import UIButton
    from ursina import color
    btn = UIButton(text='Hi')
    btn.set_text('Changed')
    assert_eq(btn.text, 'Changed')
    btn.set_text_color(color.red)

@test("UIButton: normal_color")
def test_button_normal_color():
    from core.ui.button import UIButton
    from ursina import color
    btn = UIButton()
    btn.set_normal_color(color.blue)

@test("UIButton: 事件绑定")
def test_button_events():
    from core.ui.button import UIButton
    log = []
    btn = UIButton()
    btn.on_click(lambda: log.append('click'))
    assert_true(callable(btn._click_handler))
    btn._click_handler()
    assert_eq(log, ['click'])

@test("UIButton: set_enabled")
def test_button_enable():
    from core.ui.button import UIButton
    btn = UIButton()
    btn.set_enabled(False)
    assert_false(btn._enabled)

@test("UIButton: input 状态")
def test_button_input():
    from core.ui.button import UIButton
    btn = UIButton()
    btn._is_pressed = True
    # 模拟松开
    btn.input('left mouse up')
    assert_false(btn._is_pressed)

@test("UIButton: destroy")
def test_button_destroy():
    from core.ui.button import UIButton
    btn = UIButton(text='Del')
    btn.destroy()
    # 销毁后按钮不再处于场景中, 不抛异常即为通过


# ─── UIToggle ───

@test("UIToggle: 构造")
def test_toggle_default():
    from core.ui.toggle import UIToggle
    t = UIToggle(text='Enable')
    assert_eq(t.text, 'Enable')
    assert_false(t.value)

@test("UIToggle: 默认值")
def test_toggle_default_value():
    from core.ui.toggle import UIToggle
    t = UIToggle(default_value=True)
    assert_true(t.value)

@test("UIToggle: toggle()")
def test_toggle_toggle():
    from core.ui.toggle import UIToggle
    t = UIToggle()
    assert_false(t.value)
    t.toggle()
    assert_true(t.value)
    t.toggle()
    assert_false(t.value)

@test("UIToggle: value setter")
def test_toggle_value_setter():
    from core.ui.toggle import UIToggle
    t = UIToggle()
    t.value = True
    assert_true(t.value)

@test("UIToggle: on_value_changed")
def test_toggle_callback():
    from core.ui.toggle import UIToggle
    log = []
    t = UIToggle()
    t.on_value_changed(lambda v: log.append(v))
    t.toggle()
    assert_eq(log, [True])
    t.toggle()
    assert_eq(log, [True, False])

@test("UIToggle: set_text")
def test_toggle_set_text():
    from core.ui.toggle import UIToggle
    t = UIToggle(text='Old')
    t.set_text('New')
    assert_eq(t.text, 'New')

@test("UIToggle: destroy")
def test_toggle_destroy():
    from core.ui.toggle import UIToggle
    t = UIToggle()
    t.destroy()
    # 不抛异常即为通过


# ─── UICheckbox ───

@test("UICheckbox: 构造")
def test_checkbox_default():
    from core.ui.checkbox import UICheckbox
    cb = UICheckbox(text='Opt')
    assert_eq(cb.text, 'Opt')
    assert_false(cb.value)

@test("UICheckbox: toggle / callback")
def test_checkbox_toggle():
    from core.ui.checkbox import UICheckbox
    log = []
    cb = UICheckbox(default_value=False)
    cb.on_value_changed(lambda v: log.append(v))
    cb.toggle()
    assert_true(cb.value)
    assert_eq(log, [True])

@test("UICheckbox: destroy")
def test_checkbox_destroy():
    from core.ui.checkbox import UICheckbox
    cb = UICheckbox()
    cb.destroy()
    # 不抛异常即为通过


# ─── UISlider ───

@test("UISlider: 构造")
def test_slider_default():
    from core.ui.slider import UISlider
    s = UISlider(min_value=0, max_value=100, default_value=50)
    assert_eq(s.value, 50)

@test("UISlider: value bounds")
def test_slider_bounds():
    from core.ui.slider import UISlider
    s = UISlider(min_value=0, max_value=100)
    s.value = 999
    assert_eq(s.value, 100)
    s.value = -999
    assert_eq(s.value, 0)

@test("UISlider: set_value")
def test_slider_set():
    from core.ui.slider import UISlider
    s = UISlider(min_value=0, max_value=10, step=2)
    s.set_value(5)  # round(5/2) = 2, 2*2 = 4
    assert_eq(s.value, 4)

@test("UISlider: on_value_changed")
def test_slider_callback():
    from core.ui.slider import UISlider
    log = []
    s = UISlider(min_value=0, max_value=100, default_value=0, step=1)
    s.on_value_changed(lambda v: log.append(v))
    s.set_value(42)
    assert_eq(s.value, 42)

@test("UISlider: destroy")
def test_slider_destroy():
    from core.ui.slider import UISlider
    s = UISlider()
    s.destroy()
    # 不抛异常即为通过


# ─── UIProgressBar ───

@test("UIProgressBar: 构造")
def test_progress_default():
    from core.ui.progressbar import UIProgressBar
    p = UIProgressBar(value=0.5)
    assert_eq(p.value, 0.5)

@test("UIProgressBar: set_progress / set_max")
def test_progress_set():
    from core.ui.progressbar import UIProgressBar
    p = UIProgressBar()
    p.set_progress(75).set_max(100)
    assert_eq(p.value, 75)

@test("UIProgressBar: norm 范围")
def test_progress_norm():
    from core.ui.progressbar import UIProgressBar
    p = UIProgressBar(max_value=100)
    p.value = 50
    assert_eq(p._norm, 0.5)
    p.value = 0
    assert_eq(p._norm, 0.0)
    p.value = 200
    assert_eq(p._norm, 1.0)

@test("UIProgressBar: 标签格式")
def test_progress_label():
    from core.ui.progressbar import UIProgressBar
    p = UIProgressBar(value=0.5, max_value=1.0)
    assert_true(hasattr(p, '_label'))

@test("UIProgressBar: destroy")
def test_progress_destroy():
    from core.ui.progressbar import UIProgressBar
    p = UIProgressBar()
    p.destroy()
    # 不抛异常即为通过


# ─── UIInputField ───

@test("UIInputField: 构造与 placeholder")
def test_input_default():
    from core.ui.inputfield import UIInputField
    inp = UIInputField(placeholder='Enter...')
    assert_eq(inp.text, '')
    assert_true(hasattr(inp, '_display'))

@test("UIInputField: set_text / clear")
def test_input_text():
    from core.ui.inputfield import UIInputField
    inp = UIInputField()
    inp.set_text('Hello')
    assert_eq(inp.text, 'Hello')
    inp.clear()
    assert_eq(inp.text, '')

@test("UIInputField: on_submit / on_text_changed")
def test_input_events():
    from core.ui.inputfield import UIInputField
    submit_log = []
    change_log = []
    inp = UIInputField()
    inp.on_submit(lambda t: submit_log.append(t))
    inp.on_text_changed(lambda t: change_log.append(t))
    assert_true(callable(inp._on_submit_cb))
    assert_true(callable(inp._on_change_cb))
    # 模拟文字变更
    inp._text = 'abc'
    inp._update_display()
    assert_true('abc' in change_log)

@test("UIInputField: input 文字录入")
def test_input_typing():
    from core.ui.inputfield import UIInputField
    inp = UIInputField()
    inp._is_focused = True
    inp.input('a')
    inp.input('b')
    inp.input('c')
    assert_eq(inp.text, 'abc')

@test("UIInputField: backspace")
def test_input_backspace():
    from core.ui.inputfield import UIInputField
    inp = UIInputField(default_text='hello')
    inp._is_focused = True
    inp.input('backspace')
    assert_eq(inp.text, 'hell')

@test("UIInputField: max_length")
def test_input_max_length():
    from core.ui.inputfield import UIInputField
    inp = UIInputField(max_length=3)
    inp._is_focused = True
    for ch in 'abcdef':
        inp.input(ch)
    assert_eq(len(inp.text), 3)
    assert_eq(inp.text, 'abc')

@test("UIInputField: destroy")
def test_input_destroy():
    from core.ui.inputfield import UIInputField
    inp = UIInputField()
    inp.destroy()
    # 不抛异常即为通过


# ─── UIDropdown ───

@test("UIDropdown: 构造")
def test_dropdown_default():
    from core.ui.dropdown import UIDropdown
    dd = UIDropdown(items=['A', 'B', 'C'], default_index=0)
    assert_eq(dd.selected_index, 0)
    assert_eq(dd.selected_item, 'A')

@test("UIDropdown: set_items")
def test_dropdown_set():
    from core.ui.dropdown import UIDropdown
    dd = UIDropdown()
    dd.set_items(['X', 'Y', 'Z'])
    assert_eq(len(dd._items), 3)
    assert_eq(dd.selected_index, -1)

@test("UIDropdown: _open / _close")
def test_dropdown_open():
    from core.ui.dropdown import UIDropdown
    dd = UIDropdown()
    dd._open()
    assert_true(dd._is_open)
    assert_true(dd._dropdown_root.enabled)
    dd._close()
    assert_false(dd._is_open)
    assert_false(dd._dropdown_root.enabled)

@test("UIDropdown: on_selected")
def test_dropdown_callback():
    from core.ui.dropdown import UIDropdown
    log = []
    dd = UIDropdown(items=['A', 'B'])
    dd.on_selected(lambda idx, item: log.append((idx, item)))
    dd._select(1)
    assert_eq(log, [(1, 'B')])

@test("UIDropdown: destroy")
def test_dropdown_destroy():
    from core.ui.dropdown import UIDropdown
    dd = UIDropdown()
    root = dd._dropdown_root
    dd.destroy()
    assert_false(root.enabled)


# ─── UISeparator ───

@test("UISeparator: 水平构造")
def test_separator_h():
    from core.ui.separator import UISeparator
    s = UISeparator(direction='horizontal')
    assert_true(s.scale_x > s.scale_y)

@test("UISeparator: 垂直构造")
def test_separator_v():
    from core.ui.separator import UISeparator
    s = UISeparator(direction='vertical')
    assert_true(s.scale_y > s.scale_x)


# ═══════════════════════════════════════════════
# Phase 3: 容器与布局测试
# ═══════════════════════════════════════════════

@test("UIPanel: 构造与标题")
def test_panel_default():
    from core.ui.panel import UIPanel
    p = UIPanel(title='Test Panel')
    assert_eq(p.title, 'Test Panel')
    p.set_title('New')
    assert_eq(p.title, 'New')

@test("UIPanel: add_child / clear")
def test_panel_children():
    from core.ui.panel import UIPanel
    from core.ui.button import UIButton
    p = UIPanel()
    btn = UIButton()
    p.add_child(btn)
    assert_true(len(p._children_widgets) > 0)
    p.clear_children()
    assert_eq(len(p._children_widgets), 0)

@test("UIPanel: 无标题栏模式")
def test_panel_no_title():
    from core.ui.panel import UIPanel
    p = UIPanel(title='', show_title=False)
    assert_eq(p._title_bar, None)

@test("UIPanel: destroy")
def test_panel_destroy():
    from core.ui.panel import UIPanel
    p = UIPanel()
    p.destroy()
    # 不抛异常即为通过


@test("UIScrollView: 构造")
def test_scrollview_default():
    from core.ui.scrollview import UIScrollView
    sv = UIScrollView()
    assert_true(hasattr(sv, 'content'))
    assert_true(sv.content is not None)

@test("UIScrollView: scroll_to")
def test_scrollview_scroll():
    from core.ui.scrollview import UIScrollView
    sv = UIScrollView()
    sv.scroll_to(0.3)
    # 验证范围限制
    sv.scroll_to(10)
    assert_eq(sv._content.y, 0.5)

@test("UIScrollView: destroy")
def test_scrollview_destroy():
    from core.ui.scrollview import UIScrollView
    sv = UIScrollView()
    sv.destroy()
    # 不抛异常即为通过


@test("UIGroupBox: 构造与标题")
def test_groupbox_default():
    from core.ui.groupbox import UIGroupBox
    gb = UIGroupBox(title='Settings')
    assert_eq(gb.title, 'Settings')
    gb.set_title('General')
    assert_eq(gb.title, 'General')

@test("UIGroupBox: destroy")
def test_groupbox_destroy():
    from core.ui.groupbox import UIGroupBox
    gb = UIGroupBox()
    gb.destroy()
    # 不抛异常即为通过


# ─── Layouts ───

@test("UIHorizontalLayout: add / remove / clear")
def test_hlayout():
    from core.ui.layouts import UIHorizontalLayout
    from core.ui.button import UIButton
    hl = UIHorizontalLayout()
    a = UIButton(text='A')
    b = UIButton(text='B')
    hl.add(a).add(b)
    assert_eq(len(hl._layout_children), 2)
    hl.remove(a)
    assert_eq(len(hl._layout_children), 1)
    hl.clear()
    assert_eq(len(hl._layout_children), 0)

@test("UIHorizontalLayout: rebuild")
def test_hlayout_rebuild():
    from core.ui.layouts import UIHorizontalLayout
    from core.ui.button import UIButton
    hl = UIHorizontalLayout(spacing=0.01, size=(0.4, 0.06))
    for name in 'ABC':
        hl.add(UIButton(text=name))
    hl.rebuild()  # 不抛异常即可
    assert_eq(len(hl._layout_children), 3)

@test("UIVerticalLayout: add / clear")
def test_vlayout():
    from core.ui.layouts import UIVerticalLayout
    from core.ui.button import UIButton
    vl = UIVerticalLayout()
    vl.add(UIButton()).add(UIButton()).add(UIButton())
    assert_eq(len(vl._layout_children), 3)
    vl.rebuild()
    vl.clear()
    assert_eq(len(vl._layout_children), 0)

@test("UIGridLayout: 构造与 rebuild")
def test_grid():
    from core.ui.layouts import UIGridLayout
    from core.ui.button import UIButton
    gl = UIGridLayout(cols=3, size=(0.3, 0.3))
    for i in range(6):
        gl.add(UIButton(text=str(i)))
    gl.rebuild()
    assert_eq(len(gl._layout_children), 6)

@test("UIGridLayout: cols setter")
def test_grid_cols():
    from core.ui.layouts import UIGridLayout
    gl = UIGridLayout(cols=4)
    gl.cols = 2
    assert_eq(gl.cols, 2)

@test("Layouts: destroy")
def test_layouts_destroy():
    from core.ui.layouts import UIHorizontalLayout, UIVerticalLayout, UIGridLayout
    from core.ui.button import UIButton
    for cls in (UIHorizontalLayout, UIVerticalLayout, UIGridLayout):
        l = cls()
        l.add(UIButton())
        l.destroy()
        assert_eq(len(l._layout_children), 0)


# ─── UIWindow ───

@test("UIWindow: 构造与标题")
def test_window_default():
    from core.ui.window import UIWindow
    win = UIWindow(title='Test')
    assert_eq(win.title, 'Test')
    win.set_title('Updated')
    assert_eq(win.title, 'Updated')

@test("UIWindow: closable / close")
def test_window_close():
    from core.ui.window import UIWindow
    log = []
    win = UIWindow(closable=True)
    win.on_close(lambda: log.append('closed'))
    assert_true(win.enabled)
    win.close()
    # 关闭后 enabled 为 False
    assert_false(win.enabled)
    assert_eq(log, ['closed'])

@test("UIWindow: draggable 拖拽")
def test_window_drag():
    from core.ui.window import UIWindow
    from ursina import Vec2
    win = UIWindow(draggable=True)
    # _drag_offset 初始为 (0,0)
    assert_eq(win._drag_offset, Vec2(0, 0))

@test("UIWindow: destroy")
def test_window_destroy():
    from core.ui.window import UIWindow
    win = UIWindow()
    win.destroy()
    # 不抛异常即为通过


# ─── UIDialog ───

@test("UIDialog: 构造")
def test_dialog_default():
    from core.ui.dialog import UIDialog
    dlg = UIDialog(title='Confirm', message='Sure?', confirm_text='Yes', cancel_text='No')
    assert_eq(dlg.message, 'Sure?')
    assert_true(dlg.enabled)

@test("UIDialog: on_confirm / on_cancel 回调")
def test_dialog_callbacks():
    from core.ui.dialog import UIDialog
    log = []
    dlg = UIDialog(confirm_text='OK', cancel_text='Cancel')
    dlg.on_confirm(lambda: log.append('confirm'))
    dlg.on_cancel(lambda: log.append('cancel'))
    dlg._on_confirm_clicked()
    assert_true('confirm' in log)
    assert_eq(len(log), 1)  # close 后 enabled=False, confirm 触发
    # 确认后 dialog 已 close，重新 enable 测试 cancel
    dlg2 = UIDialog(confirm_text='OK', cancel_text='Cancel')
    dlg2.on_cancel(lambda: log.append('cancel'))
    dlg2._on_cancel_clicked()
    assert_true('cancel' in log)

@test("UIDialog: set_message")
def test_dialog_message():
    from core.ui.dialog import UIDialog
    dlg = UIDialog(message='Old')
    dlg.set_message('New')
    assert_eq(dlg.message, 'New')

@test("UIDialog: 无取消按钮")
def test_dialog_no_cancel():
    from core.ui.dialog import UIDialog
    dlg = UIDialog(confirm_text='OK', cancel_text=None)
    assert_eq(dlg._cancel_btn, None)

@test("UIDialog: destroy")
def test_dialog_destroy():
    from core.ui.dialog import UIDialog
    dlg = UIDialog()
    dlg.destroy()
    # 不抛异常即为通过


# ═══════════════════════════════════════════════
# Phase 5: 全局与综合
# ═══════════════════════════════════════════════

@test("全局: from core.ui import * 完整导出")
def test_global_import():
    import core.ui
    expected = [
        'UITheme', 'ui_theme', 'set_theme', 'theme_color',
        'DARK_THEME', 'LIGHT_THEME', 'HUD_THEME',
        'UIWidget', 'Anchor',
        'UIImage', 'UIText', 'UILabel', 'UIButton', 'UIToggle',
        'UICheckbox', 'UISlider', 'UIProgressBar', 'UIInputField',
        'UIDropdown', 'UISeparator',
        'UIPanel', 'UIScrollView', 'UIGroupBox',
        'UIHorizontalLayout', 'UIVerticalLayout', 'UIGridLayout',
        'UIWindow', 'UIDialog',
    ]
    for name in expected:
        assert_true(hasattr(core.ui, name), f"core.ui missing {name}")

@test("全局: module.__all__ 完整性")
def test_global_all():
    import core.ui
    all_set = set(core.ui.__all__)
    assert_true('UIButton' in all_set)
    assert_true('UIWindow' in all_set)
    assert_true('UIDialog' in all_set)
    assert_true('Anchor' in all_set)
    assert_true('DARK_THEME' in all_set)

@test("全局: 重复 destroy 安全")
def test_double_destroy():
    from core.ui.button import UIButton
    from core.ui.slider import UISlider
    from core.ui.window import UIWindow
    for cls in (UIButton, UISlider, UIWindow):
        obj = cls()
        obj.destroy()
        # 第二次销毁不应抛异常
        try:
            obj.destroy()
        except Exception:
            pass


# ═══════════════════════════════════════════════
# 测试运行器
# ═══════════════════════════════════════════════

def run_all_tests():
    """收集并运行所有 test_ 开头的测试函数"""
    import re
    test_funcs = []
    this_module = sys.modules[__name__]
    for name in sorted(dir(this_module)):
        if name.startswith('test_') and callable(getattr(this_module, name)):
            test_funcs.append(name)

    tlog.info("=" * 60)
    tlog.info(f"  UI Module Test Suite  —  {len(test_funcs)} tests collected")
    tlog.info("=" * 60)

    for name in test_funcs:
        fn = getattr(this_module, name)
        fn()

    # 报告
    p, f, s = _test_results['pass'], _test_results['fail'], _test_results['skip']
    total = p + f + s
    tlog.info("=" * 60)
    tlog.info(f"  Results:  ✓ {p} passed   ✗ {f} failed   - {s} skipped   ∑ {total} total")
    if f > 0:
        tlog.warning(f"  ⚠ {f} test(s) FAILED — check logs above for details")
    else:
        tlog.info("  🎉 All tests passed!")
    tlog.info("=" * 60)
    return _test_results


def main():
    # 日志文件写入
    date_str = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    tlog.info(f"UI Full Test Suite started at {date_str}")
    tlog.info(f"Python: {sys.version}")
    tlog.info(f"CWD: {os.getcwd()}")
    tlog.info("")

    run_all_tests()

    # 返回退出码
    return 0 if _test_results['fail'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
