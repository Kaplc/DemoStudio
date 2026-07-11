"""
layout_patcher — 对已有 JSON 布局进行增/删/改操作
===================================================
无需手写 JSON，通过 Python API 修改现有布局文件。

用法:
    patcher = LayoutPatcher('assets/layouts/main_menu.json')

    # 修改属性
    patcher.set_prop('start_btn', 'text', '▶ Launch')
    patcher.set_prop('launch_btn', 'color', '#4a9f6a')
    patcher.set_prop('title_text', 'font_size', 1.6)

    # 批量修改
    patcher.set_props('start_btn', {
        'text': '▶ Launch',
        'color': '#4a9f6a',
        'highlight_color': '#5abf7a',
    })

    # 添加/删除子控件
    patcher.add_widget('new_btn', 'UIButton', text='New',
                        parent_id='btn_layout', index=1)
    patcher.remove_widget('old_widget')

    # 绑定事件
    patcher.add_binding('start_btn', 'on_click', 'launch_game')
    patcher.remove_binding('cancel_btn')

    # 变量管理
    patcher.set_variable('btn_color', '#ff0000')
    patcher.remove_variable('old_var')

    # 保存 (直接覆盖或另存为)
    patcher.save()
    patcher.save_as('assets/layouts/backup.json')
"""

import json
import copy
from pathlib import Path
from typing import Any, Optional

from core.logger import get_logger

logger = get_logger('assets.tools.patcher')


# ──────────────────────────────────────────────
# LayoutPatcher
# ──────────────────────────────────────────────

class LayoutPatcher:
    """JSON 布局修改器

    加载一个现有布局文件，提供增/删/改 API，然后保存。
    """

    def __init__(self, path: str | Path = None, data: dict = None):
        """
        Parameters
        ----------
        path : str | Path, optional
            布局 JSON 文件路径
        data : dict, optional
            直接传入布局字典 (与 path 二选一)
        """
        self._source_path: Optional[Path] = None
        self._data: dict = {}

        if path is not None:
            self._source_path = Path(path)
            self._load()
        elif data is not None:
            self._data = copy.deepcopy(data)
        else:
            self._data = {
                '$schema': '1.0',
                'metadata': {'name': 'Untitled', 'version': '1.0.0'},
                'variables': {},
                'ui': {'type': 'UIWidget', 'id': 'root'},
                'bindings': {},
            }

        # 确保必要字段存在
        self._data.setdefault('$schema', '1.0')
        self._data.setdefault('metadata', {'name': 'Untitled'})
        self._data.setdefault('variables', {})
        self._data.setdefault('ui', {'type': 'UIWidget', 'id': 'root'})
        self._data.setdefault('bindings', {})

    # ─── 加载 ───

    def _load(self):
        """从文件加载布局"""
        if not self._source_path or not self._source_path.exists():
            raise FileNotFoundError(f'布局文件不存在: {self._source_path}')
        try:
            with open(self._source_path, 'r', encoding='utf-8') as f:
                self._data = json.load(f)
            logger.info('已加载布局: {}', self._source_path)
        except (json.JSONDecodeError, OSError) as e:
            raise RuntimeError(f'加载布局失败 ({self._source_path}): {e}')

    def reload(self):
        """重新从文件加载"""
        self._load()

    # ─── 节点查找 ───

    def find_widget(self, widget_id: str) -> Optional[dict]:
        """按 id 查找控件节点 (深度优先)"""
        return self._find_recursive(self._data.get('ui', {}), widget_id)

    def _find_recursive(self, node: dict, widget_id: str) -> Optional[dict]:
        if not isinstance(node, dict):
            return None
        if node.get('id') == widget_id:
            return node
        for child in node.get('children', []):
            result = self._find_recursive(child, widget_id)
            if result is not None:
                return result
        return None

    def find_widgets_by_type(self, widget_type: str) -> list[dict]:
        """按类型查找所有控件节点"""
        result = []
        self._find_by_type_recursive(self._data.get('ui', {}), widget_type, result)
        return result

    def _find_by_type_recursive(self, node: dict, wtype: str, result: list):
        if not isinstance(node, dict):
            return
        if node.get('type') == wtype:
            result.append(node)
        for child in node.get('children', []):
            self._find_by_type_recursive(child, wtype, result)

    def widget_exists(self, widget_id: str) -> bool:
        """检查控件是否存在"""
        return self.find_widget(widget_id) is not None

    # ─── 属性修改 ───

    def set_prop(self, widget_id: str, key: str, value: Any) -> 'LayoutPatcher':
        """设置控件的单个属性"""
        node = self.find_widget(widget_id)
        if node is None:
            raise KeyError(f'找不到控件 "{widget_id}"')
        node[key] = value
        logger.debug('设置 {}.{} = {}', widget_id, key, value)
        return self

    def set_props(self, widget_id: str, props: dict) -> 'LayoutPatcher':
        """批量设置控件属性"""
        node = self.find_widget(widget_id)
        if node is None:
            raise KeyError(f'找不到控件 "{widget_id}"')
        node.update(props)
        logger.debug('批量设置 {}: {} 个属性', widget_id, len(props))
        return self

    def remove_prop(self, widget_id: str, key: str) -> 'LayoutPatcher':
        """移除控件的某个属性"""
        node = self.find_widget(widget_id)
        if node is None:
            raise KeyError(f'找不到控件 "{widget_id}"')
        node.pop(key, None)
        return self

    def rename_widget_id(self, old_id: str, new_id: str) -> 'LayoutPatcher':
        """重命名控件 ID (同时更新 bindings 中的引用)"""
        node = self.find_widget(old_id)
        if node is None:
            raise KeyError(f'找不到控件 "{old_id}"')
        node['id'] = new_id

        # 更新 bindings
        bindings = self._data.get('bindings', {})
        if old_id in bindings:
            bindings[new_id] = bindings.pop(old_id)

        logger.info('重命名控件: {} → {}', old_id, new_id)
        return self

    # ─── 添加/删除子控件 ───

    def add_widget(self, widget_id: str, widget_type: str = 'UIWidget',
                   parent_id: str = None, index: int = -1,
                   **props) -> 'LayoutPatcher':
        """添加子控件

        Parameters
        ----------
        widget_id : str
            新控件 ID
        widget_type : str
            控件类型
        parent_id : str, optional
            父控件 ID, None 表示添加到根节点
        index : int
            插入位置, -1 表示末尾
        **props :
            其他属性 (text, color, size, anchor 等)
        """
        node = {
            'type': widget_type,
            'id': widget_id,
            **props,
        }

        if parent_id:
            parent = self.find_widget(parent_id)
            if parent is None:
                raise KeyError(f'找不到父控件 "{parent_id}"')
            children = parent.setdefault('children', [])
        else:
            children = self._data['ui'].setdefault('children', [])

        if 0 <= index < len(children):
            children.insert(index, node)
        else:
            children.append(node)

        logger.info('添加控件: {} ({}) 到 {}', widget_id, widget_type, parent_id or 'root')
        return self

    def add_widget_node(self, node: dict, parent_id: str = None,
                        index: int = -1) -> 'LayoutPatcher':
        """直接添加一个已构造好的节点 dict

        Parameters
        ----------
        node : dict
            控件节点字典 (可以由 LayoutBuilder.create_button() 等生成)
        parent_id : str, optional
            父控件 ID
        index : int
            插入位置
        """
        node = copy.deepcopy(node)
        if parent_id:
            parent = self.find_widget(parent_id)
            if parent is None:
                raise KeyError(f'找不到父控件 "{parent_id}"')
            children = parent.setdefault('children', [])
        else:
            children = self._data['ui'].setdefault('children', [])

        if 0 <= index < len(children):
            children.insert(index, node)
        else:
            children.append(node)

        wid = node.get('id', '?')
        wtype = node.get('type', '?')
        logger.info('添加节点: {} ({}) 到 {}', wid, wtype, parent_id or 'root')
        return self

    def remove_widget(self, widget_id: str) -> 'LayoutPatcher':
        """移除控件及所有子控件"""
        removed = self._remove_recursive(self._data.get('ui', {}), widget_id)
        if not removed:
            raise KeyError(f'找不到控件 "{widget_id}"')

        # 清理 bindings
        self._data.setdefault('bindings', {}).pop(widget_id, None)

        logger.info('移除控件: {}', widget_id)
        return self

    def _remove_recursive(self, node: dict, widget_id: str) -> bool:
        children = node.get('children', [])
        for i, child in enumerate(children):
            if child.get('id') == widget_id:
                children.pop(i)
                return True
            if self._remove_recursive(child, widget_id):
                return True
        return False

    def clear_children(self, parent_id: str) -> 'LayoutPatcher':
        """清空某控件的所有子控件"""
        parent = self.find_widget(parent_id)
        if parent is None:
            raise KeyError(f'找不到控件 "{parent_id}"')
        parent['children'] = []
        logger.info('清空 {} 的子控件', parent_id)
        return self

    def move_widget(self, widget_id: str, new_parent_id: str,
                    index: int = -1) -> 'LayoutPatcher':
        """将控件移动到新的父级下"""
        # 1. 找到节点并记住它
        node = self.find_widget(widget_id)
        if node is None:
            raise KeyError(f'找不到控件 "{widget_id}"')

        node_copy = copy.deepcopy(node)

        # 2. 从原位置移除
        self.remove_widget(widget_id)

        # 3. 添加到新父级
        self.add_widget_node(node_copy, parent_id=new_parent_id, index=index)

        logger.info('移动控件 {} → {}', widget_id, new_parent_id)
        return self

    def duplicate_widget(self, widget_id: str, new_id: str = None,
                         parent_id: str = None) -> 'LayoutPatcher':
        """复制控件"""
        node = self.find_widget(widget_id)
        if node is None:
            raise KeyError(f'找不到控件 "{widget_id}"')

        new_node = copy.deepcopy(node)
        new_node['id'] = new_id or f'{widget_id}_copy'

        return self.add_widget_node(new_node, parent_id=parent_id)

    # ─── 变量管理 ───

    def set_variable(self, name: str, value: Any) -> 'LayoutPatcher':
        """设置布局变量"""
        self._data.setdefault('variables', {})[name] = value
        return self

    def remove_variable(self, name: str) -> 'LayoutPatcher':
        """移除布局变量"""
        self._data.setdefault('variables', {}).pop(name, None)
        return self

    def get_variable(self, name: str, default: Any = None) -> Any:
        """获取布局变量"""
        return self._data.get('variables', {}).get(name, default)

    def list_variables(self) -> dict:
        """列出所有变量"""
        return dict(self._data.get('variables', {}))

    # ─── 事件绑定管理 ───

    def add_binding(self, widget_id: str, event: str,
                    handler: str) -> 'LayoutPatcher':
        """添加事件绑定"""
        self._data.setdefault('bindings', {})
        self._data['bindings'].setdefault(widget_id, {})[event] = handler
        return self

    def remove_binding(self, widget_id: str, event: str = None) -> 'LayoutPatcher':
        """移除事件绑定"""
        bindings = self._data.setdefault('bindings', {})
        if event is None:
            bindings.pop(widget_id, None)
        else:
            events = bindings.get(widget_id, {})
            events.pop(event, None)
            if not events:
                bindings.pop(widget_id, None)
        return self

    def list_bindings(self) -> dict:
        """列出所有绑定"""
        return dict(self._data.get('bindings', {}))

    # ─── 元数据 ───

    def set_metadata(self, key: str, value: Any) -> 'LayoutPatcher':
        """设置元数据"""
        self._data.setdefault('metadata', {})[key] = value
        return self

    def get_metadata(self, key: str, default: Any = None) -> Any:
        """获取元数据"""
        return self._data.get('metadata', {}).get(key, default)

    # ─── 查询 ───

    def list_widget_ids(self) -> list[str]:
        """列出所有控件 ID"""
        ids = []
        self._collect_ids(self._data.get('ui', {}), ids)
        return ids

    def _collect_ids(self, node: dict, ids: list):
        if not isinstance(node, dict):
            return
        wid = node.get('id')
        if wid:
            ids.append(wid)
        for child in node.get('children', []):
            self._collect_ids(child, ids)

    def count_widgets(self) -> int:
        """统计控件总数"""
        return len(self.list_widget_ids())

    def get_widget_type(self, widget_id: str) -> Optional[str]:
        """获取控件类型"""
        node = self.find_widget(widget_id)
        return node.get('type') if node else None

    def get_widget_prop(self, widget_id: str, key: str,
                        default: Any = None) -> Any:
        """获取控件属性"""
        node = self.find_widget(widget_id)
        return node.get(key, default) if node else default

    # ─── 保存 ───

    def save(self) -> Path:
        """保存到原文件"""
        if self._source_path is None:
            raise RuntimeError('未指定保存路径, 请使用 save_as(path)')
        self._write(self._source_path)
        return self._source_path

    def save_as(self, path: str | Path) -> Path:
        """另存为新文件"""
        path = Path(path)
        self._write(path)
        self._source_path = path
        return path

    def _write(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        logger.info('布局已保存: {} ({} 个控件, {} 个绑定)',
                     path, self.count_widgets(),
                     len(self._data.get('bindings', {})))

    # ─── 预览 ───

    def print_hierarchy(self):
        """打印控件层级树"""
        def _print(node: dict, indent: int = 0):
            prefix = '  ' * indent
            wid = node.get('id', '?')
            wtype = node.get('type', '?')
            extra = ''
            if 'text' in node:
                extra = f' text="{node["text"]}"'
            elif 'title' in node:
                extra = f' title="{node["title"]}"'
            print(f'{prefix}├─ {wtype} "{wid}"{extra}')
            for child in node.get('children', []):
                _print(child, indent + 1)

    # ─── 链式属性修改 (直接按控件 id) ───

    def set_anchor(self, widget_id: str, anchor: str | tuple) -> 'LayoutPatcher':
        """设置锚点"""
        return self.set_prop(widget_id, 'anchor', list(anchor) if isinstance(anchor, tuple) else anchor)

    def set_offset(self, widget_id: str, x: float, y: float) -> 'LayoutPatcher':
        """设置偏移量"""
        return self.set_prop(widget_id, 'offset', [x, y])

    def set_size(self, widget_id: str, w: float, h: float) -> 'LayoutPatcher':
        """设置尺寸"""
        return self.set_prop(widget_id, 'size', [w, h])

    def set_position(self, widget_id: str, x: float, y: float) -> 'LayoutPatcher':
        """设置位置 (覆盖锚点)"""
        return self.set_prop(widget_id, 'position', [x, y])

    def set_pivot(self, widget_id: str, pivot: str | tuple) -> 'LayoutPatcher':
        """设置轴心"""
        return self.set_prop(widget_id, 'pivot', list(pivot) if isinstance(pivot, tuple) else pivot)

    def set_color(self, widget_id: str, color: str) -> 'LayoutPatcher':
        """设置颜色 (#hex)"""
        return self.set_prop(widget_id, 'color', color)

    def set_alpha(self, widget_id: str, alpha: float) -> 'LayoutPatcher':
        """设置透明度"""
        return self.set_prop(widget_id, 'alpha', alpha)

    def set_z(self, widget_id: str, z: float) -> 'LayoutPatcher':
        """设置渲染层级"""
        return self.set_prop(widget_id, 'z', z)

    def set_stretch(self, widget_id: str, stretch: bool | dict) -> 'LayoutPatcher':
        """设置填充拉伸: True=全填充, dict={left,right,top,bottom}"""
        return self.set_prop(widget_id, 'stretch', stretch)

    def set_text(self, widget_id: str, text: str) -> 'LayoutPatcher':
        """设置文字"""
        return self.set_prop(widget_id, 'text', text)

    def set_font_size(self, widget_id: str, size: float) -> 'LayoutPatcher':
        """设置字号"""
        return self.set_prop(widget_id, 'font_size', size)

    def set_title(self, widget_id: str, title: str) -> 'LayoutPatcher':
        """设置标题"""
        return self.set_prop(widget_id, 'title', title)

    def set_highlight_color(self, widget_id: str, color: str) -> 'LayoutPatcher':
        """设置悬停高亮色"""
        return self.set_prop(widget_id, 'highlight_color', color)

    def set_pressed_color(self, widget_id: str, color: str) -> 'LayoutPatcher':
        """设置按下颜色"""
        return self.set_prop(widget_id, 'pressed_color', color)

    def set_text_color(self, widget_id: str, color: str) -> 'LayoutPatcher':
        """设置文字颜色"""
        return self.set_prop(widget_id, 'text_color', color)

    # ─── 添加子控件 (链式) ───

    def add_child(self, parent_id: str, widget_id: str, widget_type: str = 'UIWidget',
                  **props) -> 'LayoutPatcher':
        """给指定父控件添加子控件"""
        return self.add_widget(widget_id, widget_type, parent_id=parent_id, **props)

        print(f'📋 布局: {self._data.get("metadata", {}).get("name", "?")}')
        print(f'   文件: {self._source_path or "(内存)"}')
        print(f'   控件: {self.count_widgets()} | 绑定: {len(self._data.get("bindings", {}))}')
        _print(self._data.get('ui', {}))

    def to_dict(self) -> dict:
        """导出为字典"""
        return copy.deepcopy(self._data)

    def to_json(self, indent: int = 2) -> str:
        """导出为 JSON 字符串"""
        return json.dumps(self._data, ensure_ascii=False, indent=indent)

    def __repr__(self):
        name = self._data.get('metadata', {}).get('name', '?')
        return (f'<LayoutPatcher "{name}" '
                f'{self.count_widgets()} widgets, '
                f'src={self._source_path}>')
