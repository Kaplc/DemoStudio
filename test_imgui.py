"""
p3dimgui 集成测试 v5 - 在 camera.ui 空间下正确映射像素坐标
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ursina import *
from ursina import color as _color
from panda3d.core import NodePath
from imgui_bundle import imgui
import p3dimgui

app = Ursina(borderless=False, vsync=True)
window.size = window.windowed_size
window.center_on_screen()

aspect = window.aspect_ratio
win_w = window.size.x
win_h = window.size.y

# camera.ui 坐标系已知范围:
# x: [-aspect/2, aspect/2], y: [-0.5, 0.5]  (显示区域)
# 映射 pixel(px,py) → camera.ui:
#   ui_x = px/win_w * aspect - aspect/2
#   ui_y = 0.5 - py/win_h

# 创建 ImGui 父节点
# pixel(px,py) → camera.ui 空间:
#   因为 shader 已经有 -y, 所以父节点用正 y 缩放
#   结果: clip_x = -1 + 2*px/w, clip_y = 1 - 2*py/h
imgui_parent = NodePath('imgui-parent')
imgui_parent.reparent_to(camera.ui)
imgui_parent.set_pos(-aspect/2, 0.5, 0)            # 左上角
imgui_parent.set_scale(aspect/win_w, 1/win_h, 1)    # 像素 → camera.ui

# ─── 初始化 p3dimgui（用我们的父节点） ───
p3dimgui.init(window=base.win, parent=imgui_parent)

# ─── 场景 ───
Entity(model='cube', color=_color.orange, scale=0.5)
Text('3D', origin=(0,0))

# ─── ImGui UI 构建 task ───
def build_imgui_task(task):
    imgui.begin_main_menu_bar()
    if imgui.begin_menu("File", True):
        imgui.menu_item("New")
        imgui.menu_item("Open")
        imgui.separator()
        if imgui.menu_item("Exit")[0]:
            application.quit()
        imgui.end_menu()
    if imgui.begin_menu("Edit", True):
        imgui.menu_item("Undo")
        imgui.menu_item("Redo")
        imgui.end_menu()
    imgui.end_main_menu_bar()

    imgui.set_next_window_pos(imgui.ImVec2(100, 60), imgui.Cond_.first_use_ever.value)
    imgui.set_next_window_size(imgui.ImVec2(340, 180), imgui.Cond_.first_use_ever.value)
    imgui.begin("p3dimgui 测试", None)
    imgui.text("如果看到这个窗口, 集成成功!")
    imgui.separator()
    imgui.text(f"窗口: {int(win_w)}x{int(win_h)}")
    imgui.text(f"FPS: {int(1/max(time.dt_unscaled, 0.001))}")
    if imgui.button("点我"):
        print("[ImGui] 按钮被点击!")
    imgui.same_line()
    if imgui.button("退出"):
        application.quit()
    imgui.end()
    return task.cont

base.taskMgr.add(build_imgui_task, 'build-imgui-ui', sort=20)

print("="*50)
print("p3dimgui 测试 v5 - camera.ui 空间")
print(f"camera.ui 范围: x[{-aspect/2:.2f}, {aspect/2:.2f}] y[-0.5, 0.5]")
print("="*50)
app.run()
