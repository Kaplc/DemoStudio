"""
UI 控件库 — 具体的可复用 UI 控件
================================
参考 Unity 的 uGUI 和 Unreal Engine 的 UMG 系统设计。

包含控件:
    UIImage      — 图像/图标显示
    UIText       — 文字标签
    UIButton     — 按钮 (normal/hover/pressed 状态)
    UIToggle     — 开关按钮
    UICheckbox   — 复选框 (带文字标签)
    UISlider     — 滑动条
    UIProgressBar — 进度条
    UIInputField — 文本输入框
    UIDropdown   — 下拉菜单
    UISeparator  — 分割线

所有控件继承自 UIWidget，支持锚点定位、链式 API。
"""

from ursina import (
    Entity, Text, Button, color, Vec2, Vec3,
    camera, mouse, time, held_keys, application,
)
from core.ui.theme import ui_theme, UITheme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable, Union


# ═══════════════════════════════════════════════
# UIImage
# ═══════════════════════════════════════════════

class UIImage(UIWidget):
    """图像/精灵显示控件
    
    Usage:
        img = UIImage(texture='path/to/texture', size=(0.2, 0.2))
        img.set_color(color.hex('#ff0000'))
    """

    def __init__(
        self,
        texture: str = None,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.15, 0.15),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, **kwargs,
        )
        if texture:
            self.texture = texture
        self.unlit = True


# ═══════════════════════════════════════════════
# UIText
# ═══════════════════════════════════════════════

class UIText(UIWidget):
    """文字标签控件
    
    封装 Ursina 的 Text，在其基础上添加锚点定位和主题支持。
    内部使用 Text 作为子实体，因为 Text 不是继承自 Entity 的模型。

    Usage:
        label = UIText(text='Hello World', anchor=Anchor.TOP_LEFT)
        label.set_text('New Text')
    """

    def __init__(
        self,
        text: str = '',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = None,  # Text 不需要 scale
        font_size: float = None,
        color=None,
        **kwargs,
    ):
        # UIText 不使用 quad model，而是用 Text 实体
        # 我们创建一个空的 UIWidget 作为容器，然后用 Text
        if parent is None:
            from ursina import camera
            parent = camera.ui

        self._custom_font_size = font_size

        # 不要调用 super().__init__ 创建 quad, 而是直接跳过
        # 因为 Text 自己会渲染，不需要模型
        Entity.__init__(self, parent=parent, enabled=True)
        self._anchor = Vec2(*anchor)
        self._offset = Vec2(*offset)
        self._size = Vec2(size or (0.3, 0.04))
        self._theme = None

        # 计算位置
        px = self._anchor.x + self._offset.x
        py = self._anchor.y + self._offset.y

        # 创建 Text
        self._text_entity = Text(
            parent=parent,
            text=text,
            position=(px, py, 0),
            scale=font_size if font_size else ui_theme.font_size,
            color=color if color else ui_theme.text,
            origin=(0, 0),
        )

        self._text = text
        self._color = color if color else ui_theme.text

    @property
    def text(self) -> str:
        return self._text

    @text.setter
    def text(self, value: str):
        self._text = value
        self._text_entity.text = value

    def set_text(self, value: str):
        """设置文字内容"""
        self.text = value
        return self

    @property
    def text_entity(self) -> Text:
        return self._text_entity

    @property
    def ui_color(self):
        return self._text_entity.color

    @ui_color.setter
    def ui_color(self, c):
        self._text_entity.color = c
        self._color = c

    def set_color(self, c):
        """设置文字颜色"""
        self.ui_color = c
        return self

    @property
    def font_size(self):
        return self._text_entity.scale_x if hasattr(self._text_entity, 'scale_x') else 1

    @font_size.setter
    def font_size(self, value: float):
        self._text_entity.scale = value

    def set_font_size(self, size: float):
        """设置字号"""
        self.font_size = size
        return self

    def set_anchor(self, anchor: tuple):
        """设置锚点"""
        self._anchor = Vec2(*anchor)
        px = self._anchor.x + self._offset.x
        py = self._anchor.y + self._offset.y
        self._text_entity.position = (px, py, 0)
        return self

    def set_position(self, x: float, y: float):
        """设置位置"""
        self._text_entity.position = (x, y, self._text_entity.z)
        return self

    def set_alpha(self, a: float):
        """设置透明度"""
        self._text_entity.alpha = a
        return self

    def hide(self):
        self._text_entity.enabled = False
        return self

    def show(self):
        self._text_entity.enabled = True
        return self

    @property
    def enabled(self):
        return self._text_entity.enabled

    @enabled.setter
    def enabled(self, value: bool):
        self._text_entity.enabled = value

    def destroy(self):
        if hasattr(self, '_text_entity') and self._text_entity:
            self._text_entity.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UIButton
# ═══════════════════════════════════════════════

class UIButton(UIWidget):
    """交互按钮控件
    
    支持三种视觉状态:
        - Normal: 普通状态
        - Hover: 鼠标悬停 (高亮)
        - Pressed: 按下时
    
    Usage:
        btn = UIButton(text='Click Me', anchor=Anchor.CENTER, size=(0.2, 0.06))
        btn.on_click(lambda: print('clicked!'))
    """

    def __init__(
        self,
        text: str = '',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.18, 0.05),
        font_size: float = None,
        **kwargs,
    ):
        color_normal = kwargs.pop('color', None)
        theme = kwargs.pop('theme', None)
        bg_color = color_normal or (theme.button.normal if theme else ui_theme.button.normal)
        text_color = kwargs.pop('text_color', None) or (theme.button.text if theme else ui_theme.button.text)

        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=bg_color, theme=theme, **kwargs,
        )
        self._nocolor = bg_color
        self._hovercolor = kwargs.pop('highlight_color', None) or (
            theme.button.hover if theme else ui_theme.button.hover
        )
        self._pressedcolor = kwargs.pop('pressed_color', None) or (
            theme.button.pressed if theme else ui_theme.button.pressed
        )

        self.unlit = True
        self.collider = 'box'

        # 文字
        if font_size is None:
            font_size = ui_theme.font_size * 0.8

        self._text_entity = Text(
            parent=self,
            text=text,
            position=(0, 0, -0.001),
            scale=font_size,
            color=text_color,
            origin=(0, 0),
        )

        self._text = text
        self._font_size = font_size

        # 悬停/点击状态
        self._is_hovered = False
        self._is_pressed = False

        # 绑定 Ursina 的 hover/click 事件
        self._setup_events()

    def _setup_events(self):
        """设置 Ursina 原生事件"""
        old_click = getattr(self, 'on_click', None)

        def _on_mouse_enter():
            if not self._enabled:
                return
            self._is_hovered = True
            self.color = self._hovercolor
            if self._hover_handler:
                self._hover_handler()

        def _on_mouse_exit():
            self._is_hovered = False
            self._is_pressed = False
            self.color = self._nocolor
            if self._unhover_handler:
                self._unhover_handler()

        def _on_click():
            if not self._enabled:
                return
            if self._click_handler:
                self._click_handler()

        self.on_mouse_enter = _on_mouse_enter
        self.on_mouse_exit = _on_mouse_exit
        # 不能用 on_click 直接覆盖，使用 Entity 的 click 检测
        self._click_callback = _on_click

    def input(self, key):
        if key == 'left mouse down' and self.hovered:
            self._is_pressed = True
            self.color = self._pressedcolor
        elif key == 'left mouse up' and self._is_pressed:
            self._is_pressed = False
            if self.hovered:
                self.color = self._hovercolor
                if self._click_callback:
                    self._click_callback()
            else:
                self.color = self._nocolor

    @property
    def text(self) -> str:
        return self._text

    @text.setter
    def text(self, value: str):
        self._text = value
        self._text_entity.text = value

    def set_text(self, value: str):
        """设置按钮文字"""
        self.text = value
        return self

    @property
    def text_color(self):
        return self._text_entity.color

    @text_color.setter
    def text_color(self, c):
        self._text_entity.color = c

    def set_text_color(self, c):
        self.text_color = c
        return self

    @property
    def normal_color(self):
        return self._nocolor

    @normal_color.setter
    def normal_color(self, c):
        self._nocolor = c
        if not self._is_hovered:
            self.color = c

    def set_normal_color(self, c):
        self.normal_color = c
        return self

    def set_enabled(self, enabled: bool):
        """启用/禁用按钮"""
        self._enabled = enabled
        if enabled:
            self.color = self._nocolor
        else:
            self.color = self.ui_theme.button.disabled if hasattr(self, 'ui_theme') else color.hex('#555555')
        return self

    def destroy(self):
        if hasattr(self, '_text_entity'):
            self._text_entity.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UIToggle
# ═══════════════════════════════════════════════

class UIToggle(UIWidget):
    """开关按钮 (Toggle)
    
    类似 Unity 的 Toggle，点击切换 on/off 状态。

    Usage:
        toggle = UIToggle(text='Enable Feature', anchor=Anchor.CENTER)
        toggle.on_value_changed(lambda v: print(f'toggle: {v}'))
    """

    def __init__(
        self,
        text: str = '',
        default_value: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.15, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._value = default_value
        self._on_change_cb: Optional[Callable] = None

        # 开关背景
        self._bg = Entity(
            parent=self,
            model='quad',
            scale=(0.06, 0.03, 1),
            position=(-0.03, 0, 0.001),
            color=ui_theme.toggle.on if default_value else ui_theme.toggle.off,
            origin=(-0.5, 0),
        )

        # 开关滑块
        self._thumb = Entity(
            parent=self,
            model='quad',
            scale=(0.025, 0.025, 1),
            position=(0.03 if default_value else -0.03, 0, 0.002),
            color=ui_theme.slider.thumb,
            origin=(0, 0),
        )

        # 文字标签
        self._text_entity = Text(
            parent=self,
            text=text,
            position=(0.04, 0, -0.001),
            scale=ui_theme.font_size * 0.7,
            color=ui_theme.toggle.text,
            origin=(-0.5, 0),
        )

        self._text = text

        # 事件
        def _on_enter():
            if self.hovered:
                self._bg.color = ui_theme.toggle.hover
        def _on_exit():
            self._bg.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        self.on_mouse_enter = _on_enter
        self.on_mouse_exit = _on_exit

    def input(self, key):
        if key == 'left mouse down' and self.hovered:
            self.toggle()

    @property
    def value(self) -> bool:
        return self._value

    @value.setter
    def value(self, v: bool):
        self._value = v
        self._update_visual()

    def toggle(self):
        """切换开关状态"""
        self._value = not self._value
        self._update_visual()
        if self._on_change_cb:
            self._on_change_cb(self._value)

    def _update_visual(self):
        self._bg.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        self._thumb.x = 0.03 if self._value else -0.03

    def on_value_changed(self, callback: Callable[[bool], None]):
        """绑定值变更回调"""
        self._on_change_cb = callback
        return self

    @property
    def text(self) -> str:
        return self._text

    def set_text(self, value: str):
        self._text = value
        self._text_entity.text = value
        return self

    def destroy(self):
        self._bg.destroy()
        self._thumb.destroy()
        self._text_entity.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UICheckbox
# ═══════════════════════════════════════════════

class UICheckbox(UIWidget):
    """复选框控件 (带文字标签)
    
    经典复选框，勾选/取消勾选。
    
    Usage:
        cb = UICheckbox(text='Enable Sound', default=True)
        cb.on_value_changed(lambda v: print(f'checked: {v}'))
    """

    def __init__(
        self,
        text: str = '',
        default_value: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.18, 0.035),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._value = default_value
        self._on_change_cb: Optional[Callable] = None

        # 复选框框体
        box_s = 0.03
        self._box = Entity(
            parent=self,
            model='quad',
            scale=(box_s, box_s, 1),
            position=(-0.01, 0, 0.001),
            color=ui_theme.toggle.on if default_value else ui_theme.toggle.off,
            origin=(0, 0),
        )
        # 边框
        self._border = Entity(
            parent=self,
            model='quad',
            scale=(box_s * 1.2, box_s * 1.2, 1),
            position=(-0.01, 0, 0.0005),
            color=ui_theme.border,
            origin=(0, 0),
        )

        # 勾选标记
        self._check = Text(
            parent=self,
            text='✔',
            position=(-0.01, 0, 0.002),
            scale=ui_theme.font_size * 0.6,
            color=ui_theme.toggle.checkmark,
            origin=(0, 0),
            visible=default_value,
        )

        # 文字标签
        self._text_entity = Text(
            parent=self,
            text=text,
            position=(0.03, 0, -0.001),
            scale=ui_theme.font_size * 0.7,
            color=ui_theme.toggle.text,
            origin=(-0.5, 0),
        )
        self._text = text

    def input(self, key):
        if key == 'left mouse down' and self.hovered:
            self.toggle()

    @property
    def value(self) -> bool:
        return self._value

    @value.setter
    def value(self, v: bool):
        self._value = v
        self._update_visual()

    def toggle(self):
        self._value = not self._value
        self._update_visual()
        if self._on_change_cb:
            self._on_change_cb(self._value)

    def _update_visual(self):
        self._box.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        self._check.visible = self._value

    def on_value_changed(self, callback: Callable[[bool], None]):
        self._on_change_cb = callback
        return self

    @property
    def text(self) -> str:
        return self._text

    def set_text(self, value: str):
        self._text = value
        self._text_entity.text = value
        return self

    def destroy(self):
        self._box.destroy()
        self._border.destroy()
        self._check.destroy()
        self._text_entity.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UISlider
# ═══════════════════════════════════════════════

class UISlider(UIWidget):
    """滑动条控件
    
    可拖动的滑块，支持数值范围设置。
    类似 Unity 的 Slider 或 UE 的 Slider。

    Usage:
        slider = UISlider(min=0, max=100, default=50, size=(0.25, 0.03))
        slider.on_value_changed(lambda v: print(f'value: {v}'))
    """

    def __init__(
        self,
        min_value: float = 0,
        max_value: float = 100,
        default_value: float = 0,
        step: float = 1,
        show_label: bool = True,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.03),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True

        self._min = min_value
        self._max = max_value
        self._step = step
        self._value = default_value
        self._on_change_cb: Optional[Callable] = None
        self._is_dragging = False

        # 轨道背景
        self._track = Entity(
            parent=self,
            model='quad',
            scale=(0.9, 0.25, 1),
            position=(0, 0, 0.001),
            color=ui_theme.slider.track,
            origin=(0, 0),
        )

        # 填充部分
        fill_scale = self._norm_value * 0.9
        self._fill = Entity(
            parent=self,
            model='quad',
            scale=(fill_scale or 0.01, 0.25, 1),
            position=(-0.45 + (fill_scale or 0.01) / 2, 0, 0.002),
            color=ui_theme.slider.fill,
            origin=(0, 0),
        )

        # 滑块按钮
        self._thumb = Entity(
            parent=self,
            model='quad',
            scale=(0.04, 0.5, 1),
            position=(self._thumb_x, 0, 0.003),
            color=ui_theme.slider.thumb,
            origin=(0, 0),
        )
        self._thumb.collider = 'box'

        # 数值标签
        self._show_label = show_label
        if show_label:
            self._label = Text(
                parent=self,
                text=str(int(default_value)),
                position=(0.5, 0, 0.003),
                scale=ui_theme.font_size * 0.6,
                color=ui_theme.toggle.text,
                origin=(-0.5, 0),
            )

    @property
    def _norm_value(self) -> float:
        """将值归一化到 0~1"""
        if self._max <= self._min:
            return 0
        return (self._value - self._min) / (self._max - self._min)

    @property
    def _thumb_x(self) -> float:
        return -0.45 + self._norm_value * 0.9

    @property
    def value(self) -> float:
        return self._value

    @value.setter
    def value(self, v: float):
        self._value = max(self._min, min(self._max, v))
        if self._step > 0:
            self._value = round(self._value / self._step) * self._step
        self._update_visual()

    def set_value(self, v: float):
        """设置数值"""
        self.value = v
        return self

    def _update_visual(self):
        nv = self._norm_value
        fill_w = nv * 0.9 or 0.01
        self._fill.scale_x = fill_w
        self._fill.x = -0.45 + fill_w / 2
        self._thumb.x = self._thumb_x
        if self._show_label:
            self._label.text = str(int(self._value))

    def input(self, key):
        if key == 'left mouse down' and self._thumb.hovered:
            self._is_dragging = True
            self._thumb.color = ui_theme.slider.thumb_hover
        elif key == 'left mouse up':
            if self._is_dragging:
                self._is_dragging = False
                self._thumb.color = ui_theme.slider.thumb

    def update(self):
        if self._is_dragging:
            # 获取鼠标相对滑块的位置
            # 在 Ursina 中需要将鼠标位置转换到本地空间
            mx, my = mouse.position
            # 转换到滑块的本地坐标空间
            parent_pos = self.world_position
            local_mx = mx - parent_pos.x
            # 映射到 -0.45 ~ 0.45
            t = (local_mx + 0.45) / 0.9
            t = max(0, min(1, t))
            v = self._min + t * (self._max - self._min)
            if self._step > 0:
                v = round(v / self._step) * self._step
            v = max(self._min, min(self._max, v))
            if abs(v - self._value) > 0.001:
                self._value = v
                self._update_visual()
                if self._on_change_cb:
                    self._on_change_cb(self._value)

    def on_value_changed(self, callback: Callable[[float], None]):
        self._on_change_cb = callback
        return self

    def destroy(self):
        self._track.destroy()
        self._fill.destroy()
        self._thumb.destroy()
        if self._show_label:
            self._label.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UIProgressBar
# ═══════════════════════════════════════════════

class UIProgressBar(UIWidget):
    """进度条控件 (只读)
    
    类似 Unity 的 Image (Filled) 或 UE 的 Progress Bar。
    用于显示加载进度、生命值、经验值等。

    Usage:
        bar = UIProgressBar(value=0.5, size=(0.25, 0.03))
        bar.set_progress(0.75)
    """

    def __init__(
        self,
        value: float = 0.0,
        max_value: float = 1.0,
        show_label: bool = True,
        label_format: str = '{:.0%}',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.03),
        **kwargs,
    ):
        color_bg = kwargs.pop('background_color', None) or ui_theme.slider.track
        color_fill = kwargs.pop('fill_color', None) or ui_theme.slider.fill

        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True

        self._value = value
        self._max_value = max_value
        self._label_format = label_format

        # 背景
        self._bg = Entity(
            parent=self,
            model='quad',
            scale=(1, 1, 1),
            position=(0, 0, 0.001),
            color=color_bg,
            origin=(0, 0),
        )

        # 填充
        self._fill = Entity(
            parent=self,
            model='quad',
            scale=(self._norm, 1, 1),
            position=(-0.5 + self._norm / 2, 0, 0.002),
            color=color_fill,
            origin=(0, 0),
        )

        # 标签
        self._show_label = show_label
        if show_label:
            self._label = Text(
                parent=self,
                text=self._format_value(),
                position=(0, 0, 0.003),
                scale=ui_theme.font_size * 0.6,
                color=ui_theme.text,
                origin=(0, 0),
            )

    @property
    def _norm(self) -> float:
        if self._max_value <= 0:
            return 0
        return max(0, min(1, self._value / self._max_value))

    @property
    def value(self) -> float:
        return self._value

    @value.setter
    def value(self, v: float):
        self._value = max(0, v)
        self._update_visual()

    def set_progress(self, v: float):
        """设置进度值"""
        self.value = v
        return self

    def set_max(self, m: float):
        """设置最大值"""
        self._max_value = m
        self._update_visual()
        return self

    def _format_value(self):
        try:
            return self._label_format.format(self._norm)
        except (ValueError, TypeError):
            return f'{self._value:.1f}/{self._max_value:.1f}'

    def _update_visual(self):
        n = self._norm
        self._fill.scale_x = n if n > 0.01 else 0.01
        self._fill.x = -0.5 + self._fill.scale_x / 2
        if self._show_label:
            self._label.text = self._format_value()

    def set_fill_color(self, c):
        """设置填充颜色"""
        self._fill.color = c
        return self

    def destroy(self):
        self._bg.destroy()
        self._fill.destroy()
        if self._show_label:
            self._label.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UIInputField
# ═══════════════════════════════════════════════

class UIInputField(UIWidget):
    """文本输入框
    
    类似 Unity 的 InputField 或 UE 的 TextBox。
    支持 placeholder、最大字符数、密码模式。

    Usage:
        inp = UIInputField(placeholder='Enter name...', size=(0.3, 0.04))
        inp.on_submit(lambda t: print(f'submitted: {t}'))
        inp.on_text_changed(lambda t: print(f'text: {t}'))
    """

    def __init__(
        self,
        placeholder: str = '',
        default_text: str = '',
        max_length: int = 0,
        password_mode: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.3, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.input.normal, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._text = default_text
        self._placeholder = placeholder
        self._max_length = max_length
        self._password_mode = password_mode
        self._is_focused = False
        self._cursor_visible = True
        self._cursor_timer = 0
        self._on_submit_cb: Optional[Callable] = None
        self._on_change_cb: Optional[Callable] = None

        # 显示文字
        display_text = placeholder if not default_text else default_text
        self._display = Text(
            parent=self,
            text=display_text,
            position=(-0.45, 0, 0.002),
            scale=ui_theme.font_size * 0.7,
            color=ui_theme.input.placeholder if not default_text else ui_theme.input.text,
            origin=(-0.5, 0),
        )

        # 光标
        self._cursor = Entity(
            parent=self,
            model='quad',
            scale=(0.005, 0.7, 1),
            position=(-0.45, 0, 0.003),
            color=ui_theme.input.caret,
            origin=(-0.5, 0),
            visible=False,
        )

        # 底线 (装饰)
        self._underline = Entity(
            parent=self,
            model='quad',
            scale=(1, 0.02, 1),
            position=(0, -0.5, 0.003),
            color=ui_theme.border,
            origin=(0, 0),
        )

        # 点击聚焦
        def _focus():
            self._is_focused = True
            self.color = ui_theme.input.focused
            self._underline.color = ui_theme.accent
            self._cursor_visible = True
            self._cursor_timer = 0

        def _unfocus():
            self._is_focused = False
            self.color = ui_theme.input.normal
            self._underline.color = ui_theme.border
            self._cursor.visible = False

        self.on_mouse_enter = lambda: None
        self.on_mouse_exit = lambda: None

        # 用 input 回调处理
        self._on_focus = _focus
        self._on_blur = _unfocus

    def input(self, key):
        if key == 'left mouse down':
            if self.hovered:
                self._on_focus()
            elif self._is_focused:
                self._on_blur()
            return

        if not self._is_focused:
            return

        # 文字输入
        if key == 'backspace':
            if self._text:
                self._text = self._text[:-1]
                self._update_display()
        elif key == 'enter':
            if self._on_submit_cb:
                self._on_submit_cb(self._text)
        elif key.startswith(' '):
            pass  # ignore raw space key
        elif len(key) == 1:
            if self._max_length <= 0 or len(self._text) < self._max_length:
                self._text += key
                self._update_display()

    def update(self):
        if self._is_focused:
            self._cursor_timer += time.dt
            if self._cursor_timer > 0.5:
                self._cursor_visible = not self._cursor_visible
                self._cursor_timer = 0
            self._cursor.visible = self._cursor_visible

    def _update_display(self):
        if self._text:
            display = '*' * len(self._text) if self._password_mode else self._text
            self._display.text = display
            self._display.color = ui_theme.input.text
        else:
            self._display.text = self._placeholder
            self._display.color = ui_theme.input.placeholder

        # 更新光标位置
        text_width = len(self._text) * 0.03 * ui_theme.font_size
        self._cursor.x = -0.45 + text_width

        if self._on_change_cb:
            self._on_change_cb(self._text)

    @property
    def text(self) -> str:
        return self._text

    @text.setter
    def text(self, value: str):
        self._text = value
        self._update_display()

    def set_text(self, value: str):
        """设置文字内容"""
        self.text = value
        return self

    def on_submit(self, callback: Callable[[str], None]):
        """绑定回车提交回调"""
        self._on_submit_cb = callback
        return self

    def on_text_changed(self, callback: Callable[[str], None]):
        """绑定文字变化回调"""
        self._on_change_cb = callback
        return self

    def clear(self):
        """清空输入"""
        self._text = ''
        self._update_display()
        return self

    def destroy(self):
        self._display.destroy()
        self._cursor.destroy()
        self._underline.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UIDropdown
# ═══════════════════════════════════════════════

class UIDropdown(UIWidget):
    """下拉菜单控件
    
    类似 Unity 的 Dropdown 或 UE 的 ComboBox。
    点击展开选项列表，点击选项后关闭。

    Usage:
        dd = UIDropdown(items=['Option A', 'Option B', 'Option C'])
        dd.on_selected(lambda idx, item: print(f'selected: {item}'))
    """

    def __init__(
        self,
        items: list = None,
        default_index: int = -1,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.2, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.surface, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._items = items or ['Item 1', 'Item 2']
        self._selected_index = default_index if 0 <= default_index < len(self._items) else -1
        self._is_open = False
        self._on_selected_cb: Optional[Callable] = None

        # 当前选项文字
        selected_text = self._items[self._selected_index] if self._selected_index >= 0 else 'Select...'
        self._label = Text(
            parent=self,
            text=selected_text,
            position=(-0.42, 0, 0.002),
            scale=ui_theme.font_size * 0.7,
            color=ui_theme.text,
            origin=(-0.5, 0),
        )

        # 箭头图标
        self._arrow = Text(
            parent=self,
            text='▼',
            position=(0.42, 0, 0.002),
            scale=ui_theme.font_size * 0.5,
            color=ui_theme.text_dim,
            origin=(0.5, 0),
        )

        # 下拉列表容器 (初始隐藏)
        self._dropdown_root = Entity(parent=parent, enabled=False)
        self._dropdown_items = []
        self._dropdown_bg = None

    def input(self, key):
        if key == 'left mouse down':
            if self.hovered:
                self._toggle()
            elif self._is_open:
                # 检查是否点击了下拉项
                hit_item = False
                for item_entity, idx, _ in self._dropdown_items:
                    if hasattr(item_entity, 'hovered') and item_entity.hovered:
                        self._select(idx)
                        hit_item = True
                        break
                if not hit_item:
                    self._close()

    def _toggle(self):
        if self._is_open:
            self._close()
        else:
            self._open()

    def _open(self):
        self._is_open = True
        self._rebuild_dropdown()
        self._dropdown_root.enabled = True

    def _close(self):
        self._is_open = False
        self._dropdown_root.enabled = False

    def _rebuild_dropdown(self):
        # 清除旧的
        for ent, _, _ in self._dropdown_items:
            ent.destroy()
        if self._dropdown_bg:
            self._dropdown_bg.destroy()
        self._dropdown_items.clear()

        # 计算下拉列表位置
        n = len(self._items)
        item_h = 0.035
        total_h = n * item_h + 0.01

        # 列表背景
        self._dropdown_bg = Entity(
            parent=self._dropdown_root,
            model='quad',
            scale=(self._size.x, total_h, 1),
            position=(0, -self._size.y / 2 - total_h / 2 + 0.005, 0.01),
            color=color.rgba(30, 35, 60, 240),
        )

        for i, item in enumerate(self._items):
            y_pos = -self._size.y / 2 - 0.005 - i * item_h - item_h / 2
            is_selected = (i == self._selected_index)
            item_btn = Button(
                parent=self._dropdown_root,
                text=item,
                position=(0, y_pos, 0.02),
                scale=(self._size.x, item_h),
                color=ui_theme.accent if is_selected else color.rgba(40, 50, 80, 240),
                highlight_color=ui_theme.accent_hover,
                origin=(0, 0),
            )
            self._dropdown_items.append((item_btn, i, item))

        self._arrow.text = '▲'

    def _select(self, idx: int):
        self._selected_index = idx
        item = self._items[idx] if 0 <= idx < len(self._items) else ''
        self._label.text = item
        self._close()
        if self._on_selected_cb:
            self._on_selected_cb(idx, item)

    @property
    def selected_index(self) -> int:
        return self._selected_index

    @property
    def selected_item(self) -> str:
        if 0 <= self._selected_index < len(self._items):
            return self._items[self._selected_index]
        return ''

    def set_items(self, items: list):
        """设置下拉选项"""
        self._items = items
        self._selected_index = -1
        self._label.text = 'Select...'
        return self

    def on_selected(self, callback: Callable[[int, str], None]):
        """绑定选项选择回调"""
        self._on_selected_cb = callback
        return self

    def destroy(self):
        self._label.destroy()
        self._arrow.destroy()
        for ent, _, _ in self._dropdown_items:
            ent.destroy()
        if self._dropdown_bg:
            self._dropdown_bg.destroy()
        self._dropdown_root.destroy()
        super().destroy()


# ═══════════════════════════════════════════════
# UISeparator
# ═══════════════════════════════════════════════

class UISeparator(UIWidget):
    """分割线控件
    
    用于在布局中分隔不同区域。

    Usage:
        sep = UISeparator(size=(0.3, 0.002))
    """

    def __init__(
        self,
        direction: str = 'horizontal',  # 'horizontal' | 'vertical'
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = None,
        **kwargs,
    ):
        if size is None:
            size = (0.25, 0.003) if direction == 'horizontal' else (0.003, 0.25)
        color_sep = kwargs.pop('color', None) or ui_theme.border
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color_sep, **kwargs,
        )
        self.unlit = True
