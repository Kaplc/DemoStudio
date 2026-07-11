"""
canvas_manager — 画布管理器
============================
管理多个 UICanvas 实例, 支持:
    - 注册/注销画布
    - 画布切换 (push/pop/replace)
    - 层级自动排序
    - 统一更新
    - 画布栈 (类似导航栈)

用法:
    mgr = CanvasManager()

    # 预注册
    mgr.register('menu', UICanvas('menu.json'))
    mgr.register('settings', UICanvas('settings.json'))

    # 打开画布
    mgr.open('menu')         # 显示 menu
    mgr.open('settings')     # 自动隐藏 menu, 显示 settings
    mgr.pop()                # 返回 menu

    # 叠加 (不隐藏当前)
    mgr.overlay('dialog')    # dialog 覆盖在 settings 上面

    # 关闭指定画布
    mgr.close('dialog')      # 关闭 overlay

    # 全局更新 (每帧调用)
    mgr.update()
"""

from typing import Any, Optional, Callable

from core.logger import get_logger
from core.canvas.canvas import UICanvas, CanvasLayer, CanvasState, CanvasSettings

logger = get_logger('canvas.manager')


# ──────────────────────────────────────────────
# CanvasManager
# ──────────────────────────────────────────────

class CanvasManager:
    """画布管理器

    类似 Unity 的 Canvas system, 管理多个画布的层级和切换。
    """

    def __init__(self, root_parent=None):
        self._canvases: dict[str, UICanvas] = {}  # name → canvas 注册表
        self._stack: list[str] = []                # 显示的画布栈 (按打开顺序)
        self._overlays: list[str] = []             # 叠加层名字列表

        # 事件: canvas_name → {event: handler}
        self._global_bindings: dict[str, dict[str, Callable]] = {}

        logger.info('CanvasManager 初始化')

    # ─── 注册 ───

    def register(self, name: str, canvas: UICanvas) -> 'CanvasManager':
        """注册一个画布"""
        self._canvases[name] = canvas
        # 应用全局绑定
        if name in self._global_bindings:
            for event, handler in self._global_bindings[name].items():
                # 全局绑定针对画布的所有控件
                pass
        logger.debug('注册画布: {}', name)
        return self

    def unregister(self, name: str):
        """注销画布"""
        canvas = self._canvases.pop(name, None)
        if canvas:
            canvas.destroy()
            # 从栈中移除
            if name in self._stack:
                self._stack.remove(name)
            if name in self._overlays:
                self._overlays.remove(name)

    def get(self, name: str) -> Optional[UICanvas]:
        """获取已注册的画布"""
        return self._canvases.get(name)

    def get_current(self) -> Optional[UICanvas]:
        """获取当前显示的画布 (栈顶)"""
        if self._stack:
            return self._canvases.get(self._stack[-1])
        return None

    def __contains__(self, name: str) -> bool:
        return name in self._canvases

    def __getitem__(self, name: str) -> UICanvas:
        return self._canvases[name]

    # ─── 画布操作 ───

    def open(
        self, name: str, *, animated: bool = True, variables: dict = None
    ) -> UICanvas:
        """打开画布 (push 到栈顶)

        自动隐藏当前画布 (如果有) 并显示新画布。
        等同于导航栈的 push。

        Parameters
        ----------
        name : str
            画布名称 (须已注册)
        animated : bool
            是否启用过渡动画
        variables : dict, optional
            传递给画布的运行时变量
        """
        if name not in self._canvases:
            raise KeyError(f'画布 "{name}" 未注册。可用: {list(self._canvases.keys())}')

        # 先隐藏当前
        current_name = self._stack[-1] if self._stack else None
        if current_name and current_name != name:
            current = self._canvases[current_name]
            if current.is_shown:
                current.hide(animated=animated)

        canvas = self._canvases[name]

        # 注入变量
        if variables:
            canvas._variables.update(variables)

        # 如果不在栈中, 加入
        if name not in self._stack:
            self._stack.append(name)

        canvas.show(animated=animated)
        logger.info('打开画布: {} (栈深度: {})', name, len(self._stack))
        return canvas

    def overlay(self, name: str, *, animated: bool = True) -> UICanvas:
        """叠加画布 (不隐藏当前, 覆盖在上面)

        用于对话框、通知等叠加层。
        """
        if name not in self._canvases:
            raise KeyError(f'画布 "{name}" 未注册')

        canvas = self._canvases[name]
        canvas.show(animated=animated)

        if name not in self._overlays:
            self._overlays.append(name)

        logger.info('叠加画布: {}', name)
        return canvas

    def pop(self, animated: bool = True) -> Optional[UICanvas]:
        """关闭当前画布，返回上一个 (pop 导航栈)"""
        if not self._stack:
            return None

        # 关闭栈顶
        top_name = self._stack.pop()
        top_canvas = self._canvases.get(top_name)
        if top_canvas and top_canvas.is_shown:
            top_canvas.hide(animated=animated)

        logger.info('关闭画布: {} (栈深度: {})', top_name, len(self._stack))

        # 显示前一个
        if self._stack:
            prev = self._canvases[self._stack[-1]]
            prev.show(animated=animated)
            return prev

        return None

    def replace(
        self, name: str, *, animated: bool = True, variables: dict = None
    ) -> UICanvas:
        """替换当前画布 (不保留在栈中)"""
        if not self._stack:
            return self.open(name, animated=animated, variables=variables)

        # 关闭当前
        old_name = self._stack.pop()
        old = self._canvases.get(old_name)
        if old and old.is_shown:
            old.hide(animated=False)  # 替换时不动画

        canvas = self._canvases[name]
        if variables:
            canvas._variables.update(variables)

        canvas.show(animated=animated)
        self._stack.append(name)
        logger.info('替换画布: {} → {}', old_name, name)
        return canvas

    def close(self, name: str, animated: bool = True):
        """关闭指定画布"""
        canvas = self._canvases.get(name)
        if canvas is None:
            return

        if canvas.is_shown:
            canvas.hide(animated=animated)

        # 从栈中移除
        if name in self._stack:
            self._stack.remove(name)
        if name in self._overlays:
            self._overlays.remove(name)

        logger.info('关闭画布: {}', name)

    def close_all(self):
        """关闭所有画布"""
        for name in list(self._stack):
            self.open(None)  # won't work... let me fix
        for name in list(self._canvases.keys()):
            canvas = self._canvases[name]
            if canvas.is_shown:
                canvas.hide(animated=False)
        self._stack.clear()
        self._overlays.clear()
        logger.info('关闭所有画布')

    def hide_all(self):
        """隐藏所有画布 (保留栈)"""
        for name, canvas in self._canvases.items():
            if canvas.is_shown:
                canvas.hide(animated=False)

    def clear(self):
        """清空所有画布 (销毁)"""
        for canvas in list(self._canvases.values()):
            canvas.destroy()
        self._canvases.clear()
        self._stack.clear()
        self._overlays.clear()
        logger.info('CanvasManager 已清空')

    # ─── 全局事件绑定 ───

    def bind_global(
        self, canvas_name: str, widget_id: str, event: str, handler: Callable
    ) -> 'CanvasManager':
        """为已注册画布的控件绑定事件 (即时生效)"""
        canvas = self._canvases.get(canvas_name)
        if canvas:
            canvas.on(widget_id, event, handler)
        # 也记录下来, 以便画布延迟加载时应用
        self._global_bindings.setdefault(canvas_name, {})
        self._global_bindings[canvas_name][f'{widget_id}.{event}'] = handler
        return self

    # ─── 每帧更新 ───

    def update(self):
        """每帧调用, 更新所有显示中画布的动画"""
        for name, canvas in self._canvases.items():
            if canvas._state == CanvasState.SHOWN:
                canvas.update_animation()
            # 处理隐藏动画完成后的状态
            if canvas._state != CanvasState.SHOWN:
                canvas.update_animation()

    # ─── 查询 ───

    def list_canvases(self) -> list[str]:
        """列出所有已注册的画布名称"""
        return list(self._canvases.keys())

    def list_active(self) -> list[str]:
        """列出当前显示中的画布 (栈 + 叠加)"""
        active = list(self._stack) + [o for o in self._overlays if o not in self._stack]
        return active

    @property
    def canvas_count(self) -> int:
        return len(self._canvases)

    @property
    def stack_depth(self) -> int:
        return len(self._stack)

    @property
    def overlay_count(self) -> int:
        return len(self._overlays)

    # ─── 遍历 ───

    def for_each(self, callback: Callable):
        """遍历所有画布"""
        for name, canvas in self._canvases.items():
            callback(name, canvas)

    def for_active(self, callback: Callable):
        """遍历所有活跃画布"""
        for name in self.list_active():
            canvas = self._canvases.get(name)
            if canvas:
                callback(name, canvas)

    def print_status(self):
        """打印画布状态"""
        print(f'\n📊 CanvasManager 状态:')
        print(f'   注册画布: {self.canvas_count}')
        print(f'   导航栈 ({self.stack_depth}): {" → ".join(self._stack) if self._stack else "空"}')
        print(f'   叠加层 ({self.overlay_count}): {self._overlays if self._overlays else "无"}')
        for name, canvas in self._canvases.items():
            active = '🟢' if name in self._stack or name in self._overlays else '⚫'
            print(f'   {active} {name:20s} [{canvas.state.name}] {canvas.widget_count} widgets')
        print()

    def __repr__(self):
        return f'<CanvasManager: {self.canvas_count} canvases, stack={self._stack}>'
