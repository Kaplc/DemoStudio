"""
UIImage — 图像/精灵显示控件
===========================
"""

from core.ui.widget import UIWidget, Anchor


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
