"""
GameViewport — 游戏视口
======================
在编辑器中创建一个离屏渲染缓冲区，显示游戏的摄像机画面。

架构：
  - 离屏缓冲区 (GraphicsBuffer) 渲染到纹理
  - 独立的游戏相机 (位置匹配游戏的轨道视角)
  - 纹理通过 p3dimgui.loadGraphicsBuffer() 显示在 ImGui 窗口

用法：
  viewport = GameViewport()
  viewport.start_game()
  # 每帧调用 viewport.update(dt)
  # 在 ImGui 中使用 viewport.draw_imgui()
"""
import math
from pathlib import Path

from panda3d.core import (
    GraphicsBuffer,
    NodePath,
    Camera as PandaCamera,
    PerspectiveLens,
    Texture,
    BitMask32,
)

from ursina import application, color, Vec3
from core.logger import get_logger

logger = get_logger('editor.game_viewport')

# 默认视口尺寸
VIEWPORT_W = 480
VIEWPORT_H = 360


class GameViewport:
    """管理游戏离屏渲染和 ImGui 显示"""

    def __init__(self, width=VIEWPORT_W, height=VIEWPORT_H):
        self.width = width
        self.height = height
        self.buffer: GraphicsBuffer | None = None
        self.texture: Texture | None = None
        self.texture_ref = None  # ImTextureRef (由 p3dimgui 返回)

        # 游戏实例
        self.game = None
        self.game_root: NodePath | None = None
        self.game_cam: NodePath | None = None
        self.game_running = False

        # 轨道相机参数 (匹配原游戏)
        self.azimuth = 45.0
        self.elevation = 42.0
        self.distance = 30.0
        self.target = Vec3(0, 0, 0)
        self._game_world = None  # game_root 的父级
        self._setup_done = False

    # ─── 初始化 ───

    def setup(self, game_world=None):
        """
        创建离屏缓冲区和相机
        Args:
            game_world: 游戏实体的父节点 (如果为 None 使用默认 scene)
        """
        if self._setup_done:
            return

        self._game_world = game_world

        # 1. 创建游戏场景根节点
        self.game_root = NodePath('game-root')
        if game_world:
            self.game_root.reparent_to(game_world)
        else:
            # 默认挂到 render
            try:
                self.game_root.reparent_to(base.render)
            except Exception:
                self.game_root.reparent_to(application.base.render)

        # 2. 创建离屏缓冲区
        self._create_buffer()

        # 3. 创建游戏相机
        self._create_camera()

        self._setup_done = True
        logger.info('[viewport] setup complete (%dx%d)', self.width, self.height)

    def _create_buffer(self):
        """创建离屏渲染缓冲区"""
        win = base.win
        self.buffer = win.make_texture_buffer(
            'game-viewport-buffer',
            self.width,
            self.height,
        )
        if self.buffer is None:
            logger.error('[viewport] failed to create texture buffer!')
            return

        self.buffer.set_sort(-100)  # 在主渲染之前
        self.texture = self.buffer.get_texture()

        # 通过 p3dimgui 加载纹理供 ImGui 使用
        try:
            self.texture_ref = base.imgui.loadGraphicsBuffer(self.buffer)
            logger.info('[viewport] texture_ref=%s', self.texture_ref)
        except Exception as e:
            logger.error('[viewport] loadGraphicsBuffer failed: %s', e)

    def _create_camera(self):
        """创建游戏专用相机，放置在轨道位置"""
        self.game_cam = NodePath(PandaCamera('game-cam'))
        lens = PerspectiveLens()
        lens.set_fov(30)  # 匹配原游戏 FOV
        lens.set_near_far(1, 200)
        self.game_cam.node().set_lens(lens)
        self.game_cam.reparent_to(self.game_root)

        # 设置相机为缓冲区的渲染源
        if self.buffer:
            dr = self.buffer.get_display_region(0)
            dr.set_camera(self.game_cam)

        # 更新位置
        self._update_camera_pos()

    def _update_camera_pos(self):
        """根据轨道参数更新相机位置 (球坐标 → 笛卡尔坐标)"""
        if self.game_cam is None:
            return

        az = math.radians(self.azimuth)
        el = math.radians(self.elevation)

        x = self.target.x + self.distance * math.cos(el) * math.sin(az)
        y = self.target.y + self.distance * math.sin(el)
        z = self.target.z + self.distance * math.cos(el) * math.cos(az)

        self.game_cam.set_pos(x, y, z)
        self.game_cam.look_at(self.target)

    # ─── 游戏生命周期 ───

    def start_game(self):
        """创建并启动游戏实例"""
        if self.game_running:
            logger.warning('[viewport] game already running')
            return

        try:
            from projects.snake.snake_game_runtime import SnakeGame
        except ImportError:
            logger.error('[viewport] failed to import SnakeGame')
            return

        # 创建游戏实例，实体挂在 game_root 下
        self.game = SnakeGame(parent=self.game_root, create_ui=False)
        self.game.create_scene(ambient_on=False)
        self.game.start_game()
        self.game_running = True
        logger.info('[viewport] game started')

    def stop_game(self):
        """停止并清理游戏"""
        if self.game:
            self.game.cleanup()
            self.game = None
        self.game_running = False

        # 清理游戏根节点下的子节点 (但保留相机)
        if self.game_root:
            for child in list(self.game_root.get_children()):
                if child != self.game_cam:
                    child.detach_node()
        logger.info('[viewport] game stopped')

    def update(self, dt):
        """每帧更新 (由编辑器 update 调用)"""
        if self.game and self.game_running:
            self.game.update(dt)

    def input(self, key):
        """传递键盘输入给游戏"""
        if self.game and self.game_running:
            self.game.input(key)

    def set_camera_orbit(self, azimuth=None, elevation=None, distance=None):
        """调整游戏相机轨道参数"""
        if azimuth is not None:
            self.azimuth = azimuth
        if elevation is not None:
            self.elevation = max(5, min(85, elevation))
        if distance is not None:
            self.distance = max(5, min(80, distance))
        self._update_camera_pos()

    # ─── ImGui 绘制 ───

    def draw_imgui(self):
        """在 ImGui 窗口中绘制游戏视口"""
        from imgui_bundle import imgui

        if self.texture_ref is None:
            imgui.text_colored(imgui.ImVec4(1, 0.3, 0.3, 1),
                               "Game viewport not available")
            return

        # 获取可用窗口区域
        avail = imgui.get_content_region_avail()
        vp_w = max(100, avail.x)
        vp_h = max(100, avail.y)

        # 如果窗口尺寸变化，重新创建缓冲区
        if abs(vp_w - self.width) > 10 or abs(vp_h - self.height) > 10:
            self._resize_buffer(int(vp_w), int(vp_h))

        # 显示游戏渲染纹理
        imgui.image(
            self.texture_ref,
            imgui.ImVec2(self.width, self.height),
        )

    def _resize_buffer(self, new_w, new_h):
        """重新创建指定尺寸的缓冲区"""
        if self.buffer:
            # Panda3D 不支持动态调整 buffer 尺寸，重建
            win = base.win
            old_sort = self.buffer.get_sort()
            old_tex = self.buffer.get_texture()

            # 清理旧
            base.graphicsEngine.remove_window(self.buffer)

            # 创建新
            self.width = new_w
            self.height = new_h
            self._create_buffer()
            if self.buffer:
                self.buffer.set_sort(old_sort)
                dr = self.buffer.get_display_region(0)
                dr.set_camera(self.game_cam)

    # ─── 清理 ───

    def cleanup(self):
        """完全清理"""
        self.stop_game()

        if self.buffer:
            try:
                base.graphicsEngine.remove_window(self.buffer)
            except Exception:
                pass
            self.buffer = None
            self.texture = None
            self.texture_ref = None

        if self.game_cam:
            self.game_cam.detach_node()
            self.game_cam = None

        if self.game_root:
            self.game_root.detach_node()
            self.game_root = None

        self._setup_done = False
        logger.info('[viewport] cleaned up')
