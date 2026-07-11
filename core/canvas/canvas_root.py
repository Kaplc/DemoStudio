"""
CanvasRoot — 顶级画布根容器
============================
轻量 Entity，可挂载多个 UIPanel 资产作为同级子节点。
自身保持 scale=(1,1,1)，所有资产通过 mount() 挂载。

资产根节点用 FULL 锚点自动拉伸到全屏（含宽屏两侧），
其非 FULL 子控件会自动补偿父级缩放，不被压扁。

窗口 resize 自动感知：update() 每帧检测 window.aspect_ratio
变化，触发所有 UIWidget 递归刷新布局。
"""

from pathlib import Path
from typing import Optional

from ursina import Entity, color, camera, window

from core.logger import get_logger
from core.assets.ui_layout import UILayoutLoader
from core.assets.asset_manager import AssetManager
from core.ui.widget import UIWidget

logger = get_logger('canvas.root')


class CanvasRoot(Entity):
    """顶级画布根容器

    自动填满 camera.ui 空间，可挂载多个 UIPanel 资产作为同级子节点。
    内置窗口 resize 检测，自动刷新子控件布局。

    Parameters
    ----------
    z : float
        渲染层级偏移 (正值越大越靠前)
    enabled : bool
        初始可见性
    """

    def __init__(
        self,
        z: float = 0,
        enabled: bool = False,
        **kwargs,
    ):
        super().__init__(
            parent=kwargs.pop('parent', None),
            model='quad',
            scale=(1, 1, 1),
            position=(0, 0, z),
            color=color.clear,
            enabled=enabled,
            **kwargs,
        )
        self._loader = UILayoutLoader()
        self._mounted_panels: dict[str, Entity] = {}
        self._last_aspect: float = window.aspect_ratio  # 初始值，避免启动时误触发

    # ─── 资产挂载 ───

    def mount(self, source, panel_id: str = None, z: float = None,
              asset_manager: AssetManager = None,
              canvas_manager=None) -> Optional[Entity]:
        """挂载一个 UI 资产作为同级面板

        Parameters
        ----------
        source : str | Path | dict
            JSON 文件路径 / dict
        panel_id : str, optional
            面板标识，默认用资产根节点的 id
        z : float, optional
            覆盖根 panel 的渲染层级
        asset_manager : AssetManager, optional
            资产管理器
        canvas_manager : CanvasManager, optional
            画布管理器 (用于嵌套 UICanvas)

        Returns
        -------
        Entity or None
            挂载的根 UIPanel 实例
        """
        loader = UILayoutLoader(asset_manager, canvas_manager=canvas_manager)

        if isinstance(source, (str, Path)):
            root = loader.load_from_file(str(source), validate=False)
        elif isinstance(source, dict):
            root = loader.load_from_dict(source, validate=False)
        else:
            logger.error('不支持的资产来源: {}', type(source))
            return None

        if root is None:
            logger.error('资产挂载失败')
            return None

        # 挂到 CanvasRoot 下
        root.parent = self
        pid = panel_id or getattr(root, '_widget_id', None) or f'panel_{len(self._mounted_panels)}'

        if z is not None:
            root.z = -z

        self._loader = loader  # 保存 loader，供外部获取 _built_widgets
        self._mounted_panels[pid] = root
        logger.info('资产挂载: {} (z={})', pid, -root.z if hasattr(root, 'z') else '?')
        return root

    def unmount(self, panel_id: str):
        """卸载指定面板"""
        panel = self._mounted_panels.pop(panel_id, None)
        if panel:
            from ursina import destroy
            destroy(panel)
            logger.info('资产卸载: {}', panel_id)
        else:
            logger.warning('未找到面板: {}', panel_id)

    def unmount_all(self):
        """卸载所有面板"""
        for pid in list(self._mounted_panels.keys()):
            self.unmount(pid)

    @property
    def mounted_panels(self) -> dict[str, Entity]:
        """已挂载的面板字典 {id: panel}"""
        return dict(self._mounted_panels)

    # ─── 窗口 resize 自动重绘 ───

    def update(self):
        """每帧检测窗口 aspect_ratio 变化，触发布局刷新

        Ursina 引擎在 Entity enabled 时自动每帧调用此方法。
        """
        current = window.aspect_ratio
        if abs(current - self._last_aspect) > 0.0001:
            self._last_aspect = current
            self._refresh_layouts()

    def _refresh_layouts(self):
        """递归刷新所有已挂载面板的子控件布局

        自顶向下调用 UIWidget.refresh()，父级先更新尺寸，
        子级再基于父级新缩放重新补偿。
        """
        logger.info('窗口大小改变 (aspect={:.4f})，重新计算布局', self._last_aspect)
        for child in tuple(self.children):
            if isinstance(child, UIWidget):
                child.refresh()
