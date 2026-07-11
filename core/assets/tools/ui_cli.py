"""
ui_cli — 命令行工具 & 调试工具
===============================
提供一些便捷函数用于在终端/控制台中操作 UI 资产。

用法 (Python REPL):
    from core.assets.tools import dump_layout, list_widgets, batch_patch

    # 打印布局概览
    dump_layout('assets/layouts/main_menu.json')

    # 列出所有控件 ID
    ids = list_widgets('assets/layouts/main_menu.json')

    # 批量修改
    batch_patch('assets/layouts/*.json', {'launch_btn': {'text': '[>] Launch'}})
"""

import json
import copy
from pathlib import Path
from typing import Any

from core.logger import get_logger

logger = get_logger('assets.tools.cli')


# ──────────────────────────────────────────────
# 布局转储/预览
# ──────────────────────────────────────────────

def dump_layout(path: str | Path, show_children: bool = True):
    """将布局文件以可读格式打印到控制台

    Parameters
    ----------
    path : str | Path
        布局文件路径
    show_children : bool
        是否显示层级树
    """
    path = Path(path)
    if not path.exists():
        print(f'❌ 文件不存在: {path}')
        return

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f'❌ 读取失败: {e}')
        return

    meta = data.get('metadata', {})
    print(f'\n{"="*50}')
    print(f'📄 {meta.get("name", "?")}')
    print(f'{"="*50}')
    print(f'  描述: {meta.get("description", "-")}')
    print(f'  版本: {meta.get("version", "-")}')
    print(f'  作者: {meta.get("author", "-")}')
    print(f'  Schema: {data.get("$schema", "?")}')

    variables = data.get('variables', {})
    if variables:
        print(f'\n  📌 变量 ({len(variables)}):')
        for k, v in variables.items():
            print(f'    {k} = {v}')

    bindings = data.get('bindings', {})
    if bindings:
        print(f'\n  🔗 绑定 ({len(bindings)}):')
        for wid, events in bindings.items():
            for evt, handler in events.items():
                print(f'    {wid}.{evt} → {handler}')

    if show_children:
        print(f'\n  📋 层级:')
        _print_tree(data.get('ui', {}))
    print()


def _print_tree(node: dict, indent: int = 0):
    """打印节点树"""
    if not isinstance(node, dict):
        return
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
        _print_tree(child, indent + 1)


# ──────────────────────────────────────────────
# 列出控件
# ──────────────────────────────────────────────

def list_widgets(path: str | Path) -> list[str]:
    """列出布局中的所有控件 ID

    Parameters
    ----------
    path : str | Path
        布局文件路径

    Returns
    -------
    list[str]
        所有控件 ID 列表
    """
    path = Path(path)
    if not path.exists():
        print(f'❌ 文件不存在: {path}')
        return []

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f'❌ 读取失败: {e}')
        return []

    ids = []

    def _collect(node: dict):
        if not isinstance(node, dict):
            return
        wid = node.get('id')
        if wid:
            ids.append((wid, node.get('type', '?')))
        for child in node.get('children', []):
            _collect(child)

    _collect(data.get('ui', {}))

    print(f'\n📋 控件列表 ({len(ids)}):')
    for wid, wtype in ids:
        print(f'  {wtype:20s} "{wid}"')

    return [wid for wid, _ in ids]


# ──────────────────────────────────────────────
# 打印层级 (给 LayoutPatcher 用的独立函数)
# ──────────────────────────────────────────────

def print_hierarchy(path: str | Path):
    """打印布局的层级树

    Parameters
    ----------
    path : str | Path
        布局文件路径
    """
    from core.assets.tools.layout_patcher import LayoutPatcher
    patcher = LayoutPatcher(path)
    patcher.print_hierarchy()


# ──────────────────────────────────────────────
# 批量修改
# ──────────────────────────────────────────────

def batch_patch(pattern: str, changes: dict[str, dict[str, Any]],
                dry_run: bool = False) -> list[Path]:
    """批量修改多个布局文件

    Parameters
    ----------
    pattern : str
        文件匹配模式, 如 'assets/layouts/*.json'
    changes : dict[str, dict[str, Any]]
        修改内容: {widget_id: {prop: value, ...}}
    dry_run : bool
        仅预览不实际写入

    Returns
    -------
    list[Path]
        已修改的文件列表
    """
    from core.assets.tools.layout_patcher import LayoutPatcher

    files = sorted(Path().glob(pattern))
    if not files:
        print(f'⚠️  没有匹配的文件: {pattern}')
        return []

    modified = []
    for fpath in files:
        try:
            patcher = LayoutPatcher(str(fpath))
        except Exception as e:
            print(f'❌ {fpath.name}: {e}')
            continue

        touched = False
        for widget_id, props in changes.items():
            if patcher.widget_exists(widget_id):
                patcher.set_props(widget_id, props)
                touched = True
            else:
                print(f'  ⚠️  {fpath.name}: 找不到 "{widget_id}"')

        if touched:
            if dry_run:
                print(f'  📝 {fpath.name}: 将修改 {len(changes)} 个控件')
            else:
                patcher.save()
                modified.append(fpath)
                print(f'  ✅ {fpath.name}: 已更新')

    if not dry_run:
        print(f'\n📌 共修改 {len(modified)} 个文件')
    return modified


# ──────────────────────────────────────────────
# 快速查看差异
# ──────────────────────────────────────────────

def diff_layouts(path_a: str | Path, path_b: str | Path,
                 output: str | Path = None):
    """比较两个布局文件的差异"""
    from core.assets.tools.layout_merger import LayoutMerger

    try:
        with open(path_a) as f:
            data_a = json.load(f)
        with open(path_b) as f:
            data_b = json.load(f)
    except Exception as e:
        print(f'❌ 读取失败: {e}')
        return

    diff = LayoutMerger.diff(data_a, data_b)

    print(f'\n📊 差异: {Path(path_a).name} ↔ {Path(path_b).name}')

    ui_diff = diff.get('ui', {})
    if ui_diff:
        print(f'\n  🖼️  UI 属性差异:')
        for k, v in ui_diff.items():
            print(f'    {k}: {v}')

    bind_diff = diff.get('bindings', {})
    if bind_diff:
        print(f'\n  🔗 绑定差异:')
        for wid, evts in bind_diff.items():
            print(f'    {wid}: {evts}')

    var_diff = diff.get('variables', {})
    if var_diff:
        print(f'\n  📌 变量差异:')
        for k, v in var_diff.items():
            print(f'    {k}: {v}')

    if output:
        output = Path(output)
        with open(output, 'w', encoding='utf-8') as f:
            json.dump(diff, f, ensure_ascii=False, indent=2)
        print(f'\n  💾 差异已保存: {output}')
