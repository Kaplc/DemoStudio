"""
UIWidget — 基础 UI 控件类
========================
所有 UI 控件的基类，提供：

- **锚点系统** (Anchor): 类似 Unity RectTransform，快速定位到父级九宫格位置
- **偏移量** (offset): 相对锚点的微调
- **填充拉伸** (stretch): 使用 stretch_left/right/top/bottom 自动响应父级 resize
- **事件** (on_click, on_hover, on_enable, on_disable)
- **链式 API**: widget.set_position(...).set_size(...).set_color(...)

坐标系 (同 Ursina camera.ui):
    (-0.5, 0.5) 左上 ────── (0.5, 0.5) 右上
         │                         │
         │        (0,0) 中心        │
         │                         │
    (-0.5,-0.5) 左下 ────── (0.5,-0.5) 右下

Usage:
    from core.ui.widget import UIWidget, Anchor

    # 在屏幕中心创建一个按钮
    btn = UIWidget(anchor=Anchor.CENTER, size=(0.2, 0.06))

    # 在左上角创建一个标签
    lbl = UIWidget(anchor=Anchor.TOP_LEFT, offset=(0.02, -0.02), size=(0.3, 0.04))
"""

from ursina import Entity, Vec2, Vec3, camera, color
from core.ui.theme import ui_theme, UITheme

from typing import Optional, Callable


# ──────────────────────────────────────────────
# 反缩放补偿 — 子 Text 避免继承父级非均匀缩放
# ──────────────────────────────────────────────

def compensated_text_scale(font_size, entity):
    """计算子 Text 的局部 scale，补偿实体及其所有祖先的非均匀缩放

    递归遍历整个祖先链，累积所有父级 scale 的乘积作为世界空间缩放，
    然后反缩放，使 Text 在世界空间始终渲染为 font_size 大小。

    Parameters
    ----------
    font_size : float
        目标世界空间字号
    entity : Entity
        子 Text 将要挂载的父级实体

    Returns
    -------
    tuple[float, float, float]
        补偿后的 (scale_x, scale_y, scale_z)
    """
    world_sx = 1.0
    world_sy = 1.0
    p = entity
    while p is not None:
        if hasattr(p, 'scale_x'):
            world_sx *= max(abs(p.scale_x), 0.001)
            world_sy *= max(abs(p.scale_y), 0.001)
        p = getattr(p, 'parent', None)
    inv_x = 1.0 / world_sx
    inv_y = 1.0 / world_sy
    return (font_size * inv_x, font_size * inv_y, font_size)


# ──────────────────────────────────────────────
# 锚点预设 (九宫格定位)
# ──────────────────────────────────────────────

class Anchor:
    """锚点常量
    
    9 个标准定位点对应父级归一化坐标的九宫格位置。
    FULL 为全锚定（stretch），控件自动填满父级四边。
    """
    TOP_LEFT      = (-0.5,  0.5)
    TOP_CENTER    = ( 0.0,  0.5)
    TOP_RIGHT     = ( 0.5,  0.5)
    MIDDLE_LEFT   = (-0.5,  0.0)
    CENTER        = ( 0.0,  0.0)
    MIDDLE_RIGHT  = ( 0.5,  0.0)
    BOTTOM_LEFT   = (-0.5, -0.5)
    BOTTOM_CENTER = ( 0.0, -0.5)
    BOTTOM_RIGHT  = ( 0.5, -0.5)
    FULL          = 'FULL'    # 全锚定 (stretch)，填满父级


# ──────────────────────────────────────────────
# 基础 UI 控件
# ──────────────────────────────────────────────

class UIWidget(Entity):
    """所有 UI 控件的基类
    
    Parameters
    ----------
    parent : Entity, optional
        父级实体，默认 camera.ui
    anchor : tuple, optional
        锚点位置，默认 Anchor.CENTER
    offset : tuple, optional
        相对锚点的偏移量 (x, y)，默认 (0, 0)
    size : tuple, optional
        控件尺寸 (x, y)，归一化坐标，默认 (0.1, 0.1)
    pivot : tuple, optional
        轴心点，默认等于 anchor
    theme : UITheme, optional
        自定义主题，默认使用全局 ui_theme
    model : str, optional
        模型，默认 'quad'
    **kwargs
        传递给 Entity 的额外参数
    """

    # Class-level theme override
    theme: Optional[UITheme] = None

    def __init__(
        self,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.1, 0.1),
        pivot: tuple = None,
        theme: Optional[UITheme] = None,
        model: str = 'quad',
        **kwargs,
    ):
        if parent is None:
            from ursina import camera
            parent = camera.ui

        # 是否全锚定 (stretch)
        is_full = (anchor is Anchor.FULL or anchor == 'FULL')
        if is_full:
            from ursina import window
            anchor = Anchor.CENTER  # 位置 (0,0)
            # FULL = 填满父级可视区域（宽屏水平伸展，窄屏垂直填满）
            # 宽屏: aspect>=1 → scale=(aspect, 1) 填满水平两侧
            # 窄屏: aspect<1  → scale=(aspect, 1) 填满水平（垂直自动填满）
            # 非 FULL 子控件自动补偿父级缩放，世界空间尺寸不变
            size = (window.aspect_ratio, 1)

        self._anchor = Vec2(*anchor)
        self._offset = Vec2(*offset)
        self._size = Vec2(*size)
        self._is_full = is_full
        self._stretch_left = None
        self._stretch_right = None
        self._stretch_top = None
        self._stretch_bottom = None
        self._theme = theme

        # 如果没有指定 pivot，默认与 anchor 一致 (定位点即轴心)
        if pivot is None:
            pivot = anchor

        # 如果传入了自定义 position，优先使用
        custom_pos = kwargs.pop('position', None)
        custom_z = kwargs.pop('z', None)
        if custom_pos is not None:
            pos = (custom_pos[0], custom_pos[1])
        else:
            # 计算实际位置: 锚点 + 偏移
            # 补偿父级的 origin (视觉轴心偏移)，使 anchor 相对于父级的可视范围
            pox = -parent.origin_x if hasattr(parent, 'origin_x') else 0
            poy = -parent.origin_y if hasattr(parent, 'origin_y') else 0
            pos = (self._anchor.x + self._offset.x + pox,
                   self._anchor.y + self._offset.y + poy)

        # 显式渲染层级: 正值越大越靠前 (内部取反为 Panda3D 负 z = 靠近摄像机)
        z_val = -(custom_z if custom_z is not None else 0)

        # 提取其他 Entity 参数，避免 scale 被覆盖
        scale = kwargs.pop('scale', None)
        kwargs.pop('stretch', None)  # stretch 由 FULL 内部处理，不传给 Entity

        super().__init__(
            parent=parent,
            model=model,
            origin=pivot,
            position=(pos[0], pos[1], z_val),
            scale=(size[0], size[1], 1) if scale is None else scale,
            **kwargs,
        )

        # 非 FULL 锚点：对齐的是父级的一个点，不是填满面
        # 因此补偿父级缩放，使子控件的世界空间大小不受父级非均匀缩放影响
        if not is_full and parent is not None and hasattr(parent, 'scale_x'):
            psx = max(abs(parent.scale_x), 0.001)
            psy = max(abs(parent.scale_y), 0.001)
            self.scale_x = self.scale_x / psx
            self.scale_y = self.scale_y / psy

        self._click_handler: Optional[Callable] = None
        self._hover_handler: Optional[Callable] = None
        self._unhover_handler: Optional[Callable] = None
        self._enabled = True

    # ─── 主题 ───

    @property
    def ui_theme(self) -> UITheme:
        return self._theme if self._theme is not None else ui_theme

    # ─── 定位 ───

    @property
    def ui_anchor(self) -> Vec2:
        return self._anchor

    @ui_anchor.setter
    def ui_anchor(self, value: tuple):
        self._anchor = Vec2(*value)
        self._update_position()

    @property
    def ui_offset(self) -> Vec2:
        return self._offset

    @ui_offset.setter
    def ui_offset(self, value: tuple):
        self._offset = Vec2(*value)
        self._update_position()

    @property
    def ui_size(self) -> Vec2:
        return self._size

    @ui_size.setter
    def ui_size(self, value: tuple):
        self._size = Vec2(*value)
        # 补偿父级缩放，使 size 保持世界空间语义 (非 FULL 锚点对齐的是点)
        psx = max(abs(self.parent.scale_x), 0.001) if self.parent and hasattr(self.parent, 'scale_x') else 1
        psy = max(abs(self.parent.scale_y), 0.001) if self.parent and hasattr(self.parent, 'scale_y') else 1
        self.scale = (value[0] / psx, value[1] / psy, self.scale_z or 1)

    def _update_position(self):
        """根据 anchor + offset 更新位置（补偿父级 origin）"""
        parent = self.parent
        pox = -parent.origin_x if parent and hasattr(parent, 'origin_x') else 0
        poy = -parent.origin_y if parent and hasattr(parent, 'origin_y') else 0
        self.x = self._anchor.x + self._offset.x + pox
        self.y = self._anchor.y + self._offset.y + poy

    # ─── 填充拉伸 (类似 Unity 的 stretch) ───

    def set_stretch(
        self,
        left: float = None,
        right: float = None,
        top: float = None,
        bottom: float = None,
    ):
        """设置填充拉伸，widget 会随父级缩放而自动调整
        
        Parameters
        ----------
        left, right, top, bottom : float
            距离父级对应边的偏移量 (归一化坐标)
        """
        self._stretch_left = left
        self._stretch_right = right
        self._stretch_top = top
        self._stretch_bottom = bottom
        self._apply_stretch()
        return self

    def _apply_stretch(self):
        """根据拉伸约束计算位置和大小"""
        if self._stretch_left is not None and self._stretch_right is not None:
            cx = (self._stretch_left + self._stretch_right) / 2
            w = abs(self._stretch_right - self._stretch_left)
            self.x = cx
            self.scale_x = w
        if self._stretch_bottom is not None and self._stretch_top is not None:
            cy = (self._stretch_bottom + self._stretch_top) / 2
            h = abs(self._stretch_top - self._stretch_bottom)
            self.y = cy
            self.scale_y = h

    # ─── 窗口重绘 (响应 resize) ───

    def refresh(self):
        """窗口 resize 后重新计算布局

        自顶向下递归遍历控件树：
        - FULL 控件：根据当前 window.aspect_ratio 重新计算尺寸
        - 非 FULL 控件：重新补偿父级缩放 + 更新锚点位置
        - 所有控件：重新应用 stretch（若已设置）
        """
        from ursina import window

        if self._is_full:
            # FULL: 重新计算尺寸匹配当前窗口
            aspect = window.aspect_ratio
            self._size = Vec2(aspect, 1)
            self.scale = (aspect, 1, self.scale_z or 1)
            self.x = 0
            self.y = 0
        else:
            # 非 FULL: 重新补偿父级缩放
            parent = self.parent
            if parent is not None and hasattr(parent, 'scale_x'):
                psx = max(abs(parent.scale_x), 0.001)
                psy = max(abs(parent.scale_y), 0.001)
                self.scale_x = self._size.x / psx
                self.scale_y = self._size.y / psy
            # 更新锚点位置
            self._update_position()

        # 重新应用 stretch（若有）
        if any(x is not None for x in [
            self._stretch_left, self._stretch_right,
            self._stretch_top, self._stretch_bottom,
        ]):
            self._apply_stretch()

        # 递归刷新子控件（父级先更新，子级再补偿父级的新缩放）
        for child in self.children:
            if isinstance(child, UIWidget):
                child.refresh()

    # ─── 显示/隐藏 ───

    def show(self):
        """显示控件"""
        self.enabled = True
        return self

    def toggle_visible(self):
        """切换可见性"""
        self.visible = not self.visible
        return self

    # ─── 启用/禁用 ───

    @property
    def ui_enabled(self) -> bool:
        return self._enabled

    @ui_enabled.setter
    def ui_enabled(self, value: bool):
        self._enabled = value
        # 对于普通 UIWidget，禁用时降低透明度
        if not value:
            self.color = color.rgba(
                self.color.r * 255, self.color.g * 255,
                self.color.b * 255, 80,
            )
        else:
            self.color = color.rgba(
                self.color.r * 255, self.color.g * 255,
                self.color.b * 255, 255,
            )

    # ─── 事件绑定 ───

    def on_click(self, callback: Callable):
        """绑定点击事件"""
        self._click_handler = callback
        return self

    def on_hover(self, callback: Callable):
        """绑定悬停进入事件"""
        self._hover_handler = callback
        return self

    def on_unhover(self, callback: Callable):
        """绑定悬停离开事件"""
        self._unhover_handler = callback
        return self

    # ─── 链式配置 ───

    def set_position(self, x: float, y: float):
        """直接设置位置 (覆盖锚点)"""
        self.position = (x, y, self.z)
        return self

    def set_size(self, w: float, h: float):
        """设置尺寸"""
        self.ui_size = (w, h)
        return self

    def set_color(self, c):
        """设置颜色"""
        self.color = c
        return self

    def set_alpha(self, a: float):
        """设置透明度"""
        self.alpha = a
        return self

    def set_parent(self, parent):
        """重新设置父级"""
        self.parent = parent
        return self

    # ─── 工具方法 ───

    def center_on_parent(self):
        """居中到父级"""
        self.ui_anchor = Anchor.CENTER
        self._offset = Vec2(0, 0)
        return self

    def fit_to_children(self, padding: float = 0.01):
        """自动调整大小以包裹所有子控件"""
        if not self.children:
            return self
        min_x = min(c.x - c.scale_x / 2 for c in self.children if hasattr(c, 'x'))
        max_x = max(c.x + c.scale_x / 2 for c in self.children if hasattr(c, 'x'))
        min_y = min(c.y - c.scale_y / 2 for c in self.children if hasattr(c, 'y'))
        max_y = max(c.y + c.scale_y / 2 for c in self.children if hasattr(c, 'y'))
        w = (max_x - min_x) + padding * 2
        h = (max_y - min_y) + padding * 2
        self.ui_size = (w, h)
        return self

    # ─── 子控件查找 (声明式 JSON 支持) ───

    def _find_child(self, child_id: str):
        """按 _widget_id 查找已构建的子控件 (由 _on_children_built 使用)

        Parameters
        ----------
        child_id : str
            子控件的 id (JSON 中 "id" 字段)

        Returns
        -------
        Entity 或 None
        """
        for child in self.children:
            if getattr(child, '_widget_id', None) == child_id:
                return child
        return None

    def _find_children_by_type(self, widget_type: str):
        """按类型查找已构建的子控件"""
        return [c for c in self.children if type(c).__name__ == widget_type]

    def _on_children_built(self):
        """子控件构建完成后回调 (由 UILayoutLoader 在构建完所有子控件后调用)

        声明式控件的子类应重写此方法，从 self.children 中按 id 获取
        JSON 中声明的子控件并建立引用。
        """
        pass

    # ─── 销毁 ───

    def destroy(self):
        """销毁控件及其子控件"""
        from ursina import destroy as _destroy
        for child in self.children:
            _destroy(child)
        _destroy(self)

    def __repr__(self):
        return f'<{self.__class__.__name__} anchor={self._anchor} size={self._size}>'
