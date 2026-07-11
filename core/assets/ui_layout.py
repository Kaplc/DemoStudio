"""
ui_layout — JSON→UI 控件树反序列化引擎
=======================================
核心功能: 将 JSON 描述的 UI 层级树解析为实际的 UIWidget 实例。
类似 Unity 的 UIBuilder 从 UXML/USS 加载布局。

工作流程:
    1. load_from_file(path)     读取 JSON 文件
    2. 变量解析 (variable resolver)  将 $var_name 替换为实际值
    3. Schema 校验 (可选)
    4. 递归构建控件树 (build_widget)
    5. 返回根控件

用法:
    from core.assets import UILayoutLoader, AssetManager

    mgr = AssetManager()
    loader = UILayoutLoader(mgr)

    # 从 JSON 文件加载
    root = loader.load_from_file('assets/layouts/main_menu.json')

    # 绑定事件
    loader.bind_events({
        'start_btn': lambda: print('Start!'),
    })
"""

import json
from pathlib import Path
from typing import Any, Optional, Callable

from core.logger import get_logger
from core.assets.asset_manager import AssetManager, AssetType
from core.assets.converters import parse_color, parse_anchor, parse_vec2, AnchorMap
from core.assets.schema import validate_layout

logger = get_logger('assets.layout')


# ──────────────────────────────────────────────
# 变量解析器
# ──────────────────────────────────────────────

class UIVariableResolver:
    """布局变量解析器

    在 JSON 中用 $var_name 或 $theme.path 引用变量/主题色。
    加载时统一替换为实际值。

    变量来源:
        1. JSON 中的 "variables" 字段
        2. 全局主题 (以 theme. 为前缀)
        3. 运行时传入的上下文变量
    """

    def __init__(self, variables: dict = None):
        self._vars: dict = dict(variables or {})

    def set(self, key: str, value: Any):
        self._vars[key] = value

    def update(self, mapping: dict):
        self._vars.update(mapping)

    def resolve(self, value: Any) -> Any:
        """递归解析值中的变量引用"""
        if isinstance(value, str):
            # 主题颜色引用: $accent, $button.normal
            if value.startswith('$'):
                var_name = value[1:]
                if var_name in self._vars:
                    return self._vars[var_name]
                # 尝试从主题解析
                from core.assets.converters import resolve_theme_color
                color_val = resolve_theme_color(var_name)
                if color_val is not None:
                    return color_val
                logger.warning('变量 "{}" 未定义', var_name)
                return value
            return value

        if isinstance(value, dict):
            return {k: self.resolve(v) for k, v in value.items()}

        if isinstance(value, list):
            return [self.resolve(item) for item in value]

        return value

    def resolve_dict(self, data: dict) -> dict:
        """解析整个字典中的所有变量引用"""
        return self.resolve(data)


# ──────────────────────────────────────────────
# 控件工厂 — 根据 type 创建 UIWidget 实例
# ──────────────────────────────────────────────

class _WidgetFactory:
    """根据 type 字符串创建对应的 UIWidget 实例"""

    # 类型 → (模块路径, 类名)
    REGISTRY: dict[str, tuple[str, str]] = {
        'UIWidget': ('core.ui.widget', 'UIWidget'),
        'UIImage': ('core.ui.image', 'UIImage'),
        'UIText': ('core.ui.label', 'UIText'),
        'UIButton': ('core.ui.button', 'UIButton'),
        'UIToggle': ('core.ui.toggle', 'UIToggle'),
        'UICheckbox': ('core.ui.checkbox', 'UICheckbox'),
        'UISlider': ('core.ui.slider', 'UISlider'),
        'UIProgressBar': ('core.ui.progressbar', 'UIProgressBar'),
        'UIInputField': ('core.ui.inputfield', 'UIInputField'),
        'UIDropdown': ('core.ui.dropdown', 'UIDropdown'),
        'UISeparator': ('core.ui.separator', 'UISeparator'),
        'UIPanel': ('core.ui.panel', 'UIPanel'),
        'UIScrollView': ('core.ui.scrollview', 'UIScrollView'),
        'UIGroupBox': ('core.ui.groupbox', 'UIGroupBox'),
        'UIWindow': ('core.ui.window', 'UIWindow'),
        'UIDialog': ('core.ui.dialog', 'UIDialog'),
        'UIHorizontalLayout': ('core.ui.layouts', 'UIHorizontalLayout'),
        'UIVerticalLayout': ('core.ui.layouts', 'UIVerticalLayout'),
        'UIGridLayout': ('core.ui.layouts', 'UIGridLayout'),
        'UICanvas': ('core.ui.canvas_plane', 'UICanvasPlane'),
        'UICanvasPlane': ('core.ui.canvas_plane', 'UICanvasPlane'),
    }

    # 缓存已导入的类
    _cache: dict[str, type] = {}

    @classmethod
    def create(cls, widget_type: str, **kwargs) -> Any:
        """创建控件实例"""
        klass = cls._get_class(widget_type)
        if klass is None:
            raise ValueError(f'未知控件类型: "{widget_type}"')
        return klass(**kwargs)

    @classmethod
    def _get_class(cls, widget_type: str) -> Optional[type]:
        """根据类型名获取类对象 (带缓存)"""
        if widget_type in cls._cache:
            return cls._cache[widget_type]

        entry = cls.REGISTRY.get(widget_type)
        if entry is None:
            return None

        module_path, class_name = entry
        try:
            import importlib
            module = importlib.import_module(module_path)
            klass = getattr(module, class_name)
            cls._cache[widget_type] = klass
            return klass
        except (ImportError, AttributeError) as e:
            logger.error('无法导入控件 {} ({}): {}', widget_type, module_path, e)
            return None

    @classmethod
    def register_custom(cls, type_name: str, module_path: str, class_name: str):
        """注册自定义控件类型"""
        cls.REGISTRY[type_name] = (module_path, class_name)
        # 清除缓存
        cls._cache.pop(type_name, None)

    @classmethod
    def known_types(cls) -> set[str]:
        return set(cls.REGISTRY.keys())


# ──────────────────────────────────────────────
# 布局节点 — 构建过程中的中间表示
# ──────────────────────────────────────────────

class LayoutNode:
    """布局节点 — 代表 JSON 中的一个控件及其子控件

    在构建过程中保存控件的层级关系，便于后续的事件绑定。
    """

    def __init__(
        self,
        widget_id: str,
        widget_type: str,
        instance: Any,
        children: list['LayoutNode'] = None,
    ):
        self.widget_id = widget_id
        self.widget_type = widget_type
        self.instance = instance      # 实际的 UIWidget 实例 (构建完成后)
        self.children = children or []

    def find_by_id(self, widget_id: str) -> Optional[Any]:
        """按 id 查找控件实例 (深度优先)"""
        if self.widget_id == widget_id:
            return self.instance
        for child in self.children:
            result = child.find_by_id(widget_id)
            if result is not None:
                return result
        return None

    def find_all_by_type(self, widget_type: str) -> list[Any]:
        """按类型查找所有控件实例"""
        result = []
        if self.widget_type == widget_type:
            result.append(self.instance)
        for child in self.children:
            result.extend(child.find_all_by_type(widget_type))
        return result

    def __repr__(self):
        return f'<LayoutNode "{self.widget_id}" ({self.widget_type}) [{len(self.children)} children]>'


# ──────────────────────────────────────────────
# UILayoutLoader — 核心加载器
# ──────────────────────────────────────────────

class UILayoutLoader:
    """UI 布局加载器 — JSON → UIWidget 树

    Parameters
    ----------
    asset_manager : AssetManager, optional
        用于缓存和管理已加载布局的资产管理器
    """

    def __init__(self, asset_manager: AssetManager = None, canvas_manager=None):
        self._mgr = asset_manager or AssetManager()
        self._resolver = UIVariableResolver()
        self._built_widgets: dict[str, Any] = {}  # id → widget 实例
        self._root_node: Optional[LayoutNode] = None
        self._canvas_manager = canvas_manager  # 用于嵌套 UICanvas 注册

        # 回调注册表: widget_id → {event_name: handler}
        self._event_handlers: dict[str, dict[str, Callable]] = {}

        # 待处理的颜色 (UIWindow/UIDialog 颜色后置设置)
        self._pending_color = None

    # ─── 属性 ───

    @property
    def asset_manager(self) -> AssetManager:
        return self._mgr

    @property
    def root_node(self) -> Optional[LayoutNode]:
        """构建后的根布局节点"""
        return self._root_node

    @property
    def root_widget(self) -> Optional[Any]:
        """构建后的根控件实例"""
        return self._root_node.instance if self._root_node else None

    def get_widget(self, widget_id: str) -> Optional[Any]:
        """根据 id 获取已构建的控件实例"""
        if self._root_node:
            return self._root_node.find_by_id(widget_id)
        return self._built_widgets.get(widget_id)

    def get_widgets_by_type(self, widget_type: str) -> list[Any]:
        """根据类型获取所有已构建的控件实例"""
        if self._root_node:
            return self._root_node.find_all_by_type(widget_type)
        return []

    # ─── 加载 ───

    def load_from_file(
        self,
        path: str | Path,
        context_vars: dict = None,
        validate: bool = True,
    ) -> Optional[Any]:
        """从 JSON 文件加载 UI 布局

        Parameters
        ----------
        path : str | Path
            JSON 布局文件路径
        context_vars : dict, optional
            运行时上下文变量
        validate : bool
            是否进行 Schema 校验, 默认 True

        Returns
        -------
        UIWidget or None
            构建好的根控件实例
        """
        path = Path(path)
        if not path.exists():
            logger.error('布局文件不存在: {}', path)
            return None

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.error('读取布局文件失败 ({}): {}', path, e)
            return None

        return self._build_from_data(data, context_vars, validate, path)

    def load_from_string(
        self,
        json_str: str,
        context_vars: dict = None,
        validate: bool = True,
    ) -> Optional[Any]:
        """从 JSON 字符串加载 UI 布局"""
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error('JSON 解析失败: {}', e)
            return None

        return self._build_from_data(data, context_vars, validate)

    def load_from_dict(
        self,
        data: dict,
        context_vars: dict = None,
        validate: bool = True,
    ) -> Optional[Any]:
        """从已解析的 dict 加载 UI 布局

        与 load_from_string 不同, 此方法跳过 JSON 序列化, 因此
        ``context_vars`` / 变量中可以包含任意 Python 对象 (如 Ursina color),
        不会被 json.dumps 拒绝。
        """
        if not isinstance(data, dict):
            logger.error('load_from_dict 需要 dict, 收到: {}', type(data))
            return None
        return self._build_from_data(data, context_vars, validate)

    def load_from_asset(self, asset_name: str) -> Optional[Any]:
        """从 AssetManager 中已注册的资产加载"""
        asset = self._mgr.get(asset_name)
        if asset is None:
            logger.error('资产 "{}" 未注册', asset_name)
            return None
        return self._build_from_data(asset.data)

    # ─── 构建 ───

    def _build_from_data(
        self,
        data: dict,
        context_vars: dict = None,
        validate: bool = True,
        source_path: Path = None,
    ) -> Optional[Any]:
        """从解析后的 JSON 数据构建 UI 控件树"""
        if not isinstance(data, dict) or 'ui' not in data:
            logger.error('JSON 数据缺少 "ui" 根字段')
            return None

        # 重置构建状态
        self._pending_color = None

        # Schema 校验
        if validate:
            result = validate_layout(data)
            if not result:
                for err in result.errors:
                    logger.error('布局校验失败: {}', err)
                for warn in result.warnings:
                    logger.warning('布局校验警告: {}', warn)

        # 设置变量
        variables = data.get('variables', {}) or {}
        if context_vars:
            variables.update(context_vars)
        self._resolver = UIVariableResolver(variables)

        # 构建控件树
        ui_data = self._resolver.resolve(data['ui'])
        self._built_widgets.clear()
        self._root_node = self._build_widget(ui_data, parent=None)

        if self._root_node is None:
            logger.error('布局构建失败')
            return None

        logger.info('布局构建完成: {} 个控件 (根: {})',
                     len(self._built_widgets), self._root_node.widget_type)

        # 注册到 AssetManager
        if source_path:
            self._mgr.load_from_json(source_path)

        # 应用事件绑定 (如果有预定义的 bindings)
        bindings = data.get('bindings', {})
        if isinstance(bindings, dict):
            self._apply_bindings(bindings)

        return self._root_node.instance

    def build_subtree(
        self,
        node_data: dict,
        parent=None,
        root_id: str = None,
    ) -> Optional[Any]:
        """构建子树 (从给定节点开始, 不作为根替换)

        Parameters
        ----------
        node_data : dict
            子树根节点的 JSON 描述
        parent : UIWidget
            父控件, 子树所有节点都挂到它下面
        root_id : str
            (可选) 覆盖子树的 widget id

        Returns
        -------
        UIWidget or None
            构建好的子树根控件实例
        """
        if root_id and 'id' not in node_data:
            node_data = dict(node_data)
            node_data['id'] = root_id
        node = self._build_widget(node_data, parent=parent)
        return node.instance if node is not None else None

    def _build_widget(
        self,
        node_data: dict,
        parent=None,
    ) -> Optional[LayoutNode]:
        """递归构建单个控件及其子控件"""
        widget_type = node_data.get('type', 'UIWidget')
        widget_id = node_data.get('id', '')

        # ─── 特殊处理: UICanvas 节点 (嵌套画布平面) ───
        if widget_type in ('UICanvas', 'UICanvasPlane'):
            inner_layout = node_data.get('canvas')
            canvas_name = node_data.get('canvas_name', widget_id or 'inline_canvas')
            # canvas_manager 优先用本 loader 注入的, 否则用 node_data 标记的
            canvas_mgr = self._canvas_manager
            if canvas_mgr is None:
                canvas_mgr = node_data.get('_canvas_manager')
            return self._build_canvas_plane(
                node_data, inner_layout, canvas_name, canvas_mgr, parent
            )

        # 提取构造参数
        kwargs = self._extract_kwargs(node_data, parent)

        try:
            # 对布局容器特殊处理: 先创建, 再加子控件
            is_layout = widget_type in (
                'UIHorizontalLayout', 'UIVerticalLayout', 'UIGridLayout'
            )

            instance = _WidgetFactory.create(widget_type, **kwargs)

            if widget_id:
                self._built_widgets[widget_id] = instance
                instance._widget_id = widget_id  # 存储 id 供子控件查找

            # 应用待处理的颜色 (针对 UIWindow/UIDialog 等无法在构造时传 color 的控件)
            if hasattr(self, '_pending_color') and self._pending_color:
                target_id, color_val = self._pending_color
                if target_id is None or target_id == widget_id:
                    instance.color = color_val
                    self._pending_color = None

        except Exception as e:
            logger.error('创建控件失败 (type={}, id={}): {}',
                         widget_type, widget_id, e)
            return None

        # 递归构建子控件
        children_nodes = []
        children_data = node_data.get('children', [])
        if isinstance(children_data, list):
            for child_data in children_data:
                child_node = self._build_widget(child_data, parent=instance)
                if child_node is not None:
                    children_nodes.append(child_node)

        # 布局容器需要调用 rebuild()
        if is_layout and hasattr(instance, 'rebuild'):
            try:
                instance.rebuild()
            except Exception as e:
                logger.warning('布局重建失败 ({}): {}', widget_id or widget_type, e)

        # ─── 后置钩子: 控件可以在 _on_children_built 中读取 JSON 提供的子控件 ───
        if hasattr(instance, '_on_children_built'):
            try:
                instance._on_children_built()
            except Exception as e:
                logger.warning('_on_children_built 异常 ({}): {}', widget_id or widget_type, e)

        return LayoutNode(
            widget_id=widget_id,
            widget_type=widget_type,
            instance=instance,
            children=children_nodes,
        )

    def _build_canvas_plane(
        self,
        node_data: dict,
        inner_layout: Optional[dict],
        canvas_name: str,
        canvas_manager,
        parent,
    ) -> Optional[LayoutNode]:
        """构建 UICanvasPlane 节点

        设计: UICanvasPlane 是一个 1x1 不可见的分组节点, 它的 children 实际
        挂到 camera.ui (而不是 plane), 这样子节点用全局 ±0.5 锚点不受 plane
        缩放影响。plane 仅作为"逻辑分组 + 显隐控制"的容器。
        通过记录 children 列表, plane.enabled = False 时连带隐藏所有 children。

        流程:
        1. 创建 plane 自身 (size=1x1, 透明)
        2. 把 node_data['children'] 当作子节点递归构建, 但 parent 传 camera.ui
        3. 记录所有子节点引用到 plane._children_refs
        4. plane.show_canvas/hide_canvas 切换 camera.ui 下的 children enabled
        """
        from ursina import camera
        widget_id = node_data.get('id', canvas_name)

        # 解析 plane 自身的 kwargs (剥除 canvas 子树)
        plane_node = {k: v for k, v in node_data.items()
                      if k not in ('canvas', 'canvas_name', '_canvas_manager', 'children')}
        kwargs = self._extract_kwargs(plane_node, parent)

        # 注入 UICanvasPlane 构造参数
        kwargs['canvas_name'] = canvas_name
        if canvas_manager is not None:
            kwargs['canvas_manager'] = canvas_manager

        try:
            # 创建 UICanvasPlane (作为分组节点)
            plane = _WidgetFactory.create('UICanvasPlane', **kwargs)

            if widget_id:
                self._built_widgets[widget_id] = plane

            # 递归构建子节点, 实际挂到 camera.ui 而非 plane
            children_nodes = []
            children_data = node_data.get('children', [])
            plane._inline_children = []  # 记录所有子节点, 供显隐控制

            if isinstance(children_data, list):
                for child_data in children_data:
                    child_node = self._build_widget(child_data, parent=camera.ui)
                    if child_node is not None:
                        children_nodes.append(child_node)
                        plane._inline_children.append(child_node.instance)

            # 关联 plane -> children (显隐)
            plane._inline_children = [c.instance if hasattr(c, 'instance') else c
                                       for c in children_nodes]

            return LayoutNode(
                widget_id=widget_id,
                widget_type='UICanvas',
                instance=plane,
                children=children_nodes,
            )
        except Exception as e:
            logger.error('创建 UICanvas 失败 (id={}): {}', widget_id, e)
            import traceback
            logger.error(traceback.format_exc())
            return None

    def _extract_kwargs(self, node: dict, parent) -> dict:
        """从 JSON 节点提取控件构造参数"""
        kwargs = {}

        # 父级
        if parent is not None:
            kwargs['parent'] = parent

        # parent_ref: 引用另一个已构建控件的 id 作为父级
        parent_ref = node.get('parent_ref')
        if parent_ref and parent_ref in self._built_widgets:
            kwargs['parent'] = self._built_widgets[parent_ref]

        # 字符串 → 实际类型转换
        # 锚点 (FULL 为全锚定，无需解析为 Vec2)
        if 'anchor' in node:
            anchor_val = node['anchor']
            if isinstance(anchor_val, str) and anchor_val.upper() == 'FULL':
                kwargs['anchor'] = 'FULL'
            else:
                kwargs['anchor'] = parse_anchor(anchor_val)

        # 偏移量
        if 'offset' in node:
            kwargs['offset'] = parse_vec2(node['offset'])

        # 尺寸
        if 'size' in node:
            kwargs['size'] = parse_vec2(node['size'])

        # 轴心 (同锚点解析)
        if 'pivot' in node:
            kwargs['pivot'] = parse_anchor(node['pivot'])

        # 颜色 (对 UIWindow/UIDialog 跳过, 因为它们在自己的 __init__ 中硬编码了 color)
        _node_type = node.get('type', '')
        _widget_id_for_color = node.get('id', '')
        if 'color' in node and _node_type not in ('UIWindow', 'UIDialog'):
            kwargs['color'] = parse_color(node['color'])
        elif 'color' in node:
            # 对窗口类: 构建后单独设置颜色
            self._pending_color = (_widget_id_for_color, parse_color(node['color']))

        # 位置
        if 'position' in node:
            kwargs['position'] = parse_vec2(node['position'])

        # 渲染层级 (z 轴, 数值越大越靠前)
        if 'z' in node:
            kwargs['z'] = node['z']

        # 透明度
        if 'alpha' in node:
            kwargs['alpha'] = node['alpha']

        # 填充拉伸 (full stretch: true 或 {left,right,top,bottom})
        if 'stretch' in node:
            kwargs['stretch'] = node['stretch']

        # ─── 控件特有属性 ───
        widget_type = node.get('type', '')

        # 文字类
        if 'text' in node:
            kwargs['text'] = node['text']
        if 'font_size' in node:
            kwargs['font_size'] = node['font_size']

        # 标题类
        if 'title' in node:
            kwargs['title'] = node['title']
        if 'show_title' in node:
            kwargs['show_title'] = node['show_title']
        if 'message' in node:
            kwargs['message'] = node['message']

        # 按钮
        if 'highlight_color' in node:
            kwargs['highlight_color'] = parse_color(node['highlight_color'])
        if 'pressed_color' in node:
            kwargs['pressed_color'] = parse_color(node['pressed_color'])
        if 'text_color' in node:
            kwargs['text_color'] = parse_color(node['text_color'])

        # 输入框
        if 'placeholder' in node:
            kwargs['placeholder'] = node['placeholder']
        if 'default_text' in node:
            kwargs['default_text'] = node['default_text']
        if 'max_length' in node:
            kwargs['max_length'] = node['max_length']
        if 'password_mode' in node:
            kwargs['password_mode'] = node['password_mode']

        # 开关/复选框
        if 'default_value' in node:
            kwargs['default_value'] = node['default_value']

        # 滑块
        if 'min_value' in node:
            kwargs['min_value'] = node['min_value']
        if 'max_value' in node:
            kwargs['max_value'] = node['max_value']
        if 'step' in node:
            kwargs['step'] = node['step']
        if 'show_label' in node:
            kwargs['show_label'] = node['show_label']

        # 进度条
        if 'label_format' in node:
            kwargs['label_format'] = node['label_format']
        if 'fill_color' in node:
            kwargs['fill_color'] = parse_color(node['fill_color'])
        if 'background_color' in node:
            kwargs['background_color'] = parse_color(node['background_color'])

        # 下拉菜单
        if 'items' in node:
            kwargs['items'] = node['items']
        if 'default_index' in node:
            kwargs['default_index'] = node['default_index']

        # 分割线
        if 'direction' in node:
            kwargs['direction'] = node['direction']

        # 窗口/面板
        if 'closable' in node:
            kwargs['closable'] = node['closable']
        if 'draggable' in node:
            kwargs['draggable'] = node['draggable']
        if 'confirm_text' in node:
            kwargs['confirm_text'] = node['confirm_text']
        if 'cancel_text' in node:
            kwargs['cancel_text'] = node['cancel_text']

        # 滚动视图
        if 'scroll_speed' in node:
            kwargs['scroll_speed'] = node['scroll_speed']

        # 布局参数
        if 'spacing' in node:
            kwargs['spacing'] = node['spacing']
        if 'padding' in node:
            kwargs['padding'] = node['padding']
        if 'cols' in node:
            kwargs['cols'] = node['cols']

        return kwargs

    # ─── 事件绑定 ───

    def bind_events(self, handler_map: dict[str, Callable]):
        """绑定事件处理器

        Parameters
        ----------
        handler_map : dict[str, Callable]
            {widget_id: handler_function}
            对所有标准交互控件绑定 on_click
        """
        for widget_id, handler in handler_map.items():
            widget = self.get_widget(widget_id)
            if widget is None:
                logger.warning('事件绑定: 找不到控件 "{}"', widget_id)
                continue
            if hasattr(widget, 'on_click'):
                widget.on_click(handler)
                logger.debug('绑定 {} → {}', widget_id, handler.__name__)

    def _apply_bindings(self, bindings: dict):
        """应用 JSON 中定义的 bindings"""
        for widget_id, events in bindings.items():
            widget = self.get_widget(widget_id)
            if widget is None:
                logger.warning('bindings: 找不到控件 "{}"', widget_id)
                continue
            for event_name, handler_ref in events.items():
                if event_name == 'on_click' and hasattr(widget, 'on_click'):
                    # 暂存回调引用, 等待外部通过 bind_events 注入
                    self._event_handlers.setdefault(widget_id, {})[event_name] = handler_ref

    def get_pending_handlers(self) -> dict[str, dict[str, str]]:
        """获取尚未绑定的处理器引用 (来自 JSON bindings)"""
        return {
            wid: events
            for wid, events in self._event_handlers.items()
        }

    # ─── 工具方法 ───

    def register_custom_widget(self, type_name: str, module_path: str, class_name: str):
        """注册自定义控件类型"""
        _WidgetFactory.register_custom(type_name, module_path, class_name)
        logger.info('注册自定义控件: {} → {}.{}', type_name, module_path, class_name)

    def print_hierarchy(self):
        """打印当前布局的层级结构"""
        if not self._root_node:
            print('[空布局]')
            return

        def _print(node: LayoutNode, indent: int = 0):
            prefix = '  ' * indent
            wid_info = f' id="{node.widget_id}"' if node.widget_id else ''
            child_count = f' [{len(node.children)} children]' if node.children else ''
            print(f'{prefix}├─ {node.widget_type}{wid_info}{child_count}')
            for child in node.children:
                _print(child, indent + 1)

        print('📋 UI 布局层级:')
        _print(self._root_node)
