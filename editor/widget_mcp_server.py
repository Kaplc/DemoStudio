"""
Widget MCP Server — FastMCP
============================
Modify UI widget properties in the editor layout JSON file at runtime.
Uses LayoutPatcher for direct JSON manipulation + IPC to trigger UI reload.

Usage:
  python widget_mcp_server.py

Register in VS Code .vscode/mcp.json:
  "widget-editor": {
    "command": "E:\\DemoStudio\\.venv\\Scripts\\python.exe",
    "args": ["editor\\widget_mcp_server.py"],
    "cwd": "E:\\DemoStudio"
  }
"""
import sys
import os
from pathlib import Path
from typing import Optional

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))

from fastmcp import FastMCP
from core.assets.tools import LayoutPatcher
from core.console import send_editor_command
from core.logger import get_logger

logger = get_logger('mcp.widget')

# ─── 布局文件路径 ───
LAYOUT_PATH = _root / 'editor' / 'assets' / 'editor_ui.json'

mcp = FastMCP("DemoStudio Widget Editor")


# ─── 内部工具 ───

def _patcher() -> LayoutPatcher:
    """创建 Patcher 实例"""
    return LayoutPatcher(str(LAYOUT_PATH))


def _save_and_reload(patcher: LayoutPatcher) -> dict:
    """保存 JSON 并通知编辑器刷新 UI"""
    patcher.save()
    send_editor_command("reload_ui")
    return {"status": "ok", "message": f"Layout saved to {LAYOUT_PATH}"}


def _try_save(patcher: LayoutPatcher) -> dict:
    """保存并返回结果"""
    try:
        patcher.save()
        return {"status": "ok", "message": "Layout saved"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ════════════════════════════════════════
#  MCP 工具 — 控件属性修改
# ════════════════════════════════════════

@mcp.tool(name="set_anchor", description="设置控件的锚点，例如 CENTER, TOP_LEFT, BOTTOM_RIGHT")
def set_anchor(widget_id: str, anchor: str) -> dict:
    """设置控件锚点"""
    patcher = _patcher()
    patcher.set_anchor(widget_id, anchor)
    return _try_save(patcher)


@mcp.tool(name="set_offset", description="设置控件相对锚点的偏移 [x, y]")
def set_offset(widget_id: str, x: float, y: float) -> dict:
    """设置偏移量"""
    patcher = _patcher()
    patcher.set_offset(widget_id, x, y)
    return _try_save(patcher)


@mcp.tool(name="set_size", description="设置控件尺寸 [width, height] (归一化坐标)")
def set_size(widget_id: str, width: float, height: float) -> dict:
    """设置尺寸"""
    patcher = _patcher()
    patcher.set_size(widget_id, width, height)
    return _try_save(patcher)


@mcp.tool(name="set_position", description="设置控件绝对位置 [x, y] (覆盖锚点)")
def set_position(widget_id: str, x: float, y: float) -> dict:
    """设置绝对位置"""
    patcher = _patcher()
    patcher.set_position(widget_id, x, y)
    return _try_save(patcher)


@mcp.tool(name="set_pivot", description="设置控件轴心，例如 CENTER, TOP_LEFT")
def set_pivot(widget_id: str, pivot: str) -> dict:
    """设置轴心"""
    patcher = _patcher()
    patcher.set_pivot(widget_id, pivot)
    return _try_save(patcher)


@mcp.tool(name="set_color", description="设置控件颜色 (#hex 格式，如 #ff0000)")
def set_color(widget_id: str, color: str) -> dict:
    """设置颜色"""
    patcher = _patcher()
    patcher.set_color(widget_id, color)
    return _try_save(patcher)


@mcp.tool(name="set_alpha", description="设置控件透明度 (0.0=透明, 1.0=不透明)")
def set_alpha(widget_id: str, alpha: float) -> dict:
    """设置透明度"""
    patcher = _patcher()
    patcher.set_alpha(widget_id, alpha)
    return _try_save(patcher)


@mcp.tool(name="set_z", description="设置控件渲染层级 (z 轴，数值越大越靠前)")
def set_z(widget_id: str, z: float) -> dict:
    """设置渲染层级"""
    patcher = _patcher()
    patcher.set_z(widget_id, z)
    return _try_save(patcher)


@mcp.tool(name="set_stretch", description="设置控件填充拉伸 (true=填满父级, 或 {left,right,top,bottom})")
def set_stretch(widget_id: str, stretch) -> dict:
    """设置填充拉伸"""
    patcher = _patcher()
    patcher.set_stretch(widget_id, stretch)
    return _try_save(patcher)


@mcp.tool(name="set_text", description="设置控件的文字内容")
def set_text(widget_id: str, text: str) -> dict:
    """设置文字"""
    patcher = _patcher()
    patcher.set_text(widget_id, text)
    return _try_save(patcher)


@mcp.tool(name="set_font_size", description="设置文字字号")
def set_font_size(widget_id: str, size: float) -> dict:
    """设置字号"""
    patcher = _patcher()
    patcher.set_font_size(widget_id, size)
    return _try_save(patcher)


# ════════════════════════════════════════
#  MCP 工具 — 子控件管理
# ════════════════════════════════════════

@mcp.tool(name="add_child", description="给指定父控件添加一个子控件")
def add_child(
    parent_id: str,
    widget_id: str,
    widget_type: str = "UIWidget",
    text: Optional[str] = None,
    anchor: Optional[str] = None,
    offset_x: Optional[float] = None,
    offset_y: Optional[float] = None,
    width: Optional[float] = None,
    height: Optional[float] = None,
    color: Optional[str] = None,
    font_size: Optional[float] = None,
    z: Optional[float] = None,
) -> dict:
    """添加子控件到指定父级

    Args:
        parent_id: 父控件 id
        widget_id: 新控件 id
        widget_type: 控件类型 (UIWidget, UIButton, UIText, UIPanel 等)
        text: 文字内容
        anchor: 锚点 (如 CENTER, TOP_LEFT)
        offset_x, offset_y: 偏移量
        width, height: 尺寸
        color: 颜色 #hex
        font_size: 字号
        z: 渲染层级
    """
    props = {}
    if text is not None:
        props['text'] = text
    if anchor is not None:
        props['anchor'] = anchor
    if offset_x is not None and offset_y is not None:
        props['offset'] = [offset_x, offset_y]
    if width is not None and height is not None:
        props['size'] = [width, height]
    if color is not None:
        props['color'] = color
    if font_size is not None:
        props['font_size'] = font_size
    if z is not None:
        props['z'] = z

    patcher = _patcher()
    try:
        patcher.add_widget(widget_id, widget_type, parent_id=parent_id, **props)
        return _try_save(patcher)
    except KeyError as e:
        return {"status": "error", "message": str(e)}


@mcp.tool(name="remove_widget", description="移除指定控件及其所有子控件")
def remove_widget(widget_id: str) -> dict:
    """移除控件"""
    patcher = _patcher()
    try:
        patcher.remove_widget(widget_id)
        return _try_save(patcher)
    except KeyError as e:
        return {"status": "error", "message": str(e)}


# ════════════════════════════════════════
#  MCP 工具 — 查询
# ════════════════════════════════════════

@mcp.tool(name="list_widgets", description="列出布局中所有控件的 id 和类型")
def list_widgets() -> dict:
    """列出所有控件"""
    patcher = _patcher()
    ids = patcher.list_widget_ids()
    widgets = []
    for wid in ids:
        wtype = patcher.get_widget_type(wid) or "?"
        widgets.append({"id": wid, "type": wtype})
    return {"status": "ok", "widgets": widgets, "count": len(widgets)}


@mcp.tool(name="get_widget_info", description="获取指定控件的完整属性信息")
def get_widget_info(widget_id: str) -> dict:
    """获取控件属性"""
    patcher = _patcher()
    node = patcher.find_widget(widget_id)
    if node is None:
        return {"status": "error", "message": f"Widget '{widget_id}' not found"}
    return {"status": "ok", "widget": node}


@mcp.tool(name="print_hierarchy", description="打印完整控件层级树")
def print_hierarchy() -> str:
    """打印布局层级树"""
    patcher = _patcher()
    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        patcher.print_hierarchy()
    return buf.getvalue()


@mcp.tool(name="reload_ui", description="通知编辑器重新加载 UI 布局文件")
def reload_ui() -> dict:
    """通知编辑器刷新 UI"""
    ok = send_editor_command("reload_ui")
    if ok:
        return {"status": "ok", "message": "Reload command sent to editor"}
    return {"status": "error", "message": "Failed to send IPC command. Is the editor running?"}


# ════════════════════════════════════════
#  入口
# ════════════════════════════════════════

if __name__ == "__main__":
    mcp.run()
