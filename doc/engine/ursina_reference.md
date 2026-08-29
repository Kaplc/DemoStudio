# Ursina Engine 完整参考文档

> 来源: https://www.ursinaengine.org
> 整理日期: 2026-07-11
> 用途: AI / 开发者快速查阅

---

## 目录

1. [安装指南](#1-安装指南)
2. [快速入门](#2-快速入门)
3. [Entity 基础](#3-entity-基础)
4. [坐标系](#4-坐标系)
5. [Ursina API](#5-ursina-api)
6. [Entity API](#6-entity-api)
7. [Button API](#7-button-api)
8. [Sprite API](#8-sprite-api)
9. [Text API](#9-text-api)
10. [Audio API](#10-audio-api)
11. [Camera API](#11-camera-api)
12. [Mouse API](#12-mouse-api)
13. [Window API](#13-window-api)
14. [Application API](#14-application-api)
15. [Scene API](#15-scene-api)
16. [Color API](#16-color-api)
17. [Vec2 / Vec3 / Vec4](#17-vec2--vec3--vec4)
18. [Light 类型](#18-light-类型)
19. [Mesh API](#19-mesh-api)
20. [程序化模型](#20-程序化模型)
21. [Prefabs](#21-prefabs)
22. [着色器](#22-着色器)
23. [全局变量](#23-全局变量)
24. [工具函数](#24-工具函数)

---

## 1. 安装指南

```bash
# 稳定版
python -m pip install ursina

# 安装可选依赖
pip install ursina[extras]

# GitHub 最新开发版
python -m pip install https://github.com/pokepetter/ursina/archive/master.zip

# 可编辑模式（适合修改源码）
git clone https://github.com/pokepetter/ursina.git
cd ursina
python -m pip install --editable .
```

---

## 2. 快速入门

```python
from ursina import *

app = Ursina()

# Entity: 世界中的物体
player = Entity(model='cube', color=color.orange, scale_y=2)

# update() 每帧自动调用
def update():
    player.x += held_keys['d'] * time.dt
    player.x -= held_keys['a'] * time.dt

def input(key):
    if key == 'space':
        player.y += 1
        invoke(setattr, player, 'y', player.y - 1, delay=.25)

app.run()
```

---

## 3. Entity 基础

### 什么是 Entity

Entity 是世界中的"事物"——类似 Unity 的 GameObject 或 Unreal 的 Actor。可以有位置、旋转、缩放、模型、纹理、颜色、update/input 函数和脚本。

### Model（模型）

内置模型: `'quad'`, `'plane'`, `'cube'`, `'sphere'`

支持的模型文件: `.obj`, `.bam`(Panda3D), `.blend`(自动转obj), `.ursinamesh`

```python
Entity(model='cube')
```

### Texture（纹理）

```python
Entity(model='cube', texture='texture_name')
Entity(model='cube', texture=e1.texture)       # 另一个纹理对象
Entity(model='cube', texture=Texture(PIL.Image.new(...)))  # PIL纹理
Entity(model='cube', texture='movie.mp4')      # 视频纹理

# Sprite: 自动适配纹理尺寸的 2D 精灵
s = Sprite('texture_name')
print(s.aspect_ratio)
```

### Color（颜色）

```python
e.color = color.red                    # 预设颜色
e.color = hsv(120, .5, .5)             # HSV (0-1)
e.color = rgb(.8, .1, 0)              # RGB (0-1)
e.color = rgb32(16, 128, 255)         # RGB (0-255)
e.color = '#aabbcc'                    # Hex
e.color = e.color.tint(.1)            # 调亮
e.color = color.random_color()        # 随机
e.color = lerp(color.red, color.green, .5)  # 插值
```

### Position（位置）

```python
e.position = Vec3(0, 0, 0)
e.position = (0, 0, 0)
e.x = 0   # 单独设置 x/y/z/e
e.world_position = Vec3(0, 0, 0)  # 世界坐标（忽略父级）
```

### Rotation（旋转）

```python
e.rotation = (0, 0, 0)
e.rotation_y = 90
e.look_at(target)                   # 看向目标
e.look_at(target, axis='up')        # 指定 up 轴
```

### Scale（缩放）

```python
e = Entity(model='cube', scale=(3, 1, 1))
```

### Update（每帧调用）

三种方式:

```python
# 方式1: 赋值
e = Entity()
def my_update(): e.x += 1 * time.dt
e.update = my_update

# 方式2: 继承
class Player(Entity):
    def update(self):
        self.x += 1 * time.dt

# 方式3: 模块顶层函数
def update():
    print('update')
```

### Input（输入处理）

```python
class Player(Entity):
    def input(self, key):
        if key == 'w': self.position += self.forward
        if key == 'd': self.animate('rotation_y', self.rotation_y + 90, duration=.1)
```

### Mouse Input（鼠标输入）

需要 Entity 有 collider。

```python
mouse.hovered_entity     # 鼠标下的实体
my_entity.hovered        # 是否被悬停

# 事件回调（需要 collider）
on_click()
on_double_click()
on_mouse_enter()
on_mouse_exit()
```

### 魔法函数

```python
on_enable()   # 启用时
on_disable()  # 禁用时
on_destroy()  # 销毁时
```

---

## 4. 坐标系

### Entity 坐标系 (右手系)

```
         y (up)
         |
         |
  (forward) z
         \ |
          \|
           *---------- x (right)
```

- **x**: 右 (right)    **y**: 上 (up)    **z**: 前 (forward)

### UI 坐标系 (归一化, -0.5 ~ 0.5)

```
(-0.5, 0.5)  top_left          top_right  (0.5, 0.5)
                  |            |
      left ------ (0,0) ------ right
                  |            |
(-0.5, -0.5) bottom_left     bottom_right (0.5, -0.5)
```

- `window.right` = `Vec2(0.5 * window.aspect_ratio, 0)`
- `camera.ui` 是一个 Entity，可移动和缩放

### 旋转方向

从轴外部向内看：x/y 轴顺时针为正，z 轴逆时针为正（后者是故意的——2D 中 `rotation_z` 顺时针）。
可修改：`Entity.rotation_directions = (-1, -1, 1)`

### Origin（原点）

控制模型的定位点（锚点）。UI 中尤其有用。

```
origin=(-.5,.5) 左上角      origin=(0,0) 中心
+----0----+                 0---------+
|         |                 |         |
|         |   vs            |         |
|         |                 |         |
+---------+                 +---------+
```

---

## 5. Ursina API

```python
Ursina(title='ursina', icon='textures/ursina.ico', borderless=False,
       fullscreen=False, size=None, forced_aspect_ratio=None, position=None,
       vsync=True, editor_ui_enabled=True, window_type='onscreen',
       development_mode=True, render_mode=None, show_ursina_splash=False, **kwargs)
```

- `.mouse` — 鼠标对象
- `run(info=True)` — 启动主循环
- `step()` — 手动控制更新循环
- `input(key)`, `input_up(key)`, `input_hold(key)` — 输入处理

---

## 6. Entity API

```python
Entity(add_to_scene_entities=True, enabled=True, **kwargs)
Entity.rotation_directions = (-1, -1, 1)
```

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `.enabled` | bool | 禁用后不可见且不运行代码 |
| `.model` | str/Mesh | 模型名或 Mesh 对象 |
| `.color` | Color | 颜色 |
| `.eternal` | bool | scene.clear() 时不销毁 |
| `.parent` | Entity | 父级 (默认 scene) |
| `.position` / `.x` / `.y` / `.z` | Vec3/float | 位置 |
| `.world_position` / `.world_x/y/z` | Vec3/float | 世界坐标 |
| `.rotation` / `.rotation_x/y/z` | Vec3/float | 旋转 |
| `.world_rotation` | Vec3 | 世界旋转 |
| `.scale` / `.scale_x/y/z` | Vec3/float | 缩放 |
| `.world_scale` | Vec3 | 世界缩放 |
| `.quaternion` | Quat | 四元数 |
| `.forward` / `.back` / `.right` / `.left` / `.up` / `.down` | Vec3 | 方向向量 |
| `.screen_position` | Vec3 | UI 空间位置 |
| `.texture` | Texture | 纹理 |
| `.texture_scale` | Vec2 | 纹理重复次数 |
| `.texture_offset` | Vec2 | 纹理偏移 |
| `.shader` | Shader | 着色器 |
| `.collider` | str/None | `'box'/'sphere'/'capsule'/'mesh'` |
| `.collision` | bool | 切换碰撞 |
| `.hovered` | bool | 鼠标悬停 |
| `.visible` | bool | 可见性 |
| `.unlit` | bool | 忽略光照 |
| `.billboard` | bool | 始终面向相机 |
| `.wireframe` | bool | 线框渲染 |
| `.alpha` | float | 透明度快捷方式 |
| `.double_sided` | bool | 双面渲染 |
| `.origin` / `.origin_x/y/z` | Vec3 | 原点偏移 |
| `.always_on_top` | bool | 最前显示 |
| `.scripts` | list | 脚本列表 |
| `.animations` | list | 动画列表 |
| `.children` | list | 子级列表 |
| `.on_click` | callable | 点击回调 |

### 方法

| 方法 | 说明 |
|------|------|
| `.enable()` / `.disable()` | 启用/禁用 |
| `.look_at(target, axis='forward', up=None)` | 看向目标 |
| `.look_at_2d(target, axis='z')` | 2D 看向 |
| `.look_at_xy(target)` / `.look_at_xz(target)` | 看向 |
| `.animate(name, value, duration=.1, curve=..., loop=False, ...)` | 属性动画 |
| `.animate_position(value, duration=.1)` | 位置动画 |
| `.animate_rotation(value, duration=.1)` | 旋转动画 |
| `.animate_scale(value, duration=.1)` | 缩放动画 |
| `.animate_color(value, duration=.1)` | 颜色动画 |
| `.fade_out(value=0, duration=.5)` | 淡出 |
| `.fade_in(value=1, duration=.5)` | 淡入 |
| `.blink(value=color.clear, duration=.1)` | 闪烁 |
| `.shake(duration=.2, magnitude=1)` | 震动 |
| `.add_script(class_instance)` | 添加脚本 |
| `.rotate(value, relative_to=None)` | 绕局部轴旋转 |
| `.intersects(traverse_target=scene, ...)` | 碰撞检测 |
| `.combine(analyze=False, auto_destroy=True)` | 合并网格 |
| `.get_position(relative_to=scene)` | 获取相对位置 |
| `.set_position(value, relative_to=scene)` | 设置相对位置 |
| `.get_shader_input(name)` | 获取着色器输入 |
| `.set_shader_input(name, value)` | 设置着色器输入 |
| `.has_ancestor(entity)` | 是否有某祖先 |
| `.get_changes(target_class=None)` | 获取变更字典 |

---

## 7. Button API

```python
Button(text='', parent=camera.ui, model=Default, radius=.1, origin=(0,0),
       text_origin=(0,0), text_size=1, color=Default, collider='box',
       highlight_scale=1, pressed_scale=1, disabled=False, **kwargs)
```

- `.text` / `.text_color` / `.text_size` / `.text_origin`
- `.icon` / `.icon_world_scale`
- `.highlight_color` (默认 `.tint(.2)`) / `.pressed_color` (默认 `.tint(-.2)`)
- `.highlight_scale` / `.pressed_scale`
- `.highlight_sound` / `.pressed_sound`
- `.disabled`
- `.on_click` / `.on_mouse_enter()` / `.on_mouse_exit()`
- `.fit_to_text(radius=.1, padding=...)`

---

## 8. Sprite API

```python
Sprite(texture=None, ppu:int=None, **kwargs)
Sprite.ppu = 100  # 类属性（每单位像素数）
```
本质是 `model='quad'` 的 Entity，自动适配纹理尺寸。`.update_scale()` — 更改纹理后刷新缩放。

---

## 9. Text API

```python
Text(text='', **kwargs)
Text.size = .025      # 类属性，默认文本大小
```

- 父级默认 `camera.ui`
- `.text` / `.color` / `.font` / `.size` / `.line_height`
- `.wordwrap` — 字符数换行
- `.width` / `.height` / `.lines`
- `.background` — 背景
- `.appear(speed=.025)` — 逐字出现动画
- 支持 HTML 标签: `<red>`, `<blue>`, `<scale:2>`, `<image:texture>`

---

## 10. Audio API

```python
Audio(sound_file_name='', volume=1, pitch=1, balance=0, loop=False,
      loops=1, autoplay=True, auto_destroy=False, **kwargs)
Audio.volume_multiplier = .5
```

- `.play()` / `.pause()` / `.resume()` / `.stop()`
- `.fade()` / `.fade_in()` / `.fade_out()`
- `.length` / `.playing` / `.time`

---

## 11. Camera API

**Camera 继承自 Entity**，因此拥有 Entity 的所有属性/方法（位置、旋转、缩放、look_at 等）。

```python
camera.position = (x, y, z)      # 相机位置
camera.rotation = (x, y, z)      # 整体旋转
camera.rotation_x = 35           # 俯仰角 (pitch)
camera.rotation_y = 45           # 偏航角 (heading)
camera.rotation_z = 0            # 翻滚角 (roll)

# 注意: Ursina 中 rotation 映射到 Panda3D 的 HPR:
#   rotation_y → heading (偏航)
#   rotation_x → pitch (俯仰)
#   Actual mapping: Entity.setHpr(Vec3(value[1], value[0], value[2]) * (-1,-1,1))

camera.look_at(target)           # 看向目标 (继承自 Entity)
camera.fov = 30                  # 视野（透视时为水平 FOV）
camera.orthographic = False      # 正交模式
camera.clip_plane_near = 0.1     # 近裁剪面
camera.clip_plane_far = 10000    # 远裁剪面
camera.aspect_ratio              # 宽高比（只读）
camera.shader                    # 后处理着色器
camera.ui                        # UI 层（Entity）
camera.overlay                   # 叠加层
camera.set_shader_input(name, value)  # 设置后处理参数
```

---

## 12. Mouse API

- `.position` / `.x` / `.y` — 鼠标位置
- `.delta` / `.velocity` — 移动量
- `.left` / `.right` / `.middle` — 按钮状态
- `.hovered_entity` — 悬停实体
- `.normal` / `.world_normal` — 表面法线
- `.point` / `.world_point` — 命中点
- `.visible` / `.locked` — 可见性/锁定
- `.collision` / `.collisions` — 碰撞信息

---

## 13. Window API

- `.title` / `.icon` / `.color`
- `.size` / `.position` / `.aspect_ratio`
- `.fullscreen` / `.borderless` / `.vsync`
- `.left` / `.right` / `.top` / `.bottom` / `.center`
- `.top_left` / `.top_right` / `.bottom_left` / `.bottom_right`
- `.forced_aspect_ratio` / `.always_on_top`
- `.render_mode` — `'default'/'wireframe'/'colliders'/'normals'`
- `.center_on_screen()` / `.next_render_mode()`

---

## 14. Application API

```python
application.paused = False      # 全局暂停
application.time_scale = 1      # 时间缩放
application.development_mode    # 开发模式
application.quit()              # 退出
application.pause() / .resume()
```

---

## 15. Scene API

```python
scene.entities = []             # 所有实体
scene.collidables = set()       # 可碰撞实体
scene.fog_color                 # 雾颜色
scene.fog_density               # 指数密度(float)或线性密度((start, end))
scene.clear()                   # 销毁所有非 eternal 实体
```

---

## 16. Color API

### 预定义颜色

`color.white`, `.smoke`, `.light_gray`, `.gray`, `.dark_gray`, `.black`,
`.red`, `.orange`, `.yellow`, `.lime`, `.green`, `.turquoise`, `.cyan`,
`.azure`, `.blue`, `.violet`, `.magenta`, `.pink`, `.brown`, `.olive`,
`.peach`, `.gold`, `.salmon`, `.clear`

带透明度: `.white10/33/50/66`, `.black10/33/50/66/90`

### 函数

| 函数 | 说明 |
|------|------|
| `hsv(h, s, v, a=1)` | 创建 HSV 颜色 |
| `rgb(r, g, b)` | RGB (0-1) |
| `rgba(r, g, b, a)` | RGBA (0-1) |
| `rgb32(r, g, b)` | RGB (0-255) |
| `rgba32(r, g, b, a=255)` | RGBA (0-255) |
| `hex(value)` | 十六进制颜色 |
| `random_color()` | 随机颜色 |
| `tint(color, amount=.2)` | 调亮 |
| `lerp(a, b, t)` | 颜色插值 |
| `inverse(color)` | 反转色 |
| `brightness(color)` | 亮度值 |
| `rgb_to_hex(r, g, b, a=1)` | 转十六进制 |

---

## 17. Vec2 / Vec3 / Vec4

```python
Vec2(x, y)     # .x .y .X .Y .yx
Vec3(x, y, z)  # .x .y .z .xy .yx .xz .yz .X .Y .Z
Vec4(x, y, z, w)
```

支持运算: `+`, `-`, `*`, `/`, `round()`, `lerp()`

---

## 18. Light 类型

```python
# 方向光（默认投射阴影）
DirectionalLight(shadows=True, **kwargs)
.look_at(Vec3(-1, -2, -1))
.shadow_map_resolution = Vec2(1024, 1024)
.update_bounds(entity=scene)

# 环境光
AmbientLight(**kwargs)

# 点光源 / 聚光灯
PointLight(**kwargs)
SpotLight(**kwargs)
```

---

## 19. Mesh API

```python
Mesh(vertices=[], triangles=[], colors=[], uvs=[], normals=[],
     static=True, mode='triangle', thickness=1, ...)
```

- mode: `'triangle'`, `'line'`, `'point'`, `'ngon'`
- `.generate()` / `.save()` / `.clear()` / `.generate_normals()`
- `.colorize(left=..., right=..., up=..., down=...)`

---

## 20. 程序化模型

```python
Quad(segments=0, ...)                         # 四边形
Circle(resolution=16, radius=.5, mode='ngon') # 圆形
Plane(subdivisions=(1,1))                     # 平面
Grid(width, height, mode='line')              # 网格
Cone(resolution=4, radius=.5, height=1)       # 圆锥
Cylinder(resolution=8, radius=.5, height=1)   # 圆柱
Pipe(base_shape=Quad, path=..., thicknesses=...)  # 管道
Terrain(heightmap='', height_values=None)     # 地形
```

---

## 21. Prefabs

### Sky
```python
Sky(**kwargs)  # 天空球
Sky.instances = []  # 所有天空实例
```

### EditorCamera
```python
EditorCamera(**kwargs)
# 按住右键拖动旋转，滚轮缩放
# .rotate_key='right mouse', .zoom_speed=1.25
# 快捷键: shift+p 正交切换, shift+f 聚焦
```

### FirstPersonController
```python
FirstPersonController(**kwargs)
.speed=5, .height=2, .mouse_sensitivity=Vec2(40,40)
.gravity=1, .jump_height=2, .max_jumps=1
```

### PlatformerController2d
```python
PlatformerController2d(**kwargs)
.walk_speed=8, .jump_height=4, .max_jumps=1, .gravity=1
```

### Animation
```python
Animation(name, fps=12, loop=True)      # 2D 帧动画（图片序列或 GIF）
FrameAnimation3d(name, fps=12)          # 3D 帧动画（OBJ 序列）
SpriteSheetAnimation(texture, animations, tileset_size=[4,1])  # 精灵表动画
Animator(animations={'idle': ..., 'walk': ...}, start_state='idle')
```

### Conversation (对话系统)
```python
Conversation(variables_object=Empty)
.start_conversation(text)  # 启动对话树
# 支持带 * 选项的对话树语法
```

---

## 22. 着色器

### 实体着色器

| 名称 | 说明 | 关键输入 |
|------|------|----------|
| `unlit_shader` | 无光照（默认） | texture_scale, texture_offset |
| `lit_with_shadows_shader` | 光照+阴影 | shadow_color, shadow_blur |
| `matcap_shader` | Matcap材质 |
| `colored_lights_shader` | 彩色光照 | top/bottom/left/right/front/back_color |
| `fresnel_shader` | 菲涅尔边缘光 | fresnel_color, fresnel_texture |
| `triplanar_shader` | 三平面贴图 | side_texture, side_texture_scale |
| `normals_shader` | 显示法线 |

### 屏幕空间(后处理)着色器

| 名称 | 说明 |
|------|------|
| `camera_grayscale_shader` | 灰度 |
| `camera_contrast_shader` | 对比度 |
| `camera_vertical_blur_shader` | 垂直模糊 |
| `pixelation_shader` | 像素化 |
| `camera_outline_shader` | 轮廓描边 |
| `fxaa` | 抗锯齿 |
| `ssao` | 环境光遮蔽 |

用法: `camera.shader = camera_grayscale_shader`

---

## 23. 全局变量

```python
time.dt        # 增量时间（秒）
time.time      # 程序运行时间（方法，需要调用）

held_keys      # dict，记录当前按下的键
# 如: held_keys['d'] -> 0或1
# held_keys['w'] / 'a' / 's' / 'up arrow' / 'down arrow'
# held_keys['left mouse down'] / 'right mouse down'

mouse          # 鼠标对象
camera         # 相机对象
window         # 窗口对象
scene          # 场景对象
application    # 应用对象
```

### input_handler

```python
input_handler.bind('z', 'w')        # z 键注册为 w
input_handler.unbind('z')           # 解除绑定
input_handler.rebind('to_key', 'from_key')
```

---

## 24. 工具函数

```python
destroy(entity, delay=0)                      # 销毁实体
invoke(function, *args, delay=0)              # 延迟调用
Func(func, *args, **kwargs)                   # 函数包装器（用于 Sequence）
Sequence(func1, delay, Func(...), loop=True)  # 序列动作
Wait(duration)                                # 等待
duplicate(entity, **kwargs)                   # 复制实体

# 射线/碰撞检测
raycast(origin, direction, distance=9999, ignore=[], debug=False) -> HitInfo
boxcast(origin, direction, distance=9999, thickness=(1,1), ...) -> HitInfo
terraincast(world_position, terrain_entity, height_values) -> float

# 数学工具
distance(a, b)
distance_2d(a, b)
lerp(a, b, t)
clamp(value, floor, ceiling)
round_to_closest(value, step)
rotate_around_point_2d(point, origin, deg)

# 工具
chunk_list(list, size)
flatten_list(list)
enumerate_2d(list2d)

# 加载模型/纹理
load_model(name, folder=..., file_types=..., use_deepcopy=False)
load_texture(name, path=..., filtering='default')
