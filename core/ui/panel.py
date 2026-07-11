"""
UIPanel — 带标题栏的面板容器
============================
类似 Unity 的 Panel 或 UE 的 Border + Title。
可作为其他控件的分组容器。
"""

from ursina import Entity
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor


class UIPanel(UIWidget):
    """带标题栏的面板容器 - 声明式

    视觉子元素（标题栏、标题文字、边框）由 JSON 的 children 显式提供。
    约定子控件 id:
        - _title_bar  : 标题栏背景
        - _title_text : 标题文字
        - _border_top/bottom/left/right : 四条边框

    Usage (JSON):
        {"type": "UIPanel", "id": "panel", ..., "children": [
            {"type": "UIWidget", "id": "_title_bar", ...},
            {"type": "UIText", "id": "_title_text", "text": "Properties", ...},
            {"type": "UIWidget", "id": "_border_top", ...},
            ...
        ]}
    """

    def __init__(
        self,
        title: str = None,
        show_title: bool = True,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.4),
        **kwargs,
    ):
        bg_color = kwargs.pop('color', None) or ui_theme.surface
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=bg_color, **kwargs,
        )
        self.unlit = True
        self._title = title or ''
        self._children_widgets: list = []

        # 稍后在 _on_children_built 中由 JSON 子控件填充
        self._title_bar = None
        self._title_text = None
        self._border = None
        self._content_top = 0.5
        self._content_bottom = -0.5 + 0.01

    def _on_children_built(self):
        """由布局加载器在 JSON 子控件构建完成后调用"""
        self._title_bar = self._find_child('_title_bar')
        self._title_text = self._find_child('_title_text')

        # 设置标题文本（如果 JSON 提供了 _title_text）
        if self._title_text is not None and hasattr(self._title_text, '_text_entity') and self._title:
            self._title_text._text_entity.text = self._title

        # 计算内容区域
        if self._title_bar is not None:
            title_bar_h = abs(self._title_bar.scale_y) if hasattr(self._title_bar, 'scale_y') else 0.035
            self._content_top = 0.5 - title_bar_h - 0.01

        # 记录边框引用
        for b_id in ('_border_top', '_border_bottom', '_border_left', '_border_right'):
            b = self._find_child(b_id)
            if b is not None:
                self._border = b

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value
        if self._title_text:
            self._title_text.text = value

    def set_title(self, value: str):
        self.title = value
        return self

    def add_child(self, widget: UIWidget):
        self._children_widgets.append(widget)
        return self

    def clear_children(self):
        for w in self._children_widgets:
            w.destroy()
        self._children_widgets.clear()

    def destroy(self):
        from ursina import destroy as _destroy
        if self._title_bar:
            _destroy(self._title_bar)
        if self._title_text:
            _destroy(self._title_text)
        if hasattr(self, '_border_top'):
            _destroy(self._border_top)
            _destroy(self._border_bottom)
            _destroy(self._border_left)
            _destroy(self._border_right)
        for w in self._children_widgets:
            w.destroy()
        _destroy(self)
