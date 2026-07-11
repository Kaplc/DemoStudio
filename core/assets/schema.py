"""
schema — JSON 布局 Schema 定义与校验
=====================================
定义 UI 布局 JSON 的结构规范，提供校验工具确保 JSON 格式正确。
"""

import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Optional

from core.logger import get_logger

logger = get_logger('assets.schema')


# ──────────────────────────────────────────────
# 校验结果
# ──────────────────────────────────────────────

@dataclass
class ValidationResult:
    """JSON 布局校验结果"""
    valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_error(self, msg: str):
        self.valid = False
        self.errors.append(msg)

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def __bool__(self):
        return self.valid

    def __str__(self):
        if self.valid and not self.warnings:
            return '校验通过 ✅'
        parts = []
        if self.errors:
            parts.append(f'❌ 错误 ({len(self.errors)}):\n  ' + '\n  '.join(self.errors))
        if self.warnings:
            parts.append(f'⚠️  警告 ({len(self.warnings)}):\n  ' + '\n  '.join(self.warnings))
        return '\n'.join(parts)


# ──────────────────────────────────────────────
# 已知 UI 控件类型
# ──────────────────────────────────────────────

KNOWN_WIDGET_TYPES = {
    # 基础控件
    'UIWidget', 'UIImage', 'UIText', 'UIButton', 'UIToggle',
    'UICheckbox', 'UISlider', 'UIProgressBar', 'UIInputField',
    'UIDropdown', 'UISeparator',
    # 容器
    'UIPanel', 'UIScrollView', 'UIGroupBox', 'UIWindow', 'UIDialog',
    # 布局
    'UIHorizontalLayout', 'UIVerticalLayout', 'UIGridLayout',
}

# 需要特定导入的控件映射 (type → 导入路径)
WIDGET_IMPORT_MAP = {
    'UIWidget': 'core.ui.widget',
    'UIImage': 'core.ui.image',
    'UIText': 'core.ui.label',
    'UIButton': 'core.ui.button',
    'UIToggle': 'core.ui.toggle',
    'UICheckbox': 'core.ui.checkbox',
    'UISlider': 'core.ui.slider',
    'UIProgressBar': 'core.ui.progressbar',
    'UIInputField': 'core.ui.inputfield',
    'UIDropdown': 'core.ui.dropdown',
    'UISeparator': 'core.ui.separator',
    'UIPanel': 'core.ui.panel',
    'UIScrollView': 'core.ui.scrollview',
    'UIGroupBox': 'core.ui.groupbox',
    'UIWindow': 'core.ui.window',
    'UIDialog': 'core.ui.dialog',
    'UIHorizontalLayout': 'core.ui.layouts',
    'UIVerticalLayout': 'core.ui.layouts',
    'UIGridLayout': 'core.ui.layouts',
}


# ──────────────────────────────────────────────
# 支持的属性清单
# ──────────────────────────────────────────────

# 所有控件通用属性
COMMON_PROPS = {
    'id', 'type', 'children',
    'anchor', 'offset', 'size', 'pivot',
    'position', 'color', 'alpha', 'enabled', 'visible',
    'parent_ref',  # 引用另一个控件的 id 作为父级
}

# 各控件的特有属性
WIDGET_PROPS = {
    'UIText': {'text', 'font_size'},
    'UIButton': {'text', 'font_size', 'highlight_color', 'pressed_color', 'text_color'},
    'UIToggle': {'text', 'default_value'},
    'UICheckbox': {'text', 'default_value'},
    'UISlider': {'min_value', 'max_value', 'default_value', 'step', 'show_label'},
    'UIProgressBar': {'value', 'max_value', 'show_label', 'label_format', 'fill_color', 'background_color'},
    'UIInputField': {'placeholder', 'default_text', 'max_length', 'password_mode'},
    'UIDropdown': {'items', 'default_index'},
    'UISeparator': {'direction'},
    'UIPanel': {'title', 'show_title'},
    'UIGroupBox': {'title'},
    'UIWindow': {'title', 'closable', 'draggable'},
    'UIDialog': {'message', 'confirm_text', 'cancel_text'},
    'UIScrollView': {'scroll_speed'},
    'UIHorizontalLayout': {'spacing', 'padding'},
    'UIVerticalLayout': {'spacing', 'padding'},
    'UIGridLayout': {'cols', 'spacing', 'padding'},
    'UIImage': {'texture', 'image_color'},
}

# Layout 布局参数 (对齐方式)
LAYOUT_PROPS = {'spacing', 'padding', 'cols'}


# ──────────────────────────────────────────────
# Schema 定义 (文档性结构说明)
# ──────────────────────────────────────────────

LAYOUT_SCHEMA = {
    "$schema": "1.0",
    "type": "object",
    "properties": {
        "$schema": {"type": "string", "description": "Schema 版本"},
        "metadata": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "version": {"type": "string"},
                "author": {"type": "string"},
            },
        },
        "variables": {
            "type": "object",
            "description": "布局变量定义, 可在 children 中以 $var_name 引用",
            "additionalProperties": {"type": ["string", "number", "array"]},
        },
        "imports": {
            "type": "array",
            "description": "自定义控件导入声明",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "symbols": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "ui": {
            "type": "object",
            "description": "UI 控件树根节点",
            "$ref": "#/definitions/widget",
        },
        "bindings": {
            "type": "object",
            "description": "事件绑定映射: widget_id → {event: handler}",
            "additionalProperties": {
                "type": "object",
                "additionalProperties": {"type": "string"},
            },
        },
    },
    "required": ["ui"],
    "definitions": {
        "widget": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "description": "控件类名"},
                "id": {"type": "string", "description": "控件唯一标识"},
                "anchor": {"type": ["string", "array"], "description": "锚点"},
                "offset": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "size": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "pivot": {"type": ["string", "array"]},
                "position": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "color": {"type": ["string", "array"]},
                "alpha": {"type": "number"},
                "enabled": {"type": "boolean"},
                "visible": {"type": "boolean"},
                "parent_ref": {"type": "string"},
                "children": {
                    "type": "array",
                    "items": {"$ref": "#/definitions/widget"},
                },
            },
            "required": ["type"],
        },
    },
}


# ──────────────────────────────────────────────
# 校验函数
# ──────────────────────────────────────────────

def validate_layout(data: dict) -> ValidationResult:
    """校验 JSON 布局数据的结构合法性

    Parameters
    ----------
    data : dict
        解析后的 JSON 数据

    Returns
    -------
    ValidationResult
        包含 errors 和 warnings 的校验结果
    """
    result = ValidationResult()

    if not isinstance(data, dict):
        result.add_error('顶层数据必须是 JSON 对象 (dict)')
        return result

    # 检查必须有 ui 字段
    if 'ui' not in data:
        result.add_error('缺少必要字段 "ui"')
        return result

    # 校验 schema 版本
    schema_ver = data.get('$schema', '1.0')
    if schema_ver != '1.0':
        result.add_warning(f'未知的 Schema 版本 "{schema_ver}", 可能不兼容')

    # 校验 metadata (可选)
    meta = data.get('metadata', {})
    if isinstance(meta, dict) and 'name' in meta and not meta['name']:
        result.add_warning('metadata.name 为空')

    # 递归校验控件树
    _validate_widget(data['ui'], result, path='ui')

    # 校验 bindings
    bindings = data.get('bindings', {})
    if isinstance(bindings, dict):
        for widget_id, events in bindings.items():
            if not isinstance(events, dict):
                result.add_error(f'bindings["{widget_id}"] 必须是对象')
                continue
            for event_name, handler in events.items():
                if not isinstance(handler, str):
                    result.add_error(
                        f'bindings["{widget_id}"].{event_name} 必须是字符串'
                    )

    # 校验 imports
    imports = data.get('imports', [])
    if isinstance(imports, list):
        for i, imp in enumerate(imports):
            if not isinstance(imp, dict):
                result.add_error(f'imports[{i}] 必须是对象')
                continue
            if 'from' not in imp:
                result.add_error(f'imports[{i}] 缺少 "from" 字段')
            if 'symbols' in imp and not isinstance(imp['symbols'], list):
                result.add_error(f'imports[{i}].symbols 必须是数组')

    return result


def _validate_widget(node: Any, result: ValidationResult, path: str):
    """递归校验控件节点"""
    if not isinstance(node, dict):
        result.add_error(f'{path}: 控件节点必须是对象')
        return

    wtype = node.get('type', '')
    if not wtype:
        result.add_error(f'{path}: 缺少 "type" 字段')
        return

    wid = node.get('id', '')

    # 检查控件类型是否已知
    if wtype not in KNOWN_WIDGET_TYPES:
        result.add_warning(f'{path}: 未知控件类型 "{wtype}"'
                           f'{" (id=" + wid + ")" if wid else ""}')

    # 检查未知属性
    known_props = COMMON_PROPS | WIDGET_PROPS.get(wtype, set())
    for key in node:
        if key not in known_props and not key.startswith('_'):
            result.add_warning(f'{path}: 未知属性 "{key}"'
                               f'{" (id=" + wid + ")" if wid else ""}')

    # 递归校验子节点
    children = node.get('children', [])
    if isinstance(children, list):
        for i, child in enumerate(children):
            _validate_widget(child, result, f'{path}.children[{i}]')
    elif children:
        result.add_error(f'{path}.children 必须是数组')
