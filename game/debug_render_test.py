"""
Ursina 渲染测试 - 独立窗口 (需要模块顶层 import)
用于测试不同颜色/位置/大小的实体在各种条件下的可见性
"""
import sys
import os

print("=" * 50)
print("Ursina 渲染测试 - 正在启动窗口...")
print("=" * 50)

# ── 这些 import 必须在模块顶层 ──
from ursina import *

app = Ursina()

# 设置环境光 (照亮所有物体)
scene.ambient_light = color.rgba(100, 100, 120, 255)

# ── 测试 1: 基础可见性 ──
print("\n[测试 1] 基础颜色可见性")
entities = []

# 不同位置的绿色方块 (模拟蛇身)
for i, (x, z, desc) in enumerate([
    (-6, -2, "左边远处"), (-2, -2, "左边近处"),
    (2, -2,  "右边近处"), (6, -2,  "右边远处"),
    (-2, 2,  "前方"),
    (0, 6,   "远处中间"),
]):
    e = Entity(model='cube', color=color.lime, position=(x, 0.5, z),
               scale=(0.9, 0.9, 0.9))
    entities.append(e)
    Text(text=f'{desc}', position=(x, 1.5, z), scale=8, color=color.white,
         billboard=True)
    print(f"  创建测试方块: ({x}, 0.5, {z}) -> {desc}")

# ── 测试 2: 不同颜色对比 ──
print("\n[测试 2] 颜色对比")
colors = [
    (color.lime, "lime", -3, 4),
    (color.hex('#00ff44'), "#00ff44", 0, 4),
    (color.rgb(0, 255, 100), "rgb(0,255,100)", 3, 4),
    (color.green, "green", -3, 7),
    (color.yellow, "yellow", 0, 7),
    (color.orange, "orange", 3, 7),
]
for col, name, x, z in colors:
    e = Entity(model='cube', color=col, position=(x, 0.5, z),
               scale=(0.9, 0.9, 0.9))
    Text(text=name, position=(x, 1.5, z), scale=8, color=color.white,
         billboard=True)

# ── 测试 3: 纹理对比 ──
print("\n[测试 3] 纹理对比")
e_no_tex = Entity(model='cube', color=color.lime, position=(-3, 2, -4),
                  scale=(0.9, 0.9, 0.9))
Text(text='无纹理', position=(-3, 3, -4), scale=8, color=color.white, billboard=True)

e_tex = Entity(model='cube', color=color.lime, position=(0, 2, -4),
               scale=(0.9, 0.9, 0.9), texture='white_cube')
Text(text='white_cube', position=(0, 3, -4), scale=8, color=color.white, billboard=True)

e_brick = Entity(model='cube', color=color.lime, position=(3, 2, -4),
                 scale=(0.9, 0.9, 0.9))
Text(text='无纹理(高)', position=(3, 3, -4), scale=8, color=color.white, billboard=True)

# ── 测试 4: 不同大小 ──
print("\n[测试 4] 大小对比")
sizes = [(0.5, 0.5), (0.9, 0.9), (1.5, 1.5)]
for i, (sx, sy) in enumerate(sizes):
    e = Entity(model='cube', color=color.rgb(0, 200, 255),
               position=(-3 + i * 3, 0.5, -6), scale=(sx, sy, sx))
    Text(text=f'{sx:.1f}', position=(-3 + i * 3, 1.5, -6), scale=8,
         color=color.white, billboard=True)

# ── 参考: 地板 ──
Entity(model='cube', scale=(20, 0.2, 20), position=(0, -0.1, 0),
       color=color.hex('#1a1a2e'))
Entity(model='quad', scale=19.9, position=(0, 0.01, 0),
       rotation_x=90, color=color.hex('#222244'))

# 网格线
half = 10
line_color = color.hex('#2a2a5a')
for i in range(-half, half + 1):
    Entity(model='quad', scale=(0.03, 20, 1), position=(0, 0.02, i),
           rotation_x=90, color=line_color)
    Entity(model='quad', scale=(20, 0.03, 1), position=(i, 0.02, 0),
           rotation_x=90, color=line_color)

# ── 信息面板 ──
print("\n" + "=" * 50)
print("测试窗口已打开，请观察:")
print("  1. 是否能看到任何绿色方块")
print("  2. 不同颜色的方块哪个最清楚")
print("  3. 带/不带纹理的区别")
print("  4. 不同大小的方块可见性")
print("=" * 50)

# ── 相机 (使用游戏视角) ──
camera.position = (14, 16, 14)
camera.rotation_x = 45
camera.rotation_y = 45
camera.fov = 35

# 左上角标签
Text(text='Ursina 渲染测试', position=(-0.85, 0.45), scale=2, color=color.white,
     parent=camera.ui)

app.run()
