"""
摄像机轨道控制组件 (Ursina Script 模式)
挂载: camera.add_script(CameraController())

- 滚轮: 缩放远近
- 左键拖拽: 环绕旋转
- 右键拖拽: 平移场景（仅水平方向）
"""
import math
import panda3d.core as p3d
from panda3d.core import NodePath
from ursina import camera, mouse, Vec3


class CameraController:
    """轨道摄像机组件 — 挂载到 camera 实体上作为 Script"""

    def __init__(self, azimuth=45.0, elevation=42.0, distance=30.0,
                 target=Vec3(0, 0, 0), fov=30,
                 zoom_speed=2, orbit_speed=40, pan_speed_factor=0.15):
        self.enabled = True          # 由引擎控制开关

        # 轨道参数
        self.azimuth = azimuth
        self.elevation = elevation
        self.distance = distance
        self.target = Vec3(target)

        # 灵敏度
        self.zoom_speed = zoom_speed
        self.orbit_speed = orbit_speed
        self.pan_speed_factor = pan_speed_factor

        # 范围限制
        self.min_distance = 5
        self.max_distance = 80
        self.min_elevation = 5
        self.max_elevation = 85

        # 用于逐帧差值计算（mouse.delta 是累积值，不能直接用）
        self._prev_delta = Vec3(0, 0, 0)

        # 初始化相机
        camera.fov = fov
        self.apply()

    # ─── Script 生命周期（由引擎自动调用） ───

    def input(self, key):
        """引擎自动调用 — 处理滚轮"""
        if not self.enabled:
            return
        if key == 'scroll up':
            self.distance -= self.zoom_speed
        elif key == 'scroll down':
            self.distance += self.zoom_speed

    def update(self):
        """引擎自动每帧调用 — 处理鼠标拖拽"""
        if not self.enabled:
            return

        self.distance = max(self.min_distance, min(self.max_distance, self.distance))

        # 没有按钮按下时，重置差值追踪并返回
        if not (mouse.left or mouse.right):
            self._prev_delta = Vec3(0, 0, 0)
            self.apply()
            return

        # mouse.delta 是累积值（从按下开始累计），转为逐帧差值
        dx = mouse.delta.x - self._prev_delta.x
        dy = mouse.delta.y - self._prev_delta.y
        self._prev_delta = Vec3(mouse.delta.x, mouse.delta.y, 0)

        # 只有鼠标真正在移动时才响应
        if abs(dx) < 0.0001 and abs(dy) < 0.0001:
            self.apply()
            return

        # 左键拖拽: 环绕旋转
        if mouse.left:
            self.azimuth += dx * self.orbit_speed
            self.elevation += dy * self.orbit_speed
            self.elevation = max(self.min_elevation,
                                 min(self.max_elevation, self.elevation))

        # 右键拖拽: 水平平移（不控制 Y 轴）
        if mouse.right:
            ps = self.distance * self.pan_speed_factor
            right = Vec3(camera.right.x, 0, camera.right.z).normalized()
            forward = Vec3(camera.forward.x, 0, camera.forward.z).normalized()
            self.target.x += (-dx * right.x + dy * forward.x) * ps
            self.target.z += (-dx * right.z + dy * forward.z) * ps
            # 不移 target.y — 平移不改变 Y 轴高度

        self.apply()

    # ─── 内部方法 ───

    def apply(self):
        """根据轨道参数计算摄像机位置并看向目标"""
        a = math.radians(self.azimuth)
        e = math.radians(self.elevation)
        x = self.target.x + self.distance * math.cos(e) * math.sin(a)
        y = self.target.y + self.distance * math.sin(e)
        z = self.target.z + self.distance * math.cos(e) * math.cos(a)
        camera.position = (x, y, z)
        NodePath.look_at(camera, p3d.Vec3(self.target), p3d.Vec3(0, 1, 0))

    # ─── 便捷方法 ───

    def reset(self, azimuth=45.0, elevation=42.0, distance=30.0,
              target=Vec3(0, 0, 0)):
        """重置摄像机到初始位置"""
        self.azimuth = azimuth
        self.elevation = elevation
        self.distance = distance
        self.target = Vec3(target)
        self.apply()

    def focus_on(self, position: Vec3):
        """聚焦到某个位置"""
        self.target = Vec3(position)
        self.apply()

    @property
    def position(self):
        return camera.position

    @property
    def rotation(self):
        return camera.rotation
