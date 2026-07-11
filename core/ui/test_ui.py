"""
UI 控件可视化测试
================
运行方式:
    python -m core.ui.test_ui

这将启动一个 Ursina 窗口，展示所有已实现的 UI 控件。
关闭窗口后程序自动退出。
"""
import sys
from pathlib import Path

# 确保项目根目录在路径中
_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_root))

from ursina import Ursina, camera, color, window, application
from core.ui import *


# ─── 创建测试应用 ───

app = Ursina(
    title='UI Module Test',
    borderless=False,
    editor_ui_enabled=False,
    development_mode=False,
)

window.size = (1280, 720)
window.center_on_screen()


# ─── 测试用主题色板 (仅用于测试背景) ───
BG = color.hex('#1a1a2e')
PANEL = color.hex('#16213e')
ACCENT = color.hex('#e94560')


# ─── 设置场景背景 ───
from ursina import Entity
Entity(model='quad', scale=(2, 2, 1), parent=camera.ui, color=BG)


# ─── 标题 ───
UIText(
    text='UI Module 控件测试',
    anchor=Anchor.TOP_CENTER,
    offset=(0, -0.04),
    font_size=1.4,
    color=ACCENT,
)


# ═══════════════════════════════════════════
# 第一行: 基础控件
# ═══════════════════════════════════════════

UIText(
    text='[ 基础控件 ]',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.10),
    font_size=1.0,
    color=color.hex('#8899aa'),
)

# 1. UIButton
btn1 = UIButton(
    text='Button',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.15),
    size=(0.12, 0.04),
)
btn1.on_click(lambda: print('[test] Button clicked!'))

# 2. UIToggle
toggle1 = UIToggle(
    text='Toggle',
    anchor=Anchor.TOP_LEFT,
    offset=(0.22, -0.15),
    size=(0.15, 0.04),
)
toggle1.on_value_changed(lambda v: print(f'[test] Toggle: {v}'))

# 3. UICheckbox
cb1 = UICheckbox(
    text='Checkbox',
    anchor=Anchor.TOP_LEFT,
    offset=(0.42, -0.15),
    size=(0.16, 0.035),
)
cb1.on_value_changed(lambda v: print(f'[test] Checkbox: {v}'))

# 4. UIText
UIText(
    text='UIText Label',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.21),
    font_size=0.8,
    color=color.hex('#44ff88'),
)

# 5. UIImage
UIImage(
    texture='logo',  # 如果报错说明没有 logo 纹理，会 fallback 为白色方块
    anchor=Anchor.TOP_LEFT,
    offset=(0.35, -0.21),
    size=(0.06, 0.06),
)

# 6. UISeparator 水平
UISeparator(
    direction='horizontal',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.29),
    size=(0.9, 0.003),
)


# ═══════════════════════════════════════════
# 第二行: 交互控件
# ═══════════════════════════════════════════

UIText(
    text='[ 交互控件 ]',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.32),
    font_size=1.0,
    color=color.hex('#8899aa'),
)

# 7. UISlider
slider1 = UISlider(
    min_value=0, max_value=100, default_value=30, step=1,
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.37),
    size=(0.25, 0.03),
)
slider1.on_value_changed(lambda v: print(f'[test] Slider: {v}'))

# 8. UIProgressBar
UIProgressBar(
    value=0.65, max_value=1.0, show_label=True,
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.42),
    size=(0.25, 0.03),
)

# 9. UIInputField
inp1 = UIInputField(
    placeholder='Type here...',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.47),
    size=(0.30, 0.04),
)
inp1.on_submit(lambda t: print(f'[test] Input submitted: {t}'))
inp1.on_text_changed(lambda t: print(f'[test] Input changed: {t}'))

# 10. UIDropdown
dd1 = UIDropdown(
    items=['Option A', 'Option B', 'Option C'],
    default_index=0,
    anchor=Anchor.TOP_LEFT,
    offset=(0.40, -0.47),
    size=(0.18, 0.04),
)
dd1.on_selected(lambda idx, item: print(f'[test] Dropdown: {item} (idx={idx})'))


# ═══════════════════════════════════════════
# 第三行: 容器控件
# ═══════════════════════════════════════════

UIText(
    text='[ 容器 & 布局 ]',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.54),
    font_size=1.0,
    color=color.hex('#8899aa'),
)

# 11. UIPanel
panel = UIPanel(
    title='Panel Container',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.85),
    size=(0.20, 0.28),
)

# 12. UIGroupBox
gb = UIGroupBox(
    title='Group Box',
    anchor=Anchor.TOP_LEFT,
    offset=(0.30, -0.62),
    size=(0.18, 0.12),
)

# 13. UIHorizontalLayout (水平排列按钮)
h_layout = UIHorizontalLayout(
    spacing=0.008, padding=0.005,
    anchor=Anchor.TOP_LEFT,
    offset=(0.30, -0.78),
    size=(0.28, 0.04),
)
for name in ['A', 'B', 'C', 'D']:
    UIButton(text=name, parent=h_layout)
h_layout.rebuild()

# 14. UIVerticalLayout (垂直排列按钮)
v_layout = UIVerticalLayout(
    spacing=0.006, padding=0.005,
    anchor=Anchor.TOP_LEFT,
    offset=(0.62, -0.78),
    size=(0.10, 0.16),
)
for name in ['Top', 'Mid', 'Bot']:
    UIButton(text=name, parent=v_layout)
v_layout.rebuild()

# 15. UIGridLayout (网格排列)
grid = UIGridLayout(
    cols=3, spacing=0.006, padding=0.005,
    anchor=Anchor.TOP_LEFT,
    offset=(0.76, -0.78),
    size=(0.18, 0.16),
)
for i in range(6):
    UIButton(text=str(i), parent=grid)
grid.rebuild()


# ═══════════════════════════════════════════
# 第四行: 窗口 & 对话框 (先隐藏)
# ═══════════════════════════════════════════

UIText(
    text='[ 窗口 & 对话框 ]',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -0.94),
    font_size=1.0,
    color=color.hex('#8899aa'),
)

# 16. UIWindow — 默认显示在右下角区域
win = UIWindow(
    title='Draggable Window',
    closable=True,
    draggable=True,
    anchor=Anchor.BOTTOM_RIGHT,
    offset=(-0.05, 0.05),
    size=(0.28, 0.22),
)
# 在窗口中放些内容
UIText(text='This window can be', parent=win, position=(0, 0.06), scale=0.7, color=color.hex('#e0e0e0'), origin=(0, 0))
UIText(text='dragged by the title bar', parent=win, position=(0, 0.03), scale=0.7, color=color.hex('#e0e0e0'), origin=(0, 0))
win.on_close(lambda: print('[test] Window closed'))

# 17. 对话框 — 点击按钮打开
dialog_btn = UIButton(
    text='Open Dialog',
    anchor=Anchor.TOP_LEFT,
    offset=(0.05, -1.00),
    size=(0.14, 0.04),
)
dialog = None  # 将在点击时创建

def open_dialog():
    global dialog
    if dialog and dialog.enabled:
        return
    dialog = UIDialog(
        title='Confirm',
        message='Are you sure you want to proceed?',
        confirm_text='Yes',
        cancel_text='No',
    )
    dialog.on_confirm(lambda: print('[test] Dialog confirmed'))
    dialog.on_cancel(lambda: print('[test] Dialog cancelled'))

dialog_btn.on_click(open_dialog)


# ═══════════════════════════════════════════
# 底部提示
# ═══════════════════════════════════════════

UIText(
    text='Check the terminal console for click/output feedback',
    anchor=Anchor.BOTTOM_CENTER,
    offset=(0, 0.03),
    font_size=0.6,
    color=color.hex('#667788'),
)

UIText(
    text='Close this window to exit the test.',
    anchor=Anchor.BOTTOM_CENTER,
    offset=(0, 0.01),
    font_size=0.55,
    color=color.hex('#445566'),
)


# ─── 运行 ───
if __name__ == '__main__':
    print('=' * 50)
    print('  UI Module Test')
    print('  Interact with the UI controls in the window.')
    print('  Check terminal for event feedback.')
    print('=' * 50)
    app.run()
