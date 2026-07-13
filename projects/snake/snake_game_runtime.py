"""
SnakeGame — 可内嵌于编辑器的游戏运行时
======================================
支持两种模式：
  1. 编辑器内运行 (in-editor): 接受 parent NodePath，实体创建其下
  2. 独立运行 (standalone): 作为独立应用启动 (python snake_game_runtime.py)

用法 (编辑器内):
  from snake_game_runtime import SnakeGame
  game = SnakeGame(parent=game_root)
  game.create_scene()
  game.start_game()
  # 每帧调用 game.update(time.dt)
  # 输入调用 game.input(key)

用法 (独立运行):
  python projects/snake/snake_game_runtime.py
"""
import sys, os
from pathlib import Path
from random import randint
from collections import deque
import math

_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_root))
sys.path.insert(0, os.path.dirname(__file__))

from ursina import *
from ursina import color as _color
from panda3d.core import PandaNode

# ─── 蛇游戏常量 ───
GRID_SIZE = 20
CELL_SIZE = 1
MOVE_INTERVAL_DEFAULT = 0.15


class SnakeGame:
    """贪吃蛇游戏运行时 — 可内嵌于编辑器"""

    def __init__(self, parent=None, create_ui=True):
        """
        Args:
            parent: 实体父节点 (in-editor 传入 game_root, 独立模式默认 scene)
            create_ui: 是否创建文字 UI (in-editor 通常不创建)
        """
        self.GRID_SIZE = GRID_SIZE
        self.CELL_SIZE = CELL_SIZE
        self.MOVE_INTERVAL = MOVE_INTERVAL_DEFAULT
        self.create_ui = create_ui

        # 实体根节点
        self.root = parent if parent is not None else scene

        # ─── 游戏状态 ───
        self.snake_segments = deque()
        self.direction = Vec2(1, 0)
        self.next_dir = Vec2(1, 0)
        self.food = None
        self.score = 0
        self.game_over_flag = False
        self.move_timer = 0
        self.anim_time = 0.0

        # ─── UI 引用 ───
        self.score_text = None
        self.game_over_text = None
        self.title_text = None
        self.controls_text = None
        self.ui_enabled = False

    # ─── 场景构建 ───

    def create_scene(self, ambient_on=True):
        """Build the game floor and walls under self.root"""
        half = self.GRID_SIZE // 2
        R = self.root  # 别名，所有实体挂到此节点下

        if ambient_on:
            # 强环境光
            scene.ambient_light = _color.rgba(255, 255, 255, 255)

        # 地基
        Entity(model='cube', parent=R,
               scale=(self.GRID_SIZE + 1, 0.3, self.GRID_SIZE + 1),
               position=(0, -0.15, 0), color=_color.hex('#2a2a3a'))
        # 主地板
        Entity(model='cube', parent=R,
               scale=(self.GRID_SIZE, 0.2, self.GRID_SIZE),
               position=(0, 0, 0), color=_color.hex('#3a3a4a'))

        # 棋盘格地板
        check_colors = [_color.hex('#4a4a5a'), _color.hex('#5a5a6a')]
        for x in range(-half, half):
            for z in range(-half, half):
                idx = (x + z) % 2
                Entity(model='quad', parent=R,
                       scale=(0.96, 0.96, 1),
                       position=(x + 0.5, 0.02, z + 0.5),
                       rotation_x=90, color=check_colors[idx])

        # 网格线
        line_color = _color.rgba(200, 200, 255, 40)
        for i in range(-half, half + 1):
            Entity(model='quad', parent=R,
                   scale=(0.02, self.GRID_SIZE, 1),
                   position=(0, 0.025, i), rotation_x=90, color=line_color)
            Entity(model='quad', parent=R,
                   scale=(self.GRID_SIZE, 0.02, 1),
                   position=(i, 0.025, 0), rotation_x=90, color=line_color)

        # 四角柱子
        for px, pz in [(-half, -half), (-half, half), (half, -half), (half, half)]:
            Entity(model='cube', parent=R,
                   position=(px, 2.5, pz), scale=(0.5, 5, 0.5),
                   color=_color.hex('#5599dd'))
            Entity(model='cube', parent=R,
                   position=(px, 5, pz), scale=(0.7, 0.15, 0.7),
                   color=_color.hex('#77bbff'))
            Entity(model='sphere', parent=R,
                   position=(px, 5.3, pz), scale=0.2,
                   color=_color.rgba(100, 180, 255, 200))

        # 围墙
        wall_h = 1.2
        for z in (-half, half):
            Entity(model='cube', parent=R,
                   scale=(self.GRID_SIZE, wall_h, 0.3),
                   position=(0, wall_h/2, z), color=_color.hex('#336699'))
            Entity(model='cube', parent=R,
                   scale=(self.GRID_SIZE - 0.1, 0.08, 0.35),
                   position=(0, wall_h, z), color=_color.hex('#5588bb'))
        for x in (-half, half):
            Entity(model='cube', parent=R,
                   scale=(0.3, wall_h, self.GRID_SIZE),
                   position=(x, wall_h/2, 0), color=_color.hex('#336699'))
            Entity(model='cube', parent=R,
                   scale=(0.35, 0.08, self.GRID_SIZE - 0.1),
                   position=(x, wall_h, 0), color=_color.hex('#5588bb'))

        # 地面坐标标示
        for i in range(-half, half + 1, 5):
            if i != 0:
                Entity(model='quad', parent=R,
                       scale=(0.2, 0.2, 1),
                       position=(i, 0.03, -half - 0.5),
                       rotation_x=90, color=_color.rgba(0, 150, 255, 60))
                Entity(model='quad', parent=R,
                       scale=(0.2, 0.2, 1),
                       position=(-half - 0.5, 0.03, i),
                       rotation_x=90, color=_color.rgba(255, 150, 0, 60))

    def create_ui_elements(self):
        """创建 UI 文字 (仅在 create_ui=True 时调用)"""
        if not self.create_ui:
            return

        self.score_text = Text(
            parent=camera.ui,
            text='Score: 0',
            position=(-0.85, 0.45),
            scale=2, color=_color.white,
        )
        self.game_over_text = Text(
            parent=camera.ui,
            text='Game Over!\nPress R to restart',
            position=(0, 0.1),
            scale=3, color=_color.yellow,
            origin=(0, 0), enabled=False,
        )
        self.title_text = Text(
            parent=camera.ui,
            text='Snake',
            position=(0, 0.47),
            scale=1.5, color=_color.hex('#e94560'),
            origin=(0, 0),
        )
        self.controls_text = Text(
            parent=camera.ui,
            text='Arrow Keys / WASD move | R restart',
            position=(0, -0.47),
            scale=1, color=_color.gray,
            origin=(0, 0),
        )
        self.ui_enabled = True

        import snake_shared as _sh
        _sh.reset_ipc()

    # ─── 游戏逻辑 ───

    def _create_segment(self, pos, is_head=False):
        """Create a snake body segment under self.root"""
        seg = Entity(model='cube', parent=self.root,
                     color=_color.lime,
                     position=(pos.x, 0.5, pos.y),
                     scale=(0.9, 0.9, 0.9))
        if is_head:
            seg.color = _color.hex('#44ff88')
            Entity(model='sphere', color=_color.white,
                   position=(0.25, 0.15, 0.5), scale=0.12, parent=seg)
            Entity(model='sphere', color=_color.white,
                   position=(-0.25, 0.15, 0.5), scale=0.12, parent=seg)
            Entity(model='sphere', color=_color.black,
                   position=(0.25, 0.15, 0.56), scale=0.06, parent=seg)
            Entity(model='sphere', color=_color.black,
                   position=(-0.25, 0.15, 0.56), scale=0.06, parent=seg)
        return seg

    def _spawn_food(self):
        """Spawn food at a random empty position"""
        half = self.GRID_SIZE // 2 - 1
        while True:
            x = randint(-half, half)
            y = randint(-half, half)
            if not any(seg.x == x and seg.z == y for seg in self.snake_segments):
                break

        self.food = Entity(model='cube', parent=self.root,
                           color=_color.rgb(255, 80, 80),
                           position=(x, 0.7, y), scale=(0.6, 1.4, 0.6))
        Entity(model='sphere', position=(x, 1.4, y), scale=0.2,
               color=_color.rgb(255, 200, 100), parent=self.food)
        Entity(model='quad', scale=(1.0, 1.0, 1), position=(x, 0.02, y),
               rotation_x=90, color=_color.rgba(255, 80, 80, 80), parent=self.food)

    def start_game(self):
        """初始化/重启游戏"""
        self.direction = Vec2(1, 0)
        self.next_dir = Vec2(1, 0)
        self.score = 0
        self.game_over_flag = False
        self.move_timer = 0
        self.anim_time = 0.0

        for seg in self.snake_segments:
            destroy(seg)
        self.snake_segments.clear()

        if self.food:
            destroy(self.food)
            self.food = None

        for i in range(3):
            seg = self._create_segment(Vec2(-i, 0), is_head=(i == 0))
            self.snake_segments.append(seg)

        self._spawn_food()
        self._refresh_ui()

        try:
            import snake_shared as _sh
            _sh.reset_ipc()
            _sh.append_log("游戏已开始")
        except ImportError:
            pass

    def _move_snake(self):
        """Move the snake one step"""
        self.direction = self.next_dir
        head = self.snake_segments[0]
        new_pos = Vec2(head.x + self.direction.x, head.z + self.direction.y)

        half = self.GRID_SIZE // 2 - 1

        # 墙壁碰撞
        if abs(new_pos.x) > half or abs(new_pos.y) > half:
            self.game_over_flag = True
            return

        # 自身碰撞
        for seg in list(self.snake_segments)[:-1]:
            if seg.x == new_pos.x and seg.z == new_pos.y:
                self.game_over_flag = True
                return

        # 添加新蛇头
        new_head = self._create_segment(new_pos, is_head=True)
        if len(self.snake_segments) > 0:
            old_head = self.snake_segments[0]
            old_head.color = _color.lime
            old_head.scale = (0.9, 0.9, 0.9)
        self.snake_segments.appendleft(new_head)

        # 吃食物
        if self.food and new_head.x == self.food.x and new_head.z == self.food.z:
            self.score += 1
            destroy(self.food)
            self.food = None
            self._spawn_food()
        else:
            tail = self.snake_segments.pop()
            destroy(tail)

    def _refresh_ui(self):
        """更新 UI 文字"""
        if self.score_text:
            self.score_text.text = f'Score: {self.score}'
        if self.game_over_text:
            self.game_over_text.enabled = self.game_over_flag

    # ─── 每帧调用 ───

    def update(self, dt):
        """每帧更新游戏逻辑 (由编辑器或独立主循环调用)"""
        global MOVE_INTERVAL_DEFAULT

        if self.game_over_flag:
            self._refresh_ui()
            return

        # IPC 命令处理 (仅独立模式有)
        try:
            import snake_shared as _sh
            cmd_data = _sh.read_command()
            if cmd_data and cmd_data.get("cmd") not in ("none", None):
                cmd = cmd_data["cmd"]
                params = cmd_data.get("params", {})
                if cmd == "set_direction":
                    d = params.get("direction", "")
                    if d == "up" and self.direction.y != -1:
                        self.next_dir = Vec2(0, 1)
                    elif d == "down" and self.direction.y != 1:
                        self.next_dir = Vec2(0, -1)
                    elif d == "left" and self.direction.x != 1:
                        self.next_dir = Vec2(-1, 0)
                    elif d == "right" and self.direction.x != -1:
                        self.next_dir = Vec2(1, 0)
                elif cmd == "restart":
                    self.start_game()
                elif cmd == "set_speed":
                    speed = params.get("speed", 0.15)
                    self.MOVE_INTERVAL = max(0.05, min(0.5, speed))
        except ImportError:
            pass

        # 键盘输入
        keys = held_keys
        if (keys['up arrow'] or keys['w']) and self.direction.y != -1:
            self.next_dir = Vec2(0, 1)
        elif (keys['down arrow'] or keys['s']) and self.direction.y != 1:
            self.next_dir = Vec2(0, -1)
        elif (keys['left arrow'] or keys['a']) and self.direction.x != 1:
            self.next_dir = Vec2(-1, 0)
        elif (keys['right arrow'] or keys['d']) and self.direction.x != -1:
            self.next_dir = Vec2(1, 0)

        # 定时移动
        self.move_timer += dt
        if self.move_timer >= self.MOVE_INTERVAL:
            self.move_timer = 0
            self._move_snake()

        # 食物动画
        self.anim_time += dt
        if self.food:
            self.food.y = 0.6 + math.sin(self.anim_time * 3) * 0.15
            self.food.rotation_y += dt * 60

        self._refresh_ui()

    def input(self, key):
        """键盘输入"""
        if key == 'r' and self.game_over_flag:
            self.start_game()

    # ─── 清理 ───

    def cleanup(self):
        """销毁所有游戏实体"""
        for seg in list(self.snake_segments):
            destroy(seg)
        self.snake_segments.clear()

        if self.food:
            destroy(self.food)
            self.food = None

        # 删除根节点下的所有子实体（NodePath 用 detach_node 而非 Ursina destroy）
        if self.root is not scene:
            try:
                destroy(self.root)
            except AttributeError:
                # NodePath 没有 eternal 属性，直接用 Panda3D 方法
                self.root.detach_node()

        if self.ui_enabled:
            for ui in [self.score_text, self.game_over_text,
                       self.title_text, self.controls_text]:
                if ui:
                    destroy(ui)


# ════════════════════════════════════════
#  独立运行入口
# ════════════════════════════════════════
if __name__ == '__main__':
    from snake_camera import CameraController

    app = Ursina()

    camera.add_script(CameraController(
        azimuth=45, elevation=42, distance=30))
    scene.ambient_light = color.rgba(255, 255, 255, 255)

    game = SnakeGame(create_ui=True)
    game.create_scene()
    game.create_ui_elements()
    game.start_game()

    # 注入 update/input
    def _update():
        game.update(time.dt)

    def _input(key):
        game.input(key)

    app.run()
