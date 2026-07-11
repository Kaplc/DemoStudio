"""
canvas — UICanvas 渲染画布
===========================
单个画布实体，负责:
    1. 接受资产来源 (文件路径 / dict / JSON 字符串 / AssetManager 资产)
    2. 自动调用 UILayoutLoader 构建控件树
    3. 作为独立渲染层挂在 camera.ui 下
    4. 管理显示/隐藏/销毁生命周期
    5. 事件处理器注入
    6. 旋转/缩放等后处理动画

类似 Unity 的 Canvas，每个 Canvas 拥有独立的 Entity root 节点。
"""

import json
from pathlib import Path
from enum import Enum, auto
from typing import Any, Optional, Callable

from ursina import Entity, camera, Vec2, color, time as ursina_time

from core.logger import get_logger
from core.assets.asset_manager import AssetManager, AssetType, AssetInfo
from core.assets.ui_layout import UILayoutLoader, LayoutNode
from core.canvas.canvas_root import CanvasRoot

logger = get_logger('canvas')


# ──────────────────────────────────────────────
# 枚举定义
# ──────────────────────────────────────────────

class CanvasLayer(Enum):
    """画布渲染层级 (数值越大越靠前)"""
    BACKGROUND = 0     # 背景层 (装饰)
    DEFAULT = 100      # 默认层 (主界面)
    PANEL = 200        # 面板层 (设置/信息面板)
    DIALOG = 300       # 对话框层
    TOOLTIP = 400      # 提示框层
    NOTIFICATION = 500 # 通知/Toast 层
    OVERLAY = 600      # 覆盖层 (加载遮罩等)
    DEBUG = 900        # 调试层

    def __int__(self):
        return self.value


class CanvasState(Enum):
    """画布生命周期状态"""
    EMPTY = auto()       # 尚未加载资产
    BUILDING = auto()    # 正在构建控件树
    READY = auto()       # 已构建, 待显示
    SHOWN = auto()       # 正在显示
    HIDDEN = auto()      # 已隐藏 (控件仍在内存)
    DESTROYED = auto()   # 已销毁


# ──────────────────────────────────────────────
# 画布配置
# ──────────────────────────────────────────────

class CanvasSettings:
    """画布渲染配置

    Parameters
    ----------
    layer : CanvasLayer
        渲染层级
    validate : bool
        构建时是否 Schema 校验
    auto_build : bool
        是否在设置资产后自动构建
    root_parent : Entity, optional
        自定义父节点, 默认 camera.ui
    enable_input : bool
        是否响应输入事件
    transparent : bool
        是否穿透点击 (设为 True 则画布不接收点击)
    sort_order : int
        同层级内的排序, 值越大越靠前
    """
    __slots__ = (
        'layer', 'validate', 'auto_build', 'root_parent',
        'enable_input', 'transparent', 'sort_order',
    )

    def __init__(
        self,
        layer: CanvasLayer = CanvasLayer.DEFAULT,
        validate: bool = True,
        auto_build: bool = True,
        root_parent: Entity = None,
        enable_input: bool = True,
        transparent: bool = False,
        sort_order: int = 0,
    ):
        self.layer = layer
        self.validate = validate
        self.auto_build = auto_build
        self.root_parent = root_parent
        self.enable_input = enable_input
        self.transparent = transparent
        self.sort_order = sort_order

    def copy(self) -> 'CanvasSettings':
        return CanvasSettings(
            layer=self.layer,
            validate=self.validate,
            auto_build=self.auto_build,
            root_parent=self.root_parent,
            enable_input=self.enable_input,
            transparent=self.transparent,
            sort_order=self.sort_order,
        )


# ──────────────────────────────────────────────
# UICanvas
# ──────────────────────────────────────────────

class UICanvas:
    """UI 渲染画布

    接受任意形式的 UI 资产，自动构建控件树并渲染到摄像机。

    用法:
        # 1. 从文件加载
        canvas = UICanvas('assets/layouts/main_menu.json')
        canvas.show()

        # 2. 从 dict 加载
        canvas = UICanvas({'ui': {'type': 'UIButton', 'id': 'btn', ...}})

        # 3. 从 AssetManager 加载
        canvas = UICanvas.from_asset(mgr, 'main_menu')

        # 4. 绑定事件
        canvas.on('start_btn', 'click', lambda: print('Start!'))

        # 5. 完整流程
        canvas = UICanvas('menu.json')
        canvas.on('btn', 'click', handler)
        canvas.on_built(lambda: print('canvas ready'))
        canvas.show(animated=True)  # 带动画显示
        canvas.hide()               # 隐藏 (保留控件)
        canvas.destroy()            # 完全销毁

    Parameters
    ----------
    source : str | Path | dict, optional
        UI 资产来源: 文件路径 / dict / JSON 字符串
    name : str, optional
        画布名称, 默认从 source 推导
    settings : CanvasSettings, optional
        渲染配置
    asset_manager : AssetManager, optional
        资产管理器
    variables : dict, optional
        传递给布局解析器的运行时变量
    """

    # 当前活跃的画布计数 (用于 z-index 自动排序)
    _canvas_count = 0

    def __init__(
        self,
        source=None,
        *,
        name: str = '',
        settings: CanvasSettings = None,
        asset_manager: AssetManager = None,
        variables: dict = None,
        canvas_manager=None,
    ):
        self._name = name or self.__class__.__name__
        self._settings = settings or CanvasSettings()
        self._asset_mgr = asset_manager or AssetManager()
        self._variables = dict(variables or {})
        self._canvas_manager = canvas_manager  # 用于嵌套 UICanvas 注册
        self._source = source
        self._source_path: Optional[Path] = None

        # 渲染根节点 (所有构建出来的控件都挂在它下面)
        self._root: Optional[Entity] = None

        # 构建状态
        self._state = CanvasState.EMPTY
        self._loader: Optional[UILayoutLoader] = None
        self._layout_node: Optional[LayoutNode] = None

        # 回调
        self._on_built_callbacks: list[Callable] = []
        self._on_show_callbacks: list[Callable] = []
        self._on_hide_callbacks: list[Callable] = []
        self._on_destroy_callbacks: list[Callable] = []
        self._event_handlers: dict[str, dict[str, Callable]] = {}

        # 动画参数
        self._anim_duration = 0.25
        self._anim_elapsed = 0.0
        self._anim_show = True
        self._animating = False

        # z-index 自动分配
        UICanvas._canvas_count += 1
        self._z_offset = UICanvas._canvas_count * 0.001

        # 如果传入了 source 且 auto_build, 自动构建
        if source is not None and self._settings.auto_build:
            self.set_source(source)

    # ─── 工厂方法 ───

    @classmethod
    def from_asset(
        cls,
        asset_manager: AssetManager,
        asset_name: str,
        *,
        name: str = '',
        settings: CanvasSettings = None,
        variables: dict = None,
    ) -> 'UICanvas':
        """从 AssetManager 加载画布"""
        asset = asset_manager.get(asset_name)
        if asset is None:
            raise KeyError(f'资产 "{asset_name}" 未注册')

        canvas = cls(
            name=name or asset_name,
            settings=settings,
            asset_manager=asset_manager,
            variables=variables,
        )
        canvas._build_from_dict(asset.data)
        return canvas

    @classmethod
    def from_dict(
        cls,
        data: dict,
        *,
        name: str = '',
        settings: CanvasSettings = None,
        asset_manager: AssetManager = None,
        variables: dict = None,
    ) -> 'UICanvas':
        """从 dict 创建画布"""
        canvas = cls(
            name=name or data.get('metadata', {}).get('name', 'canvas'),
            settings=settings,
            asset_manager=asset_manager,
            variables=variables,
        )
        canvas._build_from_dict(data)
        return canvas

    @classmethod
    def from_json_string(
        cls,
        json_str: str,
        *,
        name: str = '',
        settings: CanvasSettings = None,
        asset_manager: AssetManager = None,
        variables: dict = None,
    ) -> 'UICanvas':
        """从 JSON 字符串创建画布"""
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise ValueError(f'JSON 解析失败: {e}')
        return cls.from_dict(
            data, name=name, settings=settings,
            asset_manager=asset_manager, variables=variables,
        )

    # ─── 源管理 ───

    def set_source(self, source):
        """设置/更换资产来源并自动构建

        Parameters
        ----------
        source : str | Path | dict
            文件路径 / dict / JSON 字符串
        """
        self._source = source

        # 如果是文件路径
        if isinstance(source, (str, Path)):
            path = Path(source)
            if path.suffix in ('.json',) and path.exists():
                self._source_path = path
                self._name = path.stem
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self._build_from_dict(data)
                return

        # 如果是 dict
        if isinstance(source, dict):
            self._build_from_dict(source)
            return

        # 如果是字符串, 尝试当做 JSON 解析
        if isinstance(source, str):
            try:
                data = json.loads(source)
                self._build_from_dict(data)
                return
            except json.JSONDecodeError:
                raise ValueError(f'无法识别资产来源: {source}')

        raise TypeError(f'不支持的资产来源类型: {type(source)}')

    def reload(self):
        """重新加载 (从原始来源)"""
        if self._state in (CanvasState.SHOWN, CanvasState.HIDDEN):
            self._teardown()
        self.set_source(self._source)

    # ─── 构建 ───

    def _build_from_dict(self, data: dict):
        """从 JSON 数据构建控件树"""
        self._state = CanvasState.BUILDING

        # 创建根渲染节点 — CanvasRoot 轻量容器，始终填满屏幕
        # 资产中的根 UIPanel 挂载到 CanvasRoot 下作为同级
        parent = self._settings.root_parent or camera.ui
        self._root = CanvasRoot(
            parent=parent,
            z=-(self._z_offset + self._settings.sort_order * 0.0001),
            enabled=False,
        )

        # 恢复已注册的事件处理器
        if self._event_handlers:
            import copy
            saved_handlers = copy.deepcopy(self._event_handlers)
            self._event_handlers = saved_handlers

        # 用 mount 挂载资产到 CanvasRoot
        combined_vars = dict(data.get('variables', {}))
        combined_vars.update(self._variables)
        data_copy = dict(data)
        data_copy['variables'] = combined_vars

        root_widget = self._root.mount(
            data_copy,
            panel_id=self._name,
            asset_manager=self._asset_mgr,
            canvas_manager=self._canvas_manager,
        )

        if root_widget is None:
            logger.error('画布 "{}" 构建失败', self._name)
            self._state = CanvasState.EMPTY
            return

        self._layout_node = self._root._loader.root_node
        self._loader = self._root._loader  # 同步引用，供 get_widget 等使用


        self._state = CanvasState.READY
        logger.info('画布 "{}" 构建完成', self._name)

        # 触发构建完成回调
        for cb in self._on_built_callbacks:
            try:
                cb(self)
            except Exception as e:
                logger.error('构建回调异常: {}', e)

    def _teardown(self):
        """拆除控件树 (销毁所有 Entity)"""
        if self._root:
            from ursina import destroy as _destroy
            _destroy(self._root)
            self._root = None
        self._loader = None
        self._layout_node = None

    # ─── 显示/隐藏 ───

    def show(self, animated: bool = False):
        """显示画布

        Parameters
        ----------
        animated : bool
            是否启用淡入动画
        """
        if self._state == CanvasState.SHOWN:
            return
        if self._state == CanvasState.EMPTY:
            logger.warning('画布 "{}" 尚未加载资产, 无法显示', self._name)
            return

        if self._root:
            self._root.enabled = True
            # 逐级启用所有子 Entity
            self._enable_tree(self._root, True)

        self._state = CanvasState.SHOWN

        if animated:
            self._animating = True
            self._anim_show = True
            self._anim_elapsed = 0.0
            if self._root:
                self._root.alpha = 0.0

        for cb in self._on_show_callbacks:
            try:
                cb(self)
            except Exception as e:
                logger.error('显示回调异常: {}', e)

        logger.debug('画布 "{}" 显示', self._name)

    def hide(self, animated: bool = False):
        """隐藏画布 (控件保留在内存中)

        Parameters
        ----------
        animated : bool
            是否启用淡出动画
        """
        if self._state != CanvasState.SHOWN:
            return

        if not animated:
            self._state = CanvasState.HIDDEN
            if self._root:
                self._enable_tree(self._root, False)
        else:
            self._animating = True
            self._anim_show = False
            self._anim_elapsed = 0.0

        for cb in self._on_hide_callbacks:
            try:
                cb(self)
            except Exception as e:
                logger.error('隐藏回调异常: {}', e)

        logger.debug('画布 "{}" 隐藏', self._name)

    @staticmethod
    def _enable_tree(entity: Entity, enabled: bool):
        """递归启用/禁用 Entity 树"""
        entity.enabled = enabled
        for child in entity.children:
            UICanvas._enable_tree(child, enabled)

    def destroy(self):
        """完全销毁画布 (释放所有控件)"""
        if self._state == CanvasState.DESTROYED:
            return

        self._teardown()
        self._state = CanvasState.DESTROYED

        for cb in self._on_destroy_callbacks:
            try:
                cb(self)
            except Exception as e:
                logger.error('销毁回调异常: {}', e)

        logger.info('画布 "{}" 已销毁', self._name)

    # ─── 输入控制 ───

    def set_input_enabled(self, enabled: bool):
        """启用/禁用画布输入"""
        self._settings.enable_input = enabled
        if self._root:
            # 递归设置 collider 状态
            self._set_input_recursive(self._root, enabled)

    @staticmethod
    def _set_input_recursive(entity: Entity, enabled: bool):
        """递归设置输入状态"""
        if hasattr(entity, 'collider') and entity.collider:
            entity.ignore_input = not enabled
        for child in entity.children:
            UICanvas._set_input_recursive(child, enabled)

    # ─── 事件绑定 ───

    def on(self, widget_id: str, event: str, handler: Callable) -> 'UICanvas':
        """绑定控件事件

        Parameters
        ----------
        widget_id : str
            控件 ID
        event : str
            事件名: 'click', 'hover', 'unhover', 'value_changed', 'submit', 'selected'
        handler : Callable
            回调函数
        """
        self._event_handlers.setdefault(widget_id, {})[event] = handler

        # 如果控件已构建, 立即绑定
        if self._layout_node:
            widget = self._layout_node.find_by_id(widget_id)
            if widget:
                method_name = {
                    'click': 'on_click',
                    'hover': 'on_hover',
                    'unhover': 'on_unhover',
                    'value_changed': 'on_value_changed',
                    'submit': 'on_submit',
                    'selected': 'on_selected',
                }.get(event, event)

                if hasattr(widget, method_name):
                    getattr(widget, method_name)(handler)
        return self

    def bind_events(self, handler_map: dict[str, Callable]) -> 'UICanvas':
        """批量绑定点击事件"""
        for widget_id, handler in handler_map.items():
            self.on(widget_id, 'click', handler)
        return self

    # ─── 生命周期回调 ───

    def on_built(self, callback: Callable) -> 'UICanvas':
        """注册构建完成回调"""
        self._on_built_callbacks.append(callback)
        if self._state in (CanvasState.READY, CanvasState.SHOWN, CanvasState.HIDDEN):
            try:
                callback(self)
            except Exception as e:
                logger.error('构建回调异常: {}', e)
        return self

    def on_show(self, callback: Callable) -> 'UICanvas':
        """注册显示回调"""
        self._on_show_callbacks.append(callback)
        return self

    def on_hide(self, callback: Callable) -> 'UICanvas':
        """注册隐藏回调"""
        self._on_hide_callbacks.append(callback)
        return self

    def on_destroy(self, callback: Callable) -> 'UICanvas':
        """注册销毁回调"""
        self._on_destroy_callbacks.append(callback)
        return self

    # ─── 控件查询 ───

    def get_widget(self, widget_id: str) -> Optional[Any]:
        """根据 id 获取控件实例 (支持嵌套 UICanvas plane 内的 widget)"""
        # 优先在主画布子树中查找
        if self._layout_node:
            r = self._layout_node.find_by_id(widget_id)
            if r is not None:
                return r
        # 退化: 从 loader 的全局 _built_widgets 中找 (覆盖嵌套 plane 的情况)
        if self._loader and hasattr(self._loader, '_built_widgets'):
            return self._loader._built_widgets.get(widget_id)
        return None

    def get_widgets_by_type(self, widget_type: str) -> list[Any]:
        """根据类型获取所有控件实例"""
        if self._layout_node:
            return self._layout_node.find_all_by_type(widget_type)
        return []

    def get_widget_text(self, widget_id: str) -> Optional[str]:
        """获取控件文字"""
        widget = self.get_widget(widget_id)
        if widget and hasattr(widget, 'text'):
            return widget.text
        return None

    def set_widget_text(self, widget_id: str, text: str):
        """设置控件文字"""
        widget = self.get_widget(widget_id)
        if widget:
            if hasattr(widget, 'set_text'):
                widget.set_text(text)
            elif hasattr(widget, 'text'):
                widget.text = text

    def set_widget_prop(self, widget_id: str, key: str, value: Any):
        """设置控件任意属性"""
        widget = self.get_widget(widget_id)
        if widget and hasattr(widget, key):
            setattr(widget, key, value)

    # ─── 动画更新 (每帧调用) ───

    def update_animation(self) -> bool:
        """更新显示/隐藏动画, 返回 True 表示动画进行中

        若没有正在进行的动画 (show/hide 未用 animated=True 启动), 立即返回,
        避免每帧无谓地触碰 _root.alpha。
        """
        if not self._animating:
            return False

        if self._anim_elapsed >= self._anim_duration:
            self._animating = False
            if not self._anim_show and self._state == CanvasState.SHOWN:
                # 淡出完成
                self._state = CanvasState.HIDDEN
                if self._root:
                    self._enable_tree(self._root, False)
            return False

        delta = 0.016  # 约 60fps
        self._anim_elapsed += delta
        t = min(self._anim_elapsed / self._anim_duration, 1.0)

        if self._root:
            if self._anim_show:
                self._root.alpha = t
            else:
                self._root.alpha = 1.0 - t

        return True

    # ─── 属性 ───

    @property
    def name(self) -> str:
        return self._name

    @property
    def state(self) -> CanvasState:
        return self._state

    @property
    def is_shown(self) -> bool:
        return self._state == CanvasState.SHOWN

    @property
    def is_ready(self) -> bool:
        return self._state in (CanvasState.READY, CanvasState.SHOWN, CanvasState.HIDDEN)

    @property
    def root(self) -> Optional[Entity]:
        """画布的根渲染实体"""
        return self._root

    @property
    def settings(self) -> CanvasSettings:
        return self._settings

    @property
    def layer(self) -> CanvasLayer:
        return self._settings.layer

    @property
    def widget_count(self) -> int:
        if self._loader:
            return len(self._loader._built_widgets)
        return 0

    def print_hierarchy(self):
        """打印控件层级"""
        if self._layout_node:
            from core.assets.tools.ui_cli import _print_tree
            print(f'📋 画布 "{self._name}" 布局:')
            # 需要知道节点的 dict 表示, 这里用 LayoutNode
            def _print(node: LayoutNode, indent: int = 0):
                prefix = '  ' * indent
                extra = ''
                if hasattr(node.instance, 'text'):
                    extra = f' text="{node.instance.text}"'
                elif hasattr(node.instance, '_title'):
                    extra = f' title="{node.instance._title}"'
                print(f'{prefix}├─ {node.widget_type} "{node.widget_id}"{extra}')
                for child in node.children:
                    _print(child, indent + 1)
            _print(self._layout_node)

    def __repr__(self):
        return (f'<UICanvas "{self._name}" '
                f'[{self._state.name}] '
                f'{self.widget_count} widgets>')

    def __del__(self):
        try:
            UICanvas._canvas_count -= 1
        except Exception:
            pass
