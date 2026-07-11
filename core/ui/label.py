"""
UIText — 文字标签控件
=====================
封装 Ursina 的 Text，在其基础上添加锚点定位和主题支持。

位置统一由 anchor + offset 计算，parent 仅决定坐标系参考。
不区分独立/子控件模式，一律使用相同定位逻辑。
"""

from ursina import Text, color as _ucolor
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor, compensated_text_scale


class UIText(UIWidget):
    """文字标签控件
    
    parent 参数仅决定坐标系参考，不影响位置计算方式。
    位置统一由 anchor + offset 计算。
    
    Usage:
        label = UIText(text='Hello World', anchor=Anchor.TOP_LEFT)
        label = UIText(text='Hello', parent=btn, anchor=Anchor.CENTER)
    """

    def __init__(
        self,
        text: str = '',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = None,
        font_size: float = None,
        color=None,
        **kwargs,
    ):
        self._custom_font_size = font_size
        self._text_entity = None

        # 文字颜色 + 字号
        text_color_val = color if color else ui_theme.text
        fs = font_size if font_size else ui_theme.font_size

        # 统一使用 UIWidget 定位: anchor + offset 计算位置
        # 容器透明，仅提供定位锚点，不贡献视觉
        UIWidget.__init__(
            self, parent=parent, anchor=anchor, offset=offset,
            size=size or (1, 1), color=_ucolor.clear,
            **kwargs,
        )

        # Text 子实体: 挂在 self 下，用 compensated_text_scale 补偿祖先非均匀缩放
        # 使文字在世界空间始终以 uniform 大小渲染
        text_scale = compensated_text_scale(fs, self)
        self._text_entity = Text(
            parent=self,
            text=text,
            position=(0, 0, -0.001),
            scale=text_scale,
            color=text_color_val,
            origin=(0, 0),
        )
        self._text = text
        self._color = text_color_val

    @property
    def text(self) -> str:
        return self._text

    @text.setter
    def text(self, value: str):
        self._text = value
        self._text_entity.text = value

    def set_text(self, value: str):
        self.text = value
        return self

    @property
    def text_entity(self):
        return self._text_entity

    @property
    def ui_color(self):
        return self._text_entity.color

    @ui_color.setter
    def ui_color(self, c):
        self._text_entity.color = c
        self._color = c

    def set_color(self, c):
        self.ui_color = c
        return self

    @property
    def font_size(self):
        return self._text_entity.scale_x if hasattr(self._text_entity, 'scale_x') else 1

    @font_size.setter
    def font_size(self, value: float):
        self._text_entity.scale = value

    def set_font_size(self, size: float):
        self.font_size = size
        return self

    def set_anchor(self, anchor: tuple):
        """设置锚点位置并更新（链式 API）"""
        self.ui_anchor = anchor  # 使用 UIWidget 的 setter，自动调用 _update_position
        return self

    def set_position(self, x: float, y: float):
        """设置控件位置（链式 API）"""
        self.position = (x, y, self.z)
        return self

    def set_alpha(self, a: float):
        self._text_entity.alpha = a
        return self

    def hide(self, *args):
        if not args and self._text_entity is not None:
            self._text_entity.enabled = False
        return self

    def show(self, *args):
        if not args and self._text_entity is not None:
            self._text_entity.enabled = True
        return self

    @property
    def enabled(self):
        if self._text_entity is None:
            return True
        return self._text_entity.enabled

    @enabled.setter
    def enabled(self, value: bool):
        if self._text_entity is not None:
            self._text_entity.enabled = value

    def destroy(self):
        from ursina import destroy as _destroy
        if hasattr(self, '_text_entity') and self._text_entity:
            _destroy(self._text_entity)
        _destroy(self)
