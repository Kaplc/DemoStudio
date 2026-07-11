"""
layout_builder — 链式 API 构建 UI 节点树
===========================================
用 Python 方法链构建 UI 布局，比手写 JSON 更友好。
构建结果可以直接保存为 JSON 文件。

用法:
    # 构建完整布局
    root = (LayoutBuilder('main_win', 'UIWindow')
        .set_title('DemoStudio')
        .set_anchor('CENTER')
        .set_size(0.4, 0.5)
        .add_child('title_text', 'UIText')
            .set_text('Hello')
            .set_anchor('TOP_CENTER')
            .set_offset(0, -0.08)
            .set_color('$accent')
            .set_font_size(1.4)
            .up()
        .add_child('start_btn', 'UIButton')
            .set_text('▶ Start')
            .set_color('#4a9f6a')
            .set_highlight_color('#5abf7a')
            .up()
        .set_binding('start_btn', 'on_click', 'start_game')
    )
    root.save('assets/layouts/menu.json')

    # 或者用静态方法构建
    btn = LayoutBuilder.create_button(
        id='btn1', text='Click', color='$primary_color',
        anchor='CENTER', size=(0.2, 0.05),
    )
"""

import json
from pathlib import Path
from typing import Any, Optional

from core.logger import get_logger

logger = get_logger('assets.tools.builder')


# ──────────────────────────────────────────────
# LayoutBuilder
# ──────────────────────────────────────────────

class LayoutBuilder:
    """UI 布局构建器 — 链式 API

    内部维护一个栈，add_child 后自动切换到子节点，
    up() 返回父节点。end() 返回根节点。
    """

    def __init__(self, widget_id: str, widget_type: str = 'UIWidget'):
        self._root = self._make_node(widget_id, widget_type)
        self._stack = [self._root]  # 节点栈
        self._bindings: dict[str, dict[str, str]] = {}
        self._variables: dict[str, Any] = {}
        self._metadata: dict[str, Any] = {}

    # ─── 内部节点结构 ───

    @staticmethod
    def _make_node(widget_id: str, widget_type: str, **extra) -> dict:
        node = {'type': widget_type, 'id': widget_id}
        node.update(extra)
        return node

    @property
    def _current(self) -> dict:
        """当前操作的节点"""
        return self._stack[-1]

    # ─── 导航 ───

    def up(self) -> 'LayoutBuilder':
        """返回父节点"""
        if len(self._stack) > 1:
            self._stack.pop()
        return self

    def root(self) -> 'LayoutBuilder':
        """跳回根节点"""
        self._stack = [self._root]
        return self

    def end(self) -> dict:
        """结束构建，返回根节点 dict"""
        return self._root

    # ─── 通用属性设置 ───

    def set(self, key: str, value: Any) -> 'LayoutBuilder':
        """设置任意属性"""
        self._current[key] = value
        return self

    def set_anchor(self, anchor: str | tuple) -> 'LayoutBuilder':
        """设置锚点"""
        if isinstance(anchor, tuple):
            self._current['anchor'] = list(anchor)
        else:
            self._current['anchor'] = anchor
        return self

    def set_offset(self, x: float, y: float) -> 'LayoutBuilder':
        """设置偏移量"""
        self._current['offset'] = [x, y]
        return self

    def set_size(self, w: float, h: float) -> 'LayoutBuilder':
        """设置尺寸"""
        self._current['size'] = [w, h]
        return self

    def set_position(self, x: float, y: float) -> 'LayoutBuilder':
        """设置位置 (覆盖锚点)"""
        self._current['position'] = [x, y]
        return self

    def set_pivot(self, pivot: str | tuple) -> 'LayoutBuilder':
        """设置轴心"""
        if isinstance(pivot, tuple):
            self._current['pivot'] = list(pivot)
        else:
            self._current['pivot'] = pivot
        return self

    def set_color(self, color: str) -> 'LayoutBuilder':
        """设置颜色 (支持 #hex 或 $theme)"""
        self._current['color'] = color
        return self

    def set_alpha(self, alpha: float) -> 'LayoutBuilder':
        """设置透明度"""
        self._current['alpha'] = alpha
        return self

    def set_z(self, z: float) -> 'LayoutBuilder':
        """设置渲染层级"""
        self._current['z'] = z
        return self

    def set_enabled(self, enabled: bool) -> 'LayoutBuilder':
        """设置启用状态"""
        self._current['enabled'] = enabled
        return self

    def set_visible(self, visible: bool) -> 'LayoutBuilder':
        """设置可见性"""
        self._current['visible'] = visible
        return self

    def set_stretch(self, left: float = None, right: float = None,
                     top: float = None, bottom: float = None) -> 'LayoutBuilder':
        """设置填充拉伸 (跟随父级四边)"""
        data = {}
        if left is not None: data['left'] = left
        if right is not None: data['right'] = right
        if top is not None: data['top'] = top
        if bottom is not None: data['bottom'] = bottom
        if len(data) == 4:
            self._current['stretch'] = True
        elif data:
            self._current['stretch'] = data
        return self

    # ─── 控件特有属性 ───

    def set_text(self, text: str) -> 'LayoutBuilder':
        """设置文字"""
        self._current['text'] = text
        return self

    def set_title(self, title: str) -> 'LayoutBuilder':
        """设置标题 (Panel/Window)"""
        self._current['title'] = title
        return self

    def set_font_size(self, size: float) -> 'LayoutBuilder':
        """设置字号"""
        self._current['font_size'] = size
        return self

    def set_highlight_color(self, color: str) -> 'LayoutBuilder':
        """设置悬停高亮色 (按钮)"""
        self._current['highlight_color'] = color
        return self

    def set_pressed_color(self, color: str) -> 'LayoutBuilder':
        """设置按下颜色 (按钮)"""
        self._current['pressed_color'] = color
        return self

    def set_text_color(self, color: str) -> 'LayoutBuilder':
        """设置文字颜色"""
        self._current['text_color'] = color
        return self

    def set_placeholder(self, text: str) -> 'LayoutBuilder':
        """设置占位文字 (输入框)"""
        self._current['placeholder'] = text
        return self

    def set_default_text(self, text: str) -> 'LayoutBuilder':
        """设置默认文字 (输入框)"""
        self._current['default_text'] = text
        return self

    def set_default_value(self, value: bool | float) -> 'LayoutBuilder':
        """设置默认值 (Toggle/Checkbox/Slider)"""
        self._current['default_value'] = value
        return self

    def set_min(self, value: float) -> 'LayoutBuilder':
        """设置最小值 (Slider)"""
        self._current['min_value'] = value
        return self

    def set_max(self, value: float) -> 'LayoutBuilder':
        """设置最大值 (Slider)"""
        self._current['max_value'] = value
        return self

    def set_step(self, value: float) -> 'LayoutBuilder':
        """设置步长 (Slider)"""
        self._current['step'] = value
        return self

    def set_items(self, items: list) -> 'LayoutBuilder':
        """设置下拉选项 (Dropdown)"""
        self._current['items'] = items
        return self

    def set_default_index(self, index: int) -> 'LayoutBuilder':
        """设置默认选项索引 (Dropdown)"""
        self._current['default_index'] = index
        return self

    def set_message(self, text: str) -> 'LayoutBuilder':
        """设置消息文本 (Dialog)"""
        self._current['message'] = text
        return self

    def set_closable(self, closable: bool) -> 'LayoutBuilder':
        """设置可关闭 (Window)"""
        self._current['closable'] = closable
        return self

    def set_draggable(self, draggable: bool) -> 'LayoutBuilder':
        """设置可拖拽 (Window)"""
        self._current['draggable'] = draggable
        return self

    def set_spacing(self, spacing: float) -> 'LayoutBuilder':
        """设置间距 (Layout)"""
        self._current['spacing'] = spacing
        return self

    def set_padding(self, padding: float) -> 'LayoutBuilder':
        """设置内边距 (Layout)"""
        self._current['padding'] = padding
        return self

    def set_cols(self, cols: int) -> 'LayoutBuilder':
        """设置列数 (GridLayout)"""
        self._current['cols'] = cols
        return self

    def set_direction(self, direction: str) -> 'LayoutBuilder':
        """设置方向 (Separator)"""
        self._current['direction'] = direction
        return self

    def set_scroll_speed(self, speed: float) -> 'LayoutBuilder':
        """设置滚动速度 (ScrollView)"""
        self._current['scroll_speed'] = speed
        return self

    def set_show_title(self, show: bool) -> 'LayoutBuilder':
        """设置是否显示标题栏"""
        self._current['show_title'] = show
        return self

    def set_show_label(self, show: bool) -> 'LayoutBuilder':
        """设置是否显示数值标签"""
        self._current['show_label'] = show
        return self

    def set_label_format(self, fmt: str) -> 'LayoutBuilder':
        """设置标签格式 (ProgressBar)"""
        self._current['label_format'] = fmt
        return self

    def set_fill_color(self, color: str) -> 'LayoutBuilder':
        """设置填充颜色 (ProgressBar)"""
        self._current['fill_color'] = color
        return self

    def set_background_color(self, color: str) -> 'LayoutBuilder':
        """设置背景颜色 (ProgressBar)"""
        self._current['background_color'] = color
        return self

    def set_parent_ref(self, ref_id: str) -> 'LayoutBuilder':
        """设置父级引用 (指定另一个控件的 id 作为父级)"""
        self._current['parent_ref'] = ref_id
        return self

    # ─── 子控件管理 ───

    def add_child(self, widget_id: str, widget_type: str = 'UIWidget') -> 'LayoutBuilder':
        """添加子控件并切换到该子节点"""
        node = self._make_node(widget_id, widget_type)
        self._current.setdefault('children', []).append(node)
        self._stack.append(node)
        return self

    def add_sibling(self, widget_id: str, widget_type: str = 'UIWidget') -> 'LayoutBuilder':
        """在当前层级添加同级节点 (不切换)"""
        node = self._make_node(widget_id, widget_type)
        # 回到父级再添加
        if len(self._stack) >= 2:
            parent = self._stack[-2]
            parent.setdefault('children', []).append(node)
        return self

    def insert_child(self, widget_id: str, widget_type: str,
                     index: int = 0) -> 'LayoutBuilder':
        """在指定位置插入子控件并切换到该子节点"""
        node = self._make_node(widget_id, widget_type)
        children = self._current.setdefault('children', [])
        children.insert(index, node)
        self._stack.append(node)
        return self

    # ─── 元数据 / 变量 / 绑定 ───

    def set_metadata(self, key: str, value: Any) -> 'LayoutBuilder':
        """设置元数据 (name, version, description, author)"""
        self._metadata[key] = value
        return self

    def set_variable(self, name: str, value: Any) -> 'LayoutBuilder':
        """设置布局变量"""
        self._variables[name] = value
        return self

    def set_binding(self, widget_id: str, event: str, handler: str) -> 'LayoutBuilder':
        """设置事件绑定"""
        self._bindings.setdefault(widget_id, {})[event] = handler
        return self

    def remove_binding(self, widget_id: str, event: str = None) -> 'LayoutBuilder':
        """移除事件绑定"""
        if event is None:
            self._bindings.pop(widget_id, None)
        else:
            events = self._bindings.get(widget_id, {})
            events.pop(event, None)
            if not events:
                self._bindings.pop(widget_id, None)
        return self

    # ─── 输出 ───

    def to_dict(self) -> dict:
        """将构建结果导出为完整的布局字典"""
        result = {
            '$schema': '1.0',
            'metadata': {
                'name': self._metadata.get('name', 'Untitled Layout'),
                'description': self._metadata.get('description', ''),
                'version': self._metadata.get('version', '1.0.0'),
                'author': self._metadata.get('author', 'DemoStudio'),
            },
            'variables': dict(self._variables),
            'ui': self._root,
        }
        if self._bindings:
            result['bindings'] = dict(self._bindings)
        return result

    def to_json(self, indent: int = 2) -> str:
        """导出为格式化的 JSON 字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def save(self, path: str | Path) -> Path:
        """保存到 JSON 文件"""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info('布局已保存: {} ({} 个节点, {} 个绑定)',
                     path, self._count_nodes(), len(self._bindings))
        return path

    def _count_nodes(self) -> int:
        """统计节点数"""
        def _count(node: dict) -> int:
            n = 1
            for child in node.get('children', []):
                n += _count(child)
            return n
        return _count(self._root)

    def print_tree(self):
        """打印节点树到控制台"""
        def _print(node: dict, indent: int = 0):
            prefix = '  ' * indent
            wid = node.get('id', '')
            wtype = node.get('type', '?')
            extra = ''
            if 'text' in node:
                extra = f' text="{node["text"]}"'
            elif 'title' in node:
                extra = f' title="{node["title"]}"'
            print(f'{prefix}├─ {wtype} "{wid}"{extra}')
            for child in node.get('children', []):
                _print(child, indent + 1)
        print('📋 构建树:')
        _print(self._root)

    def __repr__(self):
        return f'<LayoutBuilder root="{self._root.get("id", "?")}" ({len(self._stack)} depth)>'


# ──────────────────────────────────────────────
# 工具函数: 从 dict 构建
# ──────────────────────────────────────────────

def build_from_dict(data: dict) -> LayoutBuilder:
    """从已有 dict 节点创建一个 LayoutBuilder (用于编辑)"""
    if 'ui' in data:
        root = data['ui']
    else:
        root = data

    wid = root.get('id', 'root')
    wtype = root.get('type', 'UIWidget')
    builder = LayoutBuilder(wid, wtype)
    builder._root = root

    # 恢复元数据
    if 'metadata' in data:
        builder._metadata = dict(data['metadata'])
    # 恢复变量
    if 'variables' in data:
        builder._variables = dict(data['variables'])
    # 恢复绑定
    if 'bindings' in data:
        builder._bindings = dict(data['bindings'])

    return builder


# ──────────────────────────────────────────────
# 便捷工厂方法
# ──────────────────────────────────────────────

def _register_factories():
    """在 LayoutBuilder 上注册静态工厂方法"""

    @staticmethod
    def create_button(id: str, text: str, **kwargs) -> dict:
        """快速创建按钮节点"""
        node = LayoutBuilder._make_node(id, 'UIButton', text=text, **kwargs)
        return node

    @staticmethod
    def create_window(id: str, title: str, **kwargs) -> dict:
        """快速创建窗口节点"""
        node = LayoutBuilder._make_node(id, 'UIWindow', title=title, **kwargs)
        return node

    @staticmethod
    def create_panel(id: str, title: str, **kwargs) -> dict:
        """快速创建面板节点"""
        node = LayoutBuilder._make_node(id, 'UIPanel', title=title, **kwargs)
        return node

    @staticmethod
    def create_label(id: str, text: str, **kwargs) -> dict:
        """快速创建标签节点"""
        node = LayoutBuilder._make_node(id, 'UIText', text=text, **kwargs)
        return node

    @staticmethod
    def create_input(id: str, placeholder: str = '', **kwargs) -> dict:
        """快速创建输入框节点"""
        node = LayoutBuilder._make_node(id, 'UIInputField',
                                         placeholder=placeholder, **kwargs)
        return node

    @staticmethod
    def create_slider(id: str, **kwargs) -> dict:
        """快速创建滑块节点"""
        node = LayoutBuilder._make_node(id, 'UISlider', **kwargs)
        return node

    @staticmethod
    def create_toggle(id: str, text: str, **kwargs) -> dict:
        """快速创建开关节点"""
        node = LayoutBuilder._make_node(id, 'UIToggle', text=text, **kwargs)
        return node

    @staticmethod
    def create_checkbox(id: str, text: str, **kwargs) -> dict:
        """快速创建复选框节点"""
        node = LayoutBuilder._make_node(id, 'UICheckbox', text=text, **kwargs)
        return node

    @staticmethod
    def create_dropdown(id: str, items: list, **kwargs) -> dict:
        """快速创建下拉菜单节点"""
        node = LayoutBuilder._make_node(id, 'UIDropdown', items=items, **kwargs)
        return node

    @staticmethod
    def create_separator(id: str, **kwargs) -> dict:
        """快速创建分割线节点"""
        node = LayoutBuilder._make_node(id, 'UISeparator', **kwargs)
        return node

    @staticmethod
    def create_vlayout(id: str, **kwargs) -> dict:
        """快速创建垂直布局节点"""
        node = LayoutBuilder._make_node(id, 'UIVerticalLayout', **kwargs)
        return node

    @staticmethod
    def create_hlayout(id: str, **kwargs) -> dict:
        """快速创建水平布局节点"""
        node = LayoutBuilder._make_node(id, 'UIHorizontalLayout', **kwargs)
        return node

    @staticmethod
    def create_grid(id: str, cols: int = 3, **kwargs) -> dict:
        """快速创建网格布局节点"""
        node = LayoutBuilder._make_node(id, 'UIGridLayout', cols=cols, **kwargs)
        return node

    LayoutBuilder.create_button = create_button
    LayoutBuilder.create_window = create_window
    LayoutBuilder.create_panel = create_panel
    LayoutBuilder.create_label = create_label
    LayoutBuilder.create_input = create_input
    LayoutBuilder.create_slider = create_slider
    LayoutBuilder.create_toggle = create_toggle
    LayoutBuilder.create_checkbox = create_checkbox
    LayoutBuilder.create_dropdown = create_dropdown
    LayoutBuilder.create_separator = create_separator
    LayoutBuilder.create_vlayout = create_vlayout
    LayoutBuilder.create_hlayout = create_hlayout
    LayoutBuilder.create_grid = create_grid


_register_factories()
