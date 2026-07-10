import sys, os
from pathlib import Path

# ensure root and projects/snake/ are importable
_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_root))
sys.path.insert(0, os.path.dirname(__file__))

from ursina import *
from random import randint
from collections import deque
import math

import snake_shared
from snake_camera import CameraController
snake_shared.reset_ipc()

app = Ursina()

# Game settings
GRID_SIZE = 20
CELL_SIZE = 1
MOVE_INTERVAL = 0.15

# Game state
snake_segments = deque()
direction = Vec2(1, 0)
next_dir = Vec2(1, 0)
food = None
score = 0
game_over_flag = False
move_timer = 0
anim_time = 0.0

# ─── 摄像机 Script 组件 ───
camera.add_script(CameraController(azimuth=45, elevation=42, distance=30))

# Lighting - 强环境光 (确保所有面都可见)
scene.ambient_light = color.rgba(255, 255, 255, 255)


def create_scene():
    """Build the game floor and walls (2.5D look)"""
    half = GRID_SIZE // 2

    # ═══ 地基 ═══
    Entity(model='cube', scale=(GRID_SIZE + 1, 0.3, GRID_SIZE + 1),
           position=(0, -0.15, 0), color=color.hex('#2a2a3a'))
    # 主地板
    Entity(model='cube', scale=(GRID_SIZE, 0.2, GRID_SIZE),
           position=(0, 0, 0), color=color.hex('#3a3a4a'))

    # ═══ 棋盘格地板 (亮色!) ═══
    check_colors = [color.hex('#4a4a5a'), color.hex('#5a5a6a')]
    for x in range(-half, half):
        for z in range(-half, half):
            idx = (x + z) % 2
            Entity(model='quad', scale=(0.96, 0.96, 1),
                   position=(x + 0.5, 0.02, z + 0.5),
                   rotation_x=90, color=check_colors[idx])

    # ═══ 网格线 ═══
    line_color = color.rgba(200, 200, 255, 40)
    for i in range(-half, half + 1):
        Entity(model='quad', scale=(0.02, GRID_SIZE, 1),
               position=(0, 0.025, i), rotation_x=90, color=line_color)
        Entity(model='quad', scale=(GRID_SIZE, 0.02, 1),
               position=(i, 0.025, 0), rotation_x=90, color=line_color)

    # ═══ 四角大柱子 ═══
    for px, pz in [(-half, -half), (-half, half), (half, -half), (half, half)]:
        Entity(model='cube', position=(px, 2.5, pz), scale=(0.5, 5, 0.5),
               color=color.hex('#5599dd'))
        Entity(model='cube', position=(px, 5, pz), scale=(0.7, 0.15, 0.7),
               color=color.hex('#77bbff'))
        Entity(model='sphere', position=(px, 5.3, pz), scale=0.2,
               color=color.rgba(100, 180, 255, 200))

    # ═══ 围墙 (亮色!) ═══
    wall_h = 1.2
    for z in (-half, half):
        Entity(model='cube', scale=(GRID_SIZE, wall_h, 0.3),
               position=(0, wall_h/2, z), color=color.hex('#336699'))
        Entity(model='cube', scale=(GRID_SIZE - 0.1, 0.08, 0.35),
               position=(0, wall_h, z), color=color.hex('#5588bb'))
    for x in (-half, half):
        Entity(model='cube', scale=(0.3, wall_h, GRID_SIZE),
               position=(x, wall_h/2, 0), color=color.hex('#336699'))
        Entity(model='cube', scale=(0.35, 0.08, GRID_SIZE - 0.1),
               position=(x, wall_h, 0), color=color.hex('#5588bb'))

    # ═══ 地面坐标轴标示 ═══
    for i in range(-half, half + 1, 5):
        if i != 0:
            # X 轴标记
            Entity(model='quad', scale=(0.2, 0.2, 1),
                   position=(i, 0.03, -half - 0.5),
                   rotation_x=90, color=color.rgba(0, 150, 255, 60))
            # Z 轴标记
            Entity(model='quad', scale=(0.2, 0.2, 1),
                   position=(-half - 0.5, 0.03, i),
                   rotation_x=90, color=color.rgba(255, 150, 0, 60))


def create_segment(pos, is_head=False):
    """Create a snake body segment"""
    seg = Entity(model='cube', color=color.lime,
                 position=(pos.x, 0.5, pos.y), scale=(0.9, 0.9, 0.9))
    if is_head:
        # 蛇头 - 亮绿色 + 眼睛
        seg.color = color.hex('#44ff88')
        # 眼睛
        Entity(model='sphere', color=color.white,
               position=(0.25, 0.15, 0.5), scale=0.12, parent=seg)
        Entity(model='sphere', color=color.white,
               position=(-0.25, 0.15, 0.5), scale=0.12, parent=seg)
        Entity(model='sphere', color=color.black,
               position=(0.25, 0.15, 0.56), scale=0.06, parent=seg)
        Entity(model='sphere', color=color.black,
               position=(-0.25, 0.15, 0.56), scale=0.06, parent=seg)
    return seg


def spawn_food():
    """Spawn food at a random empty position"""
    global food
    half = GRID_SIZE // 2 - 1
    while True:
        x = randint(-half, half)
        y = randint(-half, half)
        if not any(seg.x == x and seg.z == y for seg in snake_segments):
            break
    # 红色食物柱 + 光晕
    food = Entity(model='cube', color=color.rgb(255, 80, 80),
                  position=(x, 0.7, y), scale=(0.6, 1.4, 0.6))
    Entity(model='sphere', position=(x, 1.4, y), scale=0.2,
           color=color.rgb(255, 200, 100), parent=food)
    Entity(model='quad', scale=(1.0, 1.0, 1), position=(x, 0.02, y),
           rotation_x=90, color=color.rgba(255, 80, 80, 80), parent=food)


def start_game():
    """Initialize / restart the game"""
    global direction, next_dir, score, game_over_flag, move_timer

    direction = Vec2(1, 0)
    next_dir = Vec2(1, 0)
    score = 0
    game_over_flag = False
    move_timer = 0

    for seg in snake_segments:
        destroy(seg)
    snake_segments.clear()

    if food:
        destroy(food)

    # Initial snake: 3 segments facing right
    for i in range(3):
        seg = create_segment(Vec2(-i, 0), is_head=(i == 0))
        snake_segments.append(seg)

    spawn_food()
    refresh_ui()
    snake_shared.reset_ipc()
    snake_shared.append_log("游戏已开始，得分 0")


def move_snake():
    """Move the snake one step"""
    global direction, game_over_flag, score

    direction = next_dir

    head = snake_segments[0]
    new_pos = Vec2(head.x + direction.x, head.z + direction.y)

    # Wall collision
    half = GRID_SIZE // 2 - 1
    if abs(new_pos.x) > half or abs(new_pos.y) > half:
        game_over_flag = True
        snake_shared.append_log(f"撞墙! 头({int(head.x)},{int(head.z)})→({int(new_pos.x)},{int(new_pos.y)})")
        return

    # Self collision
    for seg in list(snake_segments)[:-1]:
        if seg.x == new_pos.x and seg.z == new_pos.y:
            game_over_flag = True
            snake_shared.append_log(f"撞自己! 头({int(head.x)},{int(head.z)})→({int(new_pos.x)},{int(new_pos.y)})")
            return

    # Add new head
    new_head = create_segment(new_pos, is_head=True)
    # Remove head marker from old head
    if len(snake_segments) > 0:
        old_head = snake_segments[0]
        old_head.color = color.lime
        old_head.scale = (0.9, 0.9, 0.9)
    snake_segments.appendleft(new_head)

    # Check food
    if food and new_head.x == food.x and new_head.z == food.z:
        score += 1
        snake_shared.append_log(f"吃到食物! 得分 {score}, 蛇长 {len(snake_segments)}")
        destroy(food)
        spawn_food()
    else:
        tail = snake_segments.pop()
        destroy(tail)

    # 写入游戏状态
    head_pos = snake_segments[0]
    snake_body = [(int(s.x), int(s.z)) for s in snake_segments]
    snake_shared.write_state(
        score=score,
        snake_length=len(snake_segments),
        head=(int(head_pos.x), int(head_pos.z)),
        body=snake_body,
        food=(int(food.x), int(food.z)) if food else None,
        direction=(int(direction.x), int(direction.y)),
        game_over=game_over_flag,
        grid_size=GRID_SIZE,
    )


def input(key):
    """Handle keyboard input"""
    if key == 'r' and game_over_flag:
        start_game()



def update():
    """Called every frame"""
    global move_timer, next_dir, anim_time, MOVE_INTERVAL

    if game_over_flag:
        refresh_ui()
        return

    # IPC command handling
    cmd_data = snake_shared.read_command()
    if cmd_data and cmd_data.get("cmd") not in ("none", None):
        cmd = cmd_data["cmd"]
        params = cmd_data.get("params", {})
        snake_shared.append_log(f"收到MCP命令: {cmd} {params}")
        if cmd == "set_direction":
            d = params.get("direction", "")
            if d == "up" and direction.y != -1:
                next_dir = Vec2(0, 1)
            elif d == "down" and direction.y != 1:
                next_dir = Vec2(0, -1)
            elif d == "left" and direction.x != 1:
                next_dir = Vec2(-1, 0)
            elif d == "right" and direction.x != -1:
                next_dir = Vec2(1, 0)
            snake_shared.append_log(f"方向切换为: {d}")
        elif cmd == "restart":
            start_game()
        elif cmd == "set_speed":
            speed = params.get("speed", 0.15)
            MOVE_INTERVAL = max(0.05, min(0.5, speed))
            snake_shared.append_log(f"速度调整为: {MOVE_INTERVAL:.2f}")

    # Direction input (prevent reversing)
    keys = held_keys
    if (keys['up arrow'] or keys['w']) and direction.y != -1:
        next_dir = Vec2(0, 1)
    elif (keys['down arrow'] or keys['s']) and direction.y != 1:
        next_dir = Vec2(0, -1)
    elif (keys['left arrow'] or keys['a']) and direction.x != 1:
        next_dir = Vec2(-1, 0)
    elif (keys['right arrow'] or keys['d']) and direction.x != -1:
        next_dir = Vec2(1, 0)

    # Timed movement
    move_timer += time.dt
    if move_timer >= MOVE_INTERVAL:
        move_timer = 0
        move_snake()

    # Food floating animation
    anim_time += time.dt
    if food:
        food.y = 0.6 + math.sin(anim_time * 3) * 0.15
        food.rotation_y += time.dt * 60

    refresh_ui()


# UI
score_text = Text(text='Score: 0', position=(-0.85, 0.45),
                  scale=2, color=color.white)

game_over_text = Text(
    text='Game Over!\nPress R to restart',
    position=(0, 0.1),
    scale=3,
    color=color.yellow,
    origin=(0, 0),
    enabled=False
)

title_text = Text(
    text='Snake',
    position=(0, 0.47),
    scale=1.5,
    color=color.hex('#e94560'),
    origin=(0, 0)
)

controls_text = Text(
    text='Arrow Keys / WASD move | R restart | Scroll zoom | LMB orbit | RMB pan',
    position=(0, -0.47),
    scale=1,
    color=color.gray,
    origin=(0, 0)
)


def refresh_ui():
    """Update UI elements"""
    score_text.text = f'Score: {score}'
    game_over_text.enabled = game_over_flag


# Launch the game
create_scene()
start_game()
app.run()
