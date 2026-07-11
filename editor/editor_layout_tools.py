"""
editor_layout_tools.py — 编辑器 UI 资产工具集成
=================================================
为 DemoStudio 编辑器提供 UI 资产编辑能力。
在编辑器启动时注册这些工具，可通过控制台或 MCP 调用。

用法:
    # 在编辑器初始化时
    from editor.editor_layout_tools import register_layout_tools
    register_layout_tools(console)

    # 然后可以在控制台输入:
    # > layout list                    # 列出所有布局
    # > layout dump editor_ui          # 预览编辑器布局
    # > layout patch editor_ui title_text.text="DemoStudio"  # 修改属性
    # > layout add editor_ui new_btn:UIButton text=Click parent=editor_root
"""

from pathlib import Path
from typing import Any

from core.logger import get_logger
from core.assets.tools.layout_patcher import LayoutPatcher
from core.assets.tools.layout_builder import LayoutBuilder, build_from_dict
from core.assets.tools.ui_cli import dump_layout, list_widgets, print_hierarchy

logger = get_logger('editor.layout_tools')


# ─── 布局目录 ───

LAYOUT_DIRS = [
    Path(__file__).resolve().parent / 'assets',
    Path(__file__).resolve().parent.parent / 'assets' / 'layouts',
]


# ──────────────────────────────────────────────
# 注册到编辑器控制台
# ──────────────────────────────────────────────

def register_layout_tools(console):
    """将布局工具注册到编辑器控制台

    Parameters
    ----------
    console : Console
        编辑器的 Console 实例
    """
    console.register('layout', _cmd_layout, 'UI 资产工具: list / dump / patch / add / remove / vars')
    console.register('layout_list', _cmd_list, '列出所有可用布局文件')
    console.register('layout_dump', _cmd_dump, '打印布局概览: layout_dump <filename>')
    console.register('layout_patch', _cmd_patch, '修改布局属性: layout_patch <file> <widget.field=value>')
    console.register('layout_add', _cmd_add_widget, '添加控件: layout_add <file> <id:type> [key=val]')

    logger.info('布局工具已注册到控制台')


# ──────────────────────────────────────────────
# 命令处理器
# ──────────────────────────────────────────────

def _find_layout(name: str) -> Path | None:
    """按名称查找布局文件"""
    name = name.lower()
    for d in LAYOUT_DIRS:
        if not d.exists():
            continue
        for f in d.glob('*.json'):
            if f.stem.lower() == name:
                return f
    return None


def _cmd_list(*args) -> str:
    """列出所有布局文件"""
    lines = ['📋 可用布局:']
    for d in LAYOUT_DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob('*.json')):
            lines.append(f'  • {f.stem:30s} ({f.relative_to(d.parent)})')
    return '\n'.join(lines) if len(lines) > 1 else '没有找到布局文件'


def _cmd_dump(*args) -> str:
    """打印布局概览"""
    if not args:
        return '用法: layout_dump <filename>\n  例如: layout_dump editor_ui'

    fpath = _find_layout(args[0])
    if not fpath:
        return f'❌ 找不到布局 "{args[0]}"'

    # 收集输出
    import io, json
    buf = io.StringIO()
    try:
        with open(fpath) as f:
            data = json.load(f)
    except Exception as e:
        return f'❌ 读取失败: {e}'

    meta = data.get('metadata', {})
    buf.write(f'📄 {meta.get("name", "?")}\n')
    buf.write(f'  文件: {fpath.name}\n')

    widgets = data.get('ui', {})
    count = _count_nodes(widgets)
    buf.write(f'  控件: {count}\n')

    bindings = data.get('bindings', {})
    buf.write(f'  绑定: {len(bindings)}\n')

    variables = data.get('variables', {})
    if variables:
        buf.write(f'  变量: {len(variables)} → {list(variables.keys())}\n')

    return buf.getvalue()


def _count_nodes(node: dict) -> int:
    if not isinstance(node, dict):
        return 0
    n = 1
    for child in node.get('children', []):
        n += _count_nodes(child)
    return n


def _cmd_patch(*args) -> str:
    """修改布局属性"""
    if len(args) < 2:
        return '用法: layout_patch <filename> <widget.field=value> [...]\n  例如: layout_patch editor_ui launch_btn.text="[>] Start"'

    fpath = _find_layout(args[0])
    if not fpath:
        return f'❌ 找不到布局 "{args[0]}"'

    patcher = LayoutPatcher(str(fpath))
    changes = []

    for arg in args[1:]:
        if '=' not in arg:
            continue
        # widget_id.field = value
        left, value = arg.split('=', 1)
        if '.' in left:
            widget_id, field = left.rsplit('.', 1)
        else:
            widget_id = left
            field = 'text'

        # 类型推断
        value = _infer_value(value)

        try:
            patcher.set_prop(widget_id, field, value)
            changes.append(f'{widget_id}.{field}={value}')
        except KeyError as e:
            return f'❌ {e}'

    if changes:
        patcher.save()
        return f'✅ 已修改 {len(changes)} 个属性: {", ".join(changes)}'
    return '没有变更'


def _cmd_add_widget(*args) -> str:
    """添加控件"""
    if len(args) < 2:
        return '用法: layout_add <filename> <id:type> [key=val...] [parent=<id>]\n  例如: layout_add editor_ui new_btn:UIButton text=Click parent=editor_root'

    fpath = _find_layout(args[0])
    if not fpath:
        return f'❌ 找不到布局 "{args[0]}"'

    # 解析 id:type
    spec = args[1]
    if ':' in spec:
        wid, wtype = spec.split(':', 1)
    else:
        wid, wtype = spec, 'UIButton'

    # 解析额外参数
    props = {}
    parent_id = None
    for arg in args[2:]:
        if '=' not in arg:
            continue
        k, v = arg.split('=', 1)
        if k == 'parent':
            parent_id = v
        else:
            props[k] = _infer_value(v)

    patcher = LayoutPatcher(str(fpath))
    try:
        patcher.add_widget(wid, wtype, parent_id=parent_id, **props)
        patcher.save()
        return f'✅ 已添加 {wtype} "{wid}" → {parent_id or "root"}'
    except KeyError as e:
        return f'❌ {e}'


def _infer_value(value: str) -> Any:
    """推断值的类型"""
    value = value.strip().strip('"\'')
    if value.lower() == 'true':
        return True
    if value.lower() == 'false':
        return False
    if value.lower() == 'none':
        return None
    try:
        if '.' in value:
            return float(value)
        return int(value)
    except ValueError:
        return value
