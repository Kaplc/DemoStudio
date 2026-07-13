"""
DemoStudio Editor UI — ImGui 界面定义
======================================
包含 ImGui 初始化、坐标映射、UI 菜单栏和状态栏构建。
"""
from panda3d.core import NodePath
from imgui_bundle import imgui
import p3dimgui

from ursina import window, camera, application, time, held_keys

from core.logger import get_logger

logger = get_logger('editor.ui')

# ─── 状态 ───
imgui_parent: NodePath | None = None
_imgui_visible = True
_viewport = None  # GameViewport 实例


# ─── 初始化 ───

def setup_imgui():
    """初始化 p3dimgui，创建 camera.ui 下的坐标映射父节点，加载中文字体"""
    global imgui_parent

    imgui_parent = NodePath('imgui-parent')
    imgui_parent.reparent_to(camera.ui)

    p3dimgui.init(
        window=base.win,
        parent=imgui_parent,
        wantPlaceManager=False,
        wantExplorerManager=False,
        wantTimeSliderManager=False,
    )

    # 加载中文字体（微软雅黑，完全替换默认字体）
    io = imgui.get_io()
    font_path = "C:/Windows/Fonts/msyh.ttc"
    try:
        io.fonts.clear()
        cfg = imgui.ImFontConfig()
        cfg.merge_mode = False
        cfg.font_no = 0  # TTC 第一个字体
        io.fonts.add_font_from_file_ttf(font_path, 18.0, cfg)
        logger.info('[imgui] loaded Chinese font: msyh.ttc')
    except Exception as e:
        logger.warning('[imgui] font load failed: {}', e)

    update_transform()
    logger.info('[imgui] initialized (parent=%s)', imgui_parent)


def update_transform():
    """根据当前窗口大小更新 ImGui 父节点坐标映射（每帧调用）"""
    global imgui_parent
    if imgui_parent is None:
        return

    aspect = window.aspect_ratio
    w = window.size.x
    h = window.size.y

    # 只记录变化（避免刷屏）
    prev = getattr(update_transform, '_prev', None)
    curr = (w, h, aspect)
    if prev is None or prev[0] != w or prev[1] != h:
        logger.info('[resize] update_transform: %dx%d (aspect=%.4f)', w, h, aspect)
        update_transform._prev = curr

    # camera.ui: film_size=(20*aspect, 20), 可见范围 x∈[-aspect/2, aspect/2], y∈[-0.5, 0.5]
    # pixel(0,0) → (-aspect/2, 0.5), pixel(w,h) → (aspect/2, -0.5)
    # shader 已做 -y，所以 scale_y=1/h 为正
    imgui_parent.set_pos(-aspect / 2, 0.5, -1)
    imgui_parent.set_scale(aspect / w, 1 / h, 1)

    # 同步 ImGui 显示尺寸，确保菜单栏等跟随窗口正确布局
    try:
        base.imgui.io.display_size = (w, h)
    except Exception:
        pass


def toggle_visibility():
    """切换 ImGui 显示/隐藏"""
    global _imgui_visible
    _imgui_visible = not _imgui_visible
    if _imgui_visible:
        base.imgui.show()
    else:
        base.imgui.hide()
    logger.info('[imgui] visibility: %s', 'ON' if _imgui_visible else 'OFF')


def is_visible() -> bool:
    return _imgui_visible


def set_viewport(vp):
    """设置游戏视口实例供 UI 显示"""
    global _viewport
    _viewport = vp


def get_viewport():
    return _viewport
